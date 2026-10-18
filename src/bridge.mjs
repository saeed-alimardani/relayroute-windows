import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import { FirefoxPassProvider } from './auth.mjs';
import { openProxyTunnel } from './dns.mjs';

export function parseConnectTarget(authority) {
  if (typeof authority !== 'string' || authority.length > 300 || /[\r\n\s@/#?]/.test(authority)) {
    throw new Error('Invalid CONNECT authority');
  }
  let host; let port;
  if (authority.startsWith('[')) {
    const match = authority.match(/^\[([0-9a-fA-F:.]+)\]:(\d{1,5})$/);
    if (!match || net.isIP(match[1]) !== 6) throw new Error('Invalid IPv6 CONNECT authority');
    [, host, port] = match;
  } else {
    const match = authority.match(/^([^:]+):(\d{1,5})$/);
    if (!match) throw new Error('Invalid CONNECT authority');
    [, host, port] = match;
  }
  const portNumber = Number(port);
  if (portNumber < 1 || portNumber > 65535 || !host || /[^a-zA-Z0-9.\-]/.test(host.replace(/:/g, ''))) throw new Error('Invalid CONNECT host or port');
  return { host, port: portNumber };
}

const health = { ready: false, connected: 0, failed: 0, lastError: null };
function sanitizeError(error) {
  const message = String(error?.message || error || 'Unknown error');
  // Do not expose any tokens or response bodies.
  return message.slice(0, 160);
}

export function createBridge({ passProvider, upstreamHost, upstreamIp, upstreamPort = 2499 } = {}) {
  if (!passProvider) throw new Error('passProvider is required');
  if (!upstreamHost || !/^[a-z0-9.-]+$/i.test(upstreamHost)) throw new Error('Valid upstreamHost is required');
  if (upstreamIp && net.isIP(upstreamIp) !== 4) throw new Error('Valid IPv4 upstreamIp is required');
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(health));
    } else {
      let url;
      try { url = new URL(req.url); } catch {
        res.writeHead(400); res.end('Invalid proxy request'); return;
      }
      if (url.protocol !== 'http:' || !url.hostname || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) {
        res.writeHead(405); res.end('Unsupported request'); return;
      }
      const port = Number(url.port || 80);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        res.writeHead(400); res.end('Invalid proxy port'); return;
      }
      const target = net.isIP(url.hostname) === 6 ? `[${url.hostname}]:${port}` : `${url.hostname}:${port}`;
      const agent = new http.Agent({ keepAlive: false });
      agent.createConnection = (_options, cb) => {
        openProxyTunnel({ target }).then(sock => cb(null, sock), cb);
      };
      const headers = { ...req.headers };
      delete headers['proxy-connection'];
      delete headers['proxy-authorization'];
      delete headers.connection;
      const forwarded = http.request({
        hostname: url.hostname, port, method: req.method,
        path: url.pathname + url.search, agent, headers,
        timeout: 20000
      }, upstreamRes => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      });
      forwarded.on('timeout', () => forwarded.destroy(new Error('Proxy request timeout')));
      forwarded.on('error', err => {
        health.failed++;
        health.lastError = sanitizeError(err);
        if (!res.headersSent) res.writeHead(502);
        res.end('Proxy unavailable');
      });
      req.pipe(forwarded);
    }
  });

  server.on('connect', async (request, client, head) => {
    let upstream;
    let responded = false;
    const fail = (error, status = 502) => {
      health.failed++;
      health.lastError = sanitizeError(error);
      if (!responded && !client.destroyed) {
        client.end(`HTTP/1.1 ${status} Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      } else client.destroy();
      upstream?.destroy();
    };
    try {
      const { host, port } = parseConnectTarget(request.url);
      const token = await passProvider.getPass();
      if (client.destroyed) return;
      upstream = tls.connect({
        host: upstreamIp || upstreamHost, port: upstreamPort, servername: upstreamHost,
        ALPNProtocols: ['http/1.1'],
        rejectUnauthorized: true, timeout: 14000
      });
      upstream.once('error', error => fail(error));
      upstream.once('timeout', () => fail(new Error('Upstream timeout')));
      upstream.once('secureConnect', () => {
        const authority = net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
        upstream.write(
          `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Authorization: Bearer ${token}\r\nProxy-Connection: keep-alive\r\n\r\n`
        );
      });
      let response = Buffer.alloc(0);
      const receiveHeaders = chunk => {
        response = Buffer.concat([response, chunk]);
        if (response.length > 16384) return fail(new Error('Proxy header too large'));
        const headerEnd = response.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        upstream.off('data', receiveHeaders);
        const firstLine = response.subarray(0, response.indexOf('\r\n')).toString('latin1');
        if (!/^HTTP\/1\.[01] 200(?:\s|$)/.test(firstLine)) {
          return fail(new Error(`Upstream refused CONNECT: ${firstLine.replace(/[^a-zA-Z0-9 .-]/g, '')}`));
        }
        responded = true;
        health.connected++;
        health.ready = true;
        health.lastError = null;
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) upstream.write(head);
        if (response.length > headerEnd + 4) client.write(response.subarray(headerEnd + 4));
        upstream.setTimeout(0);
        client.pipe(upstream);
        upstream.pipe(client);
      };
      upstream.on('data', receiveHeaders);
      client.on('error', () => upstream?.destroy());
      client.on('close', () => upstream?.destroy());
    } catch (error) { fail(error); }
  });
  return server;
}

function opt(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === new URL('file:///' + process.argv[1].replace(/\\/g, '/')).href) {
  const provider = new FirefoxPassProvider({ profile: opt('profile') });
  const upstreamHost = opt('host', 'p.m1.fastly-masque.net');
  const upstreamIp = opt('host-ip');
  const upstreamPort = Number(opt('port', '2499'));
  const listenPort = Number(opt('listen', '18080'));
  const server = createBridge({ passProvider: provider, upstreamHost, upstreamIp, upstreamPort });
  // Fail before changing any system routing.
  provider.getPass().then(() => {
    server.listen(listenPort, '127.0.0.1', () => {
      console.log(`Firefox bridge ready on 127.0.0.1:${listenPort}`);
    });
  }).catch(e => {
    console.error('Firefox auth unavailable:', sanitizeError(e));
    process.exitCode = 1;
  });
  process.on('SIGINT', () => server.close());
  process.on('SIGTERM', () => server.close());
}

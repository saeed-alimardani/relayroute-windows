import net from 'node:net';
import dgram from 'node:dgram';
import tls from 'node:tls';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

const DNS_HOST = 'cloudflare-dns.com';
const MAX_ANSWER = 65535;
const MAX_QUERY = 4096;

export function openProxyTunnel({ proxyPort = 18080, target = DNS_HOST + ':443' } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, '127.0.0.1');
    let headers = Buffer.alloc(0);
    const finish = err => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      socket.setTimeout(0);
      if (err) { socket.destroy(); reject(err); }
      else resolve(socket);
    };
    const onError = e => finish(e);
    const onClose = () => finish(new Error('Local bridge disconnected'));
    const onData = chunk => {
      headers = Buffer.concat([headers, chunk]);
      if (headers.length > 8192) return finish(new Error('Invalid local proxy response'));
      const end = headers.indexOf('\r\n\r\n');
      if (end < 0) return;
      const status = headers.subarray(0, headers.indexOf('\r\n')).toString('latin1');
      if (!/^HTTP\/1\.[01] 200(?:\s|$)/.test(status)) return finish(new Error('DNS HTTPS tunnel refused by local proxy'));
      if (headers.length > end + 4) socket.unshift(headers.subarray(end + 4));
      finish();
    };
    socket.setTimeout(12000, () => finish(new Error('DNS proxy CONNECT timeout')));
    socket.once('connect', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    socket.on('error', onError);
    socket.on('close', onClose);
    socket.on('data', onData);
  });
}

class LocalBridgeHttpsAgent extends https.Agent {
  constructor(proxyPort) {
    super({ keepAlive: false, maxSockets: 16 });
    this.proxyPort = proxyPort;
  }
  createConnection(_options, callback) {
    openProxyTunnel({ proxyPort: this.proxyPort }).then(socket => {
      const secured = tls.connect({
        socket, servername: DNS_HOST, ALPNProtocols: ['http/1.1'],
        rejectUnauthorized: true
      });
      secured.once('secureConnect', () => callback(null, secured));
      secured.once('error', callback);
    }, callback);
  }
}

export function dnsViaHttps(packet, { proxyPort = 18080, timeout = 15000 } = {}) {
  if (!Buffer.isBuffer(packet) || packet.length < 12 || packet.length > MAX_QUERY) return Promise.reject(new Error('Invalid DNS request'));
  const agent = new LocalBridgeHttpsAgent(proxyPort);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: DNS_HOST, port: 443, path: '/dns-query', method: 'POST',
      agent, timeout,
      headers: {
        'Content-Type': 'application/dns-message',
        Accept: 'application/dns-message',
        'Content-Length': String(packet.length),
        Connection: 'close'
      }
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('DNS HTTPS service returned HTTP ' + res.statusCode));
        return;
      }
      const data = [];
      let total = 0;
      res.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_ANSWER) { req.destroy(new Error('Oversized DNS answer')); return; }
        data.push(chunk);
      });
      res.on('end', () => {
        const answer = Buffer.concat(data);
        if (answer.length < 12 || !answer.subarray(0, 2).equals(packet.subarray(0, 2))) return reject(new Error('Invalid DNS answer'));
        resolve(answer);
      });
    });
    req.on('timeout', () => req.destroy(new Error('DNS HTTPS timeout')));
    req.on('error', reject);
    req.end(packet);
  }).finally(() => agent.destroy());
}

export async function startLocalDns({ listen = '127.0.0.1', port = 53, proxyPort = 18080 } = {}) {
  const udp = dgram.createSocket(net.isIP(listen) === 6 ? 'udp6' : 'udp4');
  const tcp = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    let busy = false;
    socket.on('data', chunk => {
      if (busy) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 2) return;
      const length = buffer.readUInt16BE(0);
      if (length < 12 || length > MAX_QUERY) return socket.destroy();
      if (buffer.length < 2 + length) return;
      busy = true;
      dnsViaHttps(buffer.subarray(2, 2 + length), { proxyPort })
        .then(answer => {
          if (!socket.destroyed) {
            const len = Buffer.alloc(2);
            len.writeUInt16BE(answer.length);
            socket.end(Buffer.concat([len, answer]));
          }
        }).catch(err => {
          if (process.env.FFVPN_DNS_DEBUG === '1') console.error('TCP DNS: ' + err.message);
          socket.destroy();
        });
    });
  });
  let inFlight = 0;
  udp.on('message', (msg, peer) => {
    if (inFlight >= 32 || msg.length > MAX_QUERY) return;
    inFlight++;
    dnsViaHttps(msg, { proxyPort })
      .then(answer => udp.send(answer, peer.port, peer.address))
      .catch(err => {
        if (process.env.FFVPN_DNS_DEBUG === '1') console.error('UDP DNS: ' + err.message);
      })
      .finally(() => inFlight--);
  });
  try {
    await new Promise((resolve, reject) => {
      udp.once('error', reject);
      udp.bind(port, listen, () => { udp.off('error', reject); resolve(); });
    });
    await new Promise((resolve, reject) => {
      tcp.once('error', reject);
      tcp.listen(port, listen, () => { tcp.off('error', reject); resolve(); });
    });
  } catch (err) {
    udp.close();
    tcp.close();
    throw err;
  }
  return { close: () => { udp.close(); tcp.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const listen = process.env.FFVPN_DNS_HOST || '127.0.0.1';
  startLocalDns({ listen, port: Number(process.env.FFVPN_DNS_PORT || 53) })
    .then(() => console.log('Firefox DNS-over-HTTPS bridge ready on ' + listen + ':53'))
    .catch(err => { console.error('DNS bridge failed: ' + err.message); process.exitCode = 1; });
}

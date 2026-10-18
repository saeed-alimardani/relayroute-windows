import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FirefoxPassProvider } from './auth.mjs';
import { createBridge } from './bridge.mjs';
import { createSocksServer } from './socks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Installed files live under Program Files. Runtime locks/logs must be writable
// without modifying the installation directory.
const RUN = process.env.RELAYROUTE_STATE_DIR ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'RelayRoute', 'state');
const LOCK = path.join(RUN, 'controller.lock');
const STOP = path.join(RUN, 'stop.signal');
const STATUS = path.join(RUN, 'status.json');
const TUN = path.join(ROOT, 'bin', 'tun2proxy-bin.exe');
const PORT = 18080;
const SOCKS_PORT = 18081;
const HOST = 'p.m1.fastly-masque.net';

function ensureRun() { fs.mkdirSync(RUN, { recursive: true }); }
function atomicJson(file, value) {
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function acquireLock() {
  ensureRun();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const prior = readJson(LOCK);
      if (prior && alive(prior.pid)) throw new Error('VPN controller is already running');
      try { fs.unlinkSync(LOCK); } catch {}
    }
  }
  throw new Error('Could not acquire controller lock');
}
function releaseLock() {
  if (readJson(LOCK)?.pid === process.pid) {
    try { fs.unlinkSync(LOCK); } catch {}
  }
}

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}
function close(server) {
  if (!server?.listening) return;
  server.close();
  server.closeAllConnections?.();
}

function fetchText(url, timeout = 8500) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, agent: false, headers: { Connection: 'close' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('IP check HTTP ' + res.statusCode)); }
      let body = '';
      res.on('data', chunk => {
        body += chunk.toString('utf8');
        if (body.length > 128) req.destroy(new Error('IP check too large'));
      });
      res.once('end', () => resolve(body.trim()));
    });
    req.once('timeout', () => req.destroy(new Error('IP check timed out')));
    req.once('error', reject);
  });
}

export function viaProxy(target = 'api.ipify.org:443', proxyPort = PORT) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: target, method: 'CONNECT', timeout: 13000 });
    req.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        return reject(new Error('Upstream tunnel refused: ' + response.statusCode));
      }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.once('timeout', () => req.destroy(new Error('HTTP bridge timed out')));
    req.once('error', reject);
    req.end();
  });
}

export async function egressThroughProxy() {
  const socket = await viaProxy();
  return new Promise((resolve, reject) => {
    const req = https.get('https://api.ipify.org', {
      agent: new class extends https.Agent {
        createConnection(_options, done) {
          const tunneled = tls.connect({ socket, servername: 'api.ipify.org', rejectUnauthorized: true });
          tunneled.once('secureConnect', () => done(null, tunneled));
          tunneled.once('error', done);
        }
      }({ keepAlive: false }),
      timeout: 13000
    }, res => {
      let body = '';
      res.on('data', c => body += c.toString('utf8'));
      res.on('end', () => resolve(body.trim()));
    });
    req.once('error', reject);
    req.once('timeout', () => req.destroy(new Error('Tunnel check timed out')));
  });
}

function isIPv4(value) { return net.isIP(value) === 4 && value !== '0.0.0.0'; }

async function terminate(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 3500);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}

export function detectOrphanWintun(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces).some(([name, addresses]) =>
    /wintun/i.test(name) && addresses.some(info => info.family === 'IPv4' && info.address === '10.0.0.33')
  );
}

function waitForStopOrExit(tunnel, signal) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (fs.existsSync(STOP)) { clearInterval(timer); resolve('user-stop'); }
      else if (signal.aborted) { clearInterval(timer); resolve('signal'); }
    }, 450);
    tunnel.once('exit', (code) => { clearInterval(timer); resolve('tunnel-exit-' + code); });
    timer.unref?.();
  });
}

export async function runController() {
  acquireLock();
  try { fs.unlinkSync(STOP); } catch {}
  let state = { pid: process.pid, state: 'starting', since: new Date().toISOString() };
  const publish = (updates) => { state = { ...state, ...updates, updatedAt: Date.now() }; atomicJson(STATUS, state); };
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let bridge, socks, tunnel;
  let checkTimer;
  try {
    if (process.platform !== 'win32') throw new Error('Windows only');
    if (!fs.existsSync(TUN) || !fs.existsSync(path.join(ROOT, 'bin', 'wintun.dll'))) throw new Error('tun2proxy/Wintun is missing');
    if (detectOrphanWintun()) throw new Error('An existing Wintun tunnel is active; check or repair network before connecting');
    const provider = new FirefoxPassProvider();
    const upstreamIps = await dns.resolve4(HOST);
    const upstreamIp = upstreamIps[0];
    if (!isIPv4(upstreamIp)) throw new Error('Could not resolve Fastly gateway');
    await provider.getPass();
    bridge = createBridge({ passProvider: provider, upstreamHost: HOST, upstreamIp });
    await listen(bridge, PORT);
    socks = createSocksServer({ httpProxyPort: PORT });
    await listen(socks, SOCKS_PORT);
    publish({ state: 'checking', upstreamIp });

    const proxiedIp = await egressThroughProxy();
    if (!isIPv4(proxiedIp)) throw new Error('Firefox proxy egress test failed');
    const directIp = await fetchText('https://api.ipify.org');
    if (!isIPv4(directIp)) throw new Error('Direct network is not ready');
    if (abort.signal.aborted || fs.existsSync(STOP)) throw new Error('Connection canceled');
    publish({ state: 'routing', proxyIp: proxiedIp });

    const args = [
      '--setup', '--proxy', 'http://127.0.0.1:' + PORT,
      '--dns', 'virtual', '--ipv6-enabled', '--mtu', '1400', '--tcp-mss', '1360',
      '--max-sessions', '400', '--verbosity', 'error',
      '--bypass', upstreamIp
    ];
    tunnel = spawn(TUN, args, { cwd: path.dirname(TUN), windowsHide: true, stdio: 'ignore' });
    tunnel.once('error', error => publish({ state: 'error', error: error.message }));
    await new Promise(resolve => setTimeout(resolve, 2800));
    if (tunnel.exitCode !== null) throw new Error('tun2proxy exited on startup');
    if (abort.signal.aborted || fs.existsSync(STOP)) throw new Error('Connection canceled');
    // A system-wide request must succeed; a virtual-DNS failure means no usable tunnel.
    const systemIp = await fetchText('https://api.ipify.org');
    if (!isIPv4(systemIp)) throw new Error('System traffic check failed');
    if (directIp === systemIp) throw new Error('System IP did not change: tunnel is not routing traffic');
    publish({ state: 'connected', systemIp });

    let consecutiveFailures = 0;
    checkTimer = setInterval(async () => {
      if (abort.signal.aborted || !tunnel || tunnel.exitCode !== null) return;
      try {
        const value = await egressThroughProxy();
        if (!isIPv4(value)) throw new Error('Invalid egress IP');
        consecutiveFailures = 0;
        publish({ state: 'connected', proxyIp: value });
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          publish({ state: 'error', error: 'Firefox upstream connection lost' });
          abort.abort();
        }
      }
    }, 25000);
    await waitForStopOrExit(tunnel, abort.signal);
  } catch (error) {
    publish({ state: 'error', error: String(error?.message || error).slice(0, 180) });
    console.error('Firefox VPN:', error?.message || error);
    process.exitCode = 1;
  } finally {
    if (checkTimer) clearInterval(checkTimer);
    publish({ state: 'stopping' });
    await terminate(tunnel);
    close(socks);
    close(bridge);
    publish({ state: 'disconnected', pid: null });
    releaseLock();
    try { fs.unlinkSync(STOP); } catch {}
  }
}

export function queryStatus() {
  const lock = readJson(LOCK);
  const status = readJson(STATUS);
  if (!lock || !alive(lock.pid)) return { state: 'disconnected' };
  return status || { state: 'starting' };
}

async function stopController() {
  const lock = readJson(LOCK);
  if (!lock || !alive(lock.pid)) return;
  fs.writeFileSync(STOP, String(Date.now()));
  for (let i = 0; i < 30; i++) {
    if (!alive(lock.pid)) return;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Controller did not stop; do not force network shutdown without checking route');
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  const action = process.argv[2] || 'status';
  if (action === 'start') runController();
  else if (action === 'stop') stopController().catch(e => { console.error(e.message); process.exitCode = 1; });
  else if (action === 'status') console.log(JSON.stringify(queryStatus()));
  else { console.error('Usage: node src/controller.mjs [start|stop|status]'); process.exitCode = 2; }
}

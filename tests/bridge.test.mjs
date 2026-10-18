import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConnectTarget, createBridge } from '../src/bridge.mjs';
import { sessionBearerId, jwtExpiry } from '../src/auth.mjs';

test('CONNECT target safely validates ports, host, and IPv6', () => {
  assert.deepEqual(parseConnectTarget('example.com:443'), { host: 'example.com', port: 443 });
  assert.deepEqual(parseConnectTarget('[::1]:443'), { host: '::1', port: 443 });
  for (const target of ['example.com', 'bad:0', 'bad:65536', 'bad name:443', 'a:443\r\nInjected: yes', 'user@a:80']) {
    assert.throws(() => parseConnectTarget(target));
  }
});

test('typed Bearer session ID is deterministic and validated', () => {
  const id = sessionBearerId('aa'.repeat(32));
  assert.match(id, /^fxs_[0-9a-f]{64}$/);
  assert.equal(id, sessionBearerId('aa'.repeat(32)));
  assert.throws(() => sessionBearerId('invalid'));
});

test('JWT expiry rejects expired or malformed pass', () => {
  const jwt = body => 'e30.' + Buffer.from(JSON.stringify(body)).toString('base64url') + '.signature';
  assert.ok(jwtExpiry(jwt({ exp: Math.floor(Date.now() / 1000) + 600 })) > Date.now());
  assert.throws(() => jwtExpiry(jwt({ exp: 10 })));
  assert.throws(() => jwtExpiry('garbage'));
});

test('bridge only answers health and does not enable plain forwarding', async () => {
  const server = createBridge({ passProvider: { getPass: async () => 'not-used' }, upstreamHost: 'example.com' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ready, false);
    const other = await fetch(`http://127.0.0.1:${address.port}/example`);
    assert.equal(other.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('pinned upstream must be a real IPv4 address', () => {
  assert.throws(() => createBridge({ passProvider: {}, upstreamHost: 'example.com', upstreamIp: 'virtual.local' }));
  assert.doesNotThrow(() => createBridge({ passProvider: {}, upstreamHost: 'example.com', upstreamIp: '23.235.42.11' }));
});

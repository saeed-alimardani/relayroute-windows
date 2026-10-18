import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSocksDestination } from '../src/socks.mjs';

test('SOCKS5 parses IPv4 and domain connect packets', () => {
  assert.deepEqual(decodeSocksDestination(Buffer.from([5,1,0,1,1,1,1,1,1,187])), {host:'1.1.1.1',port:443,length:10});
  assert.deepEqual(decodeSocksDestination(Buffer.from([5,1,0,3,3,97,46,98,1,187])), {host:'a.b',port:443,length:10});
  assert.equal(decodeSocksDestination(Buffer.from([5,1,0])), null);
  assert.throws(() => decodeSocksDestination(Buffer.from([5,2,0,1,1,1,1,1,1,187])));
});

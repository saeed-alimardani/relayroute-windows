import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dnsViaHttps } from '../src/dns.mjs';

test('DNS proxy rejects non-DNS inputs without making network connections', async () => {
  await assert.rejects(() => dnsViaHttps(Buffer.from('no')));
  await assert.rejects(() => dnsViaHttps(Buffer.alloc(5000)));
});

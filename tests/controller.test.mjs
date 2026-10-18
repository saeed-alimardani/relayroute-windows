import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOrphanWintun } from '../src/controller.mjs';

test('only a Wintun adapter with our expected interface address is considered orphaned', () => {
  assert.equal(detectOrphanWintun({
    Ethernet: [{ family: 'IPv4', address: '10.0.0.33' }]
  }), false);
  assert.equal(detectOrphanWintun({
    wintun: [{ family: 'IPv4', address: '10.0.0.33' }]
  }), true);
  assert.equal(detectOrphanWintun({
    WireGuard: [{ family: 'IPv4', address: '10.0.0.33' }],
    wintun: [{ family: 'IPv4', address: '10.1.1.3' }]
  }), false);
});

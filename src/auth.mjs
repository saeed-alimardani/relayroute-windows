import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const FIREFOX_SCOPES = 'profile https://identity.mozilla.com/apps/vpn';
const OAUTH_CLIENT_ID = '5882386c6d801776';
const OAUTH_URL = 'https://api.accounts.firefox.com/v1/oauth/token';
// The current Guardian API is hosted at .org. Some Mozilla source defaults
// still reference .com, which no longer resolves on this network.
const GUARDIAN_URL = 'https://vpn.mozilla.org/api/v1/fpn/token';

export function firefoxProfiles(base = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Mozilla', 'Firefox', 'Profiles')) {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(base, e.name, 'signedInUser.json')))
    .map(e => path.join(base, e.name));
}

export function resolveProfile(value) {
  if (value) {
    const candidate = path.resolve(value);
    if (!fs.existsSync(path.join(candidate, 'signedInUser.json'))) throw new Error('Firefox account data not found in selected profile');
    return candidate;
  }
  const profiles = firefoxProfiles();
  if (profiles.length === 0) throw new Error('No signed-in Firefox profile was found');
  if (profiles.length === 1) return profiles[0];
  // Avoid choosing an unrelated account automatically if multiple profiles exist.
  throw new Error('Multiple signed-in profiles: select one with --profile');
}

export function readSessionToken(profile) {
  const file = path.join(profile, 'signedInUser.json');
  const stat = fs.statSync(file);
  if (stat.size > 1024 * 1024) throw new Error('Unexpected Firefox account file size');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const token = data.accountData?.sessionToken;
  if (typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token)) throw new Error('Firefox has no usable account session token');
  return token;
}

export function sessionBearerId(sessionToken) {
  if (!/^[a-f\d]{64}$/i.test(sessionToken)) throw new Error('Invalid session token');
  const key = crypto.hkdfSync(
    'sha256',
    Buffer.from(sessionToken, 'hex'),
    Buffer.alloc(0),
    Buffer.from('identity.mozilla.com/picl/v1/sessionToken'),
    96
  );
  return 'fxs_' + Buffer.from(key).subarray(0, 32).toString('hex');
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
    cache: 'no-store'
  });
  const body = await response.text();
  if (!response.ok) {
    // Never log an API response body, which could contain account data.
    throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  }
  try { return JSON.parse(body); } catch { throw new Error('Unexpected non-JSON response from authentication service'); }
}

export function jwtExpiry(jwt) {
  if (typeof jwt !== 'string' || jwt.split('.').length !== 3) throw new Error('Invalid proxy pass');
  let body;
  try { body = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid proxy pass payload'); }
  if (!Number.isFinite(body.exp) || body.exp <= Date.now() / 1000) throw new Error('Proxy pass expired');
  return body.exp * 1000;
}

export class FirefoxPassProvider {
  constructor({ profile, fetchImpl } = {}) {
    this.profile = resolveProfile(profile);
    this.fetchImpl = fetchImpl || requestJSON;
    this.cachedPass = null;
    this.validUntil = 0;
    this.pending = null;
  }

  async getPass() {
    if (this.cachedPass && Date.now() < this.validUntil - 60000) return this.cachedPass;
    if (!this.pending) this.pending = this.#renew().finally(() => { this.pending = null; });
    return this.pending;
  }

  async #renew() {
    const token = readSessionToken(this.profile);
    const oauth = await this.fetchImpl(OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + sessionBearerId(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: OAUTH_CLIENT_ID,
        grant_type: 'fxa-credentials',
        scope: FIREFOX_SCOPES
      })
    });
    if (typeof oauth?.access_token !== 'string' || !oauth.access_token) throw new Error('Firefox OAuth token unavailable');
    const guardian = await this.fetchImpl(GUARDIAN_URL, {
      headers: { Authorization: 'Bearer ' + oauth.access_token }
    });
    const pass = guardian?.token;
    const expiry = jwtExpiry(pass);
    this.cachedPass = pass;
    this.validUntil = expiry;
    return pass;
  }
}

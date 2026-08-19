// Shared helpers, inlined into every Code node by scripts/build_workflows.py.
//
// HMAC_SECRET and ALLOWED_ORIGIN are injected above this by the deploy script.
// They are NOT in the committed JSON — the build writes a placeholder and
// scripts/deploy_n8n.py substitutes the real value from a gitignored local file.
//
// Static data is still used for the PIN rate limiter and the replay guard, which
// is safe: those are only ever written by production executions. Secrets cannot
// live there — n8n discards static data written during a manual test run, so
// there is no way to seed it by hand.

const EVENT_KEY = 'ls2026';
const SESSION_TTL_HOURS = 24;
const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;

// The Code-node sandbox has no `crypto` global and forbids 'node:crypto',
// but plain require('crypto') is allowed — verified against the live instance.
const nodeCrypto = require('crypto');

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64url = (text) => Buffer.from(text, 'base64url');

function hmac(secret, message) {
  return nodeCrypto.createHmac('sha256', secret).update(message).digest();
}

/** Compare two strings without leaking their difference through timing. */
function constantTimeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

function issueSession(device) {
  const payload = {
    device,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString(),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(hmac(HMAC_SECRET, body));
  return { token: `${body}.${sig}`, payload };
}

/** Returns the session payload, or null when the token is absent/forged/expired. */
function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!HMAC_SECRET) return null;
  const expected = b64url(hmac(HMAC_SECRET, body));
  if (!constantTimeEqual(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload.expires_at || new Date(payload.expires_at).getTime() < Date.now()) return null;
  return payload;
}

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function reply(statusCode, body) {
  return [{ json: { statusCode, headers: CORS, body } }];
}

/** Case-insensitive header lookup — proxies normalise header case differently. */
function header(headers, name) {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

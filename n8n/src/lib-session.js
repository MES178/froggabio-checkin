// Shared helpers, inlined into every Code node by scripts/build_workflows.py.
//
// Secrets (staff PIN, HMAC secret) live in this workflow's static data, seeded
// once by the "Seed secrets" manual trigger. They are therefore NOT in the
// exported JSON that gets committed — see docs/SETUP.md.

const EVENT_KEY = 'ls2026';
const SESSION_TTL_HOURS = 24;
const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;

function secrets() {
  const store = $getWorkflowStaticData('global');
  if (!store.pin || !store.hmacSecret) {
    throw new Error('Secrets are not seeded. Run the "Seed secrets" trigger once.');
  }
  return store;
}

function b64url(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmac(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
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

async function issueSession(device) {
  const payload = {
    device,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString(),
  };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(secrets().hmacSecret, body));
  return { token: `${body}.${sig}`, payload };
}

/** Returns the session payload, or null when the token is absent/forged/expired. */
async function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  let expected;
  try {
    expected = b64url(await hmac(secrets().hmacSecret, body));
  } catch (_) {
    return null;
  }
  if (!constantTimeEqual(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
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

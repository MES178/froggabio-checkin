// WF-A step 1 — mint a token and a short code for each new registrant.
//
// Idempotency: the search that feeds this node already excludes contacts that
// have a token. A token is never regenerated — the attendee may already be
// holding that QR in their inbox.

const EVENT_KEY = 'ls2026';
// No I, O, 0 or 1 — those are the characters staff misread off a phone screen.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const store = $getWorkflowStaticData('global');
store.issuedCodes = store.issuedCodes || {};

function uuidV4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomCode() {
  const picks = new Uint32Array(8);
  crypto.getRandomValues(picks);
  const chars = [...picks].map((n) => ALPHABET[n % ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

function uniqueCode(taken) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = randomCode();
    if (!store.issuedCodes[code] && !taken.has(code)) return code;
  }
  throw new Error('Could not find a free short code after 50 attempts');
}

const response = $input.first().json || {};
const contacts = Array.isArray(response.results) ? response.results : [];
const takenThisRun = new Set();

// Codes already in HubSpot are the authority; static data is only a fast cache.
for (const contact of contacts) {
  const code = (contact.properties || {}).ls2026_short_code;
  if (code) store.issuedCodes[code] = true;
}

const out = [];
for (const contact of contacts) {
  const props = contact.properties || {};
  if (props.ls2026_token) continue; // belt and braces

  const code = uniqueCode(takenThisRun);
  takenThisRun.add(code);
  store.issuedCodes[code] = true;

  out.push({
    json: {
      hs_id: contact.id,
      event_key: EVENT_KEY,
      token: uuidV4(),
      short_code: code,
      email: props.email || '',
      first_name: props.firstname || '',
      last_name: props.lastname || '',
      registered_at: props.recent_conversion_date || props.createdate || new Date().toISOString(),
    },
  });
}

return out;

// WF-A step 1 — mint a token and a short code for each new registrant.
//
// Idempotency: the search that feeds this node already excludes contacts that
// have a token. A token is never regenerated — the attendee may already be
// holding that QR in their inbox.

// No `crypto` global in the Code-node sandbox; require('crypto') is allowed.
const nodeCrypto = require('crypto');

const EVENT_KEY = 'ls2026';
// No I, O, 0 or 1 — those are the characters staff misread off a phone screen.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const store = $getWorkflowStaticData('global');
store.issuedCodes = store.issuedCodes || {};

const uuidV4 = () => nodeCrypto.randomUUID();

function randomCode() {
  const bytes = nodeCrypto.randomBytes(8);
  const chars = [...bytes].map((n) => ALPHABET[n % ALPHABET.length]);
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

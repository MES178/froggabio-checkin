// WF-C — POST /webhook/ls2026/auth   { pin, device } -> { session_token, expires_at }
//
// Rate limited per source IP: 5 attempts / 15 minutes (spec §10, §12.4).

const req = $input.first().json;
const method = (req.method || 'POST').toUpperCase();
if (method === 'OPTIONS') return reply(204, {});

const body = req.body || {};
const headers = req.headers || {};
const ip = header(headers, 'x-forwarded-for') || header(headers, 'x-real-ip') || 'unknown';
const device = String(body.device || '').trim().slice(0, 40);
const pin = String(body.pin || '');

if (!STAFF_PIN || !HMAC_SECRET) {
  return reply(503, { message: 'Check-in server is not configured yet. Set the desk PIN in n8n.' });
}

const store = $getWorkflowStaticData('global');
store.pinAttempts = store.pinAttempts || {};

const now = Date.now();
const record = store.pinAttempts[ip] || { count: 0, first: now };
if (now - record.first > PIN_WINDOW_MS) {
  record.count = 0;
  record.first = now;
}

if (record.count >= PIN_MAX_ATTEMPTS) {
  store.pinAttempts[ip] = record;
  return reply(429, { message: 'Too many attempts. Wait 15 minutes.' });
}

if (!device) return reply(400, { message: 'Device label is required.' });

if (!constantTimeEqual(pin, STAFF_PIN)) {
  record.count += 1;
  store.pinAttempts[ip] = record;
  return reply(401, { message: 'Wrong PIN.' });
}

delete store.pinAttempts[ip];

// Housekeeping: drop attempt records older than the window so the bag cannot
// grow without bound across the event.
for (const [key, value] of Object.entries(store.pinAttempts)) {
  if (now - value.first > PIN_WINDOW_MS) delete store.pinAttempts[key];
}

const session = issueSession(device);
return reply(200, {
  session_token: session.token,
  expires_at: session.payload.expires_at,
  device,
  event_key: EVENT_KEY,
});

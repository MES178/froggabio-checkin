// WF-D step 1 — authorise before any HubSpot call or any PII leaves the box.

const req = $input.first().json;
const method = (req.method || 'GET').toUpperCase();
if (method === 'OPTIONS') return [{ json: { authorized: false, preflight: true } }];

const session = verifySession(header(req.headers, 'x-session-token'));
return [{ json: { authorized: Boolean(session), device: session ? session.device : null } }];

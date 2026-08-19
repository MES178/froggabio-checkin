// WF-E step 1 — authorise the batch and work out which tokens to look up.
//
// The scanner may drain several offline scans at once. scan_id makes a retried
// batch harmless: anything already applied is remembered in static data.

const req = $input.first().json;
const method = (req.method || 'POST').toUpperCase();
if (method === 'OPTIONS') return [{ json: { authorized: false, preflight: true, tokens: [] } }];

const session = await verifySession(header(req.headers, 'x-session-token'));
if (!session) return [{ json: { authorized: false, tokens: [], scans: [] } }];

const scans = Array.isArray((req.body || {}).scans) ? req.body.scans : [];
const store = $getWorkflowStaticData('global');
store.appliedScans = store.appliedScans || {};

// Keep the replay guard from growing forever: entries older than 48h are gone.
const cutoff = Date.now() - 48 * 3600 * 1000;
for (const [id, at] of Object.entries(store.appliedScans)) {
  if (at < cutoff) delete store.appliedScans[id];
}

const clean = [];
for (const scan of scans.slice(0, 200)) {
  if (!scan || !scan.scan_id || !scan.token) continue;
  clean.push({
    scan_id: String(scan.scan_id),
    action: scan.action === 'undo' ? 'undo' : 'checkin',
    token: String(scan.token),
    scanned_at: scan.scanned_at || new Date().toISOString(),
    method: ['qr', 'manual_search', 'short_code'].includes(scan.method) ? scan.method : 'qr',
    device: String(scan.device || session.device || '').slice(0, 40),
    replay: Boolean(store.appliedScans[String(scan.scan_id)]),
  });
}

const tokens = [...new Set(clean.filter((s) => !s.replay).map((s) => s.token))];
return [{ json: { authorized: true, device: session.device, scans: clean, tokens } }];

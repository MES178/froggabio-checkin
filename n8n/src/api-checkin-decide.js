// WF-E step 2 — decide each scan against HubSpot, and build one batch update.
//
// Rules (spec §10 WF-E):
//   not found            -> report, write nothing
//   already checked in   -> report the ORIGINAL time and device, never overwrite
//   otherwise            -> attended, with the CLIENT's scanned_at (the scan may
//                           have happened offline an hour ago)

const plan = $('Plan check-ins').first().json;
const scans = plan.scans || [];

const byToken = new Map();
for (const item of $input.all()) {
  const body = item.json || {};
  if (!Array.isArray(body.results)) continue;
  for (const contact of body.results) {
    const token = (contact.properties || {}).ls2026_token;
    if (token) byToken.set(token, contact);
  }
}

const results = [];
const updates = new Map(); // hs_id -> properties, so two scans of one person collapse

for (const scan of scans) {
  if (scan.replay) {
    results.push({ scan_id: scan.scan_id, token: scan.token, result: 'applied' });
    continue;
  }

  const contact = byToken.get(scan.token);
  if (!contact) {
    results.push({ scan_id: scan.scan_id, token: scan.token, result: 'not_found' });
    continue;
  }

  const props = contact.properties || {};

  if (scan.action === 'undo') {
    updates.set(contact.id, {
      ls2026_status: 'registered',
      ls2026_checked_in_at: '',
      ls2026_checkin_method: '',
      ls2026_checkin_device: '',
    });
    results.push({ scan_id: scan.scan_id, token: scan.token, result: 'undone' });
    continue;
  }

  if (props.ls2026_status === 'cancelled') {
    results.push({ scan_id: scan.scan_id, token: scan.token, result: 'cancelled' });
    continue;
  }

  const pending = updates.get(contact.id);
  const existing = props.ls2026_checked_in_at || (pending && pending.ls2026_checked_in_at);

  if (existing) {
    // First check-in wins. If two devices raced offline, the earlier local
    // timestamp is authoritative and the later one is logged, not applied.
    const keepExisting = new Date(existing) <= new Date(scan.scanned_at);
    if (!keepExisting) {
      updates.set(contact.id, {
        ls2026_status: 'attended',
        ls2026_checked_in_at: new Date(scan.scanned_at).toISOString(),
        ls2026_checkin_method: scan.method,
        ls2026_checkin_device: scan.device,
      });
    }
    results.push({
      scan_id: scan.scan_id,
      token: scan.token,
      result: 'already_checked_in',
      checked_in_at: keepExisting ? existing : new Date(scan.scanned_at).toISOString(),
      device: keepExisting ? props.ls2026_checkin_device || pending?.ls2026_checkin_device || null : scan.device,
    });
    continue;
  }

  updates.set(contact.id, {
    ls2026_status: 'attended',
    ls2026_checked_in_at: new Date(scan.scanned_at).toISOString(),
    ls2026_checkin_method: scan.method,
    ls2026_checkin_device: scan.device,
  });
  results.push({
    scan_id: scan.scan_id,
    token: scan.token,
    result: 'checked_in',
    checked_in_at: new Date(scan.scanned_at).toISOString(),
    device: scan.device,
  });
}

const inputs = [...updates.entries()].map(([id, properties]) => ({ id, properties }));
return [{ json: { authorized: true, results, inputs, hasUpdates: inputs.length > 0 } }];

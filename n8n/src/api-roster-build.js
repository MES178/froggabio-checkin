// WF-D step 2 — shape the HubSpot search results into the door list.
//
// Two search pages are fetched (100 each). Anything beyond 200 registrants is
// reported honestly via roster_truncated rather than silently dropped.

const pages = $input.all();
const seen = new Set();
const attendees = [];
let total = 0;

for (const page of pages) {
  const body = page.json || {};
  if (body.error || !Array.isArray(body.results)) continue; // page 2 is absent when page 1 was the last
  total = Math.max(total, body.total || 0);
  for (const contact of body.results) {
    const p = contact.properties || {};
    if (!p.ls2026_token || seen.has(contact.id)) continue;
    seen.add(contact.id);
    attendees.push({
      hs_id: contact.id,
      token: p.ls2026_token,
      short_code: p.ls2026_short_code || '',
      first_name: p.firstname || '',
      last_name: p.lastname || '',
      company: p.company || '',
      email: p.email || '',
      status: p.ls2026_status || 'registered',
      checked_in_at: p.ls2026_checked_in_at || null,
      checkin_device: p.ls2026_checkin_device || null,
    });
  }
}

return reply(200, {
  event_key: EVENT_KEY,
  generated_at: new Date().toISOString(),
  count: attendees.length,
  total_in_hubspot: total,
  roster_truncated: total > attendees.length,
  attendees,
});

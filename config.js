/**
 * Scanner configuration. NO SECRETS EVER GO IN THIS FILE.
 *
 * This file is served publicly by GitHub Pages. Everything here is world
 * readable. The HubSpot token lives only in n8n credentials; the scanner talks
 * to n8n and nothing else.
 */
window.APP_CONFIG = {
  eventKey: 'ls2026',
  eventName: 'Life Science Event',
  eventDate: 'October 6, 2026 · 6:00 PM',

  // n8n Cloud webhook base. Production paths are /webhook/<...>; while testing a
  // workflow in the n8n editor, switch to /webhook-test/ and reload.
  n8nBase: 'https://fgbio.app.n8n.cloud/webhook',

  // Paths are deliberately distinct from the parallel ls2026/* stack built
  // alongside this one, so the two never collide on a webhook path.
  endpoints: {
    auth: '/ls2026-cc/auth',
    roster: '/ls2026-cc/roster',
    checkin: '/ls2026-cc/checkin',
  },

  // Sync behaviour
  queueRetryBaseMs: 2000,
  queueRetryMaxMs: 60000,
  resultDismissMs: 2500,
};

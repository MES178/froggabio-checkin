/**
 * Scanner configuration. NO SECRETS EVER GO IN THIS FILE.
 *
 * This file is served publicly by GitHub Pages. Everything here is world
 * readable. The HubSpot token lives only in n8n credentials; the scanner talks
 * to n8n and nothing else.
 */
window.APP_CONFIG = {
  eventKey: 'ls2026',
  eventName: 'FroggaBio Life Science Event',
  eventDate: 'October 6, 2026',

  // n8n Cloud webhook base. Production paths are /webhook/<...>; while testing a
  // workflow in the n8n editor, switch to /webhook-test/ and reload.
  n8nBase: 'https://fgbio.app.n8n.cloud/webhook',

  endpoints: {
    auth: '/ls2026/auth',
    roster: '/ls2026/roster',
    checkin: '/ls2026/checkin',
  },

  // Sync behaviour
  queueRetryBaseMs: 2000,
  queueRetryMaxMs: 60000,
  resultDismissMs: 2500,
};

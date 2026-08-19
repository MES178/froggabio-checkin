// Run this ONCE from the n8n editor ("Test step" on the Seed secrets trigger).
//
// Why here and not in the node parameters: whatever is written in a node body
// ends up in the exported JSON we commit. Static data does not — so the staff
// PIN and the session-signing secret exist only inside the running n8n instance.
//
// Set STAFF_PIN below, run the node once, then blank it out and save again.
// Re-running with a new PIN rotates it; rotating HMAC_SECRET signs every phone
// out immediately, which is the revocation lever from spec §12.3.

const STAFF_PIN = ''; // <- put the desk PIN here for one run, then clear it

// No `crypto` global in the Code-node sandbox; require('crypto') is allowed.
const nodeCrypto = require('crypto');

const store = $getWorkflowStaticData('global');

if (STAFF_PIN) {
  store.pin = STAFF_PIN;
}
if (!store.hmacSecret) {
  store.hmacSecret = nodeCrypto.randomBytes(32).toString('hex');
}

return [
  {
    json: {
      pin_set: Boolean(store.pin),
      hmac_secret_set: Boolean(store.hmacSecret),
      note: 'Clear STAFF_PIN from this node and save the workflow.',
    },
  },
];

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

const store = $getWorkflowStaticData('global');

if (STAFF_PIN) {
  store.pin = STAFF_PIN;
}
if (!store.hmacSecret) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  store.hmacSecret = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
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

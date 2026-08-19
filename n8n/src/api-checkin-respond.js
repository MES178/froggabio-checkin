// WF-E step 3 — mark scans applied and answer the scanner.
//
// A scan is only marked applied once HubSpot accepted the batch, so a failed
// write is retried by the phone rather than silently swallowed.

const decision = $('Decide check-ins').first().json;
const batch = $input.first().json || {};
const writeFailed = decision.hasUpdates && (batch.error || batch.status === 'error');

const store = $getWorkflowStaticData('global');
store.appliedScans = store.appliedScans || {};

const results = decision.results.map((r) => {
  const wroteNothing = ['not_found', 'cancelled'].includes(r.result);
  if (writeFailed && !wroteNothing) return { ...r, result: 'retry' };
  if (!wroteNothing) store.appliedScans[r.scan_id] = Date.now();
  return r;
});

return reply(writeFailed ? 502 : 200, {
  event_key: EVENT_KEY,
  applied: results.filter((r) => r.result !== 'retry').length,
  results,
});

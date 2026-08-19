/**
 * Run the Code-node bodies from WF-API-checkin.json in a stubbed n8n context.
 *
 * These nodes hold the security-relevant logic — PIN rate limiting, HMAC session
 * signing, the first-check-in-wins rule — so they are worth testing before they
 * ever touch the live instance.
 *
 * Run: node scripts/test_api_nodes.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, 'n8n/WF-API-checkin.json'), 'utf8'));
// Secrets are constants in the node bodies now, filled in at deploy time. The
// tests fill in their own so they exercise exactly the shipped code.
const TEST_PIN = '4821';
const TEST_SECRET = 'test-secret-not-used-anywhere-real';

const bodyOf = (name) =>
  workflow.nodes
    .find((n) => n.name === name)
    .parameters.jsCode.replace(/__HMAC_SECRET__/g, TEST_SECRET)
    .replace(/^const STAFF_PIN = '[^']*';$/m, `const STAFF_PIN = '${TEST_PIN}';`);

const staticData = {};
let failures = 0;

function check(label, condition, detail) {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/** Execute one node body with the n8n globals it expects. */
async function runNode(name, { input, nodeOutputs = {} }) {
  const context = {
    $input: {
      first: () => ({ json: input[0] }),
      all: () => input.map((json) => ({ json })),
    },
    $getWorkflowStaticData: () => staticData,
    $: (nodeName) => ({
      first: () => ({ json: nodeOutputs[nodeName] }),
      item: { json: nodeOutputs[nodeName] },
    }),
    // The n8n sandbox exposes require('crypto') and no crypto global — mirror
    // that here so the tests exercise what actually runs.
    require: (name) => {
      if (name === 'crypto') return require('crypto');
      throw new Error(`Module '${name}' is disallowed`);
    },
    TextEncoder,
    TextDecoder,
    console,
    Buffer,
  };
  context.globalThis = context;
  const fn = vm.runInNewContext(`(async function(){${bodyOf(name)}})`, context);
  return fn.call({});
}

(async () => {
  check('PIN and signing secret are wired into the node bodies',
    bodyOf('Authenticate').includes(`const STAFF_PIN = '${TEST_PIN}'`) &&
    bodyOf('Authenticate').includes(TEST_SECRET) &&
    !bodyOf('Verify roster session').includes('__HMAC_SECRET__'));

  const authReq = (pin, ip = '1.2.3.4') => [
    { method: 'POST', headers: { 'X-Forwarded-For': ip }, body: { pin, device: 'Desk 1' } },
  ];

  // ---- wrong PIN is rejected, then rate limited ---------------------------
  let statuses = [];
  for (let i = 0; i < 6; i++) {
    const r = await runNode('Authenticate', { input: authReq('0000') });
    statuses.push(r[0].json.statusCode);
  }
  check('five wrong PINs return 401', statuses.slice(0, 5).every((s) => s === 401), statuses.join(','));
  check('sixth attempt is rate limited (429)', statuses[5] === 429);

  // ---- correct PIN from a different IP still works ------------------------
  const good = await runNode('Authenticate', { input: authReq(TEST_PIN, '9.9.9.9') });
  const session = good[0].json.body.session_token;
  check('correct PIN issues a session', good[0].json.statusCode === 200 && Boolean(session));
  check('CORS header is the exact Pages origin, not *',
    good[0].json.headers['Access-Control-Allow-Origin'] === 'https://mes178.github.io',
    good[0].json.headers['Access-Control-Allow-Origin']);

  // ---- session verification ----------------------------------------------
  const verify = async (token) =>
    (await runNode('Verify roster session', { input: [{ method: 'GET', headers: { 'x-session-token': token } }] }))[0]
      .json.authorized;

  check('valid session is accepted', await verify(session));
  check('missing session is rejected', !(await verify(undefined)));
  check('tampered signature is rejected', !(await verify(session.slice(0, -3) + 'aaa')));

  const [payloadPart] = session.split('.');
  const forged = Buffer.from(
    JSON.stringify({ device: 'Evil', expires_at: new Date(Date.now() + 3.6e6).toISOString() })
  ).toString('base64url');
  check('forged payload with old signature is rejected', !(await verify(`${forged}.${session.split('.')[1]}`)));
  check('payload survives the round trip', typeof payloadPart === 'string' && payloadPart.length > 10);

  // ---- expired session ----------------------------------------------------
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const expiredBody = b64url(
    Buffer.from(JSON.stringify({ device: 'Desk 1', expires_at: new Date(Date.now() - 1000).toISOString() }))
  );
  const expiredSig = b64url(
    require('crypto').createHmac('sha256', TEST_SECRET).update(expiredBody).digest()
  );
  check('expired session is rejected', !(await verify(`${expiredBody}.${expiredSig}`)));

  // ---- check-in decisions -------------------------------------------------
  const scanReq = (scans) => [
    { method: 'POST', headers: { 'x-session-token': session }, body: { scans } },
  ];

  const earlier = '2026-10-06T13:00:00.000Z';
  const later = '2026-10-06T13:05:00.000Z';

  const plan = await runNode('Plan check-ins', {
    input: scanReq([
      { scan_id: 's1', token: 'tok-jane', scanned_at: later, method: 'qr', device: 'Desk 1' },
      { scan_id: 's2', token: 'tok-ahmed', scanned_at: later, method: 'manual_search', device: 'Desk 2' },
      { scan_id: 's3', token: 'tok-nobody', scanned_at: later, method: 'qr', device: 'Desk 1' },
      { scan_id: 's4', token: 'tok-marie', scanned_at: later, method: 'qr', device: 'Desk 1' },
    ]),
  });
  check('plan authorises and lists tokens', plan[0].json.authorized && plan[0].json.tokens.length === 4);

  const hubspotResults = {
    results: [
      { id: '1', properties: { ls2026_token: 'tok-jane', ls2026_status: 'registered' } },
      {
        id: '2',
        properties: {
          ls2026_token: 'tok-ahmed',
          ls2026_status: 'attended',
          ls2026_checked_in_at: earlier,
          ls2026_checkin_device: 'Desk 3',
        },
      },
      { id: '4', properties: { ls2026_token: 'tok-marie', ls2026_status: 'cancelled' } },
    ],
  };

  const decided = await runNode('Decide check-ins', {
    input: [hubspotResults],
    nodeOutputs: { 'Plan check-ins': plan[0].json },
  });
  const byId = Object.fromEntries(decided[0].json.results.map((r) => [r.scan_id, r]));

  check('new scan checks in', byId.s1.result === 'checked_in');
  check('already checked in keeps the ORIGINAL time and device',
    byId.s2.result === 'already_checked_in' && byId.s2.checked_in_at === earlier && byId.s2.device === 'Desk 3',
    JSON.stringify(byId.s2));
  check('unknown token reports not_found', byId.s3.result === 'not_found');
  check('cancelled registration is not admitted', byId.s4.result === 'cancelled');
  check('only the real check-in is written', decided[0].json.inputs.length === 1 && decided[0].json.inputs[0].id === '1');

  // ---- responding + replay guard -----------------------------------------
  const answered = await runNode('Answer scanner', {
    input: [{ status: 'COMPLETE' }],
    nodeOutputs: { 'Decide check-ins': decided[0].json },
  });
  check('scanner gets 200 with per-scan results',
    answered[0].json.statusCode === 200 && answered[0].json.body.results.length === 4);

  const replayPlan = await runNode('Plan check-ins', {
    input: scanReq([{ scan_id: 's1', token: 'tok-jane', scanned_at: later, method: 'qr', device: 'Desk 1' }]),
  });
  check('a retried batch is recognised as a replay', replayPlan[0].json.scans[0].replay === true);

  // ---- a failed HubSpot write must not be marked applied ------------------
  const decided2 = await runNode('Decide check-ins', {
    input: [{ results: [{ id: '9', properties: { ls2026_token: 'tok-new', ls2026_status: 'registered' } }] }],
    nodeOutputs: {
      'Plan check-ins': {
        authorized: true,
        scans: [{ scan_id: 's9', action: 'checkin', token: 'tok-new', scanned_at: later, method: 'qr', device: 'Desk 1', replay: false }],
      },
    },
  });
  const failed = await runNode('Answer scanner', {
    input: [{ error: 'HubSpot 500' }],
    nodeOutputs: { 'Decide check-ins': decided2[0].json },
  });
  check('a failed write tells the phone to retry',
    failed[0].json.statusCode === 502 && failed[0].json.body.results[0].result === 'retry');
  check('a failed write is not remembered as applied', !staticData.appliedScans.s9);

  // ---- unauthorized branch -----------------------------------------------
  const denied = await runNode('Roster unauthorized', { input: [{ authorized: false }] });
  check('unauthorized branch returns 401', denied[0].json.statusCode === 401);
  const preflight = await runNode('Roster unauthorized', { input: [{ preflight: true }] });
  check('CORS preflight returns 204', preflight[0].json.statusCode === 204);

  // ---- roster shaping -----------------------------------------------------
  const roster = await runNode('Build roster', {
    input: [
      {
        total: 2,
        results: [
          {
            id: '1',
            properties: {
              ls2026_token: 'tok-jane', ls2026_short_code: 'H4K2-9PQR', firstname: 'Jane',
              lastname: 'Doe', company: 'UofT', email: 'jane@example.edu', ls2026_status: 'registered',
            },
          },
          { id: '5', properties: { firstname: 'No', lastname: 'Token' } },
        ],
      },
      { error: 'page 2 did not run' },
    ],
  });
  check('roster includes only contacts with a token', roster[0].json.body.count === 1);
  check('roster reports truncation honestly', roster[0].json.body.roster_truncated === true);

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();

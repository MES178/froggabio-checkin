# Decisions

Answers to the open questions in BUILD_SPEC §2, plus the places where this build
deliberately departs from that spec. Recorded 2026-08-19.

## Answers

| # | Question | Answer | Source |
|---|---|---|---|
| Q1 | HubSpot subscription tier | Workflows are available (43 exist; the automation API answers 200). **We still build the polling path**, because it is idempotent by construction and survives a missed webhook. | verified against the portal |
| Q2 | n8n self-hosted or Cloud | **Cloud** (`fgbio.app.n8n.cloud`). No npm packages in Code nodes → the QR encoder is vendored into the node body. | existing FroggaBio n8n instance |
| Q3 | n8n reachable over public HTTPS | **Yes.** Not a blocker. | same |
| Q4 | Expected registrants | **Up to 150.** Guests arriving with a registrant are checked in by name search, not by their own QR. | owner |
| Q5 | Scanning devices | Assume **3**, staff-owned phones. Each signs in with its own label. | default |
| Q6 | Does the registration form exist | It did not. The event page's "Register Now" pointed at a HubSpot **survey** (`survey.hsforms.com/12sGcimhCQb-…`), which gives no list membership or follow-up email. A native form was created instead. | owner decision |
| Q7 | One-off or recurring | The check-in system covers **one event: Life Science, 6 October 2026**. The Pathology event on 7 October is out of scope. Property names are prefixed `ls2026_` so a second event cannot collide. | owner |
| Q8 | Venue Wi-Fi | Assume **unreliable**. Offline mode is mandatory and is built. | default |
| Q9 | Who owns the repo and n8n after launch | **Open.** Today the GitHub account (MES178) and the n8n instance are effectively one person's. Spec §20 point 5 is not satisfied until a second person has access. | escalated, unresolved |

## Deviations from the spec, and why

**WF-B is not a separate workflow.** QR rendering is a Code node inside WF-A.
Calling a sub-workflow adds an Execute Workflow hop that can fail on its own, for
no gain — nothing else ever renders a QR.

**WF-C, WF-D and WF-E are one workflow, not three.** They share the staff PIN and
the session-signing secret, and n8n static data is per workflow. Keeping them
together means those secrets live in the running instance's static data and never
appear in the JSON we commit. Three workflows would have forced the secrets into
node bodies, and therefore into the repository.

**The roster is fetched as two pages of 100, not with generic pagination.** At up
to 150 registrants two pages is enough with headroom, and it avoids a pagination
config that is easy to get subtly wrong. If the roster ever exceeds 200 the
response says so via `roster_truncated`, rather than quietly returning a short
list — a silent short roster would turn into people being turned away at the door.

**The service worker is network-first, not cache-first.** Cache-first pins each
phone to the build it first loaded, so a fix pushed on the morning of the event
would never arrive. Network-first still works fully offline: the cached copy
answers as soon as the network fails.

**The scan loop uses `setTimeout`, not `requestAnimationFrame`.** rAF stops in a
backgrounded or embedded view, which would show a live camera preview that
silently scans nothing — the worst possible failure at a registration desk.

**Search runs over the in-memory roster, not an IndexedDB index.** At 150 records
a filter over an array is instant; a secondary index is machinery without a
purpose at this size.

**No consent checkbox on the form.** FroggaBio's current forms use
`legalConsentOptions: none`, and this form follows house practice rather than
inventing a legal control. Spec §12.1 still applies: someone who owns privacy
compliance should confirm the existing consent language covers this processing
before the invitations go out.

## Found on the live instance

Five things only showed up once the workflows were running against real n8n:

**A multi-method webhook has one output per method, and n8n picks their order —
not you.** `httpMethods: ["POST", "OPTIONS"]` put POST on output *1*, so wiring
output 0 alone meant every POST ran the trigger and then silently stopped. Every
output is now wired to the same handler, which is correct whatever the ordering.

**The Code-node sandbox has no `crypto` global.** `crypto.randomUUID`,
`getRandomValues` and `crypto.subtle` are all undefined, and `require('node:crypto')`
is blocked — but plain `require('crypto')` is allowed and gives `randomUUID`,
`randomBytes` and `createHmac`. Session signing, token minting and secret seeding
all use that now, verified by probing the live sandbox.

**Static data written during a manual execution is discarded.** The original
design seeded the staff PIN and the signing secret from a manual trigger; the run
reported success and persisted nothing, so `/auth` stayed 503. Secrets are now
constants — the PIN edited in the `Authenticate` node, the signing secret injected
at deploy from a gitignored file. Static data still carries the rate limiter and
replay guard, which only production executions write.

**A Code node in "run once for each item" mode rejects `$input.first()`** and must
return a single object rather than an array. Both per-item nodes in the issuer hit
this ("Can't use .first() here") and now use `$input.item`.

**n8n answers the CORS preflight itself and echoes whatever Origin it is sent.**
Verified: a preflight from `https://evil.example.com` came back with
`Access-Control-Allow-Origin: https://evil.example.com`. That is the `*` the spec
forbids, wearing a disguise. Fixed by pinning `options.allowedOrigins` on all
three webhook nodes; the attacker origin now gets our origin back instead.

## Parallel implementation

The same system was being built in parallel with different tooling in the same
n8n instance. Ours is kept strictly separate: `ls2026-cc/*` webhook paths, an
`LS2026 (CC)` name prefix that the deploy script enforces, and a different Pages
repository. Nothing of theirs is read, modified or activated.

The two token issuers both write `ls2026_token`, so only one may ever run — ours
is deployed **inactive**. Their QR holds a URL rather than a bare token, so this
scanner now also accepts a token in a `t`/`token`/`code` query parameter and will
read codes from either stack.

## Verified end to end, against live HubSpot and live n8n

- A test registrant was issued a token, an unambiguous short code and a QR PNG
  uploaded to HubSpot File Manager; the PNG downloaded from HubSpot's CDN decodes
  back to exactly that contact's token.
- Sign-in, roster download and check-in all work from the published scanner.
- A check-in writes `attended` with the **client's** scan time, method and device.
- A second scan from another desk returns `already_checked_in` with the original
  time and desk, and does not overwrite.
- A retried batch is recognised by `scan_id` and applied once.
- An unrelated code returns `not_found`; undo returns the contact to `registered`
  and clears the timestamp.
- Offline: with every network call failing, the scan showed green instantly, the
  queue went to 1, and on reconnect it drained to 0 and landed in HubSpot **with
  the time of the scan, not the time of the sync**.

Test data was cleaned up afterwards: the temporary PIN was removed, and the test
contact's `ls2026_*` properties were cleared. The contact
`ls2026.pipeline.test@example.com` (id 243045909886) and one QR file under
`/event-checkin/ls2026/` still exist — delete them if you would rather they did not.

## Still open

- **The staff PIN is not set**, so `/auth` answers 503 by design. It is one line
  in the `Authenticate` node; nobody but the marketing lead should type it.
- **The confirmation email and the landing page are not built yet.** Event
  details are now settled: Life Science Event, Tuesday 6 October 2026, 6:00 PM,
  Jewel Box at MaRS Discovery District, 101 College Street, Toronto, ON M5G 0A3.
- **Which token issuer runs** — ours or the parallel one — is undecided, and the
  confirmation email and landing page are not built yet.
- **Q9 ownership** above.
- The business decision between this build, SimpleEvents.io and Ticket Tailor sits
  with Harel and Chris. This system exists; it has not been chosen.

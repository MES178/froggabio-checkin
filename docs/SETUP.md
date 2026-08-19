# Setup

How to rebuild this system from nothing. Steps marked **done** are already in
place in the live FroggaBio portal (hub 39925748).

## 1. HubSpot properties — done

Property group `ls2026_event_checkin` ("Event Check-In (Life Science 2026)") with
eight contact properties:

| Internal name | Type | Written by |
|---|---|---|
| `ls2026_token` | string | WF-A |
| `ls2026_short_code` | string | WF-A |
| `ls2026_qr_url` | string | WF-A |
| `ls2026_registered_at` | datetime | WF-A |
| `ls2026_status` | enumeration (`registered`/`attended`/`cancelled`) | form, WF-A, check-in API |
| `ls2026_checked_in_at` | datetime | check-in API |
| `ls2026_checkin_method` | enumeration (`qr`/`manual_search`/`short_code`) | check-in API |
| `ls2026_checkin_device` | string | check-in API |

To recreate: `python3 scripts/hs_setup_properties.py` (idempotent — existing
properties are reported and left alone).

`ls2026_status` additionally has `formField: true`, without which HubSpot rejects
it as a form field.

## 2. Registration form — done

`Life Science Event 2026 — Registration`, id `5c9b318b-635e-40df-8520-75da00bf3621`.

Fields: first name, last name, email, company/institution (all required), job
title (optional), plus a **hidden** `ls2026_status` defaulting to `registered`.

That hidden default is the whole trigger mechanism: it is the marker WF-A polls
for, so issuing tokens needs neither a HubSpot workflow nor a webhook.

To recreate: `python3 scripts/hs_setup_form.py`.

Two API quirks worth knowing if you touch this again:
- `POST /marketing/v3/forms` requires a top-level `createdAt`, undocumented as required.
- A property with `formField: false` fails form creation with a bare `"internal error"`.

## 3. HubSpot private app

The build used the existing FroggaBio service key. **Before the event, create a
dedicated private app** so this system can be revoked without affecting anything
else, with only:

- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
- `files`

Do not grant schema-write scopes. The properties already exist; a token that can
rewrite the CRM schema is a much worse thing to leak.

## 4. n8n credential — done

Header Auth credential `HubSpot Private App (LS2026 CC)`, id `SG7zuxUhsoSeYZ7H`,
created by `scripts/deploy_n8n.py`. It currently carries the shared FroggaBio
service key; swap it for a dedicated private app before the event.

### Recreating it

In n8n → Credentials → **Header Auth**, named `HubSpot Private App (LS2026)`:

- Name: `Authorization`
- Value: `Bearer <private app token>`

This is the only place the HubSpot token exists. Note the credential id — the
workflow JSON ships with `REPLACE_WITH_CREDENTIAL_ID` in its place.

## 5. Deploy the workflows — done

```bash
python3 scripts/deploy_n8n.py --activate-api
```

Live now:

| Workflow | id | Active |
|---|---|---|
| `LS2026 (CC) — Check-In API` | `37PZKD5ElbQ9cmmL` | **yes** |
| `LS2026 (CC) — Issue Tokens` | `71T3IuWfKboHaqkd` | **no — deliberately** |

Endpoints (note the `-cc` — see "Parallel stack" below):

- `POST https://fgbio.app.n8n.cloud/webhook/ls2026-cc/auth`
- `GET  https://fgbio.app.n8n.cloud/webhook/ls2026-cc/roster`
- `POST https://fgbio.app.n8n.cloud/webhook/ls2026-cc/checkin`

### Rebuilding from source

```bash
python3 scripts/build_workflows.py --origin https://mes178.github.io
```

That regenerates `n8n/WF-A-issue-tokens.json` and `n8n/WF-API-checkin.json` from
the readable sources in `n8n/src/`. **Edit the sources, never the JSON.**

Import both into n8n, set the Header Auth credential on every HTTP Request node,
then:

1. Open **LS2026 — Check-In API** → node `Write secrets to store` → set
   `STAFF_PIN` to the desk PIN → run the `Seed secrets` trigger once → **clear the
   PIN from the node and save**. The PIN now lives in the workflow's static data,
   not in any file.
2. Activate both workflows.
3. Note the three production webhook URLs and confirm they match `config.js`.

Rotating the PIN: set it again and re-run the seed. Signing every phone out:
delete `hmacSecret` from static data and re-run the seed.

## 6. Confirmation email

A HubSpot marketing email with a Custom HTML module — the markup is in
`docs/email-module.html`. Standard image modules cannot take a dynamic source, so
the QR must go in through HubL.

The service key cannot publish marketing emails (no `marketing-email` scope), so
this email is built in the HubSpot UI by hand.

## 7. Scanner — done

Published at **https://mes178.github.io/froggabio-checkin/** from the `main`
branch of `MES178/froggabio-checkin`.

### Republishing

Push to `main`; Pages serves the repository root. `config.js` holds the n8n base URL
and the event key, and nothing else — no token, no PIN, no attendee data.

After deploying, confirm the CORS origin baked into the workflows matches the
Pages origin exactly.

## Tests

```bash
node scripts/test_qr_png.js     # QR encoder: build a PNG, decode it back
node scripts/test_api_nodes.js  # auth, sessions, check-in decisions, roster shaping
```

Both run offline and need no credentials.

## Parallel stack — do not collide

A second implementation of this same system exists in the same n8n instance,
built alongside this one with different tooling:

| Theirs | Ours |
|---|---|
| `LS2026 — Staff Auth`, `— Roster API`, `— Check-in API`, `— Registration QR Issuance` | `LS2026 (CC) — Check-In API`, `— Issue Tokens` |
| webhook paths `ls2026/*` | webhook paths `ls2026-cc/*` |
| Pages site `froggabio-event-checkin` | Pages site `froggabio-checkin` |

Nothing here reads, edits or activates theirs; `scripts/deploy_n8n.py` refuses to
touch any workflow whose name does not start with `LS2026 (CC)`.

**Both token issuers write the same `ls2026_token` property.** Running both would
hand the same contact two different tokens and invalidate QR codes already sitting
in people's inboxes. Ours is therefore left **inactive**. Exactly one of the two
may ever be switched on.

Their QR encodes a URL (`https://mes178.github.io/froggabio-event-checkin/?t=…`)
rather than a bare token, so this scanner also accepts a token carried in a `t`,
`token` or `code` query parameter — either stack's codes will scan here.

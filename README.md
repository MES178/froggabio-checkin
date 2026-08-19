# FroggaBio Event Check-In

Registrants get a unique QR code by email. Desk staff scan it with an ordinary
phone. Attendance lands in HubSpot in real time, so the "attended" and "no-show"
segments build themselves.

Built for the **Life Science Event, 6 October 2026, 6:00 PM**.

Scanner: **https://mes178.github.io/froggabio-checkin/**

A second implementation of the same system exists in the same n8n instance;
see "Parallel stack" in `docs/SETUP.md` before switching anything on.

## How it works

```
Registrant → HubSpot form (hidden ls2026_status = registered)
                  │
                  ▼
        n8n "LS2026 — Issue Tokens"   polls every 3 minutes
        UUID + short code → QR PNG → HubSpot File Manager → contact updated
                  │
                  ▼
        HubSpot confirmation email carries the QR and the short code
                  │
                  ▼
        Scanner (GitHub Pages)  ──►  n8n "LS2026 — Check-In API"  ──►  HubSpot
        downloads the door list       auth / roster / checkin
        once, then decides every
        scan offline
```

The scanner never calls HubSpot. Every HubSpot interaction goes through n8n,
which is the only holder of the token.

## Repository

```
index.html app.js db.js styles.css sw.js config.js   the scanner (no build step)
vendor/         qrcode-generator (encoder), jsQR (decoder) — vendored, no CDN
n8n/src/*.js    Code-node bodies, in readable form
n8n/qr-png.js   QR → PNG encoder with no dependencies
n8n/*.json      built workflows — regenerate, never hand-edit
scripts/        HubSpot setup, workflow builder, tests
docs/           DECISIONS, SETUP, RUNBOOK, email module
```

## Working on it

```bash
python3 scripts/build_workflows.py   # rebuild workflow JSON from n8n/src
node scripts/test_qr_png.js          # encode a QR, decode it back
node scripts/test_api_nodes.js       # auth, sessions, check-in rules
```

Both test scripts run offline and need no credentials.

## Rules that are not negotiable

- **No secrets in this repository.** It is served publicly by GitHub Pages. The
  HubSpot token lives only in an n8n credential; the staff PIN and the session
  secret live only in n8n static data.
- **No attendee data in this repository.** The scanner fetches everything at
  runtime and wipes it on demand.
- **Edit `n8n/src/`, not `n8n/*.json`.** The JSON is generated.

Setup: `docs/SETUP.md`. Event day: `docs/RUNBOOK.md`. Why things are the way they
are: `docs/DECISIONS.md`.

# Event-day runbook

For whoever is running the registration desk — not necessarily whoever built this.

**Scanner:** https://mes178.github.io/froggabio-checkin/
**Event:** Life Science Event, Tuesday 6 October 2026, 6:00 PM
**Venue:** Jewel Box at MaRS Discovery District, 101 College Street, Toronto, ON M5G 0A3
**PIN:** ask the marketing lead. It is not written down here.

---

## One week before

- [ ] Register 5 real colleagues through the live form. Confirm each receives the
      email with a QR that actually scans.
- [ ] Check all 5 in, across all 3 devices.
- [ ] Rehearse the offline case deliberately: download the door list, turn on
      airplane mode, scan 5 people, turn it off, watch the queue drain to 0.
- [ ] Confirm venue Wi-Fi and get guest credentials in advance.
- [ ] Print the paper door list. This is the final fallback and it is not optional.

## Morning of

1. Charge every device to 100%. Bring power banks — the camera drains a phone fast.
2. Sign in on each device with a **distinct label**: Desk 1, Desk 2, Desk 3.
   The field starts filled in as "Desk 1" — change it on the second and third
   phone, or every check-in will look like it came from the same desk.
3. **Download the door list on every device** while on known-good Wi-Fi, ideally
   before leaving the office.
4. Check that each device shows the same attendee count.
5. Put the printed list and a pen on the desk.

On iPhone, use **Safari directly** — not a home-screen icon. Standalone-mode
camera behaviour on iOS has a long history of being unreliable.

## During the event

The status strip at the bottom is the truth. Read it, not your assumptions:

```
Checked in: 47 / 210     Queue: 0     Online
```

`Queue` above zero means those check-ins have not reached HubSpot yet. That is
fine — it drains by itself. It is only a problem if it is still above zero when
you pack up.

| What you see | What it means | What to do |
|---|---|---|
| Green ✓ | Checked in | Wave them through |
| Amber ◷ | Already checked in, with the original time and desk | Usually a second scan. Wave them through |
| Red ✕ "Not found" | The code is not on this device's list | Search by name. If still nothing, check the printed list |
| Red ✕ "Registration cancelled" | Their place was released | Send them to the marketing lead — do not check them in |

No QR? Search by name, email, company, or their 8-character code. Same result,
recorded as a manual check-in.

Checked in the wrong person? Door list → find them → **Undo**.

## If something breaks

- **Camera will not start** — check browser permissions, reload. On iPhone, use
  Safari directly rather than a home-screen icon.
- **Door list is empty** — re-download it. If the endpoint is down, use the
  printed list and record arrivals on paper.
- **n8n is unreachable** — scanning still works. Every scan is stored on the
  phone and syncs when service returns. Do not panic, and **do not clear local
  data**.
- **Everything is down** — paper list, tick names, enter into HubSpot afterwards.
  The fallback is always paper, and that is fine.

## After the event

1. Confirm every device shows **Queue: 0**. Do not skip this.
2. Compare the attended count in HubSpot against the desk tally.
3. Enter any paper check-ins by hand.
4. **Clear local data on every device** (Settings → Clear local data). The door
   list holds names, employers and email addresses of customers, and it must not
   sit on personal phones after the event.
5. Export the lists for follow-up.

## Who to call

- System built by Eugene Martynov (marketing).
- n8n and the HubSpot private app: see `docs/SETUP.md`.
- If nobody who can fix it is reachable: use paper. Everything reconciles later.

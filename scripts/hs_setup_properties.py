#!/usr/bin/env python3
"""Create the HubSpot contact property group and properties for the event check-in system.

Idempotent: existing group/properties are left untouched (reported as "exists").
Reads HUBSPOT_SERVICE_KEY from the local secrets env file. Never prints the token.

Usage:
  python3 scripts/hs_setup_properties.py [--dry-run]
"""
import json
import os
import sys
import urllib.error
import urllib.request

SECRETS = "/Users/eugenemartynov/Documents/codex/_secret/.api.env"
EVENT_KEY = "ls2026"
GROUP_NAME = f"{EVENT_KEY}_event_checkin"
GROUP_LABEL = "Event Check-In (Life Science 2026)"

PROPERTIES = [
    {
        "name": f"{EVENT_KEY}_token",
        "label": "Check-in token",
        "type": "string",
        "fieldType": "text",
        "description": "UUID v4 encoded in the attendee QR code. Written by n8n WF-A. Never shown to the attendee.",
    },
    {
        "name": f"{EVENT_KEY}_short_code",
        "label": "Check-in short code",
        "type": "string",
        "fieldType": "text",
        "description": "Human-readable fallback code (XXXX-XXXX) printed in the confirmation email.",
    },
    {
        "name": f"{EVENT_KEY}_qr_url",
        "label": "QR image URL",
        "type": "string",
        "fieldType": "text",
        "description": "Public HubSpot File Manager URL of the attendee's QR PNG.",
    },
    {
        "name": f"{EVENT_KEY}_registered_at",
        "label": "Registered at",
        "type": "datetime",
        "fieldType": "date",
        "description": "When the attendee submitted the registration form.",
    },
    {
        "name": f"{EVENT_KEY}_status",
        "label": "Event status",
        "type": "enumeration",
        "fieldType": "select",
        "description": "Lifecycle of this contact's event attendance.",
        "options": [
            {"label": "Registered", "value": "registered", "displayOrder": 0},
            {"label": "Attended", "value": "attended", "displayOrder": 1},
            {"label": "Cancelled", "value": "cancelled", "displayOrder": 2},
        ],
    },
    {
        "name": f"{EVENT_KEY}_checked_in_at",
        "label": "Checked in at",
        "type": "datetime",
        "fieldType": "date",
        "description": "Timestamp of the first successful scan at the registration desk.",
    },
    {
        "name": f"{EVENT_KEY}_checkin_method",
        "label": "Check-in method",
        "type": "enumeration",
        "fieldType": "select",
        "description": "How the attendee was checked in at the desk.",
        "options": [
            {"label": "QR scan", "value": "qr", "displayOrder": 0},
            {"label": "Manual search", "value": "manual_search", "displayOrder": 1},
            {"label": "Short code", "value": "short_code", "displayOrder": 2},
        ],
    },
    {
        "name": f"{EVENT_KEY}_checkin_device",
        "label": "Check-in device",
        "type": "string",
        "fieldType": "text",
        "description": "Label of the desk device that performed the check-in, for auditing.",
    },
]


def token():
    if not os.path.exists(SECRETS):
        sys.exit(f"ERROR: secrets file not found: {SECRETS}")
    for line in open(SECRETS, encoding="utf-8"):
        line = line.strip()
        if line.startswith("HUBSPOT_SERVICE_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("ERROR: HUBSPOT_SERVICE_KEY missing from secrets file")


TOKEN = token()


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        "https://api.hubapi.com" + path,
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return e.code, {"raw": raw[:300]}


def main():
    dry = "--dry-run" in sys.argv

    status, _ = api("GET", f"/crm/v3/properties/contacts/groups/{GROUP_NAME}")
    if status == 200:
        print(f"group   {GROUP_NAME}: exists")
    elif dry:
        print(f"group   {GROUP_NAME}: would create")
    else:
        status, body = api(
            "POST",
            "/crm/v3/properties/contacts/groups",
            {"name": GROUP_NAME, "label": GROUP_LABEL, "displayOrder": -1},
        )
        print(f"group   {GROUP_NAME}: {'created' if status in (200, 201) else 'FAILED ' + json.dumps(body)}")

    for prop in PROPERTIES:
        name = prop["name"]
        status, _ = api("GET", f"/crm/v3/properties/contacts/{name}")
        if status == 200:
            print(f"prop    {name}: exists")
            continue
        if dry:
            print(f"prop    {name}: would create ({prop['type']})")
            continue
        payload = dict(prop, groupName=GROUP_NAME, hasUniqueValue=False, formField=False)
        status, body = api("POST", "/crm/v3/properties/contacts", payload)
        if status in (200, 201):
            print(f"prop    {name}: created ({prop['type']})")
        else:
            print(f"prop    {name}: FAILED {status} {json.dumps(body)[:300]}")


if __name__ == "__main__":
    main()

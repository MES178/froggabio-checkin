#!/usr/bin/env python3
"""Create (or show) the native HubSpot registration form for the Life Science event.

The form carries a hidden ls2026_status field defaulting to "registered" — that is
the marker the n8n polling workflow (WF-A) looks for, so token issuing does not
depend on HubSpot workflows or webhooks being available.

Usage:
  python3 scripts/hs_setup_form.py [--dry-run]
"""
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

SECRETS = "/Users/eugenemartynov/Documents/codex/_secret/.api.env"
FORM_NAME = "Life Science Event 2026 — Registration"
NOTIFY_RECIPIENTS = ["52262546"]  # same internal recipient as other FroggaBio forms


def token():
    for line in open(SECRETS, encoding="utf-8"):
        if line.strip().startswith("HUBSPOT_SERVICE_KEY="):
            return line.strip().split("=", 1)[1]
    sys.exit("ERROR: HUBSPOT_SERVICE_KEY missing")


TOKEN = token()


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        "https://api.hubapi.com" + path, data=data, method=method,
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
            return e.code, {"raw": raw[:400]}


def field(name, label, field_type, required=False, hidden=False, default=None):
    f = {
        "objectTypeId": "0-1",
        "name": name,
        "label": label,
        "required": required,
        "hidden": hidden,
        "fieldType": field_type,
    }
    if default is not None:
        f["defaultValue"] = default
    if field_type == "email":
        f["validation"] = {"blockedEmailDomains": [], "useDefaultBlockList": False}
    return f


FORM = {
    "formType": "hubspot",
    "name": FORM_NAME,
    "fieldGroups": [
        {"groupType": "default_group", "richTextType": "text", "fields": [
            field("firstname", "First Name", "single_line_text", required=True),
            field("lastname", "Last Name", "single_line_text", required=True),
        ]},
        {"groupType": "default_group", "richTextType": "text", "fields": [
            field("email", "Email", "email", required=True),
        ]},
        {"groupType": "default_group", "richTextType": "text", "fields": [
            field("company", "Company / Institution", "single_line_text", required=True),
        ]},
        {"groupType": "default_group", "richTextType": "text", "fields": [
            field("jobtitle", "Job Title", "single_line_text"),
        ]},
        {"groupType": "default_group", "richTextType": "text", "fields": [
            dict(field("ls2026_status", "Event status", "dropdown", hidden=True, default="registered"),
                 options=[{"label": "Registered", "value": "registered", "displayOrder": 0},
                          {"label": "Attended", "value": "attended", "displayOrder": 1},
                          {"label": "Cancelled", "value": "cancelled", "displayOrder": 2}]),
        ]},
    ],
    "configuration": {
        "language": "en",
        "cloneable": True,
        "editable": True,
        "archivable": True,
        "recaptchaEnabled": True,
        "notifyContactOwner": True,
        "notifyRecipients": NOTIFY_RECIPIENTS,
        "createNewContactForNewEmail": True,
        "prePopulateKnownValues": True,
        "allowLinkToResetKnownValues": False,
        "postSubmitAction": {
            "type": "thank_you",
            "value": "Thanks for registering. Your check-in QR code is on its way by email — bring it with you to the registration desk.",
        },
        "embedType": "V3",
    },
    "displayOptions": {
        "renderRawHtml": False,
        "theme": "default_style",
        "submitButtonText": "Register",
        "style": {
            "fontFamily": "arial, helvetica, sans-serif",
            "backgroundWidth": "100%",
            "labelTextColor": "#33475b",
            "labelTextSize": "11px",
            "helpTextColor": "#7C98B6",
            "helpTextSize": "11px",
            "legalConsentTextColor": "#33475b",
            "legalConsentTextSize": "14px",
            "submitColor": "#00AD02",
            "submitAlignment": "left",
            "submitFontColor": "#ffffff",
            "submitSize": "12px",
        },
        "cssClass": None,
    },
    "legalConsentOptions": {"type": "none"},
}


def main():
    status, body = api("GET", "/marketing/v3/forms/?limit=100")
    existing = [f for f in body.get("results", []) if f.get("name") == FORM_NAME]
    if existing:
        f = existing[0]
        print(f"form exists: {f['id']}  {f['name']}")
        return

    if "--dry-run" in sys.argv:
        print("would create form:", FORM_NAME)
        print(json.dumps(FORM, indent=1)[:600])
        return

    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    payload = dict(FORM, createdAt=now, updatedAt=now, archived=False)
    status, body = api("POST", "/marketing/v3/forms/", payload)
    if status in (200, 201):
        print(f"form created: {body['id']}  {body['name']}")
    else:
        print(f"FAILED {status}: {json.dumps(body)[:600]}")


if __name__ == "__main__":
    main()

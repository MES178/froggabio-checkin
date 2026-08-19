#!/usr/bin/env python3
"""Assemble the n8n workflow JSON from the readable sources in n8n/src.

The Code-node bodies live as real .js files so they can be read, diffed and
linted. This script inlines them (plus the vendored QR encoder) into the two
workflows we deploy:

  n8n/WF-A-issue-tokens.json   schedule -> token, short code, QR PNG, contact update
  n8n/WF-API-checkin.json      auth + roster + checkin webhooks, one shared static store

Usage:
  python3 scripts/build_workflows.py [--origin https://<org>.github.io]
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "n8n", "src")
OUT = os.path.join(ROOT, "n8n")

HUBSPOT_API = "https://api.hubapi.com"
CRED_PLACEHOLDER = {"httpHeaderAuth": {"id": "REPLACE_WITH_CREDENTIAL_ID", "name": "HubSpot Private App (LS2026)"}}

ROSTER_PROPERTIES = [
    "email", "firstname", "lastname", "company", "jobtitle",
    "ls2026_token", "ls2026_short_code", "ls2026_status",
    "ls2026_checked_in_at", "ls2026_checkin_method", "ls2026_checkin_device",
]


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as fh:
        return fh.read()


def code_node(name, body, position, once_for_each=False, extra_prelude=""):
    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": position,
        "parameters": {
            "mode": "runOnceForEachItem" if once_for_each else "runOnceForAllItems",
            "jsCode": (extra_prelude + body) if extra_prelude else body,
        },
    }


def http_node(name, position, url, method="POST", json_body=None, extra=None, on_error=None):
    params = {
        "method": method,
        "url": url,
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "options": {},
    }
    if json_body is not None:
        params.update({"sendBody": True, "specifyBody": "json", "jsonBody": json_body})
    if extra:
        params.update(extra)
    node = {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": position,
        "parameters": params,
        "credentials": CRED_PLACEHOLDER,
    }
    if on_error:
        node["onError"] = on_error
    return node


def webhook_node(name, path, position, methods):
    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 2,
        "position": position,
        "webhookId": path.replace("/", "-"),
        "parameters": {
            "multipleMethods": True,
            "httpMethods": methods,
            "path": path,
            "responseMode": "responseNode",
            "options": {"rawBody": False},
        },
    }


def respond_node(name, position):
    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.1,
        "position": position,
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ JSON.stringify($json.body) }}",
            "options": {
                "responseCode": "={{ $json.statusCode }}",
                "responseHeaders": {
                    "entries": [
                        {"name": "Access-Control-Allow-Origin", "value": "={{ $json.headers['Access-Control-Allow-Origin'] }}"},
                        {"name": "Access-Control-Allow-Headers", "value": "Content-Type, X-Session-Token"},
                        {"name": "Access-Control-Allow-Methods", "value": "GET, POST, OPTIONS"},
                        {"name": "Cache-Control", "value": "no-store"},
                    ]
                },
            },
        },
    }


def if_authorized(name, position):
    """IF node on the v1 schema — its parameter shape has been stable for years."""
    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "type": "n8n-nodes-base.if",
        "typeVersion": 1,
        "position": position,
        "parameters": {
            "conditions": {"boolean": [{"value1": "={{ $json.authorized }}", "value2": True}]}
        },
    }


def wire(*pairs):
    """Build the n8n connections map from (from_node, to_node, output_index) tuples."""
    connections = {}
    for source, target, index in pairs:
        connections.setdefault(source, {"main": []})
        while len(connections[source]["main"]) <= index:
            connections[source]["main"].append([])
        connections[source]["main"][index].append({"node": target, "type": "main", "index": 0})
    return connections


def build_issue_tokens():
    search_body = json.dumps({
        "filterGroups": [{"filters": [
            {"propertyName": "ls2026_status", "operator": "EQ", "value": "registered"},
            {"propertyName": "ls2026_token", "operator": "NOT_HAS_PROPERTY"},
        ]}],
        "properties": ["email", "firstname", "lastname", "company",
                       "ls2026_token", "ls2026_short_code", "createdate", "recent_conversion_date"],
        "limit": 100,
    })

    # The vendored library declares `var qrcode` at top level and its UMD footer
    # is inert without `define`/`exports`, so it needs no shim here.
    qr_prelude = (
        "// --- vendored: qrcode-generator 1.4.4 (MIT, Kazuhiko Arase) ---\n"
        + read(ROOT, "vendor", "qrcode-generator.js")
        + "\n"
        "// --- vendored: n8n/qr-png.js (this repo) ---\n"
        + read(ROOT, "n8n", "qr-png.js").replace(
            "if (typeof module !== 'undefined' && module.exports) {\n"
            "  module.exports = { buildQrPng, matrixToPng, crc32, adler32, storedZlib };\n}",
            "",
        )
        + "\n// --- node body ---\n"
    )

    nodes = [
        {
            "id": "schedule",
            "name": "Every 3 minutes",
            "type": "n8n-nodes-base.scheduleTrigger",
            "typeVersion": 1.2,
            "position": [-320, 300],
            "parameters": {"rule": {"interval": [{"field": "minutes", "minutesInterval": 3}]}},
        },
        http_node("Find new registrants", [-100, 300],
                  f"{HUBSPOT_API}/crm/v3/objects/contacts/search", json_body=search_body),
        code_node("Prepare tokens", read(SRC, "wf-a-prepare.js"), [120, 300]),
        code_node("Render QR", read(SRC, "wf-a-render.js"), [340, 300],
                  once_for_each=True, extra_prelude=qr_prelude),
        http_node(
            "Upload QR to HubSpot Files", [560, 300], f"{HUBSPOT_API}/files/v3/files",
            extra={
                "sendBody": True,
                "contentType": "multipart-form-data",
                "bodyParameters": {"parameters": [
                    {"parameterType": "formBinaryData", "name": "file", "inputDataFieldName": "data"},
                    {"name": "folderPath", "value": "/event-checkin/ls2026"},
                    {"name": "options", "value": '{"access":"PUBLIC_NOT_INDEXABLE","overwrite":true}'},
                ]},
            },
        ),
        code_node(
            "Build contact update",
            read(SRC, "wf-a-update.js"),
            [780, 300],
            once_for_each=True,
        ),
        http_node(
            "Update contact", [1000, 300],
            "=" + HUBSPOT_API + "/crm/v3/objects/contacts/{{ $json.hs_id }}",
            method="PATCH",
            json_body="={{ JSON.stringify({ properties: $json.properties }) }}",
        ),
    ]

    return {
        "name": "LS2026 — Issue Tokens",
        "nodes": nodes,
        "connections": wire(
            ("Every 3 minutes", "Find new registrants", 0),
            ("Find new registrants", "Prepare tokens", 0),
            ("Prepare tokens", "Render QR", 0),
            ("Render QR", "Upload QR to HubSpot Files", 0),
            ("Upload QR to HubSpot Files", "Build contact update", 0),
            ("Build contact update", "Update contact", 0),
        ),
        "settings": {"executionOrder": "v1", "timezone": "America/Toronto"},
    }


def build_checkin_api(origin):
    prelude = f"const ALLOWED_ORIGIN = {json.dumps(origin)};\n" + read(SRC, "lib-session.js") + "\n"

    roster_search = json.dumps({
        "filterGroups": [{"filters": [{"propertyName": "ls2026_token", "operator": "HAS_PROPERTY"}]}],
        "properties": ROSTER_PROPERTIES,
        "limit": 100,
    })

    nodes = [
        # --- one-off secret seeding, so the PIN and HMAC secret never live in this file
        {
            "id": "seed-trigger",
            "name": "Seed secrets",
            "type": "n8n-nodes-base.manualTrigger",
            "typeVersion": 1,
            "position": [-320, -160],
            "parameters": {},
        },
        code_node("Write secrets to store", read(SRC, "seed-secrets.js"), [-100, -160]),

        # --- WF-C auth
        webhook_node("Auth webhook", "ls2026/auth", [-320, 60], ["POST", "OPTIONS"]),
        code_node("Authenticate", read(SRC, "api-auth.js"), [-100, 60], extra_prelude=prelude),
        respond_node("Respond auth", [340, 60]),

        # --- WF-D roster
        webhook_node("Roster webhook", "ls2026/roster", [-320, 300], ["GET", "OPTIONS"]),
        code_node("Verify roster session", read(SRC, "api-roster-verify.js"), [-100, 300], extra_prelude=prelude),
        if_authorized("Roster authorized?", [120, 300]),
        http_node("Roster page 1", [340, 220],
                  f"{HUBSPOT_API}/crm/v3/objects/contacts/search", json_body=roster_search),
        http_node(
            "Roster page 2", [560, 220],
            f"{HUBSPOT_API}/crm/v3/objects/contacts/search",
            json_body="={{ JSON.stringify(Object.assign(" + roster_search + ", { after: $json.paging?.next?.after })) }}",
            on_error="continueRegularOutput",
        ),
        code_node("Build roster", read(SRC, "api-roster-build.js"), [780, 220], extra_prelude=prelude),
        code_node("Roster unauthorized", read(SRC, "api-unauthorized.js"), [340, 380], extra_prelude=prelude),
        respond_node("Respond roster", [1000, 300]),

        # --- WF-E check-in
        webhook_node("Checkin webhook", "ls2026/checkin", [-320, 620], ["POST", "OPTIONS"]),
        code_node("Plan check-ins", read(SRC, "api-checkin-plan.js"), [-100, 620], extra_prelude=prelude),
        if_authorized("Checkin authorized?", [120, 620]),
        http_node(
            "Look up tokens", [340, 540],
            f"{HUBSPOT_API}/crm/v3/objects/contacts/search",
            json_body="={{ JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'ls2026_token', operator: 'IN', values: $json.tokens }] }], properties: "
            + json.dumps(ROSTER_PROPERTIES)
            + ", limit: 100 }) }}",
            on_error="continueRegularOutput",
        ),
        code_node("Decide check-ins", read(SRC, "api-checkin-decide.js"), [560, 540], extra_prelude=prelude),
        http_node(
            "Apply to HubSpot", [780, 540],
            f"{HUBSPOT_API}/crm/v3/objects/contacts/batch/update",
            json_body="={{ JSON.stringify({ inputs: $json.inputs }) }}",
            on_error="continueRegularOutput",
        ),
        code_node("Answer scanner", read(SRC, "api-checkin-respond.js"), [1000, 540], extra_prelude=prelude),
        code_node("Checkin unauthorized", read(SRC, "api-unauthorized.js"), [340, 700], extra_prelude=prelude),
        respond_node("Respond checkin", [1220, 620]),
    ]

    return {
        "name": "LS2026 — Check-In API",
        "nodes": nodes,
        "connections": wire(
            ("Seed secrets", "Write secrets to store", 0),

            ("Auth webhook", "Authenticate", 0),
            ("Authenticate", "Respond auth", 0),

            ("Roster webhook", "Verify roster session", 0),
            ("Verify roster session", "Roster authorized?", 0),
            ("Roster authorized?", "Roster page 1", 0),
            ("Roster authorized?", "Roster unauthorized", 1),
            ("Roster page 1", "Roster page 2", 0),
            ("Roster page 2", "Build roster", 0),
            ("Build roster", "Respond roster", 0),
            ("Roster unauthorized", "Respond roster", 0),

            ("Checkin webhook", "Plan check-ins", 0),
            ("Plan check-ins", "Checkin authorized?", 0),
            ("Checkin authorized?", "Look up tokens", 0),
            ("Checkin authorized?", "Checkin unauthorized", 1),
            ("Look up tokens", "Decide check-ins", 0),
            ("Decide check-ins", "Apply to HubSpot", 0),
            ("Apply to HubSpot", "Answer scanner", 0),
            ("Answer scanner", "Respond checkin", 0),
            ("Checkin unauthorized", "Respond checkin", 0),
        ),
        "settings": {"executionOrder": "v1", "timezone": "America/Toronto"},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", default="https://mes178.github.io",
                        help="exact GitHub Pages origin allowed by CORS")
    args = parser.parse_args()

    for filename, workflow in (
        ("WF-A-issue-tokens.json", build_issue_tokens()),
        ("WF-API-checkin.json", build_checkin_api(args.origin)),
    ):
        path = os.path.join(OUT, filename)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(workflow, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print(f"wrote {path} ({len(workflow['nodes'])} nodes, {os.path.getsize(path) // 1024} KB)")


if __name__ == "__main__":
    main()

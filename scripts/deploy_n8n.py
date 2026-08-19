#!/usr/bin/env python3
"""Deploy the built workflows to n8n Cloud.

Creates (once) a Header Auth credential holding the HubSpot token, then creates
or updates the two workflows, wiring that credential into every HTTP node.

Only touches workflows whose name starts with "LS2026 (CC)" — the parallel
ls2026 stack built alongside this one is never read, modified or activated.

Never prints the HubSpot token or the n8n API key.

Usage:
  python3 scripts/deploy_n8n.py [--activate-api]
"""
import argparse
import json
import os
import re
import secrets as pysecrets
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = "/Users/eugenemartynov/Documents/claude_code/.env"
SECRETS_FILE = "/Users/eugenemartynov/Documents/codex/_secret/.api.env"

CREDENTIAL_NAME = "HubSpot Private App (LS2026 CC)"
HMAC_FILE = os.path.join(ROOT, ".ls2026-hmac-secret")
PIN_LINE = re.compile(r"^const STAFF_PIN = '([^']*)';$", re.MULTILINE)
NAME_PREFIX = "LS2026 (CC)"
WORKFLOWS = ["WF-A-issue-tokens.json", "WF-API-checkin.json"]


def load_kv(path, keys):
    values = {}
    if not os.path.exists(path):
        sys.exit(f"ERROR: {path} not found")
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() in keys:
                values[key.strip()] = value.strip()
    missing = [k for k in keys if k not in values]
    if missing:
        sys.exit(f"ERROR: missing in {path}: {', '.join(missing)}")
    return values


env = load_kv(ENV_FILE, ["N8N_BASE_URL", "N8N_API_KEY"])
hubspot = load_kv(SECRETS_FILE, ["HUBSPOT_SERVICE_KEY"])
BASE = env["N8N_BASE_URL"].rstrip("/")


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"X-N8N-API-KEY": env["N8N_API_KEY"], "Content-Type": "application/json",
                 "accept": "application/json"},
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


def ensure_credential():
    """The n8n public API cannot list credentials, so the id is cached locally."""
    cache = os.path.join(ROOT, ".n8n-credential-id")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as fh:
            cid = fh.read().strip()
        if cid:
            print(f"credential: reusing {cid}")
            return cid

    status, body = api("POST", "/api/v1/credentials", {
        "name": CREDENTIAL_NAME,
        "type": "httpHeaderAuth",
        "data": {"name": "Authorization", "value": f"Bearer {hubspot['HUBSPOT_SERVICE_KEY']}"},
    })
    if status not in (200, 201):
        sys.exit(f"ERROR: could not create credential: {json.dumps(body)[:400]}")
    cid = body["id"]
    with open(cache, "w", encoding="utf-8") as fh:
        fh.write(cid)
    print(f"credential: created {cid}")
    return cid


def existing_workflows():
    status, body = api("GET", "/api/v1/workflows?limit=200")
    if status != 200:
        sys.exit(f"ERROR: could not list workflows: {json.dumps(body)[:300]}")
    return {w["name"]: w for w in body.get("data", [])}


def hmac_secret():
    """The session-signing secret. Local, gitignored, never committed."""
    if os.path.exists(HMAC_FILE):
        with open(HMAC_FILE, encoding="utf-8") as fh:
            value = fh.read().strip()
        if value:
            return value
    value = pysecrets.token_hex(32)
    with open(HMAC_FILE, "w", encoding="utf-8") as fh:
        fh.write(value)
    os.chmod(HMAC_FILE, 0o600)
    print(f"hmac secret: generated and stored in {os.path.basename(HMAC_FILE)}")
    return value


def live_pin(existing_workflow):
    """Read the PIN the operator set in the n8n editor so a redeploy keeps it.

    The value is moved from the live node into the new one and is never printed.
    """
    if not existing_workflow:
        return None
    for node in existing_workflow.get("nodes", []):
        if node.get("name") == "Authenticate":
            match = PIN_LINE.search(node.get("parameters", {}).get("jsCode", ""))
            if match:
                return match.group(1)
    return None


def inject_secrets(workflow, secret, pin):
    for node in workflow["nodes"]:
        code = node.get("parameters", {}).get("jsCode")
        if not code:
            continue
        code = code.replace("__HMAC_SECRET__", secret)
        if pin and node["name"] == "Authenticate":
            code = PIN_LINE.sub(f"const STAFF_PIN = '{pin}';", code, count=1)
        node["parameters"]["jsCode"] = code
    return workflow


def wire_credential(workflow, credential_id):
    for node in workflow["nodes"]:
        creds = node.get("credentials")
        if creds and "httpHeaderAuth" in creds:
            creds["httpHeaderAuth"] = {"id": credential_id, "name": CREDENTIAL_NAME}
    return workflow


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--activate-api", action="store_true",
                        help="activate the Check-In API workflow (never the token issuer)")
    args = parser.parse_args()

    credential_id = ensure_credential()
    secret = hmac_secret()
    existing = existing_workflows()

    for filename in WORKFLOWS:
        with open(os.path.join(ROOT, "n8n", filename), encoding="utf-8") as fh:
            workflow = wire_credential(json.load(fh), credential_id)

        name = workflow["name"]
        if not name.startswith(NAME_PREFIX):
            sys.exit(f"REFUSING: {name!r} is not one of ours")

        workflow = inject_secrets(workflow, secret, None)
        payload = {
            "name": name,
            "nodes": workflow["nodes"],
            "connections": workflow["connections"],
            "settings": workflow.get("settings", {}),
        }

        if name in existing:
            wid = existing[name]["id"]
            status, live = api("GET", f"/api/v1/workflows/{wid}")
            pin = live_pin(live if status == 200 else None)
            workflow = inject_secrets(workflow, secret, pin)
            payload = {
                "name": name,
                "nodes": workflow["nodes"],
                "connections": workflow["connections"],
                "settings": workflow.get("settings", {}),
            }
            print(f"   desk PIN: {'preserved from live workflow' if pin else 'NOT SET — set it in the n8n editor'}")
            status, body = api("PUT", f"/api/v1/workflows/{wid}", payload)
            action = "updated"
        else:
            status, body = api("POST", "/api/v1/workflows", payload)
            wid = body.get("id")
            action = "created"

        if status not in (200, 201):
            print(f"FAILED {name}: {status} {json.dumps(body)[:500]}")
            continue
        print(f"workflow {action}: {wid}  {name}")

        if args.activate_api and "Check-In API" in name:
            status, body = api("POST", f"/api/v1/workflows/{wid}/activate")
            print(f"   activate -> {status} {'' if status == 200 else json.dumps(body)[:300]}")


if __name__ == "__main__":
    main()

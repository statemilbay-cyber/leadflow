#!/usr/bin/env python3
"""Assemble n8n/workflows/lead-intake.json from the Code node sources in n8n/code/.

The JavaScript lives in real .js files so it can be linted and unit-tested; this script
inlines it into the workflow export that n8n imports. Run it after editing any node:

    python3 scripts/build_workflow.py          # rewrite the workflow file
    python3 scripts/build_workflow.py --check  # CI: fail if the file is out of date
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CODE = ROOT / "n8n" / "code"
OUTPUT = ROOT / "n8n" / "workflows" / "lead-intake.json"

PG_CREDENTIALS = {"postgres": {"id": "LeadflowPgCred01", "name": "leadflow-postgres"}}
API_CREDENTIALS = {"httpHeaderAuth": {"id": "LeadflowApiKey01", "name": "anthropic-api-key"}}

INSERT_LEAD = (
    "INSERT INTO leads (source, name, email, company, message, category, urgency, budget_usd, "
    "language, summary, route, draft_reply, classifier, raw) VALUES "
    "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb) "
    "RETURNING id, received_at"
)
INSERT_PARAMS = (
    "={{ [ $json.source, $json.name || null, $json.email || null, $json.company || null, "
    "$json.message, $json.category, $json.urgency, $json.budget_usd ?? null, $json.language, "
    "$json.summary, $json.route, $json.draft_reply || null, $json.classifier, $json.raw ] }}"
)
ACCEPTED_BODY = (
    "={{ JSON.stringify({ id: $json.id, category: $('Decide route').item.json.category, "
    "urgency: $('Decide route').item.json.urgency, budget_usd: $('Decide route').item.json.budget_usd, "
    "language: $('Decide route').item.json.language, route: $('Decide route').item.json.route, "
    "summary: $('Decide route').item.json.summary, draft_reply: $('Decide route').item.json.draft_reply, "
    "classifier: $('Decide route').item.json.classifier }) }}"
)
TELEGRAM_BODY = (
    "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, disable_web_page_preview: true, "
    "text: '🔥 New ' + $('Decide route').item.json.urgency + '-urgency lead\\n' "
    "+ $('Decide route').item.json.summary "
    "+ ($('Decide route').item.json.budget_usd ? '\\nBudget: $' + $('Decide route').item.json.budget_usd : '') "
    "+ '\\nFrom: ' + ($('Decide route').item.json.email || $('Decide route').item.json.name) "
    "+ '\\nLead id: ' + $json.id }) }}"
)


def code_node(uid: int, name: str, file: str, x: int, y: int) -> dict:
    return {
        "id": f"c1000000-0000-4000-8000-{uid:012d}",
        "name": name,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [x, y],
        "parameters": {
            "mode": "runOnceForEachItem",
            "jsCode": (CODE / file).read_text(encoding="utf-8"),
        },
    }


def if_node(uid: int, name: str, left: str, x: int, y: int, *, equals: str | None = None) -> dict:
    if equals is None:
        operator = {"type": "boolean", "operation": "true", "singleValue": True}
        right: object = ""
    else:
        operator = {"type": "string", "operation": "equals"}
        right = equals
    return {
        "id": f"c1000000-0000-4000-8000-{uid:012d}",
        "name": name,
        "type": "n8n-nodes-base.if",
        "typeVersion": 2,
        "position": [x, y],
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                "conditions": [
                    {
                        "id": f"d1000000-0000-4000-8000-{uid:012d}",
                        "leftValue": left,
                        "rightValue": right,
                        "operator": operator,
                    }
                ],
                "combinator": "and",
            },
            "options": {},
        },
    }


def respond_node(uid: int, name: str, body: str, status: int, x: int, y: int) -> dict:
    return {
        "id": f"c1000000-0000-4000-8000-{uid:012d}",
        "name": name,
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.1,
        "position": [x, y],
        "parameters": {
            "respondWith": "json",
            "responseBody": body,
            "options": {"responseCode": status},
        },
    }


def build() -> dict:
    nodes = [
        {
            "id": "c1000000-0000-4000-8000-000000000001",
            "name": "Lead webhook",
            "type": "n8n-nodes-base.webhook",
            "typeVersion": 2,
            "position": [0, 300],
            "webhookId": "5b0a3c2e-6f1d-4c7a-9d2e-1f3b5a7c9e01",
            "parameters": {
                "httpMethod": "POST",
                "path": "lead",
                "responseMode": "responseNode",
                "options": {},
            },
        },
        code_node(2, "Validate lead", "validate-lead.js", 220, 300),
        if_node(3, "Valid?", "={{ $json.valid }}", 440, 300),
        respond_node(
            4,
            "Reject invalid lead",
            "={{ JSON.stringify({ error: 'invalid_lead', details: $json.errors }) }}",
            422,
            660,
            500,
        ),
        if_node(5, "Live mode?", "={{ $env.LEADFLOW_MODE }}", 660, 200, equals="live"),
        code_node(6, "Build Claude request", "build-claude-request.js", 880, 80),
        {
            "id": "c1000000-0000-4000-8000-000000000007",
            "name": "Claude: classify",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.2,
            "position": [1100, 80],
            "retryOnFail": True,
            "maxTries": 3,
            "waitBetweenTries": 2000,
            "parameters": {
                "method": "POST",
                "url": "https://api.anthropic.com/v1/messages",
                "authentication": "genericCredentialType",
                "genericAuthType": "httpHeaderAuth",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [
                        {"name": "anthropic-version", "value": "2026-10-21"},
                        {"name": "anthropic-beta", "value": "server-side-fallback-2026-07-01"},
                    ]
                },
                "sendBody": True,
                "specifyBody": "json",
                "jsonBody": "={{ JSON.stringify($json.request) }}",
                "options": {"timeout": 120000},
            },
            "credentials": API_CREDENTIALS,
        },
        code_node(8, "Parse classification", "parse-classification.js", 1320, 80),
        code_node(9, "Rules classifier", "rules-classifier.js", 1100, 320),
        code_node(10, "Decide route", "decide-route.js", 1540, 200),
        {
            "id": "c1000000-0000-4000-8000-000000000011",
            "name": "Save lead",
            "type": "n8n-nodes-base.postgres",
            "typeVersion": 2.5,
            "position": [1760, 200],
            "parameters": {
                "operation": "executeQuery",
                "query": INSERT_LEAD,
                "options": {"queryReplacement": INSERT_PARAMS},
            },
            "credentials": PG_CREDENTIALS,
        },
        respond_node(12, "Respond accepted", ACCEPTED_BODY, 200, 1980, 100),
        if_node(
            13,
            "Alert the team?",
            "={{ $('Decide route').item.json.route === 'alert' && !!$env.TELEGRAM_BOT_TOKEN }}",
            1980,
            320,
        ),
        {
            "id": "c1000000-0000-4000-8000-000000000014",
            "name": "Telegram alert",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.2,
            "position": [2200, 300],
            "parameters": {
                "method": "POST",
                "url": "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage",
                "sendBody": True,
                "specifyBody": "json",
                "jsonBody": TELEGRAM_BODY,
                "options": {"timeout": 15000},
            },
        },
    ]

    def edge(*targets: str) -> list[dict]:
        return [{"node": target, "type": "main", "index": 0} for target in targets]

    connections = {
        "Lead webhook": {"main": [edge("Validate lead")]},
        "Validate lead": {"main": [edge("Valid?")]},
        "Valid?": {"main": [edge("Live mode?"), edge("Reject invalid lead")]},
        "Live mode?": {"main": [edge("Build Claude request"), edge("Rules classifier")]},
        "Build Claude request": {"main": [edge("Claude: classify")]},
        "Claude: classify": {"main": [edge("Parse classification")]},
        "Parse classification": {"main": [edge("Decide route")]},
        "Rules classifier": {"main": [edge("Decide route")]},
        "Decide route": {"main": [edge("Save lead")]},
        "Save lead": {"main": [edge("Respond accepted", "Alert the team?")]},
        "Alert the team?": {"main": [edge("Telegram alert"), []]},
    }

    return {
        "id": "LeadIntake000001",
        "name": "Lead intake",
        "active": True,
        "nodes": nodes,
        "connections": connections,
        "settings": {
            "executionOrder": "v1",
            "errorWorkflow": "LeadErrors000001",
            "saveDataErrorExecution": "all",
            "saveDataSuccessExecution": "all",
        },
        "pinData": {},
    }


def main() -> int:
    rendered = json.dumps(build(), indent=2, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != rendered:
            print(f"{OUTPUT.relative_to(ROOT)} is out of date: run scripts/build_workflow.py")
            return 1
        print("workflow is up to date")
        return 0
    OUTPUT.write_text(rendered, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

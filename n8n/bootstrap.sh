#!/bin/sh
# One-shot setup, run by the `n8n-bootstrap` service before n8n starts.
# Idempotent: credentials and workflows are upserted by id on every `docker compose up`.
set -eu

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

node /bootstrap/render-credentials.js > "$tmp"
n8n import:credentials --input="$tmp"

n8n import:workflow --input=/bootstrap/workflows/lead-errors.json
n8n import:workflow --input=/bootstrap/workflows/lead-intake.json
# n8n 2.x runs only published versions, error workflows included.
n8n publish:workflow --id=LeadErrors000001
n8n publish:workflow --id=LeadIntake000001

echo "leadflow: credentials and workflows are in place"

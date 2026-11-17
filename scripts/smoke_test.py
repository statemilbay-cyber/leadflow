#!/usr/bin/env python3
"""End-to-end check against a running stack: post every sample lead, verify the response.

    docker compose up -d --wait
    python3 scripts/smoke_test.py                 # http://127.0.0.1:5678/webhook/lead
    python3 scripts/smoke_test.py --db            # also verify rows in Postgres

In mock mode every expected field is checked. In live mode (Claude), categories and routes
are checked; wording-level fields such as the language code are reported, not asserted.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STRICT_IN_LIVE_MODE = {"status", "category", "route"}


def post(url: str, payload: dict) -> tuple[int, dict]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        body = error.read()
        try:
            return error.code, json.loads(body or b"{}")
        except json.JSONDecodeError:
            return error.code, {"raw": body.decode(errors="replace")}


def count_rows(table: str) -> int:
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "leadflow", "-d", "leadflow",
         "-tAc", f"SELECT count(*) FROM {table}"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout  # fmt: skip
    return int(out.strip())


def wait_for_webhook(url: str, timeout: float) -> None:
    """n8n reports healthy before it has registered the webhooks of published workflows.

    Probe with an empty payload: a live webhook rejects it with 422 and writes nothing.
    """
    deadline = time.monotonic() + timeout
    while True:
        status, _ = post(url, {})
        if status != 404:
            return
        if time.monotonic() > deadline:
            raise SystemExit(f"{url} still returns 404 after {timeout:.0f}s: is the workflow published?")
        time.sleep(1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", default="http://127.0.0.1:5678/webhook/lead")
    parser.add_argument("--db", action="store_true", help="also check rows in Postgres")
    parser.add_argument("--wait", type=float, default=90, help="seconds to wait for the webhook")
    args = parser.parse_args()

    wait_for_webhook(args.url, args.wait)
    samples = json.loads((ROOT / "samples" / "leads.json").read_text(encoding="utf-8"))
    before = count_rows("leads") if args.db else 0
    failures = 0
    for sample in samples:
        started = time.perf_counter()
        status, body = post(args.url, sample["payload"])
        elapsed = time.perf_counter() - started
        live = body.get("classifier") not in (None, "rules")
        problems = []
        for key, expected in sample["expect"].items():
            actual = status if key == "status" else body.get(key)
            if actual != expected and (not live or key in STRICT_IN_LIVE_MODE):
                problems.append(f"{key}: expected {expected!r}, got {actual!r}")
        mark = "FAIL" if problems else "ok  "
        detail = f"{body.get('category', '-')}/{body.get('route', '-')}" if status == 200 else status
        print(f"{mark} {sample['name']:<48} {detail}  ({elapsed:.1f}s)")
        for problem in problems:
            print(f"     {problem}")
        failures += bool(problems)

    if args.db:
        accepted = sum(1 for s in samples if s["expect"]["status"] == 200)
        added = count_rows("leads") - before
        ok = added == accepted
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} rows written to leads: {added} (expected {accepted})")

    print("\nall checks passed" if not failures else f"\n{failures} check(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cleanup-wz-scale.py — delete WZ-SCALE scratch boards from the agent sandbox.

Sandbox hygiene ("delete what you create", repo golden rule 4): before a fresh
scale-seed provision, remove leftover boards from previous runs so re-runs
never accumulate duplicates.

TRIPLE-GUARDED, by design impossible to point elsewhere:
  * workspace is HARD-CODED to the sandbox (16291824) — not configurable;
  * only boards whose name starts with the exact prefix "WZ-SCALE" qualify;
  * refuses to delete more than MAX_DELETES boards in one run (sanity fuse).

Usage:  ./cleanup-wz-scale.py [--apply]     (dry run lists what would go)
"""
import json, os, subprocess, sys
from pathlib import Path

API = os.environ.get(
    "MAPPS_API_SH",
    str(Path(__file__).resolve().parents[2] / "mapps" / "mapps-api.sh"))
APIV = "2026-04"

SANDBOX_WORKSPACE_ID = "16291824"
PREFIX = "WZ-SCALE"
MAX_DELETES = 20


def gql(q, v=None):
    a = [API, q, (json.dumps(v, ensure_ascii=False) if v is not None else ""), APIV]
    r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit(f"mapps-api.sh failed (exit {r.returncode}): {r.stderr.strip()[:400]}")
    out = json.loads(r.stdout)
    if out.get("errors"):
        raise SystemExit("GQL ERROR: " + json.dumps(out["errors"], ensure_ascii=False)[:700])
    return out.get("data", {})


def main():
    apply = "--apply" in sys.argv[1:]
    data = gql(f'query {{ boards(workspace_ids: [{SANDBOX_WORKSPACE_ID}], limit: 500, state: active) {{ id name }} }}')
    targets = [b for b in data.get("boards", []) if (b.get("name") or "").startswith(PREFIX)]
    print(f"=== cleanup-wz-scale :: {'APPLY' if apply else 'DRY RUN'} :: "
          f"{len(targets)} '{PREFIX}*' boards in sandbox {SANDBOX_WORKSPACE_ID} ===")
    for b in targets:
        print(f"  {b['id']}  {b['name']}")
    if len(targets) > MAX_DELETES:
        raise SystemExit(f"REFUSED: {len(targets)} boards exceed the {MAX_DELETES} sanity fuse — clean manually.")
    if not apply:
        print("(dry run — re-run with --apply to delete)")
        return
    for b in targets:
        gql('mutation($id: ID!) { delete_board(board_id: $id) { id } }', {"id": str(b["id"])})
        print(f"  deleted {b['id']}")
    print(f"✅ removed {len(targets)} boards.")


if __name__ == "__main__":
    main()

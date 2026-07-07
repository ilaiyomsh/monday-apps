#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate.py — post-apply scripted validation (replaces "eyeball it in the UI").

Re-queries every board recorded in state.json and ASSERTS the live schema
matches the blueprint + state:
  * every board in state exists and lives in the configured workspace
  * every mapped column id exists live, with the blueprint's column type
  * every status label id recorded in state exists in the live column settings
  * every board_relation column points at the expected target board
  * items: reports items_count per board; if config.seed exists, boards that the
    seeder writes to must be non-empty

Usage:  ./validate.py <config.json>

Read-only (queries only). Exit 0 = system matches; exit 1 = drift, with a full
violation list. Run after provision.py --apply (and after seed.py --apply).
"""
import sys, os, json, subprocess
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))        # .../monday-ops/scripts
SKILL_DIR = os.path.dirname(HERE)                        # .../monday-ops
API = os.environ.get(
    "MAPPS_API_SH",
    # Sibling skill: <skills-root>/mapps/mapps-api.sh, derived from this file's
    # own location so the skill works from wherever the repo is cloned.
    str(Path(__file__).resolve().parents[2] / "mapps" / "mapps-api.sh"))
API_VERSION = "2026-04"

SEEDED_BOARDS = {"project": "portfolio", "employees": "employees",
                 "allocations": "allocations", "timeReports": "timeLogs"}


def gql(q, v=None):
    args = [API, q] + ([json.dumps(v, ensure_ascii=False)] if v is not None else []) + [API_VERSION]
    r = subprocess.run(args, capture_output=True, text=True)
    try:
        out = json.loads(r.stdout)
    except Exception:
        raise SystemExit("BAD API RESPONSE:\n" + r.stdout[:800] + "\n" + r.stderr[:400])
    if out.get("errors"):
        raise SystemExit("GQL ERROR: " + json.dumps(out["errors"], ensure_ascii=False)[:900])
    return out["data"]


def load_skill(*parts):
    with open(os.path.join(SKILL_DIR, *parts), encoding="utf-8") as f:
        return json.load(f)


def blueprint_columns(board_key, bp, options, stages):
    """Expected columns for a board (mirrors provision.py's option gating)."""
    cols = {}
    for c in bp["boards"][board_key]["columns"]:
        req = c.get("requires")
        if req and not options.get(req):
            continue
        cols[c["key"]] = c
    return cols


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    config = json.load(open(sys.argv[1], encoding="utf-8"))
    state = json.load(open(os.path.join(config["outDir"], "state.json"), encoding="utf-8"))
    bp = load_skill("blueprints", "boards.json")
    options = state.get("options", {})
    errors, ok = [], 0

    ids = [info["id"] for info in state["boards"].values()]
    d = gql('query($b:[ID!]){boards(ids:$b){id name board_kind workspace_id items_count '
            'columns{id title type settings}}}', {"b": ids})
    live = {str(b["id"]): b for b in (d.get("boards") or [])}

    print(f"=== validate :: {state.get('demoName', '?')} :: {len(state['boards'])} board(s) ===")
    for key, info in state["boards"].items():
        bid = str(info["id"])
        b = live.get(bid)
        if not b:
            errors.append(f"BOARD MISSING: '{key}' (id {bid}) not found live.")
            continue
        if str(b.get("workspace_id")) != str(state["workspaceId"]):
            errors.append(f"WRONG WORKSPACE: '{key}' (id {bid}) lives in workspace "
                          f"{b.get('workspace_id')}, expected {state['workspaceId']}.")
        live_cols = {c["id"]: c for c in b["columns"]}
        expected = blueprint_columns(key, bp, options, state.get("stages", []))

        # columns exist + type matches the blueprint
        for logical, cid in (info.get("columns") or {}).items():
            spec = expected.get(logical)
            c = live_cols.get(cid)
            if not c:
                errors.append(f"COLUMN MISSING: {key}.{logical} -> '{cid}' not on live board {bid}.")
                continue
            if spec:
                accepted = {spec["type"]}
                if spec["type"] == "mirror":
                    accepted.add("lookup")  # API returns 'lookup' for mirrors on some versions
                if c["type"] not in accepted:
                    errors.append(f"COLUMN TYPE DRIFT: {key}.{logical} ('{cid}') is live "
                                  f"'{c['type']}', blueprint says '{spec['type']}'.")
                    continue
            ok += 1
            # board_relation must point at the expected target board
            if spec and spec["type"] == "board_relation" and c.get("settings"):
                s = json.loads(c["settings"]) if isinstance(c["settings"], str) else c["settings"]
                target_key = spec.get("target")
                target = state["boards"].get(target_key, {}).get("id")
                board_ids = [str(x) for x in (s.get("boardIds") or [])]
                if target and board_ids and str(target) not in board_ids:
                    errors.append(f"RELATION DRIFT: {key}.{logical} points at boards "
                                  f"{board_ids}, expected {target_key} ({target}).")

        # status label ids recorded in state must exist live
        for logical, labmap in (info.get("labels") or {}).items():
            cid = (info.get("columns") or {}).get(logical)
            c = live_cols.get(cid)
            if not c or not c.get("settings"):
                continue
            s = json.loads(c["settings"]) if isinstance(c["settings"], str) else c["settings"]
            live_ids = {str(l.get("id", l.get("index"))) for l in s.get("labels", [])}
            for lkey, lid in labmap.items():
                if str(lid) not in live_ids:
                    errors.append(f"LABEL DRIFT: {key}.{logical}:{lkey} -> label id '{lid}' "
                                  f"not in live labels {sorted(live_ids)}.")
                else:
                    ok += 1

        print(f"  {key} (id {bid}, kind {b.get('board_kind')}): "
              f"{len(info.get('columns') or {})} mapped cols, {b.get('items_count')} item(s)")

        # seeded boards must not be empty
        seed = config.get("seed") or {}
        for seed_key, board_key2 in SEEDED_BOARDS.items():
            if board_key2 == key and seed.get(seed_key) and b.get("items_count") == 0:
                errors.append(f"SEED MISSING: seed.{seed_key} configured but board "
                              f"'{key}' (id {bid}) has 0 items.")

    if errors:
        print(f"\nVALIDATION FAILED — {len(errors)} violation(s):")
        for e in errors:
            print("  ✗ " + e)
        sys.exit(1)
    print(f"\nvalidate.py: PASS — {ok} assertion(s) matched the blueprint/state.")


if __name__ == "__main__":
    main()

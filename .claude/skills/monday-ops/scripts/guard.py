#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
guard.py — schema-drift guard for saved settings / mapping files.

MANDATORY before reasoning over ANY saved settings/mapping JSON (app settings,
state.json, columnMap): fetch the LIVE boards' columns and diff. Saved files go
stale (columns get deleted/retyped, a ~/Downloads copy gets re-imported over a
repo fix) — never trust one without running this guard first.

HARD-FAILS (exit 1) on:
  * dead column ids        — a mapped column id that exists on none of the live boards
  * type mismatches        — a mapping field whose live column type is not in the
                             expected set (built-in EXPECTED_COLUMN_TYPES, overridable)
  * duplicate column ids   — the SAME column id used by two different mapping fields
                             (e.g. the workdaysColumnId == endDateColumnId incident)
  * required-but-empty     — fields in the required list that are null / "" / []

Usage:
    ./guard.py <settings-or-state.json> [--board <BOARD_ID>]...
               [--required fieldA,fieldB] [--allow-dup fieldA=fieldB]...
               [--expected-types <types.json>]

Input shapes auto-detected:
  1. App settings: {"settings": {...}} or a flat dict — fields ending in
     "ColumnId"/"ColumnIds" are checked against the union of live columns of all
     boards (--board args + every *BoardId value found in the file).
  2. provision.py state.json: {"boards": {key: {"id":..., "columns": {...}}}} —
     each board's columnMap is checked against THAT board's live columns.

Read-only: only runs GraphQL queries, never mutations.
"""
import sys, os, json, subprocess, re
from pathlib import Path

# Canonical API helper (owned by the mapps skill; monday-ops bundles no copy).
API = os.environ.get(
    "MAPPS_API_SH",
    # Sibling skill: <skills-root>/mapps/mapps-api.sh, derived from this file's
    # own location so the skill works from wherever the repo is cloned.
    str(Path(__file__).resolve().parents[2] / "mapps" / "mapps-api.sh"))
API_VERSION = "2026-04"

# Expected live column type(s) per mapping field (Axis Planner/Tracker preset).
# Override / extend with --expected-types <json file of {field: [types]}>.
EXPECTED_COLUMN_TYPES = {
    # dates
    "startDateColumnId": ["date"], "endDateColumnId": ["date"],
    "dateColumnId": ["date"], "endTimeColumnId": ["date"],
    "absenceDateColumnId": ["date"],
    "assignmentStartDateColumnId": ["date"], "assignmentEndDateColumnId": ["date"],
    # people
    "employeeColumnId": ["people"], "assignmentPersonColumnId": ["people"],
    "reporterColumnId": ["people"], "projectManagerColumnId": ["people"],
    "employeeUserIdColumnId": ["people"], "absenceEmployeeColumnId": ["people"],
    # status
    "projectStatusColumnId": ["status"], "eventTypeStatusColumnId": ["status"],
    "allDayTypeStatusColumnId": ["status"], "nonBillableStatusColumnId": ["status"],
    "stageColumnId": ["status"], "taskStatusColumnId": ["status"],
    "approvalStatusColumnId": ["status"], "employeeStatusColumnId": ["status"],
    "absenceTypeColumnId": ["status"], "absenceClassificationColumnId": ["status"],
    "projectTypeColumnId": ["status"], "projectClassificationColumnId": ["status"],
    # board relations
    "projectColumnId": ["board_relation"],
    "assignmentProjectLinkColumnId": ["board_relation"],
    "assignmentColumnId": ["board_relation"],
    "customerColumnId": ["board_relation"], "customerReportColumnId": ["board_relation"],
    "clientColumnId": ["board_relation"], "allocationClientColumnId": ["board_relation"],
    "tasksProjectColumnId": ["board_relation"],
    # text — roleColumnId MUST be text (Planner writes a raw string)
    "roleColumnId": ["text"],
    "employeeRoleColumnId": ["text"],
    "notesColumnId": ["text", "long_text"],
    # numbers-ish (these accept text too — the seeder writes strings)
    "hoursPerDayColumnId": ["numbers", "text"], "totalHoursColumnId": ["numbers", "text"],
    "durationColumnId": ["numbers", "text"], "ftePercentageColumnId": ["numbers", "text"],
    "allocationCostColumnId": ["numbers", "text"], "employeeCostColumnId": ["numbers", "text"],
    "employeeAllocationPercentColumnId": ["numbers", "text"],
    # misc
    "temporaryCheckboxColumnId": ["checkbox"],
    "capabilitiesColumnId": ["dropdown"],
    "reportedHoursColumnId": ["mirror", "lookup"],
}

COLUMN_FIELD_RE = re.compile(r"ColumnIds?$")
BOARD_FIELD_RE = re.compile(r"BoardId$")


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


def fetch_boards(board_ids):
    """Return {board_id: {"name":..., "kind":..., "columns": {col_id: type}}}."""
    ids = sorted({str(b) for b in board_ids if b and str(b).strip()})
    if not ids:
        raise SystemExit("guard.py: no board ids to check — pass --board or include *BoardId fields.")
    d = gql('query($b:[ID!]){boards(ids:$b){id name board_kind columns{id type settings}}}',
            {"b": ids})
    live = {}
    for b in d.get("boards") or []:
        live[str(b["id"])] = {"name": b["name"], "kind": b.get("board_kind"),
                              "columns": {c["id"]: c["type"] for c in b["columns"]}}
    missing = [i for i in ids if i not in live]
    if missing:
        raise SystemExit(f"guard.py: board id(s) not found / not accessible: {missing} — "
                         "dead board reference in the file or wrong account.")
    return live


def iter_column_fields(settings):
    """Yield (field, column_id) for every *ColumnId / *ColumnIds entry with a value."""
    for k, v in settings.items():
        if not COLUMN_FIELD_RE.search(k):
            continue
        vals = v if isinstance(v, list) else [v]
        for val in vals:
            if val is None or val == "":
                continue
            yield k, str(val)


def check_settings(settings, live, required, allow_dups, expected):
    errors, checked = [], 0
    all_cols = {}  # col_id -> {board_id: type}
    for bid, b in live.items():
        for cid, ctype in b["columns"].items():
            all_cols.setdefault(cid, {})[bid] = ctype

    # 1. dead column ids + 2. type mismatches
    for field, cid in iter_column_fields(settings):
        checked += 1
        if cid not in all_cols:
            errors.append(f"DEAD COLUMN: {field} = '{cid}' exists on none of the "
                          f"checked boards {sorted(live)} — the saved file has drifted "
                          f"from the live schema.")
            continue
        want = expected.get(field)
        if want:
            live_types = set(all_cols[cid].values())
            if not live_types & set(want):
                errors.append(f"TYPE MISMATCH: {field} = '{cid}' is live type "
                              f"{sorted(live_types)} but must be one of {want}.")

    # 3. duplicate column ids across mapping fields
    by_value = {}
    for field, cid in iter_column_fields(settings):
        by_value.setdefault(cid, []).append(field)
    for cid, fields in by_value.items():
        ufields = sorted(set(fields))
        if len(ufields) < 2:
            continue
        if any({a, b} <= set(ufields) for a, b in allow_dups):
            continue
        errors.append(f"DUPLICATE COLUMN ID: '{cid}' is mapped by {len(ufields)} different "
                      f"fields {ufields} — two settings keys must not point at the same "
                      f"column (the workdaysColumnId==endDateColumnId class of bug).")

    # 4. required-but-empty
    for field in required:
        v = settings.get(field)
        if v is None or v == "" or v == []:
            errors.append(f"REQUIRED-BUT-EMPTY: '{field}' is empty but its dependent "
                          f"feature is enabled — fill it or disable the feature.")
    return errors, checked


def check_state(state, live_fetch, required, allow_dups):
    """state.json shape: per-board columnMap checked against THAT board only."""
    errors, checked = [], 0
    boards = state["boards"]
    live = live_fetch({info["id"] for info in boards.values()
                       if str(info.get("id", "")).isdigit()})
    for key, info in boards.items():
        bid = str(info.get("id", ""))
        if bid not in live:
            errors.append(f"DEAD BOARD: state board '{key}' id '{bid}' is not fetchable.")
            continue
        cols = live[bid]["columns"]
        seen = {}
        for logical, cid in (info.get("columns") or {}).items():
            checked += 1
            if cid not in cols:
                errors.append(f"DEAD COLUMN: {key}.{logical} = '{cid}' no longer exists on "
                              f"board {bid} ('{live[bid]['name']}').")
            seen.setdefault(str(cid), []).append(logical)
        for cid, logicals in seen.items():
            ul = sorted(set(logicals))
            if len(ul) >= 2 and not any({a, b} <= set(ul) for a, b in allow_dups):
                errors.append(f"DUPLICATE COLUMN ID: board '{key}' maps '{cid}' from "
                              f"{ul} — two logical keys must not share a column.")
    return errors, checked


def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help"):
        raise SystemExit(__doc__)
    path = argv[0]
    board_ids, required, allow_dups, expected = [], [], [], dict(EXPECTED_COLUMN_TYPES)
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--board":
            board_ids.append(argv[i + 1]); i += 2
        elif a == "--required":
            required += [f.strip() for f in argv[i + 1].split(",") if f.strip()]; i += 2
        elif a == "--allow-dup":
            pair = argv[i + 1].split("=")
            if len(pair) != 2:
                raise SystemExit("--allow-dup expects fieldA=fieldB")
            allow_dups.append((pair[0].strip(), pair[1].strip())); i += 2
        elif a == "--expected-types":
            with open(argv[i + 1], encoding="utf-8") as f:
                expected.update(json.load(f))
            i += 2
        else:
            raise SystemExit(f"unknown arg: {a}\n{__doc__}")

    with open(path, encoding="utf-8") as f:
        doc = json.load(f)

    if isinstance(doc.get("boards"), dict) and all(
            isinstance(v, dict) and "columns" in v for v in doc["boards"].values()):
        errors, checked = check_state(doc, fetch_boards, required, allow_dups)
    else:
        settings = doc.get("settings", doc)
        # auto-collect board ids referenced by the file itself
        for k, v in settings.items():
            if BOARD_FIELD_RE.search(k) and v not in (None, "", []):
                board_ids.append(v)
        live = fetch_boards(board_ids)
        errors, checked = check_settings(settings, live, required, allow_dups, expected)

    print(f"guard.py: checked {checked} column mapping(s) in {path}")
    if errors:
        print(f"\nGUARD FAILED — {len(errors)} violation(s):")
        for e in errors:
            print("  ✗ " + e)
        print("\nDo NOT apply/import this file. Fix the mappings (or rebuild via "
              "provision.py) and re-run guard.py until it passes.")
        sys.exit(1)
    print("guard.py: PASS — file matches the live schema.")


if __name__ == "__main__":
    main()

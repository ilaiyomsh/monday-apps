#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
provision.py — the monday-ops build engine.

Builds (or maps existing) a board system for ONE setup from a declarative
blueprint, reads status label ids back from the API, and renders correct app
settings JSON files. Structure-aware: only builds the boards the chosen
structure needs, reuses boards that already exist, and creates only what's missing.
The bundled blueprints are the "Axis Planner/Tracker" preset; the blueprint format
is generic and extensible for other products.

Usage:
    ./provision.py <config.json>            # DRY RUN: print the plan, mutate nothing
    ./provision.py <config.json> --apply    # execute against the live workspace

state.json is written INCREMENTALLY during --apply (after board resolution and
after each board's columns), so a mid-run crash leaves a reconciliation record.
After apply, run validate.py to assert the live boards match the blueprint.

Files (all relative to the skill dir, one level above this script):
    blueprints/boards.json      — board + column model
    blueprints/structures.json  — system-structure presets
    templates/*.template.json   — settings templates with {{...}} placeholders

Outputs into config.outDir:
    state.json                  — resolved board ids, column ids, label-id maps
    planner-settings.json       — importable Planner settings (if structure uses Planner)
    tracker-settings.json       — importable Tracker settings (if structure uses Tracker)

config.json shape (produced by the SKILL.md interview):
{
  "workspaceId": "15873737",
  "demoName": "דמו 8.6",
  "outDir": "/abs/path/to/הקמות/דמו 8.6",
  "structure": "portfolio_full",
  "options": { "customers": true, "projectStructure": false, "routine": false },
  "stages": ["תכנון מוקדם","תכנון סופי","מכרז","IFC","ליווי ביצוע","סיום פרויקט"],
  "boards": {
    "portfolio":   { "mode": "create" },
    "timeLogs":    { "mode": "create" },
    "allocations": { "mode": "create" },
    "employees":   { "mode": "create" },
    "customers":   { "mode": "create" }
    // reuse instead:  "portfolio": { "mode":"reuse", "id":"123",
    //                                 "columnMap": {"step":"status_1"},
    //                                 "labelMap":  {"step":{"in_progress":"0"}} }
  }
}
Anything not in config.boards but required by the structure defaults to {mode:create}.
"""
import sys, os, json, subprocess
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))        # .../monday-ops/scripts
SKILL_DIR = os.path.dirname(HERE)                         # .../monday-ops
# Canonical API helper (owned by the mapps skill; the local duplicate was removed).
API = os.environ.get(
    "MAPPS_API_SH",
    # Sibling skill: <skills-root>/mapps/mapps-api.sh, derived from this file's
    # own location so the skill works from wherever the repo is cloned.
    str(Path(__file__).resolve().parents[2] / "mapps" / "mapps-api.sh"))
API_VERSION = "2026-04"


# ----------------------------------------------------------------------------- API
def gql(q, v=None, apply=True):
    """Run a GraphQL op. In dry-run, only queries run; mutations are skipped."""
    is_mutation = q.lstrip().startswith("mutation")
    if is_mutation and not apply:
        return {"_dryrun": True}
    args = [API, q] + ([json.dumps(v, ensure_ascii=False)] if v is not None else []) + [API_VERSION]
    r = subprocess.run(args, capture_output=True, text=True)
    try:
        out = json.loads(r.stdout)
    except Exception:
        raise SystemExit("BAD RESPONSE:\n" + r.stdout[:800] + "\n" + r.stderr[:400])
    if out.get("errors"):
        raise SystemExit("GQL ERROR: " + json.dumps(out["errors"], ensure_ascii=False)[:900]
                         + "\nquery: " + q[:300])
    return out["data"]


def load(*parts):
    with open(os.path.join(SKILL_DIR, *parts), encoding="utf-8") as f:
        return json.load(f)


def save_state(state, out_dir):
    """Write state.json NOW. Called incrementally during apply so a mid-run
    crash leaves a reconciliation record instead of an untracked half-build."""
    snapshot = {k: v for k, v in state.items()}
    snapshot["boards"] = {bk: {kk: vv for kk, vv in info.items() if kk != "deferred"}
                          for bk, info in state["boards"].items()}
    path = os.path.join(out_dir, "state.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    return path


# ------------------------------------------------------------------- plan resolution
def needed_boards(structure, options, blueprint):
    req = list(structure["boards_required"])
    # optional boards are added by their option flag
    if options.get("customers") and "customers" not in req:
        req.append("customers")
    if options.get("projectStructure") and "projectStructure" not in req:
        req.append("projectStructure")
    return req


def column_specs(board_key, bp, options, config):
    """Return the column specs for a board, expanding label sources / option-gated cols."""
    board = bp["boards"][board_key]
    cols = []
    for c in board["columns"]:
        req = c.get("requires")
        if req == "customers" and not options.get("customers"):
            continue
        if req == "projectStructure" and not options.get("projectStructure"):
            continue
        if req == "routine" and not options.get("routine"):
            continue
        c = dict(c)
        # status labels from config (e.g. Time Logs stage = chosen stages)
        if c.get("labels_from") == "config.stages":
            c["labels"] = [{"key": f"s{i}", "label": s,
                            "color": ["working_orange","done_green","dark_blue","dark_orange","dark_purple","american_gray"][i % 6]}
                           for i, s in enumerate(config["stages"])]
        # routine primary label appended to eventType
        if board_key == "timeLogs" and c["key"] == "eventType" and options.get("routine"):
            c["labels"] = c["labels"] + c.get("labels_routine", [])
        cols.append(c)
    return cols


# --------------------------------------------------------------------- board build
COLOR_OK = {"done_green","working_orange","stuck_red","american_gray","dark_orange",
            "dark_blue","dark_purple","bright_blue","sofia_pink","lipstick","bubble"}


def resolve_board(board_key, spec, bp, apply, state, config):
    """Create or reuse a board; return its monday id."""
    b = config["boards"].get(board_key, {"mode": "create"})
    title = bp["boards"][board_key]["title"]
    if b["mode"] == "reuse":
        bid = str(b["id"])
        log(f"  reuse board {board_key} -> {bid}")
        return bid
    if b.get("name"):
        title = b["name"]
    data = gql('mutation($ws:ID!,$n:String!){create_board(board_name:$n,board_kind:public,workspace_id:$ws,empty:true){id}}',
               {"ws": config["workspaceId"], "n": title}, apply)
    bid = "DRYRUN-" + board_key if not apply else str(data["create_board"]["id"])
    log(f"  create board {board_key} \"{title}\" -> {bid}")
    return bid


def existing_columns(board_id, apply):
    if not apply or str(board_id).startswith("DRYRUN"):
        return []
    d = gql('query($b:[ID!]){boards(ids:$b){columns{id title type settings}}}', {"b": [board_id]}, True)
    return d["boards"][0]["columns"]


def create_column(board_id, title, ctype, defaults, apply):
    data = gql('mutation($b:ID!,$t:String!,$ct:ColumnType!,$d:JSON){create_column(board_id:$b,title:$t,column_type:$ct,defaults:$d){id}}',
               {"b": board_id, "t": title, "ct": ctype, "d": json.dumps(defaults, ensure_ascii=False) if defaults else None}, apply)
    return "DRYRUN" if not apply else str(data["create_column"]["id"])


def read_status_labels(board_id, col_id, apply):
    """Return {labelText: labelId} read back from the API."""
    if not apply:
        return {}
    d = gql('query($b:[ID!]){boards(ids:$b){columns{id type settings}}}', {"b": [board_id]}, True)
    for c in d["boards"][0]["columns"]:
        if c["id"] == col_id and c.get("settings"):
            s = json.loads(c["settings"]) if isinstance(c["settings"], str) else c["settings"]
            return {lab["label"]: str(lab.get("id", lab.get("index"))) for lab in s.get("labels", [])}
    return {}


def build_board_columns(board_key, board_id, bp, options, apply, state, config):
    """Pass 1 (non-relation/mirror): create columns, capture ids + status label maps."""
    reuse = config["boards"].get(board_key, {}).get("mode") == "reuse"
    col_map = dict(config["boards"].get(board_key, {}).get("columnMap", {}))  # logical->real
    label_map = dict(config["boards"].get(board_key, {}).get("labelMap", {}))  # logical->{key:labelId}
    existing = existing_columns(board_id, apply)
    by_title = {c["title"]: c for c in existing}

    deferred = []  # board_relation + mirror handled in later passes
    for c in column_specs(board_key, bp, options, config):
        key, title, ctype = c["key"], c["title"], c["type"]
        if key == "name":
            col_map["name"] = "name"
            continue
        if ctype in ("board_relation", "mirror"):
            deferred.append(c)
            continue
        if key in col_map:
            cid = col_map[key]
        elif reuse and title in by_title:
            cid = by_title[title]["id"]
            col_map[key] = cid
        else:
            defaults = None
            if ctype == "status":
                defaults = {"labels": [{"index": i, "label": l["label"], "color": l["color"]}
                                       for i, l in enumerate(c["labels"])]}
            elif ctype == "dropdown" and c.get("dropdown_labels"):
                defaults = {"labels": [{"id": i + 1, "name": n} for i, n in enumerate(c["dropdown_labels"])]}
            cid = create_column(board_id, title, ctype, defaults, apply)
            col_map[key] = cid
        # status: read real label ids back
        if ctype == "status":
            real = read_status_labels(board_id, cid, apply)
            lm = {}
            for l in c["labels"]:
                if real.get(l["label"]):
                    lm[l["key"]] = real[l["label"]]
            if label_map.get(key):
                lm.update(label_map[key])
            label_map[key] = lm
    state["boards"][board_key] = {"id": board_id, "columns": col_map, "labels": label_map,
                                  "deferred": deferred}


def build_relations(bp, apply, state):
    """Pass 2: create board_relation columns (targets now exist)."""
    for board_key, info in state["boards"].items():
        for c in info["deferred"]:
            if c["type"] != "board_relation":
                continue
            target_key = c["target"]
            if target_key not in state["boards"]:
                log(f"  ! skip relation {board_key}.{c['key']} -> {target_key} (target not built)")
                continue
            if c["key"] in info["columns"]:
                continue  # already mapped (reuse)
            target_id = state["boards"][target_key]["id"]
            defaults = {"boardIds": [int(target_id)] if str(target_id).isdigit() else [target_id],
                        "allowMultipleItems": False,
                        "allowCreateReflectionColumn": bool(c.get("reflection"))}
            cid = create_column(info["id"], c["title"], "board_relation", defaults, apply)
            info["columns"][c["key"]] = cid
            log(f"  relation {board_key}.{c['key']} -> {target_key} ({cid})")


def build_mirrors(bp, apply, state):
    """Pass 3: best-effort mirror creation. Mirror config via API is fiddly and
    version-dependent — if it fails, record a manual TODO instead of aborting."""
    for board_key, info in state["boards"].items():
        for c in info["deferred"]:
            if c["type"] != "mirror":
                continue
            if c["key"] in info["columns"]:
                continue
            note = (f"MANUAL: create mirror '{c['title']}' on board {board_key} ({info['id']}) "
                    f"aggregating {c.get('mirror_column')} via {c.get('mirror_via')}.")
            state.setdefault("manual_steps", []).append(note)
            log(f"  ⚠ {note}")


# ------------------------------------------------------------------ settings render
def render_settings(template_name, out_name, structure, options, state, out_dir):
    tpl = load("templates", template_name)
    flavor = {}
    if "tracker" in template_name and structure.get("tracker_flavor"):
        flavor = structure["tracker_flavor"]

    def resolve_token(tok):
        # {{board.col}} or {{board.col:labelKey}} or {{board.id}}
        board, rest = tok.split(".", 1)
        b = state["boards"].get(board)
        if not b:
            return None
        if rest == "id":
            return b["id"]
        if ":" in rest:
            col, lab = rest.split(":", 1)
            return b["labels"].get(col, {}).get(lab)
        return b["columns"].get(rest)

    def walk(node):
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items() if k != "_doc"}
        if isinstance(node, list):
            return [walk(x) for x in node]
        if isinstance(node, str):
            s = node
            if s.startswith("__FLAVOR__"):
                return flavor.get(s[len("__FLAVOR__"):])
            for tag, on in (("__IF_ROUTINE__", options.get("routine")),
                            ("__IF_CUSTOMERS__", options.get("customers")),
                            ("__IF_TIMELOGS__", "timeLogs" in state["boards"]),
                            ("__IF_EMPLOYEES__", "employees" in state["boards"])):
                if s.startswith(tag):
                    body = s[len(tag):]
                    yes, no = body.split("__ELSE__", 1) if "__ELSE__" in body else (body, "null")
                    s = yes if on else no
                    if s == "null":
                        return None
                    break
            # substitute {{...}} tokens
            while "{{" in s:
                a = s.index("{{"); z = s.index("}}", a)
                tok = s[a + 2:z]
                val = resolve_token(tok)
                if val is None:
                    val = ""
                s = s[:a] + str(val) + s[z + 2:]
            return s
        return node

    rendered = walk(tpl)
    out_path = os.path.join(out_dir, out_name)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rendered, f, ensure_ascii=False, indent=2)
    log(f"  wrote {out_path}")


# --------------------------------------------------------------------------- driver
_LOG = []
def log(m):
    print(m)
    _LOG.append(m)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    apply = "--apply" in sys.argv
    config = json.load(open(sys.argv[1], encoding="utf-8"))
    out_dir = config["outDir"]
    os.makedirs(out_dir, exist_ok=True)

    bp = load("blueprints", "boards.json")
    structures = load("blueprints", "structures.json")["structures"]
    structure = structures[config["structure"]]
    options = config.get("options", {})

    mode = "APPLY (live mutations)" if apply else "DRY RUN (no mutations)"
    log(f"=== monday-ops :: {config['demoName']} :: {structure['label']} :: {mode} ===")
    log(f"workspace {config['workspaceId']}  |  structure {config['structure']}  |  options {options}")

    boards = needed_boards(structure, options, bp)
    log(f"boards needed: {boards}")

    state = {"workspaceId": config["workspaceId"], "demoName": config["demoName"],
             "structure": config["structure"], "structureLabel": structure["label"],
             "options": options, "stages": config.get("stages", []), "boards": {}}

    log("\n-- resolve boards --")
    board_ids = {k: resolve_board(k, structure, bp, apply, state, config) for k in boards}
    if apply:
        # record board ids immediately, before any column work
        for k, bid in board_ids.items():
            state["boards"].setdefault(k, {"id": bid, "columns": {}, "labels": {}})
        save_state(state, out_dir)

    log("\n-- columns (pass 1) --")
    for k in boards:
        build_board_columns(k, board_ids[k], bp, options, apply, state, config)
        if apply:
            save_state(state, out_dir)  # incremental: survive a mid-run crash

    log("\n-- relations (pass 2) --")
    build_relations(bp, apply, state)
    if apply:
        save_state(state, out_dir)

    log("\n-- mirrors (pass 3, best-effort) --")
    build_mirrors(bp, apply, state)

    # strip transient 'deferred' from state before the final save
    for info in state["boards"].values():
        info.pop("deferred", None)

    state_path = save_state(state, out_dir)
    log(f"\nstate -> {state_path}")

    log("\n-- render app settings --")
    if "tracker" in structure["apps"] and structure.get("tracker_flavor"):
        render_settings("tracker-settings.template.json", "tracker-settings.json", structure, options, state, out_dir)
    if "planner" in structure["apps"]:
        render_settings("planner-settings.template.json", "planner-settings.json", structure, options, state, out_dir)

    if state.get("manual_steps"):
        log("\n⚠ MANUAL STEPS REQUIRED:")
        for s in state["manual_steps"]:
            log("  - " + s)

    log("\n✅ done. Next: run validate.py to assert the live boards match the blueprint."
        if apply else "\n(dry run complete — re-run with --apply to build)")


if __name__ == "__main__":
    main()

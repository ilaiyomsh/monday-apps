#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed-scale.py — HIGH-SCALE sandbox seeder for axis load testing.

Sibling of seed.py (same state.json/column/label resolution, same batched
create_item mutations) but built for VOLUME: dozens of projects, 30+ employee
rows mapped round-robin onto the account's REAL users, hundreds of allocations
and thousands of time reports — with throttling so the shared complexity
budget survives (repo golden rule 4).

SAFETY RAILS (non-negotiable):
  * Refuses to run unless config.workspaceId == 16291824 (the agent sandbox).
  * Refuses unless config.demoName starts with "WZ-".
  * People columns only carry REAL user ids fetched live (people columns
    reject invented ids); all used users are added as board subscribers first
    (membership preflight P3 — otherwise every write fails with
    invalidPersonAssignment).

Usage:
    ./seed-scale.py <config.json> [--apply] [--projects N] [--employees N]
                    [--months M] [--sleep S]

Dry-run (no --apply) works WITHOUT state.json / token: it synthesizes a
DRYRUN state from the blueprint and prints the full volume plan. Apply mode
requires state.json produced by provision.py --apply in config.outDir.
"""
import sys, os, json, subprocess, datetime, time
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(HERE)
API = os.environ.get(
    "MAPPS_API_SH",
    str(Path(__file__).resolve().parents[2] / "mapps" / "mapps-api.sh"))
APIV = "2026-04"

SANDBOX_WORKSPACE_ID = "16291824"


def gql(q, v=None, apply=True):
    """Run a GraphQL op; dry-run skips mutations AND queries (token-free).
    One retry with a 60s cooldown on complexity exhaustion."""
    if not apply:
        return {"_dryrun": True}
    a = [API, q] + ([json.dumps(v, ensure_ascii=False)] if v is not None else []) + [APIV]
    for attempt in (1, 2):
        out = json.loads(subprocess.run(a, capture_output=True, text=True).stdout)
        errs = out.get("errors")
        if not errs:
            return out.get("data", {})
        if attempt == 1 and "COMPLEXITY" in json.dumps(errs):
            print("  complexity budget hit — cooling down 60s…", flush=True)
            time.sleep(60)
            continue
        raise SystemExit("GQL ERROR: " + json.dumps(errs, ensure_ascii=False)[:700])


def cv(d):
    return json.dumps(d, ensure_ascii=False)


def person(uid):
    return {"personsAndTeams": [{"id": int(uid), "kind": "person"}]}


def synth_dryrun_state(bp, config):
    """Blueprint-shaped placeholder state so dry-run plans without a token."""
    state = {"workspaceId": config["workspaceId"], "boards": {}}
    for key, board in bp["boards"].items():
        cols = {c["key"]: f"DRYRUN-{key}-{c['key']}" for c in board["columns"]}
        # blueprint labels are a LIST of {key,label,color} — index them by key.
        labels = {c["key"]: {l["key"]: str(i) for i, l in enumerate(c["labels"])}
                  for c in board["columns"] if c.get("labels")}
        state["boards"][key] = {"id": f"DRYRUN-{key}", "columns": cols, "labels": labels}
    return state


def fetch_real_users(apply):
    """Live account users (people columns accept only real ids)."""
    if not apply:
        return [{"id": 1000 + i, "name": f"DRYRUN user {i}"} for i in range(3)]
    data = gql('query { users(kind: all, limit: 100) { id name enabled is_guest } }', apply=True)
    users = [u for u in data.get("users", []) if u.get("enabled") and not u.get("is_guest")]
    if not users:
        raise SystemExit("SEED-SCALE ERROR: no enabled non-guest users returned — cannot fill people columns.")
    return users


def add_subscribers(board_ids, user_ids, apply):
    """Membership preflight P3: every assigned user must subscribe to the board."""
    for bid in board_ids:
        gql('mutation($b:ID!,$u:[ID!]!){add_users_to_board(board_id:$b,user_ids:$u,kind:subscriber){id}}',
            {"b": bid, "u": [str(u) for u in user_ids]}, apply)


def main():
    args = sys.argv[1:]
    apply = "--apply" in args

    def flag(name, default):
        return type(default)(args[args.index(name) + 1]) if name in args else default

    config = json.load(open(args[0], encoding="utf-8"))
    sc = config.get("seedScale", {})
    n_projects = flag("--projects", int(sc.get("projects", 40)))
    n_employees = flag("--employees", int(sc.get("employees", 30)))
    months = flag("--months", int(sc.get("months", 3)))
    sleep_s = flag("--sleep", float(sc.get("sleepBetweenBatches", 0.6)))
    alloc_per_project = int(sc.get("allocationsPerProject", 6))
    blocks_per_day = int(sc.get("blocksPerDay", 2))
    hours_per_block = int(sc.get("hoursPerBlock", 4))
    batch_size = int(sc.get("batchSize", 10))

    # ---- safety rails ----
    if str(config.get("workspaceId")) != SANDBOX_WORKSPACE_ID:
        raise SystemExit(f"SEED-SCALE REFUSED: workspaceId {config.get('workspaceId')} is not the "
                         f"agent sandbox ({SANDBOX_WORKSPACE_ID}). This script never touches other workspaces.")
    if not str(config.get("demoName", "")).startswith("WZ-"):
        raise SystemExit("SEED-SCALE REFUSED: demoName must carry the WZ- scratch prefix (golden rule 4).")

    state_path = os.path.join(config["outDir"], "state.json")
    if apply:
        if not os.path.exists(state_path):
            raise SystemExit(f"SEED-SCALE ERROR: {state_path} missing — run provision.py --apply first.")
        state = json.load(open(state_path, encoding="utf-8"))
        if str(state.get("workspaceId")) != SANDBOX_WORKSPACE_ID:
            raise SystemExit("SEED-SCALE REFUSED: state.json workspace differs from the sandbox.")
    else:
        bp = json.load(open(os.path.join(SKILL_DIR, "blueprints", "boards.json"), encoding="utf-8"))
        state = synth_dryrun_state(bp, config)
    B = state["boards"]

    def col(board, key):
        return B[board]["columns"][key]

    def lab(board, key, lkey):
        return B[board]["labels"].get(key, {}).get(lkey)

    def lab_cycle(board, key):
        ids = list(B[board]["labels"].get(key, {}).values())
        return ids or [None]

    # ---- window: `months` full months back from the 1st of the current month ----
    today = datetime.date.today()
    win_end = today
    m = today.month - (months - 1)
    y = today.year
    while m <= 0:
        m += 12
        y -= 1
    win_start = datetime.date(y, m, 1)
    workdays = [win_start + datetime.timedelta(n) for n in range((win_end - win_start).days + 1)
                if (win_start + datetime.timedelta(n)).weekday() in (6, 0, 1, 2, 3)]  # Sun–Thu

    users = fetch_real_users(apply)
    print(f"=== seed-scale :: {config['demoName']} :: {'APPLY' if apply else 'DRY RUN'} ===")
    print(f"real users available: {len(users)} | projects: {n_projects} | employee rows: {n_employees}")
    print(f"window: {win_start} → {win_end} ({len(workdays)} workdays) | "
          f"allocations: {n_projects * alloc_per_project}")

    total_reports = len(workdays) * n_employees * blocks_per_day
    print(f"planned time reports: {total_reports} "
          f"(~{(total_reports + batch_size - 1) // batch_size} mutations, sleep {sleep_s}s between)")
    if not apply:
        print("(dry run — re-run with --apply to seed)")
        return

    # ---- membership preflight (P3) ----
    user_ids = [u["id"] for u in users]
    add_subscribers([B[k]["id"] for k in ("portfolio", "employees", "allocations", "timeLogs") if k in B],
                    user_ids, apply)
    print(f"subscribers ensured on 4 boards for {len(user_ids)} users")

    created = {"projects": 0, "employees": 0, "allocations": 0, "timeReports": 0}

    def create_batch(board, rows):
        """rows: [(name, cvals)] — batched create_item mutations, throttled."""
        out = []
        for i in range(0, len(rows), batch_size):
            chunk = rows[i:i + batch_size]
            decls = "$b:ID!," + ",".join(f"$n{j}:String!,$cv{j}:JSON!" for j in range(len(chunk)))
            body = "".join(
                f' r{j}:create_item(board_id:$b,item_name:$n{j},column_values:$cv{j},create_labels_if_missing:true){{id}}'
                for j in range(len(chunk)))
            v = {"b": B[board]["id"]}
            for j, (nm, c) in enumerate(chunk):
                v[f"n{j}"] = nm
                v[f"cv{j}"] = cv(c)
            data = gql("mutation(" + decls + "){" + body + "}", v, apply)
            out.extend(str(data[f"r{j}"]["id"]) for j in range(len(chunk)))
            time.sleep(sleep_s)
        return out

    # ---- projects ----
    steps = lab_cycle("portfolio", "step")
    rags = lab_cycle("portfolio", "rag")
    prios = lab_cycle("portfolio", "priority")
    rows = []
    for i in range(n_projects):
        c = {col("portfolio", "owner"): person(users[i % len(users)]["id"]),
             col("portfolio", "planned_timeline"): {"from": win_start.isoformat(), "to": win_end.isoformat()}}
        if steps[0] is not None:
            c[col("portfolio", "step")] = {"index": int(steps[i % len(steps)])}
        if rags[0] is not None:
            c[col("portfolio", "rag")] = {"index": int(rags[i % len(rags)])}
        if prios[0] is not None:
            c[col("portfolio", "priority")] = {"index": int(prios[i % len(prios)])}
        rows.append((f"WZ-SCALE פרויקט {i + 1}", c))
    project_ids = create_batch("portfolio", rows)
    created["projects"] = len(project_ids)
    print(f"projects -> {len(project_ids)}")

    # ---- employees (round-robin over real users) ----
    active = lab("employees", "status", "active")
    roles = ["אדריכל", "מהנדס", "מנהל פרויקט", "הנדסאי", "מעצב"]
    rows = []
    for i in range(n_employees):
        u = users[i % len(users)]
        c = {col("employees", "linkedUser"): person(u["id"]),
             col("employees", "orgRole"): roles[i % len(roles)],
             col("employees", "employmentPct"): "100%",
             col("employees", "cost"): str(150 + (i % 10) * 10)}
        if active is not None:
            c[col("employees", "status")] = {"index": int(active)}
        rows.append((f"WZ-SCALE עובד {i + 1} ({u['name']})", c))
    employee_item_ids = create_batch("employees", rows)
    created["employees"] = len(employee_item_ids)
    print(f"employees -> {len(employee_item_ids)}")

    # ---- allocations: alloc_per_project per project, employees round-robin ----
    rows = []
    alloc_owner_user = []   # parallel: which real user id reports on this allocation
    alloc_project = []      # parallel: project id
    k = 0
    for pi, pid in enumerate(project_ids):
        for _ in range(alloc_per_project):
            emp_idx = k % n_employees
            u = users[emp_idx % len(users)]
            c = {col("allocations", "employee"): person(u["id"]),
                 col("allocations", "startDate"): {"date": win_start.isoformat()},
                 col("allocations", "endDate"): {"date": win_end.isoformat()},
                 col("allocations", "totalHours"): str(len(workdays) * hours_per_block // alloc_per_project),
                 col("allocations", "hoursPerDay"): str(hours_per_block),
                 col("allocations", "role"): roles[emp_idx % len(roles)],
                 col("allocations", "fte"): "100",
                 col("allocations", "cost"): "0",
                 col("allocations", "project"): {"linkedPulseIds": [{"linkedPulseId": int(pid)}]}}
            rows.append((f"WZ-SCALE הקצאה {k + 1}", c))
            alloc_owner_user.append(u["id"])
            alloc_project.append(pid)
            k += 1
    allocation_ids = create_batch("allocations", rows)
    created["allocations"] = len(allocation_ids)
    print(f"allocations -> {len(allocation_ids)}")

    # ---- time reports: per workday × employee × blocks, against that employee's allocations ----
    stage_ids = lab_cycle("timeLogs", "stage")
    proj_label = lab("timeLogs", "eventType", "project")
    # allocations indexed by employee row for a round-robin pick
    allocs_by_emp = {}
    for ai in range(len(allocation_ids)):
        allocs_by_emp.setdefault(ai % n_employees, []).append(ai)
    block_starts = ["09:00:00", "13:30:00", "16:00:00"][:blocks_per_day]
    rows = []
    for di, day in enumerate(workdays):
        ds = day.isoformat()
        for ei in range(n_employees):
            my_allocs = allocs_by_emp.get(ei) or [0]
            for bi, start in enumerate(block_starts):
                ai = my_allocs[(di + bi) % len(my_allocs)]
                end_h = int(start[:2]) + hours_per_block
                c = {col("timeLogs", "date"): {"date": ds, "time": start},
                     col("timeLogs", "endTime"): {"date": ds, "time": f"{end_h:02d}:{start[3:5]}:00"},
                     col("timeLogs", "duration"): str(hours_per_block),
                     col("timeLogs", "reporter"): person(users[ei % len(users)]["id"]),
                     col("timeLogs", "project"): {"linkedPulseIds": [{"linkedPulseId": int(alloc_project[ai])}]},
                     col("timeLogs", "assignment"): {"linkedPulseIds": [{"linkedPulseId": int(allocation_ids[ai])}]}}
                if proj_label is not None:
                    c[col("timeLogs", "eventType")] = {"index": int(proj_label)}
                if stage_ids[0] is not None:
                    c[col("timeLogs", "stage")] = {"index": int(stage_ids[(di // 5) % len(stage_ids)])}
                rows.append((ds, c))
        if di % 10 == 0:
            print(f"  building day {di + 1}/{len(workdays)} (queued {len(rows)} reports)", flush=True)
    report_ids = create_batch("timeLogs", rows)
    created["timeReports"] = len(report_ids)
    print(f"time reports -> {len(report_ids)}")

    summary_path = os.path.join(config["outDir"], "seed-scale-summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump({"created": created, "window": [win_start.isoformat(), win_end.isoformat()],
                   "realUsers": len(users), "boards": {k: B[k]["id"] for k in B}}, f, ensure_ascii=False, indent=2)
    print(f"✅ done. summary -> {summary_path}")


if __name__ == "__main__":
    main()

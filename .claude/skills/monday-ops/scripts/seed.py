#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed.py — generic demo-data seeder, driven by state.json (from provision.py) + the
`seed` block of config.json. Creates: project(s) in Portfolio, employees, allocations,
and a span of time reports. Resolves every column id + status label id from state, so
it works for any workspace the engine built. Idempotent-ish: re-runnable (creates fresh
items each run; delete old ones first if needed).

Usage:  ./seed.py <config.json> [--apply]

config.seed shape:
{
  "project": { "name":"מגדל רוטשילד 22", "scope":"...", "managerUserId":48274917,
               "timeline": {"from":"2026-06-01","to":"2026-08-31"},
               "rag":"ok", "priority":"high", "step":"in_progress" },
  "employees": [ {"name":"עילי שלם","userId":48274917,"role":"אדריכל","pct":"100%",
                  "cost":"250","capabilities":[1,5],"status":"active"} ],
  "allocations": [ {"name":"עילי — הפרויקט","employeeIdx":0,"role":"אדריכל",
                    "total":"176","perDay":"8","fte":"100","cost":"44000"} ],
  "timeReports": {
     "dateFrom":"2026-06-01","dateTo":"2026-06-30","workDays":[6,0,1,2,3],
     "rotateStages": true,
     "perPerson":[ {"employeeIdx":0,"duration":"4",
                    "blocks":[["09:00:00","13:00:00"],["13:30:00","17:30:00"]]} ]
  }
}
employeeIdx in allocations/timeReports indexes into the employees array (same userId).
"""
import sys, os, json, subprocess, datetime
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))        # .../monday-ops/scripts
# Canonical API helper (owned by the mapps skill; the local duplicate was removed).
API = os.environ.get(
    "MAPPS_API_SH",
    # Sibling skill: <skills-root>/mapps/mapps-api.sh, derived from this file's
    # own location so the skill works from wherever the repo is cloned.
    str(Path(__file__).resolve().parents[2] / "mapps" / "mapps-api.sh"))
APIV = "2026-04"


def gql(q, v=None, apply=True):
    if q.lstrip().startswith("mutation") and not apply:
        return {"_dryrun": True}
    a = [API, q] + ([json.dumps(v, ensure_ascii=False)] if v is not None else []) + [APIV]
    out = json.loads(subprocess.run(a, capture_output=True, text=True).stdout)
    if out.get("errors"):
        raise SystemExit("GQL ERROR: " + json.dumps(out["errors"], ensure_ascii=False)[:700])
    return out.get("data", {})


def cv(d):
    return json.dumps(d, ensure_ascii=False)


def person(uid):
    return {"personsAndTeams": [{"id": int(uid), "kind": "person"}]}


def main():
    apply = "--apply" in sys.argv
    config = json.load(open(sys.argv[1], encoding="utf-8"))
    state = json.load(open(os.path.join(config["outDir"], "state.json"), encoding="utf-8"))
    seed = config.get("seed", {})
    B = state["boards"]

    def col(board, key):
        return B[board]["columns"][key]

    def lab(board, key, lkey):
        return B[board]["labels"].get(key, {}).get(lkey)

    def create_item(board, name, cvals):
        d = gql('mutation($b:ID!,$n:String!,$cv:JSON!){create_item(board_id:$b,item_name:$n,column_values:$cv,create_labels_if_missing:true){id}}',
                {"b": B[board]["id"], "n": name, "cv": cv(cvals)}, apply)
        return None if not apply else d["create_item"]["id"]

    print(f"=== seed :: {config['demoName']} :: {'APPLY' if apply else 'DRY RUN'} ===")

    # ---- upfront validation (fail clearly, not with a KeyError mid-seed) ----
    if seed.get("allocations") and not seed.get("project"):
        tr_cfg = seed.get("timeReports") or {}
        if not (tr_cfg.get("dateFrom") and tr_cfg.get("dateTo")):
            raise SystemExit(
                "SEED CONFIG ERROR: seed.allocations is set but seed.project is missing "
                "and seed.timeReports has no dateFrom/dateTo. Allocations need a date "
                "range — add a seed.project with a timeline, or set "
                "seed.timeReports.dateFrom/dateTo. (Allocations will also be created "
                "without a project link.)")

    # ---- project ----
    proj_id = None
    p = seed.get("project")
    if p and "portfolio" in B:
        cvals = {col("portfolio", "step"): {"index": int(lab("portfolio", "step", p.get("step", "in_progress")))},
                 col("portfolio", "rag"): {"index": int(lab("portfolio", "rag", p.get("rag", "ok")))},
                 col("portfolio", "priority"): {"index": int(lab("portfolio", "priority", p.get("priority", "high")))}}
        if p.get("managerUserId"):
            cvals[col("portfolio", "owner")] = person(p["managerUserId"])
        if p.get("timeline"):
            cvals[col("portfolio", "planned_timeline")] = {"from": p["timeline"]["from"], "to": p["timeline"]["to"]}
        if p.get("scope"):
            cvals[col("portfolio", "scope")] = p["scope"]
        proj_id = create_item("portfolio", p["name"], cvals)
        print(f"project -> {proj_id}")

    # ---- employees ----
    emp_ids = []
    for e in seed.get("employees", []):
        cvals = {col("employees", "status"): {"index": int(lab("employees", "status", e.get("status", "active")))},
                 col("employees", "linkedUser"): person(e["userId"]),
                 col("employees", "orgRole"): e.get("role", ""),
                 col("employees", "employmentPct"): e.get("pct", "100%"),
                 col("employees", "cost"): e.get("cost", "0")}
        if e.get("capabilities"):
            cvals[col("employees", "capabilities")] = {"ids": [str(x) for x in e["capabilities"]]}
        emp_ids.append(create_item("employees", e["name"], cvals))
    print(f"employees -> {emp_ids}")

    # ---- allocations ----
    alloc_ids = []
    for a in seed.get("allocations", []):
        e = seed["employees"][a["employeeIdx"]]
        tr_cfg = seed.get("timeReports") or {}
        p_tl = (p or {}).get("timeline") or {}
        start = tr_cfg.get("dateFrom") or p_tl.get("from")
        end = tr_cfg.get("dateTo") or p_tl.get("to")
        if not (start and end):
            raise SystemExit(
                f"SEED CONFIG ERROR: allocation '{a.get('name', a)}' has no resolvable "
                "date range (no seed.timeReports.dateFrom/dateTo and no "
                "seed.project.timeline). Fix the seed block and re-run.")
        cvals = {col("allocations", "employee"): person(e["userId"]),
                 col("allocations", "startDate"): {"date": start},
                 col("allocations", "endDate"): {"date": end},
                 col("allocations", "totalHours"): a["total"], col("allocations", "hoursPerDay"): a["perDay"],
                 col("allocations", "role"): a.get("role", ""), col("allocations", "fte"): a.get("fte", "100"),
                 col("allocations", "cost"): a.get("cost", "0")}
        if proj_id:
            cvals[col("allocations", "project")] = {"linkedPulseIds": [{"linkedPulseId": int(proj_id)}]}
        alloc_ids.append(create_item("allocations", a["name"], cvals))
    print(f"allocations -> {alloc_ids}")

    # ---- time reports ----
    tr = seed.get("timeReports")
    created = 0
    if tr and "timeLogs" in B:
        d0 = datetime.date.fromisoformat(tr["dateFrom"])
        d1 = datetime.date.fromisoformat(tr["dateTo"])
        wdays = set(tr.get("workDays", [6, 0, 1, 2, 3]))
        days = [d0 + datetime.timedelta(n) for n in range((d1 - d0).days + 1)
                if (d0 + datetime.timedelta(n)).weekday() in wdays]
        stage_ids = list(B["timeLogs"]["labels"].get("stage", {}).values())
        proj_label = lab("timeLogs", "eventType", "project")
        reports = []
        for di, day in enumerate(days):
            ds = day.isoformat()
            stage = stage_ids[(di // 5) % len(stage_ids)] if (stage_ids and tr.get("rotateStages")) else (stage_ids[0] if stage_ids else None)
            for pp in tr["perPerson"]:
                e = seed["employees"][pp["employeeIdx"]]
                aidx = pp["employeeIdx"] if pp["employeeIdx"] < len(alloc_ids) else None
                for (start, end) in pp["blocks"]:
                    c = {col("timeLogs", "date"): {"date": ds, "time": start},
                         col("timeLogs", "endTime"): {"date": ds, "time": end},
                         col("timeLogs", "duration"): pp["duration"],
                         col("timeLogs", "reporter"): person(e["userId"]),
                         col("timeLogs", "eventType"): {"index": int(proj_label)}}
                    if stage:
                        c[col("timeLogs", "stage")] = {"index": int(stage)}
                    if proj_id:
                        c[col("timeLogs", "project")] = {"linkedPulseIds": [{"linkedPulseId": int(proj_id)}]}
                    if aidx is not None and alloc_ids[aidx]:
                        c[col("timeLogs", "assignment")] = {"linkedPulseIds": [{"linkedPulseId": int(alloc_ids[aidx])}]}
                    reports.append((f"{ds}", c))
        for i in range(0, len(reports), 10):
            batch = reports[i:i + 10]
            decls = "$b:ID!," + ",".join(f"$n{j}:String!,$cv{j}:JSON!" for j in range(len(batch)))
            body = "".join(f' r{j}:create_item(board_id:$b,item_name:$n{j},column_values:$cv{j},create_labels_if_missing:true){{id}}' for j in range(len(batch)))
            v = {"b": B["timeLogs"]["id"]}
            for j, (nm, c) in enumerate(batch):
                v[f"n{j}"] = nm; v[f"cv{j}"] = cv(c)
            gql("mutation(" + decls + "){" + body + "}", v, apply)
            created += len(batch)
    print(f"time reports -> {created}")
    print("✅ done." if apply else "(dry run — re-run with --apply to seed)")


if __name__ == "__main__":
    main()

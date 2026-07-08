#!/usr/bin/env python3
"""check.py — audit monday.com API usage in a path (`/monday-api check [path]`).

Checks:
  1. Deprecated fields  — settings_str (dead since 2025-10), flat User photo
     fields (photo_thumb & friends, removed 2026-10), User kind/status booleans.
  2. Version-pin rule   — flags files that call the API with NO API-Version pin,
     a pin absent from the live versions list, or a pin whose kind is
     maintenance / release_candidate.
  3. Guessed column formats — known-wrong payload shapes (e.g. {"checked":"false"}
     never unchecks) and column_values passed as an object literal without
     JSON.stringify.

Live versions come from `{ versions { kind value } }` via the canonical
mapps-api.sh wrapper (token never enters this process's output); cached in
../schema-cache/versions.json for 7 days. Use --offline to skip the network.

Exit codes: 0 = no errors (warnings allowed), 1 = errors found, 2 = crashed/misuse.
"""

import json
import os
import re
import subprocess
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
CACHE_DIR = os.path.join(SKILL_DIR, "schema-cache")
VERSIONS_CACHE = os.path.join(CACHE_DIR, "versions.json")
MAPPS_API = os.path.normpath(os.path.join(SKILL_DIR, "..", "mapps", "mapps-api.sh"))
VERSIONS_CACHE_MAX_AGE = 7 * 86400

# Fallback snapshot — verified live on 2026-07-02 (post 2026-07-01 rotation).
# Only used when live fetch fails AND no cache exists.
FALLBACK_VERSIONS = {
    "2025-04": "maintenance", "2025-07": "maintenance", "2025-10": "maintenance",
    "2026-01": "maintenance", "2026-04": "maintenance",
    "2026-07": "current", "2026-10": "release_candidate", "2027-01": "release_candidate",
}
VERSIONING_MD = os.path.join(SKILL_DIR, "references", "versioning.md")

CODE_EXTS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".html", ".graphql", ".gql"}
SKIP_DIRS = {"node_modules", "dist", "build", "dist-deploy", ".git", "generated", "coverage", "__pycache__"}

# --- Check 1: deprecated fields -------------------------------------------------
DEPRECATED_FIELDS = [
    (re.compile(r"\bsettings_str\b"),
     "ERROR", "`settings_str` is deprecated since API 2025-10 — use the typed `settings` field "
              "(see references/column-formats.md; status labels come from settings.labels[])."),
    (re.compile(r"\bphoto_thumb\b|\bphoto_thumb_small\b|\bphoto_original\b|\bphoto_tiny\b"),
     "WARN", "Flat User photo fields are deprecated in 2026-07 and removed 2026-10 — "
             "use `photo_url { small thumb original ... }` (see references/versioning.md)."),
    (re.compile(r"\bis_view_only\b|\bis_pending\b"),
     "WARN", "User boolean flags (is_admin/is_guest/is_view_only/is_pending/enabled) are deprecated "
             "in 2026-07, removed 2026-10 — use `kind` / `status` (see references/versioning.md)."),
]

# --- Check 2: version pins -------------------------------------------------------
PIN_PATTERNS = [
    re.compile(r"setApiVersion\(\s*['\"](20\d\d-\d\d)"),
    re.compile(r"['\"]API[-_][Vv]ersion['\"]\s*[:=]\s*['\"](20\d\d-\d\d)"),
    re.compile(r"apiVersion\s*[:=]\s*['\"](20\d\d-\d\d)"),
    re.compile(r"API_VERSION\s*=\s*['\"]?(20\d\d-\d\d)"),
]
API_CALL_RE = re.compile(
    r"monday\.api\s*\(|api\.monday\.com/v2|mondayApi\.query\s*\(|new\s+ApiClient\s*\(|SeamlessApiClient"
)

# --- Check 3: guessed column formats --------------------------------------------
FORMAT_TRAPS = [
    (re.compile(r"checked['\"]?\s*:\s*['\"]false['\"]"),
     "ERROR", '`{"checked":"false"}` does NOT uncheck a checkbox (it checks it) — send `null` '
              "to clear (see references/column-formats.md; probe on a scratch item first)."),
    (re.compile(r"column_values\s*:\s*\{"),
     "WARN", "column_values appears to be an object literal — it must be a JSON string "
             "(JSON.stringify(...)). Verify this call."),
    (re.compile(r"linkedPulseId['\"]?\s*:\s*['\"]"),
     "WARN", "linkedPulseId should be an integer item id, not a string "
             "(see references/board-relation.md)."),
]


def load_live_versions(offline: bool):
    """Return ({version: kind}, source_str)."""
    if os.path.isfile(VERSIONS_CACHE):
        try:
            with open(VERSIONS_CACHE) as f:
                cached = json.load(f)
            if time.time() - cached.get("fetched_at", 0) <= VERSIONS_CACHE_MAX_AGE:
                return cached["versions"], "cache"
        except (json.JSONDecodeError, KeyError, OSError):
            pass
    if not offline and os.access(MAPPS_API, os.X_OK):
        try:
            out = subprocess.run(
                [MAPPS_API, "{ versions { kind value } }"],
                capture_output=True, text=True, timeout=30, check=True,
            ).stdout
            data = json.loads(out)
            versions = {v["value"]: v["kind"] for v in data["data"]["versions"]
                        if re.match(r"20\d\d-\d\d$", v["value"])}
            if versions:
                os.makedirs(CACHE_DIR, exist_ok=True)
                with open(VERSIONS_CACHE, "w") as f:
                    json.dump({"fetched_at": time.time(), "versions": versions}, f, indent=1)
                return versions, "live"
        except (subprocess.SubprocessError, json.JSONDecodeError, KeyError, OSError):
            pass
    # stale cache beats baked-in fallback
    if os.path.isfile(VERSIONS_CACHE):
        try:
            with open(VERSIONS_CACHE) as f:
                return json.load(f)["versions"], "stale-cache"
        except (json.JSONDecodeError, KeyError, OSError):
            pass
    return dict(FALLBACK_VERSIONS), "fallback-snapshot(2026-07-02)"


def recommended_version():
    """The single sanctioned pin, declared in references/versioning.md."""
    try:
        with open(VERSIONING_MD) as f:
            m = re.search(r"^RECOMMENDED_VERSION:\s*(20\d\d-\d\d)", f.read(), re.M)
        return m.group(1) if m else None
    except OSError:
        return None


def iter_files(target):
    if os.path.isfile(target):
        yield target
        return
    for root, dirs, files in os.walk(target):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in files:
            if os.path.splitext(name)[1] in CODE_EXTS:
                yield os.path.join(root, name)


def audit_file(path, versions, recommended=None):
    findings = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError as e:
        return [("WARN", 0, f"could not read file: {e}")]
    lines = text.splitlines()

    def line_no(pos):
        return text.count("\n", 0, pos) + 1

    for rx, sev, msg in DEPRECATED_FIELDS + FORMAT_TRAPS:
        for m in rx.finditer(text):
            findings.append((sev, line_no(m.start()), msg))

    pins = []
    for rx in PIN_PATTERNS:
        for m in rx.finditer(text):
            pins.append((m.group(1), line_no(m.start())))

    calls_api = bool(API_CALL_RE.search(text))
    if calls_api and not pins:
        findings.append(("WARN", 1,
                         "file calls the monday API with NO API-Version pin — unpinned requests ride "
                         "the Current version and silently absorb quarterly breaking changes. "
                         "Pin the RECOMMENDED_VERSION from references/versioning.md."))
    for version, ln in pins:
        kind = versions.get(version)
        if version == recommended and kind in ("current", "maintenance"):
            continue  # the sanctioned pin from references/versioning.md
        if kind is None:
            findings.append(("ERROR", ln,
                             f"API-Version pin '{version}' is NOT in the live supported-versions list — "
                             "monday silently reroutes it to Current/Maintenance; the code runs against a "
                             "schema it was never written for. Migrate to the RECOMMENDED_VERSION."))
        elif kind in ("maintenance", "release_candidate"):
            findings.append(("WARN", ln,
                             f"API-Version pin '{version}' has kind={kind} — "
                             + ("it will be retired soon; plan the bump (grep the whole codebase for fields "
                                "changed by the target version's changelog)." if kind == "maintenance"
                                else "RC versions are unstable and may change under you.")))
    # context snippets
    out = []
    for sev, ln, msg in findings:
        snippet = lines[ln - 1].strip()[:120] if 0 < ln <= len(lines) else ""
        out.append((sev, ln, msg, snippet))
    return out


def main(argv):
    args = [a for a in argv[1:] if a != "--offline"]
    offline = "--offline" in argv
    target = os.path.abspath(args[0]) if args else os.getcwd()
    if not os.path.exists(target):
        print(f"check.py: path not found: {target}", file=sys.stderr)
        return 2

    versions, source = load_live_versions(offline)
    recommended = recommended_version()
    print(f"# monday-api check — target: {target}")
    print(f"# supported-versions source: {source} — {json.dumps(versions)}")
    print(f"# sanctioned pin (references/versioning.md RECOMMENDED_VERSION): {recommended}")
    if recommended and versions.get(recommended) not in ("current", "maintenance"):
        print("# WARNING: RECOMMENDED_VERSION is not in the live current/maintenance set — "
              "references/versioning.md itself is stale; update it first.")

    n_err = n_warn = n_files = 0
    for path in sorted(iter_files(target)):
        findings = audit_file(path, versions, recommended)
        if not findings:
            continue
        n_files += 1
        print(f"\n{path}")
        for sev, ln, msg, snippet in sorted(findings, key=lambda x: x[1]):
            if sev == "ERROR":
                n_err += 1
            else:
                n_warn += 1
            loc = f":{ln}" if ln else ""
            print(f"  [{sev}]{loc} {msg}")
            if snippet:
                print(f"      > {snippet}")

    print(f"\n# summary: {n_err} error(s), {n_warn} warning(s) across {n_files} file(s) with findings")
    if n_err:
        print("# FIX ERRORS BEFORE SHIPPING — see the referenced pages under "
              ".claude/skills/monday-api/references/")
    return 1 if n_err else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

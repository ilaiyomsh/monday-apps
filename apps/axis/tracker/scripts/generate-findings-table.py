#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ANALYSIS_PATH = ROOT / "tech-debt" / "ANALYSIS.md"
ROADMAP_PATH = ROOT / "tech-debt" / "ROADMAP.md"
OUTPUT_PATH = ROOT / "tech-debt" / "FINDINGS_SUMMARY.md"

SECTION_RE = re.compile(r"^### (F\d{3}) — (.+)$", re.MULTILINE)
COMMIT_RE = re.compile(r"`([0-9a-f]{7,40})`")
FINDING_ID_RE = re.compile(r"\b(F\d{3})\b")
WAVE_RE = re.compile(r"^## Wave \d+ .*?$", re.MULTILINE)
ROADMAP_COMMIT_LINE_RE = re.compile(
    r"commit\s+`([0-9a-f]{7,40})`.*?\((.*?)\)", re.IGNORECASE
)


def clean_title(raw: str) -> tuple[str, str]:
    status = "פתוח"
    title = raw.strip()
    if "✅ FIXED" in title:
        status = "נסגר"
        title = title.split("✅ FIXED", 1)[0].strip()
    return title, status


def normalize_snippet(text: str, limit: int = 110) -> str:
    one_line = " ".join(text.split())
    if len(one_line) <= limit:
        return one_line
    return one_line[: limit - 1].rstrip() + "…"


def extract_short_description(section_body: str) -> str:
    for line in section_body.splitlines():
        stripped = line.strip()
        if stripped.startswith("- **Analysis:**"):
            return normalize_snippet(stripped.replace("- **Analysis:**", "", 1).strip())
        if stripped.startswith("- **Verified:**"):
            return normalize_snippet(stripped.replace("- **Verified:**", "", 1).strip())
    return "—"


def extract_commit(section_body: str) -> str:
    matches = COMMIT_RE.findall(section_body)
    if not matches:
        return "—"
    # First hash in section is usually the most relevant breadcrumb.
    return matches[0][:10]


def parse_findings(text: str) -> list[dict[str, str]]:
    matches = list(SECTION_RE.finditer(text))
    findings: list[dict[str, str]] = []

    for idx, match in enumerate(matches):
        finding_id = match.group(1)
        raw_title = match.group(2)
        title, status = clean_title(raw_title)

        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        body = text[start:end]

        findings.append(
            {
                "id": finding_id,
                "name": title,
                "description": extract_short_description(body),
                "status": status,
                "commit": extract_commit(body),
            }
        )

    return findings


def extract_roadmap_order(roadmap_text: str) -> list[str]:
    wave_match = WAVE_RE.search(roadmap_text)
    relevant_text = roadmap_text[wave_match.start() :] if wave_match else roadmap_text

    ordered: list[str] = []
    seen: set[str] = set()
    for finding_id in FINDING_ID_RE.findall(relevant_text):
        if finding_id in seen:
            continue
        ordered.append(finding_id)
        seen.add(finding_id)
    return ordered


def extract_roadmap_commit_map(roadmap_text: str) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for match in ROADMAP_COMMIT_LINE_RE.finditer(roadmap_text):
        commit_hash = match.group(1)[:10]
        findings_blob = match.group(2)
        for finding_id in FINDING_ID_RE.findall(findings_blob):
            mapping.setdefault(finding_id, commit_hash)
    return mapping


def sort_by_roadmap(findings: list[dict[str, str]], roadmap_order: list[str]) -> list[dict[str, str]]:
    order_index = {finding_id: idx for idx, finding_id in enumerate(roadmap_order)}

    def sort_key(item: dict[str, str]) -> tuple[int, int]:
        if item["id"] in order_index:
            return (0, order_index[item["id"]])
        # Findings שלא מופיעים ב-roadmap ירדו לסוף לפי מספרם.
        number = int(item["id"][1:])
        return (1, number)

    return sorted(findings, key=sort_key)


def build_table(findings: list[dict[str, str]]) -> str:
    lines = [
        "# Findings Summary",
        "",
        "טבלה אחת מסודרת לפי סדר ביצוע מתוך `tech-debt/ROADMAP.md`.",
        "",
        "| סדר | מספר | שם | תיאור קצר | סטטוס | קומיט רלוונטי |",
        "|---|---|---|---|---|---|",
    ]

    for index, item in enumerate(findings, start=1):
        row = (
            f"| {index} | {item['id']} | {item['name']} | {item['description']} | "
            f"{item['status']} | {item['commit']} |"
        )
        lines.append(row)

    lines.extend(
        [
            "",
            "> הערה: עמודת קומיט נשענת על hash שמופיע בסקשן של ה־Finding; "
            "ואם חסר שם hash, נעשה ניסיון מיפוי מתוך `ROADMAP.md`. אם עדיין חסר יוצג `—`.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    if not ANALYSIS_PATH.exists():
        raise SystemExit(f"Missing file: {ANALYSIS_PATH}")
    if not ROADMAP_PATH.exists():
        raise SystemExit(f"Missing file: {ROADMAP_PATH}")

    analysis_text = ANALYSIS_PATH.read_text(encoding="utf-8")
    roadmap_text = ROADMAP_PATH.read_text(encoding="utf-8")
    findings = parse_findings(analysis_text)
    roadmap_order = extract_roadmap_order(roadmap_text)
    roadmap_commit_map = extract_roadmap_commit_map(roadmap_text)

    for item in findings:
        if item["commit"] == "—" and item["id"] in roadmap_commit_map:
            item["commit"] = roadmap_commit_map[item["id"]]

    findings = sort_by_roadmap(findings, roadmap_order)
    output = build_table(findings)
    OUTPUT_PATH.write_text(output, encoding="utf-8")
    print(f"Generated {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

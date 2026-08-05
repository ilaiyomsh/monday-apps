// Per-employee send summary — the CSV the cron mails to the sending mailbox
// after a digest run (owner decision 2026-08-05, docs/scheduling.md §5.2).
// Pure: no network, no storage. The scheduler owns the trigger and the target;
// this module owns the bytes and the wording.
//
// Four decisions are encoded here and each has a failure it prevents:
//
//  - **UTF-8 BOM first.** Excel with no BOM falls back to the local ANSI
//    codepage and every Hebrew name opens as mojibake. The file is for a human
//    with Excel, so the BOM is part of the deliverable, not a nicety.
//  - **The cluster columns come from `config.digest.sections`, in order.** That
//    order is also the priority order (owner, 2026-08-04), so deriving the
//    columns keeps the file honest when a cluster is added, renamed or moved.
//    A hard-coded header would keep counting — under the wrong heading.
//  - **One row per employee, including everyone who received nothing.** The
//    reason (0 tasks / already sent in this slot / an unusable users-board row)
//    goes in the last column. A missing row is information that vanished, and
//    "nobody is missing" is exactly what this report exists to prove.
//  - **A dedicated `סטטוס` (outcome) column, round348.** The free-text `שגיאה`
//    column carries non-error reasons too ("already sent", "no open tasks"),
//    which made it useless to FILTER for real SMTP failures in Excel — a filter
//    on free text also catches every benign skip. `סטטוס` is the coarse
//    (sent / skipped / failed) bucket `kind` maps to; `שגיאה` stays the
//    free-text detail, unchanged. Both come from the SAME lookup (`KIND_META`)
//    so a new `kind` can never update one column and forget the other.
//
// The last column is headed `שגיאה` per the owner's column list, and it is the
// only free-text slot there — so the non-error reasons ride in it too. `kind`
// is what distinguishes them in code.

import { buildMultipartMixed } from './mime-mixed.js';

/** The owner's fixed columns, around the derived cluster ones. */
const COLUMN_EMPLOYEE = 'עובד';
const COLUMN_EMAIL = 'אימייל';
const COLUMN_TOTAL = 'סה"כ';
const COLUMN_OUTCOME = 'סטטוס';
const COLUMN_ERROR = 'שגיאה';

/** The three values `סטטוס` may hold — coarse enough to filter on in Excel. */
const OUTCOME_SENT = 'נשלח';
const OUTCOME_SKIPPED = 'דולג';
const OUTCOME_FAILED = 'נכשל';

/** Hebrew wording for a users-board row that never became a recipient. */
const SKIP_REASONS = {
  no_email: 'דולג: אין אימייל בשורה',
  no_person: 'דולג: אין עובד משויך',
  multi_person: 'דולג: יותר מעובד אחד בשורה',
  // The recipient label gate (round348 §E) blocked this row — the ONLY
  // non-error skip reason that is a deliberate opt-out rather than a data
  // problem, so the file states it in those terms.
  not_labeled: 'דולג: לא מסומן לקבלת מייל',
};

/** A filename parameter must survive a MIME header — and not be a path. */
const SAFE_SLOT_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Leading characters Excel and Sheets treat as the start of a formula. A board
 * value can carry one (a task list is user input), and the file is opened on
 * the operator's own machine, so the value is neutralized with a leading
 * apostrophe rather than shipped executable. CSV injection is cheap to prevent
 * and impossible to fix after the fact.
 */
const FORMULA_LEAD_RE = /^[=+\-@\t\r]/;

/** Fields that force RFC4180 quoting. */
const CSV_MUST_QUOTE_RE = /[",\r\n]/;

/**
 * The UTF-8 byte-order mark, written as an escape rather than a literal: an
 * invisible character in source is a lint error (`no-irregular-whitespace`) and
 * a thing a future reader deletes as a typo. It is the whole reason Excel opens
 * the Hebrew columns as Hebrew.
 */
const UTF8_BOM = '\uFEFF';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * One CSV field: formula-neutralized, then RFC4180-quoted when it has to be.
 * @param {unknown} value
 * @returns {string}
 */
function csvField(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_LEAD_RE.test(text)) text = `'${text}`;
  if (!CSV_MUST_QUOTE_RE.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * `kind` -> { outcome, note(row) }, the ONE place that maps a row kind to both
 * CSV columns — so a new kind can never update the free-text detail and forget
 * the coarse outcome bucket, or the reverse.
 */
const KIND_META = {
  sent: { outcome: OUTCOME_SENT, note: () => '' },
  failed: {
    outcome: OUTCOME_FAILED,
    // The transport's own message IS the diagnosis (same contract as the
    // smtp-sender seam) — never a generic "failed".
    note: (row) => String(row.error ?? 'שליחה נכשלה'),
  },
  already_sent: { outcome: OUTCOME_SKIPPED, note: () => 'כבר נשלח בסלוט הזה' },
  no_tasks: { outcome: OUTCOME_SKIPPED, note: () => 'אין משימות פתוחות' },
  skipped: {
    outcome: OUTCOME_SKIPPED,
    // An unknown reason is still named: a blank cell would read as "sent".
    note: (row) => SKIP_REASONS[row.reason] ?? `דולג: ${row.reason ?? 'לא ידוע'}`,
  },
};

/**
 * The two CSV columns (`סטטוס`, `שגיאה`) for one row.
 * @param {{ kind: string, error?: string, reason?: string }} row
 * @returns {{ outcome: string, note: string }}
 */
function rowMeta(row) {
  const meta = KIND_META[row.kind];
  if (!meta) {
    // A row whose kind is unrecognized has probably lost its counts too, and
    // a report that quietly reads as "0 tasks, all fine" is worse than a
    // logged failure. The scheduler catches this and logs it.
    throw fail('unknown_summary_row_kind', `unknown summary row kind: ${row.kind}`);
  }
  return { outcome: meta.outcome, note: meta.note(row) };
}

/**
 * Build the CSV text — BOM-prefixed, CRLF-separated (RFC4180).
 * @param {object} p
 * @param {Array<{ id: string, title: string }>} p.sections - cluster columns, in config order
 * @param {Array<{ name?: string, email?: string, kind: string, counts?: Record<string, number>,
 *                 total?: number, error?: string, reason?: string }>} p.rows - one per employee
 * @returns {string}
 */
export function buildDigestSummaryCsv({ sections, rows }) {
  const cols = Array.isArray(sections) ? sections : [];
  const header = [
    COLUMN_EMPLOYEE,
    COLUMN_EMAIL,
    ...cols.map((s) => s.title ?? ''),
    COLUMN_TOTAL,
    COLUMN_OUTCOME,
    COLUMN_ERROR,
  ];
  const lines = [header.map(csvField).join(',')];
  for (const row of rows ?? []) {
    const { outcome, note } = rowMeta(row);
    const counts = row.counts ?? {};
    lines.push(
      [
        csvField(row.name),
        csvField(row.email),
        // Absent cluster → 0, never blank: blank and zero look identical to a
        // reader and only one of them is true.
        ...cols.map((s) => String(counts[s.id] ?? 0)),
        String(row.total ?? 0),
        csvField(outcome),
        csvField(note),
      ].join(',')
    );
  }
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

/**
 * Compose the whole report message: subject, plain body, and a multipart/mixed
 * MIME body carrying the CSV as an attachment.
 * @param {object} p
 * @param {string} p.slot - YYYYMMDD (also the filename)
 * @param {string} p.accountId
 * @param {Array<{ id: string, title: string }>} p.sections
 * @param {Array<object>} p.rows
 * @returns {{ subject: string, plain: string, mime: { contentType: string, body: string }, filename: string }}
 */
export function buildDigestSummaryReport({ slot, accountId, sections, rows }) {
  if (typeof slot !== 'string' || !SAFE_SLOT_RE.test(slot)) {
    throw fail('invalid_summary_slot', `summary slot is unusable as a filename: ${String(slot)}`);
  }
  const filename = `digest-summary-${slot}.csv`;
  const csv = buildDigestSummaryCsv({ sections, rows });

  const tally = (kind) => (rows ?? []).filter((r) => r.kind === kind).length;
  const plain = [
    'deadline-confirm — דוח שליחה פר עובד',
    `slot: ${slot}`,
    `חשבון: ${accountId}`,
    '',
    `נשלחו: ${tally('sent')}`,
    `נכשלו: ${tally('failed')}`,
    `כבר נשלחו בסלוט: ${tally('already_sent')}`,
    `בלי משימות: ${tally('no_tasks')}`,
    `שורות שדולגו: ${tally('skipped')}`,
    '',
    'הקובץ המצורף מפרט שורה לכל עובד, כולל מי שלא נשלח לו.',
  ].join('\n');

  return {
    subject: `deadline-confirm — דוח שליחה ${slot}`,
    plain,
    filename,
    mime: buildMultipartMixed({
      plain,
      attachments: [{ filename, contentType: 'text/csv; charset=UTF-8', content: csv }],
    }),
  };
}

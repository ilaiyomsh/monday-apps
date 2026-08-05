// TDD — the per-employee send summary the cron mails to the sending mailbox
// (owner decision 2026-08-05, docs/scheduling.md §5.2).
//
// Four properties come straight from the decision and none of them is
// negotiable in the implementation:
//
//  1. **UTF-8 BOM.** Without it Excel reads the file in the local ANSI codepage
//     and every Hebrew name opens as mojibake. The bytes are the deliverable
//     here, so the BOM is asserted as the first CODE UNIT, not "somewhere in
//     the string".
//  2. **The cluster columns are DERIVED from config.digest.sections, in order.**
//     Section order is also priority order (owner, 2026-08-04), so a file whose
//     columns are hard-coded would silently stop matching the settings the day
//     a cluster is added, renamed or reordered — and the counts would land under
//     the wrong heading, which is worse than missing them.
//  3. **A row per employee, including everyone who got nothing.** 0 tasks,
//     already sent in this slot, or a users-board row that could not be
//     resolved at all: an absent row is information that vanished, so the
//     reason rides in the last column instead.
//  4. **`סה"כ` carries a double quote**, which is exactly the character RFC4180
//     quoting exists for. It is asserted literally (`"סה""כ"`) because a
//     builder that emits it raw produces a file Excel parses one column short.

import { describe, it, expect } from 'vitest';
import {
  buildDigestSummaryCsv,
  buildDigestSummaryReport,
} from '../src/helpers/digest-summary-report.js';

const SECTIONS = [
  { id: 's_start', title: 'להתחיל:' },
  { id: 's_finish', title: 'לסיים:' },
];

/** A sent row with 2 + 1 tasks. */
const DANA = {
  name: 'דנה',
  email: 'dana@example.com',
  kind: 'sent',
  counts: { s_start: 2, s_finish: 1 },
  total: 3,
};

function csvLines(csv) {
  return csv.replace(/^\uFEFF/, '').split('\r\n');
}

describe('buildDigestSummaryCsv — bytes Excel can open', () => {
  it('starts with the UTF-8 BOM, so Excel does not read Hebrew as mojibake', () => {
    const csv = buildDigestSummaryCsv({ sections: SECTIONS, rows: [DANA] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).startsWith('עובד,')).toBe(true);
  });

  it('separates records with CRLF (RFC4180) and ends with one', () => {
    const csv = buildDigestSummaryCsv({ sections: SECTIONS, rows: [DANA] });
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(/(?<!\r)\n/.test(csv)).toBe(false);
  });

  it('quotes סה"כ as "סה""כ" — a raw quote would shift every later column', () => {
    const csv = buildDigestSummaryCsv({ sections: SECTIONS, rows: [DANA] });
    expect(csvLines(csv)[0]).toBe('עובד,אימייל,להתחיל:,לסיים:,"סה""כ",שגיאה');
  });
});

describe('buildDigestSummaryCsv — columns follow the configured clusters', () => {
  it('emits one column per section, in configuration (= priority) order', () => {
    const csv = buildDigestSummaryCsv({
      sections: [
        { id: 'b', title: 'שני' },
        { id: 'a', title: 'ראשון' },
      ],
      rows: [{ ...DANA, counts: { a: 5, b: 7 }, total: 12 }],
    });
    const [header, row] = csvLines(csv);
    expect(header).toBe('עובד,אימייל,שני,ראשון,"סה""כ",שגיאה');
    // 7 belongs under 'שני' because section b is listed first — not 5.
    expect(row).toBe('דנה,dana@example.com,7,5,12,');
  });

  it('writes 0 for a cluster the employee has no task in', () => {
    const csv = buildDigestSummaryCsv({
      sections: SECTIONS,
      rows: [{ ...DANA, counts: { s_finish: 4 }, total: 4 }],
    });
    expect(csvLines(csv)[1]).toBe('דנה,dana@example.com,0,4,4,');
  });

  it('carries no cluster columns at all when no section is configured', () => {
    const csv = buildDigestSummaryCsv({
      sections: [],
      rows: [{ ...DANA, counts: {}, total: 0 }],
    });
    expect(csvLines(csv)[0]).toBe('עובד,אימייל,"סה""כ",שגיאה');
    expect(csvLines(csv)[1]).toBe('דנה,dana@example.com,0,');
  });

  it('keeps two clusters that share a title as two separate columns', () => {
    const csv = buildDigestSummaryCsv({
      sections: [
        { id: 'x', title: 'לטפל:' },
        { id: 'y', title: 'לטפל:' },
      ],
      rows: [{ ...DANA, counts: { x: 1, y: 2 }, total: 3 }],
    });
    expect(csvLines(csv)[0]).toBe('עובד,אימייל,לטפל:,לטפל:,"סה""כ",שגיאה');
    expect(csvLines(csv)[1]).toBe('דנה,dana@example.com,1,2,3,');
  });
});

describe('buildDigestSummaryCsv — a row for every employee', () => {
  it('leaves the last column empty for a successful send', () => {
    const csv = buildDigestSummaryCsv({ sections: SECTIONS, rows: [DANA] });
    expect(csvLines(csv)[1]).toBe('דנה,dana@example.com,2,1,3,');
  });

  it('reports a failed send with the transport’s own message', () => {
    const csv = buildDigestSummaryCsv({
      sections: SECTIONS,
      rows: [{ ...DANA, kind: 'failed', error: 'smtp auth failed: 535' }],
    });
    expect(csvLines(csv)[1]).toBe('דנה,dana@example.com,2,1,3,smtp auth failed: 535');
  });

  it('names an already-sent slot instead of dropping the row', () => {
    const csv = buildDigestSummaryCsv({
      sections: SECTIONS,
      rows: [{ ...DANA, kind: 'already_sent' }],
    });
    expect(csvLines(csv)[1]).toBe('דנה,dana@example.com,2,1,3,כבר נשלח בסלוט הזה');
  });

  it('keeps an employee with zero pending tasks, with a stated reason', () => {
    const csv = buildDigestSummaryCsv({
      sections: SECTIONS,
      rows: [{ name: 'רון', email: 'ron@example.com', kind: 'no_tasks', counts: {}, total: 0 }],
    });
    expect(csvLines(csv)[1]).toBe('רון,ron@example.com,0,0,0,אין משימות פתוחות');
  });

  it('states each users-board skip reason in Hebrew, one row each', () => {
    const csv = buildDigestSummaryCsv({
      sections: SECTIONS,
      rows: [
        { name: 'א', email: '', kind: 'skipped', reason: 'no_email', counts: {}, total: 0 },
        { name: 'ב', email: '', kind: 'skipped', reason: 'no_person', counts: {}, total: 0 },
        { name: 'ג', email: '', kind: 'skipped', reason: 'multi_person', counts: {}, total: 0 },
      ],
    });
    const rows = csvLines(csv);
    expect(rows[1]).toBe('א,,0,0,0,דולג: אין אימייל בשורה');
    expect(rows[2]).toBe('ב,,0,0,0,דולג: אין עובד משויך');
    expect(rows[3]).toBe('ג,,0,0,0,דולג: יותר מעובד אחד בשורה');
  });

  it('names an unknown skip reason rather than emitting a blank cell', () => {
    const csv = buildDigestSummaryCsv({
      sections: [],
      rows: [{ name: 'א', email: '', kind: 'skipped', reason: 'brand_new', counts: {}, total: 0 }],
    });
    expect(csvLines(csv)[1]).toBe('א,,0,דולג: brand_new');
  });

  it('refuses a row whose kind it does not recognize — silent 0s would read as fine', () => {
    expect(() =>
      buildDigestSummaryCsv({ sections: SECTIONS, rows: [{ ...DANA, kind: 'maybe' }] })
    ).toThrow(/maybe/);
    try {
      buildDigestSummaryCsv({ sections: SECTIONS, rows: [{ ...DANA, kind: 'maybe' }] });
    } catch (err) {
      expect(err.code).toBe('unknown_summary_row_kind');
    }
  });

  it('emits a header-only file when nobody is on the users board', () => {
    const csv = buildDigestSummaryCsv({ sections: SECTIONS, rows: [] });
    expect(csvLines(csv)).toEqual(['עובד,אימייל,להתחיל:,לסיים:,"סה""כ",שגיאה', '']);
  });
});

describe('buildDigestSummaryCsv — field escaping', () => {
  it('quotes and doubles a value carrying a comma or a quote', () => {
    const csv = buildDigestSummaryCsv({
      sections: [{ id: 'a', title: 'עם, פסיק' }],
      rows: [
        {
          name: 'כהן, דנה',
          email: 'd@example.com',
          kind: 'failed',
          counts: { a: 1 },
          total: 1,
          error: 'said "no"',
        },
      ],
    });
    const [header, row] = csvLines(csv);
    expect(header).toBe('עובד,אימייל,"עם, פסיק","סה""כ",שגיאה');
    expect(row).toBe('"כהן, דנה",d@example.com,1,1,"said ""no"""');
  });

  it('keeps a CRLF inside a value inside its quoted field', () => {
    const csv = buildDigestSummaryCsv({
      sections: [],
      rows: [{ ...DANA, kind: 'failed', counts: {}, total: 0, error: 'line1\r\nline2' }],
    });
    expect(csv).toContain('"line1\r\nline2"');
    // The header plus ONE record that happens to span two physical lines.
    expect(csvLines(csv)).toHaveLength(4);
  });

  it('neutralizes a value Excel would evaluate as a formula', () => {
    const csv = buildDigestSummaryCsv({
      sections: [],
      rows: [
        { ...DANA, name: '=1+1', counts: {}, total: 0 },
        { ...DANA, name: '+HYPERLINK("x")', counts: {}, total: 0 },
        { ...DANA, name: '-2+3', counts: {}, total: 0 },
        { ...DANA, name: '@SUM(A1)', counts: {}, total: 0 },
      ],
    });
    const rows = csvLines(csv);
    expect(rows[1].startsWith("'=1+1,")).toBe(true);
    expect(rows[2].startsWith('"\'+HYPERLINK(""x"")"')).toBe(true);
    expect(rows[3].startsWith("'-2+3,")).toBe(true);
    expect(rows[4].startsWith("'@SUM(A1),")).toBe(true);
  });

  it('leaves an ordinary name untouched — the guard must not tax normal rows', () => {
    const csv = buildDigestSummaryCsv({ sections: [], rows: [{ ...DANA, counts: {}, total: 3 }] });
    expect(csvLines(csv)[1]).toBe('דנה,dana@example.com,3,');
  });

  it('renders a missing name or email as an empty field, never "undefined"', () => {
    const csv = buildDigestSummaryCsv({
      sections: [],
      rows: [{ kind: 'no_tasks', counts: {}, total: 0 }],
    });
    expect(csvLines(csv)[1]).toBe(',,0,אין משימות פתוחות');
  });
});

describe('buildDigestSummaryReport — the message that carries the file', () => {
  const report = () =>
    buildDigestSummaryReport({
      slot: '20260805',
      accountId: '777',
      sections: SECTIONS,
      rows: [
        DANA,
        { ...DANA, name: 'רון', email: 'ron@example.com', kind: 'failed', error: 'smtp rejected' },
        { ...DANA, name: 'נועה', email: 'noa@example.com', kind: 'already_sent' },
        { name: 'תמר', email: 't@example.com', kind: 'no_tasks', counts: {}, total: 0 },
        { name: 'שי', email: '', kind: 'skipped', reason: 'no_email', counts: {}, total: 0 },
      ],
    });

  it('names the file after the slot, with an ASCII-only filename', () => {
    expect(report().filename).toBe('digest-summary-20260805.csv');
  });

  it('puts the slot in the subject so two runs never look alike', () => {
    expect(report().subject).toContain('20260805');
  });

  it('counts every outcome in the plain body, from the rows themselves', () => {
    const { plain } = report();
    expect(plain).toContain('slot: 20260805');
    expect(plain).toContain('חשבון: 777');
    expect(plain).toContain('נשלחו: 1');
    expect(plain).toContain('נכשלו: 1');
    expect(plain).toContain('כבר נשלחו בסלוט: 1');
    expect(plain).toContain('בלי משימות: 1');
    expect(plain).toContain('שורות שדולגו: 1');
  });

  it('never leaks task content into the body — counts and addresses only', () => {
    const { plain } = report();
    expect(plain).not.toContain('להתחיל:');
    expect(plain).not.toContain('itemId');
  });

  it('attaches the CSV as text/csv, base64, with the BOM intact after decoding', () => {
    const { mime, filename } = report();
    expect(mime.contentType).toMatch(/^multipart\/mixed; boundary="dcm_/);
    expect(mime.body).toContain(`Content-Disposition: attachment; filename="${filename}"`);
    expect(mime.body).toContain('Content-Type: text/csv; charset=UTF-8;');
    const section = mime.body.split(/--dcm_[0-9a-f]+/).find((s) => s.includes('text/csv'));
    const payload = section.slice(section.indexOf('\r\n\r\n') + 4).trim();
    const decoded = Buffer.from(payload.replaceAll('\r\n', ''), 'base64').toString('utf8');
    expect(decoded.charCodeAt(0)).toBe(0xfeff);
    expect(decoded).toContain('dana@example.com');
    expect(decoded).toContain('שי');
  });

  it('refuses a slot that would not survive as a filename parameter', () => {
    for (const slot of ['', undefined, 'a"b', '2026/08/05', '..']) {
      try {
        buildDigestSummaryReport({ slot, accountId: '777', sections: [], rows: [] });
        throw new Error(`should have thrown for ${JSON.stringify(slot)}`);
      } catch (err) {
        expect(err.code).toBe('invalid_summary_slot');
      }
    }
  });
});

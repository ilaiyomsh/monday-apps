/**
 * roleTypes — the settings panel's opinion about which board column fits which
 * of the five roles, and what the four table headers resolve to.
 *
 * What is worth pinning here:
 *   - the filter is SOFT. A wrong-typed pick must produce a WARNING and still be
 *     selectable, because monday boards carry types this app has never seen
 *     (formula-as-date, lookup-as-mirror) and a hard block would strand the owner.
 *   - `action` has NO type opinion at all — every column is a first-class option.
 *   - header resolution precedence: an explicit override beats the board column's
 *     title, and a blank/whitespace override is NOT an override.
 *
 * Column fixtures follow the shape `services/boardMeta.js` returns
 * ({id, title, type}), with the types a real board answers with — including the
 * `name` pseudo-column, which board meta always includes.
 */
import { describe, it, expect } from 'vitest';
import { COLUMN_ROLES, TABLE_ROLES } from '../../../domain/settingsSchema';
import {
  ROLE_META,
  roleMeta,
  partitionColumnsForRole,
  typeWarning,
  resolveHeader,
  columnLabel,
} from '../roleTypes';

/** A realistic target board: one usable column per role plus decoys. */
const COLUMNS = [
  { id: 'name', title: 'שם', type: 'name' },
  { id: 'text_action', title: 'פעולה', type: 'text' },
  { id: 'mirror_committee', title: 'ועדה אזורית', type: 'mirror' },
  { id: 'long_report', title: 'תיאור הדיווח', type: 'long_text' },
  { id: 'date_report', title: 'תאריך', type: 'date' },
  { id: 'people_owner', title: 'אחראי', type: 'people' },
  { id: 'status_state', title: 'סטטוס', type: 'status' },
];

const byId = (id) => COLUMNS.find((c) => c.id === id);

describe('ROLE_META', () => {
  it('describes exactly the five schema roles, in the schema order', () => {
    expect(ROLE_META.map((entry) => entry.role)).toEqual(COLUMN_ROLES);
  });

  it('carries the Hebrew label the panel renders for each role', () => {
    expect(ROLE_META.map((entry) => entry.label)).toEqual([
      'פעולה',
      'שם הועדה האזורית',
      'דיווח',
      'תאריך דיווח',
      'עמודת האחראי',
    ]);
  });

  it('gives every role except action a non-empty preferred-type list', () => {
    expect(roleMeta('action').types).toBeNull();
    expect(roleMeta('committee').types).toEqual(['mirror', 'lookup']);
    expect(roleMeta('report').types).toEqual(['text', 'long_text']);
    expect(roleMeta('date').types).toEqual(['date']);
    expect(roleMeta('person').types).toEqual(['people', 'person', 'multiple_person']);
  });

  it('marks the four table roles as tableRole and person as not', () => {
    const tableRoles = ROLE_META.filter((entry) => entry.tableRole).map((entry) => entry.role);
    expect(tableRoles).toEqual(TABLE_ROLES);
    expect(roleMeta('person').tableRole).toBe(false);
  });

  it('returns undefined for a role that is not one of the five', () => {
    expect(roleMeta('committees')).toBeUndefined();
    expect(roleMeta('')).toBeUndefined();
    expect(roleMeta(undefined)).toBeUndefined();
  });
});

describe('partitionColumnsForRole', () => {
  it('puts only the matching types in preferred and everything else in other, keeping board order', () => {
    const { preferred, other } = partitionColumnsForRole(COLUMNS, 'report');
    expect(preferred.map((c) => c.id)).toEqual(['text_action', 'long_report']);
    expect(other.map((c) => c.id)).toEqual([
      'name',
      'mirror_committee',
      'date_report',
      'people_owner',
      'status_state',
    ]);
  });

  it('treats a mirror OR a lookup as preferred for committee', () => {
    const columns = [...COLUMNS, { id: 'lookup_x', title: 'שיקוף נוסף', type: 'lookup' }];
    const { preferred } = partitionColumnsForRole(columns, 'committee');
    expect(preferred.map((c) => c.id)).toEqual(['mirror_committee', 'lookup_x']);
  });

  it('prefers EVERY column for action, which has no type opinion', () => {
    const { preferred, other } = partitionColumnsForRole(COLUMNS, 'action');
    expect(preferred).toEqual(COLUMNS);
    expect(other).toEqual([]);
    // A COPY, not the caller's array: the panel sorts/renders this bucket, and
    // aliasing it would mutate the board column list every other role reads.
    expect(preferred).not.toBe(COLUMNS);
  });

  it('prefers every column for an unknown role too, rather than hiding the board', () => {
    const { preferred, other } = partitionColumnsForRole(COLUMNS, 'nope');
    expect(preferred).toEqual(COLUMNS);
    expect(other).toEqual([]);
    expect(preferred).not.toBe(COLUMNS);
  });

  it('returns two empty buckets when the board has no columns yet', () => {
    expect(partitionColumnsForRole([], 'date')).toEqual({ preferred: [], other: [] });
    expect(partitionColumnsForRole(undefined, 'date')).toEqual({ preferred: [], other: [] });
  });

  it('does not mutate or alias the input array', () => {
    const input = [...COLUMNS];
    const { preferred } = partitionColumnsForRole(input, 'date');
    expect(input).toEqual(COLUMNS);
    expect(preferred).not.toBe(input);
  });
});

describe('typeWarning', () => {
  it('names the actual type, the role and the expected types for a mismatched pick', () => {
    expect(typeWarning('date', byId('status_state'))).toBe(
      'העמודה "סטטוס" היא מסוג status — לתפקיד "תאריך דיווח" מתאימות עמודות מסוג date. ' +
        'ניתן להמשיך, אך ייתכן שהדוח יציג ערכים ריקים.'
    );
  });

  it('lists every expected type, slash-separated, for a role with several', () => {
    expect(typeWarning('committee', byId('date_report'))).toBe(
      'העמודה "תאריך" היא מסוג date — לתפקיד "שם הועדה האזורית" מתאימות עמודות מסוג mirror / lookup. ' +
        'ניתן להמשיך, אך ייתכן שהדוח יציג ערכים ריקים.'
    );
  });

  it('is silent for a matching pick', () => {
    expect(typeWarning('date', byId('date_report'))).toBe('');
    expect(typeWarning('report', byId('long_report'))).toBe('');
    expect(typeWarning('person', byId('people_owner'))).toBe('');
    expect(typeWarning('committee', byId('mirror_committee'))).toBe('');
  });

  it('is silent for action, whatever the column type is', () => {
    expect(typeWarning('action', byId('status_state'))).toBe('');
    expect(typeWarning('action', byId('name'))).toBe('');
  });

  it('is silent when nothing is mapped yet', () => {
    expect(typeWarning('date', null)).toBe('');
    expect(typeWarning('date', undefined)).toBe('');
  });

  it('is silent for an unknown role instead of inventing an expectation', () => {
    expect(typeWarning('nope', byId('status_state'))).toBe('');
  });

  it('falls back to the column id when the column has no title', () => {
    expect(typeWarning('date', { id: 'text9', title: '', type: 'text' })).toBe(
      'העמודה "text9" היא מסוג text — לתפקיד "תאריך דיווח" מתאימות עמודות מסוג date. ' +
        'ניתן להמשיך, אך ייתכן שהדוח יציג ערכים ריקים.'
    );
  });
});

describe('resolveHeader', () => {
  // BOTH sources present and DIFFERENT, so the precedence is actually pinned.
  const settings = {
    columns: { action: 'text_action', committee: 'mirror_committee', report: 'long_report', date: 'date_report' },
    headers: { action: 'פעולה שבוצעה', committee: '', report: '   ', date: '' },
  };

  it('prefers a non-empty override over the board column title', () => {
    expect(resolveHeader(settings, 'action', COLUMNS)).toBe('פעולה שבוצעה');
  });

  it('falls back to the mapped board column title when the override is empty', () => {
    expect(resolveHeader(settings, 'committee', COLUMNS)).toBe('ועדה אזורית');
    expect(resolveHeader(settings, 'date', COLUMNS)).toBe('תאריך');
  });

  it('treats a whitespace-only override as no override', () => {
    expect(resolveHeader(settings, 'report', COLUMNS)).toBe('תיאור הדיווח');
  });

  it('trims a real override rather than passing the padding through', () => {
    const padded = { ...settings, headers: { ...settings.headers, date: '  תאריך דיווח  ' } };
    expect(resolveHeader(padded, 'date', COLUMNS)).toBe('תאריך דיווח');
  });

  it('is empty when nothing is mapped and nothing is overridden', () => {
    expect(resolveHeader({ columns: {}, headers: {} }, 'date', COLUMNS)).toBe('');
  });

  it('is empty when the mapped column no longer exists on the board', () => {
    const stale = { columns: { date: 'date_deleted' }, headers: {} };
    expect(resolveHeader(stale, 'date', COLUMNS)).toBe('');
  });

  it('survives a missing settings blob and a missing column list', () => {
    expect(resolveHeader(undefined, 'date', COLUMNS)).toBe('');
    expect(resolveHeader(settings, 'date', undefined)).toBe('');
  });
});

describe('columnLabel', () => {
  it('shows the title with the monday type in parentheses', () => {
    expect(columnLabel(byId('mirror_committee'))).toBe('ועדה אזורית (mirror)');
  });

  it('falls back to the column id when there is no title', () => {
    expect(columnLabel({ id: 'text9', title: '', type: 'text' })).toBe('text9 (text)');
  });

  it('is empty for no column at all', () => {
    expect(columnLabel(null)).toBe('');
    expect(columnLabel(undefined)).toBe('');
  });
});

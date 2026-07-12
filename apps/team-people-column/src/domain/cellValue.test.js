import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCellValue, formatCellValue } from './cellValue.js';
import logger from '../utils/logger.js';
import readbackCapture from '../test-utils/probes/UpdateColumnValueReadback.json';

// The native people-column `value` string monday returns/accepts has the shape
// `{"personsAndTeams":[{"id":<int>,"kind":"person"}]}`. We derive it from the
// REAL readback capture's persons_and_teams (person 48274917 "עילי שלם") rather
// than hand-authoring ids — the capture is the single source of truth.
const readbackPersonsAndTeams =
  readbackCapture.data.items[0].column_values[0].persons_and_teams;
const readbackValueString = JSON.stringify({ personsAndTeams: readbackPersonsAndTeams });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseCellValue', () => {
  it('extracts the person entry (id as string) from the captured readback value string', () => {
    expect(parseCellValue(readbackValueString)).toEqual([
      { id: '48274917', kind: 'person' },
    ]);
  });

  it('coerces a numeric people-value id to a string id', () => {
    const raw = JSON.stringify({ personsAndTeams: [{ id: 48274917, kind: 'person' }] });
    const result = parseCellValue(raw);
    expect(result).toEqual([{ id: '48274917', kind: 'person' }]);
    expect(typeof result[0].id).toBe('string');
  });

  it('returns an empty array for a null rawValue', () => {
    expect(parseCellValue(null)).toEqual([]);
  });

  it('returns an empty array for an undefined rawValue', () => {
    expect(parseCellValue(undefined)).toEqual([]);
  });

  it('returns an empty array for an empty-string rawValue', () => {
    expect(parseCellValue('')).toEqual([]);
  });

  it('returns an empty array for an empty people value (no persons selected)', () => {
    expect(parseCellValue(JSON.stringify({ personsAndTeams: [] }))).toEqual([]);
  });

  it('returns an empty array AND warns via logger on corrupt JSON', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const result = parseCellValue('{not valid json');
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves multiple persons in order, coercing every id to a string', () => {
    const raw = JSON.stringify({
      personsAndTeams: [
        { id: 48274917, kind: 'person' },
        { id: 96863017, kind: 'person' },
      ],
    });
    expect(parseCellValue(raw)).toEqual([
      { id: '48274917', kind: 'person' },
      { id: '96863017', kind: 'person' },
    ]);
  });
});

describe('formatCellValue', () => {
  it('wraps the selection in personsAndTeams with an INTEGER id and person kind', () => {
    const result = formatCellValue([{ id: '48274917' }]);
    expect(result).toEqual({ personsAndTeams: [{ id: 48274917, kind: 'person' }] });
    expect(Number.isInteger(result.personsAndTeams[0].id)).toBe(true);
  });

  it('produces an empty personsAndTeams for an empty selection', () => {
    expect(formatCellValue([])).toEqual({ personsAndTeams: [] });
  });

  it('preserves a team entry\'s kind so a pre-existing team assignment is not rewritten as a person', () => {
    // A team can be assigned to a people column from other monday surfaces. It
    // must round-trip back as a team (id integer at this seam, kind kept), NOT
    // be silently re-typed to kind:"person" — that would corrupt the cell with a
    // team id posing as a person.
    const result = formatCellValue([{ id: '1348990', kind: 'team' }]);
    expect(result).toEqual({ personsAndTeams: [{ id: 1348990, kind: 'team' }] });
  });

  it('defaults kind to "person" only when the entry has no kind', () => {
    expect(formatCellValue([{ id: '48274917' }])).toEqual({
      personsAndTeams: [{ id: 48274917, kind: 'person' }],
    });
  });

  it('round-trips through JSON, preserving ids as STRINGS after parse', () => {
    const selection = [{ id: '48274917' }, { id: '96863017' }];
    const roundTripped = parseCellValue(JSON.stringify(formatCellValue(selection)));
    expect(roundTripped).toEqual([
      { id: '48274917', kind: 'person' },
      { id: '96863017', kind: 'person' },
    ]);
    expect(typeof roundTripped[0].id).toBe('string');
    expect(typeof roundTripped[1].id).toBe('string');
  });
});

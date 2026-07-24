// The error-detail drill-down query builder + its APL string escaping. The
// err_name arrives from a client query param, so it is UNTRUSTED — escapeApl
// must keep it inside the single-quoted APL literal (injection defense), and
// the query must filter to error kind + the exact name, newest first, capped,
// with NO projection (so the detail view gets every field Axiom holds).

import { describe, it, expect } from 'vitest';
import { buildErrorDetailQuery, escapeApl, ERROR_DETAIL_LIMIT } from '../src/server/queries.js';

describe('escapeApl', () => {
  it("escapes single quotes so a value cannot break out of the APL literal", () => {
    expect(escapeApl("it's")).toBe("it\\'s");
  });

  it('escapes backslashes (before quotes, so there is no double-unescape)', () => {
    expect(escapeApl('a\\b')).toBe('a\\\\b');
  });

  it('leaves a plain value untouched', () => {
    expect(escapeApl('TimeoutError')).toBe('TimeoutError');
  });
});

describe('buildErrorDetailQuery', () => {
  it('scopes to the dataset + shared time window', () => {
    const apl = buildErrorDetailQuery('app-errors', 'TimeoutError');
    expect(apl).toContain("['app-errors']");
    expect(apl).toContain('_time between (_startTime .. _endTime)');
  });

  it('filters to error kind + the exact err_name, newest first, capped at the limit', () => {
    const apl = buildErrorDetailQuery('app-errors', 'TimeoutError');
    expect(apl).toContain("kind=='error'");
    expect(apl).toContain("err_name=='TimeoutError'");
    expect(apl).toContain('sort by _time desc');
    expect(apl).toContain(`take ${ERROR_DETAIL_LIMIT}`);
  });

  it('does NOT project — the detail view needs every field the record carries', () => {
    expect(buildErrorDetailQuery('app-errors', 'X')).not.toContain('project');
  });

  it('neutralizes an APL-injection attempt in err_name', () => {
    const apl = buildErrorDetailQuery('app-errors', "x' | where 1==1 //");
    // the injected quote is escaped, so the whole payload stays inside the literal
    expect(apl).toContain("err_name=='x\\' | where 1==1 //'");
    // and exactly one take clause survives — no injected pipeline became APL
    expect(apl.match(/take /g)).toHaveLength(1);
  });

  it('accepts a custom limit', () => {
    expect(buildErrorDetailQuery('d', 'X', 5)).toContain('take 5');
  });
});

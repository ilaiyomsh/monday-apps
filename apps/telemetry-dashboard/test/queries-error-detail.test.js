// The error-name derivation (ERR_NAME_EXPR) + the top_errors and drill-down
// queries that share it. err_name reaches the drill-down from a client query
// param, so it is UNTRUSTED — escapeApl must keep it inside the single-quoted
// APL literal (injection defense). top_errors and the drill-down MUST derive
// the row name the same way, so a row and its details always mean the same set
// (including rows named by their message when err_name is absent).

import { describe, it, expect } from 'vitest';
import {
  buildQueries,
  buildErrorDetailQuery,
  escapeApl,
  ERR_NAME_EXPR,
  ERROR_DETAIL_LIMIT,
} from '../src/server/queries.js';

describe('escapeApl', () => {
  it('escapes single quotes so a value cannot break out of the APL literal', () => {
    expect(escapeApl("it's")).toBe("it\\'s");
  });
  it('escapes backslashes (before quotes, so there is no double-unescape)', () => {
    expect(escapeApl('a\\b')).toBe('a\\\\b');
  });
  it('leaves a plain value untouched', () => {
    expect(escapeApl('TimeoutError')).toBe('TimeoutError');
  });
});

describe('ERR_NAME_EXPR', () => {
  it('falls back err_name → err_msg → message → (unnamed)', () => {
    // order matters: earlier operands win
    const iName = ERR_NAME_EXPR.indexOf('err_name');
    const iMsg = ERR_NAME_EXPR.indexOf('err_msg');
    const iMessage = ERR_NAME_EXPR.indexOf('message');
    const iUnnamed = ERR_NAME_EXPR.indexOf("'(unnamed)'");
    expect(ERR_NAME_EXPR.startsWith('case(')).toBe(true);
    expect(iName).toBeGreaterThanOrEqual(0);
    expect(iName).toBeLessThan(iMsg);
    expect(iMsg).toBeLessThan(iMessage);
    expect(iMessage).toBeLessThan(iUnnamed);
  });
});

describe('buildQueries().top_errors', () => {
  const q = buildQueries('app-errors');

  it('no longer references the non-existent err_code column (the empty-table bug)', () => {
    expect(q.top_errors).not.toContain('err_code');
    expect(q.top_errors).not.toContain('any('); // any() is not an APL function
  });

  it('derives the row name via ERR_NAME_EXPR and groups by it + err_msg', () => {
    expect(q.top_errors).toContain("kind=='error'");
    expect(q.top_errors).toContain(`extend __name=${ERR_NAME_EXPR}`);
    expect(q.top_errors).toContain('by __name, err_msg');
    expect(q.top_errors).toContain('project err_name=__name');
    expect(q.top_errors).toContain('take 20');
  });
});

describe('buildErrorDetailQuery', () => {
  it('scopes to the dataset + shared time window + error kind', () => {
    const apl = buildErrorDetailQuery('app-errors', 'TimeoutError');
    expect(apl).toContain("['app-errors']");
    expect(apl).toContain('_time between (_startTime .. _endTime)');
    expect(apl).toContain("kind=='error'");
  });

  it('matches on the SAME derived name as top_errors, newest first, capped', () => {
    const apl = buildErrorDetailQuery('app-errors', 'TimeoutError');
    expect(apl).toContain(`extend __name=${ERR_NAME_EXPR}`);
    expect(apl).toContain("__name=='TimeoutError'");
    expect(apl).toContain('sort by _time desc');
    expect(apl).toContain(`take ${ERROR_DETAIL_LIMIT}`);
  });

  it('drops ONLY the synthetic __name helper — the real fields are returned in full', () => {
    const apl = buildErrorDetailQuery('app-errors', 'X');
    // project-away removes just the helper column; no field projection of the record
    expect(apl).toContain('project-away __name');
    expect(apl).not.toContain('project err_name'); // that's top_errors, not the detail
  });

  it('neutralizes an APL-injection attempt in the name', () => {
    const apl = buildErrorDetailQuery('app-errors', "x' | where 1==1 //");
    expect(apl).toContain("__name=='x\\' | where 1==1 //'");
    expect(apl.match(/take /g)).toHaveLength(1); // no injected pipeline survived as APL
  });

  it('accepts a custom limit', () => {
    expect(buildErrorDetailQuery('d', 'X', 5)).toContain('take 5');
  });
});

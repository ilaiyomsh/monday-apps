// Unit-level smoke test for the pure conditional evaluator.
// No HTTP, no server. Runs in-process.
//
//   node tests/run.js conditional-evaluator-unit

import { evaluateConditionals, buildEventContext } from '../../src/services/conditional-evaluator.js';
import { assertEq, assert, assertionSummary } from '../lib/assert.js';

function mkEvent({ title = '', description = '', location = '', attendees = [] } = {}) {
  return { summary: title, description, location, attendees };
}

function mkCond({ id = 'c1', name = 'c1', operator = 'AND', predicates = [], values = {} } = {}) {
  return { id, name, operator, predicates, values };
}

export async function run() {
  console.log('▶ Scenario: conditional-evaluator-unit');

  // 1) empty list → null
  {
    const ctx = buildEventContext(mkEvent());
    assertEq(evaluateConditionals([], ctx), null, 'empty list returns null');
    assertEq(evaluateConditionals(null, ctx), null, 'null list returns null');
  }

  // 2) AND all match
  {
    const ctx = buildEventContext(mkEvent({
      title: 'Project A sync',
      location: 'Zoom call',
      attendees: [{ email: 'alice@jordan-lima.com' }],
    }));
    const c = mkCond({
      id: 'proj-a',
      predicates: [
        { field: 'attendee_email', op: 'domain', value: 'jordan-lima.com' },
        { field: 'event_title', op: 'contains', value: 'Project A' },
        { field: 'location', op: 'contains', value: 'zoom' },
      ],
      values: { status_col: { type: 'status', value: { index: 1 } } },
    });
    const r = evaluateConditionals([c], ctx);
    assertEq(r && r.id, 'proj-a', 'AND all match → wins');
  }

  // 3) AND one fails
  {
    const ctx = buildEventContext(mkEvent({
      title: 'Project A',
      attendees: [{ email: 'alice@other.com' }],
    }));
    const c = mkCond({
      predicates: [
        { field: 'attendee_email', op: 'domain', value: 'jordan-lima.com' },
        { field: 'event_title', op: 'contains', value: 'Project A' },
      ],
    });
    assertEq(evaluateConditionals([c], ctx), null, 'AND one-fails → null');
  }

  // 4) OR any match
  {
    const ctx = buildEventContext(mkEvent({ title: 'Internal sync' }));
    const c = mkCond({
      id: 'or-match',
      operator: 'OR',
      predicates: [
        { field: 'attendee_email', op: 'domain', value: 'jordan-lima.com' },
        { field: 'event_title', op: 'contains', value: 'internal' },
      ],
    });
    const r = evaluateConditionals([c], ctx);
    assertEq(r && r.id, 'or-match', 'OR any-match → wins');
  }

  // 5) OR none match
  {
    const ctx = buildEventContext(mkEvent({ title: 'quarterly review' }));
    const c = mkCond({
      operator: 'OR',
      predicates: [
        { field: 'event_title', op: 'contains', value: 'standup' },
        { field: 'location', op: 'contains', value: 'zoom' },
      ],
    });
    assertEq(evaluateConditionals([c], ctx), null, 'OR none-match → null');
  }

  // 6) first-match wins with two overlapping conditionals
  {
    const ctx = buildEventContext(mkEvent({ title: 'Client call — Project A' }));
    const c1 = mkCond({
      id: 'first',
      predicates: [{ field: 'event_title', op: 'contains', value: 'Client' }],
      values: { s: { type: 'status', value: { index: 0 } } },
    });
    const c2 = mkCond({
      id: 'second',
      predicates: [{ field: 'event_title', op: 'contains', value: 'Project A' }],
      values: { s: { type: 'status', value: { index: 1 } } },
    });
    const r = evaluateConditionals([c1, c2], ctx);
    assertEq(r && r.id, 'first', 'first-match wins');
  }

  // 7) regex valid + invalid
  {
    const ctx = buildEventContext(mkEvent({ title: 'Q1-2026 review' }));
    const good = mkCond({
      predicates: [{ field: 'event_title', op: 'regex', value: '^Q\\d' }],
    });
    assert(!!evaluateConditionals([good], ctx), 'valid regex matches');

    const bad = mkCond({
      predicates: [{ field: 'event_title', op: 'regex', value: '[unclosed' }],
    });
    assertEq(evaluateConditionals([bad], ctx), null, 'invalid regex yields no match (safe)');
  }

  // 8) no attendees, attendee predicate → fails safely
  {
    const ctx = buildEventContext(mkEvent({ title: 'solo block' }));
    const c = mkCond({
      predicates: [{ field: 'attendee_email', op: 'domain', value: 'anywhere.com' }],
    });
    assertEq(evaluateConditionals([c], ctx), null, 'no attendees → predicate fails gracefully');
  }

  // 9) email equals, case-insensitive
  {
    const ctx = buildEventContext(mkEvent({
      attendees: [{ email: 'Alice@JORDAN-LIMA.COM' }],
    }));
    const c = mkCond({
      predicates: [{ field: 'attendee_email', op: 'equals', value: 'alice@jordan-lima.com' }],
    });
    assert(!!evaluateConditionals([c], ctx), 'email equals is case-insensitive');
  }

  // 10) empty predicates list → never matches
  {
    const ctx = buildEventContext(mkEvent({ title: 'anything' }));
    const c = mkCond({ predicates: [] });
    assertEq(evaluateConditionals([c], ctx), null, 'empty predicates → no match');
  }

  const { failures } = assertionSummary();
  if (failures > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) run();

// Smoke test for the full conditional-override rendering pipeline:
//   evaluateConditionals → renderColumnValue → column_values shape
// Exercises the same chain sync-engine.js uses at runtime, minus the I/O.
//
//   node tests/run.js conditional-render-pipeline-unit

import { evaluateConditionals, buildEventContext } from '../../src/services/conditional-evaluator.js';
import { renderColumnValue } from '../../src/helpers/columns.js';
import { assertEq, assertionSummary } from '../lib/assert.js';

function render(winner, event) {
  if (!winner) return {};
  const out = {};
  for (const [columnId, value] of Object.entries(winner.values || {})) {
    const rendered = renderColumnValue(value, event);
    if (rendered !== undefined) out[columnId] = rendered;
  }
  return out;
}

export async function run() {
  console.log('▶ Scenario: conditional-render-pipeline-unit');

  // Status column override
  {
    const event = {
      summary: 'Project A kickoff',
      location: 'Zoom',
      attendees: [{ email: 'alice@jordan-lima.com' }],
    };
    const conditionals = [
      {
        id: 'proj-a',
        name: 'Project A',
        operator: 'AND',
        predicates: [
          { field: 'attendee_email', op: 'domain', value: 'jordan-lima.com' },
          { field: 'event_title', op: 'contains', value: 'Project A' },
        ],
        values: { col_status: { type: 'status', value: { index: 2 } } },
      },
    ];
    const winner = evaluateConditionals(conditionals, buildEventContext(event));
    const shape = render(winner, event);
    assertEq(shape, { col_status: { index: 2 } }, 'status override renders as { index }');
  }

  // Board-relation override
  {
    const event = { summary: 'Internal sync', attendees: [] };
    const conditionals = [
      {
        id: 'internal',
        name: 'Internal',
        operator: 'OR',
        predicates: [{ field: 'event_title', op: 'contains', value: 'internal' }],
        values: { col_projects: { type: 'board_relation', value: { itemId: 123 } } },
      },
    ];
    const winner = evaluateConditionals(conditionals, buildEventContext(event));
    const shape = render(winner, event);
    assertEq(shape, { col_projects: { item_ids: [123] } }, 'board_relation renders as { item_ids: [id] }');
  }

  // Mixed: both types set in one conditional
  {
    const event = { summary: 'client call', attendees: [{ email: 'ceo@bigcorp.com' }] };
    const conditionals = [
      {
        id: 'client',
        name: 'Client',
        operator: 'AND',
        predicates: [{ field: 'attendee_email', op: 'contains', value: 'bigcorp.com' }],
        values: {
          col_status: { type: 'status', value: { index: 1 } },
          col_projects: { type: 'board_relation', value: { itemId: 999 } },
        },
      },
    ];
    const winner = evaluateConditionals(conditionals, buildEventContext(event));
    const shape = render(winner, event);
    assertEq(
      shape,
      { col_status: { index: 1 }, col_projects: { item_ids: [999] } },
      'mixed conditional renders both column shapes'
    );
  }

  // No match → empty override
  {
    const event = { summary: 'weekly sync' };
    const conditionals = [
      {
        id: 'proj',
        name: 'Project',
        operator: 'AND',
        predicates: [{ field: 'event_title', op: 'contains', value: 'Project A' }],
        values: { col_status: { type: 'status', value: { index: 5 } } },
      },
    ];
    const winner = evaluateConditionals(conditionals, buildEventContext(event));
    const shape = render(winner, event);
    assertEq(shape, {}, 'no match → no overrides');
  }

  const { failures } = assertionSummary();
  if (failures > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) run();

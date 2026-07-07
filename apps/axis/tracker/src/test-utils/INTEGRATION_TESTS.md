# Integration Tests — Harness Notes

Quick reference for `renderCalendar()` and the Monday SDK mock.

## Skeleton

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderCalendar } from '../../test-utils/renderCalendar';
import { createApiPayloadCapture } from '../../test-utils/apiPayloadCapture';

// חובה — ה-mock של ה-SDK מצביע אל globalThis.__testMondayMock,
// שאותו renderCalendar מציב לפני שהוא טוען את App.
vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__testMondayMock;
});

describe('flow X', () => {
    it('does Y', async () => {
        const { container, monday } = await renderCalendar();
        const capture = createApiPayloadCapture(monday);
        // ... interact, then assert on `capture.calls`
    });
});
```

## Defaults

`renderCalendar()` — without options — gives you:

- **Time** pinned to `2026-05-07T09:00:00+03:00` (Thursday, Israel TZ).
- **Language** `he` (production default). Pass `{ language: 'en' }` to flip.
- **Context**: `boardId: 100`, `instanceId: 'integration-instance'`, user id `7` named `Tester`.
- **Settings** seeded into `monday.storage` under key `customSettings_integration-instance`:
  - `STRUCTURE_MODES.PROJECT_ONLY` (task & stage hidden, billable toggle visible).
  - All required column IDs filled (`dateColumnId`, `durationColumnId`, `projectColumnId`, `reporterColumnId`, `eventTypeStatusColumnId`, `nonBillableStatusColumnId`, `allDayTypeStatusColumnId`).
  - `eventTypeMapping` covers all 6 indices (0=שעתי, 1=לא לחיוב, 2=חופשה, 3=מחלה, 4=מילואים, 5=זמני).
  - `lastModifiedAt` is set so the app does **not** treat this as first-install (`SettingsWizard` stays closed).
- **API responses** (defensive, override per test via `apiResponsesByOp`):
  - `me` — current user `{ id: '7', name: 'Tester' }`.
  - `boards` — empty board with `cursor: null` (terminates pagination).
  - `next_items_page` — empty page with `cursor: null`.
  - `complexity` — large remaining quota.

## Overriding defaults

Per-test overrides go in via `apiResponsesByOp` (keyed by GraphQL operation name) **or** `apiResponses` (substring fallback for cases where the op extractor can't pin a name).

```jsx
const { container, monday } = await renderCalendar({
    apiResponsesByOp: {
        boards: ({ data: { boards: [{ id: '100', items_page: { cursor: null, items: seededEvents }, columns: [] }] } })
    }
});
```

For dynamic mid-test changes, use the mock's helpers:

```jsx
monday.__mergeApiResponsesByOp({ create_item: { data: { create_item: { id: '999' } } } });
```

## Stable IDs

These are deterministic across tests — assert on them directly:

| Thing               | ID                       |
|---------------------|--------------------------|
| Reporting board     | `100`                    |
| Projects board      | `200`                    |
| Current user        | `7` (`Tester`)           |
| Date column         | `date`                   |
| Duration column     | `numbers`                |
| Project link column | `project_link`           |
| Reporter column     | `reporter_people`        |
| Event-type column   | `event_type`             |
| All-day type column | `all_day_type`           |
| Non-billable column | `non_billable_type`      |

## Async settling

- `renderCalendar()` already awaits the calendar grid (`.rbc-calendar`) appearing — no need to `waitFor` again before interactions.
- Pagination terminator: every `boards` / `items_page` factory **must** return `cursor: null` on the first page or `useMondayEvents` will loop indefinitely.
- For interactions that trigger network, wrap assertions in `waitFor(() => expect(capture.find(/op_name/)).toBeDefined())`.

## When to override settings (`{ settings: {...} }`)

Override the seeded settings only when the flow under test requires a different structure — e.g. 2.1.5 (structure-mode switch) starts in `PROJECT_ONLY` and asserts the `MappingTab` after switching. Tests that don't need a different shape should leave `settings` alone — the seed is the contract.

## When NOT to use this harness

- Pure presentational tests (`FilterBar` props rendering): use `renderWithProviders` directly. The harness is heavy.
- Hook-only tests: use `renderHookWithProviders`.
- Anything that asserts internal call sequence inside a god-file — assert on the **flow contract** (which mock fn was called with what shape) so the test survives Wave 4 extractions.

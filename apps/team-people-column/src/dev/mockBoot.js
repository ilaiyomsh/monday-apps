// Dev-mock bootstrap — runs ONLY when VITE_MONDAY_MOCK is truthy (see the
// guarded dynamic import in src/index.jsx), before React mounts.
//
// The dev-harness stub picks its context fixture from
// `process.env.VITE_MONDAY_MOCK_CONTEXT` at MODULE LOAD time (see
// src/dev-harness/monday-sdk-stub.js `FEATURE_TYPE`) — but `process.env` is
// unreadable in the browser, so that env var is always undefined here and the
// stub falls back to `CONTEXTS.board_view`. This module fixes that up at
// runtime via the stub's harness API (`harness.setContext`), driven by the
// URL instead:
//   - default                    -> CONTEXTS.column_view_click
//   - ?placement=settings        -> CONTEXTS.column_view_settings
//   - ?single=1                  -> seed selectionMode 'single' (auto-close flow)
//
// It also seeds instance storage with a valid v1 column settings object
// matching the seeded boards/columns (see probes/MANIFEST.md), UNLESS the URL
// carries ?unconfigured=1 — that flag intentionally leaves storage empty so
// the app's "not configured yet" path can be exercised in dev:mock.
// Finally it installs the app's real captured API fixtures
// (installAppApiHandlers) so dev:mock renders real seeded data end-to-end.

import { harness } from '../dev-harness/monday-sdk-stub.js';
import { CONTEXTS } from '../dev-harness/fixtures.js';
import { installAppApiHandlers } from '../test-utils/probeFixtures.js';

// Settings v1 shape (src/domain/settingsSchema.js), matching the seeded
// boards/columns from probes/MANIFEST.md:
//   relationColumnId: board_relation_mm56dy57 (source board 18421604809)
//   linkedBoardId:    18421604791 (target board)
//   peopleColumnId:   multiple_person_mm5694pg (target board's people column)
const SEEDED_COLUMN_SETTINGS = {
  version: 1,
  relationColumnId: 'board_relation_mm56dy57',
  linkedBoardId: '18421604791',
  peopleColumnId: 'multiple_person_mm5694pg',
  policy: {
    selectionMode: 'multi',
    aggregation: 'union',
    includeListedPersons: true,
  },
};

export function bootMock() {
  const params = new URLSearchParams(window.location.search);
  const isSettingsPlacement = params.get('placement') === 'settings';
  const isUnconfigured = params.get('unconfigured') === '1';
  const isSingle = params.get('single') === '1';

  harness.setContext(isSettingsPlacement ? CONTEXTS.column_view_settings : CONTEXTS.column_view_click);

  if (!isUnconfigured) {
    // Column config lives in GLOBAL storage keyed teamPeople:<boardId>:<columnId>
    // (column dialogs have no instanceId — see mondayService.getColumnConfig).
    // The stub scopes global storage under `global:<key>`; the key inputs must
    // match the context fixture this boot just installed.
    const { boardId, columnId } = harness.state.context;
    const settings = isSingle
      ? { ...SEEDED_COLUMN_SETTINGS, policy: { ...SEEDED_COLUMN_SETTINGS.policy, selectionMode: 'single' } }
      : SEEDED_COLUMN_SETTINGS;
    harness.seedStorage(`global:teamPeople:${boardId}:${columnId}`, settings);
  }

  installAppApiHandlers(harness);
}

export default bootMock;

import logger from '../logger.js';

/*
 * ============================================================================
 *  BOARD & COLUMN SCHEMA — alias scaffold ONLY (NO monday ids)
 * ============================================================================
 *
 *  The Vibe-generated code refers to columns by per-board ALIASES (column1,
 *  column5, linkTo1, ...). monday's real column ids look like `date_mkz5k0wf`.
 *
 *  This module no longer holds any real board/column ids. The active mapping
 *  (alias -> real monday id) lives ONLY in monday.storage and is published into
 *  board-config-store.js at runtime by SettingsContext. If nothing is stored,
 *  the app forces the Settings modal so the user maps boards/columns first.
 *
 *  What stays here is purely structural metadata with NO monday ids:
 *    - BOARD_CLASS_TO_KEY: maps the SDK class name in the export -> a board key.
 *    - COLUMN_SCHEMA: per-board alias -> { type, title } (the editable template
 *      the Settings UI renders). `type` is a monday column TYPE (not an id) and
 *      drives the typed GraphQL fragments + the Settings column-type filter.
 *      `title` is a Hebrew label for the Settings UI.
 *
 *  Building an empty editable mapping from this schema is done via
 *  buildEmptyConfig() — every id starts blank and must be set in Settings.
 * ============================================================================
 */

// Stable list of the board roles the app maps.
// `decisions` (לוח החלטות) is mapped MANUALLY in Settings (not wizard-created).
export const BOARD_KEYS = ['discussions', 'tasks', 'topics', 'decisions'];

// App-level preferences (not board/column mapping) — persisted under
// `settings.preferences` in monday.storage. The "Previous tasks" tab can resolve
// its tasks either via the discussion-to-discussion link (the original behavior)
// or by the discussion TYPE written onto each task's taskTypeID column.
//   AUTO is a per-DISCUSSION hybrid: a discussion that HAS a type resolves by
//   type, one WITHOUT a type falls back to the previous-discussion link (so the
//   link picker stays available for untyped discussions).
export const PREVIOUS_TASKS_MODES = {
  LINKED_DISCUSSION: 'linkedDiscussion',
  DISCUSSION_TYPE: 'discussionType',
  AUTO: 'auto',
};
/*
 * round205 — the owner-selectable APP COMPONENTS (Settings → העדפות, owners
 * only): every major surface a board owner may hide for the whole instance.
 * Visibility is stored under preferences.visibleComponents as an EXPLICIT-false
 * map — a key that was never touched stays visible (default-on), so new
 * components appear automatically on existing instances.
 */
export const APP_COMPONENTS = [
  { key: 'previous', label: 'דיונים קודמים' },
  { key: 'background', label: 'רקע' },
  { key: 'references', label: 'התייחסויות' },
  { key: 'summary', label: 'סיכום' },
  { key: 'topics', label: 'נושאים ונקודות' },
  { key: 'tasks', label: 'משימות' },
  { key: 'decisions', label: 'החלטות' },
  { key: 'effectiveness', label: 'אפקטיביות' },
  { key: 'personalArea', label: 'אזור אישי' },
  { key: 'myTasks', label: 'המשימות שלי' },
  { key: 'myDecisions', label: 'ההחלטות שלי' },
  { key: 'dashboard', label: 'דשבורד' },
];

/** A component is visible unless the owner EXPLICITLY hid it (stored false). */
export function isComponentVisible(preferences, key) {
  return preferences?.visibleComponents?.[key] !== false;
}

/** The three triple-box pane keys, in display order (רקע → התייחסויות → סיכום). */
export const BOX_LABEL_KEYS = ['background', 'references', 'summary'];

/**
 * round314 — resolve the owner-set titles of the three panes, ALWAYS returning a
 * usable name for each key.
 *
 * A stored value wins only when it is a non-blank string; anything else (missing,
 * empty, whitespace, a number that survived a bad write) falls back to the shipped
 * default, because a nameless tab is unusable and there is no UI to recover from one.
 * Trimmed on the way out so a stray space cannot shift the tab band.
 *
 * Pure — the reason it lives here beside DEFAULT_PREFERENCES rather than inside the
 * component: the same rules have to hold for the tab band and for anything else that
 * later wants to name a box.
 *
 * @param {object|null|undefined} preferences settings.preferences
 * @returns {{ background: string, references: string, summary: string }}
 */
export function resolveBoxLabels(preferences) {
  const stored = preferences?.boxLabels;
  const out = {};
  BOX_LABEL_KEYS.forEach((key) => {
    const raw = stored?.[key];
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    out[key] = trimmed || DEFAULT_PREFERENCES.boxLabels[key];
  });
  return out;
}

export const DEFAULT_PREFERENCES = {
  previousTasksMode: PREVIOUS_TASKS_MODES.LINKED_DISCUSSION,
  // round296 — default width split of the ניהול-דיון row: the AGENDA box's share
  // (0..1, clamped [0.25,0.75] by discussionLayout). 0.6 ⇒ agenda 60% / triple
  // box 40% (owner request). Owner-configurable in Settings → העדפות. A per-
  // discussion drag override is saved on that discussion only; a NEW discussion
  // (no saved layout) opens at THIS default.
  defaultLayoutRatio: 0.6,
  // round205 — per-component visibility map ({ [componentKey]: false } hides);
  // see APP_COMPONENTS + isComponentVisible above. Empty = everything shown.
  visibleComponents: {},
  // round108 — owner-set logo shown at the top-right of the discussion header
  // (parallel to the title). Stored as a small downscaled data-URI (self-contained,
  // no asset hosting); null = no logo. Set only by owners in Settings → העדפות.
  logoUrl: null,
  /*
   * round314 (owner request) — the three panes of the triple box carry OWNER-SET
   * titles. The defaults are the names the app shipped with, so an instance that
   * never touches this reads exactly as before. Per instance, like every other
   * preference; a blank or whitespace-only entry falls back to the default rather
   * than rendering a nameless tab (see resolveBoxLabels).
   *
   * Deliberately SEPARATE from the export template's per-section labels: those are
   * per discussion TYPE, so binding the on-screen names to them would make a box
   * rename itself when the discussion's type changes.
   */
  boxLabels: { background: 'רקע', references: 'התייחסויות', summary: 'סיכום' },
  // Whether the top-level "המשימות שלי" (My Tasks) view toggle is shown. Default
  // OFF so existing instances keep their current behavior (the tab is opt-in per
  // instance, enabled by the owner in Settings → העדפות).
  showMyTasks: false,
  // Which tasks-status label ids count as "done" for the EffectivenessTab
  // "בעיכוב" (delayed) KPI — a delayed task is past its deadline AND not in one
  // of these statuses. null (not []) = unset: fall back to the status column's
  // own is_done label.
  delayedDoneStatusIds: null,
  // Item 18 (2026-07-14): when true, EVERY new decision's מחליט (decider)
  // defaults to the discussion's מנהל דיון (lead) instead of the current user —
  // across ALL discussions, regardless of type. A per-type template can enable
  // the same behavior selectively (deciderIsLead on the type template). The
  // decider stays freely replaceable inline after creation.
  defaultDeciderLead: false,
  // Round 78 (2026-07-14): which DISCUSSION-board ROLE columns auto-fill each
  // tasks-board ACCESS column when a task is created from a discussion. Keyed by
  // the tasks access-column alias; each value is a list of discussion role
  // aliases whose people are UNIONED into that column. Owner-configurable in
  // Settings → מיפוי (under each access column). The default reproduces the
  // prior hardcoded behavior: participants → יכולת צפייה, lead + coordinator +
  // creator → יכולת עריכה. An unset/empty list means "don't auto-fill".
  accessRoleSources: {
    taskViewersID: ['participantsID'],
    taskEditorsID: ['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID'],
  },
};

// The discussion-board roles selectable as auto-fill sources for the tasks
// access columns (round 78). `alias` is the discussions COLUMN_SCHEMA alias;
// `label` is the Hebrew fallback shown when the live column title is unknown.
export const ACCESS_ROLE_SOURCE_OPTIONS = [
  { alias: 'discussionLeadID', label: 'מנהל דיון' },
  { alias: 'discussionCoordinatorID', label: 'מרכז דיון' },
  { alias: 'discussionCreatorID', label: 'יוצר הדיון' },
  { alias: 'participantsID', label: 'משתתפים' },
];

// Union the people off a discussion record for the given role aliases, deduped
// by id, preserving first-seen order (round 78 access auto-fill). Pure — used by
// DiscussionCard to build a new task's viewers/editors from the configured roles.
export function resolveAccessPeople(discussion, aliases) {
  const byId = new Map();
  (Array.isArray(aliases) ? aliases : []).forEach((alias) => {
    const list = Array.isArray(discussion?.[alias]) ? discussion[alias] : [];
    list.forEach((p) => { if (p?.id != null && !byId.has(String(p.id))) byId.set(String(p.id), p); });
  });
  return [...byId.values()];
}

/*
 * ============================================================================
 *  EXPORT TEMPLATE — per-instance, data-driven .docx / .pdf export config
 * ============================================================================
 *
 *  Persisted under `settings.exportTemplate` in monday.storage (merged like
 *  `preferences`). It drives the data-driven renderer in `utils/docxExport.js`:
 *  which sections appear, in what order, which metadata fields show + their
 *  labels, plus the header/footer band config.
 *
 *  DEFAULT_EXPORT_TEMPLATE reproduces TODAY's hardcoded output byte-for-byte, so
 *  existing instances (no stored exportTemplate) render exactly as before. The
 *  meta `field.key`s match the keys produced by `buildDiscussionModel`
 *  (dateText / participantsText / leadText / typesText / previousText).
 *
 *  Heavy binaries (logo images, an uploaded header/footer .docx template) do NOT
 *  live here — they are stored under a SEPARATE monday.storage key by
 *  `utils/exportAssets.js` to keep this settings blob (loaded on every boot)
 *  small. This object only carries small flags/config + a pointer flag.
 * ============================================================================
 */
export const EXPORT_FORMATS = { DOCX: 'docx', PDF: 'pdf' };
// Where the header/footer come from:
//   CONFIG — built by the app from the header/footer config below.
//   UPLOAD — spliced from an owner-uploaded .docx template (headers/footers only);
//            PDF is not available in this mode (client-side can't render Word chrome).
export const EXPORT_HEADER_MODES = { CONFIG: 'config', UPLOAD: 'upload' };
export const EXPORT_LOGO_POSITIONS = { RIGHT: 'right', CENTER: 'center', LEFT: 'left' };
export const EXPORT_TEXT_ALIGN = { RIGHT: 'right', CENTER: 'center', LEFT: 'left' };

// Selectable export fonts. `.docx` is the Word font triplet (ascii/hAnsi for
// Latin+numerals, cs = complex-script for Hebrew); `.css` is the browser family
// used by the live preview. NOTE: a .docx only REFERENCES a font by name — it's
// not embedded — so the reader's Word substitutes if the font isn't installed.
// The list is curated to fonts that ship with Office and support Hebrew.
// `brand` reproduces today's hardcoded output byte-for-byte (Figtree / Noto).
export const EXPORT_FONTS = {
  brand:     { label: 'ברירת מחדל (Figtree / Noto)', docx: { ascii: 'Figtree', hAnsi: 'Figtree', cs: 'Noto Sans Hebrew' }, css: "'Figtree','Noto Sans Hebrew',sans-serif" },
  david:     { label: 'David',      docx: { ascii: 'David',      hAnsi: 'David',      cs: 'David' },      css: "'David','Times New Roman',serif" },
  arial:     { label: 'Arial',      docx: { ascii: 'Arial',      hAnsi: 'Arial',      cs: 'Arial' },      css: "Arial,'Helvetica Neue',sans-serif" },
  narkisim:  { label: 'Narkisim',   docx: { ascii: 'Narkisim',   hAnsi: 'Narkisim',   cs: 'Narkisim' },   css: "'Narkisim',serif" },
  frankruehl:{ label: 'FrankRuehl', docx: { ascii: 'FrankRuehl', hAnsi: 'FrankRuehl', cs: 'FrankRuehl' }, css: "'FrankRuehl',serif" },
  gisha:     { label: 'Gisha',      docx: { ascii: 'Gisha',      hAnsi: 'Gisha',      cs: 'Gisha' },      css: "'Gisha',sans-serif" },
  calibri:   { label: 'Calibri',    docx: { ascii: 'Calibri',    hAnsi: 'Calibri',    cs: 'Calibri' },    css: "Calibri,sans-serif" },
  assistant: { label: 'Assistant',  docx: { ascii: 'Assistant',  hAnsi: 'Assistant',  cs: 'Assistant' },  css: "'Assistant',sans-serif" },
  rubik:     { label: 'Rubik',      docx: { ascii: 'Rubik',      hAnsi: 'Rubik',      cs: 'Rubik' },      css: "'Rubik',sans-serif" },
};
export const DEFAULT_EXPORT_FONT = 'brand';

/*
 * round315 (owner request) — how ONE participant is written in the export's
 * "פרטי הדיון" block. The owner composes a person out of ordered PARTS taken from
 * the monday user profile:
 *   'name'         the user's name (always available)
 *   'title'        the profile's Title field
 *   'cf:<metaId>'  any account custom profile field (user.custom_field_values,
 *                  keyed by custom_field_meta_id — see userProfiles.js)
 * Each part carries the separator that precedes it, which is what makes
 * "מר עידו פיוטרקובסקי, מנהל מחלקת מכירות" expressible: a space before the name,
 * a comma before the title. The separator of the FIRST part is never used.
 */
export const PARTICIPANT_PART_NAME = 'name';
export const PARTICIPANT_PART_TITLE = 'title';
export const PARTICIPANT_CF_PREFIX = 'cf:';
export const PARTICIPANT_SEPARATORS = [
  { value: ', ', label: 'פסיק' },
  { value: ' ', label: 'רווח' },
  { value: ' — ', label: 'מקף' },
  { value: '', label: 'ללא' },
];
export const DEFAULT_PARTICIPANT_SEPARATOR = ', ';
// The shipped composition: the name alone — byte-for-byte today's export.
export const DEFAULT_PARTICIPANT_PARTS = [{ key: PARTICIPANT_PART_NAME, sep: DEFAULT_PARTICIPANT_SEPARATOR }];

export const DEFAULT_EXPORT_TEMPLATE = {
  defaultFormat: EXPORT_FORMATS.DOCX,
  headerMode: EXPORT_HEADER_MODES.CONFIG,
  // Selected export font key (see EXPORT_FONTS). Default = brand (today's output).
  font: DEFAULT_EXPORT_FONT,
  // Body sections in render order. `enabled:false` drops a section entirely.
  // round203 — the "פתיחה" (freeText) section was RETIRED (owner request);
  // seedExportTemplate drops it from previously-stored templates.
  sections: [
    {
      key: 'meta',
      enabled: true,
      // Metadata lines — order + label are editable; a line is emitted only when
      // its value exists (never "סוג: null"), matching today's behavior.
      fields: [
        { key: 'dateText', enabled: true, label: 'תאריך' },
        // round315 — `perLine` puts every participant on its own line under a
        // "משתתפים:" label; `parts` composes ONE participant (see the constants
        // above). Both defaults reproduce today's single comma-joined row.
        { key: 'participantsText', enabled: true, label: 'משתתפים', perLine: false, parts: DEFAULT_PARTICIPANT_PARTS },
        { key: 'leadText', enabled: true, label: 'מוביל דיון' },
        { key: 'typesText', enabled: true, label: 'סוג' },
        { key: 'previousText', enabled: true, label: 'דיון קודם' },
      ],
    },
    // round219 — the רקע (background) box from the Topics tab's triple box;
    // rendered through the same HTML→docx converter as the summary/references.
    // Placed right after the metadata so it reads as the discussion's context;
    // seedExportTemplate back-fills it into previously-stored templates.
    { key: 'background', enabled: true, label: 'רקע' },
    { key: 'topics', enabled: true, label: 'נושאים לדיון' },
    { key: 'summary', enabled: true, label: 'סיכום' },
    // round200 — the References (התייחסויות) box from the Topics tab; rendered
    // through the same HTML→docx converter as the summary. Enabled by default;
    // degrades to "אין התייחסויות." when the box is empty.
    { key: 'references', enabled: true, label: 'התייחסויות' },
    { key: 'tasks', enabled: true, label: 'משימות' },
    // round192 — decisions table (owner request). Enabled by default; degrades to
    // "אין החלטות." when the discussion has none / the decisions board is unmapped.
    { key: 'decisions', enabled: true, label: 'החלטות' },
  ],
  // CONFIG-mode header/footer. `hasLogo` is a flag; the base64 image itself lives
  // in exportAssets (headerLogo / footerLogo). Empty text/logo ⇒ nothing rendered,
  // so the defaults below produce NO header/footer (today's output).
  header: {
    hasLogo: false,
    logoPos: EXPORT_LOGO_POSITIONS.CENTER,
    text: '',
    textAlign: EXPORT_TEXT_ALIGN.CENTER,
    meta: { name: false, date: false },
  },
  footer: {
    hasLogo: false,
    logoPos: EXPORT_LOGO_POSITIONS.RIGHT,
    text: '',
    textAlign: EXPORT_TEXT_ALIGN.CENTER,
    meta: { date: false, page: false },
  },
  // UPLOAD-mode: flag only; the template .docx bytes live in exportAssets.
  hasTemplateDocx: false,
};

/*
 * ============================================================================
 *  BOARD PERMISSIONS — config scaffold (Phase 0, INERT until enabled)
 * ============================================================================
 *
 *  Client-side ADVISORY gating only (the app has no server; this is UX
 *  guardrails, NOT a security boundary). Stored under `settings.permissions`
 *  (top-level, sparse). `enabled:false` ⇒ behavior is byte-for-byte identical
 *  to today (fail-open). Nothing here changes runtime behavior on its own — the
 *  resolver (`usePermission`, Phase 1) and the owner UI (Phase 3) consume it.
 *
 *  Roles are auto-derived from the people-type columns mapped on each board
 *  (PERMISSION_ROLE_SOURCES). `permissions.roles` is keyed `${boardKey}:${alias}`.
 * ============================================================================
 */

// Default permissions blob for a fresh / unconfigured instance. `enabled:false`
// ⇒ the whole matrix is bypassed and the app reproduces today's behavior.
export const DEFAULT_PERMISSIONS = {
  enabled: false,
  version: 1,
  roles: {},
};

// Per-capability FALLBACK when a held role neither grants (explicit true) nor is
// seeded for that capability. One of:
//   'owner'            — owners/admins only
//   'creatorLeadOwner' — discussion creator/lead (or task creator/responsible) + owners
//   'all'              — every board member
// (Per the spec: discussion-content edits + task edits default to
// 'creatorLeadOwner'; view/createDiscussion/manageTemplates to 'all';
// reorderColumns to 'owner'.)
export const CAPABILITY_DEFAULTS = {
  // ---- discussion tier ----
  // item 20 (2026-07-14): view is ROLE-GATED — participants view via the seed;
  // a user in no people column of the discussion is denied. The resolver keeps
  // two safety valves (unready discussion / unseeded roles map → allow).
  viewDiscussion: 'creatorLeadOwner',
  // round209 — the box-view caps default to 'all' so EXISTING stored role maps
  // (which lack these new keys) keep today's behavior: everyone who can open
  // the discussion sees the boxes. Unlike other 'all' caps the resolver does
  // NOT short-circuit these — an explicit `false` on a held role (e.g. the
  // owner unchecking participants) hides the pane. See usePermission.js
  // BOX_VIEW_CAPS.
  viewReferencesBox: 'all',
  viewSummaryBox: 'all',
  editDiscussionFields: 'creatorLeadOwner',
  // round212 — triple-box writes: default like editSummary (creator/lead/owner).
  writeBackground: 'creatorLeadOwner',
  writeReferences: 'creatorLeadOwner',
  editSummary: 'creatorLeadOwner',
  exportDocs: 'creatorLeadOwner',
  // round291 (owner spec) — ANYONE can create a task, both standalone (My Tasks,
  // already ungated) and inside a discussion. Mirrors createDiscussion: 'all'.
  createTask: 'all',
  addTopicOrPoint: 'creatorLeadOwner',
  editTopicOrPoint: 'creatorLeadOwner',
  deleteTopicOrPoint: 'creatorLeadOwner',
  checkPoint: 'creatorLeadOwner',
  editResponses: 'creatorLeadOwner',
  // ---- task tier ----
  editTaskStatus: 'creatorLeadOwner',
  editTaskPriority: 'creatorLeadOwner',
  editTaskDeadline: 'creatorLeadOwner',
  editTaskAssignee: 'creatorLeadOwner',
  // round305 (owner spec) — שותפים is editable by owners, the DISCUSSION's
  // lead/creator/coordinator, and the TASK's creator/responsible. The
  // 'creatorLeadOwner' bucket says exactly that for a discussion ctx; for the
  // personal (no-discussion) ctx the allowed item roles are narrowed by
  // CAP_ITEM_SELF_ROLES below (viewers must NOT inherit it).
  editTaskPartners: 'creatorLeadOwner',
  editTaskName: 'creatorLeadOwner',
  deleteTask: 'creatorLeadOwner',
  // ---- decision tier ----
  createDecision: 'creatorLeadOwner',
  editDecisionStatus: 'creatorLeadOwner',
  editDecisionPriority: 'creatorLeadOwner',
  editDecisionDate: 'creatorLeadOwner',
  editDecisionAffected: 'creatorLeadOwner',
  editDecisionName: 'creatorLeadOwner',
  deleteDecision: 'creatorLeadOwner',
  // ---- system tier (global) ----
  createDiscussion: 'all',
  reorderColumns: 'owner',
  manageTemplates: 'all',
  addDiscussionTypes: 'owner',
  saveViewDefaults: 'owner',
};

/*
 * Full capability catalog the owner UI renders, grouped per tier + category.
 *   tier:  'disc' | 'task' | 'system'
 *   group: a UI category card within the tier
 *   label: Hebrew label shown in the matrix
 * `openSettings` is deliberately NOT here — it is hard-locked to owners OUTSIDE
 * the matrix (no lockout risk).
 */
export const CAPABILITIES = [
  // ---- discussion tier ----
  { id: 'viewDiscussion', tier: 'disc', group: 'discussion', label: 'צפייה בדיון' },
  // round209 — per-role VIEW gates for the triple-box panes (owner spec: decide
  // whether participants may SEE the התייחסויות / סיכום boxes).
  { id: 'viewReferencesBox', tier: 'disc', group: 'discussion', label: 'צפייה בתיבת התייחסויות' },
  { id: 'viewSummaryBox', tier: 'disc', group: 'discussion', label: 'צפייה בתיבת סיכום' },
  { id: 'editDiscussionFields', tier: 'disc', group: 'discussion', label: 'עריכת פרטי הדיון' },
  // round212 — the triple-box WRITE gates are matrix capabilities now (owner
  // spec: full ✓-table control). editSummary keeps its id (stored configs
  // survive) but reads "כתיבת סיכום" alongside the two new siblings.
  { id: 'writeBackground', tier: 'disc', group: 'discussion', label: 'כתיבת רקע' },
  { id: 'writeReferences', tier: 'disc', group: 'discussion', label: 'כתיבת התייחסויות' },
  { id: 'editSummary', tier: 'disc', group: 'discussion', label: 'כתיבת סיכום' },
  { id: 'exportDocs', tier: 'disc', group: 'discussion', label: 'ייצוא' },
  { id: 'addTopicOrPoint', tier: 'disc', group: 'topics', label: 'הוספת נושא/נקודה' },
  { id: 'editTopicOrPoint', tier: 'disc', group: 'topics', label: 'עריכת נושא/נקודה' },
  { id: 'deleteTopicOrPoint', tier: 'disc', group: 'topics', label: 'מחיקת נושא/נקודה' },
  { id: 'checkPoint', tier: 'disc', group: 'topics', label: 'סימון נקודה כנידונה' },
  // round212 — relabeled "לנקודות" so it can't be confused with the references BOX write.
  { id: 'editResponses', tier: 'disc', group: 'topics', label: 'עריכת התייחסויות לנקודות' },
  // discussion-scoped "משימות" card (creating a task lives in the discussion)
  { id: 'createTask', tier: 'disc', group: 'tasks', label: 'יצירת משימה בדיון' },
  // discussion-scoped "החלטות" card (creating a decision lives in the discussion)
  { id: 'createDecision', tier: 'disc', group: 'decisions', label: 'יצירת החלטה בדיון' },
  // ---- task tier (one "שדות משימה" card; delete is a row) ----
  { id: 'editTaskStatus', tier: 'task', group: 'taskFields', label: 'עריכת סטאטוס' },
  { id: 'editTaskPriority', tier: 'task', group: 'taskFields', label: 'עריכת עדיפות' },
  { id: 'editTaskDeadline', tier: 'task', group: 'taskFields', label: 'עריכת דד ליין' },
  { id: 'editTaskAssignee', tier: 'task', group: 'taskFields', label: 'עריכת אחריות' },
  // round305 — the שותפים people column (partnersID).
  { id: 'editTaskPartners', tier: 'task', group: 'taskFields', label: 'עריכת שותפים' },
  { id: 'editTaskName', tier: 'task', group: 'taskFields', label: 'עריכת שם משימה' },
  { id: 'deleteTask', tier: 'task', group: 'taskFields', label: 'מחיקת משימה' },
  // ---- decision tier (one "שדות החלטה" card; delete is a row) ----
  { id: 'editDecisionStatus', tier: 'decision', group: 'decisionFields', label: 'עריכת סטאטוס' },
  { id: 'editDecisionPriority', tier: 'decision', group: 'decisionFields', label: 'עריכת עדיפות' },
  { id: 'editDecisionDate', tier: 'decision', group: 'decisionFields', label: 'עריכת תאריך' },
  { id: 'editDecisionAffected', tier: 'decision', group: 'decisionFields', label: 'עריכת מושפעים' },
  { id: 'editDecisionName', tier: 'decision', group: 'decisionFields', label: 'עריכת נוסח החלטה' },
  { id: 'deleteDecision', tier: 'decision', group: 'decisionFields', label: 'מחיקת החלטה' },
  // ---- system tier (global) ----
  { id: 'createDiscussion', tier: 'system', group: 'system', label: 'יצירת דיון' },
  { id: 'reorderColumns', tier: 'system', group: 'system', label: 'סידור עמודות' },
  { id: 'manageTemplates', tier: 'system', group: 'system', label: 'ניהול תבניות' },
  { id: 'addDiscussionTypes', tier: 'system', group: 'system', label: 'הוספת סוגי דיון' },
  { id: 'saveViewDefaults', tier: 'system', group: 'system', label: 'שמירת סינון/מיון/קיבוץ עבור כולם' },
];

/*
 * Which people-column ALIASES act as roles on each board. A user "holds" a role
 * for a given item when their id appears in that people column's value. New
 * people columns added to COLUMN_SCHEMA can be added here to surface as roles.
 * (topics has no permission roles of its own — topic/point content is gated by
 * the parent discussion tier.)
 */
export const PERMISSION_ROLE_SOURCES = {
  discussions: ['discussionCreatorID', 'discussionLeadID', 'discussionCoordinatorID', 'participantsID'],
  // item 19: יכולת צפייה (viewers, read-only) + יכולת עריכה (editors, full
  // edit) — auto-filled at task creation from the parent discussion's people.
  tasks: ['taskCreatorID', 'responsibilityID', 'taskViewersID', 'taskEditorsID'],
  // decisions: creator + decider + "מושפעים" (affected). `affectedID` is a
  // first-class role source (not just data) so a user listed in the decision's
  // affected people column is recognized as the "מושפעים" role by the resolver.
  decisions: ['decisionCreatorID', 'deciderID', 'affectedID'],
};

/*
 * round305 — PER-CAPABILITY narrowing of the item-tier "self role" scan.
 *
 * An item-tier capability with no discussion in ctx (the personal My Tasks /
 * My Decisions surfaces) normally resolves against EVERY role source of that
 * board — which includes `taskViewersID`, the deliberately read-only role. For a
 * capability whose owner spec names the allowed roles, list them here and the
 * resolver scans only those.
 *
 * `parentDiscussionEditors: true` additionally accepts the parent DISCUSSION's
 * lead/coordinator/creator, read from the roles the row carries under
 * `__discussionRoles` (stamped by useMyTasks for the "בדיונים שהובלתי" scope,
 * where there is no discussion object in ctx but the parent's roles are known).
 */
export const CAP_ITEM_SELF_ROLES = {
  // owners + discussion lead/creator/coordinator + task creator + task responsible.
  // taskEditorsID counts because item 19 fills it FROM the discussion's
  // lead/coordinator/creator; taskViewersID is excluded — a viewer never edits.
  editTaskPartners: {
    tasks: {
      selfRoles: ['taskCreatorID', 'responsibilityID', 'taskEditorsID'],
      parentDiscussionEditors: true,
    },
  },
};

/*
 * The synthetic SYSTEM pseudo-role key. Unlike the people-column roles above,
 * this is a single GLOBAL role every user "holds" — its `capabilities` map (in
 * `settings.permissions.roles[SYSTEM_ROLE_KEY]`) drives the system-tier caps
 * (createDiscussion / manageTemplates / reorderColumns). The owner UI
 * (PermissionsTab) writes to this exact key; the resolver reads from it. Keep
 * the literal in sync with PermissionsTab's synthetic system row.
 */
export const SYSTEM_ROLE_KEY = 'system:system';

/*
 * LOCKED default seed (per role), used to PRE-FILL `permissions.roles` when the
 * owner first enables the feature. Keyed `${boardKey}:${alias}`; each role's
 * `capabilities` map holds the explicit grants for that role. `true` = grant.
 * (Per the spec §"LOCKED default seed".) The system tier is not a people-column
 * role — its defaults live in CAPABILITY_DEFAULTS, not here.
 */
export const DEFAULT_PERMISSION_SEED = {
  // discussion creator → ALL discussion caps true (full)
  'discussions:discussionCreatorID': {
    capabilities: {
      viewDiscussion: true,
      viewReferencesBox: true,
      viewSummaryBox: true,
      editDiscussionFields: true,
      writeBackground: true,
      writeReferences: true,
      editSummary: true,
      exportDocs: true,
      createTask: true,
      createDecision: true,
      addTopicOrPoint: true,
      editTopicOrPoint: true,
      deleteTopicOrPoint: true,
      checkPoint: true,
      editResponses: true,
    },
  },
  // discussion lead → ALL discussion caps true (full)
  'discussions:discussionLeadID': {
    capabilities: {
      viewDiscussion: true,
      viewReferencesBox: true,
      viewSummaryBox: true,
      editDiscussionFields: true,
      writeBackground: true,
      writeReferences: true,
      editSummary: true,
      exportDocs: true,
      createTask: true,
      createDecision: true,
      addTopicOrPoint: true,
      editTopicOrPoint: true,
      deleteTopicOrPoint: true,
      checkPoint: true,
      editResponses: true,
    },
  },
  // discussion coordinator (מרכז דיון) → ALL discussion caps true (edits like lead)
  'discussions:discussionCoordinatorID': {
    capabilities: {
      viewDiscussion: true,
      viewReferencesBox: true,
      viewSummaryBox: true,
      editDiscussionFields: true,
      writeBackground: true,
      writeReferences: true,
      editSummary: true,
      exportDocs: true,
      createTask: true,
      createDecision: true,
      addTopicOrPoint: true,
      editTopicOrPoint: true,
      deleteTopicOrPoint: true,
      checkPoint: true,
      editResponses: true,
    },
  },
  // participants → view + export + createTask + createDecision + addTopicOrPoint +
  // checkPoint + editResponses ; NOT editDiscussionFields/editSummary/
  // editTopicOrPoint/deleteTopicOrPoint (createDecision mirrors createTask per role)
  'discussions:participantsID': {
    capabilities: {
      viewDiscussion: true,
      viewReferencesBox: true,
      viewSummaryBox: true,
      editDiscussionFields: false,
      writeBackground: false,
      writeReferences: false,
      editSummary: false,
      exportDocs: true,
      createTask: true,
      createDecision: true,
      addTopicOrPoint: true,
      editTopicOrPoint: false,
      deleteTopicOrPoint: false,
      checkPoint: true,
      editResponses: true,
    },
  },
  // task creator → ALL task caps true (incl. editTaskDeadline, deleteTask)
  'tasks:taskCreatorID': {
    capabilities: {
      editTaskStatus: true,
      editTaskPriority: true,
      editTaskDeadline: true,
      editTaskAssignee: true,
      // round305 — the owner's spec grants שותפים to the task creator.
      editTaskPartners: true,
      editTaskName: true,
      deleteTask: true,
    },
  },
  // responsible → status + priority ; NOT deadline/assignee/name/delete
  'tasks:responsibilityID': {
    capabilities: {
      editTaskStatus: true,
      editTaskPriority: true,
      editTaskDeadline: false,
      editTaskAssignee: false,
      // round305 — the owner's spec grants שותפים to the task's responsible,
      // even though they may not reassign אחריות itself.
      editTaskPartners: true,
      editTaskName: false,
      deleteTask: false,
    },
  },
  // item 19 — יכולת עריכה (editors): full task edit incl. delete.
  'tasks:taskEditorsID': {
    capabilities: {
      editTaskStatus: true,
      editTaskPriority: true,
      editTaskDeadline: true,
      editTaskAssignee: true,
      // round305 — editors are seeded FROM the discussion's lead/coordinator/
      // creator (item 19), the exact roles the owner's spec grants.
      editTaskPartners: true,
      editTaskName: true,
      deleteTask: true,
    },
  },
  // item 19 — יכולת צפייה (viewers): STRICTLY read-only. The explicit `false`s
  // matter: they also veto the item-tier default bucket, so a viewer-only user
  // can never inherit edit through isItemSelfRole.
  'tasks:taskViewersID': {
    capabilities: {
      editTaskStatus: false,
      editTaskPriority: false,
      editTaskDeadline: false,
      editTaskAssignee: false,
      // round305 — read-only means read-only, שותפים included.
      editTaskPartners: false,
      editTaskName: false,
      deleteTask: false,
    },
  },
  // decision creator → ALL decision caps true (incl. deleteDecision)
  'decisions:decisionCreatorID': {
    capabilities: {
      editDecisionStatus: true,
      editDecisionPriority: true,
      editDecisionDate: true,
      editDecisionAffected: true,
      editDecisionName: true,
      deleteDecision: true,
    },
  },
  // decider (מחליט) → edit everything ; NOT delete
  'decisions:deciderID': {
    capabilities: {
      editDecisionStatus: true,
      editDecisionPriority: true,
      editDecisionDate: true,
      editDecisionAffected: true,
      editDecisionName: true,
      deleteDecision: false,
    },
  },
  // affected (מושפעים) → the LEAST-privileged decision role: a stakeholder who
  // may acknowledge/track the decision STATUS but not change its substance
  // (priority/date/affected list/name) or delete it. Mirrors the task tier's
  // limited "responsible" role (explicit grant + explicit revokes). Per the
  // resolver's deny-wins veto, an explicit false here is honored even for a user
  // who also holds a higher decision role — same semantics as responsible on a
  // task. The owner can broaden these in the "שדות החלטה" card.
  'decisions:affectedID': {
    capabilities: {
      editDecisionStatus: true,
      editDecisionPriority: false,
      editDecisionDate: false,
      editDecisionAffected: false,
      editDecisionName: false,
      deleteDecision: false,
    },
  },
};

// Maps the SDK class name used in the exported code -> a board key above.
export const BOARD_CLASS_TO_KEY = {
  'דיונים1Board': 'discussions',
  'משימות1Board': 'tasks',
  'נושאיםלדיון1Board': 'topics',
  'החלטות1Board': 'decisions',
};

// alias -> { type: <monday column TYPE>, title } — NO monday ids.
// `type` selects the typed GraphQL fragment + the Settings column-type filter.
//
// Aliases follow a uniform convention: descriptive English camelCase + an
// UPPER `ID` suffix (the alias resolves to a monday column id). Aliases are
// namespaced per board, so e.g. `discussionLinkID` legitimately appears on both
// the tasks and topics boards. To rename an alias, update BOTH here and the
// ALIAS_MIGRATIONS map below (so existing stored mappings re-key automatically).
export const COLUMN_SCHEMA = {
  discussions: {
    discussionCreatorID: { type: 'people', title: 'יוצר דיון' },
    discussionLeadID: { type: 'people', title: 'מנהל דיון' },
    // Optional people column — "מרכז דיון". A full permission role (edits like the
    // lead) once the owner maps it. The header/footer label always comes from the
    // LIVE board column title, NOT this schema title (which shows only in Settings).
    discussionCoordinatorID: { type: 'people', title: 'מרכז דיון' },
    discussionDateID: { type: 'date', title: 'תאריך הדיון' },
    creationDateID: { type: 'date', title: 'תאריך יצירה' },
    participantsID: { type: 'people', title: 'משתתפים' },
    // round211 — EXTERNAL participants (not monday users): a plain text column
    // holding comma-separated names. They can never be assigned tasks; editable
    // by the discussion creator/lead/coordinator + board owners. Unmapped → the
    // whole feature hides.
    externalParticipantsID: { type: 'long_text', title: 'משתתפים חיצוניים' },
    // File column the exported summary .docx is uploaded into (add_file_to_column).
    summaryFileID: { type: 'file', title: 'קובץ סיכום (DOCS)' },
    // round216 — the three triple-box files columns (קבצי רקע/התייחסויות/סיכום,
    // rounds 204/206) were REMOVED from the schema + mapping (owner request):
    // with no mapped column the 📎 attach button and file chips simply hide.
    tasksBoardLinkID: { type: 'board_relation', title: 'לוח משימות' },
    topicsBoardLinkID: { type: 'board_relation', title: 'לוח נושאים לדיון' },
    // סוג דיון — a DROPDOWN column. Its value is the label TEXT (not a numeric
    // status id). Per-type DISPLAY COLORS live in app storage (TemplatesContext
    // typeColors), NOT on the column, since dropdown labels have no color.
    discussionTypeID: { type: 'dropdown', title: 'סוג' },
    previousDiscussionID: { type: 'board_relation', title: 'דיון קודם' },
    // Two-way pair with the decisions board's discussionLinkID — decisions are
    // READ from the discussion side via this relation's linked_items (a
    // board_relation can't be server-filtered by item id).
    decisionsBoardLinkID: { type: 'board_relation', title: 'לוח החלטות' },
    // ---- read-only display / chart fields ----
    totalTasksID: { type: 'formula', title: 'סך משימות' },
    completionPctID: { type: 'formula', title: 'ביצוע %' },
    completedTasksID: { type: 'mirror', title: 'סך משימות שבוצעו' },
    delayedTasksID: { type: 'mirror', title: 'סך משימות בעיכוב' },
    delayedPctID: { type: 'formula', title: 'בעיכוב %' },
    effectivenessID: { type: 'formula', title: 'אפקטיביות דיון' },
    totalTopicsID: { type: 'formula', title: 'סך נושאים' },
  },

  tasks: {
    taskCreatorID: { type: 'people', title: 'יוצר' },
    // round115 — stamped automatically with TODAY when a task is created in
    // the app (any create path); owner maps it to a date column ("תאריך יצירה").
    taskCreationDateID: { type: 'date', title: 'תאריך יצירה' },
    responsibilityID: { type: 'people', title: 'אחריות' },
    // round305 (owner request) — "שותפים": the task's collaborators, a SECOND
    // people column beside אחריות. Rendered in the personal "המשימות שלי" table
    // (both scopes); its edit gate is the editTaskPartners capability below.
    partnersID: { type: 'people', title: 'שותפים' },
    deadlineID: { type: 'date', title: 'דד ליין' },
    statusID: { type: 'status', title: 'סטאטוס' },
    discussionLinkID: { type: 'board_relation', title: 'דיון' },
    detailsID: { type: 'long_text', title: 'פרטים' },
    // ---- "My Tasks" tab additions (rendered ONLY in that tab) ----
    // Dedicated notes column for inline "הערות" editing in the "My Tasks" tab.
    // Owner maps this to a text / long_text column.
    taskNotesID: { type: 'long_text', title: 'הערות' },
    // Priority is a SECOND status column; the ORDER of its labels defines the
    // task's priority order (first label = highest). Rendered + sortable/
    // groupable only in the "My Tasks" tab.
    priorityID: { type: 'status', title: 'עדיפות' },
    // "סוג דיון" — a DROPDOWN column mirroring the discussions board's
    // discussionTypeID (also a dropdown). Auto-filled at task creation with the
    // parent discussion's type by label TEXT (paired with create_labels_if_missing
    // so the label is minted here if absent). The two dropdowns share the same
    // texts; the "Previous tasks by discussion type" view bridges by TEXT →
    // taskTypeID label id and filters server-side (any_of).
    taskTypeID: { type: 'dropdown', title: 'סוג דיון' },
    // ---- access columns (item 19, 2026-07-14) ----
    // Auto-filled at task creation from the parent discussion: participants →
    // viewers (read-only role), the single-person discussion roles (lead/
    // coordinator/creator) → editors (full-edit role). Mapped by the owner in
    // Settings; also usable for monday board-level column permissions.
    taskViewersID: { type: 'people', title: 'יכולת צפייה' },
    taskEditorsID: { type: 'people', title: 'יכולת עריכה' },
    topicsLinkID: { type: 'board_relation', title: 'link to נושאים לדיון1' },
    // ---- read-only display field ----
    phaseID: { type: 'text', title: 'שלב' },
  },

  topics: {
    topicCreatorID: { type: 'people', title: 'יוצר נושא' },
    // round115 — stamped automatically with TODAY at topic creation.
    topicCreationDateID: { type: 'date', title: 'תאריך יצירה' },
    // Per-topic priority — a status column on the topics board (item-level only,
    // NOT on the points/subitems). Label text + colors come from the column.
    topicPriorityID: { type: 'status', title: 'עדיפות' },
    discussionLinkID: { type: 'board_relation', title: 'דיון' },
    tasksLinkID: { type: 'board_relation', title: 'חיבור למשימות' },
    topicDetailID: { type: 'long_text', title: 'פירוט' },
    counterID: { type: 'checkbox', title: '#' },
    // "discussed" (האם נידונה) checkbox on a POINT — a real checkbox column on the
    // SUBITEMS board. The topics table renders + toggles it per point and persists
    // it to the board. When this alias is UNMAPPED the app falls back to the legacy
    // app-local flag in monday.storage (utils/discussedStore.js) so older instances
    // keep working. Display-only either way: it does NOT affect the DOCX export.
    pointCheckedID: { type: 'checkbox', title: 'האם נידונה (נקודה)', subitems: true },
    // Per-point creator (avatar) — a people column on the SUBITEMS board. Written
    // with the current user when a point is created; read back to show the avatar.
    pointCreatorID: { type: 'people', title: 'יוצר נקודה', subitems: true },
    // round115 — per-POINT creation date on the SUBITEMS board, stamped with
    // TODAY when a point is created.
    pointCreationDateID: { type: 'date', title: 'תאריך יצירה (נקודה)', subitems: true },
    // Free-text responses/comments per POINT — a long_text column on the SUBITEMS
    // board, inline-editable in the topics table (mirrors the tasks notes column).
    pointResponsesID: { type: 'long_text', title: 'התייחסויות (נקודה)', subitems: true },
    // "should display?" — CHECKED = show the topic/point in the app + include
    // in the export; UNCHECKED = hidden (dimmed) + excluded. (The names keep the
    // historical "NotForDiscussion" concept; the polarity is inverted at
    // read/write time in useTopics/templates/docxExport.)
    topicNotForDiscussionID: { type: 'checkbox', title: 'האם להציג (נושא)' },
    pointNotForDiscussionID: { type: 'checkbox', title: 'האם להציג (נקודה)', subitems: true },
    // Per-POINT board_relation links to the decisions/tasks created from that
    // point — columns on the SUBITEMS board. create_item IGNORES board_relation
    // values, so these are written AFTER creation via change_multiple_column_values
    // on the subitems board (same path as pointCheckedID), APPENDING to the
    // existing linked ids. Per-point counters/popup read them back.
    pointDecisionsLinkID: { type: 'board_relation', title: 'החלטות (נקודה)', subitems: true },
    pointTasksLinkID: { type: 'board_relation', title: 'משימות (נקודה)', subitems: true },
  },

  // לוח החלטות — mapped MANUALLY in Settings (NOT wizard-created). The item
  // NAME is the decision text itself; discussionLinkID is the two-way pair of
  // the discussions board's decisionsBoardLinkID.
  decisions: {
    decisionCreatorID: { type: 'people', title: 'יוצר החלטה' },
    deciderID: { type: 'people', title: 'מחליט' },
    affectedID: { type: 'people', title: 'מושפעים' },
    decisionStatusID: { type: 'status', title: 'סטאטוס החלטה' },
    // round153 — a SECOND status column on decisions: "מעקב החלטה" (decision
    // tracking). Labels + default come from the mapped column; a new decision
    // defaults to "התקבלה" (see useDecisions). Mapped in Settings like any column.
    decisionTrackingID: { type: 'status', title: 'מעקב החלטה' },
    decisionPriorityID: { type: 'status', title: 'עדיפות' },
    decisionDateID: { type: 'date', title: 'תאריך' },
    discussionLinkID: { type: 'board_relation', title: 'דיון' },
  },
};

/*
 * One-time alias rename map (OLD alias -> NEW alias), per board. Existing
 * per-instance settings in monday.storage are keyed by the OLD aliases; the
 * SettingsContext load step uses this map to re-key them to the NEW aliases so
 * no mapping is lost. Idempotent: already-migrated keys aren't in this map and
 * pass through untouched. Keep in lockstep with COLUMN_SCHEMA above.
 */
export const ALIAS_MIGRATIONS = {
  discussions: {
    discussionCreator: 'discussionCreatorID',
    discussionLead: 'discussionLeadID',
    column5: 'discussionDateID',
    creationDate: 'creationDateID',
    column6: 'participantsID',
    fileColumn: 'summaryFileID',
    tasksBoardLink: 'tasksBoardLinkID',
    topicsBoardLink: 'topicsBoardLinkID',
    column23: 'discussionTypeID',
    previousDiscussion: 'previousDiscussionID',
    column7: 'totalTasksID',
    column8: 'completionPctID',
    column11: 'completedTasksID',
    column12: 'delayedTasksID',
    column13: 'delayedPctID',
    column14: 'effectivenessID',
    column22: 'totalTopicsID',
  },
  tasks: {
    taskCreator: 'taskCreatorID',
    column1: 'responsibilityID',
    column4: 'deadlineID',
    column7: 'statusID',
    column10: 'discussionLinkID',
    column16: 'detailsID',
    taskNotes: 'taskNotesID',
    priority: 'priorityID',
    linkTo1: 'topicsLinkID',
    column6: 'phaseID',
  },
  topics: {
    column: 'topicCreatorID',
    column2: 'discussionLinkID',
    tasksLink: 'tasksLinkID',
    column3: 'topicDetailID',
    column4: 'counterID',
    pointChecked: 'pointCheckedID',
    topicNotForDiscussion: 'topicNotForDiscussionID',
    pointNotForDiscussion: 'pointNotForDiscussionID',
  },
  // New board (2026-07) — no legacy aliases to migrate.
  decisions: {},
};

/*
 * Re-key a stored `columns` map (per board, alias->{id,verified,...}) from OLD
 * aliases to NEW ones using ALIAS_MIGRATIONS. Preserves each entry's value;
 * entries already under a new key (or unknown keys) pass through unchanged.
 * Returns { columns, changed } so callers can decide whether to persist.
 */
export function migrateColumnAliases(columns = {}) {
  let changed = false;
  const out = {};
  for (const boardKey of Object.keys(columns)) {
    const map = ALIAS_MIGRATIONS[boardKey] || {};
    const board = columns[boardKey] || {};
    out[boardKey] = {};
    for (const [alias, value] of Object.entries(board)) {
      const newAlias = map[alias];
      if (newAlias && newAlias !== alias) {
        // Don't clobber an already-present new key (prefer the migrated value
        // only if the new key isn't set yet).
        if (out[boardKey][newAlias] == null) out[boardKey][newAlias] = value;
        changed = true;
      } else {
        out[boardKey][alias] = value;
      }
    }
  }
  return { columns: out, changed };
}

/*
 * Build an EMPTY editable config from the schema: every board has a blank id,
 * every column has its type/title from the schema but a blank id + verified
 * false. This is the seed the Settings UI edits before anything is stored.
 * It contains NO monday ids.
 */
export function buildEmptyConfig() {
  const boards = {};
  const columns = {};
  for (const boardKey of BOARD_KEYS) {
    boards[boardKey] = { id: '' };
    columns[boardKey] = {};
    const schema = COLUMN_SCHEMA[boardKey] || {};
    for (const [alias, def] of Object.entries(schema)) {
      columns[boardKey][alias] = {
        id: '',
        type: def.type,
        title: def.title,
        verified: false,
      };
    }
  }
  return { boards, columns };
}

export function resolveColumn(boardKey, alias) {
  const col = COLUMN_SCHEMA[boardKey] && COLUMN_SCHEMA[boardKey][alias];
  if (!col) {
    logger.warn('boards.config', `no schema for alias "${alias}" on board "${boardKey}"`);
  }
  return col || null;
}

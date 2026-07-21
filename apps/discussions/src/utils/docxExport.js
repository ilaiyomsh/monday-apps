/*
 * Export a discussion to a Word (.docx) document, fully client-side, RIGHT-TO-LEFT
 * Hebrew.
 *
 * The document contains:
 *   1. Title          — the discussion name.
 *   2. Metadata       — description (detailsID) + date (discussionDateID) + participants (participantsID).
 *   3. נושאים לדיון    — only topics/points NOT marked "לא לדיון"
 *                        (pointNotForDiscussionID / topicNotForDiscussionID).
 *   4. סיכום          — the free-text summary, read from the discussion's single
 *                        editable monday Update as HTML and converted to docx
 *                        (headings / bold / lists), NOT the markdown-ish text_body.
 *   5. משימות         — this discussion's tasks + the previous discussion's tasks
 *                        merged into one table, carry-overs flagged "מדיון קודם".
 *
 * RTL recipe (verified against docx 9.7.1 type defs + issue #3419):
 *   - Document `styles.default` sets run.rightToLeft + paragraph.alignment=RIGHT
 *     globally (and on heading1..3, which otherwise override the default).
 *   - Every Paragraph also sets `bidirectional:true` + ABSOLUTE `AlignmentType.RIGHT`
 *     (START/END are direction-relative and mis-resolve → left-aligned).
 *   - Every TextRun sets `rightToLeft:true`.
 *   - Lists use a custom `numbering.config` (LevelFormat.BULLET/DECIMAL, logical
 *     start/hanging indents) — NOT the LTR `bullet:{level}` shortcut.
 *   - The tasks Table uses explicit DXA columnWidths + FIXED layout + per-cell
 *     DXA width + visuallyRightToLeft (otherwise columns collapse to zero width
 *     and Hebrew stacks one glyph per line).
 *
 * `docx` + `file-saver` are dynamically imported so they stay out of the main
 * bundle. The pure shaping helpers (filterTopicsForExport, mergeTasksForExport,
 * buildDiscussionModel) are unit-tested; renderDocx is covered by a Blob smoke test.
 */
import { api, parseValue, cvSelection } from './mondayApi/monday-client.js';
import { דיונים1Board, החלטות1Board } from './mondayApi/BoardSDK.js';
import { getColumns, getBoardId } from './mondayApi/board-config-store.js';
import { DEFAULT_EXPORT_TEMPLATE, EXPORT_FONTS, DEFAULT_EXPORT_FONT } from './mondayApi/boards.config.js';
import { loadSummaryUpdateId } from './summaryStore.js';
import { getItemUpdate } from './mondayApi/updates.js';
import { isSummaryHtmlEmpty } from './summaryHtml.js';
import { uploadFileToColumnSeamless } from './mondayApi/fileUpload.js';
import { spliceBodyIntoTemplate } from './docxTemplateMerge.js';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import logger from './logger.js';

const TASK_COLS = ['responsibilityID', 'deadlineID', 'statusID']; // assignee, deadline, status
// round192 — decisions section: decider (people), status, date. Read from the
// DECISIONS board (mapped manually), which is why an unmapped board degrades to [].
const DECISION_COLS = ['deciderID', 'decisionStatusID', 'decisionDateID'];
// round193 — decisions table trimmed to 3 columns (owner request; date + status
// dropped): מס׳, החלטה, מחליט. Sum 9000 DXA to match the tasks table width.
const DECISION_COL_WIDTHS = [700, 5300, 3000];
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const HEADER_FILL = '4F6B8F';
// round191 — the "מדיון קודם" column was removed (owner request); its 900 DXA were
// folded into the task-name column so the table still fills the same width.
// 5 task columns, DXA (twips): #, task, assignee, deadline, status. Sum 9000.
const TASK_COL_WIDTHS = [600, 3800, 1900, 1400, 1300];

// Decode a base64 string to a Uint8Array (browser + node/jsdom both have atob).
function base64ToU8(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
  return u8;
}

/**
 * Parse an image data URI into the shape docx's ImageRun needs: { type, data,
 * width, height }. docx requires explicit pixel dimensions, so we read them from
 * the file header (PNG IHDR / JPEG SOF / GIF logical screen) — a pure, synchronous
 * parse that works in tests (no async Image decode). Returns null on anything it
 * can't confidently read, so a bad logo degrades to "no logo" rather than throwing.
 */
export function parseImageMeta(dataUri) {
  try {
    const m = /^data:image\/(png|jpe?g|gif);base64,([A-Za-z0-9+/=]+)$/.exec((dataUri || '').trim());
    if (!m) return null;
    const kind = m[1] === 'png' ? 'png' : m[1] === 'gif' ? 'gif' : 'jpg';
    const data = base64ToU8(m[2]);
    let width = 0;
    let height = 0;
    if (kind === 'png') {
      // 8-byte signature, then 4-byte length + "IHDR"; width/height big-endian at 16/20.
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(16);
      height = dv.getUint32(20);
    } else if (kind === 'gif') {
      width = data[6] | (data[7] << 8);
      height = data[8] | (data[9] << 8);
    } else {
      // JPEG: scan segments for a Start-Of-Frame marker (0xFFC0..0xFFCF except C4/C8/CC).
      let i = 2;
      while (i + 9 < data.length) {
        if (data[i] !== 0xff) { i += 1; continue; }
        const marker = data[i + 1];
        const len = (data[i + 2] << 8) | data[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          height = (data[i + 5] << 8) | data[i + 6];
          width = (data[i + 7] << 8) | data[i + 8];
          break;
        }
        i += 2 + len;
      }
    }
    if (!width || !height) return null;
    return { type: kind, data, width, height };
  } catch (err) {
    // Malformed/unsupported logo data URI — skip the logo rather than break export.
    logger.warn('docxExport', 'פענוח מטא-נתוני הלוגו נכשל — הלוגו יושמט מהייצוא', err);
    return null;
  }
}

function readCheckbox(columnValues, columnId) {
  if (!columnId) return false;
  const cv = (columnValues || []).find((c) => c.id === columnId);
  return cv?.checked === true;
}

/* ----------------------------------------------------------- pure shaping */

/**
 * Keep only topics/points that are "for discussion": drop topics flagged
 * topicNotForDiscussionID, drop points flagged pointNotForDiscussionID, and drop
 * topics left with no points. Accepts the useTopics shape (_subitems) or a
 * pre-shaped { points } list. Returns [{ name, points: [{ name }] }].
 */
export function filterTopicsForExport(topics = []) {
  return topics
    .filter((t) => !t?.notForDiscussion)
    .map((t) => ({
      name: t?.name || '',
      points: (t?._subitems || t?.points || [])
        .filter((p) => !p?.notForDiscussion)
        .map((p) => ({ name: p?.name || '' })),
    }))
    .filter((t) => t.points.length > 0);
}

/**
 * Merge current + previous discussion tasks into one list, de-duplicated by id.
 * A task present in BOTH is shown once as current (fromPrevious:false) — the
 * current discussion wins. Tasks only in the previous discussion are tagged
 * fromPrevious:true (the "מדיון קודם" column).
 */
export function mergeTasksForExport(currentTasks = [], previousTasks = []) {
  const seen = new Set();
  const out = [];
  for (const t of currentTasks) {
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ ...t, fromPrevious: false });
  }
  for (const t of previousTasks) {
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ ...t, fromPrevious: true });
  }
  return out;
}

// Short numeric date DD.MM.YYYY (e.g. 05.07.2026) — NOT the long "יום ראשון 5
// ביולי" form. Accepts a Date or an ISO-ish "YYYY-MM-DD..." string; anything else
// is passed through as-is.
function formatHeDate(value) {
  const pad = (n) => String(n).padStart(2, '0');
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getUTCDate())}.${pad(value.getUTCMonth() + 1)}.${value.getUTCFullYear()}`;
  }
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    return value.trim();
  }
  return value ? String(value) : '';
}

/**
 * Assemble the document-ready model from raw fetched data. Pure: dates/people
 * become plain strings and topics are filtered, so the renderer is simple and the
 * shaping is testable without docx. The summary stays as HTML (`summaryHtml`) and
 * is converted to docx inside renderDocx (needs the docx classes + DOMParser).
 */
export function buildDiscussionModel({ discussion, topics = [], summaryHtml = '', tasks = [], decisions = [], previousDiscussionName = '', typeLabel = '' }) {
  const participants = Array.isArray(discussion?.participantsID) ? discussion.participantsID : [];
  const lead = Array.isArray(discussion?.discussionLeadID) ? discussion.discussionLeadID : [];
  // "סוג" is a status column — its value is a label id; the caller resolves the
  // label text (typeLabel) since the labels live on the column, not the item.
  const typesText = (typeof typeLabel === 'string' ? typeLabel.trim() : '');
  return {
    title: discussion?.name || 'דיון',
    dateText: formatHeDate(discussion?.discussionDateID),
    participantsText: participants.map((p) => p?.name).filter(Boolean).join(', '),
    leadText: lead.map((p) => p?.name).filter(Boolean).join(', '),
    typesText,
    previousText: previousDiscussionName || '',
    topics: filterTopicsForExport(topics),
    summaryHtml: summaryHtml || '',
    // round191 — the exported tasks table is ordered by RESPONSIBLE (owner request):
    // all of one person's tasks together, then the next. Stable sort by assignee
    // text (Hebrew collation); tasks with no assignee sort last.
    tasks: tasks
      .map((t) => ({
        name: t?.name || '',
        assigneesText: (Array.isArray(t?.assignees) ? t.assignees : []).map((p) => p?.name).filter(Boolean).join(', '),
        deadlineText: formatHeDate(t?.deadline),
        status: t?.status || '',
        fromPrevious: !!t?.fromPrevious,
      }))
      .sort((a, b) => {
        if (!a.assigneesText && !b.assigneesText) return 0;
        if (!a.assigneesText) return 1;
        if (!b.assigneesText) return -1;
        return a.assigneesText.localeCompare(b.assigneesText, 'he');
      }),
    // round192 — decisions section (owner request): each decision's text (name) +
    // decider (מחליט) + date + status label, shaped to plain strings like tasks.
    decisions: (Array.isArray(decisions) ? decisions : []).map((d) => ({
      name: d?.name || '',
      deciderText: (Array.isArray(d?.decider) ? d.decider : []).map((p) => p?.name).filter(Boolean).join(', '),
      dateText: formatHeDate(d?.date),
      status: d?.status || '',
    })),
  };
}

/* ------------------------------------------------------------- data fetch */

async function fetchTopicsForExport(discussionId) {
  const topicsBoardLinkId = getColumns('discussions')?.topicsBoardLinkID?.id;
  if (!topicsBoardLinkId) return [];
  const topicCols = getColumns('topics') || {};
  const topicNfdId = topicCols.topicNotForDiscussionID?.id || null;
  const pointNfdId = topicCols.pointNotForDiscussionID?.id || null;

  const data = await api(
    `query ($discussionId: ID!, $relationCol: [String!], $topicCols: [String!], $pointCols: [String!]) {
      items(ids: [$discussionId]) {
        column_values(ids: $relationCol) {
          ... on BoardRelationValue {
            linked_items {
              id
              name
              column_values(ids: $topicCols) { id ... on CheckboxValue { checked } }
              subitems {
                id
                name
                column_values(ids: $pointCols) { id ... on CheckboxValue { checked } }
              }
            }
          }
        }
      }
    }`,
    {
      discussionId: String(discussionId),
      relationCol: [String(topicsBoardLinkId)],
      topicCols: topicNfdId ? [topicNfdId] : [],
      pointCols: pointNfdId ? [pointNfdId] : [],
    },
    'docxExport.fetchTopics'
  );

  const linkedTopics = data?.items?.[0]?.column_values?.[0]?.linked_items || [];
  return linkedTopics.map((topic) => ({
    name: topic.name,
    // Board column "האם להציג?" CHECKED = show; `notForDiscussion` (excluded
    // from export) is the inverse of the checkbox.
    notForDiscussion: !readCheckbox(topic.column_values, topicNfdId),
    _subitems: (topic.subitems || []).map((sub) => ({
      name: sub.name,
      notForDiscussion: !readCheckbox(sub.column_values, pointNfdId),
    })),
  }));
}

// Read a discussion's tasks off its tasksBoardLinkID relation (the same
// discussion-side read useTasks/PreviousTasksTab use). Returns app-shaped tasks.
async function fetchTasksOfDiscussion(discussionId) {
  const tasksBoardLinkId = getColumns('discussions')?.tasksBoardLinkID?.id;
  if (!tasksBoardLinkId) return [];
  const taskColumns = getColumns('tasks') || {};
  const taskCols = TASK_COLS.map((a) => taskColumns?.[a]?.id).filter(Boolean);
  const taskCv = cvSelection(TASK_COLS.map((a) => taskColumns?.[a]?.type));

  const data = await api(
    `query ($discussionId: ID!, $relationCol: [String!], $taskCols: [String!]) {
      items(ids: [$discussionId]) {
        column_values(ids: $relationCol) {
          ... on BoardRelationValue {
            linked_items {
              id
              name
              column_values(ids: $taskCols) { ${taskCv} }
            }
          }
        }
      }
    }`,
    { discussionId: String(discussionId), relationCol: [String(tasksBoardLinkId)], taskCols },
    'docxExport.fetchTasks'
  );

  const linked = data?.items?.[0]?.column_values?.[0]?.linked_items || [];
  return linked.map((item) => {
    const byId = {};
    (item.column_values || []).forEach((cv) => { byId[cv.id] = cv; });
    return {
      id: String(item.id),
      name: item.name,
      assignees: parseValue('people', byId[taskColumns.responsibilityID?.id]),
      deadline: parseValue('date', byId[taskColumns.deadlineID?.id]),
      // Export shows the human label, not the stable id parseValue('status')
      // returns — the status cv carries `text` (the label) alongside `index`.
      status: byId[taskColumns.statusID?.id]?.text || '',
    };
  });
}

// Read a discussion's DECISIONS for the export. monday can't server-filter a
// board_relation by linked id, so — exactly like useDecisions' reload — we SCAN
// the decisions board and keep items whose decision-side discussionLinkID points
// at this discussion, then read the display columns (status TEXT needs the raw
// `.text`, which parseValue('status') drops for its stable index). An unmapped
// decisions board / link column is an EXPECTED state (mapped manually) → returns [].
const DECISIONS_SCAN_PAGE = 100;
const DECISIONS_SCAN_GUARD = 20;
async function fetchDecisionsOfDiscussion(discussionId) {
  const decisionsBoardId = getBoardId('decisions');
  const decisionColumns = getColumns('decisions') || {};
  const linkColId = decisionColumns?.discussionLinkID?.id;
  if (!decisionsBoardId || !linkColId) return [];

  const target = String(discussionId);
  const matchedIds = [];
  let cursor = null;
  let guard = 0;
  do {
    const res = await new החלטות1Board()
      .items()
      .withPagination({ limit: DECISIONS_SCAN_PAGE, ...(cursor ? { cursor } : {}) })
      .execute();
    for (const it of res.items || []) {
      const ids = (it.discussionLinkID?.ids || []).map(String);
      if (ids.includes(target)) matchedIds.push(String(it.id));
    }
    cursor = res.cursor || null;
    guard += 1;
  } while (cursor && guard < DECISIONS_SCAN_GUARD);
  if (!matchedIds.length) return [];

  const cols = DECISION_COLS.map((a) => decisionColumns?.[a]?.id).filter(Boolean);
  const cv = cvSelection(DECISION_COLS.map((a) => decisionColumns?.[a]?.type));
  const data = await api(
    `query ($ids: [ID!], $cols: [String!]) {
      items(ids: $ids) { id name column_values(ids: $cols) { ${cv} } }
    }`,
    { ids: matchedIds, cols },
    'docxExport.fetchDecisions'
  );
  return (data?.items || []).map((item) => {
    const byId = {};
    (item.column_values || []).forEach((c) => { byId[c.id] = c; });
    return {
      name: item.name,
      decider: parseValue('people', byId[decisionColumns.deciderID?.id]),
      // Human label, not the stable index parseValue('status') returns.
      status: byId[decisionColumns.decisionStatusID?.id]?.text || '',
      date: parseValue('date', byId[decisionColumns.decisionDateID?.id]),
    };
  });
}

// Resolve the immediate previous discussion (one level back, no recursion).
// Returns { id, name } or null — the name feeds the metadata block.
async function resolvePreviousDiscussion(discussionId) {
  const colId = getColumns('discussions')?.previousDiscussionID?.id;
  if (!colId) return null;
  try {
    const data = await api(
      `query ($discussionId: ID!, $relationCol: [String!]) {
        items(ids: [$discussionId]) {
          column_values(ids: $relationCol) { ${cvSelection(['board_relation'])} }
        }
      }`,
      { discussionId: String(discussionId), relationCol: [String(colId)] },
      'docxExport.resolvePreviousDiscussion'
    );
    const rel = parseValue('board_relation', data?.items?.[0]?.column_values?.[0]);
    const first = rel?.linkedItems?.[0];
    return first?.id ? { id: String(first.id), name: first.name || '' } : null;
  } catch (err) {
    if (!err?.__loggedId) logger.warn('docxExport', 'פענוח הדיון הקודם נכשל — מייצא ללא משימות מדיון קודם', err);
    return null;
  }
}

// The free-text summary lives in a single monday Update; its id is remembered in
// monday.storage by the Summary feature. Read its HTML body for rich rendering.
async function fetchSummaryHtml(discussionId) {
  try {
    const updateId = await loadSummaryUpdateId(discussionId);
    if (!updateId) return '';
    const update = await getItemUpdate(discussionId, updateId);
    return update?.body || '';
  } catch (err) {
    if (!err?.__loggedId) logger.warn('docxExport', 'טעינת הסיכום לייצוא נכשלה', err);
    return '';
  }
}

/* ----------------------------------------------------------- docx render */

function buildFilename(discussion) {
  const safe = String(discussion?.name || 'discussion').replace(/[\\/:*?"<>|]/g, '_').trim() || 'discussion';
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${safe} - ${stamp}.docx`;
}

// Build the docx Document from the model. docx is loaded lazily here so the
// builder (and the HTML converter that needs the docx classes) live together.
// Split from renderDocx so tests can pack the same Document to a Buffer.
//
// `template` is the per-instance export config (see DEFAULT_EXPORT_TEMPLATE). It
// drives which body sections render and in what order, plus the metadata fields
// and their labels. It defaults to DEFAULT_EXPORT_TEMPLATE so callers/tests that
// pass only a model reproduce today's output byte-for-byte.
async function buildExportDoc(model, template = DEFAULT_EXPORT_TEMPLATE, assets = null) {
  const docx = await import('docx');
  const {
    Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, AlignmentType, UnderlineType,
    Table, TableRow, TableCell, WidthType, TableLayoutType,
    VerticalAlignTable, BorderStyle,
    Header, Footer, ImageRun, PageNumber,
  } = docx;

  // RTL direction only — NO explicit w:jc. In an RTL paragraph the natural
  // alignment is the leading (right) edge; setting w:jc="right" would be read as
  // the logical END by Word/Google Docs and flip the text to the LEFT.
  const RTL = { bidirectional: true };
  // Export font — resolved from the per-instance template.font key (see
  // EXPORT_FONTS). Defaults to `brand` (Figtree Latin/numerals + Noto Sans Hebrew
  // complex-script), matching the app's on-screen typography and today's output.
  const FONT = (EXPORT_FONTS[template?.font] || EXPORT_FONTS[DEFAULT_EXPORT_FONT]).docx;
  const run = (text, extra) => new TextRun({ text: String(text ?? ''), rightToLeft: true, ...extra });
  const para = (text, extra) => new Paragraph({ ...RTL, children: [run(text, extra)] });
  const heading = (text, level) => new Paragraph({ ...RTL, heading: level, children: [run(text)] });

  // ---- summary HTML -> docx paragraphs. The monday Update body carries rich
  // formatting (per summaryHtml.js): h1-3, p, strong/b, em/i, u, s/del,
  // span[style:color|font-size], block text-align, a[href], ul/ol (nested) and
  // checklists (<ul class="checklist"><li class="checklist_task is_checked">). We
  // preserve all of it so the exported summary matches what the user authored.
  const HEADING_BY_TAG = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 };
  const styleMap = (el) => {
    const out = {};
    const s = (el.getAttribute && el.getAttribute('style')) || '';
    s.split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) out[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); });
    return out;
  };
  const toHex = (c) => {
    if (!c) return null;
    const v = c.trim();
    let m = v.match(/^#([0-9a-fA-F]{6})$/); if (m) return m[1].toUpperCase();
    m = v.match(/^#([0-9a-fA-F]{3})$/); if (m) return m[1].split('').map((x) => x + x).join('').toUpperCase();
    m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
    return null; // named colors: leave to default
  };
  const toHalfPoints = (fs) => {
    const m = String(fs || '').match(/^([\d.]+)\s*(px|pt)?$/i);
    if (!m) return null;
    const val = parseFloat(m[1]); if (!val) return null;
    const pt = m[2] && m[2].toLowerCase() === 'pt' ? val : val * 0.75; // unitless/px -> pt
    return Math.max(2, Math.round(pt * 2));
  };
  // Map the summary's physical text-align to LOGICAL alignment so it behaves
  // correctly in an RTL paragraph: start = right, end = left.
  const alignFromStyle = (el) => {
    const ta = styleMap(el)['text-align'];
    if (ta === 'center') return AlignmentType.CENTER;
    if (ta === 'justify') return AlignmentType.JUSTIFIED;
    if (ta === 'left') return AlignmentType.END;    // physical left in RTL
    if (ta === 'right') return AlignmentType.START; // physical right in RTL
    return null; // natural: RTL leading edge = right (omit w:jc)
  };
  const blockProps = (el) => {
    const a = alignFromStyle(el);
    return a ? { bidirectional: true, alignment: a } : { bidirectional: true };
  };

  const inlineRuns = (node, fmt, out) => {
    if (node.nodeType === 3) { const t = node.textContent; if (t) out.push(run(t, fmt)); return; }
    if (node.nodeType !== 1) return;
    const tag = node.nodeName.toLowerCase();
    if (tag === 'br') { out.push(new TextRun({ text: '', break: 1, rightToLeft: true })); return; }
    if (tag === 'ul' || tag === 'ol') return; // nested lists handled by emitList
    if (tag === 'a') {
      const href = (node.getAttribute('href') || '').trim();
      const linkFmt = { ...fmt, color: '0563C1', underline: { type: UnderlineType.SINGLE } };
      const inner = [];
      node.childNodes.forEach((c) => inlineRuns(c, linkFmt, inner));
      if (href && inner.length) out.push(new ExternalHyperlink({ link: href, children: inner }));
      else inner.forEach((r) => out.push(r));
      return;
    }
    const next = { ...fmt };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italics = true;
    if (tag === 'u') next.underline = { type: UnderlineType.SINGLE };
    if (tag === 's' || tag === 'del') next.strike = true;
    if (tag === 'span') {
      const st = styleMap(node);
      const hex = toHex(st.color); if (hex) next.color = hex;
      const sz = toHalfPoints(st['font-size']); if (sz) next.size = sz;
    }
    node.childNodes.forEach((c) => inlineRuns(c, next, out));
  };
  const runsFor = (el) => {
    const out = [];
    el.childNodes.forEach((c) => inlineRuns(c, {}, out));
    return out.length ? out : [run('')];
  };
  const htmlToParagraphs = (html) => {
    if (typeof DOMParser === 'undefined') return [para(String(html || '').replace(/<[^>]+>/g, ' ').trim())];
    const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
    const paras = [];
    const emitList = (listEl, ordered, level) => {
      const checklist = !!(listEl.classList && listEl.classList.contains('checklist'));
      let idx = 1;
      Array.from(listEl.children).forEach((li) => {
        if (li.nodeName.toLowerCase() !== 'li') return;
        // Literal RTL marker prefix (Word's RTL list numbering renders detached).
        let marker;
        if (checklist) marker = (li.classList && li.classList.contains('is_checked')) ? '☑  ' : '☐  ';
        else if (ordered) { marker = `${idx}.  `; idx += 1; }
        else marker = level % 2 === 1 ? '◦  ' : '•  ';
        paras.push(new Paragraph({ ...blockProps(li), indent: { start: 360 * (level + 1) }, children: [run(marker), ...runsFor(li)] }));
        Array.from(li.children)
          .filter((c) => /^(ul|ol)$/i.test(c.nodeName))
          .forEach((n) => emitList(n, n.nodeName.toLowerCase() === 'ol', level + 1));
      });
    };
    Array.from(body.childNodes).forEach((node) => {
      // Bare top-level text (between/around blocks) becomes its own paragraph so
      // it's never dropped or mashed into a neighbouring block.
      if (node.nodeType === 3) {
        const t = node.textContent;
        if (t && t.trim()) paras.push(new Paragraph({ ...RTL, children: [run(t)] }));
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.nodeName.toLowerCase();
      if (HEADING_BY_TAG[tag]) paras.push(new Paragraph({ ...blockProps(node), heading: HEADING_BY_TAG[tag], children: runsFor(node) }));
      else if (tag === 'ul' || tag === 'ol') emitList(node, tag === 'ol', 0);
      else if (tag === 'hr') return; // separator — skip
      else paras.push(new Paragraph({ ...blockProps(node), children: runsFor(node) }));
    });
    return paras;
  };

  // ---- section builders. Each returns an array of docx children for one body
  // section. The composition is data-driven (see the loop below), but every
  // builder still emits through the SAME primitives (run/para/heading, the FIXED
  // table) so the RTL recipe is preserved regardless of order/selection.

  // Metadata — right-aligned (RTL natural leading edge), each line only when its
  // value exists (never "סוג: null"). The LABEL is bold, the value plain. Fields,
  // their order, and their labels come from the template's meta section.
  const metaPara = (label, value) =>
    new Paragraph({ ...RTL, children: [run(`${label}: `, { bold: true }), run(value)] });
  const buildMeta = (section) => {
    const out = [];
    const fields = Array.isArray(section?.fields) ? section.fields : [];
    for (const f of fields) {
      if (!f || f.enabled === false) continue;
      const value = model[f.key];
      if (value) out.push(metaPara(f.label || '', value));
    }
    return out;
  };

  const buildTopics = (section) => {
    const out = [heading(section?.label || 'נושאים לדיון', HeadingLevel.HEADING_2)];
    if (!model.topics.length) {
      out.push(para('אין נושאים לדיון.'));
    } else {
      for (const topic of model.topics) {
        // Topic headings are indented inward (start = RTL leading edge), with their
        // points indented one level deeper, so the נושאים hierarchy reads clearly.
        out.push(new Paragraph({ ...RTL, heading: HeadingLevel.HEADING_3, indent: { start: 360 }, children: [run(topic.name)] }));
        for (const point of topic.points) {
          out.push(new Paragraph({ ...RTL, indent: { start: 720 }, children: [run(`•  ${point.name}`)] }));
        }
      }
    }
    return out;
  };

  const buildSummary = (section) => {
    const out = [heading(section?.label || 'סיכום', HeadingLevel.HEADING_2)];
    if (isSummaryHtmlEmpty(model.summaryHtml)) out.push(para('אין סיכום.'));
    else out.push(...htmlToParagraphs(model.summaryHtml));
    return out;
  };

  const buildTasks = (section) => {
    // `keepNext` keeps the heading with the first table row; combined with keepNext
    // on every cell paragraph + cantSplit on every row, Word keeps the whole table
    // together and pushes it to the next page rather than splitting it (req: the
    // tasks table must never be cut across pages).
    const out = [new Paragraph({ ...RTL, keepNext: true, heading: HeadingLevel.HEADING_2, children: [run(section?.label || 'משימות')] })];
    if (!model.tasks.length) {
      out.push(para('אין משימות.'));
      return out;
    }
    // Every column is centered EXCEPT the task name, which stays right-aligned
    // (RTL natural leading edge — omit alignment so weak viewers don't flip it).
    const cell = (text, widthDxa, isHeader, center) => new TableCell({
      width: { size: widthDxa, type: WidthType.DXA },
      verticalAlign: VerticalAlignTable.CENTER,
      shading: isHeader ? { type: 'clear', color: 'auto', fill: HEADER_FILL } : undefined,
      margins: { marginUnitType: WidthType.DXA, top: 40, bottom: 40, left: 90, right: 90 },
      children: [new Paragraph({
        ...RTL,
        ...(center ? { alignment: AlignmentType.CENTER } : {}),
        keepNext: true,
        children: [run(text, isHeader ? { bold: true, color: 'FFFFFF' } : undefined)],
      })],
    });
    const NAME_COL = 1; // the "משימה" column — right-aligned, all others centered.
    // round191 — the "מדיון קודם" column was removed (owner request); 5 columns now.
    const headers = ['מס׳', 'משימה', 'אחראי', 'דד ליין', 'סטטוס'];
    const rows = [new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, TASK_COL_WIDTHS[i], true, i !== NAME_COL)) })];
    model.tasks.forEach((t, i) => {
      rows.push(new TableRow({
        cantSplit: true,
        children: [
          cell(String(i + 1), TASK_COL_WIDTHS[0], false, true),
          cell(t.name, TASK_COL_WIDTHS[1], false, false),
          cell(t.assigneesText, TASK_COL_WIDTHS[2], false, true),
          cell(t.deadlineText, TASK_COL_WIDTHS[3], false, true),
          cell(t.status || '—', TASK_COL_WIDTHS[4], false, true),
        ],
      }));
    });
    const border = { style: BorderStyle.SINGLE, size: 2, color: 'D9D9D9' };
    out.push(new Table({
      columnWidths: TASK_COL_WIDTHS,
      layout: TableLayoutType.FIXED,
      width: { size: TASK_COL_WIDTHS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
      visuallyRightToLeft: true,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows,
    }));
    return out;
  };

  // round192 — decisions table (owner request): same monday-board look as the tasks
  // table (heading kept with the table via keepNext/cantSplit). Columns:
  // מס׳ · החלטה · מחליט · תאריך · סטאטוס. The "החלטה" (name) column is right-aligned;
  // the rest centered.
  const buildDecisions = (section) => {
    const out = [new Paragraph({ ...RTL, keepNext: true, heading: HeadingLevel.HEADING_2, children: [run(section?.label || 'החלטות')] })];
    if (!model.decisions.length) {
      out.push(para('אין החלטות.'));
      return out;
    }
    const cell = (text, widthDxa, isHeader, center) => new TableCell({
      width: { size: widthDxa, type: WidthType.DXA },
      verticalAlign: VerticalAlignTable.CENTER,
      shading: isHeader ? { type: 'clear', color: 'auto', fill: HEADER_FILL } : undefined,
      margins: { marginUnitType: WidthType.DXA, top: 40, bottom: 40, left: 90, right: 90 },
      children: [new Paragraph({
        ...RTL,
        ...(center ? { alignment: AlignmentType.CENTER } : {}),
        keepNext: true,
        children: [run(text, isHeader ? { bold: true, color: 'FFFFFF' } : undefined)],
      })],
    });
    const NAME_COL = 1; // "החלטה" — right-aligned, all others centered.
    // round193 — only מס׳ · החלטה · מחליט (date + status columns removed).
    const headers = ['מס׳', 'החלטה', 'מחליט'];
    const rows = [new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, DECISION_COL_WIDTHS[i], true, i !== NAME_COL)) })];
    model.decisions.forEach((d, i) => {
      rows.push(new TableRow({
        cantSplit: true,
        children: [
          cell(String(i + 1), DECISION_COL_WIDTHS[0], false, true),
          cell(d.name, DECISION_COL_WIDTHS[1], false, false),
          cell(d.deciderText, DECISION_COL_WIDTHS[2], false, true),
        ],
      }));
    });
    const border = { style: BorderStyle.SINGLE, size: 2, color: 'D9D9D9' };
    out.push(new Table({
      columnWidths: DECISION_COL_WIDTHS,
      layout: TableLayoutType.FIXED,
      width: { size: DECISION_COL_WIDTHS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
      visuallyRightToLeft: true,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows,
    }));
    return out;
  };

  // Free-text block — a heading (its title) + one paragraph per line of body.
  // Emits nothing when both title and body are empty.
  const buildFreeText = (section) => {
    const title = (section?.title || '').trim();
    const body = section?.body || '';
    if (!title && !body) return [];
    const out = [];
    if (title) out.push(heading(title, HeadingLevel.HEADING_2));
    String(body).split(/\r?\n/).forEach((line) => out.push(para(line)));
    return out;
  };

  // ---- assemble (data-driven). Title is always first; the rest is driven by the
  // template's ordered `sections` list (skip disabled), so reordering/toggling in
  // Settings changes the document without touching this code.
  const children = [];
  children.push(new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, children: [run(`סיכום דיון: ${model.title}`)] }));

  const sections = Array.isArray(template?.sections) ? template.sections : DEFAULT_EXPORT_TEMPLATE.sections;
  for (const section of sections) {
    if (!section || section.enabled === false) continue;
    switch (section.key) {
      case 'meta': children.push(...buildMeta(section)); break;
      case 'topics': children.push(...buildTopics(section)); break;
      case 'summary': children.push(...buildSummary(section)); break;
      case 'tasks': children.push(...buildTasks(section)); break;
      case 'decisions': children.push(...buildDecisions(section)); break;
      case 'freeText': children.push(...buildFreeText(section)); break;
      default: break;
    }
  }

  // ---- CONFIG-mode header/footer bands. Each band = optional logo paragraph +
  // multi-line text + a metadata/page-number line. Physical alignment maps to
  // LOGICAL in RTL (right = START, left = END) so weak viewers don't flip it.
  // Returns null when the band has no content (so no empty header/footer is
  // attached — keeps the default template's output header-less, as today).
  const alignFor = (a) => (a === 'center' ? AlignmentType.CENTER : a === 'left' ? AlignmentType.END : AlignmentType.START);
  const logoParagraph = (dataUri, pos) => {
    const meta = parseImageMeta(dataUri);
    if (!meta) return null;
    const maxH = 50; // px — cap logo height, preserve aspect ratio
    const width = Math.max(1, Math.round(meta.width * (maxH / meta.height)));
    return new Paragraph({
      bidirectional: true,
      alignment: alignFor(pos),
      children: [new ImageRun({ type: meta.type, data: meta.data, transformation: { width, height: maxH } })],
    });
  };
  const buildBand = (cfg, logoDataUri, isFooter) => {
    if (!cfg) return null;
    const paras = [];
    if (cfg.hasLogo && logoDataUri) {
      const lp = logoParagraph(logoDataUri, cfg.logoPos);
      if (lp) paras.push(lp);
    }
    const text = (cfg.text || '').trim();
    if (text) {
      text.split(/\r?\n/).forEach((line) =>
        paras.push(new Paragraph({ bidirectional: true, alignment: alignFor(cfg.textAlign), children: [run(line)] })));
    }
    // metadata line: discussion name / date (both bands), and page number (footer).
    const metaBits = [];
    if (cfg.meta?.name && model.title) metaBits.push(run(model.title));
    if (cfg.meta?.date && model.dateText) metaBits.push(run(model.dateText));
    if (isFooter && cfg.meta?.page) {
      metaBits.push(run('עמוד '));
      metaBits.push(new TextRun({ rightToLeft: true, children: [PageNumber.CURRENT] }));
      metaBits.push(run(' מתוך '));
      metaBits.push(new TextRun({ rightToLeft: true, children: [PageNumber.TOTAL_PAGES] }));
    }
    if (metaBits.length) {
      // name/date/page runs on one line (the page label carries its own words).
      paras.push(new Paragraph({ bidirectional: true, alignment: alignFor(cfg.textAlign), children: metaBits }));
    }
    return paras.length ? paras : null;
  };

  // Header/footer only in CONFIG mode (UPLOAD mode splices them from the uploaded
  // .docx — see docxTemplateMerge). buildBand returns null when empty.
  const isConfigMode = (template?.headerMode || DEFAULT_EXPORT_TEMPLATE.headerMode) !== 'upload';
  const headerParas = isConfigMode ? buildBand(template?.header, assets?.headerLogo, false) : null;
  const footerParas = isConfigMode ? buildBand(template?.footer, assets?.footerLogo, true) : null;
  const section = { children };
  if (headerParas) section.headers = { default: new Header({ children: headerParas }) };
  if (footerParas) section.footers = { default: new Footer({ children: footerParas }) };

  const doc = new Document({
    styles: {
      default: {
        // monday fonts (see FONT above); he-IL as the complex-script proofing language so
        // Word doesn't flag every Hebrew word as a spelling error (en-US stays the
        // western language for Latin names/dates). Sizes are half-points:
        // body 12pt(24), heading1 18pt(36), heading2/3 14pt(28)/12pt(24). Font is
        // re-set on each heading because heading styles otherwise fall back to the
        // theme heading font instead of inheriting the body font.
        document: { run: { rightToLeft: true, font: FONT, size: 24, language: { value: 'en-US', bidirectional: 'he-IL' } } },
        heading1: { run: { rightToLeft: true, font: FONT, bold: true, size: 36, color: '1F3864' }, paragraph: { spacing: { before: 240, after: 160 } } },
        // Extra `before` spacing visually separates the top-level sections
        // (נושאים / סיכום / משימות).
        heading2: { run: { rightToLeft: true, font: FONT, bold: true, size: 28, color: '2E5496' }, paragraph: { spacing: { before: 400, after: 160 } } },
        heading3: { run: { rightToLeft: true, font: FONT, bold: true, size: 24, color: '44546A' }, paragraph: { spacing: { before: 200, after: 80 } } },
      },
    },
    sections: [section],
  });
  return { Packer, doc };
}

// Some viewers (macOS Quick Look / Pages) ignore paragraph-level RTL (w:bidi /
// w:jc) and render the doc left-aligned, even though Word, Google Docs and
// TextEdit honor it. docx 9.7.1 can't set SECTION-level RTL, so we inject
// <w:bidi/> into each <w:sectPr> after packing — the document-wide RTL signal
// weak viewers respect. Pure byte surgery; on any failure we return the original
// bytes so the export never breaks over this nicety.
export function injectSectionRtlIntoZip(bytes) {
  try {
    const files = unzipSync(bytes);
    const key = 'word/document.xml';
    if (!files[key]) return bytes;
    let xml = strFromU8(files[key]);
    if (/<w:bidi\/>\s*<w:docGrid/.test(xml)) return bytes; // already injected
    // In CT_SectPr, <w:bidi/> must precede <w:docGrid>; fall back to end of sectPr.
    if (xml.includes('<w:docGrid')) xml = xml.replace(/<w:docGrid/g, '<w:bidi/><w:docGrid');
    else xml = xml.replace(/<\/w:sectPr>/g, '<w:bidi/></w:sectPr>');
    files[key] = strToU8(xml);
    return zipSync(files, { level: 6 });
  } catch (err) {
    // Byte-surgery is a rendering nicety; on any failure return the original bytes
    // so the export never breaks over it.
    logger.warn('docxExport', 'הזרקת RTL ברמת ה-section נכשלה — מייצא את הקובץ ללא ההתאמה', err);
    return bytes;
  }
}

// Turn the model into a .docx Blob (browser download path), with section-level
// RTL injected so it renders right-to-left in every viewer. `template` selects
// which sections/fields render (defaults to today's layout).
export async function renderDocx(model, template = DEFAULT_EXPORT_TEMPLATE, assets = null) {
  const { Packer, doc } = await buildExportDoc(model, template, assets);
  const blob = await Packer.toBlob(doc);
  if (typeof blob.arrayBuffer !== 'function') return blob; // jsdom/test: skip injection
  const bytes = injectSectionRtlIntoZip(new Uint8Array(await blob.arrayBuffer()));
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// Test-only: lets tests pack the Document to a Buffer (Packer.toBuffer) for OOXML
// inspection, since jsdom Blobs lack arrayBuffer().
export const __testHooks = { buildExportDoc };

/* --------------------------------------------------------------- orchestrate */

/**
 * Fetch everything for a discussion, build the .docx, download it, and — if a
 * file column is mapped — also upload it into that column via the TOKENLESS
 * seamless monday.api(). Throws on a hard build/fetch failure (already
 * logged/toasted by the api() funnel). The upload is best-effort: a failure is
 * logged but never blocks the local download.
 *
 * @returns {{ uploadAttempted: boolean, uploaded: boolean }}
 */
export async function exportDiscussionToDocx(discussion, { template = DEFAULT_EXPORT_TEMPLATE, assets = null } = {}) {
  if (!discussion?.id) throw new Error('exportDiscussionToDocx: discussion is required');
  const discussionId = String(discussion.id);

  const [topics, summaryHtml, currentTasks, decisions, previous, fullDiscussion] = await Promise.all([
    fetchTopicsForExport(discussionId),
    fetchSummaryHtml(discussionId),
    fetchTasksOfDiscussion(discussionId),
    fetchDecisionsOfDiscussion(discussionId),
    resolvePreviousDiscussion(discussionId),
    // The list is lean (id/name/date), so fetch the discussion's own columns
    // (participants, lead, type, description) for the metadata block. Best-effort.
    new דיונים1Board().itemById(discussionId).catch(() => null),
  ]);
  const previousTasks = previous?.id ? await fetchTasksOfDiscussion(previous.id) : [];
  const mergedDiscussion = { ...discussion, ...(fullDiscussion || {}) };
  // "סוג" is a dropdown value = the label TEXT on the item — use it directly.
  const typeLabel = mergedDiscussion.discussionTypeID || '';

  const model = buildDiscussionModel({
    discussion: mergedDiscussion,
    topics,
    summaryHtml,
    tasks: mergeTasksForExport(currentTasks, previousTasks),
    decisions,
    previousDiscussionName: previous?.name || '',
    typeLabel,
  });

  const filename = buildFilename(discussion);
  // UPLOAD mode: render a body-only .docx (buildExportDoc omits header/footer when
  // headerMode==='upload') and splice it into the owner's uploaded template so its
  // header/footer survive. Any failure falls back to the plain render so export
  // never breaks over the splice.
  const headerMode = template?.headerMode || DEFAULT_EXPORT_TEMPLATE.headerMode;
  let blob;
  if (headerMode === 'upload' && assets?.templateDocx) {
    try {
      const genBlob = await renderDocx(model, template, assets);
      if (typeof genBlob.arrayBuffer === 'function') {
        const genBytes = new Uint8Array(await genBlob.arrayBuffer());
        const tplBytes = base64ToU8(assets.templateDocx);
        const merged = injectSectionRtlIntoZip(spliceBodyIntoTemplate(tplBytes, genBytes));
        blob = new Blob([merged], { type: DOCX_MIME });
      } else {
        blob = genBlob; // jsdom/test path — no arrayBuffer; skip splice
      }
    } catch (err) {
      logger.warn('docxExport', 'שילוב התבנית שהועלתה נכשל — מייצא ללא הכותרות מהקובץ', err);
      blob = await renderDocx(model, template, assets);
    }
  } else {
    blob = await renderDocx(model, template, assets);
  }
  const { saveAs } = await import('file-saver');
  saveAs(blob, filename);

  // Tokenless, best-effort upload into the discussion's file column via seamless
  // monday.api(). Attempted whenever a file column is mapped; a failure (e.g. if
  // the iframe bridge can't forward a File) is logged but never blocks the download.
  const fileColumnId = getColumns('discussions')?.summaryFileID?.id;
  const uploadAttempted = !!fileColumnId;
  let uploaded = false;
  if (uploadAttempted) {
    try {
      const file = typeof File !== 'undefined' ? new File([blob], filename, { type: DOCX_MIME }) : blob;
      await uploadFileToColumnSeamless({ itemId: discussionId, columnId: fileColumnId, file });
      uploaded = true;
    } catch (err) {
      if (!err?.__loggedId) logger.error('docxExport', 'שמירת הקובץ לעמודה (seamless monday.api) נכשלה', err);
    }
  }
  return { uploadAttempted, uploaded };
}

/*
 * Discussion TEMPLATES — shared model + apply service.
 *
 * A template is a reusable set of "fixed" discussion topics, each with a list of
 * points (נקודות). It is persisted per-instance in monday.storage by
 * TemplatesContext (key `discussions_templates_${instanceId}`) and applied to a
 * discussion either at creation time (CreateDiscussionModal) or into an existing
 * discussion (ApplyTemplateMenu in TopicsTab).
 *
 * Shape (no monday ids — only names, mirroring the simple add-topic/add-point UI):
 *   Template = { id: string, name: string, topics: Topic[] }
 *   Topic    = { name: string, points: string[] }
 *
 * createTopicsFromTemplate() reuses the exact same create_item/create_subitem
 * paths as useTopics.addTopic/addPoint, resolving the topics board + the
 * discussion relation column from the active settings store.
 */
import { api, formatValue } from './mondayApi/monday-client.js';
import { getBoardId, getColumns } from './mondayApi/board-config-store.js';
import { saveTopicOrder } from './topicOrder.js';
import logger from './logger.js';

function pointName(point) {
  return (typeof point === 'string' ? point : point?.name || '').trim();
}

// "סוג דיון" is a DROPDOWN column, so a template's type is the label TEXT (a
// non-empty string) or null when unassigned. (Legacy stores held a numeric
// status-label id; those simply won't match a text type and are treated as
// unassigned — acceptable given the clean-start migration.)
function typeKey(dt) {
  if (dt === null || dt === undefined) return null;
  const s = String(dt).trim();
  return s || null;
}

// Normalize any (possibly malformed / legacy) template-like object into the
// canonical shape. Drops topics without a name and points that are empty.
export function sanitizeTemplate(template, id) {
  const topics = Array.isArray(template?.topics) ? template.topics : [];
  const dt = template?.discussionType;
  return {
    id: id || template?.id || null,
    name: (template?.name || '').trim(),
    // Optional "סוג דיון" (label TEXT) this template is assigned to — picking that
    // type in the create modal auto-attaches this template. null = unassigned.
    discussionType: typeKey(dt),
    topics: topics
      .map((topic) => ({
        name: (topic?.name || '').trim(),
        points: (Array.isArray(topic?.points) ? topic.points : [])
          .map(pointName)
          .filter(Boolean),
      }))
      .filter((topic) => topic.name),
  };
}

// Count helpers for compact list summaries in the editor / pickers.
export function countPoints(template) {
  return (template?.topics || []).reduce(
    (sum, topic) => sum + (Array.isArray(topic?.points) ? topic.points.length : 0),
    0
  );
}

/*
 * PARTICIPANT TEMPLATES — a reusable, named set of people that can be applied to
 * a discussion's "משתתפים" picker. Persisted alongside topic templates in
 * monday.storage (its own key) by TemplatesContext.
 *
 * Shape (mirrors the PersonPicker selection shape so it drops straight in):
 *   ParticipantTemplate = { id, name, discussionType, lead: Person[], participants: Person[] }
 *   Person              = { id: string|number, kind: 'person', name: string }
 */
// Normalize a person list (PersonPicker shape) — dedup by id, drop blanks.
function sanitizePeople(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((p) => ({ id: p?.id, kind: 'person', name: (p?.name || '').trim() }))
    .filter((p) => p.id != null && !seen.has(String(p.id)) && seen.add(String(p.id)));
}

export function sanitizeParticipantTemplate(template, id) {
  const dt = template?.discussionType;
  return {
    id: id || template?.id || null,
    name: (template?.name || '').trim(),
    // Optional "סוג דיון" (label TEXT) this template is assigned to. null = unassigned.
    discussionType: typeKey(dt),
    // People per role column — shown/applied only for columns mapped in Settings.
    lead: sanitizePeople(template?.lead),
    coordinator: sanitizePeople(template?.coordinator),
    participants: sanitizePeople(template?.participants),
  };
}

/*
 * TYPE TEMPLATES — a UNIFIED, per-"סוג דיון" template that bundles BOTH the
 * fixed topics AND the people (lead + participants) for a discussion type. Unlike
 * the two standalone kinds above (each independently assignable to a type), a
 * type template is KEYED by its discussionType: there is at most ONE per type, so
 * picking a type in the create modal auto-fills topics + lead + participants in
 * one shot. Persisted in its own monday.storage key by TemplatesContext.
 *
 * Shape:
 *   TypeTemplate = { id, discussionType: string, topics: Topic[], lead, coordinator,
 *                    participants: Person[], deciderIsLead: boolean,
 *                    exportTemplate: object|null }
 *
 * `discussionType` is REQUIRED (it is the key — the label TEXT) — sanitize
 * returns null when it is missing so callers can drop malformed entries.
 *
 * round254 — `exportTemplate` (object|null): a per-type export-template CONFIG
 * that OVERRIDES the system default at export time (null ⇒ use the system
 * default). Stored raw here (a plain config object); the export dialog runs it
 * through seedExportTemplate for validation/back-fill, so this file needs no
 * knowledge of the export-template schema.
 */
export function sanitizeTypeTemplate(template, id) {
  const dt = typeKey(template?.discussionType);
  if (!dt) return null;
  const topics = Array.isArray(template?.topics) ? template.topics : [];
  const exp = template?.exportTemplate;
  return {
    id: id || template?.id || null,
    discussionType: dt,
    lead: sanitizePeople(template?.lead),
    coordinator: sanitizePeople(template?.coordinator),
    participants: sanitizePeople(template?.participants),
    // item 18 — per-type default decider flag (מחליט = מנהל הדיון). Strict
    // boolean so a stored junk value can never truthy its way in.
    deciderIsLead: template?.deciderIsLead === true,
    // round254 — a non-array object is kept as-is; anything else ⇒ null (default).
    exportTemplate: (exp && typeof exp === 'object' && !Array.isArray(exp)) ? exp : null,
    topics: topics
      .map((topic) => ({
        name: (topic?.name || '').trim(),
        points: (Array.isArray(topic?.points) ? topic.points : [])
          .map(pointName)
          .filter(Boolean),
      }))
      .filter((topic) => topic.name),
  };
}

/*
 * Create every topic of a template (and each topic's points as subitems) under
 * the given discussion. Topics and points are created sequentially to preserve
 * order and stay well under monday's complexity/rate limits.
 *
 * Errors propagate (api() throws a MondayApiError that the logger funnel already
 * surfaced as a toast); callers catch only to reset their loading state.
 *
 * opts.onProgress({ done, total }) — fired once up-front (0/total) and after
 * every created topic/point, so callers can render a REAL progress bar
 * (items 6+8). total = topics + points of the sanitized template; a listener
 * that throws is logged and never breaks the creation flow.
 *
 * @returns {Promise<{topics:number, points:number}>} how many were created.
 */
export async function createTopicsFromTemplate(discussionId, template, { onProgress, existingTopicIds = [] } = {}) {
  const clean = sanitizeTemplate(template);
  if (!discussionId || !clean.topics.length) return { topics: 0, points: 0, topicIds: [] };

  const boardId = getBoardId('topics');
  const relation = getColumns('topics')?.discussionLinkID; // board_relation: topic -> discussion
  const topicDispCol = getColumns('topics')?.topicNotForDiscussionID; // "האם להציג?" (item)
  const pointDispCol = getColumns('topics')?.pointNotForDiscussionID; // "האם להציג?" (subitem)
  // round115 — creation-date columns, stamped on every topic/point created from a
  // template (mirrors useTopics.addTopic/addPoint).
  // round267 (owner request) — the CREATOR column is intentionally NOT stamped
  // here: template/duplicate/type-default topics are generated, not authored by a
  // person, so they carry NO creator (and thus show no creator avatar). Only a
  // MANUALLY typed topic (useTopics.addTopic) gets a creator.
  const topicCreatedCol = getColumns('topics')?.topicCreationDateID;
  const pointCreatedCol = getColumns('topics')?.pointCreationDateID;

  let topicsCreated = 0;
  let pointsCreated = 0;
  const total = clean.topics.reduce((n, t) => n + 1 + t.points.length, 0);
  let done = 0;
  const report = () => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ done, total });
    } catch (err) {
      logger.warn('createTopicsFromTemplate', 'מאזין ההתקדמות נכשל — היצירה ממשיכה', err);
    }
  };
  report();

  const topicColumnValues = () => {
    const cv = {};
    if (relation?.id) {
      cv[relation.id] = formatValue(relation.type || 'board_relation', { linkedItems: [{ id: discussionId }] });
    }
    // "האם להציג?" CHECKED = show; default created topics to shown.
    if (topicDispCol?.id) cv[topicDispCol.id] = formatValue('checkbox', true);
    if (topicCreatedCol?.id) cv[topicCreatedCol.id] = formatValue('date', new Date());
    return cv;
  };
  const pointColumnValues = () => {
    const cv = pointDispCol?.id ? { [pointDispCol.id]: formatValue('checkbox', true) } : {};
    if (pointCreatedCol?.id) cv[pointCreatedCol.id] = formatValue('date', new Date());
    return cv;
  };

  // round297 — PERFORMANCE: creation used to be fully sequential (one round-trip
  // per topic AND per point), so a type template with a few topics × points took
  // many seconds. Now every TOPIC is created CONCURRENTLY, and each topic's POINTS
  // run as their own sequential chain (point order matters — no point-order map is
  // persisted) with the chains themselves in PARALLEL. Wall-time drops from
  // sum(topics+points) round-trips to ~1 (topics) + max-points-in-a-topic. Order
  // for the ribbon is preserved by the TEMPLATE index, not by creation timing.
  const topicResults = await Promise.all(clean.topics.map(async (topic, i) => {
    const res = await api(
      `mutation ($boardId: ID!, $name: String!, $columnValues: JSON!) {
        create_item(board_id: $boardId, item_name: $name, column_values: $columnValues) { id }
      }`,
      { boardId, name: topic.name, columnValues: JSON.stringify(topicColumnValues()) },
      'createTopicFromTemplate'
    );
    const topicId = res?.create_item?.id;
    if (!topicId) {
      // create_item succeeded at the API level but returned no id — can't attach
      // points. Surface the anomaly (WARN, no toast) rather than silently count it.
      logger.warn('createTopicsFromTemplate', `הנושא "${topic.name}" נוצר אך לא הוחזר מזהה — דילוג על הנקודות`);
      return { i, topicId: null, topic };
    }
    topicsCreated += 1;
    done += 1;
    report();
    return { i, topicId: String(topicId), topic };
  }));

  // Ribbon order = TEMPLATE order (by index), valid ids only.
  const createdTopicIds = topicResults
    .filter((r) => r.topicId)
    .sort((a, b) => a.i - b.i)
    .map((r) => r.topicId);

  await Promise.all(topicResults.map(async ({ topicId, topic }) => {
    if (!topicId) return;
    const pointCv = JSON.stringify(pointColumnValues());
    for (const point of topic.points) {
      await api(
        `mutation ($parentId: ID!, $name: String!, $cv: JSON!) {
          create_subitem(parent_item_id: $parentId, item_name: $name, column_values: $cv) { id }
        }`,
        { parentId: topicId, name: point, cv: pointCv },
        'createPointFromTemplate'
      );
      pointsCreated += 1;
      done += 1;
      report();
    }
  }));

  // round250 — persist the ribbon order so the template lands correctly in the
  // RTL ribbon (items[0] = rightmost): EXISTING topics keep their place, then the
  // template's topics are appended AFTER them in TEMPLATE order. Because the
  // ribbon is RTL this puts the whole template block to the LEFT of existing
  // topics (owner request E), with the template's FIRST topic to the right of its
  // second, etc. (owner request D). On a fresh discussion (existingTopicIds=[])
  // this simply orders the template topics first-to-last = right-to-left.
  if (createdTopicIds.length) {
    try {
      await saveTopicOrder(discussionId, [...existingTopicIds.map(String), ...createdTopicIds]);
    } catch (err) {
      // best-effort: a failed order save just leaves the API/default order.
      logger.warn('createTopicsFromTemplate', 'שמירת סדר הנושאים מהתבנית נכשלה', err);
    }
  }

  return { topics: topicsCreated, points: pointsCreated, topicIds: createdTopicIds };
}

/*
 * Read a discussion's existing topics (and their points = subitems) back into
 * the plain template shape { topics: [{ name, points: string[] }] }, so the
 * same createTopicsFromTemplate() path can clone them onto another discussion
 * (used by "duplicate discussion"). Best-effort: returns { topics: [] } when the
 * topics relation isn't mapped or the read fails.
 */
export async function readDiscussionTopicsAsTemplate(discussionId) {
  if (!discussionId) return { topics: [] };
  const topicsBoardLinkId = getColumns('discussions')?.topicsBoardLinkID?.id;
  if (!topicsBoardLinkId) return { topics: [] };

  try {
    const data = await api(
      `query ($discussionId: ID!, $relationCol: [String!]) {
        items(ids: [$discussionId]) {
          column_values(ids: $relationCol) {
            ... on BoardRelationValue {
              linked_items {
                name
                subitems { name }
              }
            }
          }
        }
      }`,
      { discussionId: String(discussionId), relationCol: [topicsBoardLinkId] },
      'readDiscussionTopicsAsTemplate'
    );
    const linked = data?.items?.[0]?.column_values?.[0]?.linked_items || [];
    return {
      topics: linked
        .map((t) => ({
          name: (t?.name || '').trim(),
          points: (t?.subitems || []).map((s) => (s?.name || '').trim()).filter(Boolean),
        }))
        .filter((t) => t.name),
    };
  } catch (err) {
    logger.warn('readDiscussionTopicsAsTemplate', 'שגיאה בקריאת נושאי הדיון לשכפול', err);
    return { topics: [] };
  }
}

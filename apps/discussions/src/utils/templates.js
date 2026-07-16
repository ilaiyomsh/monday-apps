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
 *   TypeTemplate = { id, discussionType: string, topics: Topic[], lead, coordinator, participants: Person[] }
 *
 * `discussionType` is REQUIRED (it is the key — the label TEXT) — sanitize
 * returns null when it is missing so callers can drop malformed entries.
 */
export function sanitizeTypeTemplate(template, id) {
  const dt = typeKey(template?.discussionType);
  if (!dt) return null;
  const topics = Array.isArray(template?.topics) ? template.topics : [];
  return {
    id: id || template?.id || null,
    discussionType: dt,
    lead: sanitizePeople(template?.lead),
    coordinator: sanitizePeople(template?.coordinator),
    participants: sanitizePeople(template?.participants),
    // item 18 — per-type default decider flag (מחליט = מנהל הדיון). Strict
    // boolean so a stored junk value can never truthy its way in.
    deciderIsLead: template?.deciderIsLead === true,
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
export async function createTopicsFromTemplate(discussionId, template, { onProgress, creatorId = null } = {}) {
  const clean = sanitizeTemplate(template);
  if (!discussionId || !clean.topics.length) return { topics: 0, points: 0 };

  const boardId = getBoardId('topics');
  const relation = getColumns('topics')?.discussionLinkID; // board_relation: topic -> discussion
  const topicDispCol = getColumns('topics')?.topicNotForDiscussionID; // "האם להציג?" (item)
  const pointDispCol = getColumns('topics')?.pointNotForDiscussionID; // "האם להציג?" (subitem)
  // round115 — creator + creation-date columns, stamped on every topic/point
  // created from a template (mirrors useTopics.addTopic/addPoint). creatorId is
  // passed by the caller (the user applying the template).
  const topicCreatorCol = getColumns('topics')?.topicCreatorID;
  const pointCreatorCol = getColumns('topics')?.pointCreatorID;
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

  for (const topic of clean.topics) {
    const columnValues = {};
    if (relation?.id) {
      columnValues[relation.id] = formatValue(
        relation.type || 'board_relation',
        { linkedItems: [{ id: discussionId }] }
      );
    }
    // "האם להציג?" CHECKED = show; default created topics to shown.
    if (topicDispCol?.id) {
      columnValues[topicDispCol.id] = formatValue('checkbox', true);
    }
    if (topicCreatorCol?.id && creatorId) {
      columnValues[topicCreatorCol.id] = formatValue('people', [creatorId]);
    }
    if (topicCreatedCol?.id) {
      columnValues[topicCreatedCol.id] = formatValue('date', new Date());
    }

    const res = await api(
      `mutation ($boardId: ID!, $name: String!, $columnValues: JSON!) {
        create_item(board_id: $boardId, item_name: $name, column_values: $columnValues) { id }
      }`,
      { boardId, name: topic.name, columnValues: JSON.stringify(columnValues) },
      'createTopicFromTemplate'
    );
    const topicId = res?.create_item?.id;
    if (!topicId) {
      // create_item succeeded at the API level but returned no id — can't attach
      // points. Surface the anomaly (WARN, no toast) rather than silently count it.
      logger.warn('createTopicsFromTemplate', `הנושא "${topic.name}" נוצר אך לא הוחזר מזהה — דילוג על הנקודות`);
      continue;
    }
    topicsCreated += 1;
    done += 1;
    report();

    const pointCv = pointDispCol?.id ? { [pointDispCol.id]: formatValue('checkbox', true) } : {};
    if (pointCreatorCol?.id && creatorId) {
      pointCv[pointCreatorCol.id] = formatValue('people', [creatorId]);
    }
    if (pointCreatedCol?.id) {
      pointCv[pointCreatedCol.id] = formatValue('date', new Date());
    }
    for (const point of topic.points) {
      await api(
        `mutation ($parentId: ID!, $name: String!, $cv: JSON!) {
          create_subitem(parent_item_id: $parentId, item_name: $name, column_values: $cv) { id }
        }`,
        { parentId: topicId, name: point, cv: JSON.stringify(pointCv) },
        'createPointFromTemplate'
      );
      pointsCreated += 1;
      done += 1;
      report();
    }
  }

  return { topics: topicsCreated, points: pointsCreated };
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

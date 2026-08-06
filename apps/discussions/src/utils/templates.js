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
import { saveFreshTopicOrder, saveTopicOrder } from './topicOrder.js';
import logger from './logger.js';
import {
  buildTopicCreateBatches,
  buildTopicRelationBatches,
  buildPointCreateBatches,
  parseAliasedMutationResult,
  buildFreshTopicOrderPayload,
} from './templateBatching.js';
export {
  buildTopicCreateBatches,
  buildTopicRelationBatches,
  buildPointCreateBatches,
  parseAliasedMutationResult,
  buildFreshTopicOrderPayload,
};

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
 *                    participants: Person[], externalParticipants: string[],
 *                    deciderIsLead: boolean, exportTemplate: object|null }
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
    // round367 — free-text external participants (not monday users), carried
    // on the type template exactly like the create card's chips.
    externalParticipants: (Array.isArray(template?.externalParticipants) ? template.externalParticipants : [])
      .map((s) => String(s ?? '').trim())
      .filter(Boolean),
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
 * the given discussion. Writes use aliased GraphQL batches of at most ten
 * operations so the serialized iframe bridge makes a few round-trips while the
 * explicit order map preserves template order.
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
/*
 * round303 — SALVAGE for a failed linkLast run. With linkLast the topics are
 * created before they are connected, so a mid-run failure leaves them as real
 * but INVISIBLE board items (the card reads through the relation). This links
 * whatever the checkpoint says was created and not yet linked, so nothing that
 * exists stays unreachable. Best-effort by design: the caller reports the
 * failure either way; this only bounds the damage.
 */
export async function linkTemplateTopics(discussionId, resumeState) {
  const boardId = getBoardId('topics');
  const relation = (getColumns('topics') || {}).discussionLinkID;
  if (!discussionId || !boardId || !relation?.id) return 0;
  const linked = new Set((resumeState?.linkedTopicSourceIndexes || []).map(Number));
  const topics = (resumeState?.topicResults || [])
    .filter((t) => t?.id != null && !linked.has(Number(t.sourceIndex)))
    .map((t) => ({ id: String(t.id), sourceIndex: Number(t.sourceIndex) }));
  if (!topics.length) return 0;
  let count = 0;
  for (const batch of buildTopicRelationBatches({
    boardId, discussionId, relationColumnId: relation.id, topics,
  })) {
    const data = await api(batch.query, batch.variables, 'linkTemplateTopics', { retry: false });
    const parsed = parseAliasedMutationResult(batch, { data, errors: [] });
    count += parsed.successful.length;
  }
  return count;
}

export async function createTopicsFromTemplate(discussionId, template, {
  onProgress,
  existingTopicIds = [],
  freshDiscussion = false,
  resumeState = null,
  onCheckpoint,
  // round301 — STAGED creation. When set, this pass creates every topic but only
  // the points of the listed topic sourceIndexes; a later pass resuming from this
  // pass's checkpoint creates the rest. Lets a fresh discussion open as soon as
  // its topics + the first topic's points exist, instead of after every point.
  pointTopicIndexes = null,
  // round303 — connect the topics to the discussion LAST (after all points), so
  // the card's relation-based read sees the agenda only once it is complete.
  linkLast = false,
  // round304 — do not connect AT ALL in this pass. A staged creation splits the
  // build across two passes (topics awaited in the create card, points + link in
  // the background); the first pass must leave the topics unconnected, or the
  // relation — which IS the read path — would serve empty topics before their
  // points exist. `linkLast` alone cannot express that: it defers the link to the
  // end of the pass, and for a topics-only pass that end is immediate.
  skipLink = false,
} = {}) {
  const clean = sanitizeTemplate(template);
  if (!discussionId || !clean.topics.length) return { topics: 0, points: 0, topicIds: [] };

  const boardId = getBoardId('topics');
  const columns = getColumns('topics') || {};
  const relation = columns.discussionLinkID;
  const topicDispCol = columns.topicNotForDiscussionID;
  const pointDispCol = columns.pointNotForDiscussionID;
  const topicCreatedCol = columns.topicCreationDateID;
  const pointCreatedCol = columns.pointCreationDateID;
  const templateKey = JSON.stringify(clean.topics);
  const compatibleResume = resumeState?.templateKey === templateKey ? resumeState : null;
  const state = {
    templateKey,
    topicResults: Array.isArray(compatibleResume?.topicResults)
      ? compatibleResume.topicResults.map((result) => ({
        sourceIndex: Number(result.sourceIndex),
        id: String(result.id),
      }))
      : [],
    pointResults: Array.isArray(compatibleResume?.pointResults)
      ? compatibleResume.pointResults.map((result) => ({
        topicSourceIndex: Number(result.topicSourceIndex),
        pointIndex: Number(result.pointIndex),
        id: String(result.id),
      }))
      : [],
    linkedTopicSourceIndexes: Array.isArray(compatibleResume?.linkedTopicSourceIndexes)
      ? compatibleResume.linkedTopicSourceIndexes.map(Number)
      : [],
    ambiguousMutation: compatibleResume?.ambiguousMutation
      ? { ...compatibleResume.ambiguousMutation }
      : null,
  };

  const checkpoint = () => {
    const snapshot = {
      templateKey: state.templateKey,
      topicResults: [...state.topicResults].sort((a, b) => a.sourceIndex - b.sourceIndex),
      pointResults: [...state.pointResults].sort((a, b) => (
        a.topicSourceIndex - b.topicSourceIndex || a.pointIndex - b.pointIndex
      )),
      linkedTopicSourceIndexes: [...new Set(state.linkedTopicSourceIndexes)].sort((a, b) => a - b),
      ambiguousMutation: state.ambiguousMutation ? { ...state.ambiguousMutation } : null,
    };
    if (typeof onCheckpoint === 'function') {
      try {
        onCheckpoint(snapshot);
      } catch (err) {
        logger.warn('createTopicsFromTemplate', 'Template checkpoint listener failed; creation continues', err);
      }
    }
    return snapshot;
  };

  // A staged pass only owns the points it is going to create, so the progress
  // total must exclude the deferred ones — otherwise stage 1's bar stalls short
  // of full and looks stuck.
  const stagedTopicIndexes = Array.isArray(pointTopicIndexes)
    ? new Set(pointTopicIndexes.map(Number))
    : null;
  const createsPointsFor = (sourceIndex) => !stagedTopicIndexes || stagedTopicIndexes.has(sourceIndex);
  const total = clean.topics.reduce(
    (count, topic, sourceIndex) => count + 1 + (createsPointsFor(sourceIndex) ? topic.points.length : 0),
    0
  );
  let done = state.topicResults.length + state.pointResults.length;
  const report = () => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ done, total });
    } catch (err) {
      logger.warn('createTopicsFromTemplate', 'מאזין ההתקדמות נכשל — היצירה ממשיכה', err);
    }
  };
  report();

  const attachResumeState = (err) => {
    const snapshot = checkpoint();
    try {
      Object.defineProperty(err, 'templateResumeState', {
        value: snapshot,
        enumerable: false,
        configurable: true,
      });
    } catch (tagErr) {
      logger.warn('createTopicsFromTemplate', 'Could not attach template resume state to error', tagErr);
    }
    return err;
  };

  const ambiguousMutationError = (phase, operations, cause = null) => {
    state.ambiguousMutation = {
      phase,
      aliases: (operations || []).map((operation) => operation.alias),
    };
    const error = new Error(
      'החיבור ל-monday נותק בזמן יצירת נושאים או נקודות. היצירה נעצרה כדי למנוע כפילויות; אין לנסות שוב מתוך הטופס הפתוח.'
    );
    error.name = 'AmbiguousTemplateMutationError';
    error.code = 'AMBIGUOUS_TEMPLATE_MUTATION';
    if (cause) error.cause = cause;
    return error;
  };

  if (state.ambiguousMutation) {
    throw attachResumeState(ambiguousMutationError(
      state.ambiguousMutation.phase,
      state.ambiguousMutation.aliases.map((alias) => ({ alias }))
    ));
  }

  const executeBatch = async (batch, functionName) => {
    try {
      // These aliases create real items and are not idempotent. A transport
      // retry after monday accepted the request could duplicate up to ten rows,
      // so the central API retry loop is explicitly disabled for this call.
      const data = await api(batch.query, batch.variables, functionName, { retry: false });
      const parsed = parseAliasedMutationResult(batch, { data, errors: [] });
      if (parsed.failed.length) {
        const missing = new Error(`${functionName} returned ${parsed.failed.length} missing alias result(s)`);
        missing.batchResult = parsed;
        missing.batchResponseReceived = true;
        throw missing;
      }
      return parsed;
    } catch (err) {
      if (!err?.batchResult) {
        const parsed = parseAliasedMutationResult(batch, err?.response || {});
        try {
          Object.defineProperty(err, 'batchResult', {
            value: parsed,
            enumerable: false,
            configurable: true,
          });
        } catch (tagErr) {
          logger.warn('createTopicsFromTemplate', 'Could not attach partial batch result to error', tagErr);
        }
      }
      throw err;
    }
  };

  const protectAmbiguousCreate = (err, batch, phase) => {
    const response = err?.response;
    const hasServerResponse = Boolean(err?.batchResponseReceived) || (Boolean(response) && (
      Object.prototype.hasOwnProperty.call(response, 'data')
      || Array.isArray(response?.errors)
    ));
    const createsItems = (batch?.operations || []).some((operation) => (
      operation.kind === 'topic' || operation.kind === 'point'
    ));
    return createsItems && !hasServerResponse
      ? ambiguousMutationError(phase, batch.operations, err)
      : err;
  };

  const addTopicSuccesses = (results) => {
    const bySource = new Map(state.topicResults.map((result) => [result.sourceIndex, result]));
    for (const result of results) {
      if (bySource.has(result.sourceIndex)) continue;
      const normalized = { sourceIndex: result.sourceIndex, id: String(result.id) };
      bySource.set(result.sourceIndex, normalized);
      done += 1;
      report();
    }
    state.topicResults = [...bySource.values()];
  };

  const addPointSuccesses = (results) => {
    const pointKey = (result) => `${result.topicSourceIndex}:${result.pointIndex}`;
    const bySource = new Map(state.pointResults.map((result) => [pointKey(result), result]));
    for (const result of results) {
      const key = pointKey(result);
      if (bySource.has(key)) continue;
      const normalized = {
        topicSourceIndex: result.topicSourceIndex,
        pointIndex: result.pointIndex,
        id: String(result.id),
      };
      bySource.set(key, normalized);
      done += 1;
      report();
    }
    state.pointResults = [...bySource.values()];
  };

  const createdAt = new Date();
  const topicCv = {};
  if (topicDispCol?.id) topicCv[topicDispCol.id] = formatValue('checkbox', true);
  if (topicCreatedCol?.id) topicCv[topicCreatedCol.id] = formatValue('date', createdAt);
  const pointCv = {};
  if (pointDispCol?.id) pointCv[pointDispCol.id] = formatValue('checkbox', true);
  if (pointCreatedCol?.id) pointCv[pointCreatedCol.id] = formatValue('date', createdAt);

  const existingTopicSources = new Set(state.topicResults.map((result) => result.sourceIndex));
  const missingTopics = clean.topics
    .map((topic, sourceIndex) => ({
      ...topic,
      sourceIndex,
      columnValues: JSON.stringify(topicCv),
    }))
    .filter((topic) => !existingTopicSources.has(topic.sourceIndex));

  for (const batch of buildTopicCreateBatches({ boardId, topics: missingTopics })) {
    try {
      const parsed = await executeBatch(batch, 'createTopicsFromTemplate.batchTopics');
      addTopicSuccesses(parsed.successful);
      checkpoint();
    } catch (err) {
      addTopicSuccesses(err?.batchResult?.successful || []);
      throw attachResumeState(protectAmbiguousCreate(err, batch, 'topics'));
    }
  }

  const linkTopicsToDiscussion = async () => {
    if (!relation?.id) return;
    const linked = new Set(state.linkedTopicSourceIndexes);
    const unlinkedTopics = state.topicResults.filter((topic) => !linked.has(topic.sourceIndex));
    for (const batch of buildTopicRelationBatches({
      boardId,
      discussionId,
      relationColumnId: relation.id,
      topics: unlinkedTopics,
    })) {
      try {
        const parsed = await executeBatch(batch, 'createTopicsFromTemplate.batchRelations');
        parsed.successful.forEach((result) => linked.add(result.sourceIndex));
        state.linkedTopicSourceIndexes = [...linked];
        checkpoint();
      } catch (err) {
        (err?.batchResult?.successful || []).forEach((result) => linked.add(result.sourceIndex));
        state.linkedTopicSourceIndexes = [...linked];
        throw attachResumeState(err);
      }
    }
  };

  // round303 (owner idea) — `linkLast` builds the whole agenda OFF-CARD first
  // (topics, then every point) and connects it to the discussion only at the END.
  // The discussion's relation is the card's read path, so with linkLast the agenda
  // pops in COMPLETE on one fetch instead of appearing as bare topics that fill in.
  if (!linkLast && !skipLink) await linkTopicsToDiscussion();

  const completedPoints = new Set(
    state.pointResults.map((result) => `${result.topicSourceIndex}:${result.pointIndex}`)
  );
  const pointTopics = state.topicResults
    .filter((topicResult) => createsPointsFor(topicResult.sourceIndex))
    .map((topicResult) => ({
    id: topicResult.id,
    sourceIndex: topicResult.sourceIndex,
    points: clean.topics[topicResult.sourceIndex].points
      .map((name, pointIndex) => ({
        name,
        pointIndex,
        columnValues: JSON.stringify(pointCv),
      }))
      .filter((point) => !completedPoints.has(`${topicResult.sourceIndex}:${point.pointIndex}`)),
  }));

  for (const batch of buildPointCreateBatches({ topics: pointTopics })) {
    try {
      const parsed = await executeBatch(batch, 'createTopicsFromTemplate.batchPoints');
      addPointSuccesses(parsed.successful);
      checkpoint();
    } catch (err) {
      addPointSuccesses(err?.batchResult?.successful || []);
      throw attachResumeState(protectAmbiguousCreate(err, batch, 'points'));
    }
  }

  if (linkLast && !skipLink) await linkTopicsToDiscussion();

  const order = buildFreshTopicOrderPayload({
    topicResults: state.topicResults,
    pointResults: state.pointResults,
  });
  if (order.topics.length) {
    try {
      if (freshDiscussion) await saveFreshTopicOrder(discussionId, order);
      else await saveTopicOrder(discussionId, [...existingTopicIds.map(String), ...order.topics]);
    } catch (err) {
      logger.warn('createTopicsFromTemplate', 'שמירת סדר הנושאים מהתבנית נכשלה', err);
    }
  }

  checkpoint();
  return {
    topics: state.topicResults.length,
    points: state.pointResults.length,
    topicIds: order.topics,
  };
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

// Lifecycle service — normalizes monday webhook bodies (feature-level
// lifecycle events + app-level install/subscription events) into board events,
// dedups redeliveries by X-Apps-Event-Id, and acks async feature deliveries
// via back_to_url. Everything is fail-soft: handlers catch, log, and resolve —
// they never rethrow into the (already-202'd) webhook path.
//
// PRIVACY CONTRACT (non-negotiable):
// - Logger calls carry ONLY ids/enums (appSlug, eventType, eventId) and
//   error.message — never webhook payload objects, never back_to_url.
// - details are built from strict allowlists below and go ONLY to the board
//   (the owner's private monday account — account names allowed there BY
//   DESIGN, but they must never reach Axiom via the logger).
// - SANCTIONED DEBUG EXCEPTION: when the operator sets
//   DEBUG_LIFECYCLE_PAYLOAD=1 (opts.debugRawPayload), the raw body is logged
//   ONCE per event at INFO level ('debug_lifecycle_raw'). INFO does not ship
//   to Axiom (WARN/ERROR-only policy, no alwaysShip) — it reaches ONLY the
//   monday-code console (`mapps code:logs`). For mapping/debugging sessions;
//   keep the flag OFF in steady state.
//
// All collaborators are injected — this module imports nothing.

const TAG = 'lifecycle';
const DEDUP_CAP = 500;

/** Ids only — accept scalar string/number, stringify; drop anything else. */
function putId(target, key, value) {
  if (typeof value === 'string' || typeof value === 'number') target[key] = String(value);
}

/** Allowlisted scalar (string/number/boolean) — anything else is dropped. */
function putScalar(target, key, value) {
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    target[key] = value;
  }
}

/** Stringify a scalar id field ('' when absent/non-scalar). */
function idString(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** Normalize a payload timestamp to an ISO string; fall back to "now". */
function normalizeOccurredAt(raw) {
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * @param {object} deps
 * @param {{ recordEvent: Function }|null} deps.eventsBoard - null when board/token
 *   are unconfigured → warn once per route and skip recording (inert-by-default)
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @param {typeof fetch} [deps.fetchImpl] - injected for tests; defaults to global fetch
 * @returns {{ handleFeatureEvent: Function, handleAppEvent: Function }}
 */
export function createLifecycleService({
  eventsBoard,
  logger,
  fetchImpl,
  debugRawPayload = false,
  slugResolver = null,
}) {
  /**
   * Best-effort owner-account slug for instance URLs (#145). '' on any
   * failure/foreign account — enrichment must never break the webhook path.
   */
  async function resolveSlug(accountId) {
    if (!slugResolver || !accountId) return '';
    try {
      const slug = await slugResolver.getSlug(accountId);
      return typeof slug === 'string' ? slug : '';
    } catch (err) {
      logger.warn('slug_resolve_failed', TAG, { error: String(err?.message ?? err) });
      return '';
    }
  }
  /** Sanctioned debug exception (see header) — raw body to console only. */
  function dumpRaw(slug, eventId, body) {
    if (!debugRawPayload) return;
    let raw = '';
    try {
      raw = JSON.stringify(body).slice(0, 8000);
    } catch {
      // Circular/unserializable body — dump what String() gives us.
      raw = String(body);
    }
    logger.info('debug_lifecycle_raw', TAG, { app: slug, eventId, raw });
  }
  const doFetch = fetchImpl ?? globalThis.fetch;

  // Dedup LRU: eventId → seen-at. Capped at DEDUP_CAP, oldest entry evicted
  // (Map preserves insertion order). Events without an id are never dedup'd.
  const seenEventIds = new Map();

  // 'lifecycle_not_configured' is throttled to once per boot per route.
  const warnedRoutes = new Set();

  function isDuplicate(eventId) {
    if (typeof eventId !== 'string' || eventId.length === 0) return false;
    if (seenEventIds.has(eventId)) return true;
    seenEventIds.set(eventId, Date.now());
    if (seenEventIds.size > DEDUP_CAP) {
      seenEventIds.delete(seenEventIds.keys().next().value);
    }
    return false;
  }

  /** Record on the board (if configured) + emit the usage track signal. */
  async function record(evt, route) {
    if (!eventsBoard) {
      if (!warnedRoutes.has(route)) {
        warnedRoutes.add(route);
        logger.warn('lifecycle_not_configured', TAG, { route });
      }
      return null;
    }
    const itemId = await eventsBoard.recordEvent(evt);
    // recordEvent never throws — null means the board write failed. Only a
    // successful write counts as a recorded event (review finding #143-10).
    if (itemId !== null && itemId !== undefined) {
      logger.track('lifecycle_event', { app: evt.appSlug, type: evt.eventType, kind: evt.category });
    }
    return itemId;
  }

  /**
   * Async-mode ack: POST { success: true } to back_to_url, fire-and-forget.
   * The URL comes from the payload and is NEVER logged.
   */
  function ackBackToUrl(backToUrl, ctx) {
    if (typeof backToUrl !== 'string' || !backToUrl.startsWith('https://')) return;
    try {
      Promise.resolve(
        doFetch(backToUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"success":true}',
        }),
      ).catch((err) => {
        // Fire-and-forget by design — monday redelivers the event if it cares.
        logger.warn('back_to_url_ack_failed', TAG, { ...ctx, error: String(err?.message ?? err) });
      });
    } catch (err) {
      // A synchronously-throwing fetch impl must not break the handler.
      logger.warn('back_to_url_ack_failed', TAG, { ...ctx, error: String(err?.message ?? err) });
    }
  }

  /**
   * Feature-level lifecycle event (JWT verified upstream with the source
   * app's Signing Secret). Body: { type, payload, accountId, userId, back_to_url }.
   * @param {{ appSlug: string, body: object, eventId: string|null }} args
   * @returns {Promise<{ duplicate: true } | { duplicate: false, itemId: string|null }>}
   */
  async function handleFeatureEvent({ appSlug, body, eventId }) {
    const slug = String(appSlug ?? '');
    const id = eventId ?? null;
    try {
      const b = body && typeof body === 'object' ? body : {};
      dumpRaw(slug, id, b);
      if (isDuplicate(id)) {
        // A redelivery means monday did not accept our previous ack — ack
        // again (recording stays at-most-once) so the redelivery loop ends
        // (review finding #143-2).
        logger.debug('duplicate_event', TAG, { app: slug, eventId: id });
        ackBackToUrl(b.back_to_url, { app: slug, eventId: id });
        return { duplicate: true };
      }
      // REAL shape (#145, captured live 2026-07-22): monday nests everything
      // under `data` — { type, data: { payload, back_to_url, app_id,
      // app_feature_id, app_feature_reference_id, user_id, account_id,
      // timestamp } }. The legacy top-level read (docs-era assumption) is
      // kept as a fallback so older/simulated bodies still parse.
      const d = b.data && typeof b.data === 'object' ? b.data : b;
      const payload = d.payload && typeof d.payload === 'object' ? d.payload : {};

      let feature = '';
      if (payload.app_feature && typeof payload.app_feature.name === 'string') {
        feature = payload.app_feature.name;
      } else if (typeof d.app_feature_id === 'string' || typeof d.app_feature_id === 'number') {
        feature = String(d.app_feature_id);
      } else if (typeof payload.appFeatureId === 'string' || typeof payload.appFeatureId === 'number') {
        feature = String(payload.appFeatureId);
      }

      // Details allowlist — ids ONLY, never free text from the payload.
      const details = {};
      putId(details, 'boardId', payload.boardId ?? payload.board_id);
      putId(details, 'itemId', payload.itemId);
      putId(details, 'instanceId', payload.instanceId);
      putId(details, 'appFeatureId', payload.appFeatureId);
      putId(details, 'object_id', payload.object_id);
      putId(details, 'source_object_id', payload.source_object_id);
      putId(details, 'source_workspace_id', payload.source_workspace_id);
      putId(details, 'app_feature_reference_id', d.app_feature_reference_id);
      putId(details, 'app_id', d.app_id);

      const accountId = idString(d.account_id ?? b.accountId);
      const objectId = idString(payload.object_id);
      // Instance URL — owner-gated slug + the object id (a board-shaped id).
      const accountSlug = objectId ? await resolveSlug(accountId) : '';
      const objectUrl =
        accountSlug && objectId ? `https://${accountSlug}.monday.com/boards/${objectId}` : '';

      const evt = {
        category: 'Lifecycle',
        eventType: String(b.type ?? ''),
        appSlug: slug,
        feature,
        accountId,
        userId: idString(d.user_id ?? b.userId),
        // Feature events carry ids only (owner decision) — identity columns
        // fill natively on install/subscription events.
        userName: '',
        userEmail: '',
        workspace: idString(payload.workspace_id),
        objectName: typeof payload.object_name === 'string' ? payload.object_name : '',
        objectUrl,
        appVersion: '',
        occurredAt: normalizeOccurredAt(d.timestamp),
        details,
        eventId: id ?? '',
      };
      const itemId = await record(evt, 'lifecycle');
      ackBackToUrl(d.back_to_url ?? b.back_to_url, { app: slug, eventId: id });
      return { duplicate: false, itemId };
    } catch (err) {
      // Fail-soft: the route already answered 202 — log and resolve.
      logger.error('feature_event_failed', TAG, {
        app: slug,
        eventId: id,
        error: String(err?.message ?? err),
      });
      return { duplicate: false, itemId: null };
    }
  }

  /**
   * App-level event (JWT verified upstream with the source app's Client
   * Secret). Body: { type, data: { app_id, account_id, user_id, ..., subscription } }.
   * @param {{ appSlug: string, body: object, eventId: string|null }} args
   * @returns {Promise<{ duplicate: true } | { duplicate: false, itemId: string|null }>}
   */
  async function handleAppEvent({ appSlug, body, eventId }) {
    const slug = String(appSlug ?? '');
    const id = eventId ?? null;
    try {
      dumpRaw(slug, id, body && typeof body === 'object' ? body : {});
      if (isDuplicate(id)) {
        logger.debug('duplicate_event', TAG, { app: slug, eventId: id });
        return { duplicate: true };
      }
      const b = body && typeof body === 'object' ? body : {};
      const data = b.data && typeof b.data === 'object' ? b.data : {};
      const subscription =
        data.subscription && typeof data.subscription === 'object' ? data.subscription : {};
      const type = String(b.type ?? '');
      const category = type === 'install' || type === 'uninstall' ? 'Install' : 'Subscription';

      // Details allowlist. Account names are allowed BY DESIGN here — they go
      // ONLY to the owner's private board, never into logger calls (Axiom).
      const details = {};
      putScalar(details, 'account_name', data.account_name);
      putScalar(details, 'account_slug', data.account_slug);
      putScalar(details, 'account_tier', data.account_tier);
      putScalar(details, 'account_max_users', data.account_max_users);
      putScalar(details, 'plan_id', subscription.plan_id);
      putScalar(details, 'is_trial', subscription.is_trial);
      putScalar(details, 'billing_period', subscription.billing_period);

      // #145: install/subscription payloads natively carry the actor's
      // identity + the app version — map them to their dedicated columns
      // (board-only by design; they never reach logger calls).
      const version =
        data.version_data && typeof data.version_data === 'object'
          ? ['major', 'minor', 'patch']
              .map((k) => data.version_data[k])
              .filter((v) => typeof v === 'number' || typeof v === 'string')
              .join('.')
          : '';

      const evt = {
        category,
        eventType: type,
        appSlug: slug,
        feature: '',
        accountId: idString(data.account_id),
        userId: idString(data.user_id),
        userName: typeof data.user_name === 'string' ? data.user_name : '',
        userEmail: typeof data.user_email === 'string' ? data.user_email : '',
        workspace: '',
        objectName: '',
        objectUrl: '',
        appVersion: version,
        occurredAt: normalizeOccurredAt(data.timestamp),
        details,
        eventId: id ?? '',
      };
      const itemId = await record(evt, 'app-events');
      return { duplicate: false, itemId };
    } catch (err) {
      // Fail-soft: the route already answered 202 — log and resolve.
      logger.error('app_event_failed', TAG, {
        app: slug,
        eventId: id,
        error: String(err?.message ?? err),
      });
      return { duplicate: false, itemId: null };
    }
  }

  return { handleFeatureEvent, handleAppEvent };
}

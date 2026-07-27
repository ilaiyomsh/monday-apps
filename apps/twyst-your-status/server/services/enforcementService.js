import { evaluateTransitionAttempt } from '../../src/domain/workflowPolicy.js';
import logger from '../logger.js';

function stringId(value) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
}

function labelId(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      logger.warn('non_json_status_value', 'enforcement', { error });
      parsed = value;
    }
  }
  const candidate = parsed?.index ?? parsed?.label?.index ?? parsed;
  return stringId(candidate);
}

export function normalizeStatusChangeEvent(rawEvent) {
  const event = rawEvent?.event ?? rawEvent;
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('A monday change_column_value event is required.');
  }
  const normalized = {
    boardId: stringId(event.boardId),
    itemId: stringId(event.pulseId ?? event.itemId),
    columnId: stringId(event.columnId),
    actorUserId: stringId(event.userId),
    fromLabelId: labelId(event.previousValue),
    toLabelId: labelId(event.value),
    triggerUuid: stringId(event.triggerUuid),
  };
  if (!normalized.boardId || !normalized.itemId || !normalized.columnId) {
    throw new TypeError('The status event is missing board, item, or column identity.');
  }
  return normalized;
}

function unique(values) {
  return [...new Set(values)];
}

function auditId(event, idFactory) {
  return event.triggerUuid ?? idFactory();
}

function denialMessage(result) {
  if (result.code === 'actor_not_permitted') {
    return 'הפעולה נחסמה: אין לך הרשאה לבצע את מעבר הסטאטוס הזה.';
  }
  if (result.code === 'required_fields_missing') {
    return `הפעולה נחסמה: חסרים שדות חובה (${result.missingColumnIds.join(', ')}).`;
  }
  return 'הפעולה נחסמה: מעבר הסטאטוס אינו מוגדר בתהליך העבודה.';
}

export function createEnforcementService({ store, mondayApi, now = Date.now, idFactory } = {}) {
  if (!store || !mondayApi) throw new TypeError('store and mondayApi are required.');
  const createId = idFactory ?? (() => `${now()}-${Math.random().toString(36).slice(2)}`);

  return {
    async handleStatusChange({ accountId: accountIdValue, event: rawEvent, token }) {
      const accountId = stringId(accountIdValue);
      if (!accountId) throw new TypeError('accountId is required.');
      const event = normalizeStatusChangeEvent(rawEvent);
      const config = await store.getConfig(accountId, event.boardId);

      if (!config) return { kind: 'ignore', code: 'config_not_found' };
      if (config.accountId !== accountId || config.boardId !== event.boardId) {
        return { kind: 'ignore', code: 'configuration_scope_mismatch' };
      }
      if (!config.enforcement.enabled) return { kind: 'ignore', code: 'enforcement_disabled' };
      if (event.columnId !== config.targetColumnId) {
        return { kind: 'ignore', code: 'target_column_not_managed' };
      }

      for (const kind of ['rollback', 'approved_action']) {
        const marker = await store.consumeExpectedMarker({
          kind,
          accountId,
          boardId: event.boardId,
          itemId: event.itemId,
          columnId: event.columnId,
          fromLabelId: event.fromLabelId,
          toLabelId: event.toLabelId,
        });
        if (marker) return { kind: 'ignore', code: `expected_${kind}` };
      }

      const requiredColumnIds = unique(config.transitions.flatMap((transition) => (
        transition.fromLabelId === event.fromLabelId && transition.toLabelId === event.toLabelId
          ? transition.requiredColumnIds
          : []
      )));
      const itemState = await mondayApi.getItemState({
        token,
        boardId: event.boardId,
        itemId: event.itemId,
        statusColumnId: event.columnId,
        columnIds: unique([event.columnId, ...requiredColumnIds]),
      });
      if (stringId(itemState?.labelId) !== event.toLabelId) {
        return { kind: 'ignore', code: 'stale_event' };
      }

      const actor = event.actorUserId
        ? await mondayApi.getActor({ token, userId: event.actorUserId })
        : null;
      const result = evaluateTransitionAttempt({
        config,
        columnId: event.columnId,
        fromLabelId: event.fromLabelId,
        toLabelId: event.toLabelId,
        actor,
        itemColumnValues: itemState.columnValues,
        internalRollback: false,
      });

      if (result.kind === 'ignore') return result;
      if (result.kind === 'allow') {
        await store.appendAudit({
          id: auditId(event, createId),
          accountId,
          boardId: event.boardId,
          itemId: event.itemId,
          columnId: event.columnId,
          actorUserId: event.actorUserId,
          fromLabelId: event.fromLabelId,
          toLabelId: event.toLabelId,
          occurredAt: new Date(now()).toISOString(),
          source: 'board',
          transitionId: result.transition.id,
          formValues: {},
        });
        return result;
      }

      await store.setExpectedMarker({
        kind: 'rollback',
        accountId,
        boardId: event.boardId,
        itemId: event.itemId,
        columnId: event.columnId,
        fromLabelId: event.toLabelId,
        toLabelId: event.fromLabelId,
        actorUserId: event.actorUserId,
      });

      const failures = [];
      try {
        await mondayApi.changeStatus({
          token,
          boardId: event.boardId,
          itemId: event.itemId,
          columnId: event.columnId,
          labelId: event.fromLabelId,
        });
      } catch (error) {
        logger.error('rollback_mutation_failed', 'enforcement', { error });
        failures.push(error);
      }

      if (event.actorUserId) {
        try {
          await mondayApi.notifyUser({
            token,
            userId: event.actorUserId,
            boardId: event.boardId,
            text: denialMessage(result),
          });
        } catch (error) {
          logger.error('denial_notification_failed', 'enforcement', { error });
          failures.push(error);
        }
      }

      if (failures.length > 0) {
        throw new AggregateError(failures, 'Status transition denial could not be completed safely.');
      }
      return { ...result, rolledBack: true };
    },
  };
}

import express from 'express';
import { asyncHandler } from '../asyncHandler.js';
import {
  isFilledColumnValue,
  evaluateTransitionAttempt,
  normalizeWorkflowConfig,
} from '../../src/domain/workflowPolicy.js';

function status(code) {
  if (code === 'actor_not_permitted') return 403;
  if (code === 'required_fields_missing') return 422;
  return 409;
}

function pendingColumnValues(currentValues, formValues) {
  const byId = new Map((currentValues ?? []).map((value) => [String(value.id), value]));
  Object.entries(formValues).forEach(([columnId, value]) => {
    byId.set(columnId, { id: columnId, text: '', value: JSON.stringify(value) });
  });
  return [...byId.values()];
}

export function createWorkflowRouter({ store, mondayApi, webhookManager, tokenProvider, now = Date.now, idFactory }) {
  const router = express.Router();
  const createId = idFactory ?? (() => `${now()}-${Math.random().toString(36).slice(2)}`);

  router.get('/boards/:boardId/config', asyncHandler(async (req, res) => {
    const [config, token] = await Promise.all([
        store.getConfig(req.session.accountId, req.params.boardId),
        tokenProvider.getFreshAccessToken(req.session.accountId),
    ]);
    res.json({ config, connected: Boolean(token) });
  }));

  router.put('/boards/:boardId/config', asyncHandler(async (req, res) => {
      const token = await tokenProvider.getFreshAccessToken(req.session.accountId);
      if (!token) {
        res.status(409).json({ error: 'monday_account_not_connected' });
        return;
      }
      if (!await mondayApi.isAdmin({ token, userId: req.session.userId })) {
        res.status(403).json({ error: 'admin_required' });
        return;
      }
      const config = normalizeWorkflowConfig({
        ...req.body,
        schemaVersion: 1,
        accountId: req.session.accountId,
        boardId: req.params.boardId,
        updatedAt: new Date(now()).toISOString(),
        updatedBy: req.session.userId,
      });
      const webhook = config.enforcement.enabled
        ? await webhookManager.ensure({
          accountId: config.accountId,
          boardId: config.boardId,
          columnId: config.targetColumnId,
          token,
        })
        : null;
      await store.saveConfig(config);
      res.json({ config, webhook });
  }));

  router.get('/boards/:boardId/items/:itemId/workflow', asyncHandler(async (req, res) => {
      const [config, audit, token] = await Promise.all([
        store.getConfig(req.session.accountId, req.params.boardId),
        store.getAudit(req.session.accountId, req.params.boardId, req.params.itemId),
        tokenProvider.getFreshAccessToken(req.session.accountId),
      ]);
      res.json({ config, audit, connected: Boolean(token) });
  }));

  router.post('/boards/:boardId/items/:itemId/transitions', asyncHandler(async (req, res) => {
      const { accountId, userId } = req.session;
      const { boardId, itemId } = req.params;
      const config = await store.getConfig(accountId, boardId);
      if (!config || !config.enforcement.enabled) {
        res.status(409).json({ error: 'workflow_not_enabled' });
        return;
      }
      const token = await tokenProvider.getFreshAccessToken(accountId);
      if (!token) {
        res.status(409).json({ error: 'monday_account_not_connected' });
        return;
      }
      const transition = config.transitions.find((candidate) => candidate.id === String(req.body.transitionId));
      if (!transition) {
        res.status(404).json({ error: 'transition_not_found' });
        return;
      }

      const formValues = req.body.formValues ?? {};
      if (formValues === null || typeof formValues !== 'object' || Array.isArray(formValues)) {
        res.status(400).json({ error: 'invalid_form_values' });
        return;
      }
      const acceptedFormColumnIds = new Set([
        ...transition.requiredColumnIds,
        ...transition.formFields.map((field) => field.columnId),
      ]);
      const unknownFormColumn = Object.keys(formValues)
        .find((columnId) => !acceptedFormColumnIds.has(columnId));
      if (unknownFormColumn) {
        res.status(400).json({ error: 'unexpected_form_field', columnId: unknownFormColumn });
        return;
      }
      const missingFormColumnIds = transition.formFields
        .filter((field) => field.required && !isFilledColumnValue(formValues[field.columnId]))
        .map((field) => field.columnId);
      if (missingFormColumnIds.length > 0) {
        res.status(422).json({ error: 'transition_form_fields_missing', missingColumnIds: missingFormColumnIds });
        return;
      }

      const queryColumnIds = [...new Set([
        config.targetColumnId,
        ...transition.requiredColumnIds,
        ...transition.formFields.map((field) => field.columnId),
      ])];
      const [itemState, actor] = await Promise.all([
        mondayApi.getItemState({
          token,
          boardId,
          itemId,
          statusColumnId: config.targetColumnId,
          columnIds: queryColumnIds,
        }),
        mondayApi.getActor({ token, userId }),
      ]);
      const result = evaluateTransitionAttempt({
        config,
        columnId: config.targetColumnId,
        fromLabelId: itemState.labelId,
        toLabelId: transition.toLabelId,
        actor,
        itemColumnValues: pendingColumnValues(itemState.columnValues, formValues),
        internalRollback: false,
      });
      if (result.kind !== 'allow' || result.transition.id !== transition.id) {
        res.status(status(result.code)).json({ error: result.code, ...result });
        return;
      }

      const marker = {
        kind: 'approved_action',
        accountId,
        boardId,
        itemId,
        columnId: config.targetColumnId,
        fromLabelId: itemState.labelId,
        toLabelId: transition.toLabelId,
        actorUserId: userId,
      };
      await store.setExpectedMarker(marker);
      try {
        await mondayApi.changeColumns({
          token,
          boardId,
          itemId,
          values: {
            ...formValues,
            [config.targetColumnId]: { index: Number(transition.toLabelId) },
          },
        });
      } catch (error) {
        await store.consumeExpectedMarker(marker);
        throw error;
      }

      const audit = await store.appendAudit({
        id: createId(),
        accountId,
        boardId,
        itemId,
        columnId: config.targetColumnId,
        actorUserId: userId,
        fromLabelId: itemState.labelId,
        toLabelId: transition.toLabelId,
        occurredAt: new Date(now()).toISOString(),
        source: 'item_view',
        transitionId: transition.id,
        formValues,
      });
      res.json({ result, audit });
  }));

  return router;
}

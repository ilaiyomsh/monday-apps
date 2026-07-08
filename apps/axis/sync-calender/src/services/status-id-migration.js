// One-shot migration: translate legacy status `value.id` (which was actually
// the label POSITION saved by an earlier UI bug) to the stable label id.
//
// A saved id `n` needs migration when:
//   - no label in the column has `id === n`  AND
//   - some label has `index === n`
// In that case we replace `n` with that label's stable `id`.
//
// Anything that already matches a real label id is left alone (idempotent).
// Anything that matches neither is reported as "unresolved" and skipped — the
// owner needs to re-pick that mapping manually.

import syncConfigStorage from '../storage/sync-config-storage.js';
import { getStatusColumnLabels } from './monday-api.js';

function classifySaved(savedId, labels) {
  if (!Number.isInteger(savedId)) return { kind: 'invalid' };
  if (labels.some((l) => l.id === savedId)) return { kind: 'ok' };
  const byIndex = labels.find((l) => l.index === savedId);
  if (byIndex) return { kind: 'translate', newId: byIndex.id, label: byIndex.label };
  return { kind: 'unresolved' };
}

function collectStatusColumnIds(policy, configs) {
  const ids = new Set();
  const mapping = policy?.columnMapping || {};
  for (const [k, v] of Object.entries(mapping)) {
    if (v?.type === 'status') ids.add(String(k));
  }
  for (const c of configs || []) {
    for (const cond of c.conditionals || []) {
      for (const [k, v] of Object.entries(cond.values || {})) {
        if (v?.type === 'status') ids.add(String(k));
      }
    }
  }
  return [...ids];
}

export async function buildMigrationPlan({ token, policy, configs }) {
  const columnIds = collectStatusColumnIds(policy, configs);
  if (columnIds.length === 0 || !policy?.boardId) {
    return { needed: false, items: [], unresolved: [], columnIds: [] };
  }
  const labelMap = await getStatusColumnLabels(token, policy.boardId, columnIds);

  const items = [];
  const unresolved = [];

  // Policy mappings
  for (const [colId, entry] of Object.entries(policy.columnMapping || {})) {
    if (entry?.type !== 'status') continue;
    const labels = labelMap.get(String(colId)) || [];
    const c = classifySaved(entry.value?.id, labels);
    if (c.kind === 'translate') {
      items.push({
        kind: 'policy',
        columnId: String(colId),
        currentId: entry.value.id,
        newId: c.newId,
        labelText: c.label,
      });
    } else if (c.kind === 'unresolved' || c.kind === 'invalid') {
      unresolved.push({
        kind: 'policy',
        columnId: String(colId),
        currentId: entry.value?.id ?? null,
      });
    }
  }

  // Conditional values
  for (const cfg of configs || []) {
    for (const cond of cfg.conditionals || []) {
      for (const [colId, v] of Object.entries(cond.values || {})) {
        if (v?.type !== 'status') continue;
        const labels = labelMap.get(String(colId)) || [];
        const c = classifySaved(v.value?.id, labels);
        if (c.kind === 'translate') {
          items.push({
            kind: 'conditional',
            configId: cfg.configId,
            conditionalId: cond.id,
            columnId: String(colId),
            currentId: v.value.id,
            newId: c.newId,
            labelText: c.label,
          });
        } else if (c.kind === 'unresolved' || c.kind === 'invalid') {
          unresolved.push({
            kind: 'conditional',
            configId: cfg.configId,
            conditionalId: cond.id,
            columnId: String(colId),
            currentId: v.value?.id ?? null,
          });
        }
      }
    }
  }

  return { needed: items.length > 0, items, unresolved, columnIds };
}

export async function applyMigrationPlan(plan, { policy, configs }) {
  let migrated = 0;

  // Policy
  const policyChanges = plan.items.filter((i) => i.kind === 'policy');
  if (policyChanges.length > 0) {
    const mapping = { ...(policy.columnMapping || {}) };
    for (const it of policyChanges) {
      const e = mapping[it.columnId];
      if (e?.type === 'status' && e.value?.id === it.currentId) {
        mapping[it.columnId] = { ...e, value: { id: it.newId } };
        migrated++;
      }
    }
    await syncConfigStorage.updateInstancePolicy(policy.objectId, { columnMapping: mapping });
  }

  // Conditionals — group by configId
  const byConfig = new Map();
  for (const it of plan.items) {
    if (it.kind !== 'conditional') continue;
    if (!byConfig.has(it.configId)) byConfig.set(it.configId, []);
    byConfig.get(it.configId).push(it);
  }
  for (const [configId, list] of byConfig) {
    const cfg = configs.find((c) => c.configId === configId);
    if (!cfg) continue;
    const conditionals = (cfg.conditionals || []).map((cond) => {
      const matches = list.filter((it) => it.conditionalId === cond.id);
      if (matches.length === 0) return cond;
      const values = { ...(cond.values || {}) };
      for (const m of matches) {
        const v = values[m.columnId];
        if (v?.type === 'status' && v.value?.id === m.currentId) {
          values[m.columnId] = { type: 'status', value: { id: m.newId } };
          migrated++;
        }
      }
      return { ...cond, values };
    });
    await syncConfigStorage.updateSyncConfig(configId, { conditionals });
  }

  return { migrated };
}

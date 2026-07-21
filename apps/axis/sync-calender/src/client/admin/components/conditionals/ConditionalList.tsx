import { useEffect, useMemo, useState } from 'react';
import { Button, Text } from '@vibe/core';
import { ConditionalCard } from './ConditionalCard';
import { ImportExportDialog } from './ImportExportDialog';
import logger from '../../lib/logger';
import type { Column, Conditional, ConditionalAction } from '../../types';

interface Props {
  conditionals: Conditional[];
  eligibleColumns: Column[];
  policyBoardId: string | null;
  userName: string | null;
  disabled?: boolean;
  onSave: (next: Conditional[]) => Promise<void>;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `cond_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function blankConditional(action: ConditionalAction): Conditional {
  return {
    id: newId(),
    name: '',
    action,
    operator: 'AND',
    predicates: [],
    values: {},
  };
}

function actionOf(c: Conditional): ConditionalAction {
  return c.action === 'skip' ? 'skip' : 'override';
}

// Drop entries from each conditional's `values` map whose column isn't in
// the eligible set (e.g., column removed from the board, or the admin
// un-toggled it). Without this prune, orphans survive every edit because
// ValueSection only renders rows for eligibleColumns and never touches
// other keys in state.
function pruneOrphanValues(list: Conditional[], eligible: Column[]): Conditional[] {
  const allowed = new Set(eligible.map((c) => c.id));
  let changed = false;
  const next = list.map((cond) => {
    const values = cond.values || {};
    const keys = Object.keys(values);
    const cleanedKeys = keys.filter((k) => allowed.has(k));
    if (cleanedKeys.length === keys.length) return cond;
    changed = true;
    const cleaned: Conditional['values'] = {};
    for (const k of cleanedKeys) cleaned[k] = values[k];
    return { ...cond, values: cleaned };
  });
  return changed ? next : list;
}

export function ConditionalList({ conditionals, eligibleColumns, policyBoardId, userName, disabled, onSave }: Props) {
  const initialPruned = pruneOrphanValues(conditionals, eligibleColumns);
  const [local, setLocal] = useState<Conditional[]>(initialPruned);
  const [dialogMode, setDialogMode] = useState<'export' | 'import' | null>(null);
  // serverSnapshot tracks the *unpruned* server value so that a fresh page
  // load with orphans surfaces as "Unsaved changes" — clicking Save sends
  // the pruned `local` and clears the orphans server-side.
  const [serverSnapshot, setServerSnapshot] = useState<string>(() => JSON.stringify(conditionals));
  const [saving, setSaving] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  // When the server hands us fresh data (refetch after save, or another tab
  // changed it) reset local to match. We intentionally skip this sync while
  // the user has unsaved edits so their work isn't wiped.
  useEffect(() => {
    const incoming = JSON.stringify(conditionals);
    const localSerialized = JSON.stringify(local);
    if (localSerialized === serverSnapshot) {
      setLocal(pruneOrphanValues(conditionals, eligibleColumns));
      setServerSnapshot(incoming);
    } else if (incoming !== serverSnapshot) {
      setServerSnapshot(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionals, eligibleColumns]);

  const isDirty = useMemo(
    () => JSON.stringify(local) !== serverSnapshot,
    [local, serverSnapshot]
  );

  const setOpen = (id: string, open: boolean) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const updateOne = (id: string, c: Conditional) => {
    setLocal((prev) => prev.map((x) => (x.id === id ? c : x)));
  };
  const removeOne = (id: string) => {
    setLocal((prev) => prev.filter((x) => x.id !== id));
    setOpen(id, false);
  };
  const duplicateOne = (id: string) => {
    setLocal((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;
      const src = prev[idx];
      const copy: Conditional = {
        ...src,
        id: newId(),
        name: src.name ? `${src.name} (copy)` : '',
        predicates: src.predicates.map((p) => ({ ...p })),
        values: { ...src.values },
      };
      setOpen(copy.id, true);
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  };
  // Move a conditional among its same-variant peers. We swap neighbors inside
  // the filtered subset rather than shifting a position in the full array,
  // so override-ordering (which is semantic) is preserved regardless of where
  // skip rules sit.
  const moveWithinVariant = (id: string, dir: -1 | 1) => {
    setLocal((prev) => {
      const variant = actionOf(prev.find((x) => x.id === id)!);
      const peerIdxs = prev
        .map((x, i) => ({ x, i }))
        .filter((e) => actionOf(e.x) === variant)
        .map((e) => e.i);
      const pos = peerIdxs.findIndex((i) => prev[i].id === id);
      const swapPos = pos + dir;
      if (pos < 0 || swapPos < 0 || swapPos >= peerIdxs.length) return prev;
      const a = peerIdxs[pos];
      const b = peerIdxs[swapPos];
      const next = prev.slice();
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  };
  const addOne = (action: ConditionalAction) => {
    const c = blankConditional(action);
    setLocal((prev) => [c, ...prev]);
    setOpen(c.id, true);
  };

  const handleSave = async () => {
    const snapshot = JSON.stringify(local);
    setSaving(true);
    try {
      await onSave(local);
      setServerSnapshot(snapshot);
      // Collapse everything — the user just confirmed the state is what they want.
      setOpenIds(new Set());
    } catch (err) {
      // onSave (ConditionsTab wrapper) already displays the failure toast and rethrows;
      // log here so the failure reaches Axiom, and swallow so it isn't an unhandled rejection.
      logger.error('conditionals', 'conditionals_save_failed', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    try {
      setLocal(JSON.parse(serverSnapshot));
    } catch {
      setLocal(conditionals);
    }
    setOpenIds(new Set());
  };

  // Warn before unloading the page with unsaved changes.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const skipRules = local.filter((c) => actionOf(c) === 'skip');
  const overrideRules = local.filter((c) => actionOf(c) === 'override');

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {isDirty && !saving && (
          <Text type="text2" color="secondary" style={{ fontStyle: 'italic' }}>
            Unsaved changes
          </Text>
        )}
        <Button
          size="small"
          kind="tertiary"
          disabled={saving || local.length === 0}
          onClick={() => setDialogMode('export')}
        >
          Export
        </Button>
        <Button
          size="small"
          kind="tertiary"
          disabled={disabled || saving}
          onClick={() => setDialogMode('import')}
        >
          Import
        </Button>
        <Button
          size="small"
          kind="tertiary"
          disabled={disabled || !isDirty || saving}
          onClick={handleDiscard}
        >
          Discard
        </Button>
        <Button
          size="small"
          kind="primary"
          disabled={disabled || !isDirty || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <ImportExportDialog
        mode={dialogMode ?? 'export'}
        open={dialogMode !== null}
        conditionals={local}
        eligibleColumns={eligibleColumns}
        policyBoardId={policyBoardId}
        userName={userName}
        onClose={() => setDialogMode(null)}
        onReplace={async (next) => {
          // Send the imported set straight to the server, bypassing local
          // unsaved-state — the user explicitly chose to replace.
          await onSave(next);
          setLocal(pruneOrphanValues(next, eligibleColumns));
          setServerSnapshot(JSON.stringify(next));
        }}
      />

      <RuleSection
        title="Override rules"
        description="Set column values on matching events."
        variant="override"
        rules={overrideRules}
        eligibleColumns={eligibleColumns}
        openIds={openIds}
        saving={saving}
        disabled={disabled}
        onOpenChange={setOpen}
        onChange={updateOne}
        onDuplicate={duplicateOne}
        onDelete={removeOne}
        onMove={moveWithinVariant}
        onAdd={() => addOne('override')}
        emptyHint={
          eligibleColumns.length === 0
            ? 'No columns have been enabled for conditional override. Ask your admin to enable some in Setup.'
            : 'No override rules yet.'
        }
        addDisabled={eligibleColumns.length === 0}
      />

      <RuleSection
        title="Skip rules"
        description="Don't import matching events."
        variant="skip"
        rules={skipRules}
        eligibleColumns={eligibleColumns}
        openIds={openIds}
        saving={saving}
        disabled={disabled}
        onOpenChange={setOpen}
        onChange={updateOne}
        onDuplicate={duplicateOne}
        onDelete={removeOne}
        onMove={moveWithinVariant}
        onAdd={() => addOne('skip')}
        emptyHint="No skip rules yet."
      />
    </div>
  );
}

interface SectionProps {
  title: string;
  description: string;
  variant: ConditionalAction;
  rules: Conditional[];
  eligibleColumns: Column[];
  openIds: Set<string>;
  saving: boolean;
  disabled?: boolean;
  onOpenChange: (id: string, open: boolean) => void;
  onChange: (id: string, c: Conditional) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onAdd: () => void;
  emptyHint: string;
  addDisabled?: boolean;
}

function RuleSection({
  title,
  description,
  variant,
  rules,
  eligibleColumns,
  openIds,
  saving,
  disabled,
  onOpenChange,
  onChange,
  onDuplicate,
  onDelete,
  onMove,
  onAdd,
  emptyHint,
  addDisabled,
}: SectionProps) {
  const accent = variant === 'skip' ? '#e2445c' : '#0073ea';
  return (
    <div
      style={{
        display: 'grid',
        gap: 12,
        padding: '14px 16px 16px',
        border: '1px solid #e6e9ef',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <div style={{ color: '#676879', fontSize: 13, marginTop: 2 }}>{description}</div>
        </div>
        <Button
          size="small"
          kind="secondary"
          disabled={disabled || saving || addDisabled}
          onClick={onAdd}
        >
          + Add {variant === 'skip' ? 'skip rule' : 'override rule'}
        </Button>
      </div>

      {rules.length === 0 ? (
        <div
          style={{
            padding: 16,
            border: '1px dashed #c3c6d4',
            borderRadius: 6,
            textAlign: 'center',
            color: '#676879',
            fontSize: 13,
          }}
        >
          {emptyHint}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rules.map((c, i) => (
            <ConditionalCard
              key={c.id}
              conditional={c}
              variant={variant}
              eligibleColumns={eligibleColumns}
              disabled={disabled || saving}
              canMoveUp={i > 0}
              canMoveDown={i < rules.length - 1}
              open={openIds.has(c.id)}
              onOpenChange={(open) => onOpenChange(c.id, open)}
              onChange={(next) => onChange(c.id, next)}
              onDuplicate={() => onDuplicate(c.id)}
              onDelete={() => onDelete(c.id)}
              onMoveUp={() => onMove(c.id, -1)}
              onMoveDown={() => onMove(c.id, 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

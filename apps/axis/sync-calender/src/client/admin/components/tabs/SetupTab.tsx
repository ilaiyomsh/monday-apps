import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { AttentionBox, Button, Chips, Text } from '@vibe/core';
import { Check, Board, Link, Column, Filter, Info, NavigationChevronRight, NavigationChevronLeft } from '@vibe/icons';
import { BoardPicker } from '../pickers/BoardPicker';
import { ColumnPicker } from '../pickers/ColumnPicker';
import { ColumnMappingTable } from '../mapping/ColumnMappingTable';
import { EligibleColumnsPicker } from '../conditionals/EligibleColumnsPicker';
import { BackupRestoreBar } from '../setup/BackupRestoreBar';
import { ConfirmDialog } from '../feedback/ConfirmDialog';
import { useBoardColumns } from '../../hooks/useBoardColumns';
import { useBoards } from '../../hooks/useBoards';
import { useToast } from '../feedback/ToastProvider';
import { deriveSetupProgress } from '../../lib/setupProgress';
import logger from '../../lib/logger';
import { useViewTracking } from '../../lib/viewTracking';
import type { Column as BoardColumn, ColumnMapping, Policy, SyncConfig } from '../../types';

interface Props {
  policy: Policy | null;
  isOwner: boolean;
  tokenReady: boolean;
  configs: SyncConfig[];
  onPatch: (updates: Partial<Policy>) => Promise<Policy>;
}

type StepKey = 'summary' | 'board' | 'ident' | 'map' | 'cond';
type IconCmp = ComponentType<{ size?: string | number }>;

interface Step {
  key: StepKey;
  title: string;
  short: string;
  hint: string;
  icon: IconCmp;
}

const STEPS: Step[] = [
  { key: 'summary', title: 'Summary',              short: 'Summary',     icon: Info as IconCmp,
    hint: 'Overview of the current setup. Use the tabs to edit any section.' },
  { key: 'board', title: '1. Choose a board',      short: 'Board',       icon: Board as IconCmp,
    hint: 'Pick the board where calendar events will become items. You can change this later — items on the previous board stay put.' },
  { key: 'ident', title: '2. Identify events',     short: 'Identify',    icon: Link as IconCmp,
    hint: 'The Event Link column is how the sync finds existing items. The Sync Lock checkbox is auto-checked on every newly-created item — uncheck it on a row to detach that row from sync. The People column is optional — when set, every synced item gets the row owner assigned.' },
  { key: 'map',   title: '3. Map fields',          short: 'Mapping',     icon: Column as IconCmp,
    hint: 'Each row is a column on your board. Pick a Google Calendar field as the source.' },
  { key: 'cond',  title: '4. Override columns',    short: 'Overrides',   icon: Filter as IconCmp,
    hint: 'Pick which columns each user may override via their own Conditions. Status and connect-boards columns are supported.' },
];

function computeDone(policy: Policy | null): Record<StepKey, boolean> {
  const base = deriveSetupProgress(policy);
  return {
    summary: true,
    board: base.hasBoard,
    ident: base.hasLink && base.hasLock,
    map: base.mappedCount >= 1,
    cond: (policy?.conditionalEligibleColumns ?? []).length > 0,
  };
}

function formatUpdatedAt(ts: number | null | undefined): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const date = d.toLocaleDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Last updated ${date} ${time}`;
  } catch {
    return '';
  }
}

export function SetupTab({ policy, isOwner, tokenReady, configs, onPatch }: Props) {
  useViewTracking(logger, 'setup');
  const toast = useToast();
  const [boardId, setBoardId] = useState<string | null>(policy?.boardId ?? null);
  const { columns, loading: colsLoading } = useBoardColumns(boardId);
  const { boards } = useBoards(tokenReady);
  const [pendingBoardChange, setPendingBoardChange] = useState<{ id: string | null; ruleCount: number } | null>(null);

  useEffect(() => { setBoardId(policy?.boardId ?? null); }, [policy?.boardId]);

  const done = useMemo(() => computeDone(policy), [policy]);

  const lock: Record<StepKey, boolean> = {
    summary: false,
    board: false,
    ident: !done.board,
    map:   !done.ident,
    cond:  !done.ident,
  };

  // Default landing on the Summary tab — provides at-a-glance overview.
  const [active, setActive] = useState<StepKey>('summary');

  if (!policy) {
    return (
      <div className="setup-section">
        <h3>Setup</h3>
        <p className="hint">
          Policy not provisioned yet — the Custom Object lifecycle webhook will create it on first install.
        </p>
      </div>
    );
  }

  const disabled = !isOwner;

  const handlePatch = async (updates: Partial<Policy>) => {
    try {
      await onPatch(updates);
      toast.success('Saved');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
      throw err;
    }
  };

  // Switching boards wipes every user's per-row conditionals (server enforces
  // this — see src/routes/policy.js). Surface a confirm so the owner sees
  // exactly how many rules are about to vanish.
  const handleBoardChange = (next: string | null) => {
    if (disabled) return;
    if (String(next || '') === String(policy?.boardId || '')) return;
    if (!policy?.boardId) {
      setBoardId(next);
      handlePatch({ boardId: next }).catch(() => {});
      return;
    }
    const ruleCount = configs.reduce((sum, c) => sum + (c.conditionals?.length || 0), 0);
    if (ruleCount === 0) {
      setBoardId(next);
      handlePatch({ boardId: next }).catch(() => {});
      return;
    }
    setPendingBoardChange({ id: next, ruleCount });
  };

  const confirmBoardChange = () => {
    if (!pendingBoardChange) return;
    const next = pendingBoardChange.id;
    setPendingBoardChange(null);
    setBoardId(next);
    handlePatch({ boardId: next }).catch(() => {});
  };

  const goto = (k: StepKey) => { if (!lock[k] || done[k]) setActive(k); };
  const idx = STEPS.findIndex((s) => s.key === active);
  const activeStep = STEPS[idx];
  const back = () => setActive(STEPS[Math.max(0, idx - 1)].key);
  const next = () => setActive(STEPS[Math.min(STEPS.length - 1, idx + 1)].key);

  const isLastStep = idx === STEPS.length - 1;
  const nextStep = !isLastStep ? STEPS[idx + 1] : null;
  const canAdvance = done[active];

  return (
    <div className="setup-wizard">
      {!isOwner && (
        <AttentionBox
          type="primary"
          title="Read-only — owner-managed policy"
          text="Only the Custom Object owner can edit the shared board policy. Ask them for changes."
        />
      )}

      <div className="setup-wizard-head">
        <BackupRestoreBar policy={policy} isOwner={isOwner} onPatch={onPatch} />
      </div>

      <nav className="setup-tabs" role="tablist">
        {STEPS.map((s, i) => {
          const isActive = s.key === active;
          const isDone = done[s.key];
          const isLocked = lock[s.key] && !isDone;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              disabled={isLocked}
              onClick={() => goto(s.key)}
              className={`setup-tab${isActive ? ' active' : ''}${isDone ? ' done' : ''}${isLocked ? ' locked' : ''}`}
            >
              <span className="setup-tab-num">
                {isDone ? <Check size={12} /> : i + 1}
              </span>
              <Icon size={14} />
              <span>{s.short}</span>
            </button>
          );
        })}
      </nav>

      <div className="setup-body">
        <h3>{activeStep.title}</h3>
        <p className="hint">{activeStep.hint}</p>

        {active === 'summary' && (
          <SummaryView
            policy={policy}
            columns={columns}
            colsLoading={colsLoading}
            boardName={boards.find((b) => String(b.id) === String(policy.boardId))?.name}
            done={done}
            onJump={goto}
          />
        )}

        {active === 'board' && (
          <Field label="Board">
            <BoardPicker
              value={boardId}
              disabled={disabled}
              tokenReady={tokenReady}
              onChange={(v) => handleBoardChange(v || null)}
            />
          </Field>
        )}

        {active === 'ident' && (
          <div className="fields-grid">
            <Field label="Event Link column · required">
              <ColumnPicker
                columns={columns}
                value={policy.linkColumnId}
                disabled={disabled || !boardId}
                typeFilter={(c) => c.type === 'link'}
                onChange={(v) => { if (!disabled) handlePatch({ linkColumnId: v }).catch(() => {}); }}
              />
            </Field>
            <Field label="Sync Lock column · required (Checkbox)">
              <ColumnPicker
                columns={columns}
                value={policy.lockColumnId}
                disabled={disabled || !boardId}
                typeFilter={(c) => c.type === 'checkbox'}
                onChange={(v) => { if (!disabled) handlePatch({ lockColumnId: v }).catch(() => {}); }}
              />
            </Field>
            <Field label="People column · optional">
              <ColumnPicker
                columns={columns}
                value={policy.peopleColumnId}
                disabled={disabled || !boardId}
                typeFilter={(c) => c.type === 'people'}
                onChange={(v) => { if (!disabled) handlePatch({ peopleColumnId: v }).catch(() => {}); }}
              />
            </Field>
          </div>
        )}

        {active === 'map' && (
          !boardId ? (
            <Text type="text2" color="secondary">Pick a board to see its columns.</Text>
          ) : colsLoading ? (
            <Text type="text2" color="secondary">Loading columns…</Text>
          ) : (
            <ColumnMappingTable
              columns={columns}
              policy={policy}
              canEdit={!disabled}
              onSaveMapping={async (mapping: ColumnMapping) => {
                await handlePatch({ columnMapping: mapping });
              }}
            />
          )
        )}

        {active === 'cond' && (
          !boardId ? (
            <Text type="text2" color="secondary">Pick a board first.</Text>
          ) : colsLoading ? (
            <Text type="text2" color="secondary">Loading columns…</Text>
          ) : (
            <EligibleColumnsPicker
              columns={columns}
              value={policy.conditionalEligibleColumns ?? []}
              disabled={disabled}
              onChange={(n) => handlePatch({ conditionalEligibleColumns: n }).catch(() => {})}
            />
          )
        )}
      </div>

      <div className="setup-footbar">
        <span className="setup-footbar-audit">
          {formatUpdatedAt(policy.updatedAt)}
        </span>
        <div className="setup-footbar-actions">
          {idx > 0 && (
            <Button
              kind="tertiary"
              onClick={back}
              leftIcon={NavigationChevronLeft}
            >
              Back: {STEPS[idx - 1].short}
            </Button>
          )}
          {!isLastStep ? (
            <Button
              kind="primary"
              disabled={!canAdvance}
              onClick={next}
              rightIcon={NavigationChevronRight}
            >
              Next: {nextStep!.short}
            </Button>
          ) : (
            <Button kind="primary" leftIcon={Check} disabled>
              Setup complete
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingBoardChange !== null}
        title="Change board?"
        body={
          pendingBoardChange
            ? `Switching boards will delete ${pendingBoardChange.ruleCount} conditional ${pendingBoardChange.ruleCount === 1 ? 'rule' : 'rules'} across all users on this app. This cannot be undone.`
            : undefined
        }
        confirmLabel="Change board"
        destructive
        onConfirm={confirmBoardChange}
        onCancel={() => setPendingBoardChange(null)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <Text type="text2" color="secondary" element="div" style={{ marginBottom: 4 }}>
        {label}
      </Text>
      {children}
    </label>
  );
}

interface SummaryViewProps {
  policy: Policy;
  columns: BoardColumn[];
  colsLoading: boolean;
  boardName: string | undefined;
  done: Record<StepKey, boolean>;
  onJump: (k: StepKey) => void;
}

function SummaryView({ policy, columns, colsLoading, boardName, done, onJump }: SummaryViewProps) {
  const colTitle = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return columns.find((c) => c.id === id)?.title ?? id;
  };
  const linkTitle = colTitle(policy.linkColumnId);
  const lockTitle = colTitle(policy.lockColumnId);
  const peopleTitle = colTitle(policy.peopleColumnId);
  const mappingEntries = Object.entries(policy.columnMapping ?? {});
  const eligibleIds = policy.conditionalEligibleColumns ?? [];
  const eligibleTitles = eligibleIds.map((id) => colTitle(id)).filter(Boolean) as string[];

  return (
    <div className="summary-grid">
      <SummaryCard
        title="Board"
        status={done.board ? 'set' : 'missing'}
        onEdit={() => onJump('board')}
      >
        {policy.boardId ? (
          <span className="summary-value">{boardName ?? `Board #${policy.boardId}`}</span>
        ) : (
          <span className="summary-empty">No board selected.</span>
        )}
      </SummaryCard>

      <SummaryCard
        title="Identify"
        status={done.ident ? 'set' : 'missing'}
        onEdit={() => onJump('ident')}
      >
        <dl className="summary-defs">
          <dt>Event Link</dt>
          <dd>{colsLoading ? '…' : linkTitle ?? <span className="summary-empty">not set</span>}</dd>
          <dt>Sync Lock</dt>
          <dd>{colsLoading ? '…' : lockTitle ?? <span className="summary-empty">not set</span>}</dd>
          <dt>People</dt>
          <dd>{colsLoading ? '…' : peopleTitle ?? <span className="summary-empty">optional</span>}</dd>
        </dl>
      </SummaryCard>

      <SummaryCard
        title="Override columns"
        status={done.cond ? 'set' : 'missing'}
        onEdit={() => onJump('cond')}
        meta={`${eligibleTitles.length} ${eligibleTitles.length === 1 ? 'column' : 'columns'}`}
      >
        {eligibleTitles.length === 0 ? (
          <span className="summary-empty">No override columns enabled.</span>
        ) : (
          <div className="summary-chips">
            {eligibleTitles.map((t, i) => (
              <Chips key={i} label={t} readOnly noAnimation color="primary" />
            ))}
          </div>
        )}
      </SummaryCard>

      <SummaryCard
        title="Mapped columns"
        status={done.map ? 'set' : 'missing'}
        onEdit={() => onJump('map')}
        meta={`${mappingEntries.length} ${mappingEntries.length === 1 ? 'column' : 'columns'}`}
      >
        {mappingEntries.length === 0 ? (
          <span className="summary-empty">No fields mapped yet.</span>
        ) : (
          <div className="summary-chips">
            {mappingEntries.slice(0, 12).map(([colId]) => (
              <Chips
                key={colId}
                label={colsLoading ? colId : colTitle(colId) ?? colId}
                readOnly
                noAnimation
              />
            ))}
            {mappingEntries.length > 12 && (
              <Chips label={`+${mappingEntries.length - 12} more`} readOnly noAnimation color="primary" />
            )}
          </div>
        )}
      </SummaryCard>
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  status: 'set' | 'missing';
  meta?: string;
  onEdit: () => void;
  children: React.ReactNode;
}

function SummaryCard({ title, status, meta, onEdit, children }: SummaryCardProps) {
  return (
    <div className="summary-card">
      <div className="summary-card-head">
        <div className="summary-card-title">
          <strong>{title}</strong>
          {meta && <span className="summary-card-meta">· {meta}</span>}
          <span className={`summary-card-status ${status}`}>
            {status === 'set' ? 'Configured' : 'Not set'}
          </span>
        </div>
        <Button size="small" kind="tertiary" onClick={onEdit}>Edit</Button>
      </div>
      <div className="summary-card-body">{children}</div>
    </div>
  );
}

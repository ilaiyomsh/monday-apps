import React, { useRef, useState } from 'react';
import { Skeleton, Button, Dialog, DialogContentContainer } from '@vibe/core';
import { Trash2, Check, X } from 'lucide-react';
import { PersonAvatar, PersonList } from '@generated/components/PersonAvatar';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { isValidStatus } from '@generated/constants/statusConfig';
import { getBoardId } from '@api/board-config-store.js';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import styles from './DecisionsTab.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

// dd/mm for the תאריך column (mockup format; DatePickerPopover's default is
// DD/MM/YYYY so we pass this via its formatDate prop).
function formatDayMonth(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/*
 * Inline label picker cell shared by the סטאטוס (full-fill) and עדיפות (pill)
 * columns. Mirrors TaskTableRow's Dialog pattern: opens upward by default
 * (flips when there's no room) and AUTO-CLOSES on select — both via the
 * explicit setOpen(false) in the option's onClick and via the
 * 'onContentClick' hideTrigger (the recent TasksTab auto-close behavior).
 * Options/labels/colors come from the MAPPED status column (useStatusOptions),
 * never hardcoded. When the picker isn't editable (or the column has no
 * options because it's unmapped) it degrades to a display-only cell.
 */
function LabelPickerCell({ value, opts, canEdit, onPick, pill = false, placeholder }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState('top-start');
  const triggerRef = useRef(null);

  const label = opts.labelById[value];
  const hasValue = isValidStatus(value) && label != null;
  const fill = hasValue ? (opts.colorById[value] || NEUTRAL) : null;

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'top-start',
      popupWidth: 184,
      popupHeight: Math.max(180, (opts.options?.length || 0) * 46 + 24),
      offset: 4,
    });
    if (next?.placement) setPosition(next.placement);
  };

  const display = pill ? (
    hasValue ? (
      <span className={`${styles.decPill} ${styles.decPillFilled}`} style={{ background: fill }}>{label}</span>
    ) : (
      <span className={styles.decPill}>{placeholder}</span>
    )
  ) : hasValue ? (
    <span className={styles.decFill} style={{ background: fill }}>{label}</span>
  ) : (
    <span className={styles.decFillEmpty}>{placeholder}</span>
  );

  // Editable only with the capability AND an actual label set to pick from
  // (an unmapped column yields zero options — degrade to display).
  if (!canEdit || (opts.options?.length || 0) === 0) return display;

  return (
    <Dialog
      open={open}
      showTrigger={['click']}
      hideTrigger={['clickoutside', 'esc', 'onContentClick']}
      onDialogDidShow={() => { updatePosition(); setOpen(true); }}
      onDialogDidHide={() => setOpen(false)}
      position={position}
      zIndex={1000}
      content={() => (
        <DialogContentContainer>
          <div className={styles.decMenu}>
            {(opts.options || []).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={styles.decMenuOption}
                style={{ background: opt.color || NEUTRAL }}
                onClick={() => { onPick(opt.id); setOpen(false); }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </DialogContentContainer>
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        className={pill ? styles.decPillTrigger : styles.decFillTrigger}
        onMouseDown={updatePosition}
      >
        {display}
      </button>
    </Dialog>
  );
}

function DecisionRow({ decision, statusOpts, priorityOpts, can, onRename, onStatus, onPriority, onDate, onAffected, onDelete }) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(decision.name || '');
  const [confirmDel, setConfirmDel] = useState(false);

  // Optimistic row whose monday item isn't saved yet (useDecisions temp id):
  // faded + locked until createDecision swaps in the server id (mirrors
  // TaskTableRow's pending state).
  const pending = String(decision.id).startsWith('temp-');

  const deciderPeople = Array.isArray(decision.deciderID) ? decision.deciderID : [];
  const affected = Array.isArray(decision.affectedID) ? decision.affectedID : [];
  const date = decision.decisionDateID instanceof Date ? decision.decisionDateID : null;

  const canRename = can('editDecisionName', decision);
  const canDelete = can('deleteDecision', decision);

  const startEditName = () => {
    if (!canRename) return;
    setNameDraft(decision.name || '');
    setEditingName(true);
  };
  const saveName = () => {
    const t = nameDraft.trim();
    if (t && t !== decision.name) onRename(decision.id, t);
    setEditingName(false);
  };

  return (
    <div className={`${styles.decRow} ${styles.decBodyRow} ${pending ? styles.decPending : ''}`} aria-busy={pending || undefined}>
      {/* החלטה — inset purple accent bar, inline rename (gated), hover delete */}
      <div className={`${styles.decCell} ${styles.decNameCell}`}>
        {editingName ? (
          <input
            className={styles.decNameInput}
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveName(); }
              if (e.key === 'Escape') { setEditingName(false); }
            }}
            onBlur={saveName}
          />
        ) : canRename ? (
          <button
            type="button"
            className={styles.decNameBtn}
            onClick={startEditName}
            title={decision.name}
            aria-label={`ערוך החלטה: ${decision.name}`}
          >
            {decision.name}
          </button>
        ) : (
          <span className={styles.decNameText} title={decision.name}>{decision.name}</span>
        )}
        {canDelete && (
          confirmDel ? (
            <span className={styles.decConfirmDel} onClick={(e) => e.stopPropagation()}>
              <span className={styles.decConfirmText}>למחוק?</span>
              <button
                type="button"
                className={`${styles.decConfirmBtn} ${styles.decConfirmYes}`}
                onClick={(e) => { e.stopPropagation(); setConfirmDel(false); onDelete(decision.id); }}
                aria-label="אישור מחיקה"
                title="אישור"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                className={styles.decConfirmBtn}
                onClick={(e) => { e.stopPropagation(); setConfirmDel(false); }}
                aria-label="ביטול מחיקה"
                title="ביטול"
              >
                <X size={14} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={styles.decDeleteBtn}
              onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }}
              aria-label="מחק החלטה"
              title="מחק החלטה"
            >
              <Trash2 size={18} />
            </button>
          )
        )}
      </div>

      {/* מחליט — single avatar (display-only; no edit capability for decider) */}
      <div className={styles.decCell}>
        {deciderPeople.length > 0 ? (
          <PersonAvatar person={deciderPeople[0]} showName={false} />
        ) : (
          <span className={styles.decMuted}>—</span>
        )}
      </div>

      {/* מושפעים — up to 3 overlapping avatars + "+N"; PersonPicker when editable */}
      <div className={styles.decCell}>
        {can('editDecisionAffected', decision) ? (
          <PersonPicker
            selected={affected}
            onChange={(people) => onAffected(decision.id, people)}
          />
        ) : (
          <PersonList people={affected} size="sm" showNames={false} max={3} />
        )}
      </div>

      {/* עדיפות — pill + inline picker (auto-closes on select) */}
      <div className={styles.decCell}>
        <LabelPickerCell
          value={decision.decisionPriorityID}
          opts={priorityOpts}
          canEdit={can('editDecisionPriority', decision)}
          onPick={(id) => onPriority(decision.id, id)}
          pill
          placeholder="—"
        />
      </div>

      {/* סטאטוס — full-fill cell + inline picker (auto-closes on select) */}
      <div className={`${styles.decCell} ${styles.decStatusCell}`}>
        <LabelPickerCell
          value={decision.decisionStatusID}
          opts={statusOpts}
          canEdit={can('editDecisionStatus', decision)}
          onPick={(id) => onStatus(decision.id, id)}
          placeholder="בחר סטאטוס"
        />
      </div>

      {/* תאריך — dd/mm; DatePickerPopover when editable */}
      <div className={styles.decCell}>
        {can('editDecisionDate', decision) ? (
          <DatePickerPopover
            value={date}
            onChange={(d) => onDate(decision.id, d)}
            formatDate={formatDayMonth}
          />
        ) : date ? (
          <span className={styles.decMuted}>{formatDayMonth(date)}</span>
        ) : (
          <span className={styles.decMuted}>—</span>
        )}
      </div>
    </div>
  );
}

/*
 * החלטות tab — monday-style decisions table for the current discussion.
 * `data` is the shared useDecisions() result (prefetched by DiscussionCard).
 * Editing is gated PER ROW via `canDecision(capId, decision)` (decision-tier
 * capabilities, mirroring TasksTab's canTask); `canCreateDecision` gates the
 * "החלטה חדשה" button and the add-row. Both creation affordances call
 * `onNewDecision()` — the create flow itself lives outside this tab.
 * Selection / bulk actions are deliberately NOT part of v1.
 */
export function DecisionsTab({ data, onNewDecision, onNotify, canDecision = () => true, canCreateDecision = true }) {
  const {
    items,
    loading,
    updateDecisionName,
    updateDecisionStatus,
    updateDecisionPriority,
    updateDecisionDate,
    updateDecisionAffected,
    softDeleteDecisions,
  } = data;

  // Status/priority label sets come from the MAPPED decisions status columns —
  // useStatusOptions never fires when the board/column is unmapped.
  const statusOpts = useStatusOptions('decisions', 'decisionStatusID');
  const priorityOpts = useStatusOptions('decisions', 'decisionPriorityID');

  // The decisions board is mapped MANUALLY in Settings (not wizard-created) —
  // unmapped is an EXPECTED state: render the empty state, fire nothing.
  const boardMapped = !!getBoardId('decisions');
  if (!boardMapped) {
    return (
      <div className={styles.decisionsRoot}>
        <div className={styles.decEmptyState}>לוח ההחלטות טרם הוגדר — מפו אותו בהגדרות</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.decSkeletonStack}>
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} type="rectangle" height={40} fullWidth />)}
      </div>
    );
  }

  // Deferred delete with an undo window (softDeleteDecisions): the row vanishes
  // now, the real delete fires when the toast's "בטל" expires.
  const handleDelete = (id) => {
    const { undo } = softDeleteDecisions(id);
    onNotify?.('ההחלטה נמחקה', 'info', 6000, { label: 'בטל', onClick: undo });
  };

  return (
    <div className={styles.decisionsRoot}>
      <div className={styles.decToolbar}>
        {canCreateDecision && (
          <Button kind={"primary"} size={"small"} onClick={() => onNewDecision?.()}>החלטה חדשה</Button>
        )}
      </div>

      <div className={styles.decBoard}>
        <div className={styles.decTable}>
          <div className={`${styles.decRow} ${styles.decHead}`}>
            <div className={`${styles.decCell} ${styles.decHeadCell} ${styles.decNameHead}`}>החלטה</div>
            <div className={`${styles.decCell} ${styles.decHeadCell}`}>מחליט</div>
            <div className={`${styles.decCell} ${styles.decHeadCell}`}>מושפעים</div>
            <div className={`${styles.decCell} ${styles.decHeadCell}`}>עדיפות</div>
            <div className={`${styles.decCell} ${styles.decHeadCell}`}>סטאטוס</div>
            <div className={`${styles.decCell} ${styles.decHeadCell}`}>תאריך</div>
          </div>

          {items.length === 0 && !canCreateDecision && (
            <div className={styles.decEmptyRow}>אין החלטות עדיין</div>
          )}

          {items.map((d) => (
            <DecisionRow
              key={d.id}
              decision={d}
              statusOpts={statusOpts}
              priorityOpts={priorityOpts}
              can={canDecision}
              onRename={updateDecisionName}
              onStatus={updateDecisionStatus}
              onPriority={updateDecisionPriority}
              onDate={updateDecisionDate}
              onAffected={updateDecisionAffected}
              onDelete={handleDelete}
            />
          ))}

          {canCreateDecision && (
            <button type="button" className={styles.decAddRow} onClick={() => onNewDecision?.()}>
              <span className={styles.decAddRowInner}>+ הוסף החלטה</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default DecisionsTab;

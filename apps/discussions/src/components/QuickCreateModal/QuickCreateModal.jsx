import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, Button, Flex } from '@vibe/core';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import styles from './QuickCreateModal.module.css';

/**
 * Quick-create modal opened by the global FAB (and by per-point "+" actions):
 * one big underlined text field with a החלטה/משימה segmented toggle when NOT
 * point-scoped (mockup: fabShowToggle).
 *
 * The DECISION form is intentionally minimal — just the wording. Its status
 * ("סטאטוס") and decider ("הגורם המחליט") are NOT collected here (round 52): a
 * decision is created quickly from a topic point and those two fields are filled
 * in later from the Decisions view. The TASK form keeps its two optional fields:
 * אחראי (assignee) + דד ליין (deadline).
 *
 * PRESENTATION-ONLY: on submit it fires `onCreate(kind, payload)` and closes —
 * the PARENT applies defaults (affected=participants etc.) and performs the
 * actual mutation (same fire-and-forget contract as NewTaskModal).
 *
 * Props:
 *   open          — bool
 *   initialMode   — 'decision' | 'task' (mode on open; toggle can change it)
 *   scopedPoint   — { id, name } | null; when set the toggle is hidden and the
 *                   scope caption reads "משויך לנקודה: <name>"
 *   discussion    — { name } | null; caption fallback "דיון: <name>"
 *   participants  — passed by the parent for ITS default-applying logic; the
 *                   modal itself doesn't consume it (kept for the contract)
 *   currentUser   — same: parent-side defaults only
 *   onClose()     — close without creating
 *   onCreate(kind, { text, person: people[]|null, deadline: Date|null })
 *   allowTask / allowDecision — disable that side of the toggle (default true)
 */
export function QuickCreateModal({
  open,
  initialMode = 'task',
  // Item 12: the clicked "+" button's DOMRect. When present (desktop), the box
  // opens right BELOW the +, horizontally centered on it (clamped to the
  // viewport); null keeps the default overlay placement. Ignored on mobile —
  // the bottom-sheet layout wins there.
  anchor = null,
  // Owner request 2026-07-14: opened from the Tasks/Decisions TAB (top button /
  // add-row) the box opens DEAD-CENTER of the screen; point-anchored opens from
  // the Topics tab keep their round-57 placement (anchor wins over centered).
  centered = false,
  scopedPoint = null,
  discussion = null,
  participants, // eslint-disable-line no-unused-vars -- parent-side defaults; part of the prop contract
  currentUser, // eslint-disable-line no-unused-vars -- parent-side defaults; part of the prop contract
  onClose,
  onCreate,
  allowTask = true,
  allowDecision = true,
}) {
  const [mode, setMode] = useState('task');
  const [text, setText] = useState('');
  const [person, setPerson] = useState([]);
  const [deadline, setDeadline] = useState(null);
  const inputRef = useRef(null);

  // Reset per open; clamp the initial mode to an allowed side.
  useEffect(() => {
    if (!open) return;
    let next = initialMode === 'decision' ? 'decision' : 'task';
    if (next === 'decision' && !allowDecision && allowTask) next = 'task';
    if (next === 'task' && !allowTask && allowDecision) next = 'decision';
    setMode(next);
    setText('');
    setPerson([]);
    setDeadline(null);
  }, [open, initialMode, allowDecision, allowTask]);

  // round229 (owner request) — focus the text input the moment the card opens
  // AND every time the משימה/החלטה toggle switches, so the user can type
  // immediately without clicking into the field. rAF defers the focus to after
  // the (re)render so the anchored/re-keyed input actually receives it.
  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, mode]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return undefined;
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  const isDecision = mode === 'decision';
  // round226 (approved mockup — unified תוצרים): the משימה/החלטה toggle shows
  // for POINT-SCOPED creates too (the point's single + opens ONE box, task
  // default). It hides only when a side is capability-disabled at the callsite.
  const showToggle = allowTask && allowDecision;
  const scopeLabel = useMemo(() => {
    if (scopedPoint?.name) return `משויך לנקודה: ${scopedPoint.name}`;
    if (discussion?.name) return `דיון: ${discussion.name}`;
    return '';
  }, [scopedPoint, discussion]);

  if (!open) return null;

  const canSubmit = text.trim().length > 0;

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // DECISION: wording only (no status/decider — set later in the Decisions
    // view). TASK: optional assignee + deadline. The sibling field that doesn't
    // apply to the created kind goes out as null.
    onCreate(isDecision ? 'decision' : 'task', {
      text: trimmed,
      person: !isDecision && person.length ? person : null,
      deadline: isDecision ? null : deadline,
    });
    onClose();
  };

  // Enter ANYWHERE in the form submits — same as clicking "צור החלטה"/"צור משימה"
  // — while RESPECTING the button's disabled state (canSubmit). Skipped for
  // textareas and buttons (native activation), and for any control inside an
  // open listbox/menu (a portaled picker), so choosing a value with Enter
  // doesn't also submit. PersonPicker / date popovers are portaled, so their
  // Enter never bubbles here.
  const onFormKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
    if (t && typeof t.closest === 'function' && t.closest('[role="listbox"], [role="menu"]')) return;
    if (!canSubmit) return;
    e.preventDefault();
    submit();
  };

  // Anchored placement (item 12): absolute-position the shell inside the fixed
  // overlay so its TOP edge sits just under the + and its CENTER lines up with
  // the button's center, clamped so the 520px shell never leaves the viewport.
  // Desktop only — the ≤768px bottom-sheet keeps its own layout.
  const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
  const anchorStyle = (anchor && isDesktop)
    ? (() => {
        const width = Math.min(520, window.innerWidth - 32);
        const centerX = anchor.left + anchor.width / 2;
        const left = Math.max(16, Math.min(centerX - width / 2, window.innerWidth - width - 16));
        const top = Math.max(16, Math.min(anchor.bottom + 8, window.innerHeight - 380));
        return { position: 'absolute', top, left, margin: 0 };
      })()
    : undefined;

  // Centered layout applies only when no anchor is in effect (an anchored
  // per-point open always wins; mobile keeps the bottom sheet either way).
  const overlayClass = (centered && !anchorStyle)
    ? `${styles.overlay} ${styles.overlayCentered}`
    : styles.overlay;

  return (
    <div className={overlayClass} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className={styles.modal}
        style={anchorStyle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onFormKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={isDecision ? 'יצירת החלטה מהירה' : 'יצירת משימה מהירה'}
        dir="rtl"
      >
        <div className={styles.topRow}>
          <div className={styles.topRowStart}>
            {showToggle && (
              <div className={styles.segmented} role="tablist" aria-label="סוג פריט">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isDecision}
                  className={`${styles.segBtn} ${isDecision ? styles.segBtnActive : ''}`}
                  onClick={() => setMode('decision')}
                  disabled={!allowDecision}
                >
                  החלטה
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isDecision}
                  className={`${styles.segBtn} ${!isDecision ? styles.segBtnActive : ''}`}
                  onClick={() => setMode('task')}
                  disabled={!allowTask}
                >
                  משימה
                </button>
              </div>
            )}
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="סגירה">
            ×
          </button>
        </div>

        <div className={styles.body}>
          <input
            ref={inputRef}
            className={styles.textInput}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={isDecision ? 'מה ההחלטה? *' : 'שם המשימה *'}
            aria-label={isDecision ? 'טקסט ההחלטה (חובה)' : 'שם המשימה (חובה)'}
          />
          {scopeLabel && <div className={styles.scopeCaption}>{scopeLabel}</div>}

          {/* TASK-only optional fields (אחראי + דד ליין). The DECISION form is
              intentionally just the wording — its status + decider are set later
              from the Decisions view (round 52). */}
          {!isDecision && (
            <div className={styles.row}>
              <div className={styles.field}>
                <Text type="text2" className={styles.label}>
                  אחראי <span className={styles.optional}>(אופציונלי)</span>
                </Text>
                <PersonPicker
                  selected={person}
                  onChange={setPerson}
                  bordered
                  closeOnSelect
                  single
                  boardKey="tasks"
                  accountWide
                />
              </div>
              <div className={styles.field}>
                <Text type="text2" className={styles.label}>
                  דד ליין <span className={styles.optional}>(אופציונלי)</span>
                </Text>
                <DatePickerPopover
                  variant="field"
                  zIndex={4200}
                  value={deadline}
                  onChange={(d) => setDeadline(d || null)}
                />
              </div>
            </div>
          )}

          <Flex gap={8} justify="end" className={styles.footer}>
            <Button kind="tertiary" onClick={onClose}>
              ביטול
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {isDecision ? 'צור החלטה' : 'צור משימה'}
            </Button>
          </Flex>
        </div>
      </div>
    </div>
  );
}

export default QuickCreateModal;

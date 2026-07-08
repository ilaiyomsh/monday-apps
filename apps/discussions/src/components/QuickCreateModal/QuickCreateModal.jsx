import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, Button, Flex } from '@vibe/core';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { useStatusOptions } from '@generated/hooks/useStatusOptions.js';
import styles from './QuickCreateModal.module.css';

/**
 * Small inline status select (decision-status field). Options come from the
 * MAPPED decisions status column via useStatusOptions — never hardcoded.
 * Renders a bordered trigger ("בחר" + caret per the approved mockup) and an
 * absolutely-positioned menu inside the field (the modal shell keeps
 * `overflow: visible`, mirroring NewTaskModal, so the menu escapes cleanly).
 */
function StatusSelect({ options, colorById, labelById, value, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Close on click-outside / Escape (stopPropagation so Escape doesn't also
  // close the whole modal while the menu is the active layer).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);

  const hasOptions = options.length > 0;
  const selectedLabel = value != null ? labelById[value] : null;
  const selectedColor = value != null ? colorById[value] : null;

  return (
    <div className={styles.selectRoot} ref={rootRef}>
      <button
        type="button"
        className={styles.selectTrigger}
        onClick={() => hasOptions && setOpen((o) => !o)}
        disabled={!hasOptions}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={!hasOptions && !loading ? 'עמודת הסטאטוס של ההחלטות טרם מופתה בהגדרות' : undefined}
      >
        {selectedLabel ? (
          <span className={styles.selectValue}>
            <span className={styles.dot} style={{ background: selectedColor || 'var(--ui-border-color, #c3c6d4)' }} />
            <span className={styles.selectText}>{selectedLabel}</span>
          </span>
        ) : (
          <span className={styles.selectPlaceholder}>{loading ? 'טוען…' : 'בחר'}</span>
        )}
        <span className={styles.caret} aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={styles.selectMenu} role="listbox">
          {value != null && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              className={styles.selectItem}
              onClick={() => { onChange(null); setOpen(false); }}
            >
              <span className={`${styles.dot} ${styles.dotEmpty}`} />
              <span className={styles.selectItemText}>ללא סטאטוס</span>
            </button>
          )}
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={opt.id === value}
              className={`${styles.selectItem} ${opt.id === value ? styles.selectItemActive : ''}`}
              onClick={() => { onChange(opt.id); setOpen(false); }}
            >
              <span className={styles.dot} style={{ background: opt.color || 'var(--ui-border-color, #c3c6d4)' }} />
              <span className={styles.selectItemText}>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Quick-create modal opened by the global FAB (and by per-point "+" actions):
 * one big underlined text field + two optional side-by-side fields, with a
 * החלטה/משימה segmented toggle when NOT point-scoped (mockup: fabShowToggle).
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
 *   onCreate(kind, { text, person: people[]|null, status: labelId|null, deadline: Date|null })
 *   allowTask / allowDecision — disable that side of the toggle (default true)
 */
export function QuickCreateModal({
  open,
  initialMode = 'task',
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
  const [statusId, setStatusId] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const inputRef = useRef(null);

  // useStatusOptions self-guards when the decisions board/column is unmapped
  // (no boardId+colId → no query, empty options), so this is degradation-safe.
  const {
    options: statusOptions,
    labelById: statusLabelById,
    colorById: statusColorById,
    loading: statusLoading,
  } = useStatusOptions('decisions', 'decisionStatusID');

  // Reset per open; clamp the initial mode to an allowed side.
  useEffect(() => {
    if (!open) return;
    let next = initialMode === 'decision' ? 'decision' : 'task';
    if (next === 'decision' && !allowDecision && allowTask) next = 'task';
    if (next === 'task' && !allowTask && allowDecision) next = 'decision';
    setMode(next);
    setText('');
    setPerson([]);
    setStatusId(null);
    setDeadline(null);
  }, [open, initialMode, allowDecision, allowTask]);

  // Focus the text input on open (matches NewTaskModal).
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return undefined;
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  const isDecision = mode === 'decision';
  const showToggle = !scopedPoint; // mockup: fabShowToggle = !pointId
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
    // Only the field relevant to the created kind is emitted; the sibling
    // field (kept across toggle flips for convenience) goes out as null.
    onCreate(isDecision ? 'decision' : 'task', {
      text: trimmed,
      person: person.length ? person : null,
      status: isDecision ? statusId : null,
      deadline: isDecision ? null : deadline,
    });
    onClose();
  };

  // Enter ANYWHERE in the form submits — same as clicking "צור החלטה"/"צור משימה"
  // — while RESPECTING the button's disabled state (canSubmit). Skipped for
  // textareas, buttons (native activation; incl. the StatusSelect trigger), and
  // any control inside the open status listbox, so choosing a status with Enter
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

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className={styles.modal}
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

          <div className={styles.row}>
            <div className={styles.field}>
              <Text type="text2" className={styles.label}>
                {isDecision ? 'הגורם המחליט' : 'אחראי'}{' '}
                <span className={styles.optional}>(אופציונלי)</span>
              </Text>
              <PersonPicker
                selected={person}
                onChange={setPerson}
                bordered
                closeOnSelect
                single
              />
            </div>
            <div className={styles.field}>
              <Text type="text2" className={styles.label}>
                {isDecision ? 'סטאטוס' : 'דד ליין'}{' '}
                <span className={styles.optional}>(אופציונלי)</span>
              </Text>
              {isDecision ? (
                <StatusSelect
                  options={statusOptions}
                  colorById={statusColorById}
                  labelById={statusLabelById}
                  value={statusId}
                  onChange={setStatusId}
                  loading={statusLoading}
                />
              ) : (
                <DatePickerPopover
                  variant="field"
                  zIndex={4200}
                  value={deadline}
                  onChange={(d) => setDeadline(d || null)}
                />
              )}
            </div>
          </div>

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

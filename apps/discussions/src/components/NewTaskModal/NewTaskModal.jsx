import { useEffect, useRef, useState } from 'react';
import { Text, Button, Flex } from '@vibe/core';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import styles from './NewTaskModal.module.css';

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Shared "new task box" — reused by the Tasks-tab blue button AND the global FAB.
 * Built with the same custom overlay/modal shell as CreateDiscussionModal (the
 * task name is the header title input; assignee + deadline sit in a two-column
 * row), so it matches the app's floating-modal look. Name, assignee AND deadline
 * are all required. On a valid submit the box closes IMMEDIATELY and fires
 * `onCreate` (= a tab-aware wrapper in DiscussionCard) without awaiting — the
 * parent owns the feedback: on the Tasks tab the optimistic row shows instantly;
 * on other tabs a loader toast → success toast. Creation errors self-log (toast
 * via the error sink).
 */
export function NewTaskModal({ open, onClose, onCreate, defaults = {} }) {
  const [name, setName] = useState('');
  const [assignee, setAssignee] = useState([]);
  const [deadlineStr, setDeadlineStr] = useState('');
  const [errors, setErrors] = useState({ name: '', assignee: '', deadline: '' });
  const titleRef = useRef(null);

  // Focus + select the name on open so it's immediately editable.
  useEffect(() => {
    if (open && titleRef.current) { titleRef.current.focus(); titleRef.current.select(); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setName('');
    setAssignee(Array.isArray(defaults.assignee) ? defaults.assignee : []);
    setDeadlineStr(toDateInputValue(defaults.deadline));
    setErrors({ name: '', assignee: '', deadline: '' });
  }, [open, defaults]);

  useEffect(() => {
    if (!open) return undefined;
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  const reset = () => { setName(''); setAssignee([]); setDeadlineStr(''); setErrors({ name: '', assignee: '', deadline: '' }); };

  const submit = () => {
    const trimmed = name.trim();
    // ONLY the name is required now — deadline + assignee are optional and can be
    // filled inline on the row afterward (matches the inline add-row: no required
    // fields blocking task creation).
    const nextErrors = {
      name: trimmed ? '' : 'יש להזין שם משימה',
      assignee: '',
      deadline: '',
    };
    setErrors(nextErrors);
    if (nextErrors.name) return;
    const deadline = deadlineStr ? new Date(`${deadlineStr}T00:00:00`) : null;
    // Fire-and-forget: the parent (DiscussionCard) decides close timing/feedback.
    onCreate(trimmed, { ...defaults, assignee, deadline });
    reset();
    onClose();
  };

  // Enter ANYWHERE in the form submits — same as clicking "צור משימה". Skipped
  // for textareas (multiline), buttons (native activation), and any control
  // inside an open picker list (role=listbox/menu) so choosing an option doesn't
  // also submit. The PersonPicker / date popovers render their inputs in a
  // portal to document.body, so their Enter never bubbles here at all. submit()
  // itself no-ops on an empty name (the button's only required field).
  const onFormKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
    if (t && typeof t.closest === 'function' && t.closest('[role="listbox"], [role="menu"]')) return;
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
        aria-label="יצירת משימה חדשה"
        // RTL like CreateDiscussionModal (owner request 2026-07-14): titles and
        // content anchor to the RIGHT, matching the new-discussion form.
        dir="rtl"
      >
        <div className={styles.header}>
          <input
            ref={titleRef}
            className={styles.titleInput}
            value={name}
            onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((p) => ({ ...p, name: '' })); }}
            placeholder="שם המשימה"
            aria-label="שם המשימה"
          />
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="סגירה">
            ×
          </button>
        </div>

        <div className={styles.content}>
          {errors.name && <Text type="text2" className={styles.fieldError}>{errors.name}</Text>}
          <Flex direction="column" gap={16} align="stretch" className={styles.form}>
            <div className={styles.row}>
              <div className={styles.field}>
                <Text type="text2" className={styles.label}>אחראי</Text>
                <PersonPicker
                  selected={assignee}
                  onChange={(p) => { setAssignee(p); if (errors.assignee) setErrors((prev) => ({ ...prev, assignee: '' })); }}
                  bordered
                  closeOnSelect
                  single
                  boardKey="tasks"
                />
                {errors.assignee && <Text type="text2" className={styles.fieldError}>{errors.assignee}</Text>}
              </div>
              <div className={styles.field}>
                <Text type="text2" className={styles.label}>דדליין</Text>
                <DatePickerPopover
                  variant="field"
                  zIndex={4200}
                  value={deadlineStr ? new Date(`${deadlineStr}T00:00:00`) : null}
                  onChange={(d) => { setDeadlineStr(d ? toDateInputValue(d) : ''); if (errors.deadline) setErrors((prev) => ({ ...prev, deadline: '' })); }}
                />
                {errors.deadline && <Text type="text2" className={styles.fieldError}>{errors.deadline}</Text>}
              </div>
            </div>
          </Flex>

          <Flex gap={8} justify="end" className={styles.footer}>
            <Button kind={"tertiary"} onClick={onClose}>
              ביטול
            </Button>
            <Button onClick={submit}>
              צור משימה
            </Button>
          </Flex>
        </div>
      </div>
    </div>
  );
}

export default NewTaskModal;

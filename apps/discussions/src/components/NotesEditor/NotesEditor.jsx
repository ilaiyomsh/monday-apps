import React, { useRef, useState } from 'react';
import { Dialog, DialogContentContainer, Button } from '@vibe/core';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import styles from './NotesEditor.module.css';

/*
 * monday long-text–style cell editor (round 40). Replaces the old inline,
 * scrollbar-showing textarea in the notes/"פרטים" cell.
 *
 *  - The CELL shows the current text on ONE line (ellipsis) — no in-cell
 *    scrollbar. RTL + right-aligned (round-33 direction kept).
 *  - HOVER: the full text floats via the native `title` tooltip (only when there
 *    is text) — never clipped by the scrolling board.
 *  - CLICK: opens a larger multi-line editor popover, portaled to <body> by
 *    @vibe's Dialog (zIndex 10000, consistent with rounds 31/32) so it is never
 *    clipped. Enter inserts a newline; Esc cancels (reverts); the value commits
 *    on close (click-outside / "שמור" / blur-to-hide).
 *
 * The caller's EXISTING save handler is reused verbatim via onCommit(value) —
 * this component owns no write path, and only fires onCommit when the text
 * actually changed, so the optimistic update behavior is unchanged.
 */
export function NotesEditor({ value, placeholder = '', onCommit, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [position, setPosition] = useState('bottom-start');
  const triggerRef = useRef(null);
  const draftRef = useRef(value || '');
  // Idempotent finish guard: whichever close path fires first (blur / "שמור" /
  // Esc / the Dialog's own hide) wins; the rest are no-ops, so onCommit fires
  // at most once per edit session.
  const finishedRef = useRef(false);
  const text = value || '';

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'bottom-start',
      popupWidth: 300,
      popupHeight: 190,
      offset: 4,
    });
    if (next?.placement) setPosition(next.placement);
  };

  // Seed the draft from the current value the moment the trigger is pressed, so
  // the textarea opens with up-to-date text and a prior session can't leak in.
  const prime = () => {
    setDraft(value || '');
    draftRef.current = value || '';
    finishedRef.current = false;
    updatePosition();
  };

  const onChange = (e) => {
    draftRef.current = e.target.value;
    setDraft(e.target.value);
  };

  // The single, idempotent finisher. `commitEdit` distinguishes a save
  // (click-outside / "שמור" / blur) from an Esc-cancel (revert = don't write).
  const finish = (commitEdit) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setOpen(false);
    if (!commitEdit) return;
    const nextVal = draftRef.current;
    if ((value || '') !== (nextVal || '')) onCommit?.(nextVal);
  };

  return (
    <Dialog
      // Derive "shown" from `open` (see DatePickerPopover): Vibe ORs its internal
      // state with the prop, so without this `open=false` could never close it.
      isOpen={open}
      useDerivedStateFromProps
      showTrigger={['click']}
      hideTrigger={['clickoutside', 'esc']}
      onDialogDidShow={() => setOpen(true)}
      onDialogDidHide={() => finish(true)}
      position={position}
      zIndex={10000}
      content={() => (
        <DialogContentContainer>
          <div className={styles.notesEditorBody} dir="rtl">
            <textarea
              className={styles.notesTextarea}
              autoFocus
              value={draft}
              placeholder={placeholder}
              onChange={onChange}
              onBlur={() => finish(true)}
              onKeyDown={(e) => {
                // Enter = newline (default, textarea keeps focus). Esc cancels.
                if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
              }}
            />
            <div className={styles.notesEditorActions}>
              <Button kind="primary" size="small" onClick={() => finish(true)}>שמור</Button>
            </div>
          </div>
        </DialogContentContainer>
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.notesCellTrigger}
        title={text || undefined}
        aria-label={ariaLabel}
        onMouseDown={prime}
      >
        {text
          ? <span className={styles.notesCellText}>{text}</span>
          : <span className={styles.notesCellPlaceholder}>{placeholder}</span>}
      </button>
    </Dialog>
  );
}

export default NotesEditor;

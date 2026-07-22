import React, { useRef, useState } from 'react';
import { Dialog, DialogContentContainer } from '@vibe/core';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { BuilderIcon } from './BuilderIcon.jsx';
import styles from './builder.module.css';

/*
 * The toolbar control shell for one builder (Sort / Filter / Group by): renders
 * the pill trigger and the panel. Desktop = an anchored @vibe Dialog popover;
 * mobile = a bottom sheet. It owns the panel-open state and the single "which
 * segment flyout is open" (openId) so only one option list shows at a time.
 *
 * The panel BODY is supplied by `renderBody({ mobile, openId, setOpenId, close })`
 * so each control builds its own segment row from current state — this component
 * stays generic (pill + chrome + open/close + segment coordination).
 */
export function BuilderControl({
  icon: Icon, label, badge = null, applied = false,
  title, onClear, onSave, width = 360, mobile = false, renderBody,
}) {
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [position, setPosition] = useState('bottom-start');
  const triggerRef = useRef(null);

  const close = () => { setOpen(false); setOpenId(null); };

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = computeFloatingPosition({
      anchorRect: rect, preferred: 'bottom-start',
      popupWidth: width, popupHeight: 360, offset: 4,
    });
    if (next?.placement) setPosition(next.placement);
  };

  const pillClass = `${styles.bPill}${applied ? ` ${styles.bPillApplied}` : ''}${open ? ` ${styles.bPillOpen}` : ''}`;

  // ---- mobile: pill opens a bottom sheet ----
  if (mobile) {
    return (
      <>
        {/* round208 — an ACTIVE control is signalled by the stronger background
            alone (bPillApplied); the old badge dot was dropped (owner spec:
            no extra marks or numbers on the mobile icons). */}
        <button type="button" ref={triggerRef} className={pillClass} onClick={() => setOpen(true)} aria-label={label}>
          <Icon className={styles.bPillIcon} />
        </button>
        {open && (
          <>
            <div className={styles.bBackdrop} onClick={close} />
            <div className={styles.bSheet} role="dialog" aria-label={title}>
              <div className={styles.bGrab} />
              <div className={styles.bSHead}>
                <span className={styles.bSTitle}>{title}</span>
                <button type="button" className={styles.bSClose} onClick={close} aria-label="סגירה">
                  <BuilderIcon name="x" size={18} />
                </button>
              </div>
              <div className={styles.bSBody}>{renderBody({ mobile: true, openId, setOpenId, close })}</div>
              {onClear || onSave ? (
                <div className={styles.bSFoot}>
                  {onSave ? <button type="button" className={styles.bGhostBtn} onClick={() => { onSave(); close(); }}>שמור</button> : null}
                  {onClear ? <button type="button" className={styles.bGhostBtn} onClick={() => { onClear(); }}>נקה</button> : null}
                </div>
              ) : null}
            </div>
          </>
        )}
      </>
    );
  }

  // ---- desktop: anchored popover ----
  return (
    <Dialog
      open={open}
      showTrigger={['click']}
      hideTrigger={['clickoutside', 'esc']}
      onDialogDidShow={() => { updatePosition(); setOpen(true); }}
      onDialogDidHide={close}
      position={position}
      zIndex={1000}
      content={() => (
        <DialogContentContainer>
          <div className={styles.bPanel} style={{ width }}>
            <div className={styles.bHead}>
              <span className={styles.bTitle}>{title}</span>
              <span className={styles.bHeadActions}>
                {onSave ? <button type="button" className={styles.bClear} onClick={onSave}>שמור</button> : null}
                {onClear ? <button type="button" className={styles.bClear} onClick={onClear}>נקה</button> : null}
              </span>
            </div>
            {renderBody({ mobile: false, openId, setOpenId, close })}
          </div>
        </DialogContentContainer>
      )}
    >
      <button type="button" ref={triggerRef} className={pillClass} onMouseDown={updatePosition}>
        <Icon className={styles.bPillIcon} />
        <span>{label}</span>
        {/* round183 — the "/ N" count suffix was removed (owner request); an
            active control is signalled by the darker background alone
            (styles.bPillApplied via pillClass), no slash + number. */}
      </button>
    </Dialog>
  );
}

export default BuilderControl;

import React from 'react';
import { BuilderIcon } from './BuilderIcon.jsx';
import styles from './builder.module.css';

/*
 * One inline "segment" of the builder sentence — a fixed-width dropdown cell
 * (column / direction / order / operator / value). It owns its option list:
 *  - desktop: an absolutely-positioned flyout rendered UNDER the segment, inside
 *    the same panel popover (one overlay; no nested @vibe Dialog → no
 *    click-outside conflict, no toolbar-clipping pitfall).
 *  - mobile: a nested bottom-sheet (position:fixed) over the panel sheet.
 *
 * Open state is lifted to the parent (openId / setOpenId) so only one segment is
 * open at a time. `multi` keeps the list open after a pick (value multi-select).
 *
 * options: [{ key, label, icon?, dot?, selected?, disabled? }]
 * chips:   [{ color, text }]  — when present, the trigger shows colored chips
 *                               instead of `text` (used by the value segment).
 */
export function Segment({
  id, openId, setOpenId,
  icon, text, placeholder, chips,
  options = [], onPick, multi = false,
  mobile = false, sheetTitle, disabled = false, note,
}) {
  const open = openId === id && !disabled;
  const toggle = () => { if (!disabled) setOpenId(open ? null : id); };
  const pick = (key) => { onPick && onPick(key); if (!multi) setOpenId(null); };

  const trigger = (
    <button
      type="button"
      className={`${styles.bSeg}${mobile ? ` ${styles.bSegFull}` : ''}${open ? ` ${styles.bSegOpen}` : ''}${disabled ? ` ${styles.bSegDisabled}` : ''}`}
      onClick={toggle}
      aria-haspopup="listbox"
      aria-expanded={open}
    >
      {icon ? <BuilderIcon name={icon} className={styles.bSegIcon} /> : null}
      {chips ? (
        <Chips chips={chips} />
      ) : (
        <span className={`${styles.bSegText}${placeholder ? ` ${styles.bSegPh}` : ''}`}>{text}</span>
      )}
      <BuilderIcon name="chev" className={styles.bSegChev} />
    </button>
  );

  const list = (big) => (
    <>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`${styles.bMItem}${big ? ` ${styles.bMItemBig}` : ''}${o.selected ? ` ${styles.bMItemSel}` : ''}${o.disabled ? ` ${styles.bMItemDisabled}` : ''}`}
          onClick={o.disabled ? undefined : () => pick(o.key)}
        >
          {o.dot
            ? <span className={`${styles.bMDot}${big ? ` ${styles.bMDotBig}` : ''}`} style={{ background: o.dot }} />
            : (o.icon ? <BuilderIcon name={o.icon} className={styles.bMIcon} /> : null)}
          <span className={styles.bMLabel}>{o.label}</span>
          {o.selected ? <BuilderIcon name="check" className={styles.bMCheck} /> : null}
        </button>
      ))}
      {note ? <div className={styles.bNote}>{note}</div> : null}
    </>
  );

  if (mobile) {
    return (
      <>
        {trigger}
        {open && (
          <div className={`${styles.bSheet} ${styles.bSheetNested}`} role="dialog">
            <div className={styles.bGrab} />
            <div className={styles.bSHead}>
              <button type="button" className={styles.bSBack} onClick={() => setOpenId(null)} aria-label="Back">
                <BuilderIcon name="back" size={18} />
              </button>
              <span className={styles.bSTitle}>{sheetTitle}</span>
            </div>
            <div className={styles.bSBody}>{list(true)}</div>
          </div>
        )}
      </>
    );
  }

  return (
    <span className={styles.bSegWrap}>
      {trigger}
      {open && <div className={styles.bFlyout} role="listbox">{list(false)}</div>}
    </span>
  );
}

function Chips({ chips }) {
  if (!chips || chips.length === 0) {
    return <span className={`${styles.bSegText} ${styles.bSegPh}`}>Choose values</span>;
  }
  const shown = chips.slice(0, 2);
  const extra = chips.length - shown.length;
  return (
    <span className={styles.bChips}>
      {shown.map((c, i) => (
        <span key={i} className={styles.bChip}>
          <span className={styles.bChipDot} style={{ background: c.color || 'var(--ui-border-color,#e6e9ef)' }} />
          <span className={styles.bChipText}>{c.text}</span>
        </span>
      ))}
      {extra > 0 ? <span className={styles.bChipMore}>+{extra}</span> : null}
    </span>
  );
}

export default Segment;

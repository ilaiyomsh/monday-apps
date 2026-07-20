import React from 'react';
import {
  EXPORT_FONTS,
  DEFAULT_EXPORT_FONT,
  EXPORT_HEADER_MODES,
} from '../../utils/mondayApi/boards.config.js';
import styles from './ExportPreview.module.css';

// Physical alignment (right/center/left) → CSS. In this RTL preview `right` is the
// natural leading edge; we map explicitly so it matches the docx band alignment.
const ALIGN_TO_CSS = { right: 'right', center: 'center', left: 'left' };
const ALIGN_TO_FLEX = { right: 'flex-start', center: 'center', left: 'flex-end' };

// Sample content so the owner sees layout/typography, not real discussion data.
const META_SAMPLE = {
  dateText: 'יום שני, 1 ביולי 2026',
  participantsText: 'דנה כהן, יוסי לוי, מיכל בר',
  leadText: 'עידו פיוטרקובסקי',
  typesText: 'ישיבת הנהלה',
  previousText: 'סיכום רבעון קודם',
};

/**
 * Live, mock-style approximation of the exported .docx. NOT the real Word
 * rendering — spacing/pagination differ — but it reflects the chosen font, the
 * header/footer bands (logo position, text alignment, name/date/page), and the
 * body section order. CONFIG mode shows the full page; UPLOAD mode shows body
 * only (the uploaded .docx chrome can't be rendered client-side).
 */
export default function ExportPreview({ template, assets }) {
  const fontCss = (EXPORT_FONTS[template?.font] || EXPORT_FONTS[DEFAULT_EXPORT_FONT]).css;
  const isConfig = (template?.headerMode || EXPORT_HEADER_MODES.CONFIG) !== EXPORT_HEADER_MODES.UPLOAD;
  const sections = Array.isArray(template?.sections) ? template.sections : [];

  const renderBand = (band, isFooter) => {
    const cfg = template?.[band] || {};
    const logo = band === 'header' ? assets?.headerLogo : assets?.footerLogo;
    const textAlign = ALIGN_TO_CSS[cfg.textAlign] || 'center';
    const lines = (cfg.text || '').split(/\r?\n/).filter((l) => l.trim());
    const metaBits = [];
    if (cfg.meta?.name) metaBits.push('שם הדיון לדוגמה');
    if (cfg.meta?.date) metaBits.push(META_SAMPLE.dateText);
    if (isFooter && cfg.meta?.page) metaBits.push('עמוד 1 מתוך 1');

    const hasContent = (cfg.hasLogo && logo) || lines.length || metaBits.length;
    if (!hasContent) {
      return (
        <div className={`${styles.band} ${styles.bandEmpty} ${isFooter ? styles.footerBand : styles.headerBand}`}>
          {isFooter ? 'אין כותרת תחתונה' : 'אין כותרת עליונה'}
        </div>
      );
    }

    return (
      <div className={`${styles.band} ${isFooter ? styles.footerBand : styles.headerBand}`}>
        {cfg.hasLogo && logo && (
          <div style={{ display: 'flex', justifyContent: ALIGN_TO_FLEX[cfg.logoPos] || 'center' }}>
            <img src={logo} alt="לוגו" className={styles.logo} />
          </div>
        )}
        {lines.map((line, i) => (
          <div key={i} style={{ textAlign }}>{line}</div>
        ))}
        {metaBits.length > 0 && (
          <div className={styles.bandMeta} style={{ textAlign }}>{metaBits.join('  ·  ')}</div>
        )}
      </div>
    );
  };

  const renderSection = (section) => {
    if (!section || section.enabled === false) return null;
    switch (section.key) {
      case 'meta': {
        const fields = (section.fields || []).filter((f) => f.enabled !== false);
        if (!fields.length) return null;
        return (
          <div key="meta" className={styles.metaBlock}>
            {fields.map((f) => (
              <div key={f.key} className={styles.metaLine}>
                <span className={styles.metaLabel}>{f.label || f.key}:</span>{' '}
                <span>{META_SAMPLE[f.key] || '—'}</span>
              </div>
            ))}
          </div>
        );
      }
      case 'topics':
        return (
          <div key="topics" className={styles.docSection}>
            <div className={styles.h2}>נושאים לדיון</div>
            <div className={styles.h3}>נושא לדוגמה</div>
            <ul className={styles.list}><li>נקודה ראשונה לדיון</li><li>נקודה שנייה לדיון</li></ul>
          </div>
        );
      case 'summary':
        return (
          <div key="summary" className={styles.docSection}>
            <div className={styles.h2}>סיכום</div>
            <p className={styles.para}>טקסט הסיכום של הדיון יופיע כאן, בגופן ובעיצוב שנבחרו.</p>
          </div>
        );
      case 'tasks':
        return (
          <div key="tasks" className={styles.docSection}>
            <div className={styles.h2}>משימות</div>
            <ul className={styles.list}><li>משימה לדוגמה — אחראי: דנה — יעד: 10/07</li><li>משימה נוספת — אחראי: יוסי</li></ul>
          </div>
        );
      case 'decisions':
        return (
          <div key="decisions" className={styles.docSection}>
            <div className={styles.h2}>החלטות</div>
            <ul className={styles.list}><li>החלטה לדוגמה — מחליט: דנה — 10/07</li><li>החלטה נוספת — מחליט: יוסי</li></ul>
          </div>
        );
      case 'freeText':
        return (
          <div key="freeText" className={styles.docSection}>
            {section.title && <div className={styles.h2}>{section.title}</div>}
            {section.body && <p className={styles.para}>{section.body}</p>}
            {!section.title && !section.body && <p className={styles.paraMuted}>פתיחה (ריק)</p>}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.pageLabel}>תצוגה מקדימה</div>
      <div className={styles.page} style={{ fontFamily: fontCss }} dir="rtl">
        {isConfig ? renderBand('header', false) : (
          <div className={`${styles.band} ${styles.bandNote}`}>הכותרות מגיעות מקובץ התבנית שהועלה</div>
        )}
        <div className={styles.body}>
          {sections.map(renderSection)}
        </div>
        {isConfig ? renderBand('footer', true) : null}
      </div>
    </div>
  );
}

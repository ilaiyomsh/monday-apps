import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  EXPORT_FONTS,
  DEFAULT_EXPORT_FONT,
  EXPORT_HEADER_MODES,
} from '../../utils/mondayApi/boards.config.js';
// Static imports on purpose (review finding): docxExport is already statically
// imported by App.jsx, so a dynamic import here cannot split it out anyway
// (INEFFECTIVE_DYNAMIC_IMPORT) — the heavy `docx` lib stays lazy INSIDE
// renderDocx. Only docx-preview is dynamically imported (its own chunk).
import { buildDiscussionModel, renderDocx, injectSectionRtlIntoZip } from '../../utils/docxExport.js';
import { spliceBodyIntoTemplate } from '../../utils/docxTemplateMerge.js';
// round202 — the page-geometry toolbox (pagination, page numbers, image-load
// wait, floating-anchor re-anchoring) moved to a pure-DOM module so it is
// testable and shared with the Chromium validation harness.
import {
  paginateRenderedDocx,
  patchPageNumbers,
  waitForImages,
  extractTemplateAnchors,
  reanchorFloatingDrawings,
  extractTemplateTabParagraphs,
  applyTemplateTabStops,
} from './previewPagination.js';
import logger from '../../utils/logger';
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
const DOC_TITLE_SAMPLE = 'ישיבת הנהלה — יולי 2026';
const TASKS_SAMPLE = [
  { name: 'להכין מצגת סיכום לרבעון', assignee: 'דנה כהן', deadline: '10.07.2026', status: 'בעבודה' },
  { name: 'לתאם פגישת המשך עם הצוות', assignee: 'יוסי לוי', deadline: '15.07.2026', status: 'טרם החל' },
];
const DECISIONS_SAMPLE = [
  { name: 'לאשר את התקציב הרבעוני', decider: 'עידו פיוטרקובסקי' },
  { name: 'להעביר את הפרויקט לשלב הבא', decider: 'מיכל בר' },
];

// round195 — the LIVE preview feeds this sample through the REAL export pipeline
// (buildDiscussionModel → buildExportDoc → docx bytes), so what renders is the
// actual Word file the export produces — faithful by construction, not a sketch.
// Kept in the raw pre-model shape buildDiscussionModel expects.
const LIVE_SAMPLE_INPUTS = {
  discussion: {
    name: DOC_TITLE_SAMPLE,
    // ISO strings, not Date objects (review finding): formatHeDate renders them
    // via its timezone-safe string branch, so the sample can never day-shift.
    discussionDateID: '2026-07-01',
    participantsID: [
      { id: '1', name: 'דנה כהן' },
      { id: '2', name: 'יוסי לוי' },
      { id: '3', name: 'מיכל בר' },
    ],
    discussionLeadID: [{ id: '4', name: 'עידו פיוטרקובסקי' }],
  },
  topics: [
    { name: 'תקציב רבעוני', _subitems: [{ name: 'אישור מסגרת התקציב' }, { name: 'חריגות ותיקונים נדרשים' }] },
    { name: 'גיוס ותפעול', _subitems: [{ name: 'סטטוס משרות פתוחות' }] },
  ],
  summaryHtml:
    '<h3>עיקרי הדיון</h3><p>סיכום הדיון יופיע כאן — כולל <strong>הדגשות</strong>, <em>הטיות</em> ורשימות.</p>' +
    '<ul><li>נקודה מרכזית ראשונה</li><li>נקודה מרכזית שנייה</li></ul>',
  // round200 — the References box sample; same converter as the summary.
  referencesHtml:
    '<p><strong>דנה כהן:</strong> מבקשת לבחון מחדש את מסגרת התקציב.</p>' +
    '<ol><li>סבב הערות עד יום רביעי</li><li>אישור סופי בישיבה הבאה</li></ol>',
  tasks: [
    { id: 't1', name: 'להכין מצגת סיכום לרבעון', assignees: [{ id: '1', name: 'דנה כהן' }], deadline: '2026-07-10', status: 'בעבודה' },
    { id: 't2', name: 'לתאם פגישת המשך עם הצוות', assignees: [{ id: '2', name: 'יוסי לוי' }], deadline: '2026-07-15', status: 'טרם החל' },
    { id: 't3', name: 'לעדכן את מסמך היעדים', assignees: [{ id: '1', name: 'דנה כהן' }], deadline: null, status: 'בוצע' },
  ],
  decisions: [
    { name: 'לאשר את התקציב הרבעוני', decider: [{ id: '4', name: 'עידו פיוטרקובסקי' }] },
    { name: 'להעביר את הפרויקט לשלב הבא', decider: [{ id: '3', name: 'מיכל בר' }] },
  ],
  previousDiscussionName: 'סיכום רבעון קודם',
  typeLabel: 'ישיבת הנהלה',
};

// Decode bare base64 (the stored uploaded-template .docx) to bytes.
function base64ToU8(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
  return u8;
}

// The live pipeline needs Blob.arrayBuffer (missing in jsdom) — same guard the
// export code uses. When unavailable the static sketch below stays on.
function canRunLivePreview() {
  return typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer === 'function';
}

/**
 * Export-template preview (round195 rewrite).
 *
 * LIVE mode (default in a real browser): renders the ACTUAL .docx — the sample
 * model runs through the very same code path the export uses (renderDocx, and in
 * upload mode the same spliceBodyIntoTemplate merge), and the resulting bytes are
 * rendered by `docx-preview` as real Word pages: true page size/margins, the
 * document title, header/footer bands with logos, fonts, RTL, and the same
 * tables. Debounced ~350ms behind template edits; pages are auto-scaled to fit
 * the preview column.
 *
 * STATIC mode (fallback): the previous hand-built sketch — shown instantly while
 * the first live render builds, in test/jsdom environments, and if the live
 * pipeline ever fails (each failure is logged through the funnel).
 */
export default function ExportPreview({ template, assets }) {
  const fontCss = (EXPORT_FONTS[template?.font] || EXPORT_FONTS[DEFAULT_EXPORT_FONT]).css;
  const isConfig = (template?.headerMode || EXPORT_HEADER_MODES.CONFIG) !== EXPORT_HEADER_MODES.UPLOAD;
  const sections = Array.isArray(template?.sections) ? template.sections : [];

  const [live, setLive] = useState(false);
  const [building, setBuilding] = useState(canRunLivePreview());
  // round197 — page navigation state for the paginated live preview.
  const [pageCount, setPageCount] = useState(1);
  const [curPage, setCurPage] = useState(1);
  const boxRef = useRef(null);   // scrollable frame (measures available width)
  const hostRef = useRef(null);  // docx-preview render target (zoom applied here)
  const seqRef = useRef(0);      // render token — only the latest build applies

  // Scale the rendered Word page(s) to the preview column width. docx-preview
  // emits real page-size sections (~794px for A4), wider than the column; CSS
  // `zoom` keeps layout+scroll math correct (unlike transform).
  const fitZoom = () => {
    const box = boxRef.current;
    const host = hostRef.current;
    if (!box || !host) return;
    const page = host.querySelector('section');
    if (!page || !page.offsetWidth) return;
    // -24 = .liveBox's 12px padding per side (clientWidth includes padding).
    const prev = host.style.zoom;
    host.style.zoom = '1';
    const scale = Math.min(1, (box.clientWidth - 24) / page.offsetWidth);
    host.style.zoom = Number.isFinite(scale) && scale > 0 ? String(scale) : prev || '1';
  };

  // Re-fit when the preview column resizes (modal resize / narrow viewport).
  useEffect(() => {
    if (!canRunLivePreview() || typeof ResizeObserver === 'undefined') return undefined;
    const box = boxRef.current;
    if (!box) return undefined;
    const ro = new ResizeObserver(() => fitZoom());
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // First reveal: the build-effect's fitZoom runs while the box is still
  // display:none (clientWidth 0) — re-fit once React actually shows it.
  useEffect(() => {
    if (live) fitZoom();
  }, [live]);

  // round197 — page/scroll controls (owner request): ▲/▼ flip between the real
  // rendered pages, ◀/▶ nudge horizontal scroll, and manual scrolling keeps the
  // "עמוד x / y" indicator in sync via the frame's onScroll.
  const pageSections = () => Array.from(hostRef.current?.querySelectorAll('section.docx') || []);
  const goPage = (delta) => {
    const secs = pageSections();
    if (!secs.length) return;
    const next = Math.min(secs.length, Math.max(1, curPage + delta));
    secs[next - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurPage(next);
  };
  const hScroll = (dir) => {
    boxRef.current?.scrollBy({ left: dir * 160, behavior: 'smooth' });
  };
  const onBoxScroll = () => {
    const box = boxRef.current;
    if (!box) return;
    const boxTop = box.getBoundingClientRect().top;
    let cur = 1;
    pageSections().forEach((s, i) => {
      if (s.getBoundingClientRect().top <= boxTop + 24) cur = i + 1;
    });
    setCurPage(cur);
  };

  // Content signature of the last SUCCESSFUL live build — skips rebuilds when
  // only object identity changed (the parent recreates `template` per patch).
  const lastSigRef = useRef('');

  // Build the real .docx from the sample model and render it. Debounced so
  // typing in the free-text/header fields doesn't rebuild on every keystroke.
  useEffect(() => {
    if (!canRunLivePreview()) return undefined;
    const sig = `${JSON.stringify(template)}|${assets?.headerLogo?.length || 0}|${assets?.footerLogo?.length || 0}|${assets?.templateDocx?.length || 0}`;
    if (sig === lastSigRef.current) {
      setBuilding(false); // identity churn only — the shown render is current
      return undefined;
    }
    let cancelled = false;
    const seq = ++seqRef.current;
    setBuilding(true);
    const timer = setTimeout(async () => {
      try {
        const docxPreview = await import('docx-preview');
        if (cancelled || seq !== seqRef.current) return;

        const model = buildDiscussionModel(LIVE_SAMPLE_INPUTS);
        // Identical to the export path: renderDocx builds + injects section RTL…
        const blob = await renderDocx(model, template, assets);
        if (cancelled || seq !== seqRef.current) return; // stale — skip the zip work
        let bytes = new Uint8Array(await blob.arrayBuffer());
        // …and in UPLOAD mode the body is spliced into the uploaded template so
        // its real header/footer show in the preview, exactly like the export.
        const uploadMode = (template?.headerMode || EXPORT_HEADER_MODES.CONFIG) === EXPORT_HEADER_MODES.UPLOAD;
        // round202 — the true geometry of the template's floating header/footer
        // art (anchored drawings) and its tab-stop paragraph layouts, read
        // straight from its XML; docx-preview collapses anchors to mis-placed
        // 0×0 boxes and evaluates tab stops LTR-only (see previewPagination.js).
        let templateAnchors = null;
        let templateTabParas = null;
        if (uploadMode && assets?.templateDocx) {
          try {
            const tplBytes = base64ToU8(assets.templateDocx);
            templateAnchors = extractTemplateAnchors(tplBytes);
            templateTabParas = extractTemplateTabParagraphs(tplBytes);
            bytes = injectSectionRtlIntoZip(spliceBodyIntoTemplate(tplBytes, bytes));
          } catch (err) {
            logger.warn('ExportPreview', 'שילוב קובץ התבנית בתצוגה המקדימה נכשל — מציג את גוף המסמך בלבד', err);
          }
        }
        if (cancelled || seq !== seqRef.current || !hostRef.current) return;

        // round197 — render into a HIDDEN ATTACHED stage: the height-based
        // pagination measures real offsets, which a detached node can't give
        // (visibility:hidden + fixed offscreen keeps it laid out but invisible);
        // still swapped atomically at the end — no blank flash on rebuilds.
        // round202 — experimental stays FALSE: docx-preview's experimental
        // tab-stop pass is LTR-only (Chromium-harness-verified: an RTL template
        // footer centered by a tab stayed ~145px off-center under it) and fires
        // on an internal 500ms timer. Template header/footer tabs are laid out
        // deterministically by applyTemplateTabStops below instead, from the
        // template's own XML.
        if (typeof document.fonts?.ready?.then === 'function') {
          await document.fonts.ready; // measure with the real webfonts loaded
          if (cancelled || seq !== seqRef.current) return;
        }
        const stage = document.createElement('div');
        stage.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
        stage.dir = 'rtl';
        document.body.appendChild(stage);
        let pageTotal = 1;
        try {
          await docxPreview.renderAsync(new Blob([bytes]), stage, stage, {
            inWrapper: true,
            breakPages: true,
            experimental: false,
            renderHeaders: true,
            renderFooters: true,
            useBase64URL: true,
          });
          // round202 — images load AFTER renderAsync resolves; measuring before
          // they decode under-counted the header/footer flow heights and let
          // body content overlap the footer. Wait for real image geometry.
          await waitForImages(stage);
          if (cancelled || seq !== seqRef.current) return;
          // round202 — put the template's floating header/footer art where the
          // file actually anchors it (page-frame absolute, real extent) and lay
          // out its tab-stop paragraphs RTL-correctly — the "not centered"
          // header/footer fix AND the phantom-overlap fix, both verified with
          // the Chromium geometry harness.
          // Tab layout FIRST (it makes paragraphs position:relative), then the
          // anchors — reanchorFloatingDrawings rebases against the actual
          // containing block, so the order keeps both exact.
          stage.querySelectorAll('section.docx').forEach((sec) => {
            if (templateTabParas) applyTemplateTabStops(sec, templateTabParas);
            if (templateAnchors) reanchorFloatingDrawings(sec, templateAnchors);
          });
          paginateRenderedDocx(stage);   // true Word-like page breaks by height
          patchPageNumbers(stage);       // stamp עמוד k מתוך N per page
          pageTotal = stage.querySelectorAll('section.docx').length || 1;
        } finally {
          stage.remove();
        }
        if (cancelled || seq !== seqRef.current || !hostRef.current) return;
        hostRef.current.replaceChildren(...stage.childNodes);
        lastSigRef.current = sig;
        setPageCount(pageTotal);
        setCurPage(1);
        setLive(true);
        setBuilding(false);
        fitZoom();
      } catch (err) {
        logger.warn('ExportPreview', 'בניית התצוגה החיה של קובץ הייצוא נכשלה — מוצגת סקיצה סטטית', err);
        if (!cancelled && seq === seqRef.current) {
          setLive(false);
          setBuilding(false);
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [template, assets]);

  /* ------------------------------------------------ static sketch (fallback) */

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

  // A bordered table mirroring the docx tables: dark header row (white bold text),
  // hairline #D9D9D9 borders, the NAME column (index 1) right-aligned like the docx
  // ("משימה"/"החלטה"), every other column centered.
  const renderTable = (headers, rows) => (
    <table className={styles.table}>
      <thead>
        <tr>{headers.map((h, i) => <th key={i} className={i === 1 ? styles.thName : ''}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((cells, r) => (
          <tr key={r}>{cells.map((c, i) => <td key={i} className={i === 1 ? styles.tdName : ''}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );

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
      case 'references':
        return (
          <div key="references" className={styles.docSection}>
            <div className={styles.h2}>התייחסויות</div>
            <p className={styles.para}><b>דנה כהן:</b> מבקשת לבחון מחדש את מסגרת התקציב.</p>
            <ol className={styles.list}><li>סבב הערות עד יום רביעי</li><li>אישור סופי בישיבה הבאה</li></ol>
          </div>
        );
      case 'tasks':
        return (
          <div key="tasks" className={styles.docSection}>
            <div className={styles.h2}>משימות</div>
            {renderTable(
              ['מס׳', 'משימה', 'אחראי', 'דד ליין', 'סטטוס'],
              TASKS_SAMPLE.map((t, i) => [String(i + 1), t.name, t.assignee, t.deadline, t.status]),
            )}
          </div>
        );
      case 'decisions':
        return (
          <div key="decisions" className={styles.docSection}>
            <div className={styles.h2}>החלטות</div>
            {renderTable(
              ['מס׳', 'החלטה', 'מחליט'],
              DECISIONS_SAMPLE.map((d, i) => [String(i + 1), d.name, d.decider]),
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.pageLabelRow}>
        <span className={styles.pageLabel}>תצוגה מקדימה</span>
        {live && !building && <span className={styles.liveBadge}>הקובץ בפועל</span>}
        {building && <span className={styles.buildingBadge}>בונה תצוגה…</span>}
        {live && (
          <span className={styles.previewControls}>
            <button type="button" className={styles.ctrlBtn} onClick={() => goPage(-1)} disabled={curPage <= 1} aria-label="עמוד קודם" title="עמוד קודם">
              <ChevronUp size={14} />
            </button>
            <span className={styles.pageIndicator}>{`עמוד ${curPage} / ${pageCount}`}</span>
            <button type="button" className={styles.ctrlBtn} onClick={() => goPage(1)} disabled={curPage >= pageCount} aria-label="עמוד הבא" title="עמוד הבא">
              <ChevronDown size={14} />
            </button>
            <span className={styles.ctrlDivider} />
            <button type="button" className={styles.ctrlBtn} onClick={() => hScroll(1)} aria-label="גלילה ימינה" title="גלילה ימינה">
              <ChevronRight size={14} />
            </button>
            <button type="button" className={styles.ctrlBtn} onClick={() => hScroll(-1)} aria-label="גלילה שמאלה" title="גלילה שמאלה">
              <ChevronLeft size={14} />
            </button>
          </span>
        )}
      </div>

      {/* Live Word rendering — kept mounted so rebuilds swap in place. */}
      <div ref={boxRef} className={styles.liveBox} style={live ? undefined : { display: 'none' }} onScroll={onBoxScroll}>
        <div ref={hostRef} className={styles.liveHost} dir="rtl" />
      </div>

      {/* Static sketch — instant placeholder + jsdom/error fallback. */}
      {!live && (
        <div className={styles.page} style={{ fontFamily: fontCss }} dir="rtl">
          {isConfig ? renderBand('header', false) : (
            <div className={`${styles.band} ${styles.bandNote}`}>הכותרות מגיעות מקובץ התבנית שהועלה</div>
          )}
          <div className={styles.body}>
            {/* The docx always opens with a centered title; mirror it here. */}
            <div className={styles.docTitle}>{`סיכום דיון: ${DOC_TITLE_SAMPLE}`}</div>
            {sections.map(renderSection)}
          </div>
          {isConfig ? renderBand('footer', true) : null}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Button } from '@vibe/core';
import { LayoutTemplate } from 'lucide-react';
import { useTemplates } from '@generated/contexts/TemplatesContext.jsx';
import { useMondayContext } from '@generated/contexts/MondayContext.jsx';
import { createTopicsFromTemplate, countPoints } from '@generated/utils/templates.js';
import { PartyProgress } from '@generated/components/PartyProgress';
import logger from '@generated/utils/logger.js';
import styles from './ApplyTemplateMenu.module.css';

/*
 * "Create topics from a template" for an EXISTING discussion. Renders a button +
 * a dropdown of saved templates; picking one creates its topics (and each
 * topic's points) under the given discussion, then calls onApplied() so the
 * caller can refetch. Hidden entirely when there are no templates.
 */
export function ApplyTemplateMenu({ discussionId, onApplied, existingTopicIds = [] }) {
  const { templates } = useTemplates();
  const { currentUser } = useMondayContext();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  // round237 — the panel PREVIEWS a template before adding: a list on the right,
  // the selected template's topics/points on the left, then an "add" button.
  const [selectedId, setSelectedId] = useState(null);
  // Item 8 — real per-create progress ({done,total}) for the branded bar shown
  // while the template's topics/points are created one by one.
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  // Default the preview to the first template whenever the panel opens.
  useEffect(() => {
    if (open && selectedId == null && templates.length) setSelectedId(templates[0].id);
  }, [open, selectedId, templates]);

  if (!templates.length) return null;

  const selected = templates.find((t) => t.id === selectedId) || templates[0];

  const apply = async (template) => {
    setOpen(false);
    if (applying) return;
    setApplying(true);
    setProgress({ done: 0, total: 1 });
    try {
      const { topics, points } = await createTopicsFromTemplate(discussionId, template, {
        onProgress: setProgress,
        // round115 — stamp the applying user as creator of the created topics/points.
        creatorId: currentUser?.id != null ? String(currentUser.id) : null,
        // round250 — keep existing topics in place; the template appends AFTER
        // them (to the LEFT in the RTL ribbon), first-topic-first.
        existingTopicIds,
      });
      logger.info('ApplyTemplateMenu', `נוצרו ${topics} נושאים ו-${points} נקודות מתבנית "${template.name}"`);
      if (onApplied) await onApplied();
    } catch (err) {
      // API failures from createTopicsFromTemplate are already logged+toasted by
      // safeApi; logger dedup (__loggedId) drops the repeat so this never double-
      // toasts, but it still surfaces any non-API error (e.g. onApplied throwing).
      logger.error('ApplyTemplateMenu', `החלת התבנית "${template.name}" נכשלה`, err);
    } finally {
      setApplying(false);
      setProgress(null);
    }
  };

  return (
    <div className={styles.wrap}>
      <Button
        kind="secondary"
        size="small"
        leftIcon={LayoutTemplate}
        loading={applying}
        disabled={applying}
        onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}
      >
        תבניות
      </Button>
      {open && (
        <div className={styles.panel} dir="rtl" role="dialog" aria-label="תבניות נושאים" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <div className={styles.panelBody}>
            <ul className={styles.list} role="listbox" aria-label="רשימת תבניות">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected?.id === t.id}
                    className={`${styles.item} ${selected?.id === t.id ? styles.itemOn : ''}`}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <span className={styles.itemName}>{t.name}</span>
                    <span className={styles.itemMeta}>{t.topics.length} נושאים · {countPoints(t)} נקודות</span>
                  </button>
                </li>
              ))}
            </ul>
            {/* round237 — live PREVIEW of the selected template before adding. */}
            <div className={styles.preview}>
              <div className={styles.previewHead}>תצוגה מקדימה — {selected?.name}</div>
              {(selected?.topics || []).map((tp, ti) => (
                <div key={ti} className={styles.previewTopic}>
                  <span className={styles.previewTopicName}>• {tp.name}</span>
                  {(tp.points || []).map((p, pi) => (
                    <span key={pi} className={styles.previewPoint}>– {p}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.panelFoot}>
            <Button kind="primary" size="small" disabled={!selected} onClick={() => selected && apply(selected)}>
              הוסף לדיון
            </Button>
          </div>
        </div>
      )}
      {/* Item 8 — branded progress while the template's topics/points are
          created sequentially (real done/total from createTopicsFromTemplate). */}
      {applying && progress && (
        <div className={styles.progressPop}>
          <PartyProgress
            value={progress.done / Math.max(1, progress.total)}
            label={`יוצר נושאים ונקודות... ${progress.done}/${progress.total}`}
          />
        </div>
      )}
    </div>
  );
}

export default ApplyTemplateMenu;

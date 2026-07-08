import { useEffect, useState } from 'react';
import { Button } from '@vibe/core';
import { LayoutTemplate } from 'lucide-react';
import { useTemplates } from '@generated/contexts/TemplatesContext.jsx';
import { createTopicsFromTemplate, countPoints } from '@generated/utils/templates.js';
import logger from '@generated/utils/logger.js';
import styles from './ApplyTemplateMenu.module.css';

/*
 * "Create topics from a template" for an EXISTING discussion. Renders a button +
 * a dropdown of saved templates; picking one creates its topics (and each
 * topic's points) under the given discussion, then calls onApplied() so the
 * caller can refetch. Hidden entirely when there are no templates.
 */
export function ApplyTemplateMenu({ discussionId, onApplied }) {
  const { templates } = useTemplates();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  if (!templates.length) return null;

  const apply = async (template) => {
    setOpen(false);
    if (applying) return;
    setApplying(true);
    try {
      const { topics, points } = await createTopicsFromTemplate(discussionId, template);
      logger.info('ApplyTemplateMenu', `נוצרו ${topics} נושאים ו-${points} נקודות מתבנית "${template.name}"`);
      if (onApplied) await onApplied();
    } catch (err) {
      // API failures from createTopicsFromTemplate are already logged+toasted by
      // safeApi; logger dedup (__loggedId) drops the repeat so this never double-
      // toasts, but it still surfaces any non-API error (e.g. onApplied throwing).
      logger.error('ApplyTemplateMenu', `החלת התבנית "${template.name}" נכשלה`, err);
    } finally {
      setApplying(false);
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
        מתבנית
      </Button>
      {open && (
        <ul className={styles.menu} role="listbox" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {templates.map((t) => (
            <li key={t.id}>
              <button type="button" className={styles.item} onClick={() => apply(t)}>
                <span className={styles.itemName}>{t.name}</span>
                <span className={styles.itemMeta}>{t.topics.length} נושאים · {countPoints(t)} נקודות</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ApplyTemplateMenu;

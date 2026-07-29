/**
 * The ordered block list that becomes the document body.
 *
 * @module components/SettingsPanel/BlockEditor
 *
 * The list is plain text blocks plus EXACTLY ONE table block. The table block can be
 * MOVED — its position is precisely what the owner chooses when they order the
 * report — but it can never be deleted or duplicated, so it renders as a read-only
 * placeholder row with move buttons and no delete.
 *
 * Every mutation goes through `blockOps.js` (pure, tested, returns the SAME array
 * reference for a no-op). Nothing here re-implements the invariant.
 *
 * Plain multiline text only, deliberately: the document's typography comes from the
 * uploaded template and the RTL recipe in `utils/docx/rtl.js`, and a rich-text
 * editor here would produce markup that pipeline has no way to honour.
 */
import React from 'react';
import { Button, Text, TextArea } from '@vibe/core';
import { MAX_BLOCKS } from '../../domain/settingsSchema.js';
import {
  addTextBlock,
  canDeleteBlock,
  deleteBlock,
  moveBlock,
  updateBlockText,
} from './blockOps.js';
import styles from './SettingsPanel.module.css';

/**
 * @param {Object} props
 * @param {Array<Object>} props.blocks
 * @param {(blocks: Array<Object>) => void} props.onChange
 */
export function BlockEditor({ blocks, onChange }) {
  const list = Array.isArray(blocks) ? blocks : [];
  const atCap = list.length >= MAX_BLOCKS;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <Text type="text1" weight="bold" element="span">
          תוכן הדוח
        </Text>
        <Text type="text3" color="secondary" element="span">
          הבלוקים יופיעו במסמך בסדר הזה
        </Text>
      </div>

      <div className={styles.blockList}>
        {list.map((block, index) => {
          const isTable = block?.type === 'table';
          const isFirst = index === 0;
          const isLast = index === list.length - 1;

          return (
            <div
              className={isTable ? `${styles.block} ${styles.tableBlock}` : styles.block}
              key={block?.id ?? index}
              data-testid={isTable ? 'block-table' : `block-text-${block?.id}`}
            >
              <div className={styles.blockBody}>
                {isTable ? (
                  <div className={styles.tablePlaceholder}>
                    <Text type="text2" color="secondary">
                      כאן תופיע הטבלה
                    </Text>
                  </div>
                ) : (
                  <TextArea
                    value={String(block?.text ?? '')}
                    placeholder="טקסט חופשי שיופיע במסמך…"
                    size="small"
                    resize
                    aria-label={`טקסט בלוק ${index + 1}`}
                    onChange={(event) => onChange(updateBlockText(list, block.id, event.target.value))}
                  />
                )}
              </div>

              <div className={styles.blockActions}>
                <Button
                  kind="tertiary"
                  size="xs"
                  disabled={isFirst}
                  aria-label={`העלו את בלוק ${index + 1}`}
                  onClick={() => onChange(moveBlock(list, block.id, -1))}
                >
                  ↑
                </Button>
                <Button
                  kind="tertiary"
                  size="xs"
                  disabled={isLast}
                  aria-label={`הורידו את בלוק ${index + 1}`}
                  onClick={() => onChange(moveBlock(list, block.id, 1))}
                >
                  ↓
                </Button>
                {canDeleteBlock(list, block?.id) ? (
                  <Button
                    kind="tertiary"
                    size="xs"
                    color="negative"
                    aria-label={`מחקו את בלוק ${index + 1}`}
                    onClick={() => onChange(deleteBlock(list, block.id))}
                  >
                    ✕
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.templateRow}>
        <Button
          kind="secondary"
          size="small"
          disabled={atCap}
          onClick={() => onChange(addTextBlock(list))}
          data-testid="add-text-block"
        >
          הוסיפו בלוק טקסט
        </Button>
        {atCap ? (
          <Text type="text3" color="secondary">
            הגעתם למספר הבלוקים המרבי ({MAX_BLOCKS}).
          </Text>
        ) : null}
      </div>
    </div>
  );
}

export default BlockEditor;

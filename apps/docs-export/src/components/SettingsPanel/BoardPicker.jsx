/**
 * The TARGET board id — the board the report reads.
 *
 * @module components/SettingsPanel/BoardPicker
 *
 * It is NOT necessarily the board this view sits on (a view on a dashboard-ish
 * summary board reporting over a data board is the normal case), so the context
 * board is offered as a one-click default rather than assumed.
 *
 * The id is VALIDATED by actually fetching the board's meta, because that is the
 * only honest check available: monday answers `boards(ids: ["999"])` with an empty
 * list rather than an error, so "does this id resolve?" and "can this user see it?"
 * are the same question and only the fetch answers it. The resolved board NAME is
 * shown as the positive confirmation — an owner pasting the wrong-but-valid id sees
 * the wrong name immediately, which no error message could tell them.
 *
 * The failure is DISPLAYED here (error-guard's display path); `useBoardColumns`
 * deliberately logs it at WARN only, since an unresolvable id is the normal state
 * while someone is still typing.
 */
import React from 'react';
import { Button, Loader, Text, TextField } from '@vibe/core';
import styles from './SettingsPanel.module.css';

const FIELD_ID = 'docs-export-board-id';

/**
 * @param {Object} props
 * @param {string} props.value - the draft board id
 * @param {(boardId: string) => void} props.onChange
 * @param {string|number} [props.contextBoardId] - the board the view sits on
 * @param {string} [props.boardName] - resolved name, '' while unknown
 * @param {boolean} [props.isLoading]
 * @param {Error|null} [props.error]
 */
export function BoardPicker({ value, onChange, contextBoardId, boardName, isLoading, error }) {
  const current = String(contextBoardId ?? '').trim();
  const canUseCurrent = current !== '' && current !== String(value ?? '').trim();

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <Text type="text1" weight="bold" element="span">
          לוח היעד
        </Text>
        <Text type="text3" color="secondary" element="span">
          הלוח שממנו נשלפים הדיווחים
        </Text>
      </div>

      <div className={styles.boardRow}>
        <div className={styles.boardField}>
          <TextField
            id={FIELD_ID}
            title="מזהה הלוח"
            /* Vibe v4 quirk: with no inputAriaLabel, TextField uses the PLACEHOLDER
             * as the input's aria-label — which overrides the `title` label and
             * announces "for example 1842425263" as the field's name. */
            inputAriaLabel="מזהה הלוח"
            placeholder="לדוגמה 1842425263"
            /* MANDATORY with a value+onChange pair. Vibe v4's TextField is
             * UNCONTROLLED by default: it seeds internal state from `value` once and
             * ignores every later change — so without this, clicking "use the
             * current board" would update the draft while the field kept showing the
             * old id. */
            controlled
            value={String(value ?? '')}
            size="small"
            onChange={(next) => onChange(String(next ?? '').trim())}
            validation={
              error
                ? {
                    status: 'error',
                    text: 'הלוח לא נמצא או שאין לכם הרשאה אליו. בדקו את המזהה.',
                  }
                : undefined
            }
          />
        </div>

        {canUseCurrent ? (
          <Button kind="tertiary" size="small" onClick={() => onChange(current)}>
            השתמשו בלוח הנוכחי ({current})
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className={styles.templateRow}>
          <Loader size="xs" />
          <Text type="text3" color="secondary">
            בודקים את הלוח…
          </Text>
        </div>
      ) : null}

      {!isLoading && !error && boardName ? (
        <Text type="text3" color="secondary" data-testid="board-name">
          נמצא הלוח: {boardName}
        </Text>
      ) : null}
    </div>
  );
}

export default BoardPicker;

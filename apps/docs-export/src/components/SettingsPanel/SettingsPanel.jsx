/**
 * The owner-facing settings surface: target board, five role mappings, four header
 * overrides, the uploaded template, and the ordered block list.
 *
 * @module components/SettingsPanel/SettingsPanel
 *
 * Shape of the interaction:
 *
 *  - Everything except the template edits a LOCAL DRAFT and is persisted by one
 *    explicit save. The five column ids and the board id are read together by every
 *    query in the app, so saving them field-by-field would leave the instance in
 *    half-mapped states that `isConfigured` reports as unusable — and would fire a
 *    storage write (read + write + read-back) per keystroke.
 *  - The TEMPLATE is the exception: it lives under a separate storage key and is
 *    saved the moment it is picked, because validating and storing megabytes is not
 *    something to hold in React state until someone presses Save.
 *  - `forced` is the SettingsGate's mode for an unconfigured instance: no way out,
 *    because there is nothing behind the panel that can work yet.
 *
 * Validation is `domain/settingsSchema#validateSettings` (Hebrew messages, shown
 * verbatim) plus the panel's own soft type warnings from `roleTypes.js` — the schema
 * cannot check column TYPES, since the blob stores ids only.
 *
 * `settings` and `updateSettings` arrive as PROPS rather than from `useSettings()`.
 * That is deliberate: `SettingsGate` (in contexts/SettingsContext.jsx) mounts this
 * component, so reading the context here would make the two modules import each
 * other. A circular import between a context and a component is exactly the kind of
 * thing that survives dev and breaks under a bundler's chunk split.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AttentionBox,
  Checkbox,
  Flex,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Text,
} from '@vibe/core';
import { useMonday } from '../../contexts/MondayContext.jsx';
import { useBoardColumns } from '../../hooks/useBoardColumns.js';
import { normalizeSettings, validateSettings } from '../../domain/settingsSchema.js';
import { getVersionLabel } from '../../utils/versionLabel.js';
import BoardPicker from './BoardPicker.jsx';
import ColumnRoleMapper from './ColumnRoleMapper.jsx';
import HeaderOverrides from './HeaderOverrides.jsx';
import BlockEditor from './BlockEditor.jsx';
import TemplateUpload from './TemplateUpload.jsx';
import logger from '../../utils/logger.js';
import styles from './SettingsPanel.module.css';

const MODAL_ID = 'docs-export-settings';

/** The keys the panel owns; the template lives under its own storage key. */
const SAVED_KEYS = [
  'boardId',
  'columns',
  'headers',
  'blocks',
  'mergeAction',
  'mergeCommittee',
  'weekStartsOn',
];

const patchFrom = (draft) =>
  Object.fromEntries(SAVED_KEYS.map((key) => [key, draft[key]]));

/**
 * @param {Object} props
 * @param {Object|null} props.settings - the loaded blob (null before the first load)
 * @param {(partial: Object) => Promise<Object>} props.updateSettings
 * @param {boolean} [props.forced] - unconfigured instance: not dismissible
 * @param {() => void} [props.onClose]
 */
export function SettingsPanel({ settings, updateSettings, forced = false, onClose }) {
  const { context } = useMonday();

  // Seeded from the loaded blob and re-seeded whenever a NEW blob arrives (a save
  // elsewhere, or the instanceId landing late). `settings` is a fresh object per
  // load, so identity is the right trigger.
  const [draft, setDraft] = useState(() => normalizeSettings(settings));
  const seededFromRef = useRef(settings);
  useEffect(() => {
    if (seededFromRef.current === settings) return;
    seededFromRef.current = settings;
    setDraft(normalizeSettings(settings));
  }, [settings]);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const board = useBoardColumns(draft.boardId);
  const validation = useMemo(() => validateSettings(draft), [draft]);

  const setField = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));
  const setColumn = (role, columnId) =>
    setDraft((prev) => ({ ...prev, columns: { ...prev.columns, [role]: columnId } }));
  const setHeader = (role, text) =>
    setDraft((prev) => ({ ...prev, headers: { ...prev.headers, [role]: text } }));

  const handleSave = async () => {
    setSaveError('');
    setIsSaving(true);
    try {
      await updateSettings(patchFrom(draft));
      if (!forced && typeof onClose === 'function') onClose();
    } catch (err) {
      // settingsStore logged this at ERROR (so a toast is already up) and
      // SettingsContext rolled the optimistic value back. All that is left is to
      // keep the panel open with its draft intact and say so in place.
      setSaveError('השמירה נכשלה ולא נשמר דבר. בדקו את החיבור ונסו שוב.');
      logger.warn('SettingsPanel', 'שמירת ההגדרות נכשלה — הטיוטה נשמרת על המסך', err);
    } finally {
      setIsSaving(false);
    }
  };

  const errors = validation.ok ? [] : validation.errors;

  return (
    <Modal
      id={MODAL_ID}
      show
      size="large"
      alertModal={forced}
      onClose={forced ? undefined : onClose}
      data-testid="settings-panel"
    >
      <ModalHeader
        title="הגדרות הפקת דוח"
        description={
          forced
            ? 'כדי להתחיל, בחרו לוח יעד ומפו את חמש העמודות.'
            : 'לוח היעד, מיפוי העמודות, הכותרות, התבנית ותוכן הדוח.'
        }
      />

      <ModalContent>
        <div className={styles.sections}>
          <BoardPicker
            value={draft.boardId}
            onChange={(boardId) => setField('boardId', boardId)}
            contextBoardId={context?.boardId}
            boardName={board.name}
            isLoading={board.isLoading}
            error={board.error}
          />

          <ColumnRoleMapper
            columnsByRole={draft.columns}
            boardColumns={board.columns}
            onChange={setColumn}
            isLoading={board.isLoading}
            hasBoard={Boolean(draft.boardId)}
          />

          <HeaderOverrides draft={draft} boardColumns={board.columns} onChange={setHeader} />

          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <Text type="text1" weight="bold" element="span">
                מיזוג תאים
              </Text>
              <Text type="text3" color="secondary" element="span">
                איחוד שורות עוקבות בעלות אותו ערך
              </Text>
            </div>
            <Checkbox
              label="מזגו את עמודת הפעולה"
              checked={draft.mergeAction}
              onChange={(event) => setField('mergeAction', event.target.checked)}
            />
            <Checkbox
              label="מזגו את עמודת הועדה (בתוך קבוצת פעולה בלבד)"
              checked={draft.mergeCommittee}
              onChange={(event) => setField('mergeCommittee', event.target.checked)}
            />
          </div>

          <TemplateUpload />

          <BlockEditor blocks={draft.blocks} onChange={(blocks) => setField('blocks', blocks)} />

          {errors.length > 0 ? (
            <div className={styles.errors} data-testid="settings-errors">
              <AttentionBox type="warning" title="חסרים פרטים כדי לשמור" icon={false}>
                <Flex direction="column" gap={4} align="start">
                  {errors.map((message) => (
                    <Text type="text3" key={message}>
                      {message}
                    </Text>
                  ))}
                </Flex>
              </AttentionBox>
            </div>
          ) : null}

          {saveError ? (
            <AttentionBox type="negative" text={saveError} icon={false} data-testid="save-error" />
          ) : null}
        </div>
      </ModalContent>

      <ModalFooter
        primaryButton={{
          text: 'שמירה',
          onClick: handleSave,
          disabled: !validation.ok || isSaving,
          loading: isSaving,
          'data-testid': 'save-settings',
        }}
        secondaryButton={
          forced ? undefined : { text: 'ביטול', onClick: onClose, disabled: isSaving }
        }
        renderSideAction={
          <Text type="text3" color="secondary" data-testid="version-label">
            {getVersionLabel()}
          </Text>
        }
      />
    </Modal>
  );
}

export default SettingsPanel;

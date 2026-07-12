import React, { useCallback, useEffect, useState } from 'react';
import { Button, Heading, Text, Flex, Loader, Dropdown, RadioButton } from '@vibe/core';
import { useSettings } from '../../contexts/SettingsContext.jsx';
import { useMondayContext } from '../../contexts/MondayContext.jsx';
import { provisionAllBoards } from '../../utils/mondayApi/provisionBoards.js';
import { api } from '../../utils/mondayApi/monday-client.js';
import logger from '../../utils/logger.js';
import styles from './SetupWizard.module.css';

/*
 * First-run setup wizard. Shown by SettingsGate when settings are empty
 * (isConfigured === false). Offers two paths:
 *   - "צור לוחות אוטומטית" → provisionAllBoards() builds the 3 boards + columns
 *     and persists the resulting mapping via updateSettings(). When that lands,
 *     isConfigured flips true and the gate unmounts the wizard automatically.
 *   - "מיפוי ידני" → onManual(), which hands off to the existing SettingsModal.
 *
 * Errors are logged through the standard funnel (→ toast) AND shown inline so
 * the owner can retry or fall back to manual mapping.
 */
export function SetupWizard({ onManual }) {
  const { updateSettings } = useSettings();
  const { context } = useMondayContext();
  const [phase, setPhase] = useState('idle'); // idle | running | error
  const [progress, setProgress] = useState({ step: 0, total: 0, label: '' });
  const [errorMsg, setErrorMsg] = useState('');

  // Tasks board choice: create a brand-new "משימות" board, or connect an existing
  // board from the account. In 'connect' mode we lazy-load the account's boards
  // once to populate the picker.
  const [tasksMode, setTasksMode] = useState('create'); // create | connect
  const [tasksBoardId, setTasksBoardId] = useState('');
  const [boardOptions, setBoardOptions] = useState([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardsLoaded, setBoardsLoaded] = useState(false);

  // Lazy-load the account's active boards the first time the owner chooses to
  // connect an existing tasks board. Loaded once; the current board is dropped
  // from the list. Errors are logged (never crash the wizard).
  useEffect(() => {
    if (tasksMode !== 'connect' || boardsLoaded) return undefined;
    let cancelled = false;
    setBoardsLoading(true);
    (async () => {
      try {
        const data = await api(
          `query { boards(limit: 200, state: active) { id name } }`,
          {},
          'SetupWizard.loadBoards'
        );
        const currentId = context?.boardId != null ? String(context.boardId) : null;
        const opts = (data?.boards || [])
          .filter((b) => b && b.id != null && String(b.id) !== currentId)
          .map((b) => ({ value: String(b.id), label: b.name }));
        if (!cancelled) setBoardOptions(opts);
      } catch (err) {
        if (!err?.__loggedId) logger.error('SetupWizard', 'טעינת רשימת הלוחות נכשלה', err);
      } finally {
        if (!cancelled) {
          setBoardsLoaded(true);
          setBoardsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tasksMode, boardsLoaded, context]);

  const handleCreate = useCallback(async () => {
    setPhase('running');
    setErrorMsg('');
    setProgress({ step: 0, total: 0, label: 'מתחיל…' });
    try {
      const config = await provisionAllBoards({
        discussionsBoardId: context?.boardId,
        workspaceId: context?.workspaceId,
        tasks: { mode: tasksMode, boardId: tasksBoardId },
        onProgress: (step, total, label) => setProgress({ step, total, label }),
      });
      await updateSettings(config);
      // isConfigured now true → SettingsGate re-renders children, unmounting us.
    } catch (err) {
      if (!err?.__loggedId) logger.error('SetupWizard', 'הקמת הלוחות נכשלה', err);
      setErrorMsg(err?.message || 'אירעה שגיאה בהקמת הלוחות');
      setPhase('error');
    }
  }, [context, updateSettings, tasksMode, tasksBoardId]);

  const pct =
    progress.total > 0 ? Math.round((progress.step / progress.total) * 100) : 0;

  return (
    <div dir="rtl" className={styles.root}>
      <Flex direction="column" align="center" gap={16} className={styles.card}>
        <Heading type="h2">הגדרת האפליקציה</Heading>

        {phase === 'running' ? (
          <Flex direction="column" align="center" gap={12} className={styles.section}>
            <Loader size={32} />
            <Text type="text1">מקים לוחות ועמודות… ({progress.step}/{progress.total})</Text>
            <div className={styles.barTrack}>
              <div className={styles.barFill} style={{ width: `${pct}%` }} />
            </div>
            <Text type="text2" color="secondary">{progress.label}</Text>
          </Flex>
        ) : (
          <Flex direction="column" align="center" gap={16} className={styles.section}>
            <Text type="text1" align="center">
              נראה שזו ההפעלה הראשונה. לחיצה על "צור לוחות אוטומטית" תוסיף את עמודות
              הדיונים <b>ללוח הנוכחי</b> (לוח הדיונים), ותיצור את לוחות הנושאים
              וההחלטות עם כל העמודות והקישורים. עבור <b>המשימות</b> אפשר ליצור לוח
              חדש או לחבר לוח קיים שתבחרו. לחלופין אפשר למפות לוחות קיימים ידנית.
            </Text>

            {phase === 'error' && (
              <Text type="text2" className={styles.error}>
                {errorMsg} — אפשר לנסות שוב או למפות ידנית.
              </Text>
            )}

            <div className={styles.tasksChoice}>
              <Text type="text2" weight="bold" align="center">לוח המשימות:</Text>
              <Flex gap={16} align="center" justify="center" className={styles.choiceRow}>
                <RadioButton
                  name="tasksMode"
                  text="צור לוח משימות חדש"
                  value="create"
                  checked={tasksMode === 'create'}
                  onSelect={() => setTasksMode('create')}
                />
                <RadioButton
                  name="tasksMode"
                  text="חבר לוח משימות קיים"
                  value="connect"
                  checked={tasksMode === 'connect'}
                  onSelect={() => setTasksMode('connect')}
                />
              </Flex>
              {tasksMode === 'connect' && (
                <div className={styles.boardPicker}>
                  <Dropdown
                    dir="rtl"
                    size="small"
                    placeholder="בחר לוח משימות"
                    options={boardOptions}
                    loading={boardsLoading}
                    value={boardOptions.find((o) => o.value === tasksBoardId) || null}
                    onChange={(opt) => setTasksBoardId(opt ? String(opt.value) : '')}
                  />
                </div>
              )}
            </div>

            <Flex gap={12} align="center" justify="center" className={styles.actions}>
              <Button
                kind="primary"
                size="medium"
                onClick={handleCreate}
                disabled={tasksMode === 'connect' && !tasksBoardId}
              >
                {phase === 'error' ? 'נסה שוב' : 'צור לוחות אוטומטית'}
              </Button>
              <Button kind="secondary" size="medium" onClick={onManual}>
                מיפוי ידני
              </Button>
            </Flex>
          </Flex>
        )}
      </Flex>
    </div>
  );
}

export default SetupWizard;

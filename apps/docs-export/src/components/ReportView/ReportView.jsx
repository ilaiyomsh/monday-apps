/**
 * ReportView — the everyday surface. Pick a window, pick committees, get a .docx.
 *
 * @module components/ReportView/ReportView
 *
 * This is what almost every user of the app ever sees, and its shape follows the
 * app's one architectural rule: **a range selection costs ONE API call, and
 * everything after it is free.** `useRangeItems` owns that call; the committee
 * filter, the preview count, the sorting/merging and the document are all pure
 * client-side work over the rows already in memory. So the user can tick and untick
 * committees, read the preview, and regenerate the report as many times as they like
 * without spending another byte of complexity budget.
 *
 * Three things are load-bearing enough to spell out:
 *
 * 1. **The unfiltered rows go into `buildReportModel`, not the filtered ones.** The
 *    committee narrowing lives inside the model builder (it has to: the same
 *    `selectedCommittees` also decides which committee cells get merged). Filtering
 *    here as well would be a second, drifting implementation of the same rule.
 * 2. **A selection is pruned when the window changes.** Flipping יומי→שבועי can
 *    remove a committee from the option list entirely; a stale pick left in state
 *    would silently narrow the report to a committee the user can no longer see, and
 *    `filterByCommittees` would answer zero rows for a selection that still LOOKS
 *    non-empty on screen.
 * 3. **An empty filtered set never produces a document.** A .docx with headers and
 *    no rows is worse than an error: it looks like a finished report and gets sent
 *    on. The user gets a toast instead, and no file.
 *
 * Errors take the app's single display path — `logger.error` → `useUiErrorSink` →
 * exactly one toast (see hooks/useUiErrorSink.js). This component never calls a
 * toast's error API directly, which is what keeps one failure at one toast.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flex, Heading, Loader, Text } from '@vibe/core';
import { Settings } from '@vibe/icons';
import { useMonday } from '../../contexts/MondayContext';
import { useRangeItems } from '../../hooks/useRangeItems';
import { filterByCommittees } from '../../domain/committees';
import { buildReportModel } from '../../domain/reportModel';
import { buildReportDocx } from '../../utils/docx/reportDoc.js';
import { downloadReport } from '../../utils/docx/download.js';
import { loadTemplate } from '../../utils/assetsStore.js';
import logger from '../../utils/logger';
import { useReportBoardMeta } from './useReportBoardMeta';
import RangeToggle from './RangeToggle';
import CommitteeMultiPicker from './CommitteeMultiPicker';
import GenerateButton from './GenerateButton';
import styles from './ReportView.module.css';

/** How each window is named in the DOWNLOADED FILE (the title comes from the model). */
const KIND_FILE_LABELS = { daily: 'יומי', weekly: 'שבועי' };

/**
 * Characters Windows/macOS refuse in a filename. A board named "דיווחים 07/2026"
 * would otherwise put a path separator mid-name and the save would fail (or, worse,
 * land somewhere unexpected).
 */
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]+/g;

/** One piece of a filename, with anything an OS would reject collapsed to a space. */
function safeFilePart(value) {
  return String(value ?? '')
    .replace(UNSAFE_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `<board name> - <יומי|שבועי> <window>.docx`, degrading gracefully when the board
 * name has not arrived yet (a report is still worth more than a blocked download).
 *
 * @param {string} boardName
 * @param {'daily'|'weekly'} kind
 * @param {string} rangeLabel
 * @returns {string}
 */
function reportFilename(boardName, kind, rangeLabel) {
  const window = `${KIND_FILE_LABELS[kind] || ''} ${safeFilePart(rangeLabel)}`.trim();
  const stem = [safeFilePart(boardName), window].filter(Boolean).join(' - ');
  return `${stem || 'report'}.docx`;
}

/**
 * The report surface.
 *
 * Prop-driven rather than context-reading for `settings`/`toast`/`isOwner`: the shell
 * (App.jsx) already holds all three, and explicit inputs are what make the wiring
 * assertable — a context-reading component can only be tested by rebuilding the
 * whole provider stack around it.
 *
 * @param {Object} props
 * @param {Object} props.settings the normalized settings blob
 * @param {Object} props.toast the queue from hooks/useToast (showLoading/showSuccess/
 *   showInfo/removeToast). Errors deliberately do NOT go through it — see the header.
 * @param {boolean} [props.isOwner] gates the settings gear
 * @param {function(): void} [props.onOpenSettings]
 */
export function ReportView({ settings, toast, isOwner = false, onOpenSettings }) {
  const { context } = useMonday();
  const userId = context?.user?.id;

  const boardMeta = useReportBoardMeta(settings?.boardId);
  const [kind, setKind] = useState('daily');

  const { items, committees, isLoading, error, range, reload } = useRangeItems({
    settings,
    columns: boardMeta.columns,
    userId,
    kind,
  });

  const [selected, setSelected] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  // Guards the async generate against a double-fire (a second click landing while the
  // first await is still in flight). `isGenerating` state cannot do this job: a state
  // update is not readable synchronously inside the same tick as the click.
  const generatingRef = useRef(false);

  const committeeColumnId = settings?.columns?.committee || '';

  // Reason 2 in the header: never carry a pick that the new window does not offer.
  useEffect(() => {
    setSelected((previous) => {
      const next = previous.filter((name) => committees.includes(name));
      // Identity-stable when nothing was dropped — returning a fresh array on every
      // `committees` identity change would re-render on a loop.
      return next.length === previous.length ? previous : next;
    });
  }, [committees]);

  // The preview: what the user is about to download, counted before they do.
  const filteredCount = useMemo(
    () => filterByCommittees(items, committeeColumnId, selected).length,
    [items, committeeColumnId, selected]
  );

  const loadError = error || boardMeta.error;
  const isBusy = isLoading || boardMeta.isLoading;
  const hasRows = items.length > 0;

  const handleRetry = useCallback(() => {
    // Retry only what actually failed: board meta is a per-board read that a range
    // failure has no reason to repeat.
    if (boardMeta.error) boardMeta.reload();
    if (error) reload();
  }, [boardMeta.error, boardMeta.reload, error, reload]);

  const handleGenerate = useCallback(async () => {
    if (generatingRef.current || selected.length === 0) return;

    // Reason 3 in the header: no rows, no document. Recomputed here rather than read
    // from `filteredCount` so a stale render can never be what authorises a file.
    const rows = filterByCommittees(items, committeeColumnId, selected);
    if (rows.length === 0) {
      toast?.showInfo?.('לא נמצאו אייטמים');
      return;
    }

    generatingRef.current = true;
    setIsGenerating(true);
    const loadingToastId = toast?.showLoading?.('מפיק את הדוח…');

    try {
      const model = buildReportModel({
        // Unfiltered on purpose — see reason 1 in the header.
        items,
        settings,
        columns: boardMeta.columns,
        range,
        selectedCommittees: selected,
      });
      const bodyBytes = await buildReportDocx(model);
      // The template is fetched at generate time, not on boot: it is hundreds of KB
      // that most sessions never need, and reading it late means an owner who uploads
      // one mid-session gets it on their very next report.
      const templateBase64 = await loadTemplate(context);
      await downloadReport({
        bodyBytes,
        templateBase64: templateBase64 ?? null,
        filename: reportFilename(boardMeta.name, kind, range.label),
      });
      toast?.showSuccess?.('הדוח הופק והורד');
    } catch (err) {
      // The single display path: one logged error becomes exactly one toast via
      // useUiErrorSink. Deliberately not rethrown — this is a user action, not a
      // render, so no boundary above could do anything better with it.
      logger.error('ReportView', 'הפקת הדוח נכשלה', err, {
        boardId: settings?.boardId,
        kind,
        from: range?.from,
        to: range?.to,
        committees: selected.length,
        rows: rows.length,
      });
    } finally {
      // Both of these run on the failure path too: a "מפיק את הדוח…" toast left on
      // screen forever, or a permanently disabled button, would each turn one failed
      // download into a stuck app.
      if (loadingToastId) toast?.removeToast?.(loadingToastId);
      generatingRef.current = false;
      setIsGenerating(false);
    }
  }, [
    boardMeta.columns,
    boardMeta.name,
    committeeColumnId,
    context,
    items,
    kind,
    range,
    selected,
    settings,
    toast,
  ]);

  const canGenerate = selected.length > 0 && !isGenerating && !isBusy && !loadError;

  return (
    <Flex direction="column" gap={16} align="start" className={styles.root}>
      <div className={styles.header}>
        <Heading type="h3">הפקת דוח</Heading>
        {isOwner ? (
          <button
            type="button"
            // Exactly "הגדרות" — a native button with an explicit label rather than
            // Vibe's IconButton, which wraps its icon in a Tooltip and would fold the
            // tooltip text into the accessible name.
            aria-label="הגדרות"
            className={styles.gear}
            onClick={onOpenSettings}
          >
            <Settings size="20" aria-hidden />
          </button>
        ) : null}
      </div>

      <RangeToggle value={kind} onChange={setKind} rangeLabel={range.label} disabled={isBusy} />

      {loadError ? (
        <div className={styles.errorBlock} role="alert">
          <Text type="text2">לא הצלחנו לטעון את האייטמים לטווח הזה</Text>
          <button type="button" className={styles.retry} onClick={handleRetry}>
            נסה שוב
          </button>
        </div>
      ) : isBusy ? (
        <Flex align="center" gap={8}>
          <Loader size={20} />
          <Text type="text2" color="secondary">
            טוען אייטמים…
          </Text>
        </Flex>
      ) : hasRows ? (
        <>
          <CommitteeMultiPicker
            committees={committees}
            selected={selected}
            onChange={setSelected}
          />
          {selected.length > 0 ? (
            <Text type="text2" color="secondary">
              {`${filteredCount} אייטמים ב-${selected.length} ועדות`}
            </Text>
          ) : (
            <Text type="text2" color="secondary">
              יש לבחור לפחות ועדה אחת כדי להפיק דוח
            </Text>
          )}
        </>
      ) : (
        // Said plainly instead of offering an empty dropdown: the user's next move is
        // to change the window or their board rows, not to hunt for options.
        <Text type="text2" color="secondary">
          לא נמצאו אייטמים בטווח הזה
        </Text>
      )}

      {/* Always mounted, even with nothing to report — a control that disappears reads
          as a broken app, a disabled one reads as "not yet". */}
      <GenerateButton
        onClick={handleGenerate}
        disabled={!canGenerate}
        isGenerating={isGenerating}
      />
    </Flex>
  );
}

export default ReportView;

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsDialogShell, type SettingsTabDef, type SettingsTabRenderCtx } from '@axis/app-core';
import { useSettings, logger } from '../../core';
import { MONDAY_STATUS_COLORS, mondayApi } from '../../services/mondayApi';
import { PersonalTypeInUseError, isPersonalTypeLabelInUse } from '../../services/vacationService';
import { validateDayOffSettings, REQUIRED_COLUMN_FIELDS, EXPECTED_COLUMN_TYPES, normalizeColumnType } from '../../domain/settingsValidation';
import { kindSelectionDiverged, approvalSelectionDiverged, samePersonalTypeOptions } from './personalTypeDiff';
import { listAllUsers } from '../../services/usersService';
import { Icon, PeoplePicker } from '../ui';
import { CompanyDaysTab } from './CompanyDaysTab';
import { SearchableSelect, type SelectOption } from './SearchableSelect';
import type { DayOffSettings, Team, VacationColumnMap, PersonalTypeOption } from '../../types';
import type { RequestStatus, Employee } from '../../domain/types';
import type { MondayBoardOption } from '../../services/mondayApi';

/** A board column descriptor as returned by mondayApi.getBoard. */
interface BoardColumn {
  id: string;
  title: string;
  type: string;
  settings?: unknown;
  settings_str?: string;
}

interface BoardsResponse {
  boards?: { id: string; name: string; columns: BoardColumn[] }[] | null;
}

/** Column mappings required by validation (W1.3) — marked * in the mapping grid. */
const REQUIRED_COLUMN_KEYS = new Set<keyof VacationColumnMap>(REQUIRED_COLUMN_FIELDS.map((f) => f.key));

/** Mapping fields, in display order, each with its i18n label key under settings.fields. */
const COLUMN_FIELDS: { key: keyof VacationColumnMap; labelKey: string }[] = [
  { key: 'kindColumnId', labelKey: 'kind' },
  { key: 'personColumnId', labelKey: 'person' },
  { key: 'startDateColumnId', labelKey: 'startDate' },
  { key: 'endDateColumnId', labelKey: 'endDate' },
  { key: 'workdaysColumnId', labelKey: 'workdays' },
  { key: 'personalTypeColumnId', labelKey: 'personalType' },
  { key: 'approvalStatusColumnId', labelKey: 'approvalStatus' },
  { key: 'mandatoryColumnId', labelKey: 'mandatory' },
  { key: 'empNoteColumnId', labelKey: 'empNote' },
  { key: 'mgrNoteColumnId', labelKey: 'mgrNote' },
  { key: 'decidedByColumnId', labelKey: 'decidedBy' },
  { key: 'decidedAtColumnId', labelKey: 'decidedAt' },
  { key: 'fileColumnId', labelKey: 'file' },
];

const STATUS_KEYS: RequestStatus[] = ['pending', 'approved', 'rejected'];
type StatusLabelOption = PersonalTypeOption;
interface StatusColorChoice {
  id: string;
  colorValue: string | number;
  color: string;
}

function colorChoiceId(value: string | number): string {
  return typeof value === 'number' ? `n:${value}` : `s:${value}`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseSettings(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return asRecord(parsed);
    } catch (err) {
      logger.warn('SettingsDialog', 'failed to parse settings JSON — using null', {
        err,
        rawPreview: raw.slice(0, 120),
      });
      return null;
    }
  }
  return asRecord(raw);
}

function parsePersonalTypeOptions(rawSettings: unknown): PersonalTypeOption[] {
  const settings = parseSettings(rawSettings);
  if (!settings) return [];
  const labels = asRecord(settings.labels);
  const labelsColors = asRecord(settings.labels_colors);
  const labelsIds = asRecord(settings.labels_ids);
  if (!labels) return [];

  const out: PersonalTypeOption[] = [];
  for (const [indexKey, rawTitle] of Object.entries(labels)) {
    if (typeof rawTitle !== 'string' || rawTitle.trim() === '') continue;
    const index = Number(indexKey);
    if (!Number.isFinite(index)) continue;
    const colorMeta = labelsColors ? asRecord(labelsColors[indexKey]) : null;
    const idFromIdsMap = labelsIds?.[indexKey];
    const idFromColorMeta = colorMeta?.id;
    const color =
      (typeof colorMeta?.color === 'string' && colorMeta.color) ||
      (typeof colorMeta?.border === 'string' && colorMeta.border) ||
      'var(--color-event-vacation)';
    out.push({
      id: String(idFromIdsMap ?? idFromColorMeta ?? indexKey),
      title: rawTitle,
      color,
      index,
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

function normalizeLabel(label: string | undefined | null): string {
  return (label ?? '').trim().toLowerCase();
}

function findOptionIdByLabel(options: StatusLabelOption[], label: string | undefined | null): string | undefined {
  const normalized = normalizeLabel(label);
  if (!normalized) return undefined;
  return options.find((opt) => normalizeLabel(opt.title) === normalized)?.id;
}

/**
 * Resolve the selected option for a kind/approval picker — by stored stable
 * label ID first (W1.2 / D8; survives label renames), falling back to a text
 * lookup for legacy settings saved before label IDs were stored.
 */
function resolveSelectedOption(
  options: StatusLabelOption[],
  labelId: string | null | undefined,
  label: string | undefined | null,
): StatusLabelOption | undefined {
  if (labelId != null && labelId.trim() !== '') {
    const byId = options.find((opt) => opt.id === labelId);
    if (byId) return byId;
  }
  const idByLabel = findOptionIdByLabel(options, label);
  return idByLabel == null ? undefined : options.find((opt) => opt.id === idByLabel);
}

function isStatusColumnType(type?: string): boolean {
  const normalized = (type ?? '').trim().toLowerCase();
  return normalized === 'color' || normalized === 'status';
}

function collectStatusColorChoices(options: PersonalTypeOption[]): StatusColorChoice[] {
  const byId = new Map<string, StatusColorChoice>(
    MONDAY_STATUS_COLORS.map((c) => [
      colorChoiceId(c.enum),
      {
        id: colorChoiceId(c.enum),
        colorValue: c.enum,
        color: c.hex,
      },
    ]),
  );
  // Keep any live board colors that don't map to the official list.
  for (const opt of options) {
    const value = opt.colorValue ?? opt.color;
    const id = colorChoiceId(value);
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        colorValue: value,
        color: opt.color,
      });
    }
  }
  return [...byId.values()];
}

/** Lazily load + cache the columns of the single configured board. */
function useBoardColumns(boardId: string | null) {
  const [columns, setColumns] = useState<Record<string, BoardColumn[]>>({});

  const load = useCallback(async (id: string) => {
    try {
      const data = (await mondayApi.getBoard(id)) as BoardsResponse;
      const cols = data.boards?.[0]?.columns ?? [];
      setColumns((prev) => ({ ...prev, [id]: cols }));
    } catch (err) {
      logger.error('SettingsDialog', 'failed to load board columns', { boardId: id, err });
      setColumns((prev) => ({ ...prev, [id]: [] }));
    }
  }, []);

  useEffect(() => {
    // Async board-columns fetch (setState happens after await, not synchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (boardId) void load(boardId);
  }, [boardId, load]);

  return boardId ? columns[boardId] ?? [] : [];
}

function useAccountBoards(enabled: boolean) {
  const [boards, setBoards] = useState<MondayBoardOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void mondayApi
      .listBoardsByType(['board'])
      .then((items) => {
        if (!cancelled) setBoards(items);
      })
      .catch((err) => {
        logger.error('SettingsDialog', 'failed to load account boards', { err });
        if (!cancelled) setBoards([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { boards, loading };
}

/**
 * Day-off settings UI — built on app-core's SettingsDialogShell (#17). One board
 * holds every entry; the kind status column splits general vs personal. The shell
 * owns the frame/tabs/draft/save; this file declares the tabs + fields.
 * Tabs: Board (id), Mapping (column dropdowns + kind/type/status value maps),
 * Team & roles.
 */
export function SettingsDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const { boards, loading } = useAccountBoards(isOpen);
  const [personalTypeError, setPersonalTypeError] = useState<string | null>(null);

  const syncAndPersistPersonalTypes = useCallback(
    async (next: DayOffSettings): Promise<DayOffSettings> => {
      const boardId = next.vacationBoardId;
      const statusColumnId = next.columns.personalTypeColumnId;
      if (!boardId || !statusColumnId) return { ...next, personalTypes: [] };

      const liveMeta = await mondayApi.getStatusColumnSnapshotMeta(boardId, statusColumnId);
      const live = liveMeta.labels;
      const revision = liveMeta.revision;
      const edited = (next.personalTypes ?? []).slice().sort((a, b) => a.index - b.index);

      const isSame =
        edited.length === live.length &&
        edited.every((label) => {
          const src = live.find((l) => l.id === label.id);
          return (
            src != null &&
            src.title === label.title &&
            String(src.colorValue ?? src.color) === String(label.colorValue ?? label.color)
          );
        });
      if (!isSame) {
        if (!revision) throw new Error('Missing status column revision');
        const existingLabelIds = new Set(
          live.map((label) => Number(label.id)).filter((id) => Number.isFinite(id)),
        );
        const editedIds = new Set(edited.map((label) => label.id));
        const deactivated = live
          .filter((label) => !editedIds.has(label.id) && existingLabelIds.has(Number(label.id)))
          .map((label) => ({ ...label, isDeactivated: true }));
        for (const label of deactivated) {
          if (await isPersonalTypeLabelInUse(boardId, statusColumnId, label.id)) {
            throw new PersonalTypeInUseError();
          }
        }
        const payload = [...edited.map((label) => ({ ...label, isDeactivated: false })), ...deactivated];
        await mondayApi.updateStatusColumnSettings(boardId, statusColumnId, revision, payload, existingLabelIds);
      }
      const snapshot = isSame ? live : await mondayApi.getStatusColumnSnapshot(boardId, statusColumnId);
      return { ...next, personalTypes: snapshot };
    },
    [],
  );

  const tabs: SettingsTabDef<DayOffSettings>[] = [
    {
      id: 'general',
      label: t('settings.tabs.general'),
      fields: ['languageOverride'],
      render: ({ draft, setField }: SettingsTabRenderCtx<DayOffSettings>) => (
        <label style={{ display: 'block' }}>
          <span style={{ fontWeight: 600 }}>{t('settings.language.label')}</span>
          <select
            value={draft.languageOverride ?? 'he'}
            onChange={(e) => setField('languageOverride', e.target.value as DayOffSettings['languageOverride'])}
          >
            <option value="he">{t('settings.language.he')}</option>
            <option value="en">{t('settings.language.en')}</option>
          </select>
          <small style={{ color: 'var(--color-text-secondary)', display: 'block', marginTop: 4 }}>
            {t('settings.language.help')}
          </small>
        </label>
      ),
    },
    {
      id: 'board',
      label: t('settings.tabs.board'),
      // 'columns' is the aggregate error key for any missing required column
      // mapping (settingsValidation) — listed so the tab error dot lights up.
      fields: ['vacationBoardId', 'columns', 'kindValues', 'statusValues'],
      render: (ctx: SettingsTabRenderCtx<DayOffSettings>) => (
        <BoardAndMappingTab
          ctx={ctx}
          savedSettings={settings}
          boardOptions={boards}
          boardsLoading={loading}
          isOpen={isOpen}
          personalTypeError={personalTypeError}
          setPersonalTypeError={setPersonalTypeError}
        />
      ),
    },
    {
      id: 'team',
      label: t('settings.tabs.team'),
      render: ({ draft, setDraft }: SettingsTabRenderCtx<DayOffSettings>) => <TeamTab draft={draft} setDraft={setDraft} />,
    },
    {
      id: 'company',
      label: t('settings.tabs.company'),
      // Company days are live data (not part of the settings draft) — managed inline.
      render: () => <CompanyDaysTab />,
    },
  ];

  return (
    <SettingsDialogShell<DayOffSettings>
      isOpen={isOpen}
      onClose={onClose}
      title={t('settings.title')}
      settings={settings}
      onSave={async (next) => {
        try {
          setPersonalTypeError(null);
          const withTypes = await syncAndPersistPersonalTypes(next);
          await updateSettings(withTypes);
          return true;
        } catch (err) {
          if (err instanceof PersonalTypeInUseError) {
            setPersonalTypeError(t('settings.personalTypeInUse'));
            return false;
          }
          throw err;
        }
      }}
      tabs={tabs}
      // W1.3: same rules as the app-level validation (core.ts) — board + the
      // five required column mappings + non-empty kind/status label maps. The
      // shell disables Save and dots the tab while any error remains.
      validate={(draft): Record<string, string> => validateDayOffSettings(draft).errors}
      labels={{
        save: t('common.save'),
        cancel: t('common.cancel'),
        export: t('common.export'),
        import: t('common.import'),
        invalid: t('settings.fixErrors'),
      }}
      allowExportImport
    />
  );
}

/** Mapping tab — column dropdowns + kind/type/status value maps for the one board. */
function BoardAndMappingTab({
  ctx,
  savedSettings,
  boardOptions,
  boardsLoading,
  isOpen,
  personalTypeError,
  setPersonalTypeError,
}: {
  ctx: SettingsTabRenderCtx<DayOffSettings>;
  savedSettings: DayOffSettings;
  boardOptions: MondayBoardOption[];
  boardsLoading: boolean;
  isOpen: boolean;
  personalTypeError: string | null;
  setPersonalTypeError: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const { draft, setDraft, setField, errors } = ctx;
  const cols = useBoardColumns(draft.vacationBoardId);
  const disabled = !draft.vacationBoardId;
  const [personalTypesLoading, setPersonalTypesLoading] = useState(false);
  const [personalTypeChecking, setPersonalTypeChecking] = useState(false);
  const [kindOptionsLoading, setKindOptionsLoading] = useState(false);
  const [approvalStatusOptionsLoading, setApprovalStatusOptionsLoading] = useState(false);
  const [openColorPickerFor, setOpenColorPickerFor] = useState<string | null>(null);
  const lastPersonalTypesSyncKey = useRef<string>('');
  const lastKindSyncKey = useRef<string>('');
  const lastApprovalSyncKey = useRef<string>('');
  const personalTypesLoadGen = useRef(0);
  const kindOptionsLoadGen = useRef(0);
  const approvalStatusLoadGen = useRef(0);
  const colorPickerRootRef = useRef<HTMLDivElement | null>(null);

  const setColumn = (key: keyof VacationColumnMap, value: string | undefined) =>
    setField('columns', { ...draft.columns, [key]: value } as DayOffSettings['columns']);

  // Type-filtered options per mapping field (change #75): a date field offers
  // only date columns, workdays only numbers, etc. — the misconfiguration that
  // let a numeric write clobber the end-date column is no longer selectable.
  // Unknown type strings degrade to the full list; a wrong-typed column that is
  // ALREADY selected stays visible (so it can be seen and fixed) and is flagged.
  const optionsForField = (key: keyof VacationColumnMap): SelectOption[] => {
    const allowed = EXPECTED_COLUMN_TYPES[key];
    const typed = cols.filter((c) => allowed.includes(normalizeColumnType(c.type)));
    const pool = typed.length ? typed : cols;
    const selectedId = draft.columns[key];
    const withSelected =
      selectedId && !pool.some((c) => c.id === selectedId)
        ? [...pool, ...cols.filter((c) => c.id === selectedId)]
        : pool;
    return withSelected.map((c) => ({ id: c.id, name: c.title }));
  };

  const columnTypeMismatch = (key: keyof VacationColumnMap): boolean => {
    const id = draft.columns[key];
    if (!id) return false;
    const col = cols.find((c) => c.id === id);
    if (!col) return false;
    return !EXPECTED_COLUMN_TYPES[key].includes(normalizeColumnType(col.type));
  };
  const personalTypeSettingsRaw = useMemo(() => {
    const col = cols.find((c) => c.id === draft.columns.personalTypeColumnId);
    if (!col) return undefined;
    return col.settings ?? col.settings_str;
  }, [cols, draft.columns.personalTypeColumnId]);
  const kindColumn = useMemo(
    () => cols.find((c) => c.id === draft.columns.kindColumnId),
    [cols, draft.columns.kindColumnId],
  );
  const approvalStatusColumn = useMemo(
    () => cols.find((c) => c.id === draft.columns.approvalStatusColumnId),
    [cols, draft.columns.approvalStatusColumnId],
  );
  const personalTypeColumn = useMemo(
    () => cols.find((c) => c.id === draft.columns.personalTypeColumnId),
    [cols, draft.columns.personalTypeColumnId],
  );
  const detectedPersonalTypes = useMemo(
    () => parsePersonalTypeOptions(personalTypeSettingsRaw),
    [personalTypeSettingsRaw],
  );
  const [kindOptions, setKindOptions] = useState<StatusLabelOption[]>([]);
  const [approvalStatusOptions, setApprovalStatusOptions] = useState<StatusLabelOption[]>([]);
  // Last-known LIVE board labels — the baseline for the W1.5 consumer warning
  // (null until the snapshot loads / after a failed load → no warning shown).
  const personalTypes = useMemo(() => {
    const draftList = draft.personalTypes ?? [];
    if (!draftList.length) return detectedPersonalTypes;
    const detectedById = new Map(detectedPersonalTypes.map((opt) => [opt.id, opt]));
    return draftList.map((draftOpt) => ({
      ...(detectedById.get(draftOpt.id) ?? {}),
      ...draftOpt,
    }));
  }, [detectedPersonalTypes, draft.personalTypes]);
  const personalTypeColorChoices = useMemo(() => collectStatusColorChoices(personalTypes), [personalTypes]);
  // W1.5 (relocated by change #78): consumers cache the KIND and APPROVAL
  // label IDs — not the personal-type ones (open set per D1, read live,
  // display-only). Warn when the draft SELECTION diverges from what is saved:
  // a semantic re-pick silently breaks Planner/tracker filtering until they
  // re-map.
  const showKindConsumerWarning = kindSelectionDiverged(savedSettings.kindValues, draft.kindValues);
  const showApprovalConsumerWarning = approvalSelectionDiverged(savedSettings.statusValues, draft.statusValues);

  const setPersonalTypeLabel = (id: string, title: string) => {
    const next = personalTypes.map((opt) => (opt.id === id ? { ...opt, title } : opt));
    setField('personalTypes', next as DayOffSettings['personalTypes']);
  };
  const setPersonalTypeColor = (id: string, choiceId: string) => {
    const choice = personalTypeColorChoices.find((c) => c.id === choiceId);
    if (!choice) return;
    const next = personalTypes.map((opt) =>
      opt.id === id ? { ...opt, color: choice.color, colorValue: choice.colorValue } : opt,
    );
    setField('personalTypes', next as DayOffSettings['personalTypes']);
  };
  const removePersonalType = async (id: string) => {
    setPersonalTypeError(null);
    if (!id.startsWith('new-') && draft.vacationBoardId && draft.columns.personalTypeColumnId) {
      setPersonalTypeChecking(true);
      try {
        const inUse = await isPersonalTypeLabelInUse(
          draft.vacationBoardId,
          draft.columns.personalTypeColumnId,
          id,
        );
        if (inUse) {
          setPersonalTypeError(t('settings.personalTypeInUse'));
          return;
        }
      } catch (err) {
        logger.error('SettingsDialog', 'failed checking personal type usage', { err, id });
        setPersonalTypeError(t('settings.personalTypeCheckFailed'));
        return;
      } finally {
        setPersonalTypeChecking(false);
      }
    }
    const next = personalTypes.filter((opt) => opt.id !== id).map((opt, idx) => ({ ...opt, index: idx }));
    setField('personalTypes', next as DayOffSettings['personalTypes']);
  };
  const addPersonalType = () => {
    setPersonalTypeError(null);
    const next: PersonalTypeOption = {
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? `new-${crypto.randomUUID()}`
          : `new-${Date.now()}`,
      title: t('settings.newStatusLabel'),
      color: personalTypeColorChoices[0]?.color ?? '#00c875',
      colorValue: personalTypeColorChoices[0]?.colorValue ?? 1,
      index: personalTypes.length,
      isDone: false,
      isDeactivated: false,
    };
    setField('personalTypes', [...personalTypes, next] as DayOffSettings['personalTypes']);
  };
  // Selections persist the stable monday label ID alongside the text (W1.2 / D8):
  // reads match by ID first; the text stays for display + legacy-settings fallback.
  const setKindValue = (key: 'general' | 'personal', optionId: string | undefined) => {
    const opt = kindOptions.find((o) => o.id === optionId);
    setField('kindValues', {
      ...draft.kindValues,
      [key]: opt?.title ?? '',
      [key === 'general' ? 'generalLabelId' : 'personalLabelId']: opt?.id ?? null,
    });
  };
  const setStatusValue = (status: RequestStatus, optionId: string | undefined) => {
    const opt = approvalStatusOptions.find((o) => o.id === optionId);
    setDraft((d) => ({
      ...d,
      statusValues: {
        ...d.statusValues,
        [status]: opt?.title ?? '',
        labelIds: { ...d.statusValues.labelIds, [status]: opt?.id ?? null },
      },
    }));
  };

  useEffect(() => {
    if (!openColorPickerFor) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!colorPickerRootRef.current?.contains(target)) {
        setOpenColorPickerFor(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openColorPickerFor]);

  useEffect(() => {
    if (!isOpen) {
      lastPersonalTypesSyncKey.current = '';
      lastKindSyncKey.current = '';
      lastApprovalSyncKey.current = '';
      personalTypesLoadGen.current += 1;
      kindOptionsLoadGen.current += 1;
      approvalStatusLoadGen.current += 1;
      setPersonalTypesLoading(false);
      setKindOptionsLoading(false);
      setApprovalStatusOptionsLoading(false);
      setOpenColorPickerFor(null);
      return;
    }
    const boardId = draft.vacationBoardId;
    const columnId = draft.columns.personalTypeColumnId;
    const syncKey = `${boardId ?? ''}:${columnId ?? ''}`;
    if (lastPersonalTypesSyncKey.current === syncKey) return;
    lastPersonalTypesSyncKey.current = syncKey;

    if (!boardId || !columnId) {
      setField('personalTypes', [] as DayOffSettings['personalTypes']);
      return;
    }

    let cancelled = false;
    const loadGen = ++personalTypesLoadGen.current;
    setPersonalTypesLoading(true);
    void mondayApi
      .getStatusColumnSnapshot(boardId, columnId)
      .then((snapshot) => {
        if (cancelled) return;
        setField('personalTypes', snapshot as DayOffSettings['personalTypes']);
      })
      .catch((err) => {
        logger.error('SettingsDialog', 'failed to sync personal-type labels', { boardId, columnId, err });
        if (cancelled) return;
        setField('personalTypes', [] as DayOffSettings['personalTypes']);
      })
      .finally(() => {
        if (loadGen === personalTypesLoadGen.current) setPersonalTypesLoading(false);
      });

    return () => {
      cancelled = true;
      lastPersonalTypesSyncKey.current = '';
      personalTypesLoadGen.current += 1;
    };
  }, [isOpen, draft.vacationBoardId, draft.columns.personalTypeColumnId, setField]);

  useEffect(() => {
    if (!isOpen) return;
    const boardId = draft.vacationBoardId;
    const columnId = draft.columns.kindColumnId;
    const syncKey = `${boardId ?? ''}:${columnId ?? ''}`;
    if (lastKindSyncKey.current === syncKey) return;
    lastKindSyncKey.current = syncKey;

    if (!boardId || !columnId) {
      setKindOptions([]);
      return;
    }

    let cancelled = false;
    const loadGen = ++kindOptionsLoadGen.current;
    setKindOptionsLoading(true);
    void mondayApi
      .getStatusColumnSnapshot(boardId, columnId)
      .then((snapshot) => {
        if (cancelled) return;
        setKindOptions(snapshot);
      })
      .catch((err) => {
        logger.error('SettingsDialog', 'failed to load kind status labels', { boardId, columnId, err });
        if (!cancelled) setKindOptions([]);
      })
      .finally(() => {
        if (loadGen === kindOptionsLoadGen.current) setKindOptionsLoading(false);
      });

    return () => {
      cancelled = true;
      lastKindSyncKey.current = '';
      kindOptionsLoadGen.current += 1;
    };
  }, [isOpen, draft.vacationBoardId, draft.columns.kindColumnId]);

  useEffect(() => {
    if (!isOpen) return;
    const boardId = draft.vacationBoardId;
    const columnId = draft.columns.approvalStatusColumnId;
    const syncKey = `${boardId ?? ''}:${columnId ?? ''}`;
    if (lastApprovalSyncKey.current === syncKey) return;
    lastApprovalSyncKey.current = syncKey;

    if (!boardId || !columnId) {
      setApprovalStatusOptions([]);
      return;
    }

    let cancelled = false;
    const loadGen = ++approvalStatusLoadGen.current;
    setApprovalStatusOptionsLoading(true);
    void mondayApi
      .getStatusColumnSnapshot(boardId, columnId)
      .then((snapshot) => {
        if (cancelled) return;
        setApprovalStatusOptions(snapshot);
      })
      .catch((err) => {
        logger.error('SettingsDialog', 'failed to load approval-status labels', { boardId, columnId, err });
        if (!cancelled) setApprovalStatusOptions([]);
      })
      .finally(() => {
        if (loadGen === approvalStatusLoadGen.current) setApprovalStatusOptionsLoading(false);
      });

    return () => {
      cancelled = true;
      lastApprovalSyncKey.current = '';
      approvalStatusLoadGen.current += 1;
    };
  }, [isOpen, draft.vacationBoardId, draft.columns.approvalStatusColumnId]);

  useEffect(() => {
    if (!samePersonalTypeOptions(draft.personalTypes ?? [], personalTypes)) {
      setField('personalTypes', personalTypes as DayOffSettings['personalTypes']);
    }
  }, [draft.personalTypes, personalTypes, setField]);

  useEffect(() => {
    if (!samePersonalTypeOptions(draft.approvalStatusTypes ?? [], approvalStatusOptions)) {
      setField('approvalStatusTypes', approvalStatusOptions as DayOffSettings['approvalStatusTypes']);
    }
  }, [draft.approvalStatusTypes, approvalStatusOptions, setField]);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section style={{ display: 'grid', gap: 8 }}>
        <label style={{ display: 'block' }}>
          <span style={{ fontWeight: 600 }}>{t('settings.board.label')}</span>
          <SearchableSelect
            options={boardOptions}
            value={draft.vacationBoardId}
            loading={boardsLoading}
            loadingText={t('settings.board.loadingBoards')}
            placeholder={t('settings.board.searchPlaceholder')}
            searchPlaceholder={t('settings.board.searchInputPlaceholder')}
            noResultsText={t('settings.board.noResults')}
            clearText={t('settings.board.clear')}
            allowClear
            onChange={(id) => setField('vacationBoardId', (id ?? null) as DayOffSettings['vacationBoardId'])}
          />
          <small style={{ color: 'var(--color-text-secondary)', display: 'block', marginTop: 4 }}>
            {t('settings.board.help')}
          </small>
          {errors.vacationBoardId && (
            <span style={{ color: 'var(--color-danger)', fontSize: 13, display: 'block' }}>{t(errors.vacationBoardId)}</span>
          )}
        </label>
      </section>

      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{t('settings.sections.columns')}</h3>
        {disabled && <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.pickBoardFirst')}</small>}
        <div className="settings-columns-grid">
          {COLUMN_FIELDS.map(({ key, labelKey }) => {
            const columnError =
              errors[`columns.${key}`] ??
              (columnTypeMismatch(key) ? 'settings.validation.columnWrongType' : undefined);
            return (
              <label key={key} style={{ display: 'block' }}>
                {t(`settings.fields.${labelKey}`)}
                {REQUIRED_COLUMN_KEYS.has(key) && (
                  <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
                    {' *'}
                  </span>
                )}
                <SearchableSelect
                  options={optionsForField(key)}
                  value={draft.columns[key] ?? ''}
                  disabled={disabled}
                  placeholder={t('settings.selectColumn')}
                  searchPlaceholder={t('settings.column.searchInputPlaceholder')}
                  noResultsText={t('settings.column.noResults')}
                  clearText={t('settings.column.clear')}
                  allowClear
                  onChange={(id) => setColumn(key, id)}
                />
                {columnError && (
                  <span style={{ color: 'var(--color-danger)', fontSize: 13, display: 'block' }}>{t(columnError)}</span>
                )}
              </label>
            );
          })}
        </div>
      </section>

      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{t('settings.kindValues.title')}</h3>
        <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.kindValues.help')}</small>
        {showKindConsumerWarning && (
          <div className="warn-box" role="alert">
            <Icon name="alert" size={16} />
            <span>{t('settings.kindValues.consumerWarning')}</span>
          </div>
        )}
        {errors.kindValues && (
          <small style={{ color: 'var(--color-danger)', display: 'block' }}>{t(errors.kindValues)}</small>
        )}
        {!draft.vacationBoardId ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.pickBoardFirst')}</small>
        ) : kindOptionsLoading ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.loadingStatusLabels')}</small>
        ) : !draft.columns.kindColumnId ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.pickKindColumnFirst')}</small>
        ) : !isStatusColumnType(kindColumn?.type) ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.selectedColumnIsNotStatus')}</small>
        ) : kindOptions.length === 0 ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.kindValuesEmpty')}</small>
        ) : (
          <div className="settings-kind-grid">
            {(['general', 'personal'] as const).map((k) => {
              const selected = resolveSelectedOption(
                kindOptions,
                k === 'general' ? draft.kindValues.generalLabelId : draft.kindValues.personalLabelId,
                draft.kindValues[k],
              );
              return (
                <label key={k} style={{ display: 'block' }}>
                  <span className="settings-value-label">
                    {selected?.color && (
                      <span className="settings-value-dot" style={{ backgroundColor: selected.color }} />
                    )}
                    {t(`settings.kindValues.${k}`)}
                  </span>
                  <SearchableSelect
                    options={kindOptions.map((opt) => ({ id: opt.id, name: opt.title, color: opt.color }))}
                    value={selected?.id}
                    placeholder={t('settings.selectStatusLabel')}
                    searchPlaceholder={t('settings.column.searchInputPlaceholder')}
                    noResultsText={t('settings.column.noResults')}
                    clearText={t('settings.column.clear')}
                    allowClear
                    onChange={(id) => setKindValue(k, id)}
                  />
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{t('settings.typeValues.title')}</h3>
        <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.typeValues.help')}</small>
        {personalTypeError ? (
          <small style={{ color: 'var(--color-danger)', display: 'block' }}>{personalTypeError}</small>
        ) : null}
        {!draft.vacationBoardId ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.pickBoardFirst')}</small>
        ) : personalTypesLoading ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.loadingStatusLabels')}</small>
        ) : !draft.columns.personalTypeColumnId ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.pickPersonalTypeColumnFirst')}</small>
        ) : !isStatusColumnType(personalTypeColumn?.type) ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.selectedColumnIsNotStatus')}</small>
        ) : personalTypes.length === 0 ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.personalTypeValuesEmpty')}</small>
        ) : (
          <div className="settings-type-editor-grid">
            {personalTypes.map((typeOpt) => (
              <label key={typeOpt.id} className="settings-type-editor">
                <input
                  type="hidden"
                  value={String(typeOpt.colorValue ?? typeOpt.color)}
                  readOnly
                />
                <div className="settings-type-editor-color" ref={openColorPickerFor === typeOpt.id ? colorPickerRootRef : undefined}>
                  <button
                    type="button"
                    className="settings-type-editor-color-trigger"
                    aria-label={t('settings.typeColor')}
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenColorPickerFor((curr) => (curr === typeOpt.id ? null : typeOpt.id));
                    }}
                  >
                    <span className="settings-type-editor-swatch" style={{ backgroundColor: typeOpt.color }} />
                  </button>
                  {openColorPickerFor === typeOpt.id && (
                    <div className="settings-type-editor-color-popover">
                      <div className="settings-type-editor-color-grid">
                        {personalTypeColorChoices.map((choice) => {
                          const selected = colorChoiceId(typeOpt.colorValue ?? typeOpt.color) === choice.id;
                          return (
                            <button
                              key={choice.id}
                              type="button"
                              className={`settings-type-editor-color-item ${selected ? 'is-selected' : ''}`}
                              style={{ backgroundColor: choice.color }}
                              onClick={(e) => {
                                e.preventDefault();
                                setPersonalTypeColor(typeOpt.id, choice.id);
                                setOpenColorPickerFor(null);
                              }}
                              aria-label={choice.color}
                              title={choice.color}
                            >
                              {selected ? <Icon name="check" size={14} style={{ color: '#fff' }} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  className="settings-type-editor-input"
                  value={typeOpt.title}
                  onChange={(e) => setPersonalTypeLabel(typeOpt.id, e.target.value)}
                />
                <button
                  type="button"
                  className="settings-type-editor-remove"
                  onClick={() => void removePersonalType(typeOpt.id)}
                  disabled={personalTypeChecking}
                  aria-label={t('settings.removeStatusLabel')}
                  title={t('settings.removeStatusLabel')}
                >
                  <Icon name="trash" size={14} />
                </button>
              </label>
            ))}
          </div>
        )}
        {draft.vacationBoardId && draft.columns.personalTypeColumnId && isStatusColumnType(personalTypeColumn?.type) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={addPersonalType}>
            <Icon name="plus" size={14} /> {t('settings.addStatusLabel')}
          </button>
        )}
      </section>

      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{t('settings.statusValues.title')}</h3>
        <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.statusValues.help')}</small>
        {showApprovalConsumerWarning && (
          <div className="warn-box" role="alert">
            <Icon name="alert" size={16} />
            <span>{t('settings.statusValues.consumerWarning')}</span>
          </div>
        )}
        {errors.statusValues && (
          <small style={{ color: 'var(--color-danger)', display: 'block' }}>{t(errors.statusValues)}</small>
        )}
        {!draft.vacationBoardId ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.pickBoardFirst')}</small>
        ) : approvalStatusOptionsLoading ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.loadingStatusLabels')}</small>
        ) : !draft.columns.approvalStatusColumnId ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.pickApprovalStatusColumnFirst')}</small>
        ) : !isStatusColumnType(approvalStatusColumn?.type) ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.selectedColumnIsNotStatus')}</small>
        ) : approvalStatusOptions.length === 0 ? (
          <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.statusValuesEmpty')}</small>
        ) : (
          <div className="settings-status-grid">
            {STATUS_KEYS.map((status) => {
              const selected = resolveSelectedOption(
                approvalStatusOptions,
                draft.statusValues.labelIds?.[status],
                draft.statusValues[status],
              );
              return (
                <label key={status} style={{ display: 'block' }}>
                  <span className="settings-value-label">
                    {selected?.color && (
                      <span className="settings-value-dot" style={{ backgroundColor: selected.color }} />
                    )}
                    {t(`settings.statusValues.${status}`)}
                  </span>
                  <SearchableSelect
                    options={approvalStatusOptions.map((opt) => ({ id: opt.id, name: opt.title, color: opt.color }))}
                    value={selected?.id}
                    placeholder={t('settings.selectStatusLabel')}
                    searchPlaceholder={t('settings.column.searchInputPlaceholder')}
                    noResultsText={t('settings.column.noResults')}
                    clearText={t('settings.column.clear')}
                    allowClear
                    onChange={(id) => setStatusValue(status, id)}
                  />
                </label>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/** A locally-unique id for a new team. */
function newTeamId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `team-${Date.now()}-${Math.floor(performance.now())}`;
}

/** Teams tab — one card per team, each with a managers + employees people-picker. */
function TeamTab({
  draft,
  setDraft,
}: {
  draft: DayOffSettings;
  setDraft: (updater: (d: DayOffSettings) => DayOffSettings) => void;
}) {
  const { t } = useTranslation();
  const [allUsers, setAllUsers] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Load the whole account directory once for the pickers.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const users = await listAllUsers();
        if (!cancelled) setAllUsers(users);
      } catch (err) {
        logger.error('SettingsDialog', 'failed to load users', { err });
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const teams = draft.teams;
  const totalManagers = new Set(teams.flatMap((tm) => tm.managers)).size;

  const patchTeam = (id: string, patch: Partial<Team>) =>
    setDraft((d) => ({ ...d, teams: d.teams.map((tm) => (tm.id === id ? { ...tm, ...patch } : tm)) }));
  // Managers & employees are mutually exclusive within a team.
  const setManagers = (id: string, ids: string[]) =>
    setDraft((d) => ({
      ...d,
      teams: d.teams.map((tm) =>
        tm.id === id ? { ...tm, managers: ids, employees: tm.employees.filter((x) => !ids.includes(x)) } : tm,
      ),
    }));
  const setEmployees = (id: string, ids: string[]) =>
    setDraft((d) => ({
      ...d,
      teams: d.teams.map((tm) =>
        tm.id === id ? { ...tm, employees: ids, managers: tm.managers.filter((x) => !ids.includes(x)) } : tm,
      ),
    }));
  const addTeam = () =>
    setDraft((d) => ({ ...d, teams: [...d.teams, { id: newTeamId(), name: '', managers: [], employees: [] }] }));
  const removeTeam = (id: string) => setDraft((d) => ({ ...d, teams: d.teams.filter((tm) => tm.id !== id) }));

  return (
    <div className="teams-tab">
      <div>
        <span style={{ fontWeight: 600 }}>{t('settings.team.title')}</span>
        <small style={{ color: 'var(--color-text-secondary)', display: 'block', marginTop: 2 }}>{t('settings.team.help')}</small>
      </div>

      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
        {t('settings.team.counts', { team: teams.length, managers: totalManagers })}
      </div>

      {loading ? (
        <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.team.loading')}</small>
      ) : failed ? (
        <small style={{ color: 'var(--color-danger)' }}>{t('settings.team.loadError')}</small>
      ) : (
        <>
          {teams.length === 0 && <small style={{ color: 'var(--color-text-secondary)' }}>{t('settings.team.empty')}</small>}
          {teams.map((tm, i) => (
            <div className="team-card" key={tm.id}>
              <div className="team-card-head">
                <input
                  className="team-name-input"
                  value={tm.name}
                  placeholder={t('settings.team.namePlaceholder', { n: i + 1 })}
                  onChange={(e) => patchTeam(tm.id, { name: e.target.value })}
                />
                <button
                  type="button"
                  className="team-remove"
                  aria-label={t('settings.team.removeTeam')}
                  title={t('settings.team.removeTeam')}
                  onClick={() => removeTeam(tm.id)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
              <div className="team-field">
                <label>{t('settings.team.managersField')}</label>
                <PeoplePicker
                  users={allUsers}
                  value={tm.managers}
                  onChange={(ids) => setManagers(tm.id, ids)}
                  placeholder={t('settings.team.managersPlaceholder')}
                />
              </div>
              <div className="team-field">
                <label>{t('settings.team.employeesField')}</label>
                <PeoplePicker
                  users={allUsers}
                  value={tm.employees}
                  onChange={(ids) => setEmployees(tm.id, ids)}
                  placeholder={t('settings.team.employeesPlaceholder')}
                />
              </div>
            </div>
          ))}

          <button type="button" className="btn add-team-btn" onClick={addTeam}>
            <Icon name="plus" size={16} strokeWidth={2.5} /> {t('settings.team.addTeam')}
          </button>
        </>
      )}
    </div>
  );
}

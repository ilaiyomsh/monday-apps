/**
 * DayOffDataProvider — the single data context for the app (replaces the
 * prototype's app.jsx state + window.DayOffData). Reads config from useSettings(),
 * builds the service ctx objects, loads requests/companyDays/entitlements/team in
 * parallel on mount, and exposes the analytics + mutation surface defined by the
 * `useDayOffData()` contract (CONTRACT.md). All monday I/O is funneled through the
 * service modules; every catch surfaces via handleError + logger.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useMondayContext, useErrorHandler } from '@axis/app-core';
import { logger, useSettings } from '../core';
import type {
  AbsenceType,
  Balance,
  CompanyDay,
  CompanyDayDraft,
  DayOffRequest,
  Employee,
  Entitlement,
  RequestDraft,
  RequestStatus,
} from '../domain/types';
import type { Team, PersonalTypeOption } from '../types';
import {
  applyRuntimeAbsenceTypes,
  computeBalance,
  pendingDaysFor as pendingDaysForDomain,
  requestYear,
  resolveStatusColor,
} from '../domain/absence';
import { todayKey } from '../domain/dates';
import {
  listEntries,
  getRequestById,
  createRequest,
  updateRequest,
  setStatus,
  deleteRequest,
  uploadAttachment,
  updateRequestNotes,
  saveCompanyDay as saveCompanyDayApi,
  deleteCompanyDay as deleteCompanyDayApi,
  type VacationCtx,
} from '../services/vacationService';
import { getMe, resolveUsers } from '../services/usersService';
import { mondayApi } from '../services/mondayApi';

type ToastVariant = '' | 'success' | 'danger';
interface Toast {
  id: number;
  text: string;
  variant: ToastVariant;
}

export interface DayOffData {
  loading: boolean;
  /** True only during the very first load — gates the full-screen loader. */
  initializing: boolean;
  requests: DayOffRequest[];
  companyDays: CompanyDay[];
  entitlements: Entitlement[];
  team: Employee[];
  teamIds: string[];
  /** All configured teams (every team, not just the current user's). */
  teams: Team[];
  /** Teams the signed-in user belongs to (manager or employee). */
  myTeams: Team[];
  /** Teams a given employee belongs to — for the team label on a request. */
  teamsOf: (empId: string) => Team[];
  empById: (id: string) => Employee | undefined;
  currentUser: Employee;
  isManager: boolean;
  isBoardOwner: boolean;
  years: number[];
  monthDate: Date;
  year: number;
  nav: { onPrev: () => void; onNext: () => void; onToday: () => void };
  onYearChange: (y: number) => void;
  balanceFor: (year: number, empId: string, type: AbsenceType) => Balance;
  pendingDaysFor: (empId: string, type: AbsenceType, year: number) => number;
  holidaysOnKey: (dateKey: string) => CompanyDay[];
  submitRequest: (draft: RequestDraft, editingId?: string) => Promise<boolean>;
  approve: (r: DayOffRequest, note?: string) => Promise<boolean>;
  reject: (r: DayOffRequest, reason?: string) => Promise<void>;
  approveAll: () => Promise<void>;
  cancelRequest: (r: DayOffRequest) => Promise<void>;
  /**
   * Fetch a single request by monday item id — for the deep-link flow when the
   * target falls outside the loaded year. Returns null when the item is missing
   * or isn't a personal request. Errors surface via handleError and resolve null.
   */
  fetchRequestById: (itemId: string) => Promise<DayOffRequest | null>;
  /** Upload a document to an existing request (any status). */
  attachDocument: (r: DayOffRequest, file: File) => Promise<void>;
  /** Persist employee and/or manager notes on an existing request (any status). */
  saveRequestNotes: (
    r: DayOffRequest,
    notes: { employeeNote?: string; managerNote?: string },
  ) => Promise<boolean>;
  /** True when the requests board has a file column configured (upload enabled). */
  canAttachDocuments: boolean;
  canEditEmployeeNote: boolean;
  canEditManagerNote: boolean;
  saveCompanyDay: (draft: CompanyDayDraft) => Promise<boolean>;
  deleteCompanyDay: (h: CompanyDay) => Promise<void>;
  toasts: Toast[];
  toast: (text: string, variant?: ToastVariant) => void;
  /** UI color for pending / approved / rejected — from settings status mapping. */
  statusColor: (status: RequestStatus) => string;
}

const Ctx = createContext<DayOffData | null>(null);

const TOAST_TTL_MS = 2800;
const MIN_SELECTABLE_YEAR = 2025;
const MAX_SELECTABLE_YEAR = 2040;

/** Stable empty entitlements list (yearly quotas were removed). */
const EMPTY_ENTITLEMENTS: Entitlement[] = [];
const LEGACY_PERSONAL_TYPES: PersonalTypeOption[] = [
  { id: 'vacation', title: 'types.vacation', color: 'var(--color-event-vacation)', index: 1 },
  { id: 'sick', title: 'types.sick', color: 'var(--color-event-sick)', index: 2 },
  { id: 'reserves', title: 'types.reserves', color: 'var(--color-event-reserves)', index: 3 },
];

/** Minimal Employee fallback when the monday users API can't resolve the signed-in user. */
function fallbackEmployee(id: string, name: string): Employee {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '?';
  return { id, name, initials, color: '#0073ea' };
}

export function DayOffDataProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { settings, validation } = useSettings();
  const { currentUser: mondayUser } = useMondayContext();
  const { handleError } = useErrorHandler(logger);

  const [loading, setLoading] = useState(true);
  // True only until the first entries load completes. Year-change reloads flip
  // `loading` but keep `initializing` false, so the app shell is not torn down.
  const [initializing, setInitializing] = useState(true);
  const [requests, setRequests] = useState<DayOffRequest[]>([]);
  const [companyDays, setCompanyDays] = useState<CompanyDay[]>([]);
  // Yearly quotas were removed — entitlements is always empty (kept on the
  // public surface so balance analytics/views compile; entitled resolves to 0).
  const entitlements: Entitlement[] = EMPTY_ENTITLEMENTS;
  const [team, setTeam] = useState<Employee[]>([]);
  const [currentUser, setCurrentUser] = useState<Employee>(() =>
    fallbackEmployee(String(mondayUser.id ?? 'me'), mondayUser.name ?? ''),
  );

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const today = useMemo(() => new Date(), []);
  const [monthDate, setMonthDate] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const year = monthDate.getFullYear();

  // ---- service context (one board; rebuilt when settings change) ----
  // W1.3: invalid settings yield NO ctx at all — a half-configured board must
  // never be read (it produces all-pending / silently-empty results). The
  // DayOffView shows the misconfiguration screen instead.
  const settingsValid = validation.isValid;
  const vacCtx = useMemo<VacationCtx | null>(() => {
    if (!settings.vacationBoardId || !settingsValid) return null;
    const savedPersonalTypes = settings.personalTypes ?? [];
    const personalTypes = savedPersonalTypes.length ? savedPersonalTypes : LEGACY_PERSONAL_TYPES;
    return {
      boardId: settings.vacationBoardId,
      cols: settings.columns,
      kindValues: settings.kindValues,
      personalTypes,
      statusValues: settings.statusValues,
    };
  }, [settings.vacationBoardId, settingsValid, settings.columns, settings.kindValues, settings.personalTypes, settings.statusValues]);

  useEffect(() => {
    const savedPersonalTypes = settings.personalTypes ?? [];
    applyRuntimeAbsenceTypes(savedPersonalTypes.length ? savedPersonalTypes : LEGACY_PERSONAL_TYPES);
  }, [settings.personalTypes]);

  const [approvalStatusTypes, setApprovalStatusTypes] = useState<PersonalTypeOption[]>([]);

  useEffect(() => {
    const saved = settings.approvalStatusTypes ?? [];
    if (saved.length) {
      setApprovalStatusTypes(saved);
      return;
    }
    const boardId = settings.vacationBoardId;
    const columnId = settings.columns.approvalStatusColumnId;
    if (!boardId || !columnId) {
      setApprovalStatusTypes([]);
      return;
    }
    let cancelled = false;
    void mondayApi
      .getStatusColumnSnapshot(boardId, columnId)
      .then((snapshot) => {
        if (!cancelled) setApprovalStatusTypes(snapshot);
      })
      .catch((err) => {
        logger.error('DayOffDataProvider', 'failed to load approval status colors', { boardId, columnId, err });
        if (!cancelled) setApprovalStatusTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.approvalStatusTypes, settings.vacationBoardId, settings.columns.approvalStatusColumnId]);

  const statusColor = useCallback(
    (status: RequestStatus) => resolveStatusColor(status, settings.statusValues, approvalStatusTypes),
    [settings.statusValues, approvalStatusTypes],
  );

  // ---- teams + derived role/universe selectors ----
  const teams = settings.teams;
  // Every configured member (any team) — resolved into `team` so empById covers
  // requesters shown in Approvals regardless of which team they're in.
  const allMemberIds = useMemo(
    () => [...new Set(teams.flatMap((tm) => [...tm.managers, ...tm.employees]))],
    [teams],
  );
  // Teams the signed-in user belongs to (as manager or employee).
  const myTeams = useMemo(
    () => teams.filter((tm) => tm.managers.includes(currentUser.id) || tm.employees.includes(currentUser.id)),
    [teams, currentUser.id],
  );
  // The current user's visible universe (members of their own teams) — drives
  // the Team view + Dashboard.
  const teamIds = useMemo(
    () => [...new Set(myTeams.flatMap((tm) => [...tm.managers, ...tm.employees]))],
    [myTeams],
  );
  const isManager = useMemo(
    () => teams.some((tm) => tm.managers.includes(currentUser.id)),
    [teams, currentUser.id],
  );
  // Owners of the configured board may always open Settings (mirrors tracker's
  // useBoardOwner, but the boardId comes from settings — Custom Object apps have
  // no reliable context.boardId).
  const [isBoardOwner, setIsBoardOwner] = useState(false);
  // Teams a given employee belongs to — used for the team label on requests.
  const teamsOf = useCallback(
    (empId: string) => teams.filter((tm) => tm.managers.includes(empId) || tm.employees.includes(empId)),
    [teams],
  );

  // ---- toasts ----
  const toast = useCallback((text: string, variant: ToastVariant = '') => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((ts) => [...ts, { id, text, variant }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), TOAST_TTL_MS);
  }, []);

  // W1.3 corollary: vacCtx is null whenever settings are invalid. The READ path
  // surfaces that via the misconfiguration screen; a user-triggered WRITE must
  // fail loudly too - never a silent no-op.
  const requireVacCtx = useCallback(
    (operation: string): VacationCtx | null => {
      if (vacCtx) return vacCtx;
      logger.error('DayOffData', 'write blocked - settings invalid or board unconfigured', { operation });
      toast(t('toasts.writeBlockedInvalidSettings'), 'danger');
      return null;
    },
    [vacCtx, toast, t],
  );

  // ---- loaders ----
  // One board read → split into personal requests + general company days.
  const loadEntries = useCallback(async (): Promise<void> => {
    if (!vacCtx) {
      setRequests([]);
      setCompanyDays([]);
      return;
    }
    const { requests: reqs, companyDays: days } = await listEntries(vacCtx, year);
    setRequests(reqs);
    setCompanyDays(days);
  }, [vacCtx, year]);

  const loadTeam = useCallback(async () => {
    if (!allMemberIds.length) {
      setTeam([]);
      return;
    }
    setTeam(await resolveUsers(allMemberIds));
  }, [allMemberIds]);

  const resolveCurrentUser = useCallback(async () => {
    // Primary source: the session `me` query — reliable even when monday's
    // context.user is absent (standalone Custom Object). Fall back to the
    // context-provided id only if `me` returns nothing.
    const me = await getMe();
    if (me) {
      setCurrentUser(me);
      return;
    }
    const id = String(mondayUser.id ?? 'me');
    const name = mondayUser.name ?? '';
    const [resolved] = id === 'me' ? [] : await resolveUsers([id]);
    setCurrentUser(resolved ?? fallbackEmployee(id, name));
  }, [mondayUser.id, mondayUser.name]);

  // ---- entries load (gates the app until the selected year's days are ready) ----
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void loadEntries()
      .catch((err) => handleError(err, { operation: 'DayOffData.loadEntries' }))
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setInitializing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadEntries, handleError]);

  // ---- team + current user (background; does not block the shell) ----
  useEffect(() => {
    const guard = (op: string, p: Promise<unknown>) =>
      p.catch((err) => handleError(err, { operation: `DayOffData.${op}` }));
    void Promise.allSettled([guard('loadTeam', loadTeam()), guard('resolveCurrentUser', resolveCurrentUser())]);
  }, [loadTeam, resolveCurrentUser, handleError]);

  // ---- board-owner check (settings access) ----
  useEffect(() => {
    const boardId = settings.vacationBoardId;
    const userId = currentUser.id;
    if (!boardId || !userId || userId === 'me') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsBoardOwner(false);
      return;
    }
    let cancelled = false;
    mondayApi
      .getBoardOwners(boardId)
      .then((owners) => {
        if (!cancelled) setIsBoardOwner(owners.some((o) => o.id === String(userId)));
      })
      .catch((err) => {
        logger.warn('DayOffData', 'getBoardOwners failed', err);
        if (!cancelled) setIsBoardOwner(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.vacationBoardId, currentUser.id]);

  // ---- derived: lookups + selectable years ----
  const empById = useCallback(
    (id: string): Employee | undefined => {
      if (currentUser.id === id) return currentUser;
      return team.find((e) => e.id === id);
    },
    [team, currentUser],
  );

  const years = useMemo(() => {
    const set = new Set<number>();
    for (let y = MIN_SELECTABLE_YEAR; y <= MAX_SELECTABLE_YEAR; y += 1) set.add(y);
    set.add(today.getFullYear());
    for (const r of requests) set.add(requestYear(r));
    for (const e of entitlements) set.add(e.year);
    return [...set].sort((a, b) => a - b);
  }, [requests, entitlements, today]);

  // ---- month nav ----
  const nav = useMemo(
    () => ({
      onPrev: () => setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1)),
      onNext: () => setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1)),
      onToday: () => setMonthDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    }),
    [today],
  );

  const onYearChange = useCallback((y: number) => {
    setMonthDate((d) => new Date(y, d.getMonth(), 1));
  }, []);

  // ---- analytics (wrap domain/absence over current data) ----
  const balanceFor = useCallback(
    (y: number, empId: string, type: AbsenceType): Balance => computeBalance(requests, entitlements, empId, type, y),
    [requests, entitlements],
  );

  const pendingDaysFor = useCallback(
    (empId: string, type: AbsenceType, y: number): number => pendingDaysForDomain(requests, empId, type, y),
    [requests],
  );

  const holidaysOnKey = useCallback(
    (dateKey: string): CompanyDay[] => companyDays.filter((h) => dateKey >= h.start && dateKey <= h.end),
    [companyDays],
  );

  // ---- mutations: API write -> re-fetch affected list -> toast ----
  const submitRequest = useCallback(
    async (draft: RequestDraft, editingId?: string): Promise<boolean> => {
      const ctx = requireVacCtx('submitRequest');
      if (!ctx) return false;
      try {
        if (editingId) {
          await updateRequest(ctx, editingId, draft, currentUser.name, currentUser.id);
        } else {
          await createRequest(ctx, currentUser.id, draft, currentUser.name);
        }
        await loadEntries();
        toast(editingId ? t('toasts.requestUpdated') : t('toasts.requestSent'), 'success');
        return true;
      } catch (err) {
        handleError(err, { operation: 'DayOffData.submitRequest' });
        return false;
      }
    },
    [requireVacCtx, currentUser.id, currentUser.name, loadEntries, toast, t, handleError],
  );

  const approve = useCallback(
    async (r: DayOffRequest, note?: string): Promise<boolean> => {
      const ctx = requireVacCtx('approve');
      if (!ctx) return false;
      const mn = note && note.trim() ? note.trim() : undefined;
      try {
        await setStatus(ctx, r.id, 'approved', currentUser.id, todayKey(), mn);
        await loadEntries();
        toast(t('toasts.requestApproved'), 'success');
        return true;
      } catch (err) {
        handleError(err, { operation: 'DayOffData.approve' });
        return false;
      }
    },
    [requireVacCtx, currentUser.id, loadEntries, toast, t, handleError],
  );

  const reject = useCallback(
    async (r: DayOffRequest, reason?: string) => {
      const ctx = requireVacCtx('reject');
      if (!ctx) return;
      const mn = reason && reason.trim() ? reason.trim() : undefined;
      try {
        await setStatus(ctx, r.id, 'rejected', currentUser.id, todayKey(), mn);
        await loadEntries();
        toast(t('toasts.requestRejected'), 'danger');
      } catch (err) {
        handleError(err, { operation: 'DayOffData.reject' });
      }
    },
    [requireVacCtx, currentUser.id, loadEntries, toast, t, handleError],
  );

  const approveAll = useCallback(async () => {
    const ctx = requireVacCtx('approveAll');
    if (!ctx) return;
    const pend = requests.filter((r) => r.status === 'pending');
    if (!pend.length) return;
    try {
      for (const r of pend) {
        await setStatus(ctx, r.id, 'approved', currentUser.id, todayKey());
      }
      await loadEntries();
      toast(t('toasts.requestsApproved', { count: pend.length }), 'success');
    } catch (err) {
      handleError(err, { operation: 'DayOffData.approveAll' });
    }
  }, [requireVacCtx, requests, currentUser.id, loadEntries, toast, t, handleError]);

  const cancelRequest = useCallback(
    async (r: DayOffRequest) => {
      try {
        await deleteRequest(r.id);
        await loadEntries();
        toast(t('toasts.requestCancelled'));
      } catch (err) {
        handleError(err, { operation: 'DayOffData.cancelRequest' });
      }
    },
    [loadEntries, toast, t, handleError],
  );

  const fetchRequestById = useCallback(
    async (itemId: string): Promise<DayOffRequest | null> => {
      if (!vacCtx) return null;
      try {
        return await getRequestById(vacCtx, itemId);
      } catch (err) {
        handleError(err, { operation: 'DayOffData.fetchRequestById' });
        return null;
      }
    },
    [vacCtx, handleError],
  );

  const attachDocument = useCallback(
    async (r: DayOffRequest, file: File) => {
      const ctx = requireVacCtx('attachDocument');
      if (!ctx) return;
      try {
        await uploadAttachment(ctx, r.id, file);
        await loadEntries();
        toast(t('toasts.documentAttached'), 'success');
      } catch (err) {
        handleError(err, { operation: 'DayOffData.attachDocument' });
      }
    },
    [requireVacCtx, loadEntries, toast, t, handleError],
  );
  const canAttachDocuments = !!vacCtx?.cols.fileColumnId;
  const canEditEmployeeNote = !!vacCtx?.cols.empNoteColumnId;
  const canEditManagerNote = !!vacCtx?.cols.mgrNoteColumnId;

  const saveRequestNotes = useCallback(
    async (r: DayOffRequest, notes: { employeeNote?: string; managerNote?: string }): Promise<boolean> => {
      const ctx = requireVacCtx('saveRequestNotes');
      if (!ctx) return false;
      try {
        await updateRequestNotes(ctx, r.id, notes);
        await loadEntries();
        toast(t('toasts.noteSaved'), 'success');
        return true;
      } catch (err) {
        handleError(err, { operation: 'DayOffData.saveRequestNotes' });
        return false;
      }
    },
    [requireVacCtx, loadEntries, toast, t, handleError],
  );

  const saveCompanyDay = useCallback(
    async (draft: CompanyDayDraft): Promise<boolean> => {
      const ctx = requireVacCtx('saveCompanyDay');
      if (!ctx) return false;
      try {
        await saveCompanyDayApi(ctx, draft);
        await loadEntries();
        toast(draft.id ? t('toasts.companyDayUpdated') : t('toasts.companyDayAdded'), 'success');
        return true;
      } catch (err) {
        handleError(err, { operation: 'DayOffData.saveCompanyDay' });
        return false;
      }
    },
    [requireVacCtx, loadEntries, toast, t, handleError],
  );

  const deleteCompanyDay = useCallback(
    async (h: CompanyDay) => {
      try {
        await deleteCompanyDayApi(h.id);
        await loadEntries();
        toast(t('toasts.companyDayDeleted'));
      } catch (err) {
        handleError(err, { operation: 'DayOffData.deleteCompanyDay' });
      }
    },
    [loadEntries, toast, t, handleError],
  );

  const value = useMemo<DayOffData>(
    () => ({
      loading,
      initializing,
      requests,
      companyDays,
      entitlements,
      team,
      teamIds,
      teams,
      myTeams,
      teamsOf,
      empById,
      currentUser,
      isManager,
      isBoardOwner,
      years,
      monthDate,
      year,
      nav,
      onYearChange,
      balanceFor,
      pendingDaysFor,
      holidaysOnKey,
      submitRequest,
      approve,
      reject,
      approveAll,
      cancelRequest,
      fetchRequestById,
      attachDocument,
      saveRequestNotes,
      canAttachDocuments,
      canEditEmployeeNote,
      canEditManagerNote,
      saveCompanyDay,
      deleteCompanyDay,
      toasts,
      toast,
      statusColor,
    }),
    [
      loading,
      initializing,
      requests,
      companyDays,
      entitlements,
      team,
      teamIds,
      teams,
      myTeams,
      teamsOf,
      empById,
      currentUser,
      isManager,
      isBoardOwner,
      years,
      monthDate,
      year,
      nav,
      onYearChange,
      balanceFor,
      pendingDaysFor,
      holidaysOnKey,
      submitRequest,
      approve,
      reject,
      approveAll,
      cancelRequest,
      fetchRequestById,
      attachDocument,
      saveRequestNotes,
      canAttachDocuments,
      canEditEmployeeNote,
      canEditManagerNote,
      saveCompanyDay,
      deleteCompanyDay,
      toasts,
      toast,
      statusColor,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDayOffData(): DayOffData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDayOffData must be used within DayOffDataProvider');
  return ctx;
}

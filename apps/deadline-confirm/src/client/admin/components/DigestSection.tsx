// v4 — the "מייל מסכם" (digest) tab: users-board mapping, section rules,
// preview against the SAVED config, and the phase-1 manual send. Nothing here
// touches the existing tabs' behavior.

import { useEffect, useState } from 'react';
import { Button, Dropdown, TextField, Toggle } from '@vibe/core';
import type {
  ActionButton,
  BoardColumn,
  Board,
  DigestPreviewResponse,
  DigestRawSendResponse,
  DigestSendResponse,
} from '../types';
import type { DigestDraft, DigestSectionDraft } from '../draft';
import { newDigestSection } from '../draft';
import { apiFetch, ApiError, formatApiFailure } from '../services/api';
import { fetchBoardColumns } from '../services/monday';
import { ampByteLength, ampSizeWarning, defaultDebugSubject, validateRawSend } from '../amp-debug';
import logger from '../utils/logger';

interface Option {
  value: string;
  label: string;
}

interface Props {
  boards: Board[];
  tasksColumns: BoardColumn[];
  tasksColumnsLoading: boolean;
  buttons: ActionButton[];
  digest: DigestDraft;
  dirty: boolean;
  onChange: (patch: Partial<DigestDraft>) => void;
}

const GUARD_MESSAGES: Record<string, string> = {
  digest_not_configured: 'המייל המסכם עוד לא נשמר — הפעילו אותו, השלימו את השדות ולחצו "שמירת הגדרות".',
  no_secret: 'אין מפתח קישורים פעיל — צרו מפתח בלשונית ההגדרות.',
  not_connected: 'אין חיבור monday פעיל — התחברו מחדש בלשונית ההגדרות.',
  email_not_configured: 'ערוץ השליחה לא מוגדר בשרת (חסר צמד ה-OAuth client בסביבת האפליקציה).',
  monday_api_failed: 'קריאת הלוחות ממאנדיי נכשלה. נסו שוב.',
};

function guardMessage(err: unknown): string {
  if (err instanceof ApiError && GUARD_MESSAGES[err.message]) return GUARD_MESSAGES[err.message];
  return 'הפעולה נכשלה. נסו שוב.';
}

const toOption = (value: string, label: string): Option => ({ value, label });
const findOption = (options: Option[], value: string | null) =>
  options.find((o) => o.value === value) ?? null;

export function DigestSection({ boards, tasksColumns, tasksColumnsLoading, buttons, digest, dirty, onChange }: Props) {
  const [usersColumns, setUsersColumns] = useState<BoardColumn[]>([]);
  const [usersColumnsLoading, setUsersColumnsLoading] = useState(false);
  const [usersColumnsError, setUsersColumnsError] = useState<string | null>(null);

  const [preview, setPreview] = useState<DigestPreviewResponse | null>(null);
  const [previewRecipient, setPreviewRecipient] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [ampCopied, setAmpCopied] = useState(false);
  const [plainCopied, setPlainCopied] = useState(false);

  const [sendPhase, setSendPhase] = useState<'idle' | 'confirm' | 'sending'>('idle');
  const [sendResult, setSendResult] = useState<DigestSendResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // AMP debug lane: the preview's amp4email document, editable, sent as typed.
  const [ampDraft, setAmpDraft] = useState('');
  const [ampTo, setAmpTo] = useState('');
  const [ampSubject, setAmpSubject] = useState('');
  const [rawSending, setRawSending] = useState(false);
  const [rawResult, setRawResult] = useState<DigestRawSendResponse | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);

  // Users board picked → load ITS columns (people + email pickers).
  useEffect(() => {
    if (!digest.usersBoardId) {
      setUsersColumns([]);
      return;
    }
    let cancelled = false;
    setUsersColumnsLoading(true);
    setUsersColumnsError(null);
    fetchBoardColumns(digest.usersBoardId)
      .then((cols) => {
        if (cancelled) return;
        setUsersColumns(cols);
      })
      .finally(() => {
        if (!cancelled) setUsersColumnsLoading(false);
      })
      // The chain must TERMINATE in catch — a .finally() tail leaves the
      // rejection unhandled once .then() throws (promise/catch-or-return).
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('admin', 'digest_users_columns_load_failed', err);
        setUsersColumnsError('טעינת עמודות לוח המשתמשים נכשלה. נסו לרענן.');
      });
    return () => {
      cancelled = true;
    };
  }, [digest.usersBoardId]);

  const boardOptions = boards.map((b) => toOption(b.id, b.name));
  const peopleOptions = usersColumns.filter((c) => c.type === 'people').map((c) => toOption(c.id, c.title));
  const emailOptions = usersColumns.filter((c) => c.type === 'email').map((c) => toOption(c.id, c.title));
  const dateOptions = tasksColumns.filter((c) => c.type === 'date').map((c) => toOption(c.id, c.title));
  const textOptions = tasksColumns.filter((c) => c.type === 'text').map((c) => toOption(c.id, c.title));
  const buttonOptions = buttons
    .filter((b) => b.name.trim().length > 0)
    .map((b) => toOption(b.id, b.name));

  const patchSection = (id: string, patch: Partial<DigestSectionDraft>) => {
    onChange({ sections: digest.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  };

  // The status-condition options for a section = the labels of the status
  // column that the section's action button writes to (owner decision: the
  // condition lives on the button's status column).
  const statusLabelOptionsFor = (buttonId: string | null): Option[] => {
    const button = buttons.find((b) => b.id === buttonId);
    if (!button) return [];
    const column = tasksColumns.find((c) => c.id === button.statusColumnId);
    return (column?.labels ?? []).map((l) => toOption(String(l.id), l.label));
  };

  const loadPreview = async (recipient: string | null) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const qs = recipient ? `?recipient=${encodeURIComponent(recipient)}` : '';
      const res = await apiFetch<DigestPreviewResponse>(`/api/digest/preview${qs}`);
      setPreview(res);
      const shown = recipient ?? res.recipients[0]?.email ?? null;
      setPreviewRecipient(shown);
      // A fresh preview is a fresh document — the editor mirrors it, and the
      // previous send's outcome no longer describes what is in the box.
      setAmpDraft(res.amp ?? '');
      setAmpTo(shown ?? '');
      setAmpSubject(defaultDebugSubject(digest.subject));
      setRawResult(null);
      setRawError(null);
    } catch (err) {
      logger.error('admin', 'digest_preview_failed', err);
      setPreviewError(guardMessage(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  // V5: hand the amp4email part to the operator's clipboard (playground paste).
  const copyPlain = async (plain: string) => {
    setPlainCopied(false);
    try {
      await navigator.clipboard.writeText(plain);
      setPlainCopied(true);
    } catch (err) {
      logger.error('admin', 'digest_plain_copy_failed', err);
      setPreviewError('העתקה נכשלה — אפשר להעתיק ידנית מהתצוגה.');
    }
  };

  const copyAmp = async (amp: string) => {
    setAmpCopied(false);
    try {
      await navigator.clipboard.writeText(amp);
      setAmpCopied(true);
    } catch (err) {
      logger.error('admin', 'digest_amp_copy_failed', err);
      setPreviewError('העתקה נכשלה — אפשר לפתוח את הקונסול ולהעתיק ידנית.');
    }
  };

  // Send the box's CURRENT contents — not a re-render. This is the whole point
  // of the lane: bisect a Gmail rendering failure by hand-editing the document.
  const sendRawAmp = async () => {
    const invalid = validateRawSend({ amp: ampDraft, to: ampTo });
    if (invalid) {
      setRawError(invalid);
      return;
    }
    setRawSending(true);
    setRawError(null);
    setRawResult(null);
    try {
      const res = await apiFetch<DigestRawSendResponse>('/api/digest/send-raw', {
        method: 'POST',
        body: JSON.stringify({
          amp: ampDraft,
          to: ampTo.trim(),
          subject: ampSubject,
          // Same plain part the real message carries, so the only variable
          // under test is the AMP document itself.
          plain: preview?.plain ?? undefined,
        }),
      });
      setRawResult(res);
    } catch (err) {
      logger.error('admin', 'digest_raw_amp_send_failed', err);
      // The server's message IS the diagnostic here (Gmail's rejection text) —
      // never collapse it into a generic Hebrew sentence.
      setRawError(formatApiFailure(err, 'שליחת הקוד הערוך נכשלה.'));
    } finally {
      setRawSending(false);
    }
  };

  const doSend = async () => {
    setSendPhase('sending');
    setSendError(null);
    setSendResult(null);
    try {
      const res = await apiFetch<DigestSendResponse>('/api/digest/send', { method: 'POST' });
      setSendResult(res);
    } catch (err) {
      logger.error('admin', 'digest_send_failed', err);
      setSendError(guardMessage(err));
    } finally {
      setSendPhase('idle');
    }
  };

  return (
    <>
      <section className="dc-section">
        <h2>מייל מסכם יומי</h2>
        <div className="dc-hint">
          מייל אחד לכל משתמש עם כל המשימות שממתינות לו — במקום מייל לכל משימה. הנמענים נקבעים
          מלוח משתמשים ייעודי: עמודת אנשים מזהה את המשתמש, עמודת אימייל היא הכתובת. משימה נכללת
          כשהתאריך שלה עבר והסטטוס עוד לא בערך היעד של הכפתור.
        </div>
        <div className="dc-row">
          <div className="dc-field">
            <label>הפעלת המייל המסכם</label>
            <Toggle
              isSelected={digest.enabled}
              onOverrideText="פעיל"
              offOverrideText="כבוי"
              onChange={(value: boolean) => onChange({ enabled: value })}
            />
          </div>
        </div>
        {digest.enabled && (
          <>
            <div className="dc-row">
              <div className="dc-field">
                <label>לוח משתמשים</label>
                <Dropdown
                  placeholder="בחרו לוח"
                  options={boardOptions}
                  value={findOption(boardOptions, digest.usersBoardId)}
                  onChange={(opt: Option | null) =>
                    onChange({
                      usersBoardId: opt?.value ?? null,
                      usersPeopleColumnId: null,
                      usersEmailColumnId: null,
                    })
                  }
                  clearable={false}
                />
              </div>
              <div className="dc-field">
                <label>עמודת אנשים (בלוח המשתמשים)</label>
                <Dropdown
                  placeholder={usersColumnsLoading ? 'טוען עמודות…' : 'בחרו עמודת אנשים'}
                  disabled={!digest.usersBoardId || usersColumnsLoading}
                  options={peopleOptions}
                  value={findOption(peopleOptions, digest.usersPeopleColumnId)}
                  onChange={(opt: Option | null) => onChange({ usersPeopleColumnId: opt?.value ?? null })}
                  clearable={false}
                />
              </div>
              <div className="dc-field">
                <label>עמודת אימייל (בלוח המשתמשים)</label>
                <Dropdown
                  placeholder={usersColumnsLoading ? 'טוען עמודות…' : 'בחרו עמודת אימייל'}
                  disabled={!digest.usersBoardId || usersColumnsLoading}
                  options={emailOptions}
                  value={findOption(emailOptions, digest.usersEmailColumnId)}
                  onChange={(opt: Option | null) => onChange({ usersEmailColumnId: opt?.value ?? null })}
                  clearable={false}
                />
              </div>
            </div>
            {usersColumnsError && <div className="dc-error">{usersColumnsError}</div>}
            {digest.usersBoardId && !usersColumnsLoading && emailOptions.length === 0 && (
              <div className="dc-hint">בלוח שנבחר אין עמודת אימייל — הוסיפו אחת במאנדיי.</div>
            )}
            <div className="dc-row">
              <div className="dc-field" style={{ minWidth: 320 }}>
                <label>נושא המייל</label>
                <TextField
                  value={digest.subject}
                  placeholder="נושא"
                  onChange={(value: string) => onChange({ subject: value })}
                />
              </div>
              <div className="dc-field" style={{ maxWidth: 160 }}>
                <label>שעת שליחה (0–23, ישראל)</label>
                <TextField
                  type="number"
                  value={String(digest.sendHour)}
                  onChange={(value: string) => {
                    const parsed = Number(value);
                    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 23) {
                      onChange({ sendHour: parsed });
                    }
                  }}
                />
              </div>
            </div>
          </>
        )}
      </section>

      {digest.enabled && (
        <section className="dc-section">
          <h2>מקבצי משימות</h2>
          <div className="dc-hint">
            כל מקבץ הוא טבלה במייל: עמודת תאריך שקובעת "באיחור" (תאריך שעבר — כולל היום),
            תנאי סטטוס שקובע אילו משימות נכנסות, ותפריט נפתח מעוצב (תגית צבע → אפשרויות)
            לבחירת סטטוס חדש מהכפתורים שנבחרו כאן.
          </div>
          {digest.sections.map((section) => {
            const primaryButtonId = section.buttonIds[0] ?? section.buttonId;
            const statusOptions = statusLabelOptionsFor(primaryButtonId);
            const selectedStatus = statusOptions.filter((o) =>
              section.includeStatusLabelIds.includes(Number(o.value))
            );
            const selectedButtons = buttonOptions.filter((o) => section.buttonIds.includes(o.value));
            return (
              <div key={section.id} className="dc-card">
                <div className="dc-row">
                  <div className="dc-field" style={{ minWidth: 280 }}>
                    <label>כותרת המקבץ</label>
                    <TextField
                      value={section.title}
                      placeholder="למשל: משימות שנדרש לסיים"
                      onChange={(value: string) => patchSection(section.id, { title: value })}
                    />
                  </div>
                  <div className="dc-field">
                    <label>עמודת תאריך (בלוח המשימות)</label>
                    <Dropdown
                      placeholder={tasksColumnsLoading ? 'טוען…' : 'בחרו עמודת תאריך'}
                      options={dateOptions}
                      value={findOption(dateOptions, section.dateColumnId)}
                      onChange={(opt: Option | null) =>
                        patchSection(section.id, {
                          dateColumnId: opt?.value ?? null,
                          // capture the board column title → email header
                          dateColumnTitle: opt?.label ?? '',
                        })
                      }
                      clearable={false}
                    />
                  </div>
                  <div className="dc-field" style={{ minWidth: 220 }}>
                    <label>כפתורי פעולה (עמודות במייל)</label>
                    <Dropdown
                      multi
                      multiline
                      placeholder="בחרו כפתור אחד או יותר"
                      options={buttonOptions}
                      value={selectedButtons}
                      onChange={(opts: Option[] | null) => {
                        const buttonIds = (opts ?? []).map((o) => o.value);
                        const nextPrimary = buttonIds[0] ?? null;
                        const primaryChanged = nextPrimary !== primaryButtonId;
                        patchSection(section.id, {
                          buttonIds,
                          buttonId: nextPrimary,
                          // switching the primary button changes the status column → reset filter
                          ...(primaryChanged ? { includeStatusLabelIds: [] } : {}),
                        });
                      }}
                      clearable={false}
                    />
                  </div>
                  {digest.sections.length > 1 && (
                    <Button
                      kind={Button.kinds.TERTIARY}
                      onClick={() => onChange({ sections: digest.sections.filter((s) => s.id !== section.id) })}
                    >
                      הסרה
                    </Button>
                  )}
                </div>
                <div className="dc-row">
                  <div className="dc-field" style={{ minWidth: 280 }}>
                    <label>עמודת טקסט חובה (אופציונלי)</label>
                    <Dropdown
                      placeholder={
                        tasksColumnsLoading
                          ? 'טוען…'
                          : textOptions.length === 0
                            ? 'אין עמודות טקסט בלוח'
                            : 'ללא — אין שדה טקסט'
                      }
                      disabled={tasksColumnsLoading || textOptions.length === 0}
                      options={textOptions}
                      value={findOption(textOptions, section.noteColumnId)}
                      onChange={(opt: Option | null) =>
                        patchSection(section.id, {
                          noteColumnId: opt?.value ?? null,
                          // capture the board column title → email header
                          noteColumnTitle: opt?.label ?? '',
                        })
                      }
                      clearable
                    />
                    <div className="dc-hint">
                      כשבוחרים עמודה, כל שורה במקבץ מקבלת שדה טקסט במייל — <b>אי אפשר לסמן משימה
                      בלי למלא אותו</b>, וכפתור האישור נשאר מנוטרל עד שכל השורות שסומנו מולאו.
                      הערך נכתב לעמודה הזו ודורס את מה שהיה בה. ריק = אין שדה ואין חובה.
                    </div>
                  </div>
                </div>
                <div className="dc-row">
                  <div className="dc-field" style={{ minWidth: 320, flex: 1 }}>
                    <label>הצג רק משימות שהסטטוס שלהן (בעמודת הכפתור הראשון):</label>
                    <Dropdown
                      multi
                      multiline
                      placeholder={
                        !primaryButtonId ? 'בחרו קודם כפתור פעולה' : 'בחרו סטטוסים שנכנסים למקבץ'
                      }
                      disabled={!primaryButtonId}
                      options={statusOptions}
                      value={selectedStatus}
                      onChange={(opts: Option[] | null) =>
                        patchSection(section.id, {
                          includeStatusLabelIds: (opts ?? []).map((o) => Number(o.value)),
                        })
                      }
                      clearable={false}
                    />
                    <div className="dc-hint">
                      רק משימות בסטטוסים שנבחרו יופיעו במקבץ — כך משימות שכבר טופלו (למשל "בוצע") לא ייכנסו.
                      הכפתור הראשון קובע את עמודת הסטטוס לסינון; כל הכפתורים שנבחרו מופיעים בתפריט הנפתח במייל.
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {digest.sections.length < 4 && (
            <div>
              <Button
                kind={Button.kinds.SECONDARY}
                onClick={() => onChange({ sections: [...digest.sections, newDigestSection()] })}
              >
                + מקבץ נוסף
              </Button>
            </div>
          )}
        </section>
      )}

      <section className="dc-section">
        <h2>תצוגה מקדימה ושליחה</h2>
        {dirty && (
          <div className="dc-hint">
            יש שינויים שלא נשמרו — התצוגה המקדימה והשליחה משקפות את ההגדרות השמורות בלבד.
          </div>
        )}
        <div className="dc-row">
          <Button
            kind={Button.kinds.SECONDARY}
            loading={previewLoading}
            onClick={() => void loadPreview(null)}
          >
            תצוגה מקדימה
          </Button>
          {sendPhase !== 'confirm' ? (
            <Button
              onClick={() => setSendPhase('confirm')}
              loading={sendPhase === 'sending'}
              disabled={sendPhase === 'sending'}
            >
              שליחה עכשיו
            </Button>
          ) : (
            <>
              <Button color={Button.colors.NEGATIVE} onClick={() => void doSend()}>
                לאשר שליחה אמיתית לכל הנמענים
              </Button>
              <Button kind={Button.kinds.TERTIARY} onClick={() => setSendPhase('idle')}>
                ביטול
              </Button>
            </>
          )}
        </div>
        {previewError && <div className="dc-error">{previewError}</div>}
        {sendError && <div className="dc-error">{sendError}</div>}

        {sendResult && (
          <div className="dc-field">
            <label>{sendResult.ok ? 'נשלח בהצלחה ✓' : 'השליחה הסתיימה עם שגיאות'}</label>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {sendResult.results.map((r) => (
                <li key={r.email} className={r.ok ? 'dc-success' : 'dc-error'}>
                  {r.name} ({r.email}) — {r.ok ? `נשלחו ${r.taskCount} משימות ✓` : `נכשל: ${r.error ?? ''}`}
                </li>
              ))}
              {sendResult.results.length === 0 && <li className="dc-hint">אין נמענים עם משימות ממתינות — לא נשלח דבר.</li>}
            </ul>
            {sendResult.skippedUsers.length > 0 && (
              <div className="dc-hint">
                דולגו {sendResult.skippedUsers.length} שורות בלוח המשתמשים (חסר אימייל או איש):{' '}
                {sendResult.skippedUsers.map((s) => s.name).join(', ')}
              </div>
            )}
          </div>
        )}

        {preview && (
          <div className="dc-field">
            <label>
              נמענים ({preview.recipients.length})
              {preview.truncated && ' · אזהרה: הלוח גדול מהמכסה — חלק מהאייטמים לא נסרקו'}
            </label>
            {preview.recipients.length === 0 ? (
              <div className="dc-hint">אין כרגע משימות ממתינות לאף משתמש.</div>
            ) : (
              <>
                <div className="dc-row">
                  <Dropdown
                    placeholder="בחרו נמען לתצוגה"
                    options={preview.recipients.map((r) => toOption(r.email, `${r.name} — ${r.taskCount} משימות`))}
                    value={
                      previewRecipient
                        ? toOption(
                            previewRecipient,
                            preview.recipients.find((r) => r.email === previewRecipient)?.name ?? previewRecipient
                          )
                        : null
                    }
                    onChange={(opt: Option | null) => {
                      if (opt) void loadPreview(opt.value);
                    }}
                    clearable={false}
                  />
                </div>
                {preview.plain && (
                  <div style={{ marginTop: 10 }}>
                    <label>גרסת טקסט (text/plain)</label>
                    <pre
                      dir="rtl"
                      style={{
                        whiteSpace: 'pre-wrap',
                        background: 'var(--ui-background-color, #f6f7fb)',
                        padding: 12,
                        borderRadius: 8,
                        border: '1px solid var(--ui-border-color, #d0d4e4)',
                        maxHeight: 240,
                        overflow: 'auto',
                        fontSize: 13,
                      }}
                    >
                      {preview.plain}
                    </pre>
                    <Button kind="secondary" size="small" onClick={() => void copyPlain(preview.plain as string)}>
                      {plainCopied ? 'הועתק ✓' : 'העתק גרסת טקסט'}
                    </Button>
                  </div>
                )}
                {preview.amp && (
                  <div style={{ marginTop: 10 }}>
                    <label>קוד ה-AMP המלא שנבנה — ניתן לעריכה ולשליחה</label>
                    <div className="dc-hint">
                      זה בדיוק המסמך שנשלח כחלק <code>text/x-amp-html</code>. אפשר לערוך אותו כאן
                      ולשלוח את הבתים שנערכו כמו שהם בערוץ השליחה (SMTP) — בלי רינדור מחדש —
                      כדי לבודד מה בדיוק ג׳ימייל דוחה.
                    </div>
                    <textarea
                      dir="ltr"
                      spellCheck={false}
                      value={ampDraft}
                      onChange={(e) => setAmpDraft(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: 320,
                        marginTop: 8,
                        padding: 12,
                        borderRadius: 8,
                        border: '1px solid var(--ui-border-color, #d0d4e4)',
                        background: 'var(--ui-background-color, #f6f7fb)',
                        fontFamily: 'Menlo, Consolas, monospace',
                        fontSize: 12,
                        lineHeight: 1.5,
                        whiteSpace: 'pre',
                        resize: 'vertical',
                      }}
                    />
                    <div className="dc-hint">
                      {ampByteLength(ampDraft).toLocaleString('en-US')} bytes
                      {ampDraft !== preview.amp && ' · נערך (שונה מהמקור)'}
                    </div>
                    {ampSizeWarning(ampDraft) && <div className="dc-error">{ampSizeWarning(ampDraft)}</div>}

                    <div className="dc-row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
                      <div className="dc-field" style={{ minWidth: 240 }}>
                        <label>נמען לבדיקה</label>
                        <TextField value={ampTo} placeholder="you@example.com" onChange={setAmpTo} />
                      </div>
                      <div className="dc-field" style={{ minWidth: 240 }}>
                        <label>נושא</label>
                        <TextField value={ampSubject} placeholder="נושא" onChange={setAmpSubject} />
                      </div>
                      <Button
                        kind={Button.kinds.PRIMARY}
                        size="small"
                        loading={rawSending}
                        disabled={rawSending}
                        onClick={() => void sendRawAmp()}
                      >
                        שליחת הקוד הערוך
                      </Button>
                      <Button
                        kind="secondary"
                        size="small"
                        disabled={ampDraft === preview.amp}
                        onClick={() => {
                          setAmpDraft(preview.amp as string);
                          setRawError(null);
                          setRawResult(null);
                        }}
                      >
                        שחזור לקוד המקורי
                      </Button>
                      <Button kind="secondary" size="small" onClick={() => void copyAmp(ampDraft)}>
                        {ampCopied ? 'הועתק ✓' : 'העתקה'}
                      </Button>
                    </div>

                    {rawError && (
                      <pre dir="ltr" className="dc-error" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                        {rawError}
                      </pre>
                    )}
                    {rawResult && (
                      <div className="dc-success">
                        נשלח ✓ — {rawResult.to} · {rawResult.ampBytes.toLocaleString('en-US')} bytes ·
                        Gmail message id: <code>{rawResult.id ?? '—'}</code>
                      </div>
                    )}

                    <div className="dc-hint">
                      השליחה יוצאת מתיבת ה-Gmail המחוברת של הארגון ובאותו מבנה MIME של המייל האמיתי
                      (plain → x-amp-html → html). לצפייה בחלק הדינמי הנמען צריך להוסיף את כתובת
                      השולח תחת Dynamic email → Developer settings. אפשר גם להדביק את הקוד
                      ב-playground.amp.dev (פורמט Email); שליחה משם דורשת ש־
                      <code>AMP_ALLOWED_SENDERS</code> יכלול את <code>amp@gmail.dev</code>.
                    </div>
                  </div>
                )}
              </>
            )}
            {preview.skippedUsers.length > 0 && (
              <div className="dc-hint">
                דולגו {preview.skippedUsers.length} שורות בלוח המשתמשים:{' '}
                {preview.skippedUsers
                  .map((s) => {
                    const reason =
                      s.reason === 'no_email'
                        ? 'חסר אימייל'
                        : s.reason === 'no_person'
                          ? 'חסר איש'
                          : s.reason === 'multi_person'
                            ? 'יותר מאיש אחד'
                            : s.reason;
                    return `${s.name} (${reason})`;
                  })
                  .join(', ')}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}

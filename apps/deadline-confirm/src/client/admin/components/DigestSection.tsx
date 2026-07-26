// v4 — the "מייל מסכם" (digest) tab: users-board mapping, section rules,
// preview against the SAVED config, and the phase-1 manual send. Nothing here
// touches the existing tabs' behavior.

import { useEffect, useState } from 'react';
import { Button, Dropdown, TextField, Toggle } from '@vibe/core';
import type { ActionButton, BoardColumn, Board, DigestPreviewResponse, DigestSendResponse } from '../types';
import type { DigestDraft, DigestSectionDraft } from '../draft';
import { newDigestSection } from '../draft';
import { apiFetch, ApiError } from '../services/api';
import { fetchBoardColumns } from '../services/monday';
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
  email_not_configured: 'ערוץ השליחה לא מוגדר בשרת (RESEND_API_KEY / DIGEST_FROM חסרים בסביבת האפליקציה).',
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

  const [sendPhase, setSendPhase] = useState<'idle' | 'confirm' | 'sending'>('idle');
  const [sendResult, setSendResult] = useState<DigestSendResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

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
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('admin', 'digest_users_columns_load_failed', err);
        setUsersColumnsError('טעינת עמודות לוח המשתמשים נכשלה. נסו לרענן.');
      })
      .finally(() => {
        if (!cancelled) setUsersColumnsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [digest.usersBoardId]);

  const boardOptions = boards.map((b) => toOption(b.id, b.name));
  const peopleOptions = usersColumns.filter((c) => c.type === 'people').map((c) => toOption(c.id, c.title));
  const emailOptions = usersColumns.filter((c) => c.type === 'email').map((c) => toOption(c.id, c.title));
  const dateOptions = tasksColumns.filter((c) => c.type === 'date').map((c) => toOption(c.id, c.title));
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
      setPreviewRecipient(recipient ?? res.recipients[0]?.email ?? null);
    } catch (err) {
      logger.error('admin', 'digest_preview_failed', err);
      setPreviewError(guardMessage(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  // V5: hand the amp4email part to the operator's clipboard (playground paste).
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
            </div>
          </>
        )}
      </section>

      {digest.enabled && (
        <section className="dc-section">
          <h2>מקבצי משימות</h2>
          <div className="dc-hint">
            כל מקבץ הוא טבלה במייל: עמודת תאריך שקובעת "באיחור" (תאריך שעבר — כולל היום),
            תנאי סטטוס שקובע אילו משימות נכנסות, והכפתור שמופיע ליד כל משימה.
          </div>
          {digest.sections.map((section) => {
            const statusOptions = statusLabelOptionsFor(section.buttonId);
            const selectedStatus = statusOptions.filter((o) =>
              section.includeStatusLabelIds.includes(Number(o.value))
            );
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
                  <div className="dc-field">
                    <label>כפתור פעולה</label>
                    <Dropdown
                      placeholder="בחרו כפתור"
                      options={buttonOptions}
                      value={findOption(buttonOptions, section.buttonId)}
                      onChange={(opt: Option | null) =>
                        // switching the button changes the status column → reset the condition
                        patchSection(section.id, { buttonId: opt?.value ?? null, includeStatusLabelIds: [] })
                      }
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
                  <div className="dc-field" style={{ minWidth: 320, flex: 1 }}>
                    <label>הצג רק משימות שהסטטוס שלהן (בעמודת הכפתור):</label>
                    <Dropdown
                      multi
                      multiline
                      placeholder={
                        !section.buttonId ? 'בחרו קודם כפתור פעולה' : 'בחרו סטטוסים שנכנסים למקבץ'
                      }
                      disabled={!section.buttonId}
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
                {preview.html && (
                  <iframe
                    title="תצוגה מקדימה של המייל"
                    srcDoc={preview.html}
                    sandbox=""
                    style={{ width: '100%', height: 480, border: '1px solid var(--ui-border-color, #d0d4e4)', borderRadius: 8, background: '#fff' }}
                  />
                )}
                {/* V5: the Gmail dynamic-email part. Copied out for the AMP
                    playground while the AMP sending path is still manual. */}
                {preview.amp && (
                  <div style={{ marginTop: 10 }}>
                    <Button kind="secondary" size="small" onClick={() => void copyAmp(preview.amp as string)}>
                      {ampCopied ? 'הועתק ✓' : 'העתק גרסת AMP (מייל דינמי בג׳ימייל)'}
                    </Button>
                    <div className="dc-hint">
                      הגרסה הזאת מציגה תיבות סימון בתוך ג׳ימייל. להדבקה ב-playground.amp.dev (פורמט Email) ומשם
                      Send to Gmail — הנמען צריך להוסיף את כתובת השולח תחת Dynamic email → Developer settings.
                    </div>
                  </div>
                )}
              </>
            )}
            {preview.skippedUsers.length > 0 && (
              <div className="dc-hint">
                דולגו {preview.skippedUsers.length} שורות בלוח המשתמשים:{' '}
                {preview.skippedUsers.map((s) => `${s.name} (${s.reason === 'no_email' ? 'חסר אימייל' : 'חסר איש'})`).join(', ')}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}

// The "מייל מסכם" (digest) tab: users-board mapping, the subject block, the
// BODY BLOCK EDITOR (DigestBlocksSection — 0.14.0), preview against the SAVED
// config, and the manual send + AMP debug lane.
//
// 0.14.0 moved the cluster settings into the block list, so this file no longer
// owns them: what is left here is the delivery configuration (who gets the mail,
// when) plus the subject — which is itself a block, pinned first, because it is
// the one piece of text that is not part of the body.

import { useRef, useEffect, useState } from 'react';
import { Button, Dropdown, TextField, Toggle } from '@vibe/core';
import type {
  ActionButton,
  BoardColumn,
  Board,
  DigestPreviewResponse,
  DigestRawSendResponse,
  DigestSendResponse,
} from '../types';
import type { DigestDraft } from '../draft';
import { apiFetch, ApiError, formatApiFailure } from '../services/api';
import { fetchBoardColumns } from '../services/monday';
import { ampByteLength, ampSizeWarning, defaultDebugSubject, validateRawSend } from '../amp-debug';
import { NAME_TOKEN, applyTokens, insertAt } from '../digest-blocks';
import { DigestBlocksSection } from './DigestBlocksSection';
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
      // Show the subject the send path would produce for THIS recipient — the
      // token is resolved per recipient, so an unresolved {{שם}} in the debug
      // field would be a different message from the real one.
      const shownName = res.recipients.find((r) => r.email === shown)?.name ?? '';
      setAmpSubject(defaultDebugSubject(applyTokens(digest.subject, { name: shownName })));
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
        <SubjectBlock subject={digest.subject} onChange={(subject) => onChange({ subject })} />
      )}

      {digest.enabled && (
        <DigestBlocksSection
          tasksColumns={tasksColumns}
          tasksColumnsLoading={tasksColumnsLoading}
          buttons={buttons}
          digest={digest}
          onChange={onChange}
        />
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

/**
 * The SUBJECT BLOCK — pinned first and not part of the body list, because it is
 * the one authored string that is not rendered inside the email. It takes the
 * same dynamic field, inserted at the caret, which is why this is a native input
 * and not a Vibe TextField (the caret position is the feature).
 */
function SubjectBlock({
  subject,
  onChange,
}: {
  subject: string;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  const insertToken = () => {
    const el = ref.current;
    const start = el?.selectionStart ?? subject.length;
    const end = el?.selectionEnd ?? start;
    const { text, caret } = insertAt(subject, start, end);
    onChange(text);
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  return (
    <section className="dc-section">
      <h2>בלוק נושא המייל</h2>
      <div className="dc-hint">
        השורה שהנמען רואה בתיבת הדואר. אפשר לשבץ בה את השדה הדינמי <code>{NAME_TOKEN}</code> —
        למשל <span dir="rtl">"המשימות של {NAME_TOKEN} להיום"</span>. עד 120 תווים.
      </div>
      <div className="dc-row" style={{ alignItems: 'center' }}>
        <div className="dc-field" style={{ minWidth: 360, flex: 1 }}>
          <label>נושא</label>
          <input
            ref={ref}
            className="dc-input"
            dir="rtl"
            type="text"
            maxLength={120}
            value={subject}
            placeholder="נושא המייל"
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        <Button size="xs" kind="secondary" onClick={insertToken}>
          + הוסף שם משתמש
        </Button>
        <span className={subject.trim().length === 0 ? 'dc-error' : 'dc-hint'}>
          {subject.length}/120
          {subject.trim().length === 0 && ' · נושא ריק — לא ניתן לשמור'}
        </span>
      </div>
    </section>
  );
}

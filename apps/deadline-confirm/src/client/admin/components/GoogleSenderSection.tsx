// T9b — the Gmail sending mailbox for THIS tenant.
//
// Each organization connects a mailbox in its own Workspace under its own OAuth
// client (owner decision 2026-07-29). That is what keeps DKIM aligned with the
// From domain, which Gmail requires before it will render the AMP part at all —
// so this section is a precondition for the whole product, not a nicety.
//
// Three states are deliberately distinguished, because they have three
// different fixes: the SERVER has no OAuth client (platform env), nobody has
// connected yet (click connect), and the grant died (reconnect).

import { Button } from '@vibe/core';
import type { AppState } from '../types';
import { openGoogleOauthTab } from '../services/monday';

interface Props {
  google: AppState['google'];
  onRefresh: () => void;
  refreshing: boolean;
}

export function GoogleSenderSection({ google, onRefresh, refreshing }: Props) {
  return (
    <section className="dc-section">
      <h2>שליחת מייל (Gmail)</h2>

      {!google.configured && (
        <div className="dc-error">
          לא הוגדרו credentials של Google בסביבת האפליקציה. יש להגדיר
          {' '}<code>GOOGLE_OAUTH_CLIENT_ID</code> ו-<code>GOOGLE_OAUTH_CLIENT_SECRET</code>{' '}
          בסביבת monday code. עד אז לא ניתן לחבר תיבה ולא ניתן לשלוח.
        </div>
      )}

      {google.configured && google.status === 'disconnected' && (
        <>
          <div className="dc-row">
            <span>לא חוברה תיבת שליחה. המייל היומי לא יישלח עד שתחובר.</span>
          </div>
          <div className="dc-row">
            <Button onClick={openGoogleOauthTab}>חבר תיבת Gmail</Button>
          </div>
        </>
      )}

      {google.configured && google.status === 'connected' && (
        <div className="dc-row">
          <span>שולח כ: {google.senderAddress ?? '—'}</span>
          <Button size="small" kind="secondary" onClick={openGoogleOauthTab}>
            חבר מחדש
          </Button>
        </div>
      )}

      {google.configured && google.status === 'broken' && (
        <>
          <div className="dc-error">
            ההרשאה של תיבת השליחה בוטלה או פגה. השליחה מושבתת עד חיבור מחדש.
            {google.grantedScope !== null && (
              <>
                <br />
                ההרשאה שגוגל העניקה בפועל:{' '}
                <code dir="ltr">{google.grantedScope || '(ריק)'}</code> — שליחת SMTP דורשת
                גם <code dir="ltr">https://mail.google.com/</code>. אם היא חסרה כאן, ה-scope
                לא נשמר במסך ההסכמה ב-Google Cloud Console (Data Access → Save) לפני החיבור.
              </>
            )}
          </div>
          <div className="dc-row">
            <Button onClick={openGoogleOauthTab}>חבר מחדש</Button>
          </div>
        </>
      )}

      {/* A connected sender that is not on AMP_ALLOWED_SENDERS produces mail
          that LOOKS fine and whose every button fails with 403. Say so here
          rather than let it be diagnosed from the recipient's inbox. */}
      {google.senderAllowedForAmp === false && (
        <div className="dc-warning">
          ⚠ כתובת השולח אינה ברשימת <code>AMP_ALLOWED_SENDERS</code>. המייל יישלח, אך כל
          לחיצה על כפתור בתוכו תידחה. יש להוסיף את {google.senderAddress} לרשימה בסביבת
          האפליקציה.
        </div>
      )}

      <div className="dc-row">
        <Button size="small" kind="tertiary" onClick={onRefresh} loading={refreshing}>
          רענון סטטוס
        </Button>
      </div>
    </section>
  );
}

// §10.1 — OAuth connection status + the low-privilege-user warning (locked
// decision §3.5: the stored token's permission scope is the blast radius).

import { Button } from '@vibe/core';
import type { AppState } from '../types';
import { openOauthTab } from '../services/monday';

const WARNING_TEXT =
  '⚠ יש לבצע את החיבור כשמחוברים כמשתמש עם הרשאת עריכה ללוח היעד בלבד — לא כאדמין. הטוקן שנשמר קובע את היקף הנזק האפשרי.';

interface Props {
  oauth: AppState['oauth'];
  onRefresh: () => void;
  refreshing: boolean;
}

export function ConnectionSection({ oauth, onRefresh, refreshing }: Props) {
  return (
    <section className="dc-section">
      <h2>חיבור</h2>
      {oauth.status === 'connected' && (
        <div className="dc-row">
          <span>מחובר כ: {oauth.name ?? '—'}</span>
          <Button size="small" kind="secondary" onClick={openOauthTab}>
            נתק/חבר מחדש
          </Button>
        </div>
      )}
      {oauth.status === 'disconnected' && (
        <div className="dc-row">
          <Button onClick={openOauthTab}>התחבר ל-monday</Button>
        </div>
      )}
      {oauth.status === 'broken' && (
        <>
          <div className="dc-error">
            החיבור ל-monday נשבר (ייתכן שהטוקן בוטל או שהמשתמש הוסר). יש להתחבר מחדש.
          </div>
          <div className="dc-row">
            <Button onClick={openOauthTab}>התחבר מחדש ל-monday</Button>
          </div>
        </>
      )}
      <div className="dc-row">
        <Button size="small" kind="tertiary" onClick={onRefresh} loading={refreshing}>
          רענון סטטוס
        </Button>
      </div>
      <div className="dc-warning">{WARNING_TEXT}</div>
    </section>
  );
}

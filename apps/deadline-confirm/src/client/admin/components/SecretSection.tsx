// §10.3 — masked secret + rotation behind an inline confirm (rotation kills
// every link already sent by email — locked decision §3.3: manual,
// event-driven rotation only).

import { useState } from 'react';
import { Button } from '@vibe/core';

const CONFIRM_TEXT =
  'החלפת המפתח תנתק את כל הקישורים שכבר נשלחו במייל — בכל הכפתורים ובכל התבניות. אחרי ההחלפה יש להעתיק מחדש את ה-HTML לתבניות ה-workflow. להמשיך?';

interface Props {
  maskedSecret: string | null;
  rotatedSecret: string | null; // full secret, shown exactly once after rotate
  rotating: boolean;
  onRotate: () => void;
}

export function SecretSection({ maskedSecret, rotatedSecret, rotating, onRotate }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyRotated = async () => {
    if (!rotatedSecret) return;
    try {
      await navigator.clipboard.writeText(rotatedSecret);
      setCopied(true);
    } catch (err) {
      console.error('clipboard copy failed', err);
      setCopied(false);
    }
  };

  return (
    <section className="dc-section">
      <h2>מפתח קישור (Secret)</h2>
      <div className="dc-row">
        <span className="dc-secret-once">{maskedSecret ?? 'עדיין לא נוצר מפתח'}</span>
      </div>
      {rotatedSecret && (
        <>
          <div className="dc-success">
            המפתח החדש (מוצג פעם אחת בלבד — העתיקו מחדש את קוד הכפתורים/התבניות):
          </div>
          <div className="dc-row">
            <span className="dc-secret-once">{rotatedSecret}</span>
            <Button size="small" kind="secondary" onClick={copyRotated}>
              {copied ? 'הועתק ✓' : 'העתק'}
            </Button>
          </div>
        </>
      )}
      {confirming ? (
        <>
          <div className="dc-warning">{CONFIRM_TEXT}</div>
          <div className="dc-row">
            <Button
              size="small"
              color="negative"
              loading={rotating}
              onClick={() => {
                setConfirming(false);
                setCopied(false);
                onRotate();
              }}
            >
              כן, צור מפתח חדש
            </Button>
            <Button size="small" kind="tertiary" onClick={() => setConfirming(false)}>
              ביטול
            </Button>
          </div>
        </>
      ) : (
        <div className="dc-row">
          <Button size="small" kind="secondary" onClick={() => setConfirming(true)}>
            צור מפתח חדש
          </Button>
        </div>
      )}
    </section>
  );
}

// §10.3 — masked secret + rotation behind an inline confirm (rotation kills
// every outstanding signature — manual, event-driven rotation only).

import { useState } from 'react';
import { Button } from '@vibe/core';

const CONFIRM_TEXT =
  'החלפת המפתח תבטל את כל החתימות שכבר נשלחו במייל — כל הנמענים יצטרכו לקבל מייל חדש. להמשיך?';

interface Props {
  maskedSecret: string | null;
  rotateSuccess: boolean;
  rotating: boolean;
  onRotate: () => void;
}

export function SecretSection({ maskedSecret, rotateSuccess, rotating, onRotate }: Props) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="dc-section">
      <h2>מפתח קישור (Secret)</h2>
      <div className="dc-row">
        <span className="dc-secret-once">{maskedSecret ?? 'עדיין לא נוצר מפתח'}</span>
      </div>
      {rotateSuccess && (
        <div className="dc-success">
          המפתח הוחלף בהצלחה — כל החתימות הקודמות בוטלו. מיילים חדשים יישלחו עם חתימות מעודכנות.
        </div>
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

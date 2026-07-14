// §10.4 — the server-rendered email-button snippet (read-only), copy button,
// and the workflow mapping instruction.

import { useState } from 'react';
import { Button } from '@vibe/core';

const INSTRUCTION_TEXT =
  'יש למפות את מזהה האייטם מה-workflow במקום {ITEM_ID}. אל תשנו את הפרמטר k.';
const AMP_NOTE =
  'אם עורך התבניות של ה-workflow מציג את &amp; כטקסט — החליפו אותו ב-& רגיל.';

interface Props {
  snippet: string | null; // null until a secret exists
}

export function SnippetSection({ snippet }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
    } catch (err) {
      console.error('clipboard copy failed', err);
      setCopied(false);
    }
  };

  return (
    <section className="dc-section">
      <h2>קוד לכפתור</h2>
      {snippet ? (
        <>
          <textarea className="dc-snippet" readOnly value={snippet} />
          <div className="dc-row">
            <Button size="small" kind="secondary" onClick={copy}>
              {copied ? 'הועתק ✓' : 'העתק'}
            </Button>
          </div>
          <div className="dc-hint">{INSTRUCTION_TEXT}</div>
          <div className="dc-hint">{AMP_NOTE}</div>
        </>
      ) : (
        <div className="dc-hint">צרו מפתח קישור כדי לקבל את קוד הכפתור.</div>
      )}
    </section>
  );
}

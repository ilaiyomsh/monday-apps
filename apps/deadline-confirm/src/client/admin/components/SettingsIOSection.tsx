// Export / import the whole configuration as JSON.
//
// Added 2026-07-27 at the owner's request, after a save kept failing with an
// opaque 400 and diagnosing it required reading SecureStorage indirectly. The
// export deliberately carries BOTH the stored config and the on-screen draft:
// when a save is rejected, the difference between the two IS the diagnosis.
//
// The file contains configuration only — no link secret, no OAuth token; those
// never reach the client. Import loads into the draft and does NOT save, so the
// operator reviews and presses שמירה themselves.

import { useRef, useState } from 'react';
import { Button } from '@vibe/core';
import type { ConfigDraft } from '../draft';
import type { AppConfig } from '../types';
import { buildSettingsExport, parseSettingsImport } from '../settings-io';
import logger from '../utils/logger';

interface Props {
  savedConfig: AppConfig | null;
  draft: ConfigDraft;
  appVersion: string;
  onImport: (draft: ConfigDraft) => void;
}

export function SettingsIOSection({ savedConfig, draft, appVersion, onImport }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const onExport = (): void => {
    try {
      const envelope = buildSettingsExport({
        savedConfig,
        draft,
        appVersion,
        now: new Date().toISOString(),
      });
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `status-email-settings-${envelope.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ kind: 'ok', text: 'הקובץ יוצא.' });
    } catch (err) {
      logger.error('admin', 'settings_export_failed', err);
      setMessage({ kind: 'error', text: 'הייצוא נכשל.' });
    }
  };

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const result = parseSettingsImport(await file.text());
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.error });
        return;
      }
      onImport(result.draft);
      setMessage({ kind: 'ok', text: 'ההגדרות נטענו למסך. בדקו אותן ולחצו שמירה.' });
    } catch (err) {
      logger.error('admin', 'settings_import_failed', err);
      setMessage({ kind: 'error', text: 'קריאת הקובץ נכשלה.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="dc-section">
      <h2 className="dc-section-title">ייצוא וייבוא הגדרות</h2>
      <p className="dc-section-hint">
        קובץ JSON עם ההגדרות השמורות וגם עם מה שמוצג כרגע במסך — שימושי לאבחון כשהשמירה נכשלת. הקובץ אינו מכיל את
        מפתח הקישורים ואינו מכיל טוקנים. ייבוא טוען את ההגדרות למסך בלבד; השמירה נשארת בידיכם.
      </p>
      <div className="dc-row">
        <Button kind="secondary" onClick={onExport}>
          ייצוא הגדרות (JSON)
        </Button>
        <Button kind="secondary" onClick={() => fileRef.current?.click()}>
          ייבוא הגדרות
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
          }}
        />
      </div>
      {message && <div className={message.kind === 'ok' ? 'dc-note' : 'dc-error'}>{message.text}</div>}
    </section>
  );
}

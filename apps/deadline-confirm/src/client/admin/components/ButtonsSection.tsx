// v2 — dynamic action buttons manager: per-button status column + target
// label + style (color/icon/size), live preview, per-button email snippet copy.

import { useState } from 'react';
import { Button, Dropdown, TextField } from '@vibe/core';
import type { ActionButton, BoardColumn, ButtonSize } from '../types';
import { BUTTON_COLOR_PRESETS, BUTTON_ICON_PRESETS } from '../types';
import { newButton } from '../draft';
import { ButtonPreview } from './ButtonPreview';
import { apiFetch, ApiError } from '../services/api';
import logger from '../utils/logger';

interface Option {
  value: string;
  label: string;
}

interface Props {
  columns: BoardColumn[];
  columnsLoading: boolean;
  buttons: ActionButton[];
  dirty: boolean; // unsaved draft changes — server snippet would be stale
  onChange: (buttons: ActionButton[]) => void;
}

const SIZE_OPTIONS: Array<{ value: ButtonSize; label: string }> = [
  { value: 'sm', label: 'קטן' },
  { value: 'md', label: 'בינוני' },
  { value: 'lg', label: 'גדול' },
];

export function ButtonsSection({ columns, columnsLoading, buttons, dirty, onChange }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const statusColumns = columns.filter((c) => c.type === 'status');
  const statusOptions = statusColumns.map((c) => ({ value: c.id, label: c.title }));

  const patchButton = (id: string, patch: Partial<ActionButton>) => {
    onChange(buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const copySnippet = async (id: string) => {
    setCopyError(null);
    try {
      const res = await apiFetch<{ snippet: string }>(`/api/snippet?btn=${encodeURIComponent(id)}`);
      await navigator.clipboard.writeText(res.snippet);
      setCopiedId(id);
    } catch (err) {
      logger.error('admin', 'snippet_copy_failed', err);
      setCopyError(
        err instanceof ApiError && err.status === 409
          ? 'צרו מפתח קישור לפני העתקת קוד'
          : 'העתקת הקוד נכשלה — ודאו שההגדרות נשמרו'
      );
    }
  };

  return (
    <section className="dc-section">
      <h2>כפתורי פעולה</h2>
      <div className="dc-hint">
        כל כפתור מקבל קוד זיהוי משלו וקובע עמודת סטטוס ולייבל יעד. הקליק במייל מעביר את
        המשימה ללייבל היעד — ללא תלות בסטטוס הנוכחי.
      </div>
      {buttons.map((button) => {
        const column = statusColumns.find((c) => c.id === button.statusColumnId) ?? null;
        const labelOptions = (column?.labels ?? []).map((l) => ({
          value: String(l.id),
          label: l.label,
        }));
        return (
          <div key={button.id} className="dc-card">
            <div className="dc-row">
              <div className="dc-field">
                <label>שם הכפתור (הטקסט במייל)</label>
                <TextField
                  value={button.name}
                  placeholder="למשל: בוצע"
                  onChange={(value: string) => patchButton(button.id, { name: value })}
                />
              </div>
              <div className="dc-field">
                <label>עמודת סטטוס</label>
                <Dropdown
                  placeholder={columnsLoading ? 'טוען…' : 'בחרו עמודה'}
                  options={statusOptions}
                  value={statusOptions.find((o) => o.value === button.statusColumnId) ?? null}
                  onChange={(opt: Option | null) =>
                    patchButton(button.id, {
                      statusColumnId: opt?.value ?? '',
                      targetIndex: -1,
                      targetLabel: '',
                    })
                  }
                  clearable={false}
                />
              </div>
              <div className="dc-field">
                <label>לייבל יעד</label>
                <Dropdown
                  placeholder="בחרו סטטוס"
                  disabled={!column}
                  options={labelOptions}
                  value={
                    button.targetIndex >= 0
                      ? labelOptions.find((o) => o.value === String(button.targetIndex)) ?? null
                      : null
                  }
                  onChange={(opt: Option | null) =>
                    patchButton(button.id, {
                      targetIndex: opt ? Number(opt.value) : -1,
                      targetLabel: opt?.label ?? '',
                    })
                  }
                  clearable={false}
                />
              </div>
            </div>
            <div className="dc-row">
              <div className="dc-field" style={{ maxWidth: 220 }}>
                <label>צבע</label>
                <div className="dc-row" style={{ gap: 6, alignItems: 'center' }}>
                  {BUTTON_COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`צבע ${color}`}
                      onClick={() => patchButton(button.id, { style: { ...button.style, color } })}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        border:
                          button.style.color === color ? '2px solid #323338' : '1px solid #d0d4e4',
                        backgroundColor: color,
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={button.style.color}
                    onChange={(e) =>
                      patchButton(button.id, { style: { ...button.style, color: e.target.value } })
                    }
                    style={{ width: 28, height: 26, border: 'none', background: 'none', cursor: 'pointer' }}
                    aria-label="צבע חופשי"
                  />
                </div>
              </div>
              <div className="dc-field" style={{ maxWidth: 200 }}>
                <label>אייקון</label>
                <div className="dc-row" style={{ gap: 6, alignItems: 'center' }}>
                  {BUTTON_ICON_PRESETS.map((icon) => (
                    <button
                      key={icon || 'none'}
                      type="button"
                      onClick={() => patchButton(button.id, { style: { ...button.style, icon } })}
                      style={{
                        minWidth: 26,
                        height: 26,
                        borderRadius: 6,
                        border:
                          button.style.icon === icon ? '2px solid #323338' : '1px solid #d0d4e4',
                        background: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {icon || '—'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="dc-field" style={{ maxWidth: 140 }}>
                <label>גודל</label>
                <Dropdown
                  options={SIZE_OPTIONS}
                  value={SIZE_OPTIONS.find((o) => o.value === button.style.size) ?? SIZE_OPTIONS[1]}
                  onChange={(opt: { value: ButtonSize } | null) =>
                    patchButton(button.id, {
                      style: { ...button.style, size: opt?.value ?? 'md' },
                    })
                  }
                  clearable={false}
                />
              </div>
            </div>
            <div className="dc-row" style={{ alignItems: 'center' }}>
              <span className="dc-hint">תצוגה מקדימה:</span>
              <ButtonPreview button={button} />
            </div>
            <div className="dc-row">
              <Button
                size="small"
                kind="secondary"
                disabled={dirty}
                onClick={() => copySnippet(button.id)}
              >
                {copiedId === button.id ? 'הועתק ✓' : 'העתק קוד כפתור בודד'}
              </Button>
              <Button
                size="small"
                kind="tertiary"
                color="negative"
                onClick={() => onChange(buttons.filter((b) => b.id !== button.id))}
              >
                מחק כפתור
              </Button>
              {dirty && <span className="dc-hint">שמרו את ההגדרות כדי להעתיק קוד עדכני</span>}
            </div>
          </div>
        );
      })}
      {copyError && <div className="dc-error">{copyError}</div>}
      <div className="dc-row">
        <Button
          size="small"
          onClick={() => {
            // newButton() calls crypto.getRandomValues — guard the event handler so a
            // throw here surfaces (log + toast) instead of escaping to the boundary.
            try {
              onChange([...buttons, newButton()]);
            } catch (err) {
              logger.error('admin', 'add_button_failed', err);
              setCopyError('הוספת כפתור נכשלה. נסו שוב.');
            }
          }}
        >
          + הוסף כפתור
        </Button>
      </div>
    </section>
  );
}

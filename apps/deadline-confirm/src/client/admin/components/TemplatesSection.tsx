// v2 — saved email templates: block editor (text blocks with direction/font/
// size/align + button rows) + client-side preview.
// V6: server-side HTML copy (/api/email-template) was deleted — templates are
// retained in config for backward compatibility but no longer ship actionable email.

import { useState } from 'react';
import { Button, Dropdown, TextField } from '@vibe/core';
import type {
  ActionButton,
  ButtonsBlock,
  Direction,
  EmailTemplate,
  TemplateBlock,
  TextAlign,
} from '../types';
import { EMAIL_FONTS } from '../types';
import { newButtonsBlock, newTemplate, newTextBlock } from '../draft';
import { ButtonPreview } from './ButtonPreview';
import logger from '../utils/logger';

interface Option {
  value: string;
  label: string;
}

interface Props {
  templates: EmailTemplate[];
  buttons: ActionButton[];
  onChange: (templates: EmailTemplate[]) => void;
}

const FONT_OPTIONS: Option[] = EMAIL_FONTS.map((f) => ({ value: f, label: f }));
const DIRECTION_OPTIONS: Array<{ value: Direction; label: string }> = [
  { value: 'rtl', label: 'ימין לשמאל' },
  { value: 'ltr', label: 'שמאל לימין' },
];
const ALIGN_OPTIONS: Array<{ value: TextAlign; label: string }> = [
  { value: 'right', label: 'ימין' },
  { value: 'center', label: 'מרכז' },
  { value: 'left', label: 'שמאל' },
];

function moveBlock(blocks: TemplateBlock[], index: number, delta: -1 | 1): TemplateBlock[] {
  const target = index + delta;
  if (target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function TemplatesSection({ templates, buttons, onChange }: Props) {
  // Surfaces the one fallible action left in this editor (see the add-template
  // guard below) — V6 removed the server HTML copy path and its error state.
  const [addError, setAddError] = useState<string | null>(null);

  const patchTemplate = (id: string, patch: Partial<EmailTemplate>) => {
    onChange(templates.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const patchBlock = (template: EmailTemplate, index: number, block: TemplateBlock) => {
    const blocks = template.blocks.map((b, i) => (i === index ? block : b));
    patchTemplate(template.id, { blocks });
  };

  return (
    <section className="dc-section">
      <h2>תבניות מייל (legacy)</h2>
      <div className="dc-hint">
        תבניות אלו נשמרות לתאימות לאחור. V6 שולח רק מייל AMP דינמי — אין עוד HTML להעתקה ל-workflow.
      </div>
      {templates.map((template) => (
        <div key={template.id} className="dc-card">
          <div className="dc-row">
            <div className="dc-field">
              <label>שם התבנית</label>
              <TextField
                value={template.name}
                placeholder='למשל: "מייל התחלה" או "תזכורת יומית"'
                onChange={(value: string) => patchTemplate(template.id, { name: value })}
              />
            </div>
          </div>

          {template.blocks.map((block, index) => (
            <div key={index} className="dc-block">
              <div className="dc-row" style={{ justifyContent: 'space-between' }}>
                <span className="dc-hint">
                  {block.type === 'text' ? `בלוק טקסט ${index + 1}` : `שורת כפתורים ${index + 1}`}
                </span>
                <span>
                  <Button
                    size="xs"
                    kind="tertiary"
                    disabled={index === 0}
                    onClick={() =>
                      patchTemplate(template.id, { blocks: moveBlock(template.blocks, index, -1) })
                    }
                  >
                    ▲
                  </Button>
                  <Button
                    size="xs"
                    kind="tertiary"
                    disabled={index === template.blocks.length - 1}
                    onClick={() =>
                      patchTemplate(template.id, { blocks: moveBlock(template.blocks, index, 1) })
                    }
                  >
                    ▼
                  </Button>
                  <Button
                    size="xs"
                    kind="tertiary"
                    color="negative"
                    onClick={() =>
                      patchTemplate(template.id, {
                        blocks: template.blocks.filter((_, i) => i !== index),
                      })
                    }
                  >
                    ✕
                  </Button>
                </span>
              </div>

              {block.type === 'text' ? (
                <>
                  <textarea
                    className="dc-textarea"
                    dir={block.direction}
                    style={{
                      fontFamily: `'${block.font}', sans-serif`,
                      fontSize: block.fontSize,
                      textAlign: block.align,
                    }}
                    value={block.text}
                    placeholder="כתבו כאן את תוכן המייל…"
                    onChange={(e) => patchBlock(template, index, { ...block, text: e.target.value })}
                  />
                  <div className="dc-row">
                    <div className="dc-field" style={{ maxWidth: 150 }}>
                      <label>כיוון</label>
                      <Dropdown
                        options={DIRECTION_OPTIONS}
                        value={DIRECTION_OPTIONS.find((o) => o.value === block.direction)}
                        onChange={(opt: { value: Direction } | null) =>
                          patchBlock(template, index, { ...block, direction: opt?.value ?? 'rtl' })
                        }
                        clearable={false}
                      />
                    </div>
                    <div className="dc-field" style={{ maxWidth: 190 }}>
                      <label>גופן</label>
                      <Dropdown
                        options={FONT_OPTIONS}
                        value={FONT_OPTIONS.find((o) => o.value === block.font)}
                        onChange={(opt: Option | null) =>
                          patchBlock(template, index, { ...block, font: opt?.value ?? 'Arial' })
                        }
                        clearable={false}
                      />
                    </div>
                    <div className="dc-field" style={{ maxWidth: 120 }}>
                      <label>גודל (10–32)</label>
                      <TextField
                        type="number"
                        value={String(block.fontSize)}
                        onChange={(value: string) => {
                          const parsed = Number(value);
                          patchBlock(template, index, {
                            ...block,
                            fontSize:
                              Number.isInteger(parsed) && parsed >= 10 && parsed <= 32
                                ? parsed
                                : block.fontSize,
                          });
                        }}
                      />
                    </div>
                    <div className="dc-field" style={{ maxWidth: 140 }}>
                      <label>יישור</label>
                      <Dropdown
                        options={ALIGN_OPTIONS}
                        value={ALIGN_OPTIONS.find((o) => o.value === block.align)}
                        onChange={(opt: { value: TextAlign } | null) =>
                          patchBlock(template, index, { ...block, align: opt?.value ?? 'right' })
                        }
                        clearable={false}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <ButtonsBlockEditor
                  block={block}
                  buttons={buttons}
                  onChange={(next) => patchBlock(template, index, next)}
                />
              )}
            </div>
          ))}

          <div className="dc-row">
            <Button
              size="small"
              kind="secondary"
              onClick={() =>
                patchTemplate(template.id, { blocks: [...template.blocks, newTextBlock()] })
              }
            >
              + בלוק טקסט
            </Button>
            <Button
              size="small"
              kind="secondary"
              disabled={buttons.length === 0}
              onClick={() =>
                patchTemplate(template.id, { blocks: [...template.blocks, newButtonsBlock()] })
              }
            >
              + שורת כפתורים
            </Button>
          </div>

          <TemplateClientPreview template={template} buttons={buttons} />

          <div className="dc-row">
            <Button
              size="small"
              kind="tertiary"
              color="negative"
              onClick={() => onChange(templates.filter((t) => t.id !== template.id))}
            >
              מחק תבנית
            </Button>
          </div>
        </div>
      ))}
      <div className="dc-row">
        <Button
          size="small"
          onClick={() => {
            // newTemplate() calls crypto.getRandomValues — guard the event handler.
            setAddError(null);
            try {
              onChange([...templates, newTemplate()]);
            } catch (err) {
              logger.error('admin', 'add_template_failed', err);
              setAddError('הוספת תבנית נכשלה. נסו שוב.');
            }
          }}
        >
          + הוסף תבנית
        </Button>
      </div>
      {addError && <div className="dc-error">{addError}</div>}
    </section>
  );
}

function ButtonsBlockEditor({
  block,
  buttons,
  onChange,
}: {
  block: ButtonsBlock;
  buttons: ActionButton[];
  onChange: (block: ButtonsBlock) => void;
}) {
  return (
    <div className="dc-row" style={{ alignItems: 'center' }}>
      {buttons.map((button) => {
        const selected = block.buttonIds.includes(button.id);
        return (
          <label key={button.id} className="dc-checkbox">
            <input
              type="checkbox"
              checked={selected}
              onChange={() =>
                onChange({
                  ...block,
                  buttonIds: selected
                    ? block.buttonIds.filter((id) => id !== button.id)
                    : [...block.buttonIds, button.id],
                })
              }
            />
            <ButtonPreview button={button} />
          </label>
        );
      })}
      {buttons.length === 0 && <span className="dc-hint">הגדירו כפתורים קודם</span>}
    </div>
  );
}

/** Client-side approximation of the rendered email (authoritative HTML is server-side). */
function TemplateClientPreview({
  template,
  buttons,
}: {
  template: EmailTemplate;
  buttons: ActionButton[];
}) {
  return (
    <div>
      <div className="dc-hint">תצוגה מקדימה:</div>
      <div className="dc-email-preview">
        {template.blocks.map((block, i) =>
          block.type === 'text' ? (
            <div
              key={i}
              dir={block.direction}
              style={{
                fontFamily: `'${block.font}', sans-serif`,
                fontSize: block.fontSize,
                textAlign: block.align,
                whiteSpace: 'pre-wrap',
                margin: '8px 0',
              }}
            >
              {block.text || '‏(בלוק טקסט ריק)'}
            </div>
          ) : (
            <div key={i} style={{ textAlign: 'center', margin: '12px 0', display: 'flex', gap: 8, justifyContent: 'center' }}>
              {block.buttonIds
                .map((id) => buttons.find((b) => b.id === id))
                .filter((b): b is ActionButton => Boolean(b))
                .map((b) => (
                  <ButtonPreview key={b.id} button={b} />
                ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

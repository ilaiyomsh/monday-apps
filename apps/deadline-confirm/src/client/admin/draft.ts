// v2 draft model — the config being edited. Buttons/templates get
// client-generated ids on creation (server re-validates and generates for
// any that arrive without one).

import type { ActionButton, AppConfig, EmailTemplate, TemplateBlock } from './types';

export interface ConfigDraft {
  boardId: string | null;
  peopleColumnId: string | null;
  buttons: ActionButton[];
  templates: EmailTemplate[];
}

function randomSlug(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function newButton(): ActionButton {
  return {
    id: `b_${randomSlug()}`,
    name: '',
    statusColumnId: '',
    targetIndex: -1, // "not picked yet" sentinel (server requires >= 0)
    targetLabel: '',
    style: { color: '#00854d', icon: '✓', size: 'md' },
  };
}

export function newTemplate(): EmailTemplate {
  return {
    id: `t_${randomSlug()}`,
    name: '',
    blocks: [
      { type: 'text', text: '', direction: 'rtl', font: 'Arial', fontSize: 16, align: 'right' },
    ],
  };
}

export function newTextBlock(): TemplateBlock {
  return { type: 'text', text: '', direction: 'rtl', font: 'Arial', fontSize: 16, align: 'right' };
}

export function newButtonsBlock(): TemplateBlock {
  return { type: 'buttons', buttonIds: [] };
}

export function draftFromConfig(config: AppConfig | null): ConfigDraft {
  return {
    boardId: config?.boardId ?? null,
    peopleColumnId: config?.peopleColumnId ?? null,
    buttons: config?.buttons ?? [],
    templates: config?.templates ?? [],
  };
}

export function buttonIsComplete(button: ActionButton): boolean {
  return (
    button.name.trim().length > 0 &&
    button.statusColumnId.length > 0 &&
    Number.isInteger(button.targetIndex) &&
    button.targetIndex >= 0 && // 0 is a valid label id; -1 = not picked
    button.targetLabel.length > 0
  );
}

export function templateIsComplete(template: EmailTemplate): boolean {
  if (template.name.trim().length === 0 || template.blocks.length === 0) return false;
  return template.blocks.every((block) =>
    block.type === 'text' ? block.text.trim().length > 0 : block.buttonIds.length > 0
  );
}

export function draftIsComplete(draft: ConfigDraft): boolean {
  return (
    draft.boardId !== null &&
    draft.buttons.length > 0 &&
    draft.buttons.every(buttonIsComplete) &&
    draft.templates.every(templateIsComplete)
  );
}

/** Resolve the draft into the PUT /api/config payload (null while incomplete). */
export function draftToConfig(draft: ConfigDraft): AppConfig | null {
  if (!draftIsComplete(draft)) return null;
  return {
    boardId: draft.boardId as string,
    peopleColumnId: draft.peopleColumnId,
    buttons: draft.buttons,
    templates: draft.templates,
  };
}

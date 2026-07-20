// v2 draft model — the config being edited. Buttons/templates get
// client-generated ids on creation (server re-validates and generates for
// any that arrive without one).

import type { ActionButton, AppConfig, DigestConfig, EmailTemplate, TemplateBlock } from './types';

export interface DigestSectionDraft {
  id: string;
  title: string;
  dateColumnId: string | null;
  dateColumnTitle: string; // captured when the date column is picked
  buttonId: string | null;
  includeStatusLabelIds: number[]; // task shown only if its status is one of these
}

export interface DigestDraft {
  enabled: boolean;
  usersBoardId: string | null;
  usersPeopleColumnId: string | null;
  usersEmailColumnId: string | null;
  subject: string;
  sections: DigestSectionDraft[];
}

export interface ConfigDraft {
  boardId: string | null;
  peopleColumnId: string | null;
  buttons: ActionButton[];
  templates: EmailTemplate[];
  digest: DigestDraft;
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

export function newDigestSection(title = ''): DigestSectionDraft {
  return {
    id: `s_${randomSlug()}`,
    title,
    dateColumnId: null,
    dateColumnTitle: '',
    buttonId: null,
    includeStatusLabelIds: [],
  };
}

export const DEFAULT_DIGEST_SUBJECT = 'המשימות שלך — נדרש עדכון סטטוס';

/** Fresh digest draft — disabled, default subject, the two mock sections. */
export function defaultDigestDraft(): DigestDraft {
  return {
    enabled: false,
    usersBoardId: null,
    usersPeopleColumnId: null,
    usersEmailColumnId: null,
    subject: DEFAULT_DIGEST_SUBJECT,
    sections: [
      newDigestSection('משימות שנדרש להתחיל וטרם התחילו:'),
      newDigestSection('משימות שנדרש לסיים וטרם בוצעו:'),
    ],
  };
}

export function digestFromConfig(digest: DigestConfig | null | undefined): DigestDraft {
  if (!digest) return defaultDigestDraft();
  return {
    enabled: true,
    usersBoardId: digest.usersBoardId,
    usersPeopleColumnId: digest.usersPeopleColumnId,
    usersEmailColumnId: digest.usersEmailColumnId,
    subject: digest.subject,
    sections: digest.sections.map((s) => ({ ...s, includeStatusLabelIds: [...s.includeStatusLabelIds] })),
  };
}

export function digestIsComplete(digest: DigestDraft): boolean {
  return (
    digest.usersBoardId !== null &&
    digest.usersPeopleColumnId !== null &&
    digest.usersEmailColumnId !== null &&
    digest.subject.trim().length > 0 &&
    digest.sections.length > 0 &&
    digest.sections.every(
      (s) =>
        s.title.trim().length > 0 &&
        s.dateColumnId !== null &&
        s.buttonId !== null &&
        // a status condition is mandatory — at least one included label
        s.includeStatusLabelIds.length > 0
    )
  );
}

/** Resolve the digest draft into the config payload piece (see draftToConfig). */
function digestToConfig(digest: DigestDraft): DigestConfig | null {
  if (!digest.enabled) return null;
  return {
    usersBoardId: digest.usersBoardId as string,
    usersPeopleColumnId: digest.usersPeopleColumnId as string,
    usersEmailColumnId: digest.usersEmailColumnId as string,
    subject: digest.subject,
    sections: digest.sections.map((s) => ({
      id: s.id,
      title: s.title,
      dateColumnId: s.dateColumnId as string,
      dateColumnTitle: s.dateColumnTitle,
      buttonId: s.buttonId as string,
      includeStatusLabelIds: [...s.includeStatusLabelIds],
    })),
  };
}

export function draftFromConfig(config: AppConfig | null): ConfigDraft {
  return {
    boardId: config?.boardId ?? null,
    peopleColumnId: config?.peopleColumnId ?? null,
    buttons: config?.buttons ?? [],
    templates: config?.templates ?? [],
    digest: digestFromConfig(config?.digest),
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
    draft.templates.every(templateIsComplete) &&
    // A disabled digest never blocks saving; an enabled one must be complete
    // (and needs the tasks-board people column for person-id matching).
    (!draft.digest.enabled || (digestIsComplete(draft.digest) && draft.peopleColumnId !== null))
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
    digest: digestToConfig(draft.digest),
  };
}

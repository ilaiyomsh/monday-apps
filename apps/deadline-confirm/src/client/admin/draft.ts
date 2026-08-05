// v2 draft model — the config being edited. Buttons/templates get
// client-generated ids on creation (server re-validates and generates for
// any that arrive without one).

import type {
  ActionButton,
  AppConfig,
  DigestBlock,
  DigestConfig,
  DigestSectionConfig,
  DigestTextBlock,
  EmailTemplate,
  TemplateBlock,
} from './types';
import {
  DEFAULT_FONT,
  DEFAULT_TEXT_COLOR,
  LEGACY_TEXTS,
  MAX_DIGEST_BLOCKS,
  MAX_DIGEST_CLUSTERS,
  MAX_DIGEST_TEXT_LENGTH,
  legacyBlocksFromSections,
} from './digest-blocks';

export interface DigestSectionDraft {
  id: string;
  title: string;
  dateColumnId: string | null;
  dateColumnTitle: string; // captured when the date column is picked
  /** Text column for the per-task required note; null = no field, no requirement. */
  noteColumnId: string | null;
  noteColumnTitle: string; // captured when the note column is picked → email header
  /** @deprecated prefer buttonIds — kept in sync as buttonIds[0] */
  buttonId: string | null;
  /** Action buttons for this cluster's label dropdown. First drives status filter. */
  buttonIds: string[];
  includeStatusLabelIds: number[]; // task shown only if its status is one of these
}

/** A cluster while it is being edited — its picks may still be empty. */
export interface DigestClusterDraft extends DigestSectionDraft {
  type: 'cluster';
}

export interface DigestTextDraft extends DigestTextBlock {
  type: 'text';
}

export type DigestBlockDraft = DigestTextDraft | DigestClusterDraft;

export const isTextBlockDraft = (b: DigestBlockDraft): b is DigestTextDraft => b.type === 'text';
export const isClusterDraft = (b: DigestBlockDraft): b is DigestClusterDraft => b.type === 'cluster';

/** The clusters of a draft, in block order — which IS their priority order. */
export const digestClusters = (digest: DigestDraft): DigestClusterDraft[] =>
  digest.blocks.filter(isClusterDraft);

export interface DigestDraft {
  enabled: boolean;
  usersBoardId: string | null;
  usersPeopleColumnId: string | null;
  usersEmailColumnId: string | null;
  /** The subject block. May carry the name token. */
  subject: string;
  /** Hour (0–23, Asia/Jerusalem) for scheduled send + slot math. Default 8. */
  sendHour: number;
  /**
   * The email body, in order: text blocks and cluster blocks in ONE list
   * (0.14.0). There is no separate sections array any more — cluster order here
   * is what the server stores as section order, i.e. the cluster priority.
   */
  blocks: DigestBlockDraft[];
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
    noteColumnId: null,
    noteColumnTitle: '',
    buttonId: null,
    buttonIds: [],
    includeStatusLabelIds: [],
  };
}

/** A new cluster block — a section plus the discriminator. */
export function newDigestCluster(title = ''): DigestClusterDraft {
  return { type: 'cluster', ...newDigestSection(title) };
}

/** A new text block. Defaults match the email's body text (14px, its own font). */
export function newDigestTextBlock(text = ''): DigestTextDraft {
  return {
    type: 'text',
    id: `x_${randomSlug()}`,
    text,
    direction: 'rtl',
    font: DEFAULT_FONT,
    fontSize: 14,
    align: 'right',
    color: DEFAULT_TEXT_COLOR,
    bold: false,
  };
}

export const DEFAULT_DIGEST_SUBJECT = 'המשימות שלך — נדרש עדכון סטטוס';

/**
 * Fresh digest draft — disabled, default subject, and a body that already
 * demonstrates the model: a greeting text block (with the dynamic field), the
 * two mock clusters, and a closing line. An operator who never touches the block
 * list still sends a mail that reads like the 0.13.x one.
 */
export function defaultDigestDraft(): DigestDraft {
  return {
    enabled: false,
    usersBoardId: null,
    usersPeopleColumnId: null,
    usersEmailColumnId: null,
    subject: DEFAULT_DIGEST_SUBJECT,
    sendHour: 8,
    blocks: [
      { ...newDigestTextBlock(LEGACY_TEXTS.greeting), fontSize: 18, bold: true },
      newDigestTextBlock(LEGACY_TEXTS.lead),
      newDigestCluster('משימות שנדרש להתחיל וטרם התחילו:'),
      newDigestCluster('משימות שנדרש לסיים וטרם בוצעו:'),
      { ...newDigestTextBlock(LEGACY_TEXTS.footer), fontSize: 12, color: '#9699A6' },
    ],
  };
}

/** One stored section → a cluster draft, tolerating every pre-0.14.0 shape. */
function clusterFromSection(s: DigestSectionConfig): DigestClusterDraft {
  const buttonIds =
    Array.isArray(s.buttonIds) && s.buttonIds.length > 0
      ? [...s.buttonIds]
      : s.buttonId
        ? [s.buttonId]
        : [];
  return {
    ...s,
    type: 'cluster',
    dateColumnTitle: s.dateColumnTitle ?? '',
    // Pre-0.12.0 configs carry neither key — normalize, never undefined.
    noteColumnId: s.noteColumnId ?? null,
    noteColumnTitle: s.noteColumnTitle ?? '',
    buttonIds,
    buttonId: buttonIds[0] ?? s.buttonId ?? null,
    includeStatusLabelIds: Array.isArray(s.includeStatusLabelIds)
      ? [...s.includeStatusLabelIds]
      : [],
  };
}

/** One stored block → a block draft (text blocks arrive complete from the API). */
function blockFromConfig(block: DigestBlock): DigestBlockDraft {
  if (block.type === 'text') return { ...block, type: 'text' };
  return clusterFromSection(block);
}

export function digestFromConfig(digest: DigestConfig | null | undefined): DigestDraft {
  if (!digest) return defaultDigestDraft();
  // GET /api/state always sends `blocks`. The fallback is for an IMPORTED
  // settings export taken before 0.14.0 — reconstruct the mail it was sending
  // rather than drop its text (same reconstruction the server does).
  const blocks = Array.isArray(digest.blocks)
    ? digest.blocks
    : legacyBlocksFromSections(digest.sections);
  return {
    enabled: true,
    usersBoardId: digest.usersBoardId,
    usersPeopleColumnId: digest.usersPeopleColumnId,
    usersEmailColumnId: digest.usersEmailColumnId,
    subject: digest.subject,
    sendHour: digest.sendHour ?? 8,
    // Tolerate configs saved before 0.6.0 introduced two of the section fields
    // (production incident 2026-07-26: a bare spread threw at SPA boot on a
    // legacy config). A missing condition becomes [], which digestIsComplete
    // then flags as incomplete — the operator picks labels, nothing is guessed.
    blocks: blocks.map(blockFromConfig),
  };
}

export function digestIsComplete(digest: DigestDraft): boolean {
  const clusters = digestClusters(digest);
  return (
    digest.usersBoardId !== null &&
    digest.usersPeopleColumnId !== null &&
    digest.usersEmailColumnId !== null &&
    digest.subject.trim().length > 0 &&
    // At least one cluster: an email with no tasks in it is not a digest.
    clusters.length > 0 &&
    clusters.length <= MAX_DIGEST_CLUSTERS &&
    digest.blocks.length <= MAX_DIGEST_BLOCKS &&
    clusters.every(
      (s) =>
        s.title.trim().length > 0 &&
        s.dateColumnId !== null &&
        s.buttonIds.length > 0 &&
        // a status condition is mandatory — at least one included label
        s.includeStatusLabelIds.length > 0
    ) &&
    // An empty text block would be a hollow element in the mail; the server
    // rejects one, so the save button must not offer it.
    digest.blocks
      .filter(isTextBlockDraft)
      .every((b) => b.text.trim().length > 0 && b.text.length <= MAX_DIGEST_TEXT_LENGTH)
  );
}

/** One cluster draft → the stored section shape. */
function sectionFromCluster(s: DigestClusterDraft): DigestSectionConfig {
  const buttonIds = s.buttonIds.length > 0 ? [...s.buttonIds] : s.buttonId ? [s.buttonId] : [];
  return {
    id: s.id,
    title: s.title,
    dateColumnId: s.dateColumnId as string,
    dateColumnTitle: s.dateColumnTitle,
    noteColumnId: s.noteColumnId,
    noteColumnTitle: s.noteColumnTitle,
    buttonId: buttonIds[0] as string,
    buttonIds,
    includeStatusLabelIds: [...s.includeStatusLabelIds],
  };
}

/**
 * Resolve the digest draft into the config payload piece (see draftToConfig).
 *
 * `blocks` is what the server validates and stores; `sections` goes along as the
 * projection the server would derive anyway — sent so an older server (rollback)
 * still finds the clusters it knows how to read. The server re-derives it from
 * the blocks regardless, so the two can never disagree in storage.
 */
function digestToConfig(digest: DigestDraft): DigestConfig | null {
  if (!digest.enabled) return null;
  const blocks: DigestBlock[] = digest.blocks.map((b) =>
    b.type === 'text' ? { ...b } : { type: 'cluster', ...sectionFromCluster(b) }
  );
  return {
    usersBoardId: digest.usersBoardId as string,
    usersPeopleColumnId: digest.usersPeopleColumnId as string,
    usersEmailColumnId: digest.usersEmailColumnId as string,
    subject: digest.subject,
    sendHour: digest.sendHour,
    blocks,
    sections: digestClusters(digest).map(sectionFromCluster),
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

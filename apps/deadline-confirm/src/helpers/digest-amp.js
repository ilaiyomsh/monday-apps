// V6 amp4email digest renderer (docs/v6-amp-only-decisions.md §3, §5, D9).
//
// Layout (owner 2026-08-04): ONE FORM PER ROW, rendered as a card under its
// cluster title (מקבץ). Superseded the 2026-07-27 table layout, and the reason
// is mechanical, not aesthetic: amp-form's `submitting` / `submit-success` /
// `submit-error` blocks must be CHILDREN of the form, so per-row feedback is
// impossible with one form per message — and a <form> cannot span two <td>s.
// Cards also stack cleanly on a phone, which the fixed-width table did not.
//
// Picking a status SUBMITS THAT ROW IMMEDIATELY. There is no global submit
// button any more (owner decision 2026-08-04, supersedes the bulk form).
//
// Wire format per row (unchanged field names, one item per POST):
//   hidden: a, p, m, s, sig      — m/sig cover THIS ROW's pairs only
//   selection: <input type="radio" name="item_<itemId>" value="<btnId>">
//
// Two decisions inside that are easy to "clean up" and must not be:
//   - The selection rides a RADIO, not an amp-bind-bound hidden input.
//     `AMP.setState(...)` followed by `form.submit` in one action chain is a
//     race: amp-bind applies its DOM mutations on the next vsync frame, so the
//     submit would carry the PREVIOUS value. A checked radio is serialized by
//     the form itself — no binding, no frame to wait for. The setState in that
//     chain is therefore cosmetic only (close the menu, repaint the trigger).
//   - The submit fires on the radio's `change` (owner-confirmed 2026-08-04 as
//     the supported AMP-for-Email pattern); `tap` only repaints and closes the
//     menu. They are NOT interchangeable and must not be merged: both fire on a
//     first pick, so submitting from each would double-post every selection.

import { escapeHtml } from './html.js';
import { buildManifest, signManifest, currentSlot } from '../services/manifest-signature.js';
import { applyTokens, DIGEST_FONTS } from '../services/digest-blocks.js';

const AMP_ENDPOINT_PATH = '/amp/confirm';
const DEFAULT_SEND_HOUR = 8;
const NEUTRAL_STATUS = '#c4c4c4';
const TRIGGER_EMPTY = '—';
const STATUS_CAPTION = 'סטטוס';
const NOTE_PLACEHOLDER = 'חובה למילוי';
const SUBMITTING_LABEL = 'מעדכן…';
const CHECK_GLYPH = '&#10003;';

/**
 * A cluster requires a per-task note when it maps a text column.
 * @param {object} section
 * @returns {string|null}
 */
function sectionNoteColumn(section) {
  const id = section?.noteColumnId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** YYYY-MM-DD → DD/MM/YYYY (unset → ''). */
function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return escapeHtml(date);
  return `${d}/${m}/${y}`;
}

/**
 * Escape a string for use inside a single-quoted amp-bind / setState literal.
 * @param {string} raw
 */
function escapeBindStr(raw) {
  return String(raw)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ');
}

/**
 * Action buttons offered for a section — multi-button (`buttons` / `buttonIds`)
 * with legacy fallback to singular `button` / `buttonId`.
 * Pill color prefers the REAL board color of the button's target label
 * (statusColumnColors[statusColumnId][targetIndex], sourced from the board's
 * status column settings) over the configured button.style.color guess.
 * @param {object} section
 * @param {Record<string, Record<string, string>>} [statusColumnColors]
 * @returns {Array<{ id: string, label: string, color: string }>}
 */
export function resolveSectionButtons(section, statusColumnColors) {
  /** @type {Array<{ id: string, label: string, color: string }>} */
  const out = [];
  const seen = new Set();

  const pushButton = (raw) => {
    if (!raw || typeof raw !== 'object') return;
    const id = raw.id ?? '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    // targetIndex 0 is a valid label id — the lookup itself is the check.
    const boardColor = statusColumnColors?.[raw.statusColumnId]?.[raw.targetIndex];
    out.push({
      id,
      label: raw.targetLabel || raw.name || 'עדכן',
      color:
        (typeof boardColor === 'string' && boardColor.length > 0 ? boardColor : '') ||
        raw.style?.color ||
        NEUTRAL_STATUS,
    });
  };

  if (Array.isArray(section.buttons) && section.buttons.length > 0) {
    for (const b of section.buttons) pushButton(b);
    return out;
  }

  if (Array.isArray(section.buttonIds) && section.buttonIds.length > 0) {
    const primary = section.button && section.button.id ? section.button : null;
    for (const id of section.buttonIds) {
      if (primary && primary.id === id) pushButton(primary);
      else if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
        seen.add(id);
        out.push({ id, label: id, color: NEUTRAL_STATUS });
      }
    }
    return out;
  }

  if (section.button) {
    pushButton(section.button);
    return out;
  }

  const id = section.buttonId ?? '';
  if (id) out.push({ id, label: id, color: NEUTRAL_STATUS });
  return out;
}

/**
 * AMP4EMAIL forbids [style] on <button> — bind background via [class] instead.
 * @param {string} hex
 * @returns {string} e.g. bg_fdab3d
 */
function colorToClass(hex) {
  const clean = String(hex || NEUTRAL_STATUS)
    .trim()
    .replace(/^#/, '')
    .replace(/[^a-fA-F0-9]/g, '')
    .toLowerCase();
  return `bg_${clean || 'c4c4c4'}`;
}

/**
 * The card's leading-edge stripe class. Taken from the CLUSTER's primary button,
 * not from the row's current status: the pill already shows the status, so the
 * stripe is free to do what it does in the monday mobile app — group the cards
 * that belong together. Being per-cluster it is also static, needing no binding.
 * @param {string} hex
 * @returns {string} e.g. ac_fdab3d
 */
function accentToClass(hex) {
  return `ac_${colorToClass(hex).slice(3)}`;
}

/**
 * @param {Iterable<string>} colors hex colors used in this message
 * @returns {string} CSS rules for .dd-trig.bg_*
 */
function buildColorClassCss(colors) {
  const seen = new Set();
  const rules = [];
  for (const raw of colors) {
    const cls = colorToClass(raw);
    if (seen.has(cls)) continue;
    seen.add(cls);
    const hexDigits = cls.slice(3); // after bg_
    rules.push(`.dd-trig.${cls} { background:#${escapeHtml(hexDigits)}; }`);
  }
  return rules.join('\n      ');
}

/**
 * All action buttons across populated sections (for status-color matching).
 * @param {object} recipient
 * @returns {Array<{ id: string, label: string, color: string }>}
 */
function allRecipientButtons(recipient) {
  const out = [];
  const seen = new Set();
  for (const section of recipient.sections ?? []) {
    if (!section.tasks || section.tasks.length === 0) continue;
    for (const button of resolveSectionButtons(section, recipient.statusColumnColors)) {
      if (seen.has(button.id)) continue;
      seen.add(button.id);
      out.push(button);
    }
  }
  return out;
}

/**
 * Best-effort color for the task's current status label: optional
 * task.statusColor, else match a known action-button label, else gray.
 * @param {string} statusText
 * @param {Array<{ label: string, color: string }>} buttons
 * @param {string} [statusColor]
 */
function resolveCurrentStatusColor(statusText, buttons, statusColor) {
  if (statusColor && typeof statusColor === 'string' && statusColor.trim()) {
    return statusColor.trim();
  }
  const needle = String(statusText || '').trim();
  if (!needle) return NEUTRAL_STATUS;
  const match = buttons.find((b) => b.label === needle);
  return match?.color || NEUTRAL_STATUS;
}

/** Closed-trigger label = current status text (or em dash if unset). */
function currentStatusLabel(task) {
  const text = typeof task?.statusText === 'string' ? task.statusText.trim() : '';
  return text || TRIGGER_EMPTY;
}

/**
 * Collect button + current-status colors used in this message (+ neutral).
 * @param {object} recipient
 * @returns {string[]}
 */
function collectColors(recipient) {
  const colors = new Set([NEUTRAL_STATUS]);
  const palette = allRecipientButtons(recipient);
  for (const button of palette) colors.add(button.color || NEUTRAL_STATUS);
  for (const section of recipient.sections ?? []) {
    if (!section.tasks || section.tasks.length === 0) continue;
    for (const task of section.tasks) {
      const label = currentStatusLabel(task);
      colors.add(
        resolveCurrentStatusColor(label === TRIGGER_EMPTY ? '' : label, palette, task.statusColor)
      );
    }
  }
  return [...colors];
}

/**
 * Initial amp-state — seeded with each item's current status (first occurrence
 * wins across clusters). c<id> is a CSS class name (AMP4EMAIL forbids [style]
 * on button). There is deliberately NO v<id> any more: the selection travels on
 * a radio, so no state key carries a wire value.
 * @param {object} recipient
 */
function buildDropdownState(recipient) {
  /** @type {Record<string, string>} */
  const state = { o: '' };
  const palette = allRecipientButtons(recipient);
  const seen = new Set();
  for (const section of recipient.sections ?? []) {
    if (!section.tasks || section.tasks.length === 0) continue;
    for (const task of section.tasks) {
      const id = String(task.itemId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const label = currentStatusLabel(task);
      const color = resolveCurrentStatusColor(
        label === TRIGGER_EMPTY ? '' : label,
        palette,
        task.statusColor
      );
      state[`l${id}`] = label;
      state[`c${id}`] = colorToClass(color);
    }
  }
  // n<id> exists only for items whose cluster maps a text column — the trigger
  // lock reads these keys, and a key that is never seeded reads as undefined
  // (not ''), which would leave the trigger locked shut.
  for (const id of noteRequiredItemIds(recipient)) state[`n${id}`] = '';
  return state;
}

/**
 * Item ids that owe a note, in first-appearance order.
 * @param {object} recipient
 * @returns {string[]}
 */
function noteRequiredItemIds(recipient) {
  const ids = [];
  const seen = new Set();
  for (const section of recipient.sections ?? []) {
    if (!section.tasks || section.tasks.length === 0) continue;
    if (!sectionNoteColumn(section)) continue;
    for (const task of section.tasks) {
      const id = String(task.itemId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

// STRICT amp4email CSS ONLY (docs/amp-email-verified-findings.md §7): the
// document declares data-css-strict, and Gmail enforces the strict property
// set even on documents that do not. Consequences baked into these rules:
//   - No logical properties. dir=rtl is fixed in this document, so the
//     physical equivalents are exact: inline-start = right, inline-end = left.
//   - No `filter`, no `pointer-events`. `cursor` is value-restricted to a
//     tiny set (initial|pointer in current validator rules), so the ONLY
//     cursor in this document is the base `pointer` — no per-state override.
//   - `transition` may only animate none|offset-distance|opacity|transform|
//     visibility (official value regex) — box-shadow is NOT among them, so
//     the document ships no transition at all; hover/active box-shadow
//     changes are instant.
//   - No flex/grid: their property sets are not fully inside the strict list,
//     so the card is plain block layout. It is also what stacks on a phone.
// `npm run validate:amp` checks all of this against the official validator.
const STYLES_BASE = `
      body { margin:0; padding:14px 10px; background:#F5F6F8; font-family:Figtree,Roboto,"Noto Sans Hebrew",Arial,Helvetica,sans-serif; color:#323338; }
      .wrap { position:relative; max-width:720px; margin:0 auto; background:#ffffff; border:1px solid #E6E9EF; border-radius:8px; padding:18px; }
      /* Operator-authored text block. Everything that varies per block (font,
         size, alignment, color, weight) lands in a generated .tb<n> rule; this
         carries only what every block shares. pre-wrap is what preserves the
         line breaks the operator typed — it is inside the strict amp4email
         property set (already used by .state.err). */
      .tb { margin:0 0 12px; line-height:1.6; white-space:pre-wrap; word-break:break-word; }
      .cluster { margin:0 0 22px; }
      .cluster-title { font-size:15px; font-weight:bold; color:#323338; margin:0 0 8px; line-height:1.4; }
      /* One card per task — and each card IS its own form. The card is the BASE
         layout, not the fallback: a client that strips media queries shows it
         everywhere, which is the layout that works at any width. The wide
         layout is added in the min-width query at the end of this sheet. */
      form.row { display:block; margin:0 0 10px; padding:12px 14px; background:#ffffff; border:1px solid #E6E9EF; border-radius:8px; text-align:right; border-right-width:4px; border-right-style:solid; border-right-color:#E6E9EF; }
      /* Cells: stacked blocks on a phone, inline-block columns when wide. */
      .c-name, .c-date, .c-note, .c-act { display:block; width:100%; box-sizing:border-box; }
      .c-date { margin-top:6px; }
      .c-note, .c-act { margin-top:10px; }
      .row-name { display:block; font-size:15px; font-weight:bold; color:#323338; line-height:1.4; }
      .chip { display:inline-block; padding:4px 10px; border-radius:6px; background:#F5F6F8; color:#676879; font-size:12px; line-height:1.4; }
      .row-cap { display:block; margin-bottom:4px; font-size:12px; color:#676879; font-weight:500; }
      /* Column headers — the wide layout's only extra markup. */
      .thead { display:none; padding:0 18px 6px; }
      .th { display:inline-block; box-sizing:border-box; font-size:12px; color:#676879; font-weight:500; text-align:right; }
      .dd-wrap { position:relative; display:inline-block; width:100%; max-width:260px; text-align:right; }
      .dd-trig {
        width:100%; height:38px; box-sizing:border-box;
        padding:0 12px; border:0; border-radius:4px; cursor:pointer;
        font-size:14px; font-weight:bold; color:#ffffff; text-align:center;
        font-family:Figtree,Roboto,"Noto Sans Hebrew",Arial,Helvetica,sans-serif;
        background:${NEUTRAL_STATUS};
      }
      .dd-menu {
        position:absolute; top:100%; left:0; z-index:20;
        width:100%; margin-top:4px; padding:8px; box-sizing:border-box;
        background:#ffffff; border:1px solid #E6E9EF; border-radius:8px;
        box-shadow:0 10px 25px rgba(0,0,0,0.15);
      }
      /* The option is a LABEL wrapping the radio: the radio is what the form
         serializes, the label is what the reader sees and taps. */
      .dd-opt {
        display:block; width:100%; box-sizing:border-box;
        margin:0 0 4px; padding:0 12px; border:0; border-radius:4px; cursor:pointer;
        height:38px; line-height:38px; font-size:14px; font-weight:bold; color:#ffffff; text-align:center;
        font-family:Figtree,Roboto,"Noto Sans Hebrew",Arial,Helvetica,sans-serif;
      }
      .dd-opt:last-child { margin-bottom:0; }
      /* Hidden, but present and clickable — the label forwards the tap to it. */
      .pick { position:absolute; width:1px; height:1px; opacity:0; margin:0; padding:0; border:0; }
      /* Tap-away catcher. Fixed positioning is outside the strict set, so the
         overlay is absolute inside the position:relative .wrap card — it
         covers the card (where every interactive element lives), not the
         viewport, which is an acceptable trade. */
      .dd-overlay {
        position:absolute; top:0; right:0; bottom:0; left:0; z-index:10;
        background:transparent;
      }
      /* Hover/active affordance is box-shadow ONLY — filter is outside the
         strict set. amp4email permits :hover; clients that ignore it simply
         render the base state, so this degrades to today's behaviour. */
      .dd-trig:hover, .dd-opt:hover { box-shadow:0 1px 4px rgba(0,0,0,0.18); }
      .dd-trig:active, .dd-opt:active { box-shadow:inset 0 2px 4px rgba(0,0,0,0.22); }
      /* In-flight state. amp-form stamps this class on the FORM that is
         submitting — which is now one row — so the dim lands on that row only
         and cannot desync from the actual request. Strict set: no cursor
         override (value-restricted), no input-freeze property. */
      form.amp-form-submitting .dd-trig, form.amp-form-submitting .dd-opt { opacity:0.75; }
      /* Per-row outcome strip. One of the three at a time — amp-form clears the
         previous rendering when the row is submitted again. */
      .state { margin-top:10px; padding:8px 10px; border-radius:6px; font-size:13px; line-height:1.5; }
      .state.wait { background:#F5F6F8; color:#676879; }
      .state.ok { background:#E6F7EF; color:#00754A; }
      .state.err { background:#FDECEE; color:#B4222F; white-space:pre-wrap; word-break:break-word; }
      .err-detail { display:block; margin-top:6px; font-size:11px; opacity:0.9; font-family:ui-monospace,Menlo,Consolas,monospace; }
      /* WIDE LAYOUT — additive on purpose (see the card comment above). A media
         query is the only width signal an amp4email document has: no JS, no
         viewport API, and the media attribute applies to amp-* elements only.
         Columns line up because every row is the same width and shares these
         percentages: there is no table element to align them, since a form
         cannot span two cells and per-row forms are what give each row its own
         loader. The percentages deliberately stop short of 100% — inline-blocks
         are separated by a whitespace gap, and a full 100% wraps the last
         column. (No literal tag names in this comment: it ships inside the
         document, where the suite asserts that no table markup exists.) */
      @media (min-width:601px) {
        .thead { display:block; }
        form.row { margin:0 0 6px; padding:10px 14px; }
        .c-name, .c-date, .c-act { display:inline-block; vertical-align:middle; margin-top:0; }
        .row-cap { display:none; }
        .chip { background:transparent; padding:0; font-size:13px; }
        .th-name, .c-name { width:43%; }
        .th-date, .c-date { width:21%; }
        .th-act, .c-act { width:33%; }
      }
`;

/**
 * Note-column styles. Emitted ONLY when this message actually requires a note —
 * a tenant that maps no text column ships neither the markup nor the rules.
 */
const STYLES_NOTES = `
      .note-in {
        width:100%; max-width:320px; height:38px; box-sizing:border-box;
        padding:0 10px; border:1px solid #D0D4E4; border-radius:4px;
        font-size:13px; color:#323338; background:#ffffff; text-align:right;
        font-family:Figtree,Roboto,"Noto Sans Hebrew",Arial,Helvetica,sans-serif;
      }
      /* A status trigger locked until its note is typed. Opacity is what greys
         it — the background is an inline/class style that no rule can beat
         without !important, and AMP forbids !important. No hover shadow: a
         locked row must not look tappable. */
      .dd-trig[disabled] { opacity:0.45; box-shadow:none; }
      .dd-trig[disabled]:hover { box-shadow:none; }
      /* A fourth column has to come out of the other three. Same breakpoint as
         the base sheet — two different ones would let the header strip and the
         rows switch at different widths. */
      @media (min-width:601px) {
        .c-note { display:inline-block; vertical-align:middle; margin-top:0; }
        .th-name, .c-name { width:29%; }
        .th-date, .c-date { width:15%; }
        .th-note, .c-note { width:25%; }
        .th-act, .c-act { width:27%; }
      }
`;

// --- operator-authored text blocks ------------------------------------------
//
// A text block contributes TWO things: an escaped <div> and one generated CSS
// rule. Nothing about it may reach the document unsanitized — the text is
// escaped (so is the substituted recipient name), and every style value is
// re-checked HERE rather than trusted from storage, because this function is
// what writes into <style amp-custom>: a font name is a CSS token, and an
// unvalidated one would be a stylesheet-injection point in a document that is
// sent to a reader's mailbox.

/** The document's own stack — what every pre-0.14.0 digest was rendered in. */
const DOC_FONT_STACK = 'Figtree,Roboto,"Noto Sans Hebrew",Arial,Helvetica,sans-serif';

/**
 * @param {string} font a DIGEST_FONTS entry ('Default' = the document stack)
 * @returns {string} a CSS font-family value
 */
function fontFamilyFor(font) {
  if (typeof font !== 'string' || font === 'Default' || !DIGEST_FONTS.includes(font)) {
    return DOC_FONT_STACK;
  }
  // Allowlisted, so quoting is about CSS correctness (multi-word families), not
  // about escaping — a name that needed escaping could not be on the list.
  const name = /\s/.test(font) ? `"${font}"` : font;
  return `${name},${DOC_FONT_STACK}`;
}

/** Clamp to the same 10–32 the admin offers; a bad value renders at 14. */
function fontSizeFor(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return 14;
  return Math.min(32, Math.max(10, Math.round(n)));
}

const ALIGNS = new Set(['right', 'center', 'left']);
const DIRECTIONS = new Set(['rtl', 'ltr']);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * The CSS rule for one text block.
 * @param {number} index
 * @param {object} block
 * @returns {string}
 */
function textBlockCss(index, block) {
  const align = ALIGNS.has(block.align) ? block.align : 'right';
  const color = HEX_COLOR_RE.test(block.color) ? block.color : '#323338';
  const weight = block.bold === true ? 'bold' : 'normal';
  return `.tb${index} { font-family:${fontFamilyFor(block.font)}; font-size:${fontSizeFor(
    block.fontSize
  )}px; text-align:${align}; color:${color}; font-weight:${weight}; }`;
}

/**
 * The markup for one text block. `dir` rides the element because a block may
 * deliberately differ from the document's rtl (a quoted English paragraph).
 * @param {number} index
 * @param {object} block
 * @param {string} resolvedText tokens already substituted, NOT yet escaped
 * @returns {string}
 */
function renderTextBlock(index, block, resolvedText) {
  const dir = DIRECTIONS.has(block.direction) ? block.direction : 'rtl';
  return `      <div class="tb tb${index}" dir="${dir}">${escapeHtml(resolvedText)}</div>`;
}

/**
 * Build the signed manifest for ONE row: every (this item × this cluster's
 * buttons) pair, and nothing else. A form that leaks authorizes one item.
 * @param {{ secret: string, accountId: string, personId: string, itemId: string,
 *           buttons: Array<{ id: string }>, slot: string }} p
 */
function signRow({ secret, accountId, personId, itemId, buttons, slot }) {
  const manifest = buildManifest(buttons.map((button) => ({ itemId, btnId: button.id })));
  const signature = signManifest({
    secret,
    accountId: String(accountId),
    personId: String(personId),
    slot,
    manifest,
  });
  return { manifest, signature };
}

/**
 * The note field for one row. The typed input carries the name itself: the
 * value used to ride a bound hidden twin fed by input-throttled → AMP.setState,
 * and in Gmail that state never updated, so every note reached the server EMPTY
 * while the status (fed by tap:) arrived intact (measured 2026-08-04). A named
 * input needs no event and no binding to be submitted.
 *
 * The state mirror still matters — the trigger lock reads `dd.n<id>` — and it
 * matters MORE than before: an event that never fires now means a dropdown that
 * never opens. So the value is mirrored from `change` (fired when the field is
 * left) as well as `input-throttled`; whichever the client implements unlocks
 * the row.
 *
 * `required` is deliberately NOT used: it would block a row the reader never
 * intended to mark. The gate is the trigger lock plus the server's refusal.
 *
 * @param {object} task
 * @param {string} caption note column title
 */
function renderNoteField(task, caption) {
  const id = String(task.itemId);
  const mirror = `AMP.setState({dd:{n${id}:event.value}})`;
  return `        <div class="c-note">
          <span class="row-cap">&#8207;${escapeHtml(caption)}</span>
          <input type="text" name="${escapeHtml(`note_${id}`)}" class="note-in" placeholder="${escapeHtml(NOTE_PLACEHOLDER)}"
                 on="change:${mirror};input-throttled:${mirror}">
        </div>`;
}

/**
 * The status control for one row: closed trigger showing the CURRENT status,
 * tap opens the colored options. Each option is a label-wrapped radio; tapping
 * it repaints the trigger, closes the menu and SUBMITS THAT ROW.
 *
 * @param {object} p
 * @param {string} p.formId the row's form id — the submit action's target
 * @param {string} p.menuKey per-CELL open/closed key (`<clusterIndex>_<itemId>`)
 * @param {object} p.task
 * @param {Array<{ id: string, label: string, color: string }>} p.buttons
 * @param {Array<{ label: string, color: string }>} p.palette
 * @param {boolean} p.noteGated locked until this row's note holds text
 */
function renderStatusControl({ formId, menuKey, task, buttons, palette, noteGated }) {
  const id = String(task.itemId);
  const lKey = `l${id}`;
  const cKey = `c${id}`;

  const curLabel = currentStatusLabel(task);
  const curColor = resolveCurrentStatusColor(
    curLabel === TRIGGER_EMPTY ? '' : curLabel,
    palette,
    task.statusColor
  );
  const curCls = colorToClass(curColor);

  // No text, no status (owner decision 2026-08-04). A disabled <button> fires no
  // click, so `tap:` never runs and the menu cannot be opened — the ONLY way to
  // express this here: strict amp4email CSS forbids `pointer-events`.
  //
  // The STATIC `disabled` is not belt-and-braces, it is the initial state:
  // amp-bind does not evaluate bindings on load, so a trigger carrying only
  // `[disabled]` would be tappable until the reader's first state change.
  const lock = noteGated
    ? ` disabled\n                    [disabled]="dd.n${id} == ''"`
    : '';

  const options = buttons
    .map((button) => {
      const color = button.color || NEUTRAL_STATUS;
      const cls = colorToClass(color);
      // The setState here is COSMETIC (close the menu, repaint the trigger).
      // The submitted value is the radio's, so the vsync delay cannot lose it.
      const paint = `AMP.setState({dd:{o:'', ${lKey}:'${escapeBindStr(button.label)}', ${cKey}:'${escapeBindStr(cls)}'}})`;
      // The two events are split on purpose:
      //   change → submit. This is the documented AMP-for-Email pattern for a
      //     form control (owner-confirmed 2026-08-04), and it fires AFTER the
      //     radio is checked, so the form serializes the right value.
      //   tap → paint. Repainting on tap (not change) also closes the menu on a
      //     tap of the already-selected option, which fires no change event.
      // Consequence to know: re-tapping the SAME option does not resubmit, so a
      // row whose request failed is retried by picking a different status (or
      // from the board). Putting submit on tap as well would double-post every
      // first pick, since both events fire on it.
      // role + tabindex are REQUIRED by the validator on any element carrying
      // `on` ("required by attribute 'on'"); <button> is exempt, <input> is not,
      // which is why the trigger has neither and the overlay has both. They are
      // also what keeps a visually hidden radio reachable by keyboard.
      return `              <label class="dd-opt" style="background:${escapeHtml(color)}">
                <input type="radio" class="pick" name="${escapeHtml(`item_${id}`)}" value="${escapeHtml(button.id)}"
                       role="radio" tabindex="0"
                       on="tap:${paint};change:${formId}.submit">
                <span>&#8207;${escapeHtml(button.label)}</span>
              </label>`;
    })
    .join('\n');

  return `        <div class="c-act">
          <span class="row-cap">&#8207;${STATUS_CAPTION}</span>
          <div class="dd-wrap">
            <button type="button" class="dd-trig ${curCls}"${lock}
                    [class]="'dd-trig ' + dd.${cKey}"
                    on="tap:AMP.setState({dd:{o: dd.o == '${menuKey}' ? '' : '${menuKey}'}})">
              <span [text]="dd.${lKey}">&#8207;${escapeHtml(curLabel)}</span>
            </button>
            <div class="dd-menu" hidden [hidden]="dd.o != '${menuKey}'">
${options}
            </div>
          </div>
        </div>`;
}

/**
 * The cluster's column-header strip — the wide layout's only extra markup, and
 * a plain div OUTSIDE the row forms (nothing may nest a form). It is
 * `display:none` until the min-width query, where the per-field captions inside
 * the cards switch off and these take over.
 *
 * @param {object} section
 * @returns {string}
 */
function renderColumnHeader(section) {
  const dateCaption =
    section.dateColumnTitle && String(section.dateColumnTitle).length > 0
      ? String(section.dateColumnTitle)
      : 'תאריך';
  const noteCell = sectionNoteColumn(section)
    ? `<span class="th th-note">&#8207;${escapeHtml(
        section.noteColumnTitle && String(section.noteColumnTitle).length > 0
          ? String(section.noteColumnTitle)
          : 'הערה'
      )}</span>`
    : '';
  return `        <div class="thead"><span class="th th-name">&#8207;שם הפעולה</span><span class="th th-date">&#8207;${escapeHtml(
    dateCaption
  )}</span>${noteCell}<span class="th th-act">&#8207;${STATUS_CAPTION}</span></div>`;
}

/**
 * One row = one card = one form. The three amp-form state blocks are DIRECT
 * children of the form (that is where amp-form looks for them), which is what
 * puts the loader, the confirmation and the error on this row and no other.
 *
 * @param {object} p
 * @param {object} p.task
 * @param {object} p.section
 * @param {number} p.clusterIndex
 * @param {Array<{ id: string, label: string, color: string }>} p.buttons
 * @param {Array<{ label: string, color: string }>} p.palette
 * @param {string} p.baseUrl
 * @param {string} p.accountId
 * @param {string} p.personId
 * @param {string} p.slot
 * @param {string} p.secret
 * @param {string} p.accentClass the cluster's stripe class (`ac_<hex>`)
 */
function renderRowForm({
  task,
  section,
  clusterIndex,
  buttons,
  palette,
  baseUrl,
  accountId,
  personId,
  slot,
  secret,
  accentClass,
}) {
  const id = String(task.itemId);
  const formId = `f${clusterIndex}_${id}`;
  const menuKey = escapeBindStr(`${clusterIndex}_${id}`);
  const { manifest, signature } = signRow({
    secret,
    accountId,
    personId,
    itemId: id,
    buttons,
    slot,
  });

  const noteColumn = sectionNoteColumn(section);
  const dateCaption =
    section.dateColumnTitle && String(section.dateColumnTitle).length > 0
      ? String(section.dateColumnTitle)
      : 'תאריך';
  const noteCaption =
    section.noteColumnTitle && String(section.noteColumnTitle).length > 0
      ? String(section.noteColumnTitle)
      : 'הערה';
  const noteField = noteColumn ? `\n${renderNoteField(task, noteCaption)}` : '';

  return `      <form class="row ${accentClass}" id="${formId}" method="post"
            action-xhr="${escapeHtml(baseUrl)}${AMP_ENDPOINT_PATH}"
            enctype="application/x-www-form-urlencoded">
        <input type="hidden" name="a" value="${escapeHtml(String(accountId))}">
        <input type="hidden" name="p" value="${escapeHtml(String(personId))}">
        <input type="hidden" name="m" value="${escapeHtml(manifest)}">
        <input type="hidden" name="s" value="${escapeHtml(slot)}">
        <input type="hidden" name="sig" value="${escapeHtml(signature)}">
        <div class="c-name"><span class="row-name">&#8207;${escapeHtml(task.name)}</span></div>
        <div class="c-date"><span class="chip">&#8207;${escapeHtml(dateCaption)}: ${formatDate(task.date) || '—'}</span></div>${noteField}
${renderStatusControl({ formId, menuKey, task, buttons, palette, noteGated: Boolean(noteColumn) })}
        <div submitting><div class="state wait">&#8207;${SUBMITTING_LABEL}</div></div>
        <div submit-success><template type="amp-mustache"><div class="state ok">${CHECK_GLYPH} {{message}}</div></template></div>
        <div submit-error><template type="amp-mustache"><div class="state err">{{message}}{{#detail}}<span class="err-detail">{{detail}}</span>{{/detail}}</div></template></div>
      </form>`;
}

/**
 * Resolve the ordered blocks into what this recipient's document actually
 * contains: text blocks as authored, cluster blocks replaced by THIS
 * recipient's matching section — dropped when the recipient has no tasks in it.
 *
 * Matching is by section id, never by position: buildDigest omits a section a
 * recipient has nothing in, so the Nth block and the Nth section are not the
 * same thing. A block naming a section that is absent renders nothing.
 *
 * `blocks` absent (legacy call shape, and every renderer test that predates
 * 0.14.0) means "the clusters, in recipient order, with no text".
 *
 * @param {Array<object>|undefined} blocks
 * @param {object} recipient
 * @returns {Array<{ kind: 'text', block: object } | { kind: 'cluster', section: object }>}
 */
function resolveUnits(blocks, recipient) {
  const sections = recipient.sections ?? [];
  const hasTasks = (section) => Boolean(section?.tasks && section.tasks.length > 0);
  if (!Array.isArray(blocks)) {
    return sections.filter(hasTasks).map((section) => ({ kind: 'cluster', section }));
  }
  const byId = new Map();
  for (const section of sections) {
    const id = section.sectionId ?? section.id;
    if (typeof id === 'string' && id.length > 0 && !byId.has(id)) byId.set(id, section);
  }
  const units = [];
  for (const block of blocks) {
    if (block?.type === 'text') {
      units.push({ kind: 'text', block });
      continue;
    }
    if (block?.type !== 'cluster') continue;
    const section = byId.get(block.id);
    if (hasTasks(section)) units.push({ kind: 'cluster', section });
  }
  return units;
}

/**
 * Render the dynamic-email (amp4email) part of one recipient's digest.
 *
 * The BODY IS THE BLOCK LIST (0.14.0). This function contributes no content
 * text of its own — only operational chrome: the cluster column headers, the
 * status caption, the note placeholder and amp-form's per-row
 * submitting/✓/error strips. A greeting, an instruction line or a footer is a
 * text block the operator wrote (a config that predates blocks is reconstructed
 * into exactly those blocks — see services/digest-blocks.js).
 *
 * @param {object} p
 * @param {string} p.baseUrl
 * @param {string} p.secret
 * @param {string} p.accountId
 * @param {{ name: string, personId: string, sections: Array<object> }} p.recipient
 * @param {Array<object>} [p.blocks] normalized digest blocks; absent = clusters only
 * @param {number} [p.sendHour=8]
 * @param {Date} [p.now=new Date()]
 * @returns {string}
 */
export function renderDigestAmp({
  baseUrl,
  secret,
  accountId,
  recipient,
  blocks,
  sendHour = DEFAULT_SEND_HOUR,
  now = new Date(),
}) {
  const personId = recipient.personId;
  if (typeof personId !== 'string' || personId.length === 0) {
    throw new Error('renderDigestAmp: recipient.personId is required');
  }

  const slot = currentSlot({ sendHour, now });
  const units = resolveUnits(blocks, recipient);
  // State, palette and the notes stylesheet describe the RENDERED clusters only:
  // a section the block list never names must not seed dropdown state, add a
  // color rule, or drag in the locked-trigger CSS.
  const rendered = {
    ...recipient,
    sections: units.filter((u) => u.kind === 'cluster').map((u) => u.section),
  };
  const ddState = buildDropdownState(rendered);
  const palette = allRecipientButtons(rendered);
  const notesInPlay = noteRequiredItemIds(rendered).length > 0;

  /** Stripe rules, one per distinct cluster accent actually rendered. */
  const accentRules = new Map();
  /** One rule per rendered text block (.tb0, .tb1, …). */
  const textRules = [];

  let clusterIndex = 0;
  let textIndex = 0;
  const bodyParts = [];

  for (const unit of units) {
    if (unit.kind === 'text') {
      const resolved = applyTokens(unit.block.text, { name: recipient.name });
      // An empty block is a hollow element and a stray margin — the operator
      // deleting a block's text is not a request for vertical space.
      if (resolved.trim().length === 0) continue;
      textRules.push(textBlockCss(textIndex, unit.block));
      bodyParts.push(renderTextBlock(textIndex, unit.block, resolved));
      textIndex += 1;
      continue;
    }

    const section = unit.section;
    const buttons = resolveSectionButtons(section, recipient.statusColumnColors);
    if (buttons.length === 0) continue;
    const accent = buttons[0].color || NEUTRAL_STATUS;
    const accentClass = accentToClass(accent);
    accentRules.set(
      accentClass,
      `.row.${accentClass} { border-right-color:#${escapeHtml(accentClass.slice(3))}; }`
    );
    const index = clusterIndex;
    clusterIndex += 1;
    const rows = section.tasks
      .map((task) =>
        renderRowForm({
          task,
          section,
          clusterIndex: index,
          buttons,
          palette,
          baseUrl,
          accountId,
          personId,
          slot,
          secret,
          accentClass,
        })
      )
      .join('\n');
    bodyParts.push(`      <div class="cluster">
        <p class="cluster-title">&#8207;${escapeHtml(section.title)}</p>
${renderColumnHeader(section)}
${rows}
      </div>`);
  }

  const colorCss = buildColorClassCss(collectColors(rendered));
  const styles = `${STYLES_BASE}${notesInPlay ? STYLES_NOTES : ''}\n      ${colorCss}\n      ${[
    ...accentRules.values(),
    ...textRules,
  ].join('\n      ')}`;

  return `<!doctype html>
<html amp4email data-css-strict lang="he">
  <head>
    <meta charset="utf-8">
    <script async src="https://cdn.ampproject.org/v0.js"></script>
    <script async custom-element="amp-form" src="https://cdn.ampproject.org/v0/amp-form-0.1.js"></script>
    <script async custom-element="amp-bind" src="https://cdn.ampproject.org/v0/amp-bind-0.1.js"></script>
    <script async custom-template="amp-mustache" src="https://cdn.ampproject.org/v0/amp-mustache-0.2.js"></script>
    <style amp4email-boilerplate>body{visibility:hidden}</style>
    <style amp-custom>${styles}    </style>
  </head>
  <body dir="rtl">
    <amp-state id="dd"><script type="application/json">${JSON.stringify(ddState)}</script></amp-state>
    <div class="wrap">
      <div class="dd-overlay" hidden [hidden]="dd.o == ''" role="button" tabindex="0"
           on="tap:AMP.setState({dd:{o:''}})"></div>
${bodyParts.join('\n')}
    </div>
  </body>
</html>`;
}

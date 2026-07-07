/*
 * HTML compatibility layer between our TipTap editor and a monday Update body.
 *
 * monday's native Update editor (Redactor) stores clean semantic HTML, and its
 * renderer preserves it. Verified shape of a monday Update body:
 *   <h1>/<h2>/<h3>, <p>, <strong>, <em>, <u>, <s>,
 *   <span style="color: …">, text-align via inline style on the block,
 *   <ul><li><p>…</p></li></ul> / <ol><li><p>…</p>…</li></ol> (nested),
 *   <a href="…">,
 *   checklist: <ul class="checklist"><li class="checklist_task[ is_checked]">…</li></ul>
 *
 * TipTap emits the same tags for everything EXCEPT the checklist, which it
 * renders as <ul data-type="taskList"><li data-type="taskItem" data-checked>…</li>.
 * So we translate the checklist in both directions and sanitise to monday's tag
 * subset on save:
 *   toMondayHtml(editorHtml)  — SAVE: taskList -> ul.checklist, then sanitise
 *   toEditorHtml(mondayHtml)  — LOAD: ul.checklist -> taskList (for TipTap)
 *
 * Pure DOM, no dependencies. Runs in the browser and in jsdom (tests).
 */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL',
  'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'A', 'SPAN', 'HR',
]);

// Elements whose entire subtree must be dropped (never just unwrapped).
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'IFRAME', 'OBJECT', 'EMBED']);

// The only class tokens we preserve (monday's checklist markup).
const CHECKLIST_CLASSES = new Set(['checklist', 'checklist_task', 'is_checked']);

const hasDom = () => typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined';
const parse = (html) => new window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

function unwrap(el) {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

// Strip every attribute except the small, per-tag allow-list:
//  - <a>: a safe href (+ target/rel)
//  - <span>: style color only
//  - block (p/h1-3/li): style text-align only
//  - <ul>/<li>: checklist class tokens only
function scrubAttributes(el) {
  const tag = el.tagName;
  const origStyle = el.getAttribute('style');
  const origClass = el.getAttribute('class');
  const origHref = tag === 'A' ? el.getAttribute('href') : null;

  for (const a of [...el.attributes]) el.removeAttribute(a.name);

  const styleProps = tag === 'SPAN' ? ['color', 'font-size']
    : (tag === 'P' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'LI') ? ['text-align']
      : [];
  if (origStyle && styleProps.length) {
    const kept = [];
    for (const decl of origStyle.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const val = decl.slice(i + 1).trim();
      if (styleProps.includes(prop) && val && !/url\(|expression|javascript:/i.test(val)) {
        kept.push(`${prop}: ${val}`);
      }
    }
    if (kept.length) el.setAttribute('style', kept.join('; '));
  }

  if (origClass && (tag === 'UL' || tag === 'LI')) {
    const tokens = origClass.split(/\s+/).filter((t) => CHECKLIST_CLASSES.has(t));
    if (tokens.length) el.setAttribute('class', tokens.join(' '));
  }

  if (tag === 'A') {
    const href = (origHref || '').trim();
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      el.setAttribute('href', href);
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }
}

function scrub(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8 /* comment */) { child.remove(); continue; }
    if (child.nodeType !== 1 /* element */) continue;

    const tag = child.tagName;
    if (DROP_TAGS.has(tag)) { child.remove(); continue; }

    scrub(child); // depth-first

    if (ALLOWED_TAGS.has(tag)) {
      scrubAttributes(child);
      // drop now-pointless wrappers (a link with no href, a span with no style)
      if ((tag === 'SPAN' && !child.hasAttribute('style')) || (tag === 'A' && !child.hasAttribute('href'))) {
        unwrap(child);
      }
    } else {
      unwrap(child);
    }
  }
}

export function sanitizeSummaryHtml(html) {
  if (!html || typeof html !== 'string') return '';
  if (!hasDom()) return html;
  const doc = parse(html);
  scrub(doc.body);
  return doc.body.innerHTML;
}

// ---- checklist translation ----------------------------------------------

// SAVE: TipTap <ul data-type="taskList"><li data-type="taskItem" data-checked>
//       -> monday <ul class="checklist"><li class="checklist_task[ is_checked]">
function taskListToMonday(root) {
  for (const ul of [...root.querySelectorAll('ul[data-type="taskList"]')]) {
    ul.removeAttribute('data-type');
    ul.setAttribute('class', 'checklist');
    for (const li of [...ul.children]) {
      if (li.tagName !== 'LI') continue;
      const checked = li.getAttribute('data-checked') === 'true';
      // content lives in a wrapper div (TaskItem) -> take its paragraph's inline html
      const contentDiv = li.querySelector(':scope > div');
      const para = (contentDiv || li).querySelector(':scope > p');
      const inner = para ? para.innerHTML : (contentDiv ? contentDiv.innerHTML : li.textContent);
      for (const a of [...li.attributes]) li.removeAttribute(a.name);
      li.setAttribute('class', `checklist_task${checked ? ' is_checked' : ''}`);
      li.innerHTML = inner;
    }
  }
}

// LOAD: monday <ul class="checklist"><li class="checklist_task[ is_checked]">
//       -> TipTap <ul data-type="taskList"><li data-type="taskItem" data-checked><p>…
function mondayToTaskList(root) {
  for (const ul of [...root.querySelectorAll('ul.checklist')]) {
    ul.removeAttribute('class');
    ul.setAttribute('data-type', 'taskList');
    for (const li of [...ul.children]) {
      if (li.tagName !== 'LI') continue;
      const checked = li.classList.contains('is_checked');
      const inner = li.innerHTML;
      for (const a of [...li.attributes]) li.removeAttribute(a.name);
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', checked ? 'true' : 'false');
      li.innerHTML = `<p>${inner}</p>`;
    }
  }
}

/** SAVE boundary: editor HTML -> a clean, monday-compatible Update body. */
export function toMondayHtml(editorHtml) {
  if (!editorHtml || typeof editorHtml !== 'string') return '';
  if (!hasDom()) return editorHtml;
  const doc = parse(editorHtml);
  taskListToMonday(doc.body);
  scrub(doc.body);
  return doc.body.innerHTML;
}

/** LOAD boundary: a monday Update body -> HTML TipTap can parse (checklist). */
export function toEditorHtml(mondayHtml) {
  if (!mondayHtml || typeof mondayHtml !== 'string') return '';
  if (!hasDom()) return mondayHtml;
  const doc = parse(mondayHtml);
  mondayToTaskList(doc.body);
  return doc.body.innerHTML;
}

/**
 * True when the HTML carries no visible text and no structural content — i.e.
 * an "empty" editor (TipTap emits "<p></p>" for empty).
 */
export function isSummaryHtmlEmpty(html) {
  if (!html || typeof html !== 'string') return true;
  if (/<(br|li|img|hr)\b/i.test(html)) return false;
  const text = html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ ​]/g, '')
    .trim();
  return text.length === 0;
}

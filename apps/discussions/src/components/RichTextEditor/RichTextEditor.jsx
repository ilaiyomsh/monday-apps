import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
// round206 — selection bubble (owner request): a dark floating menu with the
// core formatting actions pops over any text selection, so formatting never
// requires scrolling back to the top toolbar.
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Placeholder } from '@tiptap/extension-placeholder';
import { matchMentionQuery, filterMentionRoster } from '@generated/utils/mention.js';
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListChecks,
  Link2, AlignRight, AlignCenter, AlignLeft, AlignJustify, ALargeSmall, ChevronDown, Check,
  Baseline, Search, Plus, Minus,
} from 'lucide-react';
import styles from './RichTextEditor.module.css';

/*
 * Minimal RTL rich-text editor (TipTap v3, headless), aligned to monday's
 * native Update editor so saved HTML renders identically in the Updates feed.
 *
 * UNCONTROLLED: initialised once with `initialValue`; edits reported via
 * onChange(html). The parent re-mounts per discussion, so no mid-edit value sync.
 *
 * Toolbar: icon-only, horizontal. Format icons flow from the left; the font-size
 * picker (16-48px, like monday's "Size") is pinned to the right. Checklist is
 * serialised to monday's `ul.checklist` shape at the save boundary (summaryHtml.js).
 *
 * round253 — the toolbar dropdowns (color / align / size) are PORTALLED to
 * <body> with fixed positioning (like the @-mention popup) so they can never be
 * clipped/overlapped by the editor pane(s) below them (owner report: menus were
 * "swallowed behind the text box"). The link control MOVED off the toolbar into
 * the selection bubble, which also gained font-size ±, text color and alignment.
 */

const SIZE_OPTIONS = [
  { label: '16px', value: '16px' },
  { label: '18px', value: '18px' },
  { label: '24px', value: '24px' },
  { label: '32px', value: '32px' },
  { label: '36px', value: '36px' },
  { label: '48px', value: '48px' },
  { label: 'הסר גודל גופן', value: null },
];

// round253 — the ordered size ladder the bubble's A+/A- steppers walk.
const SIZE_PX = [16, 18, 24, 32, 36, 48];

const COLORS = [
  { label: 'ברירת מחדל', value: null },
  { label: 'אדום', value: '#e44258' },
  { label: 'כתום', value: '#fdab3d' },
  { label: 'ירוק', value: '#00c875' },
  { label: 'כחול', value: '#0073ea' },
  { label: 'סגול', value: '#a25ddc' },
  { label: 'אפור', value: '#676879' },
];

const ALIGNS = [
  { key: 'right', label: 'יישור לימין', Icon: AlignRight },
  { key: 'center', label: 'מרכוז', Icon: AlignCenter },
  { key: 'left', label: 'יישור לשמאל', Icon: AlignLeft },
  { key: 'justify', label: 'יישור לשני הצדדים', Icon: AlignJustify },
];

/*
 * round206 props:
 *   variant='flush'      — the editor loses its own frame and the toolbar
 *                          becomes a flush full-width strip glued to the top of
 *                          the CONTAINER (the triple-box look — no box-in-box).
 *   extraToolbarActions  — node appended at the toolbar's far end (e.g. the
 *                          📎 attach-file action of the triple box).
 */
/*
 * round220 — @-mention (triple box, owner request). Typing "@" opens a popup of
 * discussion participants (`mentionPeople`, ordered lead→coordinator→participants
 * by the caller); filtering by what's typed after the @. Selecting one replaces
 * the "@query" with the participant's name in BOLD (no @) — so it needs NO special
 * serialization or export handling: it's just `<strong>name</strong>` in the saved
 * HTML, which the docx converter already renders bold. Purely additive: with an
 * empty `mentionPeople` (summary / other editors) nothing changes.
 */
export default function RichTextEditor({ initialValue = '', onChange, onReady, placeholder = '', editable = true, variant = 'default', extraToolbarActions = null, mentionPeople = [] }) {
  // Latest closures/data reachable from the editor's create-time callbacks.
  const mentionPeopleRef = useRef(mentionPeople);
  mentionPeopleRef.current = Array.isArray(mentionPeople) ? mentionPeople : [];
  const refreshMentionRef = useRef(() => {});
  const selectMentionRef = useRef(() => {});
  const [mention, setMention] = useState(null); // { items, index, from, to, coords }
  const mentionRef = useRef(null);
  mentionRef.current = mention;

  const editor = useEditor({
    editable,
    onSelectionUpdate: ({ editor: e }) => refreshMentionRef.current(e),
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      }),
      TextStyle,
      FontSize,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder || '' }),
    ],
    content: initialValue || '',
    editorProps: {
      attributes: { class: styles.content, dir: 'rtl', 'aria-label': 'עורך סיכום הדיון' },
      // round220 — intercept nav keys while the @-mention popup is open (before
      // ProseMirror inserts a newline / moves the caret).
      handleKeyDown: (_view, event) => {
        const m = mentionRef.current;
        if (!m) return false;
        if (event.key === 'Escape') { setMention(null); return true; }
        // With zero matches let the editor handle keys normally (Enter breaks the
        // line → the @token ends → the popup clears); only nav/select when there
        // are items to act on.
        if (!m.items.length) return false;
        if (event.key === 'ArrowDown') { setMention((p) => (p ? { ...p, index: (p.index + 1) % p.items.length } : p)); return true; }
        if (event.key === 'ArrowUp') { setMention((p) => (p ? { ...p, index: (p.index - 1 + p.items.length) % p.items.length } : p)); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') { selectMentionRef.current(m.index); return true; }
        return false;
      },
    },
    onCreate: ({ editor }) => onReady?.(editor.getHTML()),
    onUpdate: ({ editor }) => { onChange?.(editor.getHTML()); refreshMentionRef.current(editor); },
  });

  // Keep the editor's editability in sync if the prop flips (e.g. permissions
  // resolve after the discussion's full details load).
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  // Reactive toolbar state (TipTap v3 needs an explicit subscription).
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? {
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      link: e.isActive('link'),
      align: ALIGNS.find((a) => e.isActive({ textAlign: a.key }))?.key || null,
      color: e.getAttributes('textStyle').color || null,
      fontSize: e.getAttributes('textStyle').fontSize || null,
    } : {}),
  }) || {};

  const [menu, setMenu] = useState(null); // 'size' | 'color' | 'align' | null (toolbar dropdowns)
  const [menuAnchor, setMenuAnchor] = useState(null); // { top, left } for the portalled menu
  const barRef = useRef(null);
  const menuPortalRef = useRef(null);
  const mentionPopupRef = useRef(null);

  // round253 — selection-bubble sub-panels (color swatches / link input) render
  // INSIDE the floating bubble so they are never clipped.
  const [bubbleSub, setBubbleSub] = useState(null); // 'color' | 'link' | null
  const [bubbleLinkUrl, setBubbleLinkUrl] = useState('');

  // round220 — recompute the @-mention popup from the caret context. Returns
  // early (clearing any open popup) when there are no mention people, the editor
  // is read-only, or the caret isn't sitting right after an "@token".
  const refreshMention = useCallback((ed) => {
    const people = mentionPeopleRef.current;
    const clear = () => setMention((m) => (m ? null : m));
    if (!ed || !ed.isEditable || !people.length) return clear();
    const sel = ed.state.selection;
    if (!sel.empty) return clear();
    const start = sel.$from.start();
    const textBefore = ed.state.doc.textBetween(start, sel.from, '\n', '\0');
    const match = matchMentionQuery(textBefore);
    if (!match) return clear();
    const from = sel.from - match.query.length - 1; // the "@" position
    const items = filterMentionRoster(people, match.query);
    // sel.from is always a valid document position, so coordsAtPos won't throw.
    const coords = ed.view.coordsAtPos(sel.from);
    // round221 — open to the LEFT of the caret/@ (owner request): anchor the
    // popup's RIGHT edge at the caret x so the list grows leftward, away from
    // the typed text, instead of overlapping it toward the @.
    // round223 — keep the popup open even with zero matches (its search box shows
    // the query + an empty state) so typing keeps narrowing; the token ending
    // (space/backspacing the @) clears it via matchMentionQuery returning null.
    setMention({
      items,
      query: match.query,
      from,
      to: sel.from,
      index: 0,
      coords: { top: coords.bottom + 4, right: Math.max(8, window.innerWidth - coords.left) },
    });
    return undefined;
  }, []);
  refreshMentionRef.current = refreshMention;

  // Replace the "@query" with the chosen participant's name in BOLD (+ a plain
  // trailing space), then close the popup. No @ and no special node — the saved
  // HTML is just <strong>name</strong>, so export renders it bold automatically.
  const selectMention = useCallback((idx) => {
    const m = mentionRef.current;
    if (!m || !editor) return;
    const person = m.items[idx] || m.items[0];
    if (!person) return;
    editor.chain().focus()
      .deleteRange({ from: m.from, to: m.to })
      .insertContent([
        { type: 'text', marks: [{ type: 'bold' }], text: person.name },
        { type: 'text', text: ' ' },
      ])
      .run();
    setMention(null);
  }, [editor]);
  selectMentionRef.current = selectMention;

  // Close the mention popup on an outside click.
  useEffect(() => {
    if (!mention) return undefined;
    const onDown = (e) => {
      if (mentionPopupRef.current && !mentionPopupRef.current.contains(e.target)) setMention(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mention]);

  // Close a toolbar dropdown on outside click / Escape. round253 — the menu is
  // portalled to <body>, so "outside" must also exempt the portalled menu node.
  useEffect(() => {
    if (!menu) return undefined;
    const onDocClick = (e) => {
      const inBar = barRef.current && barRef.current.contains(e.target);
      const inMenu = menuPortalRef.current && menuPortalRef.current.contains(e.target);
      if (!inBar && !inMenu) setMenu(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!editor) return null;

  // Open/close a toolbar dropdown, anchoring the portalled panel just under the
  // trigger button (fixed coords, so no ancestor overflow can clip it).
  const toggleMenu = (name, e) => {
    if (menu === name) { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setMenuAnchor({ top: r.bottom + 4, left: r.left });
    setMenu(name);
  };

  const applySize = (value) => {
    if (value) editor.chain().focus().setFontSize(value).run();
    else editor.chain().focus().unsetFontSize().run();
    setMenu(null);
  };
  // round253 — bubble A+/A- stepper: walk the SIZE_PX ladder from the current
  // size (default 16 when unset). Stepping below the base clears the override.
  const stepSize = (dir) => {
    const cur = st.fontSize ? parseInt(st.fontSize, 10) : 16;
    if (dir > 0) {
      const next = SIZE_PX.find((s) => s > cur);
      if (next) editor.chain().focus().setFontSize(`${next}px`).run();
    } else {
      const prev = [...SIZE_PX].reverse().find((s) => s < cur);
      if (!prev || prev <= 16) editor.chain().focus().unsetFontSize().run();
      else editor.chain().focus().setFontSize(`${prev}px`).run();
    }
  };
  const applyColor = (value) => {
    if (value) editor.chain().focus().setColor(value).run();
    else editor.chain().focus().unsetColor().run();
    setMenu(null);
    setBubbleSub(null);
  };
  const applyAlign = (key) => { editor.chain().focus().setTextAlign(key).run(); setMenu(null); };
  // round253 — link lives ONLY in the selection bubble now. Applying uses the
  // current selection's link range; an empty URL unsets it.
  const applyBubbleLink = () => {
    const url = bubbleLinkUrl.trim();
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    else editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setBubbleSub(null);
  };
  const openBubbleLink = () => {
    if (bubbleSub === 'link') { setBubbleSub(null); return; }
    setBubbleLinkUrl(editor.getAttributes('link').href || '');
    setBubbleSub('link');
  };

  const Btn = ({ onClick, active, label, children }) => (
    <button
      type="button"
      className={`${styles.btn} ${active ? styles.btnActive : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-pressed={!!active}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );

  const ActiveAlignIcon = (ALIGNS.find((a) => a.key === st.align) || ALIGNS[0]).Icon;

  // Swatch grid shared by the toolbar color dropdown and the bubble color panel.
  const renderSwatches = () => (
    <div className={styles.swatches}>
      {COLORS.map((c) => (
        <button
          key={c.label} type="button" title={c.label} aria-label={c.label}
          className={`${styles.swatch} ${(st.color === c.value) || (!st.color && c.value === null) ? styles.swatchActive : ''}`}
          style={{ background: c.value || 'transparent' }}
          onMouseDown={(e) => e.preventDefault()} onClick={() => applyColor(c.value)}
        >
          {c.value === null && <span className={styles.noColor}>A</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`${styles.root} ${variant === 'flush' ? styles.rootFlush : ''}`} dir="rtl">
      {editable && (
      <div className={`${styles.toolbar} ${variant === 'flush' ? styles.toolbarFlush : ''}`} role="toolbar" aria-label="עיצוב טקסט" ref={barRef}>
        <Btn label="מודגש" active={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></Btn>
        <Btn label="נטוי" active={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></Btn>
        <Btn label="קו תחתון" active={st.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={16} /></Btn>
        <Btn label="קו חוצה" active={st.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></Btn>

        {/* color — portalled dropdown (round253) */}
        <div className={styles.menuWrap}>
          <button
            type="button" className={styles.btn} onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => toggleMenu('color', e)}
            aria-haspopup="true" aria-expanded={menu === 'color'} aria-label="צבע טקסט" title="צבע טקסט"
          >
            <Baseline size={16} style={st.color ? { color: st.color } : undefined} />
          </button>
        </div>

        <span className={styles.divider} aria-hidden="true" />

        <Btn label="רשימת תבליטים" active={st.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></Btn>
        <Btn label="רשימה ממוספרת" active={st.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></Btn>
        <Btn label="צ׳קליסט" active={st.task} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={16} /></Btn>

        {/* alignment — portalled dropdown (round253) */}
        <div className={styles.menuWrap}>
          <button
            type="button" className={styles.btn} onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => toggleMenu('align', e)}
            aria-haspopup="true" aria-expanded={menu === 'align'} aria-label="יישור" title="יישור"
          >
            <ActiveAlignIcon size={16} />
          </button>
        </div>

        {/* font size — portalled dropdown (round253) */}
        <div className={styles.menuWrap}>
          <button
            type="button" className={styles.btn} onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => toggleMenu('size', e)}
            aria-haspopup="listbox" aria-expanded={menu === 'size'} aria-label="גודל טקסט" title="גודל טקסט"
          >
            <ALargeSmall size={18} /><ChevronDown size={13} />
          </button>
        </div>

        {/* round206 — host-provided actions (e.g. 📎 attach) pinned to the
            toolbar's far end. */}
        {extraToolbarActions && <span className={styles.toolbarExtra}>{extraToolbarActions}</span>}
      </div>
      )}

      {/* round253 — the active toolbar dropdown, portalled to <body> at fixed
          coords so the editor pane(s) below can never overlap/clip it. */}
      {editable && menu && menuAnchor && createPortal(
        <div
          ref={menuPortalRef}
          className={`${styles.menu} ${styles.menuPortal}`}
          style={{ position: 'fixed', top: menuAnchor.top, left: menuAnchor.left, zIndex: 10002 }}
          role={menu === 'color' ? undefined : 'listbox'}
        >
          {menu === 'color' && renderSwatches()}
          {menu === 'align' && (
            <ul className={styles.menuList} role="listbox">
              {ALIGNS.map((a) => (
                <li key={a.key}>
                  <button
                    type="button" role="option" aria-selected={st.align === a.key}
                    className={`${styles.menuItem} ${st.align === a.key ? styles.menuItemActive : ''}`}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => applyAlign(a.key)}
                  >
                    <a.Icon size={15} /><span>{a.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {menu === 'size' && (
            <ul className={styles.menuList} role="listbox">
              {SIZE_OPTIONS.map((opt) => (
                <li key={opt.label}>
                  <button
                    type="button" role="option" aria-selected={st.fontSize === opt.value}
                    className={`${styles.menuItem} ${st.fontSize === opt.value ? styles.menuItemActive : ''}`}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => applySize(opt.value)}
                  >
                    <span>{opt.label}</span>{st.fontSize === opt.value && <Check size={14} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>,
        document.body
      )}

      {/* round206/253 — selection bubble: core formatting over any selection,
          now also font-size ±, text color, alignment and the link control
          (owner request: link is added HERE, on selection, not on the toolbar). */}
      {editable && (
        <BubbleMenu editor={editor} className={styles.bubble} options={{ placement: 'top' }}>
          <div className={styles.bubbleRow}>
            <Btn label="מודגש" active={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></Btn>
            <Btn label="נטוי" active={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></Btn>
            <Btn label="קו תחתון" active={st.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={15} /></Btn>
            <Btn label="קו חוצה" active={st.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></Btn>
            <span className={styles.bubbleSep} aria-hidden="true" />
            {/* font size ± (round253) */}
            <Btn label="הקטן גופן" onClick={() => stepSize(-1)}><Minus size={15} /></Btn>
            <span className={styles.bubbleSizeVal} aria-hidden="true">{st.fontSize ? parseInt(st.fontSize, 10) : 16}</span>
            <Btn label="הגדל גופן" onClick={() => stepSize(1)}><Plus size={15} /></Btn>
            <span className={styles.bubbleSep} aria-hidden="true" />
            {/* text color (round253) — toggles a swatch row inside the bubble */}
            <Btn label="צבע טקסט" active={bubbleSub === 'color'} onClick={() => setBubbleSub(bubbleSub === 'color' ? null : 'color')}>
              <Baseline size={15} style={st.color ? { color: st.color } : undefined} />
            </Btn>
            <span className={styles.bubbleSep} aria-hidden="true" />
            {/* alignment (round253) — inline buttons, no dropdown */}
            {ALIGNS.map((a) => (
              <Btn key={a.key} label={a.label} active={st.align === a.key} onClick={() => editor.chain().focus().setTextAlign(a.key).run()}>
                <a.Icon size={15} />
              </Btn>
            ))}
            <span className={styles.bubbleSep} aria-hidden="true" />
            {/* link (round253) — moved here from the toolbar */}
            <Btn label="קישור" active={st.link || bubbleSub === 'link'} onClick={openBubbleLink}><Link2 size={15} /></Btn>
            <span className={styles.bubbleSep} aria-hidden="true" />
            <Btn label="רשימת תבליטים" active={st.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></Btn>
            <Btn label="רשימה ממוספרת" active={st.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></Btn>
            <Btn label="צ׳קליסט" active={st.task} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={15} /></Btn>
          </div>
          {bubbleSub === 'color' && (
            <div className={styles.bubbleSubRow} dir="rtl">{renderSwatches()}</div>
          )}
          {bubbleSub === 'link' && (
            <div className={styles.bubbleSubRow}>
              <input
                type="url" className={styles.linkInput} placeholder="https://…" value={bubbleLinkUrl}
                autoFocus dir="ltr"
                onChange={(e) => setBubbleLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyBubbleLink(); } }}
              />
              <button type="button" className={styles.linkApply} onMouseDown={(e) => e.preventDefault()} onClick={applyBubbleLink}>
                {bubbleLinkUrl.trim() ? 'החל' : 'הסר'}
              </button>
            </div>
          )}
        </BubbleMenu>
      )}

      <EditorContent editor={editor} className={styles.editorWrap} />

      {/* round220 — @-mention popup: participant list at the caret. Portalled so
          the pane's overflow never clips it. Keyboard nav is handled in the
          editor's handleKeyDown; mousedown selects without stealing focus. */}
      {editable && mention && createPortal(
        <div
          ref={mentionPopupRef}
          className={styles.mentionPopup}
          style={{ position: 'fixed', top: mention.coords.top, right: mention.coords.right, zIndex: 10002 }}
        >
          {/* round223 — a search box pinned at the TOP that mirrors the query
              typed after @ (the editor keeps focus, so the FIRST letter lands
              here automatically — no click needed — and the list narrows). */}
          <div className={styles.mentionSearch}>
            <Search size={14} aria-hidden="true" />
            {mention.query
              ? <span className={styles.mentionSearchText}>{mention.query}</span>
              : <span className={styles.mentionSearchPh}>הקלידו כדי לסנן…</span>}
          </div>
          <ul className={styles.mentionList} role="listbox" aria-label="תיוג משתתף">
            {mention.items.length === 0 ? (
              <li className={styles.mentionEmpty}>אין תוצאות</li>
            ) : mention.items.map((p, i) => (
              <li key={p.id ?? p.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === mention.index}
                  className={`${styles.mentionItem} ${i === mention.index ? styles.mentionItemActive : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); selectMention(i); }}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}

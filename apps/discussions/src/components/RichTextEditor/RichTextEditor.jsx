import React, { useEffect, useRef, useState } from 'react';
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
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListChecks,
  Link2, AlignRight, AlignCenter, AlignLeft, AlignJustify, ALargeSmall, ChevronDown, Check, Baseline,
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
export default function RichTextEditor({ initialValue = '', onChange, onReady, placeholder = '', editable = true, variant = 'default', extraToolbarActions = null }) {
  const editor = useEditor({
    editable,
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
    },
    onCreate: ({ editor }) => onReady?.(editor.getHTML()),
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
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

  const [menu, setMenu] = useState(null); // 'size' | 'color' | 'align' | 'link' | null
  const [linkUrl, setLinkUrl] = useState('');
  const barRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const onDocClick = (e) => { if (barRef.current && !barRef.current.contains(e.target)) setMenu(null); };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!editor) return null;

  const applySize = (value) => {
    if (value) editor.chain().focus().setFontSize(value).run();
    else editor.chain().focus().unsetFontSize().run();
    setMenu(null);
  };
  const applyColor = (value) => {
    if (value) editor.chain().focus().setColor(value).run();
    else editor.chain().focus().unsetColor().run();
    setMenu(null);
  };
  const applyAlign = (key) => { editor.chain().focus().setTextAlign(key).run(); setMenu(null); };
  const openLink = () => { setLinkUrl(editor.getAttributes('link').href || ''); setMenu(menu === 'link' ? null : 'link'); };
  const applyLink = () => {
    const url = linkUrl.trim();
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    else editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setMenu(null);
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

  return (
    <div className={`${styles.root} ${variant === 'flush' ? styles.rootFlush : ''}`} dir="rtl">
      {editable && (
      <div className={`${styles.toolbar} ${variant === 'flush' ? styles.toolbarFlush : ''}`} role="toolbar" aria-label="עיצוב טקסט" ref={barRef}>
        <Btn label="מודגש" active={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></Btn>
        <Btn label="נטוי" active={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></Btn>
        <Btn label="קו תחתון" active={st.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={16} /></Btn>
        <Btn label="קו חוצה" active={st.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></Btn>

        {/* color */}
        <div className={styles.menuWrap}>
          <button
            type="button" className={styles.btn} onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMenu(menu === 'color' ? null : 'color')}
            aria-haspopup="true" aria-expanded={menu === 'color'} aria-label="צבע טקסט" title="צבע טקסט"
          >
            <Baseline size={16} style={st.color ? { color: st.color } : undefined} />
          </button>
          {menu === 'color' && (
            <div className={styles.menu}>
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
            </div>
          )}
        </div>

        <span className={styles.divider} aria-hidden="true" />

        <Btn label="רשימת תבליטים" active={st.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></Btn>
        <Btn label="רשימה ממוספרת" active={st.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></Btn>
        <Btn label="צ׳קליסט" active={st.task} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={16} /></Btn>

        {/* alignment */}
        <div className={styles.menuWrap}>
          <button
            type="button" className={styles.btn} onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMenu(menu === 'align' ? null : 'align')}
            aria-haspopup="true" aria-expanded={menu === 'align'} aria-label="יישור" title="יישור"
          >
            <ActiveAlignIcon size={16} />
          </button>
          {menu === 'align' && (
            <ul className={styles.menu} role="listbox">
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
        </div>

        {/* link */}
        <div className={styles.menuWrap}>
          <Btn label="קישור" active={st.link} onClick={openLink}><Link2 size={16} /></Btn>
          {menu === 'link' && (
            <div className={`${styles.menu} ${styles.linkMenu}`}>
              <input
                type="url" className={styles.linkInput} placeholder="https://…" value={linkUrl}
                autoFocus dir="ltr"
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } }}
              />
              <button type="button" className={styles.linkApply} onMouseDown={(e) => e.preventDefault()} onClick={applyLink}>
                {linkUrl.trim() ? 'החל' : 'הסר'}
              </button>
            </div>
          )}
        </div>

        {/* font size — grouped with the other buttons */}
        <div className={styles.menuWrap}>
          <button
            type="button" className={styles.btn} onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMenu(menu === 'size' ? null : 'size')}
            aria-haspopup="listbox" aria-expanded={menu === 'size'} aria-label="גודל טקסט" title="גודל טקסט"
          >
            <ALargeSmall size={18} /><ChevronDown size={13} />
          </button>
          {menu === 'size' && (
            <ul className={styles.menu} role="listbox">
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
        </div>

        {/* round206 — host-provided actions (e.g. 📎 attach) pinned to the
            toolbar's far end. */}
        {extraToolbarActions && <span className={styles.toolbarExtra}>{extraToolbarActions}</span>}
      </div>
      )}

      {/* round206 — selection bubble: core formatting over any selection. */}
      {editable && (
        <BubbleMenu editor={editor} className={styles.bubble} options={{ placement: 'top' }}>
          <Btn label="מודגש" active={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></Btn>
          <Btn label="נטוי" active={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></Btn>
          <Btn label="קו תחתון" active={st.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={15} /></Btn>
          <Btn label="קו חוצה" active={st.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></Btn>
          <span className={styles.bubbleSep} aria-hidden="true" />
          <Btn label="רשימת תבליטים" active={st.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></Btn>
          <Btn label="רשימה ממוספרת" active={st.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></Btn>
          <Btn label="צ׳קליסט" active={st.task} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={15} /></Btn>
        </BubbleMenu>
      )}

      <EditorContent editor={editor} className={styles.editorWrap} />
    </div>
  );
}

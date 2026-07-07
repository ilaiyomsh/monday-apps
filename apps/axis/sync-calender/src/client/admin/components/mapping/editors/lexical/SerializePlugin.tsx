import type { MutableRefObject } from 'react';
import { useRef } from 'react';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import type { EditorState } from 'lexical';
import { $getRoot, $isTextNode } from 'lexical';
import { $isVariableNode } from './VariableNode';
import type { ColumnMappingEntry, TemplateToken } from '../../../../types';

type TemplateEntryType = Extract<
  ColumnMappingEntry,
  { type: 'text' | 'long_text' | 'email_simple' | 'phone_simple' }
>['type'];

interface Props {
  entryType: TemplateEntryType;
  onChange: (next: ColumnMappingEntry | null) => void;
  /**
   * Shared with HydrationPlugin — updated here after each real emit so
   * HydrationPlugin doesn't re-hydrate content that originated from the
   * editor itself.
   */
  lastSerializedRef: MutableRefObject<TemplateToken[]>;
}

export function SerializePlugin({ entryType, onChange, lastSerializedRef }: Props): null {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (editorState: EditorState): void => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;

      editorState.read(() => {
        const root = $getRoot();
        const paragraphs = root.getChildren();
        const tokens: TemplateToken[] = [];

        const pushText = (value: string) => {
          if (value === '') return;
          const last = tokens[tokens.length - 1];
          if (last && last.kind === 'text') {
            tokens[tokens.length - 1] = { kind: 'text', value: last.value + value };
          } else {
            tokens.push({ kind: 'text', value });
          }
        };

        paragraphs.forEach((para, idx) => {
          if ('getChildren' in para && typeof para.getChildren === 'function') {
            for (const child of para.getChildren()) {
              if ($isVariableNode(child)) {
                tokens.push({ kind: 'var', value: child.__source });
              } else if ($isTextNode(child)) {
                pushText(child.getTextContent());
              }
            }
          }
          // Preserve paragraph breaks in long_text; single-line types never
          // produce multiple paragraphs because SingleLinePlugin blocks Enter.
          if (idx < paragraphs.length - 1) pushText('\n');
        });

        if (JSON.stringify(tokens) === JSON.stringify(lastSerializedRef.current)) return;
        lastSerializedRef.current = tokens;

        const isEmpty = tokens.length === 0 ||
          tokens.every((t) => t.kind === 'text' && t.value.trim() === '');

        onChange(isEmpty ? null : { type: entryType, tokens });
      });
    }, 500);
  };

  return (
    <OnChangePlugin
      onChange={handleChange}
      ignoreSelectionChange
    />
  );
}

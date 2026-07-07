import type { MutableRefObject } from 'react';
import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
} from 'lexical';
import { $createVariableNode } from './VariableNode';
import type { TemplateToken } from '../../../../types';

interface Props {
  tokens: TemplateToken[];
  /**
   * Shared ref with SerializePlugin — tracks the last serialized token list so
   * we don't re-hydrate when the editor's own onChange triggers a parent
   * re-render that passes back the same tokens.
   */
  lastSerializedRef: MutableRefObject<TemplateToken[]>;
}

export function HydrationPlugin({ tokens, lastSerializedRef }: Props): null {
  const [editor] = useLexicalComposerContext();
  // Track which token array we last wrote into the editor
  const lastHydratedRef = useRef<string>('');

  useEffect(() => {
    const serialized = JSON.stringify(tokens);
    // Skip if the editor already contains exactly this content (either because
    // we just hydrated it, or because SerializePlugin just emitted it)
    if (serialized === lastHydratedRef.current) return;
    if (serialized === JSON.stringify(lastSerializedRef.current)) return;

    lastHydratedRef.current = serialized;

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      let para = $createParagraphNode();
      root.append(para);
      for (const token of tokens) {
        if (token.kind === 'var') {
          para.append($createVariableNode(token.value));
          continue;
        }
        // Split text tokens on '\n' — each split boundary starts a new
        // paragraph so long_text round-trips multi-line content correctly.
        const parts = token.value.split('\n');
        parts.forEach((part, idx) => {
          if (part !== '') para.append($createTextNode(part));
          if (idx < parts.length - 1) {
            para = $createParagraphNode();
            root.append(para);
          }
        });
      }
    });
  }, [editor, tokens, lastSerializedRef]);

  return null;
}

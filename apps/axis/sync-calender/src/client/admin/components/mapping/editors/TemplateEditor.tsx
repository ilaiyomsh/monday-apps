import { useMemo, useRef, useEffect } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Flex } from '@vibe/core';
import type { Column, ColumnMappingEntry, TemplateToken } from '../../../types';
import { bucketFor } from '../../../lib/mappingEntry';
import { VariableNode } from './lexical/VariableNode';
import { SingleLinePlugin } from './lexical/SingleLinePlugin';
import { HydrationPlugin } from './lexical/HydrationPlugin';
import { SerializePlugin } from './lexical/SerializePlugin';
import { InsertVariableMenu } from './lexical/InsertVariableMenu';

type TemplateEntryType = 'text' | 'long_text' | 'email_simple' | 'phone_simple';

function isTemplateEntryType(b: string | null): b is TemplateEntryType {
  return b === 'text' || b === 'long_text' || b === 'email_simple' || b === 'phone_simple';
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  entry: ColumnMappingEntry | null;
  column: Column;
  disabled?: boolean;
  onChange: (next: ColumnMappingEntry | null) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokensFromEntry(entry: ColumnMappingEntry | null): TemplateToken[] {
  if (!entry) return [];
  switch (entry.type) {
    case 'text':
    case 'long_text':
    case 'email_simple':
    case 'phone_simple':
      return entry.tokens;
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Inner editor (inside LexicalComposer — has access to context)
// ---------------------------------------------------------------------------

interface InnerProps {
  column: Column;
  entryType: TemplateEntryType;
  tokens: TemplateToken[];
  disabled: boolean;
  onChange: (next: ColumnMappingEntry | null) => void;
  lastSerializedRef: ReturnType<typeof useRef<TemplateToken[]>>;
}

function EditorInner({ column, entryType, tokens, disabled, onChange, lastSerializedRef }: InnerProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const multiLine = entryType === 'long_text';

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <Flex gap="xs" align="center" style={{ width: '100%' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              ariaLabel={`${column.title} template`}
              ariaMultiline={multiLine}
              style={{
                flex: 1,
                minHeight: multiLine ? 60 : 28,
                padding: '4px 8px',
                border: '1px solid var(--layout-border-color, #e6e9ef)',
                borderRadius: 4,
                fontSize: 13,
                lineHeight: '20px',
                background: disabled
                  ? 'var(--disabled-background-color, #f5f6f8)'
                  : 'transparent',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                outline: 'none',
              }}
              data-disabled={disabled || undefined}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>

      <HistoryPlugin />
      {!multiLine && <SingleLinePlugin />}
      <HydrationPlugin tokens={tokens} lastSerializedRef={lastSerializedRef} />
      <SerializePlugin entryType={entryType} onChange={onChange} lastSerializedRef={lastSerializedRef} />

      <InsertVariableMenu disabled={disabled} />
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// TemplateEditor — public component
// ---------------------------------------------------------------------------

export function TemplateEditor({ entry, column, disabled = false, onChange }: Props): JSX.Element | null {
  const bucket = bucketFor(column.type);
  const lastSerializedRef = useRef<TemplateToken[]>([]);

  const initialConfig = useMemo(
    () => ({
      namespace: 'mapping-template',
      nodes: [VariableNode],
      onError: (e: Error) => {
        console.error('[TemplateEditor]', e);
      },
      theme: {},
    }),
    []
  );

  if (!isTemplateEntryType(bucket)) {
    // Defensive — EditorDispatcher already routes non-template buckets away.
    return null;
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <EditorInner
        column={column}
        entryType={bucket}
        tokens={tokensFromEntry(entry)}
        disabled={disabled}
        onChange={onChange}
        lastSerializedRef={lastSerializedRef}
      />
    </LexicalComposer>
  );
}

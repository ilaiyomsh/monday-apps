import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH } from 'lexical';

/**
 * Blocks the Enter key so the editor stays single-line.
 * Install this inside LexicalComposer for column type 'text'.
 * T6 will omit it for 'long_text' to enable multi-line editing.
 */
export function SingleLinePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => true, // return true = command handled, prevents default newline
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  return null;
}

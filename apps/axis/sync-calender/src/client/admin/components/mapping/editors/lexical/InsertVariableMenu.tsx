import { Menu, MenuButton, MenuItem } from '@vibe/core';
import { Add } from '@vibe/icons';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $insertNodes, $getSelection, $isRangeSelection, $createTextNode } from 'lexical';
import { $createVariableNode } from './VariableNode';
import { SOURCE_FIELD_LABELS, SOURCE_FIELDS_ORDERED } from '../../../../lib/sourceFields';
import logger from '../../../../lib/logger';
import type { SourceField } from '../../../../types';

interface Props {
  disabled?: boolean;
}

export function InsertVariableMenu({ disabled }: Props): JSX.Element {
  const [editor] = useLexicalComposerContext();

  const insert = (source: SourceField): void => {
    try {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          // Insert at the current selection
          selection.insertNodes([$createVariableNode(source)]);
        } else {
          // No selection — append to end of document
          $insertNodes([$createTextNode(''), $createVariableNode(source)]);
        }
      });
      // Return focus to editor so the user can keep typing
      editor.focus();
    } catch (err) {
      // Synthetic event handler — the React error boundary does not catch throws from
      // event handlers, so a failed variable insert would otherwise be silent.
      logger.error('template_editor', 'insert_variable_failed', err);
    }
  };

  return (
    <MenuButton
      ariaLabel="Insert variable"
      size="small"
      disabled={disabled}
      component={Add}
    >
      <Menu id="insert-variable-menu" size="medium">
        {SOURCE_FIELDS_ORDERED.map((field) => (
          <MenuItem
            key={field}
            title={SOURCE_FIELD_LABELS[field]}
            onClick={() => insert(field)}
          />
        ))}
      </Menu>
    </MenuButton>
  );
}

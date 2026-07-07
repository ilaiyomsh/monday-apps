import type { JSX } from 'react';
import type {
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  SerializedLexicalNode,
} from 'lexical';
import { DecoratorNode, $applyNodeReplacement } from 'lexical';
import { VariableChip } from './VariableChip';
import type { SourceField } from '../../../../types';

// ---------------------------------------------------------------------------
// Serialized shape
// ---------------------------------------------------------------------------

export type SerializedVariableNode = SerializedLexicalNode & {
  source: SourceField;
  type: 'variable';
  version: 1;
};

// ---------------------------------------------------------------------------
// VariableNode — inline DecoratorNode for a variable chip
// ---------------------------------------------------------------------------

export class VariableNode extends DecoratorNode<JSX.Element> {
  __source: SourceField;

  static getType(): string {
    return 'variable';
  }

  static clone(node: VariableNode): VariableNode {
    return new VariableNode(node.__source, node.__key);
  }

  constructor(source: SourceField, key?: string) {
    super(key);
    this.__source = source;
  }

  // Required by Lexical to rebuild from JSON
  static importJSON(serializedNode: SerializedVariableNode): VariableNode {
    return $createVariableNode(serializedNode.source);
  }

  exportJSON(): SerializedVariableNode {
    return {
      type: 'variable',
      version: 1,
      source: this.__source,
    };
  }

  // Inline, so it lives inside a paragraph alongside text nodes
  isInline(): boolean {
    return true;
  }

  // Isolated so cursor doesn't step inside the chip
  isIsolated(): boolean {
    return true;
  }

  // The DOM wrapper for the decorator portal
  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    return span;
  }

  // Never needs DOM update — chip is rendered by React via decorate()
  updateDOM(): boolean {
    return false;
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): JSX.Element {
    return <VariableChip source={this.__source} />;
  }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

export function $createVariableNode(source: SourceField): VariableNode {
  return $applyNodeReplacement(new VariableNode(source));
}

export function $isVariableNode(
  node: LexicalNode | null | undefined
): node is VariableNode {
  return node instanceof VariableNode;
}

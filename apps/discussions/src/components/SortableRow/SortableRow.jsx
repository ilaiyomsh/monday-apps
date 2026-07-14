import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/*
 * Whole-row drag handle for the flat data tables (Tasks / Previous / Decisions),
 * mirroring TopicPointRow's native-monday feel: the ENTIRE row is the drag
 * handle (no six-dot grip). dnd-kit's PointerSensor activation distance (set on
 * the parent DndContext, ~8px) means a small press-move starts a drag while a
 * plain click still edits a cell; interactive cells stopPropagation so their
 * clicks never start a drag.
 *
 * It exposes the sortable bits to a render-prop child so the child can spread
 * the ref/listeners/style onto its EXISTING row root element (no extra wrapper
 * div — keeps the CSS grid row intact).
 *
 * Props:
 *   id       — the row's stable id (string).
 *   disabled — when true, no drag (read-only / temp row); child renders normally.
 *   children — (renderProps) => ReactNode, renderProps =
 *              { setNodeRef, style, attributes, listeners, dragging }.
 */
export function SortableRow({ id, disabled = false, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(id), disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    // A dragged row floats above its siblings so it isn't clipped by the sticky
    // frozen name cell during the move.
    zIndex: isDragging ? 3 : undefined,
    position: isDragging ? 'relative' : undefined,
  };
  return children({
    setNodeRef,
    style,
    attributes: disabled ? {} : attributes,
    listeners: disabled ? {} : listeners,
    dragging: isDragging,
  });
}

export default SortableRow;

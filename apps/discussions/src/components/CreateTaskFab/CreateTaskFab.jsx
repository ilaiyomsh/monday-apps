import { Add } from '@vibe/icons';
import styles from './CreateTaskFab.module.css';

/**
 * Floating action button — white plus in a blue circle, pinned bottom-right.
 * Mounted only inside a selected discussion, on the "נושאים" (topics) tab
 * (see DiscussionCard).
 */
export function CreateTaskFab({ onClick }) {
  return (
    <button type="button" className={styles.fab} onClick={onClick} aria-label="משימה חדשה">
      <Add />
    </button>
  );
}

export default CreateTaskFab;

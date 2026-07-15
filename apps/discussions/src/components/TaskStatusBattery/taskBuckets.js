// Round 81 — the quick-filter "battery": three task buckets shown as colored
// count chips (top-right of the tasks views), each a one-click filter.
//   open    (פתוחות)  — NOT done                     — orange
//   done    (בוצעו)    — status in the done set        — green
//   delayed (בעיכוב)   — deadline passed AND not done   — red  (a SUBSET of open)
// Reuses the EffectivenessTab's business definitions so "done"/"delayed" mean
// exactly the same thing across the app.
import { isDelayed } from '../EffectivenessTab/effectiveness.js';

export const TASK_BUCKETS = ['open', 'done', 'delayed'];

export const BUCKET_META = {
  open: { label: 'פתוחות', color: '#fdab3d' },
  done: { label: 'בוצעו', color: '#00c875' },
  delayed: { label: 'בעיכוב', color: '#e2445c' },
};

// Is this task "done"? (status label id is in the done set). Label id 0 is a
// valid status, so compare by null, not truthiness.
export function isDone(task, doneStatusIds) {
  return task?.statusID != null && doneStatusIds.has(Number(task.statusID));
}

// Does a task belong to `bucket`? open = not done; done = done; delayed = past
// deadline and not done. (A delayed task is also counted as open.)
export function taskInBucket(task, bucket, doneStatusIds, todayStart) {
  if (bucket === 'done') return isDone(task, doneStatusIds);
  if (bucket === 'open') return !isDone(task, doneStatusIds);
  if (bucket === 'delayed') return isDelayed(task, doneStatusIds, todayStart);
  return true;
}

// Count each bucket over a task list — { open, done, delayed }.
export function countBuckets(tasks, doneStatusIds, todayStart) {
  const list = Array.isArray(tasks) ? tasks : [];
  const counts = { open: 0, done: 0, delayed: 0 };
  for (const t of list) {
    if (isDone(t, doneStatusIds)) counts.done += 1;
    else {
      counts.open += 1;
      if (isDelayed(t, doneStatusIds, todayStart)) counts.delayed += 1;
    }
  }
  return counts;
}

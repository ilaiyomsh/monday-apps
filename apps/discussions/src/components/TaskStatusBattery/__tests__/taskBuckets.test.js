import { describe, it, expect } from 'vitest';
import { isDone, taskInBucket, countBuckets, BUCKET_META } from '../taskBuckets.js';

const DONE = new Set([2]); // status id 2 = "done"
const TODAY = new Date('2026-07-15T00:00:00');
const past = new Date('2026-07-10T00:00:00');
const future = new Date('2026-07-20T00:00:00');

// tasks
const openNoDeadline = { id: 'a', statusID: 1, deadlineID: null };
const doneTask = { id: 'b', statusID: 2, deadlineID: past }; // done → never delayed/open
const delayedTask = { id: 'c', statusID: 1, deadlineID: past }; // open + delayed
const openFuture = { id: 'd', statusID: 1, deadlineID: future }; // open, not delayed
const donePastZeroStatus = { id: 'e', statusID: 0, deadlineID: past }; // status 0 not in done set → open+delayed

describe('isDone', () => {
  it('true only when the status id is in the done set (id 0 respected as a real status)', () => {
    expect(isDone(doneTask, DONE)).toBe(true);
    expect(isDone(openNoDeadline, DONE)).toBe(false);
    expect(isDone({ statusID: null }, DONE)).toBe(false);
    expect(isDone(donePastZeroStatus, new Set([0]))).toBe(true);
  });
});

describe('taskInBucket', () => {
  it('done bucket = done tasks only', () => {
    expect(taskInBucket(doneTask, 'done', DONE, TODAY)).toBe(true);
    expect(taskInBucket(delayedTask, 'done', DONE, TODAY)).toBe(false);
  });
  it('open bucket = every NOT-done task (incl. delayed)', () => {
    expect(taskInBucket(delayedTask, 'open', DONE, TODAY)).toBe(true);
    expect(taskInBucket(openFuture, 'open', DONE, TODAY)).toBe(true);
    expect(taskInBucket(doneTask, 'open', DONE, TODAY)).toBe(false);
  });
  it('delayed bucket = past-deadline AND not done', () => {
    expect(taskInBucket(delayedTask, 'delayed', DONE, TODAY)).toBe(true);
    expect(taskInBucket(openFuture, 'delayed', DONE, TODAY)).toBe(false); // future deadline
    expect(taskInBucket(doneTask, 'delayed', DONE, TODAY)).toBe(false);   // done, even if past
  });
});

describe('countBuckets', () => {
  it('counts open (incl. delayed), done, and delayed', () => {
    const counts = countBuckets(
      [openNoDeadline, doneTask, delayedTask, openFuture],
      DONE, TODAY
    );
    // open: a, c, d = 3 ; done: b = 1 ; delayed: c = 1
    expect(counts).toEqual({ open: 3, done: 1, delayed: 1 });
  });
  it('a done task is never counted as open or delayed even with a past deadline', () => {
    expect(countBuckets([doneTask], DONE, TODAY)).toEqual({ open: 0, done: 1, delayed: 0 });
  });
  it('tolerates a non-array input', () => {
    expect(countBuckets(null, DONE, TODAY)).toEqual({ open: 0, done: 0, delayed: 0 });
  });
});

describe('BUCKET_META colors', () => {
  it('open=orange, done=green, delayed=red', () => {
    expect(BUCKET_META.open.color).toBe('#fdab3d');
    expect(BUCKET_META.done.color).toBe('#00c875');
    expect(BUCKET_META.delayed.color).toBe('#e2445c');
  });
});

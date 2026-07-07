import type { Policy } from '../types';
import { isMeaningful } from './mappingEntry';

export interface SetupProgress {
  hasBoard: boolean;
  hasLink: boolean;
  hasLock: boolean;
  mappedCount: number;
  complete: boolean;
}

export function deriveSetupProgress(policy: Policy | null): SetupProgress {
  if (!policy) {
    return { hasBoard: false, hasLink: false, hasLock: false, mappedCount: 0, complete: false };
  }
  const hasBoard = Boolean(policy.boardId);
  const hasLink = Boolean(policy.linkColumnId);
  const hasLock = Boolean(policy.lockColumnId);
  const mappedCount = Object.values(policy.columnMapping || {}).filter(isMeaningful).length;
  return { hasBoard, hasLink, hasLock, mappedCount, complete: hasBoard && hasLink && hasLock };
}

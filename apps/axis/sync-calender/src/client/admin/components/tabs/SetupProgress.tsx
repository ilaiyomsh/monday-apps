import { Chips, Flex } from '@vibe/core';
import { deriveSetupProgress } from '../../lib/setupProgress';
import type { Policy, Column } from '../../types';

interface Props {
  policy: Policy | null;
  columns: Column[];
}

export function SetupProgress({ policy, columns }: Props) {
  const { hasBoard, hasLink, hasLock, mappedCount } = deriveSetupProgress(policy);
  const total = columns.length;
  return (
    <Flex gap={Flex.gaps.SMALL} align={Flex.align.CENTER} style={{ marginBottom: 12 }}>
      <Chips
        label={hasBoard ? 'Board: set' : 'Board: not set'}
        color={hasBoard ? 'positive' : 'primary'}
        readOnly
        noAnimation
      />
      <Chips
        label={hasLink ? 'Link: set' : 'Link: not set'}
        color={hasLink ? 'positive' : 'primary'}
        readOnly
        noAnimation
      />
      <Chips
        label={hasLock ? 'Lock: set' : 'Lock: not set'}
        color={hasLock ? 'positive' : 'primary'}
        readOnly
        noAnimation
      />
      <Chips
        label={`Mapping ${mappedCount}${total ? `/${total}` : ''}`}
        color={mappedCount > 0 ? 'positive' : 'primary'}
        readOnly
        noAnimation
      />
    </Flex>
  );
}

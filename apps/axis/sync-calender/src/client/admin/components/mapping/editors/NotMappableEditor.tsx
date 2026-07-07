import { Text } from '@vibe/core';

interface Props {
  reason?: string;
}

export function NotMappableEditor({ reason }: Props) {
  return (
    <Text type="text2" color="secondary">
      {reason ?? 'This column type is not yet mappable.'}
    </Text>
  );
}

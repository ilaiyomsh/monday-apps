import { Button, Flex, Text } from '@vibe/core';

interface Props {
  onReset: () => void;
}

export function StaleMappingRow({ onReset }: Props) {
  return (
    <Flex gap="small" align="center">
      <Text type="text2" color="secondary">
        Column type changed since this was mapped.
      </Text>
      <Button size="small" kind="tertiary" onClick={onReset}>
        Reset
      </Button>
    </Flex>
  );
}

interface Props {
  height?: number;
  width?: number | string;
  rounded?: number;
}

export function Skeleton({ height = 16, width = '100%', rounded = 4 }: Props) {
  return (
    <span
      style={{
        display: 'inline-block',
        height,
        width,
        borderRadius: rounded,
        background: 'linear-gradient(90deg, #eef0f5 0%, #f6f7fb 50%, #eef0f5 100%)',
        backgroundSize: '200% 100%',
        animation: 'admin-skeleton 1.2s ease-in-out infinite',
      }}
    />
  );
}

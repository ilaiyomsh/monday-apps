/** MiniLoader — small inline spinner for buttons and compact loading states. */
export interface MiniLoaderProps {
  size?: number;
  className?: string;
}

export function MiniLoader({ size = 16, className }: MiniLoaderProps) {
  return (
    <span
      className={['mini-loader', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

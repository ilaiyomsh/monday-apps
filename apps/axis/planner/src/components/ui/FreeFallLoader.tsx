import React, { useEffect, useRef, useCallback, useState } from 'react';

interface FreeFallLoaderProps {
  size?: number;
  className?: string;
}

// Loader bar colors map to unified status tokens (see tokens.css).
// was: green=#00CA72, yellow=#FFCC00, red=#FB275D (Monday brand status palette)
const LOADER_COLORS = {
  green: 'var(--color-success)',
  yellow: 'var(--color-warning)',
  red: 'var(--color-danger)',
} as const;

const FREEFALL_STYLES = `
  @keyframes mon-drop {
    0% { opacity: 0; transform: translateY(-10px); }
    40%, 80% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(2px); }
  }

  .mon-bar {
    animation: mon-drop 1.5s ease-out infinite;
    opacity: 0;
  }
`;

/** Animation cycle duration in milliseconds */
export const ANIMATION_CYCLE_MS = 1500;

export const FreeFallLoader: React.FC<FreeFallLoaderProps> = ({
  size = 80,
  className = ''
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-label="Loading"
      role="status"
    >
      <style>{FREEFALL_STYLES}</style>

      <path
        d="M5 7H13"
        className="mon-bar"
        style={{ animationDelay: '0s', stroke: LOADER_COLORS.green }}
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      <path
        d="M9 12H19"
        className="mon-bar"
        style={{ animationDelay: '0.2s', stroke: LOADER_COLORS.yellow }}
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      <path
        d="M5 17H13"
        className="mon-bar"
        style={{ animationDelay: '0.4s', stroke: LOADER_COLORS.red }}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
};

/**
 * Hook to ensure minimum display time for loading states
 * Returns true when both: data is ready AND minimum time has elapsed
 */
export const useMinimumLoadingTime = (isDataReady: boolean, minTimeMs: number = ANIMATION_CYCLE_MS): boolean => {
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const elapsed = Date.now() - startTimeRef.current;
    const remaining = Math.max(0, minTimeMs - elapsed);

    if (remaining === 0) {
      setMinTimeElapsed(true);
    } else {
      const timer = setTimeout(() => setMinTimeElapsed(true), remaining);
      return () => clearTimeout(timer);
    }
  }, [minTimeMs]);

  return isDataReady && minTimeElapsed;
};

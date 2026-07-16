import React, { useMemo } from 'react';
import styles from './ConfettiBurst.module.css';

/* Confetti celebration (item 6) — a dependency-free burst of falling, spinning
   paper pieces in the app palette, rendered as a fixed, pointer-transparent
   overlay. Mount with active=true right after a successful create; unmount (or
   flip active off) when the celebration window ends — pieces animate once
   (forwards) and rest off-screen, so no cleanup timer is needed here. */
const COLORS = ['#0073ea', '#6b4ee6', '#00c875', '#fdab3d', '#e2445c', '#ffcb00'];

export function ConfettiBurst({ active = false, pieces = 70 }) {
  const items = useMemo(() => {
    if (!active) return [];
    return Array.from({ length: pieces }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      duration: 1.7 + Math.random() * 1.3,
      width: 6 + Math.random() * 6,
      color: COLORS[i % COLORS.length],
      sway: -60 + Math.random() * 120,
      spin: 360 + Math.random() * 540,
    }));
  }, [active, pieces]);

  if (!active) return null;
  return (
    <div className={styles.overlay} aria-hidden="true">
      {items.map((p, i) => (
        <span
          key={i}
          className={styles.piece}
          style={{
            left: `${p.left}%`,
            width: `${p.width}px`,
            height: `${Math.max(4, p.width * 0.45)}px`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--sway': `${p.sway}px`,
            '--spin': `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}

export default ConfettiBurst;

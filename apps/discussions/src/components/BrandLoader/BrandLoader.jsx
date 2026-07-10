import React from 'react';
import styles from './BrandLoader.module.css';

const SEATS = [
  { x: 100, y: 60, c: '#00c875' },
  { x: 88.28, y: 31.72, c: '#0073ea' },
  { x: 60, y: 20, c: '#fdab3d' },
  { x: 31.72, y: 31.72, c: '#a25ddc' },
  { x: 20, y: 60, c: '#e2445c' },
  { x: 31.72, y: 88.28, c: '#00d2d2' },
  { x: 60, y: 100, c: '#ffcb00' },
  { x: 88.28, y: 88.28, c: '#ff5ac4' },
];

export function BrandLoader({ label = 'Powered by Twyst', fullscreen = false }) {
  return (
    <div className={fullscreen ? styles.brandLoaderFull : styles.brandLoader} role="status" aria-live="polite" aria-label="טוען">
      <div className={styles.brandLoaderInner}>
        <svg className={styles.brandMark} viewBox="0 0 120 120" width="96" height="96" aria-hidden="true">
          <circle className={styles.ring} cx="60" cy="60" r="40" />
          <circle className={styles.table} cx="60" cy="60" r="17" />
          {SEATS.map((s, i) => (
            <circle key={i} className={styles.seat} cx={s.x} cy={s.y} r="7.6" style={{ fill: s.c, '--i': i }} />
          ))}
        </svg>
        <div className={styles.brandText}>{label}</div>
      </div>
    </div>
  );
}
export default BrandLoader;

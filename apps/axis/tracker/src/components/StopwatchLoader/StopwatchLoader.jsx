import React from 'react';
import { useStableT } from '../../i18n/useStableT';

export default function StopwatchLoader({ size = 64, className }) {
    const t = useStableT();
    return (
        <div role="status" aria-label={t('common.loading')} className={className}>
            <style>{`
                @keyframes spin-loader {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes press-btn {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(1px); }
                }
            `}</style>
            <svg
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ stroke: 'var(--color-loader-dark)' }}
            >
                {/* כפתור עליון */}
                <g style={{ animation: 'press-btn 1.5s ease-in-out infinite', transformOrigin: '12px 3px' }}>
                    <path d="M10 3H14" />

                </g>
                {/* טבעת */}
                <circle cx="12" cy="13" r="8" style={{ stroke: 'var(--color-loader-accent)' }} />
                {/* מחוג שעות - איטי */}
                <line
                    x1="12" y1="13" x2="12" y2="9"
                    style={{ animation: 'spin-loader 18s linear infinite', transformOrigin: '12px 13px' }}
                />
                {/* מחוג דקות - מהיר */}
                <line
                    x1="12" y1="13" x2="12" y2="10"
                    style={{ animation: 'spin-loader 1.5s linear infinite', transformOrigin: '12px 13px' }}
                />
            </svg>
        </div>
    );
}

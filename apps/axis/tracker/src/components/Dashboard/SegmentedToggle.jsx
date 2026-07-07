import React from 'react';
import styles from './SegmentedToggle.module.css';

/**
 * רכיב Toggle מקוטע - לבחירה בין אפשרויות
 * @param {{ options: Array<{value: string, label: string}>, selected: string, onChange: Function, ariaLabel: string }} props
 */
const SegmentedToggle = ({ options, selected, onChange, ariaLabel }) => {
    return (
        <div className={styles.container} role="radiogroup" aria-label={ariaLabel}>
            {options.map(opt => (
                <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected === opt.value}
                    className={`${styles.option} ${selected === opt.value ? styles.active : ''}`}
                    onClick={() => onChange(opt.value)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
};

export default SegmentedToggle;

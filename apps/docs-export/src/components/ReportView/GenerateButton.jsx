/**
 * GenerateButton — הפק דוח.
 *
 * @module components/ReportView/GenerateButton
 *
 * **Why a native `<button>` and not Vibe's.** Verified against @vibe/core 4.2.5
 * (`@vibe/button/dist/Button/Button.js`, probed by rendering it): a Vibe Button
 * given `disabled` emits `aria-disabled="true"`, `tabindex="-1"` and a `disabled_*`
 * class — but NEVER the DOM `disabled` attribute. It swallows the click in its own
 * handler instead. That is a real accessibility and correctness difference, not a
 * cosmetic one: the element still reports as an enabled button to anything that
 * checks the DOM (`:disabled`, form semantics, `toBeDisabled()`), and "disabled" is
 * this button's whole contract — it is the last thing standing between a user and a
 * .docx built from nothing. So the disabled state here is the real attribute.
 *
 * The busy state deliberately does NOT use Vibe's `loading` prop either: that swaps
 * the label for a spinner and hides the text behind `aria-hidden`, which renames the
 * button mid-flight. The label stays put and the button just goes disabled — the
 * progress signal is the loading toast the caller already shows.
 */
import React from 'react';
import styles from './GenerateButton.module.css';

/**
 * @param {Object} props
 * @param {function(): void} props.onClick
 * @param {boolean} [props.disabled] no committee picked / nothing loaded / mid-flight
 * @param {boolean} [props.isGenerating] a document is being built right now
 */
export function GenerateButton({ onClick, disabled = false, isGenerating = false }) {
  return (
    <button
      type="button"
      // An explicit aria-label pins the accessible name to exactly "הפק דוח"
      // regardless of what decoration the label ever gains.
      aria-label="הפק דוח"
      aria-busy={isGenerating}
      className={styles.button}
      onClick={onClick}
      disabled={disabled}
    >
      הפק דוח
    </button>
  );
}

export default GenerateButton;

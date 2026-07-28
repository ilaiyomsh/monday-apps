/**
 * The boot overlay — monday's dialog spinner, continued.
 *
 * WHY THIS IS NOT A REACT COMPONENT: monday paints a spinner in the Dialog
 * Design container while our iframe loads. If the app answered that with its own
 * loader, the user would see monday's spinner, a blank frame while the JS bundle
 * parses, and then a *second* loader starting its animation from 0 — the jump
 * this exists to remove. So the overlay is declared statically in `index.html`
 * with its CSS inline in `<head>`: it paints on the document's first frame,
 * before the bundle is even fetched, and it is the SAME DOM node for the whole
 * boot, so its rotation never restarts.
 *
 * That makes removal the only operation. Two callers race to it — App (for any
 * route that is not the picker, and on a context error) and OnClickDialog (once
 * the picker has data) — so it must be idempotent and must not throw when the
 * node is already gone or was never there (dev harness, jsdom tests).
 */

export const BOOT_LOADER_ID = 'twyst-boot-loader';

/**
 * Remove the boot overlay, revealing whatever the app has rendered underneath.
 * Safe to call any number of times, from anywhere, at any point in the boot.
 *
 * @param {Document} [doc=document] injectable for tests
 * @returns {void}
 */
export function dismissBootLoader(doc = document) {
  const node = doc?.getElementById?.(BOOT_LOADER_ID);
  if (node) node.remove();
}

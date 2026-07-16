/*
 * round108 — owner logo helper.
 *
 * The owner uploads an image file in Settings; we downscale it to a small
 * data-URI stored in settings.preferences.logoUrl (self-contained — no asset
 * hosting / no monday file API). `computeScaledSize` is the pure fit-inside-a-box
 * math (exported for testing); `fileToLogoDataUrl` does the DOM decode + canvas
 * downscale and resolves the data-URI string.
 */

// Scale (w×h) DOWN to fit inside a `max`×`max` box, preserving aspect ratio and
// never UP-scaling. Returns integer pixel dimensions (min 1 each). Pure.
export function computeScaledSize(w, h, max) {
  if (!(w > 0) || !(h > 0) || !(max > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

// Read an image File, downscale to fit `maxPx`, and resolve a PNG data-URI.
export function fileToLogoDataUrl(file, { maxPx = 320, type = 'image/png' } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('no file')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('file read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('image decode failed'));
      img.onload = () => {
        const { width, height } = computeScaledSize(img.naturalWidth, img.naturalHeight, maxPx);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(type));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ============================================
// Wheel Event Normalizer
// ============================================
//
// Normalizes wheel events across browsers into a consistent format.
// Returns { dx, dy, dz } where dx/dy are pan deltas in pixels and
// dz is a zoom delta (nonzero only for pinch/Ctrl+scroll).

const LINE_HEIGHT = 40;   // px per "line" (Firefox deltaMode 1)
const PAGE_HEIGHT = 800;  // px per "page" (rare deltaMode 2)
const MAX_ZOOM_STEP = 10; // clamp extreme pinch deltas (tldraw pattern)

/**
 * Normalize a WheelEvent into consistent pan and zoom deltas.
 *
 * @param {WheelEvent} e - The raw wheel event
 * @returns {{ dx: number, dy: number, dz: number }}
 *   dx, dy: pan deltas in CSS pixels (0 when zooming)
 *   dz: zoom delta, scaled to ~1.0 per scroll notch (0 when panning)
 */
export function normalizeWheel(e) {
  let dx = e.deltaX || 0;
  let dy = e.deltaY || 0;
  let dz = 0;

  // Convert deltaMode to pixel units.
  if (e.deltaMode === 1) {        // DOM_DELTA_LINE
    dx *= LINE_HEIGHT;
    dy *= LINE_HEIGHT;
  } else if (e.deltaMode === 2) { // DOM_DELTA_PAGE
    dx *= PAGE_HEIGHT;
    dy *= PAGE_HEIGHT;
  }

  // Shift+scroll → horizontal pan (Windows/Linux convention).
  if (dx === 0 && e.shiftKey) {
    dx = dy;
    dy = 0;
  }

  // Detect pinch-to-zoom (ctrlKey synthesized by all modern browsers).
  if (e.ctrlKey || e.metaKey) {
    const clamped = Math.abs(dy) > MAX_ZOOM_STEP
      ? MAX_ZOOM_STEP * Math.sign(dy)
      : dy;
    dz = clamped / 100;
    dx = 0;
    dy = 0;
  }

  return { dx, dy, dz };
}

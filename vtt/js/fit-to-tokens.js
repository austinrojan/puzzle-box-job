// vtt/js/fit-to-tokens.js
// Automatic content framing for the camera.

const FRAME_MODES = ['all', 'pcs', 'combatants'];

const DEFAULT_PADDING_RATIO = 0.15;
const MIN_PADDING_PX = 70;

/**
 * Compute a camera target that frames a set of tokens.
 *
 * @param {Array<{ x: number, y: number, size: number, isPC: boolean, visible: boolean, inInitiative: boolean }>} tokens
 * @param {{ w: number, h: number }} viewport
 * @param {Object} [opts]
 * @param {string} [opts.mode='all']           - which tokens to include
 * @param {number} [opts.paddingRatio=0.15]    - padding as fraction of bounds
 * @param {number} [opts.minPadding=70]        - minimum padding in world px
 * @param {number} [opts.maxZoom]              - don't zoom closer than this
 * @param {number} [opts.gridSize=70]          - grid cell size in world px
 * @returns {{ centerX: number, centerY: number, zoom: number }|null}
 */
export function computeFitToTokens(tokens, viewport, opts = {}) {
  const mode = opts.mode ?? 'all';
  const paddingRatio = opts.paddingRatio ?? DEFAULT_PADDING_RATIO;
  const minPadding = opts.minPadding ?? MIN_PADDING_PX;
  const gridSize = opts.gridSize ?? 70;

  // Step 1: Filter tokens by mode
  let eligible = tokens.filter(t => t.visible);
  switch (mode) {
    case 'pcs':
      eligible = eligible.filter(t => t.isPC);
      break;
    case 'combatants':
      eligible = eligible.filter(t => t.inInitiative);
      break;
  }

  if (eligible.length === 0) return null;

  // Step 2: Compute the union bounding box in world space.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const token of eligible) {
    const halfSize = (token.size * gridSize) / 2;
    minX = Math.min(minX, token.x - halfSize);
    minY = Math.min(minY, token.y - halfSize);
    maxX = Math.max(maxX, token.x + halfSize);
    maxY = Math.max(maxY, token.y + halfSize);
  }

  const boundsW = maxX - minX;
  const boundsH = maxY - minY;

  // Step 3: Add padding
  const padX = Math.max(boundsW * paddingRatio, minPadding);
  const padY = Math.max(boundsH * paddingRatio, minPadding);

  const paddedW = boundsW + padX * 2;
  const paddedH = boundsH + padY * 2;

  // Step 4: Compute the zoom level that fits the padded box.
  const fitZoom = Math.min(
    viewport.w / paddedW,
    viewport.h / paddedH
  );

  const zoom = opts.maxZoom ? Math.min(fitZoom, opts.maxZoom) : fitZoom;

  const centerX = minX + boundsW / 2;
  const centerY = minY + boundsH / 2;

  return { centerX, centerY, zoom };
}

export { FRAME_MODES };

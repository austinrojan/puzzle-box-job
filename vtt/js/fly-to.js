// vtt/js/fly-to.js
// Van Wijk & Nuij optimal camera path computation.
// Reference: "Smooth and efficient zooming and panning" (InfoVis 2003)
// Also informed by MapLibre GL JS camera.ts and D3's d3-interpolate-zoom.

const cosh = (x) => (Math.exp(x) + Math.exp(-x)) / 2;
const sinh = (x) => (Math.exp(x) - Math.exp(-x)) / 2;
const tanh = (x) => sinh(x) / cosh(x);

const DEFAULT_RHO = 1.42;
const DEFAULT_SPEED = 1.2;
const MIN_DURATION_MS = 200;
const MAX_DURATION_MS = 5000;
const EPSILON_DISTANCE = 1e-6;

/**
 * Compute a van Wijk & Nuij optimal camera path between two positions.
 *
 * @param {{ centerX: number, centerY: number, zoom: number }} start
 * @param {{ centerX: number, centerY: number, zoom: number }} end
 * @param {Object} [opts]
 * @param {number} [opts.rho=1.42]       - curvature parameter
 * @param {number} [opts.speed=1.2]      - screenfulls per second
 * @param {number} [opts.screenWidth]    - viewport width for w<->zoom conversion
 * @param {number} [opts.duration]       - override computed duration (ms)
 * @returns {{ duration: number, at: (t: number) => { centerX: number, centerY: number, zoom: number } }}
 */
export function computeFlyToPath(start, end, opts = {}) {
  const rho = opts.rho ?? DEFAULT_RHO;
  const V = opts.speed ?? DEFAULT_SPEED;
  const screenW = opts.screenWidth ?? 1920;

  // Convert zoom to visible width: w = screenWidth / zoom
  const w0 = screenW / start.zoom;
  const w1 = screenW / end.zoom;

  // Distance between centers in world space
  const dx = end.centerX - start.centerX;
  const dy = end.centerY - start.centerY;
  const u1 = Math.sqrt(dx * dx + dy * dy);

  // Pre-compute rho powers
  const rho2 = rho * rho;
  const rho4 = rho2 * rho2;

  let S, uFn, wFn;

  if (u1 < EPSILON_DISTANCE) {
    // ------ PURE ZOOM (no pan) ------
    if (Math.abs(w0 - w1) < EPSILON_DISTANCE) {
      // Start and end are identical. Return a no-op path.
      return {
        duration: 0,
        at: () => ({ centerX: start.centerX, centerY: start.centerY, zoom: start.zoom }),
      };
    }

    const k = w1 < w0 ? -1 : 1;
    S = Math.abs(Math.log(w1 / w0)) / rho;
    uFn = () => 0;
    wFn = (s) => w0 * Math.exp(k * rho * s);
  } else {
    // ------ GENERAL CASE: combined zoom + pan ------
    const b0 = (w1 * w1 - w0 * w0 + rho4 * u1 * u1) / (2 * w0 * rho2 * u1);
    const b1 = (w1 * w1 - w0 * w0 - rho4 * u1 * u1) / (2 * w1 * rho2 * u1);

    const r = (b) => Math.log(-b + Math.sqrt(b * b + 1)); // arcsinh(-b)
    const r0 = r(b0);
    const r1 = r(b1);

    S = (r1 - r0) / rho;

    const a = w0 / rho2;
    const coshr0 = cosh(r0);
    const sinhr0 = sinh(r0);

    uFn = (s) => a * coshr0 * tanh(rho * s + r0) - a * sinhr0;
    wFn = (s) => w0 * coshr0 / cosh(rho * s + r0);
  }

  // Duration: path length / speed, converted to ms.
  const computedDuration = 1000 * S / V;
  const duration = opts.duration ?? Math.min(Math.max(computedDuration, MIN_DURATION_MS), MAX_DURATION_MS);

  return {
    duration,

    /**
     * Evaluate the path at parameter t in [0, 1].
     * t should be pre-eased by the caller.
     */
    at(t) {
      const s = t * S;
      const uNorm = u1 > EPSILON_DISTANCE ? uFn(s) / u1 : 0;
      const w = wFn(s);

      return {
        centerX: start.centerX + dx * uNorm,
        centerY: start.centerY + dy * uNorm,
        zoom: screenW / w,
      };
    },
  };
}

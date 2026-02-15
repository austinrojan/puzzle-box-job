// vtt/js/easing.js
// Standard easing functions for animation.
// These are pure functions: easing(t) -> t' where both are in [0, 1].

/**
 * Ease-in-out cubic. The workhorse for camera transitions.
 * Smooth acceleration and deceleration. Feels natural and unhurried.
 */
export function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Ease-out quint. Fast start, gentle landing.
 * Good for "snap to" motions where you want the destination
 * to feel settled, like recalling a camera preset.
 */
export function easeOutQuint(t) {
  return 1 - Math.pow(1 - t, 5);
}

/**
 * Ease-in-out quart. Slightly snappier than cubic.
 * Good for shorter transitions where cubic feels sluggish.
 */
export function easeInOutQuart(t) {
  return t < 0.5
    ? 8 * t * t * t * t
    : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

/**
 * Linear. No easing. Useful for debugging and for
 * progress indicators, but never for camera motion.
 */
export function linear(t) {
  return t;
}

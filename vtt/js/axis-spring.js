// ============================================================
// AxisSpring — One spring per animated property
// ============================================================
//
// Uses the closed-form critically damped spring solution:
//   x(t) = (A + B·t) · e^(-ω₀·t)
//   v(t) = (B - ω₀·(A + B·t)) · e^(-ω₀·t)
//
// Frame-rate independent by construction — no numerical error
// accumulates across frames.

const DEFAULT_STIFFNESS = 200;
const DEFAULT_MASS = 1.0;
const DEFAULT_POSITION_THRESHOLD = 0.5;
const DEFAULT_VELOCITY_THRESHOLD = 0.5;

export class AxisSpring {
  /**
   * @param {object} opts
   * @param {number} [opts.stiffness=200]  Spring constant k
   * @param {number} [opts.mass=1.0]       Mass (rarely changed)
   * @param {number} [opts.positionThreshold=0.5]  Settlement position threshold
   * @param {number} [opts.velocityThreshold=0.5]  Settlement velocity threshold
   */
  constructor(opts = {}) {
    this.position = 0;
    this.velocity = 0;
    this.target = 0;
    this.stiffness = opts.stiffness ?? DEFAULT_STIFFNESS;
    this.mass = opts.mass ?? DEFAULT_MASS;
    this.positionThreshold = opts.positionThreshold ?? DEFAULT_POSITION_THRESHOLD;
    this.velocityThreshold = opts.velocityThreshold ?? DEFAULT_VELOCITY_THRESHOLD;

    this._omega = Math.sqrt(this.stiffness / this.mass);
  }

  /**
   * Set a new target. Velocity is preserved by default, creating
   * C¹-continuous motion across target changes.
   */
  setTarget(target, opts) {
    this.target = target;
    if (opts?.velocity !== undefined) {
      this.velocity = opts.velocity;
    }
  }

  /**
   * Set position directly (e.g. during user drag). Zeroes velocity.
   */
  setPosition(position) {
    this.position = position;
    this.velocity = 0;
  }

  /**
   * Snap to target instantly with zero velocity.
   */
  snapToTarget() {
    this.position = this.target;
    this.velocity = 0;
  }

  /**
   * Change stiffness. Preserves current position and velocity.
   */
  setStiffness(stiffness) {
    this.stiffness = stiffness;
    this._omega = Math.sqrt(this.stiffness / this.mass);
  }

  /**
   * Whether the spring is within settlement thresholds.
   * Shared by advance() (early exit + post-advance) and the settled getter.
   */
  _isSettled() {
    return Math.abs(this.position - this.target) < this.positionThreshold
        && Math.abs(this.velocity) < this.velocityThreshold;
  }

  /**
   * Advance by one timestep using closed-form critically damped solution.
   * Returns true if the spring has settled.
   * @param {number} dt  Timestep in seconds
   * @returns {boolean}
   */
  advance(dt) {
    const displacement = this.position - this.target;
    const velocity = this.velocity;

    // Early exit: already settled
    if (this._isSettled()) {
      this.position = this.target;
      this.velocity = 0;
      return true;
    }

    // Closed-form critically damped spring (ζ = 1):
    //   x(t) = (A + B·t) · e^(-ω·t)
    //   v(t) = (B - ω·(A + B·t)) · e^(-ω·t)
    const omega = this._omega;
    const A = displacement;
    const B = velocity + omega * displacement;
    const exp = Math.exp(-omega * dt);

    this.position = this.target + (A + B * dt) * exp;
    this.velocity = (B - omega * (A + B * dt)) * exp;

    // Post-advance settlement check
    if (this._isSettled()) {
      this.position = this.target;
      this.velocity = 0;
      return true;
    }

    return false;
  }

  /**
   * Whether the spring is at rest (at target with no velocity).
   */
  get settled() { return this._isSettled(); }
}

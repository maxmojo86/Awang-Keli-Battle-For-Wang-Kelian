import { getEvolutionForm } from '../data/abilities.ts';
import type { EvolutionForm, KeliEntity } from './types.ts';

export interface LocomotionProfile {
  readonly form: EvolutionForm;
  readonly isOnShore: boolean;
  /** Exponential acceleration rate (1/s). ~7.4 reaches 90% speed in ~0.31s. */
  readonly accelRate: number;
  /** Exponential deceleration rate (1/s). ~8.5 drops to 10% speed in ~0.27s. */
  readonly decelRate: number;
  /** Responsiveness multiplier when actively reversing/carving against current velocity. */
  readonly reverseBoost: number;
  /** Turning angular velocity (rad/s) near rest for crisp low-speed pivots. */
  readonly lowSpeedTurnRate: number;
  /** Turning angular velocity (rad/s) at top speed for smooth high-speed arcs. */
  readonly highSpeedTurnRate: number;
  /** Speed multiplier applied when moving on shore terrain. */
  readonly shoreSpeedMult: number;
}

const WATER_PROFILES: Record<EvolutionForm, LocomotionProfile> = {
  // Form 1 (Lv.1–39): Agile aquatic predator — snappy acceleration, tight pivots, water-only
  1: {
    form: 1,
    isOnShore: false,
    accelRate: 8.2,
    decelRate: 8.6,
    reverseBoost: 1.55,
    lowSpeedTurnRate: 14.8,
    highSpeedTurnRate: 9.2,
    shoreSpeedMult: 0.72,
  },
  // Form 2 (Lv.40–79): Strong aquatic swimmer with broader shoulder mass
  2: {
    form: 2,
    isOnShore: false,
    accelRate: 7.4,
    decelRate: 8.0,
    reverseBoost: 1.45,
    lowSpeedTurnRate: 13.4,
    highSpeedTurnRate: 8.4,
    shoreSpeedMult: 0.68,
  },
  // Form 3 (Lv.80–99): Powerful apex amphibious swimmer
  3: {
    form: 3,
    isOnShore: false,
    accelRate: 6.9,
    decelRate: 7.6,
    reverseBoost: 1.4,
    lowSpeedTurnRate: 12.2,
    highSpeedTurnRate: 7.8,
    shoreSpeedMult: 0.94,
  },
  // Form 4 (Lv.100): Keli King (locked post-victory)
  4: {
    form: 4,
    isOnShore: false,
    accelRate: 6.2,
    decelRate: 8.5,
    reverseBoost: 1.3,
    lowSpeedTurnRate: 11.0,
    highSpeedTurnRate: 7.2,
    shoreSpeedMult: 0.94,
  },
};

const LAND_PROFILES: Record<EvolutionForm, LocomotionProfile> = {
  // Form 1 cannot enter land; kept only as defensive fallback
  1: WATER_PROFILES[1],
  // Form 2 (Lv.40–79): Heavy arm-assisted land dragging (2 arms, NO legs) — noticeably slower,
  // heavier ramp-up, high ground drag when stopping, deliberate turning
  2: {
    form: 2,
    isOnShore: true,
    accelRate: 5.9,
    decelRate: 11.4,
    reverseBoost: 1.25,
    lowSpeedTurnRate: 9.6,
    highSpeedTurnRate: 6.4,
    shoreSpeedMult: 0.68,
  },
  // Form 3 (Lv.80–99): Powerful amphibious land stride — unrestricted, planted, commanding
  3: {
    form: 3,
    isOnShore: true,
    accelRate: 6.6,
    decelRate: 10.2,
    reverseBoost: 1.32,
    lowSpeedTurnRate: 11.2,
    highSpeedTurnRate: 7.4,
    shoreSpeedMult: 0.94,
  },
  // Form 4 (Lv.100): Keli King on shore (locked post-victory)
  4: {
    form: 4,
    isOnShore: true,
    accelRate: 6.4,
    decelRate: 10.5,
    reverseBoost: 1.3,
    lowSpeedTurnRate: 10.5,
    highSpeedTurnRate: 7.0,
    shoreSpeedMult: 0.94,
  },
};

/**
 * Returns the deterministic locomotion physics profile for a Keli's evolution form and terrain.
 */
export function getLocomotionProfile(level: number, isOnShore: boolean): LocomotionProfile {
  const form = getEvolutionForm(level);
  return isOnShore ? LAND_PROFILES[form] : WATER_PROFILES[form];
}

/**
 * Speed-dependent turning: tighter pivots at low speed, wider smooth carving arcs at high speed.
 */
export function computeTurnRate(
  profile: LocomotionProfile,
  currentSpeed: number,
  maxSpeed: number
): number {
  const denom = maxSpeed > 1 ? maxSpeed : 160;
  const speedRatio = Math.max(0, Math.min(1, currentSpeed / denom));
  return (
    profile.lowSpeedTurnRate +
    (profile.highSpeedTurnRate - profile.lowSpeedTurnRate) * speedRatio
  );
}

/**
 * Normalizes a 2D directional input vector safely (diagonal inputs never exceed length 1).
 * Preserves fractional analog magnitude in (0, 1] for mobile virtual joystick fine control.
 */
export function normalizeMoveInput(
  rawX: number,
  rawZ: number
): { x: number; z: number; magnitude: number } {
  const len = Math.hypot(rawX, rawZ);
  if (!Number.isFinite(len) || len <= 1e-5) {
    return { x: 0, z: 0, magnitude: 0 };
  }
  const clampedMag = Math.min(1, len);
  return {
    x: (rawX / len) * clampedMag,
    z: (rawZ / len) * clampedMag,
    magnitude: clampedMag,
  };
}

/**
 * Integrates Keli velocity deterministically over fixed step `dt` using exponential
 * arcade-responsive acceleration, crisp deceleration, and steering-assisted direction changes.
 * Zero allocations; identical physics for both players and AI bots.
 */
export function applyLocomotionVelocity(
  k: Pick<KeliEntity, 'vx' | 'vz' | 'moveAngle'>,
  desiredX: number,
  desiredZ: number,
  maxSpeed: number,
  dt: number,
  profile: LocomotionProfile
): number {
  const safeDt = dt > 0 ? dt : 0;
  const inLen = Math.hypot(desiredX, desiredZ);

  if (inLen > 0.01 && maxSpeed > 0) {
    const clampedMag = Math.min(1, inLen);
    const nx = desiredX / inLen;
    const nz = desiredZ / inLen;
    const targetVx = nx * maxSpeed * clampedMag;
    const targetVz = nz * maxSpeed * clampedMag;

    // Boost steering authority cleanly when cutting or reversing against current momentum
    // so direction changes feel athletic and responsive without instant 180-degree snaps.
    const curSpeed = Math.hypot(k.vx, k.vz);
    let effectiveAccel = profile.accelRate;
    if (curSpeed > 12) {
      const dot = (k.vx * nx + k.vz * nz) / curSpeed;
      if (dot < 0.85) {
        const turnSeverity = Math.min(1, (0.85 - dot) / 1.85);
        effectiveAccel *= 1 + (profile.reverseBoost - 1) * turnSeverity;
      }
    }

    const alpha = 1 - Math.exp(-effectiveAccel * safeDt);
    k.vx += (targetVx - k.vx) * alpha;
    k.vz += (targetVz - k.vz) * alpha;
  } else {
    const decay = Math.exp(-profile.decelRate * safeDt);
    k.vx *= decay;
    k.vz *= decay;
    if (k.vx * k.vx + k.vz * k.vz < 2.25) {
      k.vx = 0;
      k.vz = 0;
    }
  }

  const nextSpeed = Math.hypot(k.vx, k.vz);
  if (nextSpeed > 8) {
    k.moveAngle = Math.atan2(k.vz, k.vx);
  }
  return nextSpeed;
}

/**
 * Clamps residual velocity cleanly after Dash or Slip Evade expires so burst impulses
 * never leak unintended extra speed into normal locomotion.
 */
export function clampPostBurstVelocity(
  k: Pick<KeliEntity, 'vx' | 'vz'>,
  maxNormalSpeed: number
): void {
  const cap = Math.max(0, maxNormalSpeed * 1.02);
  const spd = Math.hypot(k.vx, k.vz);
  if (spd > cap && spd > 0.001) {
    const scale = cap / spd;
    k.vx *= scale;
    k.vz *= scale;
  }
}

/**
 * Projects velocity onto the collision surface tangent when colliding with a rock,
 * cliff, palong post, or shoreline boundary so movement slides smoothly instead of sticking.
 */
export function projectVelocityAlongCollisionNormal(
  k: Pick<KeliEntity, 'vx' | 'vz'>,
  normalX: number,
  normalZ: number
): void {
  const nLen = Math.hypot(normalX, normalZ);
  if (nLen < 0.001) return;
  const nx = normalX / nLen;
  const nz = normalZ / nLen;
  const vn = k.vx * nx + k.vz * nz;
  // Remove only the velocity component pushing inward into the solid surface
  if (vn < 0) {
    k.vx -= vn * nx;
    k.vz -= vn * nz;
  }
}

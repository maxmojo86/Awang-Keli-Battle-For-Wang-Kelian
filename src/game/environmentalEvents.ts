import {
  ARENA_SCALE,
  OBSTACLES,
  PALONG_GATES,
  WORLD_CENTER,
  WORLD_SIZE,
  getTerrainAt,
  isPositionAccessible,
} from './arena.ts';
import type {
  ActiveWorldEventState,
  EvolutionForm,
  LobbySize,
  MatchPhase,
  PlayerEventThreat,
  WorldEventKind,
  WorldEventPhase,
  ZoneState,
} from './types.ts';

// ---------------------------------------------------------------------------
// Environmental Event Constants & Tuned Physics Bounds
// ---------------------------------------------------------------------------

/** Form 1 base swim speed reference (from simulation.ts getMoveSpeed: ~158 u/s). */
export const FORM1_SWIM_SPEED_REF = 158;

/** Kepala Air (Flash Flood): 15-35% of Form 1 swim speed (~32% = 50 u/s peak). */
export const FLASH_FLOOD_MAX_CURRENT = 50;

/** Air Keruh (Silt Bloom): ~50% local visual detection reduction (within 40-60% target). */
export const SILT_BLOOM_VISIBILITY_MULT = 0.5;
/** Close-range combat always remains readable even inside peak silt bloom. */
export const SILT_BLOOM_MIN_READABLE_RANGE = 210;

/** Pusaran Dalam (Deep Whirlpool): bounded inward pull + gentle swirl, always escapable. */
export const WHIRLPOOL_MAX_PULL_SPEED = 54;
export const WHIRLPOOL_MAX_SWIRL_SPEED = 22;

/** Jaring Hanyut (Drifting Fishing Net): bounded movement impairment (separate from stun). */
export const NET_ENTANGLE_DURATION = 0.65; // within 0.4-0.8s
export const NET_ENTANGLE_SPEED_MULT = 0.58; // 42% movement reduction (within 35-50%)
export const NET_IMMUNITY_DURATION = 3.6; // prevents repeated/permanent snagging
export const NET_HALF_SPAN = 66;
export const NET_HALF_THICKNESS = 24;

export const ALL_WORLD_EVENT_KINDS: readonly WorldEventKind[] = [
  'flash_flood',
  'silt_bloom',
  'whirlpool',
  'drifting_net',
] as const;

export interface WorldEventMetadata {
  kind: WorldEventKind;
  label: string;
  subtitle: string;
  warningText: string;
  activeText: string;
  color: string;
}

export const WORLD_EVENT_METADATA: Record<WorldEventKind, WorldEventMetadata> = {
  flash_flood: {
    kind: 'flash_flood',
    label: 'KEPALA AIR',
    subtitle: 'Flash Flood Current',
    warningText: 'Surge building along basin channel',
    activeText: 'Strong water current — ride downstream or brace',
    color: '#38bdf8',
  },
  silt_bloom: {
    kind: 'silt_bloom',
    label: 'AIR KERUH',
    subtitle: 'Silt Bloom Cloud',
    warningText: 'Suspended tin silt rising from basin floor',
    activeText: 'Local visibility dropped — ideal for ambush or escape',
    color: '#d97706',
  },
  whirlpool: {
    kind: 'whirlpool',
    label: 'PUSARAN DALAM',
    subtitle: 'Deep Whirlpool',
    warningText: 'Deep water vortex forming — clear the rim',
    activeText: 'Vortex pull active — swim wide or Dash/Evade free',
    color: '#2dd4bf',
  },
  drifting_net: {
    kind: 'drifting_net',
    label: 'JARING HANYUT',
    subtitle: 'Drifting Fishing Net',
    warningText: 'Abandoned net drifting across channel',
    activeText: 'Avoid net sweep — Dash or Evade breaks entanglement',
    color: '#fb923c',
  },
};

export interface LobbyEventScheduleProfile {
  firstEventMinSec: number;
  firstEventMaxSec: number;
  intervalMinSec: number;
  intervalMaxSec: number;
  warningDurationSec: number;
  activeDurationSec: number;
  dissipateDurationSec: number;
  maxConcurrentEvents: 1;
}

/**
 * Lobby-aware scheduling ensures short 5/10/20-Keli matches experience a memorable
 * dynamic event without spamming overlapping hazards, while 50/100-Keli matches get
 * well-spaced basin shifts across early, mid, and late phases.
 */
export const LOBBY_EVENT_SCHEDULES: Record<LobbySize, LobbyEventScheduleProfile> = {
  5: {
    firstEventMinSec: 26,
    firstEventMaxSec: 34,
    intervalMinSec: 42,
    intervalMaxSec: 54,
    warningDurationSec: 5.5,
    activeDurationSec: 13,
    dissipateDurationSec: 2.5,
    maxConcurrentEvents: 1,
  },
  10: {
    firstEventMinSec: 28,
    firstEventMaxSec: 38,
    intervalMinSec: 44,
    intervalMaxSec: 58,
    warningDurationSec: 5.5,
    activeDurationSec: 14,
    dissipateDurationSec: 2.5,
    maxConcurrentEvents: 1,
  },
  20: {
    firstEventMinSec: 32,
    firstEventMaxSec: 44,
    intervalMinSec: 46,
    intervalMaxSec: 62,
    warningDurationSec: 6.0,
    activeDurationSec: 15,
    dissipateDurationSec: 3.0,
    maxConcurrentEvents: 1,
  },
  25: {
    firstEventMinSec: 36,
    firstEventMaxSec: 48,
    intervalMinSec: 48,
    intervalMaxSec: 65,
    warningDurationSec: 6.0,
    activeDurationSec: 15,
    dissipateDurationSec: 3.0,
    maxConcurrentEvents: 1,
  },
  50: {
    firstEventMinSec: 40,
    firstEventMaxSec: 54,
    intervalMinSec: 52,
    intervalMaxSec: 70,
    warningDurationSec: 6.5,
    activeDurationSec: 16,
    dissipateDurationSec: 3.0,
    maxConcurrentEvents: 1,
  },
  100: {
    firstEventMinSec: 42,
    firstEventMaxSec: 58,
    intervalMinSec: 55,
    intervalMaxSec: 75,
    warningDurationSec: 6.5,
    activeDurationSec: 16,
    dissipateDurationSec: 3.5,
    maxConcurrentEvents: 1,
  },
};

// ---------------------------------------------------------------------------
// Deterministic Seeded PRNG (isolated to EnvironmentalEventDirector)
// ---------------------------------------------------------------------------

function createEventRng(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Curated Basin Water Corridors, Deep Basins, and Drift Channels (scaled to 8x)
// ---------------------------------------------------------------------------

interface FloodCorridorSeed {
  x: number;
  z: number;
  angle: number;
  halfLength: number;
  halfWidth: number;
}

const S = ARENA_SCALE;

const FLOOD_CORRIDOR_CANDIDATES: FloodCorridorSeed[] = [
  // Central basin sweep (west -> east across Jantung Tasik rim)
  { x: WORLD_CENTER, z: WORLD_CENTER - 220, angle: 0.14, halfLength: 640, halfWidth: 200 },
  { x: WORLD_CENTER, z: WORLD_CENTER + 240, angle: Math.PI - 0.16, halfLength: 640, halfWidth: 200 },
  // North-South channel (Terowong Bijih -> Lubuk Hitam)
  { x: WORLD_CENTER - 240, z: WORLD_CENTER, angle: Math.PI * 0.5 + 0.12, halfLength: 620, halfWidth: 195 },
  { x: WORLD_CENTER + 250, z: WORLD_CENTER, angle: -Math.PI * 0.5 - 0.1, halfLength: 620, halfWidth: 195 },
  // Sungai Berselirat braided river flow
  { x: 1450 * S, z: 980 * S, angle: 2.25, halfLength: 560, halfWidth: 185 },
  // Gua Kelam outer channel
  { x: 520 * S, z: 880 * S, angle: 0.72, halfLength: 560, halfWidth: 185 },
  // Southern basin channel
  { x: 960 * S, z: 1480 * S, angle: -0.25, halfLength: 580, halfWidth: 190 },
  // Northern mining trough
  { x: 980 * S, z: 480 * S, angle: 0.28, halfLength: 560, halfWidth: 185 },
];

const DEEP_WATER_CANDIDATES: Array<{ x: number; z: number }> = [
  { x: WORLD_CENTER - 160, z: WORLD_CENTER - 150 },
  { x: WORLD_CENTER + 170, z: WORLD_CENTER + 160 },
  { x: WORLD_CENTER - 210, z: WORLD_CENTER + 190 },
  { x: WORLD_CENTER + 210, z: WORLD_CENTER - 180 },
  { x: 460 * S, z: 1460 * S },
  { x: 560 * S, z: 1240 * S },
  { x: 1120 * S, z: 1120 * S },
  { x: 860 * S, z: 920 * S },
  { x: 1320 * S, z: 1360 * S },
  { x: 1380 * S, z: 760 * S },
  { x: 640 * S, z: 680 * S },
  { x: WORLD_CENTER, z: WORLD_CENTER + 310 },
];

interface DriftRouteSeed {
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
}

const DRIFT_NET_ROUTES: DriftRouteSeed[] = [
  {
    startX: WORLD_CENTER - 480,
    startZ: WORLD_CENTER - 230,
    endX: WORLD_CENTER + 480,
    endZ: WORLD_CENTER - 120,
  },
  {
    startX: WORLD_CENTER + 480,
    startZ: WORLD_CENTER + 220,
    endX: WORLD_CENTER - 480,
    endZ: WORLD_CENTER + 150,
  },
  {
    startX: WORLD_CENTER - 260,
    startZ: WORLD_CENTER - 480,
    endX: WORLD_CENTER - 140,
    endZ: WORLD_CENTER + 480,
  },
  {
    startX: WORLD_CENTER + 240,
    startZ: WORLD_CENTER + 460,
    endX: WORLD_CENTER + 150,
    endZ: WORLD_CENTER - 460,
  },
  {
    startX: 1220 * S,
    startZ: 740 * S,
    endX: 1480 * S,
    endZ: 1220 * S,
  },
  {
    startX: 520 * S,
    startZ: 1120 * S,
    endX: 780 * S,
    endZ: 1520 * S,
  },
];

// ---------------------------------------------------------------------------
// Spatial Validation Helpers
// ---------------------------------------------------------------------------

function isNearPalongGate(x: number, z: number, margin: number): boolean {
  for (let i = 0; i < PALONG_GATES.length; i++) {
    const g = PALONG_GATES[i];
    if (Math.hypot(x - g.x, z - g.z) < g.width * 0.5 + margin) {
      return true;
    }
  }
  return false;
}

function minObstacleClearance(x: number, z: number): number {
  let minClear = Infinity;
  for (let i = 0; i < OBSTACLES.length; i++) {
    const obs = OBSTACLES[i];
    const clear = Math.hypot(x - obs.x, z - obs.z) - obs.radius;
    if (clear < minClear) minClear = clear;
  }
  return minClear;
}

export function isValidDeepWhirlpoolSite(x: number, z: number, zone?: ZoneState): boolean {
  if (x < 340 || x > WORLD_SIZE - 340 || z < 340 || z > WORLD_SIZE - 340) return false;
  if (zone && Math.hypot(x - zone.centerX, z - zone.centerZ) > Math.max(220, zone.currentRadius * 0.8)) {
    return false;
  }
  if (getTerrainAt(x, z) !== 'deep') return false;
  if (!isPositionAccessible(x, z, 60, false)) return false;
  if (minObstacleClearance(x, z) < 72) return false;
  if (isNearPalongGate(x, z, 90)) return false;
  return true;
}

export function isValidWaterEventSite(x: number, z: number, zone?: ZoneState): boolean {
  if (x < 300 || x > WORLD_SIZE - 300 || z < 300 || z > WORLD_SIZE - 300) return false;
  if (zone && Math.hypot(x - zone.centerX, z - zone.centerZ) > Math.max(220, zone.currentRadius * 0.84)) {
    return false;
  }
  const t = getTerrainAt(x, z);
  if (t !== 'deep' && t !== 'shallow') return false;
  return isPositionAccessible(x, z, 44, false);
}

export function isValidDriftNetRoute(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  zone?: ZoneState
): boolean {
  const len = Math.hypot(endX - startX, endZ - startZ);
  if (len < 240) return false;
  const samples = 7;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const sx = startX + (endX - startX) * t;
    const sz = startZ + (endZ - startZ) * t;
    if (!isPositionAccessible(sx, sz, 44, false)) return false;
    if (isNearPalongGate(sx, sz, 70)) return false;
    if (minObstacleClearance(sx, sz) < 38) return false;
    if (
      zone &&
      i > 0 &&
      i < samples &&
      Math.hypot(sx - zone.centerX, sz - zone.centerZ) > Math.max(280, zone.currentRadius * 0.92)
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pure Physics, Visibility & AI Avoidance Evaluators (zero hot-loop allocs)
// ---------------------------------------------------------------------------

export interface WorldEventForceSample {
  vx: number;
  vz: number;
  insideEvent: boolean;
  /** 0..1 strength indicator inside event */
  strength: number;
}

const ZERO_FORCE: WorldEventForceSample = { vx: 0, vz: 0, insideEvent: false, strength: 0 };

/**
 * Evaluates directional current (Flash Flood) or bounded radial/tangential pull (Whirlpool)
 * for any water-borne entity. Never applies forces on land and never exceeds safe bounds.
 */
export function evaluateWorldEventForce(
  event: ActiveWorldEventState | null | undefined,
  x: number,
  z: number,
  isOnShore: boolean,
  form: EvolutionForm = 1
): WorldEventForceSample {
  if (!event || isOnShore) return ZERO_FORCE;
  if (event.phase !== 'active' && event.phase !== 'dissipating') return ZERO_FORCE;
  if (event.intensity <= 0.01) return ZERO_FORCE;

  if (event.kind === 'flash_flood') {
    const dx = x - event.x;
    const dz = z - event.z;
    const cosA = Math.cos(event.flowAngle);
    const sinA = Math.sin(event.flowAngle);
    const along = dx * cosA + dz * sinA;
    const across = -dx * sinA + dz * cosA;
    const absAlong = Math.abs(along);
    const absAcross = Math.abs(across);
    if (absAlong > event.corridorHalfLength || absAcross > event.corridorHalfWidth) {
      return ZERO_FORCE;
    }

    // Smoothly feather corridor edges so transition feels organic
    const sideT = 1 - absAcross / Math.max(1, event.corridorHalfWidth);
    const endT = 1 - absAlong / Math.max(1, event.corridorHalfLength);
    const edgeFactor = Math.min(1, sideT * 2.6) * Math.min(1, endT * 3.0);
    // Larger evolved forms brace slightly better against currents while still riding them
    const formScale = form === 1 ? 1.0 : form === 2 ? 0.94 : 0.86;
    const mag = Math.min(FLASH_FLOOD_MAX_CURRENT, event.flowSpeed) * event.intensity * edgeFactor * formScale;
    return {
      vx: cosA * mag,
      vz: sinA * mag,
      insideEvent: true,
      strength: Math.min(1, event.intensity * edgeFactor),
    };
  }

  if (event.kind === 'whirlpool') {
    const dx = event.x - x;
    const dz = event.z - z;
    const distSq = dx * dx + dz * dz;
    const maxR = Math.max(40, event.radius);
    if (distSq > maxR * maxR) return ZERO_FORCE;

    const dist = Math.sqrt(distSq);
    if (dist < 1e-3) {
      return { vx: 0, vz: 0, insideEvent: true, strength: event.intensity };
    }

    const rNorm = dist / maxR; // 0 at center, 1 at rim
    // Smooth curve: gentle at outer rim (~15%), rises smoothly toward inner-mid, tapers to 0 at core singularity
    const outerCurve = Math.pow(1 - rNorm, 0.72);
    const coreDamp = dist < 32 ? dist / 32 : 1;
    const formBrace = form >= 3 ? 0.9 : 1.0;

    const inwardMag =
      Math.min(WHIRLPOOL_MAX_PULL_SPEED, event.flowSpeed) *
      (0.16 + 0.84 * outerCurve) *
      coreDamp *
      event.intensity *
      formBrace;
    const swirlMag = WHIRLPOOL_MAX_SWIRL_SPEED * (0.3 + 0.7 * (1 - rNorm)) * coreDamp * event.intensity;

    const invD = 1 / dist;
    const rx = dx * invD;
    const rz = dz * invD;
    // Counter-clockwise tangential swirl
    const tx = -rz;
    const tz = rx;

    return {
      vx: rx * inwardMag + tx * swirlMag,
      vz: rz * inwardMag + tz * swirlMag,
      insideEvent: true,
      strength: Math.min(1, (0.2 + 0.8 * outerCurve) * event.intensity),
    };
  }

  return ZERO_FORCE;
}

/**
 * Computes localized Air Keruh (Silt Bloom) visibility multiplier between an observer
 * and a target. Returns 1.0 outside the silt cloud, and smoothly drops to ~0.50 (50%
 * visual detection range reduction) inside the cloud. Both AI and player obey this rule.
 */
export function evaluateSiltVisibilityMultiplier(
  event: ActiveWorldEventState | null | undefined,
  observerX: number,
  observerZ: number,
  targetX?: number,
  targetZ?: number
): number {
  if (!event || event.kind !== 'silt_bloom') return 1.0;
  if (event.phase !== 'active' && event.phase !== 'dissipating') return 1.0;
  if (event.intensity <= 0.02) return 1.0;

  const r = Math.max(40, event.radius);
  const rSq = r * r;
  const obsD2 = (observerX - event.x) ** 2 + (observerZ - event.z) ** 2;
  let affected = obsD2 <= rSq;

  if (!affected && targetX !== undefined && targetZ !== undefined) {
    const tgtD2 = (targetX - event.x) ** 2 + (targetZ - event.z) ** 2;
    if (tgtD2 <= rSq) {
      affected = true;
    } else {
      // Midpoint sightline check for viewing across the silt cloud
      const midX = (observerX + targetX) * 0.5;
      const midZ = (observerZ + targetZ) * 0.5;
      if ((midX - event.x) ** 2 + (midZ - event.z) ** 2 <= rSq * 0.88) {
        affected = true;
      }
    }
  }

  if (!affected) return 1.0;
  return 1 - (1 - SILT_BLOOM_VISIBILITY_MULT) * event.intensity;
}

/**
 * Checks whether a water-borne entity intersects the moving Jaring Hanyut (Drifting Fishing Net).
 */
export function checkDriftingNetContact(
  event: ActiveWorldEventState | null | undefined,
  x: number,
  z: number,
  entityRadius: number,
  isOnShore: boolean
): boolean {
  if (!event || event.kind !== 'drifting_net' || isOnShore) return false;
  if (event.phase !== 'active' && event.phase !== 'dissipating') return false;
  if (event.intensity <= 0.18) return false;

  const dx = x - event.x;
  const dz = z - event.z;
  const maxCheck = event.corridorHalfLength + entityRadius + 30;
  if (dx * dx + dz * dz > maxCheck * maxCheck) return false;

  // Net mesh spans perpendicular to travel angle (flowAngle)
  const cosA = Math.cos(event.flowAngle);
  const sinA = Math.sin(event.flowAngle);
  const alongTravel = dx * cosA + dz * sinA;
  const acrossNet = -dx * sinA + dz * cosA;

  return (
    Math.abs(alongTravel) <= event.corridorHalfWidth + entityRadius &&
    Math.abs(acrossNet) <= event.corridorHalfLength + entityRadius
  );
}

/**
 * Shared spatial risk & escape vector evaluator used by both AI steering and player HUD warnings.
 */
export interface EventAvoidanceInfo {
  inside: boolean;
  dangerScore: number; // 0..100
  escapeAngle: number;
  severity: 'warning' | 'active' | null;
}

const NO_AVOIDANCE: EventAvoidanceInfo = {
  inside: false,
  dangerScore: 0,
  escapeAngle: 0,
  severity: null,
};

export function evaluateEventAvoidance(
  event: ActiveWorldEventState | null | undefined,
  x: number,
  z: number,
  entityRadius = 22
): EventAvoidanceInfo {
  if (!event) return NO_AVOIDANCE;
  if (event.phase === 'dormant' || event.phase === 'complete') return NO_AVOIDANCE;

  const sev: 'warning' | 'active' = event.phase === 'warning' ? 'warning' : 'active';
  const phaseScale = event.phase === 'warning' ? 0.65 : event.phase === 'dissipating' ? 0.45 : 1.0;

  if (event.kind === 'whirlpool') {
    const dx = x - event.x;
    const dz = z - event.z;
    const dist = Math.hypot(dx, dz);
    const padRadius = event.radius + entityRadius + 40;
    if (dist > padRadius) return NO_AVOIDANCE;
    const proximity = 1 - Math.min(1, dist / padRadius);
    const escapeAngle = Math.atan2(dz, dx);
    return {
      inside: dist <= event.radius + entityRadius,
      dangerScore: (24 + proximity * 76) * phaseScale,
      escapeAngle,
      severity: sev,
    };
  }

  if (event.kind === 'drifting_net') {
    // Check both current net position and short forward projection along drift path
    const leadDist = event.phase === 'warning' ? 60 : 95;
    const projX = event.x + Math.cos(event.flowAngle) * leadDist;
    const projZ = event.z + Math.sin(event.flowAngle) * leadDist;
    const dNow = Math.hypot(x - event.x, z - event.z);
    const dProj = Math.hypot(x - projX, z - projZ);
    const dMin = Math.min(dNow, dProj);
    const dangerR = event.corridorHalfLength + entityRadius + 75;
    if (dMin > dangerR) return NO_AVOIDANCE;

    // Sidestep perpendicular to net drift
    const cosA = Math.cos(event.flowAngle);
    const sinA = Math.sin(event.flowAngle);
    const across = -(x - event.x) * sinA + (z - event.z) * cosA;
    const perpAngle = event.flowAngle + (across >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
    const proximity = 1 - Math.min(1, dMin / dangerR);
    return {
      inside: dNow <= event.corridorHalfLength + entityRadius + 24,
      dangerScore: (22 + proximity * 72) * phaseScale,
      escapeAngle: perpAngle,
      severity: sev,
    };
  }

  if (event.kind === 'flash_flood') {
    const dx = x - event.x;
    const dz = z - event.z;
    const cosA = Math.cos(event.flowAngle);
    const sinA = Math.sin(event.flowAngle);
    const along = dx * cosA + dz * sinA;
    const across = -dx * sinA + dz * cosA;
    const padW = event.corridorHalfWidth + entityRadius + 30;
    const padL = event.corridorHalfLength + entityRadius + 30;
    if (Math.abs(along) > padL || Math.abs(across) > padW) return NO_AVOIDANCE;

    const sideEscape = event.flowAngle + (across >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
    const proximity = 1 - Math.min(1, Math.abs(across) / padW);
    return {
      inside:
        Math.abs(along) <= event.corridorHalfLength && Math.abs(across) <= event.corridorHalfWidth,
      dangerScore: (14 + proximity * 42) * phaseScale,
      escapeAngle: sideEscape,
      severity: sev,
    };
  }

  if (event.kind === 'silt_bloom') {
    const dx = x - event.x;
    const dz = z - event.z;
    const dist = Math.hypot(dx, dz);
    if (dist > event.radius + entityRadius) return NO_AVOIDANCE;
    return {
      inside: true,
      dangerScore: 12 * phaseScale, // Tactical cover, low direct hazard
      escapeAngle: Math.atan2(dz, dx),
      severity: sev,
    };
  }

  return NO_AVOIDANCE;
}

export function computePlayerEventThreat(
  event: ActiveWorldEventState | null | undefined,
  playerX: number,
  playerZ: number,
  playerRadius: number
): PlayerEventThreat | null {
  if (!event) return null;
  if (event.phase === 'dormant' || event.phase === 'complete') return null;
  const avoid = evaluateEventAvoidance(event, playerX, playerZ, playerRadius);
  if (!avoid.inside && avoid.dangerScore < 28) return null;
  if (!avoid.severity) return null;
  return {
    kind: event.kind,
    label: event.label,
    escapeAngle: avoid.escapeAngle,
    severity: avoid.severity,
  };
}

// ---------------------------------------------------------------------------
// EnvironmentalEventDirector
// ---------------------------------------------------------------------------

export interface EnvironmentalEventStepOutput {
  activeEvent: ActiveWorldEventState | null;
  phaseJustChanged: boolean;
  newPhase: WorldEventPhase | null;
  eventJustStartedWarning: boolean;
  eventJustActivated: boolean;
  eventJustCompleted: boolean;
}

export interface EnvironmentalEventDirectorOptions {
  lobbySize: LobbySize;
  matchSeed: number;
  enabled?: boolean;
}

export class EnvironmentalEventDirector {
  public readonly lobbySize: LobbySize;
  public readonly matchSeed: number;
  public readonly profile: LobbyEventScheduleProfile;
  public enabled: boolean;

  private rng: () => number;
  private activeEvent: ActiveWorldEventState | null = null;
  private nextEventTime: number;
  private eventSeq = 0;
  private lastKind: WorldEventKind | null = null;
  private recentKinds: WorldEventKind[] = [];
  private completedCount = 0;

  constructor(options: EnvironmentalEventDirectorOptions) {
    this.lobbySize = options.lobbySize;
    this.matchSeed = options.matchSeed;
    this.enabled = options.enabled ?? true;
    this.profile = LOBBY_EVENT_SCHEDULES[options.lobbySize];
    this.rng = createEventRng((options.matchSeed ^ 0x51a7e08) >>> 0);
    this.nextEventTime = this.randRange(
      this.profile.firstEventMinSec,
      this.profile.firstEventMaxSec
    );
  }

  private randRange(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }

  public getActiveEvent(): ActiveWorldEventState | null {
    return this.activeEvent;
  }

  public getNextScheduledTime(): number {
    return this.nextEventTime;
  }

  public getCompletedCount(): number {
    return this.completedCount;
  }

  public getHistoryCount(): number {
    return this.recentKinds.length;
  }

  /**
   * Immediately terminates and clears any active event (used on match victory / draw / defeat).
   */
  public clearForConclusion(): void {
    this.activeEvent = null;
  }

  /**
   * Picks a balanced next event kind without immediately repeating the prior event.
   */
  private pickNextKind(matchPhase: MatchPhase): WorldEventKind {
    // Pool excludes the immediately preceding event kind to preserve variety
    const pool: WorldEventKind[] = [];
    for (let i = 0; i < ALL_WORLD_EVENT_KINDS.length; i++) {
      const k = ALL_WORLD_EVENT_KINDS[i];
      if (k !== this.lastKind) {
        pool.push(k);
      }
    }
    // Slight thematic bias: early favors flash_flood/silt_bloom/drifting_net, mid/end allows all equally
    if (matchPhase === 'early' && this.rng() < 0.35) {
      const earlyPreferred = pool.filter((k) => k !== 'whirlpool');
      if (earlyPreferred.length > 0) {
        return earlyPreferred[Math.floor(this.rng() * earlyPreferred.length)];
      }
    }
    return pool[Math.floor(this.rng() * pool.length)];
  }

  /**
   * Selects a valid water location anchored inside the current safe zone for the requested event.
   */
  private resolveEventGeometry(
    kind: WorldEventKind,
    zone: ZoneState,
    overridePos?: { x: number; z: number; angle?: number; endX?: number; endZ?: number }
  ): Pick<
    ActiveWorldEventState,
    | 'x'
    | 'z'
    | 'radius'
    | 'corridorHalfLength'
    | 'corridorHalfWidth'
    | 'flowAngle'
    | 'flowSpeed'
    | 'startX'
    | 'startZ'
    | 'endX'
    | 'endZ'
  > | null {
    if (kind === 'flash_flood') {
      if (overridePos) {
        const ang = overridePos.angle ?? 0;
        return {
          x: overridePos.x,
          z: overridePos.z,
          radius: 620,
          corridorHalfLength: 600,
          corridorHalfWidth: 195,
          flowAngle: ang,
          flowSpeed: FLASH_FLOOD_MAX_CURRENT,
          startX: overridePos.x - Math.cos(ang) * 600,
          startZ: overridePos.z - Math.sin(ang) * 600,
          endX: overridePos.x + Math.cos(ang) * 600,
          endZ: overridePos.z + Math.sin(ang) * 600,
        };
      }

      const valid = FLOOD_CORRIDOR_CANDIDATES.filter((c) => isValidWaterEventSite(c.x, c.z, zone));
      if (valid.length > 0) {
        const pick = valid[Math.floor(this.rng() * valid.length)];
        const halfL = Math.min(pick.halfLength, Math.max(360, zone.currentRadius * 0.65));
        return {
          x: pick.x,
          z: pick.z,
          radius: halfL,
          corridorHalfLength: halfL,
          corridorHalfWidth: pick.halfWidth,
          flowAngle: pick.angle,
          flowSpeed: FLASH_FLOOD_MAX_CURRENT,
          startX: pick.x - Math.cos(pick.angle) * halfL,
          startZ: pick.z - Math.sin(pick.angle) * halfL,
          endX: pick.x + Math.cos(pick.angle) * halfL,
          endZ: pick.z + Math.sin(pick.angle) * halfL,
        };
      }

      // Dynamic fallback inside current safe zone water
      for (let attempt = 0; attempt < 24; attempt++) {
        const ang = this.rng() * Math.PI * 2;
        const dist = this.rng() * Math.max(120, zone.currentRadius * 0.55);
        const cx = zone.centerX + Math.cos(ang) * dist;
        const cz = zone.centerZ + Math.sin(ang) * dist;
        if (isValidWaterEventSite(cx, cz, zone)) {
          const flowAngle = this.rng() * Math.PI * 2;
          const halfL = Math.min(540, Math.max(320, zone.currentRadius * 0.6));
          return {
            x: cx,
            z: cz,
            radius: halfL,
            corridorHalfLength: halfL,
            corridorHalfWidth: 185,
            flowAngle,
            flowSpeed: FLASH_FLOOD_MAX_CURRENT,
            startX: cx - Math.cos(flowAngle) * halfL,
            startZ: cz - Math.sin(flowAngle) * halfL,
            endX: cx + Math.cos(flowAngle) * halfL,
            endZ: cz + Math.sin(flowAngle) * halfL,
          };
        }
      }
      return null;
    }

    if (kind === 'silt_bloom') {
      if (overridePos) {
        return {
          x: overridePos.x,
          z: overridePos.z,
          radius: 380,
          corridorHalfLength: 380,
          corridorHalfWidth: 380,
          flowAngle: 0,
          flowSpeed: 0,
          startX: overridePos.x,
          startZ: overridePos.z,
          endX: overridePos.x,
          endZ: overridePos.z,
        };
      }

      const validDeep = DEEP_WATER_CANDIDATES.filter((c) => isValidWaterEventSite(c.x, c.z, zone));
      if (validDeep.length > 0) {
        const pick = validDeep[Math.floor(this.rng() * validDeep.length)];
        const radius = Math.min(410, Math.max(280, zone.currentRadius * 0.42));
        return {
          x: pick.x,
          z: pick.z,
          radius,
          corridorHalfLength: radius,
          corridorHalfWidth: radius,
          flowAngle: 0,
          flowSpeed: 0,
          startX: pick.x,
          startZ: pick.z,
          endX: pick.x,
          endZ: pick.z,
        };
      }

      for (let attempt = 0; attempt < 28; attempt++) {
        const ang = this.rng() * Math.PI * 2;
        const dist = this.rng() * Math.max(120, zone.currentRadius * 0.62);
        const cx = zone.centerX + Math.cos(ang) * dist;
        const cz = zone.centerZ + Math.sin(ang) * dist;
        if (isValidWaterEventSite(cx, cz, zone)) {
          const radius = Math.min(390, Math.max(270, zone.currentRadius * 0.4));
          return {
            x: cx,
            z: cz,
            radius,
            corridorHalfLength: radius,
            corridorHalfWidth: radius,
            flowAngle: 0,
            flowSpeed: 0,
            startX: cx,
            startZ: cz,
            endX: cx,
            endZ: cz,
          };
        }
      }
      return null;
    }

    if (kind === 'whirlpool') {
      if (overridePos) {
        return {
          x: overridePos.x,
          z: overridePos.z,
          radius: 340,
          corridorHalfLength: 340,
          corridorHalfWidth: 340,
          flowAngle: 0,
          flowSpeed: WHIRLPOOL_MAX_PULL_SPEED,
          startX: overridePos.x,
          startZ: overridePos.z,
          endX: overridePos.x,
          endZ: overridePos.z,
        };
      }

      const validDeep = DEEP_WATER_CANDIDATES.filter((c) => isValidDeepWhirlpoolSite(c.x, c.z, zone));
      if (validDeep.length > 0) {
        const pick = validDeep[Math.floor(this.rng() * validDeep.length)];
        const radius = Math.min(360, Math.max(250, zone.currentRadius * 0.36));
        return {
          x: pick.x,
          z: pick.z,
          radius,
          corridorHalfLength: radius,
          corridorHalfWidth: radius,
          flowAngle: 0,
          flowSpeed: WHIRLPOOL_MAX_PULL_SPEED,
          startX: pick.x,
          startZ: pick.z,
          endX: pick.x,
          endZ: pick.z,
        };
      }

      for (let attempt = 0; attempt < 36; attempt++) {
        const ang = this.rng() * Math.PI * 2;
        const dist = this.rng() * Math.max(120, zone.currentRadius * 0.6);
        const cx = zone.centerX + Math.cos(ang) * dist;
        const cz = zone.centerZ + Math.sin(ang) * dist;
        if (isValidDeepWhirlpoolSite(cx, cz, zone)) {
          const radius = Math.min(350, Math.max(240, zone.currentRadius * 0.36));
          return {
            x: cx,
            z: cz,
            radius,
            corridorHalfLength: radius,
            corridorHalfWidth: radius,
            flowAngle: 0,
            flowSpeed: WHIRLPOOL_MAX_PULL_SPEED,
            startX: cx,
            startZ: cz,
            endX: cx,
            endZ: cz,
          };
        }
      }
      return null;
    }

    // drifting_net
    if (overridePos) {
      const ang = overridePos.angle ?? 0;
      const sx = overridePos.x;
      const sz = overridePos.z;
      const ex = overridePos.endX ?? sx + Math.cos(ang) * 680;
      const ez = overridePos.endZ ?? sz + Math.sin(ang) * 680;
      return {
        x: sx,
        z: sz,
        radius: NET_HALF_SPAN + 28,
        corridorHalfLength: NET_HALF_SPAN,
        corridorHalfWidth: NET_HALF_THICKNESS,
        flowAngle: Math.atan2(ez - sz, ex - sx),
        flowSpeed: Math.hypot(ex - sx, ez - sz) / Math.max(6, this.profile.activeDurationSec),
        startX: sx,
        startZ: sz,
        endX: ex,
        endZ: ez,
      };
    }

    const validRoutes = DRIFT_NET_ROUTES.filter((r) =>
      isValidDriftNetRoute(r.startX, r.startZ, r.endX, r.endZ, zone)
    );
    if (validRoutes.length > 0) {
      const r = validRoutes[Math.floor(this.rng() * validRoutes.length)];
      const flowAngle = Math.atan2(r.endZ - r.startZ, r.endX - r.startX);
      const len = Math.hypot(r.endX - r.startX, r.endZ - r.startZ);
      return {
        x: r.startX,
        z: r.startZ,
        radius: NET_HALF_SPAN + 28,
        corridorHalfLength: NET_HALF_SPAN,
        corridorHalfWidth: NET_HALF_THICKNESS,
        flowAngle,
        flowSpeed: len / Math.max(8, this.profile.activeDurationSec),
        startX: r.startX,
        startZ: r.startZ,
        endX: r.endX,
        endZ: r.endZ,
      };
    }

    // Dynamic open-water route inside safe zone
    for (let attempt = 0; attempt < 28; attempt++) {
      const baseAng = this.rng() * Math.PI * 2;
      const span = Math.min(620, Math.max(300, zone.currentRadius * 0.72));
      const sx = zone.centerX - Math.cos(baseAng) * (span * 0.5);
      const sz = zone.centerZ - Math.sin(baseAng) * (span * 0.5);
      const ex = zone.centerX + Math.cos(baseAng) * (span * 0.5);
      const ez = zone.centerZ + Math.sin(baseAng) * (span * 0.5);
      if (isValidDriftNetRoute(sx, sz, ex, ez, zone)) {
        return {
          x: sx,
          z: sz,
          radius: NET_HALF_SPAN + 28,
          corridorHalfLength: NET_HALF_SPAN,
          corridorHalfWidth: NET_HALF_THICKNESS,
          flowAngle: baseAng,
          flowSpeed: span / Math.max(8, this.profile.activeDurationSec),
          startX: sx,
          startZ: sz,
          endX: ex,
          endZ: ez,
        };
      }
    }
    return null;
  }

  /**
   * Deterministic helper to spawn a specific event immediately into WARNING (or directly ACTIVE).
   * Used both internally by scheduling and by automated tests.
   */
  public triggerEventNow(
    kind: WorldEventKind,
    matchTime: number,
    zone: ZoneState,
    options?: {
      startPhase?: 'warning' | 'active';
      overridePos?: { x: number; z: number; angle?: number; endX?: number; endZ?: number };
    }
  ): ActiveWorldEventState | null {
    const geom = this.resolveEventGeometry(kind, zone, options?.overridePos);
    if (!geom) return null;

    const meta = WORLD_EVENT_METADATA[kind];
    const startPhase: WorldEventPhase = options?.startPhase ?? 'warning';
    const phaseDuration =
      startPhase === 'active' ? this.profile.activeDurationSec : this.profile.warningDurationSec;

    this.eventSeq += 1;
    this.lastKind = kind;
    this.recentKinds.push(kind);
    if (this.recentKinds.length > 12) {
      this.recentKinds.shift();
    }

    const ev: ActiveWorldEventState = {
      id: `we_${this.eventSeq}_${kind}`,
      seq: this.eventSeq,
      kind,
      label: meta.label,
      subtitle: meta.subtitle,
      phase: startPhase,
      phaseElapsed: 0,
      phaseDuration,
      remainingSec: phaseDuration,
      intensity: startPhase === 'active' ? 1 : 0.08,
      ...geom,
      driftProgress: 0,
      createdAt: matchTime,
    };

    this.activeEvent = ev;
    return ev;
  }

  /**
   * Advances event scheduling and active lifecycle state machine:
   * DORMANT -> WARNING -> ACTIVE -> DISSIPATING -> COMPLETE (cleared).
   */
  public step(
    dt: number,
    matchTime: number,
    zone: ZoneState,
    matchPhase: MatchPhase,
    aliveCount: number,
    finalFeastActive: boolean,
    matchConcluded: boolean
  ): EnvironmentalEventStepOutput {
    const out: EnvironmentalEventStepOutput = {
      activeEvent: this.activeEvent,
      phaseJustChanged: false,
      newPhase: null,
      eventJustStartedWarning: false,
      eventJustActivated: false,
      eventJustCompleted: false,
    };

    if (!this.enabled || matchConcluded) {
      if (this.activeEvent) {
        this.activeEvent = null;
        out.activeEvent = null;
        out.eventJustCompleted = true;
      }
      return out;
    }

    // Final Feast suppression: never start new events during Final Feast; gently dissipate active ones
    if (finalFeastActive) {
      if (this.activeEvent) {
        if (this.activeEvent.phase === 'warning') {
          this.activeEvent = null;
          out.activeEvent = null;
          out.eventJustCompleted = true;
          return out;
        }
        if (this.activeEvent.phase === 'active') {
          this.activeEvent.phase = 'dissipating';
          this.activeEvent.phaseElapsed = 0;
          this.activeEvent.phaseDuration = Math.min(1.6, this.profile.dissipateDurationSec);
          this.activeEvent.remainingSec = this.activeEvent.phaseDuration;
          out.phaseJustChanged = true;
          out.newPhase = 'dissipating';
        }
      }
    }

    // Advance active event if present
    if (this.activeEvent) {
      const ev = this.activeEvent;
      ev.phaseElapsed += dt;
      ev.remainingSec = Math.max(0, ev.phaseDuration - ev.phaseElapsed);

      if (ev.phase === 'warning') {
        const t = Math.min(1, ev.phaseElapsed / Math.max(0.1, ev.phaseDuration));
        ev.intensity = 0.08 + t * 0.28;
        if (ev.phaseElapsed >= ev.phaseDuration) {
          ev.phase = 'active';
          ev.phaseElapsed = 0;
          ev.phaseDuration = this.profile.activeDurationSec;
          ev.remainingSec = ev.phaseDuration;
          ev.intensity = 0.35;
          out.phaseJustChanged = true;
          out.newPhase = 'active';
          out.eventJustActivated = true;
        }
      } else if (ev.phase === 'active') {
        // Smooth monotonic rise over first 2.0s, sustained peak
        const rampUp = Math.min(1, ev.phaseElapsed / 2.0);
        ev.intensity = Math.max(ev.intensity, 0.35 + rampUp * 0.65);

        if (ev.kind === 'drifting_net') {
          const progress = Math.min(1, ev.phaseElapsed / Math.max(0.5, ev.phaseDuration));
          ev.driftProgress = progress;
          ev.x = ev.startX + (ev.endX - ev.startX) * progress;
          ev.z = ev.startZ + (ev.endZ - ev.startZ) * progress;
        }

        if (ev.phaseElapsed >= ev.phaseDuration) {
          ev.phase = 'dissipating';
          ev.phaseElapsed = 0;
          ev.phaseDuration = this.profile.dissipateDurationSec;
          ev.remainingSec = ev.phaseDuration;
          out.phaseJustChanged = true;
          out.newPhase = 'dissipating';
        }
      } else if (ev.phase === 'dissipating') {
        const t = Math.min(1, ev.phaseElapsed / Math.max(0.1, ev.phaseDuration));
        ev.intensity = Math.max(0, 1 - t);
        if (ev.phaseElapsed >= ev.phaseDuration) {
          ev.phase = 'complete';
          ev.intensity = 0;
          ev.remainingSec = 0;
          this.completedCount += 1;
          this.activeEvent = null;
          this.nextEventTime =
            matchTime + this.randRange(this.profile.intervalMinSec, this.profile.intervalMaxSec);
          out.activeEvent = null;
          out.phaseJustChanged = true;
          out.newPhase = 'complete';
          out.eventJustCompleted = true;
          return out;
        }
      }

      out.activeEvent = this.activeEvent;
      return out;
    }

    // DORMANT state: check if time to trigger a single new event
    if (finalFeastActive) return out;
    // Do not start a brand-new event when only 2 Kelis remain in a very tiny endgame zone
    if (aliveCount <= 2 && zone.currentRadius < 420) return out;
    // Pause new scheduling briefly if the safe zone is actively shrinking with very tight radius
    if (zone.currentRadius < 320) return out;

    if (matchTime >= this.nextEventTime) {
      const primaryKind = this.pickNextKind(matchPhase);
      let created = this.triggerEventNow(primaryKind, matchTime, zone);
      if (!created) {
        // Try fallback valid kinds if terrain inside tiny zone didn't support e.g. whirlpool
        for (let i = 0; i < ALL_WORLD_EVENT_KINDS.length; i++) {
          const fallback = ALL_WORLD_EVENT_KINDS[i];
          if (fallback === primaryKind) continue;
          created = this.triggerEventNow(fallback, matchTime, zone);
          if (created) break;
        }
      }
      if (created) {
        out.activeEvent = created;
        out.phaseJustChanged = true;
        out.newPhase = 'warning';
        out.eventJustStartedWarning = true;
      } else {
        // Push back retry slightly so we don't spin every frame
        this.nextEventTime = matchTime + 8;
      }
    }

    return out;
  }
}

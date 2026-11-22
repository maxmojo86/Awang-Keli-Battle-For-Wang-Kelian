import { getEvolutionForm } from '../data/abilities.ts';
import {
  ECHO_SONAR_RADIUS,
  getHazardAt,
  getHazardModifierForForm,
  getTerrainAt,
  hasClearObstacleLineOfSight,
  OBSTACLES,
  WORLD_SIZE,
  type RockObstacle,
} from './arena.ts';
import {
  applyLocomotionVelocity,
  computeTurnRate,
  getLocomotionProfile,
} from './movement.ts';
import {
  evaluateEventAvoidance,
  evaluateSiltVisibilityMultiplier,
  SILT_BLOOM_MIN_READABLE_RANGE,
} from './environmentalEvents.ts';
import type {
  ActiveWorldEventState,
  AiDebugEntry,
  AiDifficulty,
  AiPersonality,
  AiState,
  CarcassEntity,
  KeliEntity,
  MatchPhase,
  PickupItem,
  WeatherState,
  ZoneState,
} from './types.ts';

// Shared authoritative combat & feeding constants (kept in sync with simulation.ts)
const AI_BITE_CONE_HALF_ANGLE = 0.88;
const AI_EVADE_STAMINA_COST = 24;
const AI_DASH_STAMINA_COST = 18;
const AI_VEIL_STAMINA_COST = 12;
const AI_ELECTROSHOCK_STAMINA_COST = 14;
const AI_MAELSTROM_STAMINA_COST = 16;
const AI_FEED_SOUND_ALERT_RANGE = 460;
const AI_MEDIUM_CARCASS_THRESHOLD = 10;
const AI_LARGE_CARCASS_THRESHOLD = 30;
const AI_SPATIAL_CELL_SIZE = 360;

export const ALL_AI_PERSONALITIES: readonly AiPersonality[] = [
  'aggressive_hunter',
  'cautious_survivor',
  'opportunistic_scavenger',
  'patient_ambusher',
] as const;

export interface AiPersonalityProfile {
  huntWeight: number;
  attackWeight: number;
  retreatWeight: number;
  scavengeWeight: number;
  contestWeight: number;
  ambushWeight: number;
  recoverWeight: number;
  retreatHpThreshold: number;
  abilityBoldness: number;
  feedThreatRadius: number;
}

export const PERSONALITY_WEIGHTS: Record<AiPersonality, AiPersonalityProfile> = {
  aggressive_hunter: {
    huntWeight: 1.32,
    attackWeight: 1.28,
    retreatWeight: 0.72,
    scavengeWeight: 0.92,
    contestWeight: 1.26,
    ambushWeight: 0.78,
    recoverWeight: 0.8,
    retreatHpThreshold: 0.25,
    abilityBoldness: 1.25,
    feedThreatRadius: 138,
  },
  cautious_survivor: {
    huntWeight: 0.74,
    attackWeight: 0.82,
    retreatWeight: 1.4,
    scavengeWeight: 1.08,
    contestWeight: 0.7,
    ambushWeight: 0.92,
    recoverWeight: 1.35,
    retreatHpThreshold: 0.48,
    abilityBoldness: 0.82,
    feedThreatRadius: 205,
  },
  opportunistic_scavenger: {
    huntWeight: 0.88,
    attackWeight: 0.95,
    retreatWeight: 1.08,
    scavengeWeight: 1.42,
    contestWeight: 1.32,
    ambushWeight: 1.04,
    recoverWeight: 1.05,
    retreatHpThreshold: 0.36,
    abilityBoldness: 0.96,
    feedThreatRadius: 175,
  },
  patient_ambusher: {
    huntWeight: 1.06,
    attackWeight: 1.12,
    retreatWeight: 0.96,
    scavengeWeight: 1.05,
    contestWeight: 1.18,
    ambushWeight: 1.45,
    recoverWeight: 1.0,
    retreatHpThreshold: 0.34,
    abilityBoldness: 1.08,
    feedThreatRadius: 165,
  },
};

export interface AiDifficultyProfile {
  reactionDelayMin: number;
  reactionDelayMax: number;
  decisionIntervalMin: number;
  decisionIntervalMax: number;
  distantDecisionIntervalMin: number;
  distantDecisionIntervalMax: number;
  aimJitterRad: number;
  evadeReliability: number;
  abilityComboChance: number;
  contestEagerness: number;
  mistakeChance: number;
  flankSkill: number;
  sonarCadenceSec: number;
}

/**
 * Difficulty scaling is strictly skill-based: reaction times, decision cadence,
 * aim alignment precision, ability timing, and mistake rates.
 * ZERO stat buffs, damage multipliers, stamina bonuses, cooldown discounts, or hidden vision.
 */
export const DIFFICULTY_PROFILES: Record<AiDifficulty, AiDifficultyProfile> = {
  easy: {
    reactionDelayMin: 0.19,
    reactionDelayMax: 0.31,
    decisionIntervalMin: 0.34,
    decisionIntervalMax: 0.52,
    distantDecisionIntervalMin: 0.65,
    distantDecisionIntervalMax: 0.95,
    aimJitterRad: 0.26,
    evadeReliability: 0.38,
    abilityComboChance: 0.38,
    contestEagerness: 0.65,
    mistakeChance: 0.22,
    flankSkill: 0.25,
    sonarCadenceSec: 11.5,
  },
  normal: {
    reactionDelayMin: 0.14,
    reactionDelayMax: 0.24,
    decisionIntervalMin: 0.2,
    decisionIntervalMax: 0.34,
    distantDecisionIntervalMin: 0.52,
    distantDecisionIntervalMax: 0.82,
    aimJitterRad: 0.11,
    evadeReliability: 0.68,
    abilityComboChance: 0.74,
    contestEagerness: 0.95,
    mistakeChance: 0.09,
    flankSkill: 0.65,
    sonarCadenceSec: 7.5,
  },
  hard: {
    reactionDelayMin: 0.05,
    reactionDelayMax: 0.1,
    decisionIntervalMin: 0.13,
    decisionIntervalMax: 0.22,
    distantDecisionIntervalMin: 0.42,
    distantDecisionIntervalMax: 0.68,
    aimJitterRad: 0.035,
    evadeReliability: 0.93,
    abilityComboChance: 0.94,
    contestEagerness: 1.2,
    mistakeChance: 0.025,
    flankSkill: 0.95,
    sonarCadenceSec: 5.2,
  },
};

export interface FeedingDisturbance {
  x: number;
  z: number;
  carcassId: string;
  feederId: string;
  mass: number;
  time: number;
}

export interface AiSimulationContext {
  matchTime: number;
  finalFeastActive: boolean;
  zone: ZoneState;
  weather: WeatherState;
  activeWorldEvent?: ActiveWorldEventState | null;
  kelis: KeliEntity[];
  carcasses: CarcassEntity[];
  pickups: PickupItem[];
  directorHotspots?: ReadonlyArray<{ x: number; z: number; kind: string; radius: number }>;
  matchPhase?: MatchPhase;
  getMoveSpeed: (k: KeliEntity) => number;
  computeRadius: (level: number) => number;
  getFeedRange: (level: number) => number;
  canFeedOnCarcass: (
    k: KeliEntity,
    carc: CarcassEntity,
    includeHysteresis?: boolean
  ) => { ok: boolean; reason: string | null };
  cancelFeeding: (
    k: KeliEntity,
    reason?: 'voluntary' | 'depleted' | 'out_of_range' | 'obstacle' | 'ability'
  ) => boolean;
  tryBiteOrFeed: (k: KeliEntity, playPlayerAudio: boolean) => void;
  tryEvade: (k: KeliEntity) => boolean;
  tryDash: (k: KeliEntity) => void;
  trySonar: (k: KeliEntity) => void;
  tryVeil: (k: KeliEntity) => void;
  tryElectroshock: (k: KeliEntity) => void;
  tryMaelstrom: (k: KeliEntity) => void;
}

export interface BotAiMemory {
  botId: string;
  botIndex: number;
  personality: AiPersonality;
  rng: () => number;
  state: AiState;
  stateScore: number;
  stateLockTimer: number;
  decisionTimer: number;
  targetEntityId: string | null;
  targetCarcassId: string | null;
  targetPickupId: string | null;
  targetLabel: string | null;
  intentAngle: number;
  flankSign: 1 | -1;
  reactionThreatId: string | null;
  reactionTimer: number;
  reactionWillEvade: boolean;
  ambushX: number | null;
  ambushZ: number | null;
  ambushWaitTimer: number;
  sonarCooldownGate: number;
  lastProgressX: number;
  lastProgressZ: number;
  stuckTimer: number;
  aimJitterOffset: number;
  lastHp: number;
  recentDamageTimer: number;
}

export interface TargetDesirabilityResult {
  score: number;
  isThreat: boolean;
  isVulnerable: boolean;
}

export interface AiDecisionOutput {
  state: AiState;
  score: number;
  currentStateLiveScore: number;
  targetEntityId: string | null;
  targetCarcassId: string | null;
  targetPickupId: string | null;
  targetLabel: string | null;
  alertX?: number;
  alertZ?: number;
}

// ============================================================================
// Deterministic Seeded PRNG (Mulberry32 + FNV-1a)
// ============================================================================

export function hashSeed(input: string | number): number {
  const str = typeof input === 'number' ? String(input >>> 0) : input;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically assigns one of the 4 AI personalities using matchSeed, botId, and botIndex.
 * Uses a shuffled-cycle block permutation so lobbies get a balanced mix of all 4 archetypes
 * while staying 100% deterministic for any given matchSeed.
 */
export function assignBotPersonality(
  botId: string,
  botIndex: number,
  matchSeed: number
): AiPersonality {
  const block = Math.floor(Math.max(0, botIndex) / 4);
  const slot = Math.abs(botIndex) % 4;
  const blockSeed = hashSeed(`${matchSeed >>> 0}:block:${block}`);
  const rng = createSeededRng(blockSeed);
  const order: AiPersonality[] = [...ALL_AI_PERSONALITIES];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  // If botIndex is negative or explicit custom ID without sequential index, fall back to ID hash
  if (botIndex < 0) {
    const idHash = hashSeed(`${matchSeed >>> 0}:${botId}`);
    return ALL_AI_PERSONALITIES[idHash % ALL_AI_PERSONALITIES.length];
  }
  return order[slot];
}

// ============================================================================
// Geometry & Static Obstacle Spatial Grid (built once at load for O(1) steering)
// ============================================================================

const GRID_STRIDE = Math.ceil(WORLD_SIZE / AI_SPATIAL_CELL_SIZE) + 2;

function cellKey(cx: number, cz: number): number {
  return (cx + 1) + (cz + 1) * GRID_STRIDE;
}

const STATIC_OBSTACLE_GRID = new Map<number, RockObstacle[]>();
(function buildStaticObstacleGrid() {
  for (let i = 0; i < OBSTACLES.length; i++) {
    const obs = OBSTACLES[i];
    const pad = obs.radius + 64;
    const minCx = Math.floor((obs.x - pad) / AI_SPATIAL_CELL_SIZE);
    const maxCx = Math.floor((obs.x + pad) / AI_SPATIAL_CELL_SIZE);
    const minCz = Math.floor((obs.z - pad) / AI_SPATIAL_CELL_SIZE);
    const maxCz = Math.floor((obs.z + pad) / AI_SPATIAL_CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = cellKey(cx, cz);
        let bucket = STATIC_OBSTACLE_GRID.get(key);
        if (!bucket) {
          bucket = [];
          STATIC_OBSTACLE_GRID.set(key, bucket);
        }
        bucket.push(obs);
      }
    }
  }
})();

export function normalizeAngleDiff(target: number, source: number): number {
  let diff = target - source;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export function rotateAngleTowards(current: number, target: number, maxStep: number): number {
  const diff = normalizeAngleDiff(target, current);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

/**
 * Evaluates obstacle, shore-access, zone-boundary, and hazard penalties at a candidate probe point.
 */
function evaluatePointSafetyPenalty(
  x: number,
  z: number,
  bot: KeliEntity,
  botRadius: number,
  zone: ZoneState,
  avoidShore: boolean,
  alreadyOutsideZone: boolean,
  currentZoneDist: number,
  ignoreSoftHazards = false,
  activeWorldEvent: ActiveWorldEventState | null = null
): number {
  let penalty = 0;

  // Arena bounds check
  const margin = botRadius + 30;
  if (x < margin || x > WORLD_SIZE - margin || z < margin || z > WORLD_SIZE - margin) {
    penalty += 120;
  }

  // Shore access check (strict for Lv 1-39, or when Lv 40-79 is retreating from shore)
  const terrain = getTerrainAt(x, z);
  if (terrain === 'shore') {
    if (bot.level < 40) {
      penalty += 110;
    } else if (avoidShore) {
      penalty += 80;
    }
  }

  // Zone boundary check
  const zDist = Math.hypot(x - zone.centerX, z - zone.centerZ);
  if (!alreadyOutsideZone && zDist > zone.currentRadius - 35) {
    penalty += 65;
  } else if (alreadyOutsideZone && zDist > currentZoneDist) {
    penalty += 55;
  }

  // Obstacle collision check via prebuilt static spatial grid
  const cx = Math.floor(x / AI_SPATIAL_CELL_SIZE);
  const cz = Math.floor(z / AI_SPATIAL_CELL_SIZE);
  const bucket = STATIC_OBSTACLE_GRID.get(cellKey(cx, cz));
  if (bucket) {
    for (let i = 0; i < bucket.length; i++) {
      const obs = bucket[i];
      const clearance = obs.radius + botRadius + 10;
      const dx = x - obs.x;
      const dz = z - obs.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < clearance * clearance) {
        const d = Math.sqrt(dSq);
        penalty += 95 + (clearance - d) * 1.4;
      } else if (dSq < (clearance + 24) * (clearance + 24)) {
        penalty += 14;
      }
    }
  }

  // Environmental hazard avoidance for non-adapted forms (skipped during close-range strike/contest charge)
  if (!ignoreSoftHazards) {
    const hazard = getHazardAt(x, z);
    if (hazard) {
      const mod = getHazardModifierForForm(hazard.kind, getEvolutionForm(bot.level));
      if (mod.speedMult < 0.78) {
        penalty += 10;
      }
      if (mod.staminaRate < -6 && (bot.fatigued || bot.stamina < 60)) {
        penalty += 32;
      }
      if (mod.shoreReserveMult > 1.3 && bot.level >= 40 && bot.level < 80) {
        penalty += 28;
      }
    }
    if (activeWorldEvent && !bot.isOnShore) {
      const evAvoid = evaluateEventAvoidance(activeWorldEvent, x, z, botRadius);
      if (evAvoid.dangerScore > 0) {
        if (activeWorldEvent.kind === 'whirlpool') {
          penalty += evAvoid.dangerScore * 0.85;
        } else if (activeWorldEvent.kind === 'drifting_net') {
          penalty += evAvoid.dangerScore * 0.9;
        } else if (activeWorldEvent.kind === 'flash_flood') {
          penalty += evAvoid.dangerScore * 0.35;
        }
      }
    }
  }

  return penalty;
}

const STEER_OFFSETS = [0, 0.42, -0.42, 0.88, -0.88, 1.36, -1.36, Math.PI];

/**
 * Computes a lightweight local obstacle-aware steering angle around rocks, shore cliffs,
 * inaccessible shore terrain, harmful hazards, and zone walls without per-frame oscillation.
 */
export function computeSteeredAngle(
  bot: KeliEntity,
  desiredAngle: number,
  botRadius: number,
  zone: ZoneState,
  flankSign: 1 | -1 = 1,
  avoidShore = false,
  probeDist = 84,
  ignoreSoftHazards = false,
  activeWorldEvent: ActiveWorldEventState | null = null
): number {
  const currentZoneDist = Math.hypot(bot.x - zone.centerX, bot.z - zone.centerZ);
  const alreadyOutsideZone = currentZoneDist > zone.currentRadius - 60;

  let bestAngle = desiredAngle;
  let bestScore = Infinity;

  for (let i = 0; i < STEER_OFFSETS.length; i++) {
    const rawOffset = STEER_OFFSETS[i];
    const offset = i === 0 || i === STEER_OFFSETS.length - 1 ? rawOffset : rawOffset * flankSign;
    const candAngle = desiredAngle + offset;
    const cosA = Math.cos(candAngle);
    const sinA = Math.sin(candAngle);

    // Two-point forward lookahead (near + mid)
    const p1 = evaluatePointSafetyPenalty(
      bot.x + cosA * (probeDist * 0.55),
      bot.z + sinA * (probeDist * 0.55),
      bot,
      botRadius,
      zone,
      avoidShore,
      alreadyOutsideZone,
      currentZoneDist,
      ignoreSoftHazards,
      activeWorldEvent
    );
    const p2 = evaluatePointSafetyPenalty(
      bot.x + cosA * probeDist,
      bot.z + sinA * probeDist,
      bot,
      botRadius,
      zone,
      avoidShore,
      alreadyOutsideZone,
      currentZoneDist,
      ignoreSoftHazards,
      activeWorldEvent
    );

    // Slight angle deviation cost so direct path wins when clear
    const deviationCost = Math.abs(rawOffset) * 14;
    const total = p1 * 1.15 + p2 * 0.85 + deviationCost;

    if (total < bestScore) {
      bestScore = total;
      bestAngle = candAngle;
      // Fast exit when straight path is completely unobstructed
      if (i === 0 && p1 === 0 && p2 === 0) {
        return desiredAngle;
      }
    }
  }

  return bestAngle;
}

/**
 * Finds the nearest water direction for a Lv.40–79 Keli that needs to exit dry shore
 * before its Shore Reserve depletes.
 */
export function findNearestWaterAngle(
  bot: KeliEntity,
  zone: ZoneState
): number {
  const fallback = Math.atan2(zone.centerZ - bot.z, zone.centerX - bot.x);
  const dirs = 12;
  const radii = [70, 140, 220, 320];
  for (let rIdx = 0; rIdx < radii.length; rIdx++) {
    const dist = radii[rIdx];
    let bestAng: number | null = null;
    let bestZoneBias = Infinity;
    for (let i = 0; i < dirs; i++) {
      const ang = (i / dirs) * Math.PI * 2;
      const tx = bot.x + Math.cos(ang) * dist;
      const tz = bot.z + Math.sin(ang) * dist;
      if (tx < 80 || tx > WORLD_SIZE - 80 || tz < 80 || tz > WORLD_SIZE - 80) continue;
      if (getTerrainAt(tx, tz) !== 'shore') {
        const zd = Math.hypot(tx - zone.centerX, tz - zone.centerZ);
        if (zd < bestZoneBias) {
          bestZoneBias = zd;
          bestAng = ang;
        }
      }
    }
    if (bestAng !== null) return bestAng;
  }
  return fallback;
}

// ============================================================================
// Target Desirability Scoring (Exported & Pure)
// ============================================================================

export function scoreTargetDesirability(
  bot: KeliEntity,
  target: KeliEntity,
  personality: AiPersonality,
  nearbyStrongerCount: number,
  distance?: number
): TargetDesirabilityResult {
  const dist = distance ?? Math.hypot(target.x - bot.x, target.z - bot.z);
  const profile = PERSONALITY_WEIGHTS[personality];
  const botHpFrac = bot.hp / Math.max(1, bot.maxHp);
  const targetHpFrac = target.hp / Math.max(1, target.maxHp);

  // Terrain accessibility gate
  if (target.isOnShore && bot.level < 40) {
    return { score: -100, isThreat: false, isVulnerable: false };
  }

  const levelRatio = (target.level + 2) / (bot.level + 2);
  const isFeeding = Boolean(target.feedingTargetId);
  const isDisabled = target.stunTimer > 0 || target.staggerTimer > 0;
  const isVulnerable = isFeeding || isDisabled || targetHpFrac < 0.38 || target.fatigued;

  // Threat assessment: stronger healthy target is dangerous (matches 1.15x evolution threshold)
  const isThreat =
    levelRatio > 1.15 &&
    targetHpFrac > 0.42 &&
    !isDisabled &&
    !(isFeeding && targetHpFrac < 0.55);

  // Base desirability from relative strength
  let score = 42;
  if (levelRatio <= 0.72) {
    // Clearly weaker prey — reliable kill
    score += 24;
  } else if (levelRatio <= 1.05) {
    // Comparable peer — good fight if healthy
    score += 14;
  } else if (levelRatio <= 1.22) {
    // Slightly stronger — risky unless wounded or distracted
    score -= 14;
  } else if (levelRatio <= 2.0) {
    // Much stronger — avoid unless critically weakened or distracted
    score -= 44;
  } else {
    // Apex disparity (e.g. Lv.20 vs Lv.80) — strongly avoid when healthy
    score -= 78;
  }

  // Target health opportunity (weakened stronger targets become calculated risks!)
  if (targetHpFrac < 0.25) {
    score += 48;
  } else if (targetHpFrac < 0.45) {
    score += 26;
  } else if (targetHpFrac < 0.65) {
    score += 10;
  } else {
    score -= 4;
  }

  // Vulnerability windows (feeding / stunned / fatigued)
  if (isFeeding) {
    score += 34 * profile.contestWeight;
  }
  if (isDisabled) {
    score += 22;
  }
  if (target.fatigued) {
    score += 12;
  }

  // Potential evolution fragment reward when killable
  const killableFactor = targetHpFrac < 0.5 || levelRatio <= 1.12 ? 1.0 : 0.25;
  score += Math.min(28, target.level * 0.45) * killableFactor;

  // Distance falloff
  score -= Math.min(48, dist * 0.085);

  // Bot readiness (HP & stamina)
  if (botHpFrac < profile.retreatHpThreshold) {
    score -= 42;
  } else if (botHpFrac > 0.75) {
    score += 8;
  }
  if (bot.fatigued) {
    score -= 48;
  } else if (bot.stamina < 24) {
    score -= 26;
  }

  // Shore exposure risk for Lv.40–79
  if (target.isOnShore && bot.level >= 40 && bot.level < 80) {
    if (bot.shoreReserve < 5.0) score -= 35;
    else score -= 8;
  }

  // Third-party risk penalty
  if (nearbyStrongerCount > 0) {
    score -= nearbyStrongerCount * (18 * profile.retreatWeight);
  }

  // Personality scaling
  if (score > 0) {
    score *= profile.huntWeight;
  } else {
    score *= 2 - Math.min(1.5, profile.huntWeight);
  }

  return { score, isThreat, isVulnerable };
}

// ============================================================================
// Per-Step Spatial Cache (O(1) local neighbor lookups for up to 100 Kelis)
// ============================================================================

class AiSpatialCache {
  public livingKelis: KeliEntity[] = [];
  public activeCarcasses: CarcassEntity[] = [];
  public activePickups: PickupItem[] = [];
  public feedingDisturbances: FeedingDisturbance[] = [];

  private keliCells = new Map<number, KeliEntity[]>();
  private carcassCells = new Map<number, CarcassEntity[]>();
  private pickupCells = new Map<number, PickupItem[]>();
  private usedKeliKeys: number[] = [];
  private usedCarcassKeys: number[] = [];
  private usedPickupKeys: number[] = [];

  public rebuild(
    kelis: KeliEntity[],
    carcasses: CarcassEntity[],
    pickups: PickupItem[],
    matchTime: number
  ) {
    // Clear reused buckets without reallocating Map entries
    for (let i = 0; i < this.usedKeliKeys.length; i++) {
      this.keliCells.get(this.usedKeliKeys[i])!.length = 0;
    }
    this.usedKeliKeys.length = 0;

    for (let i = 0; i < this.usedCarcassKeys.length; i++) {
      this.carcassCells.get(this.usedCarcassKeys[i])!.length = 0;
    }
    this.usedCarcassKeys.length = 0;

    for (let i = 0; i < this.usedPickupKeys.length; i++) {
      this.pickupCells.get(this.usedPickupKeys[i])!.length = 0;
    }
    this.usedPickupKeys.length = 0;

    this.livingKelis.length = 0;
    for (let i = 0; i < kelis.length; i++) {
      const k = kelis[i];
      if (!k.alive) continue;
      this.livingKelis.push(k);
      const key = cellKey(
        Math.floor(k.x / AI_SPATIAL_CELL_SIZE),
        Math.floor(k.z / AI_SPATIAL_CELL_SIZE)
      );
      let bucket = this.keliCells.get(key);
      if (!bucket) {
        bucket = [];
        this.keliCells.set(key, bucket);
      }
      if (bucket.length === 0) this.usedKeliKeys.push(key);
      bucket.push(k);
    }

    this.activeCarcasses.length = 0;
    for (let i = 0; i < carcasses.length; i++) {
      const c = carcasses[i];
      if (c.consumed || c.mass <= 0) continue;
      this.activeCarcasses.push(c);
      const key = cellKey(
        Math.floor(c.x / AI_SPATIAL_CELL_SIZE),
        Math.floor(c.z / AI_SPATIAL_CELL_SIZE)
      );
      let bucket = this.carcassCells.get(key);
      if (!bucket) {
        bucket = [];
        this.carcassCells.set(key, bucket);
      }
      if (bucket.length === 0) this.usedCarcassKeys.push(key);
      bucket.push(c);
    }

    this.activePickups.length = 0;
    for (let i = 0; i < pickups.length; i++) {
      const pk = pickups[i];
      this.activePickups.push(pk);
      const key = cellKey(
        Math.floor(pk.x / AI_SPATIAL_CELL_SIZE),
        Math.floor(pk.z / AI_SPATIAL_CELL_SIZE)
      );
      let bucket = this.pickupCells.get(key);
      if (!bucket) {
        bucket = [];
        this.pickupCells.set(key, bucket);
      }
      if (bucket.length === 0) this.usedPickupKeys.push(key);
      bucket.push(pk);
    }

    // Expire old feeding disturbances (> 5.5 seconds)
    let write = 0;
    for (let i = 0; i < this.feedingDisturbances.length; i++) {
      const ev = this.feedingDisturbances[i];
      if (matchTime - ev.time <= 5.5) {
        this.feedingDisturbances[write++] = ev;
      }
    }
    this.feedingDisturbances.length = write;
  }

  public recordFeedingDisturbance(ev: FeedingDisturbance) {
    // Update existing entry for same carcass if present
    for (let i = 0; i < this.feedingDisturbances.length; i++) {
      if (this.feedingDisturbances[i].carcassId === ev.carcassId) {
        this.feedingDisturbances[i] = ev;
        return;
      }
    }
    this.feedingDisturbances.push(ev);
    if (this.feedingDisturbances.length > 24) {
      this.feedingDisturbances.shift();
    }
  }

  public queryKelis(x: number, z: number, radius: number, out: KeliEntity[]): void {
    out.length = 0;
    const minCx = Math.floor((x - radius) / AI_SPATIAL_CELL_SIZE);
    const maxCx = Math.floor((x + radius) / AI_SPATIAL_CELL_SIZE);
    const minCz = Math.floor((z - radius) / AI_SPATIAL_CELL_SIZE);
    const maxCz = Math.floor((z + radius) / AI_SPATIAL_CELL_SIZE);
    const rSq = radius * radius;
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.keliCells.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const k = bucket[i];
          const dx = k.x - x;
          const dz = k.z - z;
          if (dx * dx + dz * dz <= rSq) {
            out.push(k);
          }
        }
      }
    }
  }

  public queryCarcasses(x: number, z: number, radius: number, out: CarcassEntity[]): void {
    out.length = 0;
    const minCx = Math.floor((x - radius) / AI_SPATIAL_CELL_SIZE);
    const maxCx = Math.floor((x + radius) / AI_SPATIAL_CELL_SIZE);
    const minCz = Math.floor((z - radius) / AI_SPATIAL_CELL_SIZE);
    const maxCz = Math.floor((z + radius) / AI_SPATIAL_CELL_SIZE);
    const rSq = radius * radius;
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.carcassCells.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const c = bucket[i];
          const dx = c.x - x;
          const dz = c.z - z;
          if (dx * dx + dz * dz <= rSq) {
            out.push(c);
          }
        }
      }
    }
  }

  public queryPickups(x: number, z: number, radius: number, out: PickupItem[]): void {
    out.length = 0;
    const minCx = Math.floor((x - radius) / AI_SPATIAL_CELL_SIZE);
    const maxCx = Math.floor((x + radius) / AI_SPATIAL_CELL_SIZE);
    const minCz = Math.floor((z - radius) / AI_SPATIAL_CELL_SIZE);
    const maxCz = Math.floor((z + radius) / AI_SPATIAL_CELL_SIZE);
    const rSq = radius * radius;
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.pickupCells.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const pk = bucket[i];
          const dx = pk.x - x;
          const dz = pk.z - z;
          if (dx * dx + dz * dz <= rSq) {
            out.push(pk);
          }
        }
      }
    }
  }
}

// ============================================================================
// Main Intelligent Enemy AI Controller
// ============================================================================

export class AiController {
  public readonly matchSeed: number;
  private difficulty: AiDifficulty;
  private memories = new Map<string, BotAiMemory>();
  private cache = new AiSpatialCache();

  // Reusable scratch buffers to keep GC allocations near zero in 100-bot matches
  private scratchKelis: KeliEntity[] = [];
  private scratchCarcasses: CarcassEntity[] = [];
  private scratchPickups: PickupItem[] = [];

  constructor(matchSeed: number, difficulty: AiDifficulty = 'normal') {
    this.matchSeed = matchSeed >>> 0;
    this.difficulty = difficulty;
  }

  public getDifficulty(): AiDifficulty {
    return this.difficulty;
  }

  public setDifficulty(difficulty: AiDifficulty): void {
    this.difficulty = difficulty;
  }

  public registerBot(bot: KeliEntity, botIndex: number): BotAiMemory {
    const existing = this.memories.get(bot.id);
    if (existing) return existing;

    const personality =
      bot.aiPersonality ?? assignBotPersonality(bot.id, botIndex, this.matchSeed);
    const botSeed = hashSeed(`${this.matchSeed}:${bot.id}:${botIndex}`);
    const rng = createSeededRng(botSeed);
    const diff = DIFFICULTY_PROFILES[this.difficulty];

    // Stagger initial decision timer deterministically across bots to distribute CPU load
    const staggeredOffset = ((botIndex % 8) * 0.032) + rng() * 0.05;
    const flankSign: 1 | -1 = rng() < 0.5 ? 1 : -1;

    bot.aiPersonality = personality;
    bot.aiState = 'EXPLORE';
    bot.aiStateScore = 10;
    bot.aiWanderAngle = rng() * Math.PI * 2;
    bot.aiIntentAngle = bot.aiWanderAngle;
    bot.aiGoalTimer = 1.1 + rng() * 1.4;
    bot.aiAggression =
      personality === 'aggressive_hunter'
        ? 0.85
        : personality === 'patient_ambusher'
          ? 0.68
          : personality === 'opportunistic_scavenger'
            ? 0.58
            : 0.38;

    const mem: BotAiMemory = {
      botId: bot.id,
      botIndex,
      personality,
      rng,
      state: 'EXPLORE',
      stateScore: 10,
      stateLockTimer: 0,
      decisionTimer: staggeredOffset,
      targetEntityId: null,
      targetCarcassId: null,
      targetPickupId: null,
      targetLabel: null,
      intentAngle: bot.aiWanderAngle,
      flankSign,
      reactionThreatId: null,
      reactionTimer: 0,
      reactionWillEvade: false,
      ambushX: null,
      ambushZ: null,
      ambushWaitTimer: 0,
      sonarCooldownGate: 1.5 + rng() * diff.sonarCadenceSec,
      lastProgressX: bot.x,
      lastProgressZ: bot.z,
      stuckTimer: 0,
      aimJitterOffset: (rng() - 0.5) * 2 * diff.aimJitterRad,
      lastHp: bot.hp,
      recentDamageTimer: 0,
    };

    this.memories.set(bot.id, mem);
    return mem;
  }

  public getBotMemory(botId: string): BotAiMemory | undefined {
    return this.memories.get(botId);
  }

  public beginStep(
    kelis: KeliEntity[],
    carcasses: CarcassEntity[],
    pickups: PickupItem[],
    matchTime: number
  ): void {
    this.cache.rebuild(kelis, carcasses, pickups, matchTime);
  }

  public recordFeedingDisturbance(
    x: number,
    z: number,
    carcassId: string,
    feederId: string,
    mass: number,
    matchTime: number
  ): void {
    this.cache.recordFeedingDisturbance({
      x,
      z,
      carcassId,
      feederId,
      mass,
      time: matchTime,
    });
  }

  public getDebugEntries(kelis: KeliEntity[]): AiDebugEntry[] {
    const out: AiDebugEntry[] = [];
    for (let i = 0; i < kelis.length; i++) {
      const k = kelis[i];
      if (!k.alive || k.isPlayer) continue;
      const mem = this.memories.get(k.id);
      out.push({
        botId: k.id,
        name: k.name,
        level: k.level,
        personality: mem?.personality ?? k.aiPersonality ?? 'opportunistic_scavenger',
        state: mem?.state ?? k.aiState ?? 'EXPLORE',
        targetId: mem?.targetEntityId ?? mem?.targetCarcassId ?? mem?.targetPickupId ?? null,
        targetLabel: mem?.targetLabel ?? k.aiTargetLabel ?? null,
        hpPct: Math.round((k.hp / Math.max(1, k.maxHp)) * 100),
        staminaPct: Math.round((k.stamina / Math.max(1, k.maxStamina)) * 100),
        score: Math.round((mem?.stateScore ?? k.aiStateScore ?? 0) * 10) / 10,
        intentAngle: mem?.intentAngle ?? k.aiIntentAngle ?? k.facingAngle,
        x: Math.round(k.x),
        z: Math.round(k.z),
      });
    }
    return out;
  }

  /**
   * Main per-bot update invoked from GameSimulation.updateAiBrain().
   */
  public updateBot(bot: KeliEntity, dt: number, ctx: AiSimulationContext): void {
    // Level 100 Keli King takes no further AI actions (single-fire victory takes precedence)
    if (!bot.alive || bot.level >= 100) return;

    const mem = this.memories.get(bot.id) ?? this.registerBot(bot, this.memories.size);
    const diff = DIFFICULTY_PROFILES[this.difficulty];
    const profile = PERSONALITY_WEIGHTS[mem.personality];

    // Track recently taken damage for responsive feeding cancellation / ambush reaction
    if (bot.hp < mem.lastHp - 0.5) {
      mem.recentDamageTimer = 0.75;
    } else if (mem.recentDamageTimer > 0) {
      mem.recentDamageTimer = Math.max(0, mem.recentDamageTimer - dt);
    }
    mem.lastHp = bot.hp;

    if (bot.stunTimer > 0) {
      applyLocomotionVelocity(bot, 0, 0, 0, dt, getLocomotionProfile(bot.level, bot.isOnShore));
      return;
    }

    if (bot.evadeTimer > 0) {
      const spd = ctx.getMoveSpeed(bot);
      bot.vx = bot.evadeDirX * spd * 2.4;
      bot.vz = bot.evadeDirZ * spd * 2.4;
      const evadeAngle = Math.atan2(bot.evadeDirZ, bot.evadeDirX);
      bot.moveAngle = evadeAngle;
      bot.facingAngle = rotateAngleTowards(bot.facingAngle, evadeAngle, 15 * dt);
      return;
    }

    if (bot.dashTimer > 0) {
      const spd = ctx.getMoveSpeed(bot);
      bot.vx = bot.dashDirX * spd * 2.55;
      bot.vz = bot.dashDirZ * spd * 2.55;
      const dashAngle = Math.atan2(bot.dashDirZ, bot.dashDirX);
      bot.moveAngle = dashAngle;
      bot.facingAngle = rotateAngleTowards(bot.facingAngle, dashAngle, 15 * dt);
      return;
    }

    // Timers
    mem.stateLockTimer = Math.max(0, mem.stateLockTimer - dt);
    mem.decisionTimer -= dt;
    mem.sonarCooldownGate = Math.max(0, mem.sonarCooldownGate - dt);
    bot.aiGoalTimer -= dt;

    const botRadius = ctx.computeRadius(bot.level);
    const spd = ctx.getMoveSpeed(bot);
    const distFromZone = Math.hypot(bot.x - ctx.zone.centerX, bot.z - ctx.zone.centerZ);

    // ------------------------------------------------------------------
    // 1. IMMEDIATE EMERGENCY OVERRIDES (evaluated promptly every tick)
    // ------------------------------------------------------------------

    // 1a. Escape shrinking radioactive zone immediately
    if (distFromZone > ctx.zone.currentRadius - 82) {
      if (bot.feedingTargetId) ctx.cancelFeeding(bot, 'voluntary');
      this.commitState(bot, mem, 'ESCAPE_ZONE', 120, null, null, null, 'Safe Zone', 0.45);
      const rawAng = Math.atan2(ctx.zone.centerZ - bot.z, ctx.zone.centerX - bot.x);
      const steered = computeSteeredAngle(bot, rawAng, botRadius, ctx.zone, mem.flankSign, bot.level < 40);
      this.steerAndMove(bot, mem, steered, spd, dt, 12);
      if (
        bot.level >= 10 &&
        bot.cooldowns.dash <= 0 &&
        bot.stamina >= AI_DASH_STAMINA_COST + 16 &&
        distFromZone > ctx.zone.currentRadius - 25
      ) {
        ctx.tryDash(bot);
      }
      return;
    }

    // 1b. Level 40–79 Shore Reserve emergency exit (well before dehydration damage)
    if (bot.level >= 40 && bot.level < 80 && bot.isOnShore && bot.shoreReserve < 4.2) {
      bot.aiRetreatingFromShore = true;
    } else if (!bot.isOnShore) {
      bot.aiRetreatingFromShore = false;
    }

    if (bot.aiRetreatingFromShore) {
      if (bot.feedingTargetId) ctx.cancelFeeding(bot, 'voluntary');
      this.commitState(bot, mem, 'RETREAT', 105, null, null, null, 'Water (Shore Reserve)', 0.55);
      const waterAng = findNearestWaterAngle(bot, ctx.zone);
      const steered = computeSteeredAngle(bot, waterAng, botRadius, ctx.zone, mem.flankSign, true);
      this.steerAndMove(bot, mem, steered, spd, dt, 13);
      if (
        bot.level >= 10 &&
        bot.cooldowns.dash <= 0 &&
        bot.stamina >= AI_DASH_STAMINA_COST + 10 &&
        bot.shoreReserve < 3.4
      ) {
        ctx.tryDash(bot);
      }
      return;
    }

    // 1b-2. Dynamic World Event response (fair, personality-driven repositioning & escape)
    if (ctx.activeWorldEvent && !bot.isOnShore) {
      // Break out of drifting fishing net entanglement with Dash or Slip Evade when stamina allows
      if ((bot.netEntangleTimer ?? 0) > 0.12 && !bot.fatigued) {
        if (
          bot.level >= 10 &&
          bot.cooldowns.dash <= 0 &&
          bot.stamina >= AI_DASH_STAMINA_COST + 12 &&
          mem.rng() < diff.evadeReliability * 0.85
        ) {
          ctx.tryDash(bot);
        } else if (
          bot.cooldowns.evade <= 0 &&
          bot.stamina >= AI_EVADE_STAMINA_COST + 10 &&
          mem.rng() < diff.evadeReliability * 0.75
        ) {
          ctx.tryEvade(bot);
        }
      }

      const evAvoid = evaluateEventAvoidance(ctx.activeWorldEvent, bot.x, bot.z, botRadius);
      const isDirectHazard =
        ctx.activeWorldEvent.kind === 'whirlpool' ||
        ctx.activeWorldEvent.kind === 'drifting_net' ||
        (ctx.activeWorldEvent.kind === 'flash_flood' && mem.personality === 'cautious_survivor');

      const avoidThreshold =
        mem.personality === 'cautious_survivor'
          ? 34
          : mem.personality === 'opportunistic_scavenger'
            ? 52
            : mem.personality === 'patient_ambusher'
              ? 48
              : 64; // aggressive_hunter pushes deeper before disengaging

      if (isDirectHazard && evAvoid.dangerScore >= avoidThreshold) {
        if (bot.feedingTargetId && evAvoid.dangerScore >= avoidThreshold + 8) {
          ctx.cancelFeeding(bot, 'voluntary');
        }
        this.commitState(
          bot,
          mem,
          'RETREAT',
          86 + evAvoid.dangerScore * 0.35,
          null,
          null,
          null,
          `Evade ${ctx.activeWorldEvent.label}`,
          0.42
        );
        const steered = computeSteeredAngle(
          bot,
          evAvoid.escapeAngle,
          botRadius,
          ctx.zone,
          mem.flankSign,
          bot.level < 40,
          88,
          false,
          ctx.activeWorldEvent
        );
        this.steerAndMove(bot, mem, steered, spd, dt, 13);

        // Escape deep whirlpool core or imminent net snag using Dash or Slip Evade
        if (
          ctx.activeWorldEvent.phase === 'active' &&
          evAvoid.dangerScore >= 68 &&
          !bot.fatigued
        ) {
          if (
            bot.level >= 10 &&
            bot.cooldowns.dash <= 0 &&
            bot.stamina >= AI_DASH_STAMINA_COST + 16
          ) {
            ctx.tryDash(bot);
          } else if (
            bot.cooldowns.evade <= 0 &&
            bot.stamina >= AI_EVADE_STAMINA_COST + 12 &&
            mem.rng() < diff.evadeReliability
          ) {
            ctx.tryEvade(bot);
          }
        }
        return;
      }
    }

    // 1c. Reactive Slip Evade against telegraphed nearby enemy bite windups (with natural reaction delay!)
    if (this.handleTelegraphedWindupReaction(bot, mem, diff, profile, botRadius, spd, dt, ctx)) {
      return;
    }

    // 1d. Active Feeding safety monitor — cancel voluntarily if ambushed or threatened
    if (bot.feedingTargetId) {
      const feedStillSafe = this.monitorActiveFeeding(bot, mem, profile, botRadius, ctx);
      if (!feedStillSafe) {
        // Force immediate re-evaluation this tick after canceling feed
        mem.decisionTimer = 0;
        mem.stateLockTimer = 0;
      }
    }

    // 1e. Responsive low-HP & outnumbered survival break-off: do not facetank to death waiting for decisionTimer
    const hpFracNow = bot.hp / Math.max(1, bot.maxHp);
    if (
      hpFracNow < Math.max(0.68, profile.retreatHpThreshold * 1.15) ||
      mem.recentDamageTimer > 0.1
    ) {
      this.cache.queryKelis(bot.x, bot.z, 210, this.scratchKelis);
      let closestHostile: KeliEntity | null = null;
      let closestHostileDist = Infinity;
      let strongerCount = 0;
      let nearbyHostileCount = 0;
      for (let i = 0; i < this.scratchKelis.length; i++) {
        const other = this.scratchKelis[i];
        if (other.id === bot.id || !other.alive || other.veilTimer > 0) continue;
        const d = Math.hypot(other.x - bot.x, other.z - bot.z);
        if (d < 195) {
          nearbyHostileCount++;
          if (other.level > bot.level * 1.12 && other.hp > other.maxHp * 0.4) {
            strongerCount++;
          }
        }
        if (d < closestHostileDist) {
          closestHostileDist = d;
          closestHostile = other;
        }
      }

      const outnumberedDanger = nearbyHostileCount >= 2 && (strongerCount >= 1 || hpFracNow < 0.65);
      const strongerDanger = strongerCount >= 1 && hpFracNow < 0.72 && closestHostileDist < 170;
      const lowHpDanger =
        hpFracNow < Math.max(0.38, profile.retreatHpThreshold * 0.95) &&
        closestHostile !== null &&
        closestHostile.hp > bot.hp * 1.05;

      if (closestHostile && (outnumberedDanger || strongerDanger || lowHpDanger)) {
        if (bot.feedingTargetId) ctx.cancelFeeding(bot, 'voluntary');
        this.commitState(
          bot,
          mem,
          'RETREAT',
          98 * profile.retreatWeight,
          closestHostile.id,
          null,
          null,
          `Emergency Flee ${closestHostile.name}`,
          0.75
        );
        const fleeAng = Math.atan2(bot.z - closestHostile.z, bot.x - closestHostile.x);
        const steered = computeSteeredAngle(
          bot,
          fleeAng,
          botRadius,
          ctx.zone,
          mem.flankSign,
          bot.level < 40
        );
        this.steerAndMove(bot, mem, steered, spd, dt, 13);
        if (
          bot.level >= 50 &&
          bot.cooldowns.veil <= 0 &&
          bot.stamina >= AI_VEIL_STAMINA_COST + 8
        ) {
          ctx.tryVeil(bot);
        } else if (
          bot.level >= 10 &&
          bot.cooldowns.dash <= 0 &&
          bot.stamina >= AI_DASH_STAMINA_COST + 10
        ) {
          ctx.tryDash(bot);
        } else if (
          bot.cooldowns.evade <= 0 &&
          bot.stamina >= AI_EVADE_STAMINA_COST + 6 &&
          closestHostileDist < 120
        ) {
          ctx.tryEvade(bot);
        }
        return;
      }
    }

    // ------------------------------------------------------------------
    // 2. STAGGERED UTILITY DECISION EVALUATION (with live-score hysteresis & LOD)
    // ------------------------------------------------------------------
    if (mem.decisionTimer <= 0) {
      const decision = this.evaluateUtilityDecision(bot, mem, diff, profile, botRadius, ctx);

      // Apply hysteresis against the CURRENT tick's recomputed score for mem.state
      // so stale historical emergency scores never trap a bot once the threat clears!
      const urgentSwitch =
        decision.state === 'ESCAPE_ZONE' ||
        decision.state === 'EVADE' ||
        (decision.state === 'RETREAT' && decision.score >= 76) ||
        (decision.state === 'RECOVER' && bot.fatigued) ||
        (decision.state === 'ATTACK' && mem.state === 'AMBUSH');

      const shouldSwitch =
        decision.state === mem.state ||
        urgentSwitch ||
        (mem.stateLockTimer <= 0 &&
          (decision.currentStateLiveScore <= 0 ||
            decision.score > decision.currentStateLiveScore * 1.12));

      if (shouldSwitch) {
        const lockDuration = this.getStateMinDuration(decision.state);
        this.commitState(
          bot,
          mem,
          decision.state,
          decision.score,
          decision.targetEntityId,
          decision.targetCarcassId,
          decision.targetPickupId,
          decision.targetLabel,
          decision.state === mem.state ? Math.max(mem.stateLockTimer, 0.15) : lockDuration
        );
        if (decision.state === 'AMBUSH' && decision.alertX !== undefined && decision.alertZ !== undefined) {
          mem.ambushX = decision.alertX;
          mem.ambushZ = decision.alertZ;
        }
      } else {
        mem.stateScore = Math.max(8, decision.currentStateLiveScore);
        bot.aiStateScore = mem.stateScore;
      }

      // Refresh small aim jitter offset periodically for human-like aiming
      mem.aimJitterOffset = (mem.rng() - 0.5) * 2 * diff.aimJitterRad;

      // Distant LOD: if isolated (no living kelis or carcasses within 640 units), use slower decision cadence
      const isIsolated =
        mem.state === 'EXPLORE' &&
        this.scratchKelis.length <= 1 &&
        this.scratchCarcasses.length === 0;
      const minInt = isIsolated ? diff.distantDecisionIntervalMin : diff.decisionIntervalMin;
      const maxInt = isIsolated ? diff.distantDecisionIntervalMax : diff.decisionIntervalMax;
      mem.decisionTimer = minInt + mem.rng() * (maxInt - minInt);
    }

    // ------------------------------------------------------------------
    // 3. EXECUTE CURRENT AI STATE
    // ------------------------------------------------------------------
    this.executeCurrentState(bot, mem, diff, profile, botRadius, spd, dt, ctx);
  }

  private getStateMinDuration(state: AiState): number {
    switch (state) {
      case 'ATTACK':
      case 'EVADE':
        return 0.25;
      case 'FEED':
        return 0.45;
      case 'RETREAT':
      case 'ESCAPE_ZONE':
        return 0.55;
      case 'AMBUSH':
        return 0.65;
      case 'EXPLORE':
        return 0.7;
      default:
        return 0.38;
    }
  }

  private commitState(
    bot: KeliEntity,
    mem: BotAiMemory,
    state: AiState,
    score: number,
    targetEntityId: string | null,
    targetCarcassId: string | null,
    targetPickupId: string | null,
    targetLabel: string | null,
    lockSec: number
  ) {
    mem.state = state;
    mem.stateScore = score;
    mem.stateLockTimer = lockSec;
    mem.targetEntityId = targetEntityId;
    mem.targetCarcassId = targetCarcassId;
    mem.targetPickupId = targetPickupId;
    mem.targetLabel = targetLabel;

    bot.aiState = state;
    bot.aiStateScore = score;
    bot.aiTargetId = targetEntityId ?? targetCarcassId ?? targetPickupId;
    bot.aiTargetLabel = targetLabel;
  }

  /**
   * Detects visible enemy bite windups within strike threat range and triggers
   * Slip Evade only after a natural, difficulty-scaled reaction delay.
   * Zero hidden-input reading; strictly respects 24 stamina cost & 2.2s cooldown.
   */
  private handleTelegraphedWindupReaction(
    bot: KeliEntity,
    mem: BotAiMemory,
    diff: AiDifficultyProfile,
    profile: AiPersonalityProfile,
    botRadius: number,
    spd: number,
    dt: number,
    ctx: AiSimulationContext
  ): boolean {
    if (bot.cooldowns.evade > 0 || bot.stamina < AI_EVADE_STAMINA_COST + 6) {
      mem.reactionThreatId = null;
      mem.reactionTimer = 0;
      return false;
    }

    this.cache.queryKelis(bot.x, bot.z, 145 + botRadius, this.scratchKelis);
    let windingEnemy: KeliEntity | null = null;
    let closestDist = Infinity;

    for (let i = 0; i < this.scratchKelis.length; i++) {
      const other = this.scratchKelis[i];
      if (other.id === bot.id || !other.alive || other.veilTimer > 0) continue;
      if (other.bitePhase !== 'windup') continue;

      const d = Math.hypot(other.x - bot.x, other.z - bot.z);
      const enemyReach = 74 + ctx.computeRadius(other.level) + botRadius;
      if (d > enemyReach) continue;

      // Only react if enemy is actually aimed toward this bot (visible telegraph!)
      const angleToBot = Math.atan2(bot.z - other.z, bot.x - other.x);
      const aimDiff = Math.abs(normalizeAngleDiff(angleToBot, other.biteAimAngle));
      if (aimDiff > AI_BITE_CONE_HALF_ANGLE + 0.3) continue;

      if (d < closestDist) {
        closestDist = d;
        windingEnemy = other;
      }
    }

    if (!windingEnemy) {
      mem.reactionThreatId = null;
      mem.reactionTimer = 0;
      return false;
    }

    // New telegraphed windup spotted — start natural reaction delay
    if (mem.reactionThreatId !== windingEnemy.id) {
      mem.reactionThreatId = windingEnemy.id;
      mem.reactionTimer =
        diff.reactionDelayMin + mem.rng() * (diff.reactionDelayMax - diff.reactionDelayMin);
      const hpFrac = bot.hp / Math.max(1, bot.maxHp);
      const isHighThreatWindup =
        windingEnemy.level > bot.level * 1.05 ||
        hpFrac < 0.72 ||
        Boolean(bot.feedingTargetId) ||
        mem.recentDamageTimer > 0;
      if (this.difficulty !== 'hard' && !isHighThreatWindup) {
        // On easy/normal, healthy bots don't twitch-burn 24 stamina on an equal peer's opening swing
        mem.reactionWillEvade = false;
      } else {
        const dangerBoost =
          windingEnemy.level > bot.level || hpFrac < 0.55 || bot.feedingTargetId ? 0.14 : 0;
        const personalityMod = mem.personality === 'cautious_survivor' ? 0.1 : 0;
        mem.reactionWillEvade =
          mem.rng() < Math.min(0.97, diff.evadeReliability + dangerBoost + personalityMod);
      }
    }

    mem.reactionTimer -= dt;
    if (mem.reactionTimer > 0 || !mem.reactionWillEvade) {
      return false;
    }

    // Execute Slip Evade perpendicular/away from the attacker, avoiding walls/shore
    if (bot.feedingTargetId) {
      ctx.cancelFeeding(bot, 'voluntary');
    }
    const awayAng = Math.atan2(bot.z - windingEnemy.z, bot.x - windingEnemy.x);
    const sidestepAng = awayAng + mem.flankSign * 0.65;
    const steeredEvade = computeSteeredAngle(
      bot,
      sidestepAng,
      botRadius,
      ctx.zone,
      mem.flankSign,
      bot.level < 40,
      70
    );
    bot.vx = Math.cos(steeredEvade) * spd;
    bot.vz = Math.sin(steeredEvade) * spd;
    bot.aiIntentAngle = steeredEvade;
    mem.intentAngle = steeredEvade;

    if (ctx.tryEvade(bot)) {
      mem.reactionThreatId = null;
      mem.reactionTimer = 0;
      this.commitState(
        bot,
        mem,
        'EVADE',
        95 * profile.retreatWeight,
        windingEnemy.id,
        null,
        null,
        windingEnemy.name,
        0.32
      );
      return true;
    }

    return false;
  }

  /**
   * Monitors an actively feeding bot for incoming threats or damage.
   * Returns false if feeding was cancelled due to danger.
   */
  private monitorActiveFeeding(
    bot: KeliEntity,
    mem: BotAiMemory,
    profile: AiPersonalityProfile,
    botRadius: number,
    ctx: AiSimulationContext
  ): boolean {
    const activeCarc = ctx.carcasses.find(
      (c) => c.id === bot.feedingTargetId && !c.consumed && c.mass > 0
    );
    if (!activeCarc || !ctx.canFeedOnCarcass(bot, activeCarc, true).ok) {
      ctx.cancelFeeding(bot, activeCarc ? 'out_of_range' : 'depleted');
      return false;
    }

    // If hit by an attacker while feeding, immediately break off to fight or flee
    if (mem.recentDamageTimer > 0.35 && bot.lastAttackerId) {
      ctx.cancelFeeding(bot, 'voluntary');
      return false;
    }

    // Check nearby approaching threats within personality-scaled threat radius
    const watchRange = profile.feedThreatRadius + botRadius;
    this.cache.queryKelis(bot.x, bot.z, watchRange, this.scratchKelis);
    for (let i = 0; i < this.scratchKelis.length; i++) {
      const other = this.scratchKelis[i];
      if (other.id === bot.id || !other.alive || other.veilTimer > 0) continue;
      if (other.isOnShore && bot.level < 40) continue;

      const d = Math.hypot(other.x - bot.x, other.z - bot.z);
      const isStronger = other.level > bot.level * 1.1;
      const isClosingDanger =
        d < watchRange * (isStronger ? 1.0 : 0.72) &&
        (isStronger || bot.hp < bot.maxHp * 0.55 || other.bitePhase === 'windup');

      if (isClosingDanger) {
        ctx.cancelFeeding(bot, 'voluntary');
        return false;
      }
    }

    // Abort risky feeding if a Whirlpool or Drifting Net bears down directly on the carcass
    if (ctx.activeWorldEvent && !bot.isOnShore) {
      if (
        ctx.activeWorldEvent.kind === 'whirlpool' ||
        ctx.activeWorldEvent.kind === 'drifting_net'
      ) {
        const evRisk = evaluateEventAvoidance(ctx.activeWorldEvent, bot.x, bot.z, botRadius);
        const cancelThreshold = mem.personality === 'cautious_survivor' ? 42 : 62;
        if (evRisk.dangerScore >= cancelThreshold) {
          ctx.cancelFeeding(bot, 'voluntary');
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Utility-based evaluation across all 12 AI states using only permitted perception.
   */
  public evaluateUtilityDecision(
    bot: KeliEntity,
    mem: BotAiMemory,
    diff: AiDifficultyProfile,
    profile: AiPersonalityProfile,
    botRadius: number,
    ctx: AiSimulationContext
  ): AiDecisionOutput {
    const vis = ctx.weather.visibilityRange;
    const basePerception = (bot.sonarTimer > 0 ? Math.max(540, ECHO_SONAR_RADIUS * vis) : 490) * vis;
    const hpFrac = bot.hp / Math.max(1, bot.maxHp);
    const stamFrac = bot.stamina / Math.max(1, bot.maxStamina);
    const strikeReach = 64 + botRadius;

    // 1. Gather locally perceived Kelis via spatial grid
    this.cache.queryKelis(bot.x, bot.z, basePerception, this.scratchKelis);

    let bestPrey: KeliEntity | null = null;
    let bestPreyScore = -Infinity;
    let bestPreyDist = Infinity;
    let bestThreat: KeliEntity | null = null;
    let bestThreatDist = Infinity;
    let bestThreatDanger = 0;

    // Count nearby strong Kelis once for third-party risk awareness
    for (let i = 0; i < this.scratchKelis.length; i++) {
      const other = this.scratchKelis[i];
      if (other.id === bot.id || !other.alive) continue;
      // Silt Veil disrupts perception cleanly (no cheating)
      if (other.veilTimer > 0) continue;
      if (other.isOnShore && bot.level < 40) continue;

      const d = Math.hypot(other.x - bot.x, other.z - bot.z);

      // Localized Air Keruh (Silt Bloom) restricts AI visual sight identically to players,
      // while preserving close-range combat readability and legitimate Echo/Hunter Sonar detection
      if (bot.sonarTimer <= 0 && ctx.activeWorldEvent?.kind === 'silt_bloom') {
        const siltMult = evaluateSiltVisibilityMultiplier(
          ctx.activeWorldEvent,
          bot.x,
          bot.z,
          other.x,
          other.z
        );
        if (siltMult < 0.99) {
          const effectiveSight = Math.max(SILT_BLOOM_MIN_READABLE_RANGE, basePerception * siltMult);
          if (d > effectiveSight) continue;
        }
      }

      // Count stronger third-parties near `other`
      let thirdPartyStrong = 0;
      for (let j = 0; j < this.scratchKelis.length; j++) {
        const third = this.scratchKelis[j];
        if (third.id === bot.id || third.id === other.id || !third.alive || third.veilTimer > 0) {
          continue;
        }
        if (third.level > bot.level * 1.18) {
          const td = Math.hypot(third.x - other.x, third.z - other.z);
          if (td < 240) thirdPartyStrong++;
        }
      }

      const evalRes = scoreTargetDesirability(bot, other, mem.personality, thirdPartyStrong, d);
      if (evalRes.isThreat && d < 320 * vis) {
        const danger =
          ((other.level + 4) / (bot.level + 4)) * 34 +
          (1 - Math.min(1, d / (320 * vis))) * 45 +
          (1 - hpFrac) * 35;
        if (danger > bestThreatDanger) {
          bestThreatDanger = danger;
          bestThreat = other;
          bestThreatDist = d;
        }
      }

      if (evalRes.score > bestPreyScore) {
        bestPreyScore = evalRes.score;
        bestPrey = other;
        bestPreyDist = d;
      }
    }

    // Lv.80+ Hunter Sonar: permitted global detection of STRICTLY lower-level Kelis ONLY while active!
    let hunterSonarPrey: KeliEntity | null = null;
    let hunterSonarDist = Infinity;
    if (bot.level >= 80 && bot.sonarTimer > 0 && bot.sonarIsHunter && bestPreyScore < 35) {
      for (let i = 0; i < this.cache.livingKelis.length; i++) {
        const other = this.cache.livingKelis[i];
        if (other.id === bot.id || !other.alive || other.veilTimer > 0) continue;
        if (other.level >= bot.level) continue; // Strictly lower-level only, matching player Hunter Sonar
        const d = Math.hypot(other.x - bot.x, other.z - bot.z);
        if (d < hunterSonarDist) {
          hunterSonarDist = d;
          hunterSonarPrey = other;
        }
      }
    }

    // 2. Gather reachable carcasses
    const carcassScanRadius = ctx.finalFeastActive ? WORLD_SIZE * 2 : Math.max(580 * vis, 520);
    if (ctx.finalFeastActive) {
      this.scratchCarcasses.length = 0;
      for (let i = 0; i < this.cache.activeCarcasses.length; i++) {
        this.scratchCarcasses.push(this.cache.activeCarcasses[i]);
      }
    } else {
      this.cache.queryCarcasses(bot.x, bot.z, carcassScanRadius, this.scratchCarcasses);
    }

    let bestCarc: CarcassEntity | null = null;
    let bestCarcScore = -Infinity;
    let bestCarcDist = Infinity;
    let bestCarcRival: KeliEntity | null = null;

    for (let i = 0; i < this.scratchCarcasses.length; i++) {
      const c = this.scratchCarcasses[i];
      if (c.consumed || c.mass <= 0) continue;
      if (getTerrainAt(c.x, c.z) === 'shore' && bot.level < 40) continue;
      if (getTerrainAt(c.x, c.z) === 'shore' && bot.level < 80 && bot.shoreReserve < 4.5) continue;

      const d = Math.hypot(c.x - bot.x, c.z - bot.z);
      // Value tier weighting (small 1-9, medium 10-29, large 30+)
      const massValue =
        c.mass >= AI_LARGE_CARCASS_THRESHOLD
          ? 76
          : c.mass >= AI_MEDIUM_CARCASS_THRESHOLD
            ? 56 + (c.mass - 10) * 0.8
            : 34 + c.mass * 2.2;
      const partialBonus =
        c.initialMass !== undefined && c.mass < c.initialMass ? 8 : 0; // Leftover/stolen fragments!

      // Check if another Keli is currently feeding on this carcass
      let rivalFeeder: KeliEntity | null = null;
      for (let j = 0; j < this.scratchKelis.length; j++) {
        const k = this.scratchKelis[j];
        if (k.id !== bot.id && k.alive && k.veilTimer <= 0 && k.feedingTargetId === c.id) {
          rivalFeeder = k;
          break;
        }
      }

      let score =
        (massValue + partialBonus - Math.min(46, d * 0.068)) *
        profile.scavengeWeight;

      if (ctx.finalFeastActive) {
        score += 45;
      }

      // If contested by a much stronger healthy rival, cautious bots penalize heavily
      if (rivalFeeder) {
        const rivalRatio = (rivalFeeder.level + 2) / (bot.level + 2);
        if (rivalRatio > 1.35 && rivalFeeder.hp > rivalFeeder.maxHp * 0.55) {
          score -= 42 * profile.retreatWeight;
        } else {
          score += 12 * profile.contestWeight * diff.contestEagerness;
        }
      }

      if (score > bestCarcScore) {
        bestCarcScore = score;
        bestCarc = c;
        bestCarcDist = d;
        bestCarcRival = rivalFeeder;
      }
    }

    // 3. Check local feeding sound disturbances (strictly within FEED_SOUND_ALERT_RANGE = 460)
    let bestFeedAlert: FeedingDisturbance | null = null;
    let bestFeedAlertScore = -Infinity;
    for (let i = 0; i < this.cache.feedingDisturbances.length; i++) {
      const ev = this.cache.feedingDisturbances[i];
      if (ev.feederId === bot.id) continue;
      const d = Math.hypot(ev.x - bot.x, ev.z - bot.z);
      if (d > AI_FEED_SOUND_ALERT_RANGE) continue;
      if (getTerrainAt(ev.x, ev.z) === 'shore' && bot.level < 40) continue;
      const score =
        (40 + Math.min(34, ev.mass * 1.1) - d * 0.06) *
        Math.max(profile.contestWeight, profile.ambushWeight) *
        diff.contestEagerness;
      if (score > bestFeedAlertScore) {
        bestFeedAlertScore = score;
        bestFeedAlert = ev;
      }
    }

    // 4. Gather nearby helpful pickups
    this.cache.queryPickups(bot.x, bot.z, 340 * vis, this.scratchPickups);
    let bestPickup: PickupItem | null = null;
    let bestPickupScore = -Infinity;
    for (let i = 0; i < this.scratchPickups.length; i++) {
      const pk = this.scratchPickups[i];
      if (getTerrainAt(pk.x, pk.z) === 'shore' && bot.level < 40) continue;
      const isHeal = pk.kind === 'kelp_salve' || pk.kind === 'monsoon_dew';
      if (isHeal && hpFrac > 0.86 && bot.venomTimer <= 0) continue;
      const d = Math.hypot(pk.x - bot.x, pk.z - bot.z);
      let s = (isHeal ? (1 - hpFrac) * 85 + 22 : 34) - d * 0.1;
      if (isHeal && bot.venomTimer > 0) s += 20;
      if (pk.rainFed) s += 10;
      s *= profile.recoverWeight;
      if (s > bestPickupScore) {
        bestPickupScore = s;
        bestPickup = pk;
      }
    }

    // ------------------------------------------------------------------
    // Score all candidate states and pick highest utility (with human-like minor noise)
    // ------------------------------------------------------------------
    let best: AiDecisionOutput = {
      state: 'EXPLORE',
      score: 18,
      currentStateLiveScore: mem.state === 'EXPLORE' ? 18 : 0,
      targetEntityId: null,
      targetCarcassId: null,
      targetPickupId: null,
      targetLabel: 'Patrol Basin',
    };

    let currentStateLiveScore = mem.state === 'EXPLORE' ? 18 : 0;

    const consider = (cand: Omit<AiDecisionOutput, 'currentStateLiveScore'>) => {
      // Optional small mistake jitter on easier difficulties (never overrides survival emergencies)
      let adj = cand.score;
      if (
        diff.mistakeChance > 0 &&
        cand.state !== 'ESCAPE_ZONE' &&
        cand.state !== 'RETREAT' &&
        mem.rng() < diff.mistakeChance
      ) {
        adj *= 0.84;
      }
      if (cand.state === mem.state && adj > currentStateLiveScore) {
        currentStateLiveScore = adj;
      }
      if (adj > best.score) {
        best = { ...cand, score: adj, currentStateLiveScore };
      }
    };

    // RETREAT: low HP or close stronger healthy threat
    if (bestThreat && (bestThreatDist < 240 || hpFrac < profile.retreatHpThreshold + 0.14)) {
      const retreatScore =
        (bestThreatDanger + (hpFrac < profile.retreatHpThreshold ? 40 : 0)) * profile.retreatWeight;
      consider({
        state: 'RETREAT',
        score: retreatScore,
        targetEntityId: bestThreat.id,
        targetCarcassId: null,
        targetPickupId: null,
        targetLabel: `Flee ${bestThreat.name}`,
      });
    } else if (hpFrac < profile.retreatHpThreshold && bestPrey && bestPreyDist < 230) {
      consider({
        state: 'RETREAT',
        score: (68 + (profile.retreatHpThreshold - hpFrac) * 75) * profile.retreatWeight,
        targetEntityId: bestPrey.id,
        targetCarcassId: null,
        targetPickupId: null,
        targetLabel: `Disengage ${bestPrey.name}`,
      });
    }

    // RECOVER: fatigued / very low stamina, or injured near a healing pickup
    if (bot.fatigued || stamFrac < 0.22) {
      const recoverScore = bot.fatigued
        ? 92 + (bestPickup ? 14 : 0)
        : (62 + (bestPickup ? 14 : 0)) * profile.recoverWeight;
      consider({
        state: 'RECOVER',
        score: recoverScore,
        targetEntityId: bestThreat?.id ?? bestPrey?.id ?? null,
        targetCarcassId: null,
        targetPickupId: bestPickup?.id ?? null,
        targetLabel: bestPickup ? `Recover (${bestPickup.kind})` : 'Recover Stamina',
      });
    } else if (bestPickup && bestPickupScore > 36) {
      consider({
        state: 'RECOVER',
        score: bestPickupScore,
        targetEntityId: null,
        targetCarcassId: null,
        targetPickupId: bestPickup.id,
        targetLabel: `Pickup ${bestPickup.kind}`,
      });
    }

    // FEED / SCAVENGE / CONTEST_CARCASS
    if (bestCarc) {
      const feedCheck = ctx.canFeedOnCarcass(bot, bestCarc, Boolean(bot.feedingTargetId));
      if (bestCarcRival) {
        const rivalRatio = (bestCarcRival.level + 2) / (bot.level + 2);
        const canContest =
          rivalRatio <= 1.28 ||
          bestCarcRival.hp < bestCarcRival.maxHp * 0.55 ||
          mem.personality === 'aggressive_hunter';
        if (canContest && !bot.fatigued) {
          consider({
            state: 'CONTEST_CARCASS',
            score: (bestCarcScore + 18) * profile.contestWeight * diff.contestEagerness,
            targetEntityId: bestCarcRival.id,
            targetCarcassId: bestCarc.id,
            targetPickupId: null,
            targetLabel: `Contest ${bestCarc.sourceName} (+${bestCarc.mass})`,
          });
        } else if (mem.personality === 'patient_ambusher' || mem.personality === 'opportunistic_scavenger') {
          consider({
            state: 'AMBUSH',
            score: (bestCarcScore + 6) * profile.ambushWeight,
            targetEntityId: bestCarcRival.id,
            targetCarcassId: bestCarc.id,
            targetPickupId: null,
            targetLabel: `Stalk ${bestCarc.sourceName}`,
            alertX: bestCarc.x,
            alertZ: bestCarc.z,
          });
        }
      } else if (feedCheck.ok || bot.feedingTargetId === bestCarc.id) {
        consider({
          state: 'FEED',
          score: bestCarcScore + 28,
          targetEntityId: null,
          targetCarcassId: bestCarc.id,
          targetPickupId: null,
          targetLabel: `Feed +${bestCarc.mass}`,
        });
      } else {
        consider({
          state: 'SCAVENGE',
          score: bestCarcScore + (bestCarcDist < 200 ? 12 : 0),
          targetEntityId: null,
          targetCarcassId: bestCarc.id,
          targetPickupId: null,
          targetLabel: `Carcass +${bestCarc.mass}`,
        });
      }
    }

    // ATTACK / CHASE / AMBUSH on best perceived target
    if (bestPrey && bestPreyScore > 12) {
      if (bestPreyDist <= strikeReach + 36) {
        consider({
          state: 'ATTACK',
          score: (bestPreyScore + 22) * profile.attackWeight,
          targetEntityId: bestPrey.id,
          targetCarcassId: null,
          targetPickupId: null,
          targetLabel: `Attack ${bestPrey.name}`,
        });
      } else if (
        mem.personality === 'patient_ambusher' &&
        bestPreyDist > strikeReach + 48 &&
        bestPreyDist < 290 &&
        !bestPrey.feedingTargetId &&
        (this.findNearbyCoverAnchor(bot.x, bot.z, bestPrey.x, bestPrey.z) !== null ||
          (ctx.activeWorldEvent?.kind === 'silt_bloom' &&
            ctx.activeWorldEvent.phase === 'active' &&
            Math.hypot(bot.x - ctx.activeWorldEvent.x, bot.z - ctx.activeWorldEvent.z) <
              ctx.activeWorldEvent.radius * 1.15))
      ) {
        const anchor =
          this.findNearbyCoverAnchor(bot.x, bot.z, bestPrey.x, bestPrey.z) ??
          { x: ctx.activeWorldEvent!.x, z: ctx.activeWorldEvent!.z };
        consider({
          state: 'AMBUSH',
          score: (bestPreyScore + 12) * profile.ambushWeight,
          targetEntityId: bestPrey.id,
          targetCarcassId: null,
          targetPickupId: null,
          targetLabel: `Ambush ${bestPrey.name}`,
          alertX: anchor.x,
          alertZ: anchor.z,
        });
      } else {
        consider({
          state: 'CHASE',
          score: bestPreyScore + 8,
          targetEntityId: bestPrey.id,
          targetCarcassId: null,
          targetPickupId: null,
          targetLabel: `Chase ${bestPrey.name}`,
        });
      }
    }

    // HUNT: react to nearby feeding disturbance or Lv.80+ Hunter Sonar prey
    if (bestFeedAlert && !bestCarc) {
      consider({
        state: mem.personality === 'patient_ambusher' ? 'AMBUSH' : 'HUNT',
        score: bestFeedAlertScore,
        targetEntityId: bestFeedAlert.feederId,
        targetCarcassId: bestFeedAlert.carcassId,
        targetPickupId: null,
        targetLabel: `Feed Sound (+${bestFeedAlert.mass})`,
        alertX: bestFeedAlert.x,
        alertZ: bestFeedAlert.z,
      });
    } else if (hunterSonarPrey) {
      consider({
        state: 'HUNT',
        score: 54 * profile.huntWeight,
        targetEntityId: hunterSonarPrey.id,
        targetCarcassId: null,
        targetPickupId: null,
        targetLabel: `Hunter Sonar: ${hunterSonarPrey.name}`,
      });
    }

    best.currentStateLiveScore = currentStateLiveScore;
    return best;
  }

  /**
   * Executes the bot's committed AI state smoothly each tick.
   */
  private executeCurrentState(
    bot: KeliEntity,
    mem: BotAiMemory,
    diff: AiDifficultyProfile,
    profile: AiPersonalityProfile,
    botRadius: number,
    spd: number,
    dt: number,
    ctx: AiSimulationContext
  ) {
    const avoidShore = bot.level < 40 || bot.aiRetreatingFromShore;
    const strikeReach = 64 + botRadius;

    // Periodic progress check to flip flankSign if snagged on geometry
    mem.stuckTimer += dt;
    if (mem.stuckTimer >= 0.65) {
      const moved = Math.hypot(bot.x - mem.lastProgressX, bot.z - mem.lastProgressZ);
      if (moved < 10 && !bot.feedingTargetId && mem.state !== 'AMBUSH') {
        mem.flankSign = mem.flankSign === 1 ? -1 : 1;
        bot.aiWanderAngle += mem.flankSign * 1.15;
      }
      mem.lastProgressX = bot.x;
      mem.lastProgressZ = bot.z;
      mem.stuckTimer = 0;
    }

    switch (mem.state) {
      case 'ESCAPE_ZONE': {
        const ang = Math.atan2(ctx.zone.centerZ - bot.z, ctx.zone.centerX - bot.x);
        const steered = computeSteeredAngle(bot, ang, botRadius, ctx.zone, mem.flankSign, avoidShore);
        this.steerAndMove(bot, mem, steered, spd, dt, 12);
        return;
      }

      case 'RETREAT': {
        const threat = mem.targetEntityId ? this.findLivingKeli(mem.targetEntityId, ctx) : null;
        let fleeAng: number;
        if (threat) {
          fleeAng = Math.atan2(bot.z - threat.z, bot.x - threat.x);
          // Slight inward bias so bots don't back themselves into the radioactive wall
          const toCenter = Math.atan2(ctx.zone.centerZ - bot.z, ctx.zone.centerX - bot.x);
          const distCenter = Math.hypot(bot.x - ctx.zone.centerX, bot.z - ctx.zone.centerZ);
          if (distCenter > ctx.zone.currentRadius * 0.72) {
            fleeAng = rotateAngleTowards(fleeAng, toCenter, 0.7);
          }
        } else {
          fleeAng = Math.atan2(ctx.zone.centerZ - bot.z, ctx.zone.centerX - bot.x);
        }
        const steered = computeSteeredAngle(bot, fleeAng, botRadius, ctx.zone, mem.flankSign, avoidShore);
        this.steerAndMove(bot, mem, steered, spd, dt, 12);

        // Tactical defensive abilities
        const threatDist = threat ? Math.hypot(threat.x - bot.x, threat.z - bot.z) : Infinity;
        if (
          bot.level >= 50 &&
          bot.cooldowns.veil <= 0 &&
          bot.stamina >= AI_VEIL_STAMINA_COST + 10 &&
          threatDist < 240
        ) {
          ctx.tryVeil(bot);
        } else if (
          bot.level >= 10 &&
          bot.cooldowns.dash <= 0 &&
          bot.stamina >= AI_DASH_STAMINA_COST + 14 &&
          threatDist < 220
        ) {
          ctx.tryDash(bot);
        }
        return;
      }

      case 'RECOVER': {
        const pickup = mem.targetPickupId
          ? ctx.pickups.find((p) => p.id === mem.targetPickupId) ?? null
          : null;
        const threat = mem.targetEntityId ? this.findLivingKeli(mem.targetEntityId, ctx) : null;

        if (pickup) {
          const ang = Math.atan2(pickup.z - bot.z, pickup.x - bot.x);
          const steered = computeSteeredAngle(bot, ang, botRadius, ctx.zone, mem.flankSign, avoidShore);
          this.steerAndMove(bot, mem, steered, spd, dt, 11);
          return;
        }

        // Maintain breathing room while stamina regenerates
        const ang = threat
          ? Math.atan2(bot.z - threat.z, bot.x - threat.x) + mem.flankSign * 0.45
          : Math.atan2(ctx.zone.centerZ - bot.z, ctx.zone.centerX - bot.x);
        const steered = computeSteeredAngle(bot, ang, botRadius, ctx.zone, mem.flankSign, avoidShore);
        this.steerAndMove(bot, mem, steered, spd * 0.85, dt, 10);
        return;
      }

      case 'FEED': {
        const carc = mem.targetCarcassId
          ? ctx.carcasses.find((c) => c.id === mem.targetCarcassId && !c.consumed && c.mass > 0) ?? null
          : null;
        if (!carc) {
          if (bot.feedingTargetId) ctx.cancelFeeding(bot, 'depleted');
          mem.decisionTimer = 0;
          return;
        }

        const ang = Math.atan2(carc.z - bot.z, carc.x - bot.x);
        const dist = Math.hypot(carc.x - bot.x, carc.z - bot.z);
        const feedRange = ctx.getFeedRange(bot.level);

        if (bot.feedingTargetId === carc.id) {
          // Stay anchored smoothly facing the carcass while progressive transfer runs
          bot.facingAngle = rotateAngleTowards(bot.facingAngle, ang, 10 * dt);
          applyLocomotionVelocity(bot, 0, 0, 0, dt, getLocomotionProfile(bot.level, bot.isOnShore));
          mem.intentAngle = ang;
          bot.aiIntentAngle = ang;
          return;
        }

        if (dist > feedRange * 0.78 || !hasClearObstacleLineOfSight(bot.x, bot.z, carc.x, carc.z)) {
          const steered = computeSteeredAngle(bot, ang, botRadius, ctx.zone, mem.flankSign, avoidShore);
          this.steerAndMove(bot, mem, steered, spd, dt, 11);
        } else {
          bot.facingAngle = rotateAngleTowards(bot.facingAngle, ang, 14 * dt);
          applyLocomotionVelocity(bot, 0, 0, 0, dt, getLocomotionProfile(bot.level, bot.isOnShore));
          mem.intentAngle = ang;
          bot.aiIntentAngle = ang;
          ctx.tryBiteOrFeed(bot, false);
        }
        return;
      }

      case 'SCAVENGE': {
        const carc = mem.targetCarcassId
          ? ctx.carcasses.find((c) => c.id === mem.targetCarcassId && !c.consumed && c.mass > 0) ?? null
          : null;
        if (!carc) {
          mem.decisionTimer = 0;
          return;
        }

        const ang = Math.atan2(carc.z - bot.z, carc.x - bot.x);
        const dist = Math.hypot(carc.x - bot.x, carc.z - bot.z);
        const feedCheck = ctx.canFeedOnCarcass(bot, carc, false);

        if (feedCheck.ok) {
          bot.facingAngle = rotateAngleTowards(bot.facingAngle, ang, 14 * dt);
          applyLocomotionVelocity(bot, 0, 0, 0, dt, getLocomotionProfile(bot.level, bot.isOnShore));
          mem.intentAngle = ang;
          bot.aiIntentAngle = ang;
          ctx.tryBiteOrFeed(bot, false);
          this.commitState(
            bot,
            mem,
            'FEED',
            mem.stateScore + 12,
            null,
            carc.id,
            null,
            `Feed +${carc.mass}`,
            0.45
          );
          return;
        }

        const steered = computeSteeredAngle(bot, ang, botRadius, ctx.zone, mem.flankSign, avoidShore);
        this.steerAndMove(bot, mem, steered, spd, dt, 11);

        // Dash toward high-value uncontested carcasses when stamina is high
        if (
          carc.mass >= AI_MEDIUM_CARCASS_THRESHOLD &&
          dist > 140 &&
          dist < 320 &&
          bot.level >= 10 &&
          bot.cooldowns.dash <= 0 &&
          bot.stamina >= AI_DASH_STAMINA_COST + 36 &&
          mem.rng() < diff.abilityComboChance * 0.2
        ) {
          ctx.tryDash(bot);
        }
        return;
      }

      case 'CONTEST_CARCASS': {
        const rival = mem.targetEntityId ? this.findLivingKeli(mem.targetEntityId, ctx) : null;
        const carc = mem.targetCarcassId
          ? ctx.carcasses.find((c) => c.id === mem.targetCarcassId && !c.consumed && c.mass > 0) ?? null
          : null;

        if (!carc) {
          mem.decisionTimer = 0;
          return;
        }
        if (!rival || rival.veilTimer > 0) {
          // Rival gone — immediately claim the carcass!
          this.commitState(
            bot,
            mem,
            'SCAVENGE',
            mem.stateScore,
            null,
            carc.id,
            null,
            `Claim +${carc.mass}`,
            0.35
          );
          return;
        }

        // Attack rival feeder to interrupt their feed!
        this.executeCombatEngagement(bot, rival, mem, diff, profile, botRadius, strikeReach, spd, dt, ctx, avoidShore);
        return;
      }

      case 'ATTACK':
      case 'CHASE': {
        const target = mem.targetEntityId ? this.findLivingKeli(mem.targetEntityId, ctx) : null;
        if (!target || target.veilTimer > 0) {
          mem.decisionTimer = 0;
          return;
        }
        this.executeCombatEngagement(bot, target, mem, diff, profile, botRadius, strikeReach, spd, dt, ctx, avoidShore);
        return;
      }

      case 'AMBUSH': {
        const target = mem.targetEntityId ? this.findLivingKeli(mem.targetEntityId, ctx) : null;
        if (target && target.veilTimer <= 0) {
          const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
          // Spring ambush if target enters strike range OR begins feeding!
          if (dist <= strikeReach + 42 || (target.feedingTargetId && dist < 190)) {
            this.commitState(
              bot,
              mem,
              'ATTACK',
              mem.stateScore + 25,
              target.id,
              null,
              null,
              `Spring on ${target.name}`,
              0.4
            );
            this.executeCombatEngagement(bot, target, mem, diff, profile, botRadius, strikeReach, spd, dt, ctx, avoidShore);
            return;
          }

          // Trigger Silt Veil (Lv.50+) to cloak ambush approach
          if (
            bot.level >= 50 &&
            bot.cooldowns.veil <= 0 &&
            bot.stamina >= AI_VEIL_STAMINA_COST + 24 &&
            dist < 230
          ) {
            ctx.tryVeil(bot);
          }
        }

        const ax = mem.ambushX ?? bot.x;
        const az = mem.ambushZ ?? bot.z;
        const distAnchor = Math.hypot(ax - bot.x, az - bot.z);
        if (distAnchor > 32) {
          const ang = Math.atan2(az - bot.z, ax - bot.x);
          const steered = computeSteeredAngle(bot, ang, botRadius, ctx.zone, mem.flankSign, avoidShore);
          this.steerAndMove(bot, mem, steered, spd * 0.88, dt, 10);
        } else {
          // Hold near cover and face prey / carcass
          applyLocomotionVelocity(bot, 0, 0, 0, dt, getLocomotionProfile(bot.level, bot.isOnShore));
          const lookAng = target
            ? Math.atan2(target.z - bot.z, target.x - bot.x)
            : bot.facingAngle;
          bot.facingAngle = rotateAngleTowards(bot.facingAngle, lookAng, 9 * dt);
          mem.intentAngle = lookAng;
          bot.aiIntentAngle = lookAng;
        }
        return;
      }

      case 'HUNT': {
        const target = mem.targetEntityId ? this.findLivingKeli(mem.targetEntityId, ctx) : null;
        let goalX = mem.ambushX ?? ctx.zone.centerX;
        let goalZ = mem.ambushZ ?? ctx.zone.centerZ;
        if (target && target.veilTimer <= 0) {
          // Only track globally if Lv.80+ Hunter Sonar is active and target is lower-level, OR target is within local range
          const d = Math.hypot(target.x - bot.x, target.z - bot.z);
          const allowedGlobal =
            bot.level >= 80 && bot.sonarTimer > 0 && bot.sonarIsHunter && target.level < bot.level;
          if (allowedGlobal || d < 520) {
            goalX = target.x;
            goalZ = target.z;
            if (d <= strikeReach + 48) {
              this.executeCombatEngagement(bot, target, mem, diff, profile, botRadius, strikeReach, spd, dt, ctx, avoidShore);
              return;
            }
          }
        }

        const ang = Math.atan2(goalZ - bot.z, goalX - bot.x);
        const steered = computeSteeredAngle(bot, ang, botRadius, ctx.zone, mem.flankSign, avoidShore);
        this.steerAndMove(bot, mem, steered, spd, dt, 11);

        // Tactical Sonar usage during HUNT
        if (bot.level >= 20 && bot.cooldowns.sonar <= 0 && mem.sonarCooldownGate <= 0) {
          ctx.trySonar(bot);
          mem.sonarCooldownGate = diff.sonarCadenceSec;
        }
        return;
      }

      case 'EVADE':
      case 'EXPLORE':
      default: {
        if (bot.aiGoalTimer <= 0) {
          bot.aiGoalTimer = 1.6 + mem.rng() * 2.1;
          const toCenter = Math.atan2(ctx.zone.centerZ - bot.z, ctx.zone.centerX - bot.x);
          // Purposeful curved exploration inside the safe zone
          bot.aiWanderAngle = toCenter + (mem.rng() - 0.5) * 2.1;

          // Fair encounter pacing: idle EXPLORE bots may naturally investigate public activity
          // hotspots (approximate zones, never hidden/veiled players) without altering movement speed
          if (ctx.directorHotspots && ctx.directorHotspots.length > 0 && !ctx.finalFeastActive) {
            const baseChance =
              ctx.matchPhase === 'endgame' ? 0.62 : ctx.matchPhase === 'mid' ? 0.48 : 0.34;
            const personalityBonus =
              mem.personality === 'aggressive_hunter' || mem.personality === 'opportunistic_scavenger'
                ? 0.14
                : mem.personality === 'cautious_survivor'
                  ? -0.14
                  : 0.04;
            if (mem.rng() < Math.max(0.12, Math.min(0.8, baseChance + personalityBonus))) {
              let bestHotspot: { x: number; z: number } | null = null;
              let bestDist = 1850;
              for (let hi = 0; hi < ctx.directorHotspots.length; hi++) {
                const hs = ctx.directorHotspots[hi];
                // Respect Lv.1-39 shoreline restrictions & safe-zone bounds
                if (avoidShore && getTerrainAt(hs.x, hs.z) === 'shore') continue;
                if (
                  Math.hypot(hs.x - ctx.zone.centerX, hs.z - ctx.zone.centerZ) >
                  ctx.zone.currentRadius * 0.96
                ) {
                  continue;
                }
                const hd = Math.hypot(hs.x - bot.x, hs.z - bot.z);
                if (hd > 130 && hd < bestDist) {
                  bestDist = hd;
                  bestHotspot = hs;
                }
              }
              if (bestHotspot) {
                bot.aiWanderAngle =
                  Math.atan2(bestHotspot.z - bot.z, bestHotspot.x - bot.x) +
                  (mem.rng() - 0.5) * 0.45;
              }
            }
          }

          // Use Echo Sonar (Lv.20+) or Hunter Sonar (Lv.80+) periodically while patrolling
          if (
            bot.level >= 20 &&
            bot.cooldowns.sonar <= 0 &&
            mem.sonarCooldownGate <= 0 &&
            (bot.level >= 80 || mem.rng() < 0.45)
          ) {
            ctx.trySonar(bot);
            mem.sonarCooldownGate = diff.sonarCadenceSec;
          }
        }

        const steered = computeSteeredAngle(
          bot,
          bot.aiWanderAngle,
          botRadius,
          ctx.zone,
          mem.flankSign,
          avoidShore,
          84,
          false,
          ctx.activeWorldEvent ?? null
        );
        this.steerAndMove(bot, mem, steered, spd * 0.84, dt, 9);
      }
    }
  }

  /**
   * Executes Update 02 directional bite combat & ability intelligence:
   * - Approaches & flanks around obstacles
   * - Aligns facingAngle into forward bite cone before biting
   * - Respects stamina reserves & opponent stun resistance (`stunResistTimer`)
   * - Never wastes abilities out of range
   */
  private executeCombatEngagement(
    bot: KeliEntity,
    target: KeliEntity,
    mem: BotAiMemory,
    diff: AiDifficultyProfile,
    profile: AiPersonalityProfile,
    botRadius: number,
    strikeReach: number,
    spd: number,
    dt: number,
    ctx: AiSimulationContext,
    avoidShore: boolean
  ) {
    const dx = target.x - bot.x;
    const dz = target.z - bot.z;
    const dist = Math.hypot(dx, dz);
    const directAngle = Math.atan2(dz, dx);

    // Subtle flanking offset when closing from mid-range (charge directly when interrupting a feeder)
    const flankOffset =
      !target.feedingTargetId && dist > strikeReach + 35 && dist < 270
        ? mem.flankSign * 0.34 * diff.flankSkill
        : 0;
    const moveDesired = directAngle + flankOffset;
    const steeredMove = computeSteeredAngle(
      bot,
      moveDesired,
      botRadius,
      ctx.zone,
      mem.flankSign,
      avoidShore,
      Math.min(84, Math.max(42, dist * 0.65)),
      Boolean(target.feedingTargetId || dist < 150)
    );

    const inBiteRange = dist <= strikeReach + 6;
    const idealCombatDist = Math.max(24, strikeReach * 0.72);

    if (inBiteRange) {
      // Aim directly at target (with small human-like difficulty jitter) before triggering directional bite!
      const aimTarget = directAngle + mem.aimJitterOffset;
      bot.facingAngle = rotateAngleTowards(bot.facingAngle, aimTarget, 14 * dt);
      mem.intentAngle = directAngle;
      bot.aiIntentAngle = directAngle;

      // Maintain healthy combat distance using shared acceleration physics (don't overshoot past target's back)
      const combatProfile = getLocomotionProfile(bot.level, bot.isOnShore);
      const combatScale = dist > idealCombatDist ? 0.85 : 0.35;
      applyLocomotionVelocity(
        bot,
        Math.cos(steeredMove),
        Math.sin(steeredMove),
        spd * combatScale,
        dt,
        combatProfile
      );

      // Only trigger bite when target is inside our forward bite cone AND we aren't fatigued
      const aimError = Math.abs(normalizeAngleDiff(directAngle, bot.facingAngle));
      const coneAllowance = AI_BITE_CONE_HALF_ANGLE * 0.86;
      if (
        aimError <= coneAllowance &&
        !bot.fatigued &&
        bot.stamina >= 12 &&
        bot.bitePhase === 'idle' &&
        hasClearObstacleLineOfSight(bot.x, bot.z, target.x, target.z)
      ) {
        ctx.tryBiteOrFeed(bot, false);
      }
    } else {
      this.steerAndMove(bot, mem, steeredMove, spd, dt, 12.5);
    }

    // Tactical ability usage (strictly range-checked, stamina-aware, stun-resistance-aware!)
    if (bot.fatigued) return;

    // Lv.60 Electroshock: ONLY when in range (< 132), target is NOT stun-resistant/stunned, and stamina allows
    if (
      bot.level >= 60 &&
      bot.cooldowns.electroshock <= 0 &&
      bot.stamina >= AI_ELECTROSHOCK_STAMINA_COST + 18 &&
      dist < 132 &&
      target.stunResistTimer <= 0 &&
      target.stunTimer <= 0 &&
      (target.feedingTargetId || mem.rng() < diff.abilityComboChance * profile.abilityBoldness * 0.35)
    ) {
      ctx.tryElectroshock(bot);
      return;
    }

    // Lv.90 Maelstrom: tactical vortex when target is in range (65–240) and stamina allows
    if (
      bot.level >= 90 &&
      bot.cooldowns.maelstrom <= 0 &&
      bot.stamina >= AI_MAELSTROM_STAMINA_COST + 22 &&
      dist > 55 &&
      dist < 240 &&
      (target.feedingTargetId || mem.rng() < diff.abilityComboChance * 0.28)
    ) {
      ctx.tryMaelstrom(bot);
      return;
    }

    // Lv.10 Dash: gap-closer when chasing target at 115–265 units with healthy stamina
    if (
      bot.level >= 10 &&
      bot.cooldowns.dash <= 0 &&
      bot.stamina >= AI_DASH_STAMINA_COST + 28 &&
      dist > strikeReach + 48 &&
      dist < 265 &&
      Math.abs(normalizeAngleDiff(directAngle, bot.facingAngle)) < 0.65 &&
      mem.rng() < diff.abilityComboChance * profile.abilityBoldness * 0.32
    ) {
      ctx.tryDash(bot);
    }
  }

  private steerAndMove(
    bot: KeliEntity,
    mem: BotAiMemory,
    angle: number,
    speed: number,
    dt: number,
    turnRate: number
  ) {
    const profile = getLocomotionProfile(bot.level, bot.isOnShore);
    const curSpeed = applyLocomotionVelocity(
      bot,
      Math.cos(angle),
      Math.sin(angle),
      speed,
      dt,
      profile
    );
    const adaptiveTurn = Math.min(turnRate, computeTurnRate(profile, curSpeed, Math.max(speed, 1)));
    bot.facingAngle = rotateAngleTowards(bot.facingAngle, angle, adaptiveTurn * dt);
    mem.intentAngle = angle;
    bot.aiIntentAngle = angle;
  }

  private findLivingKeli(id: string, ctx: AiSimulationContext): KeliEntity | null {
    for (let i = 0; i < ctx.kelis.length; i++) {
      const k = ctx.kelis[i];
      if (k.id === id) return k.alive ? k : null;
    }
    return null;
  }

  /**
   * Finds a lightweight cover anchor adjacent to a nearby obstacle between bot and prey.
   */
  private findNearbyCoverAnchor(
    botX: number,
    botZ: number,
    preyX: number,
    preyZ: number
  ): { x: number; z: number } | null {
    const cx = Math.floor(botX / AI_SPATIAL_CELL_SIZE);
    const cz = Math.floor(botZ / AI_SPATIAL_CELL_SIZE);
    const bucket = STATIC_OBSTACLE_GRID.get(cellKey(cx, cz));
    if (!bucket || bucket.length === 0) return null;

    let bestObs: RockObstacle | null = null;
    let bestDist = 230;
    for (let i = 0; i < bucket.length; i++) {
      const obs = bucket[i];
      const d = Math.hypot(obs.x - botX, obs.z - botZ);
      if (d < bestDist) {
        bestDist = d;
        bestObs = obs;
      }
    }
    if (!bestObs) return null;

    // Stand on the side of the rock slightly opposite the prey
    const awayFromPrey = Math.atan2(bestObs.z - preyZ, bestObs.x - preyX);
    const standDist = bestObs.radius + 46;
    const ax = bestObs.x + Math.cos(awayFromPrey) * standDist;
    const az = bestObs.z + Math.sin(awayFromPrey) * standDist;
    return { x: ax, z: az };
  }
}

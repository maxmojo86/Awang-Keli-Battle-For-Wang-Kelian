import { EVOLUTION_MILESTONES, type EvolutionMilestone, getEvolutionForm, getFormLabel } from '../data/abilities.ts';
import type { EvolutionForm, HudEvolutionProgress } from './types.ts';

export type EvolutionEventKind =
  | 'minor_level'
  | 'ability_unlock'
  | 'form_2'
  | 'form_3'
  | 'form_4';

export interface EvolutionFormSpec {
  form: EvolutionForm;
  minLevel: number;
  maxLevel: number;
  shortName: string;
  label: string;
  bannerTitle: string;
  bannerSubtitle: string;
  detailText: string;
  hasArms: boolean;
  hasLegs: boolean;
  shoreAccess: 'blocked' | 'temporary' | 'permanent';
  spriteSheet: string;
  accentHex: string;
  burstHex: string;
}

export const EVOLUTION_FORM_SPECS: Record<EvolutionForm, EvolutionFormSpec> = {
  1: {
    form: 1,
    minLevel: 1,
    maxLevel: 39,
    shortName: 'Aquatic',
    label: 'Aquatic Keli',
    bannerTitle: 'AQUATIC FORM',
    bannerSubtitle: 'Freshwater Catfish — Water-Bound Hunter',
    detailText: 'Streamlined aquatic predator · Water-only traversal',
    hasArms: false,
    hasLegs: false,
    shoreAccess: 'blocked',
    spriteSheet: 'awang_keli_phase1.webp',
    accentHex: '#7dd3fc',
    burstHex: '#38bdf8',
  },
  2: {
    form: 2,
    minLevel: 40,
    maxLevel: 79,
    shortName: 'First Reformation',
    label: 'First Reformation',
    bannerTitle: 'FIRST REFORMATION — SHORE ACCESS UNLOCKED',
    bannerSubtitle: 'Muscular Forelimbs Awakened · 10s Shore Raids Unlocked',
    detailText: 'Two muscular arms & tail (no legs) · Bite stuns · 10s shore raids',
    hasArms: true,
    hasLegs: false,
    shoreAccess: 'temporary',
    spriteSheet: 'awang_keli_phase2.webp',
    accentHex: '#f3d285',
    burstHex: '#f59e0b',
  },
  3: {
    form: 3,
    minLevel: 80,
    maxLevel: 99,
    shortName: 'Amphibious',
    label: 'Amphibious Ascension',
    bannerTitle: 'AMPHIBIOUS ASCENSION — LAND & WATER DOMINION',
    bannerSubtitle: 'Full Amphibious Predator · Permanent Shore Access Unlocked',
    detailText: 'Arms & legs awakened · Permanent land access · Hunter Sonar unlocked',
    hasArms: true,
    hasLegs: true,
    shoreAccess: 'permanent',
    spriteSheet: 'awang_keli_phase3.webp',
    accentHex: '#7dd3fc',
    burstHex: '#38bdf8',
  },
  4: {
    form: 4,
    minLevel: 100,
    maxLevel: 100,
    shortName: 'Keli King',
    label: 'KELI KING',
    bannerTitle: 'KELI KING',
    bannerSubtitle: 'ALL 100 FRAGMENTS REUNITED',
    detailText: 'Supreme amphibious colossus · Match Victory',
    hasArms: true,
    hasLegs: true,
    shoreAccess: 'permanent',
    spriteSheet: 'keli_king_sheet.webp',
    accentHex: '#fde68a',
    burstHex: '#fbbf24',
  },
};

export const MAJOR_EVOLUTION_THRESHOLDS = [40, 80, 100] as const;

export function getEvolutionFormSpec(form: EvolutionForm): EvolutionFormSpec {
  return EVOLUTION_FORM_SPECS[form];
}

export function clampEvolutionLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.max(1, Math.min(100, Math.trunc(level)));
}

/**
 * Computes compact, authoritative evolution progress for HUD display.
 * Never produces levels above 100 (never shows Lv.101).
 */
export function getEvolutionProgressInfo(
  rawLevel: number,
  evolutionSeq = 0,
  lastMajorForm?: EvolutionForm
): HudEvolutionProgress {
  const currentLevel = clampEvolutionLevel(rawLevel);
  const currentForm = getEvolutionForm(currentLevel);
  const spec = EVOLUTION_FORM_SPECS[currentForm];
  const isMaxLevel = currentLevel >= 100;

  let prevThreshold = 1;
  let nextEvolutionLevel: number | null = 40;
  if (currentLevel >= 100) {
    prevThreshold = 100;
    nextEvolutionLevel = null;
  } else if (currentLevel >= 80) {
    prevThreshold = 80;
    nextEvolutionLevel = 100;
  } else if (currentLevel >= 40) {
    prevThreshold = 40;
    nextEvolutionLevel = 80;
  }

  const fragmentsToNextEvolution =
    nextEvolutionLevel !== null ? Math.max(0, nextEvolutionLevel - currentLevel) : 0;

  const stageSpan =
    nextEvolutionLevel !== null ? Math.max(1, nextEvolutionLevel - prevThreshold) : 1;
  const evolutionStageProgress =
    nextEvolutionLevel !== null
      ? Math.max(0, Math.min(1, (currentLevel - prevThreshold) / stageSpan))
      : 1;

  const nextMilestone = isMaxLevel
    ? null
    : EVOLUTION_MILESTONES.find((m) => m.level > currentLevel) ?? null;

  return {
    currentLevel,
    currentForm,
    currentFormName: spec.label,
    currentFormShortName: spec.shortName,
    formLabel: getFormLabel(currentForm),
    nextEvolutionLevel,
    fragmentsToNextEvolution,
    evolutionStageProgress,
    overallProgress: currentLevel / 100,
    nextAbilityLevel: nextMilestone?.level ?? null,
    nextAbilityTitle: nextMilestone?.title ?? null,
    isMaxLevel,
    evolutionSeq,
    lastMajorForm: lastMajorForm ?? currentForm,
  };
}

/**
 * Returns the bitmask index for an evolution milestone level (10, 20, ..., 100).
 */
export function getMilestoneBit(milestoneLevel: number): number {
  const idx = EVOLUTION_MILESTONES.findIndex((m) => m.level === milestoneLevel);
  return idx >= 0 ? 1 << idx : 0;
}

/**
 * Computes the initial bitmask for all milestones already satisfied at spawn level.
 */
export function computeInitialMilestoneMask(level: number): number {
  const clamped = clampEvolutionLevel(level);
  let mask = 0;
  for (let i = 0; i < EVOLUTION_MILESTONES.length; i++) {
    if (EVOLUTION_MILESTONES[i].level <= clamped) {
      mask |= 1 << i;
    }
  }
  return mask;
}

export interface EvolutionTransitionResult {
  prevLevel: number;
  nextLevel: number;
  prevForm: EvolutionForm;
  newHighestForm: EvolutionForm;
  newMilestoneMask: number;
  unlockedMilestones: EvolutionMilestone[];
  majorFormTriggered: EvolutionForm | null;
  supersededForms: EvolutionForm[];
  minorLevelsGained: number;
  kind: EvolutionEventKind | null;
}

/**
 * Pure, monotonic transition resolver for any fragment gain.
 * - Guarantees every milestone (10..100) unlocks strictly once via bitmask latch.
 * - Guarantees major form transformations (Form 2, 3, 4) trigger monotonically and at most once.
 * - Collapses rapid multi-threshold jumps (e.g. Lv.35 -> Lv.85 or Lv.75 -> Lv.100) so only
 *   the newest/highest authoritative form presentation plays (no obsolete queued lower forms).
 */
export function resolveEvolutionTransition(
  prevLevelRaw: number,
  nextLevelRaw: number,
  highestFormReached: EvolutionForm,
  unlockedMilestoneMask: number
): EvolutionTransitionResult {
  const prevLevel = clampEvolutionLevel(prevLevelRaw);
  const nextLevel = Math.max(prevLevel, clampEvolutionLevel(nextLevelRaw));
  const prevForm = getEvolutionForm(prevLevel);
  const targetForm = getEvolutionForm(nextLevel);
  const effectiveHighest = Math.max(highestFormReached, prevForm) as EvolutionForm;

  const unlockedMilestones: EvolutionMilestone[] = [];
  let newMask = unlockedMilestoneMask;

  for (let i = 0; i < EVOLUTION_MILESTONES.length; i++) {
    const m = EVOLUTION_MILESTONES[i];
    const bit = 1 << i;
    if (m.level <= nextLevel && (newMask & bit) === 0) {
      // Only treat as newly unlocked if it wasn't already satisfied prior to spawn
      if (m.level > prevLevel) {
        unlockedMilestones.push(m);
      }
      newMask |= bit;
    }
  }

  let majorFormTriggered: EvolutionForm | null = null;
  const supersededForms: EvolutionForm[] = [];
  let newHighestForm: EvolutionForm = effectiveHighest;

  if (targetForm > effectiveHighest) {
    majorFormTriggered = targetForm;
    newHighestForm = targetForm;
    for (let f = effectiveHighest + 1; f < targetForm; f++) {
      supersededForms.push(f as EvolutionForm);
    }
  }

  const minorLevelsGained = Math.max(0, nextLevel - prevLevel);

  let kind: EvolutionEventKind | null = null;
  if (majorFormTriggered === 4) {
    kind = 'form_4';
  } else if (majorFormTriggered === 3) {
    kind = 'form_3';
  } else if (majorFormTriggered === 2) {
    kind = 'form_2';
  } else if (unlockedMilestones.length > 0) {
    kind = 'ability_unlock';
  } else if (minorLevelsGained > 0) {
    kind = 'minor_level';
  }

  return {
    prevLevel,
    nextLevel,
    prevForm,
    newHighestForm,
    newMilestoneMask: newMask,
    unlockedMilestones,
    majorFormTriggered,
    supersededForms,
    minorLevelsGained,
    kind,
  };
}

export interface EvolutionVisualProfile {
  cameraPushScale: number;
  shakeScale: number;
  particleScale: number;
  lightFlashScale: number;
  animSpeedScale: number;
}

export function getEvolutionVisualProfile(reducedMotion: boolean): EvolutionVisualProfile {
  if (reducedMotion) {
    return {
      cameraPushScale: 0,
      shakeScale: 0,
      particleScale: 0.3,
      lightFlashScale: 0.25,
      animSpeedScale: 0.7,
    };
  }
  return {
    cameraPushScale: 1,
    shakeScale: 1,
    particleScale: 1,
    lightFlashScale: 1,
    animSpeedScale: 1,
  };
}

export type TransformationPhaseName = 'warning' | 'surge' | 'reveal' | 'settle' | 'complete';

export interface TransformationPhaseSample {
  phase: TransformationPhaseName;
  normalized: number;
  scaleMult: number;
  cameraZoomDelta: number;
  lightBoost: number;
  shakeAmount: number;
  glowIntensity: number;
  showNewSprite: boolean;
}

export const MAJOR_TRANSFORM_DURATION_SEC = 1.6;
export const MAJOR_TRANSFORM_REDUCED_DURATION_SEC = 1.1;

/**
 * Evaluates the non-blocking 1.6s major transformation visual curve (Lv.40 & Lv.80).
 * 0.00–0.20s: warning pulse & anticipation crouch + restrained camera push-in
 * 0.20–0.60s: concentrated energy surge + water displacement + brief light swell
 * 0.60–1.20s: silhouette/scale emphasis & crisp sprite reveal + controlled shake
 * 1.20–1.60s: anatomy flex smoothly settling back to neutral combat framing
 */
export function evaluateTransformationPhase(
  elapsedSec: number,
  form: EvolutionForm,
  reducedMotion: boolean
): TransformationPhaseSample {
  const duration = reducedMotion
    ? MAJOR_TRANSFORM_REDUCED_DURATION_SEC
    : MAJOR_TRANSFORM_DURATION_SEC;
  if (elapsedSec < 0 || elapsedSec >= duration || form < 2) {
    return {
      phase: 'complete',
      normalized: 1,
      scaleMult: 1,
      cameraZoomDelta: 0,
      lightBoost: 0,
      shakeAmount: 0,
      glowIntensity: 0,
      showNewSprite: true,
    };
  }

  const profile = getEvolutionVisualProfile(reducedMotion);
  // Map elapsed onto canonical 0..1.6s timeline so phases stay proportional
  const t = (elapsedSec / duration) * MAJOR_TRANSFORM_DURATION_SEC;
  const isForm3Plus = form >= 3;
  const peakScale = isForm3Plus ? 0.16 : 0.12;
  const peakZoom = isForm3Plus ? -0.065 : -0.048; // negative = slight push-in
  const peakLight = isForm3Plus ? 0.44 : 0.30;
  const peakShake = isForm3Plus ? 0.36 : 0.22;

  if (t < 0.2) {
    const u = t / 0.2;
    const ease = u * u * (3 - 2 * u);
    return {
      phase: 'warning',
      normalized: t / MAJOR_TRANSFORM_DURATION_SEC,
      scaleMult: 1 - Math.sin(u * Math.PI) * 0.04 * (reducedMotion ? 0.4 : 1),
      cameraZoomDelta: peakZoom * 0.45 * ease * profile.cameraPushScale || 0,
      lightBoost: peakLight * 0.35 * ease * profile.lightFlashScale,
      shakeAmount: 0,
      glowIntensity: 0.45 + ease * 0.35,
      showNewSprite: true,
    };
  }

  if (t < 0.6) {
    const u = (t - 0.2) / 0.4;
    const ease = u * u * (3 - 2 * u);
    return {
      phase: 'surge',
      normalized: t / MAJOR_TRANSFORM_DURATION_SEC,
      scaleMult: 1 + ease * peakScale * 0.72 * (reducedMotion ? 0.5 : 1),
      cameraZoomDelta: peakZoom * (0.45 + ease * 0.55) * profile.cameraPushScale || 0,
      lightBoost: peakLight * (0.35 + ease * 0.65) * profile.lightFlashScale,
      shakeAmount: peakShake * 0.45 * ease * profile.shakeScale,
      glowIntensity: 0.8 + ease * 0.2,
      showNewSprite: true,
    };
  }

  if (t < 1.2) {
    const u = (t - 0.6) / 0.6;
    const pulse = Math.sin(u * Math.PI);
    return {
      phase: 'reveal',
      normalized: t / MAJOR_TRANSFORM_DURATION_SEC,
      scaleMult: 1 + (peakScale * 0.72 + pulse * peakScale * 0.35) * (reducedMotion ? 0.5 : 1),
      cameraZoomDelta: peakZoom * (1 - u * 0.45) * profile.cameraPushScale || 0,
      lightBoost: peakLight * (1 - u * 0.65) * profile.lightFlashScale,
      shakeAmount: peakShake * (1 - u) * profile.shakeScale,
      glowIntensity: Math.max(0.25, 1 - u * 0.65),
      showNewSprite: true,
    };
  }

  const u = (t - 1.2) / 0.4;
  const settle = 1 - u * u * (3 - 2 * u);
  return {
    phase: 'settle',
    normalized: t / MAJOR_TRANSFORM_DURATION_SEC,
    scaleMult: 1 + peakScale * 0.45 * settle * (reducedMotion ? 0.5 : 1),
    cameraZoomDelta: peakZoom * 0.55 * settle * profile.cameraPushScale || 0,
    lightBoost: peakLight * 0.35 * settle * profile.lightFlashScale,
    shakeAmount: 0,
    glowIntensity: 0.25 * settle,
    showNewSprite: true,
  };
}

export interface RemoteEvolutionReconcileResult {
  effectiveLevel: number;
  effectiveForm: EvolutionForm;
  effectiveEvoSeq: number;
  triggeredMajorForm: EvolutionForm | null;
  staleOrBlocked: boolean;
}

/**
 * Monotonic client-side evolution presentation guard.
 * Protects multiplayer & HUD rendering against out-of-order packets, duplicate triggers,
 * post-death phantom evolutions, and post-victory mutation.
 */
export class EvolutionPresentationGuard {
  private highestLevelById = new Map<string, number>();
  private highestFormById = new Map<string, EvolutionForm>();
  private lastEvoSeqById = new Map<string, number>();
  private lastAppliedTick = -1;
  private concluded = false;
  private kingVictoryTriggered = false;

  public reset() {
    this.highestLevelById.clear();
    this.highestFormById.clear();
    this.lastEvoSeqById.clear();
    this.lastAppliedTick = -1;
    this.concluded = false;
    this.kingVictoryTriggered = false;
  }

  public isPacketStale(tick: number): boolean {
    if (tick < this.lastAppliedTick) return true;
    this.lastAppliedTick = tick;
    return false;
  }

  public getLastAppliedTick(): number {
    return this.lastAppliedTick;
  }

  public reconcileEntity(
    entityId: string,
    incomingLevelRaw: number,
    incomingHighestForm: EvolutionForm | undefined,
    incomingEvoSeq: number | undefined,
    alive: boolean,
    matchStatus: 'playing' | 'victory' | 'defeat' | 'draw'
  ): RemoteEvolutionReconcileResult {
    const incomingLevel = clampEvolutionLevel(incomingLevelRaw);
    const prevLevel = this.highestLevelById.get(entityId);
    const prevForm = this.highestFormById.get(entityId);
    const prevSeq = this.lastEvoSeqById.get(entityId) ?? 0;

    // Monotonic floor: an out-of-order packet must never regress an entity's level or form
    const effectiveLevel = prevLevel !== undefined ? Math.max(prevLevel, incomingLevel) : incomingLevel;
    const derivedForm = getEvolutionForm(effectiveLevel);
    const candidateForm = Math.max(
      derivedForm,
      incomingHighestForm ?? derivedForm,
      prevForm ?? derivedForm
    ) as EvolutionForm;
    const effectiveEvoSeq = Math.max(prevSeq, incomingEvoSeq ?? 0);

    this.highestLevelById.set(entityId, effectiveLevel);
    this.highestFormById.set(entityId, candidateForm);
    this.lastEvoSeqById.set(entityId, effectiveEvoSeq);

    const matchEnded = matchStatus !== 'playing';
    let triggeredMajorForm: EvolutionForm | null = null;
    let staleOrBlocked = false;

    if (!alive) {
      staleOrBlocked = true;
    } else if (this.concluded) {
      staleOrBlocked = true;
    } else if (prevForm !== undefined && candidateForm > prevForm) {
      if (candidateForm === 4) {
        if (!this.kingVictoryTriggered) {
          this.kingVictoryTriggered = true;
          triggeredMajorForm = 4;
        } else {
          staleOrBlocked = true;
        }
      } else if (!matchEnded) {
        triggeredMajorForm = candidateForm;
      } else {
        staleOrBlocked = true;
      }
    } else if (prevForm === undefined && candidateForm === 4 && !this.kingVictoryTriggered) {
      this.kingVictoryTriggered = true;
      triggeredMajorForm = 4;
    }

    if (matchEnded) {
      this.concluded = true;
    }

    return {
      effectiveLevel,
      effectiveForm: candidateForm,
      effectiveEvoSeq,
      triggeredMajorForm,
      staleOrBlocked,
    };
  }

  public pruneMissing(activeIds: Set<string>) {
    for (const id of Array.from(this.highestLevelById.keys())) {
      if (!activeIds.has(id)) {
        this.highestLevelById.delete(id);
        this.highestFormById.delete(id);
        this.lastEvoSeqById.delete(id);
      }
    }
  }
}

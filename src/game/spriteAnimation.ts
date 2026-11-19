import * as THREE from 'three';
import { resolveAssetUrl } from '../utils/assetUrl';
import {
  BITE_RECOVERY_SEC,
  BITE_STRIKE_SEC,
  BITE_WINDUP_SEC,
} from './simulation';
import type { BitePhase, KeliEntity } from './types';

export type EvolutionPhase = 1 | 2 | 3;

export type SpriteAnimAction = 'idle' | 'move' | 'attack' | 'feed';

export const SPRITE_GRID_COLS = 6;
export const SPRITE_GRID_ROWS = 4;

export const SPRITE_ROW_BY_ACTION: Record<SpriteAnimAction, number> = {
  idle: 0,
  move: 1,
  attack: 2,
  feed: 3,
};

export interface SpriteSheetMeta {
  phase: EvolutionPhase;
  assetPath: string;
  atlasWidth: number;
  atlasHeight: number;
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
  aspect: number;
  groundPadBottomPx: number;
  /** Fraction of cell height below the resting ground contact baseline. */
  groundPadRatio: number;
  /** World-space height multiplier relative to the actor's progression size3D. */
  worldHeightScale: number;
  /** Base movement animation frame rate (FPS) for Row 1. */
  moveFps: number;
}

export const SPRITE_ANIM_CONFIG = {
  cols: SPRITE_GRID_COLS,
  rows: SPRITE_GRID_ROWS,
  idleFps: 5,
  feedFps: 8,
  evadeSpeedMult: 1.75,
  dashSpeedMult: 1.45,
  moveSpeedThreshold: 10,
  attackDurations: {
    windup: BITE_WINDUP_SEC,
    strike: BITE_STRIKE_SEC,
    recovery: BITE_RECOVERY_SEC,
  },
  sheets: {
    1: {
      phase: 1,
      assetPath: 'assets/sprites/awang_keli_phase1.webp',
      atlasWidth: 1488,
      atlasHeight: 656,
      cellWidth: 248,
      cellHeight: 164,
      cols: SPRITE_GRID_COLS,
      rows: SPRITE_GRID_ROWS,
      aspect: 248 / 164,
      groundPadBottomPx: 14,
      groundPadRatio: 14 / 164,
      worldHeightScale: 0.84,
      moveFps: 9,
    },
    2: {
      phase: 2,
      assetPath: 'assets/sprites/awang_keli_phase2.webp',
      atlasWidth: 1680,
      atlasHeight: 816,
      cellWidth: 280,
      cellHeight: 204,
      cols: SPRITE_GRID_COLS,
      rows: SPRITE_GRID_ROWS,
      aspect: 280 / 204,
      groundPadBottomPx: 10,
      groundPadRatio: 10 / 204,
      worldHeightScale: 0.92,
      moveFps: 8,
    },
    3: {
      phase: 3,
      assetPath: 'assets/sprites/awang_keli_phase3.webp',
      atlasWidth: 1680,
      atlasHeight: 1008,
      cellWidth: 280,
      cellHeight: 252,
      cols: SPRITE_GRID_COLS,
      rows: SPRITE_GRID_ROWS,
      aspect: 280 / 252,
      groundPadBottomPx: 11,
      groundPadRatio: 11 / 252,
      worldHeightScale: 1.06,
      moveFps: 10,
    },
  } as Record<EvolutionPhase, SpriteSheetMeta>,
} as const;

export type AnimatableKeliState = Pick<
  KeliEntity,
  | 'level'
  | 'alive'
  | 'vx'
  | 'vz'
  | 'isOnShore'
  | 'stunTimer'
  | 'feedingTargetId'
  | 'bitePhase'
  | 'bitePhaseTimer'
  | 'biteAttackSeq'
  | 'evadeTimer'
  | 'dashTimer'
>;

export interface ActorAnimState {
  phase: EvolutionPhase;
  action: SpriteAnimAction;
  row: number;
  col: number;
  elapsed: number;
  lastBitePhase: BitePhase;
  lastBiteAttackSeq: number;
  remoteBitePhaseElapsed: number;
  initialized: boolean;
}

export interface ActorAnimAdvanceResult {
  phase: EvolutionPhase;
  action: SpriteAnimAction;
  row: number;
  col: number;
  phaseChanged: boolean;
  frameChanged: boolean;
}

/**
 * Maps an evolution level (1-100) to one of the three animated sprite sheets:
 * - Phase 1 (Levels 1-39): Fully aquatic limbless Keli
 * - Phase 2 (Levels 40-79): Muscular arms unlocked, NO LEGS
 * - Phase 3 (Levels 80-100): Fully amphibious with muscular arms and legs
 */
export function getEvolutionPhaseForLevel(level: number): EvolutionPhase {
  if (level >= 80) return 3;
  if (level >= 40) return 2;
  return 1;
}

export function getSpriteSheetMeta(phase: EvolutionPhase): SpriteSheetMeta {
  return SPRITE_ANIM_CONFIG.sheets[phase];
}

export function createActorAnimState(initialPhase: EvolutionPhase = 1): ActorAnimState {
  return {
    phase: initialPhase,
    action: 'idle',
    row: SPRITE_ROW_BY_ACTION.idle,
    col: 0,
    elapsed: 0,
    lastBitePhase: 'idle',
    lastBiteAttackSeq: 0,
    remoteBitePhaseElapsed: 0,
    initialized: false,
  };
}

export interface ResolvedAnimIntent {
  action: SpriteAnimAction;
  paused: boolean;
  speedMult: number;
}

/**
 * Resolves the authoritative animation action strictly following state priority:
 * 1. DEATH (entity not alive; handled externally via carcass/death presentation)
 * 2. STUNNED (holds reaction frame without cycling locomotion/attack)
 * 3. FEEDING (Row 3 looping while actively feeding on a carcass)
 * 4. ATTACKING (Row 2 one-shot synchronized to windup/strike/recovery)
 * 5. MOVING (Row 1 looping; Slip Evade & Dash accelerate playback)
 * 6. IDLE (Row 0 looping)
 */
export function resolveActorAnimIntent(
  k: AnimatableKeliState,
  phase: EvolutionPhase
): ResolvedAnimIntent {
  if (!k.alive) {
    return { action: 'idle', paused: true, speedMult: 0 };
  }

  if (k.stunTimer > 0) {
    return { action: 'idle', paused: true, speedMult: 0 };
  }

  if (k.feedingTargetId !== null) {
    return { action: 'feed', paused: false, speedMult: 1 };
  }

  if (k.bitePhase !== 'idle') {
    return { action: 'attack', paused: false, speedMult: 1 };
  }

  const speed = Math.hypot(k.vx, k.vz);
  if (k.evadeTimer > 0) {
    return {
      action: 'move',
      paused: false,
      speedMult: SPRITE_ANIM_CONFIG.evadeSpeedMult,
    };
  }

  if (k.dashTimer > 0) {
    return {
      action: 'move',
      paused: false,
      speedMult: SPRITE_ANIM_CONFIG.dashSpeedMult,
    };
  }

  if (speed > SPRITE_ANIM_CONFIG.moveSpeedThreshold) {
    // Subtle speed-responsive pacing while staying near the phase's target FPS.
    // Phase 2 underwater swims slightly brisker than heavy land dragging.
    const speedFactor = Math.max(0.85, Math.min(1.18, 0.8 + speed / 260));
    const mediumFactor = phase === 2 && !k.isOnShore ? 1.08 : 1.0;
    return {
      action: 'move',
      paused: false,
      speedMult: speedFactor * mediumFactor,
    };
  }

  return { action: 'idle', paused: false, speedMult: 1 };
}

function clampFrame(col: number): number {
  if (col < 0) return 0;
  if (col >= SPRITE_GRID_COLS) return SPRITE_GRID_COLS - 1;
  return col;
}

function computeAttackFrameCol(
  bitePhase: BitePhase,
  bitePhaseTimer: number,
  remotePhaseElapsed: number
): number {
  if (bitePhase === 'windup') {
    const dur = SPRITE_ANIM_CONFIG.attackDurations.windup;
    const progress =
      bitePhaseTimer > 0
        ? Math.max(0, Math.min(0.999, 1 - bitePhaseTimer / dur))
        : Math.max(0, Math.min(0.999, remotePhaseElapsed / dur));
    return progress < 0.5 ? 0 : 1;
  }

  if (bitePhase === 'strike') {
    const dur = SPRITE_ANIM_CONFIG.attackDurations.strike;
    const progress =
      bitePhaseTimer > 0
        ? Math.max(0, Math.min(0.999, 1 - bitePhaseTimer / dur))
        : Math.max(0, Math.min(0.999, remotePhaseElapsed / dur));
    return progress < 0.45 ? 2 : 3;
  }

  if (bitePhase === 'recovery') {
    const dur = SPRITE_ANIM_CONFIG.attackDurations.recovery;
    const progress =
      bitePhaseTimer > 0
        ? Math.max(0, Math.min(0.999, 1 - bitePhaseTimer / dur))
        : Math.max(0, Math.min(0.999, remotePhaseElapsed / dur));
    return progress < 0.5 ? 4 : 5;
  }

  return 0;
}

/**
 * Advances an actor's frame-by-frame sprite sheet state in place (zero allocations).
 */
export function advanceActorAnim(
  state: ActorAnimState,
  k: AnimatableKeliState,
  dt: number,
  reducedMotion = false
): ActorAnimAdvanceResult {
  const safeDt = dt > 0 ? dt : 0;
  const nextPhase = getEvolutionPhaseForLevel(k.level);
  const prevPhase = state.phase;
  const prevRow = state.row;
  const prevCol = state.col;
  const wasInitialized = state.initialized;

  state.phase = nextPhase;
  const intent = resolveActorAnimIntent(k, nextPhase);

  if (intent.paused) {
    // Freeze animation frame cleanly during stun/death while updating phase if needed.
    state.lastBitePhase = k.bitePhase;
    state.initialized = true;
    const phaseChanged = !wasInitialized || nextPhase !== prevPhase;
    const frameChanged = !wasInitialized || phaseChanged || state.row !== prevRow || state.col !== prevCol;
    return {
      phase: state.phase,
      action: state.action,
      row: state.row,
      col: state.col,
      phaseChanged,
      frameChanged,
    };
  }

  const nextAction = intent.action;
  const actionChanged = !wasInitialized || state.action !== nextAction;

  if (nextAction === 'attack') {
    const newAttackSeq =
      k.biteAttackSeq > 0 && k.biteAttackSeq !== state.lastBiteAttackSeq;
    const phaseTransitioned = k.bitePhase !== state.lastBitePhase;

    if (actionChanged || newAttackSeq || phaseTransitioned) {
      state.remoteBitePhaseElapsed = 0;
    } else {
      state.remoteBitePhaseElapsed += safeDt;
    }

    state.action = 'attack';
    state.row = SPRITE_ROW_BY_ACTION.attack;
    state.col = clampFrame(
      computeAttackFrameCol(k.bitePhase, k.bitePhaseTimer, state.remoteBitePhaseElapsed)
    );
    state.lastBitePhase = k.bitePhase;
    state.lastBiteAttackSeq = k.biteAttackSeq;
  } else {
    state.lastBitePhase = k.bitePhase;
    state.remoteBitePhaseElapsed = 0;

    if (actionChanged) {
      state.action = nextAction;
      state.elapsed = 0;
    }

    const sheetMeta = SPRITE_ANIM_CONFIG.sheets[nextPhase];
    const baseFps =
      nextAction === 'idle'
        ? SPRITE_ANIM_CONFIG.idleFps
        : nextAction === 'feed'
          ? SPRITE_ANIM_CONFIG.feedFps
          : sheetMeta.moveFps;
    const motionFactor = reducedMotion ? 0.6 : 1.0;
    const effectiveFps = baseFps * intent.speedMult * motionFactor;

    state.elapsed += safeDt * effectiveFps;
    if (state.elapsed >= SPRITE_GRID_COLS) {
      state.elapsed = state.elapsed % SPRITE_GRID_COLS;
    }

    state.row = SPRITE_ROW_BY_ACTION[nextAction];
    state.col = clampFrame(Math.floor(state.elapsed) % SPRITE_GRID_COLS);
  }

  state.initialized = true;
  const phaseChanged = !wasInitialized || nextPhase !== prevPhase;
  const frameChanged =
    !wasInitialized || phaseChanged || state.row !== prevRow || state.col !== prevCol;

  return {
    phase: state.phase,
    action: state.action,
    row: state.row,
    col: state.col,
    phaseChanged,
    frameChanged,
  };
}

export interface FrameUVRect {
  uLeft: number;
  uRight: number;
  vBottom: number;
  vTop: number;
}

/**
 * Computes exact UV bounds for a cell (row 0 = top row, col 0 = leftmost column)
 * with a subtle quarter-texel inset so nearest-neighbour sampling never bleeds
 * across cell boundaries.
 */
export function computeFrameUVs(
  phase: EvolutionPhase,
  row: number,
  col: number
): FrameUVRect {
  const meta = SPRITE_ANIM_CONFIG.sheets[phase];
  const safeRow = Math.max(0, Math.min(meta.rows - 1, row));
  const safeCol = Math.max(0, Math.min(meta.cols - 1, col));

  const epsU = 0.25 / meta.atlasWidth;
  const epsV = 0.25 / meta.atlasHeight;

  const uLeft = safeCol / meta.cols + epsU;
  const uRight = (safeCol + 1) / meta.cols - epsU;
  // Standard WebGL texture orientation (flipY = true): row 0 sits at v = 1.
  const vTop = 1 - safeRow / meta.rows - epsV;
  const vBottom = 1 - (safeRow + 1) / meta.rows + epsV;

  return { uLeft, uRight, vBottom, vTop };
}

/**
 * Creates a bottom-center-anchored 1x1 unit quad (y in [0, 1], x in [-0.5, 0.5])
 * dedicated to a single actor so all Kelis can share 3 GPU textures while each
 * actor displays its own independent animation frame via UV coordinates.
 */
export function createActorSpriteGeometry(): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  return geo;
}

/**
 * Writes the target cell UVs directly into a bottom-anchored PlaneGeometry's
 * UV attribute with zero heap allocations.
 */
export function applyFrameUVsToGeometry(
  geo: THREE.PlaneGeometry,
  phase: EvolutionPhase,
  row: number,
  col: number
): void {
  const meta = SPRITE_ANIM_CONFIG.sheets[phase];
  const safeRow = Math.max(0, Math.min(meta.rows - 1, row));
  const safeCol = Math.max(0, Math.min(meta.cols - 1, col));

  const epsU = 0.25 / meta.atlasWidth;
  const epsV = 0.25 / meta.atlasHeight;

  const uLeft = safeCol / meta.cols + epsU;
  const uRight = (safeCol + 1) / meta.cols - epsU;
  const vTop = 1 - safeRow / meta.rows - epsV;
  const vBottom = 1 - (safeRow + 1) / meta.rows + epsV;

  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // PlaneGeometry vertex order: 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right
  uv.setXY(0, uLeft, vTop);
  uv.setXY(1, uRight, vTop);
  uv.setXY(2, uLeft, vBottom);
  uv.setXY(3, uRight, vBottom);
  uv.needsUpdate = true;
}

export type KeliSubmersionMode = 'dry' | 'partial' | 'full';

export interface KeliWaterSubmersionState {
  readonly mode: KeliSubmersionMode;
  /** Shader uniform: 0 = dry on land, 1 = partially submerged amphibian, 2 = fully submerged aquatic */
  readonly shaderMode: 0 | 1 | 2;
  /** Target blend in [0, 1] (0 = dry on land, 1 = submerged in water) */
  readonly targetBlend: number;
  /** World Y for the actor group (water surface y=0 in water, terrain height on shore) */
  readonly groupY: number;
  /** Local Y offset applied to spriteMesh inside the actor group */
  readonly spriteLocalY: number;
  /** Local Y for the contact shadow disc relative to actor group */
  readonly shadowLocalY: number;
  /** Desired renderOrder for spriteMesh (1 = below waterMesh=2; 6 = above water on dry land) */
  readonly spriteRenderOrder: number;
  /** Desired renderOrder for shadowMesh (1 = on seabed beneath water; 3 = on dry shore) */
  readonly shadowRenderOrder: number;
  /** Approximate visible top local-Y above groupY for clean nameplate/status icon anchoring */
  readonly visibleTopLocalY: number;
}

/** Exact cosine of the 45-degree isometric camera pitch (camOffset = (0, 33, 33)). */
const CAMERA_PITCH_COS = Math.SQRT1_2;

/**
 * Computes physical 3D submersion placement & water-layering parameters:
 * - Phase 1 (fully aquatic, Lv.1-39): fully submerged beneath the 3D water surface
 *   (clamped cleanly above the seabed in shallow water so it never clips terrain).
 * - Phase 2 & 3 (amphibious, Lv.40-100) in water: partially submerged (lower ~40-46%
 *   beneath the 3D water plane, upper torso & head dry above the waterline).
 * - Phase 2 & 3 on shore (isOnShore = true): completely dry on land.
 */
export function computeKeliWaterSubmersion(
  phase: EvolutionPhase,
  isOnShore: boolean,
  elevation: number,
  renderedHeight: number,
  groundPadRatio: number
): KeliWaterSubmersionState {
  const terrainY = elevation * 2.2;
  const worldSpanY = renderedHeight * CAMERA_PITCH_COS;
  const padWorldY = renderedHeight * groundPadRatio * CAMERA_PITCH_COS;

  // Dry on land (Phase 2 & 3 on shore)
  if (isOnShore && phase !== 1) {
    return {
      mode: 'dry',
      shaderMode: 0,
      targetBlend: 0,
      groupY: Math.max(0.08, terrainY),
      spriteLocalY: -renderedHeight * groundPadRatio,
      shadowLocalY: 0.04,
      spriteRenderOrder: 6,
      shadowRenderOrder: 3,
      visibleTopLocalY: renderedHeight * 0.95,
    };
  }

  // Fully aquatic Keli (Phase 1, Lv.1-39): fully submerged under y=0 3D water plane
  if (phase === 1) {
    // Visible aquatic catfish body occupies up to ~72% of cell height
    const desiredSpriteY = -(0.72 * worldSpanY) - 0.14;
    // Keep belly safely above shallow seabed so terrainMesh never clips the sprite
    const minSeabedSafeY = terrainY + 0.14 - padWorldY;
    const spriteLocalY = Math.max(minSeabedSafeY, desiredSpriteY);
    return {
      mode: 'full',
      shaderMode: 2,
      targetBlend: 1,
      groupY: 0,
      spriteLocalY,
      shadowLocalY: Math.min(-0.08, terrainY + 0.05),
      spriteRenderOrder: 1,
      shadowRenderOrder: 1,
      visibleTopLocalY: Math.max(1.25, spriteLocalY + worldSpanY * 0.85 + 0.85),
    };
  }

  // Amphibious Kelis in water (Phase 2 Lv.40-79 & Phase 3 Lv.80-100): partially submerged
  // Lower body sits below y=0 (covered by 3D waterMesh); upper torso & head rise dry above y=0.
  const submergeFrac = phase === 2 ? 0.46 : 0.42;
  const desiredSpriteY = -(submergeFrac * worldSpanY);
  // As the amphibian wades into shallow water toward the shore, feet stay on the seabed
  // so it rises naturally from chest/waist-deep -> knee-deep -> dry on land.
  const minSeabedSafeY = terrainY + 0.1 - padWorldY;
  const spriteLocalY = Math.max(minSeabedSafeY, desiredSpriteY);

  return {
    mode: 'partial',
    shaderMode: 1,
    targetBlend: 1,
    groupY: 0,
    spriteLocalY,
    shadowLocalY: Math.min(-0.06, terrainY + 0.05),
    spriteRenderOrder: 1,
    shadowRenderOrder: 1,
    visibleTopLocalY: Math.max(1.6, spriteLocalY + worldSpanY * 0.95 + 0.6),
  };
}

/**
 * Loads and shares exactly 3 GPU textures (one per evolution phase) across all
 * players, bots, remote multiplayer actors, and spectated entities.
 */
export class SpriteSheetAtlasManager {
  private textures: Record<EvolutionPhase, THREE.Texture>;
  private loaded: Record<EvolutionPhase, boolean> = { 1: false, 2: false, 3: false };
  private disposed = false;

  constructor() {
    const loader = new THREE.TextureLoader();
    const loadPhase = (phase: EvolutionPhase): THREE.Texture => {
      const meta = SPRITE_ANIM_CONFIG.sheets[phase];
      const url = resolveAssetUrl(meta.assetPath);
      const tex = loader.load(
        url,
        (loadedTex) => {
          if (this.disposed) {
            loadedTex.dispose();
            return;
          }
          this.loaded[phase] = true;
          loadedTex.needsUpdate = true;
        },
        undefined,
        () => {
          // Keep gracefully non-fatal if an asset request fails in offline/test contexts
        }
      );

      // Crisp pixel-art rendering: nearest-neighbour filtering, no mipmap blur
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.flipY = true;
      return tex;
    };

    this.textures = {
      1: loadPhase(1),
      2: loadPhase(2),
      3: loadPhase(3),
    };
  }

  public getTexture(phase: EvolutionPhase): THREE.Texture {
    return this.textures[phase];
  }

  public isLoaded(phase: EvolutionPhase): boolean {
    return this.loaded[phase];
  }

  public dispose(): void {
    this.disposed = true;
    this.textures[1].dispose();
    this.textures[2].dispose();
    this.textures[3].dispose();
  }
}

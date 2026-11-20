import * as THREE from 'three';
import {
  getElevationAt,
  getTerrainAt,
  HAZARD_TILES,
  LANDMARKS,
  OBSTACLES,
  PALONG_GATES,
  scaleArenaCoord,
  scaleArenaDist,
  simTo3D,
  WORLD_CENTER,
} from './arena';
import {
  ENV_ATLASES,
  ENV_SPRITE_MANIFEST,
  EnvAtlasId,
  EnvSpriteDef,
  EnvSpriteId,
  PixelRect,
} from './envAtlasManifestData';
import type { CarcassEntity } from './types';
import { resolveAssetUrl } from '../utils/assetUrl';

export {
  ENV_ATLASES,
  ENV_SPRITE_MANIFEST,
  type EnvAtlasId,
  type EnvSpriteDef,
  type EnvSpriteId,
  type PixelRect,
};

export type EnvCollisionClass = 'decoration' | 'visual_obstacle' | 'interactive';

export type EnvRenderLayer = 'water_surface' | 'ground_prop' | 'tall_prop' | 'overhang';

export interface EnvironmentalSpriteConfig {
  readonly id: string;
  readonly spriteId: EnvSpriteId;
  /** Simulation X coordinate [0..5656] */
  readonly x: number;
  /** Simulation Z coordinate [0..5656] */
  readonly z: number;
  /** Optional vertical lift in 3D world units (e.g. hanging stalactites in Gua Kelam Tua). */
  readonly yOffset?: number;
  /** World-space height of the sprite in 3D units (width derives strictly from pixel aspect). */
  readonly scale: number;
  readonly flipX?: boolean;
  /** Override playback rate in FPS; 0 renders frame 0 stationary. */
  readonly fps?: number;
  readonly looping?: boolean;
  readonly phaseOffset?: number;
  readonly opacity?: number;
  readonly renderLayer: EnvRenderLayer;
  readonly collisionClass: EnvCollisionClass;
  /** Links 'visual_obstacle' sprites to an existing RockObstacle ID (no new collision geometry). */
  readonly obstacleId?: string;
  readonly cullRadius?: number;
}

export interface EnvUVRect {
  readonly uLeft: number;
  readonly uRight: number;
  readonly vBottom: number;
  readonly vTop: number;
}

/**
 * Computes exact WebGL UV bounds for a pixel rectangle inside an environmental atlas,
 * inset by 0.35 texels so nearest-neighbour sampling never bleeds outside the crop rect.
 */
export function computeEnvFrameUVs(atlasId: EnvAtlasId, rect: PixelRect): EnvUVRect {
  const atlas = ENV_ATLASES[atlasId];
  const epsU = 0.35 / atlas.width;
  const epsV = 0.35 / atlas.height;

  const uLeft = rect.x / atlas.width + epsU;
  const uRight = (rect.x + rect.w) / atlas.width - epsU;
  // Standard Three.js texture orientation (flipY = true): y=0 is top -> v=1
  const vTop = 1 - rect.y / atlas.height - epsV;
  const vBottom = 1 - (rect.y + rect.h) / atlas.height + epsV;

  return { uLeft, uRight, vBottom, vTop };
}

/**
 * Creates a unit 1x1 PlaneGeometry pivoted at normalized vertical anchorY:
 * - anchorY = 0 -> bottom-center pivot (y in [0, 1]) for standing/floating props
 * - anchorY = 0.5 -> centered pivot (y in [-0.5, 0.5])
 * - anchorY = 1 -> top-center pivot (y in [-1, 0]) for hanging stalactites
 */
export function createEnvSpriteGeometry(anchorY = 0): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(1, 1);
  const shiftY = 0.5 - anchorY;
  if (Math.abs(shiftY) > 1e-4) {
    geo.translate(0, shiftY, 0);
  }
  return geo;
}

/**
 * Updates a PlaneGeometry's UV attribute in-place with zero heap allocations.
 */
export function applyEnvFrameUVs(
  geo: THREE.PlaneGeometry,
  atlasId: EnvAtlasId,
  rect: PixelRect
): void {
  const atlas = ENV_ATLASES[atlasId];
  const epsU = 0.35 / atlas.width;
  const epsV = 0.35 / atlas.height;

  const uLeft = rect.x / atlas.width + epsU;
  const uRight = (rect.x + rect.w) / atlas.width - epsU;
  const vTop = 1 - rect.y / atlas.height - epsV;
  const vBottom = 1 - (rect.y + rect.h) / atlas.height + epsV;

  const uv = geo.attributes.uv as THREE.BufferAttribute;
  uv.setXY(0, uLeft, vTop);
  uv.setXY(1, uRight, vTop);
  uv.setXY(2, uLeft, vBottom);
  uv.setXY(3, uRight, vBottom);
  uv.needsUpdate = true;
}

/**
 * Pure two-frame animation index helper (0 or 1).
 */
export function resolveTwoFrameIndex(
  elapsed: number,
  fps: number,
  phaseOffset = 0,
  looping = true
): 0 | 1 {
  if (!looping || fps <= 0) return 0;
  const t = Math.max(0, elapsed + phaseOffset);
  return (Math.floor(t * fps) & 1) as 0 | 1;
}

// ============================================================================
// EVOLUTION-SPECIFIC CARCASS MAPPING & FRAGMENT-VALUE GLOW
// ============================================================================

export type CarcassEvolutionPhase = 1 | 2 | 3;

export const CARCASS_PHASE_SCALE_RATIOS: Record<CarcassEvolutionPhase, number> = {
  1: 1.0,
  2: 1.4,
  3: 1.8,
};

export type CarcassValueTier = 'low' | 'medium' | 'high';

export interface CarcassValueGlowSpec {
  readonly tier: CarcassValueTier;
  readonly colorHex: number;
  readonly ringOpacity: number;
  readonly glowOpacity: number;
  readonly pulseSpeed: number;
  readonly shimmerParticles: boolean;
  readonly particleCount: number;
}

/**
 * Resolves the defeated Keli's visual carcass stage from its recorded level at death.
 * Never depends on the dead victim's zeroed current level.
 */
export function resolveCarcassEvolutionPhase(
  carcass: Pick<CarcassEntity, 'evolutionPhaseAtDeath' | 'mass'>
): CarcassEvolutionPhase {
  if (
    carcass.evolutionPhaseAtDeath === 1 ||
    carcass.evolutionPhaseAtDeath === 2 ||
    carcass.evolutionPhaseAtDeath === 3
  ) {
    return carcass.evolutionPhaseAtDeath;
  }
  if (carcass.mass >= 80) return 3;
  if (carcass.mass >= 40) return 2;
  return 1;
}

export function getCarcassSpriteId(
  phase: CarcassEvolutionPhase
): 'carcass_phase1' | 'carcass_phase2' | 'carcass_phase3' {
  if (phase === 3) return 'carcass_phase3';
  if (phase === 2) return 'carcass_phase2';
  return 'carcass_phase1';
}

/**
 * Computes visual carcass height in 3D units using evolution phase base ratios
 * (1.0x / 1.4x / 1.8x) plus subtle smooth shrinkage as fragments are depleted.
 * Visual scaling is completely decoupled from gameplay feeding reach & collisions.
 */
export function computeCarcassVisualScale(
  phase: CarcassEvolutionPhase,
  remainingMass: number,
  initialMass?: number
): { width: number; height: number } {
  const spriteId = getCarcassSpriteId(phase);
  const def = ENV_SPRITE_MANIFEST[spriteId];
  const rect = def.frames[0];
  const aspect = rect.w / rect.h;

  const baseHeight = 1.65 * CARCASS_PHASE_SCALE_RATIOS[phase];
  const startMass = Math.max(1, initialMass ?? remainingMass);
  const depletionRatio = Math.max(0.25, Math.min(1, remainingMass / startMass));
  // Subtle progressive shrink (at most -14%) so carcasses never resize abruptly
  const shrinkFactor = 0.86 + 0.14 * depletionRatio;
  const height = baseHeight * shrinkFactor;
  return {
    width: height * aspect,
    height,
  };
}

/**
 * Returns visual glow presentation driven strictly by remaining fragments:
 * - 1-9:   Subtle pale blue glow
 * - 10-29: Gentle gold glow
 * - 30+:   Strong gold shimmer with occasional rising gold particles
 */
export function getCarcassValueGlow(remainingFragments: number): CarcassValueGlowSpec {
  const frags = Math.max(0, Math.trunc(remainingFragments));
  if (frags >= 30) {
    return {
      tier: 'high',
      colorHex: 0xfde047,
      ringOpacity: 0.88,
      glowOpacity: 0.8,
      pulseSpeed: 4.2,
      shimmerParticles: true,
      particleCount: 6,
    };
  }
  if (frags >= 10) {
    return {
      tier: 'medium',
      colorHex: 0xfbbf24,
      ringOpacity: 0.66,
      glowOpacity: 0.56,
      pulseSpeed: 2.8,
      shimmerParticles: false,
      particleCount: 2,
    };
  }
  return {
    tier: 'low',
    colorHex: 0x7dd3fc,
    ringOpacity: 0.42,
    glowOpacity: 0.32,
    pulseSpeed: 1.7,
    shimmerParticles: false,
    particleCount: 0,
  };
}

// ============================================================================
// SHARED ATLAS TEXTURE & MATERIAL MANAGER (2 GPU TEXTURES TOTAL)
// ============================================================================

export class EnvSpriteAtlasManager {
  private textures: Record<EnvAtlasId, THREE.Texture>;
  private cutoutMaterials: Record<EnvAtlasId, THREE.MeshBasicMaterial>;
  private surfaceMaterials: Record<EnvAtlasId, THREE.MeshBasicMaterial>;
  private glowTexture: THREE.CanvasTexture;
  private disposed = false;

  constructor() {
    const loader = new THREE.TextureLoader();

    const loadAtlas = (id: EnvAtlasId): THREE.Texture => {
      const meta = ENV_ATLASES[id];
      const tex = loader.load(
        resolveAssetUrl(meta.assetPath),
        (loadedTex) => {
          if (this.disposed) {
            loadedTex.dispose();
            return;
          }
          loadedTex.needsUpdate = true;
        },
        undefined,
        () => {
          // Non-fatal in headless/offline environments
        }
      );
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
      fishing: loadAtlas('fishing'),
      advanced: loadAtlas('advanced'),
    };

    const makeCutoutMat = (tex: THREE.Texture) =>
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.14,
        depthWrite: true,
        side: THREE.DoubleSide,
      });

    const makeSurfaceMat = (tex: THREE.Texture) =>
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.06,
        opacity: 0.88,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

    this.cutoutMaterials = {
      fishing: makeCutoutMat(this.textures.fishing),
      advanced: makeCutoutMat(this.textures.advanced),
    };
    this.surfaceMaterials = {
      fishing: makeSurfaceMat(this.textures.fishing),
      advanced: makeSurfaceMat(this.textures.advanced),
    };

    this.glowTexture = this.createCarcassGlowTexture();
  }

  private createCarcassGlowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.42, 'rgba(255, 255, 255, 0.45)');
    grad.addColorStop(0.76, 'rgba(255, 255, 255, 0.14)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  public getTexture(id: EnvAtlasId): THREE.Texture {
    return this.textures[id];
  }

  public getSharedMaterial(id: EnvAtlasId, layer: EnvRenderLayer): THREE.MeshBasicMaterial {
    return layer === 'water_surface'
      ? this.surfaceMaterials[id]
      : this.cutoutMaterials[id];
  }

  public getCarcassGlowTexture(): THREE.CanvasTexture {
    return this.glowTexture;
  }

  public dispose(): void {
    this.disposed = true;
    this.cutoutMaterials.fishing.dispose();
    this.cutoutMaterials.advanced.dispose();
    this.surfaceMaterials.fishing.dispose();
    this.surfaceMaterials.advanced.dispose();
    this.textures.fishing.dispose();
    this.textures.advanced.dispose();
    this.glowTexture.dispose();
  }
}

// ============================================================================
// REUSABLE ENVIRONMENTAL SPRITE COMPONENT
// ============================================================================

const RENDER_ORDER_BY_LAYER: Record<EnvRenderLayer, number> = {
  water_surface: 3,
  ground_prop: 5,
  tall_prop: 6,
  overhang: 9,
};

export class EnvironmentalSprite {
  public readonly config: EnvironmentalSpriteConfig;
  public readonly def: EnvSpriteDef;
  public readonly mesh: THREE.Mesh;
  public readonly geometry: THREE.PlaneGeometry;
  public readonly worldX: number;
  public readonly worldZ: number;
  public readonly baseY: number;

  private readonly fps: number;
  private readonly looping: boolean;
  private readonly phaseOffset: number;
  private readonly cullRadiusSq: number;
  private readonly isWaterSurface: boolean;
  private currentFrame: 0 | 1 = 0;

  constructor(config: EnvironmentalSpriteConfig, atlases: EnvSpriteAtlasManager) {
    this.config = config;
    this.def = ENV_SPRITE_MANIFEST[config.spriteId];
    this.fps = config.fps ?? this.def.fps;
    this.looping = config.looping ?? this.fps > 0;
    this.phaseOffset = config.phaseOffset ?? 0;
    this.isWaterSurface = config.renderLayer === 'water_surface';

    const rect0 = this.def.frames[0];
    const aspect = rect0.w / rect0.h;
    const width = config.scale * aspect;
    const height = config.scale;

    this.geometry = createEnvSpriteGeometry(this.def.anchor.y);
    applyEnvFrameUVs(this.geometry, this.def.atlas, rect0);

    const mat = atlases.getSharedMaterial(this.def.atlas, config.renderLayer);
    this.mesh = new THREE.Mesh(this.geometry, mat);
    this.mesh.renderOrder = RENDER_ORDER_BY_LAYER[config.renderLayer];
    this.mesh.scale.set((config.flipX ? -1 : 1) * width, height, 1);

    this.worldX = simTo3D(config.x);
    this.worldZ = simTo3D(config.z);
    const elev = getElevationAt(config.x, config.z);
    const groundY =
      config.renderLayer === 'water_surface'
        ? 0.08
        : elev > 0.04
          ? elev * 2.2 - 0.04
          : -0.06;
    this.baseY = groundY + (config.yOffset ?? 0);

    this.mesh.position.set(this.worldX, this.baseY, this.worldZ);
    const r = config.cullRadius ?? 74;
    this.cullRadiusSq = r * r;
  }

  /**
   * Performs view-distance culling, billboard alignment, and low-overhead
   * two-frame UV stepping (updates GPU buffer only when frame 0 <-> 1 toggles).
   */
  public update(
    elapsed: number,
    cameraQuat: THREE.Quaternion,
    focusX3D: number,
    focusZ3D: number,
    reducedMotion: boolean
  ): boolean {
    const dx = this.worldX - focusX3D;
    const dz = this.worldZ - focusZ3D;
    if (dx * dx + dz * dz > this.cullRadiusSq) {
      if (this.mesh.visible) this.mesh.visible = false;
      return false;
    }

    if (!this.mesh.visible) this.mesh.visible = true;
    this.mesh.quaternion.copy(cameraQuat);

    if (this.looping && this.fps > 0 && !reducedMotion) {
      const nextFrame = resolveTwoFrameIndex(elapsed, this.fps, this.phaseOffset, true);
      if (nextFrame !== this.currentFrame) {
        this.currentFrame = nextFrame;
        applyEnvFrameUVs(this.geometry, this.def.atlas, this.def.frames[nextFrame]);
      }
    }

    // Keep water-surface ripples grounded flush; zero exaggerated whole-object wobbling
    if (this.isWaterSurface) {
      this.mesh.position.y = this.baseY;
    }

    return true;
  }

  public dispose(): void {
    this.geometry.dispose();
  }
}

// ============================================================================
// DETERMINISTIC SEEDED WANG KELIAN ENVIRONMENTAL PLACEMENT
// ============================================================================

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isNearProtectedLandmark(x: number, z: number): boolean {
  const protectedPts = [
    LANDMARKS.tutorialStart,
    LANDMARKS.tutorialSafeCarcass,
    LANDMARKS.tutorialContestedCarcass,
    LANDMARKS.redPaperBoat,
  ];
  for (let i = 0; i < protectedPts.length; i++) {
    if (Math.hypot(x - protectedPts[i].x, z - protectedPts[i].z) < 120) return true;
  }
  for (let i = 0; i < PALONG_GATES.length; i++) {
    if (Math.hypot(x - PALONG_GATES[i].x, z - PALONG_GATES[i].z) < 135) return true;
  }
  return false;
}

function isInsideObstacle(x: number, z: number, pad = 24): boolean {
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i];
    if (Math.hypot(x - o.x, z - o.z) < o.radius + pad) return true;
  }
  return false;
}

/**
 * Generates the complete, deterministic Wang Kelian environmental layout using
 * all 21 non-carcass sprites across both atlases. Pure decorations never add
 * collision; solid rock/mangrove/monument sprites anchor onto existing OBSTACLES.
 */
export function buildArenaEnvironmentalLayout(): EnvironmentalSpriteConfig[] {
  const rand = mulberry32(20260717);
  const items: EnvironmentalSpriteConfig[] = [];
  let seq = 0;

  const push = (
    spriteId: EnvSpriteId,
    x: number,
    z: number,
    scale: number,
    renderLayer: EnvRenderLayer,
    collisionClass: EnvCollisionClass,
    extra: Partial<EnvironmentalSpriteConfig> = {}
  ) => {
    items.push({
      id: `env-${spriteId}-${seq++}`,
      spriteId,
      x: Math.round(x),
      z: Math.round(z),
      scale,
      flipX: extra.flipX ?? rand() > 0.5,
      phaseOffset: extra.phaseOffset ?? rand() * 4.0,
      renderLayer,
      collisionClass,
      ...extra,
    });
  };

  const hasNearbyProp = (
    x: number,
    z: number,
    minAnyDist: number,
    sameTypeId?: EnvSpriteId,
    minSameTypeDist = 0
  ): boolean => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const d = Math.hypot(it.x - x, it.z - z);
      if (d < minAnyDist) return true;
      if (sameTypeId && it.spriteId === sameTypeId && d < minSameTypeDist) return true;
    }
    return false;
  };

  // --------------------------------------------------------------------------
  // 1. VISUAL OBSTACLES (anchored strictly onto existing OBSTACLES footprints)
  // --------------------------------------------------------------------------
  for (const obs of OBSTACLES) {
    if (obs.id.startsWith('cliff-')) continue;

    if (obs.kind === 'root') {
      // Mangrove roots & vegetation anchored onto existing root outcrops
      push('mangrove_roots', obs.x, obs.z, 5.2 + (obs.radius / 90) * 1.4, 'tall_prop', 'visual_obstacle', {
        obstacleId: obs.id,
        yOffset: 0.25,
      });
    } else if (obs.kind === 'pillar' && (obs.id.startsWith('gk-') || obs.id === 'lh-6')) {
      // Ancient glowing stone monuments anchored onto existing cavern/basin pillar obstacles
      push('stone_monument', obs.x, obs.z, 5.6, 'tall_prop', 'visual_obstacle', {
        obstacleId: obs.id,
        yOffset: 0.15,
      });
      if (obs.id.startsWith('gk-')) {
        push('stalactites', obs.x + 18, obs.z - 14, 4.8, 'overhang', 'decoration', {
          yOffset: 7.4,
        });
      }
    } else if (obs.id.startsWith('lh-') && obs.kind === 'boulder') {
      // Moss-covered rock formations on Lubuk Hitam central cover rocks (static)
      push('moss_rock', obs.x, obs.z, 4.4, 'ground_prop', 'visual_obstacle', {
        obstacleId: obs.id,
        yOffset: 0.1,
      });
    } else if (obs.id.startsWith('sb-') && obs.kind === 'boulder') {
      push('moss_rock', obs.x, obs.z, 4.8, 'ground_prop', 'visual_obstacle', {
        obstacleId: obs.id,
        yOffset: 0.12,
      });
    }
  }

  // Gua Kelam Tua cavern mouth overhanging stalactites & bioluminescent mushrooms
  const cave = LANDMARKS.guaKelamCavern;
  push('stalactites', cave.x - 42, cave.z - 22, 5.4, 'overhang', 'decoration', { yOffset: 8.6 });
  push('stalactites', cave.x + 48, cave.z + 18, 5.0, 'overhang', 'decoration', { yOffset: 8.2 });
  push('biolum_mushrooms', cave.x - 75, cave.z + 65, 3.8, 'ground_prop', 'decoration');
  push('biolum_mushrooms', cave.x + 90, cave.z - 45, 3.6, 'ground_prop', 'decoration');
  push('biolum_mushrooms', cave.x + 15, cave.z + 110, 3.4, 'ground_prop', 'decoration');

  // Jantung Tasik anomaly perimeter bioluminescent mushrooms & ancient monument
  const drum = LANDMARKS.radioactiveDrum;
  push('biolum_mushrooms', drum.x - 110, drum.z - 60, 3.7, 'ground_prop', 'decoration');
  push('biolum_mushrooms', drum.x + 125, drum.z + 75, 3.5, 'ground_prop', 'decoration');
  push('broken_barrel', drum.x + 78, drum.z - 58, 2.8, 'ground_prop', 'decoration');
  push('floating_rubbish', drum.x - 86, drum.z + 72, 2.3, 'ground_prop', 'decoration');
  push('floating_rubbish', drum.x + 42, drum.z + 108, 2.1, 'ground_prop', 'decoration');

  // --------------------------------------------------------------------------
  // 2. HAZARD REGIONS (Toxic bubbling pools strictly inside existing toxic_sludge tiles)
  // --------------------------------------------------------------------------
  for (const h of HAZARD_TILES) {
    if (h.kind !== 'toxic_sludge') continue;
    push('toxic_pool', h.x, h.z, 3.8, 'ground_prop', 'decoration', { fps: 3.0 });
    const subAngle = rand() * Math.PI * 2;
    const subR = h.radius * 0.45;
    push(
      'toxic_pool',
      h.x + Math.cos(subAngle) * subR,
      h.z + Math.sin(subAngle) * subR,
      2.9,
      'ground_prop',
      'decoration',
      { fps: 3.0 }
    );
  }

  // --------------------------------------------------------------------------
  // 3. RIVERBANKS, KAMPUNG JETTY & TEROWONG BIJIH FISHING PROPS (Non-blocking!)
  // --------------------------------------------------------------------------
  const jetty = LANDMARKS.kampungJetty;
  push('lantern_post', jetty.x - 98, jetty.z - 68, 4.3, 'tall_prop', 'decoration');
  push('lantern_post', jetty.x - 86, jetty.z + 92, 4.2, 'tall_prop', 'decoration');
  push('bamboo_raft', jetty.x - 125, jetty.z + 18, 4.4, 'ground_prop', 'decoration', { fps: 2.0 });
  push('fishing_net', jetty.x - 52, jetty.z - 128, 3.9, 'ground_prop', 'decoration');
  push('fishing_net', jetty.x - 42, jetty.z + 148, 3.9, 'ground_prop', 'decoration');
  push('supply_crate', jetty.x - 102, jetty.z - 18, 2.8, 'ground_prop', 'decoration', { fps: 1.0 });
  push('fishing_buoy', jetty.x - 155, jetty.z - 75, 2.6, 'ground_prop', 'decoration', { fps: 1.5 });
  push('fish_trap', jetty.x - 210, jetty.z + 125, 3.3, 'ground_prop', 'decoration');

  // Secondary bamboo raft & lantern posts along Tebing Kering / Palong approaches
  const landing = LANDMARKS.tebingKeringLanding;
  push('lantern_post', landing.x - 65, landing.z + 175, 4.1, 'tall_prop', 'decoration');
  push('lantern_post', scaleArenaCoord(1275), scaleArenaCoord(880), 4.1, 'tall_prop', 'decoration');
  push('bamboo_raft', scaleArenaCoord(660), scaleArenaCoord(1120), 4.2, 'ground_prop', 'decoration', { fps: 2.0 });

  // Industrial detritus & supply crates near Terowong Bijih sluice margins (outside gate center)
  for (const gate of PALONG_GATES) {
    const perpX = -Math.sin(gate.angle);
    const perpZ = Math.cos(gate.angle);
    push('lantern_post', gate.x + perpX * 150, gate.z + perpZ * 150, 4.0, 'tall_prop', 'decoration');
    push('broken_barrel', gate.x - perpX * 165, gate.z - perpZ * 165, 2.8, 'ground_prop', 'decoration');
    push('supply_crate', gate.x + Math.cos(gate.angle) * 185, gate.z + Math.sin(gate.angle) * 185, 2.7, 'ground_prop', 'decoration', { fps: 1.0 });
    push('floating_rubbish', gate.x - Math.cos(gate.angle) * 195, gate.z - Math.sin(gate.angle) * 195, 2.2, 'ground_prop', 'decoration', { fps: 1.2 });
  }

  // --------------------------------------------------------------------------
  // 4. SHALLOW WATER (Sungai Berselirat & shoreline shallows)
  // --------------------------------------------------------------------------
  const scatterInTerrain = (
    spriteId: EnvSpriteId,
    count: number,
    allowedTerrains: ReadonlyArray<'shallow' | 'deep' | 'shore'>,
    minSpacing: number,
    scaleMin: number,
    scaleMax: number,
    layer: EnvRenderLayer,
    regionFilter?: (x: number, z: number) => boolean
  ) => {
    let placed = 0;
    const maxR = scaleArenaDist(840);
    const minAnyDist = Math.min(minSpacing, 120);
    for (let attempt = 0; attempt < count * 45 && placed < count; attempt++) {
      const ang = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * maxR;
      const x = WORLD_CENTER + Math.cos(ang) * dist;
      const z = WORLD_CENTER + Math.sin(ang) * dist;

      if (regionFilter && !regionFilter(x, z)) continue;
      const terrain = getTerrainAt(x, z);
      if (!allowedTerrains.includes(terrain as 'shallow' | 'deep' | 'shore')) continue;
      if (isNearProtectedLandmark(x, z)) continue;
      if (isInsideObstacle(x, z, 34)) continue;
      if (hasNearbyProp(x, z, minAnyDist, spriteId, minSpacing)) continue;

      const sc = scaleMin + rand() * (scaleMax - scaleMin);
      push(spriteId, x, z, sc, layer, 'decoration');
      placed++;
    }
  };

  // Tall reeds along shallow margins & Sungai Berselirat
  scatterInTerrain('tall_reeds', 22, ['shallow'], 175, 3.6, 4.6, 'tall_prop');

  // Water lilies (pink flower) & white lotus in calm Sungai Berselirat & shallow coves
  scatterInTerrain('water_lilies', 14, ['shallow'], 190, 2.4, 3.1, 'ground_prop');
  scatterInTerrain(
    'white_lotus',
    10,
    ['shallow'],
    200,
    2.8,
    3.5,
    'ground_prop',
    (x, z) => x < scaleArenaCoord(1120) && z > scaleArenaCoord(920)
  );

  // Floating driftwood logs & fishing buoys in shallows/open edges
  scatterInTerrain('driftwood_log', 8, ['shallow', 'deep'], 340, 2.6, 3.2, 'ground_prop');
  scatterInTerrain('fishing_buoy', 7, ['shallow', 'deep'], 380, 2.5, 3.0, 'ground_prop');
  scatterInTerrain('supply_crate', 5, ['shallow', 'deep'], 440, 2.5, 2.9, 'ground_prop');
  scatterInTerrain('broken_barrel', 4, ['shallow', 'deep'], 460, 2.6, 3.0, 'ground_prop');
  scatterInTerrain('floating_rubbish', 5, ['shallow'], 380, 2.0, 2.4, 'ground_prop');

  // Water ripples scattered lightly across flowing & shallow water surfaces
  scatterInTerrain('water_ripple', 18, ['shallow', 'deep'], 240, 2.2, 2.9, 'water_surface');

  // --------------------------------------------------------------------------
  // 5. DEEPER WATER & HIDDEN ALCOVES (Lubuk Hitam, Terowong Bijih, Gua Kelam)
  // --------------------------------------------------------------------------
  scatterInTerrain('aquatic_weeds', 16, ['deep', 'shallow'], 220, 3.2, 4.1, 'ground_prop');
  scatterInTerrain('fish_trap', 6, ['deep'], 420, 3.1, 3.7, 'ground_prop');
  scatterInTerrain('giant_clam', 6, ['deep'], 460, 2.9, 3.5, 'ground_prop');
  // Deep water bioluminescent mushrooms in Gua Kelam & NW basin
  scatterInTerrain(
    'biolum_mushrooms',
    5,
    ['deep'],
    340,
    3.2,
    3.9,
    'ground_prop',
    (x, z) => x < scaleArenaCoord(980) && z < scaleArenaCoord(980)
  );

  return items;
}

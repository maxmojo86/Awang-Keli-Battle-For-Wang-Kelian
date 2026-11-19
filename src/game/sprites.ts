import * as THREE from 'three';
import { resolveAssetUrl } from '../utils/assetUrl';
import {
  getEvolutionForm,
  getMilestoneTier,
  MILESTONE_TIERS,
  MilestoneTier,
} from '../data/abilities';
import { EvolutionForm } from './types';

// 8 directional indices:
// 0: S (toward camera), 1: SW, 2: W, 3: NW, 4: N (away), 5: NE, 6: E, 7: SE
export type FacingIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type RigPartName =
  | 'tail'
  | 'farArm'
  | 'farLeg'
  | 'nearLeg'
  | 'torso'
  | 'head'
  | 'nearArm';

export const RIG_PART_ORDER: RigPartName[] = [
  'tail',
  'farArm',
  'farLeg',
  'nearLeg',
  'torso',
  'head',
  'nearArm',
];

export interface RigPartSpec {
  texture: THREE.CanvasTexture;
  active: boolean;
  /** Joint pivot in normalized 0..1 rig space (left->right, top->bottom) */
  uPivot: number;
  vPivot: number;
  /** Depth offset along camera normal (+Z toward viewer) */
  layerZ: number;
}

export type TierRigParts = Record<RigPartName, RigPartSpec>;

export interface SpriteSet {
  // [MilestoneTier 1..100][facing 0..7][frame 0..1]
  tiers: Record<MilestoneTier, THREE.CanvasTexture[][]>;
  // Articulated anatomical plates per milestone tier
  rigParts: Record<MilestoneTier, TierRigParts>;
  rigRevision: number;
  carcass: THREE.CanvasTexture;
}

const SIZE = 160;

const CODEX_SPRITE_PATHS: Record<MilestoneTier, string> = {
  1: resolveAssetUrl('assets/sprites/keli_lv1.png'),
  10: resolveAssetUrl('assets/sprites/keli_lv10.png'),
  20: resolveAssetUrl('assets/sprites/keli_lv20.png'),
  30: resolveAssetUrl('assets/sprites/keli_lv30.png'),
  40: resolveAssetUrl('assets/sprites/keli_lv40.png'),
  50: resolveAssetUrl('assets/sprites/keli_lv50.png'),
  60: resolveAssetUrl('assets/sprites/keli_lv60.png'),
  70: resolveAssetUrl('assets/sprites/keli_lv70.png'),
  80: resolveAssetUrl('assets/sprites/keli_lv80.png'),
  90: resolveAssetUrl('assets/sprites/keli_lv90.png'),
  100: resolveAssetUrl('assets/sprites/keli_lv100.png'),
};

const loadedCodexImages: Partial<Record<MilestoneTier, HTMLImageElement>> = {};
const portraitListeners = new Set<() => void>();
let preloadStarted = false;

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function toTex(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function angleToFacingIndex(angleRad: number): FacingIndex {
  const shifted = angleRad - Math.PI / 2;
  const norm = ((shifted % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const idx = Math.round((norm / (Math.PI * 2)) * 8) % 8;
  return idx as FacingIndex;
}

function drawGlossyBlackEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number
) {
  ctx.save();
  ctx.fillStyle = '#050708';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#2d393f';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = 'rgba(235, 245, 248, 0.85)';
  ctx.beginPath();
  ctx.ellipse(
    x - rx * 0.28,
    y - ry * 0.3,
    Math.max(1.2, rx * 0.28),
    Math.max(1.0, ry * 0.24),
    -0.4,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.restore();
}

function drawBarbels(
  ctx: CanvasRenderingContext2D,
  mouthX: number,
  mouthY: number,
  dirX: number,
  spread: number,
  len: number,
  sway: number
) {
  ctx.save();
  ctx.strokeStyle = '#dec4a2';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';

  const offsets = [-1, -0.45, 0.45, 1];
  offsets.forEach((o, i) => {
    const startX = mouthX + o * spread * 0.45;
    const startY = mouthY + Math.abs(o) * 1.6;
    const endX =
      startX + dirX * len * 0.65 + o * spread + sway * (i % 2 === 0 ? 1 : -1);
    const endY = startY + len * (0.55 + Math.abs(o) * 0.28);
    const ctrlX = (startX + endX) * 0.5 + o * 4;
    const ctrlY = startY + len * 0.22;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
    ctx.stroke();
  });
  ctx.restore();
}

/**
 * Immediate synchronous procedural fallback used only during the brief millisecond
 * before each Codex sprite PNG finishes decoding.
 */
function paintProceduralFallback(
  canvas: HTMLCanvasElement,
  form: EvolutionForm,
  facing: FacingIndex,
  frame: number
) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  const scale = SIZE / 104;
  ctx.save();
  ctx.scale(scale, scale);

  const S = 104;
  const wag = frame === 0 ? -3.8 : 3.8;
  const angleMap = [
    Math.PI / 2,
    (3 * Math.PI) / 4,
    Math.PI,
    (-3 * Math.PI) / 4,
    -Math.PI / 2,
    -Math.PI / 4,
    0,
    Math.PI / 4,
  ];
  const ang = angleMap[facing];
  const dirX = Math.cos(ang);
  const dirY = Math.sin(ang);
  const isBack = dirY < -0.35;
  const isFront = dirY > 0.35;

  const outline = '#12151a';
  const skinDark = form === 4 ? '#343e49' : '#3a4550';
  const skinMid = form === 4 ? '#586674' : '#606f7d';
  const belly = '#c4b099';
  const spineColor = form >= 2 ? '#c25d3a' : '#8e5a64';

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const cx = S * 0.5;
  const cy = form >= 3 ? S * 0.56 : S * 0.68;

  ctx.fillStyle = skinMid;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.ellipse(cx, cy, form === 1 ? 20 : 21, form >= 3 ? 21 : 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (!isBack) {
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(cx + dirX * 2, cy + 4, 12, form >= 3 ? 12 : 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = spineColor;
  for (let s = -2; s <= 2; s++) {
    ctx.beginPath();
    ctx.moveTo(cx + s * 4.5 - 2.2, cy - 12);
    ctx.lineTo(cx + s * 4.5, cy - 20);
    ctx.lineTo(cx + s * 4.5 + 2.2, cy - 12);
    ctx.fill();
  }

  const headX = cx + dirX * (form >= 3 ? 4 : 10);
  const headY = cy - (form >= 3 ? 16 : 0) + dirY * 3;
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.ellipse(headX, headY, 15, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (!isBack) {
    if (isFront) {
      drawGlossyBlackEye(ctx, headX - 7, headY - 1.5, 3.8, 3.2);
      drawGlossyBlackEye(ctx, headX + 7, headY - 1.5, 3.8, 3.2);
    } else {
      drawGlossyBlackEye(ctx, headX + dirX * 5, headY - 2, 4.1, 3.3);
    }
    drawBarbels(ctx, headX + dirX * 5, headY + 4, dirX, 10, 14, wag * 0.4);
  }
  ctx.restore();
}

/**
 * Computes exact anatomical layout & joint pivots for a given milestone tier
 * inside the 160x160 bottom-center-anchored sprite canvas.
 */
interface PartMaskDef {
  active: boolean;
  /** Polygon vertices in normalized [0..1]x[0..1] of the source PNG */
  poly: Array<[number, number]>;
  /** Cutout polygons removed from torso so limbs never duplicate behind joints */
  torsoCut?: Array<[number, number]>;
  /** Anatomical joint pivot in normalized [0..1]x[0..1] of the source PNG */
  uPivot: number;
  vPivot: number;
  layerZ: number;
}

function getFormPartLayout(form: EvolutionForm): Record<RigPartName, PartMaskDef> {
  if (form === 1) {
    return {
      tail: {
        active: true,
        poly: [
          [0.0, 0.0],
          [0.37, 0.0],
          [0.37, 1.0],
          [0.0, 1.0],
        ],
        torsoCut: [
          [0.0, 0.0],
          [0.32, 0.0],
          [0.32, 1.0],
          [0.0, 1.0],
        ],
        uPivot: 0.34,
        vPivot: 0.56,
        layerZ: -0.015,
      },
      farArm: { active: false, poly: [], uPivot: 0.5, vPivot: 0.5, layerZ: -0.025 },
      farLeg: { active: false, poly: [], uPivot: 0.5, vPivot: 0.5, layerZ: -0.02 },
      nearLeg: { active: false, poly: [], uPivot: 0.5, vPivot: 0.5, layerZ: -0.01 },
      torso: {
        active: true,
        poly: [
          [0.0, 0.0],
          [1.0, 0.0],
          [1.0, 1.0],
          [0.0, 1.0],
        ],
        uPivot: 0.48,
        vPivot: 0.56,
        layerZ: 0,
      },
      head: {
        active: true,
        poly: [
          [0.57, 0.0],
          [1.0, 0.0],
          [1.0, 1.0],
          [0.41, 1.0],
          [0.49, 0.68],
          [0.57, 0.36],
        ],
        torsoCut: [
          [0.62, 0.0],
          [1.0, 0.0],
          [1.0, 1.0],
          [0.45, 1.0],
          [0.53, 0.7],
          [0.62, 0.38],
        ],
        uPivot: 0.6,
        vPivot: 0.48,
        layerZ: 0.015,
      },
      nearArm: { active: false, poly: [], uPivot: 0.5, vPivot: 0.5, layerZ: 0.025 },
    };
  }

  if (form === 2) {
    // Crawling form (Lv.40-79): strong forelimbs, curled tail, armored chest, catfish head
    return {
      tail: {
        active: true,
        poly: [
          [0.0, 0.47],
          [0.35, 0.51],
          [0.39, 1.0],
          [0.0, 1.0],
        ],
        torsoCut: [
          [0.0, 0.5],
          [0.31, 0.55],
          [0.34, 1.0],
          [0.0, 1.0],
        ],
        uPivot: 0.35,
        vPivot: 0.8,
        layerZ: -0.028,
      },
      farArm: {
        active: true,
        poly: [
          [0.7, 0.55],
          [1.0, 0.55],
          [1.0, 1.0],
          [0.68, 1.0],
        ],
        torsoCut: [
          [0.74, 0.58],
          [1.0, 0.58],
          [1.0, 1.0],
          [0.71, 1.0],
        ],
        uPivot: 0.77,
        vPivot: 0.61,
        layerZ: -0.022,
      },
      farLeg: { active: false, poly: [], uPivot: 0.5, vPivot: 0.5, layerZ: -0.018 },
      nearLeg: { active: false, poly: [], uPivot: 0.5, vPivot: 0.5, layerZ: -0.01 },
      torso: {
        active: true,
        poly: [
          [0.0, 0.0],
          [1.0, 0.0],
          [1.0, 1.0],
          [0.0, 1.0],
        ],
        uPivot: 0.52,
        vPivot: 0.62,
        layerZ: 0,
      },
      head: {
        active: true,
        poly: [
          [0.45, 0.0],
          [1.0, 0.0],
          [1.0, 0.54],
          [0.64, 0.46],
          [0.45, 0.33],
        ],
        torsoCut: [
          [0.49, 0.0],
          [1.0, 0.0],
          [1.0, 0.49],
          [0.66, 0.42],
          [0.49, 0.31],
        ],
        uPivot: 0.58,
        vPivot: 0.35,
        layerZ: 0.015,
      },
      nearArm: {
        active: true,
        poly: [
          [0.32, 0.46],
          [0.57, 0.53],
          [0.67, 1.0],
          [0.31, 1.0],
        ],
        torsoCut: [
          [0.35, 0.5],
          [0.54, 0.57],
          [0.63, 1.0],
          [0.34, 1.0],
        ],
        uPivot: 0.42,
        vPivot: 0.55,
        layerZ: 0.028,
      },
    };
  }

  // Form 3 & 4 (Lv.80-100): Bipedal Amphibious & Keli King
  return {
    tail: {
      active: true,
      poly: [
        [0.0, 0.5],
        [0.24, 0.58],
        [0.26, 0.9],
        [0.0, 0.9],
      ],
      torsoCut: [
        [0.0, 0.52],
        [0.19, 0.6],
        [0.21, 0.88],
        [0.0, 0.88],
      ],
      uPivot: 0.22,
      vPivot: 0.72,
      layerZ: -0.036,
    },
    farArm: {
      active: true,
      poly: [
        [0.75, 0.33],
        [1.0, 0.33],
        [1.0, 0.73],
        [0.74, 0.72],
      ],
      torsoCut: [
        [0.78, 0.37],
        [1.0, 0.37],
        [1.0, 0.73],
        [0.77, 0.72],
      ],
      uPivot: 0.79,
      vPivot: 0.39,
      layerZ: -0.028,
    },
    farLeg: {
      active: true,
      poly: [
        [0.51, 0.68],
        [0.95, 0.68],
        [0.95, 1.0],
        [0.51, 1.0],
      ],
      torsoCut: [
        [0.53, 0.74],
        [0.95, 0.74],
        [0.95, 1.0],
        [0.53, 1.0],
      ],
      uPivot: 0.68,
      vPivot: 0.71,
      layerZ: -0.02,
    },
    nearLeg: {
      active: true,
      poly: [
        [0.14, 0.68],
        [0.52, 0.68],
        [0.52, 1.0],
        [0.14, 1.0],
      ],
      torsoCut: [
        [0.14, 0.77],
        [0.5, 0.77],
        [0.5, 1.0],
        [0.14, 1.0],
      ],
      uPivot: 0.34,
      vPivot: 0.71,
      layerZ: -0.012,
    },
    torso: {
      active: true,
      poly: [
        [0.0, 0.0],
        [1.0, 0.0],
        [1.0, 1.0],
        [0.0, 1.0],
      ],
      uPivot: 0.48,
      vPivot: 0.6,
      layerZ: 0,
    },
    head: {
      active: true,
      poly: [
        [0.25, 0.0],
        [1.0, 0.0],
        [1.0, 0.34],
        [0.58, 0.31],
        [0.25, 0.27],
      ],
      torsoCut: [
        [0.3, 0.0],
        [1.0, 0.0],
        [1.0, 0.3],
        [0.6, 0.27],
        [0.3, 0.24],
      ],
      uPivot: 0.58,
      vPivot: 0.26,
      layerZ: 0.016,
    },
    nearArm: {
      active: true,
      poly: [
        [0.0, 0.26],
        [0.41, 0.32],
        [0.42, 0.74],
        [0.08, 0.74],
        [0.0, 0.58],
      ],
      torsoCut: [
        [0.0, 0.3],
        [0.38, 0.36],
        [0.39, 0.73],
        [0.08, 0.73],
        [0.0, 0.58],
      ],
      uPivot: 0.24,
      vPivot: 0.36,
      layerZ: 0.028,
    },
  };
}

function tracePoly(
  ctx: CanvasRenderingContext2D,
  poly: Array<[number, number]>,
  left: number,
  top: number,
  w: number,
  h: number
) {
  ctx.beginPath();
  poly.forEach(([u, v], idx) => {
    const x = left + u * w;
    const y = top + v * h;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/**
 * Slices an official Codex sprite PNG into articulated limb/torso/head CanvasTextures
 * positioned identically inside a 160x160 bottom-center-anchored frame, plus updates
 * each part's exact anatomical pivot coordinates.
 */
function bakeRigPartsFromImage(
  img: HTMLImageElement,
  tier: MilestoneTier,
  rigParts: TierRigParts
) {
  const form = getEvolutionForm(tier);
  const layout = getFormPartLayout(form);

  const maxDim = Math.max(img.width, img.height);
  const fitScale = (SIZE - 14) / maxDim;
  const drawW = Math.round(img.width * fitScale);
  const drawH = Math.round(img.height * fitScale);
  const left = SIZE * 0.5 - drawW * 0.5;
  const top = SIZE - 5 - drawH;

  for (const partName of RIG_PART_ORDER) {
    const def = layout[partName];
    const spec = rigParts[partName];
    spec.active = def.active;
    spec.layerZ = def.layerZ;
    spec.uPivot = (left + def.uPivot * drawW) / SIZE;
    spec.vPivot = (top + def.vPivot * drawH) / SIZE;

    const canvas = spec.texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = false;

    if (!def.active) {
      spec.texture.needsUpdate = true;
      continue;
    }

    ctx.save();
    tracePoly(ctx, def.poly, left, top, drawW, drawH);
    ctx.clip();
    ctx.drawImage(img, left, top, drawW, drawH);
    ctx.restore();

    if (partName === 'torso') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      for (const cutName of RIG_PART_ORDER) {
        if (cutName === 'torso') continue;
        const cutDef = layout[cutName];
        if (!cutDef.active || !cutDef.torsoCut) continue;
        tracePoly(ctx, cutDef.torsoCut, left, top, drawW, drawH);
        ctx.fill();
      }
      ctx.restore();
    }

    spec.texture.needsUpdate = true;
  }
}

function createInitialRigParts(tier: MilestoneTier): TierRigParts {
  const form = getEvolutionForm(tier);
  const layout = getFormPartLayout(form);
  const parts = {} as TierRigParts;

  for (const partName of RIG_PART_ORDER) {
    const def = layout[partName];
    const [canvas] = makeCanvas();
    if (partName === 'torso') {
      paintProceduralFallback(canvas, form, 7, 0);
    }
    parts[partName] = {
      texture: toTex(canvas),
      active: def.active,
      uPivot: def.uPivot,
      vPivot: def.vPivot,
      layerZ: def.layerZ,
    };
  }

  const loaded = loadedCodexImages[tier];
  if (loaded) {
    bakeRigPartsFromImage(loaded, tier, parts);
  }
  return parts;
}

/**
 * Bakes an official extracted Codex sprite PNG onto a 160x160 CanvasTexture canvas,
 * preserving crisp pixel outlines, bottom-center grounding, 8-way orientation,
 * and 2-frame swim/stride pixel motion (used for portraits & fallback).
 */
function bakeCodexSpriteToCanvas(
  img: HTMLImageElement,
  tier: MilestoneTier,
  facing: FacingIndex,
  frame: number,
  canvas: HTMLCanvasElement
) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingEnabled = false;

  const flipX = facing === 1 || facing === 2 || facing === 3;
  const isNorth = facing === 3 || facing === 4 || facing === 5;
  const isPureVertical = facing === 0 || facing === 4;

  const maxDim = Math.max(img.width, img.height);
  const fitScale = (SIZE - 14) / maxDim;
  const drawW = Math.round(img.width * fitScale);
  const drawH = Math.round(img.height * fitScale);

  const isBiped = tier >= 80;
  const horizSquash = isPureVertical ? 0.91 : 1.0;
  const vertScale = isNorth ? 0.95 : frame === 1 && isBiped ? 0.97 : 1.0;
  const bobY = frame === 1 ? (isBiped ? 2 : -2) : 0;

  ctx.save();
  ctx.translate(SIZE * 0.5, SIZE - 5 + bobY);
  ctx.scale((flipX ? -1 : 1) * horizSquash, vertScale);

  if (isNorth) {
    ctx.filter = 'brightness(0.84) contrast(1.06)';
  }

  if (!isBiped && frame === 1) {
    const splitSrc = Math.round(img.width * 0.42);
    const splitDst = Math.round(drawW * 0.42);
    const leftX = -drawW * 0.5;
    const topY = -drawH;

    ctx.drawImage(
      img,
      0,
      0,
      splitSrc,
      img.height,
      leftX - 1,
      topY - 2.5,
      splitDst,
      drawH
    );
    ctx.drawImage(
      img,
      splitSrc,
      0,
      img.width - splitSrc,
      img.height,
      leftX + splitDst,
      topY + 0.5,
      drawW - splitDst,
      drawH
    );
  } else {
    ctx.drawImage(img, -drawW * 0.5, -drawH, drawW, drawH);
  }

  ctx.restore();
}

function renderCarcassCanvas(): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas();
  const cx = SIZE * 0.5;
  const cy = SIZE * 0.62;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.fillStyle = '#444e59';
  ctx.strokeStyle = '#101218';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(cx - 32, cy + 4);
  ctx.lineTo(cx - 56, cy - 12);
  ctx.lineTo(cx - 50, cy + 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#626d7a';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 40, 21, -0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ddd0bc';
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy - 2, 26, 12, -0.14, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#8b7e6b';
  ctx.lineWidth = 2.4;
  for (let r = -2; r <= 2; r++) {
    ctx.beginPath();
    ctx.moveTo(cx + r * 8 - 3, cy - 11);
    ctx.quadraticCurveTo(cx + r * 8 + 2, cy - 1, cx + r * 8 - 2, cy + 8);
    ctx.stroke();
  }

  ctx.fillStyle = '#4ade80';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(cx - 16 + i * 7.5, cy + (i % 2 === 0 ? -5 : 5), 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return canvas;
}

let cachedSpriteSet: SpriteSet | null = null;
let cachedCarcassTex: THREE.CanvasTexture | null = null;

function ensurePortraitPreload() {
  if (preloadStarted || typeof Image === 'undefined') return;
  preloadStarted = true;

  MILESTONE_TIERS.forEach((tier) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      loadedCodexImages[tier] = img;
      if (cachedSpriteSet) {
        const facingArr = cachedSpriteSet.tiers[tier];
        for (let f = 0; f < 8; f++) {
          for (let fr = 0; fr < 2; fr++) {
            const tex = facingArr[f][fr];
            const canvas = tex.image as HTMLCanvasElement;
            bakeCodexSpriteToCanvas(img, tier, f as FacingIndex, fr, canvas);
            tex.needsUpdate = true;
          }
        }
        bakeRigPartsFromImage(img, tier, cachedSpriteSet.rigParts[tier]);
        cachedSpriteSet.rigRevision += 1;
      }
      portraitListeners.forEach((cb) => cb());
    };
    img.src = CODEX_SPRITE_PATHS[tier];
  });
}

/**
 * Returns the shared carcass texture without allocating legacy multi-plate rig textures.
 */
export function getCarcassTexture(): THREE.CanvasTexture {
  if (!cachedCarcassTex) {
    cachedCarcassTex = toTex(renderCarcassCanvas());
  }
  return cachedCarcassTex;
}

export function getSpriteSet(): SpriteSet {
  if (cachedSpriteSet) return cachedSpriteSet;

  const tiers = {} as Record<MilestoneTier, THREE.CanvasTexture[][]>;
  const rigParts = {} as Record<MilestoneTier, TierRigParts>;

  MILESTONE_TIERS.forEach((tier) => {
    const form = getEvolutionForm(tier);
    const facingArr: THREE.CanvasTexture[][] = [];
    for (let f = 0; f < 8; f++) {
      const frames: THREE.CanvasTexture[] = [];
      for (let fr = 0; fr < 2; fr++) {
        const [canvas] = makeCanvas();
        const loaded = loadedCodexImages[tier];
        if (loaded) {
          bakeCodexSpriteToCanvas(loaded, tier, f as FacingIndex, fr, canvas);
        } else {
          paintProceduralFallback(canvas, form, f as FacingIndex, fr);
        }
        frames.push(toTex(canvas));
      }
      facingArr.push(frames);
    }
    tiers[tier] = facingArr;
    rigParts[tier] = createInitialRigParts(tier);
  });

  cachedSpriteSet = {
    tiers,
    rigParts,
    rigRevision: 0,
    carcass: getCarcassTexture(),
  };
  ensurePortraitPreload();
  return cachedSpriteSet;
}

export function subscribeCodexSpritesLoaded(cb: () => void): () => void {
  ensurePortraitPreload();
  portraitListeners.add(cb);
  return () => portraitListeners.delete(cb);
}

/**
 * Draws the current milestone Codex sprite portrait into the top-left circular HUD medallion.
 */
export function drawPortraitToCanvas(level: number, canvas: HTMLCanvasElement) {
  ensurePortraitPreload();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createRadialGradient(w * 0.5, h * 0.42, 4, w * 0.5, h * 0.5, w * 0.55);
  bg.addColorStop(0, '#2a4147');
  bg.addColorStop(1, '#10191f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const tier = getMilestoneTier(level);
  const loaded = loadedCodexImages[tier];
  ctx.imageSmoothingEnabled = false;

  if (loaded) {
    const isBiped = tier >= 80;
    const scale = isBiped
      ? Math.max((w * 1.15) / loaded.width, (h * 1.15) / loaded.height)
      : (w * 0.96) / loaded.width;
    const dw = loaded.width * scale;
    const dh = loaded.height * scale;
    const dx = isBiped ? w * 0.5 - dw * 0.54 : w * 0.5 - dw * 0.52;
    const dy = isBiped ? h * 0.06 : h * 0.52 - dh * 0.55;
    ctx.drawImage(loaded, dx, dy, dw, dh);
  } else {
    const [fallbackCanvas] = makeCanvas();
    paintProceduralFallback(fallbackCanvas, getEvolutionForm(tier), 7, 0);
    ctx.drawImage(fallbackCanvas, -w * 0.12, -h * 0.04, w * 1.24, h * 1.24);
  }
}

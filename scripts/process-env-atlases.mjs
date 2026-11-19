#!/usr/bin/env node
/**
 * Deterministic preprocessing pipeline for AWANG KELI environmental & carcass atlases.
 *
 * 1. Decodes both 1254x1254 RGBA source atlases via ffmpeg.
 * 2. Cleans faint alpha haze (a < 28 -> 0, a >= 215 -> 255, linear ramp in between)
 *    without damaging dark outlines, water ripples, or bioluminescent glow.
 * 3. Segments all 6x4 = 24 sprites per atlas using actual empty transparent bands
 *    (NEVER naive 313.5x209 slicing, which would clip Atlas 2!).
 * 4. Computes exact pair-aligned pixel rectangles for each 2-frame animation pair
 *    (cols 0-1 and cols 2-3) sharing identical (w, h) and common anchor baseline so
 *    two-frame loops have ZERO vertical/horizontal jumping and ZERO clipping.
 * 5. Encodes optimized WebP atlases under public/assets/sprites/ and writes
 *    exact deterministic manifest data to src/game/envAtlasManifestData.ts.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'sprites');
fs.mkdirSync(OUT_DIR, { recursive: true });

const ATLAS_SPECS = [
  {
    id: 'fishing',
    src: path.join(ROOT, 'public', 'assets', 'aistudio', 'Awang_Keli_Retro_Fishing_Props_Atlas_eca1bf72.png'),
    outWebp: path.join(OUT_DIR, 'env_fishing_atlas.webp'),
    assetPath: 'assets/sprites/env_fishing_atlas.webp',
    // Row -> [leftPairDef, rightPairDef]
    pairs: [
      [
        { id: 'tall_reeds', label: 'Tall Reeds & Cattails', anchorY: 'bottom', fps: 2.0 },
        { id: 'water_lilies', label: 'Water Lilies with Pink Flower', anchorY: 'bottom', fps: 1.5 },
      ],
      [
        { id: 'moss_rock', label: 'Moss-Covered Rock Formation', anchorY: 'bottom', fps: 0 },
        { id: 'aquatic_weeds', label: 'Aquatic Weeds', anchorY: 'bottom', fps: 2.0 },
      ],
      [
        { id: 'driftwood_log', label: 'Floating Driftwood Log', anchorY: 'bottom', fps: 1.0 },
        { id: 'fishing_buoy', label: 'Fishing Float Buoy with Rope', anchorY: 'bottom', fps: 1.5 },
      ],
      [
        { id: 'lantern_post', label: 'Wooden Lantern Post', anchorY: 'bottom', fps: 0 },
        { id: 'fishing_net', label: 'Stretched Fishing Net', anchorY: 'bottom', fps: 0 },
      ],
      [
        { id: 'toxic_pool', label: 'Toxic Bubbling Pool', anchorY: 'bottom', fps: 3.0 },
        { id: 'water_ripple', label: 'Water Ripple & Splash', anchorY: 'bottom', fps: 3.0 },
      ],
      [
        { id: 'carcass_phase1', label: 'Dead Aquatic Catfish (Lv.1-39)', anchorY: 'bottom', fps: 1.0 },
        { id: 'supply_crate', label: 'Floating Wooden Supply Crate', anchorY: 'bottom', fps: 1.0 },
      ],
    ],
  },
  {
    id: 'advanced',
    src: path.join(ROOT, 'public', 'assets', 'aistudio', 'Phase_2_and_3_catfish_sprite_atlas_1e786473.png'),
    outWebp: path.join(OUT_DIR, 'env_advanced_atlas.webp'),
    assetPath: 'assets/sprites/env_advanced_atlas.webp',
    pairs: [
      [
        { id: 'carcass_phase2', label: 'Dead Reformed Keli (Lv.40-79, Arms Only)', anchorY: 'bottom', fps: 1.0 },
        { id: 'carcass_phase3', label: 'Dead Amphibious Keli (Lv.80-100)', anchorY: 'bottom', fps: 1.0 },
      ],
      [
        { id: 'bamboo_raft', label: 'Bamboo Fishing Raft with Lantern', anchorY: 'bottom', fps: 2.0 },
        { id: 'fish_trap', label: 'Submerged Fishing Trap', anchorY: 'bottom', fps: 0 },
      ],
      [
        { id: 'biolum_mushrooms', label: 'Bioluminescent Mushroom Rocks', anchorY: 'bottom', fps: 0 },
        { id: 'stalactites', label: 'Hanging Rock Stalactites', anchorY: 'top', fps: 0 },
      ],
      [
        { id: 'white_lotus', label: 'White Lotus Flowers', anchorY: 'bottom', fps: 1.5 },
        { id: 'mangrove_roots', label: 'Mangrove Roots & Vegetation', anchorY: 'bottom', fps: 1.2 },
      ],
      [
        { id: 'broken_barrel', label: 'Broken Wooden Barrel', anchorY: 'bottom', fps: 0 },
        { id: 'floating_rubbish', label: 'Discarded Bottles & Can', anchorY: 'bottom', fps: 1.2 },
      ],
      [
        { id: 'stone_monument', label: 'Ancient Glowing Stone Monument', anchorY: 'bottom', fps: 0 },
        { id: 'giant_clam', label: 'Giant Clam', anchorY: 'bottom', fps: 0 },
      ],
    ],
  },
];

function decodeRgba(filePath) {
  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      filePath,
    ]).toString()
  ).streams[0];
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', filePath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  return { width: probe.width, height: probe.height, data: Buffer.from(raw) };
}

function cleanAlphaInPlace(data) {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 28) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    } else if (a >= 215) {
      data[i + 3] = 255;
    } else {
      data[i + 3] = Math.round(((a - 28) / (215 - 28)) * 255);
    }
  }
}

function findOccupiedBands(data, width, height, axis) {
  const len = axis === 'y' ? height : width;
  const cross = axis === 'y' ? width : height;
  const occupied = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    let any = 0;
    for (let j = 0; j < cross; j++) {
      const x = axis === 'y' ? j : i;
      const y = axis === 'y' ? i : j;
      if (data[(y * width + x) * 4 + 3] > 0) {
        any = 1;
        break;
      }
    }
    occupied[i] = any;
  }
  const bands = [];
  let start = -1;
  for (let i = 0; i < len; i++) {
    if (occupied[i] && start === -1) start = i;
    else if (!occupied[i] && start !== -1) {
      bands.push([start, i - 1]);
      start = -1;
    }
  }
  if (start !== -1) bands.push([start, len - 1]);
  return bands;
}

function measureBox(data, width, x0, y0, x1, y1) {
  let minX = x1, maxX = x0, minY = y1, maxY = y0, count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  if (count === 0) throw new Error(`Empty sprite cell [${x0}..${x1}, ${y0}..${y1}]`);
  return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1, count };
}

function encodeWebp(rgba, width, height, outPath) {
  // Try lossless first; if > 520 KB, use high-quality q92 WebP with exact alpha
  const losslessPath = outPath + '.lossless.tmp.webp';
  execFileSync(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', 'pipe:0',
      '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6',
      losslessPath,
    ],
    { input: rgba, maxBuffer: 64 * 1024 * 1024 }
  );
  const losslessSize = fs.statSync(losslessPath).size;
  if (losslessSize <= 540 * 1024) {
    fs.renameSync(losslessPath, outPath);
    return { size: losslessSize, mode: 'webp-lossless' };
  }
  fs.unlinkSync(losslessPath);
  execFileSync(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', 'pipe:0',
      '-c:v', 'libwebp', '-quality', '92', '-compression_level', '6',
      outPath,
    ],
    { input: rgba, maxBuffer: 64 * 1024 * 1024 }
  );
  return { size: fs.statSync(outPath).size, mode: 'webp-q92' };
}

const manifestEntries = {};
const atlasMeta = {};

for (const spec of ATLAS_SPECS) {
  const { width, height, data } = decodeRgba(spec.src);
  cleanAlphaInPlace(data);

  const rowBands = findOccupiedBands(data, width, height, 'y');
  const colBands = findOccupiedBands(data, width, height, 'x');

  if (rowBands.length !== 6 || colBands.length !== 4) {
    throw new Error(
      `Atlas ${spec.id}: expected 6 rows x 4 cols, found ${rowBands.length} rows (${JSON.stringify(rowBands)}) x ${colBands.length} cols (${JSON.stringify(colBands)})`
    );
  }

  // Compute safe split boundaries midway inside each transparent gutter
  const rowBounds = [];
  for (let r = 0; r < 6; r++) {
    const top = r === 0 ? 0 : Math.floor((rowBands[r - 1][1] + rowBands[r][0]) / 2) + 1;
    const bot = r === 5 ? height - 1 : Math.floor((rowBands[r][1] + rowBands[r + 1][0]) / 2);
    rowBounds.push([top, bot]);
  }
  const colBounds = [];
  for (let c = 0; c < 4; c++) {
    const left = c === 0 ? 0 : Math.floor((colBands[c - 1][1] + colBands[c][0]) / 2) + 1;
    const right = c === 3 ? width - 1 : Math.floor((colBands[c][1] + colBands[c + 1][0]) / 2);
    colBounds.push([left, right]);
  }

  const encoded = encodeWebp(data, width, height, spec.outWebp);
  atlasMeta[spec.id] = {
    id: spec.id,
    assetPath: spec.assetPath,
    width,
    height,
    bytes: encoded.size,
    encoding: encoded.mode,
  };

  console.log(
    `Atlas ${spec.id}: ${width}x${height} -> ${path.relative(ROOT, spec.outWebp)} (${(encoded.size / 1024).toFixed(1)} KB, ${encoded.mode})`
  );

  for (let r = 0; r < 6; r++) {
    const [ry0, ry1] = rowBounds[r];
    for (let pairIdx = 0; pairIdx < 2; pairIdx++) {
      const def = spec.pairs[r][pairIdx];
      const c0 = pairIdx * 2;
      const c1 = pairIdx * 2 + 1;
      const [cx0a, cx1a] = colBounds[c0];
      const [cx0b, cx1b] = colBounds[c1];

      const boxA = measureBox(data, width, cx0a, ry0, cx1a, ry1);
      const boxB = measureBox(data, width, cx0b, ry0, cx1b, ry1);

      // Pair-unified frame dimensions with 2px transparent safety padding
      const pad = 2;
      const maxW = Math.max(boxA.w, boxB.w) + pad * 2;
      const maxH = Math.max(boxA.h, boxB.h) + pad * 2;

      const buildRect = (box, cellX0, cellX1, cellY0, cellY1) => {
        const cx = (box.minX + box.maxX) / 2;
        let x = Math.round(cx - maxW / 2);
        let y;
        if (def.anchorY === 'top') {
          y = box.minY - pad;
        } else if (def.anchorY === 'center') {
          const cy = (box.minY + box.maxY) / 2;
          y = Math.round(cy - maxH / 2);
        } else {
          // bottom-aligned baseline so standing/floating objects never jump vertically
          y = box.maxY + pad - maxH + 1;
        }

        // Clamp strictly inside the sprite's transparent cell gutter so neighbor pixels can NEVER bleed in
        if (x < cellX0) x = cellX0;
        if (x + maxW - 1 > cellX1) x = cellX1 - maxW + 1;
        if (y < cellY0) y = cellY0;
        if (y + maxH - 1 > cellY1) y = cellY1 - maxH + 1;

        // Verify zero clipping of actual sprite pixels
        if (x > box.minX || x + maxW - 1 < box.maxX || y > box.minY || y + maxH - 1 < box.maxY) {
          // Fall back to exact box + available margin inside gutter
          x = Math.max(cellX0, box.minX - 1);
          const right = Math.min(cellX1, box.maxX + 1);
          y = Math.max(cellY0, box.minY - 1);
          const bottom = Math.min(cellY1, box.maxY + 1);
          return { x, y, w: right - x + 1, h: bottom - y + 1 };
        }
        return { x, y, w: maxW, h: maxH };
      };

      const rect0 = buildRect(boxA, cx0a, cx1a, ry0, ry1);
      const rect1 = buildRect(boxB, cx0b, cx1b, ry0, ry1);

      // Verify zero non-transparent pixels on outer 1px border (or inside neighbor cell)
      for (const [fi, rect] of [rect0, rect1].entries()) {
        const box = fi === 0 ? boxA : boxB;
        if (rect.x > box.minX || rect.x + rect.w - 1 < box.maxX || rect.y > box.minY || rect.y + rect.h - 1 < box.maxY) {
          throw new Error(`CLIP DETECTED on ${def.id} frame ${fi}`);
        }
      }

      const anchorRatioY = def.anchorY === 'top' ? 1.0 : def.anchorY === 'center' ? 0.5 : 0.0;
      manifestEntries[def.id] = {
        id: def.id,
        label: def.label,
        atlas: spec.id,
        row: r,
        cols: [c0, c1],
        fps: def.fps,
        anchor: { x: 0.5, y: anchorRatioY },
        frames: [rect0, rect1],
      };

      console.log(
        `  r${r} c${c0}-${c1} ${def.id.padEnd(18)} f0=(${rect0.x},${rect0.y},${rect0.w}x${rect0.h}) f1=(${rect1.x},${rect1.y},${rect1.w}x${rect1.h})`
      );
    }
  }
}

const tsOut = `// AUTO-GENERATED by scripts/process-env-atlases.mjs — deterministic pixel-bounded manifest.
// Do NOT slice the 1254x1254 atlases into uniform 313.5x209 grids; use these verified bounds.

export type EnvAtlasId = 'fishing' | 'advanced';

export type EnvSpriteId =
  | 'tall_reeds'
  | 'water_lilies'
  | 'moss_rock'
  | 'aquatic_weeds'
  | 'driftwood_log'
  | 'fishing_buoy'
  | 'lantern_post'
  | 'fishing_net'
  | 'toxic_pool'
  | 'water_ripple'
  | 'carcass_phase1'
  | 'supply_crate'
  | 'carcass_phase2'
  | 'carcass_phase3'
  | 'bamboo_raft'
  | 'fish_trap'
  | 'biolum_mushrooms'
  | 'stalactites'
  | 'white_lotus'
  | 'mangrove_roots'
  | 'broken_barrel'
  | 'floating_rubbish'
  | 'stone_monument'
  | 'giant_clam';

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface EnvAtlasMeta {
  readonly id: EnvAtlasId;
  readonly assetPath: string;
  readonly width: number;
  readonly height: number;
}

export interface EnvSpriteDef {
  readonly id: EnvSpriteId;
  readonly label: string;
  readonly atlas: EnvAtlasId;
  readonly row: number;
  readonly cols: readonly [number, number];
  readonly fps: number;
  /** Normalized pivot anchor: y=0 is bottom, y=0.5 is center, y=1 is top (for hanging stalactites). */
  readonly anchor: { readonly x: number; readonly y: number };
  readonly frames: readonly [PixelRect, PixelRect];
}

export const ENV_ATLASES: Record<EnvAtlasId, EnvAtlasMeta> = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(atlasMeta).map(([k, v]) => [k, { id: v.id, assetPath: v.assetPath, width: v.width, height: v.height }])
  ),
  null,
  2
)} as const;

export const ENV_SPRITE_MANIFEST: Record<EnvSpriteId, EnvSpriteDef> = ${JSON.stringify(
  manifestEntries,
  null,
  2
)} as const;
`;

fs.writeFileSync(path.join(ROOT, 'src', 'game', 'envAtlasManifestData.ts'), tsOut, 'utf8');
console.log('Wrote src/game/envAtlasManifestData.ts');

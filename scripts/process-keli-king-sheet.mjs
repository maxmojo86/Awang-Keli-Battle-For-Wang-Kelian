#!/usr/bin/env node
/**
 * Deterministic sprite extraction & alignment pipeline for the Lv.100 Keli King sheet.
 *
 * Source: public/assets/aistudio/Keli_King_Idle_and_Victory_Sprite_Sheet_adf2a2ce.png
 *   - 2172 x 724 RGBA, 6 columns x 2 rows = 12 frames
 *   - Row 0: Regal Idle (frames 0-5)
 *   - Row 1: Keli King Victory (frames 0-5, frame 4 = wide-open-mouth roar)
 *
 * Pipeline:
 *   1. Decodes source RGBA via ffmpeg.
 *   2. Cleans faint background alpha haze (a < 28 -> 0, a >= 205 -> 255) while
 *      preserving 100% of dark outlines, glossy black eyes, whiskers, tail, and gold armor.
 *   3. Extracts each of the 12 frames by its true non-empty pixel bounds (zero clipping).
 *   4. Aligns every frame to a shared foot/ground contact baseline (bottomY) and
 *      consistent lower-body/foot horizontal center so frame-to-frame animation and
 *      Victory -> Regal Idle transitions have ZERO jumping.
 *   5. Packs into a crisp 6x2 WebP atlas (2160 x 712, 360 x 356 per cell) with clean
 *      transparent padding on all 4 edges of every cell.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(
  ROOT,
  'public',
  'assets',
  'aistudio',
  'Keli_King_Idle_and_Victory_Sprite_Sheet_adf2a2ce.png'
);
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'sprites');
const OUT_WEBP = path.join(OUT_DIR, 'keli_king_sheet.webp');
fs.mkdirSync(OUT_DIR, { recursive: true });

const COLS = 6;
const ROWS = 2;
const CELL_W = 368;
const CELL_H = 356;
const GROUND_PAD_BOTTOM = 10;

function probeDimensions(filePath) {
  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      filePath,
    ]).toString('utf8')
  );
  return { width: probe.streams[0].width, height: probe.streams[0].height };
}

function decodeRgba(filePath) {
  return execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', filePath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 64 * 1024 * 1024 }
  );
}

function cleanAlpha(a) {
  if (a < 28) return 0;
  if (a >= 205) return 255;
  return Math.round(((a - 28) / (205 - 28)) * 255);
}

function findNonEmptyBands(counts) {
  const bands = [];
  let inBand = false;
  let start = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0 && !inBand) {
      inBand = true;
      start = i;
    } else if (counts[i] === 0 && inBand) {
      inBand = false;
      bands.push([start, i - 1]);
    }
  }
  if (inBand) bands.push([start, counts.length - 1]);
  return bands;
}

const { width: SRC_W, height: SRC_H } = probeDimensions(SRC);
const raw = decodeRgba(SRC);

// Clean alpha across a working copy
const cleaned = Buffer.from(raw);
for (let i = 0; i < SRC_W * SRC_H; i++) {
  const idx = i * 4;
  const a = cleanAlpha(cleaned[idx + 3]);
  cleaned[idx + 3] = a;
  if (a === 0) {
    cleaned[idx] = 0;
    cleaned[idx + 1] = 0;
    cleaned[idx + 2] = 0;
  }
}

// Detect exact row bands
const rowCounts = new Int32Array(SRC_H);
for (let y = 0; y < SRC_H; y++) {
  let c = 0;
  for (let x = 0; x < SRC_W; x++) {
    if (cleaned[(y * SRC_W + x) * 4 + 3] > 0) c++;
  }
  rowCounts[y] = c;
}
const rowBands = findNonEmptyBands(rowCounts);
if (rowBands.length !== ROWS) {
  throw new Error(`Expected ${ROWS} row bands, found ${rowBands.length}: ${JSON.stringify(rowBands)}`);
}

const atlasW = CELL_W * COLS;
const atlasH = CELL_H * ROWS;
const outBuf = Buffer.alloc(atlasW * atlasH * 4, 0);

const frameReports = [];

for (let r = 0; r < ROWS; r++) {
  const [ry0, ry1] = rowBands[r];
  const colCounts = new Int32Array(SRC_W);
  for (let x = 0; x < SRC_W; x++) {
    let c = 0;
    for (let y = ry0; y <= ry1; y++) {
      if (cleaned[(y * SRC_W + x) * 4 + 3] > 0) c++;
    }
    colCounts[x] = c;
  }
  const colBands = findNonEmptyBands(colCounts);
  if (colBands.length !== COLS) {
    throw new Error(
      `Row ${r}: expected ${COLS} column bands, found ${colBands.length}: ${JSON.stringify(colBands)}`
    );
  }

  for (let c = 0; c < COLS; c++) {
    const [cx0, cx1] = colBands[c];

    // Tight vertical bounds within this exact frame column band
    let minY = ry1;
    let maxY = ry0;
    let minX = cx1;
    let maxX = cx0;
    let footSumX = 0;
    let footWeight = 0;

    for (let y = ry0; y <= ry1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        const a = cleaned[(y * SRC_W + x) * 4 + 3];
        if (a > 0) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }

    // Compute stance anchor X from lower 26% (feet & legs) so raised fists/whiskers
    // do not shift the character's stance center left/right between frames!
    const h = maxY - minY + 1;
    const w = maxX - minX + 1;
    const footBandStart = maxY - Math.floor(h * 0.26);
    for (let y = footBandStart; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const a = cleaned[(y * SRC_W + x) * 4 + 3];
        if (a >= 180) {
          footSumX += x;
          footWeight += 1;
        }
      }
    }
    const footAnchorX = footWeight > 0 ? footSumX / footWeight : (minX + maxX) * 0.5;
    const relFootAnchorX = footAnchorX - minX;

    // Place inside cell with consistent foot baseline and stance center (zero edge clamping)
    const targetFootX = Math.round(CELL_W * 0.48);
    let dstOffX = Math.round(targetFootX - relFootAnchorX);
    const minMarginX = 4;
    if (dstOffX < minMarginX) dstOffX = minMarginX;
    if (dstOffX + w > CELL_W - minMarginX) dstOffX = CELL_W - minMarginX - w;

    let dstOffY = CELL_H - GROUND_PAD_BOTTOM - h;
    const minMarginY = 4;
    if (dstOffY < minMarginY) dstOffY = minMarginY;

    const cellOriginX = c * CELL_W;
    const cellOriginY = r * CELL_H;

    for (let sy = minY; sy <= maxY; sy++) {
      const dy = cellOriginY + dstOffY + (sy - minY);
      for (let sx = minX; sx <= maxX; sx++) {
        const sIdx = (sy * SRC_W + sx) * 4;
        const a = cleaned[sIdx + 3];
        if (a === 0) continue;
        const dx = cellOriginX + dstOffX + (sx - minX);
        const dIdx = (dy * atlasW + dx) * 4;
        outBuf[dIdx] = cleaned[sIdx];
        outBuf[dIdx + 1] = cleaned[sIdx + 1];
        outBuf[dIdx + 2] = cleaned[sIdx + 2];
        outBuf[dIdx + 3] = a;
      }
    }

    frameReports.push({
      row: r,
      col: c,
      srcRect: { x: minX, y: minY, w, h },
      dstOffset: { x: dstOffX, y: dstOffY },
      margins: {
        left: dstOffX,
        right: CELL_W - (dstOffX + w),
        top: dstOffY,
        bottom: CELL_H - (dstOffY + h),
      },
    });
  }
}

// Encode crisp high-quality WebP atlas
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-v',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${atlasW}x${atlasH}`,
    '-i',
    '-',
    '-c:v',
    'libwebp',
    '-quality',
    '90',
    '-compression_level',
    '6',
    OUT_WEBP,
  ],
  { input: outBuf, maxBuffer: 64 * 1024 * 1024 }
);

const stat = fs.statSync(OUT_WEBP);
console.log(
  `Generated ${path.relative(ROOT, OUT_WEBP)} (${atlasW}x${atlasH}, cell=${CELL_W}x${CELL_H}, ${(
    stat.size / 1024
  ).toFixed(1)} KB)`
);
for (const fr of frameReports) {
  console.log(
    `  r${fr.row}c${fr.col}: src=${fr.srcRect.w}x${fr.srcRect.h} @ (${fr.srcRect.x},${fr.srcRect.y}) -> margins L=${fr.margins.left} R=${fr.margins.right} T=${fr.margins.top} B=${fr.margins.bottom}`
  );
}

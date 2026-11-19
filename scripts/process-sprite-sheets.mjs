import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC_W = 1536;
const SRC_H = 1024;
const COLS = 6;
const ROWS = 4;

const PHASES = [
  {
    id: 1,
    src: 'public/assets/aistudio/awang_keli_phase1.png_e5238957.png',
    outWebp: 'public/assets/sprites/awang_keli_phase1.webp',
    outPngPreview: '/tmp/awang_keli_phase1_preview.png',
    rowBands: [
      [100, 235],
      [325, 465],
      [580, 730],
      [855, 995],
    ],
    cellW: 248,
    cellH: 164,
    groundPadBottom: 14,
  },
  {
    id: 2,
    src: 'public/assets/aistudio/awang_keli_phase2.png_a021e2c3.png',
    outWebp: 'public/assets/sprites/awang_keli_phase2.webp',
    outPngPreview: '/tmp/awang_keli_phase2_preview.png',
    rowBands: [
      [75, 260],
      [320, 495],
      [535, 735],
      [795, 975],
    ],
    cellW: 280,
    cellH: 204,
    groundPadBottom: 10,
  },
  {
    id: 3,
    src: 'public/assets/aistudio/awang_keli_phase3.png_24f06a17.png',
    outWebp: 'public/assets/sprites/awang_keli_phase3.webp',
    outPngPreview: '/tmp/awang_keli_phase3_preview.png',
    rowBands: [
      [10, 250],
      [258, 505],
      [522, 760],
      [770, 1015],
    ],
    cellW: 280,
    cellH: 252,
    groundPadBottom: 10,
  },
];

function decodeRgba(filePath) {
  return execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', filePath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 64 * 1024 * 1024 }
  );
}

/**
 * Cleans background haze (alpha < 28 -> 0) and solidifies sprite interiors/outlines/eyes
 * (alpha >= 205 -> 255) without ever removing dark outlines or glossy black eyes.
 */
function cleanAlpha(a) {
  if (a < 28) return 0;
  if (a >= 205) return 255;
  return Math.round(((a - 28) / (205 - 28)) * 255);
}

function processPhase(cfg) {
  const raw = decodeRgba(cfg.src);
  const atlasW = cfg.cellW * COLS;
  const atlasH = cfg.cellH * ROWS;
  const outBuf = Buffer.alloc(atlasW * atlasH * 4, 0);

  const reportFrames = [];

  for (let r = 0; r < ROWS; r++) {
    const [y0, y1] = cfg.rowBands[r];
    const bandH = y1 - y0 + 1;
    const compId = new Int32Array(SRC_W * bandH).fill(-1);
    const comps = [];
    const qx = new Int32Array(SRC_W * bandH);
    const qy = new Int32Array(SRC_W * bandH);

    // 1. Extract 2D connected components at alpha >= 36
    for (let y = 0; y < bandH; y++) {
      for (let x = 0; x < SRC_W; x++) {
        const p = y * SRC_W + x;
        if (compId[p] !== -1) continue;
        const a = raw[((y0 + y) * SRC_W + x) * 4 + 3];
        if (a < 36) continue;

        const cid = comps.length;
        let head = 0;
        let tail = 0;
        qx[tail] = x;
        qy[tail] = y;
        tail++;
        compId[p] = cid;

        let minX = x;
        let maxX = x;
        let minY = y0 + y;
        let maxY = y0 + y;
        let count = 0;
        let coreSumX = 0;
        let coreCount = 0;
        const pixels = [];

        while (head < tail) {
          const cx = qx[head];
          const cy = qy[head];
          head++;
          const wy = y0 + cy;
          const idx = (wy * SRC_W + cx) * 4;
          const pa = raw[idx + 3];
          pixels.push(cx, wy);
          count++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (wy < minY) minY = wy;
          if (wy > maxY) maxY = wy;
          if (pa >= 180) {
            coreSumX += cx;
            coreCount++;
          }

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || nx >= SRC_W || ny < 0 || ny >= bandH) continue;
              const np = ny * SRC_W + nx;
              if (compId[np] !== -1) continue;
              if (raw[((y0 + ny) * SRC_W + nx) * 4 + 3] >= 36) {
                compId[np] = cid;
                qx[tail] = nx;
                qy[tail] = ny;
                tail++;
              }
            }
          }
        }

        comps.push({
          cid,
          count,
          minX,
          maxX,
          minY,
          maxY,
          coreCentroidX: coreCount > 0 ? coreSumX / coreCount : (minX + maxX) * 0.5,
          pixels,
        });
      }
    }

    // 2. Identify the 6 primary sprite bodies sorted left-to-right
    const primaries = comps
      .filter((c) => c.count >= 5000)
      .sort((a, b) => a.coreCentroidX - b.coreCentroidX);
    if (primaries.length !== COLS) {
      throw new Error(
        `Phase ${cfg.id} row ${r}: expected ${COLS} primary bodies, found ${primaries.length}`
      );
    }

    // Map each primary to column 0..5, and attach nearby satellite components
    // (whisker tips, grounded front paw, detached shadows) to their closest primary body
    const frameGroups = primaries.map((prim) => ({
      coreCentroidX: prim.coreCentroidX,
      minX: prim.minX,
      maxX: prim.maxX,
      minY: prim.minY,
      maxY: prim.maxY,
      pixels: [...prim.pixels],
    }));

    const primaryIds = new Set(primaries.map((p) => p.cid));
    for (const c of comps) {
      if (primaryIds.has(c.cid) || c.count < 6) continue;
      // Find closest primary bbox
      const cx = (c.minX + c.maxX) * 0.5;
      const cy = (c.minY + c.maxY) * 0.5;
      let bestCol = -1;
      let bestDist = Infinity;
      for (let col = 0; col < COLS; col++) {
        const g = frameGroups[col];
        const dx = cx < g.minX ? g.minX - cx : cx > g.maxX ? cx - g.maxX : 0;
        const dy = cy < g.minY ? g.minY - cy : cy > g.maxY ? cy - g.maxY : 0;
        const d = Math.hypot(dx, dy);
        if (d < bestDist) {
          bestDist = d;
          bestCol = col;
        }
      }
      if (bestCol !== -1 && bestDist <= 38) {
        const g = frameGroups[bestCol];
        for (let i = 0; i < c.pixels.length; i++) g.pixels.push(c.pixels[i]);
        if (c.minX < g.minX) g.minX = c.minX;
        if (c.maxX > g.maxX) g.maxX = c.maxX;
        if (c.minY < g.minY) g.minY = c.minY;
        if (c.maxY > g.maxY) g.maxY = c.maxY;
      }
    }

    // 3. Establish consistent row ground baseline so row transitions have 0px vertical jump
    //    while preserving natural intra-row swim/stride/lunge arcs.
    const rowGroundY =
      cfg.id === 1
        ? Math.max(frameGroups[0].maxY, frameGroups[5].maxY)
        : Math.max(...frameGroups.map((g) => g.maxY));

    const targetGroundY = cfg.cellH - 1 - cfg.groundPadBottom;

    // 4. Blit each frame into its uniform (cellW, cellH) slot with 1px soft-edge halo retention
    for (let col = 0; col < COLS; col++) {
      const g = frameGroups[col];
      // Horizontal alignment: align body core centroid to cell center, clamped to prevent clipping
      let shiftX = Math.round(cfg.cellW * 0.5 - g.coreCentroidX);
      const minAllowedShiftX = 4 - g.minX;
      const maxAllowedShiftX = cfg.cellW - 5 - g.maxX;
      if (minAllowedShiftX > maxAllowedShiftX) {
        throw new Error(
          `Phase ${cfg.id} r${r} c${col}: sprite width ${g.maxX - g.minX + 1} exceeds cellW ${cfg.cellW}`
        );
      }
      shiftX = Math.max(minAllowedShiftX, Math.min(maxAllowedShiftX, shiftX));

      let shiftY = Math.round(targetGroundY - rowGroundY);
      if (g.minY + shiftY < 3) {
        shiftY = 3 - g.minY;
      }
      if (g.maxY + shiftY > cfg.cellH - 3) {
        shiftY = cfg.cellH - 3 - g.maxY;
      }

      // Build owned mask + 1px dilation for crisp anti-aliased edge pixels (alpha >= 28)
      const owned = new Set();
      for (let i = 0; i < g.pixels.length; i += 2) {
        owned.add(g.pixels[i + 1] * SRC_W + g.pixels[i]);
      }

      const toBlit = new Set(owned);
      for (let i = 0; i < g.pixels.length; i += 2) {
        const px = g.pixels[i];
        const py = g.pixels[i + 1];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx < 0 || nx >= SRC_W || ny < y0 || ny > y1) continue;
            const key = ny * SRC_W + nx;
            if (toBlit.has(key)) continue;
            const a = raw[key * 4 + 3];
            if (a >= 28) toBlit.add(key);
          }
        }
      }

      const cellOriginX = col * cfg.cellW;
      const cellOriginY = r * cfg.cellH;
      let outMinX = cfg.cellW;
      let outMaxX = -1;
      let outMinY = cfg.cellH;
      let outMaxY = -1;

      for (const key of toBlit) {
        const py = Math.floor(key / SRC_W);
        const px = key - py * SRC_W;
        const dstX = px + shiftX;
        const dstY = py + shiftY;
        if (dstX < 1 || dstX >= cfg.cellW - 1 || dstY < 1 || dstY >= cfg.cellH - 1) continue;

        const srcIdx = key * 4;
        const a = cleanAlpha(raw[srcIdx + 3]);
        if (a === 0) continue;

        const dstIdx = ((cellOriginY + dstY) * atlasW + (cellOriginX + dstX)) * 4;
        outBuf[dstIdx] = raw[srcIdx];
        outBuf[dstIdx + 1] = raw[srcIdx + 1];
        outBuf[dstIdx + 2] = raw[srcIdx + 2];
        outBuf[dstIdx + 3] = a;

        if (dstX < outMinX) outMinX = dstX;
        if (dstX > outMaxX) outMaxX = dstX;
        if (dstY < outMinY) outMinY = dstY;
        if (dstY > outMaxY) outMaxY = dstY;
      }

      reportFrames.push({
        r,
        col,
        w: outMaxX - outMinX + 1,
        h: outMaxY - outMinY + 1,
        outMinX,
        outMaxX,
        outMinY,
        outMaxY,
      });
    }
  }

  fs.mkdirSync(path.dirname(cfg.outWebp), { recursive: true });

  // Encode lossless WebP first to check exact size; target 200-500 KB with crisp pixel-art fidelity
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
      '-lossless',
      '1',
      '-compression_level',
      '6',
      cfg.outWebp,
    ],
    { input: outBuf, maxBuffer: 64 * 1024 * 1024 }
  );

  let finalBytes = fs.statSync(cfg.outWebp).size;
  let mode = 'webp-lossless';

  // If lossless exceeds 500 KB, use near-lossless / high-quality WebP (q=94, alpha quality 100)
  if (finalBytes > 500 * 1024) {
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
        '92',
        '-compression_level',
        '6',
        cfg.outWebp,
      ],
      { input: outBuf, maxBuffer: 64 * 1024 * 1024 }
    );
    finalBytes = fs.statSync(cfg.outWebp).size;
    mode = 'webp-q92';
  }

  // Also emit a checkerboard-backed PNG preview in /tmp so we can visually inspect transparency & alignment
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
      cfg.outPngPreview,
    ],
    { input: outBuf, maxBuffer: 64 * 1024 * 1024 }
  );

  const minMarginL = Math.min(...reportFrames.map((f) => f.outMinX));
  const minMarginR = Math.min(...reportFrames.map((f) => cfg.cellW - 1 - f.outMaxX));
  const minMarginT = Math.min(...reportFrames.map((f) => f.outMinY));
  const minMarginB = Math.min(...reportFrames.map((f) => cfg.cellH - 1 - f.outMaxY));

  console.log(
    `Phase ${cfg.id}: ${atlasW}x${atlasH} (${cfg.cellW}x${cfg.cellH} cells) -> ${cfg.outWebp} (${(
      finalBytes / 1024
    ).toFixed(1)} KB, ${mode}) | margins L>=${minMarginL} R>=${minMarginR} T>=${minMarginT} B>=${minMarginB}`
  );
  for (let r = 0; r < ROWS; r++) {
    const rf = reportFrames.filter((f) => f.r === r);
    console.log(
      `  row ${r}: maxY=[${rf.map((f) => f.outMaxY).join(',')}] minY=[${rf
        .map((f) => f.outMinY)
        .join(',')}]`
    );
  }
}

for (const cfg of PHASES) {
  processPhase(cfg);
}

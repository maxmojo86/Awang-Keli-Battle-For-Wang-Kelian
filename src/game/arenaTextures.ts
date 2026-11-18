import * as THREE from 'three';

export interface ArenaTextureSet {
  terrainDetail: THREE.CanvasTexture;
  terrainBump: THREE.CanvasTexture;
  waterAlbedo: THREE.CanvasTexture;
  waterBump: THREE.CanvasTexture;
  limestoneRock: THREE.CanvasTexture;
  limestoneBump: THREE.CanvasTexture;
  timberPlank: THREE.CanvasTexture;
  nipaThatch: THREE.CanvasTexture;
  bioPool: THREE.CanvasTexture;
  lilyPad: THREE.CanvasTexture;
  playerRuneRing: THREE.CanvasTexture;
  hazardSludge: THREE.CanvasTexture;
  hazardRapids: THREE.CanvasTexture;
  hazardQuagmire: THREE.CanvasTexture;
  hazardThermal: THREE.CanvasTexture;
  pickupHeal: THREE.CanvasTexture;
  pickupSpeed: THREE.CanvasTexture;
  pickupDamage: THREE.CanvasTexture;
  pickupShield: THREE.CanvasTexture;
  pickupMonsoonDew: THREE.CanvasTexture;
  pickupStormFin: THREE.CanvasTexture;
  pickupThunderRoe: THREE.CanvasTexture;
  fogWisp: THREE.CanvasTexture;
  dispose: () => void;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function drawWrappedCircle(
  ctx: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  r: number
) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const cx = x + ox * size;
      const cy = y + oy * size;
      if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWrappedEllipse(
  ctx: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot: number
) {
  const bound = Math.max(rx, ry);
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const cx = x + ox * size;
      const cy = y + oy * size;
      if (cx + bound < 0 || cx - bound > size || cy + bound < 0 || cy - bound > size) continue;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function configureTexture(
  canvas: HTMLCanvasElement,
  anisotropy: number,
  isColor: boolean,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates seamless painterly 2.5D textures calibrated to the Awang Keli
 * Design Compendium (sunset-lit limestone karsts, jade-turquoise lagoon,
 * mossy river cobbles, weathered kampung stilt piers, and glowing anomaly pools).
 */
export function createArenaTextureSet(anisotropy: number): ArenaTextureSet {
  // 1. Painterly Terrain Detail & Bump (river cobbles, mud mottling, moss flecks)
  // Kept near bright neutral (~195-245) because it multiplies cleanly with terrain vertex colors.
  const tSize = 512;
  const tCanvas = document.createElement('canvas');
  tCanvas.width = tSize;
  tCanvas.height = tSize;
  const tCtx = tCanvas.getContext('2d')!;

  const tbCanvas = document.createElement('canvas');
  tbCanvas.width = tSize;
  tbCanvas.height = tSize;
  const tbCtx = tbCanvas.getContext('2d')!;

  tCtx.fillStyle = '#dcdad2';
  tCtx.fillRect(0, 0, tSize, tSize);
  tbCtx.fillStyle = '#808080';
  tbCtx.fillRect(0, 0, tSize, tSize);

  const rngT = makeRng(104729);
  // Broad painted soil / mineral wash patches
  for (let i = 0; i < 240; i++) {
    const x = rngT() * tSize;
    const y = rngT() * tSize;
    const rx = 14 + rngT() * 34;
    const ry = 10 + rngT() * 24;
    const rot = rngT() * Math.PI;
    const bright = rngT() > 0.5;
    tCtx.fillStyle = bright ? 'rgba(248, 244, 232, 0.16)' : 'rgba(148, 144, 132, 0.18)';
    drawWrappedEllipse(tCtx, tSize, x, y, rx, ry, rot);

    tbCtx.fillStyle = bright ? 'rgba(210, 210, 210, 0.16)' : 'rgba(60, 60, 60, 0.16)';
    drawWrappedEllipse(tbCtx, tSize, x, y, rx, ry, rot);
  }

  // Painterly river pebbles & cobble stones (as seen on Tebing Kering shores in Plate 3 & 6)
  for (let i = 0; i < 360; i++) {
    const x = rngT() * tSize;
    const y = rngT() * tSize;
    const rx = 4 + rngT() * 11;
    const ry = 3 + rngT() * 7;
    const rot = rngT() * Math.PI;
    // Soft dark crevice rim
    tCtx.fillStyle = 'rgba(110, 106, 98, 0.24)';
    drawWrappedEllipse(tCtx, tSize, x + 1, y + 1.5, rx * 1.15, ry * 1.15, rot);
    // Warm sunlit stone face
    tCtx.fillStyle = rngT() > 0.35 ? 'rgba(242, 236, 224, 0.32)' : 'rgba(202, 214, 196, 0.28)';
    drawWrappedEllipse(tCtx, tSize, x, y, rx, ry, rot);

    tbCtx.fillStyle = 'rgba(230, 230, 230, 0.35)';
    drawWrappedEllipse(tbCtx, tSize, x, y, rx, ry, rot);
  }

  // Fine moss & mineral grit speckles
  for (let i = 0; i < 520; i++) {
    const x = rngT() * tSize;
    const y = rngT() * tSize;
    const r = 1.2 + rngT() * 2.8;
    tCtx.fillStyle = rngT() > 0.45 ? 'rgba(176, 204, 168, 0.22)' : 'rgba(128, 118, 102, 0.2)';
    drawWrappedCircle(tCtx, tSize, x, y, r);
  }

  const terrainDetail = configureTexture(tCanvas, anisotropy, true, 50, 50);
  const terrainBump = configureTexture(tbCanvas, anisotropy, false, 50, 50);

  // 2. Painterly Lagoon Water Albedo & Ripple Bump (Compendium Plate 2 & 3 teal-jade lagoon)
  const wSize = 512;
  const wCanvas = document.createElement('canvas');
  wCanvas.width = wSize;
  wCanvas.height = wSize;
  const wCtx = wCanvas.getContext('2d')!;

  const wbCanvas = document.createElement('canvas');
  wbCanvas.width = wSize;
  wbCanvas.height = wSize;
  const wbCtx = wbCanvas.getContext('2d')!;

  wCtx.fillStyle = '#1b585c';
  wCtx.fillRect(0, 0, wSize, wSize);
  wbCtx.fillStyle = '#7e7e7e';
  wbCtx.fillRect(0, 0, wSize, wSize);

  const rngW = makeRng(29413);
  // Deep teal & luminous emerald current bands
  for (let i = 0; i < 380; i++) {
    const x = rngW() * wSize;
    const y = rngW() * wSize;
    const rx = 18 + rngW() * 44;
    const ry = 5 + rngW() * 12;
    const rot = (rngW() - 0.5) * 0.32;
    const roll = rngW();
    if (roll < 0.42) {
      wCtx.fillStyle = 'rgba(48, 148, 136, 0.18)'; // jade shallow streak
    } else if (roll < 0.78) {
      wCtx.fillStyle = 'rgba(12, 46, 56, 0.24)'; // deep slate-teal trough
    } else {
      wCtx.fillStyle = 'rgba(125, 211, 198, 0.14)'; // luminous aqua crest
    }
    drawWrappedEllipse(wCtx, wSize, x, y, rx, ry, rot);

    wbCtx.fillStyle = roll > 0.5 ? 'rgba(215, 215, 215, 0.22)' : 'rgba(48, 48, 48, 0.2)';
    drawWrappedEllipse(wbCtx, wSize, x, y, rx, ry, rot);
  }

  // Crisp painterly wave-crest highlights & sunset gold glints (matching Plate 2 water)
  for (let i = 0; i < 190; i++) {
    const x = rngW() * wSize;
    const y = rngW() * wSize;
    const len = 14 + rngW() * 34;
    const thick = 1.4 + rngW() * 2.2;
    const isGoldGlint = rngW() > 0.78;
    wCtx.strokeStyle = isGoldGlint ? 'rgba(251, 207, 130, 0.22)' : 'rgba(186, 245, 232, 0.25)';
    wCtx.lineWidth = thick;
    wCtx.lineCap = 'round';
    for (let ox = -1; ox <= 1; ox++) {
      const sx = x + ox * wSize;
      wCtx.beginPath();
      wCtx.moveTo(sx, y);
      wCtx.quadraticCurveTo(sx + len * 0.5, y - 3 + rngW() * 6, sx + len, y + (rngW() - 0.5) * 2);
      wCtx.stroke();
    }

    wbCtx.strokeStyle = 'rgba(245, 245, 245, 0.35)';
    wbCtx.lineWidth = thick + 1;
    for (let ox = -1; ox <= 1; ox++) {
      const sx = x + ox * wSize;
      wbCtx.beginPath();
      wbCtx.moveTo(sx, y);
      wbCtx.quadraticCurveTo(sx + len * 0.5, y - 2, sx + len, y);
      wbCtx.stroke();
    }
  }

  const waterAlbedo = configureTexture(wCanvas, anisotropy, true, 34, 34);
  const waterBump = configureTexture(wbCanvas, anisotropy, false, 34, 34);

  // 3. Stratified Wang Kelian Limestone Karst Texture & Bump
  const rSize = 256;
  const rCanvas = document.createElement('canvas');
  rCanvas.width = rSize;
  rCanvas.height = rSize;
  const rCtx = rCanvas.getContext('2d')!;

  const rbCanvas = document.createElement('canvas');
  rbCanvas.width = rSize;
  rbCanvas.height = rSize;
  const rbCtx = rbCanvas.getContext('2d')!;

  rCtx.fillStyle = '#738087';
  rCtx.fillRect(0, 0, rSize, rSize);
  rbCtx.fillStyle = '#808080';
  rbCtx.fillRect(0, 0, rSize, rSize);

  const rngR = makeRng(47119);
  // Stratified sedimentary stone bands + warm sunlit ridges + cool dusk cracks
  for (let i = 0; i < 95; i++) {
    const y = rngR() * rSize;
    const h = 4 + rngR() * 14;
    const tone = rngR();
    rCtx.fillStyle =
      tone < 0.35
        ? 'rgba(54, 65, 74, 0.38)'
        : tone < 0.72
        ? 'rgba(138, 146, 142, 0.32)'
        : 'rgba(176, 162, 134, 0.25)'; // warm sunset limestone highlight
    rCtx.fillRect(0, y, rSize, h);

    rbCtx.fillStyle = tone < 0.4 ? 'rgba(42, 42, 42, 0.4)' : 'rgba(218, 218, 218, 0.32)';
    rbCtx.fillRect(0, y, rSize, h);
  }
  // Vertical karst fissures & moss veins
  for (let i = 0; i < 140; i++) {
    const x = rngR() * rSize;
    const y = rngR() * rSize;
    const rx = 3 + rngR() * 9;
    const ry = 8 + rngR() * 24;
    const isMoss = rngR() > 0.68;
    rCtx.fillStyle = isMoss ? 'rgba(78, 122, 72, 0.38)' : 'rgba(34, 42, 48, 0.34)';
    drawWrappedEllipse(rCtx, rSize, x, y, rx, ry, (rngR() - 0.5) * 0.4);

    rbCtx.fillStyle = isMoss ? 'rgba(195, 195, 195, 0.28)' : 'rgba(35, 35, 35, 0.42)';
    drawWrappedEllipse(rbCtx, rSize, x, y, rx, ry, (rngR() - 0.5) * 0.4);
  }

  const limestoneRock = configureTexture(rCanvas, anisotropy, true, 2, 2);
  const limestoneBump = configureTexture(rbCanvas, anisotropy, false, 2, 2);

  // 4. Kampung Weathered Timber Planks (Jetty, Stilt House & Palong Gates)
  const pSize = 256;
  const pCanvas = document.createElement('canvas');
  pCanvas.width = pSize;
  pCanvas.height = pSize;
  const pCtx = pCanvas.getContext('2d')!;

  pCtx.fillStyle = '#6f4e33';
  pCtx.fillRect(0, 0, pSize, pSize);
  const rngP = makeRng(88211);
  const plankCount = 8;
  const plankH = pSize / plankCount;
  for (let row = 0; row < plankCount; row++) {
    const py = row * plankH;
    const shade = (rngP() - 0.5) * 18;
    pCtx.fillStyle = `rgb(${112 + shade}, ${78 + shade * 0.7}, ${51 + shade * 0.5})`;
    pCtx.fillRect(0, py + 2, pSize, plankH - 3);
    // Plank gap shadow
    pCtx.fillStyle = '#291b10';
    pCtx.fillRect(0, py, pSize, 2.5);
    // Highlighted top bevel
    pCtx.fillStyle = 'rgba(219, 174, 120, 0.22)';
    pCtx.fillRect(0, py + 2.5, pSize, 2);
    // Wood grain streaks
    for (let g = 0; g < 18; g++) {
      const gx = rngP() * pSize;
      const gy = py + 4 + rngP() * (plankH - 8);
      const gl = 24 + rngP() * 56;
      pCtx.strokeStyle = rngP() > 0.4 ? 'rgba(54, 34, 20, 0.34)' : 'rgba(164, 124, 86, 0.2)';
      pCtx.lineWidth = 1.2;
      pCtx.beginPath();
      pCtx.moveTo(gx, gy);
      pCtx.lineTo(gx + gl, gy + (rngP() - 0.5) * 1.5);
      pCtx.stroke();
    }
    // Iron nail bolts
    pCtx.fillStyle = '#1f1610';
    for (const bx of [18, 124, 232]) {
      pCtx.beginPath();
      pCtx.arc(bx, py + 7, 1.8, 0, Math.PI * 2);
      pCtx.arc(bx, py + plankH - 6, 1.8, 0, Math.PI * 2);
      pCtx.fill();
    }
  }
  const timberPlank = configureTexture(pCanvas, anisotropy, true, 2, 2);

  // 5. Woven Attap / Nipa Thatch Roof Texture (Kampung Stilt House)
  const nSize = 256;
  const nCanvas = document.createElement('canvas');
  nCanvas.width = nSize;
  nCanvas.height = nSize;
  const nCtx = nCanvas.getContext('2d')!;
  nCtx.fillStyle = '#473a2c';
  nCtx.fillRect(0, 0, nSize, nSize);
  const rngN = makeRng(61103);
  for (let row = 0; row < 16; row++) {
    const y = (row / 16) * nSize;
    nCtx.fillStyle = 'rgba(24, 18, 12, 0.42)';
    nCtx.fillRect(0, y, nSize, 3);
    for (let s = 0; s < 48; s++) {
      const sx = rngN() * nSize;
      nCtx.strokeStyle = rngN() > 0.4 ? 'rgba(138, 114, 78, 0.45)' : 'rgba(58, 46, 33, 0.55)';
      nCtx.lineWidth = 1.5;
      nCtx.beginPath();
      nCtx.moveTo(sx, y);
      nCtx.lineTo(sx + (rngN() - 0.5) * 6, y + 18);
      nCtx.stroke();
    }
  }
  const nipaThatch = configureTexture(nCanvas, anisotropy, true, 3, 3);

  // 6. Luminous Bioluminescent Anomaly Pool Texture (Plates 1 & 2 bubbling green spots)
  const bSize = 256;
  const bCanvas = document.createElement('canvas');
  bCanvas.width = bSize;
  bCanvas.height = bSize;
  const bCtx = bCanvas.getContext('2d')!;
  const rad = bCtx.createRadialGradient(128, 128, 6, 128, 128, 124);
  rad.addColorStop(0, 'rgba(190, 255, 118, 0.96)');
  rad.addColorStop(0.28, 'rgba(74, 222, 128, 0.72)');
  rad.addColorStop(0.62, 'rgba(34, 197, 94, 0.28)');
  rad.addColorStop(1, 'rgba(16, 185, 129, 0)');
  bCtx.fillStyle = rad;
  bCtx.fillRect(0, 0, bSize, bSize);

  const rngB = makeRng(7719);
  for (let i = 0; i < 18; i++) {
    const ang = rngB() * Math.PI * 2;
    const dist = 10 + rngB() * 78;
    const bx = 128 + Math.cos(ang) * dist;
    const by = 128 + Math.sin(ang) * dist;
    const br = 3 + rngB() * 9;
    bCtx.strokeStyle = 'rgba(220, 255, 168, 0.72)';
    bCtx.lineWidth = 1.6;
    bCtx.beginPath();
    bCtx.arc(bx, by, br, 0, Math.PI * 2);
    bCtx.stroke();
  }
  const bioPool = new THREE.CanvasTexture(bCanvas);
  bioPool.colorSpace = THREE.SRGBColorSpace;
  bioPool.needsUpdate = true;

  // 7. Painterly Lily Pad Disc Texture
  const lSize = 128;
  const lCanvas = document.createElement('canvas');
  lCanvas.width = lSize;
  lCanvas.height = lSize;
  const lCtx = lCanvas.getContext('2d')!;
  lCtx.clearRect(0, 0, lSize, lSize);
  lCtx.fillStyle = '#3f7d47';
  lCtx.beginPath();
  lCtx.moveTo(64, 64);
  lCtx.arc(64, 64, 56, 0.25, Math.PI * 2 - 0.15);
  lCtx.closePath();
  lCtx.fill();
  lCtx.strokeStyle = '#73b369';
  lCtx.lineWidth = 2.5;
  lCtx.stroke();
  // Veins
  lCtx.strokeStyle = 'rgba(176, 224, 146, 0.45)';
  lCtx.lineWidth = 1.4;
  for (let v = 0; v < 7; v++) {
    const va = 0.6 + v * 0.75;
    lCtx.beginPath();
    lCtx.moveTo(64, 64);
    lCtx.lineTo(64 + Math.cos(va) * 46, 64 + Math.sin(va) * 46);
    lCtx.stroke();
  }
  const lilyPad = new THREE.CanvasTexture(lCanvas);
  lilyPad.colorSpace = THREE.SRGBColorSpace;
  lilyPad.needsUpdate = true;

  // 8. Cerulean Player Rune Ring (matching Plate 2 Lv.86 Awang Keli standing on pier)
  const ruSize = 256;
  const ruCanvas = document.createElement('canvas');
  ruCanvas.width = ruSize;
  ruCanvas.height = ruSize;
  const ruCtx = ruCanvas.getContext('2d')!;
  ruCtx.clearRect(0, 0, ruSize, ruSize);
  const ruGlow = ruCtx.createRadialGradient(128, 128, 60, 128, 128, 124);
  ruGlow.addColorStop(0, 'rgba(56, 189, 248, 0)');
  ruGlow.addColorStop(0.68, 'rgba(56, 189, 248, 0.25)');
  ruGlow.addColorStop(0.84, 'rgba(125, 211, 252, 0.85)');
  ruGlow.addColorStop(0.92, 'rgba(56, 189, 248, 0.35)');
  ruGlow.addColorStop(1, 'rgba(56, 189, 248, 0)');
  ruCtx.fillStyle = ruGlow;
  ruCtx.fillRect(0, 0, ruSize, ruSize);

  ruCtx.strokeStyle = 'rgba(224, 242, 254, 0.92)';
  ruCtx.lineWidth = 3;
  ruCtx.beginPath();
  ruCtx.arc(128, 128, 104, 0, Math.PI * 2);
  ruCtx.stroke();

  ruCtx.strokeStyle = 'rgba(125, 211, 252, 0.78)';
  ruCtx.lineWidth = 2;
  ruCtx.setLineDash([12, 8]);
  ruCtx.beginPath();
  ruCtx.arc(128, 128, 92, 0, Math.PI * 2);
  ruCtx.stroke();
  ruCtx.setLineDash([]);

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = 128 + Math.cos(a) * 98;
    const py = 128 + Math.sin(a) * 98;
    ruCtx.fillStyle = '#e0f2fe';
    ruCtx.beginPath();
    ruCtx.arc(px, py, 3.2, 0, Math.PI * 2);
    ruCtx.fill();
  }
  const playerRuneRing = new THREE.CanvasTexture(ruCanvas);
  playerRuneRing.colorSpace = THREE.SRGBColorSpace;
  playerRuneRing.needsUpdate = true;

  // 9. Toxic Tin-Mine Sludge Pocket Texture (viscous bubbling chartreuse-emerald mire)
  const hsSize = 256;
  const hsCanvas = document.createElement('canvas');
  hsCanvas.width = hsSize;
  hsCanvas.height = hsSize;
  const hsCtx = hsCanvas.getContext('2d')!;
  const hsGrad = hsCtx.createRadialGradient(128, 128, 14, 128, 128, 124);
  hsGrad.addColorStop(0, 'rgba(132, 204, 22, 0.86)');
  hsGrad.addColorStop(0.42, 'rgba(77, 124, 15, 0.78)');
  hsGrad.addColorStop(0.76, 'rgba(54, 83, 20, 0.58)');
  hsGrad.addColorStop(0.9, 'rgba(163, 230, 53, 0.72)');
  hsGrad.addColorStop(1, 'rgba(54, 83, 20, 0)');
  hsCtx.fillStyle = hsGrad;
  hsCtx.fillRect(0, 0, hsSize, hsSize);

  const rngHs = makeRng(31019);
  for (let i = 0; i < 24; i++) {
    const a = rngHs() * Math.PI * 2;
    const d = 12 + rngHs() * 82;
    const bx = 128 + Math.cos(a) * d;
    const by = 128 + Math.sin(a) * d;
    const br = 4 + rngHs() * 11;
    hsCtx.fillStyle = rngHs() > 0.45 ? 'rgba(190, 242, 100, 0.42)' : 'rgba(38, 60, 14, 0.46)';
    hsCtx.beginPath();
    hsCtx.arc(bx, by, br, 0, Math.PI * 2);
    hsCtx.fill();
    hsCtx.strokeStyle = 'rgba(217, 249, 157, 0.65)';
    hsCtx.lineWidth = 1.4;
    hsCtx.stroke();
  }
  const hazardSludge = new THREE.CanvasTexture(hsCanvas);
  hazardSludge.colorSpace = THREE.SRGBColorSpace;
  hazardSludge.needsUpdate = true;

  // 10. Current-Heavy Riptide Rapids Texture (seamless directional +U chevrons & whitewater foam)
  const hrSize = 256;
  const hrCanvas = document.createElement('canvas');
  hrCanvas.width = hrSize;
  hrCanvas.height = hrSize;
  const hrCtx = hrCanvas.getContext('2d')!;
  hrCtx.fillStyle = 'rgba(14, 116, 144, 0.42)';
  hrCtx.fillRect(0, 0, hrSize, hrSize);
  // Soft bank borders top/bottom along V
  const bankFade = hrCtx.createLinearGradient(0, 0, 0, hrSize);
  bankFade.addColorStop(0, 'rgba(8, 47, 73, 0)');
  bankFade.addColorStop(0.14, 'rgba(56, 189, 248, 0.34)');
  bankFade.addColorStop(0.5, 'rgba(34, 211, 238, 0.44)');
  bankFade.addColorStop(0.86, 'rgba(56, 189, 248, 0.34)');
  bankFade.addColorStop(1, 'rgba(8, 47, 73, 0)');
  hrCtx.fillStyle = bankFade;
  hrCtx.fillRect(0, 0, hrSize, hrSize);

  const rngHr = makeRng(44107);
  // Whitewater streaks pointing +X (right)
  for (let i = 0; i < 48; i++) {
    const x = rngHr() * hrSize;
    const y = 22 + rngHr() * (hrSize - 44);
    const len = 24 + rngHr() * 44;
    hrCtx.strokeStyle = rngHr() > 0.35 ? 'rgba(186, 230, 253, 0.55)' : 'rgba(255, 255, 255, 0.68)';
    hrCtx.lineWidth = 2 + rngHr() * 2.2;
    hrCtx.lineCap = 'round';
    for (let ox = -1; ox <= 1; ox++) {
      const sx = x + ox * hrSize;
      hrCtx.beginPath();
      hrCtx.moveTo(sx, y);
      hrCtx.lineTo(sx + len, y + (rngHr() - 0.5) * 3);
      hrCtx.stroke();
    }
  }
  // Directional flow chevrons pointing right (+U)
  hrCtx.strokeStyle = 'rgba(224, 242, 254, 0.84)';
  hrCtx.lineWidth = 4;
  hrCtx.lineJoin = 'round';
  for (let cx = 32; cx < hrSize; cx += 64) {
    for (const cy of [64, 128, 192]) {
      hrCtx.beginPath();
      hrCtx.moveTo(cx - 12, cy - 16);
      hrCtx.lineTo(cx + 8, cy);
      hrCtx.lineTo(cx - 12, cy + 16);
      hrCtx.stroke();
    }
  }
  const hazardRapids = configureTexture(hrCanvas, anisotropy, true, 3, 1);

  // 11. Tidal Mudflat / Sinking Quagmire Texture
  const hqSize = 256;
  const hqCanvas = document.createElement('canvas');
  hqCanvas.width = hqSize;
  hqCanvas.height = hqSize;
  const hqCtx = hqCanvas.getContext('2d')!;
  const hqGrad = hqCtx.createRadialGradient(128, 128, 12, 128, 128, 124);
  hqGrad.addColorStop(0, 'rgba(69, 44, 22, 0.88)');
  hqGrad.addColorStop(0.55, 'rgba(101, 67, 33, 0.72)');
  hqGrad.addColorStop(0.84, 'rgba(146, 102, 56, 0.52)');
  hqGrad.addColorStop(1, 'rgba(69, 44, 22, 0)');
  hqCtx.fillStyle = hqGrad;
  hqCtx.fillRect(0, 0, hqSize, hqSize);

  const rngHq = makeRng(55213);
  for (let r = 24; r <= 96; r += 24) {
    hqCtx.strokeStyle = 'rgba(194, 143, 82, 0.42)';
    hqCtx.lineWidth = 2.2;
    hqCtx.setLineDash([14, 10]);
    hqCtx.beginPath();
    hqCtx.arc(128, 128, r, 0, Math.PI * 2);
    hqCtx.stroke();
  }
  hqCtx.setLineDash([]);
  for (let i = 0; i < 32; i++) {
    const a = rngHq() * Math.PI * 2;
    const d = 10 + rngHq() * 88;
    hqCtx.fillStyle = 'rgba(42, 26, 12, 0.5)';
    hqCtx.beginPath();
    hqCtx.ellipse(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 8 + rngHq() * 10, 4 + rngHq() * 5, a, 0, Math.PI * 2);
    hqCtx.fill();
  }
  const hazardQuagmire = new THREE.CanvasTexture(hqCanvas);
  hazardQuagmire.colorSpace = THREE.SRGBColorSpace;
  hazardQuagmire.needsUpdate = true;

  // 12. Scorched Geothermal Brine Vent Texture
  const htSize = 256;
  const htCanvas = document.createElement('canvas');
  htCanvas.width = htSize;
  htCanvas.height = htSize;
  const htCtx = htCanvas.getContext('2d')!;
  const htGrad = htCtx.createRadialGradient(128, 128, 10, 128, 128, 124);
  htGrad.addColorStop(0, 'rgba(251, 146, 60, 0.85)');
  htGrad.addColorStop(0.38, 'rgba(194, 65, 12, 0.68)');
  htGrad.addColorStop(0.75, 'rgba(124, 45, 18, 0.45)');
  htGrad.addColorStop(0.88, 'rgba(253, 186, 116, 0.58)');
  htGrad.addColorStop(1, 'rgba(124, 45, 18, 0)');
  htCtx.fillStyle = htGrad;
  htCtx.fillRect(0, 0, htSize, htSize);

  const rngHt = makeRng(72311);
  htCtx.strokeStyle = 'rgba(254, 215, 170, 0.68)';
  htCtx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rngHt() * 0.25;
    htCtx.beginPath();
    htCtx.moveTo(128 + Math.cos(a) * 16, 128 + Math.sin(a) * 16);
    htCtx.lineTo(128 + Math.cos(a + 0.14) * 58, 128 + Math.sin(a + 0.14) * 58);
    htCtx.lineTo(128 + Math.cos(a - 0.08) * 96, 128 + Math.sin(a - 0.08) * 96);
    htCtx.stroke();
  }
  const hazardThermal = new THREE.CanvasTexture(htCanvas);
  hazardThermal.colorSpace = THREE.SRGBColorSpace;
  hazardThermal.needsUpdate = true;

  // 13. Healing & Power-Up Pickup Orb Textures
  const makePickupTexture = (
    coreCol: string,
    midCol: string,
    outerCol: string,
    drawSymbol: (ctx: CanvasRenderingContext2D) => void
  ): THREE.CanvasTexture => {
    const pSz = 128;
    const c = document.createElement('canvas');
    c.width = pSz;
    c.height = pSz;
    const gctx = c.getContext('2d')!;
    const grad = gctx.createRadialGradient(64, 64, 6, 64, 64, 58);
    grad.addColorStop(0, coreCol);
    grad.addColorStop(0.45, midCol);
    grad.addColorStop(0.75, outerCol);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, pSz, pSz);

    gctx.strokeStyle = 'rgba(255,255,255,0.88)';
    gctx.lineWidth = 3;
    gctx.beginPath();
    gctx.arc(64, 64, 34, 0, Math.PI * 2);
    gctx.stroke();

    drawSymbol(gctx);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  };

  const pickupHeal = makePickupTexture(
    'rgba(220, 252, 231, 0.98)',
    'rgba(74, 222, 128, 0.9)',
    'rgba(16, 185, 129, 0.25)',
    (gctx) => {
      gctx.fillStyle = '#052e16';
      gctx.fillRect(58, 44, 12, 40);
      gctx.fillRect(44, 58, 40, 12);
      gctx.fillStyle = '#ffffff';
      gctx.fillRect(60, 46, 8, 36);
      gctx.fillRect(46, 60, 36, 8);
    }
  );

  const pickupSpeed = makePickupTexture(
    'rgba(224, 242, 254, 0.98)',
    'rgba(56, 189, 248, 0.9)',
    'rgba(14, 165, 233, 0.25)',
    (gctx) => {
      gctx.strokeStyle = '#ffffff';
      gctx.lineWidth = 5;
      gctx.lineCap = 'round';
      gctx.lineJoin = 'round';
      for (const ox of [-8, 6]) {
        gctx.beginPath();
        gctx.moveTo(56 + ox, 48);
        gctx.lineTo(70 + ox, 64);
        gctx.lineTo(56 + ox, 80);
        gctx.stroke();
      }
    }
  );

  const pickupDamage = makePickupTexture(
    'rgba(255, 237, 213, 0.98)',
    'rgba(251, 113, 133, 0.92)',
    'rgba(239, 68, 68, 0.26)',
    (gctx) => {
      gctx.fillStyle = '#ffffff';
      gctx.beginPath();
      gctx.moveTo(64, 41);
      gctx.lineTo(82, 64);
      gctx.lineTo(64, 87);
      gctx.lineTo(46, 64);
      gctx.closePath();
      gctx.fill();
      gctx.fillStyle = '#9f1239';
      gctx.beginPath();
      gctx.arc(64, 64, 7, 0, Math.PI * 2);
      gctx.fill();
    }
  );

  const pickupShield = makePickupTexture(
    'rgba(254, 249, 195, 0.98)',
    'rgba(251, 191, 36, 0.92)',
    'rgba(217, 119, 6, 0.25)',
    (gctx) => {
      gctx.fillStyle = '#ffffff';
      gctx.beginPath();
      gctx.moveTo(64, 44);
      gctx.lineTo(80, 52);
      gctx.lineTo(78, 70);
      gctx.lineTo(64, 84);
      gctx.lineTo(50, 70);
      gctx.lineTo(48, 52);
      gctx.closePath();
      gctx.fill();
    }
  );

  const pickupMonsoonDew = makePickupTexture(
    'rgba(204, 251, 241, 0.98)',
    'rgba(45, 212, 191, 0.92)',
    'rgba(13, 148, 136, 0.28)',
    (gctx) => {
      gctx.fillStyle = '#ffffff';
      gctx.beginPath();
      gctx.moveTo(64, 38);
      gctx.bezierCurveTo(79, 58, 84, 72, 64, 86);
      gctx.bezierCurveTo(44, 72, 49, 58, 64, 38);
      gctx.closePath();
      gctx.fill();
      gctx.fillStyle = '#0f766e';
      gctx.beginPath();
      gctx.arc(60, 68, 5, 0, Math.PI * 2);
      gctx.fill();
    }
  );

  const pickupStormFin = makePickupTexture(
    'rgba(219, 234, 254, 0.98)',
    'rgba(96, 165, 250, 0.94)',
    'rgba(37, 99, 235, 0.28)',
    (gctx) => {
      gctx.strokeStyle = '#ffffff';
      gctx.lineWidth = 4.5;
      gctx.lineCap = 'round';
      for (const yOff of [-11, 0, 11]) {
        gctx.beginPath();
        gctx.moveTo(42, 64 + yOff);
        gctx.quadraticCurveTo(54, 55 + yOff, 64, 64 + yOff);
        gctx.quadraticCurveTo(74, 73 + yOff, 86, 64 + yOff);
        gctx.stroke();
      }
    }
  );

  const pickupThunderRoe = makePickupTexture(
    'rgba(243, 232, 255, 0.98)',
    'rgba(192, 132, 252, 0.94)',
    'rgba(126, 34, 206, 0.28)',
    (gctx) => {
      gctx.fillStyle = '#fef08a';
      gctx.strokeStyle = '#ffffff';
      gctx.lineWidth = 2;
      gctx.beginPath();
      gctx.moveTo(68, 39);
      gctx.lineTo(50, 65);
      gctx.lineTo(63, 65);
      gctx.lineTo(58, 89);
      gctx.lineTo(78, 61);
      gctx.lineTo(65, 61);
      gctx.closePath();
      gctx.fill();
      gctx.stroke();
    }
  );

  // 14. Soft Procedural Basin Fog Wisp Texture
  const fwSize = 128;
  const fwCanvas = document.createElement('canvas');
  fwCanvas.width = fwSize;
  fwCanvas.height = fwSize;
  const fwCtx = fwCanvas.getContext('2d')!;
  const fwGrad = fwCtx.createRadialGradient(64, 64, 6, 64, 64, 62);
  fwGrad.addColorStop(0, 'rgba(203, 224, 230, 0.36)');
  fwGrad.addColorStop(0.45, 'rgba(176, 206, 214, 0.22)');
  fwGrad.addColorStop(0.8, 'rgba(138, 174, 184, 0.07)');
  fwGrad.addColorStop(1, 'rgba(138, 174, 184, 0)');
  fwCtx.fillStyle = fwGrad;
  fwCtx.fillRect(0, 0, fwSize, fwSize);
  const fogWisp = new THREE.CanvasTexture(fwCanvas);
  fogWisp.colorSpace = THREE.SRGBColorSpace;
  fogWisp.needsUpdate = true;

  return {
    terrainDetail,
    terrainBump,
    waterAlbedo,
    waterBump,
    limestoneRock,
    limestoneBump,
    timberPlank,
    nipaThatch,
    bioPool,
    lilyPad,
    playerRuneRing,
    hazardSludge,
    hazardRapids,
    hazardQuagmire,
    hazardThermal,
    pickupHeal,
    pickupSpeed,
    pickupDamage,
    pickupShield,
    pickupMonsoonDew,
    pickupStormFin,
    pickupThunderRoe,
    fogWisp,
    dispose: () => {
      terrainDetail.dispose();
      terrainBump.dispose();
      waterAlbedo.dispose();
      waterBump.dispose();
      limestoneRock.dispose();
      limestoneBump.dispose();
      timberPlank.dispose();
      nipaThatch.dispose();
      bioPool.dispose();
      lilyPad.dispose();
      playerRuneRing.dispose();
      hazardSludge.dispose();
      hazardRapids.dispose();
      hazardQuagmire.dispose();
      hazardThermal.dispose();
      pickupHeal.dispose();
      pickupSpeed.dispose();
      pickupDamage.dispose();
      pickupShield.dispose();
      pickupMonsoonDew.dispose();
      pickupStormFin.dispose();
      pickupThunderRoe.dispose();
      fogWisp.dispose();
    },
  };
}

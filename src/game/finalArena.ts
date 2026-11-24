import {
  getTerrainAt,
  isPositionAccessible,
  scaleArenaCoord,
  scaleArenaDist,
} from './arena.ts';

export const CORE_ARCHITECTURE_VERSION = '1.0.0-core-freeze';
export const CORE_STRUCTURE_STATUS = 'CORE_STRUCTURE_COMPLETE' as const;

export const FINAL_ARENA_TARGET_LAND_PCT = 60;
export const FINAL_ARENA_TARGET_WATER_PCT = 40;
export const FINAL_ARENA_LAND_MIN_PCT = 57;
export const FINAL_ARENA_LAND_MAX_PCT = 63;
export const FINAL_ARENA_WATER_MIN_PCT = 37;
export const FINAL_ARENA_WATER_MAX_PCT = 43;

export const OPENING_ZONE_CENTER_X = scaleArenaCoord(1030); // 2913
export const OPENING_ZONE_CENTER_Z = scaleArenaCoord(1210); // 3422
export const SMALLEST_LOBBY_OPENING_RADIUS = scaleArenaDist(560); // 1584

export interface TerrainCompositionReport {
  centerX: number;
  centerZ: number;
  radius: number;
  sampleStep: number;
  totalSampledCells: number;
  playableCells: number;
  playableLandCells: number;
  playableWaterCells: number;
  deepWaterCells: number;
  shallowWaterCells: number;
  blockedCells: number;
  cliffCells: number;
  landPercent: number;
  waterPercent: number;
  blockedPercent: number;
  waterConnectivityPercent: number;
  waterComponentCount: number;
  disconnectedWaterCells: number;
  landConnectivityPercent: number;
  landComponentCount: number;
  disconnectedLandCells: number;
  waterSpanX: number;
  waterSpanZ: number;
  shorelineCells: number;
  fitsInsideSmallestOpeningZone: boolean;
  meetsTargetRatio: boolean;
  meetsAllConstraints: boolean;
}

export interface PermanentFinalArenaConfig {
  readonly centerX: number;
  readonly centerZ: number;
  readonly radius: number;
  readonly landPercent: number;
  readonly waterPercent: number;
  readonly waterConnectivityPercent: number;
  readonly landConnectivityPercent: number;
  readonly blockedPercent: number;
  readonly waterSpanX: number;
  readonly waterSpanZ: number;
  readonly shorelineCells: number;
  readonly report: TerrainCompositionReport;
}

function measureLargestComponent(cells: Map<string, [number, number]>): {
  largestSize: number;
  componentCount: number;
  connectivityPercent: number;
  disconnectedCells: number;
} {
  if (cells.size === 0) {
    return {
      largestSize: 0,
      componentCount: 0,
      connectivityPercent: 0,
      disconnectedCells: 0,
    };
  }
  const visited = new Set<string>();
  let largestSize = 0;
  let componentCount = 0;

  for (const [key, start] of cells) {
    if (visited.has(key)) continue;
    componentCount += 1;
    let count = 0;
    const stack: Array<[number, number]> = [start];
    visited.add(key);

    while (stack.length > 0) {
      const [gx, gz] = stack.pop()!;
      count += 1;
      const n1 = `${gx + 1},${gz}`;
      if (cells.has(n1) && !visited.has(n1)) {
        visited.add(n1);
        stack.push([gx + 1, gz]);
      }
      const n2 = `${gx - 1},${gz}`;
      if (cells.has(n2) && !visited.has(n2)) {
        visited.add(n2);
        stack.push([gx - 1, gz]);
      }
      const n3 = `${gx},${gz + 1}`;
      if (cells.has(n3) && !visited.has(n3)) {
        visited.add(n3);
        stack.push([gx, gz + 1]);
      }
      const n4 = `${gx},${gz - 1}`;
      if (cells.has(n4) && !visited.has(n4)) {
        visited.add(n4);
        stack.push([gx, gz - 1]);
      }
    }

    if (count > largestSize) {
      largestSize = count;
    }
  }

  return {
    largestSize,
    componentCount,
    connectivityPercent: Math.round((largestSize / cells.size) * 10000) / 100,
    disconnectedCells: cells.size - largestSize,
  };
}

/**
 * Deterministically samples playable dry land vs playable water within a circular arena
 * using the real Wang Kelian terrain elevation and static obstacle collision rules.
 *
 * Excludes impassable cliffs, boulders, limestone pillars, and roots from both numerator
 * and denominator, and computes BFS 4-neighbor connectivity for both water and dry land.
 */
export function measureCircularTerrainComposition(
  centerX: number,
  centerZ: number,
  radius: number,
  sampleStep = 12,
  actorClearanceRadius = 18
): TerrainCompositionReport {
  const step = Math.max(4, Math.round(sampleStep));
  const r2 = radius * radius;
  const minGx = Math.floor((centerX - radius) / step);
  const maxGx = Math.ceil((centerX + radius) / step);
  const minGz = Math.floor((centerZ - radius) / step);
  const maxGz = Math.ceil((centerZ + radius) / step);

  let playableLandCells = 0;
  let playableWaterCells = 0;
  let deepWaterCells = 0;
  let shallowWaterCells = 0;
  let blockedCells = 0;
  let cliffCells = 0;

  let wMinX = Infinity;
  let wMaxX = -Infinity;
  let wMinZ = Infinity;
  let wMaxZ = -Infinity;

  const waterCells = new Map<string, [number, number]>();
  const landCells = new Map<string, [number, number]>();

  for (let gx = minGx; gx <= maxGx; gx++) {
    const x = gx * step;
    const dx = x - centerX;
    const dx2 = dx * dx;
    if (dx2 > r2) continue;

    for (let gz = minGz; gz <= maxGz; gz++) {
      const z = gz * step;
      const dz = z - centerZ;
      if (dx2 + dz * dz > r2) continue;

      const terrain = getTerrainAt(x, z);
      if (terrain === 'cliff') {
        cliffCells += 1;
        blockedCells += 1;
        continue;
      }

      if (terrain === 'shore') {
        if (isPositionAccessible(x, z, actorClearanceRadius, true)) {
          playableLandCells += 1;
          landCells.set(`${gx},${gz}`, [gx, gz]);
        } else {
          blockedCells += 1;
        }
      } else {
        if (isPositionAccessible(x, z, actorClearanceRadius, false)) {
          playableWaterCells += 1;
          if (terrain === 'deep') deepWaterCells += 1;
          else shallowWaterCells += 1;
          waterCells.set(`${gx},${gz}`, [gx, gz]);
          if (x < wMinX) wMinX = x;
          if (x > wMaxX) wMaxX = x;
          if (z < wMinZ) wMinZ = z;
          if (z > wMaxZ) wMaxZ = z;
        } else {
          blockedCells += 1;
        }
      }
    }
  }

  let shorelineCells = 0;
  for (const [, [gx, gz]] of waterCells) {
    if (
      landCells.has(`${gx + 1},${gz}`) ||
      landCells.has(`${gx - 1},${gz}`) ||
      landCells.has(`${gx},${gz + 1}`) ||
      landCells.has(`${gx},${gz - 1}`)
    ) {
      shorelineCells += 1;
    }
  }

  const waterComp = measureLargestComponent(waterCells);
  const landComp = measureLargestComponent(landCells);
  const playableCells = playableLandCells + playableWaterCells;
  const totalSampledCells = playableCells + blockedCells;

  const landPercent =
    playableCells > 0 ? Math.round((playableLandCells / playableCells) * 10000) / 100 : 0;
  const waterPercent =
    playableCells > 0 ? Math.round((playableWaterCells / playableCells) * 10000) / 100 : 0;
  const blockedPercent =
    totalSampledCells > 0 ? Math.round((blockedCells / totalSampledCells) * 10000) / 100 : 100;

  const waterSpanX = Number.isFinite(wMinX) ? Math.round(wMaxX - wMinX) : 0;
  const waterSpanZ = Number.isFinite(wMinZ) ? Math.round(wMaxZ - wMinZ) : 0;

  const distFromOpeningCenter = Math.hypot(
    centerX - OPENING_ZONE_CENTER_X,
    centerZ - OPENING_ZONE_CENTER_Z
  );
  const fitsInsideSmallestOpeningZone =
    distFromOpeningCenter + radius <= SMALLEST_LOBBY_OPENING_RADIUS - 20;

  const meetsTargetRatio =
    landPercent >= FINAL_ARENA_LAND_MIN_PCT &&
    landPercent <= FINAL_ARENA_LAND_MAX_PCT &&
    waterPercent >= FINAL_ARENA_WATER_MIN_PCT &&
    waterPercent <= FINAL_ARENA_WATER_MAX_PCT;

  const meetsAllConstraints =
    meetsTargetRatio &&
    waterComp.connectivityPercent >= 95 &&
    landComp.connectivityPercent >= 95 &&
    blockedPercent <= 10 &&
    waterSpanX >= 420 &&
    waterSpanZ >= 420 &&
    shorelineCells >= 40 &&
    fitsInsideSmallestOpeningZone;

  return {
    centerX,
    centerZ,
    radius,
    sampleStep: step,
    totalSampledCells,
    playableCells,
    playableLandCells,
    playableWaterCells,
    deepWaterCells,
    shallowWaterCells,
    blockedCells,
    cliffCells,
    landPercent,
    waterPercent,
    blockedPercent,
    waterConnectivityPercent: waterComp.connectivityPercent,
    waterComponentCount: waterComp.componentCount,
    disconnectedWaterCells: waterComp.disconnectedCells,
    landConnectivityPercent: landComp.connectivityPercent,
    landComponentCount: landComp.componentCount,
    disconnectedLandCells: landComp.disconnectedCells,
    waterSpanX,
    waterSpanZ,
    shorelineCells,
    fitsInsideSmallestOpeningZone,
    meetsTargetRatio,
    meetsAllConstraints,
  };
}

/**
 * Deterministic candidate pool along the natural Tebing Kering / Jantung Tasik shoreline.
 * Evaluated by exact playable terrain composition, water/land connectivity, obstacle clearance,
 * shoreline seam length, and smooth nesting inside all lobby opening safe zones.
 */
export const FINAL_ARENA_CANDIDATES: ReadonlyArray<{
  centerX: number;
  centerZ: number;
  radius: number;
}> = [
  { centerX: 3820, centerZ: 3560, radius: 480 },
  { centerX: 3820, centerZ: 3200, radius: 540 },
  { centerX: 3880, centerZ: 3140, radius: 600 },
  { centerX: 4120, centerZ: 2960, radius: 540 },
  { centerX: 4120, centerZ: 3680, radius: 600 },
];

/**
 * Deterministically evaluates candidate final safe-zone configurations on the existing
 * Wang Kelian map and returns the highest-scoring compliant 60% land / 40% water arena.
 */
export function selectPermanentFinalArena(sampleStep = 10): PermanentFinalArenaConfig {
  let bestReport: TerrainCompositionReport | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < FINAL_ARENA_CANDIDATES.length; i++) {
    const cand = FINAL_ARENA_CANDIDATES[i];
    const rep = measureCircularTerrainComposition(
      cand.centerX,
      cand.centerZ,
      cand.radius,
      sampleStep
    );

    const ratioError = Math.abs(rep.landPercent - FINAL_ARENA_TARGET_LAND_PCT);
    let score = 1000 - ratioError * 80 - rep.blockedPercent * 35;
    score += rep.waterConnectivityPercent * 1.5;
    score += rep.landConnectivityPercent * 1.0;
    score += Math.min(80, rep.shorelineCells * 0.4);
    if (rep.fitsInsideSmallestOpeningZone) score += 250;
    if (rep.meetsAllConstraints) score += 500;

    if (score > bestScore) {
      bestScore = score;
      bestReport = rep;
    }
  }

  const chosen = bestReport!;
  return {
    centerX: chosen.centerX,
    centerZ: chosen.centerZ,
    radius: chosen.radius,
    landPercent: chosen.landPercent,
    waterPercent: chosen.waterPercent,
    waterConnectivityPercent: chosen.waterConnectivityPercent,
    landConnectivityPercent: chosen.landConnectivityPercent,
    blockedPercent: chosen.blockedPercent,
    waterSpanX: chosen.waterSpanX,
    waterSpanZ: chosen.waterSpanZ,
    shorelineCells: chosen.shorelineCells,
    report: chosen,
  };
}

/**
 * Cached authoritative permanent 60/40 final arena computed deterministically from the real terrain.
 * Selected shoreline zone: SW Tebing Kering overlooking Jantung Tasik (center 3820, 3560; radius 480).
 */
export const PERMANENT_FINAL_ARENA: PermanentFinalArenaConfig = selectPermanentFinalArena(10);

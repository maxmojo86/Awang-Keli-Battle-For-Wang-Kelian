import {
  isWaterSpawnValid,
  scaleArenaCoord,
  scaleArenaDist,
  WORLD_CENTER,
} from './arena.ts';
import type {
  ActivityHotspot,
  ActivityHotspotKind,
  CarcassEntity,
  KeliEntity,
  LobbySize,
  MatchPhase,
  MatchPacingMetrics,
  ZoneState,
} from './types.ts';

/**
 * Lobby-size-aware pacing configuration.
 * Distinct scales preserve the unique feel of a compact 5-Keli showdown
 * versus a full-scale 100-Keli Wang Kelian survival ecosystem.
 * All zone shrink speeds stay well below Form 1 base swim speed (~158+ u/s)
 * so water-bound Lv.1-39 Kelis always retain viable escape routes.
 */
export interface LobbyPacingProfile {
  readonly lobbySize: LobbySize;
  readonly label: string;
  readonly targetDurationLabel: string;
  readonly initialZoneRadius: number;
  readonly zoneRadii: readonly [number, number, number, number, number];
  readonly initialWarningSec: number;
  readonly phasePauseSec: number;
  readonly preContractionAlertSec: number;
  readonly shrinkSpeed: number;
  readonly spawnMinRadius: number;
  readonly spawnMaxRadius: number;
  readonly minSpawnSeparation: number;
  readonly earlyDurationCapSec: number;
  readonly midAliveFraction: number;
  readonly endgameAliveCount: number;
  readonly endgameTimeSec: number;
  readonly lullThresholdSec: number;
  readonly maxLullAccelMult: number;
}

const LOBBY_PACING_PROFILES: Record<LobbySize, LobbyPacingProfile> = {
  5: {
    lobbySize: 5,
    label: 'Compact Showdown',
    targetDurationLabel: '3–5 min',
    // 1,584u radius (~34% of full basin area) — keeps Tebing Kering & central sectors accessible while focusing action
    initialZoneRadius: scaleArenaDist(560),
    zoneRadii: [
      scaleArenaDist(560),
      scaleArenaDist(425),
      scaleArenaDist(300),
      scaleArenaDist(200),
      scaleArenaDist(125),
    ],
    initialWarningSec: 17,
    phasePauseSec: 18,
    preContractionAlertSec: 8,
    shrinkSpeed: 54,
    spawnMinRadius: 230,
    spawnMaxRadius: 880,
    minSpawnSeparation: 330,
    earlyDurationCapSec: 45,
    midAliveFraction: 0.8,
    endgameAliveCount: 2,
    endgameTimeSec: 115,
    lullThresholdSec: 16,
    maxLullAccelMult: 1.45,
  },
  10: {
    lobbySize: 10,
    label: 'Basin Skirmish',
    targetDurationLabel: '4–6 min',
    initialZoneRadius: scaleArenaDist(640),
    zoneRadii: [
      scaleArenaDist(640),
      scaleArenaDist(485),
      scaleArenaDist(345),
      scaleArenaDist(225),
      scaleArenaDist(135),
    ],
    initialWarningSec: 20,
    phasePauseSec: 20,
    preContractionAlertSec: 8,
    shrinkSpeed: 58,
    spawnMinRadius: 250,
    spawnMaxRadius: 1160,
    minSpawnSeparation: 280,
    earlyDurationCapSec: 55,
    midAliveFraction: 0.72,
    endgameAliveCount: 3,
    endgameTimeSec: 150,
    lullThresholdSec: 18,
    maxLullAccelMult: 1.4,
  },
  20: {
    lobbySize: 20,
    label: 'Balanced Royale',
    targetDurationLabel: '5–8 min',
    initialZoneRadius: scaleArenaDist(735),
    zoneRadii: [
      scaleArenaDist(735),
      scaleArenaDist(565),
      scaleArenaDist(405),
      scaleArenaDist(260),
      scaleArenaDist(145),
    ],
    initialWarningSec: 23,
    phasePauseSec: 23,
    preContractionAlertSec: 8,
    shrinkSpeed: 62,
    spawnMinRadius: 260,
    spawnMaxRadius: 1520,
    minSpawnSeparation: 235,
    earlyDurationCapSec: 65,
    midAliveFraction: 0.68,
    endgameAliveCount: 5,
    endgameTimeSec: 195,
    lullThresholdSec: 20,
    maxLullAccelMult: 1.38,
  },
  25: {
    lobbySize: 25,
    label: 'Standard Royale',
    targetDurationLabel: '5–8 min',
    initialZoneRadius: scaleArenaDist(775),
    zoneRadii: [
      scaleArenaDist(775),
      scaleArenaDist(595),
      scaleArenaDist(425),
      scaleArenaDist(270),
      scaleArenaDist(150),
    ],
    initialWarningSec: 24,
    phasePauseSec: 24,
    preContractionAlertSec: 8,
    shrinkSpeed: 64,
    spawnMinRadius: 260,
    spawnMaxRadius: 1650,
    minSpawnSeparation: 215,
    earlyDurationCapSec: 70,
    midAliveFraction: 0.65,
    endgameAliveCount: 6,
    endgameTimeSec: 210,
    lullThresholdSec: 21,
    maxLullAccelMult: 1.36,
  },
  50: {
    lobbySize: 50,
    label: 'Grand Basin',
    targetDurationLabel: '7–10 min',
    initialZoneRadius: scaleArenaDist(865),
    zoneRadii: [
      scaleArenaDist(865),
      scaleArenaDist(665),
      scaleArenaDist(475),
      scaleArenaDist(295),
      scaleArenaDist(155),
    ],
    initialWarningSec: 27,
    phasePauseSec: 26,
    preContractionAlertSec: 9,
    shrinkSpeed: 66,
    spawnMinRadius: 260,
    spawnMaxRadius: 1960,
    minSpawnSeparation: 175,
    earlyDurationCapSec: 80,
    midAliveFraction: 0.58,
    endgameAliveCount: 10,
    endgameTimeSec: 260,
    lullThresholdSec: 22,
    maxLullAccelMult: 1.34,
  },
  100: {
    lobbySize: 100,
    label: 'Full-Scale Ecosystem',
    targetDurationLabel: '8–12 min',
    initialZoneRadius: scaleArenaDist(960),
    zoneRadii: [
      scaleArenaDist(960),
      scaleArenaDist(735),
      scaleArenaDist(515),
      scaleArenaDist(310),
      scaleArenaDist(160),
    ],
    initialWarningSec: 30,
    phasePauseSec: 28,
    preContractionAlertSec: 9,
    shrinkSpeed: 68,
    spawnMinRadius: 260,
    spawnMaxRadius: 2240,
    minSpawnSeparation: 145,
    earlyDurationCapSec: 90,
    midAliveFraction: 0.5,
    endgameAliveCount: 16,
    endgameTimeSec: 320,
    lullThresholdSec: 24,
    maxLullAccelMult: 1.32,
  },
};

export function getLobbyPacingProfile(lobbySize: LobbySize): LobbyPacingProfile {
  return LOBBY_PACING_PROFILES[lobbySize] ?? LOBBY_PACING_PROFILES[25];
}

export interface SpawnPlacement {
  x: number;
  z: number;
  facingAngle: number;
}

const GOLDEN_ANGLE = 2.399963229728653;
const FALLBACK_WATER_POINT = { x: scaleArenaCoord(860), z: scaleArenaCoord(920) };

/**
 * Generates stratified, distance-aware, seeded water spawn positions inside the initial safe zone.
 * Guarantees:
 * - Strictly accessible water (deep or shallow) respecting Lv.1–39 shore restrictions.
 * - Clear of rocks, Palong posts, outer cliffs, and environmental hazard tiles.
 * - Viable movement escape lanes in multiple cardinal directions.
 * - Non-overlapping spacing so opening encounters happen naturally (~10-30s) without instant spawn-kills.
 * - 100% deterministic for a given `rng` / `matchSeed`.
 */
export function generateFairWaterSpawns(
  count: number,
  profile: LobbyPacingProfile,
  zoneCenterX: number,
  zoneCenterZ: number,
  rng: () => number
): SpawnPlacement[] {
  const placed: SpawnPlacement[] = [];
  const safeMaxR = Math.min(profile.spawnMaxRadius, Math.max(320, profile.initialZoneRadius - 140));
  const minR = Math.min(profile.spawnMinRadius, safeMaxR * 0.45);
  const baseAngleOffset = rng() * Math.PI * 2;

  // Center spawns softly between basin center and safe-zone center so all sectors stay balanced
  const anchorX = (WORLD_CENTER + zoneCenterX) * 0.5;
  const anchorZ = (WORLD_CENTER + zoneCenterZ) * 0.5;

  const isFarEnoughFromPlaced = (x: number, z: number, minSep: number): boolean => {
    const minSepSq = minSep * minSep;
    for (let i = 0; i < placed.length; i++) {
      const dx = x - placed[i].x;
      const dz = z - placed[i].z;
      if (dx * dx + dz * dz < minSepSq) return false;
    }
    return true;
  };

  for (let idx = 0; idx < count; idx++) {
    // Golden-angle Vogel spiral distributes entrants evenly across concentric water rings
    const u = (idx + 0.5) / Math.max(1, count);
    const targetR = minR + Math.sqrt(u) * (safeMaxR - minR);
    const baseTheta = baseAngleOffset + idx * GOLDEN_ANGLE;

    let chosenX: number | null = null;
    let chosenZ: number | null = null;

    // Pass 1..3: gradually relax separation only if needed for dense 100-Keli packing (never < 82u)
    const sepScales = [1.0, 0.82, 0.65];
    for (let pass = 0; pass < sepScales.length && chosenX === null; pass++) {
      const reqSep = Math.max(82, profile.minSpawnSeparation * sepScales[pass]);
      const reqEscape = pass === 0 ? 2 : 1;
      const attempts = pass === 0 ? 28 : 40;

      for (let attempt = 0; attempt < attempts; attempt++) {
        const angleJitter = attempt === 0 ? 0 : (rng() - 0.5) * Math.PI * (0.45 + pass * 0.55);
        const radiusJitter =
          attempt === 0
            ? 0
            : (rng() - 0.5) * Math.min(460, (safeMaxR - minR) * (0.35 + pass * 0.35));
        const r = Math.max(minR * 0.7, Math.min(safeMaxR, targetR + radiusJitter));
        const theta = baseTheta + angleJitter + attempt * 0.31;

        const cx = anchorX + Math.cos(theta) * r;
        const cz = anchorZ + Math.sin(theta) * r;

        // Strictly inside initial safe zone with comfortable escape margin
        if (Math.hypot(cx - zoneCenterX, cz - zoneCenterZ) > profile.initialZoneRadius - 120) {
          continue;
        }
        if (!isWaterSpawnValid(cx, cz, 44, reqEscape)) continue;
        if (!isFarEnoughFromPlaced(cx, cz, reqSep)) continue;

        chosenX = cx;
        chosenZ = cz;
        break;
      }
    }

    // Guaranteed safe fallback inside safe zone if a dense spot was unusually obstructed
    if (chosenX === null || chosenZ === null) {
      let bestX = FALLBACK_WATER_POINT.x;
      let bestZ = FALLBACK_WATER_POINT.z;
      let bestNearestDist = -1;
      for (let attempt = 0; attempt < 64; attempt++) {
        const theta = baseAngleOffset + attempt * GOLDEN_ANGLE + idx * 0.17;
        const r = 140 + rng() * Math.max(200, profile.initialZoneRadius - 260);
        const cx = zoneCenterX + Math.cos(theta) * r;
        const cz = zoneCenterZ + Math.sin(theta) * r;
        if (!isWaterSpawnValid(cx, cz, 36, 1)) continue;

        let nearest = Infinity;
        for (let i = 0; i < placed.length; i++) {
          const d = Math.hypot(cx - placed[i].x, cz - placed[i].z);
          if (d < nearest) nearest = d;
        }
        if (nearest > bestNearestDist) {
          bestNearestDist = nearest;
          bestX = cx;
          bestZ = cz;
          if (nearest >= Math.max(85, profile.minSpawnSeparation * 0.7)) break;
        }
      }
      chosenX = bestX;
      chosenZ = bestZ;
    }

    // Face roughly inward toward the basin with subtle natural variance so opening sightlines feel purposeful
    const inwardAngle = Math.atan2(zoneCenterZ - chosenZ, zoneCenterX - chosenX);
    const facingAngle = inwardAngle + (rng() - 0.5) * 0.9;
    placed.push({ x: chosenX, z: chosenZ, facingAngle });
  }

  return placed;
}

export interface DirectorPublicHotspot {
  x: number;
  z: number;
  kind: ActivityHotspotKind;
  radius: number;
}

export interface DirectorTickResult {
  phase: MatchPhase;
  phaseChanged: boolean;
  zonePaceMultiplier: number;
  zoneWarningJustTriggered: boolean;
  publicHotspots: DirectorPublicHotspot[];
}

const HOTSPOT_COALESCE_RADIUS = 230;
const HOTSPOT_QUANTIZE_STEP = 90;
const MAX_ACTIVE_HOTSPOTS = 4;
const ENCOUNTER_RANGE = 320;
const DEAD_TIME_THREAT_RANGE = 650;

function quantizeCoord(v: number): number {
  return Math.round(v / HOTSPOT_QUANTIZE_STEP) * HOTSPOT_QUANTIZE_STEP;
}

/**
 * Lightweight, fair, deterministic Match Pacing Director & local dev telemetry tracker.
 *
 * Strictly adheres to fairness invariants:
 * - Never spawns fragments, bots, or hidden buffs.
 * - Never alters damage, HP, stamina, or movement speeds.
 * - Never teleports entities or reveals hidden/veiled player coordinates.
 * - Executes once per 1.0s cadence (negligible overhead even at 100 Kelis).
 */
export class MatchPacingDirector {
  public readonly profile: LobbyPacingProfile;
  private readonly matchSeed: number;
  private readonly totalEntrants: number;
  private phase: MatchPhase = 'early';
  private evalAccumSec = 0;
  private lastCombatTime = 0;
  private lastEliminationTime = 0;
  private hotspotSeq = 1;
  private hotspots: ActivityHotspot[] = [];
  private publicHotspotsCache: DirectorPublicHotspot[] = [];
  private zoneWarningSignaledForPhase = 0;

  // Lightweight dev telemetry (in-memory only, zero external reporting)
  private timeToFirstEncounterSec: number | null = null;
  private timeToFirstEliminationSec: number | null = null;
  private encounterCount = 0;
  private lastEncounterTime = -999;
  private encounterIntervalsSum = 0;
  private encounterIntervalsCount = 0;
  private deadTimeSec = 0;
  private contestedCarcassIds = new Set<string>();
  private hotspotsCreated = 0;
  private evolutionMilestonesSec: Partial<Record<20 | 40 | 60 | 80 | 100, number>> = {};
  private phaseTransitionTimesSec: Partial<Record<MatchPhase, number>> = { early: 0 };
  private conclusionCause: string | null = null;
  private lastMatchTime = 0;

  constructor(lobbySize: LobbySize, totalEntrants: number, matchSeed: number) {
    this.profile = getLobbyPacingProfile(lobbySize);
    this.totalEntrants = Math.max(1, totalEntrants);
    this.matchSeed = matchSeed;
  }

  public getPhase(): MatchPhase {
    return this.phase;
  }

  public getActiveHotspots(matchTime: number): ActivityHotspot[] {
    return this.hotspots.filter((h) => h.expiresAt > matchTime);
  }

  public getPublicHotspots(): ReadonlyArray<DirectorPublicHotspot> {
    return this.publicHotspotsCache;
  }

  /**
   * Registers genuine combat contact (only when neither combatant is hidden by Silt Veil).
   * Reveals an approximate quantized zone, never exact coordinates.
   */
  public recordCombatEvent(
    x: number,
    z: number,
    matchTime: number,
    isVeiled: boolean,
    involvesPrimaryPlayer: boolean
  ): void {
    this.lastCombatTime = matchTime;
    if (involvesPrimaryPlayer) {
      this.registerPlayerEncounter(matchTime);
    }
    if (isVeiled) return;
    this.upsertHotspot('combat', x, z, 195, 7.5, matchTime, 'Active Clash');
  }

  /**
   * Registers a genuine elimination & fresh carcass drop.
   */
  public recordElimination(
    x: number,
    z: number,
    droppedMass: number,
    matchTime: number,
    isVeiled: boolean
  ): void {
    this.lastEliminationTime = matchTime;
    this.lastCombatTime = matchTime;
    if (this.timeToFirstEliminationSec === null) {
      this.timeToFirstEliminationSec = Math.round(matchTime * 100) / 100;
    }
    if (isVeiled) return;
    if (droppedMass >= 18) {
      this.upsertHotspot(
        'large_carcass',
        x,
        z,
        215,
        10.5,
        matchTime,
        `High-Value Carcass (+${Math.trunc(droppedMass)})`
      );
    } else {
      this.upsertHotspot('combat', x, z, 185, 7.0, matchTime, 'Recent Takedown');
    }
  }

  /**
   * Registers genuine active contested feeding (2+ Kelis competing over a carcass).
   */
  public recordContestedFeed(
    carcassId: string,
    x: number,
    z: number,
    mass: number,
    matchTime: number,
    allFeedersVeiled: boolean
  ): void {
    this.contestedCarcassIds.add(carcassId);
    this.lastCombatTime = matchTime;
    if (allFeedersVeiled) return;
    this.upsertHotspot(
      'contested_feed',
      x,
      z,
      210,
      8.0,
      matchTime,
      `Contested Feast (+${Math.trunc(mass)})`
    );
  }

  /**
   * Emits an approximate, non-shrinking activity clue hotspot inside the locked final arena.
   */
  public recordActivityClue(
    kind: 'large_carcass' | 'convergence',
    x: number,
    z: number,
    matchTime: number,
    label: string
  ): void {
    this.upsertHotspot(kind, x, z, 240, 9.0, matchTime, label);
  }

  /**
   * Records when any Keli crosses an evolution milestone (20/40/60/80/100) for dev telemetry.
   */
  public recordEvolutionLevel(level: number, matchTime: number): void {
    const thresholds: Array<20 | 40 | 60 | 80 | 100> = [20, 40, 60, 80, 100];
    for (let i = 0; i < thresholds.length; i++) {
      const m = thresholds[i];
      if (level >= m && this.evolutionMilestonesSec[m] === undefined) {
        this.evolutionMilestonesSec[m] = Math.round(matchTime * 100) / 100;
      }
    }
  }

  public recordConclusion(cause: string, matchTime: number): void {
    if (this.conclusionCause === null) {
      this.conclusionCause = cause;
      this.lastMatchTime = matchTime;
    }
  }

  /**
   * Low-frequency (1 Hz) deterministic pacing evaluation.
   * Returns phase transitions, safe zone pace multiplier (1.0 .. maxLullAccelMult),
   * pre-contraction warning trigger, and public activity hotspots for AI/HUD.
   */
  public step(
    dt: number,
    matchTime: number,
    zone: ZoneState,
    kelis: ReadonlyArray<KeliEntity>,
    carcasses: ReadonlyArray<CarcassEntity>,
    primaryPlayerId: string,
    finalFeastActive: boolean
  ): DirectorTickResult {
    this.lastMatchTime = matchTime;

    // Expire old hotspots cheaply
    for (let i = this.hotspots.length - 1; i >= 0; i--) {
      if (this.hotspots[i].expiresAt <= matchTime) {
        this.hotspots.splice(i, 1);
      }
    }

    // Pre-contraction warning flag (clear, predictable notice before zone begins moving)
    let zoneWarningJustTriggered = false;
    if (!finalFeastActive && !zone.isShrinking && zone.phase < 5) {
      const inWarningWindow = zone.warningTimer <= this.profile.preContractionAlertSec;
      zone.warningActive = inWarningWindow;
      if (inWarningWindow && this.zoneWarningSignaledForPhase < zone.phase) {
        this.zoneWarningSignaledForPhase = zone.phase;
        zoneWarningJustTriggered = true;
      }
    } else {
      zone.warningActive = false;
    }

    this.evalAccumSec += dt;
    if (this.evalAccumSec < 1.0) {
      return {
        phase: this.phase,
        phaseChanged: false,
        zonePaceMultiplier: 1.0,
        zoneWarningJustTriggered,
        publicHotspots: this.publicHotspotsCache,
      };
    }

    const evalDt = this.evalAccumSec;
    this.evalAccumSec = 0;

    // Gather lightweight living snapshot (single linear pass, zero allocations)
    let aliveCount = 0;
    let primaryPlayer: KeliEntity | null = null;
    for (let i = 0; i < kelis.length; i++) {
      const k = kelis[i];
      if (!k.alive) continue;
      aliveCount++;
      if (k.id === primaryPlayerId) primaryPlayer = k;
    }

    // Track primary player encounters & dead time (telemetry only — never alters gameplay!)
    let nearestToPlayer = Infinity;
    if (primaryPlayer && primaryPlayer.alive) {
      for (let i = 0; i < kelis.length; i++) {
        const other = kelis[i];
        if (!other.alive || other.id === primaryPlayer.id) continue;
        const d = Math.hypot(other.x - primaryPlayer.x, other.z - primaryPlayer.z);
        if (d < nearestToPlayer) nearestToPlayer = d;
      }
      if (nearestToPlayer <= ENCOUNTER_RANGE) {
        this.registerPlayerEncounter(matchTime);
      }

      let hasNearbyCarcass = false;
      for (let i = 0; i < carcasses.length; i++) {
        const c = carcasses[i];
        if (c.consumed || c.mass <= 0) continue;
        if (Math.hypot(c.x - primaryPlayer.x, c.z - primaryPlayer.z) <= DEAD_TIME_THREAT_RANGE) {
          hasNearbyCarcass = true;
          break;
        }
      }
      if (nearestToPlayer > DEAD_TIME_THREAT_RANGE && !hasNearbyCarcass) {
        this.deadTimeSec += evalDt;
      }
    }

    // Detect genuine convergence hotspot (3+ visible, non-veiled Kelis within 360u of each other)
    // Sampled lightly once per second without per-frame O(N^2) scans
    if (aliveCount >= 3 && !finalFeastActive) {
      const stride = aliveCount > 40 ? 2 : 1;
      for (let i = 0; i < kelis.length; i += stride) {
        const a = kelis[i];
        if (!a.alive || a.veilTimer > 0) continue;
        let clusterCount = 1;
        let sumX = a.x;
        let sumZ = a.z;
        for (let j = i + 1; j < kelis.length; j += stride) {
          const b = kelis[j];
          if (!b.alive || b.veilTimer > 0) continue;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          if (dx * dx + dz * dz <= 360 * 360) {
            clusterCount++;
            sumX += b.x;
            sumZ += b.z;
          }
        }
        if (clusterCount >= 3) {
          this.upsertHotspot(
            'convergence',
            sumX / clusterCount,
            sumZ / clusterCount,
            235,
            8.5,
            matchTime,
            'Predator Convergence'
          );
          break;
        }
      }
    }

    // Highlight genuine large unclaimed carcasses as strategic hotspots (25+ midgame, 12+ during endgame)
    if (!finalFeastActive) {
      const highValueThreshold = this.phase === 'endgame' ? 12 : 25;
      for (let i = 0; i < carcasses.length; i++) {
        const c = carcasses[i];
        if (c.consumed || c.mass < highValueThreshold) continue;
        this.upsertHotspot(
          'large_carcass',
          c.x,
          c.z,
          215,
          9.0,
          matchTime,
          `Rich Carcass (+${Math.trunc(c.mass)})`
        );
      }
    }

    // Formal 3-phase match progression (monotonically Early -> Mid -> Endgame)
    const prevPhase = this.phase;
    const aliveFraction = aliveCount / this.totalEntrants;
    if (this.phase === 'early') {
      if (
        matchTime >= this.profile.earlyDurationCapSec ||
        aliveFraction <= this.profile.midAliveFraction ||
        zone.phase >= 2
      ) {
        this.phase = 'mid';
        this.phaseTransitionTimesSec.mid = Math.round(matchTime * 100) / 100;
      }
    }
    if (this.phase === 'mid') {
      if (
        aliveCount <= this.profile.endgameAliveCount ||
        matchTime >= this.profile.endgameTimeSec ||
        zone.phase >= 4 ||
        finalFeastActive
      ) {
        this.phase = 'endgame';
        this.phaseTransitionTimesSec.endgame = Math.round(matchTime * 100) / 100;
      }
    }

    // Compute gentle, bounded zone pace adjustment when match encounters stall
    let zonePaceMultiplier = 1.0;
    if (!finalFeastActive && !zone.isShrinking && zone.phase < 5 && aliveCount >= 2) {
      const quietSec = matchTime - Math.max(this.lastCombatTime, this.lastEliminationTime);
      // Wait until past opening grace period and leave full pre-contraction warning untouched
      if (
        matchTime > 15 &&
        quietSec >= this.profile.lullThresholdSec &&
        zone.warningTimer > this.profile.preContractionAlertSec
      ) {
        const excess = Math.min(1, (quietSec - this.profile.lullThresholdSec) / 20);
        zonePaceMultiplier = 1 + (this.profile.maxLullAccelMult - 1) * (0.45 + 0.55 * excess);
      }
      // If surviving count is already small relative to the current safe zone, gently tighten wait timer
      if (
        this.phase === 'endgame' &&
        zone.currentRadius > this.profile.zoneRadii[3] &&
        zone.warningTimer > this.profile.preContractionAlertSec
      ) {
        zonePaceMultiplier = Math.max(zonePaceMultiplier, this.profile.maxLullAccelMult);
      }
    }

    // Refresh public hotspot cache for AI & HUD
    this.publicHotspotsCache = this.hotspots.map((h) => ({
      x: h.x,
      z: h.z,
      kind: h.kind,
      radius: h.radius,
    }));

    return {
      phase: this.phase,
      phaseChanged: this.phase !== prevPhase,
      zonePaceMultiplier,
      zoneWarningJustTriggered,
      publicHotspots: this.publicHotspotsCache,
    };
  }

  public getMetrics(): MatchPacingMetrics {
    return {
      lobbySize: this.profile.lobbySize,
      matchSeed: this.matchSeed,
      matchPhase: this.phase,
      totalMatchDurationSec: Math.round(this.lastMatchTime * 100) / 100,
      timeToFirstEncounterSec: this.timeToFirstEncounterSec,
      timeToFirstEliminationSec: this.timeToFirstEliminationSec,
      encounterCount: this.encounterCount,
      avgEncounterIntervalSec:
        this.encounterIntervalsCount > 0
          ? Math.round((this.encounterIntervalsSum / this.encounterIntervalsCount) * 100) / 100
          : null,
      deadTimeSec: Math.round(this.deadTimeSec * 100) / 100,
      contestedCarcassCount: this.contestedCarcassIds.size,
      hotspotsCreated: this.hotspotsCreated,
      evolutionMilestonesSec: { ...this.evolutionMilestonesSec },
      phaseTransitionTimesSec: { ...this.phaseTransitionTimesSec },
      conclusionCause: this.conclusionCause,
    };
  }

  private registerPlayerEncounter(matchTime: number): void {
    if (this.timeToFirstEncounterSec === null) {
      this.timeToFirstEncounterSec = Math.round(matchTime * 100) / 100;
      this.encounterCount = 1;
      this.lastEncounterTime = matchTime;
      return;
    }
    // Separate distinct encounters by at least 6 seconds so one fight doesn't count as 20 encounters
    if (matchTime - this.lastEncounterTime >= 6.0) {
      this.encounterIntervalsSum += matchTime - this.lastEncounterTime;
      this.encounterIntervalsCount += 1;
      this.encounterCount += 1;
      this.lastEncounterTime = matchTime;
    }
  }

  private upsertHotspot(
    kind: ActivityHotspotKind,
    rawX: number,
    rawZ: number,
    radius: number,
    ttlSec: number,
    matchTime: number,
    label: string
  ): void {
    // Quantize coordinates so hotspots show approximate activity zones, never exact player positions
    const qx = quantizeCoord(rawX);
    const qz = quantizeCoord(rawZ);
    const priority =
      kind === 'contested_feed'
        ? 4
        : kind === 'large_carcass'
          ? 3
          : kind === 'convergence'
            ? 2
            : 1;

    for (let i = 0; i < this.hotspots.length; i++) {
      const existing = this.hotspots[i];
      if (Math.hypot(existing.x - qx, existing.z - qz) <= HOTSPOT_COALESCE_RADIUS) {
        const existingPrio =
          existing.kind === 'contested_feed'
            ? 4
            : existing.kind === 'large_carcass'
              ? 3
              : existing.kind === 'convergence'
                ? 2
                : 1;
        if (priority >= existingPrio) {
          existing.kind = kind;
          existing.label = label;
          existing.radius = Math.max(existing.radius, radius);
        }
        existing.expiresAt = Math.max(existing.expiresAt, matchTime + ttlSec);
        existing.intensity = Math.min(1, existing.intensity + 0.25);
        return;
      }
    }

    if (this.hotspots.length >= MAX_ACTIVE_HOTSPOTS) {
      // Replace earliest-expiring hotspot to keep minimap & HUD uncluttered
      let oldestIdx = 0;
      for (let i = 1; i < this.hotspots.length; i++) {
        if (this.hotspots[i].expiresAt < this.hotspots[oldestIdx].expiresAt) {
          oldestIdx = i;
        }
      }
      this.hotspots.splice(oldestIdx, 1);
    }

    this.hotspotsCreated += 1;
    this.hotspots.push({
      id: `hs-${this.hotspotSeq++}`,
      kind,
      x: qx,
      z: qz,
      radius,
      intensity: 0.72,
      createdAt: matchTime,
      expiresAt: matchTime + ttlSec,
      label,
    });
  }
}

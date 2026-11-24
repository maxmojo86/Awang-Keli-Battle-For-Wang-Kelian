import {
  ARENA_SCALE,
  getTerrainAt,
  isPositionAccessible,
  scaleArenaDist,
} from './arena.ts';
import { PERMANENT_FINAL_ARENA } from './finalArena.ts';
import type {
  CarcassEntity,
  EndgameStateSnapshot,
  EndgameSubstate,
  KeliEntity,
  LobbySize,
  MatchPhase,
  ZoneState,
} from './types.ts';

/**
 * Monotonic progression rank of formal endgame substates.
 * Guarantees no backward oscillations, no duplicate substate transitions,
 * and deterministic rejection of stale out-of-order multiplayer packets.
 */
export const ENDGAME_SUBSTATE_RANK: Record<EndgameSubstate, number> = {
  none: 0,
  final_convergence: 1,
  final_hunt: 2,
  final_feast: 3,
  keli_king_victory: 4,
};

/**
 * Thresholds & bounds for safe endgame arena management.
 * The permanent 60% dry land / 40% water final arena radius (480u) acts as the
 * immutable contraction floor. Once locked, contraction never resumes.
 */
export const ENDGAME_HIGH_VALUE_CARCASS_MASS = 12;
export const ENDGAME_MIN_VIABLE_BASE_RADIUS = scaleArenaDist(92); // ~260u historical base floor
export const ENDGAME_PERMANENT_FINAL_RADIUS = PERMANENT_FINAL_ARENA.radius; // 480u permanent 60/40 arena
export const ENDGAME_TIGHTEN_SPEED = Math.round(16 * ARENA_SCALE); // ~45 u/s (< 30% of Form 1 swim speed)
export const ENDGAME_STALEMATE_QUIET_SEC = 14;
export const ENDGAME_STALEMATE_INFO_INTERVAL_SEC = 12;
export const ENDGAME_TIGHTEN_WARNING_SEC = 6.0;
export const ENDGAME_TIGHTEN_STEP_RADIUS = scaleArenaDist(28); // ~79u per gradual tightening step down to final floor

export interface SafeZoneNavigabilityReport {
  safeWaterVerified: boolean;
  waterSampleCount: number;
  openWaterCenterDist: number;
  minViableRadius: number;
}

/**
 * Evaluates whether a circular safe zone centered at (centerX, centerZ) with given radius
 * contains enough obstacle-free, water-bound navigable area for Lv.1-39 Kelis (while preserving
 * shore-reserve and amphibious routes for Lv.40+ and Lv.80+).
 * Zero heap allocations; O(1) fixed 24-point radial grid check.
 */
export function verifySafeZoneNavigability(
  centerX: number,
  centerZ: number,
  radius: number
): SafeZoneNavigabilityReport {
  let waterSampleCount = 0;
  let nearestWaterDist = Infinity;

  if (
    getTerrainAt(centerX, centerZ) !== 'shore' &&
    isPositionAccessible(centerX, centerZ, 24, false)
  ) {
    waterSampleCount += 1;
    nearestWaterDist = 0;
  }

  const usableR = Math.max(40, radius - 28);
  const rings = [0.3, 0.62, 0.88];
  for (let rIdx = 0; rIdx < rings.length; rIdx++) {
    const r = usableR * rings[rIdx];
    for (let aIdx = 0; aIdx < 8; aIdx++) {
      const ang = (aIdx * Math.PI) / 4 + rIdx * 0.22;
      const px = centerX + Math.cos(ang) * r;
      const pz = centerZ + Math.sin(ang) * r;
      if (getTerrainAt(px, pz) !== 'shore' && isPositionAccessible(px, pz, 24, false)) {
        waterSampleCount += 1;
        if (r < nearestWaterDist) nearestWaterDist = r;
      }
    }
  }

  const safeWaterVerified = waterSampleCount >= 6;
  return {
    safeWaterVerified,
    waterSampleCount,
    openWaterCenterDist: Number.isFinite(nearestWaterDist) ? nearestWaterDist : radius,
    minViableRadius: safeWaterVerified ? Math.max(ENDGAME_PERMANENT_FINAL_RADIUS, radius) : radius,
  };
}

/**
 * Computes the minimum safe-zone radius around (centerX, centerZ) that respects BOTH
 * the permanent 60% land / 40% water final arena floor (480u) AND valid navigable water routes
 * for Lv.1-39 aquatic Kelis.
 */
export function computeMinViableSafeZoneRadius(
  centerX: number,
  centerZ: number,
  floorRadius = ENDGAME_PERMANENT_FINAL_RADIUS
): number {
  const startR = Math.max(
    ENDGAME_MIN_VIABLE_BASE_RADIUS,
    ENDGAME_PERMANENT_FINAL_RADIUS,
    floorRadius
  );
  for (let r = startR; r <= startR + scaleArenaDist(180); r += scaleArenaDist(16)) {
    const rep = verifySafeZoneNavigability(centerX, centerZ, r);
    if (rep.safeWaterVerified) {
      return Math.round(r);
    }
  }
  return Math.round(startR + scaleArenaDist(120));
}

export function createInitialEndgameState(
  aliveCount: number,
  minViableRadius = ENDGAME_PERMANENT_FINAL_RADIUS
): EndgameStateSnapshot {
  return {
    substate: 'none',
    transitionSeq: 0,
    aliveCount,
    remainingUnclaimedFragments: 0,
    highValueCarcassCount: 0,
    contestedCarcassActive: false,
    tensionIntensity: 0,
    safeWaterVerified: true,
    minViableRadius,
    stalemateQuietSec: 0,
    endgameShrinkPending: false,
    finalZoneLocked: false,
    finalZoneLockSeq: 0,
    finalLandPercent: PERMANENT_FINAL_ARENA.landPercent,
    finalWaterPercent: PERMANENT_FINAL_ARENA.waterPercent,
    stalemateInfoPulseSeq: 0,
    stalemateClueLabel: null,
    announcementTitle: null,
    announcementSubtitle: null,
    announcementSeq: 0,
  };
}

export interface EndgameStepInput {
  dt: number;
  matchTime: number;
  mode: 'royale' | 'tutorial';
  matchPhase: MatchPhase;
  lobbySize: LobbySize;
  endgameAliveThreshold: number;
  kelis: ReadonlyArray<KeliEntity>;
  carcasses: ReadonlyArray<CarcassEntity>;
  zone: ZoneState;
  finalFeastActive: boolean;
  matchConcluded: boolean;
  winnerId: string | null;
}

export interface EndgameStepOutput {
  state: EndgameStateSnapshot;
  substateJustChanged: boolean;
  previousSubstate: EndgameSubstate;
  newSubstate: EndgameSubstate;
  shouldTightenZone: boolean;
  nextTightenTargetRadius: number | null;
  tightenWarningJustTriggered: boolean;
  shouldEmitDistantCall: boolean;
  finalZoneJustLocked: boolean;
  stalemateInfoPulseJustTriggered: boolean;
}

/**
 * Formal, monotonic Endgame Director extending MatchPacingDirector without replacing it.
 *
 * Manages:
 * - FINAL_CONVERGENCE -> FINAL_HUNT -> FINAL_FEAST -> KELI_KING_VICTORY
 * - Permanent single-fire locking of the 60% dry land / 40% water final arena
 * - Fair non-shrinking stalemate information pressure once the final arena is locked
 */
export class EndgameDirector {
  private substate: EndgameSubstate = 'none';
  private transitionSeq = 0;
  private announcementSeq = 0;
  private announcementTitle: string | null = null;
  private announcementSubtitle: string | null = null;
  private tensionIntensity = 0;
  private minViableRadius: number;
  private safeWaterVerified = true;
  private lastActionTime = 0;
  private stalemateQuietSec = 0;
  private tightenWarningTimer = 0;
  private tightenWarningSignaled = false;
  private distantCallCooldown = 7.5;
  private evalAccumSec = 0;
  private finalZoneLocked = false;
  private finalZoneLockSeq = 0;
  private stalemateInfoPulseSeq = 0;
  private stalemateInfoCooldown = 0;
  private stalemateClueLabel: string | null = null;
  private lastSnapshot: EndgameStateSnapshot;
  private transitionTimesSec: Partial<Record<EndgameSubstate, number>> = {};

  constructor(initialAliveCount: number, zoneCenterX: number, zoneCenterZ: number) {
    this.minViableRadius = computeMinViableSafeZoneRadius(zoneCenterX, zoneCenterZ);
    this.lastSnapshot = createInitialEndgameState(initialAliveCount, this.minViableRadius);
  }

  public getState(): EndgameStateSnapshot {
    return this.lastSnapshot;
  }

  public getSubstate(): EndgameSubstate {
    return this.substate;
  }

  public getMinViableRadius(): number {
    return this.minViableRadius;
  }

  public isFinalZoneLocked(): boolean {
    return this.finalZoneLocked;
  }

  public getTransitionTimes(): Partial<Record<EndgameSubstate, number>> {
    return { ...this.transitionTimesSec };
  }

  /**
   * Records genuine combat, feeding, or elimination activity to reset stalemate quiet timers.
   */
  public recordEngagement(matchTime: number): void {
    this.lastActionTime = Math.max(this.lastActionTime, matchTime);
    this.stalemateQuietSec = 0;
    this.stalemateClueLabel = null;
  }

  /**
   * Single-fire authoritative lock once the permanent 60% land / 40% water arena is reached.
   * Permanently halts all safe-zone contraction and freezes center + radius for the rest of the match.
   */
  public lockFinalZone(matchTime: number, zone: ZoneState): boolean {
    if (this.finalZoneLocked) {
      // Enforce immutable freeze
      zone.finalZoneLocked = true;
      zone.isShrinking = false;
      zone.warningActive = false;
      return false;
    }

    this.finalZoneLocked = true;
    this.finalZoneLockSeq += 1;
    this.tightenWarningTimer = 0;
    this.tightenWarningSignaled = false;

    const lockedCenterX = zone.finalCenterX ?? PERMANENT_FINAL_ARENA.centerX;
    const lockedCenterZ = zone.finalCenterZ ?? PERMANENT_FINAL_ARENA.centerZ;
    const lockedRadius = Math.max(
      ENDGAME_PERMANENT_FINAL_RADIUS,
      zone.finalRadius ?? PERMANENT_FINAL_ARENA.radius
    );

    zone.centerX = lockedCenterX;
    zone.centerZ = lockedCenterZ;
    zone.currentRadius = lockedRadius;
    zone.targetRadius = lockedRadius;
    zone.isShrinking = false;
    zone.warningActive = false;
    zone.warningTimer = 0;
    zone.finalZoneLocked = true;
    zone.finalCenterX = lockedCenterX;
    zone.finalCenterZ = lockedCenterZ;
    zone.finalRadius = lockedRadius;
    zone.finalLandPercent = PERMANENT_FINAL_ARENA.landPercent;
    zone.finalWaterPercent = PERMANENT_FINAL_ARENA.waterPercent;

    this.minViableRadius = lockedRadius;
    this.lastActionTime = Math.max(this.lastActionTime, matchTime);
    this.stalemateQuietSec = 0;

    if (this.substate !== 'keli_king_victory') {
      this.announcementSeq += 1;
      this.announcementTitle = 'FINAL ARENA LOCKED';
      this.announcementSubtitle = `${Math.round(PERMANENT_FINAL_ARENA.landPercent)}% Land · ${Math.round(PERMANENT_FINAL_ARENA.waterPercent)}% Water · Boundary Permanent`;
    }

    this.lastSnapshot = {
      ...this.lastSnapshot,
      finalZoneLocked: true,
      finalZoneLockSeq: this.finalZoneLockSeq,
      minViableRadius: this.minViableRadius,
      endgameShrinkPending: false,
      announcementTitle: this.announcementTitle,
      announcementSubtitle: this.announcementSubtitle,
      announcementSeq: this.announcementSeq,
    };

    return true;
  }

  /**
   * Immediately records authoritative Level 100 victory (monotonic, single-fire).
   */
  public markVictory(matchTime: number, winnerName: string, aliveCount: number): boolean {
    if (this.substate === 'keli_king_victory') return false;
    this.substate = 'keli_king_victory';
    this.transitionSeq += 1;
    this.announcementSeq += 1;
    this.announcementTitle = 'KELI KING ASCENDED';
    this.announcementSubtitle = `${winnerName} reunited all 100 evolution fragments`;
    this.transitionTimesSec.keli_king_victory = Math.round(matchTime * 100) / 100;
    this.tensionIntensity = 1;
    this.tightenWarningTimer = 0;
    this.tightenWarningSignaled = false;
    this.stalemateClueLabel = null;
    this.lastSnapshot = {
      ...this.lastSnapshot,
      substate: 'keli_king_victory',
      transitionSeq: this.transitionSeq,
      aliveCount,
      remainingUnclaimedFragments: 0,
      highValueCarcassCount: 0,
      contestedCarcassActive: false,
      tensionIntensity: 1,
      stalemateQuietSec: 0,
      endgameShrinkPending: false,
      finalZoneLocked: this.finalZoneLocked,
      finalZoneLockSeq: this.finalZoneLockSeq,
      stalemateInfoPulseSeq: this.stalemateInfoPulseSeq,
      stalemateClueLabel: null,
      announcementTitle: this.announcementTitle,
      announcementSubtitle: this.announcementSubtitle,
      announcementSeq: this.announcementSeq,
    };
    return true;
  }

  public step(input: EndgameStepInput): EndgameStepOutput {
    const {
      dt,
      matchTime,
      mode,
      matchPhase,
      endgameAliveThreshold,
      kelis,
      carcasses,
      zone,
      finalFeastActive,
      matchConcluded,
      winnerId,
    } = input;

    const prevSubstate = this.substate;
    let shouldTightenZone = false;
    let nextTightenTargetRadius: number | null = null;
    let tightenWarningJustTriggered = false;
    let shouldEmitDistantCall = false;
    let finalZoneJustLocked = false;
    let stalemateInfoPulseJustTriggered = false;

    if (mode === 'tutorial') {
      return {
        state: this.lastSnapshot,
        substateJustChanged: false,
        previousSubstate: prevSubstate,
        newSubstate: this.substate,
        shouldTightenZone: false,
        nextTightenTargetRadius: null,
        tightenWarningJustTriggered: false,
        shouldEmitDistantCall: false,
        finalZoneJustLocked: false,
        stalemateInfoPulseJustTriggered: false,
      };
    }

    // Sync lock flag if zone was locked externally
    if (zone.finalZoneLocked && !this.finalZoneLocked) {
      finalZoneJustLocked = this.lockFinalZone(matchTime, zone);
    }

    // Enforce immutable boundary whenever locked
    if (this.finalZoneLocked) {
      zone.finalZoneLocked = true;
      zone.isShrinking = false;
      zone.warningActive = false;
      this.tightenWarningTimer = 0;
      this.tightenWarningSignaled = false;
    }

    const targetTension =
      this.substate === 'keli_king_victory'
        ? 1.0
        : this.substate === 'final_hunt'
          ? 0.92
          : this.substate === 'final_feast'
            ? 0.45
            : this.substate === 'final_convergence'
              ? 0.52
              : 0;
    this.tensionIntensity += (targetTension - this.tensionIntensity) * Math.min(1, dt * 1.8);

    if (this.substate === 'final_hunt' && !matchConcluded) {
      this.distantCallCooldown -= dt;
      if (this.distantCallCooldown <= 0) {
        this.distantCallCooldown = 12.5;
        shouldEmitDistantCall = true;
      }
    }

    if (this.stalemateInfoCooldown > 0) {
      this.stalemateInfoCooldown = Math.max(0, this.stalemateInfoCooldown - dt);
    }

    // Pre-lock Phase 5 tightening ONLY while currentRadius is still strictly above the permanent 60/40 floor.
    // Once finalZoneLocked is true, contraction NEVER resumes.
    if (
      !this.finalZoneLocked &&
      this.tightenWarningTimer > 0 &&
      !finalFeastActive &&
      !matchConcluded &&
      !zone.isShrinking &&
      zone.phase >= 5
    ) {
      this.tightenWarningTimer = Math.max(0, this.tightenWarningTimer - dt);
      zone.warningActive = true;
      zone.warningTimer = this.tightenWarningTimer;
      if (this.tightenWarningTimer <= 0) {
        const nextR = Math.max(
          this.minViableRadius,
          zone.currentRadius - ENDGAME_TIGHTEN_STEP_RADIUS
        );
        if (nextR < zone.currentRadius - 2) {
          shouldTightenZone = true;
          nextTightenTargetRadius = nextR;
        }
        this.tightenWarningSignaled = false;
        this.lastActionTime = matchTime;
        this.stalemateQuietSec = 0;
      }
    }

    this.evalAccumSec += dt;
    const forceEval =
      matchConcluded ||
      finalZoneJustLocked ||
      finalFeastActive !== (this.substate === 'final_feast') ||
      this.evalAccumSec >= 0.25;

    if (!forceEval) {
      this.lastSnapshot.tensionIntensity = Math.round(this.tensionIntensity * 1000) / 1000;
      return {
        state: this.lastSnapshot,
        substateJustChanged: false,
        previousSubstate: prevSubstate,
        newSubstate: this.substate,
        shouldTightenZone,
        nextTightenTargetRadius,
        tightenWarningJustTriggered,
        shouldEmitDistantCall,
        finalZoneJustLocked,
        stalemateInfoPulseJustTriggered,
      };
    }
    this.evalAccumSec = 0;

    let aliveCount = 0;
    let hasWaterBoundSurvivor = false;
    let kingWinner: KeliEntity | null = null;
    for (let i = 0; i < kelis.length; i++) {
      const k = kelis[i];
      if (!k.alive) continue;
      aliveCount += 1;
      if (k.level < 40) hasWaterBoundSurvivor = true;
      if (Math.trunc(k.level) >= 100) kingWinner = k;
    }

    let remainingUnclaimedFragments = 0;
    let highValueCarcassCount = 0;
    let contestedCarcassActive = false;

    for (let i = 0; i < carcasses.length; i++) {
      const c = carcasses[i];
      if (c.consumed || c.mass <= 0) continue;
      remainingUnclaimedFragments += Math.trunc(c.mass);
      if (c.mass >= ENDGAME_HIGH_VALUE_CARCASS_MASS) {
        highValueCarcassCount += 1;
      }
    }

    let firstFeedTarget: string | null = null;
    for (let i = 0; i < kelis.length; i++) {
      const k = kelis[i];
      if (!k.alive || !k.feedingTargetId) continue;
      if (firstFeedTarget === null) {
        firstFeedTarget = k.feedingTargetId;
      } else if (firstFeedTarget === k.feedingTargetId) {
        contestedCarcassActive = true;
        break;
      }
    }

    const navCheck = verifySafeZoneNavigability(zone.centerX, zone.centerZ, zone.currentRadius);
    this.safeWaterVerified = navCheck.safeWaterVerified || !hasWaterBoundSurvivor;

    let desiredSubstate: EndgameSubstate = this.substate;
    if ((matchConcluded && winnerId !== null) || kingWinner !== null) {
      desiredSubstate = 'keli_king_victory';
    } else if (finalFeastActive && aliveCount === 1) {
      desiredSubstate = 'final_feast';
    } else if (!matchConcluded && aliveCount >= 2 && aliveCount <= 3) {
      desiredSubstate = 'final_hunt';
    } else if (
      !matchConcluded &&
      aliveCount >= 4 &&
      (matchPhase === 'endgame' || aliveCount <= Math.max(4, endgameAliveThreshold))
    ) {
      desiredSubstate = 'final_convergence';
    }

    let substateJustChanged = false;
    if (ENDGAME_SUBSTATE_RANK[desiredSubstate] > ENDGAME_SUBSTATE_RANK[this.substate]) {
      this.substate = desiredSubstate;
      this.transitionSeq += 1;
      substateJustChanged = true;
      this.transitionTimesSec[desiredSubstate] = Math.round(matchTime * 100) / 100;

      if (desiredSubstate === 'final_convergence') {
        this.announcementSeq += 1;
        this.announcementTitle = 'FINAL CONVERGENCE';
        this.announcementSubtitle = `${aliveCount} Kelis remain · Converging on the 60/40 shoreline arena`;
      } else if (desiredSubstate === 'final_hunt') {
        this.announcementSeq += 1;
        this.announcementTitle = 'FINAL HUNT';
        this.announcementSubtitle =
          aliveCount === 2
            ? '2 Apex Kelis Remain · Claim the Final Fragments'
            : `${aliveCount} Kelis Remain · The Final Confrontation Begins`;
        this.distantCallCooldown = 4.5;
      } else if (desiredSubstate === 'final_feast') {
        this.announcementSeq += 1;
        this.announcementTitle = 'FINAL FEAST';
        this.announcementSubtitle = `${remainingUnclaimedFragments} fragments remain to ascend as Keli King`;
        this.tightenWarningTimer = 0;
        this.tightenWarningSignaled = false;
      } else if (desiredSubstate === 'keli_king_victory') {
        this.announcementSeq += 1;
        this.announcementTitle = 'KELI KING ASCENDED';
        this.announcementSubtitle = `${kingWinner?.name ?? 'Champion'} reunited all 100 evolution fragments`;
        this.tightenWarningTimer = 0;
        this.tightenWarningSignaled = false;
      }
    }

    // Stalemate handling:
    // Case A (BEFORE final arena lock): gradual tightening ONLY down to permanent 60/40 floor.
    // Case B (AFTER final arena lock): NEVER shrink — emit fair non-exact information pressure instead!
    if (
      !matchConcluded &&
      !finalFeastActive &&
      aliveCount >= 2 &&
      (this.substate === 'final_convergence' || this.substate === 'final_hunt')
    ) {
      this.stalemateQuietSec = Math.max(0, matchTime - this.lastActionTime);

      if (this.finalZoneLocked) {
        if (
          this.stalemateQuietSec >= ENDGAME_STALEMATE_QUIET_SEC &&
          this.stalemateInfoCooldown <= 0
        ) {
          this.stalemateInfoCooldown = ENDGAME_STALEMATE_INFO_INTERVAL_SEC;
          this.stalemateInfoPulseSeq += 1;
          this.stalemateClueLabel =
            highValueCarcassCount > 0
              ? 'Rich fragment cache detected in final arena'
              : 'Ripples stir across the locked shoreline sector';
          stalemateInfoPulseJustTriggered = true;
        }
      } else if (
        zone.phase >= 5 &&
        !zone.isShrinking &&
        this.tightenWarningTimer <= 0 &&
        zone.currentRadius > this.minViableRadius + 16 &&
        this.stalemateQuietSec >= ENDGAME_STALEMATE_QUIET_SEC
      ) {
        this.tightenWarningTimer = ENDGAME_TIGHTEN_WARNING_SEC;
        zone.warningActive = true;
        zone.warningTimer = this.tightenWarningTimer;
        if (!this.tightenWarningSignaled) {
          this.tightenWarningSignaled = true;
          tightenWarningJustTriggered = true;
        }
      }
    } else {
      this.stalemateQuietSec = 0;
    }

    this.lastSnapshot = {
      substate: this.substate,
      transitionSeq: this.transitionSeq,
      aliveCount,
      remainingUnclaimedFragments,
      highValueCarcassCount,
      contestedCarcassActive,
      tensionIntensity: Math.round(this.tensionIntensity * 1000) / 1000,
      safeWaterVerified: this.safeWaterVerified,
      minViableRadius: this.minViableRadius,
      stalemateQuietSec: Math.round(this.stalemateQuietSec * 10) / 10,
      endgameShrinkPending: !this.finalZoneLocked && this.tightenWarningTimer > 0,
      finalZoneLocked: this.finalZoneLocked,
      finalZoneLockSeq: this.finalZoneLockSeq,
      finalLandPercent: PERMANENT_FINAL_ARENA.landPercent,
      finalWaterPercent: PERMANENT_FINAL_ARENA.waterPercent,
      stalemateInfoPulseSeq: this.stalemateInfoPulseSeq,
      stalemateClueLabel: this.stalemateClueLabel,
      announcementTitle: this.announcementTitle,
      announcementSubtitle: this.announcementSubtitle,
      announcementSeq: this.announcementSeq,
    };

    return {
      state: this.lastSnapshot,
      substateJustChanged,
      previousSubstate: prevSubstate,
      newSubstate: this.substate,
      shouldTightenZone,
      nextTightenTargetRadius,
      tightenWarningJustTriggered,
      shouldEmitDistantCall,
      finalZoneJustLocked,
      stalemateInfoPulseJustTriggered,
    };
  }
}

/**
 * Authoritative client-side synchronization guard for multiplayer matches.
 * Prevents stale out-of-order packets from reverting endgame substates,
 * unlocking a locked permanent final zone, duplicating announcements, or replaying victory sequences.
 */
export class EndgamePresentationGuard {
  private lastPacketTick = -1;
  private highestRank = 0;
  private highestTransitionSeq = 0;
  private highestLockSeq = 0;
  private finalZoneLocked = false;
  private lastAnnouncedSeq = 0;
  private victoryLocked = false;
  private latestState: EndgameStateSnapshot = createInitialEndgameState(0);

  public reset(): void {
    this.lastPacketTick = -1;
    this.highestRank = 0;
    this.highestTransitionSeq = 0;
    this.highestLockSeq = 0;
    this.finalZoneLocked = false;
    this.lastAnnouncedSeq = 0;
    this.victoryLocked = false;
    this.latestState = createInitialEndgameState(0);
  }

  public getState(): EndgameStateSnapshot {
    return this.latestState;
  }

  public isVictoryLocked(): boolean {
    return this.victoryLocked;
  }

  public isFinalZoneLocked(): boolean {
    return this.finalZoneLocked;
  }

  public ingest(
    packetTick: number,
    incoming: EndgameStateSnapshot | undefined,
    matchStatus: 'playing' | 'victory' | 'defeat' | 'draw'
  ): {
    accepted: boolean;
    state: EndgameStateSnapshot;
    newAnnouncement: { title: string; subtitle: string } | null;
    victoryJustLocked: boolean;
    finalZoneJustLocked: boolean;
  } {
    if (packetTick < this.lastPacketTick) {
      return {
        accepted: false,
        state: this.latestState,
        newAnnouncement: null,
        victoryJustLocked: false,
        finalZoneJustLocked: false,
      };
    }
    this.lastPacketTick = packetTick;

    if (!incoming) {
      return {
        accepted: true,
        state: this.latestState,
        newAnnouncement: null,
        victoryJustLocked: false,
        finalZoneJustLocked: false,
      };
    }

    const incomingRank = ENDGAME_SUBSTATE_RANK[incoming.substate] ?? 0;

    if (
      incomingRank < this.highestRank ||
      incoming.transitionSeq < this.highestTransitionSeq ||
      (this.finalZoneLocked && !incoming.finalZoneLocked) ||
      (incoming.finalZoneLockSeq ?? 0) < this.highestLockSeq ||
      (this.victoryLocked && incoming.substate !== 'keli_king_victory')
    ) {
      return {
        accepted: false,
        state: this.latestState,
        newAnnouncement: null,
        victoryJustLocked: false,
        finalZoneJustLocked: false,
      };
    }

    this.highestRank = incomingRank;
    this.highestTransitionSeq = incoming.transitionSeq;

    let finalZoneJustLocked = false;
    if (!this.finalZoneLocked && incoming.finalZoneLocked) {
      this.finalZoneLocked = true;
      this.highestLockSeq = Math.max(this.highestLockSeq, incoming.finalZoneLockSeq ?? 1);
      finalZoneJustLocked = true;
    }

    let newAnnouncement: { title: string; subtitle: string } | null = null;
    if (
      incoming.announcementSeq > this.lastAnnouncedSeq &&
      incoming.announcementTitle &&
      incoming.announcementSubtitle
    ) {
      this.lastAnnouncedSeq = incoming.announcementSeq;
      newAnnouncement = {
        title: incoming.announcementTitle,
        subtitle: incoming.announcementSubtitle,
      };
    }

    let victoryJustLocked = false;
    if (
      !this.victoryLocked &&
      (incoming.substate === 'keli_king_victory' ||
        matchStatus === 'victory' ||
        matchStatus === 'defeat' ||
        matchStatus === 'draw')
    ) {
      this.victoryLocked = true;
      victoryJustLocked = incoming.substate === 'keli_king_victory';
    }

    this.latestState = { ...incoming };

    return {
      accepted: true,
      state: this.latestState,
      newAnnouncement,
      victoryJustLocked,
      finalZoneJustLocked,
    };
  }
}

import { getEvolutionForm, getFormLabel } from '../data/abilities';
import { EvolutionForm, HudSnapshot, KeliEntity } from './types';

export interface ReplayFrame {
  t: number;
  x: number;
  z: number;
  facingAngle: number;
  level: number;
  form: EvolutionForm;
  alive: boolean;
  kills: number;
  zoneName: string;
  zoneCenterX: number;
  zoneCenterZ: number;
  zoneRadius: number;
  inSafeZone: boolean;
  isOnShore: boolean;
}

export type ReplayEventKind =
  | 'spawn'
  | 'fragment'
  | 'evolution'
  | 'kill'
  | 'death'
  | 'victory';

export interface ReplayEvent {
  id: string;
  t: number;
  kind: ReplayEventKind;
  x: number;
  z: number;
  level: number;
  deltaFragments: number;
  label: string;
  detail: string;
  zoneName: string;
}

export interface MatchReplayData {
  lobbySize: number;
  mode: 'royale' | 'tutorial';
  playerName: string;
  duration: number;
  startLevel: number;
  peakLevel: number;
  totalFragmentsGained: number;
  totalDistance: number;
  zonesVisited: string[];
  frames: ReplayFrame[];
  events: ReplayEvent[];
}

export class MatchReplayRecorder {
  private frames: ReplayFrame[] = [];
  private events: ReplayEvent[] = [];
  private zonesVisited: string[] = [];
  private zoneSet = new Set<string>();

  private initialized = false;
  private startLevel = 1;
  private peakLevel = 1;
  private totalFragmentsGained = 0;
  private totalDistance = 0;
  private lastSampleTime = -1;
  private lastLevel = 1;
  private lastForm: EvolutionForm = 1;
  private lastKills = 0;
  private lastAlive = true;
  private lastX = 0;
  private lastZ = 0;
  private lastZonePhase = 1;
  private outcomeRecorded = false;
  private seq = 1;

  private lobbySize = 20;
  private mode: 'royale' | 'tutorial' = 'royale';
  private playerName = 'Awang';

  public reset() {
    this.frames = [];
    this.events = [];
    this.zonesVisited = [];
    this.zoneSet.clear();
    this.initialized = false;
    this.startLevel = 1;
    this.peakLevel = 1;
    this.totalFragmentsGained = 0;
    this.totalDistance = 0;
    this.lastSampleTime = -1;
    this.lastLevel = 1;
    this.lastForm = 1;
    this.lastKills = 0;
    this.lastAlive = true;
    this.lastX = 0;
    this.lastZ = 0;
    this.lastZonePhase = 1;
    this.outcomeRecorded = false;
    this.seq = 1;
  }

  private pushZone(zoneName: string) {
    if (!zoneName || this.zoneSet.has(zoneName)) return;
    this.zoneSet.add(zoneName);
    this.zonesVisited.push(zoneName);
  }

  private pushEvent(ev: Omit<ReplayEvent, 'id'>) {
    this.events.push({
      id: `rev-${this.seq++}`,
      ...ev,
    });
  }

  public record(snap: HudSnapshot, liveEntity?: KeliEntity | null) {
    const px = liveEntity ? liveEntity.x : snap.player.x;
    const pz = liveEntity ? liveEntity.z : snap.player.z;
    const facing = liveEntity ? liveEntity.facingAngle : snap.player.facingAngle;
    const alive = liveEntity ? liveEntity.alive : snap.player.alive;
    const level = liveEntity ? liveEntity.level : snap.player.level;
    const form = getEvolutionForm(level);
    const kills = liveEntity ? liveEntity.kills : snap.player.kills;
    const isOnShore = liveEntity ? liveEntity.isOnShore : snap.player.isOnShore;
    const t = Math.max(0, snap.matchTime);
    const zoneName = snap.player.zoneName;
    const inSafeZone =
      Math.hypot(px - snap.zone.centerX, pz - snap.zone.centerZ) <= snap.zone.currentRadius;

    if (!this.initialized) {
      this.initialized = true;
      this.lobbySize = snap.lobbySize;
      this.mode = snap.mode;
      this.playerName = snap.player.name;
      this.startLevel = level;
      this.peakLevel = level;
      this.lastLevel = level;
      this.lastForm = form;
      this.lastKills = kills;
      this.lastAlive = alive;
      this.lastX = px;
      this.lastZ = pz;
      this.lastZonePhase = snap.zone.phase;
      this.lastSampleTime = t;
      this.pushZone(zoneName);

      this.frames.push({
        t,
        x: Math.round(px * 10) / 10,
        z: Math.round(pz * 10) / 10,
        facingAngle: facing,
        level,
        form,
        alive,
        kills,
        zoneName,
        zoneCenterX: snap.zone.centerX,
        zoneCenterZ: snap.zone.centerZ,
        zoneRadius: snap.zone.currentRadius,
        inSafeZone,
        isOnShore,
      });

      this.pushEvent({
        t,
        kind: 'spawn',
        x: px,
        z: pz,
        level,
        deltaFragments: 0,
        label: `Entered Basin (Lv.${level})`,
        detail: `${zoneName} · ${snap.lobbySize} Kelis`,
        zoneName,
      });
      return;
    }

    // Stop recording movement trail once eliminated (except final outcome marker)
    if (!this.lastAlive && !alive) {
      if (!this.outcomeRecorded && snap.matchResult.status !== 'playing') {
        this.outcomeRecorded = true;
      }
      return;
    }

    const stepDist = Math.hypot(px - this.lastX, pz - this.lastZ);
    if (this.lastAlive && stepDist < 420) {
      this.totalDistance += stepDist;
    }

    if (alive) {
      this.pushZone(zoneName);
    }

    if (level > this.peakLevel) {
      this.peakLevel = level;
    }

    let forceSample = false;

    if (level > this.lastLevel) {
      const delta = level - this.lastLevel;
      this.totalFragmentsGained += delta;
      forceSample = true;

      // Match recent mass ledger entry for descriptive feed/kill label
      const recentLedger = [...snap.matchResult.ledger]
        .reverse()
        .find(
          (entry) =>
            Math.abs(entry.time - t) <= 1.2 &&
            entry.actorName === this.playerName &&
            (entry.type === 'feed' || entry.type === 'kill')
        );

      this.pushEvent({
        t,
        kind: 'fragment',
        x: px,
        z: pz,
        level,
        deltaFragments: delta,
        label: `+${delta} Fragment${delta > 1 ? 's' : ''} (Lv.${level})`,
        detail: recentLedger
          ? `${recentLedger.type === 'feed' ? 'Consumed' : 'Claimed'} ${recentLedger.targetName}`
          : `Collected in ${zoneName}`,
        zoneName,
      });
    }

    if (form > this.lastForm) {
      forceSample = true;
      this.pushEvent({
        t,
        kind: 'evolution',
        x: px,
        z: pz,
        level,
        deltaFragments: 0,
        label: `Evolved: ${getFormLabel(form)}`,
        detail: `Reached Lv.${level} in ${zoneName}`,
        zoneName,
      });
    }

    if (kills > this.lastKills) {
      forceSample = true;
      this.pushEvent({
        t,
        kind: 'kill',
        x: px,
        z: pz,
        level,
        deltaFragments: 0,
        label: `Elimination #${kills}`,
        detail: `Subdued rival at ${zoneName}`,
        zoneName,
      });
    }

    if (this.lastAlive && !alive) {
      forceSample = true;
      this.outcomeRecorded = true;
      this.pushEvent({
        t,
        kind: 'death',
        x: px,
        z: pz,
        level,
        deltaFragments: 0,
        label: `Fragments Scattered (Lv.${level})`,
        detail: snap.matchResult.killedBy
          ? `Eliminated by ${snap.matchResult.killedBy}`
          : `Eliminated in ${zoneName}`,
        zoneName,
      });
    } else if (!this.outcomeRecorded && snap.matchResult.status === 'victory') {
      forceSample = true;
      this.outcomeRecorded = true;
      this.pushEvent({
        t,
        kind: 'victory',
        x: px,
        z: pz,
        level,
        deltaFragments: 0,
        label: 'Keli King Crowned (100/100)',
        detail: `All 100 fragments reunited at ${zoneName}`,
        zoneName,
      });
    }

    if (snap.zone.phase !== this.lastZonePhase) {
      forceSample = true;
    }

    if (forceSample || t - this.lastSampleTime >= 0.25) {
      this.lastSampleTime = t;
      this.frames.push({
        t,
        x: Math.round(px * 10) / 10,
        z: Math.round(pz * 10) / 10,
        facingAngle: facing,
        level,
        form,
        alive,
        kills,
        zoneName,
        zoneCenterX: snap.zone.centerX,
        zoneCenterZ: snap.zone.centerZ,
        zoneRadius: snap.zone.currentRadius,
        inSafeZone,
        isOnShore,
      });
    }

    this.lastLevel = level;
    this.lastForm = form;
    this.lastKills = kills;
    this.lastAlive = alive;
    this.lastX = px;
    this.lastZ = pz;
    this.lastZonePhase = snap.zone.phase;
  }

  public finalize(finalSnap: HudSnapshot, liveEntity?: KeliEntity | null): MatchReplayData {
    this.record(finalSnap, liveEntity);

    // Ensure the final timestamp matches survivalTime/matchTime when alive
    const endT =
      finalSnap.matchResult.survivalTime > 0
        ? finalSnap.matchResult.survivalTime
        : finalSnap.matchTime;

    if (this.frames.length > 0) {
      const last = this.frames[this.frames.length - 1];
      if (endT > last.t + 0.05 && last.alive) {
        this.frames.push({
          ...last,
          t: endT,
        });
      }
    }

    const duration =
      this.frames.length > 0 ? Math.max(0.1, this.frames[this.frames.length - 1].t) : 0.1;

    return {
      lobbySize: this.lobbySize,
      mode: this.mode,
      playerName: this.playerName,
      duration,
      startLevel: this.startLevel,
      peakLevel: this.peakLevel,
      totalFragmentsGained: this.totalFragmentsGained,
      totalDistance: Math.round(this.totalDistance),
      zonesVisited: [...this.zonesVisited],
      frames: [...this.frames],
      events: [...this.events],
    };
  }
}

/**
 * Samples an interpolated player pose & zone state at arbitrary replay timestamp `t`.
 */
export function sampleReplayAtTime(replay: MatchReplayData, t: number): ReplayFrame | null {
  const { frames } = replay;
  if (frames.length === 0) return null;
  if (t <= frames[0].t) return frames[0];
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1];

  // Binary search for bracketing frames
  let lo = 0;
  let hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }

  const a = frames[lo];
  const b = frames[hi];
  const span = Math.max(0.0001, b.t - a.t);
  const alpha = Math.max(0, Math.min(1, (t - a.t) / span));

  let angleDiff = b.facingAngle - a.facingAngle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  return {
    t,
    x: a.x + (b.x - a.x) * alpha,
    z: a.z + (b.z - a.z) * alpha,
    facingAngle: a.facingAngle + angleDiff * alpha,
    level: a.level,
    form: a.form,
    alive: a.alive,
    kills: a.kills,
    zoneName: a.zoneName,
    zoneCenterX: a.zoneCenterX + (b.zoneCenterX - a.zoneCenterX) * alpha,
    zoneCenterZ: a.zoneCenterZ + (b.zoneCenterZ - a.zoneCenterZ) * alpha,
    zoneRadius: a.zoneRadius + (b.zoneRadius - a.zoneRadius) * alpha,
    inSafeZone: a.inSafeZone,
    isOnShore: a.isOnShore,
  };
}

import type { EmoteId } from '../data/emotes';
import type { RegionCode } from '../data/regions';
import { resolveArenaCollision } from './arena';
import { soundEngine } from './audio';
import { getMultiplayerWsUrl, getResolvedWsHost } from './backendConfig';
import {
  createInitialEndgameState,
  EndgamePresentationGuard,
} from './endgameDirector';
import { EvolutionPresentationGuard } from './evolutionExperience';
import {
  normalizeRoomCode,
  type ClientMessage,
  type ClientSfxEvent,
  type RemoteKeliState,
  type RoomState,
  type RoomSummary,
  type ServerMessage,
  type VoiceSignalPayload,
  type WorldStatePacket,
} from './multiplayerTypes';
import type { RenderableSimulation } from './scene3d';
import type {
  AbilityId,
  ActiveWorldEventState,
  CarcassEntity,
  DamageImpulse,
  DeathCamState,
  EndgameStateSnapshot,
  FloatingCallout,
  HitStopEvent,
  HudSnapshot,
  KeliEntity,
  LobbySize,
  PickupItem,
  WeatherState,
  WorldEffect,
  ZoneState,
} from './types';

function makeDefaultEntity(r?: RemoteKeliState, localPlayerId?: string): KeliEntity {
  const entityId = r?.id ?? localPlayerId ?? 'player';
  const isLocalPlayer = r
    ? localPlayerId
      ? r.id === localPlayerId
      : false
    : true;
  return {
    id: entityId,
    name: r?.name ?? 'Awang Keli',
    isPlayer: isLocalPlayer,
    x: r?.x ?? 1000,
    z: r?.z ?? 1000,
    vx: r?.vx ?? 0,
    vz: r?.vz ?? 0,
    facingAngle: r?.facingAngle ?? 0,
    level: r?.level ?? 1,
    hp: r?.hp ?? 100,
    maxHp: r?.maxHp ?? 100,
    alive: r?.alive ?? true,
    isOnShore: r?.isOnShore ?? false,
    isSubmerged: r?.isSubmerged ?? true,
    shoreReserve: r?.shoreReserve ?? 10,
    maxShoreReserve: r?.maxShoreReserve ?? 10,
    stamina: r?.stamina ?? 100,
    maxStamina: r?.maxStamina ?? 100,
    staminaRegenDelay: 0,
    fatigued: r?.fatigued ?? false,
    activeHazard: r?.activeHazard ?? null,
    bitePhase: r?.bitePhase ?? 'idle',
    bitePhaseTimer: 0,
    biteCooldown: 0,
    biteAimAngle: r?.biteAimAngle ?? 0,
    biteHitApplied: false,
    biteBufferTimer: 0,
    biteAttackSeq: 0,
    evadeTimer: r?.evadeTimer ?? 0,
    evadeDirX: 0,
    evadeDirZ: 0,
    staggerTimer: r?.staggerTimer ?? 0,
    stunTimer: r?.stunTimer ?? 0,
    stunResistTimer: r?.stunResistTimer ?? 0,
    stunStacks: 0,
    stunStackDecayTimer: 0,
    recoilTimer: r?.recoilTimer ?? 0,
    recoilDirX: r?.recoilDirX ?? 0,
    recoilDirZ: r?.recoilDirZ ?? 0,
    recoilStrength: r?.recoilStrength ?? 0,
    lastHitKind: r?.lastHitKind ?? null,
    netEntangleTimer: r?.netEntangleTimer ?? 0,
    netImmunityTimer: r?.netImmunityTimer ?? 0,
    venomTimer: r?.venomTimer ?? 0,
    venomDps: 0,
    venomSourceId: null,
    frenzyTimer: r?.frenzyTimer ?? 0,
    veilTimer: r?.veilTimer ?? 0,
    dashTimer: r?.dashTimer ?? 0,
    dashDirX: 0,
    dashDirZ: 0,
    hitFlashTimer: r?.hitFlashTimer ?? 0,
    surgeTimer: r?.surgeTimer ?? 0,
    predatorTimer: r?.predatorTimer ?? 0,
    aegisTimer: r?.aegisTimer ?? 0,
    dewTimer: r?.dewTimer ?? 0,
    stormFinTimer: r?.stormFinTimer ?? 0,
    thunderRoeTimer: r?.thunderRoeTimer ?? 0,
    evoBoostTimer: r?.evoBoostTimer ?? 0,
    highestFormReached: r?.highestFormReached,
    evolutionSeq: r?.evolutionSeq ?? 0,
    lastEvolutionForm: r?.lastEvolutionForm,
    lastEvolutionTime: r?.lastEvolutionTime ?? -1,
    lastMinorLevelTime: r?.lastMinorLevelTime ?? -1,
    sonarTimer: r?.sonarTimer ?? 0,
    sonarIsHunter: r?.sonarIsHunter ?? false,
    feedingTargetId: r?.feedingTargetId ?? null,
    feedingProgress: r?.feedingProgress ?? 0,
    feedingDuration: r?.feedingDuration ?? 0,
    feedingRecoveryTimer: r?.feedingRecoveryTimer ?? 0,
    feedingSessionFragments: r?.feedingSessionFragments ?? 0,
    cooldowns: r?.cooldowns ?? {
      evade: 0,
      dash: 0,
      sonar: 0,
      veil: 0,
      electroshock: 0,
      maelstrom: 0,
    },
    activeEmote: r?.activeEmote ?? null,
    kills: r?.kills ?? 0,
    rivalsConsumed: r?.rivalsConsumed ?? 0,
    bountyReward: r?.bountyReward ?? 0,
    bountyPoints: r?.bountyPoints ?? 0,
    bountyBoostTimer: r?.bountyBoostTimer ?? 0,
    damageDealt: 0,
    lastAttackerId: null,
    lastAttackerName: null,
    lastDamageCause: null,
    aiWanderAngle: 0,
    aiGoalTimer: 0,
    aiTargetId: null,
    aiAggression: 0.5,
    aiRetreatingFromShore: false,
  };
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/**
 * Smoothly interpolated client view of the server-authoritative simulation.
 * Implements RenderableSimulation so ArenaScene3D renders remote matches identically.
 */
export class RemoteSimulationView implements RenderableSimulation {
  public kelis: KeliEntity[] = [];
  public carcasses: CarcassEntity[] = [];
  public pickups: PickupItem[] = [];
  public effects: WorldEffect[] = [];
  public callouts: FloatingCallout[] = [];
  public zone: ZoneState = {
    centerX: 2900,
    centerZ: 3400,
    currentRadius: 2700,
    targetRadius: 2700,
    phase: 1,
    warningTimer: 26,
    isShrinking: false,
  };
  public weather: WeatherState = {
    kind: 'clear',
    label: 'Clear Twilight',
    intensity: 0,
    remainingSec: 20,
    visibilityRange: 1.0,
  };
  public activeWorldEvent: ActiveWorldEventState | null = null;
  public endgameState: EndgameStateSnapshot = createInitialEndgameState(0);
  public cameraShake = 0;
  public damageImpulse: DamageImpulse | null = null;
  public hitStop: HitStopEvent | null = null;
  public status: 'playing' | 'victory' | 'defeat' | 'draw' = 'playing';
  public winnerId: string | null = null;

  private targetsById = new Map<string, RemoteKeliState>();
  private entityById = new Map<string, KeliEntity>();
  private localPlayerId: string;
  private expectedMatchId: string | null;
  private latestHud: HudSnapshot | null = null;
  private lastPacketTime = 0;
  private speakingPeers = new Set<string>();
  private seenDamageHitIds = new Set<string>();
  private evolutionGuard = new EvolutionPresentationGuard();
  private endgameGuard = new EndgamePresentationGuard();
  public hasReceivedSnapshot = false;
  public latestTick: number | null = null;

  constructor(localPlayerId: string, expectedMatchId: string | null = null) {
    this.localPlayerId = localPlayerId;
    this.expectedMatchId = expectedMatchId;
  }

  public setSpeakingPeers(ids: Set<string>) {
    this.speakingPeers = ids;
  }

  public getExpectedMatchId(): string | null {
    return this.expectedMatchId;
  }

  public applyServerState(packet: WorldStatePacket): boolean {
    // Reject packets belonging to another match/round so stale snapshots can never contaminate state
    if (this.expectedMatchId && packet.matchId && packet.matchId !== this.expectedMatchId) {
      return false;
    }
    // Discard stale out-of-order packets so levels, forms, sprites & audio can never regress or double-fire
    if (this.evolutionGuard.isPacketStale(packet.tick)) {
      return false;
    }
    this.hasReceivedSnapshot = true;
    this.latestTick = packet.tick;

    const wasAlreadyConcluded = this.status !== 'playing';
    const incomingEndgame = packet.endgame ?? packet.hud.endgame;
    const egCheck = this.endgameGuard.ingest(packet.tick, incomingEndgame, packet.status);
    if (egCheck.accepted) {
      this.endgameState = egCheck.state;
    }

    this.latestHud = {
      ...packet.hud,
      endgame: { ...this.endgameState },
    };
    // Prevent stale packets from overriding an already concluded match state
    if (!wasAlreadyConcluded || packet.status !== 'playing') {
      this.status = packet.status;
      this.winnerId = packet.hud.matchResult.winnerId ?? this.winnerId;
    }
    // Enforce monotonic permanent final zone lock on the client
    if (this.endgameGuard.isFinalZoneLocked() && !packet.zone.finalZoneLocked) {
      this.zone = {
        ...this.zone,
        finalZoneLocked: true,
        isShrinking: false,
        warningActive: false,
      };
    } else {
      this.zone = packet.zone;
    }
    this.weather = packet.weather;
    this.activeWorldEvent =
      this.status === 'playing'
        ? (packet.worldEvent ?? packet.hud.activeWorldEvent ?? null)
        : null;
    this.cameraShake = Math.max(this.cameraShake, packet.cameraShake);
    this.hitStop = packet.hitStop ?? this.hitStop;
    this.carcasses = packet.carcasses;
    this.pickups = packet.pickups;
    this.effects = packet.effects;
    this.callouts = packet.callouts ?? [];
    this.lastPacketTime = performance.now();

    const hits = packet.hud.recentDamageHits;
    if (hits && hits.length > 0) {
      for (const h of hits) {
        if (this.seenDamageHitIds.has(h.id)) continue;
        this.seenDamageHitIds.add(h.id);
        if (this.seenDamageHitIds.size > 40) {
          const oldest = this.seenDamageHitIds.values().next().value;
          if (oldest) this.seenDamageHitIds.delete(oldest);
        }
        this.damageImpulse = {
          x: -Math.cos(h.directionAngle),
          z: -Math.sin(h.directionAngle),
          strength: h.intensity,
          seq: (this.damageImpulse?.seq ?? 0) + 1,
        };
        this.cameraShake = Math.max(this.cameraShake, 0.48 + h.intensity * 0.45);
      }
    }

    const activeIds = new Set<string>();
    const nextList: KeliEntity[] = [];

    const matchFrozen = packet.status !== 'playing';
    for (const remote of packet.kelis) {
      activeIds.add(remote.id);
      const evoCheck = this.evolutionGuard.reconcileEntity(
        remote.id,
        remote.level,
        remote.highestFormReached,
        remote.evolutionSeq,
        remote.alive,
        packet.status
      );
      const isLocalEntity = remote.id === this.localPlayerId;
      const effectiveRemote = matchFrozen
        ? {
            ...remote,
            isPlayer: isLocalEntity,
            level: evoCheck.effectiveLevel,
            highestFormReached: evoCheck.effectiveForm,
            evolutionSeq: evoCheck.effectiveEvoSeq,
            vx: 0,
            vz: 0,
            dashTimer: 0,
            evadeTimer: 0,
          }
        : {
            ...remote,
            isPlayer: isLocalEntity,
            level: evoCheck.effectiveLevel,
            highestFormReached: evoCheck.effectiveForm,
            evolutionSeq: evoCheck.effectiveEvoSeq,
          };
      this.targetsById.set(remote.id, effectiveRemote);
      let ent = this.entityById.get(remote.id);
      if (!ent) {
        ent = makeDefaultEntity(effectiveRemote, this.localPlayerId);
        this.entityById.set(remote.id, ent);
      } else {
        // Snap if teleported/large jump, otherwise reconcile smoothly in advance()
        const jumpDist = Math.hypot(effectiveRemote.x - ent.x, effectiveRemote.z - ent.z);
        if (jumpDist > 220) {
          ent.x = effectiveRemote.x;
          ent.z = effectiveRemote.z;
          ent.facingAngle = effectiveRemote.facingAngle;
        }
        ent.name = effectiveRemote.name;
        ent.isPlayer = isLocalEntity;
        ent.vx = effectiveRemote.vx;
        ent.vz = effectiveRemote.vz;
        ent.level = effectiveRemote.level;
        ent.hp = effectiveRemote.hp;
        ent.maxHp = effectiveRemote.maxHp;
        ent.alive = effectiveRemote.alive;
        ent.isOnShore = effectiveRemote.isOnShore;
        ent.isSubmerged = effectiveRemote.isSubmerged;
        ent.shoreReserve = remote.shoreReserve;
        ent.maxShoreReserve = remote.maxShoreReserve;
        ent.stamina = remote.stamina;
        ent.maxStamina = remote.maxStamina;
        ent.fatigued = remote.fatigued;
        ent.activeHazard = remote.activeHazard;
        ent.bitePhase = remote.bitePhase;
        ent.biteAimAngle = remote.biteAimAngle;
        ent.evadeTimer = remote.evadeTimer ?? 0;
        ent.staggerTimer = remote.staggerTimer ?? 0;
        ent.stunTimer = remote.stunTimer;
        ent.stunResistTimer = remote.stunResistTimer ?? 0;
        ent.recoilTimer = remote.recoilTimer ?? 0;
        ent.recoilDirX = remote.recoilDirX ?? 0;
        ent.recoilDirZ = remote.recoilDirZ ?? 0;
        ent.recoilStrength = remote.recoilStrength ?? 0;
        ent.lastHitKind = remote.lastHitKind ?? null;
        ent.netEntangleTimer = remote.netEntangleTimer ?? 0;
        ent.netImmunityTimer = remote.netImmunityTimer ?? 0;
        ent.venomTimer = remote.venomTimer;
        ent.frenzyTimer = remote.frenzyTimer;
        ent.veilTimer = remote.veilTimer;
        ent.dashTimer = remote.dashTimer;
        ent.hitFlashTimer = remote.hitFlashTimer;
        ent.surgeTimer = remote.surgeTimer;
        ent.predatorTimer = remote.predatorTimer;
        ent.aegisTimer = remote.aegisTimer;
        ent.dewTimer = remote.dewTimer;
        ent.stormFinTimer = remote.stormFinTimer;
        ent.thunderRoeTimer = remote.thunderRoeTimer;
        ent.evoBoostTimer = remote.evoBoostTimer ?? 0;
        ent.highestFormReached = effectiveRemote.highestFormReached;
        ent.evolutionSeq = effectiveRemote.evolutionSeq;
        ent.lastEvolutionForm = remote.lastEvolutionForm ?? effectiveRemote.highestFormReached;
        ent.lastEvolutionTime = remote.lastEvolutionTime ?? ent.lastEvolutionTime;
        ent.lastMinorLevelTime = remote.lastMinorLevelTime ?? ent.lastMinorLevelTime;
        ent.sonarTimer = remote.sonarTimer;
        ent.sonarIsHunter = remote.sonarIsHunter;
        ent.kills = remote.kills;
        ent.rivalsConsumed = remote.rivalsConsumed ?? 0;
        ent.bountyReward = remote.bountyReward ?? 0;
        ent.bountyPoints = remote.bountyPoints ?? 0;
        ent.bountyBoostTimer = remote.bountyBoostTimer ?? 0;
        ent.feedingTargetId = remote.feedingTargetId;
        ent.feedingProgress = remote.feedingProgress;
        ent.feedingDuration = remote.feedingDuration;
        ent.feedingRecoveryTimer = remote.feedingRecoveryTimer ?? 0;
        ent.feedingSessionFragments = remote.feedingSessionFragments ?? 0;
        ent.cooldowns = remote.cooldowns;
        ent.activeEmote = remote.activeEmote ?? null;
      }
      nextList.push(ent);
    }

    for (const id of Array.from(this.entityById.keys())) {
      if (!activeIds.has(id)) {
        this.entityById.delete(id);
        this.targetsById.delete(id);
      }
    }
    this.evolutionGuard.pruneMissing(activeIds);
    this.kelis = nextList;

    if (!wasAlreadyConcluded) {
      for (const sfx of packet.sfx) {
        this.playSfx(sfx);
      }
    }
    return true;
  }

  private playSfx(sfx: ClientSfxEvent) {
    switch (sfx.kind) {
      case 'bite':
        soundEngine.playBite(false);
        break;
      case 'bite_heavy':
        soundEngine.playBite(true);
        break;
      case 'bite_miss':
        soundEngine.playBiteMiss();
        break;
      case 'hit_confirm':
        soundEngine.playHitConfirm(false);
        break;
      case 'hit_crit':
        soundEngine.playHitConfirm(true);
        break;
      case 'hit_stun':
        soundEngine.playStunImpact();
        break;
      case 'hit_blocked':
        soundEngine.playBlockedHit();
        break;
      case 'evade':
        soundEngine.playEvade();
        break;
      case 'death':
        soundEngine.playDeath();
        break;
      case 'feed':
        soundEngine.playFeedComplete();
        break;
      case 'feed_start':
        soundEngine.playFeedStart();
        break;
      case 'feed_tick':
        soundEngine.playFeedTick();
        break;
      case 'feed_interrupt':
        soundEngine.playFeedInterrupt();
        break;
      case 'feed_nearby':
        soundEngine.playNearbyFeedAlert();
        break;
      case 'evolution':
        soundEngine.playEvolution();
        break;
      case 'level_up_minor':
        soundEngine.playMinorLevelUp(this.latestHud?.player.level ?? 1);
        break;
      case 'ability_unlock':
        soundEngine.playAbilityUnlock();
        break;
      case 'evolution_form_2':
        soundEngine.playForm2Transformation();
        break;
      case 'evolution_form_3':
        soundEngine.playForm3Transformation();
        break;
      case 'evolution_king':
        soundEngine.playKeliKingAscension();
        break;
      case 'dash':
        soundEngine.playDash();
        break;
      case 'sonar':
        soundEngine.playSonar(false);
        break;
      case 'hunter_sonar':
        soundEngine.playSonar(true);
        break;
      case 'veil':
        soundEngine.playVeil();
        break;
      case 'electroshock':
        soundEngine.playElectroshock();
        break;
      case 'maelstrom':
        soundEngine.playMaelstrom();
        break;
      case 'pickup_heal':
        soundEngine.playPickup(true);
        break;
      case 'pickup_buff':
        soundEngine.playPickup(false);
        break;
      case 'pickup_rainfed':
        soundEngine.playRainFedPickup();
        break;
      case 'weather_rain':
        soundEngine.playWeatherCue('light_rain');
        break;
      case 'weather_fog':
        soundEngine.playWeatherCue('basin_fog');
        break;
      case 'emote_signal':
        soundEngine.playEmoteCue(false);
        break;
      case 'emote_taunt':
        soundEngine.playEmoteCue(true);
        break;
      case 'damage_hit':
        soundEngine.playDamageHit(false);
        break;
      case 'damage_hit_heavy':
        soundEngine.playDamageHit(true);
        break;
      case 'bounty_marked':
        soundEngine.playBountyCue(false);
        break;
      case 'bounty_claimed':
        soundEngine.playBountyCue(true);
        break;
      case 'whistle':
        soundEngine.playShiftWhistle();
        break;
      case 'event_warning':
        soundEngine.playWorldEventWarning();
        break;
      case 'event_flood':
        soundEngine.playFlashFloodCue();
        break;
      case 'event_silt':
        soundEngine.playSiltBloomCue();
        break;
      case 'event_whirlpool':
        soundEngine.playWhirlpoolCue();
        break;
      case 'event_net_snag':
        soundEngine.playNetSnag();
        break;
      case 'endgame_convergence':
        soundEngine.playEndgameConvergenceCue();
        break;
      case 'endgame_final_hunt':
        soundEngine.playFinalHuntStartCue();
        break;
      case 'endgame_final_feast':
        soundEngine.playFinalFeastTriumphCue();
        break;
      case 'endgame_call':
        soundEngine.playFinalHuntDistantCall();
        break;
      case 'final_feed_claim':
        soundEngine.playFinalFeedClaimCue();
        break;
      case 'final_zone_locked':
        soundEngine.playEndgameConvergenceCue();
        break;
    }
  }

  public advance(dt: number) {
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.5);
    }
    const deathCamActive = Boolean(this.getDeathCam()?.active);
    const matchPlaying = this.status === 'playing';
    const baseBlend = 1 - Math.exp((deathCamActive ? -11 : -16) * dt);
    const burstBlend = 1 - Math.exp(-24 * dt);
    const deadReckonDt = matchPlaying
      ? Math.min(0.055, Math.max(0, (performance.now() - this.lastPacketTime) / 1000)) * 0.4
      : 0;
    const fxDt = dt * (deathCamActive ? 0.3 : 1);

    for (const ent of this.kelis) {
      ent.isSpeaking = this.speakingPeers.has(ent.id);
      const target = this.targetsById.get(ent.id);
      if (!target) continue;

      // Halt extrapolation cleanly once match concludes, entity is eliminated, or Keli King is crowned
      if (!matchPlaying || !ent.alive || ent.level >= 100) {
        ent.vx = 0;
        ent.vz = 0;
        ent.x += (target.x - ent.x) * baseBlend;
        ent.z += (target.z - ent.z) * baseBlend;
        ent.facingAngle = lerpAngle(ent.facingAngle, target.facingAngle, baseBlend);
        continue;
      }

      const isBursting = target.dashTimer > 0 || (target.evadeTimer ?? 0) > 0;
      const blend = isBursting ? burstBlend : baseBlend;
      let goalX = target.x + target.vx * deadReckonDt;
      let goalZ = target.z + target.vz * deadReckonDt;

      // Keep client-side dead reckoning strictly inside walkable arena & shoreline bounds
      if (deadReckonDt > 0.0005 && (Math.abs(target.vx) > 2 || Math.abs(target.vz) > 2)) {
        const radius = 14 + ent.level * 0.28 + (ent.level >= 80 ? 8 : ent.level >= 40 ? 4 : 0);
        const safe = resolveArenaCollision(goalX, goalZ, radius, ent.level >= 40);
        goalX = safe.x;
        goalZ = safe.z;
      }

      ent.x += (goalX - ent.x) * blend;
      ent.z += (goalZ - ent.z) * blend;
      ent.facingAngle = lerpAngle(ent.facingAngle, target.facingAngle, blend);
    }

    for (const fx of this.effects) {
      fx.elapsed += fxDt;
    }
    for (const c of this.carcasses) {
      c.bobPhase += fxDt * 2.4;
    }
    for (const pk of this.pickups) {
      pk.bobPhase += fxDt * 3.1;
    }
  }

  public getPlayer(): KeliEntity {
    const found = this.entityById.get(this.localPlayerId);
    if (found) return found;
    if (this.latestHud) {
      const hp = this.latestHud.player;
      const fallback = makeDefaultEntity(undefined, this.localPlayerId);
      fallback.id = this.localPlayerId;
      fallback.name = hp.name;
      fallback.alive = hp.alive;
      fallback.level = hp.level;
      fallback.x = hp.x;
      fallback.z = hp.z;
      fallback.facingAngle = hp.facingAngle;
      return fallback;
    }
    return makeDefaultEntity(undefined, this.localPlayerId);
  }

  public getSpectateTarget(): KeliEntity | null {
    const targetId = this.latestHud?.spectating?.targetId;
    if (targetId) {
      const found = this.entityById.get(targetId);
      if (found) return found;
    }
    return this.kelis[0] ?? null;
  }

  public getDeathCam(): DeathCamState | null {
    const dc = this.latestHud?.deathCam;
    if (!dc || !dc.active || dc.remaining <= 0) return null;
    return dc;
  }

  public getLatestHud(): HudSnapshot | null {
    return this.latestHud;
  }
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'unavailable';

export interface MultiplayerSnapshot {
  status: ConnectionStatus;
  wsHost: string | null;
  clientId: string | null;
  latencyMs: number | null;
  rooms: RoomSummary[];
  currentRoom: RoomState | null;
  error: string | null;
  activeMatchPlayerId: string | null;
  activeMatchId: string | null;
  activeRoomCode: string | null;
  latestSnapshotTick: number | null;
}

export interface LeaderboardResultEvent {
  matchId: string;
  playerId: string;
  status: 'saved' | 'failed' | 'ineligible' | 'unavailable';
  globalRank: number | null;
  regionalRank: number | null;
  region: RegionCode;
  error?: string;
}

const CLIENT_ID_STORAGE_KEY = 'awang_keli_ws_client_id';

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private reconnectAttempts = 0;
  private hasEverConnected = false;
  private shouldStayConnected = false;

  private lastInputSentAt = 0;
  private lastSentInput = { moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false };
  private latestWorldState: WorldStatePacket | null = null;
  private lastTickEmitAt = 0;
  private lastPlayerName: string | null = null;
  private lastPlayerRegion: RegionCode | null = null;
  private latestLeaderboardResultByMatch = new Map<string, LeaderboardResultEvent>();

  private state: MultiplayerSnapshot = {
    status: getMultiplayerWsUrl() ? 'disconnected' : 'unavailable',
    wsHost: getResolvedWsHost(),
    clientId: this.readStoredClientId(),
    latencyMs: null,
    rooms: [],
    currentRoom: null,
    error: null,
    activeMatchPlayerId: null,
    activeMatchId: null,
    activeRoomCode: null,
    latestSnapshotTick: null,
  };

  private listeners = new Set<(snap: MultiplayerSnapshot) => void>();
  private worldListeners = new Set<(packet: WorldStatePacket) => void>();
  private matchStartListeners = new Set<
    (info: { playerId: string; roomCode: string; matchId: string }) => void
  >();
  private matchEndListeners = new Set<
    (hud: HudSnapshot, meta?: { matchId: string; roomCode: string }) => void
  >();
  private leaderboardResultListeners = new Set<(event: LeaderboardResultEvent) => void>();
  private voiceSignalListeners = new Set<
    (msg: { fromId: string; fromName: string; signal: VoiceSignalPayload }) => void
  >();
  private voiceSpeakingListeners = new Set<(msg: { peerId: string; speaking: boolean }) => void>();
  private voicePeerLeftListeners = new Set<(peerId: string) => void>();

  private readStoredClientId(): string | null {
    try {
      return sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private saveClientId(id: string) {
    try {
      sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, id);
    } catch {
      // Ignore storage failures
    }
  }

  private emitState() {
    const snap = { ...this.state };
    this.listeners.forEach((cb) => cb(snap));
  }

  public getSnapshot(): MultiplayerSnapshot {
    return { ...this.state };
  }

  public subscribe(cb: (snap: MultiplayerSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb({ ...this.state });
    return () => {
      this.listeners.delete(cb);
    };
  }

  public onWorldState(
    cb: (packet: WorldStatePacket) => void,
    expectedMatchId?: string | null
  ): () => void {
    this.worldListeners.add(cb);
    // Replay latest valid buffered snapshot so subscribers mounted after tick 0 never miss initial state
    const cached = this.latestWorldState;
    if (
      cached &&
      (!expectedMatchId || !cached.matchId || cached.matchId === expectedMatchId) &&
      (!this.state.activeMatchId || !cached.matchId || cached.matchId === this.state.activeMatchId)
    ) {
      cb(cached);
    }
    return () => {
      this.worldListeners.delete(cb);
    };
  }

  public getLatestWorldState(expectedMatchId?: string | null): WorldStatePacket | null {
    const cached = this.latestWorldState;
    if (!cached) return null;
    if (expectedMatchId && cached.matchId && cached.matchId !== expectedMatchId) return null;
    return cached;
  }

  public onMatchStarted(
    cb: (info: { playerId: string; roomCode: string; matchId: string }) => void
  ): () => void {
    this.matchStartListeners.add(cb);
    return () => {
      this.matchStartListeners.delete(cb);
    };
  }

  public onMatchEnded(
    cb: (hud: HudSnapshot, meta?: { matchId: string; roomCode: string }) => void
  ): () => void {
    this.matchEndListeners.add(cb);
    return () => {
      this.matchEndListeners.delete(cb);
    };
  }

  public onLeaderboardResult(cb: (event: LeaderboardResultEvent) => void): () => void {
    this.leaderboardResultListeners.add(cb);
    if (this.state.activeMatchId) {
      const cached = this.latestLeaderboardResultByMatch.get(this.state.activeMatchId);
      if (cached) {
        cb(cached);
      }
    }
    return () => {
      this.leaderboardResultListeners.delete(cb);
    };
  }

  public getLeaderboardResultForMatch(matchId: string | null | undefined): LeaderboardResultEvent | null {
    if (!matchId) return null;
    return this.latestLeaderboardResultByMatch.get(matchId) ?? null;
  }

  public onVoiceSignal(
    cb: (msg: { fromId: string; fromName: string; signal: VoiceSignalPayload }) => void
  ): () => void {
    this.voiceSignalListeners.add(cb);
    return () => {
      this.voiceSignalListeners.delete(cb);
    };
  }

  public onVoiceSpeaking(cb: (msg: { peerId: string; speaking: boolean }) => void): () => void {
    this.voiceSpeakingListeners.add(cb);
    return () => {
      this.voiceSpeakingListeners.delete(cb);
    };
  }

  public onVoicePeerLeft(cb: (peerId: string) => void): () => void {
    this.voicePeerLeftListeners.add(cb);
    return () => {
      this.voicePeerLeftListeners.delete(cb);
    };
  }

  private networkListenersAttached = false;

  private ensureNetworkListeners() {
    if (this.networkListenersAttached || typeof window === 'undefined') return;
    this.networkListenersAttached = true;
    window.addEventListener('offline', () => {
      if (!this.shouldStayConnected) return;
      if (this.reconnectTimer !== null) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.state.status = 'disconnected';
      this.state.latencyMs = null;
      this.state.error =
        'Device is offline. Solo Royale and Guide Mode remain playable offline.';
      this.emitState();
    });
    window.addEventListener('online', () => {
      if (!this.shouldStayConnected) return;
      this.reconnectAttempts = 0;
      this.state.error = null;
      this.connect();
    });
  }

  public connect() {
    const url = getMultiplayerWsUrl();
    this.state.wsHost = getResolvedWsHost();
    if (!url) {
      this.shouldStayConnected = false;
      this.state.status = 'unavailable';
      this.state.error = null;
      this.state.latencyMs = null;
      this.state.rooms = [];
      this.state.currentRoom = null;
      this.state.activeMatchId = null;
      this.state.activeRoomCode = null;
      this.state.latestSnapshotTick = null;
      this.latestWorldState = null;
      this.emitState();
      return;
    }

    this.ensureNetworkListeners();
    this.shouldStayConnected = true;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.state.status = 'disconnected';
      this.state.latencyMs = null;
      this.state.error =
        'Device is offline. Solo Royale and Guide Mode remain playable offline.';
      this.emitState();
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.state.status = this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
    this.emitState();

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.shouldStayConnected = false;
      this.state.status = 'unavailable';
      this.state.error = 'Online multiplayer server URL is invalid or unreachable.';
      this.emitState();
      return;
    }
    this.ws = ws;

    ws.onerror = () => {
      if (!this.shouldStayConnected) return;
      this.state.error =
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'Device is offline. Solo Royale and Guide Mode remain playable offline.'
          : 'Unable to reach the multiplayer server. Retrying connection — Solo Royale remains available.';
      this.emitState();
    };

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.hasEverConnected = true;
      this.state.status = 'connected';
      this.state.error = null;
      this.emitState();

      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        this.send({ type: 'ping', t: Date.now() });
      }, 4000);
      this.send({ type: 'ping', t: Date.now() });
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'welcome': {
          const prevId = this.state.clientId;
          const activeRoomCode = this.state.currentRoom?.code ?? this.state.activeRoomCode;
          this.state.clientId = msg.clientId;
          this.state.rooms = msg.rooms;
          // If reconnecting while previously inside a room, re-join automatically using old clientId, custom name, and region
          if (activeRoomCode && prevId) {
            const prevMember = this.state.currentRoom?.participants.find((p) => p.id === prevId);
            const localName = prevMember?.name || this.lastPlayerName || 'Awang';
            const localRegion = prevMember?.region || this.lastPlayerRegion || undefined;
            this.send({
              type: 'room:join',
              code: activeRoomCode,
              playerName: localName,
              region: localRegion,
              clientId: prevId,
            });
          } else {
            this.saveClientId(msg.clientId);
          }
          this.emitState();
          break;
        }
        case 'pong': {
          this.state.latencyMs = Math.max(1, Date.now() - msg.t);
          this.emitState();
          break;
        }
        case 'rooms:updated': {
          this.state.rooms = msg.rooms;
          this.emitState();
          break;
        }
        case 'room:joined': {
          this.state.clientId = msg.clientId;
          this.saveClientId(msg.clientId);
          this.state.currentRoom = msg.room;
          this.state.activeRoomCode = msg.room.code;
          const selfMember = msg.room.participants.find((p) => p.id === msg.clientId);
          if (selfMember?.name) {
            this.lastPlayerName = selfMember.name;
          }
          if (selfMember?.region) {
            this.lastPlayerRegion = selfMember.region;
          }
          if (msg.room.status !== 'playing') {
            this.state.activeMatchId = msg.room.activeMatchId ?? null;
          }
          this.state.error = null;
          this.emitState();
          break;
        }
        case 'room:state': {
          this.state.currentRoom = msg.room;
          this.state.activeRoomCode = msg.room.code;
          const selfMember = msg.room.participants.find((p) => p.id === this.state.clientId);
          if (selfMember?.name) {
            this.lastPlayerName = selfMember.name;
          }
          if (selfMember?.region) {
            this.lastPlayerRegion = selfMember.region;
          }
          this.emitState();
          break;
        }
        case 'room:error': {
          this.state.error = msg.message;
          this.emitState();
          break;
        }
        case 'match:started': {
          const isNewMatch = this.state.activeMatchId !== msg.matchId;
          if (isNewMatch) {
            this.latestWorldState = null;
            this.state.latestSnapshotTick = null;
          }
          this.state.activeMatchPlayerId = msg.playerId;
          this.state.activeMatchId = msg.matchId;
          this.state.activeRoomCode = msg.roomCode;
          this.state.error = null;
          this.emitState();
          this.matchStartListeners.forEach((cb) =>
            cb({ playerId: msg.playerId, roomCode: msg.roomCode, matchId: msg.matchId })
          );
          break;
        }
        case 'world:state': {
          // Drop stale packets from a previous match/round
          if (
            this.state.activeMatchId &&
            msg.state.matchId &&
            msg.state.matchId !== this.state.activeMatchId
          ) {
            break;
          }
          const hadTick = this.state.latestSnapshotTick !== null;
          this.latestWorldState = msg.state;
          this.state.latestSnapshotTick = msg.state.tick;
          const now = Date.now();
          if (!hadTick || now - this.lastTickEmitAt >= 500 || msg.state.status !== 'playing') {
            this.lastTickEmitAt = now;
            this.emitState();
          }
          this.worldListeners.forEach((cb) => cb(msg.state));
          break;
        }
        case 'match:ended': {
          if (
            this.state.activeMatchId &&
            msg.matchId &&
            msg.matchId !== this.state.activeMatchId
          ) {
            break;
          }
          this.matchEndListeners.forEach((cb) =>
            cb(msg.hud, { matchId: msg.matchId, roomCode: msg.roomCode })
          );
          break;
        }
        case 'leaderboard:result': {
          const event: LeaderboardResultEvent = {
            matchId: msg.matchId,
            playerId: msg.playerId,
            status: msg.status,
            globalRank: msg.globalRank,
            regionalRank: msg.regionalRank,
            region: msg.region,
            error: msg.error,
          };
          this.latestLeaderboardResultByMatch.set(msg.matchId, event);
          if (this.latestLeaderboardResultByMatch.size > 10) {
            const oldestKey = this.latestLeaderboardResultByMatch.keys().next().value;
            if (oldestKey) this.latestLeaderboardResultByMatch.delete(oldestKey);
          }
          this.leaderboardResultListeners.forEach((cb) => cb(event));
          break;
        }
        case 'voice:signal': {
          this.voiceSignalListeners.forEach((cb) =>
            cb({ fromId: msg.fromId, fromName: msg.fromName, signal: msg.signal })
          );
          break;
        }
        case 'voice:speaking': {
          this.voiceSpeakingListeners.forEach((cb) =>
            cb({ peerId: msg.peerId, speaking: msg.speaking })
          );
          break;
        }
        case 'voice:peer_left': {
          this.voicePeerLeftListeners.forEach((cb) => cb(msg.peerId));
          break;
        }
      }
    };

    ws.onclose = () => {
      if (this.pingTimer !== null) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.ws = null;
      if (!this.shouldStayConnected) {
        this.state.status = 'disconnected';
        this.emitState();
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.state.status = 'disconnected';
        this.state.latencyMs = null;
        this.state.error =
          'Device is offline. Solo Royale and Guide Mode remain playable offline.';
        this.emitState();
        return;
      }

      if (!this.hasEverConnected && this.reconnectAttempts >= 3) {
        this.shouldStayConnected = false;
        this.state.status = 'unavailable';
        this.state.latencyMs = null;
        this.state.error =
          'Multiplayer server unreachable on this host. Solo Royale and Guide Mode remain playable.';
        this.emitState();
        return;
      }

      this.state.status = 'reconnecting';
      if (this.reconnectAttempts >= 2 && !this.state.error) {
        this.state.error =
          'Connection to multiplayer server lost. Retrying automatically — Solo Royale remains available.';
      }
      this.emitState();
      const delay = Math.min(8000, 900 * Math.pow(1.6, this.reconnectAttempts));
      this.reconnectAttempts += 1;
      if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => {
        this.connect();
      }, delay);
    };
  }

  public disconnect() {
    this.shouldStayConnected = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state.status = 'disconnected';
    this.state.currentRoom = null;
    this.state.activeMatchPlayerId = null;
    this.state.activeMatchId = null;
    this.state.activeRoomCode = null;
    this.state.latestSnapshotTick = null;
    this.latestWorldState = null;
    this.emitState();
  }

  public clearError() {
    this.state.error = null;
    this.emitState();
  }

  private send(msg: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  public refreshRooms() {
    this.send({ type: 'rooms:list' });
  }

  public createRoom(
    playerName: string,
    lobbySize: LobbySize,
    fillWithBots: boolean,
    roomName?: string,
    region?: RegionCode
  ) {
    const clean = playerName.trim().slice(0, 18);
    if (clean) this.lastPlayerName = clean;
    if (region) this.lastPlayerRegion = region;
    this.send({
      type: 'room:create',
      playerName: clean || playerName,
      region: region ?? this.lastPlayerRegion ?? undefined,
      lobbySize,
      fillWithBots,
      roomName,
    });
  }

  public joinRoom(code: string, playerName: string, region?: RegionCode) {
    const normalizedCode = normalizeRoomCode(code);
    const clean = playerName.trim().slice(0, 18);
    if (clean) this.lastPlayerName = clean;
    if (region) this.lastPlayerRegion = region;
    this.send({
      type: 'room:join',
      code: normalizedCode,
      playerName: clean || playerName,
      region: region ?? this.lastPlayerRegion ?? undefined,
      clientId: this.state.clientId ?? undefined,
    });
  }

  public renamePlayer(playerName: string, region?: RegionCode) {
    const clean = playerName.replace(/\s+/g, ' ').trim().slice(0, 18);
    if (!clean) return;
    this.lastPlayerName = clean;
    if (region) this.lastPlayerRegion = region;
    if (this.state.currentRoom && this.state.currentRoom.status !== 'playing') {
      this.send({
        type: 'room:rename',
        playerName: clean,
        region: region ?? this.lastPlayerRegion ?? undefined,
      });
    }
  }

  public updateRegion(region: RegionCode) {
    this.lastPlayerRegion = region;
    if (this.state.currentRoom && this.state.currentRoom.status !== 'playing') {
      this.send({ type: 'room:region', region });
    }
  }

  public leaveRoom() {
    this.state.currentRoom = null;
    this.state.activeMatchPlayerId = null;
    this.state.activeMatchId = null;
    this.state.activeRoomCode = null;
    this.state.latestSnapshotTick = null;
    this.latestWorldState = null;
    this.send({ type: 'room:leave' });
    this.emitState();
  }

  public updateRoomConfig(lobbySize?: LobbySize, fillWithBots?: boolean) {
    this.send({ type: 'room:config', lobbySize, fillWithBots });
  }

  public setReady(ready: boolean) {
    this.send({ type: 'room:ready', ready });
  }

  public sendChat(text: string) {
    this.send({ type: 'room:chat', text });
  }

  public startRoomMatch() {
    this.send({ type: 'room:start' });
  }

  public restartRoomMatch() {
    this.send({ type: 'room:restart' });
  }

  public sendPlayerInput(
    input: { moveX: number; moveZ: number; aimAngle: number; biteHeld: boolean },
    force = false
  ) {
    const now = performance.now();
    const biteChanged = input.biteHeld !== this.lastSentInput.biteHeld;
    const moveChanged =
      Math.hypot(input.moveX - this.lastSentInput.moveX, input.moveZ - this.lastSentInput.moveZ) >
      0.08;
    const aimChanged = Math.abs(input.aimAngle - this.lastSentInput.aimAngle) > 0.08;

    if (!force && !biteChanged) {
      if (!moveChanged && !aimChanged) return;
      if (now - this.lastInputSentAt < 34) return;
    }

    this.lastInputSentAt = now;
    this.lastSentInput = { ...input };
    this.send({
      type: 'player:input',
      moveX: input.moveX,
      moveZ: input.moveZ,
      aimAngle: input.aimAngle,
      biteHeld: input.biteHeld,
    });
  }

  public triggerAbility(ability: AbilityId) {
    this.send({ type: 'player:ability', ability });
  }

  public triggerEmote(emoteId: EmoteId) {
    this.send({ type: 'player:emote', emoteId });
  }

  public sendSpectateAction(action: 'prev' | 'next' | 'leader' | 'skip_death_cam') {
    this.send({ type: 'player:spectate', action });
  }

  public sendVoiceState(enabled: boolean, muted: boolean) {
    this.send({ type: 'voice:state', enabled, muted });
  }

  public sendVoiceSignal(targetId: string, signal: VoiceSignalPayload) {
    this.send({ type: 'voice:signal', targetId, signal });
  }

  public sendVoiceSpeaking(speaking: boolean) {
    this.send({ type: 'voice:speaking', speaking });
  }
}

export const multiplayerClient = new MultiplayerClient();

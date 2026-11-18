import type { EmoteId } from '../data/emotes';
import { soundEngine } from './audio';
import {
  ClientMessage,
  ClientSfxEvent,
  RemoteKeliState,
  RoomState,
  RoomSummary,
  ServerMessage,
  VoiceSignalPayload,
  WorldStatePacket,
} from './multiplayerTypes';
import { RenderableSimulation } from './scene3d';
import {
  AbilityId,
  CarcassEntity,
  DamageImpulse,
  DeathCamState,
  HudSnapshot,
  KeliEntity,
  LobbySize,
  PickupItem,
  WeatherState,
  WorldEffect,
  ZoneState,
} from './types';

function makeDefaultEntity(r?: RemoteKeliState): KeliEntity {
  return {
    id: r?.id ?? 'player',
    name: r?.name ?? 'Awang',
    isPlayer: r?.isPlayer ?? true,
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
    fatigued: r?.fatigued ?? false,
    activeHazard: r?.activeHazard ?? null,
    bitePhase: r?.bitePhase ?? 'idle',
    bitePhaseTimer: 0,
    biteCooldown: 0,
    biteAimAngle: r?.biteAimAngle ?? 0,
    biteHitApplied: false,
    stunTimer: r?.stunTimer ?? 0,
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
    sonarTimer: r?.sonarTimer ?? 0,
    sonarIsHunter: r?.sonarIsHunter ?? false,
    feedingTargetId: r?.feedingTargetId ?? null,
    feedingProgress: r?.feedingProgress ?? 0,
    feedingDuration: r?.feedingDuration ?? 0,
    cooldowns: r?.cooldowns ?? {
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
  public cameraShake = 0;
  public damageImpulse: DamageImpulse | null = null;

  private targetsById = new Map<string, RemoteKeliState>();
  private entityById = new Map<string, KeliEntity>();
  private localPlayerId: string;
  private latestHud: HudSnapshot | null = null;
  private lastPacketTime = 0;
  private speakingPeers = new Set<string>();
  private seenDamageHitIds = new Set<string>();

  constructor(localPlayerId: string) {
    this.localPlayerId = localPlayerId;
  }

  public setSpeakingPeers(ids: Set<string>) {
    this.speakingPeers = ids;
  }

  public applyServerState(packet: WorldStatePacket) {
    this.latestHud = packet.hud;
    this.zone = packet.zone;
    this.weather = packet.weather;
    this.cameraShake = Math.max(this.cameraShake, packet.cameraShake);
    this.carcasses = packet.carcasses;
    this.pickups = packet.pickups;
    this.effects = packet.effects;
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

    for (const remote of packet.kelis) {
      activeIds.add(remote.id);
      this.targetsById.set(remote.id, remote);
      let ent = this.entityById.get(remote.id);
      if (!ent) {
        ent = makeDefaultEntity(remote);
        this.entityById.set(remote.id, ent);
      } else {
        // Snap if teleported/large jump, otherwise interpolate smoothly in advance()
        const jumpDist = Math.hypot(remote.x - ent.x, remote.z - ent.z);
        if (jumpDist > 260) {
          ent.x = remote.x;
          ent.z = remote.z;
          ent.facingAngle = remote.facingAngle;
        }
        ent.name = remote.name;
        ent.isPlayer = remote.id === this.localPlayerId;
        ent.vx = remote.vx;
        ent.vz = remote.vz;
        ent.level = remote.level;
        ent.hp = remote.hp;
        ent.maxHp = remote.maxHp;
        ent.alive = remote.alive;
        ent.isOnShore = remote.isOnShore;
        ent.isSubmerged = remote.isSubmerged;
        ent.shoreReserve = remote.shoreReserve;
        ent.maxShoreReserve = remote.maxShoreReserve;
        ent.stamina = remote.stamina;
        ent.maxStamina = remote.maxStamina;
        ent.fatigued = remote.fatigued;
        ent.activeHazard = remote.activeHazard;
        ent.bitePhase = remote.bitePhase;
        ent.biteAimAngle = remote.biteAimAngle;
        ent.stunTimer = remote.stunTimer;
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
        ent.sonarTimer = remote.sonarTimer;
        ent.sonarIsHunter = remote.sonarIsHunter;
        ent.kills = remote.kills;
        ent.rivalsConsumed = remote.rivalsConsumed ?? 0;
        ent.bountyReward = remote.bountyReward ?? 0;
        ent.feedingTargetId = remote.feedingTargetId;
        ent.feedingProgress = remote.feedingProgress;
        ent.feedingDuration = remote.feedingDuration;
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
    this.kelis = nextList;

    for (const sfx of packet.sfx) {
      this.playSfx(sfx);
    }
  }

  private playSfx(sfx: ClientSfxEvent) {
    switch (sfx.kind) {
      case 'bite':
        soundEngine.playBite(false);
        break;
      case 'bite_heavy':
        soundEngine.playBite(true);
        break;
      case 'death':
        soundEngine.playDeath();
        break;
      case 'feed':
        soundEngine.playFeedComplete();
        break;
      case 'evolution':
        soundEngine.playEvolution();
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
    }
  }

  public advance(dt: number) {
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.5);
    }
    const deathCamActive = Boolean(this.getDeathCam()?.active);
    const blend = 1 - Math.exp((deathCamActive ? -11 : -18) * dt);
    const deadReckonDt = Math.min(0.06, (performance.now() - this.lastPacketTime) / 1000) * 0.45;
    const fxDt = dt * (deathCamActive ? 0.3 : 1);

    for (const ent of this.kelis) {
      ent.isSpeaking = this.speakingPeers.has(ent.id);
      const target = this.targetsById.get(ent.id);
      if (!target) continue;
      const goalX = target.x + target.vx * deadReckonDt;
      const goalZ = target.z + target.vz * deadReckonDt;
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
      const fallback = makeDefaultEntity();
      fallback.id = this.localPlayerId;
      fallback.name = hp.name;
      fallback.alive = hp.alive;
      fallback.level = hp.level;
      fallback.x = hp.x;
      fallback.z = hp.z;
      fallback.facingAngle = hp.facingAngle;
      return fallback;
    }
    return makeDefaultEntity();
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
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface MultiplayerSnapshot {
  status: ConnectionStatus;
  clientId: string | null;
  latencyMs: number | null;
  rooms: RoomSummary[];
  currentRoom: RoomState | null;
  error: string | null;
  activeMatchPlayerId: string | null;
}

const CLIENT_ID_STORAGE_KEY = 'awang_keli_ws_client_id';

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private reconnectAttempts = 0;
  private shouldStayConnected = false;

  private lastInputSentAt = 0;
  private lastSentInput = { moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false };

  private state: MultiplayerSnapshot = {
    status: 'disconnected',
    clientId: this.readStoredClientId(),
    latencyMs: null,
    rooms: [],
    currentRoom: null,
    error: null,
    activeMatchPlayerId: null,
  };

  private listeners = new Set<(snap: MultiplayerSnapshot) => void>();
  private worldListeners = new Set<(packet: WorldStatePacket) => void>();
  private matchStartListeners = new Set<(info: { playerId: string; roomCode: string }) => void>();
  private matchEndListeners = new Set<(hud: HudSnapshot) => void>();
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

  public onWorldState(cb: (packet: WorldStatePacket) => void): () => void {
    this.worldListeners.add(cb);
    return () => {
      this.worldListeners.delete(cb);
    };
  }

  public onMatchStarted(cb: (info: { playerId: string; roomCode: string }) => void): () => void {
    this.matchStartListeners.add(cb);
    return () => {
      this.matchStartListeners.delete(cb);
    };
  }

  public onMatchEnded(cb: (hud: HudSnapshot) => void): () => void {
    this.matchEndListeners.add(cb);
    return () => {
      this.matchEndListeners.delete(cb);
    };
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

  public connect() {
    this.shouldStayConnected = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    this.state.status = this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
    this.emitState();

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
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
          const activeRoomCode = this.state.currentRoom?.code;
          this.state.clientId = msg.clientId;
          this.state.rooms = msg.rooms;
          // If reconnecting while previously inside a room, re-join automatically using old clientId
          if (activeRoomCode && prevId) {
            const localName =
              this.state.currentRoom?.participants.find((p) => p.id === prevId)?.name || 'Awang';
            this.send({
              type: 'room:join',
              code: activeRoomCode,
              playerName: localName,
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
          this.state.error = null;
          this.emitState();
          break;
        }
        case 'room:state': {
          this.state.currentRoom = msg.room;
          this.emitState();
          break;
        }
        case 'room:error': {
          this.state.error = msg.message;
          this.emitState();
          break;
        }
        case 'match:started': {
          this.state.activeMatchPlayerId = msg.playerId;
          this.state.error = null;
          this.emitState();
          this.matchStartListeners.forEach((cb) =>
            cb({ playerId: msg.playerId, roomCode: msg.roomCode })
          );
          break;
        }
        case 'world:state': {
          this.worldListeners.forEach((cb) => cb(msg.state));
          break;
        }
        case 'match:ended': {
          this.matchEndListeners.forEach((cb) => cb(msg.hud));
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

      this.state.status = 'reconnecting';
      this.emitState();
      const delay = Math.min(4000, 750 * Math.pow(1.5, this.reconnectAttempts));
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

  public createRoom(playerName: string, lobbySize: LobbySize, fillWithBots: boolean, roomName?: string) {
    this.send({
      type: 'room:create',
      playerName,
      lobbySize,
      fillWithBots,
      roomName,
    });
  }

  public joinRoom(code: string, playerName: string) {
    this.send({
      type: 'room:join',
      code,
      playerName,
      clientId: this.state.clientId ?? undefined,
    });
  }

  public leaveRoom() {
    this.state.currentRoom = null;
    this.state.activeMatchPlayerId = null;
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

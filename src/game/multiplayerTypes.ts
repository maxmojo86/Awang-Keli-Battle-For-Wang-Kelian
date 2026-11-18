import {
  AbilityCooldowns,
  AbilityId,
  BitePhase,
  CarcassEntity,
  HazardTileKind,
  HudSnapshot,
  LobbySize,
  PickupItem,
  WeatherState,
  WorldEffect,
  ZoneState,
} from './types';

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomParticipant {
  id: string;
  name: string;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  keliLevel: number;
  alive: boolean;
  kills: number;
  voiceEnabled?: boolean;
  voiceMuted?: boolean;
}

export interface VoiceSignalPayload {
  sdp?: {
    type: 'offer' | 'answer' | 'pranswer' | 'rollback';
    sdp?: string;
  };
  candidate?: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
  };
}

export interface RoomChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  system?: boolean;
}

export interface RoomSummary {
  code: string;
  name: string;
  hostName: string;
  lobbySize: LobbySize;
  humanCount: number;
  maxHumans: number;
  status: RoomStatus;
  fillWithBots: boolean;
}

export interface RoomState {
  code: string;
  name: string;
  hostId: string;
  lobbySize: LobbySize;
  fillWithBots: boolean;
  status: RoomStatus;
  participants: RoomParticipant[];
  chat: RoomChatMessage[];
}

export interface RemoteKeliState {
  id: string;
  name: string;
  isPlayer: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facingAngle: number;
  level: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  isOnShore: boolean;
  isSubmerged: boolean;
  shoreReserve: number;
  maxShoreReserve: number;
  stamina: number;
  maxStamina: number;
  fatigued: boolean;
  activeHazard: HazardTileKind | null;
  bitePhase: BitePhase;
  biteAimAngle: number;
  stunTimer: number;
  venomTimer: number;
  frenzyTimer: number;
  veilTimer: number;
  dashTimer: number;
  hitFlashTimer: number;
  surgeTimer: number;
  predatorTimer: number;
  aegisTimer: number;
  dewTimer: number;
  stormFinTimer: number;
  thunderRoeTimer: number;
  sonarTimer: number;
  sonarIsHunter: boolean;
  kills: number;
  feedingTargetId: string | null;
  feedingProgress: number;
  feedingDuration: number;
  cooldowns: AbilityCooldowns;
}

export interface ClientSfxEvent {
  kind:
    | 'bite'
    | 'bite_heavy'
    | 'death'
    | 'feed'
    | 'evolution'
    | 'dash'
    | 'sonar'
    | 'hunter_sonar'
    | 'veil'
    | 'electroshock'
    | 'maelstrom'
    | 'pickup_heal'
    | 'pickup_buff'
    | 'pickup_rainfed'
    | 'weather_rain'
    | 'weather_fog'
    | 'whistle';
}

export interface WorldStatePacket {
  tick: number;
  serverTime: number;
  matchTime: number;
  status: 'playing' | 'victory' | 'defeat' | 'draw';
  cameraShake: number;
  zone: ZoneState;
  weather: WeatherState;
  kelis: RemoteKeliState[];
  carcasses: CarcassEntity[];
  pickups: PickupItem[];
  effects: WorldEffect[];
  hud: HudSnapshot;
  sfx: ClientSfxEvent[];
}

export type ClientMessage =
  | { type: 'rooms:list' }
  | {
      type: 'room:create';
      playerName: string;
      roomName?: string;
      lobbySize: LobbySize;
      fillWithBots: boolean;
    }
  | {
      type: 'room:join';
      code: string;
      playerName: string;
      clientId?: string;
    }
  | { type: 'room:leave' }
  | { type: 'room:config'; lobbySize?: LobbySize; fillWithBots?: boolean }
  | { type: 'room:ready'; ready: boolean }
  | { type: 'room:chat'; text: string }
  | { type: 'room:start' }
  | { type: 'room:restart' }
  | {
      type: 'player:input';
      moveX: number;
      moveZ: number;
      aimAngle: number;
      biteHeld: boolean;
    }
  | { type: 'player:ability'; ability: AbilityId }
  | { type: 'player:spectate'; action: 'prev' | 'next' | 'leader' }
  | { type: 'voice:state'; enabled: boolean; muted: boolean }
  | { type: 'voice:signal'; targetId: string; signal: VoiceSignalPayload }
  | { type: 'voice:speaking'; speaking: boolean }
  | { type: 'ping'; t: number };

export type ServerMessage =
  | { type: 'welcome'; clientId: string; rooms: RoomSummary[] }
  | { type: 'rooms:updated'; rooms: RoomSummary[] }
  | { type: 'room:joined'; room: RoomState; clientId: string }
  | { type: 'room:state'; room: RoomState }
  | { type: 'room:error'; message: string }
  | { type: 'match:started'; playerId: string; roomCode: string }
  | { type: 'world:state'; state: WorldStatePacket }
  | { type: 'match:ended'; hud: HudSnapshot }
  | { type: 'voice:signal'; fromId: string; fromName: string; signal: VoiceSignalPayload }
  | { type: 'voice:speaking'; peerId: string; speaking: boolean }
  | { type: 'voice:peer_left'; peerId: string }
  | { type: 'pong'; t: number };

import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { VALID_EMOTE_IDS } from '../src/data/emotes.ts';
import {
  normalizeRoomCode,
  type ClientMessage,
  type RoomChatMessage,
  type RoomParticipant,
  type RoomState,
  type RoomStatus,
  type RoomSummary,
  type ServerMessage,
} from '../src/game/multiplayerTypes.ts';
import { GameSimulation } from '../src/game/simulation.ts';
import type { AbilityId, LobbySize } from '../src/game/types.ts';

const VALID_LOBBY_SIZES = new Set<LobbySize>([5, 10, 20, 25, 50, 100]);
const VALID_ABILITIES = new Set<AbilityId>([
  'bite',
  'evade',
  'dash',
  'sonar',
  'veil',
  'electroshock',
  'maelstrom',
]);

interface ConnectedClient {
  id: string;
  name: string;
  ws: WebSocket;
  roomCode: string | null;
  lastAbilityAtByType: Partial<Record<AbilityId, number>>;
}

interface RoomMember {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  voiceEnabled: boolean;
  voiceMuted: boolean;
}

interface RoomRecord {
  code: string;
  name: string;
  hostId: string;
  lobbySize: LobbySize;
  fillWithBots: boolean;
  status: RoomStatus;
  matchId: string | null;
  members: Map<string, RoomMember>;
  chat: RoomChatMessage[];
  sim: GameSimulation | null;
  tick: number;
  loopTimer: NodeJS.Timeout | null;
  broadcastCounter: number;
  cleanupTimer: NodeJS.Timeout | null;
  matchEndedSent: boolean;
}

export interface MultiplayerServerOptions {
  path?: string;
  silentLogs?: boolean;
  logger?: (line: string) => void;
  tickIntervalMs?: number;
}

export interface MultiplayerHub {
  wss: WebSocketServer;
  getRoomSummaries: () => RoomSummary[];
  getHealthStats: () => { rooms: number; clients: number };
  getRoomSimulation: (code: string) => GameSimulation | null;
  close: () => Promise<void>;
}

function shortPlayerId(id: string | null | undefined): string {
  if (!id) return '-';
  const parts = id.split('-');
  const tail = parts[parts.length - 1] ?? id;
  return `p_${tail.slice(-6)}`;
}

function sanitizeName(raw: unknown, fallback = 'Awang'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 18);
  return cleaned || fallback;
}

function isDefaultPlaceholderName(raw: unknown): boolean {
  if (typeof raw !== 'string') return true;
  const cleaned = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  return !cleaned || cleaned === 'awang' || cleaned === 'awang keli';
}

export function attachMultiplayerServer(
  httpServer: HttpServer,
  options: MultiplayerServerOptions = {}
): MultiplayerHub {
  const clients = new Map<WebSocket, ConnectedClient>();
  const clientsById = new Map<string, ConnectedClient>();
  const rooms = new Map<string, RoomRecord>();

  const wsPath = options.path ?? '/ws';
  const simDt = 1 / 30;
  const tickIntervalMs = options.tickIntervalMs ?? Math.round(simDt * 1000);
  const logFn = options.silentLogs
    ? () => {}
    : options.logger ?? ((line: string) => console.log(line));

  let seqCounter = 1;
  function nextSeq(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${seqCounter++}`;
  }

  function logEvent(
    event: string,
    meta: {
      room?: string | null;
      match?: string | null;
      player?: string | null;
      detail?: string;
    } = {}
  ) {
    const parts = [
      `[MP] event=${event}`,
      `room=${meta.room || '-'}`,
      `match=${meta.match || '-'}`,
      `player=${shortPlayerId(meta.player)}`,
    ];
    if (meta.detail) {
      parts.push(`detail=${meta.detail}`);
    }
    logFn(parts.join(' '));
  }

  function generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = '';
      for (let i = 0; i < 5; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!rooms.has(code)) return code;
    }
    return `WK${Math.floor(100 + Math.random() * 899)}`;
  }

  function sendToClient(client: ConnectedClient | undefined, msg: ServerMessage) {
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;
    try {
      client.ws.send(JSON.stringify(msg));
    } catch {
      // Ignore closed socket send races
    }
  }

  function getRoomSummaries(): RoomSummary[] {
    const list: RoomSummary[] = [];
    for (const room of rooms.values()) {
      const connectedCount = Array.from(room.members.values()).filter((m) => m.connected).length;
      if (connectedCount === 0 && room.status !== 'playing') continue;
      const host = room.members.get(room.hostId);
      list.push({
        code: room.code,
        name: room.name,
        hostName: host?.name ?? 'Host',
        lobbySize: room.lobbySize,
        humanCount: room.members.size,
        maxHumans: room.lobbySize,
        status: room.status,
        fillWithBots: room.fillWithBots,
      });
    }
    return list;
  }

  function broadcastRoomsList() {
    const summary = getRoomSummaries();
    const payload: ServerMessage = { type: 'rooms:updated', rooms: summary };
    for (const client of clients.values()) {
      if (!client.roomCode) {
        sendToClient(client, payload);
      }
    }
  }

  function serializeRoomState(room: RoomRecord): RoomState {
    const participants: RoomParticipant[] = [];
    for (const member of room.members.values()) {
      const keli = room.sim?.kelis.find((k) => k.id === member.id);
      participants.push({
        id: member.id,
        name: member.name,
        isHost: member.id === room.hostId,
        ready: member.ready,
        connected: member.connected,
        keliLevel: keli ? (keli.alive ? keli.level : (keli.eliminatedAtLevel ?? 0)) : 1,
        alive: keli?.alive ?? true,
        kills: keli?.kills ?? 0,
        voiceEnabled: member.voiceEnabled,
        voiceMuted: member.voiceMuted,
      });
    }
    return {
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      lobbySize: room.lobbySize,
      fillWithBots: room.fillWithBots,
      status: room.status,
      activeMatchId: room.matchId,
      participants,
      chat: room.chat.slice(-40),
    };
  }

  function broadcastRoomState(room: RoomRecord) {
    const msg: ServerMessage = { type: 'room:state', room: serializeRoomState(room) };
    for (const member of room.members.values()) {
      if (member.connected) {
        sendToClient(clientsById.get(member.id), msg);
      }
    }
  }

  function pushSystemChat(room: RoomRecord, text: string) {
    room.chat.push({
      id: nextSeq('chat'),
      senderId: 'system',
      senderName: 'Lubuk Hitam',
      text,
      timestamp: Date.now(),
      system: true,
    });
    if (room.chat.length > 50) room.chat.shift();
  }

  function stopRoomLoop(room: RoomRecord) {
    if (room.loopTimer) {
      clearInterval(room.loopTimer);
      room.loopTimer = null;
    }
  }

  function scheduleRoomCleanupIfEmpty(room: RoomRecord) {
    const anyConnected = Array.from(room.members.values()).some((m) => m.connected);
    if (anyConnected) {
      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
      }
      return;
    }
    if (room.cleanupTimer) return;
    room.cleanupTimer = setTimeout(() => {
      const stillAny = Array.from(room.members.values()).some((m) => m.connected);
      if (!stillAny) {
        stopRoomLoop(room);
        rooms.delete(room.code);
        broadcastRoomsList();
      }
    }, 30000);
  }

  function leaveCurrentRoom(client: ConnectedClient, permanent: boolean) {
    if (!client.roomCode) return;
    const room = rooms.get(client.roomCode);
    const oldCode = client.roomCode;
    client.roomCode = null;
    if (!room) return;

    const member = room.members.get(client.id);
    if (!member) return;

    if (permanent) {
      if (room.status === 'playing' && room.sim) {
        // AI takes over so 100-fragment conservation never breaks
        room.sim.setHumanConnected(client.id, false);
      }
      room.members.delete(client.id);
      pushSystemChat(room, `${member.name} left the basin.`);
      logEvent('room_leave', {
        room: oldCode,
        match: room.matchId,
        player: client.id,
        detail: `remaining=${room.members.size}`,
      });
      if (room.hostId === client.id) {
        const nextHost =
          Array.from(room.members.values()).find((m) => m.connected) ??
          Array.from(room.members.values())[0];
        if (nextHost) {
          room.hostId = nextHost.id;
          pushSystemChat(room, `${nextHost.name} is now Basin Host.`);
        }
      }
    } else {
      member.connected = false;
      member.voiceEnabled = false;
      if (room.status === 'playing' && room.sim) {
        room.sim.setHumanConnected(client.id, false);
      }
      logEvent('room_disconnect_slot_held', {
        room: oldCode,
        match: room.matchId,
        player: client.id,
      });
    }

    for (const m of room.members.values()) {
      if (m.connected && m.id !== client.id) {
        sendToClient(clientsById.get(m.id), { type: 'voice:peer_left', peerId: client.id });
      }
    }

    if (room.members.size === 0) {
      stopRoomLoop(room);
      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
      }
      rooms.delete(room.code);
    } else {
      broadcastRoomState(room);
      scheduleRoomCleanupIfEmpty(room);
    }
    broadcastRoomsList();
  }

  function startRoomMatch(room: RoomRecord) {
    stopRoomLoop(room);
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    const connectedMembers = Array.from(room.members.values()).filter((m) => m.connected);
    if (connectedMembers.length === 0) return;

    // Remove any stale disconnected ghosts before match launch
    for (const [id, m] of room.members.entries()) {
      if (!m.connected) room.members.delete(id);
    }

    const humanEntrants = connectedMembers.map((m) => ({
      id: m.id,
      name: m.name,
    }));

    const effectiveSize: LobbySize = room.fillWithBots
      ? (Math.max(room.lobbySize, humanEntrants.length) as LobbySize)
      : (Math.max(2, humanEntrants.length) as LobbySize);

    const host = room.members.get(room.hostId);
    const matchId = nextSeq('match');
    const sim = new GameSimulation(effectiveSize, 'royale', host?.name ?? humanEntrants[0].name, {
      humanEntrants,
      emitLocalSound: false,
      isMultiplayerMatch: true,
    });

    room.sim = sim;
    room.matchId = matchId;
    room.status = 'playing';
    room.tick = 0;
    room.broadcastCounter = 0;
    room.matchEndedSent = false;

    logEvent('match_start', {
      room: room.code,
      match: matchId,
      player: room.hostId,
      detail: `humans=${humanEntrants.length},total=${sim.kelis.length}`,
    });

    pushSystemChat(
      room,
      `Match started with ${humanEntrants.length} human${humanEntrants.length > 1 ? 's' : ''} & ${
        sim.kelis.length - humanEntrants.length
      } AI Kelis.`
    );
    broadcastRoomState(room);
    broadcastRoomsList();

    for (const m of connectedMembers) {
      sendToClient(clientsById.get(m.id), {
        type: 'match:started',
        playerId: m.id,
        roomCode: room.code,
        matchId,
      });
    }

    // Send immediate tick 0 snapshot
    for (const m of connectedMembers) {
      sendToClient(clientsById.get(m.id), {
        type: 'world:state',
        state: sim.getRemoteWorldStateFor(m.id, 0, matchId, room.code),
      });
    }

    room.loopTimer = setInterval(() => {
      if (!room.sim || room.status !== 'playing' || !room.matchId) {
        stopRoomLoop(room);
        return;
      }

      room.sim.step(simDt);
      room.tick += 1;
      room.broadcastCounter += 1;

      // Broadcast world state at ~20 Hz (ticks 0, 2, 3, 5... or every tick when ending)
      const finished = room.sim.status !== 'playing';
      const shouldBroadcast = finished || room.tick % 2 === 0 || room.tick % 3 === 0;
      const activeMatchId = room.matchId;

      if (shouldBroadcast) {
        for (const m of room.members.values()) {
          if (!m.connected) continue;
          const client = clientsById.get(m.id);
          if (!client) continue;
          const packet = room.sim.getRemoteWorldStateFor(m.id, room.tick, activeMatchId, room.code);
          sendToClient(client, { type: 'world:state', state: packet });
          if (finished && !room.matchEndedSent) {
            sendToClient(client, {
              type: 'match:ended',
              hud: packet.hud,
              matchId: activeMatchId,
              roomCode: room.code,
            });
          }
        }
      }

      if (finished && !room.matchEndedSent) {
        room.matchEndedSent = true;
        room.status = 'finished';
        stopRoomLoop(room);
        for (const m of room.members.values()) {
          m.ready = m.id === room.hostId;
        }
        logEvent('match_end', {
          room: room.code,
          match: activeMatchId,
          player: room.sim.winnerId,
          detail: `status=${room.sim.status}`,
        });
        pushSystemChat(
          room,
          room.sim.winnerName
            ? `${room.sim.winnerName} crowned Keli King (Lv.100)!`
            : 'Match concluded with no survivors.'
        );
        broadcastRoomState(room);
        broadcastRoomsList();
      }
    }, tickIntervalMs);
  }

  function handleMessage(client: ConnectedClient, raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'ping': {
        sendToClient(client, { type: 'pong', t: Number(msg.t) || Date.now() });
        break;
      }

      case 'rooms:list': {
        sendToClient(client, { type: 'rooms:updated', rooms: getRoomSummaries() });
        break;
      }

      case 'room:create': {
        leaveCurrentRoom(client, true);
        client.name = sanitizeName(msg.playerName, client.name);
        const code = generateRoomCode();
        const lobbySize: LobbySize = VALID_LOBBY_SIZES.has(msg.lobbySize) ? msg.lobbySize : 20;
        const roomName =
          typeof msg.roomName === 'string' && msg.roomName.trim()
            ? msg.roomName.trim().slice(0, 28)
            : `${client.name}'s Basin`;

        const room: RoomRecord = {
          code,
          name: roomName,
          hostId: client.id,
          lobbySize,
          fillWithBots: Boolean(msg.fillWithBots),
          status: 'waiting',
          matchId: null,
          members: new Map([
            [
              client.id,
              {
                id: client.id,
                name: client.name,
                ready: true,
                connected: true,
                voiceEnabled: false,
                voiceMuted: false,
              },
            ],
          ]),
          chat: [],
          sim: null,
          tick: 0,
          loopTimer: null,
          broadcastCounter: 0,
          cleanupTimer: null,
          matchEndedSent: false,
        };
        pushSystemChat(room, `Basin ${code} opened by ${client.name}.`);
        rooms.set(code, room);
        client.roomCode = code;

        logEvent('room_create', {
          room: code,
          player: client.id,
          detail: `lobbySize=${lobbySize},bots=${room.fillWithBots}`,
        });

        sendToClient(client, {
          type: 'room:joined',
          room: serializeRoomState(room),
          clientId: client.id,
        });
        broadcastRoomsList();
        break;
      }

      case 'room:join': {
        const code = normalizeRoomCode(msg.code);
        const room = code ? rooms.get(code) : undefined;
        if (!room) {
          sendToClient(client, {
            type: 'room:error',
            message: `Basin "${code || '???'}" was not found or has already closed.`,
          });
          return;
        }

        const prevClientId = typeof msg.clientId === 'string' ? msg.clientId : null;
        const reconnectingMember = prevClientId ? room.members.get(prevClientId) : undefined;

        // Support seamless reconnect if the player's previous clientId is in this room
        if (reconnectingMember && prevClientId && prevClientId !== client.id) {
          const oldConn = clientsById.get(prevClientId);
          if (!oldConn || oldConn.ws.readyState !== WebSocket.OPEN) {
            clientsById.delete(client.id);
            client.id = prevClientId;
            clientsById.set(client.id, client);
          }
        }

        const existingMember = room.members.get(client.id);

        if (existingMember) {
          // Preserve custom member name on reconnect — never overwrite a valid name with default placeholder
          if (room.status === 'playing') {
            client.name = existingMember.name;
          } else if (isDefaultPlaceholderName(msg.playerName) && !isDefaultPlaceholderName(existingMember.name)) {
            client.name = existingMember.name;
          } else {
            client.name = sanitizeName(msg.playerName, existingMember.name);
            existingMember.name = client.name;
          }
          existingMember.connected = true;
          client.roomCode = room.code;
          if (room.cleanupTimer) {
            clearTimeout(room.cleanupTimer);
            room.cleanupTimer = null;
          }

          logEvent('room_reconnect', {
            room: room.code,
            match: room.matchId,
            player: client.id,
            detail: `status=${room.status}`,
          });

          if (room.status === 'playing' && room.sim && room.matchId) {
            room.sim.setHumanConnected(client.id, true);
            sendToClient(client, {
              type: 'room:joined',
              room: serializeRoomState(room),
              clientId: client.id,
            });
            sendToClient(client, {
              type: 'match:started',
              playerId: client.id,
              roomCode: room.code,
              matchId: room.matchId,
            });
            sendToClient(client, {
              type: 'world:state',
              state: room.sim.getRemoteWorldStateFor(client.id, room.tick, room.matchId, room.code),
            });
          } else {
            sendToClient(client, {
              type: 'room:joined',
              room: serializeRoomState(room),
              clientId: client.id,
            });
          }
          broadcastRoomState(room);
          broadcastRoomsList();
          return;
        }

        if (room.status === 'playing') {
          sendToClient(client, {
            type: 'room:error',
            message: `Basin ${code} is already mid-match. Create a new basin or wait for this round to finish.`,
          });
          return;
        }

        if (room.members.size >= room.lobbySize) {
          sendToClient(client, {
            type: 'room:error',
            message: `Basin ${code} is full (${room.lobbySize}/${room.lobbySize}).`,
          });
          return;
        }

        client.name = sanitizeName(msg.playerName, client.name);
        leaveCurrentRoom(client, true);
        if (room.status === 'finished') {
          room.status = 'waiting';
          room.sim = null;
          room.matchId = null;
        }
        if (room.cleanupTimer) {
          clearTimeout(room.cleanupTimer);
          room.cleanupTimer = null;
        }

        room.members.set(client.id, {
          id: client.id,
          name: client.name,
          ready: false,
          connected: true,
          voiceEnabled: false,
          voiceMuted: false,
        });
        client.roomCode = room.code;
        pushSystemChat(room, `${client.name} swam into the basin.`);

        logEvent('room_join', {
          room: room.code,
          player: client.id,
          detail: `members=${room.members.size}`,
        });

        sendToClient(client, {
          type: 'room:joined',
          room: serializeRoomState(room),
          clientId: client.id,
        });
        broadcastRoomState(room);
        broadcastRoomsList();
        break;
      }

      case 'room:rename': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || room.status === 'playing') return;
        const member = room.members.get(client.id);
        if (!member) return;
        const prevName = member.name;
        const nextName = sanitizeName(msg.playerName, prevName);
        if (nextName === prevName) return;

        member.name = nextName;
        client.name = nextName;
        if (room.hostId === client.id && room.name === `${prevName}'s Basin`) {
          room.name = `${nextName}'s Basin`;
        }
        logEvent('room_rename', {
          room: room.code,
          player: client.id,
        });
        broadcastRoomState(room);
        broadcastRoomsList();
        break;
      }

      case 'room:leave': {
        leaveCurrentRoom(client, true);
        sendToClient(client, { type: 'rooms:updated', rooms: getRoomSummaries() });
        break;
      }

      case 'room:config': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || room.hostId !== client.id || room.status === 'playing') return;
        if (msg.lobbySize && VALID_LOBBY_SIZES.has(msg.lobbySize)) {
          room.lobbySize = msg.lobbySize;
        }
        if (typeof msg.fillWithBots === 'boolean') {
          room.fillWithBots = msg.fillWithBots;
        }
        broadcastRoomState(room);
        broadcastRoomsList();
        break;
      }

      case 'room:ready': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || room.status === 'playing') return;
        const member = room.members.get(client.id);
        if (!member) return;
        member.ready = Boolean(msg.ready);
        broadcastRoomState(room);
        break;
      }

      case 'room:chat': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room) return;
        const text =
          typeof msg.text === 'string' ? msg.text.replace(/\s+/g, ' ').trim().slice(0, 180) : '';
        if (!text) return;
        room.chat.push({
          id: nextSeq('chat'),
          senderId: client.id,
          senderName: client.name,
          text,
          timestamp: Date.now(),
        });
        if (room.chat.length > 50) room.chat.shift();
        broadcastRoomState(room);
        break;
      }

      case 'room:start': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || room.hostId !== client.id || room.status === 'playing') return;
        const connectedCount = Array.from(room.members.values()).filter((m) => m.connected).length;
        if (!room.fillWithBots && connectedCount < 2) {
          sendToClient(client, {
            type: 'room:error',
            message: 'Human-only match requires at least 2 players, or enable AI Bot Backfill.',
          });
          return;
        }
        startRoomMatch(room);
        break;
      }

      case 'room:restart': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || room.hostId !== client.id || room.status === 'playing') return;
        const connectedCount = Array.from(room.members.values()).filter((m) => m.connected).length;
        if (!room.fillWithBots && connectedCount < 2) {
          sendToClient(client, {
            type: 'room:error',
            message: 'Human-only rematch requires at least 2 players, or enable AI Bot Backfill.',
          });
          return;
        }
        startRoomMatch(room);
        break;
      }

      case 'player:input': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || room.status !== 'playing' || !room.sim || room.sim.status !== 'playing') return;
        const moveX = Number.isFinite(msg.moveX) ? Math.max(-1, Math.min(1, msg.moveX)) : 0;
        const moveZ = Number.isFinite(msg.moveZ) ? Math.max(-1, Math.min(1, msg.moveZ)) : 0;
        const aimAngle = Number.isFinite(msg.aimAngle) ? msg.aimAngle : 0;
        const biteHeld = Boolean(msg.biteHeld);
        room.sim.setInputForPlayer(client.id, { moveX, moveZ, aimAngle, biteHeld });
        break;
      }

      case 'player:ability': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || room.status !== 'playing' || !room.sim || room.sim.status !== 'playing') return;
        if (!VALID_ABILITIES.has(msg.ability)) return;
        // Network duplicate-packet deduplication (prevents duplicate packet bursts from double-triggering)
        const nowMs = Date.now();
        const lastAt = client.lastAbilityAtByType[msg.ability] ?? 0;
        if (nowMs - lastAt < 40) return;
        client.lastAbilityAtByType[msg.ability] = nowMs;
        room.sim.triggerAbilityForPlayer(client.id, msg.ability);
        break;
      }

      case 'player:emote': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || room.status !== 'playing' || !room.sim || room.sim.status !== 'playing') return;
        if (!VALID_EMOTE_IDS.has(msg.emoteId)) return;
        room.sim.triggerEmoteForPlayer(client.id, msg.emoteId);
        break;
      }

      case 'player:spectate': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || !room.sim) return;
        if (msg.action === 'prev') room.sim.cycleSpectateTargetFor(client.id, -1);
        else if (msg.action === 'next') room.sim.cycleSpectateTargetFor(client.id, 1);
        else if (msg.action === 'leader') room.sim.spectateLeaderFor(client.id);
        else if (msg.action === 'skip_death_cam') room.sim.skipDeathCamFor(client.id);
        break;
      }

      case 'voice:state': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room) return;
        const member = room.members.get(client.id);
        if (!member) return;
        const wasEnabled = member.voiceEnabled;
        member.voiceEnabled = Boolean(msg.enabled);
        member.voiceMuted = Boolean(msg.muted);
        if (wasEnabled && !member.voiceEnabled) {
          for (const m of room.members.values()) {
            if (m.connected && m.id !== client.id) {
              sendToClient(clientsById.get(m.id), { type: 'voice:peer_left', peerId: client.id });
            }
          }
        }
        broadcastRoomState(room);
        break;
      }

      case 'voice:signal': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room) return;
        const targetId = typeof msg.targetId === 'string' ? msg.targetId : '';
        if (!targetId || targetId === client.id) return;
        const targetMember = room.members.get(targetId);
        if (!targetMember || !targetMember.connected) return;
        sendToClient(clientsById.get(targetId), {
          type: 'voice:signal',
          fromId: client.id,
          fromName: client.name,
          signal: msg.signal,
        });
        break;
      }

      case 'voice:speaking': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room) return;
        const speaking = Boolean(msg.speaking);
        for (const m of room.members.values()) {
          if (m.connected && m.id !== client.id) {
            sendToClient(clientsById.get(m.id), {
              type: 'voice:speaking',
              peerId: client.id,
              speaking,
            });
          }
        }
        break;
      }
    }
  }

  const wss = new WebSocketServer({ server: httpServer, path: wsPath });

  wss.on('connection', (ws) => {
    const client: ConnectedClient = {
      id: nextSeq('keli'),
      name: 'Awang',
      ws,
      roomCode: null,
      lastAbilityAtByType: {},
    };
    clients.set(ws, client);
    clientsById.set(client.id, client);

    logEvent('connect', { player: client.id, detail: `clients=${clients.size}` });

    sendToClient(client, {
      type: 'welcome',
      clientId: client.id,
      rooms: getRoomSummaries(),
    });

    ws.on('message', (data) => {
      handleMessage(client, String(data));
    });

    ws.on('close', () => {
      const roomCode = client.roomCode;
      clients.delete(ws);
      if (clientsById.get(client.id) === client) {
        clientsById.delete(client.id);
      }
      logEvent('disconnect', {
        room: roomCode,
        player: client.id,
        detail: `clients=${clients.size}`,
      });
      // Keep match member slot alive briefly for reconnection if playing
      const room = roomCode ? rooms.get(roomCode) : undefined;
      if (room && room.status === 'playing') {
        leaveCurrentRoom(client, false);
      } else {
        leaveCurrentRoom(client, true);
      }
    });
  });

  return {
    wss,
    getRoomSummaries,
    getHealthStats: () => ({ rooms: rooms.size, clients: clients.size }),
    getRoomSimulation: (code: string) => rooms.get(normalizeRoomCode(code))?.sim ?? null,
    close: async () => {
      for (const room of rooms.values()) {
        stopRoomLoop(room);
        if (room.cleanupTimer) {
          clearTimeout(room.cleanupTimer);
          room.cleanupTimer = null;
        }
      }
      rooms.clear();
      for (const ws of clients.keys()) {
        try {
          ws.terminate();
        } catch {
          // Ignore already closed sockets
        }
      }
      clients.clear();
      clientsById.clear();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}

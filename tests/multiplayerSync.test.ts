import assert from 'node:assert/strict';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import WebSocket from 'ws';
import { attachMultiplayerServer, type MultiplayerHub } from '../server/multiplayerServer.ts';
import { MultiplayerClient, RemoteSimulationView } from '../src/game/multiplayerClient.ts';
import {
  normalizeRoomCode,
  type ClientMessage,
  type ServerMessage,
  type WorldStatePacket,
} from '../src/game/multiplayerTypes.ts';
import {
  buildNameplateCacheKey,
  formatOverheadNameplateLabel,
  resolveHudDisplayName,
} from '../src/game/nameplate.ts';

class TestWsClient {
  public ws: WebSocket;
  public messages: ServerMessage[] = [];
  public clientId: string | null = null;
  private waiters: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (msg.type === 'welcome' || msg.type === 'room:joined') {
        this.clientId = msg.clientId;
      }
      this.messages.push(msg);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        if (w.predicate(msg)) {
          clearTimeout(w.timer);
          this.waiters.splice(i, 1);
          w.resolve(msg);
        }
      }
    });
  }

  public async waitForOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onErr = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        this.ws.off('open', onOpen);
        this.ws.off('error', onErr);
      };
      this.ws.on('open', onOpen);
      this.ws.on('error', onErr);
    });
  }

  public send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  public waitFor<T extends ServerMessage = ServerMessage>(
    predicate: (msg: ServerMessage) => msg is T,
    timeoutMs?: number,
    scanExisting?: boolean
  ): Promise<T>;
  public waitFor(
    predicate: (msg: ServerMessage) => boolean,
    timeoutMs?: number,
    scanExisting?: boolean
  ): Promise<ServerMessage>;
  public waitFor(
    predicate: (msg: ServerMessage) => boolean,
    timeoutMs = 5000,
    scanExisting = false
  ): Promise<ServerMessage> {
    if (scanExisting) {
      for (let i = this.messages.length - 1; i >= 0; i--) {
        if (predicate(this.messages[i])) {
          return Promise.resolve(this.messages[i]);
        }
      }
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for expected WS message`));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  public getLatestWorldState(matchId?: string): WorldStatePacket | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.type === 'world:state') {
        if (!matchId || m.state.matchId === matchId) return m.state;
      }
    }
    return null;
  }

  public async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

async function startTestServer(logs: string[] = []): Promise<{
  httpServer: HttpServer;
  hub: MultiplayerHub;
  wsUrl: string;
  shutdown: () => Promise<void>;
}> {
  const httpServer = createServer();
  const hub = attachMultiplayerServer(httpServer, {
    path: '/ws',
    tickIntervalMs: 16,
    logger: (line) => logs.push(line),
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = httpServer.address() as AddressInfo;
  const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
  return {
    httpServer,
    hub,
    wsUrl,
    shutdown: async () => {
      await hub.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

describe('Multiplayer synchronization, custom names, and lifecycle reliability', () => {
  it('unit: resolves HUD display names, overhead nameplate labels, and invalidates cache keys on name changes', () => {
    assert.equal(
      resolveHudDisplayName({
        isSpectating: false,
        authoritativePlayerName: 'Mujahid',
        fallbackPlayerName: 'Ignored',
      }),
      'Mujahid'
    );
    assert.equal(
      resolveHudDisplayName({
        isSpectating: false,
        authoritativePlayerName: '',
        fallbackPlayerName: 'Tester',
      }),
      'Tester'
    );
    assert.equal(
      resolveHudDisplayName({
        isSpectating: false,
        authoritativePlayerName: null,
        fallbackPlayerName: null,
      }),
      'Awang Keli'
    );
    assert.equal(
      resolveHudDisplayName({
        isSpectating: true,
        spectateTargetName: 'Tester',
        authoritativePlayerName: 'Mujahid',
      }),
      'Tester'
    );

    assert.equal(formatOverheadNameplateLabel('Mujahid', 15, true, false), 'Lv.15 Mujahid');
    assert.equal(formatOverheadNameplateLabel('Tester', 12, false, true), '(( )) Lv.12 Tester');
    assert.equal(formatOverheadNameplateLabel('', 1, true, false), 'Lv.1 Awang Keli');

    const baseKeyInput = {
      level: 10,
      hpBucket: 20,
      isPlayer: true,
      name: 'Awang Keli',
      isHigherLevel: false,
      stunned: false,
      staggered: false,
      stunResist: false,
      evading: false,
      venom: false,
      speaking: false,
      emoteId: '',
      bountyPts: 0,
    };
    const keyBefore = buildNameplateCacheKey(baseKeyInput);
    const keyAfter = buildNameplateCacheKey({ ...baseKeyInput, name: 'Mujahid' });
    assert.notEqual(keyBefore, keyAfter, 'Name change must invalidate nameplate cache key');
    assert.equal(normalizeRoomCode('  wk-842  '), 'WK842');
  });

  it('unit: RemoteSimulationView normalizes isPlayer on first entity creation and rejects stale matchId snapshots', () => {
    const viewA = new RemoteSimulationView('keli-a', 'match-1');
    const viewB = new RemoteSimulationView('keli-b', 'match-1');

    const makePacket = (
      matchId: string,
      tick: number,
      localId: string,
      localName: string
    ): WorldStatePacket =>
      ({
        matchId,
        roomCode: 'WK123',
        tick,
        serverTime: Date.now(),
        matchTime: tick * 0.05,
        status: 'playing',
        cameraShake: 0,
        zone: {
          centerX: 2900,
          centerZ: 3400,
          currentRadius: 2700,
          targetRadius: 2700,
          phase: 1,
          warningTimer: 20,
          isShrinking: false,
        },
        weather: {
          kind: 'clear',
          label: 'Clear',
          intensity: 0,
          remainingSec: 20,
          visibilityRange: 1,
        },
        // Intentionally mark BOTH entities isPlayer: true to prove client normalizes strictly by localPlayerId
        kelis: [
          {
            id: 'keli-a',
            name: 'Mujahid',
            isPlayer: true,
            x: 2000,
            z: 2000,
            vx: 0,
            vz: 0,
            facingAngle: 0,
            level: 50,
            hp: 200,
            maxHp: 200,
            alive: true,
            isOnShore: false,
            isSubmerged: true,
            shoreReserve: 10,
            maxShoreReserve: 10,
            stamina: 100,
            maxStamina: 100,
            fatigued: false,
            activeHazard: null,
            bitePhase: 'idle',
            biteAimAngle: 0,
            stunTimer: 0,
            venomTimer: 0,
            frenzyTimer: 0,
            veilTimer: 0,
            dashTimer: 0,
            hitFlashTimer: 0,
            surgeTimer: 0,
            predatorTimer: 0,
            aegisTimer: 0,
            dewTimer: 0,
            stormFinTimer: 0,
            thunderRoeTimer: 0,
            sonarTimer: 0,
            sonarIsHunter: false,
            kills: 0,
            feedingTargetId: null,
            feedingProgress: 0,
            feedingDuration: 0,
            cooldowns: {
              evade: 0,
              dash: 0,
              sonar: 0,
              veil: 0,
              electroshock: 0,
              maelstrom: 0,
            },
            activeEmote: null,
          },
          {
            id: 'keli-b',
            name: 'Tester',
            isPlayer: true,
            x: 2100,
            z: 2000,
            vx: 0,
            vz: 0,
            facingAngle: 0,
            level: 50,
            hp: 200,
            maxHp: 200,
            alive: true,
            isOnShore: false,
            isSubmerged: true,
            shoreReserve: 10,
            maxShoreReserve: 10,
            stamina: 100,
            maxStamina: 100,
            fatigued: false,
            activeHazard: null,
            bitePhase: 'idle',
            biteAimAngle: 0,
            stunTimer: 0,
            venomTimer: 0,
            frenzyTimer: 0,
            veilTimer: 0,
            dashTimer: 0,
            hitFlashTimer: 0,
            surgeTimer: 0,
            predatorTimer: 0,
            aegisTimer: 0,
            dewTimer: 0,
            stormFinTimer: 0,
            thunderRoeTimer: 0,
            sonarTimer: 0,
            sonarIsHunter: false,
            kills: 0,
            feedingTargetId: null,
            feedingProgress: 0,
            feedingDuration: 0,
            cooldowns: {
              evade: 0,
              dash: 0,
              sonar: 0,
              veil: 0,
              electroshock: 0,
              maelstrom: 0,
            },
            activeEmote: null,
          },
        ],
        carcasses: [],
        pickups: [],
        effects: [],
        hud: {
          player: { id: localId, name: localName, alive: true, level: 50, x: 2000, z: 2000, facingAngle: 0 },
          matchResult: { status: 'playing', winnerId: null, winnerName: null, ledger: [] },
        } as unknown as WorldStatePacket['hud'],
        sfx: [],
      }) as WorldStatePacket;

    // Stale match packet must be rejected
    assert.equal(viewA.applyServerState(makePacket('match-old', 0, 'keli-a', 'Mujahid')), false);
    assert.equal(viewA.hasReceivedSnapshot, false);

    // Valid match packet accepted; isPlayer strictly normalized on creation
    assert.equal(viewA.applyServerState(makePacket('match-1', 0, 'keli-a', 'Mujahid')), true);
    assert.equal(viewB.applyServerState(makePacket('match-1', 0, 'keli-b', 'Tester')), true);

    assert.equal(viewA.kelis.find((k) => k.id === 'keli-a')?.isPlayer, true);
    assert.equal(viewA.kelis.find((k) => k.id === 'keli-b')?.isPlayer, false);
    assert.equal(viewB.kelis.find((k) => k.id === 'keli-a')?.isPlayer, false);
    assert.equal(viewB.kelis.find((k) => k.id === 'keli-b')?.isPlayer, true);
  });

  it('e2e two-client acceptance: shared room, rename, host-only launch, shared matchId, independent input, movement, combat/carcass/feeding, reconnect, rematch, and failure handling', async () => {
    const serverLogs: string[] = [];
    const { hub, wsUrl, shutdown } = await startTestServer(serverLogs);

    const c1 = new TestWsClient(wsUrl);
    const c2 = new TestWsClient(wsUrl);

    try {
      // 1. Connect two independent clients and confirm distinct server-assigned IDs
      const welcome1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
      const welcome2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
      await Promise.all([c1.waitForOpen(), c2.waitForOpen()]);
      const [w1, w2] = await Promise.all([welcome1P, welcome2P]);
      assert.ok(w1.clientId);
      assert.ok(w2.clientId);
      assert.notEqual(w1.clientId, w2.clientId, 'Two clients must receive distinct server IDs');

      // 10a. Missing room rejection (must NOT auto-create a room)
      const missingErrP = c2.waitFor((m): m is Extract<ServerMessage, { type: 'room:error' }> => m.type === 'room:error');
      c2.send({ type: 'room:join', code: 'NOPE99', playerName: 'Tester' });
      const missingErr = await missingErrP;
      assert.match(missingErr.message, /not found/i);
      assert.equal(hub.getHealthStats().rooms, 0, 'Missing room join must never auto-create a room');

      // 2. Client 1 ("Mujahid") creates room; Client 2 ("Tester") joins using normalized code
      const joined1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'room:joined' }> => m.type === 'room:joined');
      c1.send({
        type: 'room:create',
        playerName: 'Mujahid',
        lobbySize: 5,
        fillWithBots: false,
      });
      const joined1 = await joined1P;
      const roomCode = joined1.room.code;
      assert.equal(joined1.room.hostId, w1.clientId);
      assert.equal(joined1.room.participants.length, 1);
      assert.equal(joined1.room.participants[0].name, 'Mujahid');

      const state1AfterJoinP = c1.waitFor(
        (m): m is Extract<ServerMessage, { type: 'room:state' }> =>
          m.type === 'room:state' && m.room.participants.length === 2
      );
      const joined2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'room:joined' }> => m.type === 'room:joined');
      c2.send({
        type: 'room:join',
        code: `  ${roomCode.toLowerCase()}  `,
        playerName: 'TempGuest',
      });
      const [joined2, state1AfterJoin] = await Promise.all([joined2P, state1AfterJoinP]);
      assert.equal(joined2.room.code, roomCode);
      assert.equal(joined2.room.participants.length, 2);
      assert.equal(state1AfterJoin.room.participants.length, 2);

      // 3. Waiting-room rename syncs custom name ("Tester") to server & both clients before launch
      const rename1P = c1.waitFor(
        (m): m is Extract<ServerMessage, { type: 'room:state' }> =>
          m.type === 'room:state' && m.room.participants.some((p) => p.id === w2.clientId && p.name === 'Tester')
      );
      const rename2P = c2.waitFor(
        (m): m is Extract<ServerMessage, { type: 'room:state' }> =>
          m.type === 'room:state' && m.room.participants.some((p) => p.id === w2.clientId && p.name === 'Tester')
      );
      c2.send({ type: 'room:rename', playerName: 'Tester' });
      const [renamed1, renamed2] = await Promise.all([rename1P, rename2P]);

      const rosterNames1 = renamed1.room.participants.map((p) => p.name).sort();
      const rosterNames2 = renamed2.room.participants.map((p) => p.name).sort();
      assert.deepEqual(rosterNames1, ['Mujahid', 'Tester']);
      assert.deepEqual(rosterNames2, ['Mujahid', 'Tester']);

      // 4. Non-host cannot launch match; host launches once
      c2.send({ type: 'room:start' });
      await new Promise((r) => setTimeout(r, 60));
      assert.equal(hub.getRoomSimulation(roomCode), null, 'Non-host must not be allowed to launch match');

      const started1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'match:started' }> => m.type === 'match:started');
      const started2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'match:started' }> => m.type === 'match:started');
      const tick0P1 = c1.waitFor(
        (m): m is Extract<ServerMessage, { type: 'world:state' }> => m.type === 'world:state' && m.state.tick === 0
      );
      const tick0P2 = c2.waitFor(
        (m): m is Extract<ServerMessage, { type: 'world:state' }> => m.type === 'world:state' && m.state.tick === 0
      );
      c1.send({ type: 'room:start' });
      const [started1, started2, t0Client1, t0Client2] = await Promise.all([
        started1P,
        started2P,
        tick0P1,
        tick0P2,
      ]);

      // 5. Identical matchId, same roomCode, shared entity IDs, exact custom names, and normalized RemoteSimulationView
      assert.ok(started1.matchId);
      assert.equal(started1.matchId, started2.matchId, 'Both clients must share the same server matchId');
      assert.equal(started1.roomCode, roomCode);
      assert.equal(started2.roomCode, roomCode);
      assert.equal(started1.playerId, w1.clientId);
      assert.equal(started2.playerId, w2.clientId);

      const matchId1 = started1.matchId;
      assert.equal(t0Client1.state.matchId, matchId1);
      assert.equal(t0Client2.state.matchId, matchId1);
      assert.equal(t0Client1.state.hud.player.name, 'Mujahid');
      assert.equal(t0Client2.state.hud.player.name, 'Tester');

      const ids1 = t0Client1.state.kelis.map((k) => k.id).sort();
      const ids2 = t0Client2.state.kelis.map((k) => k.id).sort();
      assert.deepEqual(ids1, [w1.clientId, w2.clientId].sort());
      assert.deepEqual(ids2, ids1);

      const remoteView1 = new RemoteSimulationView(started1.playerId, matchId1);
      const remoteView2 = new RemoteSimulationView(started2.playerId, matchId1);
      assert.equal(remoteView1.applyServerState(t0Client1.state), true);
      assert.equal(remoteView2.applyServerState(t0Client2.state), true);
      assert.equal(remoteView1.kelis.find((k) => k.id === w1.clientId)?.isPlayer, true);
      assert.equal(remoteView1.kelis.find((k) => k.id === w2.clientId)?.isPlayer, false);
      assert.equal(remoteView2.kelis.find((k) => k.id === w1.clientId)?.isPlayer, false);
      assert.equal(remoteView2.kelis.find((k) => k.id === w2.clientId)?.isPlayer, true);
      assert.equal(remoteView1.kelis.find((k) => k.id === w1.clientId)?.name, 'Mujahid');
      assert.equal(remoteView1.kelis.find((k) => k.id === w2.clientId)?.name, 'Tester');

      // 6 & 7. Independent input control & mutually visible movement
      // Place both in open water at Lubuk Hitam center (2900, 3400) so neither is blocked by shoreline
      const sim1 = hub.getRoomSimulation(roomCode);
      assert.ok(sim1, 'Authoritative simulation must exist for active room');
      const k1 = sim1.kelis.find((k) => k.id === w1.clientId)!;
      const k2 = sim1.kelis.find((k) => k.id === w2.clientId)!;
      k1.x = 2820;
      k1.z = 3400;
      k1.vx = 0;
      k1.vz = 0;
      k2.x = 2980;
      k2.z = 3400;
      k2.vx = 0;
      k2.vz = 0;

      // Move ONLY Mujahid (+X), keep Tester stationary
      c1.send({ type: 'player:input', moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
      c2.send({ type: 'player:input', moveX: 0, moveZ: 0, aimAngle: Math.PI, biteHeld: false });

      const movedMujahidTick = t0Client1.state.tick + 12;
      const [afterMove1A, afterMove1B] = await Promise.all([
        c1.waitFor(
          (m): m is Extract<ServerMessage, { type: 'world:state' }> =>
            m.type === 'world:state' && m.state.tick >= movedMujahidTick
        ),
        c2.waitFor(
          (m): m is Extract<ServerMessage, { type: 'world:state' }> =>
            m.type === 'world:state' && m.state.tick >= movedMujahidTick
        ),
      ]);

      const m1OnC1 = afterMove1A.state.kelis.find((k) => k.id === w1.clientId)!;
      const t1OnC1 = afterMove1A.state.kelis.find((k) => k.id === w2.clientId)!;
      const m1OnC2 = afterMove1B.state.kelis.find((k) => k.id === w1.clientId)!;
      const t1OnC2 = afterMove1B.state.kelis.find((k) => k.id === w2.clientId)!;

      assert.ok(m1OnC1.x > 2845, `Mujahid should move +X on C1 (got ${m1OnC1.x})`);
      assert.ok(m1OnC2.x > 2845, `Mujahid movement must be visible on C2 (got ${m1OnC2.x})`);
      assert.ok(Math.abs(t1OnC1.x - 2980) < 3, `Tester must stay stationary when only Mujahid moves (got ${t1OnC1.x})`);
      assert.ok(Math.abs(t1OnC2.x - 2980) < 3, `Tester must stay stationary on C2 (got ${t1OnC2.x})`);

      // Stop Mujahid, move ONLY Tester (-X toward Mujahid)
      const mujahidStopX = m1OnC1.x;
      c1.send({ type: 'player:input', moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
      c2.send({ type: 'player:input', moveX: -1, moveZ: 0, aimAngle: Math.PI, biteHeld: false });

      const movedTesterTick = afterMove1A.state.tick + 12;
      const [afterMove2A, afterMove2B] = await Promise.all([
        c1.waitFor(
          (m): m is Extract<ServerMessage, { type: 'world:state' }> =>
            m.type === 'world:state' && m.state.tick >= movedTesterTick
        ),
        c2.waitFor(
          (m): m is Extract<ServerMessage, { type: 'world:state' }> =>
            m.type === 'world:state' && m.state.tick >= movedTesterTick
        ),
      ]);

      const m2OnC1 = afterMove2A.state.kelis.find((k) => k.id === w1.clientId)!;
      const t2OnC1 = afterMove2A.state.kelis.find((k) => k.id === w2.clientId)!;
      const t2OnC2 = afterMove2B.state.kelis.find((k) => k.id === w2.clientId)!;

      assert.ok(t2OnC2.x < 2960, `Tester should move -X on C2 (got ${t2OnC2.x})`);
      assert.ok(t2OnC1.x < 2960, `Tester movement must be visible on C1 (got ${t2OnC1.x})`);
      assert.ok(Math.abs(m2OnC1.x - mujahidStopX) < 30, 'Mujahid should decelerate to stop when zero input sent');

      // 8. Shared combat damage, elimination, carcass creation, feeding, and Keli King match end
      c2.send({ type: 'player:input', moveX: 0, moveZ: 0, aimAngle: Math.PI, biteHeld: false });
      k1.x = 2900;
      k1.z = 3400;
      k1.facingAngle = 0;
      k2.x = 2948;
      k2.z = 3400;
      k2.hp = 60; // 2 bites to eliminate cleanly

      // Bite via real WebSocket input from Mujahid
      c1.send({ type: 'player:input', moveX: 0.2, moveZ: 0, aimAngle: 0, biteHeld: true });

      const damagedOnC2 = await c2.waitFor(
        (m): m is Extract<ServerMessage, { type: 'world:state' }> =>
          m.type === 'world:state' &&
          m.state.matchId === matchId1 &&
          (m.state.hud.player.hp < 60 || !m.state.hud.player.alive),
        4000
      );
      assert.ok(
        damagedOnC2.state.hud.player.hp < 60 || !damagedOnC2.state.hud.player.alive,
        'Tester must observe combat damage inflicted by Mujahid'
      );

      // Keep holding bite/move toward Tester's carcass until elimination + feeding finishes the match
      const end1P = c1.waitFor(
        (m): m is Extract<ServerMessage, { type: 'match:ended' }> =>
          m.type === 'match:ended' && m.matchId === matchId1,
        10000,
        true
      );
      const end2P = c2.waitFor(
        (m): m is Extract<ServerMessage, { type: 'match:ended' }> =>
          m.type === 'match:ended' && m.matchId === matchId1,
        10000,
        true
      );

      // Wait for carcass creation on both clients after Tester is eliminated
      const carcassSeenOnC2 = await c2.waitFor(
        (m): m is Extract<ServerMessage, { type: 'world:state' }> =>
          m.type === 'world:state' &&
          m.state.matchId === matchId1 &&
          m.state.carcasses.some((c) => c.sourceName === 'Tester'),
        5000,
        true
      );
      assert.ok(
        carcassSeenOnC2.state.carcasses.some((c) => c.sourceName === 'Tester'),
        'Carcass must preserve custom eliminated name Tester'
      );

      // Move Mujahid onto Tester's carcass to feed to Lv.100
      const targetCarcass = carcassSeenOnC2.state.carcasses.find((c) => c.sourceName === 'Tester')!;
      k1.x = targetCarcass.x;
      k1.z = targetCarcass.z;
      c1.send({ type: 'player:input', moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });

      const [ended1, ended2] = await Promise.all([end1P, end2P]);
      assert.equal(ended1.matchId, matchId1);
      assert.equal(ended2.matchId, matchId1);
      assert.equal(ended1.hud.matchResult.status, 'victory');
      assert.equal(ended1.hud.matchResult.winnerName, 'Mujahid');
      assert.equal(ended2.hud.matchResult.status, 'defeat');
      assert.equal(ended2.hud.matchResult.winnerName, 'Mujahid');
      assert.equal(ended2.hud.matchResult.killedBy, 'Mujahid');
      assert.equal(ended2.hud.matchResult.massTransferredTo, 'Mujahid');

      // 9a. Rematch: host restarts room -> new matchId, custom names survive rematch!
      const rematchStart1P = c1.waitFor(
        (m): m is Extract<ServerMessage, { type: 'match:started' }> =>
          m.type === 'match:started' && m.matchId !== matchId1
      );
      const rematchStart2P = c2.waitFor(
        (m): m is Extract<ServerMessage, { type: 'match:started' }> =>
          m.type === 'match:started' && m.matchId !== matchId1
      );
      const rematchTick0P1 = c1.waitFor(
        (m): m is Extract<ServerMessage, { type: 'world:state' }> =>
          m.type === 'world:state' && m.state.matchId !== matchId1 && m.state.tick === 0
      );
      c1.send({ type: 'room:restart' });
      const [rematch1, rematch2, rematchTick0] = await Promise.all([
        rematchStart1P,
        rematchStart2P,
        rematchTick0P1,
      ]);
      assert.notEqual(rematch1.matchId, matchId1, 'Rematch must produce a new matchId');
      assert.equal(rematch1.matchId, rematch2.matchId, 'Both clients must share the rematch matchId');
      const rematchNames = rematchTick0.state.kelis.map((k) => k.name).sort();
      assert.deepEqual(rematchNames, ['Mujahid', 'Tester']);

      // 9b. Mid-match disconnect & reconnect preserves custom name (even if client sends default fallback) & same matchId
      await c2.close();
      const c2Reconnect = new TestWsClient(wsUrl);
      try {
        const w2ReP = c2Reconnect.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
        await c2Reconnect.waitForOpen();
        await w2ReP;

        const reStartedP = c2Reconnect.waitFor(
          (m): m is Extract<ServerMessage, { type: 'match:started' }> => m.type === 'match:started'
        );
        const reWorldP = c2Reconnect.waitFor(
          (m): m is Extract<ServerMessage, { type: 'world:state' }> => m.type === 'world:state'
        );
        c2Reconnect.send({
          type: 'room:join',
          code: roomCode,
          playerName: 'Awang', // Simulate client fallback on reconnect — server must preserve 'Tester'!
          clientId: w2.clientId,
        });
        const [reStarted, reWorld] = await Promise.all([reStartedP, reWorldP]);
        assert.equal(reStarted.matchId, rematch1.matchId);
        assert.equal(reStarted.playerId, w2.clientId);
        assert.equal(reWorld.state.matchId, rematch1.matchId);
        assert.equal(
          reWorld.state.hud.player.name,
          'Tester',
          'Custom name must survive reconnect without reverting to Awang'
        );
      } finally {
        await c2Reconnect.close();
      }

      // 10b. Verify structured server logs include lifecycle events & exclude noisy player:input / secrets
      assert.ok(serverLogs.some((l) => l.includes('event=connect')));
      assert.ok(serverLogs.some((l) => l.includes(`event=room_create room=${roomCode}`)));
      assert.ok(serverLogs.some((l) => l.includes(`event=room_join room=${roomCode}`)));
      assert.ok(serverLogs.some((l) => l.includes(`event=match_start room=${roomCode} match=${matchId1}`)));
      assert.ok(serverLogs.some((l) => l.includes(`event=match_end room=${roomCode} match=${matchId1}`)));
      assert.ok(serverLogs.some((l) => l.includes(`event=room_reconnect room=${roomCode}`)));
      assert.equal(
        serverLogs.some((l) => l.includes('player:input') || l.includes('sdp')),
        false,
        'Server logs must never log per-tick input packets or voice SDP payloads'
      );
    } finally {
      await c1.close();
      await c2.close();
      await shutdown();
    }
  });

  it('unit: MultiplayerClient buffers latest world:state for delayed subscribers and marks unavailable without solo fallback when unconfigured', () => {
    const client = new MultiplayerClient();
    client.connect(); // In Node (no window/WS config), must cleanly enter 'unavailable'
    assert.equal(client.getSnapshot().status, 'unavailable');

    // Simulate match:started + tick 0 arriving BEFORE GameViewport mounts its onWorldState listener
    const internal = client as unknown as {
      state: { activeMatchId: string | null; activeRoomCode: string | null; latestSnapshotTick: number | null };
      latestWorldState: WorldStatePacket | null;
    };
    const bufferedTick0 = {
      matchId: 'match-buffered-1',
      roomCode: 'WK999',
      tick: 0,
      serverTime: Date.now(),
      matchTime: 0,
      status: 'playing',
      cameraShake: 0,
      zone: { centerX: 2900, centerZ: 3400, currentRadius: 2700, targetRadius: 2700, phase: 1, warningTimer: 20, isShrinking: false },
      weather: { kind: 'clear', label: 'Clear', intensity: 0, remainingSec: 20, visibilityRange: 1 },
      kelis: [],
      carcasses: [],
      pickups: [],
      effects: [],
      hud: { player: { id: 'p1', name: 'Mujahid', alive: true, level: 50 } } as unknown as WorldStatePacket['hud'],
      sfx: [],
    } as WorldStatePacket;

    internal.state.activeMatchId = 'match-buffered-1';
    internal.state.activeRoomCode = 'WK999';
    internal.state.latestSnapshotTick = 0;
    internal.latestWorldState = bufferedTick0;

    // Late subscriber for matching matchId immediately receives buffered tick 0
    const received: WorldStatePacket[] = [];
    const unsub1 = client.onWorldState((pkt) => received.push(pkt), 'match-buffered-1');
    unsub1();
    assert.equal(received.length, 1);
    assert.equal(received[0].tick, 0);
    assert.equal(received[0].hud.player.name, 'Mujahid');

    // Late subscriber expecting a DIFFERENT matchId does NOT receive stale buffered snapshot
    const wrongMatchReceived: WorldStatePacket[] = [];
    const unsub2 = client.onWorldState((pkt) => wrongMatchReceived.push(pkt), 'match-other-2');
    unsub2();
    assert.equal(wrongMatchReceived.length, 0);
  });
});

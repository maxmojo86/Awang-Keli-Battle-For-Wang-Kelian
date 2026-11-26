import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import WebSocket from 'ws';
import {
  createLeaderboardStoreFromEnv,
  type GlobalLeaderboardSort,
  LeaderboardStorageUnavailableError,
  type LeaderboardStore,
  parseLegacyLeaderboardJson,
  PostgresLeaderboardStore,
  type SqlQueryExecutor,
} from '../server/leaderboardStore.ts';
import { attachMultiplayerServer, type MultiplayerHub } from '../server/multiplayerServer.ts';
import { type RegionCode, type RegionFilter, VALID_REGION_CODES } from '../src/data/regions.ts';
import type { ClientMessage, ServerMessage } from '../src/game/multiplayerTypes.ts';

function createPGliteExecutor(pg: PGlite): SqlQueryExecutor {
  return {
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const res = await pg.query<T>(sql, params);
      return { rows: res.rows };
    },
    close: async () => {
      await pg.close();
    },
  };
}

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
    timeoutMs = 8000,
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
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for WS message`));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  public async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

async function startFullTestServer(
  leaderboardStore: LeaderboardStore,
  logs: string[] = []
): Promise<{
  httpServer: HttpServer;
  hub: MultiplayerHub;
  baseUrl: string;
  wsUrl: string;
  shutdown: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  const hub = attachMultiplayerServer(httpServer, {
    path: '/ws',
    tickIntervalMs: 16,
    leaderboardStore,
    logger: (line) => logs.push(line),
  });

  app.get('/api/leaderboard', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const rawRegion = String(req.query.region || 'ALL').toUpperCase();
    const region: RegionFilter =
      rawRegion === 'ALL' || VALID_REGION_CODES.has(rawRegion as RegionCode)
        ? (rawRegion as RegionFilter)
        : 'ALL';
    const rawSort = String(req.query.sort || 'longest');
    const sort: GlobalLeaderboardSort =
      rawSort === 'fastest_king' || rawSort === 'kills' ? rawSort : 'longest';
    const limit = Number(req.query.limit || 100);
    try {
      const result = await leaderboardStore.query(region, sort, limit);
      res.json(result);
    } catch (err) {
      if (err instanceof LeaderboardStorageUnavailableError) {
        res.status(503).json({ error: err.message, code: err.code });
        return;
      }
      res.status(503).json({
        error: 'Global rankings database is currently unavailable.',
        code: 'LEADERBOARD_DB_UNAVAILABLE',
      });
    }
  });

  app.post('/api/leaderboard', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const outcome = await leaderboardStore.submitSolo(req.body ?? {});
    if (outcome.ok === false) {
      const statusCode =
        outcome.code === 'MULTIPLAYER_CLIENT_REJECTED'
          ? 403
          : outcome.code === 'VALIDATION_ERROR' || outcome.code === 'INELIGIBLE_RUN'
            ? 400
            : 503;
      res.status(statusCode).json({
        error: outcome.error,
        code: outcome.code,
        retryable: outcome.retryable,
      });
      return;
    }
    res.status(201).json(outcome.result);
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

  return {
    httpServer,
    hub,
    baseUrl,
    wsUrl,
    shutdown: async () => {
      await hub.waitForPendingPersistence();
      await hub.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/**
 * Helper to drive a 2-human match to clean authoritative completion:
 * advances simulation time past 1s eligibility threshold, eliminates player 2 via real bite input,
 * and feeds on their carcass until player 1 crowns as Lv.100 Keli King.
 */
async function finishTwoHumanMatch(
  hub: MultiplayerHub,
  roomCode: string,
  matchId: string,
  c1: TestWsClient,
  c2: TestWsClient,
  winnerId: string,
  loserId: string,
  loserName: string,
  disconnectLoserAfterElimination = false
): Promise<void> {
  const sim = hub.getRoomSimulation(roomCode);
  assert.ok(sim, 'Simulation must exist for active room');

  // Ensure both players have well over 1s survival time for eligibility
  sim.matchTime = 18.5;

  const kWinner = sim.kelis.find((k) => k.id === winnerId)!;
  const kLoser = sim.kelis.find((k) => k.id === loserId)!;
  assert.ok(kWinner && kLoser);

  // Position side by side in open water at Lubuk Hitam
  kWinner.x = 2900;
  kWinner.z = 3400;
  kWinner.vx = 0;
  kWinner.vz = 0;
  kWinner.facingAngle = 0;

  kLoser.x = 2946;
  kLoser.z = 3400;
  kLoser.vx = 0;
  kLoser.vz = 0;
  kLoser.hp = 18; // Single bite eliminates cleanly

  const end1P = c1.waitFor(
    (m): m is Extract<ServerMessage, { type: 'match:ended' }> =>
      m.type === 'match:ended' && m.matchId === matchId,
    10000,
    true
  );

  // Winner bites loser via real WS input
  c1.send({ type: 'player:input', moveX: 0.2, moveZ: 0, aimAngle: 0, biteHeld: true });

  // Wait for loser carcass to appear
  const carcassSnap = await c1.waitFor(
    (m): m is Extract<ServerMessage, { type: 'world:state' }> =>
      m.type === 'world:state' &&
      m.state.matchId === matchId &&
      m.state.carcasses.some((c) => c.sourceName === loserName),
    6000,
    true
  );

  if (disconnectLoserAfterElimination) {
    // Immediately sever loser's connection BEFORE the match concludes or any summary screen opens
    await c2.close();
  }

  // Advance clock slightly so winner's survivalTime is distinctly higher than loser's
  sim.matchTime = 24.25;

  const carcass = carcassSnap.state.carcasses.find((c) => c.sourceName === loserName)!;
  kWinner.x = carcass.x;
  kWinner.z = carcass.z;
  c1.send({ type: 'player:input', moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });

  await end1P;
  await hub.waitForPendingPersistence();
}

describe('Durable PostgreSQL global & regional leaderboard persistence', () => {
  it('1 & 2. persists authoritative multiplayer names & regions across full server + database restart and rejects client multiplayer POSTs', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awang-keli-pg-restart-'));
    try {
      // --- SERVER INSTANCE #1 ---
      const pg1 = new PGlite(tmpDir);
      const store1 = new PostgresLeaderboardStore({
        executor: createPGliteExecutor(pg1),
        retryBaseDelayMs: 10,
      });
      await store1.init();

      const srv1 = await startFullTestServer(store1);
      const c1 = new TestWsClient(srv1.wsUrl);
      const c2 = new TestWsClient(srv1.wsUrl);

      let matchId = '';
      try {
        // Verify client cannot forge multiplayer leaderboard submissions via POST /api/leaderboard
        const spoofRes = await fetch(`${srv1.baseUrl}/api/leaderboard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submissionId: 'spoof-mp-1',
            playerName: 'Spoofer',
            region: 'SEA',
            survivalTime: 999,
            finalLevel: 100,
            kills: 99,
            victory: true,
            lobbySize: 20,
            mode: 'multiplayer',
          }),
        });
        assert.equal(spoofRes.status, 403, 'Client multiplayer POST must be rejected with HTTP 403');
        const spoofBody = (await spoofRes.json()) as { code: string };
        assert.equal(spoofBody.code, 'MULTIPLAYER_CLIENT_REJECTED');

        const w1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
        const w2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
        await Promise.all([c1.waitForOpen(), c2.waitForOpen()]);
        const [w1, w2] = await Promise.all([w1P, w2P]);

        // Host "Mujahid" in SEA creates room; Guest "Tester" in EUR joins
        const joined1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'room:joined' }> => m.type === 'room:joined');
        c1.send({
          type: 'room:create',
          playerName: 'Mujahid',
          region: 'SEA',
          lobbySize: 5,
          fillWithBots: false,
        });
        const joined1 = await joined1P;
        const roomCode = joined1.room.code;

        const joined2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'room:joined' }> => m.type === 'room:joined');
        c2.send({
          type: 'room:join',
          code: roomCode,
          playerName: 'Tester',
          region: 'EUR',
        });
        await joined2P;

        const started1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'match:started' }> => m.type === 'match:started');
        const started2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'match:started' }> => m.type === 'match:started');
        c1.send({ type: 'room:start' });
        const [started1] = await Promise.all([started1P, started2P]);
        matchId = started1.matchId;

        const lbRes1P = c1.waitFor(
          (m): m is Extract<ServerMessage, { type: 'leaderboard:result' }> =>
            m.type === 'leaderboard:result' && m.matchId === matchId,
          10000,
          true
        );
        const lbRes2P = c2.waitFor(
          (m): m is Extract<ServerMessage, { type: 'leaderboard:result' }> =>
            m.type === 'leaderboard:result' && m.matchId === matchId,
          10000,
          true
        );

        await finishTwoHumanMatch(srv1.hub, roomCode, matchId, c1, c2, w1.clientId, w2.clientId, 'Tester', false);

        const [lb1, lb2] = await Promise.all([lbRes1P, lbRes2P]);
        assert.equal(lb1.status, 'saved');
        assert.equal(lb1.region, 'SEA');
        assert.equal(lb1.globalRank, 1);
        assert.equal(lb1.regionalRank, 1);

        assert.equal(lb2.status, 'saved');
        assert.equal(lb2.region, 'EUR');
        assert.equal(lb2.regionalRank, 1);
      } finally {
        await c1.close();
        await c2.close();
        await srv1.shutdown();
        await store1.close();
      }

      // --- SERVER INSTANCE #2 (FRESH RESTART AGAINST SAME PERSISTENT POSTGRES DATA DIR) ---
      const pg2 = new PGlite(tmpDir);
      const store2 = new PostgresLeaderboardStore({
        executor: createPGliteExecutor(pg2),
        retryBaseDelayMs: 10,
      });
      await store2.init();
      const srv2 = await startFullTestServer(store2);

      try {
        const res = await fetch(`${srv2.baseUrl}/api/leaderboard?region=ALL&sort=longest&limit=100`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('cache-control') || '', /no-store/i);
        const data = (await res.json()) as {
          totalGlobal: number;
          entries: Array<{
            playerName: string;
            region: RegionCode;
            matchId: string | null;
            mode: string;
            victory: boolean;
            finalLevel: number;
            globalRank: number;
            regionalRank: number;
          }>;
        };

        assert.equal(data.totalGlobal, 2, 'Both multiplayer results must survive server restart');
        assert.equal(data.entries.length, 2);

        const mujahid = data.entries.find((e) => e.playerName === 'Mujahid');
        const tester = data.entries.find((e) => e.playerName === 'Tester');
        assert.ok(mujahid, 'Mujahid entry must persist across restart');
        assert.ok(tester, 'Tester entry must persist across restart');
        assert.equal(mujahid.region, 'SEA');
        assert.equal(mujahid.victory, true);
        assert.equal(mujahid.finalLevel, 100);
        assert.equal(mujahid.mode, 'multiplayer');
        assert.equal(mujahid.matchId, matchId);

        assert.equal(tester.region, 'EUR');
        assert.equal(tester.victory, false);
        assert.equal(tester.mode, 'multiplayer');
        assert.equal(tester.matchId, matchId);
      } finally {
        await srv2.shutdown();
        await store2.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('3 & 4. consecutive matches retain all sets of results, while repeated writes/reconnects never duplicate a player-match row', async () => {
    const pg = new PGlite();
    const store = new PostgresLeaderboardStore({
      executor: createPGliteExecutor(pg),
      retryBaseDelayMs: 10,
    });
    await store.init();
    const srv = await startFullTestServer(store);
    const c1 = new TestWsClient(srv.wsUrl);
    const c2 = new TestWsClient(srv.wsUrl);

    try {
      const w1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
      const w2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
      await Promise.all([c1.waitForOpen(), c2.waitForOpen()]);
      const [w1, w2] = await Promise.all([w1P, w2P]);

      const joined1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'room:joined' }> => m.type === 'room:joined');
      c1.send({ type: 'room:create', playerName: 'Mujahid', region: 'SEA', lobbySize: 5, fillWithBots: false });
      const roomCode = (await joined1P).room.code;

      const joined2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'room:joined' }> => m.type === 'room:joined');
      c2.send({ type: 'room:join', code: roomCode, playerName: 'Tester', region: 'NAM' });
      await joined2P;

      // Update Tester's region in lobby before match 1 to EUR via room:region
      const regionUpdatedP = c1.waitFor(
        (m): m is Extract<ServerMessage, { type: 'room:state' }> =>
          m.type === 'room:state' &&
          m.room.participants.some((p) => p.id === w2.clientId && p.region === 'EUR')
      );
      c2.send({ type: 'room:region', region: 'EUR' });
      await regionUpdatedP;

      // --- MATCH 1 ---
      const start1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'match:started' }> => m.type === 'match:started');
      c1.send({ type: 'room:start' });
      const matchId1 = (await start1P).matchId;

      await finishTwoHumanMatch(srv.hub, roomCode, matchId1, c1, c2, w1.clientId, w2.clientId, 'Tester', false);

      // Simulate duplicate authoritative persistence callback for the exact same (matchId1, playerId)
      const dup1 = await store.recordMultiplayerResult({
        matchId: matchId1,
        playerId: w1.clientId,
        playerName: 'Mujahid',
        region: 'SEA',
        survivalTime: 24.25,
        finalLevel: 100,
        kills: 1,
        victory: true,
        lobbySize: 2,
      });
      assert.equal(dup1.ok, true);
      if (dup1.ok) {
        assert.equal(dup1.deduplicated, true, 'Repeated write for same match+player must deduplicate');
      }

      // --- MATCH 2 (REMATCH IN SAME ROOM) ---
      const start2P = c1.waitFor(
        (m): m is Extract<ServerMessage, { type: 'match:started' }> =>
          m.type === 'match:started' && m.matchId !== matchId1
      );
      c1.send({ type: 'room:restart' });
      const matchId2 = (await start2P).matchId;
      assert.notEqual(matchId2, matchId1);

      // Mid-match reconnect by Tester before finishing Match 2 — must preserve custom name & EUR region and NOT duplicate row
      await c2.close();
      const c2Re = new TestWsClient(srv.wsUrl);
      try {
        const wReP = c2Re.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
        await c2Re.waitForOpen();
        await wReP;
        const reStartP = c2Re.waitFor(
          (m): m is Extract<ServerMessage, { type: 'match:started' }> => m.type === 'match:started'
        );
        c2Re.send({
          type: 'room:join',
          code: roomCode,
          playerName: 'Awang', // Client fallback — server must preserve 'Tester' & 'EUR'
          clientId: w2.clientId,
        });
        await reStartP;

        await finishTwoHumanMatch(srv.hub, roomCode, matchId2, c1, c2Re, w1.clientId, w2.clientId, 'Tester', false);
      } finally {
        await c2Re.close();
      }

      const board = await store.query('ALL', 'longest', 100);
      assert.equal(board.totalGlobal, 4, 'Two 2-player matches must retain exactly 4 distinct rows (2 per match)');
      const match1Rows = board.entries.filter((e) => e.matchId === matchId1);
      const match2Rows = board.entries.filter((e) => e.matchId === matchId2);
      assert.equal(match1Rows.length, 2);
      assert.equal(match2Rows.length, 2);
      assert.equal(match2Rows.find((e) => e.playerId === w2.clientId)?.playerName, 'Tester');
      assert.equal(match2Rows.find((e) => e.playerId === w2.clientId)?.region, 'EUR');

      // Also verify solo POST idempotency on repeated submissionId
      const soloPayload = {
        submissionId: 'solo-retry-idempotent-1',
        playerName: 'SoloFisher',
        region: 'EAS',
        survivalTime: 45.5,
        finalLevel: 72,
        kills: 6,
        victory: false,
        lobbySize: 20,
        mode: 'royale',
      };
      const r1 = await fetch(`${srv.baseUrl}/api/leaderboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(soloPayload),
      });
      const r2 = await fetch(`${srv.baseUrl}/api/leaderboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(soloPayload),
      });
      assert.equal(r1.status, 201);
      assert.equal(r2.status, 201);
      const afterSolo = await store.query('ALL', 'longest', 100);
      assert.equal(afterSolo.totalGlobal, 5, 'Duplicate solo submissionId must produce strictly 1 row');
    } finally {
      await c1.close();
      await c2.close();
      await srv.shutdown();
      await store.close();
    }
  });

  it('5. persists an eliminated player result even if they disconnect immediately before match end or summary screen', async () => {
    const pg = new PGlite();
    const store = new PostgresLeaderboardStore({
      executor: createPGliteExecutor(pg),
      retryBaseDelayMs: 10,
    });
    await store.init();
    const srv = await startFullTestServer(store);
    const c1 = new TestWsClient(srv.wsUrl);
    const c2 = new TestWsClient(srv.wsUrl);

    try {
      const w1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
      const w2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
      await Promise.all([c1.waitForOpen(), c2.waitForOpen()]);
      const [w1, w2] = await Promise.all([w1P, w2P]);

      const joined1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'room:joined' }> => m.type === 'room:joined');
      c1.send({ type: 'room:create', playerName: 'Mujahid', region: 'SEA', lobbySize: 5, fillWithBots: false });
      const roomCode = (await joined1P).room.code;

      const joined2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'room:joined' }> => m.type === 'room:joined');
      c2.send({ type: 'room:join', code: roomCode, playerName: 'EarlyLeaver', region: 'OCE' });
      await joined2P;

      const startP = c1.waitFor((m): m is Extract<ServerMessage, { type: 'match:started' }> => m.type === 'match:started');
      c1.send({ type: 'room:start' });
      const matchId = (await startP).matchId;

      // Disconnect EarlyLeaver immediately after elimination, BEFORE Mujahid finishes feeding
      await finishTwoHumanMatch(srv.hub, roomCode, matchId, c1, c2, w1.clientId, w2.clientId, 'EarlyLeaver', true);

      const board = await store.query('ALL', 'longest', 100);
      assert.equal(board.totalGlobal, 2);
      const leaver = board.entries.find((e) => e.playerName === 'EarlyLeaver');
      const winner = board.entries.find((e) => e.playerName === 'Mujahid');
      assert.ok(leaver, 'Eliminated player who disconnected early must still be persisted');
      assert.equal(leaver.region, 'OCE');
      assert.equal(leaver.victory, false);
      assert.ok(leaver.survivalTime >= 18);
      assert.ok(winner);
      assert.equal(winner.region, 'SEA');
      assert.equal(winner.victory, true);
    } finally {
      await c1.close();
      await c2.close();
      await srv.shutdown();
      await store.close();
    }
  });

  it('6. computes independent global and regional ranks across longest, fastest_king, and kills without pruning history', async () => {
    const pg = new PGlite();
    const store = new PostgresLeaderboardStore({
      executor: createPGliteExecutor(pg),
      retryBaseDelayMs: 10,
    });
    await store.init();

    try {
      const seed: Array<{
        matchId: string;
        playerId: string;
        playerName: string;
        region: RegionCode;
        survivalTime: number;
        finalLevel: number;
        kills: number;
        victory: boolean;
      }> = [
        // Longest survival (300s), slower king
        { matchId: 'm-1', playerId: 'p-1', playerName: 'AlphaSEA', region: 'SEA', survivalTime: 300, finalLevel: 100, kills: 7, victory: true },
        // Second longest (250s), EUR #1 longest, not a king
        { matchId: 'm-2', playerId: 'p-2', playerName: 'BetaEUR', region: 'EUR', survivalTime: 250, finalLevel: 85, kills: 15, victory: false },
        // Fastest Keli King (95s), EUR #2 longest, EUR #1 fastest_king
        { matchId: 'm-3', playerId: 'p-3', playerName: 'FastKingEUR', region: 'EUR', survivalTime: 95, finalLevel: 100, kills: 10, victory: true },
        // Second fastest Keli King (140s), NAM #1
        { matchId: 'm-4', playerId: 'p-4', playerName: 'SpeedNAM', region: 'NAM', survivalTime: 140, finalLevel: 100, kills: 12, victory: true },
        // Most kills (22), SEA #2 longest
        { matchId: 'm-5', playerId: 'p-5', playerName: 'HunterSEA', region: 'SEA', survivalTime: 180, finalLevel: 90, kills: 22, victory: false },
      ];

      for (const item of seed) {
        const out = await store.recordMultiplayerResult({ ...item, lobbySize: 20 });
        assert.equal(out.ok, true);
      }

      // --- Sort: longest (ALL) ---
      const longestAll = await store.query('ALL', 'longest', 100);
      assert.deepEqual(
        longestAll.entries.map((e) => e.playerName),
        ['AlphaSEA', 'BetaEUR', 'HunterSEA', 'SpeedNAM', 'FastKingEUR']
      );
      assert.deepEqual(
        longestAll.entries.map((e) => e.globalRank),
        [1, 2, 3, 4, 5]
      );

      // --- Sort: longest filtered by EUR -> globalRank stays 2 & 5 while regionalRank is 1 & 2 ---
      const longestEur = await store.query('EUR', 'longest', 100);
      assert.equal(longestEur.totalGlobal, 5);
      assert.equal(longestEur.totalMatching, 2);
      assert.deepEqual(
        longestEur.entries.map((e) => ({
          name: e.playerName,
          globalRank: e.globalRank,
          regionalRank: e.regionalRank,
        })),
        [
          { name: 'BetaEUR', globalRank: 2, regionalRank: 1 },
          { name: 'FastKingEUR', globalRank: 5, regionalRank: 2 },
        ]
      );

      // --- Sort: fastest_king (only victory=true && finalLevel>=100, ascending time) ---
      const fastestAll = await store.query('ALL', 'fastest_king', 100);
      assert.deepEqual(
        fastestAll.entries.map((e) => ({
          name: e.playerName,
          globalRank: e.globalRank,
          regionalRank: e.regionalRank,
        })),
        [
          { name: 'FastKingEUR', globalRank: 1, regionalRank: 1 },
          { name: 'SpeedNAM', globalRank: 2, regionalRank: 1 },
          { name: 'AlphaSEA', globalRank: 3, regionalRank: 1 },
        ]
      );
      const fastestSea = await store.query('SEA', 'fastest_king', 100);
      assert.equal(fastestSea.entries.length, 1);
      assert.equal(fastestSea.entries[0].playerName, 'AlphaSEA');
      assert.equal(fastestSea.entries[0].globalRank, 3);
      assert.equal(fastestSea.entries[0].regionalRank, 1);

      // --- Sort: kills (descending) ---
      const killsAll = await store.query('ALL', 'kills', 100);
      assert.deepEqual(
        killsAll.entries.map((e) => e.playerName),
        ['HunterSEA', 'BetaEUR', 'SpeedNAM', 'FastKingEUR', 'AlphaSEA']
      );
      const killsEur = await store.query('EUR', 'kills', 100);
      assert.deepEqual(
        killsEur.entries.map((e) => ({
          name: e.playerName,
          globalRank: e.globalRank,
          regionalRank: e.regionalRank,
        })),
        [
          { name: 'BetaEUR', globalRank: 2, regionalRank: 1 },
          { name: 'FastKingEUR', globalRank: 4, regionalRank: 2 },
        ]
      );

      // --- Verify zero destructive pruning: insert 105 additional rows -> totalGlobal = 110, LIMIT applies only at query time ---
      for (let i = 0; i < 105; i++) {
        const res = await store.recordMultiplayerResult({
          matchId: `bulk-${i}`,
          playerId: `p-bulk-${i}`,
          playerName: `Swimmer${i}`,
          region: i % 2 === 0 ? 'SEA' : 'EUR',
          survivalTime: 10 + (i % 50),
          finalLevel: 20,
          kills: 1,
          victory: false,
          lobbySize: 20,
        });
        assert.equal(res.ok, true);
      }

      const paged = await store.query('ALL', 'longest', 10);
      assert.equal(paged.totalGlobal, 110, 'Stored history must never be pruned');
      assert.equal(paged.entries.length, 10, 'LIMIT must be applied at query time only');
    } finally {
      await store.close();
    }
  });

  it('7. surfaces explicit errors on DB failure & missing production DATABASE_URL without false success or credential leaks', async () => {
    // 7a. Production without DATABASE_URL must NEVER fall back to local JSON, even if dev flag is set
    const prodStore = createLeaderboardStoreFromEnv({
      NODE_ENV: 'production',
      LEADERBOARD_DEV_JSON_FALLBACK: 'true',
    });
    assert.equal(prodStore.storageKind, 'unavailable');
    assert.equal(await prodStore.isAvailable(), false);

    const srvUnavail = await startFullTestServer(prodStore);
    try {
      const getRes = await fetch(`${srvUnavail.baseUrl}/api/leaderboard`);
      assert.equal(getRes.status, 503, 'GET /api/leaderboard must return HTTP 503 when DB is unavailable');
      const getBody = (await getRes.json()) as { code: string; error: string };
      assert.equal(getBody.code, 'LEADERBOARD_DB_UNAVAILABLE');

      const postRes = await fetch(`${srvUnavail.baseUrl}/api/leaderboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: 'solo-unavail-1',
          playerName: 'Awang',
          region: 'SEA',
          survivalTime: 40,
          finalLevel: 50,
          kills: 2,
          victory: false,
          lobbySize: 20,
          mode: 'royale',
        }),
      });
      assert.equal(postRes.status, 503, 'POST /api/leaderboard must return HTTP 503, never false 201');
    } finally {
      await srvUnavail.shutdown();
      await prodStore.close();
    }

    // 7b. Live PostgreSQL write failure during multiplayer match: bounded retries, explicit 'failed' WS status, sanitized logs
    const storeLogs: string[] = [];
    let writeAttempts = 0;
    const failingExecutor: SqlQueryExecutor = {
      query: async <T = Record<string, unknown>>(sql: string) => {
        if (/INSERT INTO leaderboard_results/i.test(sql)) {
          writeAttempts += 1;
          throw new Error(
            'connection refused for postgres://admin:super_secret_pw@db.internal.render.com:5432/awangkeli'
          );
        }
        return { rows: [] as T[] };
      },
    };
    const failingStore = new PostgresLeaderboardStore({
      executor: failingExecutor,
      retryBaseDelayMs: 5,
      logger: (line) => storeLogs.push(line),
    });
    // Mark initialized without running DDL on the mock failing executor
    (failingStore as unknown as { initialized: boolean }).initialized = true;

    const mpLogs: string[] = [];
    const srvFail = await startFullTestServer(failingStore, mpLogs);
    const c1 = new TestWsClient(srvFail.wsUrl);
    const c2 = new TestWsClient(srvFail.wsUrl);
    try {
      const w1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
      const w2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
      await Promise.all([c1.waitForOpen(), c2.waitForOpen()]);
      const [w1, w2] = await Promise.all([w1P, w2P]);

      const joined1P = c1.waitFor((m): m is Extract<ServerMessage, { type: 'room:joined' }> => m.type === 'room:joined');
      c1.send({ type: 'room:create', playerName: 'Mujahid', region: 'SEA', lobbySize: 5, fillWithBots: false });
      const roomCode = (await joined1P).room.code;

      const joined2P = c2.waitFor((m): m is Extract<ServerMessage, { type: 'room:joined' }> => m.type === 'room:joined');
      c2.send({ type: 'room:join', code: roomCode, playerName: 'Tester', region: 'EUR' });
      await joined2P;

      const startP = c1.waitFor((m): m is Extract<ServerMessage, { type: 'match:started' }> => m.type === 'match:started');
      c1.send({ type: 'room:start' });
      const matchId = (await startP).matchId;

      const lbFail1P = c1.waitFor(
        (m): m is Extract<ServerMessage, { type: 'leaderboard:result' }> =>
          m.type === 'leaderboard:result' && m.matchId === matchId,
        10000,
        true
      );
      const lbFail2P = c2.waitFor(
        (m): m is Extract<ServerMessage, { type: 'leaderboard:result' }> =>
          m.type === 'leaderboard:result' && m.matchId === matchId,
        10000,
        true
      );

      await finishTwoHumanMatch(srvFail.hub, roomCode, matchId, c1, c2, w1.clientId, w2.clientId, 'Tester', false);
      const [fail1, fail2] = await Promise.all([lbFail1P, lbFail2P]);

      assert.equal(fail1.status, 'failed', 'Failed DB write must report failed, never saved');
      assert.equal(fail2.status, 'failed', 'Failed DB write must report failed, never saved');
      assert.equal(writeAttempts, 6, 'Each of 2 participants should execute 3 bounded attempts (1 initial + 2 retries)');

      const combinedLogs = [...storeLogs, ...mpLogs].join('\n');
      assert.ok(combinedLogs.includes('[REDACTED_DB_URL]'), 'Logs must redact database URLs');
      assert.equal(combinedLogs.includes('super_secret_pw'), false, 'Logs must NEVER leak database passwords');
      assert.equal(combinedLogs.includes('db.internal.render.com'), false, 'Logs must NEVER leak database connection URLs');
    } finally {
      await c1.close();
      await c2.close();
      await srvFail.shutdown();
    }
  });

  it('8. imports existing legacy global-leaderboard.json idempotently without duplicating rows and skips invalid records', async () => {
    const pg = new PGlite();
    const store = new PostgresLeaderboardStore({
      executor: createPGliteExecutor(pg),
      retryBaseDelayMs: 10,
    });
    await store.init();

    try {
      const legacyJson = JSON.stringify([
        {
          id: 'gl-legacy-1',
          submissionId: 'sub-legacy-1',
          playerName: 'OldChampion',
          region: 'SEA',
          survivalTime: 215.4,
          finalLevel: 100,
          kills: 14,
          victory: true,
          lobbySize: 20,
          mode: 'multiplayer',
          achievedAt: '2026-10-01T12:00:00.000Z',
        },
        {
          id: 'gl-legacy-2',
          submissionId: 'sub-legacy-2',
          playerName: 'OldScout',
          region: 'EUR',
          survivalTime: 88.2,
          finalLevel: 45,
          kills: 3,
          victory: false,
          lobbySize: 10,
          mode: 'royale',
          achievedAt: '2026-10-02T09:30:00.000Z',
        },
        {
          // Invalid: negative survival time and invalid region
          id: 'gl-corrupt',
          submissionId: 'sub-corrupt',
          playerName: 'Broken',
          region: 'MARS',
          survivalTime: -5,
          finalLevel: 10,
          kills: 0,
          victory: false,
          lobbySize: 20,
          mode: 'royale',
          achievedAt: '2026-10-03T00:00:00.000Z',
        },
      ]);

      const parsed = parseLegacyLeaderboardJson(legacyJson);
      assert.equal(parsed.length, 3);

      // Pass 1: imports 2 valid rows, skips 1 invalid
      const pass1 = await store.importLegacyRecords(parsed);
      assert.deepEqual(pass1, {
        totalRead: 3,
        imported: 2,
        skippedDuplicates: 0,
        invalid: 1,
      });

      // Pass 2 (re-run import): skips both valid rows as duplicates, 0 newly imported
      const pass2 = await store.importLegacyRecords(parsed);
      assert.deepEqual(pass2, {
        totalRead: 3,
        imported: 0,
        skippedDuplicates: 2,
        invalid: 1,
      });

      const board = await store.query('ALL', 'longest', 100);
      assert.equal(board.totalGlobal, 2);
      assert.equal(board.entries[0].playerName, 'OldChampion');
      assert.equal(board.entries[0].region, 'SEA');
      assert.equal(board.entries[1].playerName, 'OldScout');
      assert.equal(board.entries[1].region, 'EUR');
    } finally {
      await store.close();
    }
  });

  it('9. PWA service worker excludes /api/leaderboard from caching', () => {
    const swPath = path.resolve(process.cwd(), 'pwa', 'sw.js');
    const swSource = fs.readFileSync(swPath, 'utf-8');
    assert.match(swSource, /url\.pathname\.startsWith\(['"]\/api\/['"]\)/, 'SW must exclude /api/* paths from cache');
    assert.match(swSource, /request\.method\s*!==\s*['"]GET['"]/, 'SW must ignore non-GET requests');
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getTerrainAt } from '../src/game/arena.ts';
import { getBackendConfig } from '../src/game/backendConfig.ts';
import {
  createDefaultSavePayload,
  parseAndValidateSaveData,
  PersistentSaveManager,
  serializeSaveData,
} from '../src/game/cloudSave.ts';
import {
  computeMinViableSafeZoneRadius,
  EndgameDirector,
  EndgamePresentationGuard,
} from '../src/game/endgameDirector.ts';
import {
  CORE_ARCHITECTURE_VERSION,
  CORE_STRUCTURE_STATUS,
  FINAL_ARENA_LAND_MAX_PCT,
  FINAL_ARENA_LAND_MIN_PCT,
  FINAL_ARENA_WATER_MAX_PCT,
  FINAL_ARENA_WATER_MIN_PCT,
  measureCircularTerrainComposition,
  PERMANENT_FINAL_ARENA,
  selectPermanentFinalArena,
} from '../src/game/finalArena.ts';
import {
  GRAPHICS_QUALITY_PRESETS,
  resolveGraphicsQuality,
} from '../src/game/graphicsQuality.ts';
import { RemoteSimulationView } from '../src/game/multiplayerClient.ts';
import type { RemoteKeliState, WorldStatePacket } from '../src/game/multiplayerTypes.ts';
import {
  resetPlatformCapabilitiesCache,
  resolvePlatformCapabilities,
} from '../src/game/platform.ts';
import {
  computeMatchScore,
  computeMatchScoreFromHud,
  ScoreSubmissionGuard,
} from '../src/game/scoring.ts';
import { GameSimulation } from '../src/game/simulation.ts';
import type { KeliEntity, ZoneState } from '../src/game/types.ts';
import {
  OfficialYtGameSdk,
  YOUTUBE_SAFE_SAVE_MAX_BYTES,
  YouTubePlayablesBridge,
} from '../src/game/youtubePlayables.ts';

function stepSim(sim: GameSimulation, seconds: number, dt = 1 / 30): void {
  const steps = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < steps && sim.status === 'playing'; i++) {
    sim.step(dt);
  }
}

function totalMass(sim: GameSimulation): number {
  const living = sim.kelis.filter((k) => k.alive).reduce((s, k) => s + k.level, 0);
  const carcass = sim.carcasses
    .filter((c) => !c.consumed && c.mass > 0)
    .reduce((s, c) => s + c.mass, 0);
  return living + carcass;
}

function toRemoteKeli(k: KeliEntity): RemoteKeliState {
  return {
    id: k.id,
    name: k.name,
    isPlayer: k.isPlayer,
    x: k.x,
    z: k.z,
    vx: k.vx,
    vz: k.vz,
    facingAngle: k.facingAngle,
    level: k.level,
    hp: k.hp,
    maxHp: k.maxHp,
    alive: k.alive,
    isOnShore: k.isOnShore,
    isSubmerged: k.isSubmerged,
    shoreReserve: k.shoreReserve,
    maxShoreReserve: k.maxShoreReserve,
    stamina: k.stamina,
    maxStamina: k.maxStamina,
    fatigued: k.fatigued,
    activeHazard: k.activeHazard,
    bitePhase: k.bitePhase,
    biteAimAngle: k.biteAimAngle,
    evadeTimer: k.evadeTimer,
    staggerTimer: k.staggerTimer,
    stunTimer: k.stunTimer,
    stunResistTimer: k.stunResistTimer,
    venomTimer: k.venomTimer,
    frenzyTimer: k.frenzyTimer,
    veilTimer: k.veilTimer,
    dashTimer: k.dashTimer,
    hitFlashTimer: k.hitFlashTimer,
    surgeTimer: k.surgeTimer,
    predatorTimer: k.predatorTimer,
    aegisTimer: k.aegisTimer,
    dewTimer: k.dewTimer,
    stormFinTimer: k.stormFinTimer,
    thunderRoeTimer: k.thunderRoeTimer,
    evoBoostTimer: k.evoBoostTimer,
    sonarTimer: k.sonarTimer,
    sonarIsHunter: k.sonarIsHunter,
    kills: k.kills,
    feedingTargetId: k.feedingTargetId,
    feedingProgress: k.feedingProgress,
    feedingDuration: k.feedingDuration,
    cooldowns: { ...k.cooldowns },
    activeEmote: k.activeEmote ?? null,
  };
}

// 1. Permanent final arena terrain composition is ~60% dry land / ~40% water on existing Wang Kelian terrain
test('1. Permanent final arena contains ~60% playable dry land and ~40% playable water', () => {
  const m = measureCircularTerrainComposition(
    PERMANENT_FINAL_ARENA.centerX,
    PERMANENT_FINAL_ARENA.centerZ,
    PERMANENT_FINAL_ARENA.radius,
    6
  );

  assert.equal(CORE_ARCHITECTURE_VERSION, '1.0.0-core-freeze');
  assert.equal(CORE_STRUCTURE_STATUS, 'CORE_STRUCTURE_COMPLETE');
  assert.ok(
    m.landPercent >= FINAL_ARENA_LAND_MIN_PCT && m.landPercent <= FINAL_ARENA_LAND_MAX_PCT,
    `Expected landPercent in [57, 63], got ${m.landPercent}%`
  );
  assert.ok(
    m.waterPercent >= FINAL_ARENA_WATER_MIN_PCT && m.waterPercent <= FINAL_ARENA_WATER_MAX_PCT,
    `Expected waterPercent in [37, 43], got ${m.waterPercent}%`
  );
  assert.ok(Math.abs(m.landPercent + m.waterPercent - 100) < 0.05);
  assert.ok(m.blockedPercent < 5, `Expected low obstacle clutter, got ${m.blockedPercent}%`);
  assert.equal(m.meetsAllConstraints, true);
});

// 2. Permanent final arena has connected navigable water, connected dry land, and natural shoreline
test('2. Permanent final arena has 100% connected water, connected land, and natural shoreline seam', () => {
  const selected = selectPermanentFinalArena(6);
  assert.equal(selected.centerX, PERMANENT_FINAL_ARENA.centerX);
  assert.equal(selected.centerZ, PERMANENT_FINAL_ARENA.centerZ);
  assert.equal(selected.radius, PERMANENT_FINAL_ARENA.radius);
  assert.ok(
    selected.waterConnectivityPercent >= 99,
    `Expected >=99% water connectivity, got ${selected.waterConnectivityPercent}%`
  );
  assert.ok(
    selected.landConnectivityPercent >= 99,
    `Expected >=99% land connectivity, got ${selected.landConnectivityPercent}%`
  );
  assert.ok(
    selected.shorelineCells >= 80,
    `Expected wide shoreline transition, got ${selected.shorelineCells}`
  );
});

// 3. Permanent final arena fits completely inside the smallest 5-Keli opening safe zone
test('3. Permanent final arena fits strictly inside the smallest 5-Keli opening zone', () => {
  const sim = new GameSimulation(5, 'royale', 'BoundaryCheck', { matchSeed: 1003 });
  const openingRadius = sim.zone.currentRadius;
  const dist = Math.hypot(
    PERMANENT_FINAL_ARENA.centerX - sim.zone.centerX,
    PERMANENT_FINAL_ARENA.centerZ - sim.zone.centerZ
  );
  assert.ok(
    dist + PERMANENT_FINAL_ARENA.radius <= openingRadius,
    `Final arena extends outside 5-Keli opening zone: dist=${dist.toFixed(1)}, r=${PERMANENT_FINAL_ARENA.radius}, open=${openingRadius.toFixed(1)}`
  );
});

// 4. Safe-zone center smoothly converges toward the permanent 60/40 arena center during contractions
test('4. Safe-zone center converges smoothly toward permanent 60/40 arena center', () => {
  const sim = new GameSimulation(10, 'royale', 'ConvergenceCheck', { matchSeed: 1004 });
  const startDist = Math.hypot(
    sim.zone.centerX - PERMANENT_FINAL_ARENA.centerX,
    sim.zone.centerZ - PERMANENT_FINAL_ARENA.centerZ
  );
  assert.ok(startDist > 100);

  sim.zone.phase = 5;
  sim.zone.isShrinking = true;
  sim.zone.warningActive = false;
  sim.zone.targetRadius = PERMANENT_FINAL_ARENA.radius;
  sim.zone.currentRadius = PERMANENT_FINAL_ARENA.radius + 80;

  stepSim(sim, 4.0);

  const endDist = Math.hypot(
    sim.zone.centerX - PERMANENT_FINAL_ARENA.centerX,
    sim.zone.centerZ - PERMANENT_FINAL_ARENA.centerZ
  );
  assert.ok(endDist < startDist, `Expected center to move closer: start=${startDist}, end=${endDist}`);
});

// 5. Safe zone locks permanently once the 60/40 final radius is reached and never shrinks further
test('5. Safe zone locks permanently at 480u and never shrinks below the permanent 60/40 floor', () => {
  const sim = new GameSimulation(10, 'royale', 'LockFloorCheck', { matchSeed: 1005 });
  sim.zone.phase = 5;
  sim.zone.isShrinking = true;
  sim.zone.warningActive = false;
  sim.zone.targetRadius = PERMANENT_FINAL_ARENA.radius;
  sim.zone.currentRadius = PERMANENT_FINAL_ARENA.radius + 8;

  stepSim(sim, 3.0);

  assert.equal(sim.zone.finalZoneLocked, true);
  assert.equal(sim.zone.isShrinking, false);
  assert.equal(sim.zone.warningActive, false);
  assert.equal(sim.zone.currentRadius, PERMANENT_FINAL_ARENA.radius);
  assert.equal(sim.zone.centerX, PERMANENT_FINAL_ARENA.centerX);
  assert.equal(sim.zone.centerZ, PERMANENT_FINAL_ARENA.centerZ);

  // Advance significantly more match time and confirm zero further shrinkage
  stepSim(sim, 20.0);
  assert.equal(sim.zone.finalZoneLocked, true);
  assert.equal(sim.zone.isShrinking, false);
  assert.equal(sim.zone.currentRadius, PERMANENT_FINAL_ARENA.radius);
  assert.equal(sim.zone.targetRadius, PERMANENT_FINAL_ARENA.radius);
});

// 6. finalZoneLockSeq is strictly single-fire
test('6. Final arena lock transition fires exactly once (single-fire invariant)', () => {
  const director = new EndgameDirector(
    2,
    PERMANENT_FINAL_ARENA.centerX,
    PERMANENT_FINAL_ARENA.centerZ
  );
  const zone: ZoneState = {
    centerX: PERMANENT_FINAL_ARENA.centerX,
    centerZ: PERMANENT_FINAL_ARENA.centerZ,
    currentRadius: PERMANENT_FINAL_ARENA.radius,
    targetRadius: PERMANENT_FINAL_ARENA.radius,
    phase: 5,
    warningTimer: 0,
    warningActive: false,
    isShrinking: false,
    finalZoneLocked: false,
  };

  assert.equal(director.lockFinalZone(120, zone), true);
  assert.equal(director.isFinalZoneLocked(), true);
  assert.equal(director.getState().finalZoneLockSeq, 1);
  assert.equal(zone.finalZoneLocked, true);

  // Subsequent lock attempts must be ignored
  assert.equal(director.lockFinalZone(125, zone), false);
  assert.equal(director.lockFinalZone(180, zone), false);
  assert.equal(director.getState().finalZoneLockSeq, 1);
});

// 7. Post-lock stalemate pressure never shrinks zone, teleports Kelis, modifies stats, or mints fragments
test('7. Post-lock stalemate pressure never shrinks arena, alters stats, teleports, or mints fragments', () => {
  const sim = new GameSimulation(5, 'royale', 'StalemateFair', { matchSeed: 1007 });
  sim.zone.phase = 5;
  sim.zone.isShrinking = true;
  sim.zone.targetRadius = PERMANENT_FINAL_ARENA.radius;
  sim.zone.currentRadius = PERMANENT_FINAL_ARENA.radius + 1;
  stepSim(sim, 1.0);
  assert.equal(sim.zone.finalZoneLocked, true);

  const p = sim.getPlayer();
  p.x = PERMANENT_FINAL_ARENA.centerX - 180;
  p.z = PERMANENT_FINAL_ARENA.centerZ;
  p.hp = p.maxHp;

  const totalMassBefore = totalMass(sim);
  stepSim(sim, 16.0);
  const totalMassAfter = totalMass(sim);

  assert.equal(totalMassBefore, 100);
  assert.equal(totalMassAfter, 100);
  assert.equal(sim.zone.currentRadius, PERMANENT_FINAL_ARENA.radius);
  assert.equal(sim.zone.isShrinking, false);
});

// 8. Post-lock stalemate pressure triggers fair periodic info pulses instead of shrinking
test('8. Post-lock stalemate pressure triggers periodic info pulses and never requests shrinkage', () => {
  const sim = new GameSimulation(5, 'royale', 'PulseTest', { matchSeed: 1008 });
  // Leave exactly 2 survivors for Final Hunt
  for (let i = 2; i < sim.kelis.length; i++) {
    sim.kelis[i].alive = false;
    sim.kelis[i].hp = 0;
  }
  const director = new EndgameDirector(
    2,
    PERMANENT_FINAL_ARENA.centerX,
    PERMANENT_FINAL_ARENA.centerZ
  );
  const zone: ZoneState = {
    centerX: PERMANENT_FINAL_ARENA.centerX,
    centerZ: PERMANENT_FINAL_ARENA.centerZ,
    currentRadius: PERMANENT_FINAL_ARENA.radius,
    targetRadius: PERMANENT_FINAL_ARENA.radius,
    phase: 5,
    warningTimer: 0,
    warningActive: false,
    isShrinking: false,
    finalZoneLocked: false,
  };
  director.lockFinalZone(100, zone);

  let pulseCount = 0;
  for (let i = 0; i < 60; i++) {
    const res = director.step({
      dt: 0.5,
      matchTime: 100 + i * 0.5,
      mode: 'royale',
      matchPhase: 'endgame',
      lobbySize: 20,
      endgameAliveThreshold: 4,
      kelis: sim.kelis,
      carcasses: [],
      zone,
      finalFeastActive: false,
      matchConcluded: false,
      winnerId: null,
    });
    assert.equal(res.shouldTightenZone, false, 'Must NEVER request zone tightening once locked');
    assert.equal(res.tightenWarningJustTriggered, false);
    if (res.stalemateInfoPulseJustTriggered) pulseCount += 1;
  }
  assert.ok(pulseCount >= 1, `Expected at least one fair stalemate info pulse, got ${pulseCount}`);
});

// 9. Deterministic draw safeguard prevents infinite stalls if all combatants expire simultaneously
test('9. Deterministic draw resolution cleanly ends zero-survivor edge cases without stall', () => {
  const sim = new GameSimulation(5, 'royale', 'DrawGuard', { matchSeed: 1009 });
  for (const k of sim.kelis) {
    k.alive = false;
    k.hp = 0;
  }
  const resolved = sim.resolveDraw('All combatants eliminated simultaneously');
  assert.equal(resolved, true);
  assert.equal(sim.status, 'draw');
  assert.equal(sim.getHudSnapshot().matchResult.status, 'draw');
  // Calling again is a safe no-op
  assert.equal(sim.resolveDraw('Duplicate call'), false);
});

// 10. Exact 100-fragment mass conservation holds during locked 60/40 endgame combat
test('10. 100-fragment mass conservation holds continuously after permanent final arena lock', () => {
  const sim = new GameSimulation(20, 'royale', 'MassEndgame', { matchSeed: 1010 });
  sim.zone.phase = 5;
  sim.zone.isShrinking = true;
  sim.zone.targetRadius = PERMANENT_FINAL_ARENA.radius;
  sim.zone.currentRadius = PERMANENT_FINAL_ARENA.radius + 5;

  for (let i = 0; i < 15; i++) {
    stepSim(sim, 1.0);
    assert.equal(totalMass(sim), 100, `Mass conservation violated at t=${i}`);
  }
});

// 11. All evolution forms (aquatic Lv.1-39, shore-crawler Lv.40-79, amphibious Lv.80+) have valid territory in 60/40 arena
test('11. Locked 60/40 arena supports aquatic, shore-crawling, and amphibious terrain access', () => {
  let deepWaterCells = 0;
  let shallowWaterCells = 0;
  let dryLandCells = 0;
  const r = PERMANENT_FINAL_ARENA.radius;
  for (let dz = -r; dz <= r; dz += 16) {
    for (let dx = -r; dx <= r; dx += 16) {
      if (dx * dx + dz * dz > r * r) continue;
      const t = getTerrainAt(PERMANENT_FINAL_ARENA.centerX + dx, PERMANENT_FINAL_ARENA.centerZ + dz);
      if (t === 'deep') deepWaterCells++;
      else if (t === 'shallow') shallowWaterCells++;
      else if (t === 'shore') dryLandCells++;
    }
  }
  assert.ok(deepWaterCells > 100, `Expected deep water space, got ${deepWaterCells}`);
  assert.ok(shallowWaterCells > 100, `Expected shallow shoreline water, got ${shallowWaterCells}`);
  assert.ok(dryLandCells > 500, `Expected broad dry land space, got ${dryLandCells}`);
});

// 12. Platform capabilities: STANDALONE_WEB
test('12. Platform capability resolver produces full online capabilities for STANDALONE_WEB', () => {
  const caps = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
  });
  assert.equal(caps.platform, 'STANDALONE_WEB');
  assert.equal(caps.isYouTubePlayables, false);
  assert.equal(caps.onlineMultiplayerEnabled, true);
  assert.equal(caps.webSocketEnabled, true);
  assert.equal(caps.externalLeaderboardsEnabled, true);
  assert.equal(caps.spatialVoiceEnabled, true);
  assert.equal(caps.youtubeSdkEnabled, false);
  assert.equal(caps.localStorageAllowed, true);
});

// 13. Platform capabilities: ANDROID
test('13. Platform capability resolver produces ANDROID capabilities with multiplayer preserved', () => {
  const caps = resolvePlatformCapabilities({
    buildTarget: 'android',
    inYouTubePlayablesEnv: false,
    isNativeAndroid: true,
  });
  assert.equal(caps.platform, 'ANDROID');
  assert.equal(caps.isAndroid, true);
  assert.equal(caps.isYouTubePlayables, false);
  assert.equal(caps.onlineMultiplayerEnabled, true);
  assert.equal(caps.webSocketEnabled, true);
  assert.equal(caps.mobileControlsSupported, true);
  assert.equal(caps.youtubeSdkEnabled, false);
});

// 14. Platform capabilities: YOUTUBE_PLAYABLES via buildTarget
test('14. Platform capability resolver isolates YOUTUBE_PLAYABLES with zero external multiplayer/WS/localStorage', () => {
  const caps = resolvePlatformCapabilities({
    buildTarget: 'youtube',
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
  });
  assert.equal(caps.platform, 'YOUTUBE_PLAYABLES');
  assert.equal(caps.isYouTubePlayables, true);
  assert.equal(caps.onlineMultiplayerEnabled, false);
  assert.equal(caps.webSocketEnabled, false);
  assert.equal(caps.externalLeaderboardsEnabled, false);
  assert.equal(caps.externalAnalyticsEnabled, false);
  assert.equal(caps.spatialVoiceEnabled, false);
  assert.equal(caps.youtubeSdkEnabled, true);
  assert.equal(caps.cloudSaveEnabled, true);
  assert.equal(caps.scoreSubmissionEnabled, true);
  assert.equal(caps.localStorageAllowed, false);
  assert.equal(caps.modeDisplayLabel, 'AI Battle Royale');
});

// 15. Platform capabilities: runtime ytgame.IN_PLAYABLES_ENV activates YouTube mode
test('15. Runtime inYouTubePlayablesEnv signal activates YOUTUBE_PLAYABLES safeguards automatically', () => {
  const caps = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    inYouTubePlayablesEnv: true,
    isNativeAndroid: false,
  });
  assert.equal(caps.platform, 'YOUTUBE_PLAYABLES');
  assert.equal(caps.onlineMultiplayerEnabled, false);
  assert.equal(caps.localStorageAllowed, false);
});

// 16. backendConfig disables API and WebSocket URLs when running inside YouTube Playables
test('16. backendConfig enforces null API and WS URLs in YouTube Playables runtime', () => {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  try {
    (globalThis as Record<string, unknown>).window = {
      ytgame: { IN_PLAYABLES_ENV: true },
      location: { origin: 'https://example.com', protocol: 'https:', host: 'example.com' },
    };
    resetPlatformCapabilitiesCache();
    const cfg = getBackendConfig();
    assert.equal(cfg.apiBaseUrl, null);
    assert.equal(cfg.wsUrl, null);
    assert.equal(cfg.isApiConfigured, false);
    assert.equal(cfg.isWsConfigured, false);
  } finally {
    if (prevWindow === undefined) delete (globalThis as Record<string, unknown>).window;
    else (globalThis as Record<string, unknown>).window = prevWindow;
    resetPlatformCapabilitiesCache();
  }
});

// 17. YouTubePlayablesBridge signals firstFrameReady and gameReady in order and strictly once
test('17. YouTubePlayablesBridge calls firstFrameReady before gameReady and strictly once each', () => {
  const calls: string[] = [];
  const mockSdk: OfficialYtGameSdk = {
    IN_PLAYABLES_ENV: true,
    game: {
      firstFrameReady: () => calls.push('firstFrameReady'),
      gameReady: () => calls.push('gameReady'),
    },
  };
  const bridge = new YouTubePlayablesBridge(() => mockSdk);

  assert.equal(bridge.isInPlayablesEnv(), true);
  assert.equal(bridge.signalFirstFrameReady(), true);
  assert.equal(bridge.signalFirstFrameReady(), false);
  assert.equal(bridge.signalGameReady(), true);
  assert.equal(bridge.signalGameReady(), false);
  assert.deepEqual(calls, ['firstFrameReady', 'gameReady']);

  // Calling gameReady first still guarantees firstFrameReady runs beforehand
  const calls2: string[] = [];
  const bridge2 = new YouTubePlayablesBridge(() => ({
    IN_PLAYABLES_ENV: true,
    game: {
      firstFrameReady: () => calls2.push('firstFrameReady'),
      gameReady: () => calls2.push('gameReady'),
    },
  }));
  bridge2.signalGameReady();
  assert.deepEqual(calls2, ['firstFrameReady', 'gameReady']);
});

// 18. YouTubePlayablesBridge pause/resume lifecycle hooks work and unsubscribe cleanly
test('18. YouTubePlayablesBridge subscribes and unsubscribes onPause/onResume cleanly', () => {
  const hooks: { pause: (() => void) | null; resume: (() => void) | null } = {
    pause: null,
    resume: null,
  };
  const mockSdk: OfficialYtGameSdk = {
    IN_PLAYABLES_ENV: true,
    system: {
      onPause: (cb) => {
        hooks.pause = cb;
        return () => {
          hooks.pause = null;
        };
      },
      onResume: (cb) => {
        hooks.resume = cb;
        return () => {
          hooks.resume = null;
        };
      },
    },
  };
  const bridge = new YouTubePlayablesBridge(() => mockSdk);
  const events: string[] = [];
  const unsub = bridge.subscribeLifecycle(
    () => events.push('pause'),
    () => events.push('resume')
  );
  hooks.pause?.();
  hooks.resume?.();
  assert.deepEqual(events, ['pause', 'resume']);
  unsub();
  assert.equal(hooks.pause, null);
  assert.equal(hooks.resume, null);
});

// 19. YouTubePlayablesBridge respects isAudioEnabled and onAudioEnabledChange
test('19. YouTubePlayablesBridge propagates YouTube audio mute/unmute state changes', () => {
  const hook: { audioCb: ((enabled: boolean) => void) | null } = { audioCb: null };
  let currentAudio = false;
  const mockSdk: OfficialYtGameSdk = {
    IN_PLAYABLES_ENV: true,
    system: {
      isAudioEnabled: () => currentAudio,
      onAudioEnabledChange: (cb) => {
        hook.audioCb = cb;
        return () => {
          hook.audioCb = null;
        };
      },
    },
  };
  const bridge = new YouTubePlayablesBridge(() => mockSdk);
  assert.equal(bridge.isAudioEnabled(), false);

  const states: boolean[] = [];
  const unsub = bridge.subscribeAudioEnabledChange((enabled) => states.push(enabled));
  currentAudio = true;
  hook.audioCb?.(true);
  currentAudio = false;
  hook.audioCb?.(false);
  assert.deepEqual(states, [true, false]);
  unsub();
  assert.equal(hook.audioCb, null);
});

// 20. YouTubePlayablesBridge enforces load-before-save and 500 KiB payload ceiling
test('20. YouTubePlayablesBridge enforces load-before-save and rejects oversized cloud payloads', async () => {
  let stored = '';
  const mockSdk: OfficialYtGameSdk = {
    IN_PLAYABLES_ENV: true,
    game: {
      loadData: async () => stored,
      saveData: async (data) => {
        stored = data;
      },
    },
  };
  const bridge = new YouTubePlayablesBridge(() => mockSdk);

  const preLoad = await bridge.saveCloudData('{"schemaVersion":1}');
  assert.equal(preLoad.ok, false);
  assert.equal(preLoad.reason, 'load_required_before_save');

  const loaded = await bridge.loadCloudData();
  assert.equal(loaded.ok, true);
  const okSave = await bridge.saveCloudData('{"schemaVersion":1,"bestScore":4200}');
  assert.equal(okSave.ok, true);
  assert.ok(stored.includes('4200'));

  const huge = 'x'.repeat(YOUTUBE_SAFE_SAVE_MAX_BYTES + 1024);
  const bigSave = await bridge.saveCloudData(huge);
  assert.equal(bigSave.ok, false);
  assert.equal(bigSave.reason, 'payload_exceeds_limit');
});

// 21. PersistentSaveManager validates schema v1, recovers from corrupted data, and persists atomically via cloud
test('21. PersistentSaveManager recovers cleanly from malformed data and persists schema v1 to YouTube cloud', async () => {
  let cloudStore = '{corrupted json!!!';
  const mockSdk: OfficialYtGameSdk = {
    IN_PLAYABLES_ENV: true,
    game: {
      loadData: async () => cloudStore,
      saveData: async (data) => {
        cloudStore = data;
      },
    },
  };
  const bridge = new YouTubePlayablesBridge(() => mockSdk);
  const ytCaps = resolvePlatformCapabilities({ buildTarget: 'youtube' });
  const manager = new PersistentSaveManager(() => ytCaps, bridge);

  const loaded = await manager.load();
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(loaded.bestScore, 0);

  const saved = await manager.savePatch((prev) => ({
    ...prev,
    bestScore: 5300,
    matchesCompleted: 3,
    keliKingVictories: 1,
    epilogueUnlocked: true,
    settings: { ...prev.settings, graphicsQuality: 'medium', aiDifficulty: 'hard' },
  }));
  assert.equal(saved, true);

  const reparsed = parseAndValidateSaveData(cloudStore);
  assert.equal(reparsed.bestScore, 5300);
  assert.equal(reparsed.keliKingVictories, 1);
  assert.equal(reparsed.settings.graphicsQuality, 'medium');
  assert.equal(reparsed.settings.aiDifficulty, 'hard');
  assert.ok(serializeSaveData(createDefaultSavePayload()).length < 2048);
});

// 22. Deterministic match scoring is reproducible, monotonic, and independent of 100 evolution fragments
test('22. Match score formula is deterministic, rewards victory/milestones, and never alters fragment count', () => {
  const a = computeMatchScore({
    defeatedOpponents: 4,
    consumedFragments: 60,
    survivalSeconds: 180,
    finalLevel: 61,
    isKeliKingVictory: false,
    matchCompleted: true,
  });
  const b = computeMatchScore({
    defeatedOpponents: 4,
    consumedFragments: 60,
    survivalSeconds: 180,
    finalLevel: 61,
    isKeliKingVictory: false,
    matchCompleted: true,
  });
  assert.deepEqual(a, b);
  assert.equal(a.defeatedScore, 1000);
  assert.equal(a.fragmentScore, 900);
  assert.equal(a.survivalScore, 720);
  assert.equal(a.milestoneScore, 650); // Lv20+40+60
  assert.equal(a.victoryBonus, 0);
  assert.equal(a.completionBonus, 200);
  assert.equal(a.totalScore, 3470);

  const king = computeMatchScore({
    defeatedOpponents: 6,
    consumedFragments: 99,
    survivalSeconds: 240,
    finalLevel: 100,
    isKeliKingVictory: true,
    matchCompleted: true,
  });
  assert.equal(king.victoryBonus, 1500);
  assert.ok(king.totalScore > a.totalScore);

  const sim = new GameSimulation(5, 'royale', 'ScoreHud', { matchSeed: 1022 });
  const scoreFromHud = computeMatchScoreFromHud(sim.getHudSnapshot());
  assert.ok(Number.isInteger(scoreFromHud.totalScore));
});

// 23. Score submission is strictly deduplicated per match ID
test('23. Score submission strictly deduplicates per match ID and rejects non-positive scores', async () => {
  const sent: number[] = [];
  const bridge = new YouTubePlayablesBridge(() => ({
    IN_PLAYABLES_ENV: true,
    engagement: {
      sendScore: async ({ value }) => {
        sent.push(value);
      },
    },
  }));

  const zeroRes = await bridge.submitScore(0, 'match-0');
  assert.equal(zeroRes.submitted, false);

  const first = await bridge.submitScore(4120, 'match-1');
  const dup = await bridge.submitScore(4120, 'match-1');
  const second = await bridge.submitScore(5200, 'match-2');
  assert.equal(first.submitted, true);
  assert.equal(dup.submitted, false);
  assert.equal(dup.reason, 'duplicate_submission');
  assert.equal(second.submitted, true);
  assert.deepEqual(sent, [4120, 5200]);

  const guard = new ScoreSubmissionGuard();
  assert.equal(guard.markSubmitted('run-A'), true);
  assert.equal(guard.markSubmitted('run-A'), false);
  assert.equal(guard.markSubmitted('run-B'), true);
});

// 24. Graphics quality presets scale strictly visual parameters across auto/low/medium/high
test('24. Graphics quality resolver maps auto/low/medium/high to strictly visual rendering budgets', () => {
  assert.equal(resolveGraphicsQuality('low').tier, 'low');
  assert.equal(resolveGraphicsQuality('medium').tier, 'medium');
  assert.equal(resolveGraphicsQuality('high').tier, 'high');
  assert.equal(
    resolveGraphicsQuality('auto', { isSoftwareGl: true }).tier,
    'low'
  );
  assert.equal(
    resolveGraphicsQuality('auto', { isCoarsePointer: true, hardwareConcurrency: 4, deviceMemoryGb: 4 }).tier,
    'medium'
  );
  assert.equal(
    resolveGraphicsQuality('auto', { isCoarsePointer: false, hardwareConcurrency: 8, deviceMemoryGb: 8 }).tier,
    'high'
  );

  assert.ok(GRAPHICS_QUALITY_PRESETS.low.maxPixelRatio < GRAPHICS_QUALITY_PRESETS.high.maxPixelRatio);
  assert.ok(
    GRAPHICS_QUALITY_PRESETS.low.ambientParticleScale <
      GRAPHICS_QUALITY_PRESETS.high.ambientParticleScale
  );
  assert.equal(GRAPHICS_QUALITY_PRESETS.low.shadowsEnabled, false);
  assert.equal(GRAPHICS_QUALITY_PRESETS.high.shadowsEnabled, true);
});

// 25. Graphics quality settings never change gameplay simulation determinism
test('25. Simulation physics, AI, and combat are 100% independent of graphics quality mode', () => {
  const origRandom = Math.random;
  const runWithQuality = (quality: 'low' | 'high') => {
    let state = 0x12345678;
    Math.random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    resolveGraphicsQuality(quality);
    const sim = new GameSimulation(10, 'royale', 'DetCheck', { matchSeed: 2025 });
    sim.setInput({ moveX: 0.8, moveZ: 0.6, aimAngle: 0.64, biteHeld: true });
    stepSim(sim, 5.0);
    return sim;
  };

  try {
    const simLow = runWithQuality('low');
    const simHigh = runWithQuality('high');

    assert.equal(simLow.kelis.length, simHigh.kelis.length);
    for (let i = 0; i < simLow.kelis.length; i++) {
      assert.equal(simLow.kelis[i].x, simHigh.kelis[i].x);
      assert.equal(simLow.kelis[i].z, simHigh.kelis[i].z);
      assert.equal(simLow.kelis[i].level, simHigh.kelis[i].level);
      assert.equal(simLow.kelis[i].hp, simHigh.kelis[i].hp);
    }
  } finally {
    Math.random = origRandom;
  }
});

// 26. EndgamePresentationGuard preserves monotonic finalZoneLocked on multiplayer snapshots
test('26. EndgamePresentationGuard preserves monotonic finalZoneLocked against out-of-order snapshots', () => {
  const guard = new EndgamePresentationGuard();
  const base = {
    substate: 'final_hunt' as const,
    transitionSeq: 2,
    aliveCount: 2,
    remainingUnclaimedFragments: 0,
    highValueCarcassCount: 0,
    contestedCarcassActive: false,
    tensionIntensity: 0.85,
    safeWaterVerified: true,
    minViableRadius: PERMANENT_FINAL_ARENA.radius,
    stalemateQuietSec: 0,
    endgameShrinkPending: false,
    finalZoneLocked: true,
    finalZoneLockSeq: 1,
    finalLandPercent: PERMANENT_FINAL_ARENA.landPercent,
    finalWaterPercent: PERMANENT_FINAL_ARENA.waterPercent,
    stalemateInfoPulseSeq: 0,
    stalemateClueLabel: null,
    announcementTitle: 'FINAL ARENA LOCKED',
    announcementSubtitle: '60% Land · 40% Water',
    announcementSeq: 2,
  };
  const first = guard.ingest(10, base, 'playing');
  assert.equal(first.accepted, true);
  assert.equal(first.finalZoneJustLocked, true);
  assert.equal(guard.isFinalZoneLocked(), true);

  // Stale/reverted packet claiming unlocked must be rejected
  const stale = guard.ingest(
    11,
    {
      ...base,
      finalZoneLocked: false,
      finalZoneLockSeq: 0,
    },
    'playing'
  );
  assert.equal(stale.accepted, false);
  assert.equal(guard.isFinalZoneLocked(), true);
  assert.equal(guard.getState().finalZoneLocked, true);
});

// 27. RemoteSimulationView synchronizes finalZoneLocked cleanly from authoritative server packets
test('27. RemoteSimulationView synchronizes permanent finalZoneLocked state monotonically', () => {
  const sim = new GameSimulation(5, 'royale', 'NetSync', { matchSeed: 1027 });
  sim.zone.phase = 5;
  sim.zone.isShrinking = true;
  sim.zone.targetRadius = PERMANENT_FINAL_ARENA.radius;
  sim.zone.currentRadius = PERMANENT_FINAL_ARENA.radius + 1;
  stepSim(sim, 1.0);
  assert.equal(sim.zone.finalZoneLocked, true);

  const hud = sim.getHudSnapshot();
  const remote = new RemoteSimulationView(sim.getPlayer().id);
  const packet: WorldStatePacket = {
    tick: 42,
    serverTime: Date.now(),
    matchTime: sim.matchTime,
    status: sim.status,
    cameraShake: 0,
    zone: { ...sim.zone },
    weather: { ...sim.weather },
    worldEvent: sim.activeWorldEvent,
    endgame: hud.endgame,
    kelis: sim.kelis.map(toRemoteKeli),
    carcasses: [],
    pickups: [],
    effects: [],
    hud,
    sfx: [{ kind: 'final_zone_locked' }],
  };
  remote.applyServerState(packet);

  assert.equal(remote.zone.finalZoneLocked, true);
  assert.equal(remote.endgameState?.finalZoneLocked, true);
  assert.equal(remote.zone.currentRadius, PERMANENT_FINAL_ARENA.radius);
});

// 28. Responsive aspect ratios (9:32 through 32:9) and 0x0 viewport safety invariants
test('28. Viewport scaling math stays finite across extreme aspect ratios (9:32..32:9) and 0x0', () => {
  const viewports = [
    { w: 0, h: 0 },
    { w: 280, h: 996 }, // ~9:32 ultra-tall
    { w: 360, h: 640 }, // 9:16 mobile portrait
    { w: 1280, h: 720 }, // 16:9 desktop
    { w: 2560, h: 1080 }, // 21:9 ultrawide
    { w: 2560, h: 720 }, // 32:9 super-ultrawide
  ];
  for (const vp of viewports) {
    const safeW = Math.max(1, vp.w);
    const safeH = Math.max(1, vp.h);
    const aspect = safeW / safeH;
    const minViable = computeMinViableSafeZoneRadius(
      PERMANENT_FINAL_ARENA.centerX,
      PERMANENT_FINAL_ARENA.centerZ
    );
    assert.ok(Number.isFinite(aspect) && aspect > 0);
    assert.equal(minViable, PERMANENT_FINAL_ARENA.radius);
  }
});

// 29. 100-Keli performance benchmark & numerical stability check
test('29. 100-Keli simulation runs stably with finite coordinates and conserved 100-fragment economy', () => {
  const sim = new GameSimulation(100, 'royale', 'Bench100', { matchSeed: 1029 });
  const t0 = performance.now();
  const steps = 120; // 4 seconds of 30Hz simulation with 100 active Kelis
  for (let i = 0; i < steps && sim.status === 'playing'; i++) {
    sim.step(1 / 30);
  }
  const elapsedMs = performance.now() - t0;
  const avgStepMs = elapsedMs / steps;

  assert.equal(totalMass(sim), 100);
  for (const k of sim.kelis) {
    assert.ok(Number.isFinite(k.x) && Number.isFinite(k.z), `Non-finite position on ${k.id}`);
    assert.ok(Number.isFinite(k.vx) && Number.isFinite(k.vz), `Non-finite velocity on ${k.id}`);
  }
  // Generous CI ceiling (typical headless step < 4ms)
  assert.ok(avgStepMs < 33, `Expected 100-Keli average step < 33ms, got ${avgStepMs.toFixed(2)}ms`);
});

// 30. YouTube Playables audit script & bundle asset integrity verification
test('30. YouTube Playables build auditor script validates dist-youtube/ structure cleanly', async () => {
  const root = process.cwd();
  const auditScriptPath = path.join(root, 'scripts', 'audit-youtube-build.mjs');
  assert.ok(fs.existsSync(auditScriptPath), 'scripts/audit-youtube-build.mjs must exist');

  const { auditYouTubeBuild } = await import('../scripts/audit-youtube-build.mjs');
  const distYt = path.join(root, 'dist-youtube');
  if (fs.existsSync(distYt)) {
    const report = auditYouTubeBuild(distYt);
    assert.equal(
      report.ok,
      true,
      `YouTube Playables build audit failed: ${report.errors.join('; ')}`
    );
    assert.ok(report.metrics && report.metrics.totalBytes < 250 * 1024 * 1024);
    assert.ok(report.metrics && report.metrics.initialBytes < 30 * 1024 * 1024);
  } else {
    const missingReport = auditYouTubeBuild(path.join(root, 'dist-youtube-nonexistent'));
    assert.equal(missingReport.ok, false);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getHazardAt,
  getTerrainAt,
  isPositionAccessible,
  isWaterSpawnValid,
  OBSTACLES,
} from '../src/game/arena.ts';
import { createSeededRng } from '../src/game/enemyAI.ts';
import {
  generateFairWaterSpawns,
  getLobbyPacingProfile,
  MatchPacingDirector,
} from '../src/game/matchPacing.ts';
import { RemoteSimulationView } from '../src/game/multiplayerClient.ts';
import { GameSimulation, TOTAL_MATCH_FRAGMENTS } from '../src/game/simulation.ts';
import type { LobbySize } from '../src/game/types.ts';

const ALL_LOBBY_SIZES: LobbySize[] = [5, 10, 20, 25, 50, 100];

function totalFragments(sim: GameSimulation): number {
  const living = sim.kelis
    .filter((k) => k.alive)
    .reduce((sum, k) => sum + Math.trunc(k.level), 0);
  const carc = sim.carcasses
    .filter((c) => !c.consumed && c.mass > 0)
    .reduce((sum, c) => sum + Math.trunc(c.mass), 0);
  return living + carc;
}

// 1. Valid spawn distribution
test('1. Valid spawn distribution places all entrants in safe, clear water with escape routes', () => {
  const sim = new GameSimulation(25, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6001,
  });

  for (const k of sim.kelis) {
    const terrain = getTerrainAt(k.x, k.z);
    assert.ok(
      terrain === 'deep' || terrain === 'shallow',
      `Keli ${k.id} spawned on non-water terrain: ${terrain}`
    );
    assert.equal(getHazardAt(k.x, k.z), null, `Keli ${k.id} spawned inside a hazard tile`);
    assert.ok(
      isWaterSpawnValid(k.x, k.z, 36, 1),
      `Keli ${k.id} failed isWaterSpawnValid clearance/escape check`
    );
    const distFromZone = Math.hypot(k.x - sim.zone.centerX, k.z - sim.zone.centerZ);
    assert.ok(
      distFromZone <= sim.zone.currentRadius - 100,
      `Keli ${k.id} spawned too close to/outside safe zone (${distFromZone.toFixed(1)} vs ${sim.zone.currentRadius})`
    );
    for (const obs of OBSTACLES) {
      const clear = Math.hypot(k.x - obs.x, k.z - obs.z) - obs.radius;
      assert.ok(clear >= 32, `Keli ${k.id} spawned too close to obstacle (${clear.toFixed(1)}u)`);
    }
  }
});

// 2. No overlapping or inaccessible spawns across all lobby sizes
test('2. No overlapping or inaccessible spawns across all lobby sizes (5, 10, 20, 25, 50, 100)', () => {
  for (const size of ALL_LOBBY_SIZES) {
    const sim = new GameSimulation(size, 'royale', 'Awang', {
      emitLocalSound: false,
      matchSeed: 6010 + size,
    });
    assert.equal(sim.kelis.length, size);

    for (let i = 0; i < sim.kelis.length; i++) {
      const a = sim.kelis[i];
      assert.ok(
        isPositionAccessible(a.x, a.z, 18, false),
        `Lobby ${size}: ${a.id} not accessible for aquatic Keli`
      );
      for (let j = i + 1; j < sim.kelis.length; j++) {
        const b = sim.kelis[j];
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        assert.ok(
          dist >= 78,
          `Lobby ${size}: overlapping spawns between ${a.id} and ${b.id} (${dist.toFixed(1)}u)`
        );
      }
    }
  }
});

// 3. Different lobby sizes apply distinct adaptive pacing profiles
test('3. Different lobby sizes apply distinct adaptive pacing profiles', () => {
  const p5 = getLobbyPacingProfile(5);
  const p10 = getLobbyPacingProfile(10);
  const p20 = getLobbyPacingProfile(20);
  const p25 = getLobbyPacingProfile(25);
  const p50 = getLobbyPacingProfile(50);
  const p100 = getLobbyPacingProfile(100);

  // Safe zone initial radius scales cleanly with lobby size
  assert.ok(p5.initialZoneRadius < p10.initialZoneRadius);
  assert.ok(p10.initialZoneRadius < p20.initialZoneRadius);
  assert.ok(p20.initialZoneRadius < p25.initialZoneRadius);
  assert.ok(p25.initialZoneRadius < p50.initialZoneRadius);
  assert.ok(p50.initialZoneRadius < p100.initialZoneRadius);

  // Spawn spread & opening wait scale appropriately
  assert.ok(p5.spawnMaxRadius < p25.spawnMaxRadius);
  assert.ok(p25.spawnMaxRadius < p100.spawnMaxRadius);
  assert.ok(p5.initialWarningSec < p25.initialWarningSec);
  assert.ok(p25.initialWarningSec < p100.initialWarningSec);

  // Simulation applies profile on construction
  const sim5 = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false, matchSeed: 6020 });
  const sim100 = new GameSimulation(100, 'royale', 'Awang', { emitLocalSound: false, matchSeed: 6020 });
  assert.equal(sim5.zone.currentRadius, p5.initialZoneRadius);
  assert.equal(sim100.zone.currentRadius, p100.initialZoneRadius);
  assert.ok(sim5.zone.currentRadius < sim100.zone.currentRadius);
});

// 4. Preservation of exact 100 integer fragments
test('4. Strict integer conservation of exact 100 evolution fragments across all lobby sizes and play', () => {
  for (const size of ALL_LOBBY_SIZES) {
    const sim = new GameSimulation(size, 'royale', 'Awang', {
      emitLocalSound: false,
      matchSeed: 6040 + size,
    });
    assert.equal(totalFragments(sim), TOTAL_MATCH_FRAGMENTS, `Initial sum != 100 for lobby ${size}`);
    for (const k of sim.kelis) {
      assert.ok(Number.isInteger(k.level), `Non-integer starting level on ${k.id}`);
    }
  }

  const sim20 = new GameSimulation(20, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6049,
  });
  for (let i = 0; i < 600; i++) {
    sim20.step(0.05);
    if (sim20.status !== 'playing') break;
    assert.equal(
      totalFragments(sim20),
      TOTAL_MATCH_FRAGMENTS,
      `Fragment conservation violated at tick ${i}`
    );
  }
});

// 5. Seeded deterministic spawn generation
test('5. Seeded deterministic spawn generation produces identical placements for identical seeds', () => {
  const simA = new GameSimulation(20, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 77742,
  });
  const simB = new GameSimulation(20, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 77742,
  });
  const simC = new GameSimulation(20, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 99991,
  });

  assert.equal(simA.kelis.length, simB.kelis.length);
  for (let i = 0; i < simA.kelis.length; i++) {
    assert.equal(simA.kelis[i].x, simB.kelis[i].x, `x mismatch at index ${i}`);
    assert.equal(simA.kelis[i].z, simB.kelis[i].z, `z mismatch at index ${i}`);
    assert.equal(simA.kelis[i].facingAngle, simB.kelis[i].facingAngle, `angle mismatch at ${i}`);
    assert.equal(simA.kelis[i].level, simB.kelis[i].level, `level mismatch at ${i}`);
  }

  let anyDifferent = false;
  for (let i = 0; i < simA.kelis.length; i++) {
    if (simA.kelis[i].x !== simC.kelis[i].x || simA.kelis[i].z !== simC.kelis[i].z) {
      anyDifferent = true;
      break;
    }
  }
  assert.ok(anyDifferent, 'Different seeds must produce distinct spawn distributions');

  // Direct generator determinism check
  const prof = getLobbyPacingProfile(25);
  const g1 = generateFairWaterSpawns(25, prof, 2913, 3422, createSeededRng(12345));
  const g2 = generateFairWaterSpawns(25, prof, 2913, 3422, createSeededRng(12345));
  assert.deepEqual(g1, g2);
});

// 6. Early encounter pacing without instant spawn-kills
test('6. Early encounter pacing yields safe opening seconds and natural early encounters', () => {
  const sim = new GameSimulation(20, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6060,
  });

  // First 2.5 seconds: no unavoidable instant spawn-kill on the player
  const p = sim.getPlayer();
  for (let i = 0; i < 50; i++) {
    sim.step(0.05);
  }
  assert.ok(p.alive, 'Player should not suffer an unavoidable instant spawn-kill in opening 2.5s');

  // Nearest rival at spawn is within reasonable scouting distance (not across the entire 5,656u map)
  const simFresh = new GameSimulation(20, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6060,
  });
  const pf = simFresh.getPlayer();
  let nearestSpawnDist = Infinity;
  for (const k of simFresh.kelis) {
    if (k.id === pf.id) continue;
    const d = Math.hypot(k.x - pf.x, k.z - pf.z);
    if (d < nearestSpawnDist) nearestSpawnDist = d;
  }
  assert.ok(
    nearestSpawnDist >= 180 && nearestSpawnDist <= 1150,
    `Nearest rival spawn distance (${nearestSpawnDist.toFixed(1)}u) outside fair early-encounter band`
  );

  // Within 35s of active play, bots engage in natural combat / eliminations
  let hadCombatOrElim = false;
  for (let i = 0; i < 650; i++) {
    sim.step(0.05);
    const metrics = sim.getPacingMetrics();
    if (metrics.timeToFirstEliminationSec !== null || metrics.hotspotsCreated > 0) {
      hadCombatOrElim = true;
      break;
    }
  }
  assert.ok(hadCombatOrElim, 'Expected genuine early-game skirmish activity within 35s');
});

// 7. Match phase transitions
test('7. Match phases progress monotonically from early -> mid -> endgame', () => {
  const sim = new GameSimulation(10, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6070,
  });

  assert.equal(sim.getMatchPhase(), 'early');
  assert.equal(sim.getHudSnapshot().matchPhase, 'early');

  // Eliminate 3 bots (drops aliveFraction to 0.70 <= 0.72 for 10-Keli profile)
  let killed = 0;
  for (const k of sim.kelis) {
    if (!k.isPlayer && k.alive && killed < 3) {
      k.alive = false;
      killed++;
    }
  }
  // Advance slightly past 1 Hz director cadence
  for (let i = 0; i < 25; i++) sim.step(0.05);
  assert.equal(sim.getMatchPhase(), 'mid');

  // Reduce surviving Kelis to endgame threshold (<= 3 for 10-Keli profile)
  for (const k of sim.kelis) {
    if (!k.isPlayer && k.alive && sim.kelis.filter((x) => x.alive).length > 3) {
      k.alive = false;
    }
  }
  for (let i = 0; i < 25; i++) sim.step(0.05);
  assert.equal(sim.getMatchPhase(), 'endgame');
  assert.equal(sim.getHudSnapshot().matchPhase, 'endgame');
});

// 8. Zone contraction timing & safe escape speeds
test('8. Zone contraction speeds remain safely escapable and lull acceleration stays bounded', () => {
  const form1SwimSpeed = 158; // Form 1 baseline swim speed (u/s)
  for (const size of ALL_LOBBY_SIZES) {
    const profile = getLobbyPacingProfile(size);
    assert.ok(
      profile.shrinkSpeed < form1SwimSpeed * 0.48,
      `Lobby ${size} shrinkSpeed (${profile.shrinkSpeed}) too fast for Form 1 swim (${form1SwimSpeed})`
    );
    assert.ok(
      profile.maxLullAccelMult >= 1.2 && profile.maxLullAccelMult <= 1.5,
      `Lobby ${size} maxLullAccelMult (${profile.maxLullAccelMult}) out of fair bounds`
    );
  }

  // Verify lull acceleration speeds up idle wait without skipping pre-contraction warning
  const dir = new MatchPacingDirector(5, 5, 6080);
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false, matchSeed: 6080 });
  sim.zone.warningTimer = 15;
  sim.zone.isShrinking = false;
  sim.zone.phase = 1;
  // Simulate 20s with no combat recorded -> lull active
  const res = dir.step(1.05, 36, sim.zone, sim.kelis, sim.carcasses, 'player', false);
  assert.ok(
    res.zonePaceMultiplier > 1.0 && res.zonePaceMultiplier <= dir.profile.maxLullAccelMult + 1e-6,
    `Expected bounded lull multiplier, got ${res.zonePaceMultiplier}`
  );
});

// 9. Zone warnings
test('9. Pre-contraction warning activates cleanly before zone shrinks and clears during shrink', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6090,
  });
  const profile = getLobbyPacingProfile(5);

  assert.equal(sim.zone.warningActive, false);

  // Step until entering the pre-contraction warning window
  let sawWarning = false;
  let sawShrinkingCleared = false;
  for (let i = 0; i < 600; i++) {
    sim.step(0.05);
    if (sim.status !== 'playing') break;
    if (!sim.zone.isShrinking && sim.zone.warningTimer <= profile.preContractionAlertSec) {
      if (sim.zone.warningActive) sawWarning = true;
    }
    if (sim.zone.isShrinking) {
      assert.equal(sim.zone.warningActive, false, 'warningActive must clear once shrinking starts');
      sawShrinkingCleared = true;
      break;
    }
  }
  assert.ok(sawWarning, 'Pre-contraction warningActive should activate before zone starts moving');
  assert.ok(sawShrinkingCleared, 'Zone should transition into shrinking phase after warning');
});

// 10. Hotspot creation, quantization, coalescing, cap, and expiration
test('10. Activity hotspots are quantized approximate zones, capped at 4, and expire automatically', () => {
  const dir = new MatchPacingDirector(25, 25, 6100);
  const sim = new GameSimulation(25, 'royale', 'Awang', { emitLocalSound: false, matchSeed: 6100 });

  // Exact coordinates should be quantized to 90u grid (never revealing exact pixel coordinates)
  dir.recordCombatEvent(2417, 3142, 10, false, false);
  const active1 = dir.getActiveHotspots(10);
  assert.equal(active1.length, 1);
  assert.equal(active1[0].x % 90, 0, 'Hotspot X must be quantized');
  assert.equal(active1[0].z % 90, 0, 'Hotspot Z must be quantized');
  assert.ok(active1[0].radius >= 150, 'Hotspot must represent a broad approximate zone');

  // Coalescing nearby event into same hotspot
  dir.recordContestedFeed('c1', 2440, 3160, 28, 11, false);
  assert.equal(dir.getActiveHotspots(11).length, 1, 'Nearby hotspot should coalesce');
  assert.equal(dir.getActiveHotspots(11)[0].kind, 'contested_feed');

  // Hard cap at 4 simultaneous hotspots to avoid HUD/minimap clutter
  dir.recordCombatEvent(1200, 1200, 12, false, false);
  dir.recordCombatEvent(3800, 1200, 12.2, false, false);
  dir.recordCombatEvent(1200, 4200, 12.4, false, false);
  dir.recordCombatEvent(4200, 4200, 12.6, false, false);
  assert.ok(dir.getActiveHotspots(12.6).length <= 4, 'Hotspots must be capped at 4');

  // Automatic expiration after TTL
  dir.step(0.05, 30, sim.zone, sim.kelis, sim.carcasses, 'player', false);
  assert.equal(dir.getActiveHotspots(30).length, 0, 'Expired hotspots must be pruned');
});

// 11. Silt Veil & weather visibility restrictions
test('11. Silt Veil prevents hotspot generation and basin fog limits hotspot visibility range', () => {
  const sim = new GameSimulation(20, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6110,
  });
  const p = sim.getPlayer();
  const bot = sim.kelis.find((k) => !k.isPlayer)!;

  // Put both in safe water near each other, enable Silt Veil on attacker
  bot.x = p.x + 40;
  bot.z = p.z;
  bot.veilTimer = 5.0;
  p.facingAngle = 0;

  // Trigger veiled combat via direct bite
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  for (let i = 0; i < 6; i++) sim.step(0.05);
  assert.equal(
    sim.getActivityHotspots().length,
    0,
    'Combat involving a Silt Veil Keli must not emit a public hotspot'
  );

  // Now test weather visibility filtering in HUD snapshot
  const dir = new MatchPacingDirector(20, 20, 6111);
  dir.recordCombatEvent(p.x + 1500, p.z, 5, false, false);
  // Inject via simulation by placing an un-veiled bot 1500u away and dropping a large carcass
  sim.carcasses.push({
    id: 'carc-fog-test',
    x: p.x + 1500,
    z: p.z,
    mass: 30,
    initialMass: 30,
    evolutionPhaseAtDeath: 2,
    sourceName: 'Test',
    createdAt: sim.matchTime,
    bobPhase: 0,
    consumed: false,
    relocated: false,
  });
  for (let i = 0; i < 25; i++) sim.step(0.05);

  sim.weather.kind = 'clear';
  sim.weather.visibilityRange = 1.0;
  const clearCount = sim.getHudSnapshot().activityHotspots?.length ?? 0;

  sim.weather.kind = 'basin_fog';
  sim.weather.visibilityRange = 0.58; // 1950 * 0.58 = 1131u < 1500u
  const fogCount = sim.getHudSnapshot().activityHotspots?.length ?? 0;

  assert.ok(clearCount >= 1, 'Large carcass at 1500u should be visible as hotspot in clear weather');
  assert.ok(fogCount < clearCount, 'Dense basin fog must restrict distant hotspot visibility');
});

// 12. AI compatibility with hotspots and shore restrictions
test('12. AI bots integrate smoothly with public hotspots while respecting Lv.1-39 shore restrictions', () => {
  const sim = new GameSimulation(10, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6120,
  });

  // Add a high-value water carcass to generate a public hotspot
  sim.carcasses.push({
    id: 'carc-ai-hs',
    x: sim.zone.centerX,
    z: sim.zone.centerZ,
    mass: 28,
    initialMass: 28,
    evolutionPhaseAtDeath: 2,
    sourceName: 'Bait',
    createdAt: 0,
    bobPhase: 0,
    consumed: false,
    relocated: false,
  });

  for (let i = 0; i < 120; i++) {
    sim.step(0.05);
    if (sim.status !== 'playing') break;
    for (const k of sim.kelis) {
      if (!k.alive || k.isPlayer) continue;
      if (k.level < 40) {
        assert.notEqual(
          getTerrainAt(k.x, k.z),
          'shore',
          `Lv.${k.level} bot ${k.id} illegally crossed onto shore`
        );
      }
    }
  }

  const debugEntries = sim.getAiDebugSnapshot();
  assert.ok(debugEntries.length > 0);
  for (const e of debugEntries) {
    assert.ok(Number.isFinite(e.x) && Number.isFinite(e.z));
    assert.ok(Number.isFinite(e.intentAngle));
  }
});

// 13. No artificial damage or stat modification
test('13. Match pacing director never alters Keli HP, maxHP, stamina, or movement stats', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6130,
  });
  const p = sim.getPlayer();
  const initialMaxHp = p.maxHp;
  const initialMaxStamina = p.maxStamina;

  // Step through a quiet lull so director increases zonePaceMultiplier
  const dir = new MatchPacingDirector(5, 5, 6130);
  const res = dir.step(1.1, 45, sim.zone, sim.kelis, sim.carcasses, p.id, false);
  assert.ok(res.zonePaceMultiplier > 1.0);
  assert.equal(p.maxHp, initialMaxHp, 'Director must never alter maxHp');
  assert.equal(p.hp, initialMaxHp, 'Director must never apply hidden damage or healing');
  assert.equal(p.maxStamina, initialMaxStamina, 'Director must never alter maxStamina');
  assert.equal(p.stamina, initialMaxStamina, 'Director must never alter stamina');
});

// 14. No enemy teleportation
test('14. Pacing system never teleports enemies (per-tick movement strictly bounded)', () => {
  const sim = new GameSimulation(20, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6140,
  });

  const prevPos = new Map<string, { x: number; z: number }>();
  for (const k of sim.kelis) prevPos.set(k.id, { x: k.x, z: k.z });

  const dt = 0.05;
  for (let tick = 0; tick < 240; tick++) {
    sim.step(dt);
    if (sim.status !== 'playing') break;
    for (const k of sim.kelis) {
      if (!k.alive) continue;
      const prev = prevPos.get(k.id);
      if (prev) {
        const moved = Math.hypot(k.x - prev.x, k.z - prev.z);
        // Max legitimate burst (dash/evade + rapids + recoil) over 0.05s is well under 95u
        assert.ok(
          moved < 95,
          `Suspected teleport on ${k.id} at tick ${tick}: moved ${moved.toFixed(1)}u in ${dt}s`
        );
      }
      prevPos.set(k.id, { x: k.x, z: k.z });
    }
  }
});

// 15. Multiplayer authoritative pacing replication
test('15. Multiplayer authoritative pacing replicates matchPhase, zone warning, and hotspots', () => {
  const sim = new GameSimulation(10, 'royale', 'Host', {
    emitLocalSound: false,
    isMultiplayerMatch: true,
    matchSeed: 6150,
    humanEntrants: [
      { id: 'p1', name: 'Host' },
      { id: 'p2', name: 'Guest' },
    ],
  });

  // Trigger pre-contraction warning window and advance 1s
  sim.zone.warningTimer = 5;
  for (let i = 0; i < 25; i++) sim.step(0.05);

  const pkt1 = sim.getRemoteWorldStateFor('p1', 1);
  const pkt2 = sim.getRemoteWorldStateFor('p2', 1);

  assert.equal(pkt1.hud.matchPhase, pkt2.hud.matchPhase);
  assert.equal(pkt1.zone.warningActive, pkt2.zone.warningActive);
  assert.equal(pkt1.zone.warningActive, true);
  assert.equal(typeof pkt1.hud.fragmentsToKing, 'number');
  assert.equal(typeof pkt2.hud.fragmentsToKing, 'number');

  const clientView = new RemoteSimulationView('p2');
  clientView.applyServerState(pkt2);
  const clientHud = clientView.getLatestHud();
  assert.ok(clientHud, 'RemoteSimulationView should hold replicated HUD snapshot');
  assert.equal(clientHud.matchPhase, pkt2.hud.matchPhase);
  assert.equal(clientView.zone.warningActive, true);
  assert.equal(clientHud.fragmentsToKing, pkt2.hud.fragmentsToKing);
});

// 16. Final Feast compatibility
test('16. Final Feast pauses zone contraction/warnings, clears normal hotspots, and allows Lv.100 finish', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6160,
  });
  const p = sim.getPlayer();

  // Eliminate all bots so player is sole survivor with remaining fragments on carcasses
  for (const k of sim.kelis) {
    if (k.id === p.id) continue;
    k.x = p.x + 35;
    k.z = p.z;
    k.hp = 1;
    // Use natural combat kill via damage by stepping or letting death drop carcasses cleanly
    k.alive = false;
    const dropped = Math.trunc(k.level);
    k.level = 0;
    sim.carcasses.push({
      id: `ff-carc-${k.id}`,
      x: p.x + 25,
      z: p.z,
      mass: dropped,
      initialMass: dropped,
      evolutionPhaseAtDeath: 1,
      sourceName: k.name,
      createdAt: sim.matchTime,
      bobPhase: 0,
      consumed: false,
      relocated: false,
    });
  }

  sim.zone.warningTimer = 4;
  for (let i = 0; i < 25; i++) sim.step(0.05);

  assert.equal(sim.finalFeastActive, true, 'Final Feast must activate for sole survivor < Lv.100');
  assert.equal(sim.zone.warningActive, false, 'Zone pre-contraction warning must pause in Final Feast');
  const radiusDuringFF = sim.zone.currentRadius;
  for (let i = 0; i < 40; i++) sim.step(0.05);
  assert.equal(sim.zone.currentRadius, radiusDuringFF, 'Zone must not contract during Final Feast');

  const hud = sim.getHudSnapshot();
  assert.equal(hud.activityHotspots?.length ?? 0, 0, 'Standard hotspots should yield during Final Feast');
  assert.ok(hud.finalFeast?.active, 'Final Feast guidance must remain active');
});

// 17. Level 100 victory priority
test('17. Reaching Level 100 immediately triggers single-fire victory regardless of match phase', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6170,
  });
  assert.equal(sim.getMatchPhase(), 'early');

  const p = sim.getPlayer();
  const missing = TOTAL_MATCH_FRAGMENTS - p.level;
  // Remove levels from bots and put them on a carcass right in front of the player
  for (const k of sim.kelis) {
    if (k.id !== p.id) {
      k.alive = false;
      k.level = 0;
    }
  }
  sim.carcasses.push({
    id: 'king-carc',
    x: p.x + 15,
    z: p.z,
    mass: missing,
    initialMass: missing,
    evolutionPhaseAtDeath: 3,
    sourceName: 'Rival',
    createdAt: 0,
    bobPhase: 0,
    consumed: false,
    relocated: false,
  });

  const transferred = sim.transferCarcassFragments(p, 'king-carc');
  assert.equal(transferred, missing);
  assert.equal(p.level, TOTAL_MATCH_FRAGMENTS);
  assert.equal(sim.status, 'victory');
  assert.equal(sim.winnerId, p.id);
  assert.equal(sim.getVictoryRecordCount(), 1);
  assert.equal(sim.getPacingMetrics().conclusionCause, 'level_100_king');
});

// 18. Long-running match stability
test('18. Extended headless match remains numerically stable with conserved fragments and bounded arrays', () => {
  const sim = new GameSimulation(10, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6180,
  });

  for (let i = 0; i < 1800; i++) {
    sim.step(0.05); // up to 90 simulated seconds
    if (sim.status !== 'playing') break;
  }

  assert.equal(totalFragments(sim), TOTAL_MATCH_FRAGMENTS, 'Fragments must stay exact 100');
  assert.ok(sim.getActivityHotspots().length <= 4, 'Hotspot list must stay bounded');
  for (const k of sim.kelis) {
    assert.ok(Number.isFinite(k.x) && Number.isFinite(k.z), `Non-finite coords on ${k.id}`);
    assert.ok(Number.isFinite(k.vx) && Number.isFinite(k.vz), `Non-finite velocity on ${k.id}`);
    assert.ok(Number.isFinite(k.hp), `Non-finite HP on ${k.id}`);
  }
});

// 19. 100-Keli performance stays within Update 05 budget
test('19. 100-Keli simulation with pacing director and hotspots sustains smooth tick budget', () => {
  const sim = new GameSimulation(100, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6190,
  });

  const start = performance.now();
  for (let i = 0; i < 60; i++) {
    sim.step(0.05);
  }
  const elapsedMs = performance.now() - start;
  const perTickMs = elapsedMs / 60;

  assert.ok(
    elapsedMs < 2000,
    `60 ticks at 100 Kelis took ${elapsedMs.toFixed(1)}ms (${perTickMs.toFixed(2)}ms/tick), exceeding budget`
  );
  assert.equal(totalFragments(sim), TOTAL_MATCH_FRAGMENTS);
});

// 20. Dev pacing telemetry & regression check
test('20. Dev pacing metrics accurately track match telemetry without affecting gameplay', () => {
  const sim = new GameSimulation(20, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 6200,
  });

  for (let i = 0; i < 700; i++) {
    sim.step(0.05);
    if (sim.status !== 'playing') break;
  }

  const metrics = sim.getPacingMetrics();
  assert.equal(metrics.lobbySize, 20);
  assert.equal(metrics.matchSeed, 6200);
  assert.ok(metrics.totalMatchDurationSec > 0);
  assert.ok(
    metrics.matchPhase === 'early' || metrics.matchPhase === 'mid' || metrics.matchPhase === 'endgame'
  );
  assert.equal(metrics.phaseTransitionTimesSec.early, 0);
  assert.ok(metrics.deadTimeSec >= 0);
  assert.ok(metrics.hotspotsCreated >= 0);

  // Verify HUD guidance fields are always coherent
  const hud = sim.getHudSnapshot();
  assert.equal(hud.fragmentsToKing, Math.max(0, TOTAL_MATCH_FRAGMENTS - Math.trunc(sim.getPlayer().level)));
  assert.ok(
    hud.nextMilestoneLevel === null ||
      (typeof hud.nextMilestoneLevel === 'number' &&
        hud.nextMilestoneLevel > sim.getPlayer().level &&
        hud.nextMilestoneLevel <= 100)
  );
});

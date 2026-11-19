import test from 'node:test';
import assert from 'node:assert/strict';
import { getEvolutionForm } from '../src/data/abilities.ts';
import {
  getTerrainAt,
  isPositionAccessible,
  LANDMARKS,
  OBSTACLES,
} from '../src/game/arena.ts';
import {
  computeBountyReward,
  GameSimulation,
  TOTAL_MATCH_FRAGMENTS,
} from '../src/game/simulation.ts';
import type { KeliEntity, LobbySize } from '../src/game/types.ts';

function assertInvariant(sim: GameSimulation, label: string) {
  const audit = sim.getFragmentAudit();
  assert.equal(
    audit.total,
    TOTAL_MATCH_FRAGMENTS,
    `${label}: expected total=100, got ${audit.total} (living=${audit.living}, carcasses=${audit.carcasses})`
  );
  assert.equal(audit.hasFractional, false, `${label}: fragments must be integers`);
  assert.equal(audit.deadHoldingFragments, 0, `${label}: dead Kelis must hold 0 active fragments`);
  assert.ok(
    audit.maxEntityFragments <= TOTAL_MATCH_FRAGMENTS,
    `${label}: no entity may exceed 100 fragments (got ${audit.maxEntityFragments})`
  );
  assert.equal(audit.valid, true, `${label}: fragment audit must be valid`);
}

function killEntity(
  sim: GameSimulation,
  victim: KeliEntity,
  killer: KeliEntity | null = null,
  cause = 'Bite'
) {
  const internal = sim as unknown as {
    applyDamage: (
      target: KeliEntity,
      attacker: KeliEntity | null,
      amount: number,
      cause: string
    ) => void;
  };
  internal.applyDamage(victim, killer, victim.maxHp * 10 + 1000, cause);
}

// ============================================================================
// REQUIRED TEST 1–4: Lobby Fragment Conservation (5, 20, 50, 100 players)
// ============================================================================

for (const lobbySize of [5, 20, 50, 100] as LobbySize[]) {
  test(`Lobby size ${lobbySize}: initial total fragments strictly equals 100 integer fragments`, () => {
    const sim = new GameSimulation(lobbySize, 'royale', 'Awang', {
      emitLocalSound: false,
    });

    assert.equal(sim.kelis.length, lobbySize);
    assert.equal(sim.carcasses.length, 0);
    assertInvariant(sim, `${lobbySize}-player init`);

    for (const k of sim.kelis) {
      assert.ok(Number.isInteger(k.level), `Keli ${k.id} level must be integer`);
      assert.ok(k.level >= 1, `Keli ${k.id} must start with >= 1 fragment`);
      assert.ok(k.level <= 100, `Keli ${k.id} cannot exceed 100 fragments`);
    }
  });
}

test('Tutorial mode also preserves exact 100 fragments before and after skipToLandLesson()', () => {
  const sim = new GameSimulation(20, 'tutorial', 'Awang', { emitLocalSound: false });
  assertInvariant(sim, 'tutorial init');
  sim.skipToLandLesson();
  assert.equal(sim.getPlayer().level, 40);
  assertInvariant(sim, 'tutorial after skipToLandLesson');
});

// ============================================================================
// REQUIRED TEST 5: Player death transfers fragments correctly (no duplication)
// ============================================================================

test('Player death transfers exact fragments to carcass, zeroes victim inventory, and blocks duplicate death', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const killer = sim.kelis[1];
  const expectedMass = player.level;

  killEntity(sim, player, killer, 'Bite');

  assert.equal(player.alive, false);
  assert.equal(player.level, 0, 'Defeated Keli active inventory must be zeroed');
  assert.equal(player.eliminatedAtLevel, expectedMass);
  assert.equal(sim.carcasses.length, 1);
  assert.equal(sim.carcasses[0].mass, expectedMass);
  assert.equal(sim.carcasses[0].sourceId, player.id);
  assertInvariant(sim, 'after player death');

  // Simultaneous / duplicate lethal call on already-dead Keli must NOT duplicate carcass
  killEntity(sim, player, sim.kelis[2], 'Electroshock');
  assert.equal(sim.carcasses.length, 1, 'Simultaneous kill must not spawn a duplicate carcass');
  assertInvariant(sim, 'after duplicate kill attempt');

  // HUD must still accurately report player elimination level
  const hud = sim.getHudSnapshot(player.id);
  assert.equal(hud.matchResult.finalLevel, expectedMass);
});

// ============================================================================
// REQUIRED TEST 6: Feeding transfers fragments without duplication & preserves incomplete feed
// ============================================================================

test('Feeding transfers fragments accurately and incomplete/interrupted feeding preserves exact remaining quantity', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const eater = sim.getPlayer();
  const victim = sim.kelis[1];
  const initialEaterLevel = eater.level;
  const victimMass = victim.level;

  killEntity(sim, victim, eater, 'Bite');
  const carcass = sim.carcasses[0];
  assert.ok(carcass);
  assert.equal(carcass.mass, victimMass);

  // Place eater next to carcass and start feeding channel, then interrupt mid-channel
  eater.x = carcass.x + 12;
  eater.z = carcass.z;
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);
  assert.equal(eater.feedingTargetId, carcass.id);
  assert.ok(eater.feedingProgress > 0 && eater.feedingProgress < eater.feedingDuration);

  // Move eater away mid-feed -> incomplete feed must preserve full carcass mass
  eater.x = carcass.x + 250;
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
  sim.step(0.05);
  assert.equal(eater.feedingTargetId, null);
  assert.equal(carcass.mass, victimMass, 'Interrupted channel must preserve carcass mass');
  assertInvariant(sim, 'after interrupted channel');

  // Partial atomic transfer preserves exact remaining quantity
  const partialAmount = Math.floor(victimMass / 2);
  const transferred1 = sim.transferCarcassFragments(eater, carcass.id, partialAmount);
  assert.equal(transferred1, partialAmount);
  assert.equal(eater.level, initialEaterLevel + partialAmount);
  assert.equal(carcass.mass, victimMass - partialAmount);
  assertInvariant(sim, 'after partial transfer');

  // Finish consuming remainder
  const transferred2 = sim.transferCarcassFragments(eater, carcass.id);
  assert.equal(transferred2, victimMass - partialAmount);
  assert.equal(eater.level, initialEaterLevel + victimMass);
  assert.equal(sim.carcasses.length, 0);
  assertInvariant(sim, 'after full consumption');
});

// ============================================================================
// REQUIRED TEST 7: Two players feeding simultaneously cannot duplicate rewards
// ============================================================================

test('Two players feeding simultaneously on the same carcass cannot duplicate fragments', () => {
  const sim = new GameSimulation(5, 'royale', 'P1', {
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
    emitLocalSound: false,
    isMultiplayerMatch: true,
  });

  const p1 = sim.getPlayer('p1');
  const p2 = sim.getPlayer('p2');
  const victim = sim.kelis[2];
  const p1Before = p1.level;
  const p2Before = p2.level;
  const victimMass = victim.level;

  killEntity(sim, victim, p1, 'Bite');
  const carc = sim.carcasses[0];
  assert.ok(carc);

  // Position both human feeders right on the carcass and feed simultaneously
  p1.x = carc.x + 10;
  p1.z = carc.z;
  p2.x = carc.x - 10;
  p2.z = carc.z;
  p1.feedingTargetId = carc.id;
  p1.feedingDuration = 0.5;
  p1.feedingProgress = 0.49;
  p2.feedingTargetId = carc.id;
  p2.feedingDuration = 0.5;
  p2.feedingProgress = 0.49;

  // Step a single tick where BOTH cross feedingDuration in the exact same tick!
  sim.step(0.05);

  const totalGained = (p1.level - p1Before) + (p2.level - p2Before);
  assert.equal(totalGained, victimMass, 'Only one feeder may claim the carcass fragments');
  assert.equal(sim.carcasses.length, 0);
  assert.equal(p1.feedingTargetId, null);
  assert.equal(p2.feedingTargetId, null);
  assertInvariant(sim, 'after simultaneous feed race');

  // Direct second attempt on already-consumed carcass ID must yield 0
  const secondClaim = sim.transferCarcassFragments(p2, carc.id);
  assert.equal(secondClaim, 0);
  assertInvariant(sim, 'after stale carcass re-claim');
});

// ============================================================================
// REQUIRED TEST 8: Bounty rewards cannot generate extra fragments
// ============================================================================

test('Multiplayer bounty rewards never mint fragments and instead grant speed/stamina surge + bounty points', () => {
  const sim = new GameSimulation(10, 'royale', 'P1', {
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
    emitLocalSound: false,
    isMultiplayerMatch: true,
  });

  const p1 = sim.getPlayer('p1');
  const p2 = sim.getPlayer('p2');

  // Have p1 eliminate and consume 2 bots so p1 earns an active Rival Bounty mark
  for (const botIdx of [2, 3]) {
    const bot = sim.kelis[botIdx];
    killEntity(sim, bot, p1, 'Bite');
    const carc = sim.carcasses.find((c) => c.sourceId === bot.id)!;
    sim.transferCarcassFragments(p1, carc.id);
  }

  assert.equal(p1.bountyReward, computeBountyReward(2));
  assert.ok((p1.bountyReward ?? 0) > 0, 'p1 should be marked with a bounty');
  assertInvariant(sim, 'after p1 becomes bounty target');

  const p2LevelBefore = p2.level;
  p2.stamina = 10;
  p2.fatigued = true;

  // p2 eliminates bounty-marked p1
  killEntity(sim, p1, p2, 'Bite');

  assert.equal(
    p2.level,
    p2LevelBefore,
    'Claiming a bounty must NOT directly add evolution fragments'
  );
  assert.equal(p2.bountyPoints, computeBountyReward(2), 'Killer must earn non-fragment bounty points');
  assert.ok((p2.bountyBoostTimer ?? 0) > 0, 'Killer must receive temporary speed/stamina surge');
  assert.equal(p2.fatigued, false, 'Bounty surge should clear fatigue');
  assert.ok(p2.stamina > 10, 'Bounty surge should restore stamina');
  assertInvariant(sim, 'after bounty claim');

  // Also ensure consuming p1 carcass afterward keeps total = 100
  const p1Carc = sim.carcasses.find((c) => c.sourceId === p1.id)!;
  sim.transferCarcassFragments(p2, p1Carc.id);
  assertInvariant(sim, 'after consuming bounty victim carcass');
});

// ============================================================================
// REQUIRED TEST 9: Disconnected player cannot cause fragment loss
// ============================================================================

test('Disconnected player preserves all 100 fragments under both AI-takeover and elimination modes', () => {
  // Mode A: Default multiplayer disconnect -> AI takes over living Keli
  const simA = new GameSimulation(10, 'royale', 'P1', {
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
    emitLocalSound: false,
    isMultiplayerMatch: true,
  });
  const p2A = simA.getPlayer('p2');
  const p2MassA = p2A.level;

  simA.handlePlayerDisconnect('p2', false);
  assert.equal(p2A.isPlayer, false);
  assert.equal(p2A.alive, true);
  assert.equal(p2A.level, p2MassA);
  assertInvariant(simA, 'after disconnect AI takeover');

  for (let i = 0; i < 20; i++) {
    simA.step(1 / 30);
  }
  assertInvariant(simA, 'after ticking post-disconnect AI takeover');

  // Mode B: Disconnect elimination -> fragments drop into an accessible carcass
  const simB = new GameSimulation(10, 'royale', 'P1', {
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
    emitLocalSound: false,
    isMultiplayerMatch: true,
  });
  const p2B = simB.getPlayer('p2');
  const p2MassB = p2B.level;

  simB.handlePlayerDisconnect('p2', true);
  assert.equal(p2B.alive, false);
  assert.equal(p2B.level, 0);
  assert.equal(simB.carcasses.length, 1);
  assert.equal(simB.carcasses[0].mass, p2MassB);
  assertInvariant(simB, 'after disconnect elimination');
});

// ============================================================================
// REQUIRED TEST 10: Rapid consecutive eliminations maintain correct totals
// ============================================================================

test('Rapid consecutive eliminations across a 50-player match maintain exact 100 fragments', () => {
  const sim = new GameSimulation(50, 'royale', 'Awang', { emitLocalSound: false });
  const survivor = sim.getPlayer();

  // Eliminate 49 opponents in rapid succession with interleaved ticks and feeds
  for (let i = 1; i < sim.kelis.length; i++) {
    const victim = sim.kelis[i];
    const killer = i % 3 === 0 ? null : survivor;
    killEntity(sim, victim, killer, i % 3 === 0 ? 'Radioactive Zone' : 'Bite');
    assertInvariant(sim, `rapid elimination #${i}`);

    // Interleave partial feeds every 5 eliminations
    if (i % 5 === 0 && sim.carcasses.length > 0 && sim.status === 'playing') {
      sim.transferCarcassFragments(survivor, sim.carcasses[0].id);
      assertInvariant(sim, `interleaved feed #${i}`);
    }
  }

  assert.equal(sim.kelis.filter((k) => k.alive).length, 1);
  assertInvariant(sim, 'after 49 rapid eliminations');
});

// ============================================================================
// REQUIRED TEST 11: Single survivor enters Final Feast & recovers trapped fragments
// ============================================================================

test('Single survivor with unclaimed carcasses enters Final Feast, recovers inaccessible shore/rock fragments, and wins at Lv.100', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();

  // Eliminate all 4 bots while player stays < Lv.40 (so shore is inaccessible to player!)
  assert.ok(player.level < 40);
  for (let i = 1; i < sim.kelis.length; i++) {
    killEntity(sim, sim.kelis[i], player, 'Bite');
  }

  // Intentionally trap one carcass on Tebing Kering shore and another inside a solid rock obstacle!
  const shoreCarc = sim.carcasses[0];
  const rockCarc = sim.carcasses[1];
  shoreCarc.x = LANDMARKS.kampungHut.x;
  shoreCarc.z = LANDMARKS.kampungHut.z;
  assert.equal(getTerrainAt(shoreCarc.x, shoreCarc.z), 'shore');

  rockCarc.x = OBSTACLES[0].x;
  rockCarc.z = OBSTACLES[0].z;

  // Step simulation -> must NOT award immediate victory; MUST initiate Final Feast
  sim.step(1 / 30);

  assert.equal(sim.status, 'playing', 'Sole survivor below Lv.100 must NOT win immediately');
  assert.equal(sim.finalFeastActive, true, 'Final Feast must activate');
  assert.equal(sim.finalFeastTriggered, true);
  assertInvariant(sim, 'upon entering Final Feast');

  // Every trapped carcass must now be relocated to accessible non-shore water!
  for (const c of sim.carcasses) {
    assert.equal(
      isPositionAccessible(c.x, c.z, 12, player.level >= 40),
      true,
      `Carcass ${c.id} must be relocated to an accessible water location`
    );
  }

  // HUD must expose ALL remaining carcasses and directional offscreen markers
  const hud = sim.getHudSnapshot(player.id);
  assert.ok(hud.finalFeast?.active, 'HUD must report active Final Feast');
  assert.equal(hud.finalFeast.remainingCarcasses.length, sim.carcasses.length);
  assert.equal(hud.finalFeast.remainingFragments, 100 - player.level);

  // Survivor collects all remaining carcasses -> reaches exactly 100 and wins
  const remainingIds = sim.carcasses.map((c) => c.id);
  for (const id of remainingIds) {
    sim.transferCarcassFragments(player, id);
  }

  assert.equal(player.level, 100);
  assert.equal(sim.carcasses.length, 0);
  assert.equal(sim.status, 'victory');
  assert.equal(sim.winnerId, player.id);
  assert.equal(sim.finalFeastActive, false);
  assertInvariant(sim, 'after Final Feast completion');
});

// ============================================================================
// REQUIRED TEST 12: Reaching exactly 100 fragments triggers victory once & stops simulation
// ============================================================================

test('Reaching exactly 100 fragments triggers victory strictly once and halts further gameplay mutations', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();

  // Eliminate all rivals and collect all carcasses
  for (let i = 1; i < sim.kelis.length; i++) {
    killEntity(sim, sim.kelis[i], player, 'Bite');
  }
  const ids = sim.carcasses.map((c) => c.id);
  for (const id of ids) {
    sim.transferCarcassFragments(player, id);
  }

  assert.equal(player.level, 100);
  assert.equal(sim.status, 'victory');
  assert.equal(sim.getVictoryRecordCount(), 1, 'Victory must be recorded exactly once');

  const frozenMatchTime = sim.matchTime;
  const frozenX = player.x;
  const frozenHp = player.hp;

  // Attempt post-victory steps, inputs, abilities, and damage -> simulation must stay frozen
  sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.triggerPlayerAbility('dash');
  for (let i = 0; i < 30; i++) {
    sim.step(1 / 30);
  }
  killEntity(sim, player, null, 'Post-Victory Hazard');

  assert.equal(sim.matchTime, frozenMatchTime, 'Simulation time must halt after victory');
  assert.equal(player.x, frozenX, 'Winner must not move after victory');
  assert.equal(player.alive, true, 'Winner must not die after victory');
  assert.equal(player.hp, frozenHp);
  assert.equal(sim.status, 'victory');
  assert.equal(sim.getVictoryRecordCount(), 1, 'Victory count must remain strictly 1');
  assertInvariant(sim, 'post-victory frozen state');
});

// ============================================================================
// REQUIRED TEST 13: No player can exceed 100 evolution fragments
// ============================================================================

test('No player can exceed 100 evolution fragments even under extreme feeding or bounty stress', () => {
  const sim = new GameSimulation(20, 'royale', 'P1', {
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
    emitLocalSound: false,
    isMultiplayerMatch: true,
  });

  const p1 = sim.getPlayer('p1');
  const p2 = sim.getPlayer('p2');

  // Give p2 a bounty mark first, then have p1 eliminate everyone (including bounty-marked p2)
  for (const idx of [2, 3]) {
    killEntity(sim, sim.kelis[idx], p2, 'Bite');
    const c = sim.carcasses.find((x) => x.sourceId === sim.kelis[idx].id)!;
    sim.transferCarcassFragments(p2, c.id);
  }
  assert.ok((p2.bountyReward ?? 0) > 0);

  for (const other of sim.kelis) {
    if (other.id === p1.id || !other.alive) continue;
    killEntity(sim, other, p1, 'Bite');
    assertInvariant(sim, `stress kill ${other.id}`);
  }

  for (const c of [...sim.carcasses]) {
    sim.transferCarcassFragments(p1, c.id);
    assert.ok(p1.level <= 100, `Player level exceeded 100: ${p1.level}`);
    assertInvariant(sim, `stress feed ${c.id}`);
  }

  assert.equal(p1.level, 100);
  assert.equal(sim.status, 'victory');
  assert.equal(sim.getVictoryRecordCount(), 1);
});

// ============================================================================
// REGRESSION CHECKS (TASK 7): Movement, Combat/Cooldowns, Evolutions, AI, Zone
// ============================================================================

test('Preserved gameplay mechanics: movement, combat/cooldowns, evolution forms, AI, and zone contraction remain intact', () => {
  const sim = new GameSimulation(10, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const startX = player.x;
  const startZ = player.z;

  // 1. Movement works
  sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
  for (let i = 0; i < 10; i++) sim.step(1 / 30);
  assert.ok(Math.hypot(player.x - startX, player.z - startZ) > 10, 'Player movement must work');

  // 2. Dash ability unlocks at Lv.10 and applies cooldown
  assert.equal(player.level, 10);
  sim.triggerPlayerAbility('dash');
  assert.ok(player.cooldowns.dash > 0, 'Dash cooldown must trigger at Lv.10+');

  // 3. Evolution forms trigger at exact thresholds (1..39 Form 1, 40..79 Form 2, 80..99 Form 3, 100 Form 4)
  assert.equal(getEvolutionForm(1), 1);
  assert.equal(getEvolutionForm(39), 1);
  assert.equal(getEvolutionForm(40), 2);
  assert.equal(getEvolutionForm(79), 2);
  assert.equal(getEvolutionForm(80), 3);
  assert.equal(getEvolutionForm(99), 3);
  assert.equal(getEvolutionForm(100), 4);

  // 4. AI bots move and operate over 150 ticks while preserving exact 100 fragments
  const botStartPos = sim.kelis[1].x + sim.kelis[1].z;
  for (let i = 0; i < 150; i++) {
    sim.step(1 / 30);
    assertInvariant(sim, `AI simulation tick ${i}`);
  }
  const botMoved = Math.abs(sim.kelis[1].x + sim.kelis[1].z - botStartPos) > 1 || !sim.kelis[1].alive;
  assert.ok(botMoved, 'AI opponents must actively simulate');

  // 5. Radioactive zone contracts after warningTimer expires
  const initialRadius = sim.zone.currentRadius;
  sim.zone.warningTimer = 0.01;
  for (let i = 0; i < 60; i++) {
    sim.step(1 / 30);
  }
  assert.ok(sim.zone.currentRadius < initialRadius, 'Radioactive zone must contract normally');
  assertInvariant(sim, 'after zone contraction');
});

test('Multiplayer authoritative state packets synchronize fragment sums, Final Feast, and single winner across clients', () => {
  const sim = new GameSimulation(5, 'royale', 'Host', {
    humanEntrants: [
      { id: 'h1', name: 'Host' },
      { id: 'h2', name: 'Rival' },
    ],
    emitLocalSound: false,
    isMultiplayerMatch: true,
  });

  const h1 = sim.getPlayer('h1');
  const h2 = sim.getPlayer('h2');

  // Eliminate h2 and all bots so h1 is sole survivor < 100
  for (const k of sim.kelis) {
    if (k.id !== h1.id) killEntity(sim, k, h1, 'Bite');
  }
  sim.step(1 / 30);

  const pkt1Before = sim.getRemoteWorldStateFor('h1', 1);
  const pkt2Before = sim.getRemoteWorldStateFor('h2', 1);
  assert.equal(pkt1Before.status, 'playing');
  assert.equal(pkt2Before.status, 'playing');
  assert.equal(pkt1Before.hud.livingMassSum + pkt1Before.hud.carcassMassSum, 100);
  assert.equal(pkt2Before.hud.livingMassSum + pkt2Before.hud.carcassMassSum, 100);
  assert.equal(pkt1Before.hud.finalFeast?.active, true);
  assert.equal(pkt2Before.hud.matchResult.finalLevel, 20);

  // h1 collects remaining carcasses -> reaches 100
  for (const c of [...sim.carcasses]) {
    sim.transferCarcassFragments(h1, c.id);
  }

  const pkt1After = sim.getRemoteWorldStateFor('h1', 2);
  const pkt2After = sim.getRemoteWorldStateFor('h2', 2);
  assert.equal(pkt1After.status, 'victory');
  assert.equal(pkt2After.status, 'defeat');
  assert.equal(pkt1After.hud.matchResult.winnerId, 'h1');
  assert.equal(pkt2After.hud.matchResult.winnerId, 'h1');
  assert.equal(pkt1After.hud.matchResult.winnerName, 'Host');
  assert.equal(pkt2After.hud.matchResult.winnerName, 'Host');
  assert.equal(pkt1After.hud.matchResult.finalLevel, 100);
  assert.equal(pkt2After.hud.matchResult.finalLevel, 20);
  assert.equal(sim.getVictoryRecordCount(), 1);
});

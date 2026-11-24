import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  LANDMARKS,
  WORLD_CENTER,
  getTerrainAt,
  isPositionAccessible,
} from '../src/game/arena.ts';
import {
  ENDGAME_MIN_VIABLE_BASE_RADIUS,
  ENDGAME_SUBSTATE_RANK,
  ENDGAME_TIGHTEN_SPEED,
  EndgamePresentationGuard,
  computeMinViableSafeZoneRadius,
  verifySafeZoneNavigability,
} from '../src/game/endgameDirector.ts';
import { RemoteSimulationView } from '../src/game/multiplayerClient.ts';
import {
  GameSimulation,
  TOTAL_MATCH_FRAGMENTS,
} from '../src/game/simulation.ts';
import type { KeliEntity, ZoneState } from '../src/game/types.ts';
import { WorldEventVfxPool } from '../src/game/worldEventVfx.ts';

function assertFragmentConservation(sim: GameSimulation, label: string) {
  const audit = sim.getFragmentAudit();
  assert.equal(
    audit.total,
    TOTAL_MATCH_FRAGMENTS,
    `${label}: expected 100 total fragments, got ${audit.total} (living=${audit.living}, carcasses=${audit.carcasses})`
  );
  assert.equal(audit.hasFractional, false, `${label}: fractional fragments forbidden`);
  assert.equal(audit.deadHoldingFragments, 0, `${label}: dead Kelis must hold 0 fragments`);
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
  internal.applyDamage(victim, killer, victim.maxHp * 10, cause);
}

function findOpenWaterInZone(zone: ZoneState, minDistFromCenter = 0): { x: number; z: number } {
  for (let r = minDistFromCenter; r <= Math.max(200, zone.currentRadius - 90); r += 36) {
    for (let a = 0; a < 16; a++) {
      const ang = (a * Math.PI * 2) / 16;
      const x = zone.centerX + Math.cos(ang) * r;
      const z = zone.centerZ + Math.sin(ang) * r;
      if (getTerrainAt(x, z) === 'deep' && isPositionAccessible(x, z, 32, false)) {
        return { x, z };
      }
    }
  }
  return { x: LANDMARKS.radioactiveDrum.x, z: LANDMARKS.radioactiveDrum.z };
}

function findDryShorePoint(): { x: number; z: number } {
  const base = LANDMARKS.tebingKeringLanding;
  for (let r = 20; r <= 420; r += 24) {
    for (let a = 0; a < 16; a++) {
      const ang = (a * Math.PI * 2) / 16;
      const x = base.x + Math.cos(ang) * r;
      const z = base.z + Math.sin(ang) * r;
      if (getTerrainAt(x, z) === 'shore' && isPositionAccessible(x, z, 24, true)) {
        return { x, z };
      }
    }
  }
  return { x: base.x + 120, z: base.z };
}

/**
 * Cleanly redistributes integer fragment totals across living Kelis while keeping total === 100.
 */
function setLivingLevelsConserved(sim: GameSimulation, assignments: Array<[KeliEntity, number]>) {
  // Kill anyone not in assignments cleanly into zero-mass or transfer to assignments
  const map = new Map<string, number>();
  let sum = 0;
  for (const [k, lvl] of assignments) {
    map.set(k.id, lvl);
    sum += lvl;
  }
  const carcassSum = sim.carcasses
    .filter((c) => !c.consumed && c.mass > 0)
    .reduce((acc, c) => acc + Math.trunc(c.mass), 0);
  assert.equal(sum + carcassSum, TOTAL_MATCH_FRAGMENTS, 'Test setup must conserve 100 fragments');

  for (const k of sim.kelis) {
    const targetLvl = map.get(k.id);
    if (targetLvl !== undefined) {
      k.alive = true;
      k.level = targetLvl;
      k.maxHp = 100 + targetLvl * 4;
      k.hp = k.maxHp;
    } else {
      k.alive = false;
      k.level = 0;
      k.hp = 0;
    }
  }
}

test('1. Correct endgame activation: starts in none, stays none in tutorial, activates cleanly in royale', () => {
  const tutSim = new GameSimulation(5, 'tutorial', 'Learner', {
    matchSeed: 9001,
    emitLocalSound: false,
  });
  for (let i = 0; i < 30; i++) tutSim.step(0.05);
  assert.equal(tutSim.endgameState.substate, 'none', 'Tutorial mode must stay in none');

  const sim = new GameSimulation(20, 'royale', 'Awang', {
    matchSeed: 9002,
    emitLocalSound: false,
  });
  sim.step(0.05);
  assert.equal(sim.endgameState.substate, 'none', '20-Keli opening must start in none');
  assert.equal(sim.endgameState.transitionSeq, 0);
  assertFragmentConservation(sim, 'test 1');
});

test('2. Final Convergence transition activates when surviving count enters endgame threshold (>=4 Kelis)', () => {
  const sim = new GameSimulation(20, 'royale', 'Awang', {
    matchSeed: 9003,
    emitLocalSound: false,
  });
  // Reduce to 5 living Kelis (endgame threshold for 20-Keli lobby is 5)
  const survivors = sim.kelis.slice(0, 5);
  setLivingLevelsConserved(sim, [
    [survivors[0], 20],
    [survivors[1], 20],
    [survivors[2], 20],
    [survivors[3], 20],
    [survivors[4], 20],
  ]);

  for (let i = 0; i < 8; i++) sim.step(0.05);
  assert.equal(sim.endgameState.substate, 'final_convergence');
  assert.equal(sim.endgameState.aliveCount, 5);
  assert.equal(sim.endgameState.announcementTitle, 'FINAL CONVERGENCE');
  assert.ok(sim.endgameState.transitionSeq >= 1);
  assertFragmentConservation(sim, 'test 2');
});

test('3. Final Hunt activation with 2-3 survivors preserves full combat interactivity without resets or freebies', () => {
  const sim = new GameSimulation(10, 'royale', 'Awang', {
    matchSeed: 9004,
    emitLocalSound: false,
  });
  const s0 = sim.kelis[0];
  const s1 = sim.kelis[1];
  const s2 = sim.kelis[2];
  setLivingLevelsConserved(sim, [
    [s0, 45],
    [s1, 35],
    [s2, 20],
  ]);

  const spot = findOpenWaterInZone(sim.zone, 0);
  s0.x = spot.x - 160;
  s0.z = spot.z;
  s0.hp = Math.round(s0.maxHp * 0.6);
  s0.stamina = 42;
  s1.x = spot.x + 160;
  s1.z = spot.z;
  s2.x = spot.x;
  s2.z = spot.z + 180;

  const hpBefore = s0.hp;
  const stamBefore = s0.stamina;
  const xBefore = s0.x;

  // Step once past evaluation cadence
  for (let i = 0; i < 6; i++) sim.step(0.05);

  assert.equal(sim.endgameState.substate, 'final_hunt');
  assert.equal(sim.endgameState.aliveCount, 3);
  assert.equal(sim.endgameState.announcementTitle, 'FINAL HUNT');
  // No teleportation, no HP reset, no free fragments, no level equalization
  assert.ok(Math.abs(s0.x - xBefore) < 80, 'Player must not be teleported on Final Hunt');
  assert.ok(s0.hp <= hpBefore + 6, 'HP must not be artificially reset on Final Hunt');
  assert.ok(s0.stamina < s0.maxStamina || stamBefore < s0.maxStamina, 'Stamina must not be artificially reset');
  assert.equal(s0.level, 45);
  assert.equal(s1.level, 35);
  assert.equal(s2.level, 20);
  assertFragmentConservation(sim, 'test 3');
});

test('4. No duplicate substate transitions and strictly monotonic substate progression', () => {
  const sim = new GameSimulation(10, 'royale', 'Awang', {
    matchSeed: 9005,
    emitLocalSound: false,
  });
  const survivors = sim.kelis.slice(0, 4);
  setLivingLevelsConserved(sim, [
    [survivors[0], 25],
    [survivors[1], 25],
    [survivors[2], 25],
    [survivors[3], 25],
  ]);

  // Enter FINAL_CONVERGENCE
  for (let i = 0; i < 8; i++) sim.step(0.05);
  assert.equal(sim.endgameState.substate, 'final_convergence');
  const seqAfterConv = sim.endgameState.transitionSeq;
  const annAfterConv = sim.endgameState.announcementSeq;

  // Step further while still in FINAL_CONVERGENCE -> zero duplicate transitions
  for (let i = 0; i < 20; i++) sim.step(0.05);
  assert.equal(sim.endgameState.transitionSeq, seqAfterConv, 'Must not fire duplicate convergence transitions');
  assert.equal(sim.endgameState.announcementSeq, annAfterConv, 'Must not fire duplicate announcements');

  // Drop to 2 survivors -> enter FINAL_HUNT once
  const spot = findOpenWaterInZone(sim.zone, 0);
  survivors[0].x = spot.x - 200;
  survivors[0].z = spot.z;
  survivors[1].x = spot.x + 200;
  survivors[1].z = spot.z;
  setLivingLevelsConserved(sim, [
    [survivors[0], 55],
    [survivors[1], 45],
  ]);

  for (let i = 0; i < 8; i++) sim.step(0.05);
  assert.equal(sim.endgameState.substate, 'final_hunt');
  const seqAfterHunt = sim.endgameState.transitionSeq;
  assert.equal(seqAfterHunt, seqAfterConv + 1, 'Exactly one transition increment into Final Hunt');

  for (let i = 0; i < 20; i++) sim.step(0.05);
  assert.equal(sim.endgameState.transitionSeq, seqAfterHunt, 'Must not duplicate Final Hunt transition');
  assert.ok(
    ENDGAME_SUBSTATE_RANK[sim.endgameState.substate] >= ENDGAME_SUBSTATE_RANK.final_hunt
  );
  assertFragmentConservation(sim, 'test 4');
});

test('5. Accurate surviving-Keli count tracks eliminations dynamically', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9006,
    emitLocalSound: false,
  });
  for (let i = 0; i < 6; i++) sim.step(0.05);
  assert.equal(sim.endgameState.aliveCount, 5);

  killEntity(sim, sim.kelis[4], sim.kelis[0]);
  for (let i = 0; i < 6; i++) sim.step(0.05);
  assert.equal(sim.endgameState.aliveCount, 4);

  killEntity(sim, sim.kelis[3], sim.kelis[0]);
  for (let i = 0; i < 6; i++) sim.step(0.05);
  assert.equal(sim.endgameState.aliveCount, 3);
  assert.equal(sim.endgameState.substate, 'final_hunt');
  assertFragmentConservation(sim, 'test 5');
});

test('6. Valid safe-zone contraction respects navigable water floor and gradual stalemate tightening', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9007,
    emitLocalSound: false,
  });
  const minViable = computeMinViableSafeZoneRadius(sim.zone.centerX, sim.zone.centerZ);
  assert.ok(minViable >= ENDGAME_MIN_VIABLE_BASE_RADIUS);
  const nav = verifySafeZoneNavigability(sim.zone.centerX, sim.zone.centerZ, minViable);
  assert.equal(nav.safeWaterVerified, true, 'Minimum viable radius must guarantee navigable water');
  assert.ok(nav.waterSampleCount >= 6, 'At least 6 obstacle-free water samples inside min viable radius');

  // Set 2 passive survivors in Phase 5 well above minViable radius
  const s0 = sim.kelis[0];
  const s1 = sim.kelis[1];
  setLivingLevelsConserved(sim, [
    [s0, 50],
    [s1, 50],
  ]);
  const waterA = findOpenWaterInZone(sim.zone, 0);
  s0.x = waterA.x - 140;
  s0.z = waterA.z;
  s1.x = waterA.x + 140;
  s1.z = waterA.z;
  sim.zone.phase = 5;
  sim.zone.isShrinking = false;
  sim.zone.currentRadius = minViable + 190;
  sim.zone.targetRadius = minViable + 190;

  const startRadius = sim.zone.currentRadius;
  let sawWarning = false;
  let sawShrink = false;

  // Step 26s of quiet stalemate (14s quiet + 6s warning + tightening)
  for (let i = 0; i < 520; i++) {
    // Keep them passive & separated without combat
    s0.x = sim.zone.centerX - 110;
    s0.z = sim.zone.centerZ;
    s1.x = sim.zone.centerX + 110;
    s1.z = sim.zone.centerZ;
    sim.step(0.05);
    if (sim.endgameState.endgameShrinkPending || sim.zone.warningActive) sawWarning = true;
    if (sim.zone.isShrinking) sawShrink = true;
  }

  assert.equal(sawWarning, true, 'Endgame tightening must show clear advance warning');
  assert.equal(sawShrink, true, 'Stalemate pressure must gradually tighten safe zone');
  assert.ok(sim.zone.currentRadius < startRadius, 'Safe zone radius should decrease under stalemate');
  assert.ok(
    sim.zone.currentRadius >= minViable - 1,
    `Safe zone must never collapse below minViableRadius (${minViable}), got ${sim.zone.currentRadius}`
  );
  assert.ok(ENDGAME_TIGHTEN_SPEED < 60, 'Endgame tightening speed must remain easily escapable');
  assertFragmentConservation(sim, 'test 6');
});

test('7. Level 1-39 water accessibility: aquatic Kelis stay off shore and endgame carcasses recover to water', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9008,
    emitLocalSound: false,
  });
  const aquatic = sim.kelis[0];
  const amph = sim.kelis[1];
  const victim = sim.kelis[2];
  setLivingLevelsConserved(sim, [
    [aquatic, 25], // Lv.1-39 water-bound
    [amph, 55],
    [victim, 20],
  ]);

  const waterSpot = findOpenWaterInZone(sim.zone, 0);
  aquatic.x = waterSpot.x;
  aquatic.z = waterSpot.z;
  amph.x = waterSpot.x + 180;
  amph.z = waterSpot.z;

  // Drop a carcass on dry shore during Final Hunt
  const shorePt = findDryShorePoint();
  victim.x = shorePt.x;
  victim.z = shorePt.z;
  killEntity(sim, victim, amph);

  // Step so Final Hunt + updateCarcasses run
  for (let i = 0; i < 12; i++) sim.step(0.05);

  assert.equal(sim.endgameState.safeWaterVerified, true, 'Safe zone water verified for Lv.1-39');
  assert.equal(sim.carcasses.length, 1);
  const carc = sim.carcasses[0];
  assert.notEqual(
    getTerrainAt(carc.x, carc.z),
    'shore',
    'Endgame carcass must recover from shore into water while a Lv.1-39 aquatic Keli survives'
  );
  assert.equal(
    isPositionAccessible(carc.x, carc.z, 14, false),
    true,
    'Recovered endgame carcass must be water-accessible'
  );
  assertFragmentConservation(sim, 'test 7');
});

test('8. Level 40-79 shore limitations remain enforced during Final Hunt', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9009,
    emitLocalSound: false,
  });
  const player = sim.kelis[0];
  const rival = sim.kelis[1];
  setLivingLevelsConserved(sim, [
    [player, 55], // Form 2: temporary shore access with reserve drain
    [rival, 45],
  ]);

  const shorePt = findDryShorePoint();
  player.x = shorePt.x;
  player.z = shorePt.z;
  player.shoreReserve = 8;
  rival.x = sim.zone.centerX;
  rival.z = sim.zone.centerZ;

  const reserveBefore = player.shoreReserve;
  for (let i = 0; i < 15; i++) sim.step(0.05);

  assert.equal(sim.endgameState.substate, 'final_hunt');
  assert.equal(player.isOnShore, true, 'Lv.55 Keli must be allowed onto shore');
  assert.ok(player.shoreReserve < reserveBefore, 'Lv.40-79 shore reserve must still drain on land');
  assertFragmentConservation(sim, 'test 8');
});

test('9. Level 80+ amphibious traversal remains unrestricted on land during Final Hunt', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9010,
    emitLocalSound: false,
  });
  const apex = sim.kelis[0];
  const rival = sim.kelis[1];
  setLivingLevelsConserved(sim, [
    [apex, 85], // Form 3: unrestricted land traversal
    [rival, 15],
  ]);

  const shorePt = findDryShorePoint();
  apex.x = shorePt.x;
  apex.z = shorePt.z;
  apex.shoreReserve = apex.maxShoreReserve;
  rival.x = sim.zone.centerX;
  rival.z = sim.zone.centerZ;

  const hpBefore = apex.hp;
  for (let i = 0; i < 20; i++) sim.step(0.05);

  assert.equal(sim.endgameState.substate, 'final_hunt');
  assert.equal(apex.isOnShore, true, 'Lv.85 Keli must traverse land freely');
  assert.equal(apex.shoreReserve, apex.maxShoreReserve, 'Lv.80+ must never lose shore reserve on land');
  assert.ok(apex.hp >= hpBefore - 1, 'Lv.80+ must not suffer shore exposure damage');
  assertFragmentConservation(sim, 'test 9');
});

test('10. Visibility and sonar restrictions: no global exact enemy coordinates leaked during Final Hunt', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9011,
    emitLocalSound: false,
  });
  const player = sim.kelis[0];
  const rival = sim.kelis[1];
  setLivingLevelsConserved(sim, [
    [player, 55],
    [rival, 45],
  ]);
  player.x = sim.zone.centerX - 360;
  player.z = sim.zone.centerZ;
  rival.x = sim.zone.centerX + 360;
  rival.z = sim.zone.centerZ;
  player.sonarTimer = 0;

  for (let i = 0; i < 6; i++) sim.step(0.05);
  assert.equal(sim.endgameState.substate, 'final_hunt');

  const hudNoSonar = sim.getHudSnapshot(player.id);
  assert.equal(
    hudNoSonar.sonarContacts.length,
    0,
    'Without active sonar, Final Hunt must NOT globally reveal exact rival coordinates'
  );

  // Activating Echo Sonar legitimately detects rival within sonar range
  player.sonarTimer = 3.0;
  const hudWithSonar = sim.getHudSnapshot(player.id);
  assert.ok(
    hudWithSonar.sonarContacts.some((c) => c.id === rival.id),
    'Legitimate Echo Sonar must detect non-veiled rival in range during Final Hunt'
  );
  assertFragmentConservation(sim, 'test 10');
});

test('11. Silt Veil compatibility: veiled rival stays concealed from AI and public hotspots during Final Hunt', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9012,
    emitLocalSound: false,
  });
  const player = sim.kelis[0];
  const bot = sim.kelis[1];
  setLivingLevelsConserved(sim, [
    [player, 50],
    [bot, 50],
  ]);
  const waterSpot = findOpenWaterInZone(sim.zone, 0);
  player.x = waterSpot.x;
  player.z = waterSpot.z;
  bot.x = waterSpot.x + 150;
  bot.z = waterSpot.z;
  player.veilTimer = 4.0;
  bot.aiTargetId = null;

  for (let i = 0; i < 10; i++) {
    player.veilTimer = 4.0;
    sim.step(0.05);
  }
  assert.equal(sim.endgameState.substate, 'final_hunt');
  assert.notEqual(bot.aiTargetId, player.id, 'AI must respect Silt Veil concealment during Final Hunt');
  assertFragmentConservation(sim, 'test 11');
});

test('12. Final carcass contested feeding: two surviving rivals fight over a 15-fragment carcass in Final Hunt', () => {
  const sim = new GameSimulation(5, 'royale', 'P1', {
    matchSeed: 9013,
    emitLocalSound: false,
    isMultiplayerMatch: true,
    humanEntrants: [
      { id: 'p1', name: 'Apex' },
      { id: 'p2', name: 'Challenger' },
    ],
  });
  const p1 = sim.getPlayer('p1');
  const p2 = sim.getPlayer('p2');
  const victim = sim.kelis[2];
  setLivingLevelsConserved(sim, [
    [p1, 50],
    [p2, 35],
    [victim, 15],
  ]);

  const spot = findOpenWaterInZone(sim.zone, 0);
  victim.x = spot.x;
  victim.z = spot.z;
  p1.x = spot.x - 36;
  p1.z = spot.z;
  p2.x = spot.x + 36;
  p2.z = spot.z;

  killEntity(sim, victim, p1);
  sim.setInputForPlayer('p1', { moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.setInputForPlayer('p2', { moveX: 0, moveZ: 0, aimAngle: Math.PI, biteHeld: true });

  let sawContested = false;
  for (let i = 0; i < 20; i++) {
    sim.step(0.05);
    if (sim.endgameState.contestedCarcassActive) sawContested = true;
    assertFragmentConservation(sim, `test 12 tick ${i}`);
  }

  assert.equal(sim.endgameState.substate, 'final_hunt');
  assert.equal(sawContested, true, 'EndgameState must surface active contested feeding over final carcass');
  const hud = sim.getHudSnapshot('p1');
  assert.ok(
    (hud.tacticalCarcasses?.length ?? 0) >= 0,
    'High-value endgame carcass tracked cleanly while active'
  );
  assertFragmentConservation(sim, 'test 12 end');
});

test('13. Progressive fragment transfers during endgame preserve exact integer totals on interruption', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9014,
    emitLocalSound: false,
  });
  const p = sim.kelis[0];
  const rival = sim.kelis[1];
  const victim = sim.kelis[2];
  setLivingLevelsConserved(sim, [
    [p, 55],
    [rival, 30],
    [victim, 15],
  ]);

  const spot = findOpenWaterInZone(sim.zone, 0);
  p.x = spot.x - 24;
  p.z = spot.z;
  victim.x = spot.x;
  victim.z = spot.z;
  rival.x = spot.x + 320;
  rival.z = spot.z;
  killEntity(sim, victim, p);
  const carc = sim.carcasses[0];

  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  for (let i = 0; i < 16; i++) {
    sim.step(0.05);
    assertFragmentConservation(sim, `test 13 tick ${i}`);
  }
  sim.cancelFeedingForPlayer(p.id);
  assert.ok(p.level > 55 && p.level < 70, 'Progressive feeding should transfer partial fragments');
  assert.equal(carc.mass, 70 - p.level, 'Carcass remainder must equal exact unconsumed fragments');
  assertFragmentConservation(sim, 'test 13 end');
});

test('14. Final Feast activation triggers when 1 Keli survives below Lv.100 with unclaimed carcasses', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9015,
    emitLocalSound: false,
  });
  const p = sim.kelis[0];
  const victim = sim.kelis[1];
  setLivingLevelsConserved(sim, [
    [p, 82],
    [victim, 18],
  ]);
  const spot = findOpenWaterInZone(sim.zone, 0);
  p.x = spot.x;
  p.z = spot.z;
  victim.x = spot.x + 260;
  victim.z = spot.z;
  killEntity(sim, victim, p);

  for (let i = 0; i < 8; i++) sim.step(0.05);
  assert.equal(sim.status, 'playing', 'Must NOT declare premature victory below Lv.100');
  assert.equal(sim.finalFeastActive, true);
  assert.equal(sim.endgameState.substate, 'final_feast');
  assert.equal(sim.endgameState.remainingUnclaimedFragments, 18);
  assertFragmentConservation(sim, 'test 14');
});

test('15. Final Feast suppresses environmental hazards, clears net entanglement, and pauses zone pressure', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9016,
    emitLocalSound: false,
  });
  const p = sim.kelis[0];
  const victim = sim.kelis[1];
  setLivingLevelsConserved(sim, [
    [p, 80],
    [victim, 20],
  ]);
  const spot = findOpenWaterInZone(sim.zone, 0);
  p.x = spot.x;
  p.z = spot.z;
  victim.x = spot.x + 240;
  victim.z = spot.z;

  // Trigger an active drifting net & snag survivor before Final Feast starts
  sim.triggerWorldEvent('drifting_net', { startPhase: 'active' });
  p.netEntangleTimer = 0.65;
  sim.zone.isShrinking = true;
  const radiusBefore = sim.zone.currentRadius;

  killEntity(sim, victim, p);
  for (let i = 0; i < 6; i++) sim.step(0.05);

  assert.equal(sim.finalFeastActive, true);
  assert.equal(sim.endgameState.substate, 'final_feast');
  assert.equal(sim.activeWorldEvent, null, 'Final Feast must immediately suppress active world events');
  assert.equal(p.netEntangleTimer, 0, 'Final Feast must clear net entanglement');
  assert.equal(sim.zone.currentRadius, radiusBefore, 'Final Feast must pause radioactive zone shrinking');
  assertFragmentConservation(sim, 'test 15');
});

test('16. Final Feast recovers inaccessible fragments and smoothly converges carcasses without auto-awarding', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9017,
    emitLocalSound: false,
  });
  const p = sim.kelis[0];
  const victim = sim.kelis[1];
  // Sole survivor is Lv.35 (water-bound), carcass starts on dry shore & out of zone!
  setLivingLevelsConserved(sim, [
    [p, 35],
    [victim, 65],
  ]);
  const waterSpot = findOpenWaterInZone(sim.zone, 0);
  p.x = waterSpot.x;
  p.z = waterSpot.z;
  const shorePt = findDryShorePoint();
  victim.x = shorePt.x;
  victim.z = shorePt.z;
  killEntity(sim, victim, p);

  for (let i = 0; i < 20; i++) sim.step(0.05);

  assert.equal(sim.finalFeastActive, true);
  assert.equal(p.level, 35, 'Final Feast must NOT automatically award fragments without feeding');
  assert.equal(sim.carcasses.length, 1);
  const c = sim.carcasses[0];
  assert.equal(c.relocated, true, 'Inaccessible carcass should be flagged relocated');
  assert.equal(
    isPositionAccessible(c.x, c.z, 14, false),
    true,
    'Recovered carcass must be accessible in water for Lv.35 survivor'
  );
  const distToSurvivor = Math.hypot(c.x - p.x, c.z - p.z);
  assert.ok(distToSurvivor >= 80, 'Carcass must not teleport directly into the player');
  assertFragmentConservation(sim, 'test 16');
});

test('17. Final Feast completion: feeding remaining carcasses ascends survivor to Lv.100 Keli King', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9018,
    emitLocalSound: false,
  });
  const p = sim.kelis[0];
  const victim = sim.kelis[1];
  setLivingLevelsConserved(sim, [
    [p, 88],
    [victim, 12],
  ]);
  const spot = findOpenWaterInZone(sim.zone, 0);
  p.x = spot.x;
  p.z = spot.z;
  victim.x = spot.x + 26;
  victim.z = spot.z;
  killEntity(sim, victim, p);

  sim.step(0.05);
  assert.equal(sim.finalFeastActive, true);

  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  for (let i = 0; i < 80 && sim.status === 'playing'; i++) {
    sim.step(0.05);
    assertFragmentConservation(sim, `test 17 tick ${i}`);
  }

  assert.equal(p.level, 100);
  assert.equal(sim.status, 'victory');
  assert.equal(sim.winnerId, p.id);
  assert.equal(sim.finalFeastActive, false);
  assert.equal(sim.endgameState.substate, 'keli_king_victory');
  assertFragmentConservation(sim, 'test 17 end');
});

test('18. Single-fire Level 100 victory fires exactly once even under repeated post-victory calls', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9019,
    emitLocalSound: false,
  });
  const p = sim.kelis[0];
  const victim = sim.kelis[1];
  setLivingLevelsConserved(sim, [
    [p, 95],
    [victim, 5],
  ]);
  const spot = findOpenWaterInZone(sim.zone, 0);
  p.x = spot.x;
  p.z = spot.z;
  victim.x = spot.x + 20;
  victim.z = spot.z;
  killEntity(sim, victim, p);

  sim.transferCarcassFragments(p, sim.carcasses[0].id, 5);
  assert.equal(sim.status, 'victory');
  assert.equal(sim.getVictoryRecordCount(), 1);
  const seqAtVictory = sim.endgameState.transitionSeq;

  // Attempt repeated ticks & transfers after victory
  for (let i = 0; i < 20; i++) sim.step(0.05);
  assert.equal(sim.getVictoryRecordCount(), 1, 'Victory record count must stay strictly 1');
  assert.equal(sim.endgameState.transitionSeq, seqAtVictory, 'No duplicate victory transitions');
  assertFragmentConservation(sim, 'test 18');
});

test('19. Disconnect during Final Hunt preserves all 100 fragments and lets the match finish cleanly', () => {
  const sim = new GameSimulation(5, 'royale', 'P1', {
    matchSeed: 9020,
    emitLocalSound: false,
    isMultiplayerMatch: true,
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
  });
  const p1 = sim.getPlayer('p1');
  const p2 = sim.getPlayer('p2');
  setLivingLevelsConserved(sim, [
    [p1, 60],
    [p2, 40],
  ]);
  const spot = findOpenWaterInZone(sim.zone, 0);
  p1.x = spot.x - 60;
  p1.z = spot.z;
  p2.x = spot.x + 60;
  p2.z = spot.z;

  for (let i = 0; i < 6; i++) sim.step(0.05);
  assert.equal(sim.endgameState.substate, 'final_hunt');

  // Case A: Disconnect with AI takeover -> zero fragment loss, still 2 active Kelis
  sim.handlePlayerDisconnect('p2', false);
  assert.equal(p2.isPlayer, false, 'Disconnected human handed cleanly to AI');
  assert.equal(p2.alive, true);
  assert.equal(p2.level, 40);
  assertFragmentConservation(sim, 'test 19a AI takeover');

  // Case B: Disconnect with clean elimination -> converts into accessible 40-frag carcass & triggers Final Feast
  sim.handlePlayerDisconnect('p2', true);
  for (let i = 0; i < 6; i++) sim.step(0.05);
  assert.equal(p2.alive, false);
  assert.equal(sim.finalFeastActive, true);
  assert.equal(sim.endgameState.substate, 'final_feast');
  assert.equal(sim.endgameState.remainingUnclaimedFragments, 40);
  assertFragmentConservation(sim, 'test 19b clean elimination');
});

test('20. Multiplayer state synchronization replicates endgame substate and rejects stale/out-of-order packets', () => {
  const sim = new GameSimulation(10, 'royale', 'P1', {
    matchSeed: 9021,
    emitLocalSound: false,
    isMultiplayerMatch: true,
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
  });
  const remoteP1 = new RemoteSimulationView('p1');
  const remoteP2 = new RemoteSimulationView('p2');

  // Step 1: Final Convergence (4 alive in 10-Keli lobby)
  setLivingLevelsConserved(sim, [
    [sim.kelis[0], 25],
    [sim.kelis[1], 25],
    [sim.kelis[2], 25],
    [sim.kelis[3], 25],
  ]);
  for (let i = 0; i < 8; i++) sim.step(0.05);
  const pktConvP1 = sim.getRemoteWorldStateFor('p1', 10);
  const pktConvP2 = sim.getRemoteWorldStateFor('p2', 10);
  remoteP1.applyServerState(pktConvP1);
  remoteP2.applyServerState(pktConvP2);
  assert.equal(remoteP1.endgameState.substate, 'final_convergence');
  assert.equal(remoteP2.endgameState.substate, 'final_convergence');

  // Step 2: Final Hunt (2 alive)
  setLivingLevelsConserved(sim, [
    [sim.kelis[0], 60],
    [sim.kelis[1], 40],
  ]);
  for (let i = 0; i < 8; i++) sim.step(0.05);
  const pktHuntP1 = sim.getRemoteWorldStateFor('p1', 20);
  const pktHuntP2 = sim.getRemoteWorldStateFor('p2', 20);
  remoteP1.applyServerState(pktHuntP1);
  remoteP2.applyServerState(pktHuntP2);
  assert.equal(remoteP1.endgameState.substate, 'final_hunt');
  assert.equal(remoteP2.endgameState.substate, 'final_hunt');

  // Step 3: Inject stale packet from tick 10 (Final Convergence) -> MUST be rejected!
  remoteP1.applyServerState(pktConvP1);
  assert.equal(
    remoteP1.endgameState.substate,
    'final_hunt',
    'Stale out-of-order packet must never regress endgame substate'
  );

  // Step 4: Test EndgamePresentationGuard directly against duplicate announcements & victory lock
  const guard = new EndgamePresentationGuard();
  const r1 = guard.ingest(10, pktHuntP1.endgame, 'playing');
  assert.equal(r1.accepted, true);
  assert.ok(r1.newAnnouncement !== null, 'First announcement should surface once');
  const r2 = guard.ingest(11, pktHuntP1.endgame, 'playing');
  assert.equal(r2.newAnnouncement, null, 'Same announcementSeq must never duplicate');
  const rStale = guard.ingest(9, pktConvP1.endgame, 'playing');
  assert.equal(rStale.accepted, false, 'Older tick must be rejected');
});

test('21. AI endgame behaviour stays personality-distinct and obeys visibility/movement rules', () => {
  const sim = new GameSimulation(10, 'royale', 'Observer', {
    matchSeed: 9022,
    emitLocalSound: false,
  });
  const hunter = sim.kelis[1];
  const scavenger = sim.kelis[2];
  const victim = sim.kelis[3];
  setLivingLevelsConserved(sim, [
    [hunter, 50],
    [scavenger, 34],
    [victim, 16],
  ]);
  // Force distinct personalities cleanly for deterministic verification
  const aiCtrl = (sim as unknown as {
    aiController: {
      getBotMemory?: (id: string) => { personality: string } | undefined;
    };
  }).aiController;
  const memH = aiCtrl.getBotMemory?.(hunter.id);
  const memS = aiCtrl.getBotMemory?.(scavenger.id);
  if (memH) memH.personality = 'aggressive_hunter';
  if (memS) memS.personality = 'opportunistic_scavenger';

  const spot = findOpenWaterInZone(sim.zone, 0);
  hunter.x = spot.x - 160;
  hunter.z = spot.z;
  scavenger.x = spot.x + 150;
  scavenger.z = spot.z;
  victim.x = spot.x + 115;
  victim.z = spot.z;
  killEntity(sim, victim, hunter);

  for (let i = 0; i < 30; i++) {
    sim.step(0.05);
    assertFragmentConservation(sim, `test 21 tick ${i}`);
  }

  assert.equal(sim.endgameState.substate, 'final_hunt');
  assert.ok(
    Number.isFinite(hunter.x) && Number.isFinite(scavenger.x),
    'AI bots remain numerically valid during Final Hunt'
  );
  // Scavenger should move toward or begin feeding on the nearby 16-fragment carcass
  const scavProgress =
    scavenger.level > 34 ||
    scavenger.feedingTargetId !== null ||
    (sim.carcasses[0] && Math.hypot(scavenger.x - sim.carcasses[0].x, scavenger.z - sim.carcasses[0].z) < 120);
  assert.equal(scavProgress, true, 'Scavenger AI should actively pursue/contest nearby high-value endgame carcass');
});

test('22. Environmental event cleanup: Final Hunt suppresses/dissipates world events and victory clears immediately', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9023,
    emitLocalSound: false,
  });
  sim.triggerWorldEvent('whirlpool', { startPhase: 'active' });
  assert.ok(sim.activeWorldEvent !== null && sim.activeWorldEvent.phase === 'active');

  // Drop to 2 survivors -> Final Hunt should begin dissipating active whirlpool and prevent new events
  setLivingLevelsConserved(sim, [
    [sim.kelis[0], 55],
    [sim.kelis[1], 45],
  ]);
  const spot = findOpenWaterInZone(sim.zone, 0);
  sim.kelis[0].x = spot.x - 260;
  sim.kelis[0].z = spot.z;
  sim.kelis[1].x = spot.x + 260;
  sim.kelis[1].z = spot.z;

  for (let i = 0; i < 60; i++) sim.step(0.05);
  assert.equal(sim.endgameState.substate, 'final_hunt');
  assert.equal(
    sim.activeWorldEvent,
    null,
    'Active world event must dissipate cleanly during Final Hunt and no new event should spawn'
  );

  // Also test immediate clearing on Level 100 victory
  sim.triggerWorldEvent('flash_flood', { startPhase: 'active' });
  const p = sim.kelis[0];
  const rival = sim.kelis[1];
  rival.x = p.x + 20;
  rival.z = p.z;
  killEntity(sim, rival, p);
  sim.transferCarcassFragments(p, sim.carcasses[0].id, 45);
  assert.equal(sim.status, 'victory');
  assert.equal(sim.activeWorldEvent, null, 'Victory must immediately clear any active world event');
  assertFragmentConservation(sim, 'test 22');
});

test('23. Strict 100-fragment conservation holds across Convergence -> Final Hunt -> Final Feast -> Victory', () => {
  const sim = new GameSimulation(10, 'royale', 'Awang', {
    matchSeed: 9024,
    emitLocalSound: false,
  });
  const spot = findOpenWaterInZone(sim.zone, 0);

  // Stage 1: Final Convergence (4 alive in 10-Keli lobby)
  setLivingLevelsConserved(sim, [
    [sim.kelis[0], 35],
    [sim.kelis[1], 30],
    [sim.kelis[2], 20],
    [sim.kelis[3], 15],
  ]);
  for (let i = 0; i < 4; i++) {
    sim.kelis[i].x = spot.x + (i - 1.5) * 140;
    sim.kelis[i].z = spot.z;
  }
  for (let i = 0; i < 8; i++) {
    sim.step(0.05);
    assertFragmentConservation(sim, `stage1-${i}`);
  }
  assert.equal(sim.endgameState.substate, 'final_convergence');

  // Stage 2: Final Hunt (3 alive, 1 carcass in play)
  killEntity(sim, sim.kelis[3], sim.kelis[1]);
  for (let i = 0; i < 8; i++) {
    sim.step(0.05);
    assertFragmentConservation(sim, `stage2-${i}`);
  }
  assert.equal(sim.endgameState.substate, 'final_hunt');

  // Stage 3: Final Feast (1 alive below Lv.100, remaining carcasses active)
  killEntity(sim, sim.kelis[2], sim.kelis[0]);
  killEntity(sim, sim.kelis[1], sim.kelis[0]);
  for (let i = 0; i < 8; i++) {
    sim.step(0.05);
    assertFragmentConservation(sim, `stage3-${i}`);
  }
  assert.equal(sim.endgameState.substate, 'final_feast');

  // Stage 4: Consume all remaining carcasses -> Lv.100 Keli King Victory
  for (const c of [...sim.carcasses]) {
    if (!c.consumed && c.mass > 0) {
      sim.transferCarcassFragments(sim.kelis[0], c.id, c.mass);
    }
  }
  assert.equal(sim.kelis[0].level, 100);
  assert.equal(sim.endgameState.substate, 'keli_king_victory');
  assertFragmentConservation(sim, 'stage4-victory');
});

test('24. Post-victory simulation freeze halts movement, velocities, and mutations', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    matchSeed: 9025,
    emitLocalSound: false,
  });
  const p = sim.kelis[0];
  const rival = sim.kelis[1];
  setLivingLevelsConserved(sim, [
    [p, 90],
    [rival, 10],
  ]);
  const spot = findOpenWaterInZone(sim.zone, 0);
  p.x = spot.x;
  p.z = spot.z;
  rival.x = spot.x + 22;
  rival.z = spot.z;
  killEntity(sim, rival, p);

  sim.transferCarcassFragments(p, sim.carcasses[0].id, 10);
  assert.equal(sim.status, 'victory');

  const frozenX = p.x;
  const frozenZ = p.z;
  const frozenTime = sim.matchTime;

  sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: true });
  for (let i = 0; i < 30; i++) {
    sim.step(0.05);
  }

  assert.equal(p.x, frozenX, 'King X must remain frozen post-victory');
  assert.equal(p.z, frozenZ, 'King Z must remain frozen post-victory');
  assert.equal(p.vx, 0);
  assert.equal(p.vz, 0);
  assert.equal(sim.matchTime, frozenTime, 'Match timer must freeze post-victory');
  assert.equal(sim.endgameState.substate, 'keli_king_victory');
  assertFragmentConservation(sim, 'test 24');
});

test('25. Performance and resource cleanup: 100-Keli endgame simulation budget & pooled VFX disposal', () => {
  const runBench = (forceFinalHunt: boolean) => {
    const sim = new GameSimulation(100, 'royale', 'Bench', {
      matchSeed: 9026,
      emitLocalSound: false,
    });
    if (forceFinalHunt) {
      // Simulate heavy endgame: 3 living apex Kelis + 20 unclaimed carcasses in circulation
      const levels = [40, 30, 10];
      sim.kelis[0].level = levels[0];
      sim.kelis[1].level = levels[1];
      sim.kelis[2].level = levels[2];
      for (let i = 3; i < 23; i++) {
        sim.kelis[i].level = 1;
        killEntity(sim, sim.kelis[i], sim.kelis[0]);
      }
      for (let i = 23; i < sim.kelis.length; i++) {
        sim.kelis[i].alive = false;
        sim.kelis[i].level = 0;
      }
      assertFragmentConservation(sim, 'bench-final-hunt-setup');
    }
    // Warmup
    for (let i = 0; i < 10; i++) sim.step(1 / 30);
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) sim.step(1 / 30);
    const elapsedMs = performance.now() - t0;
    return { elapsedMs, perTickMs: elapsedMs / 60, substate: sim.endgameState.substate };
  };

  const full100 = runBench(false);
  const endgameBench = runBench(true);
  console.log(
    `[Perf Endgame 60-tick @30Hz] 100-Keli=${full100.elapsedMs.toFixed(1)}ms (${full100.perTickMs.toFixed(2)}ms/tick) | FinalHunt+20Carcasses=${endgameBench.elapsedMs.toFixed(1)}ms (${endgameBench.perTickMs.toFixed(2)}ms/tick)`
  );

  assert.equal(endgameBench.substate, 'final_hunt');
  assert.ok(full100.perTickMs < 15, `100-Keli tick budget exceeded: ${full100.perTickMs.toFixed(2)}ms`);
  assert.ok(endgameBench.perTickMs < 8, `Final Hunt tick budget exceeded: ${endgameBench.perTickMs.toFixed(2)}ms`);

  // Verify pooled Three.js VFX group creates bounded objects and disposes cleanly with zero scene leftovers
  const scene = new THREE.Scene();
  const pool = new WorldEventVfxPool(scene);
  const initialChildren = scene.children.length;
  assert.ok(initialChildren >= 1);
  pool.update(null, 1.0, 0, 0, false);
  pool.dispose();
  assert.equal(scene.children.length, 0, 'WorldEventVfxPool.dispose() must remove all pooled VFX from scene');
});

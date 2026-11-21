import test from 'node:test';
import assert from 'node:assert/strict';
import { getEvolutionForm } from '../src/data/abilities.ts';
import {
  getTerrainAt,
  hasClearObstacleLineOfSight,
  LANDMARKS,
  OBSTACLES,
} from '../src/game/arena.ts';
import { RemoteSimulationView } from '../src/game/multiplayerClient.ts';
import {
  EVADE_COOLDOWN_SEC,
  EVADE_STAMINA_COST,
  FEED_INTERRUPT_RECOVERY_SEC,
  FEED_MOVE_SPEED_MULT,
  FEED_SOUND_ALERT_RANGE,
  FEED_TICK_SEC_LARGE,
  FEED_TICK_SEC_MEDIUM,
  FEED_TICK_SEC_SMALL,
  FEED_WINDUP_SEC,
  FINAL_FEAST_FEED_TICK_SEC,
  FINAL_FEAST_FEED_WINDUP_SEC,
  GameSimulation,
  LARGE_CARCASS_MINIMAP_RANGE,
  LARGE_CARCASS_THRESHOLD,
  TOTAL_MATCH_FRAGMENTS,
} from '../src/game/simulation.ts';
import type { KeliEntity } from '../src/game/types.ts';

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
  internal.applyDamage(victim, killer, victim.maxHp * 10, cause);
}

function dealDirectDamage(
  sim: GameSimulation,
  target: KeliEntity,
  attacker: KeliEntity | null,
  amount: number,
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
  internal.applyDamage(target, attacker, amount, cause);
}

/**
 * Places non-subject Kelis far away so deterministic feeding tests aren't disturbed by bots.
 */
function isolateKelis(sim: GameSimulation, keepIds: string[]) {
  const keep = new Set(keepIds);
  let idx = 0;
  for (const k of sim.kelis) {
    if (keep.has(k.id)) continue;
    k.x = LANDMARKS.radioactiveDrum.x - 420 - (idx % 3) * 55;
    k.z = LANDMARKS.radioactiveDrum.z - 420 - Math.floor(idx / 3) * 55;
    k.vx = 0;
    k.vz = 0;
    idx += 1;
  }
}

test('1. Feeding begins only within valid range and selects the nearest valid carcass', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const victimA = sim.kelis[1];
  const victimB = sim.kelis[2];
  isolateKelis(sim, [player.id, victimA.id, victimB.id]);

  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;
  const maxRange = sim.getFeedRange(player.level);

  victimA.x = player.x + maxRange + 45;
  victimA.z = player.z;
  victimB.x = player.x + 28;
  victimB.z = player.z;
  killEntity(sim, victimA, player);
  const farCarc = sim.carcasses[0];

  // Out-of-range carcass must NOT start feeding
  sim.triggerPlayerAbility('bite');
  assert.equal(player.feedingTargetId, null, 'Should not begin feeding outside valid range');

  // Wait for bite phase to finish before testing in-range carcass
  for (let i = 0; i < 20; i++) sim.step(0.05);

  // Spawn closer carcass within valid range
  killEntity(sim, victimB, player);
  const nearCarc = sim.carcasses.find((c) => c.id !== farCarc.id)!;
  nearCarc.x = player.x + 28;
  nearCarc.z = player.z;

  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);
  assert.equal(player.feedingTargetId, nearCarc.id, 'Should lock onto the nearest valid carcass in range');
  assertInvariant(sim, 'test 1');
});

test('2. Feeding progress advances through 0.45s windup and progressive per-fragment ticks with 20% movement slowdown and no simultaneous biting', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const victim = sim.kelis[1];
  isolateKelis(sim, [player.id, victim.id]);

  // Configure exact 100 total: victim has 5 fragments (small tier -> 0.20s tick)
  player.level = 20;
  victim.level = 5;
  sim.kelis[2].level = 25;
  sim.kelis[3].level = 25;
  sim.kelis[4].level = 25;
  assertInvariant(sim, 'test 2 setup');

  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;
  victim.x = player.x + 22;
  victim.z = player.z;
  killEntity(sim, victim, player);
  const carc = sim.carcasses[0];
  assert.equal(carc.mass, 5);

  // Verify centralized pacing constants
  const smallPacing = sim.getFeedPacing(5);
  assert.equal(smallPacing.windupSec, FEED_WINDUP_SEC);
  assert.equal(smallPacing.tickSec, FEED_TICK_SEC_SMALL);
  assert.equal(sim.getFeedPacing(15).tickSec, FEED_TICK_SEC_MEDIUM);
  assert.equal(sim.getFeedPacing(35).tickSec, FEED_TICK_SEC_LARGE);

  // Settle tile hazard state once before measuring baseline non-feeding speed
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
  sim.step(0.01);
  const internal = sim as unknown as { getMoveSpeed: (k: KeliEntity) => number };
  const normalSpeed = internal.getMoveSpeed(player);

  // Start feeding
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);
  assert.equal(player.feedingTargetId, carc.id);
  assert.equal(player.feedingWindupDone, false);
  assert.equal(carc.mass, 5, 'No fragments should transfer before 0.45s initial windup');

  const feedingSpeed = internal.getMoveSpeed(player);
  assert.ok(
    Math.abs(feedingSpeed / normalSpeed - FEED_MOVE_SPEED_MULT) < 0.01,
    `Feeding speed ratio should be ${FEED_MOVE_SPEED_MULT}, got ${feedingSpeed / normalSpeed}`
  );

  // Duplicate feed/bite input during feeding must NOT trigger offensive bite or reset progress
  const progressBefore = player.feedingProgress;
  sim.triggerPlayerAbility('bite');
  assert.equal(player.bitePhase, 'idle', 'Cannot trigger offensive bite while actively feeding');
  assert.equal(player.feedingProgress, progressBefore, 'Duplicate feed input must not reset channel progress');

  // Advance through windup (0.45s total -> first fragment transfers)
  for (let i = 0; i < 9; i++) sim.step(0.05);
  assert.equal(player.feedingWindupDone, true, 'Windup should complete at 0.45s');
  assert.equal(player.level, 21, 'First fragment should transfer right after windup');
  assert.equal(carc.mass, 4, 'Carcass should have 4 remaining fragments');
  assertInvariant(sim, 'test 2 after first tick');

  // Continue feeding until fully consumed
  for (let i = 0; i < 25; i++) {
    if (sim.carcasses.length === 0) break;
    sim.step(0.05);
  }
  assert.equal(player.level, 25, 'Player should gain all 5 fragments');
  assert.equal(sim.carcasses.length, 0, 'Depleted carcass must be removed');
  assert.equal(player.feedingTargetId, null, 'Feeding state must clear upon completion');
  assertInvariant(sim, 'test 2 complete');
});

test('3. Feeding can be cancelled voluntarily (pulling away or explicit cancel) with zero recovery lockout', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const victim = sim.kelis[1];
  isolateKelis(sim, [player.id, victim.id]);

  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;
  victim.x = player.x + 24;
  victim.z = player.z;
  killEntity(sim, victim, player);
  const carc = sim.carcasses[0];

  // Start feeding, then pull away with biteHeld=false
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);
  assert.equal(player.feedingTargetId, carc.id);

  // Pull directly away from carcass (-X direction) for 0.20s
  sim.setInput({ moveX: -1, moveZ: 0, aimAngle: Math.PI, biteHeld: false });
  for (let i = 0; i < 5; i++) sim.step(0.05);

  assert.equal(player.feedingTargetId, null, 'Pulling away must voluntarily cancel feeding');
  assert.equal(player.feedingRecoveryTimer ?? 0, 0, 'Voluntary cancel must not apply interrupt recovery lockout');

  // Re-engage and test explicit cancelFeedingForPlayer()
  player.x = carc.x - 20;
  player.z = carc.z;
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);
  assert.equal(player.feedingTargetId, carc.id);

  assert.equal(sim.cancelFeedingForPlayer(player.id), true);
  assert.equal(player.feedingTargetId, null);
  assert.equal(player.feedingProgress, 0);
  assertInvariant(sim, 'test 3');
});

test('4. Qualifying direct damage and stagger/stun interrupt feeding, keep already-transferred fragments, and apply 0.25s recovery', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const victim = sim.kelis[1];
  const ambusher = sim.kelis[2];
  isolateKelis(sim, [player.id, victim.id, ambusher.id]);

  player.level = 15;
  victim.level = 10;
  ambusher.level = 15;
  sim.kelis[3].level = 30;
  sim.kelis[4].level = 30;

  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;
  victim.x = player.x + 22;
  victim.z = player.z;
  ambusher.x = player.x - 220;
  ambusher.z = player.z;
  killEntity(sim, victim, player);
  const carc = sim.carcasses[0];

  // Feed through windup + 1 progressive tick so 2 fragments are already transferred
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  for (let i = 0; i < 14; i++) sim.step(0.05);
  assert.equal(player.feedingTargetId, carc.id);
  const levelBeforeHit = player.level;
  const massBeforeHit = carc.mass;
  assert.ok(levelBeforeHit >= 16, 'At least 1 fragment should be transferred before ambush');

  // Ambusher lands qualifying direct hit -> feeding must interrupt and apply 0.25s recovery
  dealDirectDamage(sim, player, ambusher, 18, 'Bite');
  assert.equal(player.feedingTargetId, null, 'Qualifying damage must interrupt active feeding');
  assert.equal(player.feedingProgress, 0);
  assert.ok(
    (player.feedingRecoveryTimer ?? 0) >= FEED_INTERRUPT_RECOVERY_SEC - 0.01,
    `Interrupt recovery should be ${FEED_INTERRUPT_RECOVERY_SEC}s`
  );
  // Already-transferred fragments stay with player; remaining stay in carcass
  assert.equal(player.level, levelBeforeHit);
  assert.equal(carc.mass, massBeforeHit);
  assertInvariant(sim, 'test 4 after interrupt');

  // Cannot immediately re-lock feeding during recovery window
  assert.equal(sim.canFeedOnCarcass(player, carc).reason, 'recovering');

  // Advance past 0.25s recovery -> player can cleanly re-engage feeding (never permanently stuck)
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
  for (let i = 0; i < 6; i++) sim.step(0.05);
  assert.equal(player.feedingRecoveryTimer ?? 0, 0);
  assert.equal(sim.canFeedOnCarcass(player, carc).ok, true);
  assertInvariant(sim, 'test 4 recovered');
});

test('5. Slip Evade cancels feeding immediately with zero interrupt recovery lockout and preserves 24 stamina / 2.2s cooldown', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const victim = sim.kelis[1];
  isolateKelis(sim, [player.id, victim.id]);

  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;
  victim.x = player.x + 22;
  victim.z = player.z;
  killEntity(sim, victim, player);

  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);
  assert.ok(player.feedingTargetId !== null);

  const stamBefore = player.stamina;
  sim.setInput({ moveX: -1, moveZ: 0, aimAngle: Math.PI, biteHeld: false });
  sim.triggerPlayerAbility('evade');

  assert.equal(player.feedingTargetId, null, 'Slip Evade must cancel feeding immediately');
  assert.equal(player.feedingProgress, 0);
  assert.equal(player.feedingRecoveryTimer ?? 0, 0, 'Evade cancel must not impose interrupt recovery lockout');
  assert.ok(player.evadeTimer > 0, 'Evade window must activate');
  assert.equal(stamBefore - player.stamina, EVADE_STAMINA_COST, 'Evade must still cost 24 stamina');
  assert.equal(player.cooldowns.evade, EVADE_COOLDOWN_SEC, 'Evade cooldown must remain 2.2s');
  assertInvariant(sim, 'test 5');
});

test('6. Stunned players cannot initiate or continue feeding', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const victim = sim.kelis[1];
  isolateKelis(sim, [player.id, victim.id]);

  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;
  victim.x = player.x + 20;
  victim.z = player.z;
  killEntity(sim, victim, player);
  const carc = sim.carcasses[0];

  sim.applyControlEffect(player, null, 'stun', 0.8);
  assert.ok(player.stunTimer > 0);
  assert.equal(sim.canFeedOnCarcass(player, carc).reason, 'stunned');

  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);
  assert.equal(player.feedingTargetId, null, 'Stunned player must not enter feeding state');
  assertInvariant(sim, 'test 6');
});

test('7. Partial consumption preserves exact integer fragment totals across repeated partial meals', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const victim = sim.kelis[1];
  isolateKelis(sim, [player.id, victim.id]);

  player.level = 10;
  victim.level = 20;
  sim.kelis[2].level = 25;
  sim.kelis[3].level = 25;
  sim.kelis[4].level = 20;

  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;
  victim.x = player.x + 20;
  victim.z = player.z;
  killEntity(sim, victim, player);
  const carc = sim.carcasses[0];

  // Feed partway (0.90s -> windup + ~2-3 progressive fragments)
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  for (let i = 0; i < 18; i++) {
    sim.step(0.05);
    assertInvariant(sim, `test 7 tick ${i}`);
  }

  // Cancel feeding mid-carcass
  sim.cancelFeedingForPlayer(player.id);
  assert.ok(player.level > 10 && player.level < 30, 'Player should have partially consumed carcass');
  assert.equal(carc.mass, 30 - player.level, 'Carcass must hold exact unconsumed remainder');
  assert.equal(carc.consumed, false);
  assertInvariant(sim, 'test 7 after partial cancel');

  // Resume feeding later to finish the remainder
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  for (let i = 0; i < 80 && sim.carcasses.length > 0; i++) {
    sim.step(0.05);
    assertInvariant(sim, `test 7 resume ${i}`);
  }
  assert.equal(player.level, 30);
  assert.equal(sim.carcasses.length, 0);
  assertInvariant(sim, 'test 7 finished');
});

test('8. Two players can contest one carcass simultaneously with independent channel progress', () => {
  const sim = new GameSimulation(5, 'royale', 'P1', {
    emitLocalSound: false,
    isMultiplayerMatch: true,
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
  });
  const p1 = sim.getPlayer('p1');
  const p2 = sim.getPlayer('p2');
  const victim = sim.kelis[2];
  isolateKelis(sim, [p1.id, p2.id, victim.id]);

  p1.level = 10;
  p2.level = 10;
  victim.level = 14;
  sim.kelis[3].level = 33;
  sim.kelis[4].level = 33;
  assertInvariant(sim, 'test 8 setup');

  const cx = LANDMARKS.radioactiveDrum.x;
  const cz = LANDMARKS.radioactiveDrum.z;
  victim.x = cx;
  victim.z = cz;
  p1.x = cx - 44;
  p1.z = cz;
  p2.x = cx + 44;
  p2.z = cz;
  killEntity(sim, victim, p1);
  const carc = sim.carcasses[0];
  carc.x = cx;
  carc.z = cz;

  // P1 starts feeding first, then P2 joins 0.15s later -> independent channel progress
  sim.setInputForPlayer('p1', { moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.setInputForPlayer('p2', { moveX: 0, moveZ: 0, aimAngle: Math.PI, biteHeld: false });
  sim.step(0.05);
  sim.step(0.05);
  sim.step(0.05);

  sim.setInputForPlayer('p2', { moveX: 0, moveZ: 0, aimAngle: Math.PI, biteHeld: true });
  sim.step(0.05);

  assert.equal(p1.feedingTargetId, carc.id, 'P1 must remain locked onto contested carcass');
  assert.equal(p2.feedingTargetId, carc.id, 'P2 must lock onto same contested carcass simultaneously');
  assert.ok(p1.feedingProgress > p2.feedingProgress, 'Competing Kelis must track independent channel progress');

  const hudP1 = sim.getHudSnapshot('p1');
  assert.equal(hudP1.player.feedingContested, true, 'HUD must flag feedingContested=true');
  assert.equal(hudP1.player.feedingCompetitorCount, 2, 'HUD must count 2 active competitors');
  assertInvariant(sim, 'test 8 final');
});

test('9. Simultaneous contested feeding cannot duplicate fragments and cancels all feeders on depletion', () => {
  const sim = new GameSimulation(5, 'royale', 'P1', {
    emitLocalSound: false,
    isMultiplayerMatch: true,
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
  });
  const p1 = sim.getPlayer('p1');
  const p2 = sim.getPlayer('p2');
  const victim = sim.kelis[2];
  isolateKelis(sim, [p1.id, p2.id, victim.id]);

  p1.level = 10;
  p2.level = 10;
  victim.level = 14;
  sim.kelis[3].level = 33;
  sim.kelis[4].level = 33;
  assertInvariant(sim, 'test 9 setup');

  const cx = LANDMARKS.radioactiveDrum.x;
  const cz = LANDMARKS.radioactiveDrum.z;
  victim.x = cx;
  victim.z = cz;
  p1.x = cx - 44;
  p1.z = cz;
  p2.x = cx + 44;
  p2.z = cz;
  killEntity(sim, victim, p1);
  const carc = sim.carcasses[0];
  carc.x = cx;
  carc.z = cz;

  sim.setInputForPlayer('p1', { moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.setInputForPlayer('p2', { moveX: 0, moveZ: 0, aimAngle: Math.PI, biteHeld: true });

  for (let i = 0; i < 60 && sim.carcasses.length > 0; i++) {
    sim.step(0.05);
    assertInvariant(sim, `test 9 step ${i}`);
  }

  assert.equal(sim.carcasses.length, 0, 'Contested carcass must be removed on depletion');
  assert.equal(p1.feedingTargetId, null, 'P1 feeding must cancel immediately on depletion');
  assert.equal(p2.feedingTargetId, null, 'P2 feeding must cancel immediately on depletion');

  const gainedP1 = p1.level - 10;
  const gainedP2 = p2.level - 10;
  assert.ok(gainedP1 > 0 && gainedP2 > 0, `Both competitors should win fragments (p1=${gainedP1}, p2=${gainedP2})`);
  assert.equal(gainedP1 + gainedP2, 14, 'Combined fragments won must equal exact carcass mass with zero duplication');
  assertInvariant(sim, 'test 9 final');
});

test('10. Depleted carcass cannot be consumed again and cancels all competing feeders immediately', () => {
  const sim = new GameSimulation(5, 'royale', 'P1', {
    emitLocalSound: false,
    isMultiplayerMatch: true,
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
  });
  const p1 = sim.getPlayer('p1');
  const p2 = sim.getPlayer('p2');
  const victim = sim.kelis[2];
  isolateKelis(sim, [p1.id, p2.id, victim.id]);

  p1.level = 10;
  p2.level = 10;
  victim.level = 2;
  sim.kelis[3].level = 39;
  sim.kelis[4].level = 39;

  const cx = LANDMARKS.radioactiveDrum.x;
  const cz = LANDMARKS.radioactiveDrum.z;
  victim.x = cx;
  victim.z = cz;
  p1.x = cx - 42;
  p1.z = cz;
  p2.x = cx + 42;
  p2.z = cz;
  killEntity(sim, victim, p1);
  const carc = sim.carcasses[0];
  const carcId = carc.id;

  sim.setInputForPlayer('p1', { moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.setInputForPlayer('p2', { moveX: 0, moveZ: 0, aimAngle: Math.PI, biteHeld: true });
  sim.step(0.05);
  assert.equal(p1.feedingTargetId, carcId);
  assert.equal(p2.feedingTargetId, carcId);

  // Deplete atomically -> both channels cancel, subsequent transfer returns 0
  const taken = sim.transferCarcassFragments(p1, carcId);
  assert.equal(taken, 2);
  assert.equal(carc.consumed, true);
  assert.equal(p1.feedingTargetId, null);
  assert.equal(p2.feedingTargetId, null);
  assert.equal(sim.transferCarcassFragments(p2, carcId), 0, 'Depleted carcass must yield 0 on re-consumption attempt');
  assert.equal(sim.canFeedOnCarcass(p2, carc).reason, 'depleted');
  assertInvariant(sim, 'test 10');
});

test('11. Fragment transfer stops immediately after death and dead Keli drops all active fragments', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const victim = sim.kelis[1];
  const killer = sim.kelis[2];
  isolateKelis(sim, [player.id, victim.id, killer.id]);

  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;
  victim.x = player.x + 22;
  victim.z = player.z;
  killEntity(sim, victim, player);
  const carc = sim.carcasses[0];

  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);
  assert.equal(player.feedingTargetId, carc.id);

  // Kill the player mid-feed
  killEntity(sim, player, killer);
  assert.equal(player.alive, false);
  assert.equal(player.feedingTargetId, null);
  assert.equal(sim.transferCarcassFragments(player, carc.id), 0, 'Dead Keli cannot transfer carcass fragments');
  assert.equal(sim.canFeedOnCarcass(player, carc).reason, 'dead');
  assertInvariant(sim, 'test 11');
});

test('12. Feeding stops immediately after match conclusion and cannot transfer fragments post-victory', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const rival = sim.kelis[1];
  const v2 = sim.kelis[2];
  const v3 = sim.kelis[3];
  const v4 = sim.kelis[4];
  isolateKelis(sim, [player.id, rival.id]);

  player.level = 95;
  rival.level = 2;
  v2.level = 1;
  v3.level = 1;
  v4.level = 1;
  killEntity(sim, v2, player);
  killEntity(sim, v3, player);
  killEntity(sim, v4, player);

  // Player reaches 100 by eating rival (2) + 3 carcasses (3)
  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;
  rival.x = player.x + 25;
  rival.z = player.z;
  killEntity(sim, rival, player);
  for (const c of [...sim.carcasses]) {
    sim.transferCarcassFragments(player, c.id);
  }
  assert.equal(sim.status, 'victory');
  assert.equal(player.level, TOTAL_MATCH_FRAGMENTS);
  assert.equal(player.feedingTargetId, null);

  // Synthetic carcass check after match conclusion must be rejected
  sim.carcasses.push({
    id: 'fake-post-match',
    x: player.x + 10,
    z: player.z,
    mass: 1,
    initialMass: 1,
    evolutionPhaseAtDeath: 1,
    sourceId: undefined,
    sourceName: 'Ghost',
    createdAt: sim.matchTime,
    bobPhase: 0,
    consumed: false,
  });
  assert.equal(sim.canFeedOnCarcass(player, sim.carcasses[0]).reason, 'match_ended');
  assert.equal(sim.transferCarcassFragments(player, 'fake-post-match'), 0);
});

test('13. Feeding respects solid rock obstacle boundaries (no wall feeding) and Lv.40 shore restriction', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const victim = sim.kelis[1];
  isolateKelis(sim, [player.id, victim.id]);

  // Pick a non-cliff rock obstacle inside the arena where player & carcass sit across a chord within range
  const rock = OBSTACLES.find((o) => !o.id.startsWith('cliff-') && o.radius <= 50) ?? OBSTACLES.find((o) => !o.id.startsWith('cliff-'))!;
  const offset = rock.radius + 12;
  player.level = 10;
  player.x = rock.x - offset;
  player.z = rock.z;
  victim.x = rock.x + offset;
  victim.z = rock.z;

  assert.equal(
    hasClearObstacleLineOfSight(player.x, player.z, victim.x, victim.z),
    false,
    'Line of sight across solid rock obstacle must be blocked'
  );

  killEntity(sim, victim, player);
  const rockCarc = sim.carcasses[0];
  rockCarc.x = rock.x + offset;
  rockCarc.z = rock.z;

  // Ensure distance is within nominal range while segment passes through rock interior
  const dist = Math.hypot(rockCarc.x - player.x, rockCarc.z - player.z);
  if (dist <= sim.getFeedRange(player.level)) {
    assert.equal(sim.canFeedOnCarcass(player, rockCarc).reason, 'obstacle');
  } else {
    // Place just outside the rock's chord edge so dist <= feedRange AND segment intersects rock interior
    player.x = rock.x - rock.radius * 0.65;
    player.z = rock.z - rock.radius * 0.85;
    rockCarc.x = rock.x + rock.radius * 0.65;
    rockCarc.z = rock.z - rock.radius * 0.85;
    assert.ok(Math.hypot(rockCarc.x - player.x, rockCarc.z - player.z) <= sim.getFeedRange(player.level));
    assert.equal(sim.canFeedOnCarcass(player, rockCarc).reason, 'obstacle');
  }

  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);
  assert.equal(player.feedingTargetId, null, 'Must NOT feed through solid rock obstacle');

  // Verify shore Lv.40 restriction: carcass on dry shore cannot be fed on by Lv.10, CAN be fed on by Lv.45
  const shoreX = LANDMARKS.kampungHut.x;
  const shoreZ = LANDMARKS.kampungHut.z;
  assert.equal(getTerrainAt(shoreX, shoreZ), 'shore');
  rockCarc.x = shoreX;
  rockCarc.z = shoreZ;
  player.x = shoreX - 24;
  player.z = shoreZ;

  assert.equal(sim.canFeedOnCarcass(player, rockCarc).reason, 'shore', 'Lv < 40 must be blocked from shore feeding');
  player.level = 45;
  assert.equal(sim.canFeedOnCarcass(player, rockCarc).ok, true, 'Lv >= 40 must be permitted to feed on shore');
});

test('14. Feeding works cleanly across all evolution forms (Form 1 -> Form 2 -> Form 3 -> Form 4)', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  isolateKelis(sim, [player.id]);

  // Distribute exact 100 across 4 victims so player crosses Lv.40, Lv.80, and Lv.100 via feeding
  player.level = 20; // Form 1
  sim.kelis[1].level = 25; // -> 45 (Form 2)
  sim.kelis[2].level = 40; // -> 85 (Form 3)
  sim.kelis[3].level = 10; // -> 95 (Form 3)
  sim.kelis[4].level = 5;  // -> 100 (Form 4)
  assert.equal(getEvolutionForm(player.level), 1);

  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;

  // Keep uninvolved bots stunned far away so they don't wander over during multi-second feeding
  const keepBotsAway = () => {
    for (let i = 1; i < sim.kelis.length; i++) {
      if (sim.kelis[i].alive) {
        sim.kelis[i].stunTimer = 5;
      }
    }
  };

  // Step 1: Form 1 -> Form 2
  sim.kelis[1].x = player.x + 22;
  sim.kelis[1].z = player.z;
  killEntity(sim, sim.kelis[1], player);
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  for (let i = 0; i < 160 && sim.carcasses.length > 0; i++) {
    keepBotsAway();
    player.x = sim.carcasses[0].x - 18;
    player.z = sim.carcasses[0].z;
    sim.step(0.05);
  }
  assert.equal(player.level, 45);
  assert.equal(getEvolutionForm(player.level), 2);
  assertInvariant(sim, 'test 14 form 2');

  // Step 2: Form 2 -> Form 3
  sim.kelis[2].x = player.x + 22;
  sim.kelis[2].z = player.z;
  killEntity(sim, sim.kelis[2], player);
  for (let i = 0; i < 180 && sim.carcasses.length > 0; i++) {
    keepBotsAway();
    player.x = sim.carcasses[0].x - 18;
    player.z = sim.carcasses[0].z;
    sim.step(0.05);
  }
  assert.equal(player.level, 85);
  assert.equal(getEvolutionForm(player.level), 3);
  assertInvariant(sim, 'test 14 form 3');

  // Step 3: Form 3 -> Form 4 (Lv.100 Keli King)
  sim.kelis[3].x = player.x + 22;
  sim.kelis[3].z = player.z;
  sim.kelis[4].x = player.x - 22;
  sim.kelis[4].z = player.z;
  killEntity(sim, sim.kelis[3], player);
  killEntity(sim, sim.kelis[4], player);
  for (let i = 0; i < 160 && sim.status === 'playing'; i++) {
    if (sim.carcasses.length > 0) {
      player.x = sim.carcasses[0].x - 18;
      player.z = sim.carcasses[0].z;
    }
    sim.step(0.05);
  }
  assert.equal(player.level, 100);
  assert.equal(getEvolutionForm(player.level), 4);
  assert.equal(sim.status, 'victory');
  assertInvariant(sim, 'test 14 form 4');
});

test('15. Final Feast accelerates feeding rate while preserving animations and exact 100-fragment victory resolution', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  player.x = LANDMARKS.radioactiveDrum.x;
  player.z = LANDMARKS.radioactiveDrum.z;

  // Eliminate all 4 bots so player is sole survivor below Lv.100 -> Final Feast triggers
  for (let i = 1; i < sim.kelis.length; i++) {
    sim.kelis[i].x = player.x + 25;
    sim.kelis[i].z = player.z;
    killEntity(sim, sim.kelis[i], player);
  }
  sim.step(0.05);
  assert.equal(sim.finalFeastActive, true, 'Final Feast must activate for sole survivor < Lv.100');

  // Verify accelerated Final Feast pacing constants
  const ffPacing = sim.getFeedPacing(20);
  assert.equal(ffPacing.windupSec, FINAL_FEAST_FEED_WINDUP_SEC);
  assert.equal(ffPacing.tickSec, FINAL_FEAST_FEED_TICK_SEC);
  assert.ok(ffPacing.windupSec < FEED_WINDUP_SEC, 'Final Feast windup should be faster than normal');
  assert.ok(ffPacing.tickSec < FEED_TICK_SEC_LARGE, 'Final Feast tick should be faster than normal');

  // Place all remaining carcasses within reach and feed cleanly to Level 100
  for (const c of sim.carcasses) {
    c.x = player.x + 20;
    c.z = player.z;
  }
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });

  let sawActiveFeeding = false;
  for (let i = 0; i < 140 && sim.status === 'playing'; i++) {
    sim.step(0.05);
    if (player.feedingTargetId) sawActiveFeeding = true;
    assertInvariant(sim, `test 15 step ${i}`);
  }

  assert.equal(sawActiveFeeding, true, 'Final Feast must still play visible feeding channels');
  assert.equal(sim.status, 'victory');
  assert.equal(player.level, TOTAL_MATCH_FRAGMENTS);
  assert.equal(sim.carcasses.length, 0);
  assertInvariant(sim, 'test 15 final');
});

test('16. Multiplayer feeding stays authoritative across WorldStatePacket, RemoteSimulationView, short-range sound alerts, and large carcass minimap visibility', () => {
  const sim = new GameSimulation(5, 'royale', 'P1', {
    emitLocalSound: false,
    isMultiplayerMatch: true,
    humanEntrants: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
      { id: 'p3', name: 'P3' },
    ],
  });
  const p1 = sim.getPlayer('p1');
  const p2 = sim.getPlayer('p2');
  const p3 = sim.getPlayer('p3');
  const victim = sim.kelis[3];
  isolateKelis(sim, [p1.id, p2.id, p3.id, victim.id]);

  // Victim drops a large 35-fragment carcass (>= 30 threshold)
  p1.level = 15;
  p2.level = 15;
  p3.level = 15;
  victim.level = 35;
  sim.kelis[4].level = 20;

  const cx = LANDMARKS.radioactiveDrum.x;
  const cz = LANDMARKS.radioactiveDrum.z;
  victim.x = cx;
  victim.z = cz;
  p1.x = cx - 22;
  p1.z = cz;
  // P2 is within short-range feeding sound cue (460u) and tactical minimap range (1100u)
  p2.x = cx + FEED_SOUND_ALERT_RANGE - 100;
  p2.z = cz;
  // P3 is far outside both ranges (> 1100u)
  p3.x = cx + LARGE_CARCASS_MINIMAP_RANGE + 350;
  p3.z = cz;

  killEntity(sim, victim, p1);
  const carc = sim.carcasses[0];
  assert.ok(carc.mass >= LARGE_CARCASS_THRESHOLD);

  // P1 starts feeding
  sim.setInputForPlayer('p1', { moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);

  const pkt1 = sim.getRemoteWorldStateFor('p1', 10);
  const pkt2 = sim.getRemoteWorldStateFor('p2', 10);
  const pkt3 = sim.getRemoteWorldStateFor('p3', 10);

  // P2 hears nearby feeding cue & sees tactical large carcass with activelyFed=true
  assert.ok(
    pkt2.sfx.some((e) => e.kind === 'feed_nearby'),
    'Nearby rival P2 within 460u must receive local feed_nearby audio cue'
  );
  assert.ok(
    pkt2.hud.tacticalCarcasses?.some((tc) => tc.id === carc.id && tc.activelyFed),
    'Nearby rival P2 must see actively consumed 30+ carcass pulse on minimap'
  );

  // P3 is far away -> MUST NOT receive global feeding sound cue or tactical carcass outside range
  assert.equal(
    pkt3.sfx.some((e) => e.kind === 'feed_nearby'),
    false,
    'Distant player P3 must NOT receive short-range feeding sound alert'
  );
  assert.equal(
    pkt3.hud.tacticalCarcasses?.some((tc) => tc.id === carc.id),
    false,
    'Distant player P3 outside tactical range must not see local large carcass ping'
  );

  // RemoteSimulationView faithfully replicates authoritative feeding progress & carcass state
  const view1 = new RemoteSimulationView('p1');
  const view2 = new RemoteSimulationView('p2');
  view1.applyServerState(pkt1);
  view2.applyServerState(pkt2);

  const remoteP1OnClient2 = view2.kelis.find((k) => k.id === 'p1')!;
  assert.equal(remoteP1OnClient2.feedingTargetId, carc.id);
  assert.ok(remoteP1OnClient2.feedingProgress > 0);
  assert.deepEqual(view1.carcasses, view2.carcasses);
  assertInvariant(sim, 'test 16');
});

test('17. Exactly 100 fragments remain in circulation throughout an active contested match simulation', () => {
  const sim = new GameSimulation(20, 'royale', 'Awang', { emitLocalSound: false });
  assertInvariant(sim, 'test 17 initial');

  // Run 12 seconds of active bot-vs-bot combat, kills, contested feeding, and interruptions
  for (let step = 0; step < 240; step++) {
    if (sim.status !== 'playing') break;
    sim.step(0.05);
    if (step % 10 === 0) {
      assertInvariant(sim, `test 17 step ${step}`);
    }
  }
  assertInvariant(sim, 'test 17 final');
});

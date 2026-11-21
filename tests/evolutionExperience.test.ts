import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVOLUTION_MILESTONES,
  getEvolutionForm,
} from '../src/data/abilities.ts';
import {
  getTerrainAt,
  isPositionAccessible,
  resolveArenaCollision,
  WORLD_SIZE,
} from '../src/game/arena.ts';
import {
  computeInitialMilestoneMask,
  evaluateTransformationPhase,
  EVOLUTION_FORM_SPECS,
  EvolutionPresentationGuard,
  getEvolutionProgressInfo,
  getEvolutionVisualProfile,
  resolveEvolutionTransition,
} from '../src/game/evolutionExperience.ts';
import { RemoteSimulationView } from '../src/game/multiplayerClient.ts';
import { GameSimulation, TOTAL_MATCH_FRAGMENTS } from '../src/game/simulation.ts';
import {
  getEvolutionPhaseForLevel,
  getSpriteSheetMeta,
  KELI_KING_SHEET_META,
} from '../src/game/spriteAnimation.ts';
import type { KeliEntity } from '../src/game/types.ts';

function assertFragmentConservation(sim: GameSimulation, label: string) {
  const snap = sim.getHudSnapshot();
  const living = snap.livingMassSum;
  const carcass = snap.carcassMassSum;
  assert.equal(
    living + carcass,
    TOTAL_MATCH_FRAGMENTS,
    `${label}: expected total fragments = 100, got living=${living} + carcass=${carcass}`
  );
  for (const k of sim.kelis) {
    assert.equal(Math.trunc(k.level), k.level, `${label}: non-integer Keli level`);
  }
  for (const c of sim.carcasses) {
    assert.equal(Math.trunc(c.mass), c.mass, `${label}: non-integer carcass mass`);
  }
}

/**
 * Helper to create a clean carcass with conserved mass by transferring from donor bots.
 */
function spawnConservedCarcassNear(
  sim: GameSimulation,
  target: KeliEntity,
  mass: number,
  offsetX = 18,
  protectIds: Set<string> = new Set()
) {
  let remaining = mass;
  const donors = sim.kelis.filter((k) => k.alive && k.id !== target.id && !protectIds.has(k.id));
  for (const donor of donors) {
    if (remaining <= 0) break;
    const take = Math.min(donor.level, remaining);
    donor.level -= take;
    remaining -= take;
    if (donor.level <= 0) {
      donor.alive = false;
      donor.hp = 0;
    }
  }
  assert.equal(remaining, 0, 'Not enough donor mass available');
  const carcass = {
    id: `test_carc_${Math.random().toString(36).slice(2, 8)}`,
    x: target.x + offsetX,
    z: target.z,
    mass,
    initialMass: mass,
    evolutionPhaseAtDeath: (mass >= 80 ? 3 : mass >= 40 ? 2 : 1) as 1 | 2 | 3,
    sourceId: 'donor',
    sourceName: 'Donor Keli',
    createdAt: sim.matchTime,
    bobPhase: 0,
    consumed: false,
  };
  sim.carcasses.push(carcass);
  return carcass;
}

/**
 * Helper to set a Keli to an exact level while strictly conserving total 100 fragments.
 */
function setLevelConserved(
  sim: GameSimulation,
  target: KeliEntity,
  desiredLevel: number,
  protectIds: Set<string> = new Set()
) {
  const delta = desiredLevel - target.level;
  if (delta <= 0) return;
  let need = delta;
  for (const other of sim.kelis) {
    if (!other.alive || other.id === target.id || protectIds.has(other.id) || need <= 0) continue;
    const take = Math.min(other.level, need);
    other.level -= take;
    need -= take;
    if (other.level <= 0) {
      other.alive = false;
      other.hp = 0;
    }
  }
  assert.equal(need, 0, `Could not allocate ${delta} fragments to ${target.id}`);
  target.level = desiredLevel;
  target.highestFormReached = getEvolutionForm(desiredLevel);
  target.unlockedMilestoneMask = computeInitialMilestoneMask(desiredLevel);
}

function findTerrainPoint(terrainKind: 'shore' | 'shallow' | 'deep'): { x: number; z: number } {
  for (let x = 200; x < WORLD_SIZE - 200; x += 60) {
    for (let z = 200; z < WORLD_SIZE - 200; z += 60) {
      if (
        getTerrainAt(x, z) === terrainKind &&
        isPositionAccessible(x, z, 26, terrainKind === 'shore')
      ) {
        return { x, z };
      }
    }
  }
  throw new Error(`Could not find accessible terrain point of kind ${terrainKind}`);
}

// 1. Correct form at Lv.1, 39, 40, 79, 80, 99, 100
test('1. Exact evolution form thresholds at Lv.1, 39, 40, 79, 80, 99, 100', () => {
  assert.equal(getEvolutionForm(1), 1);
  assert.equal(getEvolutionForm(39), 1);
  assert.equal(getEvolutionForm(40), 2);
  assert.equal(getEvolutionForm(79), 2);
  assert.equal(getEvolutionForm(80), 3);
  assert.equal(getEvolutionForm(99), 3);
  assert.equal(getEvolutionForm(100), 4);
});

// 2. Lv.40 triggers exactly one Form 2 transformation
test('2. Reaching Level 40 triggers exactly one Form 2 transformation event', () => {
  const sim = new GameSimulation(20, 'royale', undefined, { matchSeed: 701 });
  const player = sim.getPlayer();
  setLevelConserved(sim, player, 38);
  const carc = spawnConservedCarcassNear(sim, player, 4);

  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, carc.id, 4);

  assert.equal(player.level, 42);
  assert.equal(player.highestFormReached, 2);
  assert.equal(player.evolutionSeq, 1);

  const form2Events = sim
    .getEvolutionEventLog()
    .filter((e) => e.entityId === player.id && e.kind === 'form_2');
  assert.equal(form2Events.length, 1);
  assert.equal(form2Events[0].form, 2);
  assertFragmentConservation(sim, 'Lv.40 trigger');
});

// 3. Lv.80 triggers exactly one Form 3 transformation
test('3. Reaching Level 80 triggers exactly one Form 3 transformation event', () => {
  const sim = new GameSimulation(20, 'royale', undefined, { matchSeed: 702 });
  const player = sim.getPlayer();
  setLevelConserved(sim, player, 78);
  const carc = spawnConservedCarcassNear(sim, player, 5);

  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, carc.id, 5);

  assert.equal(player.level, 83);
  assert.equal(player.highestFormReached, 3);
  assert.equal(player.evolutionSeq, 1);

  const form3Events = sim
    .getEvolutionEventLog()
    .filter((e) => e.entityId === player.id && e.kind === 'form_3');
  assert.equal(form3Events.length, 1);
  assert.equal(form3Events[0].form, 3);
  assertFragmentConservation(sim, 'Lv.80 trigger');
});

// 4. Lv.100 triggers existing victory sequence once
test('4. Reaching Level 100 triggers Keli King victory sequence exactly once', () => {
  const sim = new GameSimulation(10, 'royale', undefined, { matchSeed: 703 });
  const player = sim.getPlayer();
  setLevelConserved(sim, player, 95);
  const carc = spawnConservedCarcassNear(sim, player, 5);

  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, carc.id, 5);

  assert.equal(player.level, 100);
  assert.equal(sim.status, 'victory');
  assert.equal(sim.winnerId, player.id);
  assert.equal(sim.getVictoryRecordCount(), 1);

  const form4Events = sim
    .getEvolutionEventLog()
    .filter((e) => e.entityId === player.id && e.kind === 'form_4');
  assert.equal(form4Events.length, 1);
  assertFragmentConservation(sim, 'Lv.100 victory');
});

// 5. No duplicate evolution events
test('5. Monotonic latch prevents duplicate evolution events for the same threshold', () => {
  const first = resolveEvolutionTransition(39, 41, 1, computeInitialMilestoneMask(39));
  assert.equal(first.majorFormTriggered, 2);
  assert.equal(first.unlockedMilestones.map((m) => m.level).includes(40), true);

  // Re-evaluating at same or higher level within Form 2 never re-triggers Form 2 or Lv.40 unlock
  const second = resolveEvolutionTransition(41, 45, first.newHighestForm, first.newMilestoneMask);
  assert.equal(second.majorFormTriggered, null);
  assert.equal(second.unlockedMilestones.length, 0);
  assert.equal(second.kind, 'minor_level');

  // Even if someone erroneously passes a stale prevLevel=39 against latched mask/highestForm
  const replayAttempt = resolveEvolutionTransition(39, 41, first.newHighestForm, first.newMilestoneMask);
  assert.equal(replayAttempt.majorFormTriggered, null);
  assert.equal(replayAttempt.unlockedMilestones.length, 0);
});

// 6. Progressive feeding across evolution thresholds
test('6. Progressive feeding seamlessly crosses Lv.40 threshold without losing fragments or locking controls', () => {
  const sim = new GameSimulation(20, 'royale', undefined, { matchSeed: 704 });
  const player = sim.getPlayer();
  setLevelConserved(sim, player, 37);
  const carc = spawnConservedCarcassNear(sim, player, 6, 10);

  // Simulate natural progressive feeding ticks
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  for (let i = 0; i < 90 && !carc.consumed; i++) {
    sim.step(1 / 20);
  }

  assert.equal(player.level, 43);
  assert.equal(getEvolutionForm(player.level), 2);
  const form2Count = sim
    .getEvolutionEventLog()
    .filter((e) => e.entityId === player.id && e.kind === 'form_2').length;
  assert.equal(form2Count, 1);
  assertFragmentConservation(sim, 'Progressive feed across Lv.40');
});

// 7. Multiple milestones crossed rapidly
test('7. Rapid multi-milestone jump collapses obsolete lower form and unlocks all crossed milestones once', () => {
  // Single jump Lv.35 -> Lv.85 crosses Form 2 (40) AND Form 3 (80)
  const jump = resolveEvolutionTransition(35, 85, 1, computeInitialMilestoneMask(35));
  assert.equal(jump.majorFormTriggered, 3);
  assert.deepEqual(jump.supersededForms, [2]);
  assert.deepEqual(
    jump.unlockedMilestones.map((m) => m.level),
    [40, 50, 60, 70, 80]
  );

  // Single jump Lv.75 -> Lv.100 immediately supersedes Form 3 with Form 4 Keli King
  const kingJump = resolveEvolutionTransition(75, 100, 2, computeInitialMilestoneMask(75));
  assert.equal(kingJump.majorFormTriggered, 4);
  assert.deepEqual(kingJump.supersededForms, [3]);
  assert.deepEqual(
    kingJump.unlockedMilestones.map((m) => m.level),
    [80, 90, 100]
  );
});

// 8. Correct anatomy / sprite metadata per form (Form 2 has NO legs!)
test('8. Authoritative form anatomy and sprite-sheet metadata match each evolution stage', () => {
  assert.equal(EVOLUTION_FORM_SPECS[1].hasArms, false);
  assert.equal(EVOLUTION_FORM_SPECS[1].hasLegs, false);
  assert.equal(getEvolutionPhaseForLevel(39), 1);
  assert.equal(getSpriteSheetMeta(1).phase, 1);

  // Non-negotiable Form 2 anatomy: two muscular arms + tail, NO legs
  assert.equal(EVOLUTION_FORM_SPECS[2].hasArms, true);
  assert.equal(EVOLUTION_FORM_SPECS[2].hasLegs, false);
  assert.equal(EVOLUTION_FORM_SPECS[2].bannerTitle, 'FIRST REFORMATION — SHORE ACCESS UNLOCKED');
  assert.equal(getEvolutionPhaseForLevel(40), 2);
  assert.equal(getSpriteSheetMeta(2).phase, 2);

  assert.equal(EVOLUTION_FORM_SPECS[3].hasArms, true);
  assert.equal(EVOLUTION_FORM_SPECS[3].hasLegs, true);
  assert.equal(
    EVOLUTION_FORM_SPECS[3].bannerTitle,
    'AMPHIBIOUS ASCENSION — LAND & WATER DOMINION'
  );
  assert.equal(getEvolutionPhaseForLevel(80), 3);
  assert.equal(getSpriteSheetMeta(3).phase, 3);

  assert.equal(EVOLUTION_FORM_SPECS[4].bannerTitle, 'KELI KING');
  assert.equal(EVOLUTION_FORM_SPECS[4].bannerSubtitle, 'ALL 100 FRAGMENTS REUNITED');
  assert.equal(KELI_KING_SHEET_META.cols, 6);
  assert.equal(KELI_KING_SHEET_META.rows, 2);
});

// 9. Evolution during active combat (no invulnerability, no pause, no cooldown/stamina exploit)
test('9. Evolution during active combat never pauses simulation, grants invulnerability, or resets cooldowns', () => {
  const sim = new GameSimulation(20, 'royale', undefined, { matchSeed: 705 });
  const player = sim.getPlayer();
  setLevelConserved(sim, player, 39);
  const attacker = sim.kelis.find((k) => k.alive && k.id !== player.id)!;
  attacker.x = player.x + 20;
  attacker.z = player.z;
  player.cooldowns.evade = 1.9;
  player.stamina = 42;

  const carc = spawnConservedCarcassNear(sim, player, 2, 12);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, carc.id, 2);

  assert.equal(player.level, 41);
  assert.equal(sim.status, 'playing');
  // Cooldowns & stamina must NOT be exploit-reset on evolution
  assert.equal(player.cooldowns.evade, 1.9);
  assert.equal(player.stamina, 42);

  // Player must remain fully damageable immediately after evolving (no transformation invulnerability)
  const hpBeforeHit = player.hp;
  (sim as unknown as {
    applyDamage: (t: KeliEntity, a: KeliEntity | null, d: number, cause: string) => void;
  }).applyDamage(player, attacker, 25, 'Rival Bite');
  assert.ok(player.hp < hpBeforeHit, 'Evolving player must still take normal combat damage');
  assertFragmentConservation(sim, 'Evolution in combat');
});

// 10. Evolution while stunned
test('10. Evolution while stunned updates authoritative form cleanly without cleansing stun', () => {
  const sim = new GameSimulation(20, 'royale', undefined, { matchSeed: 706 });
  const player = sim.getPlayer();
  setLevelConserved(sim, player, 39);
  player.stunTimer = 0.75;

  const carc = spawnConservedCarcassNear(sim, player, 2);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, carc.id, 2);

  assert.equal(player.level, 41);
  assert.equal(getEvolutionForm(player.level), 2);
  assert.equal(player.highestFormReached, 2);
  assert.equal(player.stunTimer, 0.75, 'Evolution must not cleanse active stun');
  assertFragmentConservation(sim, 'Evolution while stunned');
});

// 11. Evolution near shoreline boundaries
test('11. Evolution near shoreline boundary preserves valid collision and arena position', () => {
  const sim = new GameSimulation(20, 'royale', undefined, { matchSeed: 707 });
  const player = sim.getPlayer();
  const shallowPt = findTerrainPoint('shallow');
  player.x = shallowPt.x;
  player.z = shallowPt.z;
  setLevelConserved(sim, player, 39);

  const carc = spawnConservedCarcassNear(sim, player, 2, 10);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, carc.id, 2);

  sim.step(1 / 20);
  assert.ok(Number.isFinite(player.x) && Number.isFinite(player.z));
  const resolved = resolveArenaCollision(player.x, player.z, 26, player.level >= 40);
  assert.ok(isPositionAccessible(resolved.x, resolved.z, 26, true));
  assertFragmentConservation(sim, 'Shoreline evolution');
});

// 12. Correct shore permissions after evolution
test('12. Shore access rules update accurately across Lv.39 (blocked), Lv.40 (10s reserve), and Lv.80 (permanent)', () => {
  const shorePt = findTerrainPoint('shore');
  assert.equal(isPositionAccessible(shorePt.x, shorePt.z, 26, false), false, 'Lv.39 blocked from shore');
  assert.equal(isPositionAccessible(shorePt.x, shorePt.z, 26, true), true, 'Lv.40+ allowed on shore');

  const sim = new GameSimulation(20, 'royale', undefined, { matchSeed: 708 });
  const player = sim.getPlayer();
  setLevelConserved(sim, player, 42);
  player.x = shorePt.x;
  player.z = shorePt.z;
  player.isOnShore = true;
  player.shoreReserve = 10;

  // At Lv.42 (Form 2), staying on shore consumes temporary 10s reserve
  sim.step(0.5);
  assert.ok(player.shoreReserve < 10, 'Form 2 shore reserve should drain on shore');

  // Evolve to Lv.82 (Form 3): permanent land access restores full reserve without exposure drain
  const carc = spawnConservedCarcassNear(sim, player, 40);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, carc.id, 40);
  assert.equal(player.level, 82);
  const reserveAfter = player.shoreReserve;
  sim.step(0.5);
  assert.ok(player.shoreReserve >= reserveAfter, 'Form 3 must have permanent shore access');
  assertFragmentConservation(sim, 'Shore permissions');
});

// 13. Correct ability milestone unlocks & HUD progress never shows Lv.101
test('13. All ability milestones (10..100) unlock cleanly and HUD progress never shows Lv.101', () => {
  assert.deepEqual(
    EVOLUTION_MILESTONES.map((m) => m.level),
    [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
  );

  const p1 = getEvolutionProgressInfo(1);
  assert.equal(p1.currentForm, 1);
  assert.equal(p1.nextEvolutionLevel, 40);
  assert.equal(p1.fragmentsToNextEvolution, 39);
  assert.equal(p1.nextAbilityLevel, 10);

  const p40 = getEvolutionProgressInfo(40);
  assert.equal(p40.currentForm, 2);
  assert.equal(p40.nextEvolutionLevel, 80);
  assert.equal(p40.fragmentsToNextEvolution, 40);

  const p80 = getEvolutionProgressInfo(80);
  assert.equal(p80.currentForm, 3);
  assert.equal(p80.nextEvolutionLevel, 100);
  assert.equal(p80.fragmentsToNextEvolution, 20);

  // At Lv.100 (and even clamped overflow input 105), never show Lv.101!
  const p100 = getEvolutionProgressInfo(100);
  assert.equal(p100.isMaxLevel, true);
  assert.equal(p100.currentLevel, 100);
  assert.equal(p100.nextEvolutionLevel, null);
  assert.equal(p100.nextAbilityLevel, null);
  assert.equal(p100.fragmentsToNextEvolution, 0);

  const pOverflow = getEvolutionProgressInfo(105);
  assert.equal(pOverflow.currentLevel, 100);
  assert.equal(pOverflow.nextEvolutionLevel, null);
});

// 14. No fragment creation or loss across full Lv.1 -> Lv.40 -> Lv.80 -> Lv.100 progression
test('14. Strict integer 100-fragment conservation holds across all three evolution thresholds', () => {
  const sim = new GameSimulation(25, 'royale', undefined, { matchSeed: 709 });
  const player = sim.getPlayer();
  assertFragmentConservation(sim, 'Initial');

  const c1 = spawnConservedCarcassNear(sim, player, 36);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, c1.id, 36);
  assert.equal(player.level, 40);
  assertFragmentConservation(sim, 'After Form 2');

  const c2 = spawnConservedCarcassNear(sim, player, 40);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, c2.id, 40);
  assert.equal(player.level, 80);
  assertFragmentConservation(sim, 'After Form 3');

  const c3 = spawnConservedCarcassNear(sim, player, 20);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, c3.id, 20);
  assert.equal(player.level, 100);
  assertFragmentConservation(sim, 'After Keli King');
});

// 15. Multiplayer form synchronization
test('15. Authoritative multiplayer world state synchronizes form, evolutionSeq, and HUD progress', () => {
  const sim = new GameSimulation(10, 'royale', undefined, { matchSeed: 710 });
  const player = sim.getPlayer();
  const remoteView = new RemoteSimulationView(player.id);

  // Tick 1: Lv.10 initial
  const pkt1 = sim.getRemoteWorldStateFor(player.id, 1);
  remoteView.applyServerState(pkt1);
  assert.equal(remoteView.getPlayer().level, 10);
  assert.equal(getEvolutionForm(remoteView.getPlayer().level), 1);

  // Evolve player to Form 2 (Lv.40) on server
  const carc = spawnConservedCarcassNear(sim, player, 30);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, carc.id, 30);

  const pkt2 = sim.getRemoteWorldStateFor(player.id, 2);
  remoteView.applyServerState(pkt2);
  assert.equal(remoteView.getPlayer().level, 40);
  assert.equal(remoteView.getPlayer().highestFormReached, 2);
  assert.equal(remoteView.getPlayer().evolutionSeq, 1);
  assert.equal(pkt2.hud.evolutionProgress?.currentForm, 2);
  assert.equal(pkt2.hud.evolutionProgress?.nextEvolutionLevel, 80);
  assert.equal(pkt2.sfx.some((s) => s.kind === 'evolution_form_2'), true);
});

// 16. Out-of-order packet resilience
test('16. Out-of-order multiplayer packets never regress form/level or replay transformations', () => {
  const sim = new GameSimulation(10, 'royale', undefined, { matchSeed: 711 });
  const player = sim.getPlayer();
  const remoteView = new RemoteSimulationView(player.id);

  const pktOld = sim.getRemoteWorldStateFor(player.id, 10); // Lv.10

  const carc = spawnConservedCarcassNear(sim, player, 30);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, carc.id, 30);
  const pktNew = sim.getRemoteWorldStateFor(player.id, 20); // Lv.40

  // Apply newer packet first, then stale out-of-order packet
  remoteView.applyServerState(pktNew);
  assert.equal(remoteView.getPlayer().level, 40);
  assert.equal(remoteView.getPlayer().highestFormReached, 2);

  remoteView.applyServerState(pktOld);
  assert.equal(remoteView.getPlayer().level, 40, 'Stale packet must not regress level');
  assert.equal(remoteView.getPlayer().highestFormReached, 2, 'Stale packet must not regress form');

  // Guard unit check: dead or post-victory entity never triggers new form presentation
  const guard = new EvolutionPresentationGuard();
  guard.reconcileEntity('e1', 39, 1, 0, true, 'playing');
  const deadRes = guard.reconcileEntity('e1', 42, 2, 1, false, 'playing');
  assert.equal(deadRes.triggeredMajorForm, null);
  assert.equal(deadRes.staleOrBlocked, true);
});

// 17. Bot evolution compatibility
test('17. AI bots evolve cleanly at Lv.40 and Lv.80, emit world VFX, and retain AI personalities', () => {
  const sim = new GameSimulation(20, 'royale', undefined, { matchSeed: 712 });
  const bot = sim.kelis.find((k) => !k.isPlayer && k.alive)!;
  const origPersonality = bot.aiPersonality;

  setLevelConserved(sim, bot, 38);
  const carc1 = spawnConservedCarcassNear(sim, bot, 4);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(bot, carc1.id, 4);

  assert.equal(bot.level, 42);
  assert.equal(bot.highestFormReached, 2);
  assert.equal(bot.aiPersonality, origPersonality);
  assert.ok(
    sim.effects.some((fx) => fx.type === 'evolution_burst' && fx.ownerId === bot.id),
    'Bot Form 2 evolution should emit world evolution_burst VFX'
  );

  // Bot evolves to Form 3 (Lv.80+)
  const carc2 = spawnConservedCarcassNear(sim, bot, 40);
  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(bot, carc2.id, 40);
  assert.equal(bot.level, 82);
  assert.equal(bot.highestFormReached, 3);
  assert.equal(bot.evolutionSeq, 2);
  assertFragmentConservation(sim, 'Bot evolution');
});

// 18. Reduced-motion compatibility
test('18. Reduced-motion profile zeroes camera push-in and shake while dampening particles and light flash', () => {
  const normalProfile = getEvolutionVisualProfile(false);
  const reducedProfile = getEvolutionVisualProfile(true);

  assert.equal(normalProfile.cameraPushScale, 1);
  assert.equal(normalProfile.shakeScale, 1);
  assert.equal(reducedProfile.cameraPushScale, 0);
  assert.equal(reducedProfile.shakeScale, 0);
  assert.ok(reducedProfile.particleScale < normalProfile.particleScale);
  assert.ok(reducedProfile.lightFlashScale < normalProfile.lightFlashScale);

  const normalSample = evaluateTransformationPhase(0.5, 3, false);
  const reducedSample = evaluateTransformationPhase(0.35, 3, true);
  assert.ok(normalSample.cameraZoomDelta < 0);
  assert.ok(normalSample.shakeAmount > 0);
  assert.equal(reducedSample.cameraZoomDelta, 0);
  assert.equal(reducedSample.shakeAmount, 0);
  assert.ok(reducedSample.lightBoost < normalSample.lightBoost);
});

// 19. Simultaneous multi-bot evolution performance (100-Keli match)
test('19. 100-Keli match with simultaneous multi-bot evolutions stays fast and bounded', () => {
  const sim = new GameSimulation(100, 'royale', undefined, { matchSeed: 713 });
  const bots = sim.kelis.filter((k) => !k.isPlayer && k.alive);

  // Trigger 2 simultaneous Form 2 bot evolutions (40 + 40 = 80 fragments, 20 remaining across others)
  const b1 = bots[0];
  const b2 = bots[1];
  const protectedSet = new Set([b1.id, b2.id]);
  setLevelConserved(sim, b1, 39, protectedSet);
  setLevelConserved(sim, b2, 39, protectedSet);
  const c1 = spawnConservedCarcassNear(sim, b1, 2, 18, protectedSet);
  const c2 = spawnConservedCarcassNear(sim, b2, 2, 18, protectedSet);

  const startMs = performance.now();
  const transfer = (
    sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number }
  ).transferCarcassFragments.bind(sim);
  transfer(b1, c1.id, 2);
  transfer(b2, c2.id, 2);

  for (let i = 0; i < 60; i++) {
    sim.step(1 / 20);
  }
  const elapsedMs = performance.now() - startMs;

  assert.equal(b1.highestFormReached, 2);
  assert.equal(b2.highestFormReached, 2);
  assert.ok(sim.effects.length <= 96, `Effects pool exceeded cap: ${sim.effects.length}`);
  assert.ok(elapsedMs < 1500, `100-Keli 60-tick with simultaneous evolutions too slow: ${elapsedMs.toFixed(1)}ms`);
  assertFragmentConservation(sim, 'Simultaneous multi-bot 100-Keli');
});

// 20. No post-victory mutation
test('20. No forms, levels, evolution events, or victory counts mutate after Level 100 victory concludes', () => {
  const sim = new GameSimulation(10, 'royale', undefined, { matchSeed: 714 });
  const player = sim.getPlayer();
  setLevelConserved(sim, player, 95);
  const carc = spawnConservedCarcassNear(sim, player, 5);

  (sim as unknown as { transferCarcassFragments: (e: KeliEntity, id: string, max?: number) => number })
    .transferCarcassFragments(player, carc.id, 5);

  assert.equal(sim.status, 'victory');
  assert.equal(sim.getVictoryRecordCount(), 1);
  const logLenAfterVictory = sim.getEvolutionEventLog().length;
  const seqAfterVictory = player.evolutionSeq;

  // Attempt extra ticks and direct grantFragments post-victory
  for (let i = 0; i < 20; i++) {
    sim.step(1 / 20);
  }
  (sim as unknown as { grantFragments: (e: KeliEntity, amt: number, label: string) => void })
    .grantFragments(player, 10, 'Illegal Post-Victory Grant');

  assert.equal(player.level, 100);
  assert.equal(sim.getVictoryRecordCount(), 1);
  assert.equal(player.evolutionSeq, seqAfterVictory);
  assert.equal(sim.getEvolutionEventLog().length, logLenAfterVictory);
  assertFragmentConservation(sim, 'Post-victory freeze');
});

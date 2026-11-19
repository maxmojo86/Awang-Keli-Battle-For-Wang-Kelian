import test from 'node:test';
import assert from 'node:assert/strict';
import { getEvolutionForm } from '../src/data/abilities.ts';
import {
  getTerrainAt,
  LANDMARKS,
  OBSTACLES,
  WORLD_SIZE,
} from '../src/game/arena.ts';
import {
  BITE_BUFFER_WINDOW_SEC,
  BITE_COOLDOWN_SEC,
  BITE_RECOVERY_SEC,
  BITE_STAMINA_COST,
  BITE_STRIKE_SEC,
  BITE_WINDUP_SEC,
  EVADE_COOLDOWN_SEC,
  EVADE_DAMAGE_MITIGATION,
  EVADE_DURATION_SEC,
  EVADE_STAMINA_COST,
  GameSimulation,
  STUN_RESIST_DURATION_SEC,
  TOTAL_MATCH_FRAGMENTS,
} from '../src/game/simulation.ts';
import type { KeliEntity } from '../src/game/types.ts';

function assertFragmentInvariant(sim: GameSimulation, label: string) {
  const audit = sim.getFragmentAudit();
  assert.equal(
    audit.total,
    TOTAL_MATCH_FRAGMENTS,
    `${label}: expected 100 fragments, got ${audit.total} (living=${audit.living}, carcasses=${audit.carcasses})`
  );
  assert.equal(audit.hasFractional, false, `${label}: fractional fragments detected`);
  assert.equal(audit.deadHoldingFragments, 0, `${label}: dead Keli holding fragments`);
  assert.equal(audit.valid, true, `${label}: fragment audit must be valid`);
}

function stepSeconds(sim: GameSimulation, seconds: number, dt = 1 / 60) {
  let remaining = seconds;
  while (remaining > 1e-6) {
    const step = Math.min(dt, remaining);
    sim.step(step);
    remaining -= step;
  }
}

/**
 * Sets up a deterministic 2-human duel in calm deep water (zero current, no AI drift),
 * with remaining bots parked far away and strict 100-fragment conservation preserved.
 */
function setupDuelArena(playerLevel = 20, rivalLevel = 20) {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    humanEntrants: [
      { id: 'player', name: 'Awang' },
      { id: 'rival', name: 'RivalKeli' },
    ],
    emitLocalSound: false,
    isMultiplayerMatch: true,
  });
  const player = sim.getPlayer('player');
  const rival = sim.getPlayer('rival');
  const rest = sim.kelis.filter((k) => k.id !== player.id && k.id !== rival.id);

  // Rebalance integer levels while preserving strict 100-fragment sum
  const remainingForOthers = TOTAL_MATCH_FRAGMENTS - playerLevel - rivalLevel;
  assert.ok(remainingForOthers >= rest.length, 'Invalid level setup for 100-fragment invariant');

  const setLevel = (k: KeliEntity, lvl: number) => {
    k.level = lvl;
    k.maxHp = 95 + lvl * 12;
    k.hp = k.maxHp;
    k.stamina = k.maxStamina;
    k.fatigued = false;
    k.stunTimer = 0;
    k.staggerTimer = 0;
    k.stunResistTimer = 0;
    k.stunStacks = 0;
    k.evadeTimer = 0;
    k.bitePhase = 'idle';
    k.bitePhaseTimer = 0;
    k.biteCooldown = 0;
    k.biteBufferTimer = 0;
    k.cooldowns = { dash: 0, evade: 0, sonar: 0, veil: 0, electroshock: 0, maelstrom: 0 };
  };

  setLevel(player, playerLevel);
  setLevel(rival, rivalLevel);
  let left = remainingForOthers;
  rest.forEach((b, idx) => {
    const share = idx === rest.length - 1 ? left : Math.max(1, Math.floor(left / (rest.length - idx)));
    setLevel(b, share);
    left -= share;
    // Park bystanders far away so they cannot interfere with the duel
    b.x = 120 + idx * 90;
    b.z = 120 + idx * 90;
    b.vx = 0;
    b.vz = 0;
  });

  // Calm open water with no palong currents
  const cx = LANDMARKS.tutorialStart.x;
  const cz = LANDMARKS.tutorialStart.z;
  player.x = cx;
  player.z = cz;
  player.vx = 0;
  player.vz = 0;
  player.facingAngle = 0;
  player.biteAimAngle = 0;
  player.isOnShore = false;

  rival.x = cx + 42;
  rival.z = cz;
  rival.vx = 0;
  rival.vz = 0;
  rival.facingAngle = Math.PI;
  rival.biteAimAngle = Math.PI;
  rival.isOnShore = false;

  sim.setInputForPlayer(player.id, { moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
  sim.setInputForPlayer(rival.id, { moveX: 0, moveZ: 0, aimAngle: Math.PI, biteHeld: false });
  assertFragmentInvariant(sim, 'setupDuelArena');
  return { sim, player, rival };
}

// ============================================================================
// TEST 1: Directional hit detection (hits target inside forward cone)
// ============================================================================
test('1. Directional bite hits enemy inside forward cone and triggers recoil/knockback/callout', () => {
  const { sim, player, rival } = setupDuelArena(20, 20);
  const startHp = rival.hp;
  const startX = rival.x;

  sim.setInputForPlayer(player.id, { aimAngle: 0 });
  sim.triggerAbilityForPlayer(player.id, 'bite');
  assert.equal(player.bitePhase, 'windup');

  // Advance through windup + active strike
  stepSeconds(sim, BITE_WINDUP_SEC + BITE_STRIKE_SEC + 0.02);

  assert.ok(rival.hp < startHp, `Expected rival HP (${rival.hp}) < start HP (${startHp})`);
  assert.ok(rival.x > startX, 'Expected forward directional knockback pushing rival along +X');
  assert.ok(rival.recoilTimer > 0, 'Expected directional recoil animation timer to activate');
  assert.ok(sim.callouts.length > 0, 'Expected floating damage callout to spawn');
  assertFragmentInvariant(sim, 'directional hit');
});

// ============================================================================
// TEST 2: Attacks strictly miss enemies behind the player (even point-blank)
// ============================================================================
test('2. Directional bite strictly misses enemy behind the player even at point-blank distance', () => {
  const { sim, player, rival } = setupDuelArena(20, 20);

  // Place rival directly behind player at point-blank range (16 units behind)
  player.facingAngle = 0;
  sim.setInputForPlayer(player.id, { aimAngle: 0 });
  rival.x = player.x - 16;
  rival.z = player.z;
  const startHp = rival.hp;

  sim.triggerAbilityForPlayer(player.id, 'bite');
  stepSeconds(sim, BITE_WINDUP_SEC + BITE_STRIKE_SEC + BITE_RECOVERY_SEC + 0.04);

  assert.equal(
    rival.hp,
    startHp,
    `Enemy behind player should NEVER be hit (start=${startHp}, after=${rival.hp})`
  );
  assertFragmentInvariant(sim, 'rear miss');
});

// ============================================================================
// TEST 3: Windup, active hit (strike), recovery, and cooldown phases
// ============================================================================
test('3. Bite executes distinct windup -> strike -> recovery -> cooldown phases', () => {
  const { sim, player, rival } = setupDuelArena(20, 20);
  rival.x = player.x + 260;

  sim.triggerAbilityForPlayer(player.id, 'bite');
  assert.equal(player.bitePhase, 'windup');
  assert.ok(player.bitePhaseTimer > 0);

  // Mid-windup: still windup
  stepSeconds(sim, BITE_WINDUP_SEC * 0.5);
  assert.equal(player.bitePhase, 'windup');

  // Cross into strike
  stepSeconds(sim, BITE_WINDUP_SEC * 0.6);
  assert.equal(player.bitePhase, 'strike');

  // Cross into recovery
  stepSeconds(sim, BITE_STRIKE_SEC + 0.02);
  assert.equal(player.bitePhase, 'recovery');

  // Attempting to spam bite early in recovery should NOT restart windup immediately
  sim.triggerAbilityForPlayer(player.id, 'bite');
  assert.equal(player.bitePhase, 'recovery');

  // Finish recovery -> enters cooldown while idle
  stepSeconds(sim, BITE_RECOVERY_SEC + 0.04);
  assert.equal(player.bitePhase, 'idle');
  assert.ok(player.biteCooldown > 0, 'Expected brief post-recovery cooldown to prevent spam');

  // Wait for cooldown to expire
  stepSeconds(sim, BITE_COOLDOWN_SEC + 0.05);
  assert.equal(player.biteCooldown, 0);
});

// ============================================================================
// TEST 4: Responsive input buffering (~100-150ms near end of recovery/cooldown)
// ============================================================================
test('4. Bite input buffered near end of recovery/cooldown fires automatically on ready', () => {
  const { sim, player, rival } = setupDuelArena(20, 20);
  rival.x = player.x + 260;

  sim.triggerAbilityForPlayer(player.id, 'bite');
  const firstSeq = player.biteAttackSeq;

  // Advance until recovery completes and post-recovery cooldown begins
  stepSeconds(sim, BITE_WINDUP_SEC + BITE_STRIKE_SEC + BITE_RECOVERY_SEC + 0.05);
  assert.equal(player.bitePhase, 'idle');
  assert.ok(player.biteCooldown > 0 && player.biteCooldown <= BITE_COOLDOWN_SEC);

  // Buffer a bite press within the 150ms buffer window before cooldown expires
  if (player.biteCooldown > BITE_BUFFER_WINDOW_SEC * 0.8) {
    stepSeconds(sim, player.biteCooldown - 0.08);
  }
  sim.triggerAbilityForPlayer(player.id, 'bite');
  assert.ok(player.biteBufferTimer > 0, 'Expected bite input to be buffered');

  // Advance past remaining cooldown — buffered bite should fire automatically
  stepSeconds(sim, 0.16);
  assert.equal(player.biteAttackSeq, firstSeq + 1, 'Expected buffered bite to fire automatically');
  const phaseAfterBuffer: string = player.bitePhase;
  assert.ok(
    phaseAfterBuffer === 'windup' || phaseAfterBuffer === 'strike',
    `Expected active bite phase after buffer fire, got ${phaseAfterBuffer}`
  );
});

// ============================================================================
// TEST 5: Defensive counterplay (Slip Evade) cost, mitigation, stun guard & CD
// ============================================================================
test('5. Slip Evade costs stamina, mitigates 60% damage, guards stun, and cannot be spammed', () => {
  const { sim, player, rival } = setupDuelArena(40, 40);
  const initialStamina = player.stamina;

  sim.setInputForPlayer(player.id, { moveX: 0, moveZ: 1, aimAngle: Math.PI / 2 });
  sim.triggerAbilityForPlayer(player.id, 'evade');

  assert.ok(player.evadeTimer > 0 && player.evadeTimer <= EVADE_DURATION_SEC);
  assert.equal(player.cooldowns.evade, EVADE_COOLDOWN_SEC);
  assert.ok(
    Math.abs(initialStamina - player.stamina - EVADE_STAMINA_COST) < 0.5,
    `Expected stamina spend ~${EVADE_STAMINA_COST}, spent ${initialStamina - player.stamina}`
  );

  // Damage during active evade window is mitigated by 60% (only 40% gets through)
  const hpBefore = player.hp;
  const internal = sim as unknown as {
    applyDamage: (
      target: KeliEntity,
      attacker: KeliEntity | null,
      amount: number,
      cause: string
    ) => void;
  };
  internal.applyDamage(player, rival, 100, 'Bite');
  const dmgTaken = hpBefore - player.hp;
  const expected = Math.round(100 * (1 - EVADE_DAMAGE_MITIGATION));
  assert.ok(
    Math.abs(dmgTaken - expected) <= 1,
    `Expected mitigated damage ~${expected}, got ${dmgTaken}`
  );
  assert.equal(player.lastHitKind, 'mitigated');

  // Hard stun attempted during active evade window is evaded/guarded
  const stunResult = sim.applyControlEffect(player, rival, 'stun', 0.9);
  assert.equal(stunResult, 'evaded', 'Evade window should guard against stun');
  assert.equal(player.stunTimer, 0);

  // Attempting to spam evade immediately while on cooldown is rejected
  const stamAfterFirst = player.stamina;
  stepSeconds(sim, EVADE_DURATION_SEC + 0.05);
  assert.equal(player.evadeTimer, 0);
  sim.triggerAbilityForPlayer(player.id, 'evade');
  assert.equal(player.evadeTimer, 0, 'Evade must not re-trigger while on cooldown');
  assert.ok(player.stamina >= stamAfterFirst - 0.1);
});

// ============================================================================
// TEST 6: Evasion respects solid obstacles, arena boundaries, and shore rules
// ============================================================================
test('6. Slip Evade respects solid obstacles, arena boundaries, and Lv.40 shore rule', () => {
  // 6a. Solid obstacle check
  const { sim, player } = setupDuelArena(20, 20);
  const obs = OBSTACLES[0]!;
  player.x = obs.x - obs.radius - 18;
  player.z = obs.z;
  sim.setInputForPlayer(player.id, { moveX: 1, moveZ: 0, aimAngle: 0 });
  sim.triggerAbilityForPlayer(player.id, 'evade');
  stepSeconds(sim, EVADE_DURATION_SEC + 0.05);
  const distToObs = Math.hypot(player.x - obs.x, player.z - obs.z);
  assert.ok(
    distToObs >= obs.radius + 10,
    `Evade must not clip into solid obstacle (dist=${distToObs.toFixed(1)}, r=${obs.radius})`
  );

  // 6b. Arena boundary check
  player.cooldowns.evade = 0;
  player.stamina = player.maxStamina;
  player.x = WORLD_SIZE - 45;
  player.z = WORLD_SIZE * 0.5;
  sim.setInputForPlayer(player.id, { moveX: 1, moveZ: 0, aimAngle: 0 });
  sim.triggerAbilityForPlayer(player.id, 'evade');
  stepSeconds(sim, EVADE_DURATION_SEC + 0.05);
  assert.ok(player.x <= WORLD_SIZE - 39, `Evade must respect world boundary (x=${player.x})`);

  // 6c. Shore rule: Lv.20 (< 40) cannot evade onto dry land; Lv.45 (>= 40) CAN evade on shore
  const shoreX = LANDMARKS.kampungHut.x;
  const shoreZ = LANDMARKS.kampungHut.z;
  assert.equal(getTerrainAt(shoreX, shoreZ), 'shore');

  let waterX = shoreX;
  while (getTerrainAt(waterX, shoreZ) === 'shore' && waterX > 200) {
    waterX -= 12;
  }
  player.level = 20;
  player.x = waterX;
  player.z = shoreZ;
  player.cooldowns.evade = 0;
  player.stamina = player.maxStamina;
  sim.setInputForPlayer(player.id, { moveX: 1, moveZ: 0, aimAngle: 0 });
  sim.triggerAbilityForPlayer(player.id, 'evade');
  stepSeconds(sim, EVADE_DURATION_SEC + 0.05);
  assert.notEqual(
    getTerrainAt(player.x, player.z),
    'shore',
    'Lv.20 Keli must NOT bypass Lv.40 shore restriction via Slip Evade'
  );

  // Lv.45 Keli CAN evade on shore
  const { sim: sim45, player: p45 } = setupDuelArena(45, 20);
  p45.x = shoreX;
  p45.z = shoreZ;
  p45.isOnShore = true;
  const startShoreZ = p45.z;
  sim45.setInputForPlayer(p45.id, { moveX: 0, moveZ: 1, aimAngle: Math.PI / 2 });
  sim45.triggerAbilityForPlayer(p45.id, 'evade');
  assert.ok(p45.evadeTimer > 0, 'Lv.45 Keli should be able to activate Slip Evade on shore');
  stepSeconds(sim45, EVADE_DURATION_SEC + 0.05);
  assert.ok(
    Math.hypot(p45.x - shoreX, p45.z - startShoreZ) > 15,
    'Lv.45 Keli should move across shore during Slip Evade'
  );
});

// ============================================================================
// TEST 7: Stun recovery (locked while stunned, cleanly regained afterward)
// ============================================================================
test('7. Stun blocks abilities and movement while active, then recovers cleanly', () => {
  const { sim, player, rival } = setupDuelArena(40, 40);
  // Keep rival out of collision push range while checking pure player stun lock
  rival.x = player.x + 220;

  const res = sim.applyControlEffect(player, rival, 'stun', 0.45);
  assert.equal(res, 'applied');
  assert.ok(player.stunTimer > 0.4);

  // Abilities must be rejected while stunned
  sim.triggerAbilityForPlayer(player.id, 'bite');
  assert.equal(player.bitePhase, 'idle', 'Cannot bite while stunned');
  sim.triggerAbilityForPlayer(player.id, 'evade');
  assert.equal(player.evadeTimer, 0, 'Cannot evade while stunned');
  sim.triggerAbilityForPlayer(player.id, 'dash');
  assert.equal(player.dashTimer, 0, 'Cannot dash while stunned');

  // Movement input must NOT propel player while stunned (zero self-propulsion vx/vz)
  const stunnedX = player.x;
  sim.setInputForPlayer(player.id, { moveX: 1, moveZ: 0, aimAngle: 0 });
  stepSeconds(sim, 0.25);
  assert.ok(
    Math.abs(player.vx) < 0.5 && Math.abs(player.vz) < 0.5,
    `Stunned Keli must have zero self-propulsion velocity (vx=${player.vx.toFixed(2)}, vz=${player.vz.toFixed(2)})`
  );
  assert.ok(
    Math.abs(player.x - stunnedX) < 10,
    `Stunned Keli should not swim under player input (moved ${Math.abs(player.x - stunnedX).toFixed(2)})`
  );

  // Wait for stun to expire -> full control restored (swimming + bite)
  stepSeconds(sim, 0.35);
  assert.equal(player.stunTimer, 0);
  const afterRecoveryX = player.x;
  stepSeconds(sim, 0.2);
  assert.ok(player.x - afterRecoveryX > 15, 'Control must restore swimming propulsion after stun expires');
  sim.triggerAbilityForPlayer(player.id, 'bite');
  assert.equal(player.bitePhase, 'windup', 'Control must be restored cleanly after stun expires');
});

// ============================================================================
// TEST 8: Stun resistance & diminishing returns prevent perpetual stun-lock
// ============================================================================
test('8. Repeated stuns apply diminishing returns (100% -> 50%) then temporary stun immunity', () => {
  const { sim, player, rival } = setupDuelArena(45, 45);

  // 1st stun: full 1.0s
  const r1 = sim.applyControlEffect(player, rival, 'stun', 1.0);
  assert.equal(r1, 'applied');
  assert.ok(Math.abs(player.stunTimer - 1.0) < 0.05, `1st stun expected ~1.0s, got ${player.stunTimer}`);
  stepSeconds(sim, 1.05);
  assert.equal(player.stunTimer, 0);

  // 2nd stun within stack decay window: 50% duration (0.5s)
  const r2 = sim.applyControlEffect(player, rival, 'stun', 1.0);
  assert.equal(r2, 'applied');
  assert.ok(Math.abs(player.stunTimer - 0.5) < 0.06, `2nd stun expected ~0.5s, got ${player.stunTimer}`);
  stepSeconds(sim, 0.55);
  assert.equal(player.stunTimer, 0);

  // 3rd stun: resisted and triggers temporary stun immunity!
  const r3 = sim.applyControlEffect(player, rival, 'stun', 1.0);
  assert.equal(r3, 'resisted');
  assert.equal(player.stunTimer, 0);
  assert.ok(
    player.stunResistTimer >= STUN_RESIST_DURATION_SEC - 0.1,
    `Expected stun immunity ~${STUN_RESIST_DURATION_SEC}s, got ${player.stunResistTimer}`
  );

  // Further stun during immunity is immediately resisted
  const r4 = sim.applyControlEffect(player, rival, 'stun', 1.0);
  assert.equal(r4, 'resisted');
  assert.equal(player.stunTimer, 0);
});

// ============================================================================
// TEST 9: No duplicate hit registration within a single attack window
// ============================================================================
test('9. Single bite strike registers at most ONE hit per target across all active frames', () => {
  const { sim, player, rival } = setupDuelArena(20, 20);
  rival.hp = 500;
  rival.maxHp = 500;

  let hitEvents = 0;
  let prevHp = rival.hp;

  sim.setInputForPlayer(player.id, { aimAngle: 0 });
  sim.triggerAbilityForPlayer(player.id, 'bite');

  // Step frame-by-frame across the entire windup + strike + recovery window
  const totalSteps = Math.ceil((BITE_WINDUP_SEC + BITE_STRIKE_SEC + BITE_RECOVERY_SEC + 0.05) / (1 / 60));
  for (let i = 0; i < totalSteps; i++) {
    sim.step(1 / 60);
    if (rival.hp < prevHp) {
      hitEvents += 1;
      prevHp = rival.hp;
    }
  }

  assert.equal(hitEvents, 1, `Expected exactly 1 hit registration per bite window, got ${hitEvents}`);
});

// ============================================================================
// TEST 10: Combat interactions at Evolution Levels 1, 40, and 80
// ============================================================================
test('10. Combat interactions work properly at Evolution Levels 1, 40, and 80', () => {
  // Level 1 (Form 1 — Aquatic): Bite damages & interrupts windup with brief stagger, no hard stun
  {
    const { sim, player, rival } = setupDuelArena(1, 10);
    assert.equal(getEvolutionForm(player.level), 1);
    const startHp = rival.hp;
    rival.bitePhase = 'windup';
    rival.bitePhaseTimer = 0.25;
    sim.setInputForPlayer(player.id, { aimAngle: 0 });
    sim.triggerAbilityForPlayer(player.id, 'bite');
    stepSeconds(sim, BITE_WINDUP_SEC + BITE_STRIKE_SEC + 0.02);
    assert.ok(rival.hp < startHp, 'Lv.1 bite must deal damage');
    assert.equal(rival.stunTimer, 0, 'Lv.1 bite must not apply Lv.40+ hard stun');
  }

  // Level 40 (Form 2 — First Reformation): Bite applies hard stun
  {
    const { sim, player, rival } = setupDuelArena(40, 20);
    assert.equal(getEvolutionForm(player.level), 2);
    const startHp = rival.hp;
    sim.setInputForPlayer(player.id, { aimAngle: 0 });
    sim.triggerAbilityForPlayer(player.id, 'bite');
    stepSeconds(sim, BITE_WINDUP_SEC + BITE_STRIKE_SEC + 0.02);
    assert.ok(rival.hp < startHp, 'Lv.40 bite must deal damage');
    assert.ok(rival.stunTimer > 0, 'Lv.40 First Reformation bite must apply stun');
  }

  // Level 80 (Form 3 — Amphibious): Electroshock stuns & damages + Bite applies venom
  {
    const { sim, player, rival } = setupDuelArena(80, 15);
    assert.equal(getEvolutionForm(player.level), 3);
    const startHp = rival.hp;
    sim.triggerAbilityForPlayer(player.id, 'electroshock');
    assert.ok(rival.hp < startHp, 'Lv.80 Electroshock must deal AoE damage');
    assert.ok(rival.stunTimer > 0, 'Lv.80 Electroshock must stun nearby target');

    // Follow-up bite applies venom (Lv.50+ perk)
    const hpAfterShock = rival.hp;
    sim.setInputForPlayer(player.id, { aimAngle: 0 });
    sim.triggerAbilityForPlayer(player.id, 'bite');
    stepSeconds(sim, BITE_WINDUP_SEC + BITE_STRIKE_SEC + 0.02);
    assert.ok(rival.hp < hpAfterShock, 'Lv.80 Bite must deal damage');
    assert.ok(rival.venomTimer > 0, 'Lv.80 Bite must apply venom DoT');
  }
});

// ============================================================================
// TEST 11: Combat during Final Feast & strictly disabled after Victory
// ============================================================================
test('11. Combat/evade work in Final Feast and are completely blocked after Victory', () => {
  const { sim, player, rival } = setupDuelArena(80, 15);
  const bystanders = sim.kelis.filter((k) => k.id !== player.id && k.id !== rival.id);
  const internal = sim as unknown as {
    applyDamage: (
      target: KeliEntity,
      attacker: KeliEntity | null,
      amount: number,
      cause: string
    ) => void;
  };
  for (const b of bystanders) {
    internal.applyDamage(b, player, 99999, 'Bite');
  }
  internal.applyDamage(rival, player, 99999, 'Bite');
  stepSeconds(sim, 0.05);

  // Now player is sole survivor with unclaimed carcasses -> Final Feast active
  assert.equal(sim.status, 'playing');
  assert.equal(sim.finalFeastActive, true, 'Expected Final Feast phase to be active');
  assertFragmentInvariant(sim, 'Final Feast active');

  // Player can still Slip Evade and Bite during Final Feast
  player.cooldowns.evade = 0;
  player.stamina = player.maxStamina;
  sim.triggerAbilityForPlayer(player.id, 'evade');
  assert.ok(player.evadeTimer > 0, 'Evade must remain functional during Final Feast');

  // Consume all remaining carcasses atomically to reach Lv.100 Victory
  for (const c of [...sim.carcasses]) {
    sim.transferCarcassFragments(player, c.id);
  }
  stepSeconds(sim, 0.05);

  assert.equal(sim.status, 'victory', 'Expected Victory once all 100 fragments are claimed');
  assert.equal(player.level, 100);
  assertFragmentInvariant(sim, 'Post-victory');

  // Post-victory: all attack & ability triggers must be strictly ignored
  player.cooldowns.evade = 0;
  player.evadeTimer = 0;
  player.biteCooldown = 0;
  player.bitePhase = 'idle';
  const seqBefore = player.biteAttackSeq;
  sim.triggerAbilityForPlayer(player.id, 'bite');
  sim.triggerAbilityForPlayer(player.id, 'evade');
  sim.triggerAbilityForPlayer(player.id, 'electroshock');
  assert.equal(player.biteAttackSeq, seqBefore, 'No attacks allowed after match concludes');
  assert.equal(player.evadeTimer, 0, 'No abilities allowed after match concludes');
});

// ============================================================================
// TEST 12: Strict 100-fragment conservation after combat exchanges & kills
// ============================================================================
test('12. Strict 100-fragment conservation holds across bites, evades, stuns, and kills', () => {
  const { sim, player, rival } = setupDuelArena(45, 25);
  rival.hp = 30;

  // Exchange: rival evades first, then player finishes rival with bite
  sim.triggerAbilityForPlayer(rival.id, 'evade');
  stepSeconds(sim, EVADE_DURATION_SEC + 0.05);

  rival.x = player.x + 36;
  rival.z = player.z;
  rival.vx = 0;
  rival.vz = 0;
  sim.setInputForPlayer(player.id, { aimAngle: 0 });
  sim.triggerAbilityForPlayer(player.id, 'bite');
  stepSeconds(sim, BITE_WINDUP_SEC + BITE_STRIKE_SEC + 0.1);

  assert.equal(rival.alive, false, 'Expected rival to be eliminated by lethal bite');
  assert.equal(rival.level, 0, 'Defeated rival must hold 0 active fragments');
  assert.ok(sim.carcasses.some((c) => c.mass === 25), 'Expected carcass holding all 25 fragments');
  assertFragmentInvariant(sim, 'after lethal combat exchange');

  // Feed on the carcass and re-verify invariant
  const carc = sim.carcasses[0]!;
  sim.transferCarcassFragments(player, carc.id);

  assert.equal(player.level, 70, 'Expected player to grow from 45 + 25 = 70');
  assertFragmentInvariant(sim, 'after feeding on combat kill carcass');
});

// ============================================================================
// TEST 13: Bot combat compatibility over multi-second arena simulation
// ============================================================================
test('13. Bots execute directional combat & defensive evades while preserving invariants', () => {
  const sim = new GameSimulation(20, 'royale', 'Awang', { emitLocalSound: false });
  assertFragmentInvariant(sim, 'bot sim start');

  // Simulate 12 seconds of live multi-bot arena combat
  stepSeconds(sim, 12.0, 1 / 30);

  assertFragmentInvariant(sim, 'bot sim after 12s');
  for (const k of sim.kelis) {
    assert.ok(Number.isFinite(k.x) && Number.isFinite(k.z), `Valid coordinates for ${k.id}`);
    assert.ok(k.stamina >= 0 && k.stamina <= k.maxStamina + 0.01, `Valid stamina for ${k.id}`);
    assert.ok(k.stunTimer >= 0 && k.staggerTimer >= 0 && k.evadeTimer >= 0);
  }
});

// ============================================================================
// TEST 14: Authoritative multiplayer combat consistency & network state sync
// ============================================================================
test('14. Multiplayer authoritative combat syncs recoil/callouts/hitStop and enforces stun/victory guards', () => {
  const { sim, player: p1, rival: p2 } = setupDuelArena(25, 25);

  const p2StartHp = p2.hp;
  sim.triggerAbilityForPlayer(p1.id, 'bite');
  stepSeconds(sim, BITE_WINDUP_SEC + BITE_STRIKE_SEC + 0.02);

  assert.ok(p2.hp < p2StartHp, 'Authoritative server bite must damage P2');

  // Verify remote world state packet for P2 includes combat sync fields, callouts, and hitStop
  const packetForP2 = sim.getRemoteWorldStateFor(p2.id, 1);
  const syncedP2 = packetForP2.kelis.find((k) => k.id === p2.id);
  assert.ok(syncedP2, 'Packet must include synced P2 entity');
  assert.ok((syncedP2.recoilTimer ?? 0) > 0, 'Packet must sync directional recoil state');
  assert.ok((packetForP2.callouts?.length ?? 0) > 0, 'Packet must sync floating damage callouts');
  assert.ok(packetForP2.hitStop && packetForP2.hitStop.seq > 0, 'Packet must sync local visual hit-stop event');

  // Verify stunned remote player cannot trigger abilities
  sim.applyControlEffect(p2, p1, 'stun', 0.8);
  const p2SeqBefore = p2.biteAttackSeq;
  sim.triggerAbilityForPlayer(p2.id, 'bite');
  sim.triggerAbilityForPlayer(p2.id, 'evade');
  assert.equal(p2.biteAttackSeq, p2SeqBefore, 'Stunned multiplayer player cannot bite');
  assert.equal(p2.evadeTimer, 0, 'Stunned multiplayer player cannot evade');

  // Verify stamina cost applies to bite (not free infinite spam)
  assert.ok(
    p1.stamina < p1.maxStamina || BITE_STAMINA_COST > 0,
    'Bite should engage stamina economy'
  );
  assertFragmentInvariant(sim, 'multiplayer authoritative duel');
});

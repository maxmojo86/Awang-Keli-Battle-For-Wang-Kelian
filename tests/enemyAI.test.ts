import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTerrainAt,
  LANDMARKS,
  OBSTACLES,
  scaleArenaCoord,
} from '../src/game/arena.ts';
import {
  ALL_AI_PERSONALITIES,
  assignBotPersonality,
  computeSteeredAngle,
  DIFFICULTY_PROFILES,
  normalizeAngleDiff,
  scoreTargetDesirability,
} from '../src/game/enemyAI.ts';
import {
  BITE_CONE_HALF_ANGLE,
  EVADE_COOLDOWN_SEC,
  EVADE_STAMINA_COST,
  GameSimulation,
  TOTAL_MATCH_FRAGMENTS,
} from '../src/game/simulation.ts';
import type { CarcassEntity, KeliEntity } from '../src/game/types.ts';

const OPEN_WATER_X = LANDMARKS.radioactiveDrum.x;
const OPEN_WATER_Z = LANDMARKS.radioactiveDrum.z;
const DRY_SHORE_X = LANDMARKS.kampungHut.x;
const DRY_SHORE_Z = LANDMARKS.kampungHut.z;

function parkOthers(sim: GameSimulation, keepIds: string[]) {
  const keep = new Set(keepIds);
  let idx = 0;
  for (const k of sim.kelis) {
    if (keep.has(k.id)) continue;
    k.x = scaleArenaCoord(360 + (idx % 6) * 38);
    k.z = scaleArenaCoord(1520 + Math.floor(idx / 6) * 38);
    k.vx = 0;
    k.vz = 0;
    idx++;
  }
}

function rebalanceLivingFragments(sim: GameSimulation, overrides: Record<string, number>, carcassMass = 0) {
  const used = Object.values(overrides).reduce((a, b) => a + b, 0) + carcassMass;
  const remaining = TOTAL_MATCH_FRAGMENTS - used;
  assert.ok(remaining >= 0, `Fragment budget exceeded: used=${used}`);
  const others = sim.kelis.filter((k) => k.alive && !(k.id in overrides));
  let left = remaining;
  for (let i = 0; i < others.length; i++) {
    const share = i === others.length - 1 ? left : Math.floor(left / (others.length - i));
    others[i].level = share;
    others[i].maxHp = Math.round(90 + share * 6.5);
    others[i].hp = others[i].maxHp;
    left -= share;
  }
  for (const [id, lvl] of Object.entries(overrides)) {
    const k = sim.kelis.find((e) => e.id === id);
    assert.ok(k, `Missing entity ${id}`);
    k.level = lvl;
    k.maxHp = Math.round(90 + lvl * 6.5);
    k.hp = k.maxHp;
  }
}

function addCarcass(
  sim: GameSimulation,
  id: string,
  x: number,
  z: number,
  mass: number,
  initialMass = mass
): CarcassEntity {
  const carc: CarcassEntity = {
    id,
    x,
    z,
    mass,
    initialMass,
    evolutionPhaseAtDeath: mass >= 80 ? 3 : mass >= 40 ? 2 : 1,
    sourceName: 'Test Fallen',
    createdAt: sim.matchTime,
    bobPhase: 0,
    consumed: false,
  };
  sim.carcasses.push(carc);
  return carc;
}

// 1. Deterministic AI personality assignment across match seeds
test('1. Deterministic AI personality assignment produces balanced archetypes and repeats identically per seed', () => {
  const simA = new GameSimulation(20, 'royale', 'Tester', { emitLocalSound: false, matchSeed: 424242 });
  const simB = new GameSimulation(20, 'royale', 'Tester', { emitLocalSound: false, matchSeed: 424242 });

  const botsA = simA.kelis.filter((k) => !k.isPlayer);
  const botsB = simB.kelis.filter((k) => !k.isPlayer);
  assert.equal(botsA.length, botsB.length);

  const seenPersonalities = new Set<string>();
  for (let i = 0; i < botsA.length; i++) {
    assert.ok(botsA[i].aiPersonality, 'Bot must be assigned a personality');
    assert.equal(botsA[i].aiPersonality, botsB[i].aiPersonality, 'Same seed must assign identical personalities');
    assert.equal(botsA[i].aiPersonality, assignBotPersonality(botsA[i].id, i, 424242));
    seenPersonalities.add(botsA[i].aiPersonality!);
  }
  for (const archetype of ALL_AI_PERSONALITIES) {
    assert.ok(seenPersonalities.has(archetype), `Expected archetype ${archetype} in 12-Keli match`);
  }
});

// 2. Target selection by relative threat (Lv.20 vs healthy Lv.80 vs weakened/feeding Lv.80)
test('2. Target selection distinguishes relative threat and vulnerable opportunities', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', { emitLocalSound: false, matchSeed: 101 });
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  const rival = sim.kelis.filter((k) => !k.isPlayer)[1]!;

  bot.level = 20;
  bot.maxHp = Math.round(90 + 20 * 6.5);
  bot.hp = bot.maxHp;
  bot.x = OPEN_WATER_X;
  bot.z = OPEN_WATER_Z;

  rival.level = 80;
  rival.maxHp = Math.round(90 + 80 * 6.5);
  rival.hp = rival.maxHp;
  rival.x = OPEN_WATER_X + 120;
  rival.z = OPEN_WATER_Z;
  rival.feedingTargetId = null;

  const healthyEval = scoreTargetDesirability(bot, rival, 'cautious_survivor', 0, 120);
  assert.equal(healthyEval.isThreat, true, 'Healthy Lv.80 should be recognized as a threat by Lv.20');
  assert.ok(healthyEval.score < 0, `Expected negative desirability against healthy Lv.80, got ${healthyEval.score}`);

  // Critically weakened & distracted (feeding) Lv.80 becomes a calculated opportunity!
  rival.hp = rival.maxHp * 0.18;
  rival.feedingTargetId = 'carc-bait';
  const vulnerableEval = scoreTargetDesirability(bot, rival, 'opportunistic_scavenger', 0, 120);
  assert.equal(vulnerableEval.isVulnerable, true);
  assert.ok(
    vulnerableEval.score > healthyEval.score + 40,
    `Critically weakened feeding Lv.80 (${vulnerableEval.score}) must score dramatically higher than healthy Lv.80 (${healthyEval.score})`
  );
});

// 3. Retreat at low health
test('3. Low-health bot retreats and creates separation from healthy nearby rival', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', { emitLocalSound: false, matchSeed: 303 });
  const player = sim.getPlayer();
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [player.id, bot.id]);
  rebalanceLivingFragments(sim, { [player.id]: 20, [bot.id]: 15 });

  bot.x = OPEN_WATER_X;
  bot.z = OPEN_WATER_Z;
  bot.hp = bot.maxHp * 0.16; // Critical low health
  player.x = OPEN_WATER_X + 110;
  player.z = OPEN_WATER_Z;
  player.hp = player.maxHp;

  const startDist = Math.hypot(player.x - bot.x, player.z - bot.z);
  for (let i = 0; i < 45; i++) {
    sim.step(1 / 30);
  }
  const endDist = Math.hypot(player.x - bot.x, player.z - bot.z);
  assert.equal(bot.aiState, 'RETREAT', `Expected bot to enter RETREAT at low HP, got ${bot.aiState}`);
  assert.ok(endDist > startDist + 40, `Expected retreating bot to widen gap (${startDist} -> ${endDist})`);
});

// 4. Slip Evade against telegraphed enemy bite windups
test('4. Bot reacts to telegraphed enemy bite windup with legitimate Slip Evade (24 stamina, 2.2s CD)', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', {
    emitLocalSound: false,
    matchSeed: 707,
    aiDifficulty: 'hard',
  });
  const player = sim.getPlayer();
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [player.id, bot.id]);
  rebalanceLivingFragments(sim, { [player.id]: 20, [bot.id]: 18 });

  bot.x = OPEN_WATER_X + 74;
  bot.z = OPEN_WATER_Z;
  bot.stamina = bot.maxStamina;
  bot.cooldowns.evade = 0;

  player.x = OPEN_WATER_X;
  player.z = OPEN_WATER_Z;
  player.facingAngle = 0; // Aimed right at bot
  sim.setInput({ aimAngle: 0, moveX: 0, moveZ: 0, biteHeld: false });

  // Trigger a real player bite windup
  sim.triggerPlayerAbility('bite');
  assert.equal(player.bitePhase, 'windup', 'Player bite should enter visible windup phase');

  let evaded = false;
  let staminaAfterEvade = bot.stamina;
  let cdAfterEvade = 0;
  for (let i = 0; i < 12; i++) {
    sim.step(1 / 60);
    if (bot.evadeTimer > 0) {
      evaded = true;
      staminaAfterEvade = bot.stamina;
      cdAfterEvade = bot.cooldowns.evade;
      break;
    }
  }

  assert.equal(evaded, true, 'Hard AI should execute Slip Evade against close telegraphed windup');
  assert.ok(
    staminaAfterEvade <= bot.maxStamina - EVADE_STAMINA_COST + 1,
    `Bot Slip Evade must pay full ${EVADE_STAMINA_COST} stamina cost (got ${staminaAfterEvade}/${bot.maxStamina})`
  );
  assert.ok(
    cdAfterEvade >= EVADE_COOLDOWN_SEC - 0.1,
    `Bot Slip Evade must obey full ${EVADE_COOLDOWN_SEC}s cooldown (got ${cdAfterEvade})`
  );
});

// 5. Directional bite alignment
test('5. Bot rotates facing into forward bite cone before executing directional bite', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', {
    emitLocalSound: false,
    matchSeed: 505,
    aiDifficulty: 'hard',
  });
  const player = sim.getPlayer();
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [player.id, bot.id]);
  rebalanceLivingFragments(sim, { [player.id]: 10, [bot.id]: 18 });

  bot.x = OPEN_WATER_X;
  bot.z = OPEN_WATER_Z;
  bot.facingAngle = Math.PI; // Initially facing completely AWAY from target!
  player.x = OPEN_WATER_X + 58;
  player.z = OPEN_WATER_Z;

  let biteFired = false;
  let angleErrAtBite = Math.PI;
  for (let i = 0; i < 40; i++) {
    sim.step(1 / 30);
    if (bot.bitePhase === 'windup' || bot.bitePhase === 'strike') {
      const targetAng = Math.atan2(player.z - bot.z, player.x - bot.x);
      angleErrAtBite = Math.abs(normalizeAngleDiff(targetAng, bot.facingAngle));
      biteFired = true;
      break;
    }
  }

  assert.equal(biteFired, true, 'Bot should align and bite nearby weaker target');
  assert.ok(
    angleErrAtBite <= BITE_CONE_HALF_ANGLE,
    `Bot must align within forward bite cone (${BITE_CONE_HALF_ANGLE} rad), got error ${angleErrAtBite.toFixed(3)}`
  );
});

// 6. Stamina-aware combat & stun-resistance discipline
test('6. Fatigued bot recovers stamina and Lv.60 bot avoids wasting Electroshock on stun-resistant target', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', {
    emitLocalSound: false,
    matchSeed: 606,
    aiDifficulty: 'hard',
  });
  const player = sim.getPlayer();
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [player.id, bot.id]);
  rebalanceLivingFragments(sim, { [player.id]: 20, [bot.id]: 62 });

  // Part A: Fatigued bot enters RECOVER rather than spamming attacks
  bot.x = OPEN_WATER_X;
  bot.z = OPEN_WATER_Z;
  bot.stamina = 8;
  bot.fatigued = true;
  player.x = OPEN_WATER_X + 140;
  player.z = OPEN_WATER_Z;

  for (let i = 0; i < 15; i++) sim.step(1 / 30);
  assert.equal(bot.aiState, 'RECOVER', `Fatigued bot should choose RECOVER, got ${bot.aiState}`);

  // Part B: Lv.62 bot with full stamina does NOT waste Electroshock while target has stunResistTimer > 0
  bot.stamina = bot.maxStamina;
  bot.fatigued = false;
  bot.cooldowns.electroshock = 0;
  player.x = OPEN_WATER_X + 95;
  player.z = OPEN_WATER_Z;
  player.stunResistTimer = 3.5;

  for (let i = 0; i < 20; i++) {
    player.stunResistTimer = 3.0;
    sim.step(1 / 30);
  }
  assert.equal(
    bot.cooldowns.electroshock,
    0,
    'Lv.60+ bot must not waste Electroshock on a stun-resistant target'
  );
});

// 7. Carcass discovery & value-weighted scavenging
test('7. Bot discovers carcasses and prioritizes high-value 30+ carcass over small 2-fragment carcass', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', { emitLocalSound: false, matchSeed: 777 });
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [bot.id]);
  rebalanceLivingFragments(sim, { [bot.id]: 15 }, 34);

  bot.x = OPEN_WATER_X;
  bot.z = OPEN_WATER_Z;
  addCarcass(sim, 'carc-small', OPEN_WATER_X - 180, OPEN_WATER_Z, 2);
  addCarcass(sim, 'carc-large', OPEN_WATER_X + 200, OPEN_WATER_Z, 32);

  for (let i = 0; i < 25; i++) sim.step(1 / 30);

  assert.equal(
    bot.aiTargetId,
    'carc-large',
    `Expected bot to prioritize 32-fragment carcass over 2-fragment carcass, targeted ${bot.aiTargetId}`
  );
  assert.ok(
    bot.aiState === 'SCAVENGE' || bot.aiState === 'FEED',
    `Expected SCAVENGE or FEED state, got ${bot.aiState}`
  );
});

// 8. Progressive feeding via authoritative transferCarcassFragments()
test('8. Bot feeds progressively on carcass and conserves exact 100 evolution fragments', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', { emitLocalSound: false, matchSeed: 808 });
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [bot.id]);
  rebalanceLivingFragments(sim, { [bot.id]: 10 }, 6);

  bot.x = OPEN_WATER_X;
  bot.z = OPEN_WATER_Z;
  const carc = addCarcass(sim, 'carc-feed', OPEN_WATER_X + 36, OPEN_WATER_Z, 6);

  const startLevel = bot.level;
  let sawMidProgress = false;
  for (let i = 0; i < 90; i++) {
    sim.step(1 / 30);
    if (carc.mass > 0 && carc.mass < 6) sawMidProgress = true;
    const audit = sim.getFragmentAudit();
    assert.equal(audit.valid, true, `Fragment conservation violated during bot feeding: total=${audit.total}`);
  }

  assert.equal(sawMidProgress, true, 'Bot feeding must transfer fragments progressively, not instantaneously');
  assert.equal(bot.level, startLevel + 6, 'Bot should gain all 6 integer fragments');
  assert.equal(carc.consumed, true, 'Depleted carcass must be marked consumed');
});

// 9. Contested feeding & rival feeding interruption
test('9. Bot contests an occupied carcass and interrupts rival feeder', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', {
    emitLocalSound: false,
    matchSeed: 909,
    aiDifficulty: 'hard',
  });
  const player = sim.getPlayer();
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [player.id, bot.id]);
  rebalanceLivingFragments(sim, { [player.id]: 15, [bot.id]: 18 }, 15);

  const carc = addCarcass(sim, 'carc-contested', OPEN_WATER_X, OPEN_WATER_Z, 15);
  player.x = OPEN_WATER_X - 24;
  player.z = OPEN_WATER_Z;
  player.facingAngle = 0;
  sim.setInput({ aimAngle: 0, moveX: 0, moveZ: 0, biteHeld: true });
  sim.triggerPlayerAbility('bite'); // Player locks into feeding on the carcass!
  assert.equal(player.feedingTargetId, carc.id, 'Player must begin feeding on carcass');

  bot.x = OPEN_WATER_X + 105;
  bot.z = OPEN_WATER_Z;

  let contestedStateSeen = false;
  let interrupted = false;
  for (let i = 0; i < 65; i++) {
    sim.step(1 / 30);
    if (bot.aiState === 'CONTEST_CARCASS' || bot.aiState === 'ATTACK') {
      contestedStateSeen = true;
    }
    if (player.feedingTargetId === null && (player.feedingRecoveryTimer ?? 0) > 0) {
      interrupted = true;
      break;
    }
  }

  assert.equal(contestedStateSeen, true, 'Bot should enter CONTEST_CARCASS/ATTACK against rival feeder');
  assert.equal(interrupted, true, 'Contesting bot should interrupt the rival feeding interaction');
});

// 10. Feeding cancellation when threatened & resumption when safe
test('10. Actively feeding bot cancels feed when stronger threat closes in and resumes once safe', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', {
    emitLocalSound: false,
    matchSeed: 1010,
    aiDifficulty: 'normal',
  });
  const player = sim.getPlayer();
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [player.id, bot.id]);
  rebalanceLivingFragments(sim, { [player.id]: 42, [bot.id]: 14 }, 14);

  const carc = addCarcass(sim, 'carc-cancel', OPEN_WATER_X, OPEN_WATER_Z, 14);
  bot.x = OPEN_WATER_X + 26;
  bot.z = OPEN_WATER_Z;
  // Park player far away first so bot safely starts feeding
  player.x = OPEN_WATER_X - 900;
  player.z = OPEN_WATER_Z;

  for (let i = 0; i < 35; i++) {
    sim.step(1 / 30);
    if (bot.feedingTargetId === carc.id) break;
  }
  assert.equal(bot.feedingTargetId, carc.id, 'Bot should start feeding safely when clear');

  // Now move strong Lv.42 threat right next to the feeding bot
  player.x = bot.x + 88;
  player.z = bot.z;
  sim.step(1 / 30);
  sim.step(1 / 30);
  assert.equal(bot.feedingTargetId, null, 'Bot must voluntarily cancel feeding when stronger threat closes in');
  assert.ok(carc.mass > 0 && !carc.consumed, 'Partially consumed carcass should remain for resumption');

  // Move threat far away again — bot should resume feeding on remaining fragments
  player.x = OPEN_WATER_X - 1100;
  player.z = OPEN_WATER_Z;
  let resumed = false;
  for (let i = 0; i < 90; i++) {
    sim.step(1 / 30);
    if (bot.feedingTargetId === carc.id || carc.consumed) {
      resumed = true;
      break;
    }
  }
  assert.equal(resumed, true, 'Bot should return and resume feeding on partially consumed carcass once safe');
});

// 11. Basic obstacle avoidance around OBSTACLES
test('11. Obstacle-aware steering deflects smoothly around blocking rock obstacles', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', { emitLocalSound: false, matchSeed: 1111 });
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  const rock = OBSTACLES.find((o) => o.id === 'lh-1')!;
  assert.ok(rock, 'Central Lubuk Hitam boulder lh-1 must exist');

  // Place bot directly west of boulder aiming straight east through rock center
  bot.level = 15;
  bot.x = rock.x - (rock.radius + 52);
  bot.z = rock.z;
  const desiredDirectAngle = 0; // straight into rock center
  const steered = computeSteeredAngle(bot, desiredDirectAngle, 18, sim.zone, 1, true, 84);

  assert.ok(
    Math.abs(normalizeAngleDiff(steered, desiredDirectAngle)) > 0.25,
    `Expected obstacle steering to deflect around rock lh-1, got steered=${steered.toFixed(3)}`
  );
});

// 12. Shore restrictions below Level 40
test('12. Level 1-39 aquatic bots ignore shore carcasses and never enter shore terrain', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', { emitLocalSound: false, matchSeed: 1212 });
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  const distantAmphibian = sim.kelis.filter((k) => !k.isPlayer)[1]!;
  parkOthers(sim, [bot.id]);
  // Give a distant parked bot Lv.45 so the arena's <Lv.40 shore-carcass relocation doesn't float it into water
  rebalanceLivingFragments(sim, { [bot.id]: 15, [distantAmphibian.id]: 45 }, 20);

  // Locate exact water edge west of Tebing Kering shore bank
  let waterX = DRY_SHORE_X;
  while (getTerrainAt(waterX, DRY_SHORE_Z) === 'shore' && waterX > 200) {
    waterX -= 20;
  }
  bot.x = waterX - 65;
  bot.z = DRY_SHORE_Z;
  assert.notEqual(getTerrainAt(bot.x, bot.z), 'shore', 'Bot starting point must be water');

  const shoreCarc = addCarcass(sim, 'carc-shore-12', DRY_SHORE_X, DRY_SHORE_Z, 20);
  assert.equal(getTerrainAt(shoreCarc.x, shoreCarc.z), 'shore', 'Shore carcass must be on dry shore');

  for (let i = 0; i < 60; i++) {
    sim.step(1 / 30);
    if (getTerrainAt(shoreCarc.x, shoreCarc.z) === 'shore') {
      assert.notEqual(bot.aiTargetId, shoreCarc.id, 'Lv.15 bot must never target a dry shore carcass');
    }
    assert.equal(bot.isOnShore, false, 'Lv.15 bot must never step onto dry shore');
  }
});

// 13. Temporary shore access at Level 40 (exits before dehydration)
test('13. Level 40-79 bot can enter shore temporarily and retreats to water before dehydration damage', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', { emitLocalSound: false, matchSeed: 1313 });
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [bot.id]);
  rebalanceLivingFragments(sim, { [bot.id]: 45 });

  // Locate Tebing Kering waterline and place Lv.45 bot ~160u inland on dry shore with 3.5s reserve left
  let waterEdgeX = DRY_SHORE_X;
  while (getTerrainAt(waterEdgeX, DRY_SHORE_Z) === 'shore' && waterEdgeX > 200) {
    waterEdgeX -= 20;
  }
  bot.x = waterEdgeX + 160;
  bot.z = DRY_SHORE_Z;
  assert.equal(getTerrainAt(bot.x, bot.z), 'shore', 'Lv.45 bot must start on dry shore');
  bot.isOnShore = true;
  bot.shoreReserve = 3.5;
  const startHp = bot.hp;

  let leftShoreSafely = false;
  for (let i = 0; i < 140; i++) {
    sim.step(1 / 30);
    if (!bot.isOnShore) {
      leftShoreSafely = true;
      break;
    }
  }

  assert.equal(leftShoreSafely, true, 'Lv.45 bot must retreat from dry shore back to water');
  assert.equal(bot.alive, true, 'Lv.45 bot must survive without shore dehydration death');
  assert.ok(bot.hp >= startHp - 1, `Lv.45 bot should exit shore before losing HP (${bot.hp}/${startHp})`);
});

// 14. Amphibious traversal & global lower-level Hunter Sonar at Level 80+
test('14. Level 80+ amphibious bot traverses shore freely and uses Hunter Sonar to hunt lower-level prey', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', {
    emitLocalSound: false,
    matchSeed: 1414,
    aiDifficulty: 'hard',
  });
  const player = sim.getPlayer();
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [player.id, bot.id]);
  rebalanceLivingFragments(sim, { [bot.id]: 84, [player.id]: 12 });

  // Place Lv.84 bot on dry shore — must NOT trigger shore retreat
  bot.x = DRY_SHORE_X;
  bot.z = DRY_SHORE_Z;
  bot.isOnShore = true;
  bot.shoreReserve = 0;
  bot.sonarTimer = 4.5;
  bot.sonarIsHunter = true;

  // Place Lv.12 prey beyond normal local sight range (~1000 units away)
  player.x = DRY_SHORE_X - 1050;
  player.z = DRY_SHORE_Z;

  for (let i = 0; i < 25; i++) {
    bot.sonarTimer = 4.5;
    bot.sonarIsHunter = true;
    sim.step(1 / 30);
  }

  assert.equal(bot.aiRetreatingFromShore, false, 'Lv.80+ amphibious bot must never retreat due to shore exposure');
  assert.equal(bot.aiState, 'HUNT', `Lv.84 bot with active Hunter Sonar should enter HUNT, got ${bot.aiState}`);
  assert.equal(bot.aiTargetId, player.id, 'Lv.84 bot Hunter Sonar should lock onto lower-level prey');
});

// 15. Zone escape priority when outside safe zone
test('15. Bot outside safe zone prioritizes ESCAPE_ZONE and moves inward toward safe center', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', { emitLocalSound: false, matchSeed: 1515 });
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  parkOthers(sim, [bot.id]);
  rebalanceLivingFragments(sim, { [bot.id]: 18 }, 12);

  // Shrink zone radius and place bot clearly outside in open water (west of center) with a tempting carcass nearby
  sim.zone.currentRadius = 820;
  bot.x = sim.zone.centerX - 1020;
  bot.z = sim.zone.centerZ;
  addCarcass(sim, 'carc-outside-zone', bot.x - 30, bot.z, 12);

  const startDist = Math.hypot(bot.x - sim.zone.centerX, bot.z - sim.zone.centerZ);
  let escapedStateActive = false;
  for (let i = 0; i < 20; i++) {
    sim.step(1 / 30);
    const curDist = Math.hypot(bot.x - sim.zone.centerX, bot.z - sim.zone.centerZ);
    if (curDist > sim.zone.currentRadius - 82) {
      assert.equal(bot.aiState, 'ESCAPE_ZONE', `Expected ESCAPE_ZONE while outside safe zone, got ${bot.aiState}`);
      escapedStateActive = true;
    }
  }
  const endDist = Math.hypot(bot.x - sim.zone.centerX, bot.z - sim.zone.centerZ);

  assert.equal(escapedStateActive, true, 'Bot must activate ESCAPE_ZONE while outside safe zone');
  assert.ok(endDist < startDist - 60, `Bot must swim inward toward safe zone (${startDist} -> ${endDist})`);
});

// 16. Difficulty-tier behaviour differences without stat cheating
test('16. Difficulty tiers differ strictly in reaction/decision skill with zero stat cheating', () => {
  const easy = DIFFICULTY_PROFILES.easy;
  const normal = DIFFICULTY_PROFILES.normal;
  const hard = DIFFICULTY_PROFILES.hard;

  assert.ok(hard.reactionDelayMax < easy.reactionDelayMin, 'Hard reaction time must be faster than Easy');
  assert.ok(normal.reactionDelayMax <= easy.reactionDelayMax);
  assert.ok(hard.aimJitterRad < normal.aimJitterRad && normal.aimJitterRad < easy.aimJitterRad);
  assert.ok(hard.evadeReliability > normal.evadeReliability && normal.evadeReliability > easy.evadeReliability);
  assert.ok(hard.mistakeChance < normal.mistakeChance && normal.mistakeChance < easy.mistakeChance);

  // Verify ZERO stat inflation between Easy and Hard bots of the same level
  const simEasy = new GameSimulation(10, 'royale', 'Tester', {
    emitLocalSound: false,
    matchSeed: 1616,
    aiDifficulty: 'easy',
  });
  const simHard = new GameSimulation(10, 'royale', 'Tester', {
    emitLocalSound: false,
    matchSeed: 1616,
    aiDifficulty: 'hard',
  });
  const bEasy = simEasy.kelis.find((k) => !k.isPlayer)!;
  const bHard = simHard.kelis.find((k) => !k.isPlayer)!;

  assert.equal(bEasy.level, bHard.level);
  assert.equal(bEasy.maxHp, bHard.maxHp, 'Hard bots must have identical maxHp to Easy bots');
  assert.equal(bEasy.maxStamina, bHard.maxStamina, 'Hard bots must have identical maxStamina to Easy bots');
});

// 17. Deterministic decision outputs under identical matchSeed
test('17. Identical matchSeed and aiDifficulty produce deterministic bot states and trajectories', () => {
  const sim1 = new GameSimulation(20, 'royale', 'Tester', {
    emitLocalSound: false,
    matchSeed: 987654321,
    aiDifficulty: 'normal',
  });
  const sim2 = new GameSimulation(20, 'royale', 'Tester', {
    emitLocalSound: false,
    matchSeed: 987654321,
    aiDifficulty: 'normal',
  });

  // Neutralize weather timer randomness for pure deterministic AI verification
  sim1.weather.remainingSec = 999;
  sim2.weather.remainingSec = 999;
  sim1.pickups.length = 0;
  sim2.pickups.length = 0;

  for (let i = 0; i < 45; i++) {
    sim1.step(1 / 30);
    sim2.step(1 / 30);
  }

  const bots1 = sim1.kelis.filter((k) => !k.isPlayer);
  const bots2 = sim2.kelis.filter((k) => !k.isPlayer);
  for (let i = 0; i < bots1.length; i++) {
    assert.equal(bots1[i].aiPersonality, bots2[i].aiPersonality);
    assert.equal(bots1[i].aiState, bots2[i].aiState);
    assert.ok(Math.abs(bots1[i].x - bots2[i].x) < 0.001, `Bot ${i} X diverged: ${bots1[i].x} vs ${bots2[i].x}`);
    assert.ok(Math.abs(bots1[i].z - bots2[i].z) < 0.001, `Bot ${i} Z diverged: ${bots1[i].z} vs ${bots2[i].z}`);
  }
});

// 18. 100-bot simulation stability & performance check
test('18. Full 100-Keli simulation runs stably and smoothly within performance budget', () => {
  const sim = new GameSimulation(100, 'royale', 'BenchPlayer', {
    emitLocalSound: false,
    matchSeed: 100100,
    aiDifficulty: 'normal',
  });
  assert.equal(sim.kelis.length, 100);

  const startMs = performance.now();
  for (let i = 0; i < 60; i++) {
    sim.step(1 / 30);
  }
  const elapsedMs = performance.now() - startMs;

  for (const k of sim.kelis) {
    assert.ok(Number.isFinite(k.x) && Number.isFinite(k.z), `Entity ${k.id} has non-finite position`);
    assert.ok(Number.isFinite(k.vx) && Number.isFinite(k.vz), `Entity ${k.id} has non-finite velocity`);
  }
  assert.ok(elapsedMs < 2500, `60 steps of 100-Keli AI took too long: ${elapsedMs.toFixed(1)}ms`);
});

// 19. Multiplayer authoritative consistency & zero AI internal leakage
test('19. Multiplayer authoritative simulation syncs bots consistently and never exposes AI internals', () => {
  const sim = new GameSimulation(20, 'royale', 'HostA', {
    humanEntrants: [
      { id: 'p1', name: 'HostA' },
      { id: 'p2', name: 'GuestB' },
    ],
    emitLocalSound: false,
    isMultiplayerMatch: true,
    matchSeed: 1919,
  });

  // Dev debug snapshot must be strictly disabled for multiplayer matches
  assert.deepEqual(sim.getAiDebugSnapshot(), []);

  for (let i = 0; i < 30; i++) sim.step(1 / 30);

  const pkt1 = sim.getRemoteWorldStateFor('p1', 30);
  const pkt2 = sim.getRemoteWorldStateFor('p2', 30);

  const bots1 = pkt1.kelis.filter((k) => k.id.startsWith('bot-'));
  const bots2 = pkt2.kelis.filter((k) => k.id.startsWith('bot-'));
  assert.equal(bots1.length, bots2.length);
  assert.ok(bots1.length > 0);

  for (let i = 0; i < bots1.length; i++) {
    assert.equal(bots1[i].id, bots2[i].id);
    assert.equal(bots1[i].x, bots2[i].x, 'Clients must receive identical authoritative bot X');
    assert.equal(bots1[i].z, bots2[i].z, 'Clients must receive identical authoritative bot Z');
    assert.equal(bots1[i].level, bots2[i].level, 'Clients must receive identical authoritative bot level');

    // Verify no internal AI fields leaked into network packet
    const raw = bots1[i] as unknown as Record<string, unknown>;
    assert.equal('aiPersonality' in raw, false, 'aiPersonality must never leak in WorldStatePacket');
    assert.equal('aiState' in raw, false, 'aiState must never leak in WorldStatePacket');
    assert.equal('aiStateScore' in raw, false, 'aiStateScore must never leak in WorldStatePacket');
  }
});

// 20. Strict 100-fragment conservation across active AI-driven matches
test('20. Strict 100-fragment conservation holds across active AI-driven combat and contested feeding', () => {
  const sim = new GameSimulation(20, 'royale', 'Observer', {
    emitLocalSound: false,
    matchSeed: 202020,
    aiDifficulty: 'hard',
  });
  // Cluster bots near central basin so active combat, kills, carcasses, and contested feeding happen immediately
  const living = sim.kelis.filter((k) => !k.isPlayer);
  for (let i = 0; i < living.length; i++) {
    const ang = (i / living.length) * Math.PI * 2;
    const dist = 60 + (i % 3) * 55;
    living[i].x = OPEN_WATER_X + Math.cos(ang) * dist;
    living[i].z = OPEN_WATER_Z + Math.sin(ang) * dist;
  }

  for (let tick = 0; tick < 240; tick++) {
    if (sim.status !== 'playing') break;
    sim.step(1 / 30);
    const audit = sim.getFragmentAudit();
    assert.equal(
      audit.total,
      TOTAL_MATCH_FRAGMENTS,
      `Tick ${tick}: expected exact 100 fragments, got living=${audit.living} carcasses=${audit.carcasses} total=${audit.total}`
    );
    assert.equal(audit.hasFractional, false, `Tick ${tick}: fractional fragments detected`);
    assert.equal(audit.valid, true, `Tick ${tick}: fragment audit invalid`);
  }
});

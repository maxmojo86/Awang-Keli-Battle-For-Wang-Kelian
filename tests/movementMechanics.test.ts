import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getElevationAt,
  getTerrainAt,
  LANDMARKS,
  OBSTACLES,
  PALONG_GATES,
  resolveArenaCollision,
  resolveSweptMovement,
  scaleArenaCoord,
  WORLD_CENTER,
} from '../src/game/arena.ts';
import {
  computeTurnRate,
  getLocomotionProfile,
  normalizeMoveInput,
} from '../src/game/movement.ts';
import { RemoteSimulationView } from '../src/game/multiplayerClient.ts';
import {
  DASH_STAMINA_COST,
  EVADE_COOLDOWN_SEC,
  EVADE_DAMAGE_MITIGATION,
  EVADE_STAMINA_COST,
  FEED_MOVE_SPEED_MULT,
  GameSimulation,
  TOTAL_MATCH_FRAGMENTS,
} from '../src/game/simulation.ts';
import { resolveActorAnimIntent } from '../src/game/spriteAnimation.ts';

// Calm deep-water coordinate in Lubuk Hitam (zero current, far from obstacles & shore)
const CALM_WATER_X = scaleArenaCoord(960);
const CALM_WATER_Z = scaleArenaCoord(960);

// Clean dry shore (Kampung Hut — outside geothermal vents) & shallow waterline just west of Tebing Kering
const SHORE_X = LANDMARKS.kampungHut.x;
const SHORE_Z = LANDMARKS.kampungHut.z;
const SHORE_WATER_EDGE_X = LANDMARKS.tebingKeringLanding.x + 40;
const SHORE_WATER_EDGE_Z = LANDMARKS.tebingKeringLanding.z;

function keliRadius(level: number): number {
  return 14 + Math.min(24, level * 0.24);
}

function stepSeconds(sim: GameSimulation, seconds: number, dt = 1 / 60) {
  let remaining = seconds;
  while (remaining > 1e-6) {
    const step = Math.min(dt, remaining);
    sim.step(step);
    remaining -= step;
  }
}

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

function setupIsolatedPlayerSim(playerLevel = 20, x = CALM_WATER_X, z = CALM_WATER_Z) {
  const sim = new GameSimulation(5, 'royale', 'Awang', {
    humanEntrants: [
      { id: 'player', name: 'Awang' },
      { id: 'rival', name: 'RivalKeli' },
    ],
    emitLocalSound: false,
    isMultiplayerMatch: true,
    matchSeed: 424242,
  });

  const player = sim.getPlayer('player');
  const rival = sim.getPlayer('rival');
  const bots = sim.kelis.filter((k) => !k.isPlayer);

  // Distribute exact 100 integer fragments cleanly
  const safePlayerLvl = Math.max(1, Math.min(96, Math.trunc(playerLevel)));
  const remaining = TOTAL_MATCH_FRAGMENTS - safePlayerLvl;
  const rivalLvl = Math.max(1, Math.min(remaining - bots.length, 10));
  let pool = remaining - rivalLvl;

  player.level = safePlayerLvl;
  player.maxHp = 100 + player.level * 12;
  player.hp = player.maxHp;
  player.x = x;
  player.z = z;
  player.vx = 0;
  player.vz = 0;
  player.facingAngle = 0;
  player.isOnShore = getTerrainAt(x, z) === 'shore';
  player.shoreReserve = player.maxShoreReserve;
  player.stamina = player.maxStamina;
  player.fatigued = false;

  rival.level = rivalLvl;
  rival.maxHp = 100 + rival.level * 12;
  rival.hp = rival.maxHp;
  rival.x = scaleArenaCoord(700);
  rival.z = scaleArenaCoord(900);
  rival.vx = 0;
  rival.vz = 0;

  for (let i = 0; i < bots.length; i++) {
    const share = i === bots.length - 1 ? pool : Math.max(1, Math.floor(pool / (bots.length - i)));
    pool -= share;
    bots[i].level = share;
    bots[i].x = scaleArenaCoord(540 + i * 70);
    bots[i].z = scaleArenaCoord(580);
    bots[i].vx = 0;
    bots[i].vz = 0;
  }

  assertFragmentInvariant(sim, 'setupIsolatedPlayerSim');
  return { sim, player, rival, bots };
}

test('1. Acceleration and deceleration match arcade-responsive target curves', () => {
  const { sim, player } = setupIsolatedPlayerSim(20);

  // Measure steady-state top speed first
  sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
  stepSeconds(sim, 1.2);
  const topSpeed = Math.hypot(player.vx, player.vz);
  assert.ok(topSpeed > 150, `Expected steady-state speed > 150, got ${topSpeed}`);

  // Reset to rest and measure time to reach 90% of top speed (target 0.25s - 0.40s)
  player.vx = 0;
  player.vz = 0;
  player.x = CALM_WATER_X;
  player.z = CALM_WATER_Z;
  let timeTo90 = 0;
  const dt = 1 / 60;
  for (let i = 1; i <= 60; i++) {
    sim.step(dt);
    const spd = Math.hypot(player.vx, player.vz);
    if (spd >= topSpeed * 0.9) {
      timeTo90 = i * dt;
      break;
    }
  }
  assert.ok(
    timeTo90 >= 0.25 && timeTo90 <= 0.42,
    `Expected time to 90% speed in [0.25s, 0.42s], got ${timeTo90.toFixed(3)}s`
  );

  // Ramp to full speed, then release input and measure time to drop to 10% (target 0.20s - 0.35s)
  stepSeconds(sim, 0.5);
  const peakSpeed = Math.hypot(player.vx, player.vz);
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
  let timeTo10 = 0;
  for (let i = 1; i <= 60; i++) {
    sim.step(dt);
    const spd = Math.hypot(player.vx, player.vz);
    if (spd <= peakSpeed * 0.1) {
      timeTo10 = i * dt;
      break;
    }
  }
  assert.ok(
    timeTo10 >= 0.2 && timeTo10 <= 0.36,
    `Expected time to decelerate to 10% in [0.20s, 0.36s], got ${timeTo10.toFixed(3)}s`
  );

  // Continue briefly and confirm crisp full stop (no endless ice-skating drift)
  stepSeconds(sim, 0.6);
  assert.equal(Math.hypot(player.vx, player.vz), 0, 'Expected clean full stop after release');
});

test('2. Diagonal movement normalization matches cardinal speed', () => {
  const norm = normalizeMoveInput(1, 1);
  assert.ok(Math.abs(Math.hypot(norm.x, norm.z) - 1) < 1e-6, 'Diagonal vector must normalize to 1');

  const runCardinal = setupIsolatedPlayerSim(20);
  runCardinal.sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
  stepSeconds(runCardinal.sim, 0.8);
  const cardinalSpeed = Math.hypot(runCardinal.player.vx, runCardinal.player.vz);
  const cardinalDist = Math.hypot(
    runCardinal.player.x - CALM_WATER_X,
    runCardinal.player.z - CALM_WATER_Z
  );

  const runDiag = setupIsolatedPlayerSim(20);
  // Feed unnormalized raw (1, 1) to ensure simulation itself enforces normalization
  runDiag.sim.setInput({ moveX: 1, moveZ: 1, aimAngle: Math.PI / 4, biteHeld: false });
  stepSeconds(runDiag.sim, 0.8);
  const diagSpeed = Math.hypot(runDiag.player.vx, runDiag.player.vz);
  const diagDist = Math.hypot(runDiag.player.x - CALM_WATER_X, runDiag.player.z - CALM_WATER_Z);

  assert.ok(
    Math.abs(diagSpeed - cardinalSpeed) < 0.5,
    `Diagonal speed (${diagSpeed.toFixed(2)}) must match cardinal speed (${cardinalSpeed.toFixed(2)})`
  );
  assert.ok(
    Math.abs(diagDist - cardinalDist) < 1.0,
    `Diagonal distance (${diagDist.toFixed(2)}) must match cardinal distance (${cardinalDist.toFixed(2)})`
  );
});

test('3. Direction changes are responsive without instantaneous 180-degree velocity reversal', () => {
  const { sim, player } = setupIsolatedPlayerSim(20);
  sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
  stepSeconds(sim, 0.7);
  const initialVx = player.vx;
  assert.ok(initialVx > 140);

  // Reverse direction sharply
  sim.setInput({ moveX: -1, moveZ: 0, aimAngle: Math.PI, biteHeld: false });
  sim.step(1 / 60);
  // Single tick must NOT instantaneously snap to full -initialVx
  assert.ok(
    player.vx > -initialVx * 0.5,
    `Velocity must transition smoothly on reversal, got ${player.vx} after 1 tick`
  );
  // Facing angle also rotates smoothly instead of instant 180-degree snap
  assert.ok(Math.abs(player.facingAngle) < Math.PI - 0.5, 'Facing must turn smoothly without snapping');

  // Within 0.45s Keli should be briskly moving in the reversed direction
  stepSeconds(sim, 0.45);
  assert.ok(player.vx < -initialVx * 0.75, `Expected crisp reversal by 0.45s, got vx=${player.vx}`);

  // Speed-dependent turning: low speed turn rate > high speed turn rate
  const prof = getLocomotionProfile(20, false);
  const lowTurn = computeTurnRate(prof, 0, 170);
  const highTurn = computeTurnRate(prof, 170, 170);
  assert.ok(lowTurn > highTurn, `Low-speed turn (${lowTurn}) should exceed high-speed turn (${highTurn})`);
});

test('4. Fixed-step deterministic movement produces identical trajectories and consistent 30Hz/60Hz convergence', () => {
  const runSim = (dt: number) => {
    const { sim, player } = setupIsolatedPlayerSim(25);
    sim.setInput({ moveX: 1, moveZ: 0.5, aimAngle: 0.4, biteHeld: false });
    stepSeconds(sim, 0.5, dt);
    sim.setInput({ moveX: -0.3, moveZ: 1, aimAngle: 1.8, biteHeld: false });
    stepSeconds(sim, 0.5, dt);
    return { x: player.x, z: player.z, vx: player.vx, vz: player.vz, facing: player.facingAngle };
  };

  const a60 = runSim(1 / 60);
  const b60 = runSim(1 / 60);
  assert.equal(a60.x, b60.x, 'Repeated 60Hz runs must be bit-identical in X');
  assert.equal(a60.z, b60.z, 'Repeated 60Hz runs must be bit-identical in Z');
  assert.equal(a60.vx, b60.vx, 'Repeated 60Hz runs must be bit-identical in vx');
  assert.equal(a60.vz, b60.vz, 'Repeated 60Hz runs must be bit-identical in vz');

  const a30 = runSim(1 / 30);
  assert.ok(
    Math.hypot(a60.x - a30.x, a60.z - a30.z) < 4.5,
    `30Hz and 60Hz fixed-step trajectories should closely match (delta=${Math.hypot(a60.x - a30.x, a60.z - a30.z).toFixed(2)})`
  );
});

test('5. Obstacle collision sliding glides smoothly around limestone rocks without sticking', () => {
  const rock = OBSTACLES.find((o) => o.id === 'lh-1')!;
  assert.ok(rock, 'Central Lubuk Hitam rock lh-1 must exist');

  // Position player west-northwest of the rock and push east into its upper curved flank
  const startX = rock.x - rock.radius - 30;
  const startZ = rock.z - 44;
  const { sim, player } = setupIsolatedPlayerSim(20, startX, startZ);
  sim.setInput({ moveX: 0.96, moveZ: 0.28, aimAngle: 0.25, biteHeld: false });

  const startY = player.z;
  stepSeconds(sim, 1.3);

  const distToRock = Math.hypot(player.x - rock.x, player.z - rock.z);
  const minClearance = rock.radius + keliRadius(player.level) - 0.5;
  assert.ok(distToRock >= minClearance, `Must not penetrate rock (dist=${distToRock}, min=${minClearance})`);
  assert.ok(
    Math.hypot(player.x - startX, player.z - startY) > 100,
    `Keli should slide cleanly around rock instead of sticking (moved=${Math.hypot(player.x - startX, player.z - startY).toFixed(1)})`
  );
  assert.ok(Math.hypot(player.vx, player.vz) > 40, 'Tangential sliding should retain smooth momentum');
});

test('6. No obstacle penetration even at high speed or between adjacent boulders', () => {
  const rock = OBSTACLES.find((o) => o.id === 'lh-2')!;
  const radius = 24;
  // Attempt to sweep straight through the center of the rock in a single large step
  const fromX = rock.x - rock.radius - 40;
  const toX = rock.x + rock.radius + 40;
  const swept = resolveSweptMovement(fromX, rock.z, toX, rock.z, radius, true);
  assert.equal(swept.collided, true, 'Swept movement must detect rock collision');
  const distToCenter = Math.hypot(swept.x - rock.x, swept.z - rock.z);
  assert.ok(
    distToCenter >= rock.radius + radius - 0.5,
    `Swept movement must not penetrate rock (dist=${distToCenter}, min=${rock.radius + radius})`
  );
  assert.ok(swept.x < rock.x, 'Must stop on entry side rather than tunneling through rock center');
});

test('7. Narrow passage traversal passes cleanly through Palong sluice gates', () => {
  const gate = PALONG_GATES[0];
  assert.ok(gate, 'Palong gate 1 must exist');

  // Approach perpendicular to the gate bar through the open center lane between left & right pilings
  const laneDirX = -Math.sin(gate.angle);
  const laneDirZ = Math.cos(gate.angle);
  const startX = gate.x - laneDirX * 85;
  const startZ = gate.z - laneDirZ * 85;

  const { sim, player } = setupIsolatedPlayerSim(25, startX, startZ);
  sim.setInput(
    { moveX: laneDirX, moveZ: laneDirZ, aimAngle: Math.atan2(laneDirZ, laneDirX), biteHeld: false }    );
  stepSeconds(sim, 1.4);

  // Measure signed forward progress through the gate plane along the lane normal
  const signedThrough = (player.x - gate.x) * laneDirX + (player.z - gate.z) * laneDirZ;
  assert.ok(
    signedThrough > 50,
    `Keli should pass cleanly beyond the Palong gate center line (signedThrough=${signedThrough.toFixed(1)})`
  );
});

test('8. Level 1-39 water restrictions block shore entry and slide cleanly along waterline', () => {
  const { sim, player } = setupIsolatedPlayerSim(18, SHORE_WATER_EDGE_X, SHORE_WATER_EDGE_Z);
  assert.equal(getTerrainAt(player.x, player.z), 'shallow', 'Starting position should be water');

  // Drive diagonally southeast into Tebing Kering shoreline
  sim.setInput({ moveX: 0.85, moveZ: 0.55, aimAngle: 0.5, biteHeld: false });
  const startZ = player.z;
  stepSeconds(sim, 1.4);

  assert.notEqual(getTerrainAt(player.x, player.z), 'shore', 'Lv.1-39 Keli must never enter shore');
  assert.equal(player.isOnShore, false, 'isOnShore must remain false for Lv.1-39');
  // Must slide smoothly along the shoreline contour instead of freezing in place
  assert.ok(
    Math.abs(player.z - startZ) > 55,
    `Lv.1-39 Keli should slide tangentially along shoreline (dz=${(player.z - startZ).toFixed(1)})`
  );

  // Also verify western Boat Spit shore cannot be entered by Lv.1-39
  const spitCheck = resolveArenaCollision(scaleArenaCoord(1300), scaleArenaCoord(1200), 20, false);
  assert.equal(spitCheck.blockedByShore, true, 'Boat Spit shore must block Lv.1-39');
  assert.notEqual(getTerrainAt(spitCheck.x, spitCheck.z), 'shore', 'Resolved Boat Spit pos must be water');
});

test('9. Level 40-79 arm-assisted shore movement is heavier and slower than water swimming', () => {
  const waterRun = setupIsolatedPlayerSim(55, CALM_WATER_X, CALM_WATER_Z);
  waterRun.sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
  stepSeconds(waterRun.sim, 0.8);
  const waterSpeed = Math.hypot(waterRun.player.vx, waterRun.player.vz);

  const landRun = setupIsolatedPlayerSim(55, SHORE_X, SHORE_Z);
  assert.equal(getTerrainAt(landRun.player.x, landRun.player.z), 'shore');
  landRun.sim.setInput({ moveX: 0, moveZ: -1, aimAngle: -Math.PI / 2, biteHeld: false });
  stepSeconds(landRun.sim, 0.8);
  const landSpeed = Math.hypot(landRun.player.vx, landRun.player.vz);

  assert.equal(landRun.player.isOnShore, true, 'Lv.40-79 Keli must be allowed onto shore');
  assert.ok(
    landSpeed < waterSpeed * 0.78 && landSpeed > waterSpeed * 0.55,
    `Form 2 land dragging speed (${landSpeed.toFixed(1)}) should be noticeably slower than water (${waterSpeed.toFixed(1)})`
  );

  // Sprite animation cadence reflects slower arm-assisted dragging on land vs water swim
  const animLand = resolveActorAnimIntent(landRun.player, 2);
  const animWater = resolveActorAnimIntent(waterRun.player, 2);
  assert.equal(animLand.action, 'move');
  assert.ok(
    animLand.speedMult < animWater.speedMult,
    `Form 2 land drag anim (${animLand.speedMult.toFixed(2)}) must be slower than water swim (${animWater.speedMult.toFixed(2)})`
  );
});

test('10. Shore reserve countdown on land and clean water recovery for Lv.40-79', () => {
  const { sim, player } = setupIsolatedPlayerSim(55, SHORE_X, SHORE_Z);
  player.shoreReserve = player.maxShoreReserve;

  // Stay on shore for 3 seconds — reserve must count down reliably without resets
  stepSeconds(sim, 3.0);
  assert.equal(player.isOnShore, true);
  assert.ok(
    player.shoreReserve < 7.2 && player.shoreReserve > 6.5,
    `Expected ~7.0s shore reserve after 3s on shore (got ${player.shoreReserve.toFixed(2)})`
  );

  // Return to water — reserve must recover cleanly at 2.5/s
  const reserveBeforeWater = player.shoreReserve;
  player.x = CALM_WATER_X;
  player.z = CALM_WATER_Z;
  player.isOnShore = false;
  stepSeconds(sim, 1.0);
  assert.equal(player.isOnShore, false);
  assert.ok(
    player.shoreReserve > reserveBeforeWater + 2.0,
    `Expected shore reserve recovery in water (before=${reserveBeforeWater.toFixed(2)}, after=${player.shoreReserve.toFixed(2)})`
  );
});

test('11. Level 80+ amphibious traversal crosses shoreline freely without reserve loss', () => {
  const { sim, player } = setupIsolatedPlayerSim(85, SHORE_WATER_EDGE_X, SHORE_WATER_EDGE_Z);
  player.shoreReserve = player.maxShoreReserve;

  // Cross directly from water onto Tebing Kering shore
  sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
  stepSeconds(sim, 2.2);

  assert.equal(player.isOnShore, true, 'Lv.80+ Amphibious Keli must cross freely onto shore');
  assert.equal(
    player.shoreReserve,
    player.maxShoreReserve,
    'Lv.80+ Amphibious Keli must never lose shore reserve on land'
  );

  // Confirm Form 3 land stride is significantly faster than Form 2 arm-dragging
  const form3LandSpeed = Math.hypot(player.vx, player.vz);
  const form2Land = setupIsolatedPlayerSim(55, SHORE_X, SHORE_Z);
  form2Land.sim.setInput({ moveX: 0, moveZ: -1, aimAngle: -Math.PI / 2, biteHeld: false });
  stepSeconds(form2Land.sim, 0.8);
  const form2LandSpeed = Math.hypot(form2Land.player.vx, form2Land.player.vz);

  assert.ok(
    form3LandSpeed > form2LandSpeed * 1.25,
    `Form 3 land stride (${form3LandSpeed.toFixed(1)}) must clearly outperform Form 2 drag (${form2LandSpeed.toFixed(1)})`
  );
});

test('12. Dash movement, stamina/cooldown preservation, swept collision, and zero post-dash speed leak', () => {
  const { sim, player } = setupIsolatedPlayerSim(20);
  const staminaBefore = player.stamina;

  sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
  sim.triggerPlayerAbility('dash');

  assert.equal(player.stamina, staminaBefore - DASH_STAMINA_COST, 'Dash must consume exact 18 stamina');
  assert.equal(player.cooldowns.dash, 3.5, 'Dash cooldown must remain 3.5s');
  assert.ok(player.dashTimer > 0, 'Dash timer must activate');

  sim.step(1 / 60);
  const dashSpeed = Math.hypot(player.vx, player.vz);
  assert.ok(dashSpeed > 360, `Expected high Dash burst speed, got ${dashSpeed.toFixed(1)}`);

  // Finish dash and release input: velocity must clamp cleanly without leaking excess burst speed
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
  stepSeconds(sim, 0.26);
  assert.equal(player.dashTimer, 0, 'Dash timer should finish');
  const postDashSpeed = Math.hypot(player.vx, player.vz);
  assert.ok(
    postDashSpeed <= 185,
    `Post-dash speed (${postDashSpeed.toFixed(1)}) must never inherit excess burst velocity`
  );

  // Dash straight into a rock obstacle: must never tunnel through
  const rock = OBSTACLES.find((o) => o.id === 'lh-1')!;
  player.x = rock.x - rock.radius - keliRadius(player.level) - 8;
  player.z = rock.z;
  player.cooldowns.dash = 0;
  player.stamina = 100;
  sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
  sim.triggerPlayerAbility('dash');
  stepSeconds(sim, 0.25);
  assert.ok(player.x < rock.x, 'Dashing straight into rock must not tunnel through');
  assert.ok(
    Math.hypot(player.x - rock.x, player.z - rock.z) >= rock.radius + keliRadius(player.level) - 0.5,
    'Dashing Keli must remain outside rock radius'
  );
});

test('13. Slip Evade preserves exact 24 stamina, 2.2s cooldown, 60% mitigation, collision safety, and clean exit velocity', () => {
  const { sim, player, rival } = setupIsolatedPlayerSim(20);
  const staminaBefore = player.stamina;

  sim.setInput({ moveX: 0, moveZ: 1, aimAngle: Math.PI / 2, biteHeld: false });
  sim.triggerPlayerAbility('evade');

  assert.equal(player.stamina, staminaBefore - EVADE_STAMINA_COST, 'Slip Evade must cost exact 24 stamina');
  assert.equal(player.cooldowns.evade, EVADE_COOLDOWN_SEC, 'Slip Evade cooldown must be exact 2.2s');
  assert.ok(player.evadeTimer > 0, 'Slip Evade timer must activate');

  // Verify 60% damage mitigation remains intact during active evade
  rival.x = player.x;
  rival.z = player.z - 42;
  rival.facingAngle = Math.PI / 2;
  const hpBefore = player.hp;
  sim.setInputForPlayer('rival', { moveX: 0, moveZ: 0, aimAngle: Math.PI / 2, biteHeld: true });
  stepSeconds(sim, 0.2);
  // If rival hit during evade, damage is reduced by 60% (mitigated)
  const hpLost = hpBefore - player.hp;
  assert.ok(hpLost < 35 * (1 - EVADE_DAMAGE_MITIGATION) + 12, 'Evade damage mitigation must remain intact');

  // Finish evade and ensure zero excess burst speed carries over
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
  stepSeconds(sim, 0.25);
  assert.equal(player.evadeTimer, 0, 'Evade timer must expire');
  assert.ok(
    Math.hypot(player.vx, player.vz) <= 185,
    `Post-evade speed (${Math.hypot(player.vx, player.vz).toFixed(1)}) must clamp cleanly`
  );
});

test('14. Knockback is collision-safe, stagger restricts Dash/Evade and speed, and stun halts movement', () => {
  const rock = OBSTACLES.find((o) => o.id === 'lh-3')!;
  const { sim, player, rival } = setupIsolatedPlayerSim(
    20,
    rock.x - rock.radius - 26,
    rock.z
  );
  // Place rival directly west so bite knockback drives player east toward rock
  rival.level = 30;
  rival.x = player.x - 42;
  rival.z = player.z;
  rival.facingAngle = 0;

  sim.setInputForPlayer('rival', { moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  stepSeconds(sim, 0.22);

  const distToRock = Math.hypot(player.x - rock.x, player.z - rock.z);
  assert.ok(
    distToRock >= rock.radius + keliRadius(player.level) - 0.5,
    'Knockback must never push target inside rock obstacle'
  );

  // Stagger blocks Dash and Evade and reduces movement speed
  player.staggerTimer = 0.5;
  player.stamina = 100;
  player.cooldowns.dash = 0;
  player.cooldowns.evade = 0;
  sim.triggerPlayerAbility('dash');
  sim.triggerPlayerAbility('evade');
  assert.equal(player.dashTimer, 0, 'Stagger must block Dash');
  assert.equal(player.evadeTimer, 0, 'Stagger must block Slip Evade');

  // Stun halts locomotion cleanly
  player.staggerTimer = 0;
  player.stunTimer = 0.6;
  player.vx = 140;
  player.vz = 0;
  sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
  stepSeconds(sim, 0.35);
  assert.ok(
    Math.hypot(player.vx, player.vz) < 12,
    `Stunned Keli must decelerate cleanly to a halt (speed=${Math.hypot(player.vx, player.vz).toFixed(1)})`
  );
});

test('15. Feeding movement slowdown preserves exact FEED_MOVE_SPEED_MULT', () => {
  const { sim, player } = setupIsolatedPlayerSim(20);
  // Place a reachable carcass right beside the player (keeping 100 fragments conserved by shifting from a bot)
  const donorBot = sim.kelis.find((k) => !k.isPlayer && k.level > 2)!;
  donorBot.level -= 2;
  sim.carcasses.push({
    id: 'carc-move-test',
    x: player.x + 26,
    z: player.z,
    mass: 2,
    initialMass: 2,
    evolutionPhaseAtDeath: 1,
    sourceName: 'TestPrey',
    createdAt: 0,
    bobPhase: 0,
    consumed: false,
  });

  // Start feeding
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(1 / 60);
  assert.equal(player.feedingTargetId, 'carc-move-test', 'Player should enter feeding channel');

  // Move gently perpendicular while still holding feed
  sim.setInput({ moveX: 0, moveZ: 1, aimAngle: 0, biteHeld: true });
  stepSeconds(sim, 0.25);
  const feedSpeed = Math.hypot(player.vx, player.vz);
  // Normal Lv.20 speed is ~167; 20% feeding speed is ~33.4
  assert.ok(
    feedSpeed <= 167 * FEED_MOVE_SPEED_MULT + 6,
    `Feeding speed (${feedSpeed.toFixed(1)}) must remain capped near ${FEED_MOVE_SPEED_MULT * 100}%`
  );
});

test('16. Multiplayer interpolation/reconciliation respects obstacles, shorelines, and victory freeze', () => {
  const { sim, player } = setupIsolatedPlayerSim(20, SHORE_WATER_EDGE_X, SHORE_WATER_EDGE_Z);
  const remote = new RemoteSimulationView('player');

  // Feed initial server snapshot
  const pkt1 = sim.getRemoteWorldStateFor('player', 1);
  remote.applyServerState(pkt1);

  // Move player aggressively east toward shore in server snapshot
  sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
  stepSeconds(sim, 0.25);
  const pkt2 = sim.getRemoteWorldStateFor('player', 16);
  remote.applyServerState(pkt2);

  // Advance client interpolation multiple frames
  for (let i = 0; i < 15; i++) {
    remote.advance(1 / 60);
  }

  const clientPlayer = remote.getPlayer();
  assert.notEqual(
    getTerrainAt(clientPlayer.x, clientPlayer.z),
    'shore',
    'Client dead reckoning must never push Lv.1-39 onto shore'
  );
  assert.ok(
    Math.hypot(clientPlayer.x - player.x, clientPlayer.z - player.z) < 28,
    'Client view should smoothly reconcile toward authoritative position'
  );

  // Victory packet freezes client velocities and halts drift
  const victoryPkt = {
    ...pkt2,
    status: 'victory' as const,
    kelis: pkt2.kelis.map((k) =>
      k.id === 'player' ? { ...k, level: 100, vx: 150, vz: 100 } : k
    ),
  };
  remote.applyServerState(victoryPkt);
  const frozenX = remote.getPlayer().x;
  const frozenZ = remote.getPlayer().z;
  for (let i = 0; i < 20; i++) {
    remote.advance(1 / 60);
  }
  assert.equal(remote.getPlayer().vx, 0, 'Post-victory client velocity X must be zero');
  assert.equal(remote.getPlayer().vz, 0, 'Post-victory client velocity Z must be zero');
  assert.ok(
    Math.hypot(remote.getPlayer().x - frozenX, remote.getPlayer().z - frozenZ) < 18,
    'Post-victory client entity must settle cleanly without dead-reckoning drift'
  );
});

test('17. AI steering compatibility uses shared physics, navigates obstacles, and respects Form 2 shore reserve', () => {
  const sim = new GameSimulation(10, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 777123,
  });

  // Put a Form 2 bot onto shore with low shore reserve and verify it retreats smoothly back into water
  const bot = sim.kelis.find((k) => !k.isPlayer)!;
  const delta = 50 - bot.level;
  bot.level = 50;
  // Rebalance fragments from other bots so strict 100-fragment invariant holds
  let toRemove = delta;
  for (const other of sim.kelis) {
    if (other.id === bot.id || other.isPlayer || toRemove <= 0) continue;
    const take = Math.min(toRemove, other.level - 1);
    if (take > 0) {
      other.level -= take;
      toRemove -= take;
    }
  }
  // Place bot on dry shore ~110 units inland from the Tebing Kering western waterline (clear of thermal vents)
  bot.x = LANDMARKS.tebingKeringLanding.x + 125;
  bot.z = LANDMARKS.tebingKeringLanding.z;
  assert.equal(getTerrainAt(bot.x, bot.z), 'shore', 'Form 2 bot test start must be on shore');
  bot.isOnShore = true;
  bot.shoreReserve = 3.2;
  bot.vx = 0;
  bot.vz = 0;

  // Step 2 ticks and verify smooth acceleration (not instantaneous top-speed jump on tick 1)
  sim.step(1 / 60);
  const spd1 = Math.hypot(bot.vx, bot.vz);
  assert.ok(spd1 > 0 && spd1 < 120, `Bot should accelerate smoothly via shared physics (tick1=${spd1.toFixed(1)})`);

  // Step 3.5 seconds and confirm bot successfully navigates back off shore without dying
  stepSeconds(sim, 3.5);
  assert.equal(bot.alive, true, 'Form 2 bot should survive low-reserve shore exit');
  assert.equal(bot.isOnShore, false, 'Form 2 bot should exit shore into water before dehydration');
});

test('18. 100-Keli movement and swept collision performance stays fast with zero NaN/Infinity', () => {
  const sim = new GameSimulation(100, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 9001,
  });

  const t0 = performance.now();
  for (let i = 0; i < 60; i++) {
    sim.setInput(
      {
        moveX: Math.cos(i * 0.1),
        moveZ: Math.sin(i * 0.1),
        aimAngle: i * 0.1,
        biteHeld: false,
      }      );
    sim.step(1 / 60);
  }
  const elapsedMs = performance.now() - t0;

  assert.ok(
    elapsedMs < 1500,
    `60 ticks of 100-Keli simulation should complete comfortably under 1500ms (took ${elapsedMs.toFixed(1)}ms)`
  );

  for (const k of sim.kelis) {
    assert.ok(Number.isFinite(k.x) && Number.isFinite(k.z), `Finite coordinates required for ${k.id}`);
    assert.ok(Number.isFinite(k.vx) && Number.isFinite(k.vz), `Finite velocity required for ${k.id}`);
  }
  assertFragmentInvariant(sim, '100-Keli performance test');
});

test('19. Post-victory movement blocking freezes Keli King and all survivors with zero drift', () => {
  const { sim, player } = setupIsolatedPlayerSim(95);
  // Shift remaining 5 fragments into a carcass right next to player so feeding triggers Lv.100 victory
  let taken = 0;
  for (const k of sim.kelis) {
    if (k.id === player.id || !k.alive) continue;
    const mass = Math.trunc(k.level);
    k.alive = false;
    k.level = 0;
    taken += mass;
  }
  sim.carcasses.push({
    id: 'carc-crown',
    x: player.x + 20,
    z: player.z,
    mass: taken,
    initialMass: taken,
    evolutionPhaseAtDeath: 1,
    sourceName: 'FinalRival',
    createdAt: 0,
    bobPhase: 0,
    consumed: false,
  });
  assertFragmentInvariant(sim, 'pre-victory setup');

  // Give player active momentum + dash right before reaching Lv.100
  player.vx = 180;
  player.vz = 90;
  sim.transferCarcassFragments(player, 'carc-crown');

  assert.equal(sim.status, 'victory', 'Reaching 100 fragments must trigger victory');
  assert.equal(player.level, 100);
  assert.equal(player.vx, 0, 'Keli King vx must be immediately zeroed on victory');
  assert.equal(player.vz, 0, 'Keli King vz must be immediately zeroed on victory');
  assert.equal(player.dashTimer, 0, 'Keli King dashTimer must be zeroed on victory');
  assert.equal(player.evadeTimer, 0, 'Keli King evadeTimer must be zeroed on victory');

  const winX = player.x;
  const winZ = player.z;
  sim.setInput({ moveX: 1, moveZ: 1, aimAngle: 0.5, biteHeld: true });
  sim.triggerPlayerAbility('dash');
  sim.triggerPlayerAbility('evade');
  stepSeconds(sim, 1.0);

  assert.equal(player.x, winX, 'Keli King X must not drift after victory');
  assert.equal(player.z, winZ, 'Keli King Z must not drift after victory');
});

test('20. Strict 100-fragment conservation holds across active locomotion, collisions, combat, and feeding', () => {
  const sim = new GameSimulation(25, 'royale', 'Awang', {
    emitLocalSound: false,
    matchSeed: 202605,
  });

  // Drive player through varied directions, dashes, evades, bites, and obstacle contacts for 8 simulated seconds
  for (let sec = 0; sec < 8; sec++) {
    const ang = sec * 0.9;
    sim.setInput(
      {
        moveX: Math.cos(ang),
        moveZ: Math.sin(ang),
        aimAngle: ang,
        biteHeld: sec % 2 === 0,
      }      );
    if (sec === 2) sim.triggerPlayerAbility('evade');
    if (sec === 4) sim.triggerPlayerAbility('dash');
    stepSeconds(sim, 1.0);
    assertFragmentInvariant(sim, `25-Keli active match @ ${sec + 1}s`);
  }

  // Ensure elevation query helper remains finite across arena
  assert.ok(Number.isFinite(getElevationAt(WORLD_CENTER, WORLD_CENTER)));
  assert.ok(Number.isFinite(getElevationAt(LANDMARKS.tebingKeringLanding.x, LANDMARKS.tebingKeringLanding.z)));
});

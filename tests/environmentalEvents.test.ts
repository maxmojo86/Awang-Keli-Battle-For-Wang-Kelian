import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  OBSTACLES,
  WORLD_CENTER,
  getTerrainAt,
  isPositionAccessible,
} from '../src/game/arena.ts';
import {
  ALL_WORLD_EVENT_KINDS,
  EnvironmentalEventDirector,
  FLASH_FLOOD_MAX_CURRENT,
  FORM1_SWIM_SPEED_REF,
  LOBBY_EVENT_SCHEDULES,
  NET_ENTANGLE_DURATION,
  NET_ENTANGLE_SPEED_MULT,
  SILT_BLOOM_MIN_READABLE_RANGE,
  WHIRLPOOL_MAX_PULL_SPEED,
  checkDriftingNetContact,
  evaluateSiltVisibilityMultiplier,
  evaluateWorldEventForce,
  isValidDeepWhirlpoolSite,
  isValidDriftNetRoute,
  isValidWaterEventSite,
} from '../src/game/environmentalEvents.ts';
import { RemoteSimulationView } from '../src/game/multiplayerClient.ts';
import { GameSimulation, TOTAL_MATCH_FRAGMENTS } from '../src/game/simulation.ts';
import type { LobbySize, ZoneState } from '../src/game/types.ts';
import {
  FLOOD_STREAK_COUNT,
  SILT_PUFF_COUNT,
  WHIRLPOOL_DEBRIS_COUNT,
  WorldEventVfxPool,
} from '../src/game/worldEventVfx.ts';

function makeDefaultZone(radius = 2200): ZoneState {
  return {
    centerX: WORLD_CENTER,
    centerZ: WORLD_CENTER,
    currentRadius: radius,
    targetRadius: radius,
    phase: 1,
    warningTimer: 25,
    isShrinking: false,
    warningActive: false,
  };
}

function findDeepWaterPoint(zone?: ZoneState): { x: number; z: number } {
  const cx = zone ? zone.centerX : WORLD_CENTER;
  const cz = zone ? zone.centerZ : WORLD_CENTER;
  for (let r = 0; r <= 900; r += 60) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (isValidDeepWhirlpoolSite(x, z, zone)) {
        return { x, z };
      }
    }
  }
  return { x: cx, z: cz };
}

function findWaterNearShore(): { x: number; z: number; toShoreAngle: number } {
  for (let x = 600; x < 5000; x += 45) {
    for (let z = 600; z < 5000; z += 45) {
      if (getTerrainAt(x, z) !== 'shallow' || !isPositionAccessible(x, z, 28, false)) continue;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const sx = x + Math.cos(a) * 52;
        const sz = z + Math.sin(a) * 52;
        if (getTerrainAt(sx, sz) === 'shore') {
          return { x, z, toShoreAngle: a };
        }
      }
    }
  }
  throw new Error('Could not locate shallow water adjacent to shore');
}

// 1. Seeded event determinism
test('1. Seeded event determinism: identical seeds produce identical event schedule and geometry', () => {
  const zone = makeDefaultZone();
  const dirA = new EnvironmentalEventDirector({ lobbySize: 20, matchSeed: 424242 });
  const dirB = new EnvironmentalEventDirector({ lobbySize: 20, matchSeed: 424242 });

  const logA: string[] = [];
  const logB: string[] = [];

  for (let t = 0; t < 160; t += 0.5) {
    const resA = dirA.step(0.5, t, zone, t < 50 ? 'early' : 'mid', 12, false, false);
    const resB = dirB.step(0.5, t, zone, t < 50 ? 'early' : 'mid', 12, false, false);
    if (resA.phaseJustChanged && resA.activeEvent) {
      logA.push(
        `${t.toFixed(1)}:${resA.activeEvent.kind}:${resA.activeEvent.phase}:${Math.round(resA.activeEvent.x)},${Math.round(resA.activeEvent.z)}`
      );
    }
    if (resB.phaseJustChanged && resB.activeEvent) {
      logB.push(
        `${t.toFixed(1)}:${resB.activeEvent.kind}:${resB.activeEvent.phase}:${Math.round(resB.activeEvent.x)},${Math.round(resB.activeEvent.z)}`
      );
    }
  }

  assert.ok(logA.length >= 4, 'Expected multiple deterministic event phase transitions');
  assert.deepEqual(logA, logB, 'Identical seeds must produce identical event schedules');
});

// 2. Valid event positioning
test('2. Valid event positioning: all four events spawn on valid water terrain', () => {
  const zone = makeDefaultZone();
  const dir = new EnvironmentalEventDirector({ lobbySize: 25, matchSeed: 9091 });

  for (const kind of ALL_WORLD_EVENT_KINDS) {
    const ev = dir.triggerEventNow(kind, 45, zone);
    assert.ok(ev, `Expected ${kind} to resolve a valid position`);

    if (kind === 'whirlpool') {
      assert.equal(getTerrainAt(ev.x, ev.z), 'deep', 'Whirlpool must spawn strictly in deep water');
      assert.ok(isValidDeepWhirlpoolSite(ev.x, ev.z, zone), 'Whirlpool must pass deep-water & clearance check');
    } else if (kind === 'drifting_net') {
      assert.ok(
        isValidDriftNetRoute(ev.startX, ev.startZ, ev.endX, ev.endZ, zone),
        'Drifting net route must traverse unobstructed open water away from narrow gates'
      );
    } else {
      assert.ok(
        isValidWaterEventSite(ev.x, ev.z, zone),
        `${kind} must spawn in accessible water inside safe zone`
      );
    }
  }
});

// 3. Warning-to-active transitions
test('3. Lifecycle transitions cleanly through WARNING -> ACTIVE -> DISSIPATING -> COMPLETE', () => {
  const zone = makeDefaultZone();
  const dir = new EnvironmentalEventDirector({ lobbySize: 10, matchSeed: 1337 });
  const ev = dir.triggerEventNow('flash_flood', 30, zone, { startPhase: 'warning' });
  assert.ok(ev);
  assert.equal(ev.phase, 'warning');

  const phasesSeen: string[] = ['warning'];
  let t = 30;
  for (let i = 0; i < 400; i++) {
    t += 0.1;
    const res = dir.step(0.1, t, zone, 'early', 8, false, false);
    if (res.phaseJustChanged && res.newPhase) {
      phasesSeen.push(res.newPhase);
    }
    if (res.eventJustCompleted) break;
  }

  assert.deepEqual(phasesSeen, ['warning', 'active', 'dissipating', 'complete']);
});

// 4. Event expiry and cleanup
test('4. Event expiry clears active event and restores neutral physics/visibility', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', { matchSeed: 5511, emitLocalSound: false });
  const ev = sim.triggerWorldEvent('silt_bloom', { startPhase: 'active' });
  assert.ok(ev);
  assert.equal(sim.activeWorldEvent?.kind, 'silt_bloom');

  // Step past active + dissipation duration (GameSimulation clamps dt <= 0.05s)
  for (let i = 0; i < 420; i++) {
    sim.step(0.05);
    if (!sim.activeWorldEvent) break;
  }

  assert.equal(sim.activeWorldEvent, null, 'Expired event must be cleaned up to null');
  assert.equal(sim.eventDirector.getCompletedCount(), 1);
  const f = evaluateWorldEventForce(sim.activeWorldEvent, WORLD_CENTER, WORLD_CENTER, false, 1);
  assert.equal(f.vx, 0);
  assert.equal(f.vz, 0);
  assert.equal(
    evaluateSiltVisibilityMultiplier(sim.activeWorldEvent, WORLD_CENTER, WORLD_CENTER),
    1.0
  );
});

// 5. Flash flood movement influence
test('5. Kepala Air (Flash Flood): current falls within 15-35% of Form 1 swim speed and pushes water Kelis only', () => {
  const sim = new GameSimulation(10, 'royale', 'Swimmer', { matchSeed: 7001, emitLocalSound: false });
  const p = sim.getPlayer();
  const site = findDeepWaterPoint();
  p.x = site.x;
  p.z = site.z;
  p.isOnShore = false;
  p.vx = 0;
  p.vz = 0;

  const ev = sim.triggerWorldEvent('flash_flood', {
    startPhase: 'active',
    overridePos: { x: site.x, z: site.z, angle: 0 },
  });
  assert.ok(ev);

  const sample = evaluateWorldEventForce(ev, p.x, p.z, false, 1);
  const ratio = Math.hypot(sample.vx, sample.vz) / FORM1_SWIM_SPEED_REF;
  assert.ok(ratio >= 0.15 && ratio <= 0.35, `Expected flood force 15-35% of Form 1 swim speed, got ${(ratio * 100).toFixed(1)}%`);
  assert.ok(sample.vx > 0, 'Flow angle 0 must push in +X direction');

  // Must NOT affect land-borne Kelis
  const shoreSample = evaluateWorldEventForce(ev, p.x, p.z, true, 3);
  assert.equal(shoreSample.vx, 0);
  assert.equal(shoreSample.vz, 0);

  // Verify actual displacement in simulation
  const startX = p.x;
  for (let i = 0; i < 15; i++) {
    sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
    sim.step(0.05);
  }
  assert.ok(p.x > startX + 12, `Expected downstream flash flood drift (+X), delta=${(p.x - startX).toFixed(1)}`);
});

// 6. Flash flood obstacle collision
test('6. Flash flood obstacle collision: current slides Kelis safely around rock obstacles without penetration', () => {
  const sim = new GameSimulation(10, 'royale', 'RockTest', { matchSeed: 7002, emitLocalSound: false });
  const p = sim.getPlayer();
  // Find a rock surrounded by accessible water on its west side
  const rock = OBSTACLES.find((o) =>
    isPositionAccessible(o.x - o.radius - 32, o.z, 22, false)
  )!;
  assert.ok(rock, 'Expected an obstacle with accessible water beside it');

  p.x = rock.x - rock.radius - 28;
  p.z = rock.z;
  p.vx = 0;
  p.vz = 0;

  sim.triggerWorldEvent('flash_flood', {
    startPhase: 'active',
    overridePos: { x: rock.x, z: rock.z, angle: 0 },
  });

  const minAllowedDist = rock.radius + 12;
  for (let i = 0; i < 40; i++) {
    sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
    sim.step(0.05);
    const dist = Math.hypot(p.x - rock.x, p.z - rock.z);
    assert.ok(
      dist >= minAllowedDist,
      `Keli penetrated rock under flash flood (dist=${dist.toFixed(1)}, min=${minAllowedDist})`
    );
  }
});

// 7. Level 1-39 shoreline protection under flash flood
test('7. Level 1-39 shoreline protection: flash flood never pushes aquatic Keli onto prohibited shore', () => {
  const sim = new GameSimulation(10, 'royale', 'ShoreGuard', { matchSeed: 7003, emitLocalSound: false });
  const p = sim.getPlayer();
  p.level = 15; // Form 1 (Lv.1-39), strictly barred from shore
  const spot = findWaterNearShore();
  p.x = spot.x;
  p.z = spot.z;
  p.isOnShore = false;

  sim.triggerWorldEvent('flash_flood', {
    startPhase: 'active',
    overridePos: { x: spot.x, z: spot.z, angle: spot.toShoreAngle },
  });

  for (let i = 0; i < 50; i++) {
    sim.setInput({
      moveX: Math.cos(spot.toShoreAngle),
      moveZ: Math.sin(spot.toShoreAngle),
      aimAngle: spot.toShoreAngle,
      biteHeld: false,
    });
    sim.step(0.05);
    assert.notEqual(
      getTerrainAt(p.x, p.z),
      'shore',
      'Form 1 Keli must NEVER be pushed onto shore by Flash Flood'
    );
    assert.equal(p.isOnShore, false);
  }
});

// 8. Silt visual/perception restrictions
test('8. Air Keruh (Silt Bloom): reduces local visibility 40-60%, keeps close combat readable, stays localized', () => {
  const sim = new GameSimulation(10, 'royale', 'SiltTest', { matchSeed: 7004, emitLocalSound: false });
  sim.weather.kind = 'clear';
  sim.weather.visibilityRange = 1.0;

  const site = findDeepWaterPoint();
  const ev = sim.triggerWorldEvent('silt_bloom', {
    startPhase: 'active',
    overridePos: { x: site.x, z: site.z },
  });
  assert.ok(ev);

  const insideMult = evaluateSiltVisibilityMultiplier(ev, site.x, site.z, site.x + 120, site.z);
  assert.ok(insideMult >= 0.4 && insideMult <= 0.6, `Expected 0.40-0.60 mult, got ${insideMult}`);

  const outsideMult = evaluateSiltVisibilityMultiplier(
    ev,
    site.x + 1200,
    site.z + 1200,
    site.x + 1500,
    site.z + 1200
  );
  assert.equal(outsideMult, 1.0, 'Silt Bloom must stay strictly localized, never darkening arena-wide');

  const closeRange = sim.getEffectiveVisualRange(site.x, site.z, site.x + 90, site.z, 490);
  assert.ok(
    closeRange >= SILT_BLOOM_MIN_READABLE_RANGE && closeRange < 320,
    `Expected reduced sight with readable close-range floor (>=${SILT_BLOOM_MIN_READABLE_RANGE}), got ${closeRange}`
  );
});

// 9. Sonar and Silt Veil compatibility
test('9. Sonar and Silt Veil remain functional during active Silt Bloom', () => {
  const sim = new GameSimulation(10, 'royale', 'SonarUser', { matchSeed: 7005, emitLocalSound: false });
  const p = sim.getPlayer();
  const botVisible = sim.kelis[1];
  const botScanner = sim.kelis[2];
  const site = findDeepWaterPoint();

  p.level = 30; // Unlocks Echo Sonar
  p.x = site.x;
  p.z = site.z;
  p.sonarTimer = 5;
  p.sonarIsHunter = false;
  p.veilTimer = 4; // Silt Veil active on player

  botVisible.x = site.x + 280;
  botVisible.z = site.z;
  botVisible.veilTimer = 0;

  // Scanner bot right next to veiled player inside Silt Bloom
  botScanner.x = site.x + 110;
  botScanner.z = site.z;
  botScanner.sonarTimer = 0;
  botScanner.level = 35;

  // Move other bots far away
  for (let i = 3; i < sim.kelis.length; i++) {
    sim.kelis[i].x = site.x + 1500;
    sim.kelis[i].z = site.z + 1500;
  }

  sim.triggerWorldEvent('silt_bloom', {
    startPhase: 'active',
    overridePos: { x: site.x, z: site.z },
  });

  const hud = sim.getHudSnapshot();
  const contactIds = new Set(hud.sonarContacts.map((c) => c.id));
  assert.ok(contactIds.has(botVisible.id), 'Echo Sonar must still detect target during Silt Bloom');

  for (let i = 0; i < 10; i++) sim.step(0.05);
  assert.notEqual(
    botScanner.aiTargetId,
    p.id,
    'Silt Veil must continue concealing veiled Keli from enemy AI during Silt Bloom'
  );
});

// 10. Whirlpool force limits and escape
test('10. Pusaran Dalam (Deep Whirlpool): bounded pull, gentle outer rim, no instant kill, escapable via steering/Dash', () => {
  const sim = new GameSimulation(10, 'royale', 'VortexEscape', { matchSeed: 7006, emitLocalSound: false });
  const p = sim.getPlayer();
  p.level = 20;
  const site = findDeepWaterPoint();
  const ev = sim.triggerWorldEvent('whirlpool', {
    startPhase: 'active',
    overridePos: { x: site.x, z: site.z },
  });
  assert.ok(ev);

  const outerForce = evaluateWorldEventForce(ev, site.x + ev.radius * 0.92, site.z, false, 1);
  const innerForce = evaluateWorldEventForce(ev, site.x + ev.radius * 0.3, site.z, false, 1);
  const centerForce = evaluateWorldEventForce(ev, site.x, site.z, false, 1);

  assert.ok(
    Math.hypot(outerForce.vx, outerForce.vz) < Math.hypot(innerForce.vx, innerForce.vz),
    'Outer rim pull must be gentler than inner pull'
  );
  assert.ok(
    Math.hypot(innerForce.vx, innerForce.vz) <= WHIRLPOOL_MAX_PULL_SPEED + 25,
    'Whirlpool force must remain strictly bounded'
  );
  assert.equal(centerForce.vx, 0, 'Center must have zero singularity');

  // Place player inside inner band and steer radially outward to escape
  p.x = site.x + 110;
  p.z = site.z;
  const hpBefore = p.hp;
  for (let i = 0; i < 65; i++) {
    sim.setInput({ moveX: 1, moveZ: 0, aimAngle: 0, biteHeld: false });
    sim.step(0.05);
  }
  const distAfter = Math.hypot(p.x - site.x, p.z - site.z);
  assert.ok(p.alive && p.hp >= hpBefore - 1, 'Whirlpool must never instant-kill or deal vortex damage');
  assert.ok(distAfter > ev.radius, `Expected Keli to steer free of whirlpool (dist=${distAfter.toFixed(1)}, r=${ev.radius})`);
});

// 11. Net collision and recovery
test('11. Jaring Hanyut (Drifting Net): 35-50% slowdown for 0.4-0.8s, zero direct HP damage, Dash/Evade escapes', () => {
  const sim = new GameSimulation(10, 'royale', 'NetRunner', { matchSeed: 7007, emitLocalSound: false });
  const p = sim.getPlayer();
  p.level = 15;
  const site = findDeepWaterPoint();
  p.x = site.x;
  p.z = site.z;
  p.isOnShore = false;
  p.hp = p.maxHp;

  const ev = sim.triggerWorldEvent('drifting_net', {
    startPhase: 'active',
    overridePos: { x: site.x, z: site.z, angle: 0, endX: site.x + 600, endZ: site.z },
  });
  assert.ok(ev);
  assert.ok(checkDriftingNetContact(ev, p.x, p.z, 20, false));

  assert.ok(NET_ENTANGLE_DURATION >= 0.4 && NET_ENTANGLE_DURATION <= 0.8);
  const slowPct = 1 - NET_ENTANGLE_SPEED_MULT;
  assert.ok(slowPct >= 0.35 && slowPct <= 0.5, `Expected 35-50% net slowdown, got ${(slowPct * 100).toFixed(1)}%`);

  sim.step(0.05);
  assert.ok((p.netEntangleTimer ?? 0) > 0, 'Drifting net contact must apply bounded netEntangleTimer');
  assert.ok((p.netImmunityTimer ?? 0) > 1.0, 'Drifting net contact must grant temporary repeat immunity');
  assert.equal(p.hp, p.maxHp, 'Drifting net must NEVER deal direct HP damage');

  // Slip Evade immediately breaks entanglement
  p.stamina = 100;
  sim.triggerPlayerAbility('evade');
  assert.equal(p.netEntangleTimer ?? 0, 0, 'Slip Evade must cleanly break net entanglement');
});

// 12. No permanent entanglement & separation from Update 02 stun system
test('12. Net entanglement expires cleanly, prevents re-snag loop, and never touches Update 02 stun state', () => {
  const sim = new GameSimulation(10, 'royale', 'NoStunConflict', { matchSeed: 7008, emitLocalSound: false });
  const p = sim.getPlayer();
  const site = findDeepWaterPoint();
  p.x = site.x;
  p.z = site.z;
  p.stunTimer = 0;
  p.stunStacks = 0;
  p.stunResistTimer = 0;

  sim.triggerWorldEvent('drifting_net', {
    startPhase: 'active',
    overridePos: { x: site.x, z: site.z, angle: 0, endX: site.x + 300, endZ: site.z },
  });

  sim.step(0.05);
  assert.ok((p.netEntangleTimer ?? 0) > 0);
  assert.equal(p.stunTimer, 0, 'Net entanglement must NOT set stunTimer');
  assert.equal(p.stunStacks, 0, 'Net entanglement must NOT alter stunStacks');
  assert.equal(p.stunResistTimer, 0, 'Net entanglement must NOT consume stunResistTimer');

  // Step 1.0s while tracking net center -> must recover and NOT immediately re-snag due to immunity
  for (let i = 0; i < 20; i++) {
    if (sim.activeWorldEvent) {
      p.x = sim.activeWorldEvent.x;
      p.z = sim.activeWorldEvent.z;
    }
    sim.step(0.05);
  }
  assert.equal(p.netEntangleTimer ?? 0, 0, 'Entanglement must expire cleanly without permanent immobilization');
  assert.ok((p.netImmunityTimer ?? 0) > 1.5, 'Temporary immunity must still prevent immediate re-entanglement');
});

// 13. Combat under active events
test('13. Directional bite combat functions cleanly under active Flash Flood & Whirlpool', () => {
  const sim = new GameSimulation(10, 'royale', 'Fighter', { matchSeed: 7009, emitLocalSound: false });
  const p = sim.getPlayer();
  const foe = sim.kelis[1];
  const site = findDeepWaterPoint();

  p.level = 20;
  foe.level = 10;
  p.x = site.x;
  p.z = site.z;
  foe.x = site.x + 48;
  foe.z = site.z;
  p.facingAngle = 0;
  const foeHpBefore = foe.hp;

  sim.triggerWorldEvent('whirlpool', {
    startPhase: 'active',
    overridePos: { x: site.x + 80, z: site.z },
  });

  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  for (let i = 0; i < 12; i++) {
    sim.step(0.05);
  }
  assert.ok(foe.hp < foeHpBefore, 'Directional bite must land damage properly during active whirlpool');
});

// 14. Feeding under active events
test('14. Progressive carcass feeding transfers fragments cleanly during active world event', () => {
  const sim = new GameSimulation(5, 'royale', 'Feeder', { matchSeed: 7010, emitLocalSound: false });
  const p = sim.getPlayer();
  const site = findDeepWaterPoint(sim.zone);
  p.x = site.x;
  p.z = site.z;
  // Move bots far away so no combat interruption
  for (let i = 1; i < sim.kelis.length; i++) {
    sim.kelis[i].x = site.x + 1200;
    sim.kelis[i].z = site.z + 1200;
  }

  // Convert one bot cleanly into a conserved carcass right beside player
  const victim = sim.kelis[1];
  const victimLevel = victim.level;
  victim.alive = false;
  victim.level = 0;
  const carc = {
    id: 'carc_event_feed',
    x: p.x + 28,
    z: p.z,
    mass: victimLevel,
    initialMass: victimLevel,
    evolutionPhaseAtDeath: 1 as const,
    sourceName: victim.name,
    createdAt: 0,
    bobPhase: 0,
    consumed: false,
    relocated: false,
  };
  sim.carcasses.push(carc);

  sim.triggerWorldEvent('silt_bloom', {
    startPhase: 'active',
    overridePos: { x: site.x, z: site.z },
  });

  const lvlBefore = p.level;
  for (let i = 0; i < 120; i++) {
    sim.setInput({
      moveX: 0,
      moveZ: 0,
      aimAngle: Math.atan2(carc.z - p.z, carc.x - p.x),
      biteHeld: true,
    });
    sim.step(0.05);
    if (carc.consumed) break;
  }

  assert.ok(p.level > lvlBefore, 'Player must gain fragments while feeding during active event');
  assert.equal(p.level - lvlBefore + (carc.consumed ? 0 : carc.mass), victimLevel);
});

// 15. Carcass accessibility under active events
test('15. Carcasses remain accessible and fragment-conserved under Flash Flood & Whirlpool drift', () => {
  const sim = new GameSimulation(5, 'royale', 'Scavenger', { matchSeed: 7011, emitLocalSound: false });
  const site = findDeepWaterPoint();
  const bot = sim.kelis[1];
  const botMass = bot.level;
  bot.alive = false;
  bot.level = 0;
  sim.carcasses.push({
    id: 'carc_drift_test',
    x: site.x,
    z: site.z,
    mass: botMass,
    initialMass: botMass,
    evolutionPhaseAtDeath: 1,
    sourceName: bot.name,
    createdAt: 0,
    bobPhase: 0,
    consumed: false,
    relocated: false,
  });

  sim.triggerWorldEvent('flash_flood', {
    startPhase: 'active',
    overridePos: { x: site.x, z: site.z, angle: 0.4 },
  });

  for (let i = 0; i < 60; i++) {
    sim.step(0.05);
  }

  const carc = sim.carcasses.find((c) => c.id === 'carc_drift_test');
  assert.ok(carc);
  assert.ok(
    isPositionAccessible(carc.x, carc.z, 14, false),
    'Carcass must remain accessible in water under Flash Flood drift'
  );
  const hud = sim.getHudSnapshot();
  assert.equal(hud.livingMassSum + hud.carcassMassSum, TOTAL_MATCH_FRAGMENTS);
});

// 16. AI event awareness & personality differences
test('16. AI obeys Silt Bloom visibility limits fairly and reacts differently by personality', () => {
  const sim = new GameSimulation(20, 'royale', 'Observer', { matchSeed: 7012, emitLocalSound: false });
  const site = findDeepWaterPoint();

  // Place a bot inside a whirlpool and verify cautious_survivor avoids it proactively
  const cautiousBot = sim.kelis.find((k) => !k.isPlayer && k.aiPersonality === 'cautious_survivor')!;
  const hunterBot = sim.kelis.find((k) => !k.isPlayer && k.aiPersonality === 'aggressive_hunter')!;
  assert.ok(cautiousBot && hunterBot, 'Expected cautious_survivor and aggressive_hunter bots');

  cautiousBot.x = site.x + 210;
  cautiousBot.z = site.z;
  cautiousBot.isOnShore = false;
  cautiousBot.hp = cautiousBot.maxHp;

  hunterBot.x = site.x + 210;
  hunterBot.z = site.z + 25;
  hunterBot.isOnShore = false;
  hunterBot.hp = hunterBot.maxHp;

  sim.triggerWorldEvent('whirlpool', {
    startPhase: 'warning',
    overridePos: { x: site.x, z: site.z },
  });

  // Step a few ticks while in WARNING phase (dangerScore ~ 35-48: cautious evades, hunter holds)
  for (let i = 0; i < 8; i++) {
    sim.step(0.05);
  }
  assert.equal(
    cautiousBot.aiState,
    'RETREAT',
    `Expected cautious_survivor to evade warning whirlpool, got ${cautiousBot.aiState}`
  );
  assert.ok(
    cautiousBot.aiTargetLabel?.includes('PUSARAN DALAM'),
    `Expected cautious bot label to reference whirlpool, got ${cautiousBot.aiTargetLabel}`
  );

  // Verify Silt Bloom limits AI perception fairly: distant bot at 380u inside silt cannot be spotted without sonar
  const siltSim = new GameSimulation(10, 'royale', 'HiddenTarget', { matchSeed: 7013, emitLocalSound: false });
  const target = siltSim.getPlayer();
  const scanner = siltSim.kelis[1];
  target.x = site.x + 370;
  target.z = site.z;
  scanner.x = site.x;
  scanner.z = site.z;
  scanner.sonarTimer = 0;
  scanner.level = 10;
  target.level = 10;
  // Move other bots far away
  for (let i = 2; i < siltSim.kelis.length; i++) {
    siltSim.kelis[i].x = site.x + 1500;
    siltSim.kelis[i].z = site.z + 1500;
  }

  siltSim.triggerWorldEvent('silt_bloom', {
    startPhase: 'active',
    overridePos: { x: site.x + 180, z: site.z },
  });

  for (let i = 0; i < 12; i++) siltSim.step(0.05);
  assert.notEqual(
    scanner.aiTargetId,
    target.id,
    'AI without sonar must not spot a 370u target through active Silt Bloom'
  );
});

// 17. Lobby-size scheduling
test('17. Lobby-size scheduling adapts cleanly across 5, 10, 20, 25, 50, and 100 lobbies', () => {
  const sizes: LobbySize[] = [5, 10, 20, 25, 50, 100];
  for (const size of sizes) {
    const profile = LOBBY_EVENT_SCHEDULES[size];
    assert.equal(profile.maxConcurrentEvents, 1, `Lobby ${size} must cap at 1 concurrent event`);
    const dir = new EnvironmentalEventDirector({ lobbySize: size, matchSeed: 8800 + size });
    const firstTime = dir.getNextScheduledTime();
    assert.ok(
      firstTime >= profile.firstEventMinSec && firstTime <= profile.firstEventMaxSec,
      `Lobby ${size} first event time ${firstTime.toFixed(1)}s out of bounds`
    );
  }
  // Short lobbies (5/10) trigger first event earlier than 100-Keli matches so short matches experience one
  assert.ok(
    LOBBY_EVENT_SCHEDULES[5].firstEventMaxSec < LOBBY_EVENT_SCHEDULES[100].firstEventMinSec,
    'Short 5-Keli matches should schedule first event earlier than 100-Keli matches'
  );
});

// 18. MatchPacingDirector compatibility
test('18. MatchPacingDirector & EnvironmentalEventDirector cooperate with strictly 1 active event max', () => {
  const sim = new GameSimulation(20, 'royale', 'PacingTest', { matchSeed: 7018, emitLocalSound: false });
  let sawEvent = false;
  for (let i = 0; i < 1100; i++) {
    sim.step(0.05);
    if (sim.status !== 'playing') break;
    if (sim.activeWorldEvent) {
      sawEvent = true;
      assert.ok(
        ALL_WORLD_EVENT_KINDS.includes(sim.activeWorldEvent.kind),
        'Active event kind must be valid'
      );
      break;
    }
  }
  const metrics = sim.getPacingMetrics();
  assert.ok(sawEvent, '20-Keli match should trigger at least one dynamic event within 60s');
  assert.ok(metrics.lobbySize === 20);
  assert.ok(sim.zone.currentRadius > 0);
});

// 19. Final Feast suppression
test('19. Final Feast suppresses new world events and cleanly clears/dissipates pending ones', () => {
  const sim = new GameSimulation(5, 'royale', 'LastSurvivor', { matchSeed: 7019, emitLocalSound: false });
  const p = sim.getPlayer();
  const site = findDeepWaterPoint();
  p.x = site.x;
  p.z = site.z;

  // Trigger a warning event, then drop to 1 living Keli with unclaimed carcasses -> Final Feast
  sim.triggerWorldEvent('whirlpool', { startPhase: 'warning', overridePos: { x: site.x, z: site.z } });
  assert.ok(sim.activeWorldEvent);

  for (let i = 1; i < sim.kelis.length; i++) {
    const b = sim.kelis[i];
    const m = b.level;
    b.alive = false;
    b.level = 0;
    sim.carcasses.push({
      id: `ff_carc_${i}`,
      x: site.x + 250 + i * 30,
      z: site.z,
      mass: m,
      initialMass: m,
      evolutionPhaseAtDeath: 1,
      sourceName: b.name,
      createdAt: sim.matchTime,
      bobPhase: 0,
      consumed: false,
      relocated: false,
    });
  }

  // Step to activate Final Feast and cancel warning event
  for (let i = 0; i < 6; i++) sim.step(0.1);
  assert.equal(sim.finalFeastActive, true, 'Final Feast should be active');
  assert.equal(sim.activeWorldEvent, null, 'Warning event must be cancelled during Final Feast');

  // Attempting to trigger a new event during Final Feast is blocked
  const blocked = sim.triggerWorldEvent('flash_flood', { startPhase: 'warning' });
  assert.equal(blocked, null, 'New world events must be suppressed during Final Feast');
});

// 20. Post-victory event termination
test('20. Post-victory event termination clears active event immediately on Level 100 ascension', () => {
  const sim = new GameSimulation(5, 'royale', 'KingAwang', { matchSeed: 7020, emitLocalSound: false });
  const p = sim.getPlayer();
  const site = findDeepWaterPoint();
  p.x = site.x;
  p.z = site.z;

  sim.triggerWorldEvent('flash_flood', {
    startPhase: 'active',
    overridePos: { x: site.x, z: site.z, angle: 0 },
  });
  assert.ok(sim.activeWorldEvent);

  // Give player all 100 fragments cleanly to trigger authoritative Level 100 victory
  let total = p.level;
  for (let i = 1; i < sim.kelis.length; i++) {
    total += sim.kelis[i].level;
    sim.kelis[i].alive = false;
    sim.kelis[i].level = 0;
  }
  p.level = total;
  assert.equal(p.level, TOTAL_MATCH_FRAGMENTS);

  sim.step(0.05);
  assert.equal(sim.status, 'victory');
  assert.equal(sim.activeWorldEvent, null, 'Active world event must terminate immediately on victory');

  // Subsequent ticks must never respawn an event post-victory
  for (let i = 0; i < 20; i++) sim.step(0.1);
  assert.equal(sim.activeWorldEvent, null);
});

// 21. Multiplayer authoritative synchronization
test('21. Multiplayer authoritative synchronization replicates worldEvent and rejects stale packets', () => {
  const sim = new GameSimulation(10, 'royale', 'HostKeli', {
    matchSeed: 7021,
    emitLocalSound: false,
    isMultiplayerMatch: true,
    humanEntrants: [
      { id: 'p1', name: 'HostKeli' },
      { id: 'p2', name: 'GuestKeli' },
    ],
  });
  const site = findDeepWaterPoint();
  sim.triggerWorldEvent('whirlpool', {
    startPhase: 'warning',
    overridePos: { x: site.x, z: site.z },
  });

  const client1 = new RemoteSimulationView('p1');
  const client2 = new RemoteSimulationView('p2');

  const pktWarn = sim.getRemoteWorldStateFor('p1', 10);
  const pktWarn2 = sim.getRemoteWorldStateFor('p2', 10);
  client1.applyServerState(pktWarn);
  client2.applyServerState(pktWarn2);

  assert.equal(client1.activeWorldEvent?.kind, 'whirlpool');
  assert.equal(client2.activeWorldEvent?.kind, 'whirlpool');
  assert.equal(client1.activeWorldEvent?.phase, 'warning');
  assert.equal(client1.activeWorldEvent?.seq, client2.activeWorldEvent?.seq);

  // Advance past warning duration (5.5s = 110+ ticks at 0.05s) into active phase
  for (let i = 0; i < 130; i++) sim.step(0.05);
  const pktActive = sim.getRemoteWorldStateFor('p1', 140);
  client1.applyServerState(pktActive);
  assert.equal(client1.activeWorldEvent?.phase, 'active');

  // Re-applying stale packet (tick 10) must be ignored so event never regresses to warning
  client1.applyServerState(pktWarn);
  assert.equal(
    client1.activeWorldEvent?.phase,
    'active',
    'Stale packets must never overwrite newer authoritative worldEvent state'
  );
});

// 22. Strict 100-fragment conservation across all 4 events
test('22. Strict integer 100-fragment conservation holds across all four active events', () => {
  for (const kind of ALL_WORLD_EVENT_KINDS) {
    const sim = new GameSimulation(20, 'royale', `Conserve_${kind}`, {
      matchSeed: 7022 + kind.length,
      emitLocalSound: false,
    });
    sim.triggerWorldEvent(kind, { startPhase: 'active' });

    for (let i = 0; i < 120; i++) {
      sim.step(0.05);
      if (sim.status !== 'playing') break;
    }

    const hud = sim.getHudSnapshot();
    assert.equal(
      hud.livingMassSum + hud.carcassMassSum,
      TOTAL_MATCH_FRAGMENTS,
      `Fragment conservation violated during ${kind}: living=${hud.livingMassSum}, carcass=${hud.carcassMassSum}`
    );
    for (const k of sim.kelis) {
      assert.equal(k.level, Math.trunc(k.level), 'Keli levels must remain strict integers');
    }
    for (const c of sim.carcasses) {
      assert.equal(c.mass, Math.trunc(c.mass), 'Carcass masses must remain strict integers');
    }
  }
});

// 23. 100-Keli performance (with vs. without active events)
test('23. 100-Keli 60-tick performance stays smooth with and without active world events', () => {
  const runBench = (kind: typeof ALL_WORLD_EVENT_KINDS[number] | null): number => {
    const sim = new GameSimulation(100, 'royale', 'BenchKeli', {
      matchSeed: 7023,
      emitLocalSound: false,
    });
    if (kind === null) {
      sim.eventDirector.enabled = false;
    } else {
      sim.triggerWorldEvent(kind, { startPhase: 'active' });
    }
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) {
      sim.step(1 / 30);
    }
    return performance.now() - t0;
  };

  const baselineMs = runBench(null);
  const floodMs = runBench('flash_flood');
  const siltMs = runBench('silt_bloom');
  const whirlpoolMs = runBench('whirlpool');
  const netMs = runBench('drifting_net');

  console.log(
    `[Perf 100-Keli 60-tick] baseline=${baselineMs.toFixed(1)}ms | flood=${floodMs.toFixed(1)}ms | silt=${siltMs.toFixed(1)}ms | whirlpool=${whirlpoolMs.toFixed(1)}ms | net=${netMs.toFixed(1)}ms`
  );

  // Generous CI ceiling (1500ms for 60 ticks = 25ms/tick) while verifying no regression
  assert.ok(floodMs < 1500, `Flash flood 100-Keli bench too slow: ${floodMs.toFixed(1)}ms`);
  assert.ok(siltMs < 1500, `Silt bloom 100-Keli bench too slow: ${siltMs.toFixed(1)}ms`);
  assert.ok(whirlpoolMs < 1500, `Whirlpool 100-Keli bench too slow: ${whirlpoolMs.toFixed(1)}ms`);
  assert.ok(netMs < 1500, `Drifting net 100-Keli bench too slow: ${netMs.toFixed(1)}ms`);
});

// 24. Event VFX resource cleanup
test('24. WorldEventVfxPool enforces fixed pool bounds, culls offscreen, and disposes cleanly', () => {
  const scene = new THREE.Scene();
  const pool = new WorldEventVfxPool(scene);
  const initSummary = pool.getSummary();

  assert.equal(initSummary.disposed, false);
  assert.equal(initSummary.floodStreakCapacity, FLOOD_STREAK_COUNT);
  assert.equal(initSummary.siltPuffCapacity, SILT_PUFF_COUNT);
  assert.equal(initSummary.whirlpoolDebrisCapacity, WHIRLPOOL_DEBRIS_COUNT);
  assert.ok(initSummary.geometriesTracked >= 8);
  assert.ok(initSummary.materialsTracked >= 8);

  const dir = new EnvironmentalEventDirector({ lobbySize: 20, matchSeed: 7024 });
  const zone = makeDefaultZone();

  // Exercise all 4 event types near camera & offscreen + reducedMotion
  for (const kind of ALL_WORLD_EVENT_KINDS) {
    const ev = dir.triggerEventNow(kind, 40, zone, { startPhase: 'active' });
    assert.ok(ev);
    pool.update(ev, 12.5, (ev.x - WORLD_CENTER) * 0.1, (ev.z - WORLD_CENTER) * 0.1, false);
    assert.equal(pool.getSummary().visible, true, `${kind} VFX should be visible near camera`);
    assert.equal(pool.getSummary().activeKind, kind);

    // Offscreen culling check
    pool.update(ev, 13.0, 9999, 9999, true);
    assert.equal(pool.getSummary().visible, false, `${kind} VFX should cull when far offscreen`);
  }

  // Null event hides pool cleanly
  pool.update(null, 14.0, 0, 0, false);
  assert.equal(pool.getSummary().visible, false);

  // Disposal clears all tracked GPU resources and detaches from scene
  pool.dispose();
  const afterDispose = pool.getSummary();
  assert.equal(afterDispose.disposed, true);
  assert.equal(afterDispose.geometriesTracked, 0);
  assert.equal(afterDispose.materialsTracked, 0);
  assert.equal(afterDispose.texturesTracked, 0);
  assert.equal(scene.children.length, 0, 'Root VFX group must be removed from scene on dispose');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  advanceActorAnim,
  AnimatableKeliState,
  applyFrameUVsToGeometry,
  computeFrameUVs,
  computeKeliWaterSubmersion,
  createActorAnimState,
  createActorSpriteGeometry,
  EvolutionPhase,
  getEvolutionPhaseForLevel,
  getSpriteSheetMeta,
  resolveActorAnimIntent,
  SPRITE_ANIM_CONFIG,
  SPRITE_GRID_COLS,
  SPRITE_GRID_ROWS,
  SPRITE_ROW_BY_ACTION,
} from '../src/game/spriteAnimation';
import {
  BITE_RECOVERY_SEC,
  BITE_STRIKE_SEC,
  BITE_WINDUP_SEC,
  GameSimulation,
} from '../src/game/simulation';

function makeActor(overrides: Partial<AnimatableKeliState> = {}): AnimatableKeliState {
  return {
    level: 1,
    alive: true,
    vx: 0,
    vz: 0,
    isOnShore: false,
    stunTimer: 0,
    feedingTargetId: null,
    bitePhase: 'idle',
    bitePhaseTimer: 0,
    biteAttackSeq: 0,
    evadeTimer: 0,
    dashTimer: 0,
    ...overrides,
  };
}

test('Processed WebP sprite sheets exist, meet 200-550 KB size budget, and have clean alpha with zero cell-border clipping', () => {
  const phases: EvolutionPhase[] = [1, 2, 3];
  for (const phase of phases) {
    const meta = getSpriteSheetMeta(phase);
    const fullPath = path.resolve(process.cwd(), 'public', meta.assetPath);
    assert.ok(fs.existsSync(fullPath), `Missing sprite sheet ${fullPath}`);

    const stat = fs.statSync(fullPath);
    const kb = stat.size / 1024;
    assert.ok(kb >= 100 && kb <= 550, `Phase ${phase} WebP size ${kb.toFixed(1)} KB outside target range`);

    // Verify RIFF WEBP header
    const header = fs.readFileSync(fullPath).subarray(0, 12).toString('ascii');
    assert.equal(header.slice(0, 4), 'RIFF');
    assert.equal(header.slice(8, 12), 'WEBP');

    // Decode raw RGBA via ffmpeg and verify exact dimensions, clean transparent margins, and dark outline preservation
    const rgba = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-i', fullPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    assert.equal(
      rgba.length,
      meta.atlasWidth * meta.atlasHeight * 4,
      `Phase ${phase} decoded RGBA byte length must match ${meta.atlasWidth}x${meta.atlasHeight}`
    );

    const alphaAt = (x: number, y: number) => rgba[(y * meta.atlasWidth + x) * 4 + 3];

    // Check every single one of the 24 cells for clean outer borders (zero clipping / zero bleed)
    let opaqueDarkPixels = 0;
    for (let r = 0; r < SPRITE_GRID_ROWS; r++) {
      for (let c = 0; c < SPRITE_GRID_COLS; c++) {
        const x0 = c * meta.cellWidth;
        const y0 = r * meta.cellHeight;
        const x1 = x0 + meta.cellWidth - 1;
        const y1 = y0 + meta.cellHeight - 1;

        for (let x = x0; x <= x1; x++) {
          assert.equal(alphaAt(x, y0), 0, `Phase ${phase} cell (${r},${c}) clipped at top border x=${x}`);
          assert.equal(alphaAt(x, y1), 0, `Phase ${phase} cell (${r},${c}) clipped at bottom border x=${x}`);
        }
        for (let y = y0; y <= y1; y++) {
          assert.equal(alphaAt(x0, y), 0, `Phase ${phase} cell (${r},${c}) clipped at left border y=${y}`);
          assert.equal(alphaAt(x1, y), 0, `Phase ${phase} cell (${r},${c}) clipped at right border y=${y}`);
        }

        // Verify cell actually contains visible sprite pixels (non-empty)
        let cellOpaque = 0;
        for (let y = y0 + 1; y < y1; y++) {
          for (let x = x0 + 1; x < x1; x++) {
            const idx = (y * meta.atlasWidth + x) * 4;
            if (rgba[idx + 3] > 200) {
              cellOpaque++;
              if (rgba[idx] < 35 && rgba[idx + 1] < 35 && rgba[idx + 2] < 35) {
                opaqueDarkPixels++;
              }
            }
          }
        }
        assert.ok(cellOpaque > 1500, `Phase ${phase} cell (${r},${c}) has too few opaque pixels (${cellOpaque})`);
      }
    }

    // Confirm dark outlines & glossy black catfish eyes were NOT stripped by alpha cleanup
    assert.ok(
      opaqueDarkPixels > 10000,
      `Phase ${phase} dark outline/eye pixel count unexpectedly low (${opaqueDarkPixels})`
    );
  }
});

test('Evolution phase mapping covers all levels 1-100 accurately without legs in Phase 2', () => {
  for (let lv = 1; lv <= 39; lv++) {
    assert.equal(getEvolutionPhaseForLevel(lv), 1, `Lv.${lv} must map to Phase 1`);
  }
  for (let lv = 40; lv <= 79; lv++) {
    assert.equal(getEvolutionPhaseForLevel(lv), 2, `Lv.${lv} must map to Phase 2`);
  }
  for (let lv = 80; lv <= 100; lv++) {
    assert.equal(getEvolutionPhaseForLevel(lv), 3, `Lv.${lv} must map to Phase 3`);
  }
});

test('Animation priority strictly enforces Death > Stunned > Feeding > Attacking > Moving/Evade > Idle', () => {
  // 1. Dead
  assert.equal(
    resolveActorAnimIntent(
      makeActor({ alive: false, stunTimer: 1, feedingTargetId: 'c1', bitePhase: 'strike', vx: 120 }),
      1
    ).paused,
    true
  );

  // 2. Stunned overrides feeding, attacking, moving
  assert.equal(
    resolveActorAnimIntent(
      makeActor({ stunTimer: 0.5, feedingTargetId: 'c1', bitePhase: 'strike', vx: 120 }),
      2
    ).paused,
    true
  );

  // 3. Feeding overrides attacking & moving
  assert.equal(
    resolveActorAnimIntent(
      makeActor({ feedingTargetId: 'carc-1', bitePhase: 'windup', vx: 80 }),
      2
    ).action,
    'feed'
  );

  // 4. Attacking overrides moving & evade
  assert.equal(
    resolveActorAnimIntent(
      makeActor({ bitePhase: 'strike', vx: 140, evadeTimer: 0.1 }),
      3
    ).action,
    'attack'
  );

  // 5. Slip Evade uses movement row at accelerated speed
  const evadeIntent = resolveActorAnimIntent(makeActor({ evadeTimer: 0.15, vx: 0, vz: 0 }), 1);
  assert.equal(evadeIntent.action, 'move');
  assert.equal(evadeIntent.speedMult, SPRITE_ANIM_CONFIG.evadeSpeedMult);

  // 6. Moving uses movement row
  assert.equal(resolveActorAnimIntent(makeActor({ vx: 90 }), 1).action, 'move');

  // 7. Idle fallback
  assert.equal(resolveActorAnimIntent(makeActor({ vx: 2, vz: 1 }), 1).action, 'idle');
});

test('Idle, Movement, and Feeding loop cleanly across frames 0-5 at configured frame rates', () => {
  // Idle: 5 FPS -> 0.2s per frame, wraps back to 0 after 1.2s
  const idleState = createActorAnimState(1);
  const idleActor = makeActor({ level: 5 });
  const idleFrames: number[] = [];
  for (let i = 0; i < 8; i++) {
    const res = advanceActorAnim(idleState, idleActor, i === 0 ? 0 : 0.2);
    assert.equal(res.row, SPRITE_ROW_BY_ACTION.idle);
    idleFrames.push(res.col);
  }
  assert.deepEqual(idleFrames, [0, 1, 2, 3, 4, 5, 0, 1]);

  // Movement: Phase 1 (9 FPS), Phase 2 (8 FPS), Phase 3 (10 FPS)
  assert.equal(getSpriteSheetMeta(1).moveFps, 9);
  assert.equal(getSpriteSheetMeta(2).moveFps, 8);
  assert.equal(getSpriteSheetMeta(3).moveFps, 10);

  const moveState = createActorAnimState(2);
  const crawlActor = makeActor({ level: 55, isOnShore: true, vx: 80 });
  const seenMoveCols = new Set<number>();
  for (let i = 0; i < 20; i++) {
    const res = advanceActorAnim(moveState, crawlActor, 0.05);
    assert.equal(res.phase, 2);
    assert.equal(res.row, SPRITE_ROW_BY_ACTION.move);
    seenMoveCols.add(res.col);
  }
  assert.equal(seenMoveCols.size, 6, 'Movement cycle must visit all 6 frames');

  // Feeding: 8 FPS -> 0.125s per frame, wraps cleanly
  const feedState = createActorAnimState(3);
  const feedActor = makeActor({ level: 88, feedingTargetId: 'carc-9' });
  const feedFrames: number[] = [];
  for (let i = 0; i < 7; i++) {
    const res = advanceActorAnim(feedState, feedActor, i === 0 ? 0 : 0.125);
    assert.equal(res.row, SPRITE_ROW_BY_ACTION.feed);
    feedFrames.push(res.col);
  }
  assert.deepEqual(feedFrames, [0, 1, 2, 3, 4, 5, 0]);
});

test('Attack animation plays one-shot synchronized with windup, strike, and recovery for both local and remote Kelis', () => {
  // Local simulation entity (authoritative bitePhaseTimer > 0)
  const localState = createActorAnimState(1);
  const r0 = advanceActorAnim(
    localState,
    makeActor({ bitePhase: 'windup', bitePhaseTimer: BITE_WINDUP_SEC * 0.9, biteAttackSeq: 1 }),
    0.016
  );
  const r1 = advanceActorAnim(
    localState,
    makeActor({ bitePhase: 'windup', bitePhaseTimer: BITE_WINDUP_SEC * 0.2, biteAttackSeq: 1 }),
    0.016
  );
  const r2 = advanceActorAnim(
    localState,
    makeActor({ bitePhase: 'strike', bitePhaseTimer: BITE_STRIKE_SEC * 0.85, biteAttackSeq: 1 }),
    0.016
  );
  const r3 = advanceActorAnim(
    localState,
    makeActor({ bitePhase: 'strike', bitePhaseTimer: BITE_STRIKE_SEC * 0.25, biteAttackSeq: 1 }),
    0.016
  );
  const r4 = advanceActorAnim(
    localState,
    makeActor({ bitePhase: 'recovery', bitePhaseTimer: BITE_RECOVERY_SEC * 0.8, biteAttackSeq: 1 }),
    0.016
  );
  const r5 = advanceActorAnim(
    localState,
    makeActor({ bitePhase: 'recovery', bitePhaseTimer: BITE_RECOVERY_SEC * 0.15, biteAttackSeq: 1 }),
    0.016
  );

  assert.deepEqual(
    [r0, r1, r2, r3, r4, r5].map((r) => [r.row, r.col]),
    [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
      [2, 5],
    ]
  );

  // Immediately returns to idle/move once bite finishes (never loops Row 2)
  const postAttack = advanceActorAnim(
    localState,
    makeActor({ bitePhase: 'idle', bitePhaseTimer: 0, biteAttackSeq: 1, vx: 0 }),
    0.016
  );
  assert.equal(postAttack.action, 'idle');
  assert.equal(postAttack.row, SPRITE_ROW_BY_ACTION.idle);

  // Remote multiplayer entity (bitePhase replicated, bitePhaseTimer === 0)
  const remoteState = createActorAnimState(2);
  const rw0 = advanceActorAnim(remoteState, makeActor({ level: 50, bitePhase: 'windup' }), 0.02);
  const rw1 = advanceActorAnim(remoteState, makeActor({ level: 50, bitePhase: 'windup' }), 0.09);
  const rs0 = advanceActorAnim(remoteState, makeActor({ level: 50, bitePhase: 'strike' }), 0.01);
  const rs1 = advanceActorAnim(remoteState, makeActor({ level: 50, bitePhase: 'strike' }), 0.06);
  const rr0 = advanceActorAnim(remoteState, makeActor({ level: 50, bitePhase: 'recovery' }), 0.02);
  const rr1 = advanceActorAnim(remoteState, makeActor({ level: 50, bitePhase: 'recovery' }), 0.13);

  assert.deepEqual(
    [rw0, rw1, rs0, rs1, rr0, rr1].map((r) => r.col),
    [0, 1, 2, 3, 4, 5]
  );
});

test('Evolution transitions (Lv.39 -> Lv.40 and Lv.79 -> Lv.80) preserve continuity without invalid frames', () => {
  const state = createActorAnimState(1);

  // Swim in Phase 1 at Lv.39
  advanceActorAnim(state, makeActor({ level: 39, vx: 110 }), 0.25);
  assert.equal(state.phase, 1);
  assert.equal(state.action, 'move');

  // Evolve to Lv.40 mid-movement
  const toP2 = advanceActorAnim(state, makeActor({ level: 40, vx: 110 }), 0.05);
  assert.equal(toP2.phase, 2);
  assert.equal(toP2.phaseChanged, true);
  assert.equal(toP2.action, 'move');
  assert.ok(toP2.col >= 0 && toP2.col < SPRITE_GRID_COLS);

  // Evolve to Lv.80 mid-feeding
  advanceActorAnim(state, makeActor({ level: 79, feedingTargetId: 'c2' }), 0.16);
  const toP3 = advanceActorAnim(state, makeActor({ level: 80, feedingTargetId: 'c2' }), 0.05);
  assert.equal(toP3.phase, 3);
  assert.equal(toP3.phaseChanged, true);
  assert.equal(toP3.action, 'feed');
  assert.ok(toP3.col >= 0 && toP3.col < SPRITE_GRID_COLS);
});

test('UV coordinates stay strictly within [0,1], non-overlapping across all 24 cells, and update PlaneGeometry UVs', () => {
  const geo = createActorSpriteGeometry();
  const phases: EvolutionPhase[] = [1, 2, 3];

  for (const phase of phases) {
    for (let r = 0; r < SPRITE_GRID_ROWS; r++) {
      for (let c = 0; c < SPRITE_GRID_COLS; c++) {
        const uv = computeFrameUVs(phase, r, c);
        assert.ok(uv.uLeft >= 0 && uv.uRight <= 1 && uv.uLeft < uv.uRight);
        assert.ok(uv.vBottom >= 0 && uv.vTop <= 1 && uv.vBottom < uv.vTop);

        if (c < SPRITE_GRID_COLS - 1) {
          const nextCol = computeFrameUVs(phase, r, c + 1);
          assert.ok(uv.uRight < nextCol.uLeft, 'Adjacent column UVs must not overlap');
        }
        if (r < SPRITE_GRID_ROWS - 1) {
          const nextRow = computeFrameUVs(phase, r + 1, c);
          assert.ok(nextRow.vTop < uv.vBottom, 'Adjacent row UVs must not overlap');
        }

        applyFrameUVsToGeometry(geo, phase, r, c);
        const attr = geo.attributes.uv;
        assert.ok(Math.abs(attr.getX(0) - uv.uLeft) < 1e-6);
        assert.ok(Math.abs(attr.getY(0) - uv.vTop) < 1e-6);
        assert.ok(Math.abs(attr.getX(3) - uv.uRight) < 1e-6);
        assert.ok(Math.abs(attr.getY(3) - uv.vBottom) < 1e-6);
      }
    }
  }
  geo.dispose();
});

test('Simulation entities (player + AI bots) cleanly drive frame-by-frame animation states during combat and locomotion', () => {
  const sim = new GameSimulation(10, 'royale', 'Tester', { emitLocalSound: false });
  const player = sim.getPlayer();
  player.vx = 0;
  player.vz = 0;
  const state = createActorAnimState(getEvolutionPhaseForLevel(player.level));

  // Initial idle
  let res = advanceActorAnim(state, player, 0.016);
  assert.equal(res.phase, 1);
  assert.equal(res.action, 'idle');

  // Trigger bite -> transitions cleanly through attack frames
  sim.triggerAbilityForPlayer(player.id, 'bite');
  sim.step(0.02);
  res = advanceActorAnim(state, player, 0.02);
  assert.equal(res.action, 'attack');
  assert.equal(res.row, SPRITE_ROW_BY_ACTION.attack);
  assert.ok(res.col === 0 || res.col === 1);

  // Advance into strike phase -> frames 2-3
  for (let i = 0; i < 8; i++) sim.step(0.02);
  res = advanceActorAnim(state, player, 0.02);
  assert.equal(res.action, 'attack');
  assert.ok(res.col === 2 || res.col === 3);

  // Advance past recovery -> returns to idle
  for (let i = 0; i < 20; i++) sim.step(0.02);
  player.vx = 0;
  player.vz = 0;
  res = advanceActorAnim(state, player, 0.02);
  assert.equal(res.action, 'idle');

  // Trigger Slip Evade -> uses movement row at boosted speed
  sim.triggerAbilityForPlayer(player.id, 'evade');
  sim.step(0.02);
  res = advanceActorAnim(state, player, 0.02);
  assert.equal(res.action, 'move');
  assert.equal(res.row, SPRITE_ROW_BY_ACTION.move);
});

test('3D water submersion fully submerges aquatic Kelis, partially submerges amphibians in water, and keeps them dry on land', () => {
  const cos45 = Math.SQRT1_2;

  // 1. Phase 1 fully aquatic Keli in deep water -> fully beneath y=0 water surface & below waterMesh renderOrder=2
  const p1Meta = getSpriteSheetMeta(1);
  const p1Height = 3.0;
  const p1Deep = computeKeliWaterSubmersion(1, false, -1.4, p1Height, p1Meta.groundPadRatio);
  assert.equal(p1Deep.mode, 'full');
  assert.equal(p1Deep.shaderMode, 2);
  assert.equal(p1Deep.targetBlend, 1);
  assert.equal(p1Deep.spriteRenderOrder, 1);
  assert.equal(p1Deep.groupY, 0);
  const p1TopWorldY = p1Deep.groupY + p1Deep.spriteLocalY + 0.72 * p1Height * cos45;
  const p1BellyWorldY = p1Deep.groupY + p1Deep.spriteLocalY + p1Meta.groundPadRatio * p1Height * cos45;
  assert.ok(p1TopWorldY < 0, `Aquatic Keli top (${p1TopWorldY}) must be fully below y=0 water plane`);
  assert.ok(p1BellyWorldY > -1.4 * 2.2, 'Aquatic Keli belly must stay above seabed');

  // 2. Phase 1 in shallow water -> still mode='full' and safely clamped above shallow seabed
  const p1Shallow = computeKeliWaterSubmersion(1, false, -0.3, p1Height, p1Meta.groundPadRatio);
  assert.equal(p1Shallow.mode, 'full');
  assert.equal(p1Shallow.shaderMode, 2);
  const p1ShallowBellyY =
    p1Shallow.groupY + p1Shallow.spriteLocalY + p1Meta.groundPadRatio * p1Height * cos45;
  assert.ok(p1ShallowBellyY > -0.3 * 2.2, 'Shallow aquatic Keli must not clip into seabed');

  // 3. Phase 2 & 3 amphibious Kelis in deep water -> partially submerged (bottom < 0, upper torso/head > 0)
  for (const phase of [2, 3] as EvolutionPhase[]) {
    const meta = getSpriteSheetMeta(phase);
    const height = phase === 2 ? 4.8 : 6.4;
    const inWater = computeKeliWaterSubmersion(phase, false, -1.5, height, meta.groundPadRatio);
    assert.equal(inWater.mode, 'partial');
    assert.equal(inWater.shaderMode, 1);
    assert.equal(inWater.spriteRenderOrder, 1);
    const bottomY = inWater.groupY + inWater.spriteLocalY + meta.groundPadRatio * height * cos45;
    const topY = inWater.groupY + inWater.spriteLocalY + 0.92 * height * cos45;
    assert.ok(bottomY < -0.5, `Phase ${phase} lower body must sit below water surface`);
    assert.ok(topY > 0.8, `Phase ${phase} upper body/head must rise dry above water surface`);

    // 4. Phase 2 & 3 on shore -> 100% dry on land (above waterMesh renderOrder, zero submersion)
    const onLand = computeKeliWaterSubmersion(phase, true, 0.45, height, meta.groundPadRatio);
    assert.equal(onLand.mode, 'dry');
    assert.equal(onLand.shaderMode, 0);
    assert.equal(onLand.targetBlend, 0);
    assert.equal(onLand.spriteRenderOrder, 6);
    assert.ok(onLand.groupY >= 0.45 * 2.2 - 1e-4, 'On-land Keli must stand on shore elevation');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  advanceActorAnim,
  AnimatableKeliState,
  applyKeliKingFrameUVsToGeometry,
  computeKeliKingFrameUVs,
  computeKeliWaterSubmersion,
  createActorAnimState,
  createActorSpriteGeometry,
  getEvolutionPhaseForLevel,
  getSpriteSheetMeta,
  isKeliKingLevel,
  KELI_KING_GRID_COLS,
  KELI_KING_GRID_ROWS,
  KELI_KING_ROAR_FRAME,
  KELI_KING_ROW,
  KELI_KING_SHEET_META,
} from '../src/game/spriteAnimation';
import { GameSimulation } from '../src/game/simulation';
import { RemoteSimulationView } from '../src/game/multiplayerClient';

function makeActor(overrides: Partial<AnimatableKeliState> = {}): AnimatableKeliState {
  return {
    level: 1,
    alive: true,
    vx: 0,
    vz: 0,
    isOnShore: true,
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

test('Keli King WebP sprite sheet exists, is compact, has clean alpha borders, preserves dark eyes/outlines, and keeps consistent foot baseline across all 12 frames', () => {
  const fullPath = path.resolve(process.cwd(), 'public', KELI_KING_SHEET_META.assetPath);
  assert.ok(fs.existsSync(fullPath), `Missing Keli King sprite sheet at ${fullPath}`);

  const stat = fs.statSync(fullPath);
  const kb = stat.size / 1024;
  assert.ok(kb > 100 && kb <= 500, `Keli King WebP size ${kb.toFixed(1)} KB outside optimal 100–500 KB budget`);

  const header = fs.readFileSync(fullPath).subarray(0, 12).toString('ascii');
  assert.equal(header.slice(0, 4), 'RIFF');
  assert.equal(header.slice(8, 12), 'WEBP');

  const rgba = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', fullPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  const { atlasWidth, atlasHeight, cellWidth, cellHeight } = KELI_KING_SHEET_META;
  assert.equal(
    rgba.length,
    atlasWidth * atlasHeight * 4,
    `Decoded RGBA byte length must match ${atlasWidth}x${atlasHeight}`
  );

  const alphaAt = (x: number, y: number) => rgba[(y * atlasWidth + x) * 4 + 3];
  const footBaselines: number[] = [];

  for (let r = 0; r < KELI_KING_GRID_ROWS; r++) {
    for (let c = 0; c < KELI_KING_GRID_COLS; c++) {
      const x0 = c * cellWidth;
      const y0 = r * cellHeight;
      const x1 = x0 + cellWidth - 1;
      const y1 = y0 + cellHeight - 1;

      // Zero clipping on any of the 4 outer borders of every frame
      for (let x = x0; x <= x1; x++) {
        assert.equal(alphaAt(x, y0), 0, `Keli King cell (${r},${c}) clipped at top x=${x}`);
        assert.equal(alphaAt(x, y1), 0, `Keli King cell (${r},${c}) clipped at bottom x=${x}`);
      }
      for (let y = y0; y <= y1; y++) {
        assert.equal(alphaAt(x0, y), 0, `Keli King cell (${r},${c}) clipped at left y=${y}`);
        assert.equal(alphaAt(x1, y), 0, `Keli King cell (${r},${c}) clipped at right y=${y}`);
      }

      let opaqueCount = 0;
      let darkOutlineOrEyePixels = 0;
      let goldPixels = 0;
      let maxLocalY = -1;

      for (let y = y0 + 1; y < y1; y++) {
        for (let x = x0 + 1; x < x1; x++) {
          const idx = (y * atlasWidth + x) * 4;
          const a = rgba[idx + 3];
          if (a >= 180) {
            opaqueCount++;
            const red = rgba[idx];
            const green = rgba[idx + 1];
            const blue = rgba[idx + 2];
            if (red < 35 && green < 35 && blue < 40) {
              darkOutlineOrEyePixels++;
            }
            if (red > 150 && green > 105 && blue < 95) {
              goldPixels++;
            }
            const localY = y - y0;
            if (localY > maxLocalY) maxLocalY = localY;
          }
        }
      }

      assert.ok(opaqueCount > 25000, `Keli King cell (${r},${c}) appears too sparse (${opaqueCount} px)`);
      assert.ok(darkOutlineOrEyePixels > 2000, `Keli King cell (${r},${c}) lost dark outlines/eyes`);
      assert.ok(goldPixels > 1200, `Keli King cell (${r},${c}) missing golden royal armor`);
      footBaselines.push(maxLocalY);
    }
  }

  // All 12 frames share an aligned foot baseline within <= 4 px
  const minFoot = Math.min(...footBaselines);
  const maxFoot = Math.max(...footBaselines);
  assert.ok(
    maxFoot - minFoot <= 4,
    `Foot baseline drift across 12 frames too large: ${minFoot}..${maxFoot}`
  );
});

test('Keli King 6x2 UV slicing maps every frame cleanly within [0,1] without neighbor bleed', () => {
  const geo = createActorSpriteGeometry();
  const seen = new Set<string>();

  for (let r = 0; r < KELI_KING_GRID_ROWS; r++) {
    for (let c = 0; c < KELI_KING_GRID_COLS; c++) {
      const uv = computeKeliKingFrameUVs(r, c);
      assert.ok(uv.uLeft >= 0 && uv.uRight <= 1 && uv.uLeft < uv.uRight);
      assert.ok(uv.vBottom >= 0 && uv.vTop <= 1 && uv.vBottom < uv.vTop);

      // Verify exact cell containment (inset stays strictly inside cell boundaries)
      const cellU0 = c / KELI_KING_GRID_COLS;
      const cellU1 = (c + 1) / KELI_KING_GRID_COLS;
      assert.ok(uv.uLeft > cellU0 && uv.uRight < cellU1);

      const cellV1 = 1 - r / KELI_KING_GRID_ROWS;
      const cellV0 = 1 - (r + 1) / KELI_KING_GRID_ROWS;
      assert.ok(uv.vBottom > cellV0 && uv.vTop < cellV1);

      const key = `${uv.uLeft.toFixed(5)}:${uv.vBottom.toFixed(5)}`;
      assert.ok(!seen.has(key), `Duplicate UV window at (${r},${c})`);
      seen.add(key);

      applyKeliKingFrameUVsToGeometry(geo, r, c);
      const attr = geo.attributes.uv;
      assert.ok(Math.abs(attr.getX(0) - uv.uLeft) < 1e-6);
      assert.ok(Math.abs(attr.getY(0) - uv.vTop) < 1e-6);
      assert.ok(Math.abs(attr.getX(3) - uv.uRight) < 1e-6);
      assert.ok(Math.abs(attr.getY(3) - uv.vBottom) < 1e-6);
    }
  }
  assert.equal(seen.size, 12);
  geo.dispose();
});

test('Level 80-99 stays on Phase 3 while Level 100 activates distinct Keli King form with Victory -> Regal Idle state machine and exact Frame-4 roar trigger', () => {
  // Levels 80-99 remain on Phase 3 (not Keli King)
  for (const lv of [80, 90, 99]) {
    assert.equal(isKeliKingLevel(lv), false);
    const phase = getEvolutionPhaseForLevel(lv);
    assert.equal(phase, 3);
    const st = createActorAnimState(phase);
    const step = advanceActorAnim(st, makeActor({ level: lv }), 1 / 60);
    assert.equal(step.isKeliKing, false);
    assert.notEqual(step.action, 'keli_king_victory');
    assert.notEqual(step.action, 'keli_king_regal_idle');
  }

  // Keli King scale is distinctly larger than Phase 3
  assert.ok(
    KELI_KING_SHEET_META.worldHeightScale > getSpriteSheetMeta(3).worldHeightScale,
    'Keli King worldHeightScale must exceed Phase 3 worldHeightScale'
  );

  // Transitioning from Lv.99 -> Lv.100 immediately triggers Row 1 Victory (non-looping)
  const animState = createActorAnimState(3);
  advanceActorAnim(animState, makeActor({ level: 99, vx: 60 }), 1 / 60);
  assert.equal(animState.isKeliKing, false);

  const observedVictoryFrames: number[] = [];
  let victoryStarts = 0;
  let roarTriggers = 0;
  let roarFrameAtTrigger = -1;
  let victoryCompletions = 0;
  const dt = 1 / 60;

  // Step through 1.4s (> 6 frames at 6 FPS = 1.0s) while aggressively injecting movement, attack, and feed flags
  for (let i = 0; i < 84; i++) {
    const res = advanceActorAnim(
      animState,
      makeActor({
        level: 100,
        vx: 140,
        vz: -90,
        bitePhase: 'strike',
        biteAttackSeq: i + 1,
        feedingTargetId: 'carcass_fake',
        stunTimer: 0.5,
      }),
      dt
    );

    assert.equal(res.isKeliKing, true);
    assert.ok(
      res.action === 'keli_king_victory' || res.action === 'keli_king_regal_idle',
      `Keli King must NEVER revert to combat/move/feed state (got ${res.action})`
    );

    if (res.keliKingVictoryJustStarted) victoryStarts++;
    if (res.keliKingRoarJustTriggered) {
      roarTriggers++;
      roarFrameAtTrigger = res.col;
    }
    if (res.keliKingVictoryJustCompleted) victoryCompletions++;

    if (res.action === 'keli_king_victory') {
      assert.equal(res.row, KELI_KING_ROW.victory);
      if (observedVictoryFrames[observedVictoryFrames.length - 1] !== res.col) {
        observedVictoryFrames.push(res.col);
      }
    }
  }

  assert.deepEqual(observedVictoryFrames, [0, 1, 2, 3, 4, 5], 'Victory row must play frames 0..5 sequentially');
  assert.equal(victoryStarts, 1, 'Victory animation must start exactly once');
  assert.equal(roarTriggers, 1, 'Victory roar must fire strictly once');
  assert.equal(roarFrameAtTrigger, KELI_KING_ROAR_FRAME, 'Victory roar must trigger on exact Frame 4');
  assert.equal(victoryCompletions, 1, 'Victory completion must fire strictly once');
  assert.equal(animState.action, 'keli_king_regal_idle', 'Must transition seamlessly into Regal Idle');

  // Verify Regal Idle loops smoothly across Row 0 frames 0..5 and never restarts Victory
  const idleFramesSeen = new Set<number>();
  for (let i = 0; i < 120; i++) {
    const res = advanceActorAnim(
      animState,
      makeActor({ level: 100, vx: 200, bitePhase: 'windup', biteAttackSeq: 999 }),
      dt
    );
    assert.equal(res.isKeliKing, true);
    assert.equal(res.action, 'keli_king_regal_idle');
    assert.equal(res.row, KELI_KING_ROW.idle);
    assert.equal(res.keliKingVictoryJustStarted, false);
    assert.equal(res.keliKingRoarJustTriggered, false);
    idleFramesSeen.add(res.col);
  }
  assert.deepEqual([...idleFramesSeen].sort(), [0, 1, 2, 3, 4, 5], 'Regal Idle must loop cleanly across frames 0..5');
});

test('Keli King water submersion stays dry on land and partially submerged in water', () => {
  const dry = computeKeliWaterSubmersion(3, true, 0.9, 10.6, KELI_KING_SHEET_META.groundPadRatio, true);
  assert.equal(dry.mode, 'dry');
  assert.equal(dry.shaderMode, 0);
  assert.equal(dry.targetBlend, 0);

  const water = computeKeliWaterSubmersion(3, false, -0.8, 10.6, KELI_KING_SHEET_META.groundPadRatio, true);
  assert.equal(water.mode, 'partial');
  assert.equal(water.shaderMode, 1);
  assert.ok(water.targetBlend === 1 && water.spriteLocalY < 0, 'Keli King stands tall with lower legs partially submerged in water');
});

test('Authoritative Lv.100 victory fires once, locks post-victory mutations, preserves 100-fragment conservation, and syncs identically across multiplayer clients & spectators', () => {
  const sim = new GameSimulation(10, 'royale', 'AwangTester', {
    humanEntrants: [
      { id: 'p1', name: 'AwangTester' },
      { id: 'p2', name: 'FinalRival' },
    ],
    emitLocalSound: false,
    isMultiplayerMatch: true,
  });
  const player = sim.getPlayer('p1');

  // Consolidate all other kelis into carcasses via disconnect/elimination and transfer them atomically to player
  for (const k of sim.kelis) {
    if (k.id === player.id || !k.alive) continue;
    sim.handlePlayerDisconnect(k.id, true);
  }

  for (const c of [...sim.carcasses]) {
    sim.transferCarcassFragments(player, c.id);
  }
  sim.step(0.05);

  assert.equal(sim.status, 'victory');
  assert.equal(sim.winnerId, player.id);
  assert.equal(player.level, 100);
  assert.equal(sim.getVictoryRecordCount(), 1, 'Victory must resolve strictly once');

  const snapAfterWin = sim.getHudSnapshot('p1');
  assert.equal(
    snapAfterWin.livingMassSum + snapAfterWin.carcassMassSum,
    100,
    'Strict 100-fragment invariant must hold on Keli King victory'
  );

  // Stepping after match conclusion must NOT mutate winner state or re-fire victory
  const winX = player.x;
  const winZ = player.z;
  const ledgerLen = sim.ledger.length;
  sim.setInput({ moveX: 1, moveZ: 1, biteHeld: true });
  for (let i = 0; i < 20; i++) {
    sim.step(0.05);
  }
  assert.equal(sim.getVictoryRecordCount(), 1);
  assert.equal(player.x, winX, 'Winner position must remain frozen after match conclusion');
  assert.equal(player.z, winZ, 'Winner position must remain frozen after match conclusion');
  assert.equal(sim.ledger.length, ledgerLen, 'No post-victory ledger mutations allowed');

  // Replicate real authoritative WorldStatePackets to BOTH winner client and defeated spectator client
  const pktWinner = sim.getRemoteWorldStateFor('p1', 42);
  const pktSpectator = sim.getRemoteWorldStateFor('p2', 42);

  const winnerClient = new RemoteSimulationView('p1');
  const spectatorClient = new RemoteSimulationView('p2');

  winnerClient.applyServerState(pktWinner);
  spectatorClient.applyServerState(pktSpectator);

  assert.equal(winnerClient.status, 'victory');
  assert.equal(winnerClient.winnerId, player.id);
  assert.equal(spectatorClient.status, 'defeat');
  assert.equal(spectatorClient.winnerId, player.id);

  const winnerAnim = createActorAnimState(3);
  const spectatorAnim = createActorAnimState(3);

  // Apply duplicate packets repeatedly and ensure neither client restarts victory animation
  let winnerStarts = 0;
  let spectatorStarts = 0;
  for (let i = 0; i < 90; i++) {
    if (i % 15 === 0) {
      winnerClient.applyServerState(sim.getRemoteWorldStateFor('p1', 43 + i));
      spectatorClient.applyServerState(sim.getRemoteWorldStateFor('p2', 43 + i));
    }
    const wKing = winnerClient.kelis.find((k) => k.id === player.id)!;
    const sKing = spectatorClient.kelis.find((k) => k.id === player.id)!;
    const wr = advanceActorAnim(winnerAnim, wKing, 1 / 60);
    const sr = advanceActorAnim(spectatorAnim, sKing, 1 / 60);
    if (wr.keliKingVictoryJustStarted) winnerStarts++;
    if (sr.keliKingVictoryJustStarted) spectatorStarts++;
    assert.equal(wr.action, sr.action, 'Winner and spectator must see identical Keli King state');
    assert.equal(wr.row, sr.row);
    assert.equal(wr.col, sr.col);
  }
  assert.equal(winnerStarts, 1);
  assert.equal(spectatorStarts, 1);
  assert.equal(winnerAnim.action, 'keli_king_regal_idle');
  assert.equal(spectatorAnim.action, 'keli_king_regal_idle');
});

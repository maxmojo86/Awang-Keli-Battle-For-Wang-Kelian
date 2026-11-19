import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  HAZARD_TILES,
  LANDMARKS,
  OBSTACLES,
  PALONG_GATES,
  resolveArenaCollision,
} from '../src/game/arena.ts';
import {
  applyEnvFrameUVs,
  buildArenaEnvironmentalLayout,
  CARCASS_PHASE_SCALE_RATIOS,
  computeCarcassVisualScale,
  computeEnvFrameUVs,
  createEnvSpriteGeometry,
  ENV_ATLASES,
  ENV_SPRITE_MANIFEST,
  EnvAtlasId,
  EnvSpriteId,
  getCarcassSpriteId,
  getCarcassValueGlow,
  resolveCarcassEvolutionPhase,
  resolveTwoFrameIndex,
} from '../src/game/environmentalSprites.ts';
import { RemoteSimulationView } from '../src/game/multiplayerClient.ts';
import { GameSimulation, TOTAL_MATCH_FRAGMENTS } from '../src/game/simulation.ts';
import type { KeliEntity } from '../src/game/types.ts';

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

function assertFragmentInvariant(sim: GameSimulation, label: string) {
  const audit = sim.getFragmentAudit();
  assert.equal(
    audit.total,
    TOTAL_MATCH_FRAGMENTS,
    `${label}: total fragments must equal 100 (got ${audit.total})`
  );
  assert.equal(audit.valid, true, `${label}: fragment audit must be valid`);
  assert.equal(audit.deadHoldingFragments, 0, `${label}: dead Kelis must hold 0 fragments`);
}

test('Processed environmental WebP atlases exist, meet compact size budget, decode to 1254x1254 RGBA, and have clean alpha with zero clipping', () => {
  const atlasIds: EnvAtlasId[] = ['fishing', 'advanced'];
  const decodedByAtlas: Record<EnvAtlasId, Buffer> = {} as Record<EnvAtlasId, Buffer>;

  for (const id of atlasIds) {
    const meta = ENV_ATLASES[id];
    const fullPath = path.resolve(process.cwd(), 'public', meta.assetPath);
    assert.ok(fs.existsSync(fullPath), `Missing environmental atlas ${fullPath}`);

    const kb = fs.statSync(fullPath).size / 1024;
    assert.ok(kb >= 120 && kb <= 500, `Atlas ${id} WebP size ${kb.toFixed(1)} KB outside expected range`);

    const header = fs.readFileSync(fullPath).subarray(0, 12).toString('ascii');
    assert.equal(header.slice(0, 4), 'RIFF');
    assert.equal(header.slice(8, 12), 'WEBP');

    const rgba = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-i', fullPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    assert.equal(rgba.length, meta.width * meta.height * 4);
    decodedByAtlas[id] = rgba;

    // Corners of each atlas must be fully transparent (no opaque black/white background)
    const cornerAlpha = (x: number, y: number) => rgba[(y * meta.width + x) * 4 + 3];
    assert.equal(cornerAlpha(0, 0), 0, `${id} top-left corner must be transparent`);
    assert.equal(cornerAlpha(meta.width - 1, 0), 0, `${id} top-right corner must be transparent`);
    assert.equal(cornerAlpha(0, meta.height - 1), 0, `${id} bottom-left corner must be transparent`);
    assert.equal(
      cornerAlpha(meta.width - 1, meta.height - 1),
      0,
      `${id} bottom-right corner must be transparent`
    );
  }

  // Validate all 24 manifest entries (48 frames)
  const entries = Object.values(ENV_SPRITE_MANIFEST);
  assert.equal(entries.length, 24, 'Expected exactly 24 environmental & carcass sprite entries');

  for (const def of entries) {
    const meta = ENV_ATLASES[def.atlas];
    const rgba = decodedByAtlas[def.atlas];
    const [f0, f1] = def.frames;

    assert.equal(f0.w, f1.w, `${def.id} animation pair widths must match`);
    assert.equal(f0.h, f1.h, `${def.id} animation pair heights must match`);

    for (let fi = 0; fi < 2; fi++) {
      const rect = def.frames[fi];
      assert.ok(rect.x >= 0 && rect.y >= 0, `${def.id}[${fi}] rect origin must be >= 0`);
      assert.ok(rect.x + rect.w <= meta.width, `${def.id}[${fi}] exceeds atlas width`);
      assert.ok(rect.y + rect.h <= meta.height, `${def.id}[${fi}] exceeds atlas height`);

      // Verify clean transparent padding outside the rect (no clipping into neighbors)
      const alphaAt = (x: number, y: number) => rgba[(y * meta.width + x) * 4 + 3];
      const topRow = Math.max(0, rect.y);
      const bottomRow = Math.min(meta.height - 1, rect.y + rect.h - 1);
      const leftCol = Math.max(0, rect.x);
      const rightCol = Math.min(meta.width - 1, rect.x + rect.w - 1);

      let borderNonTransparent = 0;
      for (let x = leftCol; x <= rightCol; x++) {
        if (alphaAt(x, topRow) > 20) borderNonTransparent++;
        if (alphaAt(x, bottomRow) > 20) borderNonTransparent++;
      }
      for (let y = topRow; y <= bottomRow; y++) {
        if (alphaAt(leftCol, y) > 20) borderNonTransparent++;
        if (alphaAt(rightCol, y) > 20) borderNonTransparent++;
      }
      assert.equal(
        borderNonTransparent,
        0,
        `${def.id}[${fi}] has ${borderNonTransparent} opaque pixels touching crop border (possible clipping)`
      );

      // Verify visible artwork and dark outline pixels exist inside frame
      let opaqueCount = 0;
      let darkOutlineCount = 0;
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          const idx = (y * meta.width + x) * 4;
          if (rgba[idx + 3] > 200) {
            opaqueCount++;
            const luma = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
            if (luma < 52) {
              darkOutlineCount++;
            }
          }
        }
      }
      assert.ok(opaqueCount > 1200, `${def.id}[${fi}] opaque pixel count too low (${opaqueCount})`);
      if (def.id !== 'toxic_pool' && def.id !== 'water_ripple') {
        assert.ok(
          darkOutlineCount > 250,
          `${def.id}[${fi}] dark outline pixels missing (${darkOutlineCount})`
        );
      }
    }
  }
});

test('Atlas manifest matches exact 6x4 sprite coordinates and produces non-overlapping [0,1] UVs', () => {
  const expectedMapping: Array<[EnvSpriteId, EnvAtlasId, number, [number, number]]> = [
    // Atlas 1 — Fishing Environment
    ['tall_reeds', 'fishing', 0, [0, 1]],
    ['water_lilies', 'fishing', 0, [2, 3]],
    ['moss_rock', 'fishing', 1, [0, 1]],
    ['aquatic_weeds', 'fishing', 1, [2, 3]],
    ['driftwood_log', 'fishing', 2, [0, 1]],
    ['fishing_buoy', 'fishing', 2, [2, 3]],
    ['lantern_post', 'fishing', 3, [0, 1]],
    ['fishing_net', 'fishing', 3, [2, 3]],
    ['toxic_pool', 'fishing', 4, [0, 1]],
    ['water_ripple', 'fishing', 4, [2, 3]],
    ['carcass_phase1', 'fishing', 5, [0, 1]],
    ['supply_crate', 'fishing', 5, [2, 3]],
    // Atlas 2 — Advanced Environment & Carcasses
    ['carcass_phase2', 'advanced', 0, [0, 1]],
    ['carcass_phase3', 'advanced', 0, [2, 3]],
    ['bamboo_raft', 'advanced', 1, [0, 1]],
    ['fish_trap', 'advanced', 1, [2, 3]],
    ['biolum_mushrooms', 'advanced', 2, [0, 1]],
    ['stalactites', 'advanced', 2, [2, 3]],
    ['white_lotus', 'advanced', 3, [0, 1]],
    ['mangrove_roots', 'advanced', 3, [2, 3]],
    ['broken_barrel', 'advanced', 4, [0, 1]],
    ['floating_rubbish', 'advanced', 4, [2, 3]],
    ['stone_monument', 'advanced', 5, [0, 1]],
    ['giant_clam', 'advanced', 5, [2, 3]],
  ];

  for (const [id, atlas, row, cols] of expectedMapping) {
    const def = ENV_SPRITE_MANIFEST[id];
    assert.ok(def, `Missing manifest entry for ${id}`);
    assert.equal(def.atlas, atlas);
    assert.equal(def.row, row);
    assert.deepEqual(def.cols, cols);
  }

  // Verify UVs stay strictly within [0,1] and zero rects overlap inside each atlas
  const geo = createEnvSpriteGeometry(0);
  for (const atlasId of ['fishing', 'advanced'] as EnvAtlasId[]) {
    const rects: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    for (const def of Object.values(ENV_SPRITE_MANIFEST)) {
      if (def.atlas !== atlasId) continue;
      for (let i = 0; i < 2; i++) {
        const r = def.frames[i];
        const uv = computeEnvFrameUVs(atlasId, r);
        assert.ok(uv.uLeft >= 0 && uv.uRight <= 1 && uv.uLeft < uv.uRight);
        assert.ok(uv.vBottom >= 0 && uv.vTop <= 1 && uv.vBottom < uv.vTop);

        applyEnvFrameUVs(geo, atlasId, r);
        const attr = geo.attributes.uv;
        assert.ok(Math.abs(attr.getX(0) - uv.uLeft) < 1e-6);
        assert.ok(Math.abs(attr.getY(0) - uv.vTop) < 1e-6);
        assert.ok(Math.abs(attr.getX(3) - uv.uRight) < 1e-6);
        assert.ok(Math.abs(attr.getY(3) - uv.vBottom) < 1e-6);

        rects.push({ id: `${def.id}[${i}]`, ...r });
      }
    }

    assert.equal(rects.length, 24, `Atlas ${atlasId} must define 24 frames`);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const separated =
          a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y;
        assert.ok(separated, `Overlap detected in ${atlasId} between ${a.id} and ${b.id}`);
      }
    }
  }
  geo.dispose();
});

test('Two-frame environmental animation loops 0 <-> 1 at configured FPS and supports stationary props', () => {
  // Reeds: 2 FPS -> flips every 0.5s
  assert.equal(ENV_SPRITE_MANIFEST.tall_reeds.fps, 2);
  assert.equal(resolveTwoFrameIndex(0.0, 2, 0, true), 0);
  assert.equal(resolveTwoFrameIndex(0.49, 2, 0, true), 0);
  assert.equal(resolveTwoFrameIndex(0.51, 2, 0, true), 1);
  assert.equal(resolveTwoFrameIndex(1.01, 2, 0, true), 0);

  // Ripples & toxic pools: 3 FPS -> flips every ~0.333s
  assert.equal(ENV_SPRITE_MANIFEST.water_ripple.fps, 3);
  assert.equal(ENV_SPRITE_MANIFEST.toxic_pool.fps, 3);
  assert.equal(resolveTwoFrameIndex(0.1, 3, 0, true), 0);
  assert.equal(resolveTwoFrameIndex(0.35, 3, 0, true), 1);
  assert.equal(resolveTwoFrameIndex(0.7, 3, 0, true), 0);

  // Carcasses: 1 FPS subtle dead drift
  assert.equal(ENV_SPRITE_MANIFEST.carcass_phase1.fps, 1);
  assert.equal(ENV_SPRITE_MANIFEST.carcass_phase2.fps, 1);
  assert.equal(ENV_SPRITE_MANIFEST.carcass_phase3.fps, 1);
  assert.equal(resolveTwoFrameIndex(0.5, 1, 0, true), 0);
  assert.equal(resolveTwoFrameIndex(1.2, 1, 0, true), 1);

  // Stationary stone structures & non-floating, non-vegetation props must be static (fps === 0)
  const staticIds: EnvSpriteId[] = [
    'moss_rock',
    'stone_monument',
    'stalactites',
    'biolum_mushrooms',
    'lantern_post',
    'fishing_net',
    'fish_trap',
    'broken_barrel',
    'giant_clam',
  ];
  for (const id of staticIds) {
    assert.equal(ENV_SPRITE_MANIFEST[id].fps, 0, `${id} should be treated as a static asset`);
    assert.equal(resolveTwoFrameIndex(3.7, ENV_SPRITE_MANIFEST[id].fps, 0.5, true), 0);
  }

  // Vegetation, floating props, water effects, and floating carcasses remain animated
  const animatedIds: EnvSpriteId[] = [
    'tall_reeds',
    'aquatic_weeds',
    'water_lilies',
    'white_lotus',
    'mangrove_roots',
    'driftwood_log',
    'fishing_buoy',
    'supply_crate',
    'bamboo_raft',
    'floating_rubbish',
    'water_ripple',
    'toxic_pool',
    'carcass_phase1',
    'carcass_phase2',
    'carcass_phase3',
  ];
  for (const id of animatedIds) {
    assert.ok(ENV_SPRITE_MANIFEST[id].fps > 0, `${id} should remain animated`);
  }

  // Stationary mode stays locked to frame 0
  assert.equal(resolveTwoFrameIndex(4.5, 2, 0.3, false), 0);
  assert.equal(resolveTwoFrameIndex(4.5, 0, 0.3, true), 0);
});

test('Deterministic environmental layout places all 21 non-carcass props safely without altering collision or blocking paths', () => {
  const obstacleSnapshot = OBSTACLES.map((o) => ({ ...o }));
  const layoutA = buildArenaEnvironmentalLayout();
  const layoutB = buildArenaEnvironmentalLayout();

  // Strictly deterministic across runs
  assert.deepEqual(layoutA, layoutB);
  assert.ok(layoutA.length > 100, 'Arena should contain rich distributed environmental sprites');

  // Verify all 21 non-carcass sprite IDs are represented and NO carcass sprites are placed statically
  const placedIds = new Set(layoutA.map((item) => item.spriteId));
  const expectedEnvSprites: EnvSpriteId[] = [
    'tall_reeds',
    'water_lilies',
    'moss_rock',
    'aquatic_weeds',
    'driftwood_log',
    'fishing_buoy',
    'lantern_post',
    'fishing_net',
    'toxic_pool',
    'water_ripple',
    'supply_crate',
    'bamboo_raft',
    'fish_trap',
    'biolum_mushrooms',
    'stalactites',
    'white_lotus',
    'mangrove_roots',
    'broken_barrel',
    'floating_rubbish',
    'stone_monument',
    'giant_clam',
  ];
  for (const id of expectedEnvSprites) {
    assert.ok(placedIds.has(id), `Expected environmental sprite "${id}" to be placed in arena`);
  }
  assert.equal(placedIds.has('carcass_phase1'), false);
  assert.equal(placedIds.has('carcass_phase2'), false);
  assert.equal(placedIds.has('carcass_phase3'), false);

  // Every visual_obstacle must anchor onto an existing OBSTACLES entry (zero new solid collision)
  const obstacleMap = new Map(OBSTACLES.map((o) => [o.id, o]));
  for (const item of layoutA) {
    if (item.collisionClass === 'visual_obstacle') {
      assert.ok(item.obstacleId, `Visual obstacle ${item.id} must link to an existing obstacleId`);
      const obs = obstacleMap.get(item.obstacleId!);
      assert.ok(obs, `Linked obstacle ${item.obstacleId} must exist in OBSTACLES`);
      assert.ok(
        Math.hypot(item.x - obs!.x, item.z - obs!.z) < 2,
        `Visual obstacle ${item.id} must stay aligned to ${obs!.id}`
      );
    }
  }

  // Every toxic_pool must be placed inside an existing toxic_sludge HAZARD_TILES circle
  const toxicTiles = HAZARD_TILES.filter((h) => h.kind === 'toxic_sludge');
  const toxicSprites = layoutA.filter((item) => item.spriteId === 'toxic_pool');
  assert.ok(toxicSprites.length >= toxicTiles.length);
  for (const ts of toxicSprites) {
    const insideToxic = toxicTiles.some(
      (h) => Math.hypot(ts.x - h.x, ts.z - h.z) <= h.radius
    );
    assert.ok(insideToxic, `toxic_pool ${ts.id} must stay strictly inside a toxic_sludge hazard tile`);
  }

  // Protected tutorial landmarks & Palong Gates remain clear of props
  const protectedPoints = [
    LANDMARKS.tutorialStart,
    LANDMARKS.tutorialSafeCarcass,
    LANDMARKS.tutorialContestedCarcass,
    LANDMARKS.redPaperBoat,
    ...PALONG_GATES,
  ];
  for (const item of layoutA) {
    for (const pt of protectedPoints) {
      assert.ok(
        Math.hypot(item.x - pt.x, item.z - pt.z) >= 85,
        `Prop ${item.id} (${item.spriteId}) is too close to protected landmark`
      );
    }
  }

  // OBSTACLES array & arena collision resolution remain completely unmodified
  assert.deepEqual(OBSTACLES, obstacleSnapshot);
  const sampleDecor = layoutA.find((i) => i.spriteId === 'tall_reeds')!;
  const resolved = resolveArenaCollision(sampleDecor.x, sampleDecor.z, 26, false);
  assert.ok(
    Math.hypot(resolved.x - sampleDecor.x, resolved.z - sampleDecor.z) < 1,
    'Pure decoration sprite must not block Keli movement'
  );
});

test('Evolution-specific carcass sprites match exact defeated Keli level across Phase 1 (1-39), Phase 2 (40-79), and Phase 3 (80-100)', () => {
  // Phase 1 kill: Lv.18 aquatic catfish -> carcass_phase1
  {
    const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
    const killer = sim.kelis[0];
    const victim = sim.kelis[1];
    victim.level = 18;
    sim.kelis[2].level += 2; // preserve 100 total (each started at 20)
    assertFragmentInvariant(sim, 'phase 1 pre-kill');

    killEntity(sim, victim, killer);
    assert.equal(victim.alive, false);
    assert.equal(victim.level, 0);
    assert.equal(victim.eliminatedAtLevel, 18);
    assert.equal(sim.carcasses.length, 1);

    const carc = sim.carcasses[0];
    assert.equal(carc.mass, 18);
    assert.equal(carc.initialMass, 18);
    assert.equal(carc.evolutionPhaseAtDeath, 1);
    assert.equal(resolveCarcassEvolutionPhase(carc), 1);
    assert.equal(getCarcassSpriteId(resolveCarcassEvolutionPhase(carc)), 'carcass_phase1');
    assertFragmentInvariant(sim, 'phase 1 post-kill');
  }

  // Phase 2 kill: Lv.55 armed legless Keli -> carcass_phase2
  {
    const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
    const killer = sim.kelis[0];
    const victim = sim.kelis[1];
    // Redistribute exact 100 fragments so victim is Lv.55
    sim.kelis[0].level = 20;
    sim.kelis[1].level = 55;
    sim.kelis[2].level = 10;
    sim.kelis[3].level = 10;
    sim.kelis[4].level = 5;
    assertFragmentInvariant(sim, 'phase 2 pre-kill');

    killEntity(sim, victim, killer);
    const carc = sim.carcasses[0];
    assert.equal(carc.mass, 55);
    assert.equal(carc.initialMass, 55);
    assert.equal(carc.evolutionPhaseAtDeath, 2);
    assert.equal(resolveCarcassEvolutionPhase(carc), 2);
    assert.equal(getCarcassSpriteId(resolveCarcassEvolutionPhase(carc)), 'carcass_phase2');
    assertFragmentInvariant(sim, 'phase 2 post-kill');
  }

  // Phase 3 kill: Lv.84 amphibious Keli -> carcass_phase3
  {
    const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
    const killer = sim.kelis[0];
    const victim = sim.kelis[1];
    sim.kelis[0].level = 10;
    sim.kelis[1].level = 84;
    sim.kelis[2].level = 2;
    sim.kelis[3].level = 2;
    sim.kelis[4].level = 2;
    assertFragmentInvariant(sim, 'phase 3 pre-kill');

    killEntity(sim, victim, killer);
    const carc = sim.carcasses[0];
    assert.equal(carc.mass, 84);
    assert.equal(carc.initialMass, 84);
    assert.equal(carc.evolutionPhaseAtDeath, 3);
    assert.equal(resolveCarcassEvolutionPhase(carc), 3);
    assert.equal(getCarcassSpriteId(resolveCarcassEvolutionPhase(carc)), 'carcass_phase3');
    assertFragmentInvariant(sim, 'phase 3 post-kill');
  }
});

test('Carcass visual scale follows 1.0x / 1.4x / 1.8x phase ratios and shrinks subtly on depletion', () => {
  assert.equal(CARCASS_PHASE_SCALE_RATIOS[1], 1.0);
  assert.equal(CARCASS_PHASE_SCALE_RATIOS[2], 1.4);
  assert.equal(CARCASS_PHASE_SCALE_RATIOS[3], 1.8);

  const s1 = computeCarcassVisualScale(1, 20, 20);
  const s2 = computeCarcassVisualScale(2, 55, 55);
  const s3 = computeCarcassVisualScale(3, 85, 85);

  assert.ok(Math.abs(s2.height / s1.height - 1.4) < 1e-6);
  assert.ok(Math.abs(s3.height / s1.height - 1.8) < 1e-6);
  assert.ok(s1.width > s1.height, 'Carcasses maintain natural horizontal catfish silhouette');

  // Subtle depletion shrink (<= 14%, never shrinks abruptly to tiny speck)
  const s3Depleted = computeCarcassVisualScale(3, 2, 85);
  assert.ok(s3Depleted.height < s3.height);
  assert.ok(s3Depleted.height > s3.height * 0.84);
});

test('Carcass value glow is driven strictly by remaining fragments independent of evolution stage', () => {
  // 1-9 fragments -> subtle pale blue glow
  for (const frags of [1, 2, 5, 9]) {
    const glow = getCarcassValueGlow(frags);
    assert.equal(glow.tier, 'low');
    assert.equal(glow.colorHex, 0x7dd3fc);
    assert.equal(glow.shimmerParticles, false);
  }

  // 10-29 fragments -> gentle gold glow
  for (const frags of [10, 15, 29]) {
    const glow = getCarcassValueGlow(frags);
    assert.equal(glow.tier, 'medium');
    assert.equal(glow.colorHex, 0xfbbf24);
    assert.equal(glow.shimmerParticles, false);
  }

  // 30+ fragments -> strong gold shimmer + rising particles
  for (const frags of [30, 40, 84]) {
    const glow = getCarcassValueGlow(frags);
    assert.equal(glow.tier, 'high');
    assert.equal(glow.colorHex, 0xfde047);
    assert.equal(glow.shimmerParticles, true);
  }

  // Key scenario: Level 80+ carcass depleted from 40 -> 2 fragments keeps Phase 3 sprite
  // while glow shifts cleanly from strong gold shimmer to subtle pale blue!
  const richPhase3 = { evolutionPhaseAtDeath: 3 as const, mass: 40 };
  const depletedPhase3 = { evolutionPhaseAtDeath: 3 as const, mass: 2 };
  assert.equal(getCarcassSpriteId(resolveCarcassEvolutionPhase(richPhase3)), 'carcass_phase3');
  assert.equal(getCarcassSpriteId(resolveCarcassEvolutionPhase(depletedPhase3)), 'carcass_phase3');
  assert.equal(getCarcassValueGlow(richPhase3.mass).tier, 'high');
  assert.equal(getCarcassValueGlow(depletedPhase3.mass).tier, 'low');
});

test('Multiplayer world-state serialization replicates identical evolutionPhaseAtDeath and initialMass across all clients', () => {
  const sim = new GameSimulation(5, 'royale', 'Host', { emitLocalSound: false });
  sim.kelis[0].level = 10;
  sim.kelis[1].level = 52; // Phase 2
  sim.kelis[2].level = 14; // Phase 1
  sim.kelis[3].level = 12;
  sim.kelis[4].level = 12;

  killEntity(sim, sim.kelis[1], sim.kelis[0]);
  killEntity(sim, sim.kelis[2], sim.kelis[0]);

  const packetClientA = sim.getRemoteWorldStateFor(sim.kelis[0].id, 42);
  const packetClientB = sim.getRemoteWorldStateFor(sim.kelis[3].id, 42);

  assert.equal(packetClientA.carcasses.length, 2);
  assert.deepEqual(packetClientA.carcasses, packetClientB.carcasses);

  const p2Carc = packetClientA.carcasses.find((c) => c.sourceId === sim.kelis[1].id)!;
  const p1Carc = packetClientA.carcasses.find((c) => c.sourceId === sim.kelis[2].id)!;
  assert.equal(p2Carc.evolutionPhaseAtDeath, 2);
  assert.equal(p2Carc.initialMass, 52);
  assert.equal(p1Carc.evolutionPhaseAtDeath, 1);
  assert.equal(p1Carc.initialMass, 14);

  // Apply authoritative packet on two separate RemoteSimulationView client instances
  const clientA = new RemoteSimulationView(sim.kelis[0].id);
  const clientB = new RemoteSimulationView(sim.kelis[3].id);
  clientA.applyServerState(packetClientA);
  clientB.applyServerState(packetClientB);

  assert.deepEqual(clientA.carcasses, clientB.carcasses);
  assert.equal(
    resolveCarcassEvolutionPhase(clientA.carcasses.find((c) => c.id === p2Carc.id)!),
    2
  );
  assert.equal(
    resolveCarcassEvolutionPhase(clientB.carcasses.find((c) => c.id === p1Carc.id)!),
    1
  );
});

test('Partial feeding preserves carcass evolution stage until fully consumed and respects strict 100-fragment conservation', () => {
  const sim = new GameSimulation(5, 'royale', 'Awang', { emitLocalSound: false });
  const player = sim.getPlayer();
  const victim = sim.kelis[1];

  // Give victim 45 fragments (Phase 2) so partial feeding drops it below 40 while remaining Phase 2
  sim.kelis[0].level = 15;
  sim.kelis[1].level = 45;
  sim.kelis[2].level = 14;
  sim.kelis[3].level = 13;
  sim.kelis[4].level = 13;

  // Position victim right beside player in safe water
  victim.x = player.x + 28;
  victim.z = player.z;
  killEntity(sim, victim, player);

  const carc = sim.carcasses[0];
  assert.equal(carc.evolutionPhaseAtDeath, 2);
  assert.equal(carc.mass, 45);

  // Start feeding channel, then interrupt mid-channel -> carcass keeps full mass & Phase 2
  player.x = carc.x + 12;
  player.z = carc.z;
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: true });
  sim.step(0.05);
  assert.equal(player.feedingTargetId, carc.id);
  assertFragmentInvariant(sim, 'during feeding channel');

  // Interrupt by moving away -> carcass remains intact with exact mass
  player.x = carc.x + 240;
  sim.setInput({ moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false });
  sim.step(0.05);
  assert.equal(player.feedingTargetId, null);
  assert.equal(sim.carcasses.length, 1);
  assert.equal(sim.carcasses[0].mass, 45);
  assertFragmentInvariant(sim, 'after feeding interruption');

  // Partial atomic transfer drops remaining fragments from 45 -> 5 (low tier glow!)
  // while carcass visual evolution phase MUST remain Phase 2!
  const taken = sim.transferCarcassFragments(player, carc.id, 40);
  assert.equal(taken, 40);
  assert.equal(sim.carcasses.length, 1, 'Partially eaten carcass must remain visible');
  assert.equal(sim.carcasses[0].mass, 5);
  assert.equal(resolveCarcassEvolutionPhase(sim.carcasses[0]), 2);
  assert.equal(getCarcassSpriteId(resolveCarcassEvolutionPhase(sim.carcasses[0])), 'carcass_phase2');
  assert.equal(getCarcassValueGlow(sim.carcasses[0].mass).tier, 'low');
  assertFragmentInvariant(sim, 'after partial consumption');

  // Finish consuming remaining 5 fragments -> carcass disappears ONLY when mass reaches 0
  const remainder = sim.transferCarcassFragments(player, carc.id);
  assert.equal(remainder, 5);
  assert.equal(sim.carcasses.length, 0, 'Fully consumed carcass must be removed');
  assertFragmentInvariant(sim, 'after complete consumption');
});

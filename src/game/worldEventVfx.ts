import * as THREE from 'three';
import { SIM_TO_3D, simTo3D } from './arena.ts';
import type { ActiveWorldEventState } from './types.ts';

export const FLOOD_STREAK_COUNT = 44;
export const SILT_PUFF_COUNT = 56;
export const WHIRLPOOL_DEBRIS_COUNT = 32;

const _dummy = new THREE.Object3D();

function createDriftingNetTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, 256, 128);
  // Subtle murky shadow under rope mesh
  ctx.fillStyle = 'rgba(28, 22, 14, 0.24)';
  ctx.fillRect(10, 14, 236, 100);

  // Diagonal woven fishing net diamond pattern
  ctx.strokeStyle = 'rgba(226, 198, 145, 0.88)';
  ctx.lineWidth = 2.4;
  const step = 18;
  for (let x = -128; x < 384; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 12);
    ctx.lineTo(x + 104, 116);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + 104, 12);
    ctx.lineTo(x, 116);
    ctx.stroke();
  }

  // Heavy top & bottom lead/float border ropes
  ctx.strokeStyle = '#fb923c';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(8, 16);
  ctx.lineTo(248, 16);
  ctx.moveTo(8, 112);
  ctx.lineTo(248, 112);
  ctx.stroke();

  // Floating cork buoys along top rope
  for (let i = 0; i < 6; i++) {
    const bx = 24 + i * 41;
    ctx.fillStyle = '#f97316';
    ctx.strokeStyle = '#431407';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(bx, 16, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface WorldEventVfxPoolSummary {
  disposed: boolean;
  visible: boolean;
  activeKind: ActiveWorldEventState['kind'] | null;
  floodStreakCapacity: number;
  siltPuffCapacity: number;
  whirlpoolDebrisCapacity: number;
  geometriesTracked: number;
  materialsTracked: number;
  texturesTracked: number;
}

/**
 * Pooled, offscreen-culled Three.js renderer for Wang Kelian dynamic environmental events.
 * Zero per-frame geometry/material/vector allocations; full GPU disposal in dispose().
 */
export class WorldEventVfxPool {
  private readonly scene: THREE.Scene;
  private readonly rootGroup: THREE.Group;

  // Tracked GPU resources for guaranteed deterministic disposal
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];

  // 1. Kepala Air (Flash Flood)
  private readonly floodGroup: THREE.Group;
  private readonly floodCorridorMesh: THREE.Mesh;
  private readonly floodCorridorMat: THREE.MeshBasicMaterial;
  private readonly floodBorderMesh: THREE.LineSegments;
  private readonly floodBorderMat: THREE.LineBasicMaterial;
  private readonly floodStreaks: THREE.InstancedMesh;
  private readonly floodStreakMat: THREE.MeshBasicMaterial;
  private readonly floodSeeds: Float32Array;

  // 2. Air Keruh (Silt Bloom — strictly localized underwater turbidity, NEVER full-screen dark)
  private readonly siltGroup: THREE.Group;
  private readonly siltDiscMesh: THREE.Mesh;
  private readonly siltDiscMat: THREE.MeshBasicMaterial;
  private readonly siltRimMesh: THREE.Mesh;
  private readonly siltRimMat: THREE.MeshBasicMaterial;
  private readonly siltPuffs: THREE.InstancedMesh;
  private readonly siltPuffMat: THREE.MeshBasicMaterial;
  private readonly siltSeeds: Float32Array;

  // 3. Pusaran Dalam (Deep Whirlpool)
  private readonly whirlpoolGroup: THREE.Group;
  private readonly whirlpoolRings: THREE.Mesh[] = [];
  private readonly whirlpoolRingMats: THREE.MeshBasicMaterial[] = [];
  private readonly whirlpoolCoreMesh: THREE.Mesh;
  private readonly whirlpoolCoreMat: THREE.MeshBasicMaterial;
  private readonly whirlpoolDebris: THREE.InstancedMesh;
  private readonly whirlpoolDebrisMat: THREE.MeshBasicMaterial;
  private readonly whirlpoolSeeds: Float32Array;

  // 4. Jaring Hanyut (Drifting Fishing Net)
  private readonly netGroup: THREE.Group;
  private readonly netQuadMesh: THREE.Mesh;
  private readonly netQuadMat: THREE.MeshBasicMaterial;
  private readonly netPathLine: THREE.Line;
  private readonly netPathMat: THREE.LineBasicMaterial;
  private readonly netPathPosAttr: THREE.BufferAttribute;

  private disposed = false;
  private lastActiveKind: ActiveWorldEventState['kind'] | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'WorldEventVfxRoot';
    this.rootGroup.visible = false;
    this.scene.add(this.rootGroup);

    // -----------------------------------------------------------------------
    // 1. Flash Flood pooled visuals
    // -----------------------------------------------------------------------
    this.floodGroup = new THREE.Group();
    this.floodGroup.visible = false;
    this.rootGroup.add(this.floodGroup);

    const corridorGeo = this.trackGeo(new THREE.PlaneGeometry(2, 2));
    corridorGeo.rotateX(-Math.PI / 2);
    this.floodCorridorMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      })
    );
    this.floodCorridorMesh = new THREE.Mesh(corridorGeo, this.floodCorridorMat);
    this.floodCorridorMesh.position.y = 0.08;
    this.floodGroup.add(this.floodCorridorMesh);

    // Subtle corridor outline edges (2 side rails in local unit square)
    const railGeo = this.trackGeo(new THREE.BufferGeometry());
    railGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          -1, 0.14, -1, 1, 0.14, -1,
          -1, 0.14, 1, 1, 0.14, 1,
        ]),
        3
      )
    );
    this.floodBorderMat = this.trackMat(
      new THREE.LineBasicMaterial({
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.48,
      })
    );
    this.floodBorderMesh = new THREE.LineSegments(railGeo, this.floodBorderMat);
    this.floodGroup.add(this.floodBorderMesh);

    const streakGeo = this.trackGeo(new THREE.PlaneGeometry(1.0, 0.22));
    streakGeo.rotateX(-Math.PI / 2);
    this.floodStreakMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xe0f2fe,
        transparent: true,
        opacity: 0.56,
        depthWrite: false,
      })
    );
    this.floodStreaks = new THREE.InstancedMesh(streakGeo, this.floodStreakMat, FLOOD_STREAK_COUNT);
    this.floodStreaks.frustumCulled = false;
    this.floodGroup.add(this.floodStreaks);

    this.floodSeeds = new Float32Array(FLOOD_STREAK_COUNT * 3);
    for (let i = 0; i < FLOOD_STREAK_COUNT; i++) {
      // Deterministic golden-ratio spread
      const u = (i * 0.6180339887) % 1;
      const v = ((i * 0.3819660113 + 0.17) % 1) * 2 - 1;
      this.floodSeeds[i * 3] = u;
      this.floodSeeds[i * 3 + 1] = v * 0.88;
      this.floodSeeds[i * 3 + 2] = 0.75 + (i % 5) * 0.18;
    }

    // -----------------------------------------------------------------------
    // 2. Silt Bloom pooled visuals (strictly localized ochre-brown turbidity)
    // -----------------------------------------------------------------------
    this.siltGroup = new THREE.Group();
    this.siltGroup.visible = false;
    this.rootGroup.add(this.siltGroup);

    const siltDiscGeo = this.trackGeo(new THREE.CircleGeometry(1, 36));
    siltDiscGeo.rotateX(-Math.PI / 2);
    this.siltDiscMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x7c5328,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      })
    );
    this.siltDiscMesh = new THREE.Mesh(siltDiscGeo, this.siltDiscMat);
    this.siltDiscMesh.position.y = 0.12;
    this.siltGroup.add(this.siltDiscMesh);

    const siltRimGeo = this.trackGeo(new THREE.RingGeometry(0.95, 1.0, 40));
    siltRimGeo.rotateX(-Math.PI / 2);
    this.siltRimMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xd97706,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      })
    );
    this.siltRimMesh = new THREE.Mesh(siltRimGeo, this.siltRimMat);
    this.siltRimMesh.position.y = 0.14;
    this.siltGroup.add(this.siltRimMesh);

    const puffGeo = this.trackGeo(new THREE.CircleGeometry(1, 12));
    puffGeo.rotateX(-Math.PI / 2);
    this.siltPuffMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x9a6b35,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      })
    );
    this.siltPuffs = new THREE.InstancedMesh(puffGeo, this.siltPuffMat, SILT_PUFF_COUNT);
    this.siltPuffs.frustumCulled = false;
    this.siltGroup.add(this.siltPuffs);

    this.siltSeeds = new Float32Array(SILT_PUFF_COUNT * 3);
    for (let i = 0; i < SILT_PUFF_COUNT; i++) {
      const ang = i * 2.3999632; // Golden angle
      const rNorm = Math.sqrt((i + 0.5) / SILT_PUFF_COUNT) * 0.88;
      this.siltSeeds[i * 3] = ang;
      this.siltSeeds[i * 3 + 1] = rNorm;
      this.siltSeeds[i * 3 + 2] = 0.75 + (i % 4) * 0.24;
    }

    // -----------------------------------------------------------------------
    // 3. Deep Whirlpool pooled visuals
    // -----------------------------------------------------------------------
    this.whirlpoolGroup = new THREE.Group();
    this.whirlpoolGroup.visible = false;
    this.rootGroup.add(this.whirlpoolGroup);

    const coreGeo = this.trackGeo(new THREE.CircleGeometry(1, 28));
    coreGeo.rotateX(-Math.PI / 2);
    this.whirlpoolCoreMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x062029,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      })
    );
    this.whirlpoolCoreMesh = new THREE.Mesh(coreGeo, this.whirlpoolCoreMat);
    this.whirlpoolCoreMesh.position.y = 0.1;
    this.whirlpoolGroup.add(this.whirlpoolCoreMesh);

    const ringSpecs = [
      { inner: 0.94, outer: 1.0, color: 0x5eead4, y: 0.14 },
      { inner: 0.62, outer: 0.69, color: 0x2dd4bf, y: 0.15 },
      { inner: 0.3, outer: 0.39, color: 0x99f6e4, y: 0.16 },
    ];
    for (let i = 0; i < ringSpecs.length; i++) {
      const spec = ringSpecs[i];
      const rGeo = this.trackGeo(new THREE.RingGeometry(spec.inner, spec.outer, 40, 1, 0, Math.PI * 1.75));
      rGeo.rotateX(-Math.PI / 2);
      const rMat = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        })
      );
      const mesh = new THREE.Mesh(rGeo, rMat);
      mesh.position.y = spec.y;
      this.whirlpoolGroup.add(mesh);
      this.whirlpoolRings.push(mesh);
      this.whirlpoolRingMats.push(rMat);
    }

    const debrisGeo = this.trackGeo(new THREE.PlaneGeometry(0.9, 0.32));
    debrisGeo.rotateX(-Math.PI / 2);
    this.whirlpoolDebrisMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xccfbf1,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      })
    );
    this.whirlpoolDebris = new THREE.InstancedMesh(
      debrisGeo,
      this.whirlpoolDebrisMat,
      WHIRLPOOL_DEBRIS_COUNT
    );
    this.whirlpoolDebris.frustumCulled = false;
    this.whirlpoolGroup.add(this.whirlpoolDebris);

    this.whirlpoolSeeds = new Float32Array(WHIRLPOOL_DEBRIS_COUNT * 3);
    for (let i = 0; i < WHIRLPOOL_DEBRIS_COUNT; i++) {
      this.whirlpoolSeeds[i * 3] = (i / WHIRLPOOL_DEBRIS_COUNT) * Math.PI * 2;
      this.whirlpoolSeeds[i * 3 + 1] = 0.18 + ((i * 0.6180339) % 0.78);
      this.whirlpoolSeeds[i * 3 + 2] = 0.8 + (i % 4) * 0.25;
    }

    // -----------------------------------------------------------------------
    // 4. Drifting Fishing Net pooled visuals
    // -----------------------------------------------------------------------
    this.netGroup = new THREE.Group();
    this.netGroup.visible = false;
    this.rootGroup.add(this.netGroup);

    const netTex = createDriftingNetTexture();
    if (netTex) {
      this.textures.push(netTex);
    }
    const netGeo = this.trackGeo(new THREE.PlaneGeometry(2, 2));
    netGeo.rotateX(-Math.PI / 2);
    this.netQuadMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: netTex ? 0xffffff : 0xfb923c,
        map: netTex ?? null,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      })
    );
    this.netQuadMesh = new THREE.Mesh(netGeo, this.netQuadMat);
    this.netQuadMesh.position.y = 0.22;
    this.netGroup.add(this.netQuadMesh);

    const pathGeo = this.trackGeo(new THREE.BufferGeometry());
    this.netPathPosAttr = new THREE.BufferAttribute(new Float32Array(6), 3);
    pathGeo.setAttribute('position', this.netPathPosAttr);
    this.netPathMat = this.trackMat(
      new THREE.LineBasicMaterial({
        color: 0xfdba74,
        transparent: true,
        opacity: 0.34,
      })
    );
    this.netPathLine = new THREE.Line(pathGeo, this.netPathMat);
    this.netGroup.add(this.netPathLine);
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  public getSummary(): WorldEventVfxPoolSummary {
    return {
      disposed: this.disposed,
      visible: this.rootGroup.visible,
      activeKind: this.lastActiveKind,
      floodStreakCapacity: FLOOD_STREAK_COUNT,
      siltPuffCapacity: SILT_PUFF_COUNT,
      whirlpoolDebrisCapacity: WHIRLPOOL_DEBRIS_COUNT,
      geometriesTracked: this.geometries.length,
      materialsTracked: this.materials.length,
      texturesTracked: this.textures.length,
    };
  }

  public update(
    event: ActiveWorldEventState | null,
    elapsed: number,
    focusX3D: number,
    focusZ3D: number,
    reducedMotion: boolean
  ): void {
    if (this.disposed) return;

    if (!event || event.phase === 'dormant' || event.phase === 'complete') {
      this.rootGroup.visible = false;
      this.floodGroup.visible = false;
      this.siltGroup.visible = false;
      this.whirlpoolGroup.visible = false;
      this.netGroup.visible = false;
      this.lastActiveKind = null;
      return;
    }

    const evX3D = simTo3D(event.x);
    const evZ3D = simTo3D(event.z);
    const evR3D = Math.max(event.radius, event.corridorHalfLength) * SIM_TO_3D;
    const distFromCamera = Math.hypot(evX3D - focusX3D, evZ3D - focusZ3D);
    // Offscreen culling margin (~135 3D units covers full camera viewport + margin)
    if (distFromCamera > evR3D + 145) {
      this.rootGroup.visible = false;
      this.lastActiveKind = event.kind;
      return;
    }

    this.rootGroup.visible = true;
    this.lastActiveKind = event.kind;
    const motionScale = reducedMotion ? 0.35 : 1.0;
    const isWarning = event.phase === 'warning';
    const warnPulse = isWarning
      ? 0.55 + 0.45 * Math.sin(elapsed * (reducedMotion ? 2.4 : 6.0))
      : 1.0;

    this.floodGroup.visible = event.kind === 'flash_flood';
    this.siltGroup.visible = event.kind === 'silt_bloom';
    this.whirlpoolGroup.visible = event.kind === 'whirlpool';
    this.netGroup.visible = event.kind === 'drifting_net';

    if (event.kind === 'flash_flood') {
      const halfL = event.corridorHalfLength * SIM_TO_3D;
      const halfW = event.corridorHalfWidth * SIM_TO_3D;
      this.floodGroup.position.set(evX3D, 0, evZ3D);
      this.floodGroup.rotation.y = -event.flowAngle;

      this.floodCorridorMesh.scale.set(halfL, 1, halfW);
      this.floodBorderMesh.scale.set(halfL, 1, halfW);
      this.floodCorridorMat.opacity = isWarning
        ? 0.06 + 0.08 * warnPulse
        : 0.04 + 0.14 * event.intensity;
      this.floodBorderMat.opacity = isWarning
        ? 0.25 + 0.35 * warnPulse
        : 0.18 + 0.34 * event.intensity;
      this.floodStreakMat.opacity = isWarning
        ? 0.16 * warnPulse
        : 0.12 + 0.48 * event.intensity;

      const speed = (isWarning ? 0.38 : 1.05) * motionScale;
      for (let i = 0; i < FLOOD_STREAK_COUNT; i++) {
        const u0 = this.floodSeeds[i * 3];
        const vNorm = this.floodSeeds[i * 3 + 1];
        const s = this.floodSeeds[i * 3 + 2];
        const prog = ((u0 + elapsed * speed * 0.45 * s) % 1) * 2 - 1;
        _dummy.position.set(prog * halfL * 0.94, 0.18, vNorm * halfW);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(4.5 * s, 1, 1.8);
        _dummy.updateMatrix();
        this.floodStreaks.setMatrixAt(i, _dummy.matrix);
      }
      this.floodStreaks.instanceMatrix.needsUpdate = true;
      return;
    }

    if (event.kind === 'silt_bloom') {
      const r3d = event.radius * SIM_TO_3D;
      this.siltGroup.position.set(evX3D, 0, evZ3D);
      this.siltDiscMesh.scale.set(r3d, 1, r3d);
      this.siltRimMesh.scale.set(r3d, 1, r3d);

      this.siltDiscMat.opacity = isWarning
        ? 0.07 + 0.06 * warnPulse
        : 0.06 + 0.22 * event.intensity;
      this.siltRimMat.opacity = isWarning
        ? 0.24 + 0.26 * warnPulse
        : 0.14 + 0.24 * event.intensity;
      this.siltPuffMat.opacity = isWarning
        ? 0.06 + 0.05 * warnPulse
        : 0.05 + 0.2 * event.intensity;

      for (let i = 0; i < SILT_PUFF_COUNT; i++) {
        const baseAng = this.siltSeeds[i * 3];
        const rNorm = this.siltSeeds[i * 3 + 1];
        const size = this.siltSeeds[i * 3 + 2];
        const swirl = baseAng + elapsed * 0.12 * motionScale * (i % 2 === 0 ? 1 : -1);
        const rad = r3d * rNorm;
        _dummy.position.set(
          Math.cos(swirl) * rad,
          0.22 + (i % 3) * 0.06,
          Math.sin(swirl) * rad
        );
        _dummy.rotation.set(0, 0, 0);
        const puffScale = (3.8 + size * 2.4) * (0.7 + 0.3 * event.intensity);
        _dummy.scale.set(puffScale, 1, puffScale);
        _dummy.updateMatrix();
        this.siltPuffs.setMatrixAt(i, _dummy.matrix);
      }
      this.siltPuffs.instanceMatrix.needsUpdate = true;
      return;
    }

    if (event.kind === 'whirlpool') {
      const r3d = event.radius * SIM_TO_3D;
      this.whirlpoolGroup.position.set(evX3D, 0, evZ3D);
      this.whirlpoolCoreMesh.scale.set(r3d * 0.34, 1, r3d * 0.34);
      this.whirlpoolCoreMat.opacity = isWarning
        ? 0.12 + 0.1 * warnPulse
        : 0.14 + 0.42 * event.intensity;

      const spin = elapsed * (isWarning ? 0.9 : 2.35) * motionScale;
      for (let i = 0; i < this.whirlpoolRings.length; i++) {
        const ring = this.whirlpoolRings[i];
        const mat = this.whirlpoolRingMats[i];
        ring.scale.set(r3d, 1, r3d);
        ring.rotation.y = spin * (1 + i * 0.48);
        mat.opacity = isWarning
          ? (0.2 + 0.28 * warnPulse) * (i === 0 ? 1 : 0.55)
          : (0.18 + 0.46 * event.intensity);
      }

      this.whirlpoolDebrisMat.opacity = isWarning
        ? 0.18 * warnPulse
        : 0.14 + 0.52 * event.intensity;

      for (let i = 0; i < WHIRLPOOL_DEBRIS_COUNT; i++) {
        const a0 = this.whirlpoolSeeds[i * 3];
        const r0 = this.whirlpoolSeeds[i * 3 + 1];
        const sp = this.whirlpoolSeeds[i * 3 + 2];
        const rCycle = ((r0 - elapsed * 0.14 * motionScale * sp) % 0.82 + 0.82) % 0.82 + 0.14;
        const ang = a0 + elapsed * (1.2 + (1 - rCycle) * 1.8) * motionScale;
        const rad = r3d * rCycle;
        _dummy.position.set(Math.cos(ang) * rad, 0.2, Math.sin(ang) * rad);
        _dummy.rotation.set(0, -ang, 0);
        _dummy.scale.set(1.8 + sp * 0.8, 1, 1.2);
        _dummy.updateMatrix();
        this.whirlpoolDebris.setMatrixAt(i, _dummy.matrix);
      }
      this.whirlpoolDebris.instanceMatrix.needsUpdate = true;
      return;
    }

    // drifting_net
    const netHalfSpan = event.corridorHalfLength * SIM_TO_3D;
    const netHalfThick = event.corridorHalfWidth * SIM_TO_3D;
    this.netQuadMesh.position.set(evX3D, 0.24, evZ3D);
    // Align wide net bar perpendicular to travel heading flowAngle
    this.netQuadMesh.rotation.set(0, -event.flowAngle + Math.PI * 0.5, 0);
    const sway = reducedMotion ? 0 : Math.sin(elapsed * 3.1) * 0.06;
    this.netQuadMesh.scale.set(netHalfSpan * (1 + sway), 1, netHalfThick * 1.15);
    this.netQuadMat.opacity = isWarning
      ? 0.32 + 0.28 * warnPulse
      : 0.2 + 0.72 * event.intensity;

    // Drift trajectory telegraph line
    const arr = this.netPathPosAttr.array as Float32Array;
    arr[0] = simTo3D(event.startX);
    arr[1] = 0.15;
    arr[2] = simTo3D(event.startZ);
    arr[3] = simTo3D(event.endX);
    arr[4] = 0.15;
    arr[5] = simTo3D(event.endZ);
    this.netPathPosAttr.needsUpdate = true;
    this.netPathMat.opacity = isWarning ? 0.24 + 0.26 * warnPulse : 0.18 * event.intensity;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rootGroup.visible = false;
    this.scene.remove(this.rootGroup);

    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i].dispose();
    }
    this.geometries.length = 0;

    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].dispose();
    }
    this.materials.length = 0;

    for (let i = 0; i < this.textures.length; i++) {
      this.textures[i].dispose();
    }
    this.textures.length = 0;
  }
}

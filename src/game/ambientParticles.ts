import * as THREE from 'three';
import { getElevationAt, HAZARD_TILES, simTo3D } from './arena';
import { HazardTileKind, WeatherState } from './types';

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface ParticleBufferData {
  count: number;
  positions: Float32Array;
  orbits: Float32Array;
  phases: Float32Array;
  colors: Float32Array;
}

export interface HazardParticleDataset {
  fireflies: ParticleBufferData;
  insects: ParticleBufferData;
}

const FIREFLY_COUNTS: Record<HazardTileKind, number> = {
  toxic_sludge: 14,
  quagmire: 16,
  thermal_vent: 12,
  rapids: 6,
};

const INSECT_COUNTS: Record<HazardTileKind, number> = {
  toxic_sludge: 10,
  quagmire: 12,
  thermal_vent: 8,
  rapids: 16,
};

const FIREFLY_PALETTE: Record<HazardTileKind, number[]> = {
  toxic_sludge: [0xbef264, 0x86efac, 0xfef08a],
  quagmire: [0xfde68a, 0xfbbf24, 0xd9f99d],
  thermal_vent: [0xfed7aa, 0xfdba74, 0xfef08a],
  rapids: [0xa5f3fc, 0xfde68a, 0x99f6e4],
};

const INSECT_PALETTE: Record<HazardTileKind, number[]> = {
  toxic_sludge: [0xd9f99d, 0xcbd5e1, 0xa7f3d0],
  quagmire: [0xfef3c7, 0xe2e8f0, 0xfde68a],
  thermal_vent: [0xffedd5, 0xe2e8f0, 0xfed7aa],
  rapids: [0xe0f2fe, 0xbae6fd, 0xf1f5f9],
};

/**
 * Deterministically generates subtle, domain-tuned firefly and small water insect
 * spawn buffers anchored around all water hazard tiles in the Wang Kelian basin.
 */
export function buildHazardParticleDataset(seed = 20261118): HazardParticleDataset {
  const rng = makeRng(seed);
  const workColor = new THREE.Color();

  let fireflyTotal = 0;
  let insectTotal = 0;
  for (const h of HAZARD_TILES) {
    fireflyTotal += FIREFLY_COUNTS[h.kind];
    insectTotal += INSECT_COUNTS[h.kind];
  }

  const ffPos = new Float32Array(fireflyTotal * 3);
  const ffOrb = new Float32Array(fireflyTotal * 4);
  const ffPh = new Float32Array(fireflyTotal * 4);
  const ffCol = new Float32Array(fireflyTotal * 3);

  const inPos = new Float32Array(insectTotal * 3);
  const inOrb = new Float32Array(insectTotal * 4);
  const inPh = new Float32Array(insectTotal * 4);
  const inCol = new Float32Array(insectTotal * 3);

  let ffIdx = 0;
  let inIdx = 0;

  const sampleTileSimPos = (
    tile: (typeof HAZARD_TILES)[number],
    minRatio: number,
    maxRatio: number
  ): { sx: number; sz: number } => {
    if (tile.shape === 'rect') {
      const halfL = tile.halfL ?? 200;
      const halfW = tile.halfW ?? 100;
      const ang = tile.angle ?? 0;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const along = (rng() * 2 - 1) * halfL * maxRatio;
      // Bias slightly toward outer foam banks for calmer eddies when minRatio > 0.5
      const sideSign = rng() > 0.5 ? 1 : -1;
      const acrossMag = (minRatio + rng() * (maxRatio - minRatio)) * halfW;
      const across = sideSign * acrossMag;
      return {
        sx: tile.x + along * cos - across * sin,
        sz: tile.z + along * sin + across * cos,
      };
    }

    const r = tile.radius * (minRatio + Math.sqrt(rng()) * (maxRatio - minRatio));
    const theta = rng() * Math.PI * 2;
    return {
      sx: tile.x + Math.cos(theta) * r,
      sz: tile.z + Math.sin(theta) * r,
    };
  };

  for (const tile of HAZARD_TILES) {
    const ffCount = FIREFLY_COUNTS[tile.kind];
    const ffColors = FIREFLY_PALETTE[tile.kind];
    for (let i = 0; i < ffCount; i++) {
      // Scatter organically from inner hazard rim out slightly past its edge
      const { sx, sz } = sampleTileSimPos(
        tile,
        tile.kind === 'rapids' ? 0.62 : 0.15,
        1.14
      );
      const elev = getElevationAt(sx, sz);
      const surfaceY = Math.max(0.08, elev * 2.2);
      const hoverY = surfaceY + 0.55 + rng() * 1.55;

      const p3 = ffIdx * 3;
      const p4 = ffIdx * 4;
      ffPos[p3 + 0] = simTo3D(sx);
      ffPos[p3 + 1] = hoverY;
      ffPos[p3 + 2] = simTo3D(sz);

      ffOrb[p4 + 0] = 0.85 + rng() * 1.65; // driftX
      ffOrb[p4 + 1] = 0.18 + rng() * 0.34; // driftY
      ffOrb[p4 + 2] = 0.85 + rng() * 1.65; // driftZ
      ffOrb[p4 + 3] = 0.42 + rng() * 0.48; // drift speed

      ffPh[p4 + 0] = rng() * Math.PI * 2; // motion phase
      ffPh[p4 + 1] = rng() * Math.PI * 2; // blink phase
      ffPh[p4 + 2] = 0.85 + rng() * 1.15; // blink frequency
      ffPh[p4 + 3] = 7.2 + rng() * 4.4;   // base point size

      workColor.setHex(ffColors[Math.floor(rng() * ffColors.length)]);
      ffCol[p3 + 0] = workColor.r;
      ffCol[p3 + 1] = workColor.g;
      ffCol[p3 + 2] = workColor.b;
      ffIdx++;
    }

    const inCount = INSECT_COUNTS[tile.kind];
    const inColors = INSECT_PALETTE[tile.kind];
    for (let i = 0; i < inCount; i++) {
      const { sx, sz } = sampleTileSimPos(
        tile,
        tile.kind === 'rapids' ? 0.08 : 0.12,
        1.06
      );
      const elev = getElevationAt(sx, sz);
      const surfaceY = Math.max(0.08, elev * 2.2);
      const hoverY = surfaceY + 0.2 + rng() * 0.65;

      const p3 = inIdx * 3;
      const p4 = inIdx * 4;
      inPos[p3 + 0] = simTo3D(sx);
      inPos[p3 + 1] = hoverY;
      inPos[p3 + 2] = simTo3D(sz);

      const fasterSkim = tile.kind === 'rapids' ? 1.35 : 1.0;
      inOrb[p4 + 0] = 0.35 + rng() * 0.85; // tight swarm orbitX
      inOrb[p4 + 1] = 0.08 + rng() * 0.18; // vertical dart
      inOrb[p4 + 2] = 0.35 + rng() * 0.85; // tight swarm orbitZ
      inOrb[p4 + 3] = (1.6 + rng() * 1.9) * fasterSkim; // brisker insect speed

      inPh[p4 + 0] = rng() * Math.PI * 2;
      inPh[p4 + 1] = rng() * Math.PI * 2;
      inPh[p4 + 2] = 4.2 + rng() * 3.8; // wing shimmer rate
      inPh[p4 + 3] = 3.4 + rng() * 2.1; // subtle tiny speck size

      workColor.setHex(inColors[Math.floor(rng() * inColors.length)]);
      inCol[p3 + 0] = workColor.r;
      inCol[p3 + 1] = workColor.g;
      inCol[p3 + 2] = workColor.b;
      inIdx++;
    }
  }

  return {
    fireflies: {
      count: fireflyTotal,
      positions: ffPos,
      orbits: ffOrb,
      phases: ffPh,
      colors: ffCol,
    },
    insects: {
      count: insectTotal,
      positions: inPos,
      orbits: inOrb,
      phases: inPh,
      colors: inCol,
    },
  };
}

function buildPointsGeometry(data: ParticleBufferData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('aOrbit', new THREE.BufferAttribute(data.orbits, 4));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(data.phases, 4));
  geo.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

const FIREFLY_VERT = `
  attribute vec4 aOrbit;
  attribute vec4 aPhase;
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uWeatherScale;
  uniform float uFogDensity;
  uniform float uReducedMotion;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float t = uTime * aOrbit.w + aPhase.x;
    vec3 pos = position;
    pos.x += sin(t) * aOrbit.x + cos(t * 0.63 + aPhase.x) * (aOrbit.x * 0.45);
    pos.y += sin(t * 1.31 + aPhase.y) * aOrbit.y - (1.0 - uWeatherScale) * 0.24;
    pos.z += cos(t * 0.87 + aPhase.x * 0.5) * aOrbit.z + sin(t * 0.51) * (aOrbit.z * 0.4);

    float blinkWave = 0.5 + 0.5 * sin(uTime * aPhase.z + aPhase.y);
    float pulse = mix(
      0.14 + 0.86 * pow(blinkWave, 2.8),
      0.52 + 0.24 * blinkWave,
      uReducedMotion
    );

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float fogDepth = max(1.0, -mvPosition.z);
    float fogFactor = exp(-uFogDensity * uFogDensity * fogDepth * fogDepth);

    vColor = aColor;
    vAlpha = pulse * uWeatherScale * fogFactor;

    gl_Position = projectionMatrix * mvPosition;
    float sizeScale = 0.78 + 0.36 * pulse;
    gl_PointSize = clamp(
      aPhase.w * sizeScale * uPixelRatio * (48.0 / max(12.0, fogDepth)),
      2.0,
      28.0
    );
  }
`;

const FIREFLY_FRAG = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;

    float halo = pow(1.0 - d, 2.4);
    float core = smoothstep(0.42, 0.0, d);
    vec3 col = mix(vColor, vec3(1.0, 0.99, 0.9), core * 0.65);
    float alpha = clamp((halo * 0.52 + core * 0.48) * vAlpha, 0.0, 0.92);
    gl_FragColor = vec4(col, alpha);
  }
`;

const INSECT_VERT = `
  attribute vec4 aOrbit;
  attribute vec4 aPhase;
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uWeatherScale;
  uniform float uFogDensity;
  uniform float uReducedMotion;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float t = uTime * aOrbit.w + aPhase.x;
    vec3 pos = position;
    // Erratic figure-8 pond midge hover
    pos.x += sin(t) * aOrbit.x + sin(t * 2.17 + aPhase.y) * (aOrbit.x * 0.32);
    pos.y += sin(t * 2.65 + aPhase.y) * aOrbit.y - (1.0 - uWeatherScale) * 0.12;
    pos.z += cos(t * 1.41 + aPhase.x) * aOrbit.z + cos(t * 2.53) * (aOrbit.z * 0.28);

    float flutter = 0.5 + 0.5 * sin(uTime * aPhase.z + aPhase.y);
    float vis = mix(0.38 + 0.48 * flutter, 0.55, uReducedMotion);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float fogDepth = max(1.0, -mvPosition.z);
    float fogFactor = exp(-uFogDensity * uFogDensity * fogDepth * fogDepth);

    vColor = aColor;
    vAlpha = vis * uWeatherScale * fogFactor;

    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(
      aPhase.w * uPixelRatio * (48.0 / max(12.0, fogDepth)),
      1.5,
      14.0
    );
  }
`;

const INSECT_FRAG = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;

    float body = smoothstep(1.0, 0.18, d);
    float alpha = body * 0.58 * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class AmbientHazardParticles {
  private fireflyPoints: THREE.Points;
  private insectPoints: THREE.Points;
  private fireflyMat: THREE.ShaderMaterial;
  private insectMat: THREE.ShaderMaterial;
  private fireflyGeo: THREE.BufferGeometry;
  private insectGeo: THREE.BufferGeometry;
  private scene: THREE.Scene;

  private simTime = 0;
  private weatherScale = 1;

  public readonly fireflyCount: number;
  public readonly insectCount: number;

  constructor(scene: THREE.Scene, pixelRatio = 1) {
    this.scene = scene;
    const dataset = buildHazardParticleDataset();
    this.fireflyCount = dataset.fireflies.count;
    this.insectCount = dataset.insects.count;

    this.fireflyGeo = buildPointsGeometry(dataset.fireflies);
    this.insectGeo = buildPointsGeometry(dataset.insects);

    this.fireflyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uWeatherScale: { value: 1 },
        uFogDensity: { value: 0.0046 },
        uReducedMotion: { value: 0 },
      },
      vertexShader: FIREFLY_VERT,
      fragmentShader: FIREFLY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.insectMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uWeatherScale: { value: 1 },
        uFogDensity: { value: 0.0046 },
        uReducedMotion: { value: 0 },
      },
      vertexShader: INSECT_VERT,
      fragmentShader: INSECT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.fireflyPoints = new THREE.Points(this.fireflyGeo, this.fireflyMat);
    this.fireflyPoints.frustumCulled = false;
    this.fireflyPoints.renderOrder = 10;
    this.scene.add(this.fireflyPoints);

    this.insectPoints = new THREE.Points(this.insectGeo, this.insectMat);
    this.insectPoints.frustumCulled = false;
    this.insectPoints.renderOrder = 9;
    this.scene.add(this.insectPoints);
  }

  public update(
    visualDt: number,
    reducedMotion: boolean,
    weather: WeatherState | undefined,
    fogDensity: number,
    pixelRatio?: number
  ) {
    this.simTime += visualDt * (reducedMotion ? 0.22 : 1.0);

    const kind = weather?.kind ?? 'clear';
    const intensity = weather?.intensity ?? 0;
    // Rain pushes insects down into reeds; fog lets fireflies glow softly through haze
    const targetWeatherScale =
      kind === 'light_rain'
        ? Math.max(0.32, 1.0 - 0.62 * intensity)
        : kind === 'basin_fog'
          ? 1.0 - 0.14 * intensity
          : 1.0;
    this.weatherScale = THREE.MathUtils.damp(this.weatherScale, targetWeatherScale, 2.2, visualDt);

    const rm = reducedMotion ? 1 : 0;
    this.fireflyMat.uniforms.uTime.value = this.simTime;
    this.fireflyMat.uniforms.uWeatherScale.value = this.weatherScale;
    this.fireflyMat.uniforms.uFogDensity.value = fogDensity;
    this.fireflyMat.uniforms.uReducedMotion.value = rm;

    this.insectMat.uniforms.uTime.value = this.simTime;
    this.insectMat.uniforms.uWeatherScale.value = this.weatherScale;
    this.insectMat.uniforms.uFogDensity.value = fogDensity;
    this.insectMat.uniforms.uReducedMotion.value = rm;

    if (pixelRatio !== undefined) {
      this.fireflyMat.uniforms.uPixelRatio.value = pixelRatio;
      this.insectMat.uniforms.uPixelRatio.value = pixelRatio;
    }
  }

  public dispose() {
    this.scene.remove(this.fireflyPoints);
    this.scene.remove(this.insectPoints);
    this.fireflyGeo.dispose();
    this.insectGeo.dispose();
    this.fireflyMat.dispose();
    this.insectMat.dispose();
  }
}

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  getElevationAt,
  HAZARD_TILES,
  LANDMARKS,
  OBSTACLES,
  PALONG_GATES,
  scaleArenaCoord,
  scaleArenaDist,
  SIM_TO_3D,
  simTo3D,
  threeDToSim,
  WORLD_SIZE,
} from './arena';
import { getEvolutionForm, getMilestoneTier } from '../data/abilities';
import { getEmoteSpec } from '../data/emotes';
import { AmbientHazardParticles } from './ambientParticles';
import { ArenaTextureSet, createArenaTextureSet } from './arenaTextures';
import {
  angleToFacingIndex,
  getSpriteSet,
  RIG_PART_ORDER,
  RigPartName,
  SpriteSet,
} from './sprites';
import {
  collectActiveStatusIndicators,
  MAX_FLOATING_STATUS_ICONS,
  StatusIconTextureCache,
  StatusIndicatorId,
  StatusIndicatorSpec,
} from './statusIcons';
import {
  CarcassEntity,
  DamageImpulse,
  DeathCamState,
  KeliEntity,
  PickupItem,
  PickupKind,
  WeatherState,
  WorldEffect,
  ZoneState,
} from './types';

export interface RenderableSimulation {
  kelis: KeliEntity[];
  carcasses: CarcassEntity[];
  pickups: PickupItem[];
  effects: WorldEffect[];
  zone: ZoneState;
  weather: WeatherState;
  cameraShake: number;
  damageImpulse?: DamageImpulse | null;
  getPlayer: () => KeliEntity;
  getSpectateTarget: () => KeliEntity | null;
  getDeathCam?: () => DeathCamState | null;
}

// Pre-allocated math helpers (zero GC in render loop)
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hitVec = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camDesiredPos = new THREE.Vector3();
const _camDesiredLook = new THREE.Vector3();
const _deathCamPos = new THREE.Vector3();
const _deathCamLook = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _skyClear = new THREE.Color(0x162b35);
const _skyRain = new THREE.Color(0x10222c);
const _skyFog = new THREE.Color(0x283e46);
const _workSky = new THREE.Color();
const RAIN_COUNT = 360;
const SPLASH_COUNT = 26;

interface RigPartNodes {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  baseX: number;
  baseY: number;
  baseZ: number;
}

interface ActorVisual {
  group: THREE.Group;
  rigGroup: THREE.Group;
  parts: Record<RigPartName, RigPartNodes>;
  lastTierKey: string;
  animPhase: number;
  idleTime: number;
  moveBlend: number;
  shadowMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
  runeMesh: THREE.Mesh;
  biteCone: THREE.Mesh;
  badgeMesh: THREE.Mesh;
  badgeTex: THREE.CanvasTexture;
  badgeCtx: CanvasRenderingContext2D;
  lastBadgeKey: string;
}

interface CarcassVisual {
  group: THREE.Group;
  spriteMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
}

interface PickupVisual {
  group: THREE.Group;
  spriteMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
}

export class ArenaScene3D {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private keyLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private spriteSet: SpriteSet;
  private arenaTextures!: ArenaTextureSet;
  private isSoftwareGl: boolean;

  private actorPool = new Map<string, ActorVisual>();
  private carcassPool = new Map<string, CarcassVisual>();
  private pickupPool = new Map<string, PickupVisual>();
  private fxPool = new Map<string, THREE.Mesh>();
  private zoneRingMesh!: THREE.Mesh;
  private paperBoatGroup!: THREE.Group;
  private toxicPools: THREE.Mesh[] = [];
  private hazardMeshes: THREE.Mesh[] = [];
  private waterMat!: THREE.MeshPhysicalMaterial;
  private waterUniforms = { uTime: { value: 0 } };

  // Pooled dynamic weather visuals
  private rainLines!: THREE.LineSegments;
  private rainPositions!: Float32Array;
  private rainOffsets!: Float32Array;
  private rainSplashMesh!: THREE.InstancedMesh;
  private rainSplashData!: Float32Array;
  private fogWisps: Array<{
    mesh: THREE.Mesh;
    offsetX: number;
    offsetZ: number;
    baseY: number;
    scale: number;
    phase: number;
    speedX: number;
    speedZ: number;
  }> = [];
  private ambientParticles!: AmbientHazardParticles;
  private statusIconCache!: StatusIconTextureCache;
  private statusIconGroup!: THREE.Group;
  private statusIconSlots: Array<{
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    currentId: StatusIndicatorId | null;
    opacity: number;
    scale: number;
  }> = [];
  private activeStatusScratch: StatusIndicatorSpec[] = [];
  private activeFloatingStatusIds: StatusIndicatorId[] = [];
  private showStatusIcons = true;

  private sharedQuadGeo = new THREE.PlaneGeometry(1, 1);
  private sharedRingGeo = new THREE.RingGeometry(0.76, 1.0, 32);
  private sharedDiscGeo = new THREE.CircleGeometry(1, 20);
  private sharedConeGeo: THREE.BufferGeometry;

  private frameId = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private visualElapsed = 0;
  private reducedMotion = false;
  private onContextLost?: () => void;

  // Elevated Ragnarok Online-inspired 2.5D camera
  private camOffset = new THREE.Vector3(0, 33, 33);
  private currentCamFocus = new THREE.Vector3(0, 0, 0);
  private currentCamPos = new THREE.Vector3(0, 33, 33);
  private currentCamLook = new THREE.Vector3(0, 0, 0);
  private cameraInitialized = false;
  private lastDamageImpulseSeq = 0;
  private impulseOffsetX = 0;
  private impulseOffsetZ = 0;
  private shakeClock = 0;

  constructor(
    container: HTMLElement,
    reducedMotion = false,
    onContextLost?: () => void
  ) {
    this.container = container;
    this.reducedMotion = reducedMotion;
    this.onContextLost = onContextLost;
    this.sharedConeGeo = this.createBiteConeGeometry();

    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });

    this.scene = new THREE.Scene();
    // Twilight Wang Kelian sunset-lake atmosphere matching reference plates
    this.scene.background = new THREE.Color(0x162b35);
    this.scene.fog = new THREE.FogExp2(0x162b35, 0.0046);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 650);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.spriteSet = getSpriteSet();
    this.arenaTextures = createArenaTextureSet(this.renderer.capabilities.getMaxAnisotropy());
    this.setupLighting();
    this.buildTerrainAndWater();
    this.buildInstancedRocksAndReeds();
    this.buildCompositeLandmarks();
    this.buildZoneBoundary();
    this.initWeatherVisuals();
    this.initFloatingStatusIcons();
    this.ambientParticles = new AmbientHazardParticles(
      this.scene,
      this.renderer.getPixelRatio()
    );

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  public setReducedMotion(val: boolean) {
    this.reducedMotion = val;
  }

  public setShowStatusIcons(val: boolean) {
    this.showStatusIcons = val;
    if (!val && this.statusIconGroup) {
      this.statusIconGroup.visible = false;
    }
  }

  public getActiveFloatingStatusIds(): readonly StatusIndicatorId[] {
    return this.activeFloatingStatusIds;
  }

  public resize() {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  public screenToSim(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_ndc, this.camera);
    const hit = _raycaster.ray.intersectPlane(_groundPlane, _hitVec);
    if (!hit) return null;
    return {
      x: threeDToSim(hit.x),
      z: threeDToSim(hit.z),
    };
  }

  private createBiteConeGeometry(): THREE.BufferGeometry {
    const geo = new THREE.CircleGeometry(1, 18, -0.85, 1.7);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }

  private setupLighting() {
    // Twilight cerulean sky vs warm mossy sunset ground
    this.hemiLight = new THREE.HemisphereLight(0x90c6d8, 0x4d3f2d, 1.08);
    this.scene.add(this.hemiLight);

    // Warm golden sunset key light (matching golden sun over karsts in Plate 1 & 2)
    this.keyLight = new THREE.DirectionalLight(0xffd288, 1.72);
    this.keyLight.position.set(42, 68, 30);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.width = 1024;
    this.keyLight.shadow.mapSize.height = 1024;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    const d = 55;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.camera.near = 5;
    this.keyLight.shadow.camera.far = 160;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    // Cool limestone twilight rim light
    const rim = new THREE.DirectionalLight(0x5eb8c4, 0.58);
    rim.position.set(-50, 30, -45);
    this.scene.add(rim);

    // Jantung Tasik warm miner lantern glow
    const lanternPos = LANDMARKS.minerLantern;
    const lanternLight = new THREE.PointLight(0xffb347, 5.8, 34, 1.5);
    lanternLight.position.set(simTo3D(lanternPos.x), 3.0, simTo3D(lanternPos.z));
    this.scene.add(lanternLight);

    // Tebing Kering kampung stilt house & pier lantern warm golden glow
    const pierGlow = new THREE.PointLight(0xffae42, 6.2, 48, 1.4);
    pierGlow.position.set(simTo3D(LANDMARKS.kampungJetty.x), 3.4, simTo3D(LANDMARKS.kampungJetty.z));
    this.scene.add(pierGlow);

    // Glowing emerald cavern beacon at Gua Kelam Tua (Plate 2 signature glowing cave)
    const caveGlow = new THREE.PointLight(0x52f28e, 7.8, 62, 1.35);
    caveGlow.position.set(simTo3D(LANDMARKS.guaKelamCavern.x), 4.8, simTo3D(LANDMARKS.guaKelamCavern.z));
    this.scene.add(caveGlow);

    // Restrained radioactive barrel glow
    const drumPos = LANDMARKS.radioactiveDrum;
    const drumLight = new THREE.PointLight(0x4ade80, 4.4, 26, 1.5);
    drumLight.position.set(simTo3D(drumPos.x), 1.8, simTo3D(drumPos.z));
    this.scene.add(drumLight);
  }

  private buildTerrainAndWater() {
    const segs = 224;
    const size3D = WORLD_SIZE * SIM_TO_3D;
    const terrainGeo = new THREE.PlaneGeometry(size3D * 1.35, size3D * 1.35, segs, segs);
    terrainGeo.rotateX(-Math.PI / 2);

    const pos = terrainGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    const colAlt = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      const sx = threeDToSim(wx);
      const sz = threeDToSim(wz);
      const elev = getElevationAt(sx, sz);
      pos.setY(i, elev * 2.2);

      const mottle =
        0.5 +
        0.3 * Math.sin(sx * 0.018 + sz * 0.011) +
        0.2 * Math.cos(sz * 0.023 - sx * 0.014);

      if (elev > 1.45) {
        // Steep limestone karst perimeter & mossy highland canopy
        col.setHex(0x55646c);
        colAlt.setHex(0x466842);
        col.lerp(colAlt, Math.min(1, mottle * 0.72));
      } else if (elev > 0.34) {
        // Tebing Kering warm ochre earth & mossy grass patches (Plate 2 & 3)
        col.setHex(0x8a7352);
        colAlt.setHex(0x4d6b44);
        col.lerp(colAlt, Math.max(0, Math.min(0.75, (mottle - 0.18) * 0.95)));
      } else if (elev > 0.02) {
        // Damp cobble & muddy shoreline margin (Plate 3 Lv.40 & Plate 6)
        const bankT = (elev - 0.02) / 0.32;
        col.setHex(0x746348);
        colAlt.setHex(0x967c5a);
        col.lerp(colAlt, bankT * 0.65 + mottle * 0.2);
      } else if (elev > -1.05) {
        // Luminous jade-turquoise mineral shallows
        const shallowT = (elev + 1.05) / 1.07;
        col.setHex(0x1a4f52);
        colAlt.setHex(0x2d7b6f);
        col.lerp(colAlt, shallowT * 0.75 + mottle * 0.2);
      } else {
        // Deep twilight slate-teal Lubuk Hitam silt
        col.setHex(0x0f2830);
        colAlt.setHex(0x183c44);
        col.lerp(colAlt, mottle * 0.45);
      }

      // Subtle emerald bioluminescent tint near Gua Kelam Tua cavern mouth
      const caveDist = Math.hypot(
        sx - LANDMARKS.guaKelamCavern.x,
        sz - LANDMARKS.guaKelamCavern.z
      );
      const caveGlowRad = scaleArenaDist(260);
      if (caveDist < caveGlowRad) {
        const caveBlend = (1 - caveDist / caveGlowRad) * 0.32;
        colAlt.setHex(0x36a868);
        col.lerp(colAlt, caveBlend);
      }

      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.arenaTextures.terrainDetail,
      bumpMap: this.arenaTextures.terrainBump,
      bumpScale: 0.24,
      roughness: 0.88,
      metalness: 0.04,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    this.scene.add(terrainMesh);

    // Animated Wang Kelian lagoon water with procedural caustic shimmer & golden sunset reflections
    const waterGeo = new THREE.PlaneGeometry(size3D * 1.15, size3D * 1.15, 128, 128);
    waterGeo.rotateX(-Math.PI / 2);

    this.waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x22696c,
      map: this.arenaTextures.waterAlbedo,
      bumpMap: this.arenaTextures.waterBump,
      bumpScale: 0.16,
      roughness: 0.15,
      metalness: 0.06,
      clearcoat: 0.82,
      clearcoatRoughness: 0.14,
      transparent: true,
      opacity: 0.66,
      depthWrite: false,
    });

    this.waterMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterUniforms.uTime;
      shader.vertexShader =
        `uniform float uTime;\nvarying vec3 vWaterWorldPos;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          transformed.y += sin(transformed.x * 0.32 + uTime * 1.8) * 0.06
                         + cos(transformed.z * 0.28 + uTime * 1.4) * 0.05;
          vWaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          `
        );
      shader.fragmentShader =
        `uniform float uTime;\nvarying vec3 vWaterWorldPos;\n` +
        shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `
          #include <emissivemap_fragment>
          float w1 = sin(vWaterWorldPos.x * 0.42 + uTime * 1.25) * cos(vWaterWorldPos.z * 0.38 - uTime * 0.95);
          float w2 = sin((vWaterWorldPos.x + vWaterWorldPos.z) * 0.55 - uTime * 1.55);
          float caustic = smoothstep(0.48, 0.95, w1 * 0.6 + w2 * 0.4);
          float glint = smoothstep(0.76, 0.98, sin(vWaterWorldPos.x * 0.25 - uTime * 0.9) * cos(vWaterWorldPos.z * 0.31 + uTime * 1.1));
          totalEmissiveRadiance += vec3(0.08, 0.34, 0.31) * caustic * 0.55;
          totalEmissiveRadiance += vec3(0.45, 0.32, 0.14) * glint * 0.35;
          `
        );
    };

    const waterMesh = new THREE.Mesh(waterGeo, this.waterMat);
    waterMesh.position.y = 0;
    waterMesh.renderOrder = 2;
    this.scene.add(waterMesh);

    // Luminous toxic-emerald bubble pools scattered across the basin (Plate 1 & 2 motif)
    const poolCoords = [
      { x: LANDMARKS.guaKelamCavern.x, z: LANDMARKS.guaKelamCavern.z, r: 9.2 },
      { x: LANDMARKS.radioactiveDrum.x, z: LANDMARKS.radioactiveDrum.z, r: 7.4 },
      { x: scaleArenaCoord(860), z: scaleArenaCoord(980), r: 5.2 },
      { x: scaleArenaCoord(1210), z: scaleArenaCoord(860), r: 5.5 },
      { x: scaleArenaCoord(640), z: scaleArenaCoord(1180), r: 4.8 },
      { x: scaleArenaCoord(1320), z: scaleArenaCoord(1090), r: 4.4 },
      { x: scaleArenaCoord(410), z: scaleArenaCoord(640), r: 6.0 },
      { x: scaleArenaCoord(1430), z: scaleArenaCoord(540), r: 5.6 },
      { x: scaleArenaCoord(760), z: scaleArenaCoord(1540), r: 4.9 },
      { x: scaleArenaCoord(1690), z: scaleArenaCoord(1290), r: 5.1 },
      { x: scaleArenaCoord(920), z: scaleArenaCoord(620), r: 5.0 },
      { x: scaleArenaCoord(1110), z: scaleArenaCoord(1560), r: 4.8 },
    ];
    poolCoords.forEach((p, idx) => {
      const poolMesh = new THREE.Mesh(
        this.sharedQuadGeo,
        new THREE.MeshBasicMaterial({
          map: this.arenaTextures.bioPool,
          color: 0xffffff,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      poolMesh.rotation.x = -Math.PI / 2;
      poolMesh.position.set(simTo3D(p.x), 0.06, simTo3D(p.z));
      const diam = p.r * 2.1;
      poolMesh.scale.set(diam, diam, 1);
      poolMesh.userData.baseDiam = diam;
      poolMesh.userData.phase = idx * 1.3;
      poolMesh.renderOrder = 3;
      this.scene.add(poolMesh);
      this.toxicPools.push(poolMesh);
    });

    // Environmental Hazard Tiles (toxic sludge pockets, current-heavy rapids, quagmires, thermal vents)
    HAZARD_TILES.forEach((h, idx) => {
      const elev = getElevationAt(h.x, h.z);
      const yPos = elev > 0.02 ? elev * 2.2 + 0.14 : 0.085;

      if (h.kind === 'rapids' && h.shape === 'rect') {
        const len3D = (h.halfL ?? 200) * 2 * SIM_TO_3D;
        const wid3D = (h.halfW ?? 100) * 2 * SIM_TO_3D;
        const geo = new THREE.PlaneGeometry(len3D, wid3D);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          map: this.arenaTextures.hazardRapids,
          transparent: true,
          opacity: 0.78,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(simTo3D(h.x), 0.09, simTo3D(h.z));
        mesh.rotation.y = -(h.angle ?? 0);
        mesh.renderOrder = 3;
        mesh.userData = { kind: h.kind, baseOpacity: 0.78, phase: idx * 0.7 };
        this.scene.add(mesh);
        this.hazardMeshes.push(mesh);
      } else {
        const tex =
          h.kind === 'toxic_sludge'
            ? this.arenaTextures.hazardSludge
            : h.kind === 'quagmire'
              ? this.arenaTextures.hazardQuagmire
              : this.arenaTextures.hazardThermal;
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: h.kind === 'toxic_sludge' ? 0.84 : h.kind === 'thermal_vent' ? 0.8 : 0.76,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const diam3D = h.radius * 2 * SIM_TO_3D;
        const mesh = new THREE.Mesh(this.sharedQuadGeo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(simTo3D(h.x), yPos, simTo3D(h.z));
        mesh.scale.set(diam3D, diam3D, 1);
        mesh.renderOrder = 3;
        mesh.userData = {
          kind: h.kind,
          baseDiam: diam3D,
          baseOpacity: mat.opacity,
          phase: idx * 0.9,
        };
        this.scene.add(mesh);
        this.hazardMeshes.push(mesh);
      }
    });
  }

  private buildInstancedRocksAndReeds() {
    const rockGeo = new THREE.DodecahedronGeometry(1, 2);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.arenaTextures.limestoneRock,
      bumpMap: this.arenaTextures.limestoneBump,
      bumpScale: 0.28,
      roughness: 0.85,
      metalness: 0.04,
    });

    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, OBSTACLES.length);
    rocks.castShadow = !this.isSoftwareGl;
    rocks.receiveShadow = true;

    const mossGeo = new THREE.DodecahedronGeometry(0.85, 1);
    const mossMat = new THREE.MeshStandardMaterial({
      color: 0x4b7444,
      roughness: 0.9,
      metalness: 0.02,
    });
    const mossEligible = OBSTACLES.filter((o) => o.kind !== 'boulder' || o.radius > 40);
    const mossCaps = new THREE.InstancedMesh(mossGeo, mossMat, mossEligible.length);
    mossCaps.receiveShadow = true;

    const tint = new THREE.Color();
    let mossIdx = 0;
    OBSTACLES.forEach((obs, i) => {
      const r3d = obs.radius * SIM_TO_3D;
      const h3d = obs.height * SIM_TO_3D;
      const baseElev = getElevationAt(obs.x, obs.z) * 1.5;
      _dummy.position.set(simTo3D(obs.x), baseElev + h3d * 0.35, simTo3D(obs.z));
      _dummy.rotation.set((i % 5) * 0.14, i * 1.1, (i % 3) * 0.1);
      _dummy.scale.set(r3d * 0.98, h3d * 0.88, r3d * 0.92);
      _dummy.updateMatrix();
      rocks.setMatrixAt(i, _dummy.matrix);

      if (obs.kind === 'root') tint.setHex(0x7a593c);
      else if (obs.kind === 'pillar') tint.setHex(0x6d7f76);
      else if (obs.kind === 'limestone') tint.setHex(0x88949b);
      else tint.setHex(0x918b7e);
      rocks.setColorAt(i, tint);

      if (obs.kind !== 'boulder' || obs.radius > 40) {
        _dummy.position.set(
          simTo3D(obs.x) + Math.sin(i) * r3d * 0.1,
          baseElev + h3d * 0.92,
          simTo3D(obs.z) + Math.cos(i) * r3d * 0.1
        );
        _dummy.rotation.set(0.1, i * 0.9, -0.08);
        _dummy.scale.set(r3d * 0.68, h3d * 0.28, r3d * 0.64);
        _dummy.updateMatrix();
        mossCaps.setMatrixAt(mossIdx, _dummy.matrix);
        tint.setHex(obs.kind === 'root' ? 0x528247 : 0x456b3e);
        mossCaps.setColorAt(mossIdx, tint);
        mossIdx++;
      }
    });
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.computeBoundingSphere();
    this.scene.add(rocks);

    mossCaps.instanceMatrix.needsUpdate = true;
    if (mossCaps.instanceColor) mossCaps.instanceColor.needsUpdate = true;
    mossCaps.computeBoundingSphere();
    this.scene.add(mossCaps);

    // Tropical river reeds & bank ferns across Sungai Berselirat and Tebing Kering edges
    const reedGeo = new THREE.ConeGeometry(0.16, 2.4, 5);
    reedGeo.translate(0, 1.2, 0);
    const reedMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.02,
    });
    const reedCount = 240;
    const reeds = new THREE.InstancedMesh(reedGeo, reedMat, reedCount);
    const bankReedX0 = scaleArenaCoord(1245);
    const bankReedXSpan = scaleArenaDist(360);
    const bankReedZ0 = scaleArenaCoord(940);
    const bankReedZSpan = scaleArenaDist(480);
    const streamReedX0 = scaleArenaCoord(240);
    const streamReedXSpan = scaleArenaDist(640);
    const streamReedZ0 = scaleArenaCoord(1160);
    const streamReedZSpan = scaleArenaDist(580);

    for (let i = 0; i < reedCount; i++) {
      const inBankCluster = i >= 160;
      const sx = inBankCluster
        ? bankReedX0 + ((i * 397) % bankReedXSpan)
        : streamReedX0 + ((i * 463) % streamReedXSpan);
      const sz = inBankCluster
        ? bankReedZ0 + ((i * 521) % bankReedZSpan)
        : streamReedZ0 + ((i * 613) % streamReedZSpan);
      const elev = getElevationAt(sx, sz);
      _dummy.position.set(
        simTo3D(sx),
        elev > 0 ? elev * 2.0 : Math.min(-0.15, elev * 1.6),
        simTo3D(sz)
      );
      _dummy.rotation.set(Math.sin(i) * 0.14, i * 0.7, Math.cos(i) * 0.14);
      const sc = 0.78 + (i % 4) * 0.18;
      _dummy.scale.set(sc, sc, sc);
      _dummy.updateMatrix();
      reeds.setMatrixAt(i, _dummy.matrix);
      tint.setHex(i % 3 === 0 ? 0x5c8b49 : i % 3 === 1 ? 0x457343 : 0x6b904d);
      reeds.setColorAt(i, tint);
    }
    reeds.instanceMatrix.needsUpdate = true;
    if (reeds.instanceColor) reeds.instanceColor.needsUpdate = true;
    reeds.computeBoundingSphere();
    this.scene.add(reeds);

    // Floating lily pads in calm Sungai Berselirat & shoreline shallows
    const padMat = new THREE.MeshBasicMaterial({
      map: this.arenaTextures.lilyPad,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
    });
    const padCount = 120;
    const pads = new THREE.InstancedMesh(this.sharedQuadGeo, padMat, padCount);
    const streamPadX0 = scaleArenaCoord(310);
    const streamPadXSpan = scaleArenaDist(520);
    const streamPadZ0 = scaleArenaCoord(1190);
    const streamPadZSpan = scaleArenaDist(520);
    const shorePadX0 = scaleArenaCoord(1220);
    const shorePadXSpan = scaleArenaDist(140);
    const shorePadZ0 = scaleArenaCoord(980);
    const shorePadZSpan = scaleArenaDist(420);

    for (let i = 0; i < padCount; i++) {
      const sx =
        i < 80
          ? streamPadX0 + ((i * 449) % streamPadXSpan)
          : shorePadX0 + ((i * 331) % shorePadXSpan);
      const sz =
        i < 80
          ? streamPadZ0 + ((i * 557) % streamPadZSpan)
          : shorePadZ0 + ((i * 409) % shorePadZSpan);
      _dummy.position.set(simTo3D(sx), 0.04, simTo3D(sz));
      _dummy.rotation.set(-Math.PI / 2, 0, (i * 1.3) % (Math.PI * 2));
      const sc = 1.15 + (i % 4) * 0.25;
      _dummy.scale.set(sc, sc, 1);
      _dummy.updateMatrix();
      pads.setMatrixAt(i, _dummy.matrix);
    }
    pads.instanceMatrix.needsUpdate = true;
    pads.computeBoundingSphere();
    pads.renderOrder = 3;
    this.scene.add(pads);
  }

  private buildCompositeLandmarks() {
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0xd4b692,
      map: this.arenaTextures.timberPlank,
      roughness: 0.84,
      metalness: 0.04,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0xc2ab8e,
      map: this.arenaTextures.nipaThatch,
      roughness: 0.92,
      metalness: 0.02,
    });
    const rustMat = new THREE.MeshStandardMaterial({ color: 0x72432d, roughness: 0.65, metalness: 0.52 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd9a85a, roughness: 0.32, metalness: 0.82 });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x9b7e53, roughness: 0.9, metalness: 0.02 });
    const lanternGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xffa629,
      emissiveIntensity: 2.1,
      roughness: 0.25,
    });
    const limestoneMat = new THREE.MeshStandardMaterial({
      color: 0x8d9aa1,
      map: this.arenaTextures.limestoneRock,
      bumpMap: this.arenaTextures.limestoneBump,
      bumpScale: 0.26,
      roughness: 0.86,
      metalness: 0.04,
    });

    // 1. Palong Tin-Mining Sluice Gates (Terowong Bijih)
    PALONG_GATES.forEach((gate) => {
      const g = new THREE.Group();
      g.position.set(simTo3D(gate.x), 0, simTo3D(gate.z));
      g.rotation.y = -gate.angle;

      const halfW = gate.width * SIM_TO_3D * 0.55;
      const postGeo = new THREE.CylinderGeometry(0.45, 0.55, 7.5, 8);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, woodMat);
        post.position.set(side * halfW, 2.5, 0);
        post.castShadow = !this.isSoftwareGl;
        g.add(post);

        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 2.4), rustMat);
        plate.position.set(side * (halfW - 0.5), 0.6, 0);
        g.add(plate);
      }

      const beam = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2.2, 0.7, 0.9), woodMat);
      beam.position.set(0, 5.8, 0);
      beam.castShadow = !this.isSoftwareGl;
      g.add(beam);

      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.7, 8), lanternGlowMat);
      lantern.position.set(0, 4.9, 0);
      g.add(lantern);

      this.scene.add(g);
    });

    // 2. Wooden Kampung Stilt Jetty & Stilt House on Tebing Kering (Plate 2 signature pier!)
    const jetty = new THREE.Group();
    jetty.position.set(simTo3D(LANDMARKS.kampungJetty.x), 0.35, simTo3D(LANDMARKS.kampungJetty.z));
    jetty.rotation.y = -0.35;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.42, 4.8), woodMat);
    deck.receiveShadow = true;
    deck.castShadow = !this.isSoftwareGl;
    jetty.add(deck);
    for (let p = -1; p <= 1; p++) {
      for (let q = -1; q <= 1; q += 2) {
        const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 3.5, 8), woodMat);
        piling.position.set(p * 4.6, -1.1, q * 1.9);
        jetty.add(piling);
      }
    }
    // Wooden cargo crate & coiled rope bollard on the pier
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.05, 1.15), woodMat);
    crate.position.set(-2.5, 0.72, -1.35);
    crate.castShadow = !this.isSoftwareGl;
    jetty.add(crate);
    const ropeCoil = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.14, 6, 14), ropeMat);
    ropeCoil.rotation.x = Math.PI / 2;
    ropeCoil.position.set(4.1, 0.28, 1.5);
    jetty.add(ropeCoil);

    const postLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 3.0, 8), woodMat);
    postLamp.position.set(-4.4, 1.5, 1.85);
    jetty.add(postLamp);
    const jettyLantern = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.62), lanternGlowMat);
    jettyLantern.position.set(-4.4, 3.0, 1.85);
    jetty.add(jettyLantern);
    this.scene.add(jetty);

    // Kampung Timber Stilt House on Tebing Kering ridge (warm glowing window + porch eaves)
    const hut = new THREE.Group();
    hut.position.set(simTo3D(LANDMARKS.kampungHut.x), 2.2, simTo3D(LANDMARKS.kampungHut.z));
    hut.rotation.y = -0.5;
    const hutBody = new THREE.Mesh(new THREE.BoxGeometry(6.8, 3.7, 5.4), woodMat);
    hutBody.position.y = 2.0;
    hutBody.castShadow = !this.isSoftwareGl;
    hut.add(hutBody);
    const hutWindow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), lanternGlowMat);
    hutWindow.position.set(0, 2.15, 2.72);
    hut.add(hutWindow);
    const hutRoof = new THREE.Mesh(new THREE.ConeGeometry(6.0, 2.8, 4), roofMat);
    hutRoof.position.y = 5.15;
    hutRoof.rotation.y = Math.PI / 4;
    hutRoof.castShadow = !this.isSoftwareGl;
    hut.add(hutRoof);
    for (const sx of [-2.7, 2.7]) {
      for (const sz of [-2.1, 2.1]) {
        const stilt = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 3.3, 6), woodMat);
        stilt.position.set(sx, -0.45, sz);
        hut.add(stilt);
      }
    }
    this.scene.add(hut);

    // 3. Gua Kelam Tua Luminous Emerald Cavern Arch (Plate 2 NW cavern landmark)
    const cavern = new THREE.Group();
    cavern.position.set(simTo3D(LANDMARKS.guaKelamCavern.x), 0.1, simTo3D(LANDMARKS.guaKelamCavern.z));
    cavern.rotation.y = 0.72;
    cavern.scale.setScalar(1.35);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.DodecahedronGeometry(2.6, 1), limestoneMat);
      pillar.position.set(side * 4.2, 2.2, 0);
      pillar.scale.set(0.95, 1.85, 1.1);
      pillar.castShadow = !this.isSoftwareGl;
      cavern.add(pillar);
    }
    const archCap = new THREE.Mesh(new THREE.DodecahedronGeometry(3.4, 1), limestoneMat);
    archCap.position.set(0, 5.2, -0.4);
    archCap.scale.set(1.85, 0.75, 1.0);
    archCap.castShadow = !this.isSoftwareGl;
    cavern.add(archCap);
    this.scene.add(cavern);

    // 4. Ruptured Radioactive Barrel at Jantung Tasik
    const drumGroup = new THREE.Group();
    drumGroup.position.set(simTo3D(LANDMARKS.radioactiveDrum.x), -1.0, simTo3D(LANDMARKS.radioactiveDrum.z));
    drumGroup.rotation.set(0.38, 0.6, 1.12);
    const drumBody = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.6, 14), rustMat);
    drumGroup.add(drumBody);
    const band1 = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.08, 6, 16), brassMat);
    band1.rotation.x = Math.PI / 2;
    band1.position.y = 0.6;
    drumGroup.add(band1);
    const band2 = band1.clone();
    band2.position.y = -0.6;
    drumGroup.add(band2);
    this.scene.add(drumGroup);

    // 5. Aisyah's Red Paper Boat at Jantung Tasik roots
    this.paperBoatGroup = new THREE.Group();
    this.paperBoatGroup.position.set(simTo3D(LANDMARKS.redPaperBoat.x), 0.14, simTo3D(LANDMARKS.redPaperBoat.z));
    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xc0392b,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const hullGeo = new THREE.CylinderGeometry(0.15, 0.75, 1.6, 4);
    hullGeo.rotateZ(Math.PI / 2);
    hullGeo.scale(1.0, 0.5, 0.65);
    const hull = new THREE.Mesh(hullGeo, paperMat);
    this.paperBoatGroup.add(hull);
    const sail = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.85, 3), paperMat);
    sail.position.y = 0.35;
    this.paperBoatGroup.add(sail);
    this.scene.add(this.paperBoatGroup);
  }

  private buildZoneBoundary() {
    const geo = new THREE.RingGeometry(0.985, 1.015, 96);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.zoneRingMesh = new THREE.Mesh(geo, mat);
    this.zoneRingMesh.position.y = 0.25;
    this.zoneRingMesh.renderOrder = 4;
    this.scene.add(this.zoneRingMesh);
  }

  private createActorVisual(): ActorVisual {
    const group = new THREE.Group();
    const rigGroup = new THREE.Group();
    const parts = {} as Record<RigPartName, RigPartNodes>;

    RIG_PART_ORDER.forEach((partName, idx) => {
      const pivot = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        alphaTest: 0.12,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.sharedQuadGeo, mat);
      mesh.renderOrder = 5 + idx;
      pivot.add(mesh);
      rigGroup.add(pivot);

      parts[partName] = {
        pivot,
        mesh,
        mat,
        baseX: 0,
        baseY: 0.5,
        baseZ: 0,
      };
    });
    group.add(rigGroup);

    const shadowMesh = new THREE.Mesh(
      this.sharedDiscGeo,
      new THREE.MeshBasicMaterial({
        color: 0x050808,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      })
    );
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.04;
    shadowMesh.renderOrder = 3;
    group.add(shadowMesh);

    const ringMesh = new THREE.Mesh(
      this.sharedRingGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.07;
    ringMesh.renderOrder = 3;
    group.add(ringMesh);

    const runeMesh = new THREE.Mesh(
      this.sharedQuadGeo,
      new THREE.MeshBasicMaterial({
        map: this.arenaTextures.playerRuneRing,
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    runeMesh.rotation.x = -Math.PI / 2;
    runeMesh.position.y = 0.09;
    runeMesh.visible = false;
    runeMesh.renderOrder = 4;
    group.add(runeMesh);

    const biteCone = new THREE.Mesh(
      this.sharedConeGeo,
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    biteCone.position.y = 0.25;
    biteCone.visible = false;
    biteCone.renderOrder = 6;
    group.add(biteCone);

    // RPG overhead nameplate matching Plate 2 (Lv. X Awang Keli + HP bar) + top emote callout slot
    const badgeCanvas = document.createElement('canvas');
    badgeCanvas.width = 160;
    badgeCanvas.height = 68;
    const badgeCtx = badgeCanvas.getContext('2d')!;
    const badgeTex = new THREE.CanvasTexture(badgeCanvas);
    badgeTex.colorSpace = THREE.SRGBColorSpace;
    const badgeMesh = new THREE.Mesh(
      this.sharedQuadGeo,
      new THREE.MeshBasicMaterial({ map: badgeTex, transparent: true, depthWrite: false })
    );
    badgeMesh.scale.set(5.4, 2.295, 1);
    badgeMesh.renderOrder = 15;
    group.add(badgeMesh);

    this.scene.add(group);
    return {
      group,
      rigGroup,
      parts,
      lastTierKey: '',
      animPhase: Math.random() * Math.PI * 2,
      idleTime: Math.random() * Math.PI * 2,
      moveBlend: 0,
      shadowMesh,
      ringMesh,
      runeMesh,
      biteCone,
      badgeMesh,
      badgeTex,
      badgeCtx,
      lastBadgeKey: '',
    };
  }

  private syncActorRigTier(
    vis: ActorVisual,
    tier: ReturnType<typeof getMilestoneTier>,
    rigRev: number
  ) {
    vis.lastTierKey = `${tier}-${rigRev}`;
    const tierParts = this.spriteSet.rigParts[tier];

    for (const partName of RIG_PART_ORDER) {
      const spec = tierParts[partName];
      const node = vis.parts[partName];
      node.pivot.visible = spec.active;
      node.baseX = spec.uPivot - 0.5;
      node.baseY = 1.0 - spec.vPivot;
      node.baseZ = spec.layerZ;
      node.pivot.position.set(node.baseX, node.baseY, node.baseZ);
      node.mesh.position.set(0.5 - spec.uPivot, spec.vPivot - 0.5, 0);

      if (node.mat.map !== spec.texture) {
        node.mat.map = spec.texture;
        node.mat.needsUpdate = true;
      }
    }
  }

  private updateActorBadge(vis: ActorVisual, k: KeliEntity, playerLevel: number) {
    const hpBucket = Math.round((k.hp / Math.max(1, k.maxHp)) * 20);
    const emoteId = k.activeEmote ?? '';
    const bountyPts = k.bountyReward ?? 0;
    const key = `${k.level}-${hpBucket}-${k.isPlayer ? 1 : 0}-${k.level > playerLevel ? 'd' : 'p'}-${k.stunTimer > 0 ? 's' : ''}-${k.venomTimer > 0 ? 'v' : ''}-${k.isSpeaking ? 'm' : ''}-${emoteId}-${bountyPts}`;
    if (key === vis.lastBadgeKey) return;
    vis.lastBadgeKey = key;

    const ctx = vis.badgeCtx;
    ctx.clearRect(0, 0, 160, 68);

    // Optional overhead Emote Signal / Rival Taunt / Bounty callout ribbon
    const emoteSpec = getEmoteSpec(k.activeEmote);
    if (emoteSpec) {
      ctx.fillStyle = emoteSpec.category === 'taunt' ? 'rgba(34, 10, 14, 0.94)' : 'rgba(9, 23, 34, 0.94)';
      ctx.fillRect(18, 2, 124, 20);
      ctx.strokeStyle = emoteSpec.color;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(18, 2, 124, 20);
      // Small downward pointer notch
      ctx.beginPath();
      ctx.moveTo(75, 22);
      ctx.lineTo(80, 27);
      ctx.lineTo(85, 22);
      ctx.closePath();
      ctx.fillStyle = emoteSpec.color;
      ctx.fill();

      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = emoteSpec.color;
      ctx.fillText(emoteSpec.overheadText, 80, 12);
    } else if (bountyPts > 0) {
      ctx.fillStyle = 'rgba(38, 12, 14, 0.94)';
      ctx.fillRect(22, 3, 116, 18);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(22, 3, 116, 18);
      ctx.font = 'bold 10.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fde68a';
      ctx.fillText(`BOUNTY +${bountyPts} EVO`, 80, 12);
    }

    const yOff = 28;

    // Dark RPG plaque with thin brass border
    ctx.fillStyle = 'rgba(13, 21, 27, 0.88)';
    ctx.fillRect(6, yOff + 2, 148, 20);
    ctx.strokeStyle = emoteSpec
      ? emoteSpec.color
      : bountyPts > 0
        ? '#fbbf24'
        : k.isSpeaking
          ? '#4ade80'
          : k.isPlayer
            ? '#c99c4a'
            : k.level > playerLevel
              ? '#b91c1c'
              : '#3a545e';
    ctx.lineWidth = emoteSpec || k.isSpeaking || bountyPts > 0 ? 1.8 : 1.2;
    ctx.strokeRect(6, yOff + 2, 148, 20);

    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = k.isPlayer ? '#f3d285' : k.level > playerLevel ? '#fca5a5' : '#e2e8f0';
    const baseLabel = k.isPlayer ? `Lv.${k.level} Awang Keli` : `Lv.${k.level} ${k.name.slice(0, 9)}`;
    const label = k.isSpeaking ? `(( )) ${baseLabel}` : baseLabel;
    ctx.fillText(label, 80, yOff + 12);

    // HP bar
    ctx.fillStyle = '#0c1216';
    ctx.fillRect(14, yOff + 25, 132, 6);
    const pct = Math.max(0, Math.min(1, k.hp / Math.max(1, k.maxHp)));
    ctx.fillStyle = k.isPlayer ? '#38bdf8' : k.level > playerLevel ? '#ef4444' : '#34d399';
    ctx.fillRect(14, yOff + 25, Math.round(132 * pct), 6);

    if (k.venomTimer > 0) {
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(14, yOff + 33, 56, 3);
    }
    if (k.stunTimer > 0) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(90, yOff + 33, 56, 3);
    }

    vis.badgeTex.needsUpdate = true;
  }

  private createCarcassVisual(): CarcassVisual {
    const group = new THREE.Group();
    const spriteMesh = new THREE.Mesh(
      this.sharedQuadGeo,
      new THREE.MeshBasicMaterial({
        map: this.spriteSet.carcass,
        transparent: true,
        alphaTest: 0.12,
        side: THREE.DoubleSide,
      })
    );
    spriteMesh.renderOrder = 4;
    group.add(spriteMesh);

    const ringMesh = new THREE.Mesh(
      this.sharedRingGeo,
      new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.08;
    ringMesh.renderOrder = 3;
    group.add(ringMesh);

    this.scene.add(group);
    return { group, spriteMesh, ringMesh };
  }

  private createPickupVisual(kind: PickupKind): PickupVisual {
    const tex =
      kind === 'kelp_salve'
        ? this.arenaTextures.pickupHeal
        : kind === 'amphetide'
          ? this.arenaTextures.pickupSpeed
          : kind === 'fang_charge'
            ? this.arenaTextures.pickupDamage
            : kind === 'carapace_ward'
              ? this.arenaTextures.pickupShield
              : kind === 'monsoon_dew'
                ? this.arenaTextures.pickupMonsoonDew
                : kind === 'storm_fin'
                  ? this.arenaTextures.pickupStormFin
                  : this.arenaTextures.pickupThunderRoe;

    const ringColor =
      kind === 'kelp_salve'
        ? 0x4ade80
        : kind === 'amphetide'
          ? 0x38bdf8
          : kind === 'fang_charge'
            ? 0xfb7185
            : kind === 'carapace_ward'
              ? 0xfbbf24
              : kind === 'monsoon_dew'
                ? 0x2dd4bf
                : kind === 'storm_fin'
                  ? 0x60a5fa
                  : 0xc084fc;

    const group = new THREE.Group();
    const spriteMesh = new THREE.Mesh(
      this.sharedQuadGeo,
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    spriteMesh.scale.set(2.5, 2.5, 1);
    spriteMesh.renderOrder = 5;
    group.add(spriteMesh);

    const ringMesh = new THREE.Mesh(
      this.sharedRingGeo,
      new THREE.MeshBasicMaterial({
        color: ringColor,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = -0.35;
    ringMesh.renderOrder = 3;
    group.add(ringMesh);

    this.scene.add(group);
    return { group, spriteMesh, ringMesh };
  }

  private initWeatherVisuals() {
    // 1. Pooled light monsoon rain streaks centered around camera focus
    this.rainPositions = new Float32Array(RAIN_COUNT * 6);
    this.rainOffsets = new Float32Array(RAIN_COUNT * 3);
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainOffsets[i * 3 + 0] = (Math.random() - 0.5) * 86;
      this.rainOffsets[i * 3 + 1] = Math.random() * 28;
      this.rainOffsets[i * 3 + 2] = (Math.random() - 0.5) * 86;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    const rainMat = new THREE.LineBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.rainLines = new THREE.LineSegments(rainGeo, rainMat);
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.rainLines.renderOrder = 12;
    this.scene.add(this.rainLines);

    // 2. Pooled raindrop ripple rings across nearby water surface
    const splashMat = new THREE.MeshBasicMaterial({
      color: 0xa5f3fc,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.rainSplashMesh = new THREE.InstancedMesh(this.sharedRingGeo, splashMat, SPLASH_COUNT);
    this.rainSplashMesh.frustumCulled = false;
    this.rainSplashMesh.visible = false;
    this.rainSplashMesh.renderOrder = 4;
    this.rainSplashData = new Float32Array(SPLASH_COUNT * 3);
    for (let i = 0; i < SPLASH_COUNT; i++) {
      this.rainSplashData[i * 3 + 0] = (Math.random() - 0.5) * 64;
      this.rainSplashData[i * 3 + 1] = (Math.random() - 0.5) * 64;
      this.rainSplashData[i * 3 + 2] = Math.random();
    }
    this.scene.add(this.rainSplashMesh);

    // 3. Pooled drifting basin fog/mist sheets hovering over the water
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.arenaTextures.fogWisp,
        color: 0xd4eceb,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.sharedQuadGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 11;
      const scale = 28 + (i % 4) * 9;
      mesh.scale.set(scale, scale, 1);
      this.scene.add(mesh);

      const angle = (i / 14) * Math.PI * 2;
      const dist = 12 + (i % 3) * 14;
      this.fogWisps.push({
        mesh,
        offsetX: Math.cos(angle) * dist,
        offsetZ: Math.sin(angle) * dist,
        baseY: 2.2 + (i % 4) * 1.4,
        scale,
        phase: i * 1.37,
        speedX: (i % 2 === 0 ? 1 : -1) * (0.8 + (i % 3) * 0.35),
        speedZ: (i % 3 === 0 ? 0.65 : -0.45),
      });
    }
  }

  private initFloatingStatusIcons() {
    this.statusIconCache = new StatusIconTextureCache(
      this.renderer.capabilities.getMaxAnisotropy()
    );
    this.statusIconGroup = new THREE.Group();
    this.statusIconGroup.visible = false;
    this.statusIconGroup.renderOrder = 16;

    for (let i = 0; i < MAX_FLOATING_STATUS_ICONS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.sharedQuadGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 16;
      this.statusIconGroup.add(mesh);
      this.statusIconSlots.push({
        mesh,
        mat,
        currentId: null,
        opacity: 0,
        scale: 0.72,
      });
    }

    this.scene.add(this.statusIconGroup);
  }

  private updateFloatingStatusIcons(
    target: KeliEntity | null,
    vis: ActorVisual | undefined,
    sim: RenderableSimulation,
    dt: number,
    elapsed: number
  ) {
    this.activeFloatingStatusIds.length = 0;

    if (!this.showStatusIcons || !target || !target.alive || !vis) {
      this.statusIconGroup.visible = false;
      for (let i = 0; i < this.statusIconSlots.length; i++) {
        const slot = this.statusIconSlots[i];
        slot.mesh.visible = false;
        slot.currentId = null;
        slot.opacity = 0;
        slot.scale = 0.72;
      }
      return;
    }

    const count = collectActiveStatusIndicators(target, sim, this.activeStatusScratch);
    if (count === 0) {
      this.statusIconGroup.visible = false;
      for (let i = 0; i < this.statusIconSlots.length; i++) {
        const slot = this.statusIconSlots[i];
        slot.mesh.visible = false;
        slot.currentId = null;
        slot.opacity = 0;
        slot.scale = 0.72;
      }
      return;
    }

    const hasTopRibbon = Boolean(
      getEmoteSpec(target.activeEmote) || (target.bountyReward ?? 0) > 0
    );
    const anchorY = vis.group.position.y + vis.badgeMesh.position.y + (hasTopRibbon ? 2.52 : 1.62);
    this.statusIconGroup.visible = true;
    this.statusIconGroup.position.set(vis.group.position.x, anchorY, vis.group.position.z);
    this.statusIconGroup.quaternion.copy(this.camera.quaternion);

    const iconW = 1.62;
    const iconH = 1.88;
    const spacing = 1.74;

    for (let i = 0; i < MAX_FLOATING_STATUS_ICONS; i++) {
      const slot = this.statusIconSlots[i];
      if (i >= count) {
        slot.mesh.visible = false;
        slot.currentId = null;
        slot.opacity = 0;
        slot.scale = 0.72;
        continue;
      }

      const spec = this.activeStatusScratch[i];
      this.activeFloatingStatusIds.push(spec.id);

      if (slot.currentId !== spec.id) {
        slot.currentId = spec.id;
        slot.mat.map = this.statusIconCache.getTexture(spec.id);
        slot.mat.needsUpdate = true;
        slot.opacity = this.reducedMotion ? 1 : Math.min(slot.opacity, 0.35);
        slot.scale = this.reducedMotion ? 1 : 0.78;
      }

      slot.mesh.visible = true;
      slot.opacity = this.reducedMotion
        ? 1
        : THREE.MathUtils.damp(slot.opacity, 1, 11, dt);
      slot.scale = this.reducedMotion
        ? 1
        : THREE.MathUtils.damp(slot.scale, 1, 12, dt);

      const xOffset = (i - (count - 1) * 0.5) * spacing;
      const bobY = this.reducedMotion
        ? 0
        : Math.sin(elapsed * 3.1 + i * 1.15) * 0.085;
      const urgencyPulse =
        !this.reducedMotion && spec.category === 'critical'
          ? 1 + Math.sin(elapsed * 6.5) * 0.055
          : 1;
      const s = slot.scale * urgencyPulse;

      slot.mesh.position.set(xOffset, bobY, 0.06);
      slot.mesh.scale.set(iconW * s, iconH * s, 1);
      slot.mat.opacity = slot.opacity;
    }
  }

  private updateWeatherVisuals(weather: WeatherState, dt: number, elapsed: number) {
    const kind = weather?.kind ?? 'clear';
    const intensity = weather?.intensity ?? 0;

    // 1. Dynamic FogExp2, Sky tint, and Light damping
    const targetDensity =
      kind === 'basin_fog'
        ? 0.0046 + intensity * 0.0195
        : kind === 'light_rain'
          ? 0.0046 + intensity * 0.0048
          : 0.0046;

    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = THREE.MathUtils.damp(fog.density, targetDensity, 2.8, dt);

    if (kind === 'basin_fog') {
      _workSky.copy(_skyClear).lerp(_skyFog, intensity);
    } else if (kind === 'light_rain') {
      _workSky.copy(_skyClear).lerp(_skyRain, intensity);
    } else {
      _workSky.copy(_skyClear);
    }
    fog.color.lerp(_workSky, 1 - Math.exp(-3.0 * dt));
    (this.scene.background as THREE.Color).copy(fog.color);

    const targetKeyInt =
      kind === 'basin_fog'
        ? 1.72 - intensity * 0.56
        : kind === 'light_rain'
          ? 1.72 - intensity * 0.44
          : 1.72;
    const targetHemiInt =
      kind === 'basin_fog'
        ? 1.08 + intensity * 0.14
        : kind === 'light_rain'
          ? 1.08 - intensity * 0.16
          : 1.08;
    this.keyLight.intensity = THREE.MathUtils.damp(this.keyLight.intensity, targetKeyInt, 2.5, dt);
    this.hemiLight.intensity = THREE.MathUtils.damp(this.hemiLight.intensity, targetHemiInt, 2.5, dt);

    const cx = this.currentCamFocus.x;
    const cz = this.currentCamFocus.z;

    // 2. Rain streaks & splash rings
    const rainActive = kind === 'light_rain' && intensity > 0.02;
    this.rainLines.visible = rainActive;
    this.rainSplashMesh.visible = rainActive;

    if (rainActive) {
      const fallSpeed = this.reducedMotion ? 8 : 34;
      const windX = this.reducedMotion ? -1.4 : -6.2;
      const windZ = this.reducedMotion ? 0.5 : 2.1;
      const streakDx = -0.32;
      const streakDy = 1.65;
      const streakDz = 0.12;

      for (let i = 0; i < RAIN_COUNT; i++) {
        const idx = i * 3;
        let ox = this.rainOffsets[idx + 0] + windX * dt;
        let oy = this.rainOffsets[idx + 1] - fallSpeed * dt;
        let oz = this.rainOffsets[idx + 2] + windZ * dt;

        if (oy < 0.2) {
          oy = 26 + Math.random() * 4;
          ox = (Math.random() - 0.5) * 86;
          oz = (Math.random() - 0.5) * 86;
        }
        this.rainOffsets[idx + 0] = ox;
        this.rainOffsets[idx + 1] = oy;
        this.rainOffsets[idx + 2] = oz;

        const pIdx = i * 6;
        const wx = cx + ox;
        const wy = oy;
        const wz = cz + oz;
        this.rainPositions[pIdx + 0] = wx;
        this.rainPositions[pIdx + 1] = wy;
        this.rainPositions[pIdx + 2] = wz;
        this.rainPositions[pIdx + 3] = wx + streakDx;
        this.rainPositions[pIdx + 4] = wy + streakDy;
        this.rainPositions[pIdx + 5] = wz + streakDz;
      }
      (this.rainLines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.rainLines.material as THREE.LineBasicMaterial).opacity =
        (this.reducedMotion ? 0.24 : 0.42) * intensity;

      // Water droplet ripple rings
      for (let i = 0; i < SPLASH_COUNT; i++) {
        const sIdx = i * 3;
        let ph = this.rainSplashData[sIdx + 2] + dt * (this.reducedMotion ? 0.8 : 1.75);
        if (ph >= 1) {
          ph -= 1;
          this.rainSplashData[sIdx + 0] = (Math.random() - 0.5) * 64;
          this.rainSplashData[sIdx + 1] = (Math.random() - 0.5) * 64;
        }
        this.rainSplashData[sIdx + 2] = ph;
        const wx = cx + this.rainSplashData[sIdx + 0];
        const wz = cz + this.rainSplashData[sIdx + 1];
        const simX = threeDToSim(wx);
        const simZ = threeDToSim(wz);
        const elev = getElevationAt(simX, simZ);
        const r = elev > 0.02 ? 0.001 : 0.25 + ph * 1.1;

        _dummy.position.set(wx, 0.07, wz);
        _dummy.rotation.set(-Math.PI / 2, 0, 0);
        _dummy.scale.set(r, r, 1);
        _dummy.updateMatrix();
        this.rainSplashMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.rainSplashMesh.instanceMatrix.needsUpdate = true;
      (this.rainSplashMesh.material as THREE.MeshBasicMaterial).opacity = 0.26 * intensity;
    }

    // 3. Basin fog & mist wisps
    const fogWispOpacity =
      kind === 'basin_fog'
        ? 0.32 * intensity
        : kind === 'light_rain'
          ? 0.1 * intensity
          : 0;
    const wispsActive = fogWispOpacity > 0.015;
    for (let i = 0; i < this.fogWisps.length; i++) {
      const w = this.fogWisps[i];
      w.mesh.visible = wispsActive;
      if (!wispsActive) continue;

      if (!this.reducedMotion) {
        w.offsetX += w.speedX * dt;
        w.offsetZ += w.speedZ * dt;
        if (w.offsetX > 46) w.offsetX = -46;
        if (w.offsetX < -46) w.offsetX = 46;
        if (w.offsetZ > 46) w.offsetZ = -46;
        if (w.offsetZ < -46) w.offsetZ = 46;
      }

      w.mesh.position.set(cx + w.offsetX, w.baseY, cz + w.offsetZ);
      w.mesh.rotation.z = Math.sin(elapsed * 0.2 + w.phase) * 0.35;
      const breathe = 1 + Math.sin(elapsed * 0.45 + w.phase) * 0.08;
      w.mesh.scale.set(w.scale * breathe, w.scale * breathe, 1);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity =
        fogWispOpacity * (0.75 + Math.sin(elapsed * 0.7 + w.phase) * 0.25);
    }
  }

  public render(sim: RenderableSimulation) {
    if (this.disposed) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const player = sim.getPlayer();
    const deathCam = !player.alive ? sim.getDeathCam?.() ?? null : null;
    const deathCamActive = Boolean(deathCam && deathCam.active && deathCam.remaining > 0);

    // Slow visual pacing during the 3-second Death Cam transition
    const visualScale = deathCamActive ? (this.reducedMotion ? 0.5 : 0.28) : 1.0;
    const visualDt = dt * visualScale;
    this.visualElapsed += visualDt;
    const elapsed = this.visualElapsed;

    this.waterUniforms.uTime.value = elapsed;
    if (!this.reducedMotion) {
      this.arenaTextures.hazardRapids.offset.x = -((elapsed * 0.75) % 1);
    }

    // Gentle pulse on bioluminescent pools, hazard pockets & paper boat bob
    this.toxicPools.forEach((p) => {
      const phase = (p.userData.phase as number) || 0;
      const baseDiam = (p.userData.baseDiam as number) || 6;
      const pulse = Math.sin(elapsed * 2.1 + phase);
      (p.material as THREE.MeshBasicMaterial).opacity = 0.62 + pulse * 0.18;
      const d = baseDiam * (1 + pulse * 0.06);
      p.scale.set(d, d, 1);
    });

    this.hazardMeshes.forEach((hm) => {
      const kind = hm.userData.kind as string;
      const phase = (hm.userData.phase as number) || 0;
      const baseOpacity = (hm.userData.baseOpacity as number) || 0.78;
      if (kind === 'toxic_sludge' || kind === 'thermal_vent') {
        const pulse = this.reducedMotion ? 0 : Math.sin(elapsed * 2.4 + phase);
        (hm.material as THREE.MeshBasicMaterial).opacity = baseOpacity + pulse * 0.1;
        const baseDiam = hm.userData.baseDiam as number;
        const s = baseDiam * (1 + pulse * 0.03);
        hm.scale.set(s, s, 1);
      }
    });

    if (this.paperBoatGroup) {
      this.paperBoatGroup.position.y = 0.14 + Math.sin(elapsed * 2.1) * 0.05;
      this.paperBoatGroup.rotation.z = Math.sin(elapsed * 1.6) * 0.06;
    }

    const killerEntity = deathCamActive
      ? sim.kelis.find((k) => k.alive && k.id === deathCam!.killerId) ?? null
      : null;
    const focus = player.alive
      ? player
      : killerEntity ?? sim.getSpectateTarget() ?? player;

    const targetCamX = simTo3D(focus.x);
    const targetCamZ = simTo3D(focus.z);
    const zoomScale = 1 + (focus.level / 100) * 0.25;
    _camTarget.set(targetCamX, 0, targetCamZ);

    if (!this.cameraInitialized) {
      this.currentCamFocus.copy(_camTarget);
      this.currentCamLook.copy(_camTarget);
      this.currentCamPos.set(
        _camTarget.x + this.camOffset.x * zoomScale,
        this.camOffset.y * zoomScale,
        _camTarget.z + this.camOffset.z * zoomScale
      );
      this.cameraInitialized = true;
    } else {
      const dampFactor = 1 - Math.exp(-8 * dt);
      this.currentCamFocus.lerp(_camTarget, dampFactor);
    }

    _camDesiredLook.copy(this.currentCamFocus);
    _camDesiredPos.set(
      this.currentCamFocus.x + this.camOffset.x * zoomScale,
      this.camOffset.y * zoomScale,
      this.currentCamFocus.z + this.camOffset.z * zoomScale
    );

    if (deathCamActive && deathCam) {
      const dur = Math.max(0.01, deathCam.duration);
      const progress = Math.max(0, Math.min(1, 1 - deathCam.remaining / dur));

      // Smooth ramp-in (0..0.16), hold rival perspective (0.16..0.78), smooth handoff to spectator cam (0.78..1.0)
      let cinematicBlend = 1;
      if (progress < 0.16) {
        const u = progress / 0.16;
        cinematicBlend = u * u * (3 - 2 * u);
      } else if (progress > 0.78) {
        const u = Math.min(1, (progress - 0.78) / 0.22);
        cinematicBlend = 1 - u * u * (3 - 2 * u);
      }
      if (this.reducedMotion) {
        cinematicBlend *= 0.55;
      }

      const rivalX = killerEntity ? simTo3D(killerEntity.x) : simTo3D(deathCam.deathX);
      const rivalZ = killerEntity ? simTo3D(killerEntity.z) : simTo3D(deathCam.deathZ);
      const rivalAngle = killerEntity ? killerEntity.facingAngle : focus.facingAngle;
      const fwdX = Math.cos(rivalAngle);
      const fwdZ = Math.sin(rivalAngle);
      const rightX = -fwdZ;
      const rightZ = fwdX;

      const backDist = 14.5 + zoomScale * 2.8;
      const shoulderOffset = this.reducedMotion ? 2.5 : 5.2;
      const heightOffset = this.reducedMotion ? 19.5 : 13.8 + zoomScale * 2.2;

      _deathCamPos.set(
        rivalX - fwdX * backDist + rightX * shoulderOffset,
        heightOffset,
        rivalZ - fwdZ * backDist + rightZ * shoulderOffset
      );

      // Frame the rival Keli and the fallen victim spot slightly ahead
      const deathSpotX = simTo3D(deathCam.deathX);
      const deathSpotZ = simTo3D(deathCam.deathZ);
      const distToDeath = Math.hypot(deathSpotX - rivalX, deathSpotZ - rivalZ);
      const spotWeight = distToDeath < 18 ? 0.35 : 0;
      _deathCamLook.set(
        rivalX * (1 - spotWeight) + deathSpotX * spotWeight + fwdX * 3.8,
        0.55,
        rivalZ * (1 - spotWeight) + deathSpotZ * spotWeight + fwdZ * 3.8
      );

      _camDesiredPos.lerp(_deathCamPos, cinematicBlend);
      _camDesiredLook.lerp(_deathCamLook, cinematicBlend);
    }

    const posDamp = 1 - Math.exp((deathCamActive ? -9.5 : -14) * dt);
    this.currentCamPos.lerp(_camDesiredPos, posDamp);
    this.currentCamLook.lerp(_camDesiredLook, posDamp);

    const impulse = sim.damageImpulse;
    if (impulse && impulse.seq !== this.lastDamageImpulseSeq) {
      this.lastDamageImpulseSeq = impulse.seq;
      if (!this.reducedMotion) {
        const kick = 1.2 + impulse.strength * 1.15;
        this.impulseOffsetX += impulse.x * kick;
        this.impulseOffsetZ += impulse.z * kick;
      }
    }
    const impulseDecay = Math.exp(-15 * dt);
    this.impulseOffsetX *= impulseDecay;
    this.impulseOffsetZ *= impulseDecay;

    let shakeX = 0;
    let shakeY = 0;
    let shakeZ = 0;
    let shakeRoll = 0;
    if (!this.reducedMotion) {
      this.shakeClock += dt;
      const trauma = Math.min(1, Math.max(0, sim.cameraShake));
      const traumaSq = trauma * trauma;
      if (traumaSq > 0.002 || Math.abs(this.impulseOffsetX) > 0.01 || Math.abs(this.impulseOffsetZ) > 0.01) {
        const t = this.shakeClock;
        shakeX =
          this.impulseOffsetX +
          (Math.sin(t * 53) * 0.65 + (Math.random() - 0.5) * 0.7) * traumaSq * 2.15;
        shakeY = (Math.cos(t * 61) * 0.55 + (Math.random() - 0.5) * 0.5) * traumaSq * 1.15;
        shakeZ =
          this.impulseOffsetZ +
          (Math.sin(t * 47 + 1.4) * 0.65 + (Math.random() - 0.5) * 0.7) * traumaSq * 2.15;
        shakeRoll = Math.sin(t * 43) * traumaSq * 0.022;
      }
    } else {
      this.impulseOffsetX = 0;
      this.impulseOffsetZ = 0;
    }

    this.camera.position.set(
      this.currentCamPos.x + shakeX,
      this.currentCamPos.y + shakeY,
      this.currentCamPos.z + shakeZ
    );
    this.camera.lookAt(
      this.currentCamLook.x + shakeX * 0.42,
      this.currentCamLook.y + shakeY * 0.35,
      this.currentCamLook.z + shakeZ * 0.42
    );
    if (shakeRoll !== 0) {
      this.camera.rotateZ(shakeRoll);
    }

    this.keyLight.position.set(this.currentCamLook.x + 35, 65, this.currentCamLook.z + 25);
    this.keyLight.target.position.copy(this.currentCamLook);

    this.updateWeatherVisuals(sim.weather, visualDt, elapsed);
    this.ambientParticles.update(
      visualDt,
      this.reducedMotion,
      sim.weather,
      (this.scene.fog as THREE.FogExp2).density,
      this.renderer.getPixelRatio()
    );

    this.zoneRingMesh.position.x = simTo3D(sim.zone.centerX);
    this.zoneRingMesh.position.z = simTo3D(sim.zone.centerZ);
    const zr = sim.zone.currentRadius * SIM_TO_3D;
    this.zoneRingMesh.scale.set(zr, zr, 1);

    const activeIds = new Set<string>();
    for (const k of sim.kelis) {
      if (!k.alive) continue;
      activeIds.add(k.id);

      let vis = this.actorPool.get(k.id);
      if (!vis) {
        vis = this.createActorVisual();
        this.actorPool.set(k.id, vis);
      }

      const tier = getMilestoneTier(k.level);
      const form = getEvolutionForm(k.level);
      const facing = angleToFacingIndex(k.facingAngle);
      const flipX = facing === 1 || facing === 2 || facing === 3;
      const isNorth = facing === 3 || facing === 4 || facing === 5;
      const isPureVertical = facing === 0 || facing === 4;

      const tierKey = `${tier}-${this.spriteSet.rigRevision}`;
      if (vis.lastTierKey !== tierKey) {
        this.syncActorRigTier(vis, tier, this.spriteSet.rigRevision);
      }

      const tintHex =
        k.hitFlashTimer > 0
          ? 0xff9988
          : k.veilTimer > 0
            ? 0x526b66
            : !k.isOnShore && k.isSubmerged
              ? 0xc4ebe6
              : isNorth
                ? 0xd6e1e6
                : 0xffffff;
      const partOpacity = k.veilTimer > 0 && !k.isPlayer ? 0.35 : 1.0;

      for (const partName of RIG_PART_ORDER) {
        const node = vis.parts[partName];
        if (!node.pivot.visible) continue;
        node.mat.color.setHex(tintHex);
        node.mat.opacity = partOpacity;
      }

      // Scale progression aligned with the Codex Sprite Scale Chart (Lv.1 fry -> Lv.100 Keli King)
      const tierStep =
        tier >= 100 ? 1.55 : tier >= 80 ? 0.95 : tier >= 40 ? 0.45 : 0;
      const size3D = 2.85 + (k.level / 100) * 4.2 + tierStep;
      const motionScale = this.reducedMotion ? 0.25 : 1.0;

      const speed = Math.hypot(k.vx, k.vz);
      const isMoving = speed > 10 && k.stunTimer <= 0;
      const moveTarget = isMoving ? Math.min(1, speed / 95) : 0;
      vis.moveBlend += (moveTarget - vis.moveBlend) * (1 - Math.exp(-10 * visualDt));
      vis.idleTime += visualDt * motionScale;

      const speedRatio = Math.min(1.3, speed / 120);
      const cycleFreq =
        form === 1 ? 6.5 + speedRatio * 5.2 : 5.6 + speedRatio * 5.0;
      vis.animPhase += visualDt * cycleFreq * (0.25 + vis.moveBlend * 0.75) * motionScale;

      const moveW = vis.moveBlend;
      const idleW = 1 - moveW;
      const p = vis.animPhase;
      const it = vis.idleTime;
      const breath = Math.sin(it * 2.3);

      // Compute idle + locomotion + combat pose per articulated plate
      let torsoRot = 0;
      let torsoDx = 0;
      let torsoDy = breath * 0.011 * idleW;
      let torsoSx = 1 - breath * 0.012 * idleW;
      let torsoSy = 1 + breath * 0.026 * idleW;

      let headRot =
        (Math.sin(it * 1.45) * 0.042 + Math.sin(it * 2.9) * 0.018) * idleW;
      let headDx = 0;
      let headDy = breath * 0.013 * idleW;

      let tailRot = Math.sin(it * 2.1 + 0.8) * 0.085 * idleW;
      let tailDy = 0;
      let tailSx = 1 + Math.sin(it * 2.1) * 0.032 * idleW;

      let nearArmRot = (-0.035 + Math.sin(it * 2.1 - 0.4) * 0.055) * idleW;
      let nearArmDx = 0;
      let nearArmDy = breath * 0.011 * idleW;

      let farArmRot = (0.035 - Math.sin(it * 2.1 - 0.4) * 0.05) * idleW;
      let farArmDx = 0;
      let farArmDy = breath * 0.011 * idleW;

      let nearLegRot = 0;
      let nearLegDy = 0;
      let farLegRot = 0;
      let farLegDy = 0;

      if (moveW > 0.01) {
        if (form === 1) {
          // Aquatic S-wave propulsion
          const swimWave = Math.sin(p);
          const swimBob = Math.sin(p * 2) * 0.018;
          tailRot += swimWave * 0.34 * moveW;
          tailSx += -Math.abs(swimWave) * 0.1 * moveW;
          torsoRot += Math.sin(p - 1.1) * 0.075 * moveW;
          torsoDy += swimBob * moveW;
          torsoSx += Math.sin(p * 2) * 0.024 * moveW;
          headRot += -Math.sin(p - 0.5) * 0.105 * moveW;
          headDx += 0.014 * moveW;
          headDy += swimBob * 0.9 * moveW;
        } else if (form === 2) {
          // Muscular forelimb crawl + tail sweep
          const s1 = Math.sin(p);
          const s2 = Math.sin(p + Math.PI);
          const crawlBob = Math.abs(s1) * 0.026;
          nearArmRot += (s1 * 0.42 + 0.06) * moveW;
          nearArmDx += s1 * 0.02 * moveW;
          nearArmDy += Math.max(0, s1) * 0.032 * moveW;
          farArmRot += (s2 * 0.42 + 0.06) * moveW;
          farArmDx += s2 * 0.02 * moveW;
          farArmDy += Math.max(0, s2) * 0.032 * moveW;
          tailRot += Math.sin(p + 0.9) * 0.27 * moveW;
          tailDy += crawlBob * 0.7 * moveW;
          torsoRot += (-0.045 + Math.sin(p * 2) * 0.042) * moveW;
          torsoDy += crawlBob * moveW;
          headRot += (0.04 + Math.cos(p * 2) * 0.038) * moveW;
          headDy += crawlBob * 0.88 * moveW;
        } else {
          // Bipedal stride (Lv.80-100): alternating legs, contralateral arms, double-freq bob
          const s1 = Math.sin(p);
          const walkBob = (Math.abs(s1) * 0.034 - 0.012) * moveW;
          nearLegRot += s1 * 0.38 * moveW;
          nearLegDy += Math.max(0, Math.cos(p - 0.4)) * 0.034 * moveW;
          farLegRot += -s1 * 0.38 * moveW;
          farLegDy += Math.max(0, -Math.cos(p - 0.4)) * 0.034 * moveW;

          nearArmRot += -s1 * 0.34 * moveW;
          nearArmDx += -s1 * 0.012 * moveW;
          nearArmDy += walkBob;
          farArmRot += s1 * 0.34 * moveW;
          farArmDx += s1 * 0.012 * moveW;
          farArmDy += walkBob;

          torsoRot += (-0.06 + Math.cos(p * 2) * 0.026) * moveW;
          torsoDy += walkBob;
          headRot += (0.045 - Math.cos(p * 2) * 0.028) * moveW;
          headDy += walkBob * 0.95;
          tailRot += (Math.sin(p + 0.6) * 0.16 - 0.05) * moveW;
          tailDy += walkBob * 0.85;
        }
      }

      // Bite windup / strike anticipation & lunge
      if (k.bitePhase === 'windup') {
        torsoRot += 0.11 * motionScale;
        headRot += 0.13 * motionScale;
        nearArmRot -= 0.25 * motionScale;
        farArmRot -= 0.16 * motionScale;
      } else if (k.bitePhase === 'strike') {
        torsoRot -= 0.16 * motionScale;
        torsoDx += 0.035 * motionScale;
        headRot -= 0.18 * motionScale;
        headDx += 0.055 * motionScale;
        nearArmRot += 0.38 * motionScale;
        farArmRot += 0.28 * motionScale;
      }
      if (k.stunTimer > 0) {
        headRot += Math.sin(elapsed * 18) * 0.13 * motionScale;
      }

      // Apply plate transforms around each part's anatomical pivot
      const pTorso = vis.parts.torso;
      pTorso.pivot.position.set(pTorso.baseX + torsoDx, pTorso.baseY + torsoDy, pTorso.baseZ);
      pTorso.pivot.rotation.z = torsoRot;
      pTorso.pivot.scale.set(torsoSx, torsoSy, 1);

      const pHead = vis.parts.head;
      pHead.pivot.position.set(pHead.baseX + headDx, pHead.baseY + headDy, pHead.baseZ);
      pHead.pivot.rotation.z = headRot;

      const pTail = vis.parts.tail;
      pTail.pivot.position.set(pTail.baseX, pTail.baseY + tailDy, pTail.baseZ);
      pTail.pivot.rotation.z = tailRot;
      pTail.pivot.scale.set(tailSx, 1, 1);

      if (vis.parts.nearArm.pivot.visible) {
        const pArm = vis.parts.nearArm;
        pArm.pivot.position.set(pArm.baseX + nearArmDx, pArm.baseY + nearArmDy, pArm.baseZ);
        pArm.pivot.rotation.z = nearArmRot;
      }
      if (vis.parts.farArm.pivot.visible) {
        const pFArm = vis.parts.farArm;
        pFArm.pivot.position.set(pFArm.baseX + farArmDx, pFArm.baseY + farArmDy, pFArm.baseZ);
        pFArm.pivot.rotation.z = farArmRot;
      }
      if (vis.parts.nearLeg.pivot.visible) {
        const pLeg = vis.parts.nearLeg;
        pLeg.pivot.position.set(pLeg.baseX, pLeg.baseY + nearLegDy, pLeg.baseZ);
        pLeg.pivot.rotation.z = nearLegRot;
      }
      if (vis.parts.farLeg.pivot.visible) {
        const pFLeg = vis.parts.farLeg;
        pFLeg.pivot.position.set(pFLeg.baseX, pFLeg.baseY + farLegDy, pFLeg.baseZ);
        pFLeg.pivot.rotation.z = farLegRot;
      }

      const horizSquash = isPureVertical ? 0.91 : 1.0;
      const vertScale = isNorth ? 0.95 : 1.0;
      vis.rigGroup.scale.set((flipX ? -1 : 1) * horizSquash * size3D, vertScale * size3D, 1);
      vis.rigGroup.position.y = -0.02 * size3D;
      vis.rigGroup.quaternion.copy(this.camera.quaternion);
      vis.badgeMesh.quaternion.copy(this.camera.quaternion);
      const badgeFactor = tier >= 80 ? 1.05 : tier >= 40 ? 0.88 : 0.72;
      vis.badgeMesh.position.y = size3D * badgeFactor + 0.45;

      const elev = getElevationAt(k.x, k.z);
      const groundY = k.isOnShore ? Math.max(0.08, elev * 2.2) : -0.15;
      vis.group.position.set(simTo3D(k.x), groundY, simTo3D(k.z));

      vis.shadowMesh.scale.setScalar(size3D * 0.34);
      vis.ringMesh.scale.setScalar(size3D * 0.46);
      const ringMat = vis.ringMesh.material as THREE.MeshBasicMaterial;
      const runeMat = vis.runeMesh.material as THREE.MeshBasicMaterial;
      if (k.isPlayer) {
        // Glowing cerulean rune circle matching Plate 2 Lv.86 Awang Keli
        vis.runeMesh.visible = true;
        const runeDiam = size3D * 1.18;
        vis.runeMesh.scale.set(runeDiam, runeDiam, 1);
        vis.runeMesh.rotation.z = this.reducedMotion ? 0 : elapsed * 0.35;
        runeMat.color.setHex(0x7dd3fc);
        runeMat.opacity = 0.86 + Math.sin(elapsed * 3.5) * 0.1;
        if (k.isSpeaking) {
          const voicePulse = this.reducedMotion ? 1.1 : 1.05 + Math.sin(elapsed * 12) * 0.14;
          vis.ringMesh.scale.setScalar(size3D * 0.64 * voicePulse);
          ringMat.color.setHex(0x4ade80);
          ringMat.opacity = 0.78;
        } else {
          ringMat.opacity = 0;
        }
      } else if (k.isSpeaking) {
        // Pulsing acoustic voice ring for nearby speaking multiplayer Kelis
        vis.runeMesh.visible = !player.alive && k.id === focus.id;
        if (vis.runeMesh.visible) {
          vis.runeMesh.scale.set(size3D * 1.14, size3D * 1.14, 1);
          runeMat.color.setHex(0xfbbf24);
          runeMat.opacity = 0.85;
        }
        const voicePulse = this.reducedMotion ? 1.08 : 1.05 + Math.sin(elapsed * 12 + k.x) * 0.14;
        vis.ringMesh.scale.setScalar(size3D * 0.64 * voicePulse);
        ringMat.color.setHex(0x4ade80);
        ringMat.opacity = 0.78;
      } else if (!player.alive && k.id === focus.id) {
        // Crimson rival focus rune during 3s Death Cam; warm gold once in normal Spectator Mode
        const isKillerCam = Boolean(deathCamActive && deathCam && k.id === deathCam.killerId);
        vis.runeMesh.visible = true;
        const runeDiam = size3D * (isKillerCam ? 1.24 : 1.14);
        vis.runeMesh.scale.set(runeDiam, runeDiam, 1);
        vis.runeMesh.rotation.z = this.reducedMotion ? 0 : elapsed * (isKillerCam ? 0.55 : 0.25);
        runeMat.color.setHex(isKillerCam ? 0xf87171 : 0xfbbf24);
        runeMat.opacity = isKillerCam ? 0.94 : 0.85;
        ringMat.opacity = 0;
      } else if ((k.bountyReward ?? 0) > 0) {
        vis.runeMesh.visible = false;
        const pulse = this.reducedMotion ? 1.0 : 1.0 + Math.sin(elapsed * 6 + k.x) * 0.08;
        vis.ringMesh.scale.setScalar(size3D * 0.56 * pulse);
        ringMat.color.setHex(0xf59e0b);
        ringMat.opacity = 0.62;
      } else if (!k.isOnShore) {
        vis.runeMesh.visible = false;
        ringMat.color.setHex(0x5eead4);
        ringMat.opacity = 0.3 + Math.sin(elapsed * 4 + k.x) * 0.1;
      } else {
        vis.runeMesh.visible = false;
        ringMat.opacity = 0;
      }

      if (k.bitePhase === 'windup' || k.bitePhase === 'strike') {
        vis.biteCone.visible = true;
        const reach3D = 6.4 + k.level * 0.024;
        vis.biteCone.scale.set(reach3D, 1, reach3D);
        vis.biteCone.position.y = k.isOnShore ? 0.14 : 0.25;
        vis.biteCone.rotation.y = -k.biteAimAngle;
        const coneMat = vis.biteCone.material as THREE.MeshBasicMaterial;
        coneMat.color.setHex(k.bitePhase === 'strike' ? 0xef4444 : 0xfbbf24);
        coneMat.opacity = k.bitePhase === 'strike' ? 0.62 : 0.48;
      } else {
        vis.biteCone.visible = false;
      }

      this.updateActorBadge(vis, k, focus.level);
    }

    for (const [id, vis] of this.actorPool.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(vis.group);
        for (const partName of RIG_PART_ORDER) {
          vis.parts[partName].mat.dispose();
        }
        (vis.shadowMesh.material as THREE.Material).dispose();
        (vis.ringMesh.material as THREE.Material).dispose();
        (vis.runeMesh.material as THREE.Material).dispose();
        (vis.biteCone.material as THREE.Material).dispose();
        vis.badgeTex.dispose();
        (vis.badgeMesh.material as THREE.Material).dispose();
        this.actorPool.delete(id);
      }
    }

    this.updateFloatingStatusIcons(
      focus,
      this.actorPool.get(focus.id),
      sim,
      visualDt,
      elapsed
    );

    const activeCarcs = new Set<string>();
    for (const c of sim.carcasses) {
      activeCarcs.add(c.id);
      let vis = this.carcassPool.get(c.id);
      if (!vis) {
        vis = this.createCarcassVisual();
        this.carcassPool.set(c.id, vis);
      }
      const scale = 2.4 + Math.min(2.4, c.mass * 0.06);
      vis.spriteMesh.scale.set(scale, scale, 1);
      vis.spriteMesh.quaternion.copy(this.camera.quaternion);
      vis.ringMesh.scale.setScalar(scale * 0.48 + Math.sin(c.bobPhase) * 0.15);

      const elev = getElevationAt(c.x, c.z);
      const y = elev > 0.05 ? elev * 2.2 + 0.3 : 0.05 + Math.sin(c.bobPhase) * 0.06;
      vis.group.position.set(simTo3D(c.x), y, simTo3D(c.z));
    }

    for (const [id, vis] of this.carcassPool.entries()) {
      if (!activeCarcs.has(id)) {
        this.scene.remove(vis.group);
        (vis.spriteMesh.material as THREE.Material).dispose();
        (vis.ringMesh.material as THREE.Material).dispose();
        this.carcassPool.delete(id);
      }
    }

    const activePickups = new Set<string>();
    for (const pk of sim.pickups) {
      activePickups.add(pk.id);
      let vis = this.pickupPool.get(pk.id);
      if (!vis) {
        vis = this.createPickupVisual(pk.kind);
        this.pickupPool.set(pk.id, vis);
      }
      const bob = this.reducedMotion ? 0 : Math.sin(pk.bobPhase) * 0.22;
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(pk.bobPhase * 1.4) * 0.08;
      vis.spriteMesh.quaternion.copy(this.camera.quaternion);
      vis.spriteMesh.position.y = 0.9 + bob;
      const baseSize = pk.rainFed ? 2.7 : 2.45;
      vis.spriteMesh.scale.set(baseSize * pulse, baseSize * pulse, 1);

      vis.ringMesh.scale.setScalar((pk.rainFed ? 1.6 : 1.35) + Math.sin(pk.bobPhase) * 0.16);
      (vis.ringMesh.material as THREE.MeshBasicMaterial).opacity =
        (pk.rainFed ? 0.62 : 0.48) + Math.sin(pk.bobPhase * 1.5) * 0.18;

      const elev = getElevationAt(pk.x, pk.z);
      const baseY = elev > 0.05 ? elev * 2.2 + 0.45 : 0.12;
      vis.group.position.set(simTo3D(pk.x), baseY, simTo3D(pk.z));
    }

    for (const [id, vis] of this.pickupPool.entries()) {
      if (!activePickups.has(id)) {
        this.scene.remove(vis.group);
        (vis.spriteMesh.material as THREE.Material).dispose();
        (vis.ringMesh.material as THREE.Material).dispose();
        this.pickupPool.delete(id);
      }
    }

    this.syncEffects(sim.effects);
    this.renderer.render(this.scene, this.camera);
  }

  private syncEffects(effects: WorldEffect[]) {
    const activeFx = new Set<string>();

    for (const fx of effects) {
      activeFx.add(fx.id);
      let mesh = this.fxPool.get(fx.id);
      const t = Math.min(1, fx.elapsed / Math.max(0.01, fx.duration));

      if (!mesh) {
        const geo =
          fx.type === 'veil_cloud' || fx.type === 'maelstrom'
            ? this.sharedDiscGeo
            : fx.type === 'bite_arc'
              ? this.sharedConeGeo
              : this.sharedRingGeo;
        const mat = new THREE.MeshBasicMaterial({
          color: fx.color,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = fx.type === 'bite_arc' ? 0 : -Math.PI / 2;
        mesh.position.y = 0.22;
        mesh.renderOrder = 6;
        this.scene.add(mesh);
        this.fxPool.set(fx.id, mesh);
      }

      mesh.position.x = simTo3D(fx.x);
      mesh.position.z = simTo3D(fx.z);
      const r3d = fx.radius * SIM_TO_3D;
      const mat = mesh.material as THREE.MeshBasicMaterial;

      if (fx.type === 'evolution_burst') {
        const eased = 1 - Math.pow(1 - t, 2.2);
        const curR = r3d * (0.2 + eased * 1.15);
        mesh.scale.setScalar(curR);
        mat.opacity = (1 - t) * 0.92;
      } else if (fx.type === 'bite_arc') {
        mesh.rotation.y = -fx.angle;
        mesh.scale.setScalar(r3d * (0.85 + t * 0.25));
        mat.opacity = (1 - t) * 0.65;
      } else if (fx.type === 'sonar_ring' || fx.type === 'electroshock') {
        const curR = r3d * (0.15 + t * 0.85);
        mesh.scale.setScalar(curR);
        mat.opacity = (1 - t) * 0.75;
      } else if (fx.type === 'veil_cloud') {
        mesh.scale.setScalar(r3d * (0.65 + Math.sin(t * Math.PI) * 0.35));
        mat.opacity = (1 - t * 0.7) * 0.78;
      } else if (fx.type === 'maelstrom') {
        mesh.scale.setScalar(r3d * (0.85 + Math.sin(t * 14) * 0.1));
        mesh.rotation.z = t * 14;
        mat.opacity = (1 - t * 0.6) * 0.42;
      } else {
        mesh.scale.setScalar(r3d * (0.5 + t * 0.6));
        mat.opacity = (1 - t) * 0.65;
      }
    }

    for (const [id, mesh] of this.fxPool.entries()) {
      if (!activeFx.has(id)) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.fxPool.delete(id);
      }
    }
  }

  public startLoop(onFrame: () => void) {
    const afterDraw = (cb: () => void) => {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      if (!sync) {
        this.frameId = window.setTimeout(cb, 80);
        return;
      }
      const poll = () => {
        if (this.disposed) return;
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (this.disposed) return;
      onFrame();
      if (this.isSoftwareGl) {
        afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    this.frameId = requestAnimationFrame(tick);
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    this.arenaTextures?.dispose();
    this.statusIconCache?.dispose();
    this.sharedQuadGeo.dispose();
    this.sharedRingGeo.dispose();
    this.sharedDiscGeo.dispose();
    this.sharedConeGeo.dispose();

    this.rainLines?.geometry?.dispose();
    (this.rainLines?.material as THREE.Material | undefined)?.dispose();
    this.ambientParticles?.dispose();

    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material?.dispose();
      }
    });

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

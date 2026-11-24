import type { ArenaZoneId, EvolutionForm, HazardTileKind, TerrainType } from './types.ts';

export const ARENA_SCALE = Math.SQRT2 * 2; // √8 ≈ 2.8284 -> 8× surface area
export const WORLD_SIZE = 5656;
export const WORLD_CENTER = WORLD_SIZE / 2; // 2828
export const WATER_LEVEL = 0;
export const ECHO_SONAR_RADIUS = 1050;

export function scaleArenaCoord(oldCoord: number): number {
  return Math.round(oldCoord * ARENA_SCALE);
}

export function scaleArenaDist(oldDist: number): number {
  return Math.round(oldDist * ARENA_SCALE);
}

// Convert simulation coordinates [0..5656] to Three.js world coordinates [-282.8..282.8]
export const SIM_TO_3D = 0.1;
export function simTo3D(val: number): number {
  return (val - WORLD_CENTER) * SIM_TO_3D;
}
export function threeDToSim(val: number): number {
  return val / SIM_TO_3D + WORLD_CENTER;
}

export interface RockObstacle {
  id: string;
  x: number;
  z: number;
  radius: number;
  height: number;
  kind: 'limestone' | 'boulder' | 'pillar' | 'root';
}

export interface PalongGate {
  id: string;
  x: number;
  z: number;
  angle: number;
  width: number;
}

export interface HazardTile {
  id: string;
  kind: HazardTileKind;
  shape: 'circle' | 'rect';
  x: number;
  z: number;
  radius: number; // circle radius OR bounding radius for rect
  halfL?: number;
  halfW?: number;
  angle?: number;
  flowVx: number;
  flowVz: number;
  zoneName: string;
}

export interface HazardFormModifier {
  kind: HazardTileKind;
  label: string;
  speedMult: number;
  staminaRate: number; // delta per second
  shoreReserveMult: number;
  summary: string;
  color: string;
}

export interface ZoneMeta {
  id: ArenaZoneId;
  name: string;
  subtitle: string;
}

export const ZONE_METADATA: Record<ArenaZoneId, ZoneMeta> = {
  lubuk_hitam: {
    id: 'lubuk_hitam',
    name: 'Lubuk Hitam',
    subtitle: 'Deep central basin',
  },
  gua_kelam_tua: {
    id: 'gua_kelam_tua',
    name: 'Gua Kelam Tua',
    subtitle: 'Constricted limestone tunnels',
  },
  terowong_bijih: {
    id: 'terowong_bijih',
    name: 'Terowong Bijih',
    subtitle: 'Flooded palong & current lanes',
  },
  sungai_berselirat: {
    id: 'sungai_berselirat',
    name: 'Sungai Berselirat',
    subtitle: 'Branching streams & small shortcuts',
  },
  tebing_kering: {
    id: 'tebing_kering',
    name: 'Tebing Kering',
    subtitle: 'Shoreline raids (Lv.40+) & flanking (Lv.80+)',
  },
  jantung_tasik: {
    id: 'jantung_tasik',
    name: 'Jantung Tasik',
    subtitle: 'Final convergence & anomaly source',
  },
};

const TUTORIAL_START_X = scaleArenaCoord(640);
const TUTORIAL_START_Z = scaleArenaCoord(1460);

// Static landmarks
export const LANDMARKS = {
  radioactiveDrum: { x: scaleArenaCoord(1015), z: scaleArenaCoord(1265) },
  redPaperBoat: { x: scaleArenaCoord(1270), z: scaleArenaCoord(1205) },
  minerLantern: { x: scaleArenaCoord(1070), z: scaleArenaCoord(1230) },
  kampungJetty: { x: scaleArenaCoord(1355), z: scaleArenaCoord(1070) },
  kampungHut: { x: scaleArenaCoord(1540), z: scaleArenaCoord(1120) },
  guaKelamCavern: { x: scaleArenaCoord(520), z: scaleArenaCoord(450) },
  tebingKeringLanding: { x: scaleArenaCoord(1295), z: scaleArenaCoord(1090) },
  tutorialStart: { x: TUTORIAL_START_X, z: TUTORIAL_START_Z },
  tutorialSafeCarcass: { x: TUTORIAL_START_X + 170, z: TUTORIAL_START_Z - 115 },
  tutorialContestedCarcass: { x: TUTORIAL_START_X + 410, z: TUTORIAL_START_Z - 240 },
};

// Palong tin-mining sluice gates in Terowong Bijih
export const PALONG_GATES: PalongGate[] = [
  { id: 'palong-1', x: scaleArenaCoord(1360), z: scaleArenaCoord(460), angle: -Math.PI * 0.25, width: 145 },
  { id: 'palong-2', x: scaleArenaCoord(1200), z: scaleArenaCoord(680), angle: -Math.PI * 0.22, width: 155 },
];

function makeRapidsTile(
  id: string,
  oldX: number,
  oldZ: number,
  halfL: number,
  halfW: number,
  angle: number,
  flowSpeed: number,
  zoneName: string
): HazardTile {
  return {
    id,
    kind: 'rapids',
    shape: 'rect',
    x: scaleArenaCoord(oldX),
    z: scaleArenaCoord(oldZ),
    radius: Math.hypot(halfL, halfW),
    halfL,
    halfW,
    angle,
    flowVx: Math.cos(angle) * flowSpeed,
    flowVz: Math.sin(angle) * flowSpeed,
    zoneName,
  };
}

// Hazard tiles distributed across all 6 sectors of the 8x Wang Kelian arena
export const HAZARD_TILES: HazardTile[] = [
  // 1. Toxic Tin-Mine Sludge Pockets (heavy gill/stamina drain for Form 1, resisted by armored Form 3+)
  { id: 'sludge-1', kind: 'toxic_sludge', shape: 'circle', x: scaleArenaCoord(540), z: scaleArenaCoord(430), radius: 175, flowVx: 0, flowVz: 0, zoneName: 'Gua Kelam Tua' },
  { id: 'sludge-2', kind: 'toxic_sludge', shape: 'circle', x: scaleArenaCoord(990), z: scaleArenaCoord(1285), radius: 165, flowVx: 0, flowVz: 0, zoneName: 'Jantung Tasik' },
  { id: 'sludge-3', kind: 'toxic_sludge', shape: 'circle', x: scaleArenaCoord(850), z: scaleArenaCoord(710), radius: 155, flowVx: 0, flowVz: 0, zoneName: 'Lubuk Hitam' },
  { id: 'sludge-4', kind: 'toxic_sludge', shape: 'circle', x: scaleArenaCoord(1210), z: scaleArenaCoord(920), radius: 150, flowVx: 0, flowVz: 0, zoneName: 'Lubuk Hitam' },
  { id: 'sludge-5', kind: 'toxic_sludge', shape: 'circle', x: scaleArenaCoord(710), z: scaleArenaCoord(1120), radius: 145, flowVx: 0, flowVz: 0, zoneName: 'Lubuk Hitam' },
  { id: 'sludge-6', kind: 'toxic_sludge', shape: 'circle', x: scaleArenaCoord(1430), z: scaleArenaCoord(570), radius: 155, flowVx: 0, flowVz: 0, zoneName: 'Terowong Bijih' },
  { id: 'sludge-7', kind: 'toxic_sludge', shape: 'circle', x: scaleArenaCoord(1100), z: scaleArenaCoord(1540), radius: 160, flowVx: 0, flowVz: 0, zoneName: 'Lubuk Hitam' },

  // 2. Current-Heavy Riptide Streams (Aquatic Form 1 surfs downstream; heavy Form 2/3 lose speed & stamina)
  makeRapidsTile('rapids-1', 1340, 475, 340, 115, Math.PI * 0.76, 95, 'Terowong Bijih'),
  makeRapidsTile('rapids-2', 1185, 695, 310, 120, Math.PI * 0.77, 90, 'Terowong Bijih'),
  makeRapidsTile('rapids-3', 1590, 770, 320, 110, Math.PI * 0.56, 85, 'Terowong Bijih'),
  makeRapidsTile('rapids-4', 420, 1120, 300, 105, -0.32, 80, 'Sungai Berselirat'),
  makeRapidsTile('rapids-5', 540, 1690, 310, 110, -0.25, 82, 'Sungai Berselirat'),
  makeRapidsTile('rapids-6', 760, 620, 280, 105, 0.68, 84, 'Gua Kelam Tua'),

  // 3. Tidal Mudflats / Sinking Quagmires (Form 1 slithers cleanly; Form 2 arms bog down)
  { id: 'quagmire-1', kind: 'quagmire', shape: 'circle', x: scaleArenaCoord(1335), z: scaleArenaCoord(985), radius: 135, flowVx: 0, flowVz: 0, zoneName: 'Tebing Kering' },
  { id: 'quagmire-2', kind: 'quagmire', shape: 'circle', x: scaleArenaCoord(1345), z: scaleArenaCoord(1375), radius: 140, flowVx: 0, flowVz: 0, zoneName: 'Tebing Kering' },
  { id: 'quagmire-3', kind: 'quagmire', shape: 'circle', x: scaleArenaCoord(1635), z: scaleArenaCoord(1355), radius: 145, flowVx: 0, flowVz: 0, zoneName: 'Tebing Kering' },
  { id: 'quagmire-4', kind: 'quagmire', shape: 'circle', x: scaleArenaCoord(420), z: scaleArenaCoord(1390), radius: 140, flowVx: 0, flowVz: 0, zoneName: 'Sungai Berselirat' },
  { id: 'quagmire-5', kind: 'quagmire', shape: 'circle', x: scaleArenaCoord(755), z: scaleArenaCoord(1610), radius: 140, flowVx: 0, flowVz: 0, zoneName: 'Sungai Berselirat' },
  { id: 'quagmire-6', kind: 'quagmire', shape: 'circle', x: scaleArenaCoord(920), z: scaleArenaCoord(1430), radius: 130, flowVx: 0, flowVz: 0, zoneName: 'Lubuk Hitam' },

  // 4. Scorched Geothermal Brine Flats (saps Form 2 Shore Reserve & stamina; Amphibious Form 3+ thrives)
  { id: 'thermal-1', kind: 'thermal_vent', shape: 'circle', x: scaleArenaCoord(1475), z: scaleArenaCoord(1180), radius: 145, flowVx: 0, flowVz: 0, zoneName: 'Tebing Kering' },
  { id: 'thermal-2', kind: 'thermal_vent', shape: 'circle', x: scaleArenaCoord(1555), z: scaleArenaCoord(1025), radius: 125, flowVx: 0, flowVz: 0, zoneName: 'Tebing Kering' },
  { id: 'thermal-3', kind: 'thermal_vent', shape: 'circle', x: scaleArenaCoord(1505), z: scaleArenaCoord(1330), radius: 125, flowVx: 0, flowVz: 0, zoneName: 'Tebing Kering' },
  { id: 'thermal-4', kind: 'thermal_vent', shape: 'circle', x: scaleArenaCoord(455), z: scaleArenaCoord(310), radius: 130, flowVx: 0, flowVz: 0, zoneName: 'Gua Kelam Tua' },
  { id: 'thermal-5', kind: 'thermal_vent', shape: 'circle', x: scaleArenaCoord(1320), z: scaleArenaCoord(1210), radius: 105, flowVx: 0, flowVz: 0, zoneName: 'Tebing Kering' },
];

// Deterministic limestone formations, tunnel pillars, and stream islands
export const OBSTACLES: RockObstacle[] = [
  // Outer basin boundary cliffs (natural limestone karst perimeter)
  ...buildPerimeterCliffs(),

  // Gua Kelam Tua (NW cave pillars creating winding ambush lanes)
  { id: 'gk-1', x: scaleArenaCoord(430), z: scaleArenaCoord(380), radius: 92, height: 50, kind: 'limestone' },
  { id: 'gk-2', x: scaleArenaCoord(590), z: scaleArenaCoord(340), radius: 84, height: 48, kind: 'limestone' },
  { id: 'gk-3', x: scaleArenaCoord(360), z: scaleArenaCoord(540), radius: 88, height: 52, kind: 'limestone' },
  { id: 'gk-4', x: scaleArenaCoord(540), z: scaleArenaCoord(520), radius: 74, height: 44, kind: 'pillar' },
  { id: 'gk-5', x: scaleArenaCoord(700), z: scaleArenaCoord(480), radius: 76, height: 42, kind: 'limestone' },
  { id: 'gk-6', x: scaleArenaCoord(470), z: scaleArenaCoord(690), radius: 84, height: 46, kind: 'limestone' },
  { id: 'gk-7', x: scaleArenaCoord(660), z: scaleArenaCoord(650), radius: 68, height: 39, kind: 'pillar' },
  { id: 'gk-8', x: scaleArenaCoord(310), z: scaleArenaCoord(700), radius: 78, height: 44, kind: 'limestone' },
  { id: 'gk-9', x: scaleArenaCoord(760), z: scaleArenaCoord(320), radius: 72, height: 40, kind: 'pillar' },
  { id: 'gk-10', x: scaleArenaCoord(610), z: scaleArenaCoord(790), radius: 64, height: 36, kind: 'pillar' },

  // Terowong Bijih (NE flooded industrial rock outcrops)
  { id: 'tb-1', x: scaleArenaCoord(1240), z: scaleArenaCoord(340), radius: 74, height: 38, kind: 'boulder' },
  { id: 'tb-2', x: scaleArenaCoord(1520), z: scaleArenaCoord(380), radius: 82, height: 42, kind: 'limestone' },
  { id: 'tb-3', x: scaleArenaCoord(1550), z: scaleArenaCoord(590), radius: 72, height: 36, kind: 'boulder' },
  { id: 'tb-4', x: scaleArenaCoord(1120), z: scaleArenaCoord(520), radius: 62, height: 30, kind: 'pillar' },
  { id: 'tb-5', x: scaleArenaCoord(1690), z: scaleArenaCoord(490), radius: 78, height: 40, kind: 'limestone' },
  { id: 'tb-6', x: scaleArenaCoord(1420), z: scaleArenaCoord(750), radius: 66, height: 32, kind: 'pillar' },
  { id: 'tb-7', x: scaleArenaCoord(1080), z: scaleArenaCoord(310), radius: 68, height: 34, kind: 'boulder' },

  // Lubuk Hitam (Central basin cover rocks — generous sightlines with tactical cover)
  { id: 'lh-1', x: scaleArenaCoord(860), z: scaleArenaCoord(860), radius: 56, height: 22, kind: 'boulder' },
  { id: 'lh-2', x: scaleArenaCoord(1090), z: scaleArenaCoord(910), radius: 50, height: 20, kind: 'boulder' },
  { id: 'lh-3', x: scaleArenaCoord(830), z: scaleArenaCoord(1080), radius: 52, height: 21, kind: 'boulder' },
  { id: 'lh-4', x: scaleArenaCoord(970), z: scaleArenaCoord(740), radius: 48, height: 19, kind: 'boulder' },
  { id: 'lh-5', x: scaleArenaCoord(1160), z: scaleArenaCoord(1040), radius: 46, height: 18, kind: 'boulder' },
  { id: 'lh-6', x: scaleArenaCoord(720), z: scaleArenaCoord(960), radius: 52, height: 22, kind: 'pillar' },

  // Sungai Berselirat (SW branching stream islands with narrow small-body gaps!)
  { id: 'sb-1', x: scaleArenaCoord(360), z: scaleArenaCoord(1320), radius: 84, height: 28, kind: 'root' },
  { id: 'sb-2', x: scaleArenaCoord(520), z: scaleArenaCoord(1240), radius: 72, height: 25, kind: 'boulder' },
  { id: 'sb-3', x: scaleArenaCoord(480), z: scaleArenaCoord(1440), radius: 78, height: 27, kind: 'root' },
  { id: 'sb-4', x: scaleArenaCoord(660), z: scaleArenaCoord(1340), radius: 62, height: 22, kind: 'boulder' },
  { id: 'sb-5', x: scaleArenaCoord(380), z: scaleArenaCoord(1580), radius: 86, height: 30, kind: 'limestone' },
  { id: 'sb-6', x: scaleArenaCoord(640), z: scaleArenaCoord(1580), radius: 74, height: 26, kind: 'root' },
  { id: 'sb-7', x: scaleArenaCoord(800), z: scaleArenaCoord(1490), radius: 60, height: 22, kind: 'boulder' },
  { id: 'sb-8', x: scaleArenaCoord(260), z: scaleArenaCoord(1180), radius: 72, height: 24, kind: 'root' },
  { id: 'sb-9', x: scaleArenaCoord(540), z: scaleArenaCoord(1690), radius: 70, height: 25, kind: 'limestone' },
  { id: 'sb-10', x: scaleArenaCoord(890), z: scaleArenaCoord(1620), radius: 64, height: 22, kind: 'root' },

  // Jantung Tasik & Tebing Kering root outcrops (creating distinct shore entries/exits)
  { id: 'jt-1', x: scaleArenaCoord(1180), z: scaleArenaCoord(1340), radius: 52, height: 22, kind: 'root' },
  { id: 'jt-2', x: scaleArenaCoord(1280), z: scaleArenaCoord(1060), radius: 54, height: 23, kind: 'root' },
  { id: 'jt-3', x: scaleArenaCoord(1540), z: scaleArenaCoord(1490), radius: 64, height: 25, kind: 'root' },
  { id: 'jt-4', x: scaleArenaCoord(1690), z: scaleArenaCoord(1020), radius: 58, height: 24, kind: 'limestone' },
];

function buildPerimeterCliffs(): RockObstacle[] {
  const cliffs: RockObstacle[] = [];
  const count = 96;
  const baseDist = scaleArenaDist(945);
  const jitter = scaleArenaDist(28);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const dist = baseDist + Math.sin(i * 2.7) * jitter;
    cliffs.push({
      id: `cliff-${i}`,
      x: WORLD_CENTER + Math.cos(angle) * dist,
      z: WORLD_CENTER + Math.sin(angle) * dist,
      radius: 125 + Math.cos(i * 1.9) * 24,
      height: 68 + Math.sin(i * 3.1) * 18,
      kind: 'limestone',
    });
  }
  return cliffs;
}

const CLIFF_RISE_DIST = scaleArenaDist(900);
const CLIFF_TERRAIN_DIST = scaleArenaDist(915);
const LUBUK_CENTER_X = scaleArenaCoord(940);
const LUBUK_CENTER_Z = scaleArenaCoord(940);
const LUBUK_SPREAD = scaleArenaDist(650);
const JANTUNG_CENTER_X = scaleArenaCoord(1030);
const JANTUNG_CENTER_Z = scaleArenaCoord(1240);
const JANTUNG_ZONE_X = scaleArenaCoord(1040);
const JANTUNG_RADIUS = scaleArenaDist(220);
const SUNGAI_X_MAX = scaleArenaCoord(850);
const SUNGAI_Z_MIN = scaleArenaCoord(1150);
const BANK_CENTER_X = scaleArenaCoord(1475);
const BANK_CENTER_Z = scaleArenaCoord(1180);
const BANK_RX = scaleArenaDist(185);
const BANK_RZ = scaleArenaDist(245);
const BOAT_SPIT_X = scaleArenaCoord(1300);
const BOAT_SPIT_Z = scaleArenaCoord(1200);
const BOAT_SPIT_RX = scaleArenaDist(65);
const BOAT_SPIT_RZ = scaleArenaDist(48);

/**
 * Continuous elevation function in simulation space [0..5656].
 * Returns world elevation in 3D units:
 *  < -1.2 : Deep water (Lubuk Hitam, channels)
 *  -1.2..0.0 : Shallows
 *  > 0.05 : Shore / Tebing Kering bank (requires Lv.40+)
 */
export function getElevationAt(x: number, z: number): number {
  const dx = x - WORLD_CENTER;
  const dz = z - WORLD_CENTER;
  const distFromCenter = Math.hypot(dx, dz);

  // Outer karst rim rises steeply
  if (distFromCenter > CLIFF_RISE_DIST) {
    return (distFromCenter - CLIFF_RISE_DIST) * 0.045;
  }

  // Deep central basin (Lubuk Hitam)
  const lubukDist = Math.hypot(x - LUBUK_CENTER_X, z - LUBUK_CENTER_Z);
  let elev = -1.6 + Math.min(1.0, lubukDist / LUBUK_SPREAD) * 0.7;

  // Jantung Tasik deep convergence pocket
  const jantungDist = Math.hypot(x - JANTUNG_CENTER_X, z - JANTUNG_CENTER_Z);
  if (jantungDist < JANTUNG_RADIUS) {
    elev = Math.min(elev, -1.45 + (jantungDist / JANTUNG_RADIUS) * 0.35);
  }

  // Sungai Berselirat (SW shallow stream network)
  if (x < SUNGAI_X_MAX && z > SUNGAI_Z_MIN) {
    elev = Math.max(elev, -0.75 + Math.sin(x * 0.0065) * 0.18 + Math.cos(z * 0.0065) * 0.15);
  }

  // Tebing Kering (East/SE elevated shore bank with two ramps and outer aquatic bypass channel)
  const bankDx = (x - BANK_CENTER_X) / BANK_RX;
  const bankDz = (z - BANK_CENTER_Z) / BANK_RZ;
  const bankDist = Math.hypot(bankDx, bankDz);

  if (bankDist < 1.15) {
    const bankHeight = (1.0 - bankDist) * 2.2;
    elev = Math.max(elev, bankHeight - 0.15);
  }

  // Small western rocky spit near Jantung Tasik for Aisyah's red paper boat roots
  const boatSpit = Math.hypot((x - BOAT_SPIT_X) / BOAT_SPIT_RX, (z - BOAT_SPIT_Z) / BOAT_SPIT_RZ);
  if (boatSpit < 1.0) {
    elev = Math.max(elev, (1.0 - boatSpit) * 0.9);
  }

  return elev;
}

export function getTerrainAt(x: number, z: number): TerrainType {
  const distFromCenter = Math.hypot(x - WORLD_CENTER, z - WORLD_CENTER);
  if (distFromCenter > CLIFF_TERRAIN_DIST) return 'cliff';
  const elev = getElevationAt(x, z);
  if (elev > 0.05) return 'shore';
  if (elev > -1.05) return 'shallow';
  return 'deep';
}

const ZONE_TEBING_SHORE_X = scaleArenaCoord(1250);
const ZONE_GUA_MAX = scaleArenaCoord(780);
const ZONE_TEROWONG_X_MIN = scaleArenaCoord(1080);
const ZONE_TEROWONG_Z_MAX = scaleArenaCoord(800);
const ZONE_SUNGAI_X_MAX = scaleArenaCoord(840);
const ZONE_SUNGAI_Z_MIN = scaleArenaCoord(1140);
const ZONE_TEBING_X_MIN = scaleArenaCoord(1240);
const ZONE_TEBING_Z_MIN = scaleArenaCoord(850);
const ZONE_TEBING_Z_MAX = scaleArenaCoord(1520);

export function getZoneAt(x: number, z: number): ZoneMeta {
  const terrain = getTerrainAt(x, z);
  if (terrain === 'shore' && x > ZONE_TEBING_SHORE_X) {
    return ZONE_METADATA.tebing_kering;
  }
  if (Math.hypot(x - JANTUNG_ZONE_X, z - JANTUNG_CENTER_Z) < JANTUNG_RADIUS) {
    return ZONE_METADATA.jantung_tasik;
  }
  if (x < ZONE_GUA_MAX && z < ZONE_GUA_MAX) {
    return ZONE_METADATA.gua_kelam_tua;
  }
  if (x > ZONE_TEROWONG_X_MIN && z < ZONE_TEROWONG_Z_MAX) {
    return ZONE_METADATA.terowong_bijih;
  }
  if (x < ZONE_SUNGAI_X_MAX && z > ZONE_SUNGAI_Z_MIN) {
    return ZONE_METADATA.sungai_berselirat;
  }
  if (x > ZONE_TEBING_X_MIN && z >= ZONE_TEBING_Z_MIN && z <= ZONE_TEBING_Z_MAX) {
    return ZONE_METADATA.tebing_kering;
  }
  return ZONE_METADATA.lubuk_hitam;
}

const CUR_TB_X_MIN = scaleArenaCoord(1060);
const CUR_TB_X_MAX = scaleArenaCoord(1680);
const CUR_TB_Z_MIN = scaleArenaCoord(320);
const CUR_TB_Z_MAX = scaleArenaCoord(860);
const CUR_TB_REF_X = scaleArenaCoord(1400);
const CUR_TB_REF_Z = scaleArenaCoord(420);
const CUR_TB_LANE_DIST = scaleArenaDist(320);
const CUR_SB_X_MAX = scaleArenaCoord(780);
const CUR_SB_Z_MIN = scaleArenaCoord(1180);

/**
 * Returns water current velocity vector (units/sec) at (x, z).
 * Terowong Bijih palong chutes push swimmers & carcasses along the sluice toward Jantung Tasik.
 * Sungai Berselirat has gentle downstream drift.
 */
export function getCurrentVectorAt(x: number, z: number): { vx: number; vz: number } {
  // Terowong Bijih palong current lane
  if (x > CUR_TB_X_MIN && x < CUR_TB_X_MAX && z > CUR_TB_Z_MIN && z < CUR_TB_Z_MAX) {
    const laneDist = Math.abs((x - CUR_TB_REF_X) * 0.7 + (z - CUR_TB_REF_Z) * 0.7);
    if (laneDist < CUR_TB_LANE_DIST) {
      return { vx: -36, vz: 34 };
    }
  }
  // Sungai Berselirat gentle current toward center
  if (x < CUR_SB_X_MAX && z > CUR_SB_Z_MIN) {
    return { vx: 18, vz: -12 };
  }
  return { vx: 0, vz: 0 };
}

const MAX_PLAYABLE_RADIUS = scaleArenaDist(885);

interface StaticCircleCollider {
  x: number;
  z: number;
  radius: number;
}

const COLLIDER_CELL_SIZE = 320;
const COLLIDER_GRID_STRIDE = Math.ceil(WORLD_SIZE / COLLIDER_CELL_SIZE) + 4;
const COLLIDER_QUERY_PADDING = 52;

function colliderCellKey(cx: number, cz: number): number {
  return cx + 2 + (cz + 2) * COLLIDER_GRID_STRIDE;
}

// Precompute all solid circular colliders (rocks + palong wooden pilings) into a static spatial grid once at load
// so 100-Keli movement & swept collision queries run in O(1) time with zero per-call heap allocations.
const STATIC_COLLIDER_GRID = new Map<number, StaticCircleCollider[]>();

(function buildStaticColliderGrid() {
  const allColliders: StaticCircleCollider[] = [];
  for (let i = 0; i < OBSTACLES.length; i++) {
    const obs = OBSTACLES[i];
    allColliders.push({ x: obs.x, z: obs.z, radius: obs.radius });
  }
  for (let i = 0; i < PALONG_GATES.length; i++) {
    const gate = PALONG_GATES[i];
    const cos = Math.cos(gate.angle);
    const sin = Math.sin(gate.angle);
    const halfW = gate.width * 0.55;
    allColliders.push({ x: gate.x - cos * halfW, z: gate.z - sin * halfW, radius: 16 });
    allColliders.push({ x: gate.x + cos * halfW, z: gate.z + sin * halfW, radius: 16 });
  }

  for (let i = 0; i < allColliders.length; i++) {
    const c = allColliders[i];
    const span = c.radius + COLLIDER_QUERY_PADDING;
    const minCx = Math.floor((c.x - span) / COLLIDER_CELL_SIZE);
    const maxCx = Math.floor((c.x + span) / COLLIDER_CELL_SIZE);
    const minCz = Math.floor((c.z - span) / COLLIDER_CELL_SIZE);
    const maxCz = Math.floor((c.z + span) / COLLIDER_CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = colliderCellKey(cx, cz);
        let bucket = STATIC_COLLIDER_GRID.get(key);
        if (!bucket) {
          bucket = [];
          STATIC_COLLIDER_GRID.set(key, bucket);
        }
        bucket.push(c);
      }
    }
  }
})();

export interface ArenaCollisionResult {
  x: number;
  z: number;
  blockedByShore: boolean;
  collided: boolean;
  normalX: number;
  normalZ: number;
}

/**
 * Computes the unit outward water-pointing normal along any shoreline contour using
 * central finite differences on getElevationAt(). Works cleanly on both Tebing Kering
 * and Boat Spit so Lv.1–39 aquatic Kelis slide tangentially without stuttering.
 */
function computeShoreWaterNormal(x: number, z: number): { nx: number; nz: number } {
  const h = 8;
  const gx = getElevationAt(x + h, z) - getElevationAt(x - h, z);
  const gz = getElevationAt(x, z + h) - getElevationAt(x, z - h);
  const gLen = Math.hypot(gx, gz);
  if (gLen > 1e-5) {
    // Downhill points back into water
    return { nx: -gx / gLen, nz: -gz / gLen };
  }
  // Fallback if directly at bank crest: point away from nearest land feature
  const bankD = Math.hypot(x - BANK_CENTER_X, z - BANK_CENTER_Z);
  const spitD = Math.hypot(x - BOAT_SPIT_X, z - BOAT_SPIT_Z);
  const cx = spitD < bankD * 0.45 ? BOAT_SPIT_X : BANK_CENTER_X;
  const cz = spitD < bankD * 0.45 ? BOAT_SPIT_Z : BANK_CENTER_Z;
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) {
    return { nx: -1, nz: 0 };
  }
  return { nx: dx / d, nz: dz / d };
}

/**
 * Resolves circle collision against arena cliffs, rocks, palong pillars, and shore walls (for Lv < 40)
 * using up to 3 iterative constraint passes over the prebuilt static spatial grid.
 * Returns final safe coordinates plus accumulated contact normal for smooth tangential sliding.
 */
export function resolveArenaCollision(
  x: number,
  z: number,
  radius: number,
  canGoAshore: boolean
): ArenaCollisionResult {
  let nx = x;
  let nz = z;
  let blockedByShore = false;
  let collided = false;
  let accNormalX = 0;
  let accNormalZ = 0;

  const maxR = MAX_PLAYABLE_RADIUS - radius;

  for (let pass = 0; pass < 3; pass++) {
    let movedThisPass = false;

    // 1. Keep inside outer circular limestone basin
    const dx = nx - WORLD_CENTER;
    const dz = nz - WORLD_CENTER;
    const d = Math.hypot(dx, dz);
    if (d > maxR && d > 0.001) {
      const invD = 1 / d;
      nx = WORLD_CENTER + dx * invD * maxR;
      nz = WORLD_CENTER + dz * invD * maxR;
      accNormalX -= dx * invD;
      accNormalZ -= dz * invD;
      collided = true;
      movedThisPass = true;
    }

    // 2. Rock obstacles & Palong side pilings via O(1) static spatial grid
    const bucket = STATIC_COLLIDER_GRID.get(
      colliderCellKey(Math.floor(nx / COLLIDER_CELL_SIZE), Math.floor(nz / COLLIDER_CELL_SIZE))
    );
    if (bucket) {
      for (let i = 0; i < bucket.length; i++) {
        const obs = bucket[i];
        const ox = nx - obs.x;
        const oz = nz - obs.z;
        const minDist = obs.radius + radius;
        const distSq = ox * ox + oz * oz;
        if (distSq < minDist * minDist) {
          if (distSq > 1e-6) {
            const dist = Math.sqrt(distSq);
            const invDist = 1 / dist;
            const push = minDist - dist;
            const ux = ox * invDist;
            const uz = oz * invDist;
            nx += ux * push;
            nz += uz * push;
            accNormalX += ux;
            accNormalZ += uz;
          } else {
            nx += minDist;
            accNormalX += 1;
          }
          collided = true;
          movedThisPass = true;
        }
      }
    }

    // 3. Smooth contour-following shore restriction for Level 1–39 (cannot go ashore)
    if (!canGoAshore && getTerrainAt(nx, nz) === 'shore') {
      blockedByShore = true;
      collided = true;
      movedThisPass = true;
      const shoreNorm = computeShoreWaterNormal(nx, nz);
      accNormalX += shoreNorm.nx;
      accNormalZ += shoreNorm.nz;

      // Step smoothly downhill along local elevation gradient until cleanly in water
      // Fine 6u steps near the waterline preserve smooth contour sliding; wider 16u steps guarantee escape from deep bank interiors
      let prevX = nx;
      let prevZ = nz;
      for (let step = 0; step < 28; step++) {
        if (getTerrainAt(nx, nz) !== 'shore') break;
        const n = step === 0 ? shoreNorm : computeShoreWaterNormal(nx, nz);
        const stepSize = step < 6 ? 6 : 16;
        prevX = nx;
        prevZ = nz;
        nx += n.nx * stepSize;
        nz += n.nz * stepSize;
      }
      // Binary refine back toward the exact shoreline edge so there is zero visible bounce/stutter
      if (getTerrainAt(nx, nz) !== 'shore') {
        let loX = prevX;
        let loZ = prevZ;
        let hiX = nx;
        let hiZ = nz;
        for (let b = 0; b < 4; b++) {
          const midX = (loX + hiX) * 0.5;
          const midZ = (loZ + hiZ) * 0.5;
          if (getTerrainAt(midX, midZ) === 'shore') {
            loX = midX;
            loZ = midZ;
          } else {
            hiX = midX;
            hiZ = midZ;
          }
        }
        nx = hiX;
        nz = hiZ;
      }
    }

    if (!movedThisPass) break;
  }

  let normalX = 0;
  let normalZ = 0;
  const nLen = Math.hypot(accNormalX, accNormalZ);
  if (nLen > 1e-4) {
    normalX = accNormalX / nLen;
    normalZ = accNormalZ / nLen;
  }

  return { x: nx, z: nz, blockedByShore, collided, normalX, normalZ };
}

/**
 * Swept/substepped movement collision resolver so high-speed Dash, Slip Evade, or heavy
 * knockback impulses can never tunnel through narrow pilings, boulders, or shorelines.
 */
export function resolveSweptMovement(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius: number,
  canGoAshore: boolean
): ArenaCollisionResult {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const totalDist = Math.hypot(dx, dz);
  const maxStep = Math.max(10, radius * 0.65);

  if (totalDist <= maxStep) {
    return resolveArenaCollision(toX, toZ, radius, canGoAshore);
  }

  const steps = Math.min(8, Math.ceil(totalDist / maxStep));
  const stepDx = dx / steps;
  const stepDz = dz / steps;

  let curX = fromX;
  let curZ = fromZ;
  let blockedByShore = false;
  let collided = false;
  let normalX = 0;
  let normalZ = 0;

  for (let s = 0; s < steps; s++) {
    const res = resolveArenaCollision(curX + stepDx, curZ + stepDz, radius, canGoAshore);
    curX = res.x;
    curZ = res.z;
    if (res.blockedByShore) blockedByShore = true;
    if (res.collided) {
      collided = true;
      normalX = res.normalX;
      normalZ = res.normalZ;
    }
  }

  return { x: curX, z: curZ, blockedByShore, collided, normalX, normalZ };
}

/**
 * Checks whether a coordinate is inside the playable limestone basin, clear of solid
 * rocks/pilings, and on traversable terrain for the current accessibility requirement.
 */
export function isPositionAccessible(
  x: number,
  z: number,
  radius: number,
  canGoAshore: boolean
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const maxR = MAX_PLAYABLE_RADIUS - radius - 4;
  if (Math.hypot(x - WORLD_CENTER, z - WORLD_CENTER) > maxR) return false;

  const terrain = getTerrainAt(x, z);
  if (terrain === 'cliff') return false;
  if (!canGoAshore && terrain === 'shore') return false;

  const bucket = STATIC_COLLIDER_GRID.get(
    colliderCellKey(Math.floor(x / COLLIDER_CELL_SIZE), Math.floor(z / COLLIDER_CELL_SIZE))
  );
  if (bucket) {
    for (let i = 0; i < bucket.length; i++) {
      const obs = bucket[i];
      const minDist = obs.radius + radius + 2;
      const ox = x - obs.x;
      const oz = z - obs.z;
      if (ox * ox + oz * oz < minDist * minDist) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Deterministically locates the nearest reachable position (and optionally inside the
 * active safe zone) so carcasses or fragments trapped on cliffs, inside obstacles, or on
 * inaccessible shore can always be recovered.
 */
export function findNearestAccessiblePosition(
  x: number,
  z: number,
  radius: number,
  canGoAshore: boolean,
  safeCenterX?: number,
  safeCenterZ?: number,
  safeRadius?: number
): { x: number; z: number } {
  const hasSafeZone =
    safeCenterX !== undefined &&
    safeCenterZ !== undefined &&
    safeRadius !== undefined &&
    safeRadius > 0;
  const effectiveSafeRadius = hasSafeZone ? Math.max(40, safeRadius! - 28) : Infinity;

  const isInsideSafe = (cx: number, cz: number): boolean => {
    if (!hasSafeZone) return true;
    return Math.hypot(cx - safeCenterX!, cz - safeCenterZ!) <= effectiveSafeRadius;
  };

  const isCandidateValid = (cx: number, cz: number): boolean =>
    isPositionAccessible(cx, cz, radius, canGoAshore) && isInsideSafe(cx, cz);

  // Clamp starting anchor toward safe zone if currently outside it
  let startX = Number.isFinite(x) ? x : WORLD_CENTER;
  let startZ = Number.isFinite(z) ? z : WORLD_CENTER;
  if (hasSafeZone && !isInsideSafe(startX, startZ)) {
    const dx = startX - safeCenterX!;
    const dz = startZ - safeCenterZ!;
    const d = Math.hypot(dx, dz) || 1;
    startX = safeCenterX! + (dx / d) * Math.max(20, effectiveSafeRadius - 20);
    startZ = safeCenterZ! + (dz / d) * Math.max(20, effectiveSafeRadius - 20);
  }

  const direct = resolveArenaCollision(startX, startZ, radius, canGoAshore);
  if (isCandidateValid(direct.x, direct.z)) {
    return { x: direct.x, z: direct.z };
  }

  const searchOrigins: Array<{ ox: number; oz: number }> = [
    { ox: direct.x, oz: direct.z },
  ];
  if (hasSafeZone) {
    searchOrigins.push({ ox: safeCenterX!, oz: safeCenterZ! });
  }
  searchOrigins.push(
    { ox: LANDMARKS.radioactiveDrum.x, oz: LANDMARKS.radioactiveDrum.z },
    { ox: SPAWN_FALLBACK.x, oz: SPAWN_FALLBACK.z }
  );

  const ringRadii = [32, 72, 120, 180, 260, 360, 480, 640, 860];
  const angleSteps = 16;

  for (const origin of searchOrigins) {
    if (isCandidateValid(origin.ox, origin.oz)) {
      return { x: origin.ox, z: origin.oz };
    }
    for (const r of ringRadii) {
      for (let k = 0; k < angleSteps; k++) {
        const ang = (k / angleSteps) * Math.PI * 2;
        const cx = origin.ox + Math.cos(ang) * r;
        const cz = origin.oz + Math.sin(ang) * r;
        if (isCandidateValid(cx, cz)) {
          return { x: cx, z: cz };
        }
      }
    }
  }

  // Final guaranteed reachable fallback ignoring zone constraint if safe zone was somehow tiny
  for (const origin of searchOrigins) {
    if (isPositionAccessible(origin.ox, origin.oz, radius, canGoAshore)) {
      return { x: origin.ox, z: origin.oz };
    }
    for (const r of ringRadii) {
      for (let k = 0; k < angleSteps; k++) {
        const ang = (k / angleSteps) * Math.PI * 2;
        const cx = origin.ox + Math.cos(ang) * r;
        const cz = origin.oz + Math.sin(ang) * r;
        if (isPositionAccessible(cx, cz, radius, canGoAshore)) {
          return { x: cx, z: cz };
        }
      }
    }
  }

  return { x: SPAWN_FALLBACK.x, z: SPAWN_FALLBACK.z };
}

/**
 * Checks whether the straight line segment between (x1, z1) and (x2, z2) is
 * unobstructed by solid rock obstacles or perimeter cliffs (used to prevent
 * feeding or interacting through solid walls).
 */
export function hasClearObstacleLineOfSight(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  padding = 4
): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-4) return true;

  // Reject if midpoint lies inside outer perimeter cliff
  if (getTerrainAt((x1 + x2) * 0.5, (z1 + z2) * 0.5) === 'cliff') {
    return false;
  }

  for (let i = 0; i < OBSTACLES.length; i++) {
    const obs = OBSTACLES[i];
    const effectiveR = Math.max(4, obs.radius - padding);
    // Project obstacle center onto segment [0, 1]
    const t = Math.max(0, Math.min(1, ((obs.x - x1) * dx + (obs.z - z1) * dz) / lenSq));
    const closestX = x1 + t * dx;
    const closestZ = z1 + t * dz;
    const distSq = (obs.x - closestX) * (obs.x - closestX) + (obs.z - closestZ) * (obs.z - closestZ);
    if (distSq < effectiveR * effectiveR) {
      return false;
    }
  }
  return true;
}

const SPAWN_RING_MIN = scaleArenaDist(310);
const SPAWN_RING_SPAN = scaleArenaDist(440);
const SPAWN_RETRY_MIN = scaleArenaDist(240);
const SPAWN_RETRY_SPAN = scaleArenaDist(520);
const SPAWN_FALLBACK = { x: scaleArenaCoord(860), z: scaleArenaCoord(920) };

export function getHazardAt(x: number, z: number): HazardTile | null {
  for (let i = 0; i < HAZARD_TILES.length; i++) {
    const h = HAZARD_TILES[i];
    const dx = x - h.x;
    const dz = z - h.z;
    if (h.shape === 'circle') {
      if (dx * dx + dz * dz <= h.radius * h.radius) {
        return h;
      }
    } else {
      if (dx * dx + dz * dz > h.radius * h.radius) continue;
      const ang = h.angle ?? 0;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const along = dx * cos + dz * sin;
      const across = -dx * sin + dz * cos;
      if (Math.abs(along) <= (h.halfL ?? 0) && Math.abs(across) <= (h.halfW ?? 0)) {
        return h;
      }
    }
  }
  return null;
}

export function getHazardModifierForForm(
  kind: HazardTileKind,
  form: EvolutionForm
): HazardFormModifier {
  switch (kind) {
    case 'toxic_sludge':
      if (form === 1) {
        return {
          kind,
          label: 'Tin Toxicity',
          speedMult: 0.68,
          staminaRate: -18,
          shoreReserveMult: 1,
          summary: 'Form 1 (Aquatic): -32% Spd · -18 Stam/s',
          color: '#84cc16',
        };
      }
      if (form === 2) {
        return {
          kind,
          label: 'Tin Toxicity',
          speedMult: 0.78,
          staminaRate: -11,
          shoreReserveMult: 1,
          summary: 'Form 2 (Reformed): -22% Spd · -11 Stam/s',
          color: '#a3e635',
        };
      }
      return {
        kind,
        label: 'Tin Toxicity',
        speedMult: 0.88,
        staminaRate: -5,
        shoreReserveMult: 1,
        summary: `Form ${form} (Armored): -12% Spd · -5 Stam/s`,
        color: '#bef264',
      };

    case 'rapids':
      if (form === 1) {
        return {
          kind,
          label: 'Flooded Velocity',
          speedMult: 1.24,
          staminaRate: 2,
          shoreReserveMult: 1,
          summary: 'Form 1 (Aquatic): +24% Swim · Stream Surf',
          color: '#38bdf8',
        };
      }
      if (form === 2) {
        return {
          kind,
          label: 'Riptide Drag',
          speedMult: 0.88,
          staminaRate: -10,
          shoreReserveMult: 1,
          summary: 'Form 2 (Arms): -12% Spd · -10 Stam/s',
          color: '#22d3ee',
        };
      }
      return {
        kind,
        label: 'Riptide Drag',
        speedMult: 0.74,
        staminaRate: -17,
        shoreReserveMult: 1,
        summary: `Form ${form} (Legs): -26% Spd · -17 Stam/s`,
        color: '#0ea5e9',
      };

    case 'quagmire':
      if (form === 1) {
        return {
          kind,
          label: 'Mire Glide',
          speedMult: 1.05,
          staminaRate: 0,
          shoreReserveMult: 1,
          summary: 'Form 1 (Aquatic): +5% Slither · No Drain',
          color: '#c28f52',
        };
      }
      if (form === 2) {
        return {
          kind,
          label: 'Quagmire Snare',
          speedMult: 0.66,
          staminaRate: -14,
          shoreReserveMult: 1,
          summary: 'Form 2 (Arms): -34% Spd · -14 Stam/s',
          color: '#d97706',
        };
      }
      return {
        kind,
        label: 'Quagmire Snare',
        speedMult: 0.84,
        staminaRate: -7,
        shoreReserveMult: 1,
        summary: `Form ${form} (Legs): -16% Spd · -7 Stam/s`,
        color: '#b45309',
      };

    case 'thermal_vent':
      if (form === 1) {
        return {
          kind,
          label: 'Brine Scorch',
          speedMult: 0.84,
          staminaRate: -14,
          shoreReserveMult: 1,
          summary: 'Form 1 (Aquatic): -16% Spd · -14 Stam/s',
          color: '#fb923c',
        };
      }
      if (form === 2) {
        return {
          kind,
          label: 'Brine Scorch',
          speedMult: 0.86,
          staminaRate: -16,
          shoreReserveMult: 2.2,
          summary: 'Form 2 (Hybrid): -14% Spd · 2.2x Dehydration',
          color: '#f97316',
        };
      }
      return {
        kind,
        label: 'Thermal Surge',
        speedMult: 1.04,
        staminaRate: -3,
        shoreReserveMult: 1,
        summary: `Form ${form} (Amphibious): +4% Stride · Heat Resistant`,
        color: '#fdba74',
      };
  }
}

/**
 * Validates that a candidate water spawn coordinate is strictly accessible water
 * (deep or shallow, respecting Lv.1–39 shore restrictions), inside the playable basin,
 * clear of all rock/Palong colliders via the O(1) static spatial grid, outside hazards,
 * and possesses viable escape lanes in at least `minEscapeDirs` cardinal directions.
 */
export function isWaterSpawnValid(
  x: number,
  z: number,
  obstacleClearance = 44,
  minEscapeDirs = 2
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (Math.hypot(x - WORLD_CENTER, z - WORLD_CENTER) > MAX_PLAYABLE_RADIUS - obstacleClearance - 40) {
    return false;
  }
  const terrain = getTerrainAt(x, z);
  if (terrain !== 'deep' && terrain !== 'shallow') return false;
  if (getHazardAt(x, z)) return false;

  const bucket = STATIC_COLLIDER_GRID.get(
    colliderCellKey(Math.floor(x / COLLIDER_CELL_SIZE), Math.floor(z / COLLIDER_CELL_SIZE))
  );
  if (bucket) {
    for (let i = 0; i < bucket.length; i++) {
      const obs = bucket[i];
      const minD = obs.radius + obstacleClearance;
      const dx = x - obs.x;
      const dz = z - obs.z;
      if (dx * dx + dz * dz < minD * minD) return false;
    }
  }

  if (minEscapeDirs > 0) {
    const step = 76;
    const dirs = [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ];
    let openDirs = 0;
    for (let d = 0; d < dirs.length; d++) {
      const nx = x + dirs[d][0];
      const nz = z + dirs[d][1];
      const nt = getTerrainAt(nx, nz);
      if (nt !== 'deep' && nt !== 'shallow') continue;
      let blocked = false;
      const nb = STATIC_COLLIDER_GRID.get(
        colliderCellKey(Math.floor(nx / COLLIDER_CELL_SIZE), Math.floor(nz / COLLIDER_CELL_SIZE))
      );
      if (nb) {
        for (let i = 0; i < nb.length; i++) {
          const obs = nb[i];
          const minD = obs.radius + 26;
          const dx = nx - obs.x;
          const dz = nz - obs.z;
          if (dx * dx + dz * dz < minD * minD) {
            blocked = true;
            break;
          }
        }
      }
      if (!blocked) {
        openDirs++;
        if (openDirs >= minEscapeDirs) break;
      }
    }
    if (openDirs < minEscapeDirs) return false;
  }

  return true;
}

/**
 * Finds a safe water spawn coordinate away from rocks, hazard tiles & Tebing Kering shore.
 */
export function findWaterSpawn(seedIndex: number, total: number): { x: number; z: number } {
  // Spread around the outer & mid aquatic rings
  const ringAngle = (seedIndex / Math.max(1, total)) * Math.PI * 2 + (seedIndex % 3) * 0.27;
  const ringRadius = SPAWN_RING_MIN + ((seedIndex * 389) % SPAWN_RING_SPAN);
  let x = WORLD_CENTER + Math.cos(ringAngle) * ringRadius;
  let z = WORLD_CENTER + Math.sin(ringAngle) * ringRadius;

  // Nudge out of obstacles, hazards, and shore
  for (let attempt = 0; attempt < 32; attempt++) {
    if (isWaterSpawnValid(x, z, 36, 1)) {
      return { x, z };
    }
    const a = ringAngle + attempt * 0.45;
    const r = SPAWN_RETRY_MIN + ((attempt * 233) % SPAWN_RETRY_SPAN);
    x = WORLD_CENTER + Math.cos(a) * r;
    z = WORLD_CENTER + Math.sin(a) * r;
  }

  return SPAWN_FALLBACK;
}

/**
 * Finds a random spawn coordinate inside the active safe zone & cliff perimeter,
 * avoiding rock obstacles and clustering near existing pickups.
 */
export function findPickupSpawn(
  centerX: number,
  centerZ: number,
  zoneRadius: number,
  existing: ReadonlyArray<{ x: number; z: number }>,
  minSpacing = 180,
  waterOnly = false,
  rng: () => number = Math.random
): { x: number; z: number } {
  const usableRadius = Math.max(80, zoneRadius - 60);
  const maxCliffDist = CLIFF_TERRAIN_DIST - 60;

  for (let pass = 0; pass < 2; pass++) {
    const reqSpacing = pass === 0 ? minSpacing : 70;
    for (let attempt = 0; attempt < 36; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * usableRadius;
      const x = centerX + Math.cos(a) * r;
      const z = centerZ + Math.sin(a) * r;

      if (Math.hypot(x - WORLD_CENTER, z - WORLD_CENTER) >= maxCliffDist) continue;
      const terrain = getTerrainAt(x, z);
      if (terrain === 'cliff') continue;
      if (waterOnly && terrain !== 'deep' && terrain !== 'shallow') continue;

      let blocked = false;
      for (const obs of OBSTACLES) {
        if (Math.hypot(x - obs.x, z - obs.z) < obs.radius + 38) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      let tooClose = false;
      for (let i = 0; i < existing.length; i++) {
        if (Math.hypot(x - existing[i].x, z - existing[i].z) < reqSpacing) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) return { x, z };
    }
  }

  return SPAWN_FALLBACK;
}


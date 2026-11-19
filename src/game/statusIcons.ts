import * as THREE from 'three';
import { getEvolutionForm } from '../data/abilities';
import { KeliEntity, WeatherState, ZoneState } from './types';

export const MAX_FLOATING_STATUS_ICONS = 4;

export type StatusIndicatorId =
  | 'radioactive_water'
  | 'flooded_velocity'
  | 'riptide_drag'
  | 'tin_toxicity'
  | 'tin_toxicity_armored'
  | 'mire_glide'
  | 'quagmire_snare'
  | 'brine_scorch'
  | 'thermal_surge'
  | 'shore_exposure'
  | 'stunned'
  | 'venom'
  | 'fatigued'
  | 'monsoon_dew'
  | 'stormfin'
  | 'thunder_roe'
  | 'amphetide_surge'
  | 'carapace_aegis'
  | 'silt_veil'
  | 'basin_fog'
  | 'monsoon_rain';

export type StatusIndicatorCategory = 'critical' | 'hazard' | 'buff' | 'weather';

export interface StatusIndicatorSpec {
  id: StatusIndicatorId;
  label: string;
  shortTag: string;
  category: StatusIndicatorCategory;
  color: string;
  accentColor: string;
  bgColor: string;
}

export const STATUS_INDICATOR_CATALOG: Record<StatusIndicatorId, StatusIndicatorSpec> = {
  radioactive_water: {
    id: 'radioactive_water',
    label: 'Radioactive Water',
    shortTag: 'RAD',
    category: 'critical',
    color: '#f87171',
    accentColor: '#fbbf24',
    bgColor: '#2a0b0e',
  },
  flooded_velocity: {
    id: 'flooded_velocity',
    label: 'Flooded Velocity',
    shortTag: 'SPEED',
    category: 'buff',
    color: '#38bdf8',
    accentColor: '#e0f2fe',
    bgColor: '#071f30',
  },
  riptide_drag: {
    id: 'riptide_drag',
    label: 'Riptide Drag',
    shortTag: 'DRAG',
    category: 'hazard',
    color: '#22d3ee',
    accentColor: '#a5f3fc',
    bgColor: '#081d26',
  },
  tin_toxicity: {
    id: 'tin_toxicity',
    label: 'Tin Toxicity',
    shortTag: 'TOXIC',
    category: 'hazard',
    color: '#a3e635',
    accentColor: '#ecfccb',
    bgColor: '#152408',
  },
  tin_toxicity_armored: {
    id: 'tin_toxicity_armored',
    label: 'Tin Toxicity (Armored)',
    shortTag: 'TOXIC',
    category: 'hazard',
    color: '#bef264',
    accentColor: '#f7fee7',
    bgColor: '#18240c',
  },
  mire_glide: {
    id: 'mire_glide',
    label: 'Mire Glide',
    shortTag: 'GLIDE',
    category: 'buff',
    color: '#d4a359',
    accentColor: '#fef3c7',
    bgColor: '#241a0a',
  },
  quagmire_snare: {
    id: 'quagmire_snare',
    label: 'Quagmire Snare',
    shortTag: 'MIRE',
    category: 'hazard',
    color: '#d97706',
    accentColor: '#fde68a',
    bgColor: '#261405',
  },
  brine_scorch: {
    id: 'brine_scorch',
    label: 'Brine Scorch',
    shortTag: 'HEAT',
    category: 'hazard',
    color: '#f97316',
    accentColor: '#fed7aa',
    bgColor: '#2b1006',
  },
  thermal_surge: {
    id: 'thermal_surge',
    label: 'Thermal Surge',
    shortTag: 'SURGE',
    category: 'buff',
    color: '#fdba74',
    accentColor: '#fff7ed',
    bgColor: '#291507',
  },
  shore_exposure: {
    id: 'shore_exposure',
    label: 'Shore Exposure',
    shortTag: 'DRY',
    category: 'critical',
    color: '#fb923c',
    accentColor: '#fef08a',
    bgColor: '#2b1108',
  },
  stunned: {
    id: 'stunned',
    label: 'Stunned',
    shortTag: 'STUN',
    category: 'hazard',
    color: '#fbbf24',
    accentColor: '#fef9c3',
    bgColor: '#261b05',
  },
  venom: {
    id: 'venom',
    label: 'Venom',
    shortTag: 'VENOM',
    category: 'hazard',
    color: '#4ade80',
    accentColor: '#dcfce7',
    bgColor: '#092412',
  },
  fatigued: {
    id: 'fatigued',
    label: 'Fatigued',
    shortTag: 'TIRED',
    category: 'hazard',
    color: '#f59e0b',
    accentColor: '#fef3c7',
    bgColor: '#241706',
  },
  monsoon_dew: {
    id: 'monsoon_dew',
    label: 'Monsoon Dew',
    shortTag: 'DEW',
    category: 'buff',
    color: '#2dd4bf',
    accentColor: '#ccfbf1',
    bgColor: '#072221',
  },
  stormfin: {
    id: 'stormfin',
    label: 'Stormfin Catalyst',
    shortTag: 'SWIFT',
    category: 'buff',
    color: '#60a5fa',
    accentColor: '#dbeafe',
    bgColor: '#0a1b30',
  },
  thunder_roe: {
    id: 'thunder_roe',
    label: 'Thunder Roe',
    shortTag: 'VOLT',
    category: 'buff',
    color: '#c084fc',
    accentColor: '#f3e8ff',
    bgColor: '#1f0e30',
  },
  amphetide_surge: {
    id: 'amphetide_surge',
    label: 'Amphetide Surge',
    shortTag: 'HASTE',
    category: 'buff',
    color: '#38bdf8',
    accentColor: '#e0f2fe',
    bgColor: '#081e2d',
  },
  carapace_aegis: {
    id: 'carapace_aegis',
    label: 'Carapace Aegis',
    shortTag: 'AEGIS',
    category: 'buff',
    color: '#fbbf24',
    accentColor: '#fef3c7',
    bgColor: '#241a07',
  },
  silt_veil: {
    id: 'silt_veil',
    label: 'Silt Veil',
    shortTag: 'VEIL',
    category: 'buff',
    color: '#94a3b8',
    accentColor: '#f1f5f9',
    bgColor: '#111a22',
  },
  basin_fog: {
    id: 'basin_fog',
    label: 'Basin Fog',
    shortTag: 'FOG',
    category: 'weather',
    color: '#cbd5e1',
    accentColor: '#f8fafc',
    bgColor: '#121d24',
  },
  monsoon_rain: {
    id: 'monsoon_rain',
    label: 'Monsoon Rain',
    shortTag: 'RAIN',
    category: 'weather',
    color: '#7dd3fc',
    accentColor: '#e0f2fe',
    bgColor: '#0a1c28',
  },
};

function pushIfRoom(out: StatusIndicatorSpec[], id: StatusIndicatorId): boolean {
  if (out.length >= MAX_FLOATING_STATUS_ICONS) return false;
  out.push(STATUS_INDICATOR_CATALOG[id]);
  return true;
}

/**
 * Populates `out` with up to MAX_FLOATING_STATUS_ICONS active environmental & status
 * indicators for a Keli entity, ordered by tactical priority. Zero heap allocations.
 */
export function collectActiveStatusIndicators(
  k: KeliEntity,
  env: { zone: ZoneState; weather: WeatherState },
  out: StatusIndicatorSpec[]
): number {
  out.length = 0;
  if (!k.alive) return 0;

  const form = getEvolutionForm(k.level);

  // 1. Critical environmental boundary: Radioactive Water outside safe zone
  const distFromZone = Math.hypot(k.x - env.zone.centerX, k.z - env.zone.centerZ);
  if (distFromZone > env.zone.currentRadius) {
    pushIfRoom(out, 'radioactive_water');
  }

  // 2. Active Biome Environmental Condition (form-aware)
  if (k.activeHazard === 'rapids') {
    pushIfRoom(out, form === 1 ? 'flooded_velocity' : 'riptide_drag');
  } else if (k.activeHazard === 'toxic_sludge') {
    pushIfRoom(out, form >= 3 ? 'tin_toxicity_armored' : 'tin_toxicity');
  } else if (k.activeHazard === 'quagmire') {
    pushIfRoom(out, form === 1 ? 'mire_glide' : 'quagmire_snare');
  } else if (k.activeHazard === 'thermal_vent') {
    pushIfRoom(out, form >= 3 ? 'thermal_surge' : 'brine_scorch');
  }

  // 3. Mid-game Shoreline Exposure (Lv 40-79 ashore without Aegis/Dew protection)
  if (k.isOnShore && k.level >= 40 && k.level < 80 && k.aegisTimer <= 0 && k.dewTimer <= 0) {
    pushIfRoom(out, 'shore_exposure');
  }

  // 4. Acute Combat & Stamina Debuffs
  if (k.stunTimer > 0) pushIfRoom(out, 'stunned');
  if (k.venomTimer > 0) pushIfRoom(out, 'venom');
  if (k.fatigued) pushIfRoom(out, 'fatigued');

  // 5. Environmental / Power-Up Buffs
  if (k.dewTimer > 0) pushIfRoom(out, 'monsoon_dew');
  if (k.stormFinTimer > 0) pushIfRoom(out, 'stormfin');
  if (k.thunderRoeTimer > 0) pushIfRoom(out, 'thunder_roe');
  if (k.surgeTimer > 0) pushIfRoom(out, 'amphetide_surge');
  if (k.aegisTimer > 0) pushIfRoom(out, 'carapace_aegis');
  if (k.veilTimer > 0) pushIfRoom(out, 'silt_veil');

  // 6. Active Basin Weather Condition (only when weather visibility/atmosphere is engaged)
  if (env.weather.intensity >= 0.35) {
    if (env.weather.kind === 'basin_fog') {
      pushIfRoom(out, 'basin_fog');
    } else if (env.weather.kind === 'light_rain') {
      pushIfRoom(out, 'monsoon_rain');
    }
  }

  return out.length;
}

function traceOctagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const cut = r * 0.42;
  ctx.beginPath();
  ctx.moveTo(cx - r + cut, cy - r);
  ctx.lineTo(cx + r - cut, cy - r);
  ctx.lineTo(cx + r, cy - r + cut);
  ctx.lineTo(cx + r, cy + r - cut);
  ctx.lineTo(cx + r - cut, cy + r);
  ctx.lineTo(cx - r + cut, cy + r);
  ctx.lineTo(cx - r, cy + r - cut);
  ctx.lineTo(cx - r, cy - r + cut);
  ctx.closePath();
}

function traceDiamondCrest(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 1.04);
  ctx.lineTo(cx + r * 0.88, cy - r * 0.42);
  ctx.lineTo(cx + r * 0.88, cy + r * 0.48);
  ctx.lineTo(cx, cy + r * 1.0);
  ctx.lineTo(cx - r * 0.88, cy + r * 0.48);
  ctx.lineTo(cx - r * 0.88, cy - r * 0.42);
  ctx.closePath();
}

function drawGlyph(ctx: CanvasRenderingContext2D, id: StatusIndicatorId, cx: number, cy: number, color: string, accent: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (id) {
    case 'flooded_velocity': {
      // Sweeping water wave below twin forward speed chevrons
      ctx.strokeStyle = color;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(-24, 16);
      ctx.quadraticCurveTo(-10, 6, 0, 14);
      ctx.quadraticCurveTo(10, 22, 24, 12);
      ctx.stroke();

      // Speed chevrons (>>)
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(-20, -16);
      ctx.lineTo(-4, -3);
      ctx.lineTo(-20, 10);
      ctx.moveTo(-2, -18);
      ctx.lineTo(16, -3);
      ctx.lineTo(-2, 12);
      ctx.stroke();

      // Leading sparkle streak
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(15, -13);
      ctx.lineTo(24, -13);
      ctx.stroke();
      break;
    }

    case 'riptide_drag': {
      // Curling undertow wave + backward opposing drag chevron
      ctx.strokeStyle = color;
      ctx.lineWidth = 4.8;
      ctx.beginPath();
      ctx.moveTo(-24, 12);
      ctx.bezierCurveTo(-12, -8, 12, -8, 22, 6);
      ctx.quadraticCurveTo(16, 18, 4, 12);
      ctx.stroke();

      ctx.strokeStyle = accent;
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.moveTo(12, -18);
      ctx.lineTo(-2, -8);
      ctx.lineTo(12, 2);
      ctx.moveTo(-4, -18);
      ctx.lineTo(-18, -8);
      ctx.lineTo(-4, 2);
      ctx.stroke();
      break;
    }

    case 'tin_toxicity':
    case 'tin_toxicity_armored': {
      // Bubbling toxic acid droplet with skull-like fume eyes
      ctx.fillStyle = color;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(0, -25);
      ctx.bezierCurveTo(16, -6, 21, 6, 18, 16);
      ctx.arc(0, 11, 18.5, 0.25, Math.PI - 0.25);
      ctx.bezierCurveTo(-21, 6, -16, -6, 0, -25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Dark toxic skull eyes + slash inside droplet
      ctx.fillStyle = '#122006';
      ctx.beginPath();
      ctx.arc(-6.5, 7, 3.8, 0, Math.PI * 2);
      ctx.arc(6.5, 7, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, 16);
      ctx.lineTo(4, 16);
      ctx.strokeStyle = '#122006';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Rising toxic vapor bubbles
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(-18, -14, 3.6, 0, Math.PI * 2);
      ctx.arc(19, -10, 2.8, 0, Math.PI * 2);
      ctx.fill();

      if (id === 'tin_toxicity_armored') {
        // Armored brass-lime shield chevron over lower-right corner
        ctx.fillStyle = 'rgba(13, 21, 27, 0.9)';
        ctx.strokeStyle = '#f3d285';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(14, 4);
        ctx.lineTo(25, 8);
        ctx.lineTo(23, 20);
        ctx.lineTo(14, 26);
        ctx.lineTo(5, 20);
        ctx.lineTo(3, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }

    case 'mire_glide': {
      // Smooth golden S-ribbon skimming across ripples
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5.2;
      ctx.beginPath();
      ctx.moveTo(-22, 10);
      ctx.bezierCurveTo(-12, -16, 4, 16, 18, -12);
      ctx.stroke();

      // Arrowhead tip
      ctx.beginPath();
      ctx.moveTo(9, -14);
      ctx.lineTo(20, -14);
      ctx.lineTo(18, -2);
      ctx.stroke();

      // Mud surface ripples
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-22, 18);
      ctx.lineTo(22, 18);
      ctx.stroke();
      break;
    }

    case 'quagmire_snare': {
      // Sinking mud spiral + downward snare arrow
      ctx.strokeStyle = color;
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.ellipse(0, 12, 22, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 12, 12, 4.5, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Downward drag arrow
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, -21);
      ctx.lineTo(0, 7);
      ctx.moveTo(-10, -2);
      ctx.lineTo(0, 8);
      ctx.lineTo(10, -2);
      ctx.stroke();
      break;
    }

    case 'brine_scorch':
    case 'thermal_surge': {
      // Blazing thermal vent flame
      ctx.fillStyle = color;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, -25);
      ctx.bezierCurveTo(16, -12, 22, 4, 14, 18);
      ctx.quadraticCurveTo(0, 26, -14, 18);
      ctx.bezierCurveTo(-22, 4, -14, -10, 0, -25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Inner bright core
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.bezierCurveTo(7, 0, 9, 10, 0, 16);
      ctx.bezierCurveTo(-9, 10, -7, 0, 0, -9);
      ctx.closePath();
      ctx.fill();

      if (id === 'thermal_surge') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(-10, -14);
        ctx.lineTo(0, -24);
        ctx.lineTo(10, -14);
        ctx.stroke();
      }
      break;
    }

    case 'radioactive_water': {
      // Crisp 3-blade radiation trefoil
      ctx.fillStyle = accent;
      for (let i = 0; i < 3; i++) {
        const a0 = -Math.PI / 2 + (i * Math.PI * 2) / 3 - 0.48;
        const a1 = a0 + 0.96;
        ctx.beginPath();
        ctx.arc(0, 0, 24, a0, a1);
        ctx.arc(0, 0, 9, a1, a0, true);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 6.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2a0b0e';
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }

    case 'shore_exposure': {
      // Evaporating cracked water droplet beneath solar arc
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(0, -17, 13, 0.25, Math.PI - 0.25);
      ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        const ang = -Math.PI / 2 + i * 0.42;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 16, -15 + Math.sin(ang) * 12);
        ctx.lineTo(Math.cos(ang) * 22, -15 + Math.sin(ang) * 17);
        ctx.stroke();
      }

      // Parched droplet
      ctx.fillStyle = color;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.bezierCurveTo(13, 6, 14, 17, 0, 22);
      ctx.bezierCurveTo(-14, 17, -13, 6, 0, -6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Crack slash across droplet
      ctx.strokeStyle = '#2b1108';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-4, 4);
      ctx.lineTo(2, 10);
      ctx.lineTo(-3, 16);
      ctx.stroke();
      break;
    }

    case 'stunned': {
      // Electric 4-point starburst & shock ring
      ctx.fillStyle = accent;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const rad = i % 2 === 0 ? 23 : 8.5;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'venom': {
      // Twin venomous fangs dripping green toxin
      ctx.fillStyle = accent;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-16, -20);
      ctx.lineTo(-4, -20);
      ctx.lineTo(-10, 4);
      ctx.closePath();
      ctx.moveTo(4, -20);
      ctx.lineTo(16, -20);
      ctx.lineTo(10, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(-10, 15, 5.5, 0, Math.PI * 2);
      ctx.arc(10, 15, 5.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'fatigued': {
      // Low/cracked stamina bolt
      ctx.strokeStyle = color;
      ctx.fillStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(5, -23);
      ctx.lineTo(-12, 2);
      ctx.lineTo(-1, 2);
      ctx.lineTo(-7, 23);
      ctx.lineTo(13, -3);
      ctx.lineTo(1, -3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Diagonal drain slash
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(-20, -16);
      ctx.lineTo(20, 16);
      ctx.stroke();
      break;
    }

    case 'monsoon_dew': {
      // Luminous teal dew droplet with inner highlight
      ctx.fillStyle = color;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.bezierCurveTo(17, -4, 19, 14, 0, 22);
      ctx.bezierCurveTo(-19, 14, -17, -4, 0, -24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(-5, 6, 7, Math.PI * 0.75, Math.PI * 1.25);
      ctx.stroke();
      break;
    }

    case 'stormfin': {
      // Triple windswept storm streaks
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.moveTo(-22, -10);
      ctx.quadraticCurveTo(0, -18, 16, -8);
      ctx.moveTo(-24, 2);
      ctx.quadraticCurveTo(2, -5, 22, 4);
      ctx.moveTo(-16, 14);
      ctx.quadraticCurveTo(2, 8, 18, 16);
      ctx.stroke();
      break;
    }

    case 'thunder_roe': {
      // Lightning bolt inside glowing violet orb
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(5, -18);
      ctx.lineTo(-10, 2);
      ctx.lineTo(0, 2);
      ctx.lineTo(-5, 18);
      ctx.lineTo(11, -3);
      ctx.lineTo(1, -3);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'amphetide_surge': {
      // High-velocity turbine gauge arc + upward needle
      ctx.strokeStyle = color;
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.arc(0, 6, 20, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();

      ctx.strokeStyle = accent;
      ctx.lineWidth = 4.8;
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.lineTo(12, -10);
      ctx.stroke();

      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, 10, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'carapace_aegis': {
      // Faceted golden carapace shield
      ctx.fillStyle = color;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(0, -23);
      ctx.lineTo(19, -14);
      ctx.lineTo(16, 8);
      ctx.lineTo(0, 23);
      ctx.lineTo(-16, 8);
      ctx.lineTo(-19, -14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#241a07';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.lineTo(0, 16);
      ctx.moveTo(-11, -5);
      ctx.lineTo(11, -5);
      ctx.stroke();
      break;
    }

    case 'silt_veil': {
      // Swirling stealth mist cloud
      ctx.fillStyle = color;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(-9, 2, 11, Math.PI * 0.5, Math.PI * 1.6);
      ctx.arc(2, -6, 12, Math.PI * 1.1, Math.PI * 1.95);
      ctx.arc(12, 3, 10, Math.PI * 1.5, Math.PI * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'basin_fog': {
      // Layered karst mist bars
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-20, -12);
      ctx.lineTo(18, -12);
      ctx.moveTo(-24, 0);
      ctx.lineTo(24, 0);
      ctx.moveTo(-16, 12);
      ctx.lineTo(20, 12);
      ctx.stroke();
      break;
    }

    case 'monsoon_rain': {
      // Three crisp angled rain streaks
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.moveTo(-10, -18);
      ctx.lineTo(-18, 12);
      ctx.moveTo(4, -20);
      ctx.lineTo(-4, 14);
      ctx.moveTo(18, -14);
      ctx.lineTo(10, 16);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

function buildStatusIconTexture(
  spec: StatusIndicatorSpec,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const w = 144;
  const h = 168;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = 64;
  const r = 49;

  // Soft outer aura glow in the condition's signature color
  const glow = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r * 1.24);
  glow.addColorStop(0, `${spec.color}66`);
  glow.addColorStop(0.65, `${spec.color}22`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.24, 0, Math.PI * 2);
  ctx.fill();

  // Category-distinct Compendium medallion frame
  const traceFrame = () => {
    if (spec.category === 'buff') {
      traceDiamondCrest(ctx, cx, cy, r);
    } else if (spec.category === 'weather') {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
      ctx.closePath();
    } else {
      traceOctagon(ctx, cx, cy, r * 0.95);
    }
  };

  // Drop shadow for crisp separation against bright water/stone
  ctx.save();
  ctx.shadowColor = 'rgba(2, 6, 10, 0.85)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  traceFrame();
  ctx.fillStyle = spec.bgColor;
  ctx.fill();
  ctx.restore();

  // Inner metallic radial sheen
  ctx.save();
  traceFrame();
  ctx.clip();
  const innerGrad = ctx.createRadialGradient(cx, cy - 16, 4, cx, cy + 6, r * 1.15);
  innerGrad.addColorStop(0, `${spec.color}38`);
  innerGrad.addColorStop(0.65, 'rgba(8, 16, 22, 0.55)');
  innerGrad.addColorStop(1, 'rgba(4, 9, 13, 0.92)');
  ctx.fillStyle = innerGrad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Outer brass-tinted & condition-colored double bevel rim
  traceFrame();
  ctx.strokeStyle = spec.color;
  ctx.lineWidth = 4.4;
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(0.86, 0.86);
  ctx.translate(-cx, -cy);
  traceFrame();
  ctx.strokeStyle = 'rgba(243, 210, 133, 0.42)';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();

  // Draw the centered high-contrast procedural vector glyph
  drawGlyph(ctx, spec.id, cx, cy, spec.color, spec.accentColor);

  // Corner polarity crest (top-right: ▲ for buffs, ! for hazards/critical)
  if (spec.category === 'buff' || spec.category === 'hazard' || spec.category === 'critical') {
    const bx = cx + 36;
    const by = cy - 36;
    ctx.fillStyle = '#081016';
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(bx, by, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = spec.accentColor;
    if (spec.category === 'buff') {
      ctx.beginPath();
      ctx.moveTo(bx, by - 6.5);
      ctx.lineTo(bx + 6, by + 4.5);
      ctx.lineTo(bx - 6, by + 4.5);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(bx - 1.8, by - 6.5, 3.6, 8);
      ctx.beginPath();
      ctx.arc(bx, by + 5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Crisp beveled micro-tag plaque below the medallion
  const tagW = 112;
  const tagH = 30;
  const tagX = cx - tagW / 2;
  const tagY = 124;
  ctx.fillStyle = 'rgba(8, 16, 22, 0.94)';
  ctx.fillRect(tagX, tagY, tagW, tagH);
  ctx.strokeStyle = spec.color;
  ctx.lineWidth = 2.4;
  ctx.strokeRect(tagX, tagY, tagW, tagH);

  ctx.font = 'bold 21px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = spec.accentColor;
  ctx.fillText(spec.shortTag, cx, tagY + tagH / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.max(1, Math.min(4, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

/**
 * Per-renderer cache of procedural floating status icon textures.
 * Owned and disposed by ArenaScene3D so every WebGL context cleans up properly.
 */
export class StatusIconTextureCache {
  private readonly textures = new Map<StatusIndicatorId, THREE.CanvasTexture>();
  private readonly maxAnisotropy: number;

  constructor(maxAnisotropy: number) {
    this.maxAnisotropy = maxAnisotropy;
  }

  public getTexture(id: StatusIndicatorId): THREE.CanvasTexture {
    let tex = this.textures.get(id);
    if (!tex) {
      tex = buildStatusIconTexture(STATUS_INDICATOR_CATALOG[id], this.maxAnisotropy);
      this.textures.set(id, tex);
    }
    return tex;
  }

  public dispose(): void {
    for (const tex of this.textures.values()) {
      tex.dispose();
    }
    this.textures.clear();
  }
}

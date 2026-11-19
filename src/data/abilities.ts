import { ECHO_SONAR_RADIUS } from '../game/arena.ts';
import type { AbilityId, EvolutionForm } from '../game/types.ts';

export interface EvolutionMilestone {
  level: number;
  title: string;
  shortRule: string;
  abilityId?: AbilityId;
  keyHint?: string;
}

export const EVOLUTION_MILESTONES: EvolutionMilestone[] = [
  {
    level: 1,
    title: 'Bite / Swim',
    shortRule: 'Aquatic movement and close-range telegraphed bite.',
    abilityId: 'bite',
    keyHint: 'LMB / Space',
  },
  {
    level: 10,
    title: 'Riptide Dash',
    shortRule: 'Short aquatic burst to pursue prey or disengage.',
    abilityId: 'dash',
    keyHint: 'Shift',
  },
  {
    level: 20,
    title: 'Echo Sonar',
    shortRule: `${ECHO_SONAR_RADIUS}-unit local scan for 4.2s (12s cooldown).`,
    abilityId: 'sonar',
    keyHint: 'E',
  },
  {
    level: 30,
    title: 'Venom Bite',
    shortRule: 'Ongoing poison damage finishes rivals after separation.',
  },
  {
    level: 40,
    title: 'First Reformation',
    shortRule: 'Two arms grow. Bite stuns. Fish tail, 10s shore raids.',
  },
  {
    level: 50,
    title: 'Silt Veil',
    shortRule: 'Eject a dark mud cloud that disrupts rival targeting.',
    abilityId: 'veil',
    keyHint: 'Q',
  },
  {
    level: 60,
    title: 'Electroshock',
    shortRule: 'Local damage and stun burst around your body.',
    abilityId: 'electroshock',
    keyHint: 'R',
  },
  {
    level: 70,
    title: 'Feeding Frenzy',
    shortRule: 'Brief increase in bite rate and speed after feeding.',
  },
  {
    level: 80,
    title: 'Amphibious / Hunter Sonar',
    shortRule: 'Two legs grow. Permanent land access + global lower-level scan (7s, 16s CD).',
    abilityId: 'sonar',
    keyHint: 'E',
  },
  {
    level: 90,
    title: 'Maelstrom',
    shortRule: 'Pull rivals and unclaimed carcasses toward you.',
    abilityId: 'maelstrom',
    keyHint: 'F',
  },
  {
    level: 100,
    title: 'Keli King',
    shortRule: 'All 100 fragments reunited. Final form and immediate victory.',
  },
];

export interface ActiveAbilitySpec {
  id: AbilityId;
  name: string;
  key: string;
  unlockLevel: number;
  cooldown: number;
  staminaCost?: number;
  description: string;
}

export const ACTIVE_ABILITIES: ActiveAbilitySpec[] = [
  {
    id: 'bite',
    name: 'Bite / Feed',
    key: 'LMB / Space',
    unlockLevel: 1,
    cooldown: 0.45,
    staminaCost: 10,
    description: 'Directional bite arc (stuns at Lv.40+). Also feeds on nearby carcasses.',
  },
  {
    id: 'evade',
    name: 'Slip Evade',
    key: 'RMB / C',
    unlockLevel: 1,
    cooldown: 2.2,
    staminaCost: 24,
    description: 'Quick evasive burst with brief 60% damage mitigation and stun guard.',
  },
  {
    id: 'dash',
    name: 'Riptide Dash',
    key: 'Shift',
    unlockLevel: 10,
    cooldown: 3.5,
    staminaCost: 18,
    description: 'Surge forward rapidly along your movement or aim vector.',
  },
  {
    id: 'sonar',
    name: 'Echo / Hunter Sonar',
    key: 'E',
    unlockLevel: 20,
    cooldown: 12,
    description: `Lv.20: ${ECHO_SONAR_RADIUS}-unit local scan (4.2s). Lv.80: Global lower-level scan (7s, 16s CD).`,
  },
  {
    id: 'veil',
    name: 'Silt Veil',
    key: 'Q',
    unlockLevel: 50,
    cooldown: 10,
    staminaCost: 12,
    description: 'Eject a dense silt cloud for 4s that breaks enemy tracking.',
  },
  {
    id: 'electroshock',
    name: 'Electroshock',
    key: 'R',
    unlockLevel: 60,
    cooldown: 11,
    staminaCost: 14,
    description: 'Discharge bio-electric shockwave damaging and stunning nearby rivals.',
  },
  {
    id: 'maelstrom',
    name: 'Maelstrom',
    key: 'F',
    unlockLevel: 90,
    cooldown: 14,
    staminaCost: 16,
    description: 'Conjure a swirling vortex pulling rivals and carcasses inward.',
  },
];

export type MilestoneTier = 1 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100;

export const MILESTONE_TIERS: MilestoneTier[] = [
  1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
];

export function getMilestoneTier(level: number): MilestoneTier {
  if (level >= 100) return 100;
  if (level >= 90) return 90;
  if (level >= 80) return 80;
  if (level >= 70) return 70;
  if (level >= 60) return 60;
  if (level >= 50) return 50;
  if (level >= 40) return 40;
  if (level >= 30) return 30;
  if (level >= 20) return 20;
  if (level >= 10) return 10;
  return 1;
}

export function getEvolutionForm(level: number): EvolutionForm {
  if (level >= 100) return 4;
  if (level >= 80) return 3;
  if (level >= 40) return 2;
  return 1;
}

export function getFormLabel(form: EvolutionForm): string {
  switch (form) {
    case 1:
      return 'Aquatic Form (Limbless)';
    case 2:
      return 'First Reformation (Arms & Tail)';
    case 3:
      return 'Amphibious Form (Legs)';
    case 4:
      return 'Raja Keli (Keli King)';
  }
}

export function getNextMilestone(level: number): EvolutionMilestone | null {
  for (const m of EVOLUTION_MILESTONES) {
    if (m.level > level) return m;
  }
  return null;
}

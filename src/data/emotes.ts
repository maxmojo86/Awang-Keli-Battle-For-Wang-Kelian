export type EmoteCategory = 'signal' | 'taunt';

export type EmoteId =
  | 'rally'
  | 'danger'
  | 'feast'
  | 'challenge'
  | 'respect'
  | 'mock';

export interface EmoteSpec {
  id: EmoteId;
  category: EmoteCategory;
  label: string;
  shortLabel: string;
  overheadText: string;
  calloutText: string;
  hotkey: string;
  color: string;
  ringColor: string;
}

export const EMOTE_SPECS: EmoteSpec[] = [
  {
    id: 'rally',
    category: 'signal',
    label: 'Rally Here',
    shortLabel: 'Rally',
    overheadText: 'RALLY!',
    calloutText: 'signals Rally Here',
    hotkey: '1',
    color: '#38bdf8',
    ringColor: '#38bdf8',
  },
  {
    id: 'danger',
    category: 'signal',
    label: 'Danger Close',
    shortLabel: 'Danger',
    overheadText: 'DANGER!',
    calloutText: 'warns Danger Close',
    hotkey: '2',
    color: '#f59e0b',
    ringColor: '#f59e0b',
  },
  {
    id: 'feast',
    category: 'signal',
    label: 'Carcass Feast',
    shortLabel: 'Feast',
    overheadText: 'FEAST!',
    calloutText: 'pings Carcass Feast',
    hotkey: '3',
    color: '#4ade80',
    ringColor: '#4ade80',
  },
  {
    id: 'challenge',
    category: 'taunt',
    label: 'Come Fight',
    shortLabel: 'Fight Me',
    overheadText: 'FIGHT ME!',
    calloutText: 'taunts Come Fight',
    hotkey: '4',
    color: '#f87171',
    ringColor: '#ef4444',
  },
  {
    id: 'mock',
    category: 'taunt',
    label: 'Too Slow!',
    shortLabel: 'Too Slow',
    overheadText: 'TOO SLOW!',
    calloutText: 'taunts Too Slow!',
    hotkey: '5',
    color: '#c084fc',
    ringColor: '#a855f7',
  },
  {
    id: 'respect',
    category: 'signal',
    label: 'Basin Salute',
    shortLabel: 'Salute',
    overheadText: 'SALUTE!',
    calloutText: 'gives Basin Salute',
    hotkey: '6',
    color: '#f3d285',
    ringColor: '#c99c4a',
  },
];

export const VALID_EMOTE_IDS = new Set<EmoteId>(EMOTE_SPECS.map((e) => e.id));

export function getEmoteSpec(id: EmoteId | null | undefined): EmoteSpec | null {
  if (!id) return null;
  return EMOTE_SPECS.find((e) => e.id === id) ?? null;
}

import { AccessibilitySettings, HudVisibilitySettings } from './types';

const SETTINGS_STORAGE_KEY = 'awang_keli_settings_v1';

export const DEFAULT_HUD_VISIBILITY: HudVisibilitySettings = {
  minimap: true,
  evolutionProgress: true,
  statusEffects: true,
  matchTelemetry: true,
  abilityBar: true,
  banners: true,
};

export const MINIMAL_HUD_VISIBILITY: HudVisibilitySettings = {
  minimap: false,
  evolutionProgress: false,
  statusEffects: false,
  matchTelemetry: false,
  abilityBar: true,
  banners: false,
};

export interface HudVisibilityItemMeta {
  key: keyof HudVisibilitySettings;
  label: string;
  description: string;
}

export const HUD_VISIBILITY_ITEMS: HudVisibilityItemMeta[] = [
  {
    key: 'minimap',
    label: 'Mini-Map',
    description: 'Basin radar, safe zone ring, sonar pings & rival bounties',
  },
  {
    key: 'evolutionProgress',
    label: 'Evolution Progress Bar',
    description: 'Fragment gauge (0–100) and next form milestone',
  },
  {
    key: 'statusEffects',
    label: 'Status Effects & Buffs',
    description: 'Floating overhead status icons, active buffs, debuffs & biome hazards',
  },
  {
    key: 'matchTelemetry',
    label: 'Match Telemetry',
    description: 'Remaining Kelis, match clock, zone timer & weather plaque',
  },
  {
    key: 'abilityBar',
    label: 'Ability Bar & Sonar Dish',
    description: 'Bottom-center action hotbar (keyboard hotkeys stay active)',
  },
  {
    key: 'banners',
    label: 'Event Banners & Toasts',
    description: 'Evolution form toasts, match banners & emote signal feed',
  },
];

export const DEFAULT_SETTINGS: AccessibilitySettings = {
  reducedMotion: false,
  visualSoundCues: true,
  hudScale: 'standard',
  hudVisibility: { ...DEFAULT_HUD_VISIBILITY },
  muted: false,
  volume: 0.65,
  musicVolume: 0.35,
  voiceVolume: 0.9,
  voiceMode: 'open',
  evadeKey: 'KeyC',
};

function sanitizeHudVisibility(raw: unknown): HudVisibilitySettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_HUD_VISIBILITY };
  }
  const obj = raw as Partial<Record<keyof HudVisibilitySettings, unknown>>;
  return {
    minimap: typeof obj.minimap === 'boolean' ? obj.minimap : DEFAULT_HUD_VISIBILITY.minimap,
    evolutionProgress:
      typeof obj.evolutionProgress === 'boolean'
        ? obj.evolutionProgress
        : DEFAULT_HUD_VISIBILITY.evolutionProgress,
    statusEffects:
      typeof obj.statusEffects === 'boolean'
        ? obj.statusEffects
        : DEFAULT_HUD_VISIBILITY.statusEffects,
    matchTelemetry:
      typeof obj.matchTelemetry === 'boolean'
        ? obj.matchTelemetry
        : DEFAULT_HUD_VISIBILITY.matchTelemetry,
    abilityBar:
      typeof obj.abilityBar === 'boolean' ? obj.abilityBar : DEFAULT_HUD_VISIBILITY.abilityBar,
    banners: typeof obj.banners === 'boolean' ? obj.banners : DEFAULT_HUD_VISIBILITY.banners,
  };
}

export function loadSavedSettings(): AccessibilitySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        ...DEFAULT_SETTINGS,
        hudVisibility: { ...DEFAULT_HUD_VISIBILITY },
      };
    }
    const parsed = JSON.parse(raw) as Partial<AccessibilitySettings> | null;
    if (!parsed || typeof parsed !== 'object') {
      return {
        ...DEFAULT_SETTINGS,
        hudVisibility: { ...DEFAULT_HUD_VISIBILITY },
      };
    }

    const hudScale =
      parsed.hudScale === 'compact' ||
      parsed.hudScale === 'standard' ||
      parsed.hudScale === 'large'
        ? parsed.hudScale
        : DEFAULT_SETTINGS.hudScale;

    const voiceMode =
      parsed.voiceMode === 'open' || parsed.voiceMode === 'ptt'
        ? parsed.voiceMode
        : DEFAULT_SETTINGS.voiceMode;

    const evadeKey =
      typeof parsed.evadeKey === 'string' && /^(Key[A-Z]|Digit[0-9]|AltLeft|ControlLeft|Key[A-Z])$/.test(parsed.evadeKey)
        ? parsed.evadeKey
        : DEFAULT_SETTINGS.evadeKey;

    const clamp01 = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isFinite(v)
        ? Math.max(0, Math.min(1, v))
        : fallback;

    return {
      reducedMotion:
        typeof parsed.reducedMotion === 'boolean'
          ? parsed.reducedMotion
          : DEFAULT_SETTINGS.reducedMotion,
      visualSoundCues:
        typeof parsed.visualSoundCues === 'boolean'
          ? parsed.visualSoundCues
          : DEFAULT_SETTINGS.visualSoundCues,
      hudScale,
      hudVisibility: sanitizeHudVisibility(parsed.hudVisibility),
      muted:
        typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SETTINGS.muted,
      volume: clamp01(parsed.volume, DEFAULT_SETTINGS.volume),
      musicVolume: clamp01(
        parsed.musicVolume,
        DEFAULT_SETTINGS.musicVolume ?? 0.35
      ),
      voiceVolume: clamp01(parsed.voiceVolume, DEFAULT_SETTINGS.voiceVolume ?? 0.9),
      voiceMode,
      evadeKey,
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      hudVisibility: { ...DEFAULT_HUD_VISIBILITY },
    };
  }
}

export function saveSettings(settings: AccessibilitySettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota or private mode failures
  }
}

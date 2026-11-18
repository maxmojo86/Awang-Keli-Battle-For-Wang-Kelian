import { AccessibilitySettings } from './types';

const SETTINGS_STORAGE_KEY = 'awang_keli_settings_v1';

export const DEFAULT_SETTINGS: AccessibilitySettings = {
  reducedMotion: false,
  visualSoundCues: true,
  hudScale: 'standard',
  muted: false,
  volume: 0.65,
  voiceVolume: 0.9,
  voiceMode: 'open',
};

export function loadSavedSettings(): AccessibilitySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AccessibilitySettings> | null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };

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
      muted:
        typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SETTINGS.muted,
      volume: clamp01(parsed.volume, DEFAULT_SETTINGS.volume),
      voiceVolume: clamp01(parsed.voiceVolume, DEFAULT_SETTINGS.voiceVolume ?? 0.9),
      voiceMode,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AccessibilitySettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota or private mode failures
  }
}

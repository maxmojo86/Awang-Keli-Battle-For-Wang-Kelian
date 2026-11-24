import { getPlatformCapabilities, type PlatformCapabilities } from './platform.ts';
import { DEFAULT_SETTINGS } from './settings.ts';
import type { AccessibilitySettings, AiDifficulty, GraphicsQuality } from './types.ts';
import {
  YOUTUBE_SAFE_SAVE_MAX_BYTES,
  youtubePlayablesBridge,
  type YouTubePlayablesBridge,
} from './youtubePlayables.ts';

export const SAVE_SCHEMA_VERSION = 1;
const LOCAL_SAVE_KEY = 'awang_keli_profile_save_v1';
const MAX_RECENT_MATCHES = 10;

export interface SavedMatchRecord {
  readonly completedAt: number;
  readonly score: number;
  readonly finalLevel: number;
  readonly kills: number;
  readonly survivalSec: number;
  readonly lobbySize: number;
  readonly victory: boolean;
}

export interface PersistedSettingsSlice {
  reducedMotion: boolean;
  visualSoundCues: boolean;
  hudScale: 'compact' | 'standard' | 'large';
  graphicsQuality: GraphicsQuality;
  aiDifficulty: AiDifficulty;
  muted: boolean;
  volume: number;
  musicVolume: number;
}

export interface CloudSavePayloadV1 {
  schemaVersion: 1;
  updatedAt: number;
  settings: PersistedSettingsSlice;
  bestScore: number;
  bestSurvivalSec: number;
  matchesCompleted: number;
  keliKingVictories: number;
  epilogueUnlocked: boolean;
  achievements: string[];
  recentMatches: SavedMatchRecord[];
}

export function createDefaultSavePayload(): CloudSavePayloadV1 {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    updatedAt: 0,
    settings: {
      reducedMotion: DEFAULT_SETTINGS.reducedMotion,
      visualSoundCues: DEFAULT_SETTINGS.visualSoundCues,
      hudScale: DEFAULT_SETTINGS.hudScale,
      graphicsQuality: DEFAULT_SETTINGS.graphicsQuality ?? 'auto',
      aiDifficulty: DEFAULT_SETTINGS.aiDifficulty ?? 'normal',
      muted: DEFAULT_SETTINGS.muted,
      volume: DEFAULT_SETTINGS.volume,
      musicVolume: DEFAULT_SETTINGS.musicVolume ?? 0.35,
    },
    bestScore: 0,
    bestSurvivalSec: 0,
    matchesCompleted: 0,
    keliKingVictories: 0,
    epilogueUnlocked: false,
    achievements: [],
    recentMatches: [],
  };
}

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Validates and migrates raw serialized cloud/local save data into a clean schema v1 payload.
 * Rejects malformed inputs safely without throwing or corrupting active state.
 */
export function parseAndValidateSaveData(raw: string): CloudSavePayloadV1 {
  const defaults = createDefaultSavePayload();
  if (!raw || typeof raw !== 'string') return defaults;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }

  if (!parsed || typeof parsed !== 'object') return defaults;
  const obj = parsed as Partial<CloudSavePayloadV1>;
  const rawSettings = (obj.settings && typeof obj.settings === 'object'
    ? obj.settings
    : {}) as Partial<PersistedSettingsSlice>;

  const hudScale =
    rawSettings.hudScale === 'compact' ||
    rawSettings.hudScale === 'standard' ||
    rawSettings.hudScale === 'large'
      ? rawSettings.hudScale
      : defaults.settings.hudScale;

  const graphicsQuality: GraphicsQuality =
    rawSettings.graphicsQuality === 'auto' ||
    rawSettings.graphicsQuality === 'low' ||
    rawSettings.graphicsQuality === 'medium' ||
    rawSettings.graphicsQuality === 'high'
      ? rawSettings.graphicsQuality
      : defaults.settings.graphicsQuality;

  const aiDifficulty: AiDifficulty =
    rawSettings.aiDifficulty === 'easy' ||
    rawSettings.aiDifficulty === 'normal' ||
    rawSettings.aiDifficulty === 'hard'
      ? rawSettings.aiDifficulty
      : defaults.settings.aiDifficulty;

  const achievements = Array.isArray(obj.achievements)
    ? Array.from(
        new Set(
          obj.achievements
            .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 48)
            .slice(0, 32)
        )
      )
    : [];

  const recentMatches: SavedMatchRecord[] = Array.isArray(obj.recentMatches)
    ? obj.recentMatches
        .filter((m): m is SavedMatchRecord => Boolean(m && typeof m === 'object'))
        .slice(0, MAX_RECENT_MATCHES)
        .map((m) => ({
          completedAt: clampInt(m.completedAt, 0, Number.MAX_SAFE_INTEGER, 0),
          score: clampInt(m.score, 0, 10_000_000, 0),
          finalLevel: clampInt(m.finalLevel, 1, 100, 1),
          kills: clampInt(m.kills, 0, 200, 0),
          survivalSec: clampInt(m.survivalSec, 0, 86_400, 0),
          lobbySize: clampInt(m.lobbySize, 5, 100, 20),
          victory: Boolean(m.victory),
        }))
    : [];

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    updatedAt: clampInt(obj.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    settings: {
      reducedMotion:
        typeof rawSettings.reducedMotion === 'boolean'
          ? rawSettings.reducedMotion
          : defaults.settings.reducedMotion,
      visualSoundCues:
        typeof rawSettings.visualSoundCues === 'boolean'
          ? rawSettings.visualSoundCues
          : defaults.settings.visualSoundCues,
      hudScale,
      graphicsQuality,
      aiDifficulty,
      muted:
        typeof rawSettings.muted === 'boolean'
          ? rawSettings.muted
          : defaults.settings.muted,
      volume: clamp01(rawSettings.volume, defaults.settings.volume),
      musicVolume: clamp01(rawSettings.musicVolume, defaults.settings.musicVolume),
    },
    bestScore: clampInt(obj.bestScore, 0, 10_000_000, 0),
    bestSurvivalSec: clampInt(obj.bestSurvivalSec, 0, 86_400, 0),
    matchesCompleted: clampInt(obj.matchesCompleted, 0, 1_000_000, 0),
    keliKingVictories: clampInt(obj.keliKingVictories, 0, 1_000_000, 0),
    epilogueUnlocked: Boolean(obj.epilogueUnlocked),
    achievements,
    recentMatches,
  };
}

export function serializeSaveData(payload: CloudSavePayloadV1): string {
  const clean = parseAndValidateSaveData(JSON.stringify(payload));
  const encoded = JSON.stringify(clean);
  if (new TextEncoder().encode(encoded).byteLength <= YOUTUBE_SAFE_SAVE_MAX_BYTES) {
    return encoded;
  }
  // Trim recent matches if somehow oversized
  clean.recentMatches = clean.recentMatches.slice(0, 3);
  return JSON.stringify(clean);
}

/**
 * Atomic, load-before-save persistence manager supporting both YouTube Playables cloud storage
 * (`ytgame.game.loadData` / `saveData`) and standalone/Android local storage.
 */
export class PersistentSaveManager {
  private readonly capabilitiesProvider: () => PlatformCapabilities;
  private readonly ytBridge: YouTubePlayablesBridge;
  private loaded = false;
  private current: CloudSavePayloadV1 = createDefaultSavePayload();
  private pendingWrite: Promise<boolean> = Promise.resolve(true);

  constructor(
    capabilitiesProvider: () => PlatformCapabilities = getPlatformCapabilities,
    ytBridge: YouTubePlayablesBridge = youtubePlayablesBridge
  ) {
    this.capabilitiesProvider = capabilitiesProvider;
    this.ytBridge = ytBridge;
  }

  public isLoaded(): boolean {
    return this.loaded;
  }

  public getCurrent(): CloudSavePayloadV1 {
    return this.current;
  }

  public async load(): Promise<CloudSavePayloadV1> {
    const caps = this.capabilitiesProvider();
    if (caps.cloudSaveEnabled && caps.youtubeSdkEnabled) {
      const res = await this.ytBridge.loadCloudData();
      this.current = parseAndValidateSaveData(res.data);
      this.loaded = true;
      return this.current;
    }

    if (caps.localStorageAllowed && typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(LOCAL_SAVE_KEY) ?? '';
        this.current = parseAndValidateSaveData(raw);
      } catch {
        this.current = createDefaultSavePayload();
      }
    }
    this.loaded = true;
    return this.current;
  }

  public async savePatch(
    updater: (prev: CloudSavePayloadV1) => CloudSavePayloadV1
  ): Promise<boolean> {
    if (!this.loaded) {
      await this.load();
    }
    const next = parseAndValidateSaveData(
      JSON.stringify({
        ...updater(this.current),
        schemaVersion: SAVE_SCHEMA_VERSION,
        updatedAt: Date.now(),
      })
    );
    this.current = next;
    const serialized = serializeSaveData(next);

    // Queue writes sequentially so pause/eviction cannot interleave or corrupt state
    this.pendingWrite = this.pendingWrite.then(async () => {
      const caps = this.capabilitiesProvider();
      if (caps.cloudSaveEnabled && caps.youtubeSdkEnabled) {
        const res = await this.ytBridge.saveCloudData(serialized);
        return res.ok;
      }
      if (caps.localStorageAllowed && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(LOCAL_SAVE_KEY, serialized);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    });
    return this.pendingWrite;
  }

  public extractSettingsPatch(): Partial<AccessibilitySettings> {
    const s = this.current.settings;
    return {
      reducedMotion: s.reducedMotion,
      visualSoundCues: s.visualSoundCues,
      hudScale: s.hudScale,
      graphicsQuality: s.graphicsQuality,
      aiDifficulty: s.aiDifficulty,
      muted: s.muted,
      volume: s.volume,
      musicVolume: s.musicVolume,
    };
  }
}

export const persistentSaveManager = new PersistentSaveManager();

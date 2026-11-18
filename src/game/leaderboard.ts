import { HudSnapshot, LobbySize, MatchMode } from './types';

export const SURVIVAL_LEADERBOARD_STORAGE_KEY = 'awang_keli_top_survival_times';
export const PLAYER_NAME_STORAGE_KEY = 'awang_keli_player_name';
export const MAX_LEADERBOARD_ENTRIES = 10;
export const DEFAULT_PLAYER_NAME = 'Awang Keli';

export type LeaderboardSortOrder = 'longest' | 'fastest';

export interface SurvivalLeaderboardEntry {
  id: string;
  playerName: string;
  survivalTime: number;
  kills: number;
  lobbySize: LobbySize;
  mode: MatchMode;
  achievedAt: string;
}

const VALID_LOBBY_SIZES = new Set<number>([5, 10, 20, 25, 50, 100]);

function getSafeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function sanitizePlayerName(raw: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return DEFAULT_PLAYER_NAME;
  return trimmed.slice(0, 18);
}

export function getSavedPlayerName(): string {
  const storage = getSafeStorage();
  if (!storage) return DEFAULT_PLAYER_NAME;
  try {
    const saved = storage.getItem(PLAYER_NAME_STORAGE_KEY);
    return saved ? sanitizePlayerName(saved) : DEFAULT_PLAYER_NAME;
  } catch {
    return DEFAULT_PLAYER_NAME;
  }
}

export function savePlayerName(name: string): string {
  const sanitized = sanitizePlayerName(name);
  const storage = getSafeStorage();
  if (storage) {
    try {
      storage.setItem(PLAYER_NAME_STORAGE_KEY, sanitized);
    } catch {
      // Ignore storage quota or privacy mode errors
    }
  }
  return sanitized;
}

function isValidEntry(value: unknown): value is SurvivalLeaderboardEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.playerName === 'string' &&
    typeof v.survivalTime === 'number' &&
    Number.isFinite(v.survivalTime) &&
    v.survivalTime >= 0 &&
    typeof v.kills === 'number' &&
    Number.isFinite(v.kills) &&
    v.kills >= 0 &&
    typeof v.lobbySize === 'number' &&
    VALID_LOBBY_SIZES.has(v.lobbySize) &&
    (v.mode === 'royale' || v.mode === 'tutorial') &&
    typeof v.achievedAt === 'string'
  );
}

export function sortSurvivalEntries(
  entries: SurvivalLeaderboardEntry[],
  order: LeaderboardSortOrder = 'longest'
): SurvivalLeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    const timeDiff =
      order === 'fastest'
        ? a.survivalTime - b.survivalTime
        : b.survivalTime - a.survivalTime;
    if (Math.abs(timeDiff) > 0.001) return timeDiff;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime();
  });
}

export function getTopSurvivalTimes(): SurvivalLeaderboardEntry[] {
  const storage = getSafeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(SURVIVAL_LEADERBOARD_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidEntry);
    return sortSurvivalEntries(valid, 'longest').slice(0, MAX_LEADERBOARD_ENTRIES);
  } catch {
    return [];
  }
}

export function recordKeliKingSurvivalTime(
  snap: HudSnapshot,
  explicitPlayerName?: string
): { entries: SurvivalLeaderboardEntry[]; savedEntry: SurvivalLeaderboardEntry | null; rank: number | null } {
  const existing = getTopSurvivalTimes();

  // Only players who reached Keli King status (Lv.100 victory) qualify
  if (snap.matchResult.status !== 'victory' || snap.matchResult.finalLevel < 100) {
    return { entries: existing, savedEntry: null, rank: null };
  }

  const survivalTime = Math.max(0, Number(snap.matchResult.survivalTime.toFixed(2)));
  const entry: SurvivalLeaderboardEntry = {
    id: `keli-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    playerName: sanitizePlayerName(explicitPlayerName ?? snap.player.name),
    survivalTime,
    kills: Math.max(0, Math.floor(snap.matchResult.kills)),
    lobbySize: snap.lobbySize,
    mode: snap.mode,
    achievedAt: new Date().toISOString(),
  };

  const nextTop = sortSurvivalEntries([...existing, entry], 'longest').slice(
    0,
    MAX_LEADERBOARD_ENTRIES
  );

  const storage = getSafeStorage();
  if (storage) {
    try {
      storage.setItem(SURVIVAL_LEADERBOARD_STORAGE_KEY, JSON.stringify(nextTop));
    } catch {
      // Ignore storage quota or privacy mode errors
    }
  }

  const idx = nextTop.findIndex((item) => item.id === entry.id);
  return {
    entries: nextTop,
    savedEntry: idx >= 0 ? entry : null,
    rank: idx >= 0 ? idx + 1 : null,
  };
}

export function clearTopSurvivalTimes(): SurvivalLeaderboardEntry[] {
  const storage = getSafeStorage();
  if (storage) {
    try {
      storage.removeItem(SURVIVAL_LEADERBOARD_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  return [];
}

export function formatSurvivalDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

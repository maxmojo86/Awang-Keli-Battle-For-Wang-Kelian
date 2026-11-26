import {
  detectDefaultRegion,
  RegionCode,
  RegionFilter,
  VALID_REGION_CODES,
} from '../data/regions';
import { HudSnapshot, LobbySize, MatchMode } from './types';
import { buildApiUrl } from './backendConfig';
import { getPlatformCapabilities } from './platform';

export const SURVIVAL_LEADERBOARD_STORAGE_KEY = 'awang_keli_top_survival_times';
export const PLAYER_NAME_STORAGE_KEY = 'awang_keli_player_name';
export const PLAYER_REGION_STORAGE_KEY = 'awang_keli_player_region';
export const MAX_LEADERBOARD_ENTRIES = 10;
export const DEFAULT_PLAYER_NAME = 'Awang Keli';

export type LeaderboardSortOrder = 'longest' | 'fastest';
export type GlobalLeaderboardSort = 'longest' | 'fastest_king' | 'kills';

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
    if (!getPlatformCapabilities().localStorageAllowed) return null;
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

export function getSavedPlayerRegion(): RegionCode {
  const storage = getSafeStorage();
  if (!storage) return detectDefaultRegion();
  try {
    const saved = storage.getItem(PLAYER_REGION_STORAGE_KEY);
    if (saved && VALID_REGION_CODES.has(saved as RegionCode)) {
      return saved as RegionCode;
    }
  } catch {
    // Ignore storage errors
  }
  return detectDefaultRegion();
}

export function savePlayerRegion(region: RegionCode): RegionCode {
  const valid: RegionCode = VALID_REGION_CODES.has(region) ? region : detectDefaultRegion();
  const storage = getSafeStorage();
  if (storage) {
    try {
      storage.setItem(PLAYER_REGION_STORAGE_KEY, valid);
    } catch {
      // Ignore storage errors
    }
  }
  return valid;
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

export interface GlobalLeaderboardEntry {
  id: string;
  submissionId: string;
  playerName: string;
  region: RegionCode;
  survivalTime: number;
  finalLevel: number;
  kills: number;
  victory: boolean;
  lobbySize: LobbySize;
  mode: 'royale' | 'multiplayer';
  achievedAt: string;
  globalRank: number;
  regionalRank: number;
}

export interface RegionLeaderboardSummary {
  region: RegionCode;
  name: string;
  count: number;
  kingCount: number;
  topSurvivalTime: number | null;
  topPlayerName: string | null;
}

export interface GlobalLeaderboardResponse {
  entries: GlobalLeaderboardEntry[];
  regionSummary: RegionLeaderboardSummary[];
  totalGlobal: number;
  totalMatching: number;
  updatedAt: string;
}

export interface GlobalSubmissionResult {
  entry: GlobalLeaderboardEntry;
  globalRank: number | null;
  regionalRank: number | null;
  totalGlobal: number;
  totalRegional: number;
}

export type LeaderboardSaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'failed'
  | 'unavailable'
  | 'ineligible';

export interface LeaderboardSaveState {
  status: LeaderboardSaveStatus;
  globalRank: number | null;
  regionalRank: number | null;
  region: RegionCode | null;
  message?: string | null;
  retryable?: boolean;
}

export type GlobalSubmissionOutcome =
  | { ok: true; result: GlobalSubmissionResult }
  | {
      ok: false;
      status: 'failed' | 'unavailable' | 'ineligible';
      error: string;
      retryable: boolean;
    };

export class LeaderboardUnavailableError extends Error {
  constructor(message = 'Global leaderboard backend is not configured for this build.') {
    super(message);
    this.name = 'LeaderboardUnavailableError';
  }
}

async function tryParseErrorBody(
  res: Response
): Promise<{ error?: string; code?: string } | null> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    const parsed = (await res.json()) as { error?: unknown; code?: unknown };
    return {
      error: typeof parsed?.error === 'string' ? parsed.error : undefined,
      code: typeof parsed?.code === 'string' ? parsed.code : undefined,
    };
  } catch {
    return null;
  }
}

export async function fetchGlobalLeaderboard(
  region: RegionFilter = 'ALL',
  sort: GlobalLeaderboardSort = 'longest',
  limit = 100
): Promise<GlobalLeaderboardResponse> {
  const endpoint = buildApiUrl('/api/leaderboard');
  if (!endpoint) {
    throw new LeaderboardUnavailableError();
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Device is offline. Connect to load Global Rankings — Local Top 10 remains available.');
  }

  const params = new URLSearchParams({
    region,
    sort,
    limit: String(Math.max(1, Math.min(100, limit))),
  });

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    controller && typeof window !== 'undefined'
      ? window.setTimeout(() => controller.abort(), 8000)
      : null;

  try {
    const res = await fetch(`${endpoint}?${params.toString()}`, {
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (!res.ok) {
      const body = await tryParseErrorBody(res);
      if (res.status === 503 || body?.code === 'LEADERBOARD_DB_UNAVAILABLE') {
        throw new LeaderboardUnavailableError(
          body?.error || 'Global rankings database is currently unavailable.'
        );
      }
      throw new Error(body?.error || `Leaderboard service responded with HTTP ${res.status}.`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Leaderboard service returned an unexpected response format.');
    }
    const payload = (await res.json()) as Partial<GlobalLeaderboardResponse>;
    if (!payload || !Array.isArray(payload.entries) || !Array.isArray(payload.regionSummary)) {
      throw new Error('Leaderboard response was incomplete.');
    }
    return payload as GlobalLeaderboardResponse;
  } catch (err) {
    if (err instanceof LeaderboardUnavailableError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Global rankings request timed out. Local records remain available.');
    }
    if (err instanceof TypeError) {
      throw new Error('Unable to reach the Global Rankings server. Check your internet connection — Local Top 10 remains available.');
    }
    if (err instanceof Error && err.message) {
      throw err;
    }
    throw new Error('Unable to reach global rankings service. Local records remain available.');
  } finally {
    if (timeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutId);
    }
  }
}

/**
 * Submits a Solo Royale run to the global leaderboard.
 * Multiplayer results are NEVER submitted by the browser — they are recorded authoritatively by the server.
 */
export async function submitGlobalSurvivalTime(
  snap: HudSnapshot,
  playerName: string,
  region: RegionCode,
  submissionId: string
): Promise<GlobalSubmissionOutcome> {
  if (snap.mode === 'tutorial') {
    return {
      ok: false,
      status: 'ineligible',
      error: 'Guide mode matches are not ranked on the global leaderboard.',
      retryable: false,
    };
  }
  const endpoint = buildApiUrl('/api/leaderboard');
  if (!endpoint) {
    return {
      ok: false,
      status: 'unavailable',
      error: 'Global leaderboard service is not configured for this build.',
      retryable: false,
    };
  }

  const survivalTime = Math.max(0, Number(snap.matchResult.survivalTime.toFixed(2)));
  if (survivalTime < 1) {
    return {
      ok: false,
      status: 'ineligible',
      error: 'Survive at least 1 second to qualify for global rankings.',
      retryable: false,
    };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      ok: false,
      status: 'failed',
      error: 'Device is offline. Ranking was not saved to Global Rankings.',
      retryable: true,
    };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    controller && typeof window !== 'undefined'
      ? window.setTimeout(() => controller.abort(), 8000)
      : null;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      signal: controller?.signal,
      body: JSON.stringify({
        submissionId,
        playerName: sanitizePlayerName(playerName || snap.player.name),
        region,
        survivalTime,
        finalLevel: Math.max(1, Math.min(100, Math.round(snap.matchResult.finalLevel))),
        kills: Math.max(0, Math.floor(snap.matchResult.kills)),
        victory: snap.matchResult.status === 'victory',
        lobbySize: snap.lobbySize,
        mode: 'royale',
      }),
    });
    if (!res.ok) {
      const body = await tryParseErrorBody(res);
      if (res.status === 503 || body?.code === 'LEADERBOARD_DB_UNAVAILABLE') {
        return {
          ok: false,
          status: 'unavailable',
          error: body?.error || 'Global rankings database is currently unavailable.',
          retryable: true,
        };
      }
      return {
        ok: false,
        status: 'failed',
        error: body?.error || `Failed to save ranking (HTTP ${res.status}).`,
        retryable: res.status >= 500 || res.status === 429,
      };
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        status: 'failed',
        error: 'Leaderboard server returned an invalid confirmation response.',
        retryable: true,
      };
    }
    const result = (await res.json()) as GlobalSubmissionResult;
    if (!result || !result.entry) {
      return {
        ok: false,
        status: 'failed',
        error: 'Leaderboard server confirmation was incomplete.',
        retryable: true,
      };
    }
    return { ok: true, result };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        status: 'failed',
        error: 'Ranking save request timed out. Tap Retry to try again.',
        retryable: true,
      };
    }
    return {
      ok: false,
      status: 'failed',
      error: 'Unable to reach Global Rankings to save your run. Tap Retry to try again.',
      retryable: true,
    };
  } finally {
    if (timeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutId);
    }
  }
}

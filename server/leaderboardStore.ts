import fs from 'fs';
import path from 'path';
import { REGIONS, RegionCode, RegionFilter, VALID_REGION_CODES } from '../src/data/regions';
import { LobbySize } from '../src/game/types';

export type GlobalLeaderboardSort = 'longest' | 'fastest_king' | 'kills';

export interface StoredLeaderboardRecord {
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
}

export interface RankedLeaderboardEntry extends StoredLeaderboardRecord {
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

export interface LeaderboardQueryResult {
  entries: RankedLeaderboardEntry[];
  regionSummary: RegionLeaderboardSummary[];
  totalGlobal: number;
  totalMatching: number;
  updatedAt: string;
}

export interface LeaderboardSubmissionInput {
  submissionId?: unknown;
  playerName?: unknown;
  region?: unknown;
  survivalTime?: unknown;
  finalLevel?: unknown;
  kills?: unknown;
  victory?: unknown;
  lobbySize?: unknown;
  mode?: unknown;
}

export interface LeaderboardSubmissionResult {
  entry: RankedLeaderboardEntry;
  globalRank: number | null;
  regionalRank: number | null;
  totalGlobal: number;
  totalRegional: number;
}

const VALID_LOBBY_SIZES = new Set<number>([5, 10, 20, 25, 50, 100]);
const MAX_PER_BUCKET = 100;

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Awang Keli';
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 18);
  return cleaned || 'Awang Keli';
}

function compareByLongest(a: StoredLeaderboardRecord, b: StoredLeaderboardRecord): number {
  const timeDiff = b.survivalTime - a.survivalTime;
  if (Math.abs(timeDiff) > 0.001) return timeDiff;
  if (a.victory !== b.victory) return a.victory ? -1 : 1;
  if (b.finalLevel !== a.finalLevel) return b.finalLevel - a.finalLevel;
  if (b.kills !== a.kills) return b.kills - a.kills;
  return new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime();
}

function compareBySort(
  a: StoredLeaderboardRecord,
  b: StoredLeaderboardRecord,
  sort: GlobalLeaderboardSort
): number {
  if (sort === 'fastest_king') {
    const timeDiff = a.survivalTime - b.survivalTime;
    if (Math.abs(timeDiff) > 0.001) return timeDiff;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime();
  }
  if (sort === 'kills') {
    if (b.kills !== a.kills) return b.kills - a.kills;
    return compareByLongest(a, b);
  }
  return compareByLongest(a, b);
}

function isValidRecord(raw: unknown): raw is StoredLeaderboardRecord {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.submissionId === 'string' &&
    typeof r.playerName === 'string' &&
    typeof r.region === 'string' &&
    VALID_REGION_CODES.has(r.region as RegionCode) &&
    typeof r.survivalTime === 'number' &&
    Number.isFinite(r.survivalTime) &&
    r.survivalTime >= 0 &&
    typeof r.finalLevel === 'number' &&
    Number.isFinite(r.finalLevel) &&
    typeof r.kills === 'number' &&
    Number.isFinite(r.kills) &&
    typeof r.victory === 'boolean' &&
    typeof r.lobbySize === 'number' &&
    VALID_LOBBY_SIZES.has(r.lobbySize) &&
    (r.mode === 'royale' || r.mode === 'multiplayer') &&
    typeof r.achievedAt === 'string'
  );
}

export class GlobalLeaderboardStore {
  private filePath: string;
  private records: StoredLeaderboardRecord[] = [];
  private updatedAt: string = new Date().toISOString();

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? path.resolve(process.cwd(), '.data', 'global-leaderboard.json');
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.records = [];
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.records = this.retainPool(parsed.filter(isValidRecord));
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as { records?: unknown; updatedAt?: unknown };
        if (Array.isArray(obj.records)) {
          this.records = this.retainPool(obj.records.filter(isValidRecord));
        }
        if (typeof obj.updatedAt === 'string') {
          this.updatedAt = obj.updatedAt;
        }
      }
    } catch {
      this.records = [];
    }
  }

  private saveToDisk() {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(
        tmpPath,
        JSON.stringify({ updatedAt: this.updatedAt, records: this.records }, null, 2),
        'utf-8'
      );
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('Failed to persist global leaderboard:', err);
    }
  }

  private retainPool(list: StoredLeaderboardRecord[]): StoredLeaderboardRecord[] {
    const dedup = new Map<string, StoredLeaderboardRecord>();
    for (const item of list) {
      dedup.set(item.submissionId || item.id, item);
    }
    const all = Array.from(dedup.values()).sort(compareByLongest);
    const keep = new Map<string, StoredLeaderboardRecord>();

    // Retain top 100 globally (longest)
    for (const r of all.slice(0, MAX_PER_BUCKET)) {
      keep.set(r.id, r);
    }

    // Retain top 100 per region so every region has a full competitive top-100 board
    for (const reg of REGIONS) {
      const regional = all.filter((r) => r.region === reg.code).slice(0, MAX_PER_BUCKET);
      for (const r of regional) {
        keep.set(r.id, r);
      }
    }

    // Also retain top 100 fastest Keli King speedruns
    const kings = all
      .filter((r) => r.victory && r.finalLevel >= 100)
      .sort((a, b) => compareBySort(a, b, 'fastest_king'))
      .slice(0, MAX_PER_BUCKET);
    for (const r of kings) {
      keep.set(r.id, r);
    }

    return Array.from(keep.values()).sort(compareByLongest);
  }

  private buildRankedList(sort: GlobalLeaderboardSort): RankedLeaderboardEntry[] {
    const base =
      sort === 'fastest_king'
        ? this.records.filter((r) => r.victory && r.finalLevel >= 100)
        : [...this.records];

    base.sort((a, b) => compareBySort(a, b, sort));

    const regionCounters = new Map<RegionCode, number>();
    return base.map((rec, idx) => {
      const prevRegRank = regionCounters.get(rec.region) ?? 0;
      const nextRegRank = prevRegRank + 1;
      regionCounters.set(rec.region, nextRegRank);
      return {
        ...rec,
        globalRank: idx + 1,
        regionalRank: nextRegRank,
      };
    });
  }

  public getRegionSummary(): RegionLeaderboardSummary[] {
    const byLongest = [...this.records].sort(compareByLongest);
    return REGIONS.map((reg) => {
      const regRecords = byLongest.filter((r) => r.region === reg.code);
      const top = regRecords[0] ?? null;
      return {
        region: reg.code,
        name: reg.name,
        count: regRecords.length,
        kingCount: regRecords.filter((r) => r.victory && r.finalLevel >= 100).length,
        topSurvivalTime: top ? top.survivalTime : null,
        topPlayerName: top ? top.playerName : null,
      };
    });
  }

  public query(
    region: RegionFilter = 'ALL',
    sort: GlobalLeaderboardSort = 'longest',
    limit = 100
  ): LeaderboardQueryResult {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit) || 100));
    const rankedAll = this.buildRankedList(sort);
    const filtered =
      region === 'ALL'
        ? rankedAll
        : rankedAll.filter((entry) => entry.region === region);

    return {
      entries: filtered.slice(0, safeLimit),
      regionSummary: this.getRegionSummary(),
      totalGlobal: rankedAll.length,
      totalMatching: filtered.length,
      updatedAt: this.updatedAt,
    };
  }

  public submit(
    input: LeaderboardSubmissionInput
  ): { ok: true; result: LeaderboardSubmissionResult } | { ok: false; error: string } {
    if (input.mode !== 'royale' && input.mode !== 'multiplayer') {
      return { ok: false, error: 'Only ranked Royale or Multiplayer runs qualify.' };
    }
    const region = typeof input.region === 'string' ? input.region.toUpperCase() : '';
    if (!VALID_REGION_CODES.has(region as RegionCode)) {
      return { ok: false, error: 'Invalid competitive region code.' };
    }

    const rawTime = Number(input.survivalTime);
    if (!Number.isFinite(rawTime) || rawTime < 1 || rawTime > 7200) {
      return { ok: false, error: 'Survival time must be between 1s and 7200s.' };
    }
    const survivalTime = Math.round(rawTime * 100) / 100;

    const rawLevel = Number(input.finalLevel);
    const finalLevel = Number.isFinite(rawLevel)
      ? Math.max(1, Math.min(100, Math.round(rawLevel)))
      : 1;

    const rawKills = Number(input.kills);
    const kills = Number.isFinite(rawKills)
      ? Math.max(0, Math.min(99, Math.floor(rawKills)))
      : 0;

    const rawLobby = Number(input.lobbySize);
    const lobbySize: LobbySize = VALID_LOBBY_SIZES.has(rawLobby)
      ? (rawLobby as LobbySize)
      : 20;

    const victory = Boolean(input.victory);
    const playerName = sanitizeName(input.playerName);
    const submissionId =
      typeof input.submissionId === 'string' && input.submissionId.trim()
        ? input.submissionId.trim().slice(0, 64)
        : `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    // Deduplicate idempotent retries
    const existing = this.records.find((r) => r.submissionId === submissionId);
    if (existing) {
      const ranked = this.buildRankedList('longest');
      const found = ranked.find((r) => r.id === existing.id);
      const totalRegional = ranked.filter((r) => r.region === existing.region).length;
      return {
        ok: true,
        result: {
          entry: found ?? { ...existing, globalRank: 1, regionalRank: 1 },
          globalRank: found ? found.globalRank : null,
          regionalRank: found ? found.regionalRank : null,
          totalGlobal: ranked.length,
          totalRegional,
        },
      };
    }

    const record: StoredLeaderboardRecord = {
      id: `glb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      submissionId,
      playerName,
      region: region as RegionCode,
      survivalTime,
      finalLevel,
      kills,
      victory,
      lobbySize,
      mode: input.mode,
      achievedAt: new Date().toISOString(),
    };

    this.updatedAt = record.achievedAt;
    this.records = this.retainPool([...this.records, record]);
    this.saveToDisk();

    const ranked = this.buildRankedList('longest');
    const rankedEntry = ranked.find((r) => r.id === record.id);
    const totalRegional = ranked.filter((r) => r.region === record.region).length;

    return {
      ok: true,
      result: {
        entry: rankedEntry ?? { ...record, globalRank: ranked.length + 1, regionalRank: totalRegional + 1 },
        globalRank: rankedEntry && rankedEntry.globalRank <= 100 ? rankedEntry.globalRank : rankedEntry?.globalRank ?? null,
        regionalRank: rankedEntry ? rankedEntry.regionalRank : null,
        totalGlobal: ranked.length,
        totalRegional,
      },
    };
  }
}

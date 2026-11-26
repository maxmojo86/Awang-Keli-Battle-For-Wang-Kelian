import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { REGIONS, type RegionCode, type RegionFilter, VALID_REGION_CODES } from '../src/data/regions.ts';
import type { LobbySize } from '../src/game/types.ts';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type GlobalLeaderboardSort = 'longest' | 'fastest_king' | 'kills';

export interface StoredLeaderboardRecord {
  id: string;
  resultKey: string;
  submissionId: string;
  matchId: string | null;
  playerId: string | null;
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

export interface AuthoritativeMultiplayerResultInput {
  matchId: string;
  playerId: string;
  playerName: string;
  region: RegionCode;
  survivalTime: number;
  finalLevel: number;
  kills: number;
  victory: boolean;
  lobbySize: number;
  achievedAt?: string;
}

export interface LeaderboardSubmissionResult {
  entry: RankedLeaderboardEntry;
  globalRank: number | null;
  regionalRank: number | null;
  totalGlobal: number;
  totalRegional: number;
}

export type LeaderboardWriteErrorCode =
  | 'VALIDATION_ERROR'
  | 'MULTIPLAYER_CLIENT_REJECTED'
  | 'INELIGIBLE_RUN'
  | 'DB_UNAVAILABLE'
  | 'DB_WRITE_FAILED';

export type LeaderboardWriteOutcome =
  | {
      ok: true;
      result: LeaderboardSubmissionResult;
      deduplicated: boolean;
    }
  | {
      ok: false;
      code: LeaderboardWriteErrorCode;
      error: string;
      retryable: boolean;
    };

export interface LegacyImportSummary {
  totalRead: number;
  imported: number;
  skippedDuplicates: number;
  invalid: number;
}

export interface SqlQueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface SqlQueryExecutor {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<SqlQueryResult<T>>;
  close?: () => Promise<void>;
}

export class LeaderboardStorageUnavailableError extends Error {
  public readonly code = 'LEADERBOARD_DB_UNAVAILABLE';
  constructor(message = 'Durable leaderboard database is currently unavailable.') {
    super(message);
    this.name = 'LeaderboardStorageUnavailableError';
  }
}

export interface LeaderboardStore {
  readonly storageKind: 'postgres' | 'dev_json' | 'unavailable';
  init: () => Promise<void>;
  isAvailable: () => Promise<boolean>;
  query: (
    region?: RegionFilter,
    sort?: GlobalLeaderboardSort,
    limit?: number
  ) => Promise<LeaderboardQueryResult>;
  submitSolo: (input: LeaderboardSubmissionInput) => Promise<LeaderboardWriteOutcome>;
  recordMultiplayerResult: (
    input: AuthoritativeMultiplayerResultInput
  ) => Promise<LeaderboardWriteOutcome>;
  importLegacyRecords: (rawRecords: unknown[]) => Promise<LegacyImportSummary>;
  close: () => Promise<void>;
}

const VALID_SOLO_LOBBY_SIZES = new Set<number>([5, 10, 20, 25, 50, 100]);

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Awang Keli';
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 18);
  return cleaned || 'Awang Keli';
}

function sanitizeLobbySize(raw: unknown, allowTwoPlayerHuman = false): LobbySize {
  const n = Number(raw);
  if (Number.isFinite(n)) {
    const rounded = Math.round(n);
    if (VALID_SOLO_LOBBY_SIZES.has(rounded)) return rounded as LobbySize;
    if (allowTwoPlayerHuman && rounded >= 2 && rounded <= 100) {
      return rounded as LobbySize;
    }
  }
  return 20;
}

function sanitizeErrorReason(err: unknown): string {
  if (!err || typeof err !== 'object') return 'unknown_error';
  const e = err as { code?: unknown; name?: unknown; message?: unknown };
  const pgCode = typeof e.code === 'string' ? e.code : '';
  const name = typeof e.name === 'string' ? e.name : 'Error';
  // Strip any accidental connection URI fragments before logging
  const rawMsg = typeof e.message === 'string' ? e.message : '';
  const safeMsg = rawMsg
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DB_URL]')
    .replace(/password=[^\s&;]+/gi, 'password=[REDACTED]')
    .slice(0, 140);
  return [pgCode || name, safeMsg].filter(Boolean).join(': ');
}

function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return true;
  const code = String((err as { code?: unknown }).code ?? '');
  // PostgreSQL data/constraint/syntax errors (22xxx, 23xxx, 42xxx) are non-retryable
  if (/^(22|23|42)/.test(code)) return false;
  return true;
}

async function withBoundedRetry<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number; onRetry?: (attempt: number, err: unknown) => void } = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(10, options.baseDelayMs ?? 120);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isTransientDbError(err)) {
        throw err;
      }
      options.onRetry?.(attempt, err);
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

export function buildMultiplayerResultKey(matchId: string, playerId: string): string {
  return `mp:${matchId.trim()}:${playerId.trim()}`;
}

export function buildSoloResultKey(submissionId: string): string {
  return `solo:${submissionId.trim()}`;
}

export function buildLegacyResultKey(submissionIdOrId: string): string {
  return `legacy:${submissionIdOrId.trim()}`;
}

function getOrderClause(sort: GlobalLeaderboardSort): string {
  switch (sort) {
    case 'fastest_king':
      return 'survival_time ASC, kills DESC, achieved_at DESC, id ASC';
    case 'kills':
      return 'kills DESC, survival_time DESC, victory DESC, final_level DESC, achieved_at DESC, id ASC';
    case 'longest':
    default:
      return 'survival_time DESC, victory DESC, final_level DESC, kills DESC, achieved_at DESC, id ASC';
  }
}

function compareByLongest(a: StoredLeaderboardRecord, b: StoredLeaderboardRecord): number {
  const timeDiff = b.survivalTime - a.survivalTime;
  if (Math.abs(timeDiff) > 0.001) return timeDiff;
  if (a.victory !== b.victory) return a.victory ? -1 : 1;
  if (b.finalLevel !== a.finalLevel) return b.finalLevel - a.finalLevel;
  if (b.kills !== a.kills) return b.kills - a.kills;
  const dateDiff = new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime();
  if (dateDiff !== 0) return dateDiff;
  return a.id.localeCompare(b.id);
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
    const dateDiff = new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.id.localeCompare(b.id);
  }
  if (sort === 'kills') {
    if (b.kills !== a.kills) return b.kills - a.kills;
    return compareByLongest(a, b);
  }
  return compareByLongest(a, b);
}

export function parseLegacyLeaderboardJson(rawContent: string): unknown[] {
  const parsed: unknown = JSON.parse(rawContent);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { records?: unknown }).records)) {
    return (parsed as { records: unknown[] }).records;
  }
  throw new Error('JSON file must be an array of records or an object with a "records" array.');
}

function normalizeLegacyRecord(raw: unknown): StoredLeaderboardRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 96) : '';
  const submissionId =
    typeof r.submissionId === 'string' && r.submissionId.trim()
      ? r.submissionId.trim().slice(0, 96)
      : id;
  if (!id && !submissionId) return null;

  const regionRaw = typeof r.region === 'string' ? r.region.trim().toUpperCase() : '';
  if (!VALID_REGION_CODES.has(regionRaw as RegionCode)) return null;

  const survivalTimeRaw = Number(r.survivalTime);
  if (!Number.isFinite(survivalTimeRaw) || survivalTimeRaw < 1 || survivalTimeRaw > 7200) return null;
  const survivalTime = Math.round(survivalTimeRaw * 100) / 100;

  const finalLevelRaw = Number(r.finalLevel);
  if (!Number.isFinite(finalLevelRaw)) return null;
  const finalLevel = Math.max(1, Math.min(100, Math.round(finalLevelRaw)));

  const killsRaw = Number(r.kills);
  if (!Number.isFinite(killsRaw) || killsRaw < 0) return null;
  const kills = Math.max(0, Math.min(99, Math.floor(killsRaw)));

  if (typeof r.victory !== 'boolean') return null;
  if (r.mode !== 'royale' && r.mode !== 'multiplayer') return null;

  const achievedAtRaw = typeof r.achievedAt === 'string' ? r.achievedAt : '';
  const achievedDate = new Date(achievedAtRaw);
  const achievedAt = Number.isNaN(achievedDate.getTime())
    ? new Date().toISOString()
    : achievedDate.toISOString();

  const stableKeySource = submissionId || id;
  return {
    id: id || `imp-${stableKeySource}`,
    resultKey: buildLegacyResultKey(stableKeySource),
    submissionId: stableKeySource,
    matchId: null,
    playerId: null,
    playerName: sanitizeName(r.playerName),
    region: regionRaw as RegionCode,
    survivalTime,
    finalLevel,
    kills,
    victory: r.victory,
    lobbySize: sanitizeLobbySize(r.lobbySize, r.mode === 'multiplayer'),
    mode: r.mode,
    achievedAt,
  };
}

export function loadMigrationStatements(): string[] {
  const migrationPath = path.resolve(__dirname, 'migrations', '001_create_leaderboard_results.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter((stmt) => stmt.length > 0);
}

export function resolvePgSslConfig(
  databaseUrl: string,
  envSsl?: string,
  envRejectUnauthorized?: string
): boolean | { rejectUnauthorized: boolean } {
  const normalized = (envSsl ?? '').trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'disable' || normalized === 'off') {
    return false;
  }

  let parsedHost = '';
  let sslModeParam = '';
  try {
    const parsed = new URL(databaseUrl);
    parsedHost = parsed.hostname.toLowerCase();
    sslModeParam = (parsed.searchParams.get('sslmode') ?? '').toLowerCase();
  } catch {
    // Fallback to checking raw string if URL parsing fails
  }

  if (sslModeParam === 'disable') return false;

  const isLocalHost =
    parsedHost === 'localhost' || parsedHost === '127.0.0.1' || parsedHost === '::1';
  const isRemoteFqdn = Boolean(parsedHost && !isLocalHost && parsedHost.includes('.'));
  const wantsSsl =
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'require' ||
    sslModeParam === 'require' ||
    sslModeParam === 'prefer' ||
    sslModeParam === 'verify-full' ||
    sslModeParam === 'verify-ca' ||
    isRemoteFqdn ||
    (!isLocalHost && process.env.NODE_ENV === 'production');

  if (!wantsSsl) return false;

  const rejectFlag = (envRejectUnauthorized ?? '').trim().toLowerCase();
  const rejectUnauthorized =
    rejectFlag === 'false' || rejectFlag === '0'
      ? false
      : rejectFlag === 'true' || rejectFlag === '1'
        ? true
        : sslModeParam === 'verify-full' || sslModeParam === 'verify-ca';

  return { rejectUnauthorized };
}

interface DbRankedRow {
  id: string;
  result_key: string;
  submission_id: string;
  match_id: string | null;
  player_id: string | null;
  player_name: string;
  region: string;
  survival_time: number | string;
  final_level: number | string;
  kills: number | string;
  victory: boolean;
  lobby_size: number | string;
  mode: string;
  achieved_at: Date | string;
  global_rank: number | string;
  regional_rank: number | string;
}

function mapRankedRow(row: DbRankedRow): RankedLeaderboardEntry {
  const achievedAt =
    row.achieved_at instanceof Date
      ? row.achieved_at.toISOString()
      : new Date(String(row.achieved_at)).toISOString();
  return {
    id: String(row.id),
    resultKey: String(row.result_key),
    submissionId: String(row.submission_id),
    matchId: row.match_id ? String(row.match_id) : null,
    playerId: row.player_id ? String(row.player_id) : null,
    playerName: String(row.player_name),
    region: String(row.region) as RegionCode,
    survivalTime: Math.round(Number(row.survival_time) * 100) / 100,
    finalLevel: Number(row.final_level),
    kills: Number(row.kills),
    victory: Boolean(row.victory),
    lobbySize: Number(row.lobby_size) as LobbySize,
    mode: row.mode === 'multiplayer' ? 'multiplayer' : 'royale',
    achievedAt,
    globalRank: Number(row.global_rank),
    regionalRank: Number(row.regional_rank),
  };
}

export class PostgresLeaderboardStore implements LeaderboardStore {
  public readonly storageKind = 'postgres' as const;
  private executor: SqlQueryExecutor;
  private initialized = false;
  private logger: (line: string) => void;
  private retryBaseDelayMs: number;

  constructor(options: {
    connectionString?: string;
    ssl?: boolean | { rejectUnauthorized: boolean };
    executor?: SqlQueryExecutor;
    logger?: (line: string) => void;
    retryBaseDelayMs?: number;
  }) {
    this.logger = options.logger ?? ((line: string) => console.error(line));
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 120;

    if (options.executor) {
      this.executor = options.executor;
    } else if (options.connectionString) {
      const pool = new Pool({
        connectionString: options.connectionString,
        ssl: options.ssl,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 8000,
      });
      pool.on('error', (err) => {
        this.logger(`[LEADERBOARD] event=pool_error reason=${sanitizeErrorReason(err)}`);
      });
      this.executor = {
        query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const res = await pool.query(sql, params);
          return { rows: res.rows as T[] };
        },
        close: async () => {
          await pool.end();
        },
      };
    } else {
      throw new Error('PostgresLeaderboardStore requires either connectionString or executor.');
    }
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    const statements = loadMigrationStatements();
    for (const stmt of statements) {
      await this.executor.query(stmt);
    }
    this.initialized = true;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      await this.executor.query('SELECT 1 AS ok');
      return true;
    } catch {
      return false;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  private async getRegionSummary(): Promise<RegionLeaderboardSummary[]> {
    const statsRes = await this.executor.query<{
      region: string;
      count: number | string;
      king_count: number | string;
    }>(`
      SELECT
        region,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE victory = TRUE AND final_level >= 100)::int AS king_count
      FROM leaderboard_results
      GROUP BY region
    `);

    const leadersRes = await this.executor.query<{
      region: string;
      survival_time: number | string;
      player_name: string;
    }>(`
      SELECT DISTINCT ON (region)
        region,
        survival_time,
        player_name
      FROM leaderboard_results
      ORDER BY region, survival_time DESC, victory DESC, final_level DESC, kills DESC, achieved_at DESC, id ASC
    `);

    const statsByRegion = new Map<string, { count: number; kingCount: number }>();
    for (const row of statsRes.rows) {
      statsByRegion.set(String(row.region), {
        count: Number(row.count),
        kingCount: Number(row.king_count),
      });
    }

    const leaderByRegion = new Map<string, { topSurvivalTime: number; topPlayerName: string }>();
    for (const row of leadersRes.rows) {
      leaderByRegion.set(String(row.region), {
        topSurvivalTime: Math.round(Number(row.survival_time) * 100) / 100,
        topPlayerName: String(row.player_name),
      });
    }

    return REGIONS.map((reg) => {
      const stats = statsByRegion.get(reg.code);
      const leader = leaderByRegion.get(reg.code);
      return {
        region: reg.code,
        name: reg.name,
        count: stats?.count ?? 0,
        kingCount: stats?.kingCount ?? 0,
        topSurvivalTime: leader ? leader.topSurvivalTime : null,
        topPlayerName: leader ? leader.topPlayerName : null,
      };
    });
  }

  public async query(
    region: RegionFilter = 'ALL',
    sort: GlobalLeaderboardSort = 'longest',
    limit = 100
  ): Promise<LeaderboardQueryResult> {
    try {
      await this.ensureInitialized();
      const safeLimit = Math.max(1, Math.min(100, Math.floor(limit) || 100));
      const orderClause = getOrderClause(sort);
      const whereQualifying =
        sort === 'fastest_king' ? 'WHERE victory = TRUE AND final_level >= 100' : '';

      const params: unknown[] = [];
      let outerWhere = '';
      if (region !== 'ALL' && VALID_REGION_CODES.has(region)) {
        params.push(region);
        outerWhere = `WHERE region = $${params.length}`;
      }
      params.push(safeLimit);
      const limitParam = `$${params.length}`;

      const entriesSql = `
        WITH ranked AS (
          SELECT
            id, result_key, submission_id, match_id, player_id,
            player_name, region, survival_time, final_level,
            kills, victory, lobby_size, mode, achieved_at,
            ROW_NUMBER() OVER (ORDER BY ${orderClause})::int AS global_rank,
            ROW_NUMBER() OVER (PARTITION BY region ORDER BY ${orderClause})::int AS regional_rank
          FROM leaderboard_results
          ${whereQualifying}
        )
        SELECT *
        FROM ranked
        ${outerWhere}
        ORDER BY global_rank ASC
        LIMIT ${limitParam}
      `;

      const countsParams: unknown[] = [];
      let matchingCountExpr = 'COUNT(*)::int AS total_matching';
      if (region !== 'ALL' && VALID_REGION_CODES.has(region)) {
        countsParams.push(region);
        matchingCountExpr = `COUNT(*) FILTER (WHERE region = $1)::int AS total_matching`;
      }

      const countsSql = `
        SELECT
          COUNT(*)::int AS total_global,
          ${matchingCountExpr},
          MAX(achieved_at) AS updated_at
        FROM leaderboard_results
        ${whereQualifying}
      `;

      const [entriesRes, countsRes, regionSummary] = await Promise.all([
        this.executor.query<DbRankedRow>(entriesSql, params),
        this.executor.query<{
          total_global: number | string;
          total_matching: number | string;
          updated_at: Date | string | null;
        }>(countsSql, countsParams),
        this.getRegionSummary(),
      ]);

      const countsRow = countsRes.rows[0];
      const updatedAtRaw = countsRow?.updated_at;
      const updatedAt = updatedAtRaw
        ? updatedAtRaw instanceof Date
          ? updatedAtRaw.toISOString()
          : new Date(String(updatedAtRaw)).toISOString()
        : new Date().toISOString();

      return {
        entries: entriesRes.rows.map(mapRankedRow),
        regionSummary,
        totalGlobal: Number(countsRow?.total_global ?? 0),
        totalMatching: Number(countsRow?.total_matching ?? 0),
        updatedAt,
      };
    } catch (err) {
      this.logger(`[LEADERBOARD] event=query_failed reason=${sanitizeErrorReason(err)}`);
      throw new LeaderboardStorageUnavailableError(
        'Global rankings database is currently unavailable.'
      );
    }
  }

  private async fetchRankedResultByKey(resultKey: string): Promise<LeaderboardSubmissionResult> {
    const orderClause = getOrderClause('longest');
    const rowRes = await this.executor.query<DbRankedRow>(
      `
        WITH ranked AS (
          SELECT
            id, result_key, submission_id, match_id, player_id,
            player_name, region, survival_time, final_level,
            kills, victory, lobby_size, mode, achieved_at,
            ROW_NUMBER() OVER (ORDER BY ${orderClause})::int AS global_rank,
            ROW_NUMBER() OVER (PARTITION BY region ORDER BY ${orderClause})::int AS regional_rank
          FROM leaderboard_results
        )
        SELECT * FROM ranked WHERE result_key = $1 LIMIT 1
      `,
      [resultKey]
    );

    const row = rowRes.rows[0];
    if (!row) {
      throw new Error('Committed leaderboard record could not be reloaded.');
    }
    const entry = mapRankedRow(row);

    const totalsRes = await this.executor.query<{
      total_global: number | string;
      total_regional: number | string;
    }>(
      `
        SELECT
          COUNT(*)::int AS total_global,
          COUNT(*) FILTER (WHERE region = $1)::int AS total_regional
        FROM leaderboard_results
      `,
      [entry.region]
    );
    const totals = totalsRes.rows[0];

    return {
      entry,
      globalRank: entry.globalRank,
      regionalRank: entry.regionalRank,
      totalGlobal: Number(totals?.total_global ?? 1),
      totalRegional: Number(totals?.total_regional ?? 1),
    };
  }

  private async insertIdempotent(
    record: StoredLeaderboardRecord
  ): Promise<LeaderboardWriteOutcome> {
    try {
      const outcome = await withBoundedRetry(
        async () => {
          await this.ensureInitialized();
          const insertRes = await this.executor.query<{ id: string }>(
            `
              INSERT INTO leaderboard_results (
                id, result_key, submission_id, match_id, player_id,
                player_name, region, survival_time, final_level, kills,
                victory, lobby_size, mode, achieved_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              ON CONFLICT DO NOTHING
              RETURNING id
            `,
            [
              record.id,
              record.resultKey,
              record.submissionId,
              record.matchId,
              record.playerId,
              record.playerName,
              record.region,
              record.survivalTime,
              record.finalLevel,
              record.kills,
              record.victory,
              record.lobbySize,
              record.mode,
              record.achievedAt,
            ]
          );

          const inserted = insertRes.rows.length > 0;
          const result = await this.fetchRankedResultByKey(record.resultKey);
          return { inserted, result };
        },
        {
          maxAttempts: 3,
          baseDelayMs: this.retryBaseDelayMs,
          onRetry: (attempt, err) => {
            this.logger(
              `[LEADERBOARD] event=write_retry key=${record.resultKey} attempt=${attempt} reason=${sanitizeErrorReason(err)}`
            );
          },
        }
      );

      return {
        ok: true,
        result: outcome.result,
        deduplicated: !outcome.inserted,
      };
    } catch (err) {
      this.logger(
        `[LEADERBOARD] event=write_failed key=${record.resultKey} mode=${record.mode} reason=${sanitizeErrorReason(err)}`
      );
      return {
        ok: false,
        code: 'DB_WRITE_FAILED',
        error: 'Unable to save leaderboard result to the database.',
        retryable: isTransientDbError(err),
      };
    }
  }

  public async submitSolo(input: LeaderboardSubmissionInput): Promise<LeaderboardWriteOutcome> {
    if (input.mode === 'multiplayer') {
      return {
        ok: false,
        code: 'MULTIPLAYER_CLIENT_REJECTED',
        error: 'Multiplayer rankings are recorded authoritatively by the match server.',
        retryable: false,
      };
    }
    if (input.mode !== 'royale') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Only ranked Solo Royale runs can be submitted from the client.',
        retryable: false,
      };
    }

    const region = typeof input.region === 'string' ? input.region.trim().toUpperCase() : '';
    if (!VALID_REGION_CODES.has(region as RegionCode)) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Invalid competitive region code.',
        retryable: false,
      };
    }

    const rawTime = Number(input.survivalTime);
    if (!Number.isFinite(rawTime) || rawTime < 1 || rawTime > 7200) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Survival time must be between 1s and 7200s.',
        retryable: false,
      };
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

    const lobbySize = sanitizeLobbySize(input.lobbySize, false);
    const victory = Boolean(input.victory) && finalLevel >= 100;
    const playerName = sanitizeName(input.playerName);
    const submissionId =
      typeof input.submissionId === 'string' && input.submissionId.trim()
        ? input.submissionId.trim().slice(0, 64)
        : `solo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const record: StoredLeaderboardRecord = {
      id: `glb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      resultKey: buildSoloResultKey(submissionId),
      submissionId,
      matchId: null,
      playerId: null,
      playerName,
      region: region as RegionCode,
      survivalTime,
      finalLevel,
      kills,
      victory,
      lobbySize,
      mode: 'royale',
      achievedAt: new Date().toISOString(),
    };

    return this.insertIdempotent(record);
  }

  public async recordMultiplayerResult(
    input: AuthoritativeMultiplayerResultInput
  ): Promise<LeaderboardWriteOutcome> {
    const matchId = input.matchId.trim().slice(0, 64);
    const playerId = input.playerId.trim().slice(0, 64);
    if (!matchId || !playerId) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Authoritative multiplayer results require matchId and playerId.',
        retryable: false,
      };
    }

    const region: RegionCode = VALID_REGION_CODES.has(input.region) ? input.region : 'SEA';
    const rawTime = Number(input.survivalTime);
    if (!Number.isFinite(rawTime) || rawTime < 1 || rawTime > 7200) {
      return {
        ok: false,
        code: 'INELIGIBLE_RUN',
        error: 'Run lasted under 1 second and does not qualify for leaderboard ranking.',
        retryable: false,
      };
    }

    const survivalTime = Math.round(rawTime * 100) / 100;
    const finalLevel = Number.isFinite(input.finalLevel)
      ? Math.max(1, Math.min(100, Math.round(input.finalLevel)))
      : 1;
    const kills = Number.isFinite(input.kills)
      ? Math.max(0, Math.min(99, Math.floor(input.kills)))
      : 0;
    const victory = Boolean(input.victory) && finalLevel >= 100;
    const lobbySize = sanitizeLobbySize(input.lobbySize, true);
    const resultKey = buildMultiplayerResultKey(matchId, playerId);

    const record: StoredLeaderboardRecord = {
      id: `glb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      resultKey,
      submissionId: resultKey,
      matchId,
      playerId,
      playerName: sanitizeName(input.playerName),
      region,
      survivalTime,
      finalLevel,
      kills,
      victory,
      lobbySize,
      mode: 'multiplayer',
      achievedAt: input.achievedAt ?? new Date().toISOString(),
    };

    return this.insertIdempotent(record);
  }

  public async importLegacyRecords(rawRecords: unknown[]): Promise<LegacyImportSummary> {
    await this.ensureInitialized();
    const summary: LegacyImportSummary = {
      totalRead: rawRecords.length,
      imported: 0,
      skippedDuplicates: 0,
      invalid: 0,
    };

    for (const raw of rawRecords) {
      const rec = normalizeLegacyRecord(raw);
      if (!rec) {
        summary.invalid += 1;
        continue;
      }
      const res = await this.executor.query<{ id: string }>(
        `
          INSERT INTO leaderboard_results (
            id, result_key, submission_id, match_id, player_id,
            player_name, region, survival_time, final_level, kills,
            victory, lobby_size, mode, achieved_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT DO NOTHING
          RETURNING id
        `,
        [
          rec.id,
          rec.resultKey,
          rec.submissionId,
          rec.matchId,
          rec.playerId,
          rec.playerName,
          rec.region,
          rec.survivalTime,
          rec.finalLevel,
          rec.kills,
          rec.victory,
          rec.lobbySize,
          rec.mode,
          rec.achievedAt,
        ]
      );
      if (res.rows.length > 0) {
        summary.imported += 1;
      } else {
        summary.skippedDuplicates += 1;
      }
    }

    return summary;
  }

  public async close(): Promise<void> {
    if (this.executor.close) {
      await this.executor.close();
    }
  }
}

/**
 * Explicit development-only JSON file store.
 * NEVER enabled in production (`NODE_ENV === 'production'`).
 */
export class DevJsonLeaderboardStore implements LeaderboardStore {
  public readonly storageKind = 'dev_json' as const;
  private filePath: string;
  private records: StoredLeaderboardRecord[] = [];
  private updatedAt: string = new Date().toISOString();

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? path.resolve(process.cwd(), '.data', 'global-leaderboard.json');
  }

  public async init(): Promise<void> {
    this.loadFromDisk();
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  private loadFromDisk() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.records = [];
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const items = parseLegacyLeaderboardJson(raw);
      const dedup = new Map<string, StoredLeaderboardRecord>();
      for (const item of items) {
        const rec = normalizeLegacyRecord(item);
        if (rec) dedup.set(rec.resultKey, rec);
      }
      this.records = Array.from(dedup.values()).sort(compareByLongest);
    } catch {
      this.records = [];
    }
  }

  private saveToDisk() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify({ updatedAt: this.updatedAt, records: this.records }, null, 2),
      'utf-8'
    );
    fs.renameSync(tmpPath, this.filePath);
  }

  private buildRankedList(sort: GlobalLeaderboardSort): RankedLeaderboardEntry[] {
    const base =
      sort === 'fastest_king'
        ? this.records.filter((r) => r.victory && r.finalLevel >= 100)
        : [...this.records];

    base.sort((a, b) => compareBySort(a, b, sort));

    const regionCounters = new Map<RegionCode, number>();
    return base.map((rec, idx) => {
      const nextRegRank = (regionCounters.get(rec.region) ?? 0) + 1;
      regionCounters.set(rec.region, nextRegRank);
      return {
        ...rec,
        globalRank: idx + 1,
        regionalRank: nextRegRank,
      };
    });
  }

  private getRegionSummary(): RegionLeaderboardSummary[] {
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

  public async query(
    region: RegionFilter = 'ALL',
    sort: GlobalLeaderboardSort = 'longest',
    limit = 100
  ): Promise<LeaderboardQueryResult> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit) || 100));
    const rankedAll = this.buildRankedList(sort);
    const filtered =
      region === 'ALL' ? rankedAll : rankedAll.filter((entry) => entry.region === region);

    return {
      entries: filtered.slice(0, safeLimit),
      regionSummary: this.getRegionSummary(),
      totalGlobal: rankedAll.length,
      totalMatching: filtered.length,
      updatedAt: this.updatedAt,
    };
  }

  private insertRecord(record: StoredLeaderboardRecord): LeaderboardWriteOutcome {
    const existing = this.records.find(
      (r) => r.resultKey === record.resultKey || r.submissionId === record.submissionId
    );
    let deduplicated = false;
    let target = record;
    if (existing) {
      deduplicated = true;
      target = existing;
    } else {
      this.updatedAt = record.achievedAt;
      this.records = [...this.records, record];
      try {
        this.saveToDisk();
      } catch (err) {
        this.records = this.records.filter((r) => r.id !== record.id);
        return {
          ok: false,
          code: 'DB_WRITE_FAILED',
          error: `Dev JSON write failed: ${sanitizeErrorReason(err)}`,
          retryable: true,
        };
      }
    }

    const ranked = this.buildRankedList('longest');
    const found = ranked.find((r) => r.id === target.id) ?? {
      ...target,
      globalRank: ranked.length,
      regionalRank: 1,
    };
    const totalRegional = ranked.filter((r) => r.region === target.region).length;
    return {
      ok: true,
      deduplicated,
      result: {
        entry: found,
        globalRank: found.globalRank,
        regionalRank: found.regionalRank,
        totalGlobal: ranked.length,
        totalRegional,
      },
    };
  }

  public async submitSolo(input: LeaderboardSubmissionInput): Promise<LeaderboardWriteOutcome> {
    if (input.mode === 'multiplayer') {
      return {
        ok: false,
        code: 'MULTIPLAYER_CLIENT_REJECTED',
        error: 'Multiplayer rankings are recorded authoritatively by the match server.',
        retryable: false,
      };
    }
    if (input.mode !== 'royale') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Only ranked Solo Royale runs can be submitted from the client.',
        retryable: false,
      };
    }
    const region = typeof input.region === 'string' ? input.region.trim().toUpperCase() : '';
    if (!VALID_REGION_CODES.has(region as RegionCode)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Invalid competitive region code.', retryable: false };
    }
    const rawTime = Number(input.survivalTime);
    if (!Number.isFinite(rawTime) || rawTime < 1 || rawTime > 7200) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Survival time must be between 1s and 7200s.', retryable: false };
    }
    const submissionId =
      typeof input.submissionId === 'string' && input.submissionId.trim()
        ? input.submissionId.trim().slice(0, 64)
        : `solo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const finalLevel = Number.isFinite(Number(input.finalLevel))
      ? Math.max(1, Math.min(100, Math.round(Number(input.finalLevel))))
      : 1;
    const kills = Number.isFinite(Number(input.kills))
      ? Math.max(0, Math.min(99, Math.floor(Number(input.kills))))
      : 0;
    return this.insertRecord({
      id: `glb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      resultKey: buildSoloResultKey(submissionId),
      submissionId,
      matchId: null,
      playerId: null,
      playerName: sanitizeName(input.playerName),
      region: region as RegionCode,
      survivalTime: Math.round(rawTime * 100) / 100,
      finalLevel,
      kills,
      victory: Boolean(input.victory) && finalLevel >= 100,
      lobbySize: sanitizeLobbySize(input.lobbySize, false),
      mode: 'royale',
      achievedAt: new Date().toISOString(),
    });
  }

  public async recordMultiplayerResult(
    input: AuthoritativeMultiplayerResultInput
  ): Promise<LeaderboardWriteOutcome> {
    const rawTime = Number(input.survivalTime);
    if (!Number.isFinite(rawTime) || rawTime < 1 || rawTime > 7200) {
      return {
        ok: false,
        code: 'INELIGIBLE_RUN',
        error: 'Run lasted under 1 second and does not qualify for leaderboard ranking.',
        retryable: false,
      };
    }
    const resultKey = buildMultiplayerResultKey(input.matchId, input.playerId);
    const finalLevel = Number.isFinite(input.finalLevel)
      ? Math.max(1, Math.min(100, Math.round(input.finalLevel)))
      : 1;
    return this.insertRecord({
      id: `glb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      resultKey,
      submissionId: resultKey,
      matchId: input.matchId,
      playerId: input.playerId,
      playerName: sanitizeName(input.playerName),
      region: VALID_REGION_CODES.has(input.region) ? input.region : 'SEA',
      survivalTime: Math.round(rawTime * 100) / 100,
      finalLevel,
      kills: Math.max(0, Math.min(99, Math.floor(input.kills))),
      victory: Boolean(input.victory) && finalLevel >= 100,
      lobbySize: sanitizeLobbySize(input.lobbySize, true),
      mode: 'multiplayer',
      achievedAt: input.achievedAt ?? new Date().toISOString(),
    });
  }

  public async importLegacyRecords(rawRecords: unknown[]): Promise<LegacyImportSummary> {
    const summary: LegacyImportSummary = {
      totalRead: rawRecords.length,
      imported: 0,
      skippedDuplicates: 0,
      invalid: 0,
    };
    for (const raw of rawRecords) {
      const rec = normalizeLegacyRecord(raw);
      if (!rec) {
        summary.invalid += 1;
        continue;
      }
      if (this.records.some((r) => r.resultKey === rec.resultKey || r.submissionId === rec.submissionId)) {
        summary.skippedDuplicates += 1;
        continue;
      }
      this.records.push(rec);
      summary.imported += 1;
    }
    if (summary.imported > 0) {
      this.updatedAt = new Date().toISOString();
      this.saveToDisk();
    }
    return summary;
  }

  public async close(): Promise<void> {}
}

/**
 * Explicit unavailable store used whenever DATABASE_URL is missing in production
 * (or in development without explicit dev JSON opt-in).
 * Never silently falls back to temporary files or fake empty boards.
 */
export class UnavailableLeaderboardStore implements LeaderboardStore {
  public readonly storageKind = 'unavailable' as const;
  private readonly reason: string;

  constructor(reason = 'Leaderboard database is not configured (DATABASE_URL missing).') {
    this.reason = reason;
  }

  public async init(): Promise<void> {}

  public async isAvailable(): Promise<boolean> {
    return false;
  }

  public async query(): Promise<LeaderboardQueryResult> {
    throw new LeaderboardStorageUnavailableError(this.reason);
  }

  public async submitSolo(input: LeaderboardSubmissionInput): Promise<LeaderboardWriteOutcome> {
    if (input.mode === 'multiplayer') {
      return {
        ok: false,
        code: 'MULTIPLAYER_CLIENT_REJECTED',
        error: 'Multiplayer rankings are recorded authoritatively by the match server.',
        retryable: false,
      };
    }
    return {
      ok: false,
      code: 'DB_UNAVAILABLE',
      error: this.reason,
      retryable: true,
    };
  }

  public async recordMultiplayerResult(): Promise<LeaderboardWriteOutcome> {
    return {
      ok: false,
      code: 'DB_UNAVAILABLE',
      error: this.reason,
      retryable: true,
    };
  }

  public async importLegacyRecords(): Promise<LegacyImportSummary> {
    throw new LeaderboardStorageUnavailableError(this.reason);
  }

  public async close(): Promise<void> {}
}

export function createLeaderboardStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  logger: (line: string) => void = (line) => console.log(line)
): LeaderboardStore {
  const databaseUrl = (env.DATABASE_URL ?? '').trim();
  const isProd = env.NODE_ENV === 'production';

  if (databaseUrl) {
    const ssl = resolvePgSslConfig(
      databaseUrl,
      env.DATABASE_SSL,
      env.DATABASE_SSL_REJECT_UNAUTHORIZED
    );
    logger(
      `[LEADERBOARD] event=store_configured kind=postgres ssl=${ssl === false ? 'off' : 'on'}`
    );
    return new PostgresLeaderboardStore({
      connectionString: databaseUrl,
      ssl,
      logger,
    });
  }

  const allowDevJson =
    !isProd &&
    ['true', '1', 'yes', 'json'].includes(
      (env.LEADERBOARD_DEV_JSON_FALLBACK ?? '').trim().toLowerCase()
    );

  if (allowDevJson) {
    const customPath = (env.LEADERBOARD_DEV_JSON_PATH ?? '').trim() || undefined;
    logger('[LEADERBOARD] event=store_configured kind=dev_json mode=explicit_dev_opt_in');
    return new DevJsonLeaderboardStore(customPath);
  }

  const reason = isProd
    ? 'Global leaderboard database is not configured. Set server-only DATABASE_URL.'
    : 'Global leaderboard database is not configured. Set DATABASE_URL (or LEADERBOARD_DEV_JSON_FALLBACK=true for local development).';
  logger(`[LEADERBOARD] event=store_unavailable env=${isProd ? 'production' : 'development'}`);
  return new UnavailableLeaderboardStore(reason);
}

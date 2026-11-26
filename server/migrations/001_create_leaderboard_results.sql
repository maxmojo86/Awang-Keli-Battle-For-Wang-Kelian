-- Migration 001: Durable global and regional leaderboard results
-- Idempotent PostgreSQL schema for AWANG KELI: BATTLE FOR WANG KELIAN

CREATE TABLE IF NOT EXISTS leaderboard_results (
  id TEXT PRIMARY KEY,
  result_key TEXT NOT NULL UNIQUE,
  submission_id TEXT NOT NULL UNIQUE,
  match_id TEXT NULL,
  player_id TEXT NULL,
  player_name TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('SEA', 'EAS', 'SAS', 'EUR', 'NAM', 'SAM', 'OCE', 'MEA')),
  survival_time DOUBLE PRECISION NOT NULL CHECK (survival_time >= 0 AND survival_time <= 7200),
  final_level INTEGER NOT NULL CHECK (final_level >= 1 AND final_level <= 100),
  kills INTEGER NOT NULL CHECK (kills >= 0 AND kills <= 99),
  victory BOOLEAN NOT NULL DEFAULT FALSE,
  lobby_size INTEGER NOT NULL CHECK (lobby_size >= 2 AND lobby_size <= 100),
  mode TEXT NOT NULL CHECK (mode IN ('royale', 'multiplayer')),
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce strict idempotency for server-authoritative multiplayer results (one row per match + player)
CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_match_player
  ON leaderboard_results (match_id, player_id)
  WHERE match_id IS NOT NULL AND player_id IS NOT NULL;

-- Query performance indexes for all supported sorting and regional filters
CREATE INDEX IF NOT EXISTS idx_leaderboard_longest
  ON leaderboard_results (survival_time DESC, victory DESC, final_level DESC, kills DESC, achieved_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_leaderboard_fastest_king
  ON leaderboard_results (survival_time ASC, kills DESC, achieved_at DESC, id ASC)
  WHERE victory = TRUE AND final_level >= 100;

CREATE INDEX IF NOT EXISTS idx_leaderboard_kills
  ON leaderboard_results (kills DESC, survival_time DESC, victory DESC, final_level DESC, achieved_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_leaderboard_region_longest
  ON leaderboard_results (region, survival_time DESC, victory DESC, final_level DESC, kills DESC, achieved_at DESC, id ASC);

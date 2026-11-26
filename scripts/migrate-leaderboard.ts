import { createLeaderboardStoreFromEnv } from '../server/leaderboardStore.ts';

async function main() {
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable is required to run migrations.');
    process.exit(1);
  }

  const store = createLeaderboardStoreFromEnv(process.env, (line) => console.log(line));
  try {
    await store.init();
    const ok = await store.isAvailable();
    if (!ok) {
      throw new Error('Database connectivity verification failed after migration.');
    }
    console.log('[LEADERBOARD] Migration 001_create_leaderboard_results.sql applied successfully.');
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  const safeMsg = err instanceof Error ? err.message : String(err);
  console.error('[LEADERBOARD] Migration failed:', safeMsg.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DB_URL]'));
  process.exit(1);
});

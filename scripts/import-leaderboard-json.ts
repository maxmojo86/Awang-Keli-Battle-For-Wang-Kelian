import fs from 'fs';
import path from 'path';
import {
  createLeaderboardStoreFromEnv,
  parseLegacyLeaderboardJson,
} from '../server/leaderboardStore.ts';

async function main() {
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable is required to import legacy leaderboard JSON.');
    process.exit(1);
  }

  const inputArg = process.argv[2] ?? path.resolve(process.cwd(), '.data', 'global-leaderboard.json');
  const resolvedPath = path.resolve(process.cwd(), inputArg);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: Leaderboard JSON file not found at ${resolvedPath}`);
    process.exit(1);
  }

  const rawContent = fs.readFileSync(resolvedPath, 'utf-8');
  const rawRecords = parseLegacyLeaderboardJson(rawContent);

  const store = createLeaderboardStoreFromEnv(process.env, (line) => console.log(line));
  try {
    await store.init();
    const summary = await store.importLegacyRecords(rawRecords);
    console.log(
      `[LEADERBOARD] Import complete: read=${summary.totalRead}, imported=${summary.imported}, skippedDuplicates=${summary.skippedDuplicates}, invalid=${summary.invalid}`
    );
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  const safeMsg = err instanceof Error ? err.message : String(err);
  console.error('[LEADERBOARD] Import failed:', safeMsg.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DB_URL]'));
  process.exit(1);
});

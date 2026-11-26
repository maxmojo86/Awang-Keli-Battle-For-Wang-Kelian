import fs from 'fs';
import path from 'path';
import { createLeaderboardStoreFromEnv } from '../server/leaderboardStore.ts';

async function main() {
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable is required to export leaderboard records.');
    process.exit(1);
  }

  const outputArg = process.argv[2] ?? path.resolve(process.cwd(), '.data', 'leaderboard-export.json');
  const resolvedPath = path.resolve(process.cwd(), outputArg);

  const store = createLeaderboardStoreFromEnv(process.env, (line) => console.log(line));
  try {
    const records = await store.exportRecords();
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(
      resolvedPath,
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          count: records.length,
          records,
        },
        null,
        2
      ),
      'utf-8'
    );
    console.log(`[LEADERBOARD] Exported ${records.length} record(s) to ${resolvedPath} (source database unmodified).`);
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  const safeMsg = err instanceof Error ? err.message : String(err);
  console.error('[LEADERBOARD] Export failed:', safeMsg.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DB_URL]'));
  process.exit(1);
});

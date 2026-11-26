# Neon PostgreSQL Global & Regional Leaderboard Setup (Render Deployment)

AWANG KELI: BATTLE FOR WANG KELIAN runs its Express + WebSocket multiplayer server on Render and persists global and regional leaderboard rankings in **Neon PostgreSQL** using a server-only `DATABASE_URL` environment variable.

## Architecture & Guarantees

- **Server-only `pg.Pool`**: Reads `process.env.DATABASE_URL` exclusively on the Node.js server. Never prefix with `VITE_`, never include in frontend bundles, and never commit real credentials or URLs to GitHub.
- **Neon TLS preserved**: Connections to `*.neon.tech` (including pooled URLs with `?sslmode=require&channel_binding=require`) enforce TLS with certificate verification (`rejectUnauthorized: true`) by default and include cold-wake timeout headroom (`connectionTimeoutMillis: 15000`) plus TCP keepalive.
- **Canonical schema & regions**: Uses `leaderboard_results` with canonical region codes `SEA`, `APAC`, `NA`, `EU`, `SA`, and `MEA`. Schema initialization (`server/migrations/001_create_leaderboard_results.sql`) is lock-free and idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`).
- **Production fail-loud behavior**: In `NODE_ENV=production`, the server **never** silently falls back to temporary `.data/` JSON files or fake empty results if `DATABASE_URL` is missing or Neon is unreachable. `/api/leaderboard` returns HTTP `503` (`LEADERBOARD_DB_UNAVAILABLE`), and `/api/health` reports `leaderboardAvailable: false` until a live `SELECT 1 FROM leaderboard_results LIMIT 0` succeeds.
- **Local development opt-in**: Outside production, you may either point `DATABASE_URL` at a dev PostgreSQL database or explicitly opt into local JSON storage via `LEADERBOARD_DEV_JSON_FALLBACK=true`.

---

## 1. Configure Render Environment Variables for Neon

In your Render Web Service (`awang-keli-multiplayer`) -> **Environment**:

| Variable | Required | Value / Notes |
| --- | --- | --- |
| `NODE_ENV` | Yes | `production` |
| `DATABASE_URL` | Yes | **Pooled Neon PostgreSQL connection string** from the Neon Console (host ending in `-pooler.<region>.aws.neon.tech`, keeping `?sslmode=require&channel_binding=require`). **Server-only — never prefix with `VITE_`.** |
| `DATABASE_SSL` | Optional | Leave unset for Neon (TLS is auto-enabled for `*.neon.tech` and `sslmode=require`). |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Optional | Leave unset for Neon (defaults to `true` for `*.neon.tech`). |
| `CORS_ORIGIN` | Optional | `*` (or your allowed web/app origins). |

> Never put `DATABASE_URL` in `.env.production`, Vite config, or any committed file.

---

## 2. Schema Verification / Migration (Idempotent)

If `leaderboard_results` and its indexes are already created in Neon from `server/migrations/001_create_leaderboard_results.sql`, you can still safely verify or re-run the idempotent migration at any time:

```bash
DATABASE_URL="postgresql://<user>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/<dbname>?sslmode=require&channel_binding=require" npm run db:migrate
```

Render deployment commands:

- **Build Command:** `npm ci && npm run build:standalone`
- **Pre-Deploy Command (optional):** `npm run db:migrate`
- **Start Command:** `npm start`

The server also runs idempotent schema verification on startup without acquiring destructive table locks on an already-migrated Neon table.

---

## 3. Migrate Existing Render PostgreSQL Rankings to Neon (Non-Destructive, Duplicate-Free)

Follow this procedure to copy existing rankings from your old Render PostgreSQL database into Neon **without deleting the old Render database, resetting any rankings, or creating duplicate entries**:

### Step A — Export all existing rankings from Render PostgreSQL (Read-Only)

Run from your local machine (do **not** commit the export file to GitHub; `.data/` is gitignored):

```bash
DATABASE_URL="<OLD_RENDER_EXTERNAL_DATABASE_URL>" \
  npm run db:export-leaderboard -- .data/render-leaderboard-export.json
```

This executes a read-only `SELECT` on `leaderboard_results` and writes every row (preserving exact `id`, `resultKey`, `submissionId`, `matchId`, `playerId`, `playerName`, `region`, `survivalTime`, `finalLevel`, `kills`, `victory`, `lobbySize`, `mode`, and `achievedAt`) to `.data/render-leaderboard-export.json`. The Render PostgreSQL database is **not modified or deleted**.

### Step B — Import into Neon PostgreSQL (Idempotent / Zero Duplicates)

```bash
DATABASE_URL="<NEON_POOLED_DATABASE_URL>" \
  npm run db:import-leaderboard -- .data/render-leaderboard-export.json
```

- Every row is inserted with `ON CONFLICT DO NOTHING` against `id`, `result_key`, `submission_id`, and `(match_id, player_id)`.
- Re-running the import or running it after new live matches in Neon will safely skip any existing records (`skippedDuplicates`) without overwriting or duplicating rankings.
- You can inspect the printed summary: `read=N, imported=M, skippedDuplicates=K, invalid=0`.

### Step C — Switch Render Web Service to Neon & Verify Before Retiring Old DB

1. Update `DATABASE_URL` in Render (`awang-keli-multiplayer` -> **Environment**) to your **pooled Neon URL** and redeploy.
2. Verify live health:
   ```bash
   curl -s https://awang-keli-multiplayer.onrender.com/api/health
   ```
   Confirm it returns `"leaderboardStorage":"postgres"` and `"leaderboardAvailable":true`.
3. Verify rankings are visible globally and regionally:
   ```bash
   curl -s "https://awang-keli-multiplayer.onrender.com/api/leaderboard?region=ALL&sort=longest"
   ```
4. Keep the old Render PostgreSQL database untouched as a read-only fallback until you confirm live matches persist cleanly in Neon across a service restart.
5. Delete your local `.data/render-leaderboard-export.json` once verified, and never commit it to GitHub.

### Optional: Importing an Older Local `.data/global-leaderboard.json` File

The same `db:import-leaderboard` command also accepts legacy `.data/global-leaderboard.json` files (`legacy:<submissionId|id>` deduplication keys).

---

## 4. Post-Deployment Two-Device Verification Checklist

After deploying with Neon `DATABASE_URL` configured on Render:

1. Open `https://awang-keli-multiplayer.onrender.com/` on two separate devices (or two separate browsers) with distinct custom player names and competitive regions (for example, `Mujahid` in `SEA` and `Tester` in `EU`).
2. Create a Multiplayer Basin on Device 1 and join using the exact Basin Code on Device 2.
3. Confirm both devices enter the same shared match with their custom names preserved in HUD and overhead nameplates.
4. Complete the match (survive at least 1 second) and confirm both participants receive server-confirmed `Saved · Global #... · #... REGION` status.
5. Trigger a manual restart/redeploy of the Render service, then reload `/api/leaderboard` and the lobby leaderboard UI on both devices.
6. Confirm both participants' rankings remain visible in both Global (`ALL`) and their respective Regional tabs across `Longest`, `Fastest King`, and `Most Kills`.

---

## 5. Authoritative Persistence & Failure Handling

- Multiplayer results are recorded **authoritatively by the server** using `GameSimulation` data as soon as a participant is eliminated or the match finishes—even if a player disconnects before the post-match screen.
- Client `POST /api/leaderboard` requests claiming `mode: "multiplayer"` are rejected with HTTP `403`.
- Transient database errors trigger bounded retries (up to 3 attempts with exponential backoff) on the server.
- All error logs redact PostgreSQL connection strings (`[REDACTED_DB_URL]`) and never log passwords or credentials.

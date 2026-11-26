# Durable Global & Regional Leaderboard Database Setup

AWANG KELI: BATTLE FOR WANG KELIAN stores global and regional leaderboard rankings in PostgreSQL using a server-only `DATABASE_URL` environment variable.

## Why an External PostgreSQL Database Is Required

Render web services use an **ephemeral filesystem**. Any JSON files saved under `.data/` are wiped whenever Render restarts, scales, or redeploys the service.

- In **production (`NODE_ENV=production`)**, the server **never** falls back to local temporary JSON files or an empty fake leaderboard if `DATABASE_URL` is missing or unreachable. Instead, leaderboard endpoints explicitly return HTTP `503` (`LEADERBOARD_DB_UNAVAILABLE`) so the UI reports that rankings are unavailable.
- In **local development (`NODE_ENV !== 'production'`)**, you can either connect a local PostgreSQL `DATABASE_URL` or explicitly opt into local JSON storage by setting `LEADERBOARD_DEV_JSON_FALLBACK=true`.

> **Important:** Previously lost `.data/global-leaderboard.json` files from past ephemeral Render restarts cannot be recovered unless you already have a separate backup copy.

---

## 1. Provision a PostgreSQL Database

Choose any standard PostgreSQL provider (do **not** commit credentials to GitHub):

- **Render PostgreSQL** (same region as `awang-keli-multiplayer` recommended; use the **Internal Database URL** for the Render web service and **External Database URL** only when running migrations/imports from your laptop).
- **Neon** (free tier available; includes `sslmode=require`).
- **Supabase** (PostgreSQL direct/pooled connection string).

---

## 2. Configure Render Environment Variables

In your Render Web Service (`awang-keli-multiplayer`) -> **Environment**:

| Variable | Required | Value / Notes |
| --- | --- | --- |
| `NODE_ENV` | Yes | `production` |
| `DATABASE_URL` | Yes | PostgreSQL connection string (`postgresql://user:pass@host:5432/dbname`). **Server-only — never prefix with `VITE_`.** |
| `DATABASE_SSL` | Optional | `true` for external/hosted Postgres requiring TLS (auto-enabled when `sslmode=require` or non-local host in production). Set `false` only if using an internal non-TLS connection. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Optional | Defaults to `true` when `DATABASE_SSL` is explicitly verified, or set `false` if your provider uses a self-signed certificate chain. |
| `CORS_ORIGIN` | Optional | `*` (or your specific allowed origin). |

**Never** place `DATABASE_URL` in `.env.production`, Vite client config, or any `VITE_*` variable.

---

## 3. Run Database Migrations

The schema lives in `server/migrations/001_create_leaderboard_results.sql`.

Run migrations manually before or during deployment:

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

On Render, you can also configure your **Pre-Deploy Command** (or Build/Start workflow):

- **Build Command:** `npm ci && npm run build:standalone`
- **Pre-Deploy Command (optional):** `npm run db:migrate`
- **Start Command:** `npm start`

The server also safely verifies/ensures the idempotent schema on startup when `DATABASE_URL` is configured.

---

## 4. Import an Existing `global-leaderboard.json` Backup (Optional)

If you have a surviving local backup of `.data/global-leaderboard.json`, import it idempotently into PostgreSQL:

```bash
DATABASE_URL="postgresql://..." npm run db:import-leaderboard -- ./path/to/global-leaderboard.json
```

- Valid entries are inserted with a deterministic unique key (`legacy:<submissionId|id>`).
- Running the import multiple times skips duplicates (`ON CONFLICT DO NOTHING`) without creating duplicate leaderboard rows.
- Invalid or corrupted rows are skipped and reported in the summary.
- **Never commit `.data/global-leaderboard.json` or database credentials to GitHub** (`.data/` and `.env*` are ignored in `.gitignore`).

---

## 5. Failure & Retry Behavior

- Multiplayer match results are recorded **authoritatively by the server** when each participant is eliminated or when the match concludes—even if the player closes their browser or disconnects before the summary screen.
- Client `POST /api/leaderboard` requests claiming `mode: "multiplayer"` are rejected with HTTP `403`. Only Solo Royale runs can be submitted from the client.
- Transient database errors trigger bounded retries (up to 3 attempts with exponential backoff) on the server.
- A result is only acknowledged as `saved` after PostgreSQL commits the transaction. If PostgreSQL remains unavailable after retries, the server logs a sanitized error (no credentials or connection strings) and notifies the client that the save failed rather than reporting false success.

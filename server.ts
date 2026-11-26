import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { type GlobalLeaderboardSort, GlobalLeaderboardStore } from './server/leaderboardStore.ts';
import { attachMultiplayerServer } from './server/multiplayerServer.ts';
import { type RegionCode, type RegionFilter, VALID_REGION_CODES } from './src/data/regions.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

async function bootstrap() {
  const app = express();
  const corsOrigin = process.env.CORS_ORIGIN || '*';
  app.use('/api', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', corsOrigin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json());
  const leaderboardStore = new GlobalLeaderboardStore();
  const httpServer = createServer(app);
  const mpHub = attachMultiplayerServer(httpServer, { path: '/ws' });

  app.get('/api/health', (_req, res) => {
    const stats = mpHub.getHealthStats();
    res.json({ ok: true, rooms: stats.rooms, clients: stats.clients });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: mpHub.getRoomSummaries() });
  });

  app.get('/api/leaderboard', (req, res) => {
    const rawRegion = String(req.query.region || 'ALL').toUpperCase();
    const region: RegionFilter =
      rawRegion === 'ALL' || VALID_REGION_CODES.has(rawRegion as RegionCode)
        ? (rawRegion as RegionFilter)
        : 'ALL';
    const rawSort = String(req.query.sort || 'longest');
    const sort: GlobalLeaderboardSort =
      rawSort === 'fastest_king' || rawSort === 'kills' ? rawSort : 'longest';
    const limit = Number(req.query.limit || 100);
    res.json(leaderboardStore.query(region, sort, limit));
  });

  app.post('/api/leaderboard', (req, res) => {
    const outcome = leaderboardStore.submit(req.body ?? {});
    if (outcome.ok === false) {
      res.status(400).json({ error: outcome.error });
      return;
    }
    res.status(201).json(outcome.result);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true' ? { server: httpServer } : false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          res.setHeader('Content-Disposition', 'inline');
          const normalized = filePath.replace(/\\/g, '/');
          if (normalized.endsWith('/sw.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Service-Worker-Allowed', '/');
          } else if (normalized.endsWith('/manifest.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
          } else if (normalized.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Awang Keli server listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

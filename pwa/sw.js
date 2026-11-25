/* eslint-disable no-restricted-globals */
/**
 * AWANG KELI: BATTLE FOR WANG KELIAN — Standalone Production Web Service Worker
 *
 * Scope: Standalone production web builds ONLY (excluded from dev, Android, and YouTube Playables).
 *
 * Design principles:
 * - Precaches ONLY the lightweight offline fallback page and its local icons.
 * - Never downloads all game assets during install.
 * - Never caches or intercepts /api/*, WebSocket traffic, non-GET requests, voice signalling,
 *   cross-origin URLs (including Stripe checkout), payment paths, YouTube SDK, or game HTML/JS bundles.
 * - Navigation requests stay network-fresh and fall back to /offline.html ONLY on network failure
 *   (server 4xx/5xx responses are returned directly without caching).
 * - Optional same-origin image caching uses an explicit allowlist, response cloning before body reads,
 *   per-file byte limits, entry eviction caps, and never lets cache errors break a network response.
 * - Safe updates: never forces skipWaiting() during active gameplay; activates when tabs close or
 *   when the user triggers an explicit SKIP_WAITING update from the Title Screen.
 */

const CACHE_VERSION = '__PWA_CACHE_VERSION__';
const CACHE_PREFIX = 'awang-keli-pwa-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const IMAGE_CACHE = `${CACHE_PREFIX}images-${CACHE_VERSION}`;

const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/pwa/pwa-192x192.png',
  '/pwa/apple-touch-icon.png',
];

const MAX_IMAGE_ENTRIES = 28;
const MAX_IMAGE_BYTES = 1536 * 1024; // 1.5 MiB per cached image

/**
 * Returns true if the request path is explicitly excluded from service worker interception.
 */
function isExcludedPath(pathname) {
  if (pathname.startsWith('/api/')) return true;
  if (pathname === '/api') return true;
  if (pathname === '/ws' || pathname.startsWith('/ws/')) return true;
  if (pathname === '/sw.js') return true;
  if (
    pathname === '/checkout' ||
    pathname.startsWith('/checkout/') ||
    pathname === '/stripe' ||
    pathname.startsWith('/stripe/') ||
    pathname === '/payment' ||
    pathname.startsWith('/payment/')
  ) {
    return true;
  }
  return false;
}

/**
 * Explicit allowlist for same-origin static images eligible for bounded runtime caching.
 * Game HTML, JS, CSS, audio payloads (.dat/.mp3), and API/JSON are intentionally excluded.
 */
function isAllowlistedImagePath(pathname) {
  if (pathname.startsWith('/pwa/') && pathname.endsWith('.png')) return true;
  if (pathname === '/favicon.ico') return true;
  if (
    pathname.startsWith('/assets/aistudio/') &&
    (pathname.endsWith('.webp') || pathname.endsWith('.png'))
  ) {
    return true;
  }
  if (
    pathname.startsWith('/assets/sprites/') &&
    (pathname.endsWith('.webp') || pathname.endsWith('.png'))
  ) {
    return true;
  }
  if (pathname.startsWith('/assets/comic/') && pathname.endsWith('.webp')) {
    return true;
  }
  return false;
}

/**
 * Trims oldest entries from IMAGE_CACHE to enforce MAX_IMAGE_ENTRIES.
 */
async function trimImageCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= MAX_IMAGE_ENTRIES) return;
    const excess = keys.length - MAX_IMAGE_ENTRIES;
    for (let i = 0; i < excess; i += 1) {
      await cache.delete(keys[i]);
    }
  } catch {
    // Ignore cache trimming failures
  }
}

/**
 * Safely stores a cloned image response in IMAGE_CACHE if it passes MIME and byte-size checks.
 * Never throws and never reads the caller's original Response body.
 */
async function cacheImageSafely(request, response) {
  try {
    if (!response || !response.ok || response.type !== 'basic') return;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return;

    const declaredLen = Number(response.headers.get('content-length') || '0');
    if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_BYTES) return;

    // Clone BEFORE reading body or putting into Cache Storage.
    const inspectClone = response.clone();
    const storeClone = response.clone();

    if (!declaredLen) {
      const buf = await inspectClone.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return;
    }

    const cache = await caches.open(IMAGE_CACHE);
    await cache.put(request, storeClone);
    await trimImageCache(cache);
  } catch {
    // Never allow cache write/quota errors to affect app delivery
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(PRECACHE_URLS);
      } catch {
        // Install still succeeds if a non-critical icon fails; offline fallback is best-effort
        try {
          const cache = await caches.open(SHELL_CACHE);
          await cache.add(OFFLINE_URL);
        } catch {
          // Ignore
        }
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.all(
          names.map((name) => {
            if (
              name.startsWith(CACHE_PREFIX) &&
              name !== SHELL_CACHE &&
              name !== IMAGE_CACHE
            ) {
              return caches.delete(name);
            }
            return Promise.resolve(false);
          })
        );
      } catch {
        // Ignore cache cleanup errors
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 1. Never intercept non-GET requests (POST, PUT, DELETE, etc.) or WebSocket upgrades
  if (request.method !== 'GET') return;
  const upgradeHeader = request.headers.get('upgrade');
  if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') return;
  if (request.headers.has('range')) return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // 2. Never intercept cross-origin requests (fonts, YouTube SDK, external services)
  if (url.origin !== self.location.origin) return;

  // 3. Never intercept /api/*, /ws, or /sw.js
  if (isExcludedPath(url.pathname)) return;

  // 4. Document navigations: strictly network-fresh; fallback to /offline.html ONLY on network error
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Return live network response directly (including 4xx/5xx server errors without caching)
          return await fetch(request);
        } catch {
          // Network is unavailable -> serve precached lightweight offline page
          try {
            const shellCache = await caches.open(SHELL_CACHE);
            const cachedOffline = await shellCache.match(OFFLINE_URL);
            if (cachedOffline) return cachedOffline;
          } catch {
            // Fall through to inline fallback
          }
          return new Response(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offline · Awang Keli</title></head><body style="background:#091116;color:#f7f2e7;font-family:sans-serif;text-align:center;padding:3rem"><h1>Internet Connection Required</h1><p>Please reconnect to load AWANG KELI: BATTLE FOR WANG KELIAN.</p><button onclick="location.reload()" style="padding:10px 20px;margin-top:12px">Try Again</button></body></html>',
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }
          );
        }
      })()
    );
    return;
  }

  // 5. Explicit allowlist: precached offline shell icons
  if (PRECACHE_URLS.includes(url.pathname)) {
    let finishBackground = () => {};
    const backgroundWork = new Promise((resolve) => {
      finishBackground = resolve;
    });
    event.waitUntil(backgroundWork);

    event.respondWith(
      (async () => {
        try {
          const shellCache = await caches.open(SHELL_CACHE);
          const cached = await shellCache.match(request);
          if (cached) {
            fetch(request)
              .then((res) => {
                if (res && res.ok && res.type === 'basic') {
                  return shellCache.put(request, res.clone());
                }
                return undefined;
              })
              .catch(() => {})
              .finally(finishBackground);
            return cached;
          }
        } catch {
          // Proceed to network
        }
        try {
          const networkRes = await fetch(request);
          finishBackground();
          return networkRes;
        } catch (err) {
          finishBackground();
          throw err;
        }
      })()
    );
    return;
  }

  // 6. Explicit allowlist: same-origin static images with safe background refresh & strict limits
  if (isAllowlistedImagePath(url.pathname)) {
    let finishBackground = () => {};
    const backgroundWork = new Promise((resolve) => {
      finishBackground = resolve;
    });
    event.waitUntil(backgroundWork);

    event.respondWith(
      (async () => {
        let cached = undefined;
        try {
          const imageCache = await caches.open(IMAGE_CACHE);
          cached = await imageCache.match(request);
        } catch {
          cached = undefined;
        }

        if (cached) {
          // Safe background refresh (never blocks cached response)
          fetch(request)
            .then((fresh) => cacheImageSafely(request, fresh))
            .catch(() => {})
            .finally(finishBackground);
          return cached;
        }

        // Network fetch: return the real response; cache a clone asynchronously
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
            const cloneForCache = networkResponse.clone();
            cacheImageSafely(request, cloneForCache)
              .catch(() => {})
              .finally(finishBackground);
          } else {
            finishBackground();
          }
          return networkResponse;
        } catch (err) {
          finishBackground();
          throw err;
        }
      })()
    );
    return;
  }

  // 7. Everything else (JS, CSS, manifest, audio, data): do not intercept — stay network-fresh
});

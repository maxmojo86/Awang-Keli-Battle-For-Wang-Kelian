import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { resolvePlatformCapabilities } from '../src/game/platform.ts';
import {
  detectInstallGuidePlatform,
  isSecureOriginForSw,
  isStandaloneDisplayMode,
  registerStandaloneServiceWorker,
  type ServiceWorkerContainerLike,
  type ServiceWorkerRegistrationLike,
} from '../src/game/pwa.ts';

const ROOT = process.cwd();

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  // Verify PNG signature
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${filePath} must be a valid PNG`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

interface MockResponse {
  ok: boolean;
  status: number;
  type: string;
  bodyBytes: Uint8Array;
  bodyUsed: boolean;
  headers: {
    get: (name: string) => string | null;
  };
  clone: () => MockResponse;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}

function makeMockResponse(
  body: string | Uint8Array,
  init: { status?: number; type?: string; headers?: Record<string, string> } = {}
): MockResponse {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const status = init.status ?? 200;
  const type = init.type ?? 'basic';
  const normalizedHeaders = new Map<string, string>();
  for (const [k, v] of Object.entries(init.headers ?? {})) {
    normalizedHeaders.set(k.toLowerCase(), v);
  }
  const res: MockResponse = {
    ok: status >= 200 && status < 300,
    status,
    type,
    bodyBytes: bytes,
    bodyUsed: false,
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
    clone() {
      if (this.bodyUsed) {
        throw new TypeError('Cannot clone a Response whose body has already been used');
      }
      return makeMockResponse(new Uint8Array(bytes), {
        status,
        type,
        headers: Object.fromEntries(normalizedHeaders.entries()),
      });
    },
    async arrayBuffer() {
      if (this.bodyUsed) {
        throw new TypeError('Body has already been consumed');
      }
      this.bodyUsed = true;
      return bytes.slice().buffer;
    },
    async text() {
      const ab = await this.arrayBuffer();
      return new TextDecoder().decode(ab);
    },
  };
  return res;
}

function createSwHarness(options: {
  cacheVersion?: string;
  initialCaches?: Record<string, Record<string, MockResponse>>;
  fetchImpl?: (req: { url: string; method: string }) => Promise<MockResponse>;
  failCachePut?: boolean;
} = {}) {
  const origin = 'https://awang-keli-multiplayer.onrender.com';
  const cacheStore = new Map<string, Map<string, MockResponse>>();
  for (const [name, entries] of Object.entries(options.initialCaches ?? {})) {
    const map = new Map<string, MockResponse>();
    for (const [url, res] of Object.entries(entries)) {
      map.set(url, res);
    }
    cacheStore.set(name, map);
  }

  const normalizeKey = (req: string | { url: string }): string => {
    const raw = typeof req === 'string' ? req : req.url;
    return new URL(raw, origin).href;
  };

  const openCache = (name: string) => {
    if (!cacheStore.has(name)) cacheStore.set(name, new Map());
    const map = cacheStore.get(name)!;
    return {
      async addAll(urls: string[]) {
        for (const u of urls) {
          await this.add(u);
        }
      },
      async add(u: string) {
        const key = normalizeKey(u);
        const res = await fetchFn({ url: key, method: 'GET' });
        if (!res.ok) throw new Error(`Precache HTTP ${res.status}`);
        map.set(key, res);
      },
      async match(req: string | { url: string }) {
        return map.get(normalizeKey(req));
      },
      async put(req: string | { url: string }, res: MockResponse) {
        if (options.failCachePut) {
          throw new Error('QuotaExceededError');
        }
        map.set(normalizeKey(req), res);
      },
      async keys() {
        return Array.from(map.keys()).map((url) => ({ url }));
      },
      async delete(req: string | { url: string }) {
        return map.delete(normalizeKey(req));
      },
    };
  };

  const cachesApi = {
    async open(name: string) {
      return openCache(name);
    },
    async keys() {
      return Array.from(cacheStore.keys());
    },
    async delete(name: string) {
      return cacheStore.delete(name);
    },
    async match(req: string | { url: string }) {
      const key = normalizeKey(req);
      for (const map of cacheStore.values()) {
        if (map.has(key)) return map.get(key);
      }
      return undefined;
    },
  };

  const fetchCalls: string[] = [];
  const fetchFn = async (req: string | { url: string; method?: string }) => {
    const reqObj =
      typeof req === 'string'
        ? { url: new URL(req, origin).href, method: 'GET' }
        : { url: new URL(req.url, origin).href, method: req.method ?? 'GET' };
    fetchCalls.push(reqObj.url);
    if (options.fetchImpl) {
      return options.fetchImpl(reqObj);
    }
    if (reqObj.url.endsWith('/offline.html')) {
      return makeMockResponse(fs.readFileSync(path.join(ROOT, 'pwa', 'offline.html'), 'utf8'), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return makeMockResponse(new Uint8Array([1, 2, 3, 4]), {
      headers: { 'content-type': 'image/png', 'content-length': '4' },
    });
  };

  const listeners = new Map<string, Array<(ev: unknown) => void>>();
  let skipWaitingCount = 0;

  const selfObj = {
    location: { origin },
    addEventListener(type: string, cb: (ev: unknown) => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    skipWaiting() {
      skipWaitingCount += 1;
    },
  };

  const swSource = fs
    .readFileSync(path.join(ROOT, 'pwa', 'sw.js'), 'utf8')
    .replace(/__PWA_CACHE_VERSION__/g, options.cacheVersion ?? 'v1-test');

  const context = vm.createContext({
    self: selfObj,
    caches: cachesApi,
    fetch: fetchFn,
    URL,
    Response: class MockResponseCtor {
      body: string;
      status: number;
      headers: Record<string, string>;
      constructor(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
        this.body = body;
        this.status = init.status ?? 200;
        this.headers = init.headers ?? {};
      }
      async text() {
        return this.body;
      }
    },
    Promise,
  });

  vm.runInContext(swSource, context);

  async function dispatchLifecycle(type: 'install' | 'activate') {
    const waits: Promise<unknown>[] = [];
    for (const cb of listeners.get(type) ?? []) {
      cb({
        waitUntil(p: Promise<unknown>) {
          waits.push(p);
        },
      });
    }
    await Promise.all(waits);
  }

  function dispatchMessage(data: unknown) {
    for (const cb of listeners.get('message') ?? []) {
      cb({ data });
    }
  }

  async function dispatchFetch(reqInit: {
    url: string;
    method?: string;
    mode?: string;
    headers?: Record<string, string>;
  }): Promise<{
    intercepted: boolean;
    response: MockResponse | null;
    asyncWaitUntilCalled: boolean;
  }> {
    const headerMap = new Map<string, string>();
    for (const [k, v] of Object.entries(reqInit.headers ?? {})) {
      headerMap.set(k.toLowerCase(), v);
    }
    const request = {
      url: new URL(reqInit.url, origin).href,
      method: reqInit.method ?? 'GET',
      mode: reqInit.mode ?? 'cors',
      headers: {
        get: (n: string) => headerMap.get(n.toLowerCase()) ?? null,
        has: (n: string) => headerMap.has(n.toLowerCase()),
      },
    };

    const state: {
      intercepted: boolean;
      responsePromise: Promise<MockResponse> | null;
      syncDispatchFinished: boolean;
      asyncWaitUntilCalled: boolean;
    } = {
      intercepted: false,
      responsePromise: null,
      syncDispatchFinished: false,
      asyncWaitUntilCalled: false,
    };
    const waitUntilPromises: Promise<unknown>[] = [];

    const event = {
      request,
      respondWith(p: Promise<MockResponse>) {
        state.intercepted = true;
        state.responsePromise = Promise.resolve(p);
      },
      waitUntil(p: Promise<unknown>) {
        if (state.syncDispatchFinished) {
          state.asyncWaitUntilCalled = true;
        }
        waitUntilPromises.push(Promise.resolve(p));
      },
    };

    for (const cb of listeners.get('fetch') ?? []) {
      cb(event);
    }
    state.syncDispatchFinished = true;

    const response = state.responsePromise ? await state.responsePromise : null;
    await Promise.all(waitUntilPromises);

    return {
      intercepted: state.intercepted,
      response,
      asyncWaitUntilCalled: state.asyncWaitUntilCalled,
    };
  }

  return {
    cacheStore,
    fetchCalls,
    getSkipWaitingCount: () => skipWaitingCount,
    dispatchLifecycle,
    dispatchMessage,
    dispatchFetch,
  };
}

test('1. Web App Manifest has valid metadata, standalone display, dark-teal theme, and verified PNG icon dimensions', () => {
  const manifestPath = path.join(ROOT, 'pwa', 'manifest.webmanifest');
  assert.ok(fs.existsSync(manifestPath), 'pwa/manifest.webmanifest must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.name, 'AWANG KELI: BATTLE FOR WANG KELIAN');
  assert.equal(manifest.short_name, 'Awang Keli');
  assert.ok(manifest.short_name.length <= 12, 'short_name must stay <= 12 chars');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#091116');
  assert.equal(manifest.theme_color, '#091116');
  assert.equal(manifest.orientation, undefined, 'Must allow responsive portrait/landscape without forced orientation');

  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  const sizesFound = new Set<string>();
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    assert.notEqual(icon.purpose, 'any maskable', 'Keep any and maskable purposes separate');
    sizesFound.add(`${icon.sizes}:${icon.purpose}`);

    const fileName = path.basename(icon.src);
    const actualDims = readPngDimensions(path.join(ROOT, 'pwa', 'icons', fileName));
    assert.equal(
      `${actualDims.width}x${actualDims.height}`,
      icon.sizes,
      `Icon ${fileName} actual dimensions must match manifest sizes`
    );
  }
  assert.ok(sizesFound.has('192x192:any'), 'Must declare 192x192 any PNG icon');
  assert.ok(sizesFound.has('512x512:any'), 'Must declare 512x512 any PNG icon');
  assert.ok(sizesFound.has('512x512:maskable'), 'Must declare 512x512 maskable PNG icon');

  const appleTouchDims = readPngDimensions(path.join(ROOT, 'pwa', 'icons', 'apple-touch-icon.png'));
  assert.equal(appleTouchDims.width, 180);
  assert.equal(appleTouchDims.height, 180);
});

test('2. Platform isolation enables PWA ONLY in production standalone web builds', () => {
  const prodWeb = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    isProdBuild: true,
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
  });
  assert.equal(prodWeb.pwaEnabled, true);

  const devWeb = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    isProdBuild: false,
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
  });
  assert.equal(devWeb.pwaEnabled, false);

  const ytBuild = resolvePlatformCapabilities({
    buildTarget: 'youtube',
    isProdBuild: true,
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
  });
  assert.equal(ytBuild.pwaEnabled, false);

  const ytRuntime = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    isProdBuild: true,
    inYouTubePlayablesEnv: true,
    isNativeAndroid: false,
  });
  assert.equal(ytRuntime.pwaEnabled, false);

  const androidBuild = resolvePlatformCapabilities({
    buildTarget: 'android',
    isProdBuild: true,
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
  });
  assert.equal(androidBuild.pwaEnabled, false);

  const androidRuntime = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    isProdBuild: true,
    inYouTubePlayablesEnv: false,
    isNativeAndroid: true,
  });
  assert.equal(androidRuntime.pwaEnabled, false);
});

test('3. Standalone detection, iOS navigator.standalone, and platform install guide detection work accurately', () => {
  assert.equal(
    isStandaloneDisplayMode({
      matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' }) as MediaQueryList,
      navigator: {} as Navigator,
    }),
    true
  );
  assert.equal(
    isStandaloneDisplayMode({
      matchMedia: () => ({ matches: false }) as MediaQueryList,
      navigator: { standalone: true } as unknown as Navigator,
    }),
    true
  );
  assert.equal(
    isStandaloneDisplayMode({
      matchMedia: () => ({ matches: false }) as MediaQueryList,
      navigator: { standalone: false } as unknown as Navigator,
    }),
    false
  );

  assert.equal(
    detectInstallGuidePlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', 5),
    'android_chrome'
  );
  assert.equal(
    detectInstallGuidePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', 5),
    'ios_safari'
  );
  // iPadOS Safari reports Macintosh UA with maxTouchPoints > 1
  assert.equal(
    detectInstallGuidePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 5),
    'ios_safari'
  );
  assert.equal(
    detectInstallGuidePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36', 0),
    'desktop'
  );
});

test('4. Service worker registration enforces standalone production gating, root scope, and updateViaCache: none', async () => {
  const registered: Array<{ url: string; options?: unknown }> = [];
  let updateFoundTriggered = false;

  const mockReg: ServiceWorkerRegistrationLike = {
    waiting: { postMessage() {} },
    installing: null,
    scope: '/',
    addEventListener() {},
  };

  const mockSw: ServiceWorkerContainerLike = {
    controller: {},
    async register(url, options) {
      registered.push({ url, options });
      return mockReg;
    },
    addEventListener() {},
  };

  // Blocked in dev mode
  const devResult = await registerStandaloneServiceWorker({
    capabilities: resolvePlatformCapabilities({ buildTarget: 'standalone', isProdBuild: false }),
    serviceWorker: mockSw,
    location: { protocol: 'https:', hostname: 'awang-keli-multiplayer.onrender.com' },
  });
  assert.equal(devResult, null);
  assert.equal(registered.length, 0);

  // Blocked on insecure non-localhost HTTP
  assert.equal(isSecureOriginForSw({ protocol: 'http:', hostname: 'example.com' }), false);
  const insecureResult = await registerStandaloneServiceWorker({
    capabilities: resolvePlatformCapabilities({ buildTarget: 'standalone', isProdBuild: true }),
    serviceWorker: mockSw,
    location: { protocol: 'http:', hostname: 'example.com' },
  });
  assert.equal(insecureResult, null);
  assert.equal(registered.length, 0);

  // Allowed in production standalone web on HTTPS
  const okResult = await registerStandaloneServiceWorker({
    capabilities: resolvePlatformCapabilities({ buildTarget: 'standalone', isProdBuild: true }),
    serviceWorker: mockSw,
    location: { protocol: 'https:', hostname: 'awang-keli-multiplayer.onrender.com' },
    onUpdateAvailable: () => {
      updateFoundTriggered = true;
    },
  });
  assert.ok(okResult);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].url, '/sw.js');
  assert.deepEqual(registered[0].options, { scope: '/', updateViaCache: 'none' });
  assert.equal(updateFoundTriggered, true);
});

test('5. Service worker install precaches only offline shell/icons, activate deletes only outdated app caches, and never auto-skips waiting', async () => {
  const harness = createSwHarness({
    cacheVersion: 'v1-new',
    initialCaches: {
      'awang-keli-pwa-shell-v1-old': {},
      'awang-keli-pwa-images-v1-old': {},
      'unrelated-other-app-cache': {},
    },
  });

  await harness.dispatchLifecycle('install');
  assert.equal(harness.getSkipWaitingCount(), 0, 'install must not force skipWaiting() during gameplay');
  assert.equal(harness.fetchCalls.length, 3, 'Must precache only offline.html and 2 local icons (not all game assets)');
  assert.ok(harness.cacheStore.has('awang-keli-pwa-shell-v1-new'));

  await harness.dispatchLifecycle('activate');
  assert.equal(harness.cacheStore.has('awang-keli-pwa-shell-v1-old'), false);
  assert.equal(harness.cacheStore.has('awang-keli-pwa-images-v1-old'), false);
  assert.equal(harness.cacheStore.has('unrelated-other-app-cache'), true, 'Must preserve unrelated caches');

  // Explicit menu-triggered update activates waiting worker
  harness.dispatchMessage({ type: 'SKIP_WAITING' });
  assert.equal(harness.getSkipWaitingCount(), 1);
});

test('6. Service worker never intercepts /api/*, WebSocket traffic, non-GET requests, cross-origin requests, or game JS bundles', async () => {
  const harness = createSwHarness();
  await harness.dispatchLifecycle('install');

  const excludedCases = [
    { url: '/api/health', method: 'GET' },
    { url: '/api/rooms', method: 'GET' },
    { url: '/api/leaderboard?region=MY', method: 'GET' },
    { url: '/api/leaderboard', method: 'POST' },
    { url: '/ws', method: 'GET', headers: { upgrade: 'websocket' } },
    { url: '/assets/index-abc123.js', method: 'GET' },
    { url: '/assets/aistudio/Panggilan_Lubuk_Hitam_8b130ca5.dat', method: 'GET' },
    { url: 'https://www.youtube.com/game_api/v1', method: 'GET' },
    { url: 'https://fonts.googleapis.com/css2?family=Fraunces', method: 'GET' },
  ];

  for (const tc of excludedCases) {
    const res = await harness.dispatchFetch(tc);
    assert.equal(res.intercepted, false, `SW must NOT intercept ${tc.method} ${tc.url}`);
  }
});

test('7. Navigation stays network-fresh (preserving room URLs), passes through server 500 without caching, and serves offline.html on network failure', async () => {
  let mode: 'online' | 'server_500' | 'offline' = 'online';
  const harness = createSwHarness({
    fetchImpl: async (req) => {
      if (req.url.endsWith('/offline.html')) {
        return makeMockResponse(fs.readFileSync(path.join(ROOT, 'pwa', 'offline.html'), 'utf8'), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (req.url.includes('/pwa/')) {
        return makeMockResponse(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'image/png', 'content-length': '3' },
        });
      }
      if (mode === 'online') {
        return makeMockResponse(`<html>LIVE:${req.url}</html>`, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (mode === 'server_500') {
        return makeMockResponse('Internal Server Error', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        });
      }
      throw new TypeError('Failed to fetch');
    },
  });

  await harness.dispatchLifecycle('install');

  // Online navigation with room query param
  const onlineRes = await harness.dispatchFetch({ url: '/?room=WK999', mode: 'navigate' });
  assert.equal(onlineRes.intercepted, true);
  assert.equal(onlineRes.response?.status, 200);
  assert.match(await onlineRes.response!.text(), /LIVE:.*\/\?room=WK999/);
  assert.equal(
    harness.cacheStore.get('awang-keli-pwa-images-v1-test')?.size ?? 0,
    0,
    'Game HTML must never be cached'
  );

  // Server 500 error: returned directly, not cached, not masked as offline.html
  mode = 'server_500';
  const errRes = await harness.dispatchFetch({ url: '/?room=WK999', mode: 'navigate' });
  assert.equal(errRes.response?.status, 500);

  // Network offline: returns precached offline.html
  mode = 'offline';
  const offlineRes = await harness.dispatchFetch({ url: '/?room=WK999', mode: 'navigate' });
  assert.equal(offlineRes.response?.status, 200);
  const offlineHtml = await offlineRes.response!.text();
  assert.match(offlineHtml, /Internet Connection Required/);
  assert.match(offlineHtml, /Try Again/);

  // Recovery when back online
  mode = 'online';
  const recoveredRes = await harness.dispatchFetch({ url: '/?room=WK999', mode: 'navigate' });
  assert.equal(recoveredRes.response?.status, 200);
  assert.match(await recoveredRes.response!.text(), /LIVE:.*\/\?room=WK999/);
});

test('8. Allowlisted image caching clones responses cleanly, enforces byte/entry limits, uses sync waitUntil, and survives cache failures', async () => {
  // 8a. Normal image + oversized image + entry limit (> 28 images)
  const harness = createSwHarness({
    fetchImpl: async (req) => {
      if (req.url.endsWith('/offline.html')) {
        return makeMockResponse('<html>offline</html>', { headers: { 'content-type': 'text/html' } });
      }
      if (req.url.includes('oversized.webp')) {
        const big = new Uint8Array(2 * 1024 * 1024);
        return makeMockResponse(big, {
          headers: { 'content-type': 'image/webp', 'content-length': String(big.byteLength) },
        });
      }
      return makeMockResponse(new Uint8Array([9, 8, 7, 6]), {
        headers: { 'content-type': 'image/webp', 'content-length': '4' },
      });
    },
  });
  await harness.dispatchLifecycle('install');

  // Verify response body remains readable (was cloned before caching) & waitUntil is synchronous
  const imgResult = await harness.dispatchFetch({ url: '/assets/sprites/keli_lv1.png' });
  assert.equal(imgResult.intercepted, true);
  assert.equal(imgResult.asyncWaitUntilCalled, false, 'event.waitUntil must be registered synchronously');
  assert.equal(imgResult.response?.bodyUsed, false, 'Returned response must not be consumed by cache logic');
  const bytes = new Uint8Array(await imgResult.response!.arrayBuffer());
  assert.deepEqual(Array.from(bytes), [9, 8, 7, 6]);

  // Oversized image (> 1.5 MiB) is delivered to caller but NOT cached
  const bigResult = await harness.dispatchFetch({ url: '/assets/aistudio/oversized.webp' });
  assert.equal(bigResult.response?.status, 200);
  assert.equal(
    harness.cacheStore.get('awang-keli-pwa-images-v1-test')?.has('https://awang-keli-multiplayer.onrender.com/assets/aistudio/oversized.webp'),
    false,
    'Oversized image must not be stored in IMAGE_CACHE'
  );

  // Entry limit cap (MAX_IMAGE_ENTRIES = 28)
  for (let i = 0; i < 34; i += 1) {
    await harness.dispatchFetch({ url: `/assets/sprites/keli_test_${i}.png` });
  }
  const cacheSize = harness.cacheStore.get('awang-keli-pwa-images-v1-test')?.size ?? 0;
  assert.ok(cacheSize <= 28 && cacheSize > 0, `IMAGE_CACHE must stay capped at <= 28 entries (got ${cacheSize})`);

  // 8b. Cache write failure (QuotaExceededError) must NEVER break a successful network response
  const failingCacheHarness = createSwHarness({
    failCachePut: true,
    fetchImpl: async () =>
      makeMockResponse(new Uint8Array([4, 3, 2, 1]), {
        headers: { 'content-type': 'image/webp', 'content-length': '4' },
      }),
  });
  const resilientRes = await failingCacheHarness.dispatchFetch({ url: '/assets/sprites/keli_lv10.png' });
  assert.equal(resilientRes.response?.status, 200);
  assert.deepEqual(Array.from(new Uint8Array(await resilientRes.response!.arrayBuffer())), [4, 3, 2, 1]);
});

test('9. Build output isolation: standalone dist/ includes stamped PWA artifacts while dist-youtube/ excludes all PWA files', () => {
  const distDir = path.join(ROOT, 'dist');
  if (fs.existsSync(path.join(distDir, 'manifest.webmanifest'))) {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/pwa\/apple-touch-icon\.png"/);
    assert.ok(fs.existsSync(path.join(distDir, 'offline.html')));
    assert.ok(fs.existsSync(path.join(distDir, 'sw.js')));
    const swText = fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8');
    assert.equal(swText.includes('__PWA_CACHE_VERSION__'), false, 'Built sw.js must have stamped cache version');
    assert.ok(fs.existsSync(path.join(distDir, 'pwa', 'pwa-192x192.png')));
    assert.ok(fs.existsSync(path.join(distDir, 'pwa', 'pwa-512x512.png')));
    assert.ok(fs.existsSync(path.join(distDir, 'pwa', 'pwa-maskable-512x512.png')));
    assert.ok(fs.existsSync(path.join(distDir, 'pwa', 'apple-touch-icon.png')));
  }

  const distYt = path.join(ROOT, 'dist-youtube');
  if (fs.existsSync(distYt)) {
    const ytHtml = fs.readFileSync(path.join(distYt, 'index.html'), 'utf8');
    assert.equal(/rel=["']manifest["']/i.test(ytHtml), false, 'YouTube build must not link PWA manifest');
    assert.equal(fs.existsSync(path.join(distYt, 'manifest.webmanifest')), false);
    assert.equal(fs.existsSync(path.join(distYt, 'sw.js')), false);
    assert.equal(fs.existsSync(path.join(distYt, 'offline.html')), false);
    assert.equal(fs.existsSync(path.join(distYt, 'pwa')), false);
  }
});

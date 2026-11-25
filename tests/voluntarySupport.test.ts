import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolvePlatformCapabilities } from '../src/game/platform.ts';
import {
  resetSupportDiagnosticCache,
  resolveVoluntarySupportConfig,
  validateHttpsSupportUrl,
} from '../src/game/support.ts';
import { SUPPORT_COPY } from '../src/components/VoluntarySupportControl.tsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_STRIPE_URL = 'https://buy.stripe.com/5kQ9ASgXJ1q91tv3Iv2B200';

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

test('1. HTTPS URL validator accepts valid https URLs and rejects insecure or malformed schemes', () => {
  assert.equal(validateHttpsSupportUrl(DEFAULT_STRIPE_URL), DEFAULT_STRIPE_URL);
  assert.equal(
    validateHttpsSupportUrl('  https://support.example.com/checkout?ref=web  '),
    'https://support.example.com/checkout?ref=web'
  );

  // Reject insecure, script, malformed, or credential-bearing URLs
  const rejected = [
    '',
    '   ',
    'http://buy.stripe.com/5kQ9ASgXJ1q91tv3Iv2B200',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://buy.stripe.com/test',
    'buy.stripe.com/5kQ9ASgXJ1q91tv3Iv2B200',
    'https://localhost/test',
    'https://user:pass@buy.stripe.com/test',
    'https://buy.stripe.com/path with spaces',
    'not a url',
  ];
  for (const bad of rejected) {
    assert.equal(validateHttpsSupportUrl(bad), null, `Expected URL to be rejected: ${bad}`);
  }
});

test('2. Standalone web defaults to the exact Stripe checkout link and keeps multiplayer free', () => {
  const webProdCaps = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
    isProdBuild: true,
  });

  assert.equal(webProdCaps.voluntarySupportEnabled, true);
  assert.equal(webProdCaps.onlineMultiplayerEnabled, true);
  assert.equal(webProdCaps.pwaEnabled, true);

  const cfg = resolveVoluntarySupportConfig({
    capabilities: webProdCaps,
    overrideUrl: '',
    defaultUrl: DEFAULT_STRIPE_URL,
  });

  assert.equal(cfg.enabled, true);
  assert.equal(cfg.url, DEFAULT_STRIPE_URL);
  assert.equal(cfg.isOverride, false);
  assert.equal(cfg.reason, 'enabled_default');
  assert.equal(cfg.diagnostic, null);
});

test('3. Valid VITE_SUPPORT_URL override replaces the default destination', () => {
  const webCaps = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
    isProdBuild: true,
  });

  const override = 'https://buy.stripe.com/custom_test_link';
  const cfg = resolveVoluntarySupportConfig({
    capabilities: webCaps,
    overrideUrl: override,
    defaultUrl: DEFAULT_STRIPE_URL,
  });

  assert.equal(cfg.enabled, true);
  assert.equal(cfg.url, override);
  assert.equal(cfg.isOverride, true);
  assert.equal(cfg.reason, 'enabled_override');
  assert.equal(cfg.diagnostic, null);
});

test('4. Invalid explicit VITE_SUPPORT_URL override safely hides support and emits dev diagnostic', () => {
  resetSupportDiagnosticCache();
  const webCaps = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
    isProdBuild: false,
  });

  const diagnostics: string[] = [];
  const cfg = resolveVoluntarySupportConfig({
    capabilities: webCaps,
    overrideUrl: 'http://insecure.example.com/pay',
    defaultUrl: DEFAULT_STRIPE_URL,
    isDev: true,
    warn: (msg) => diagnostics.push(msg),
  });

  assert.equal(cfg.enabled, false);
  assert.equal(cfg.url, null);
  assert.equal(cfg.isOverride, true);
  assert.equal(cfg.reason, 'invalid_override');
  assert.ok(cfg.diagnostic && cfg.diagnostic.includes('VITE_SUPPORT_URL'));
  assert.equal(diagnostics.length, 1);
});

test('5. Platform isolation disables voluntary support on Android and YouTube Playables (build & runtime)', () => {
  const youtubeBuild = resolvePlatformCapabilities({
    buildTarget: 'youtube',
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
    isProdBuild: true,
  });
  const youtubeRuntime = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    inYouTubePlayablesEnv: true,
    isNativeAndroid: false,
    isProdBuild: true,
  });
  const androidBuild = resolvePlatformCapabilities({
    buildTarget: 'android',
    inYouTubePlayablesEnv: false,
    isNativeAndroid: false,
    isProdBuild: true,
  });
  const androidRuntime = resolvePlatformCapabilities({
    buildTarget: 'standalone',
    inYouTubePlayablesEnv: false,
    isNativeAndroid: true,
    isProdBuild: true,
  });

  for (const caps of [youtubeBuild, youtubeRuntime, androidBuild, androidRuntime]) {
    assert.equal(caps.voluntarySupportEnabled, false);
    const cfg = resolveVoluntarySupportConfig({
      capabilities: caps,
      overrideUrl: DEFAULT_STRIPE_URL,
      defaultUrl: DEFAULT_STRIPE_URL,
    });
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.url, null);
    assert.equal(cfg.reason, 'platform_disabled');
  }
});

test('6. Exact Bahasa Malaysia copy, external link safety, and non-advertising compliance in source', () => {
  assert.equal(SUPPORT_COPY.buttonLabel, 'Belanja Keli Makan 🐟');
  assert.equal(SUPPORT_COPY.panelTitle, 'Belanja Keli Makan 🐟');
  assert.equal(
    SUPPORT_COPY.description,
    'Suka main AWANG KELI? Belanja keli makan untuk membantu pembangunan game dan kos server multiplayer.'
  );
  assert.equal(
    SUPPORT_COPY.supportingText,
    'Sokongan anda adalah sukarela. Semua pemain tetap boleh bermain secara percuma. Tiada kelebihan gameplay diberikan.'
  );
  assert.equal(SUPPORT_COPY.primaryCta, 'Sokong melalui Stripe');
  assert.equal(SUPPORT_COPY.secondaryCta, 'Teruskan bermain');

  const componentSrc = fs.readFileSync(
    path.join(ROOT, 'src/components/VoluntarySupportControl.tsx'),
    'utf8'
  );
  assert.match(componentSrc, /target="_blank"/);
  assert.match(componentSrc, /rel="noopener noreferrer"/);
  assert.match(componentSrc, /role="dialog"/);
  assert.match(componentSrc, /aria-modal="true"/);
  assert.match(componentSrc, /e\.key === 'Escape'/);
  assert.doesNotMatch(componentSrc, /localStorage|sessionStorage|window\.open|charity|tax-deductible/i);

  // Verify zero advertising scripts or SDK references exist in index.html, src/, or pwa/
  const adPattern = /adsbygoogle|googlesyndication|doubleclick\.net|pagead2|admob|h5games/i;
  const checkFiles = [
    path.join(ROOT, 'index.html'),
    ...walkFiles(path.join(ROOT, 'src')).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')),
    ...walkFiles(path.join(ROOT, 'pwa')).filter((f) => f.endsWith('.js') || f.endsWith('.html')),
  ];
  for (const file of checkFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(adPattern.test(content), false, `Unexpected ad reference in ${file}`);
  }
});

test('7. Service worker never intercepts or caches Stripe checkout or payment requests', () => {
  const swSource = fs
    .readFileSync(path.join(ROOT, 'pwa/sw.js'), 'utf8')
    .replace(/__PWA_CACHE_VERSION__/g, 'v1-support-test');

  const listeners = new Map<string, (ev: any) => void>();
  const sandbox: any = {
    URL,
    Response,
    Headers,
    Promise,
    self: {
      location: { origin: 'https://awang-keli-multiplayer.onrender.com' },
      addEventListener: (type: string, cb: (ev: any) => void) => listeners.set(type, cb),
      skipWaiting: () => Promise.resolve(),
    },
    caches: {
      open: async () => ({ match: async () => undefined, put: async () => undefined }),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async () => new Response('ok', { status: 200 }),
  };

  vm.runInNewContext(swSource, sandbox);
  const fetchHandler = listeners.get('fetch');
  assert.ok(fetchHandler);

  const nonInterceptedRequests = [
    { url: DEFAULT_STRIPE_URL, method: 'GET', mode: 'navigate' },
    { url: 'https://js.stripe.com/v3/', method: 'GET', mode: 'no-cors' },
    { url: 'https://checkout.stripe.com/c/pay/cs_test', method: 'GET', mode: 'navigate' },
    { url: 'https://awang-keli-multiplayer.onrender.com/checkout', method: 'GET', mode: 'navigate' },
    { url: 'https://awang-keli-multiplayer.onrender.com/stripe/return', method: 'GET', mode: 'navigate' },
    { url: 'https://awang-keli-multiplayer.onrender.com/payment/status', method: 'GET', mode: 'cors' },
  ];

  for (const spec of nonInterceptedRequests) {
    let responded = false;
    fetchHandler({
      request: {
        url: spec.url,
        method: spec.method,
        mode: spec.mode,
        headers: new Headers(),
      },
      respondWith: () => {
        responded = true;
      },
      waitUntil: () => {},
    });
    assert.equal(responded, false, `Service worker must not intercept ${spec.url}`);
  }
});

test('8. Build bundle verification: standalone dist/ contains Stripe default while dist-youtube/ excludes it', () => {
  const standaloneDist = path.join(ROOT, 'dist');
  const youtubeDist = path.join(ROOT, 'dist-youtube');

  if (fs.existsSync(standaloneDist)) {
    const jsFiles = walkFiles(standaloneDist).filter((f) => f.endsWith('.js'));
    const combinedStandalone = jsFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    assert.equal(
      combinedStandalone.includes(DEFAULT_STRIPE_URL),
      true,
      'Standalone dist/ bundle should contain the default Stripe checkout URL'
    );
    assert.equal(
      /adsbygoogle|googlesyndication|doubleclick\.net/i.test(combinedStandalone),
      false,
      'Standalone dist/ bundle must not contain ad scripts'
    );
  }

  if (fs.existsSync(youtubeDist)) {
    const ytFiles = walkFiles(youtubeDist).filter(
      (f) => f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.css')
    );
    const combinedYt = ytFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    assert.equal(
      /stripe\.com|5kQ9ASgXJ1q91tv3Iv2B200/i.test(combinedYt),
      false,
      'dist-youtube/ must completely exclude Stripe checkout URLs'
    );
    assert.equal(
      /adsbygoogle|googlesyndication|doubleclick\.net/i.test(combinedYt),
      false,
      'dist-youtube/ must not contain ad scripts'
    );
  }
});

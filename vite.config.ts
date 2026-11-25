import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

const DEFAULT_STANDALONE_SUPPORT_URL = 'https://buy.stripe.com/5kQ9ASgXJ1q91tv3Iv2B200';

const UNREFERENCED_LEGACY_YOUTUBE_PNGS = [
  'awang_keli_phase1.png_e5238957.png',
  'awang_keli_phase2.png_a021e2c3.png',
  'awang_keli_phase3.png_24f06a17.png',
  'Awang_Keli_Retro_Fishing_Props_Atlas_eca1bf72.png',
  'Keli_King_Idle_and_Victory_Sprite_Sheet_adf2a2ce.png',
  'Phase_2_and_3_catfish_sprite_atlas_1e786473.png',
];

const ROOT_DIR = import.meta.dirname;

export default defineConfig(({ command, mode }) => {
  const rawTarget = (process.env.BUILD_TARGET || 'standalone').toLowerCase();
  const buildTarget =
    rawTarget === 'youtube' || rawTarget === 'android' ? rawTarget : 'standalone';
  const isYouTube = buildTarget === 'youtube';
  const isStandalone = buildTarget === 'standalone';
  const isStandaloneProd = command === 'build' && isStandalone;
  const outDir = isYouTube ? 'dist-youtube' : 'dist';
  const releaseSeed = (process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || '').slice(0, 10);
  const pwaCacheVersion = `v1-${releaseSeed ? `${releaseSeed}-` : ''}${Date.now().toString(36)}`;

  const loadedViteEnv = loadEnv(mode, ROOT_DIR, 'VITE_');
  const rawSupportOverride = isStandalone
    ? (process.env.VITE_SUPPORT_URL ?? loadedViteEnv.VITE_SUPPORT_URL ?? '')
    : '';

  if (!isStandalone && 'VITE_SUPPORT_URL' in process.env) {
    delete process.env.VITE_SUPPORT_URL;
  }

  return {
    base: './',
    define: {
      __BUILD_TARGET__: JSON.stringify(buildTarget),
      __CORE_VERSION__: JSON.stringify('1.0.0-core-freeze'),
      __PWA_ENABLED__: JSON.stringify(isStandaloneProd),
      __PWA_CACHE_VERSION__: JSON.stringify(isStandaloneProd ? pwaCacheVersion : ''),
      __VOLUNTARY_SUPPORT_ENABLED__: JSON.stringify(isStandalone),
      __DEFAULT_SUPPORT_URL__: JSON.stringify(isStandalone ? DEFAULT_STANDALONE_SUPPORT_URL : ''),
      __SUPPORT_URL_OVERRIDE__: JSON.stringify(rawSupportOverride),
      ...(!isStandalone ? { 'import.meta.env.VITE_SUPPORT_URL': JSON.stringify('') } : {}),
    },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/three')) return 'three-vendor';
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react-vendor';
            }
            return undefined;
          },
        },
      },
    },
    plugins: [
      {
        name: 'strip-non-standalone-support-env',
        configResolved(resolvedConfig) {
          if (!isStandalone && resolvedConfig.env && 'VITE_SUPPORT_URL' in resolvedConfig.env) {
            delete resolvedConfig.env.VITE_SUPPORT_URL;
          }
        },
      },
      react(),
      tailwindcss(),
      // Standalone production Web PWA transform & asset emitter:
      // - Strictly active ONLY when `command === 'build' && buildTarget === 'standalone'`.
      // - Excluded from dev mode, Android Capacitor builds, and YouTube Playables builds.
      {
        name: 'standalone-pwa-build',
        transformIndexHtml(html: string) {
          if (!isStandaloneProd) return html;
          const pwaTags = [
            '    <meta name="apple-mobile-web-app-capable" content="yes" />',
            '    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
            '    <meta name="apple-mobile-web-app-title" content="Awang Keli" />',
            '    <link rel="apple-touch-icon" sizes="180x180" href="/pwa/apple-touch-icon.png" />',
            '    <link rel="manifest" href="/manifest.webmanifest" />',
          ].join('\n');
          return html.replace(
            '<meta name="mobile-web-app-capable" content="yes" />',
            `<meta name="mobile-web-app-capable" content="yes" />\n${pwaTags}`
          );
        },
        closeBundle(error?: Error): void {
          if (error || !isStandaloneProd) return;
          const resolvedOutDir = path.resolve(ROOT_DIR, outDir);
          const pwaSrcDir = path.resolve(ROOT_DIR, 'pwa');
          const pwaIconsSrcDir = path.join(pwaSrcDir, 'icons');
          const pwaIconsOutDir = path.join(resolvedOutDir, 'pwa');

          if (!fs.existsSync(resolvedOutDir) || !fs.existsSync(pwaSrcDir)) return;

          // Copy manifest and lightweight offline fallback page
          fs.copyFileSync(
            path.join(pwaSrcDir, 'manifest.webmanifest'),
            path.join(resolvedOutDir, 'manifest.webmanifest')
          );
          fs.copyFileSync(
            path.join(pwaSrcDir, 'offline.html'),
            path.join(resolvedOutDir, 'offline.html')
          );

          // Stamp a unique cache version into the standalone service worker per build
          const swTemplate = fs.readFileSync(path.join(pwaSrcDir, 'sw.js'), 'utf8');
          const stampedSw = swTemplate.replace(/__PWA_CACHE_VERSION__/g, pwaCacheVersion);
          fs.writeFileSync(path.join(resolvedOutDir, 'sw.js'), stampedSw, 'utf8');

          // Copy approved PNG icon variants into dist/pwa/
          if (fs.existsSync(pwaIconsSrcDir)) {
            fs.mkdirSync(pwaIconsOutDir, { recursive: true });
            for (const entry of fs.readdirSync(pwaIconsSrcDir)) {
              if (!entry.endsWith('.png')) continue;
              fs.copyFileSync(
                path.join(pwaIconsSrcDir, entry),
                path.join(pwaIconsOutDir, entry)
              );
            }
          }
        },
      },
      // YouTube Playables build compliance transform:
      // 1. Inject official YouTube Playables SDK script BEFORE any game script tags.
      // 2. Strip external Google Fonts CDN links so zero unauthorized network calls occur.
      {
        name: 'youtube-playables-html-transform',
        transformIndexHtml(html: string) {
          if (!isYouTube) return html;
          let transformed = html
            .replace(/<link[^>]*fonts\.googleapis\.com[^>]*>\s*/gi, '')
            .replace(/<link[^>]*fonts\.gstatic\.com[^>]*>\s*/gi, '');
          const sdkTag = '    <script src="https://www.youtube.com/game_api/v1"></script>';
          if (!transformed.includes('https://www.youtube.com/game_api/v1')) {
            transformed = transformed.replace(
              '<meta charset="UTF-8" />',
              `<meta charset="UTF-8" />\n${sdkTag}`
            );
          }
          return transformed;
        },
      },
      // Copies src/assets into output dir so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Also prunes unreferenced legacy PNG backups from YouTube output.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const resolvedOutDir = path.resolve(ROOT_DIR, outDir);
          const srcAssets = path.resolve(ROOT_DIR, 'src/assets');
          const distAssets = path.resolve(resolvedOutDir, 'src/assets');
          if (fs.existsSync(resolvedOutDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
          }

          if (isYouTube) {
            const aiStudioDir = path.resolve(resolvedOutDir, 'assets/aistudio');
            if (fs.existsSync(aiStudioDir)) {
              for (const legacyPng of UNREFERENCED_LEGACY_YOUTUBE_PNGS) {
                const candidate = path.join(aiStudioDir, legacyPng);
                if (fs.existsSync(candidate)) {
                  fs.unlinkSync(candidate);
                }
              }
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(ROOT_DIR, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

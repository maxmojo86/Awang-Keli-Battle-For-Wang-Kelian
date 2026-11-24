import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

const UNREFERENCED_LEGACY_YOUTUBE_PNGS = [
  'awang_keli_phase1.png_e5238957.png',
  'awang_keli_phase2.png_a021e2c3.png',
  'awang_keli_phase3.png_24f06a17.png',
  'Awang_Keli_Retro_Fishing_Props_Atlas_eca1bf72.png',
  'Keli_King_Idle_and_Victory_Sprite_Sheet_adf2a2ce.png',
  'Phase_2_and_3_catfish_sprite_atlas_1e786473.png',
];

const ROOT_DIR = import.meta.dirname;

export default defineConfig(() => {
  const rawTarget = (process.env.BUILD_TARGET || 'standalone').toLowerCase();
  const buildTarget =
    rawTarget === 'youtube' || rawTarget === 'android' ? rawTarget : 'standalone';
  const isYouTube = buildTarget === 'youtube';
  const outDir = isYouTube ? 'dist-youtube' : 'dist';

  return {
    base: './',
    define: {
      __BUILD_TARGET__: JSON.stringify(buildTarget),
      __CORE_VERSION__: JSON.stringify('1.0.0-core-freeze'),
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
      react(),
      tailwindcss(),
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

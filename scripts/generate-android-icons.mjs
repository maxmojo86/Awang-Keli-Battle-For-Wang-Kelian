#!/usr/bin/env node
/**
 * Generates Android launcher icons, adaptive icon foreground/background layers,
 * Capacitor splash screens, and the 512x512 Google Play Store icon from the
 * supplied game icon (public/favicon.ico, a 1024x1024 PNG).
 *
 * Uses ImageMagick (`magick` on Windows/macOS/Linux v7, or `convert` on Linux v6).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const SOURCE_ICON = path.join(ROOT, 'public', 'favicon.ico');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const RESOURCES_DIR = path.join(ROOT, 'resources');

function findImageMagickCommand() {
  for (const cmd of ['magick', 'convert']) {
    try {
      execFileSync(cmd, ['-version'], { stdio: 'ignore' });
      return cmd;
    } catch {
      // Try next binary
    }
  }
  throw new Error(
    'ImageMagick is required to regenerate Android icons. Install ImageMagick (https://imagemagick.org) so `magick` or `convert` is available on PATH.'
  );
}

const IM = findImageMagickCommand();

function runIM(args) {
  execFileSync(IM, args, { stdio: 'pipe' });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

if (!fs.existsSync(SOURCE_ICON)) {
  throw new Error(`Supplied icon not found at ${SOURCE_ICON}`);
}
if (!fs.existsSync(ANDROID_RES)) {
  throw new Error(
    `Android res directory not found at ${ANDROID_RES}. Run "npx cap add android" first.`
  );
}

ensureDir(RESOURCES_DIR);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awang-keli-icons-'));

try {
  // 1. Master icons for Capacitor / Google Play Store
  const baseIcon1024 = path.join(RESOURCES_DIR, 'icon.png');
  const playStore512 = path.join(RESOURCES_DIR, 'play-store-icon-512.png');

  runIM([`png:${SOURCE_ICON}`, '-resize', '1024x1024!', 'PNG32:' + baseIcon1024]);
  runIM([`png:${SOURCE_ICON}`, '-resize', '512x512!', 'PNG32:' + playStore512]);

  // 2. Master 432x432 adaptive background & foreground layers
  // Adaptive icon canvas = 108dp (432px @ xxxhdpi).
  // Visible mask = 72dp (288px); guaranteed circular safe zone = 66dp (264px).
  const masterBg = path.join(RESOURCES_DIR, 'icon-background.png');
  const masterFg = path.join(RESOURCES_DIR, 'icon-foreground.png');

  // Deep Wang Kelian dark-teal radial gradient matching the water edges of the emblem
  runIM([
    '-size',
    '432x432',
    'radial-gradient:#10393b-#050f14',
    '-modulate',
    '100,105,100',
    'PNG32:' + masterBg,
  ]);

  // Create a soft circular alpha mask for the 284x284 centered emblem so it sits
  // cleanly inside the 66dp-72dp adaptive safe zone with feathered edges for parallax.
  const fgArt = path.join(tmpDir, 'fg-art.png');
  const fgMask = path.join(tmpDir, 'fg-mask.png');
  const fgMasked = path.join(tmpDir, 'fg-masked.png');

  runIM([`png:${SOURCE_ICON}`, '-resize', '284x284!', '-alpha', 'set', 'PNG32:' + fgArt]);
  runIM([
    '-size',
    '284x284',
    'xc:none',
    '-fill',
    'white',
    '-draw',
    'circle 142,142 142,10',
    '-channel',
    'A',
    '-blur',
    '0x8',
    '+channel',
    'PNG32:' + fgMask,
  ]);
  runIM([fgArt, fgMask, '-compose', 'DstIn', '-composite', 'PNG32:' + fgMasked]);
  runIM([
    '-size',
    '432x432',
    'xc:none',
    fgMasked,
    '-gravity',
    'center',
    '-compose',
    'Over',
    '-composite',
    'PNG32:' + masterFg,
  ]);

  // 3. Density-specific mipmap icons (legacy rounded square, legacy round, adaptive layers)
  const MIPMAPS = [
    { dir: 'mipmap-mdpi', legacy: 48, adaptive: 108 },
    { dir: 'mipmap-hdpi', legacy: 72, adaptive: 162 },
    { dir: 'mipmap-xhdpi', legacy: 96, adaptive: 216 },
    { dir: 'mipmap-xxhdpi', legacy: 144, adaptive: 324 },
    { dir: 'mipmap-xxxhdpi', legacy: 192, adaptive: 432 },
  ];

  for (const { dir, legacy, adaptive } of MIPMAPS) {
    const outDir = path.join(ANDROID_RES, dir);
    ensureDir(outDir);

    const radius = Math.max(4, Math.round(legacy * 0.16));
    const center = (legacy - 1) / 2;
    const resized = path.join(tmpDir, `legacy-${legacy}.png`);
    const roundRectMask = path.join(tmpDir, `mask-rr-${legacy}.png`);
    const circleMask = path.join(tmpDir, `mask-circle-${legacy}.png`);

    runIM([`png:${SOURCE_ICON}`, '-resize', `${legacy}x${legacy}!`, '-alpha', 'set', 'PNG32:' + resized]);
    runIM([
      '-size',
      `${legacy}x${legacy}`,
      'xc:none',
      '-fill',
      'white',
      '-draw',
      `roundrectangle 0,0 ${legacy - 1},${legacy - 1} ${radius},${radius}`,
      'PNG32:' + roundRectMask,
    ]);
    runIM([
      '-size',
      `${legacy}x${legacy}`,
      'xc:none',
      '-fill',
      'white',
      '-draw',
      `circle ${center},${center} ${center},0`,
      'PNG32:' + circleMask,
    ]);

    runIM([
      resized,
      roundRectMask,
      '-compose',
      'DstIn',
      '-composite',
      'PNG32:' + path.join(outDir, 'ic_launcher.png'),
    ]);
    runIM([
      resized,
      circleMask,
      '-compose',
      'DstIn',
      '-composite',
      'PNG32:' + path.join(outDir, 'ic_launcher_round.png'),
    ]);

    runIM([
      masterFg,
      '-resize',
      `${adaptive}x${adaptive}!`,
      'PNG32:' + path.join(outDir, 'ic_launcher_foreground.png'),
    ]);
    runIM([
      masterBg,
      '-resize',
      `${adaptive}x${adaptive}!`,
      'PNG32:' + path.join(outDir, 'ic_launcher_background.png'),
    ]);
  }

  // 4. Adaptive icon XML descriptors
  const anydpiDir = path.join(ANDROID_RES, 'mipmap-anydpi-v26');
  ensureDir(anydpiDir);
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveXml, 'utf8');
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveXml, 'utf8');

  // 5. Dark basin splash screens for Capacitor SplashScreen
  const SPLASH_TARGETS = [
    { dir: 'drawable', w: 480, h: 320 },
    { dir: 'drawable-port-mdpi', w: 320, h: 480 },
    { dir: 'drawable-port-hdpi', w: 480, h: 800 },
    { dir: 'drawable-port-xhdpi', w: 720, h: 1280 },
    { dir: 'drawable-port-xxhdpi', w: 960, h: 1600 },
    { dir: 'drawable-port-xxxhdpi', w: 1280, h: 1920 },
    { dir: 'drawable-land-mdpi', w: 480, h: 320 },
    { dir: 'drawable-land-hdpi', w: 800, h: 480 },
    { dir: 'drawable-land-xhdpi', w: 1280, h: 720 },
    { dir: 'drawable-land-xxhdpi', w: 1600, h: 960 },
    { dir: 'drawable-land-xxxhdpi', w: 1920, h: 1280 },
  ];

  for (const { dir, w, h } of SPLASH_TARGETS) {
    const outDir = path.join(ANDROID_RES, dir);
    ensureDir(outDir);
    const emblemSize = Math.round(Math.min(w, h) * 0.42);
    const r = Math.round(emblemSize * 0.16);

    const splashBg = path.join(tmpDir, `splash-bg-${w}x${h}.png`);
    const emblemResized = path.join(tmpDir, `splash-emblem-${emblemSize}.png`);
    const emblemMask = path.join(tmpDir, `splash-mask-${emblemSize}.png`);
    const emblemRounded = path.join(tmpDir, `splash-rounded-${emblemSize}.png`);

    runIM(['-size', `${w}x${h}`, 'radial-gradient:#0f262c-#091116', 'PNG32:' + splashBg]);
    runIM([
      `png:${SOURCE_ICON}`,
      '-resize',
      `${emblemSize}x${emblemSize}!`,
      '-alpha',
      'set',
      'PNG32:' + emblemResized,
    ]);
    runIM([
      '-size',
      `${emblemSize}x${emblemSize}`,
      'xc:none',
      '-fill',
      'white',
      '-draw',
      `roundrectangle 0,0 ${emblemSize - 1},${emblemSize - 1} ${r},${r}`,
      'PNG32:' + emblemMask,
    ]);
    runIM([emblemResized, emblemMask, '-compose', 'DstIn', '-composite', 'PNG32:' + emblemRounded]);
    runIM([
      splashBg,
      emblemRounded,
      '-gravity',
      'center',
      '-compose',
      'Over',
      '-composite',
      'PNG32:' + path.join(outDir, 'splash.png'),
    ]);
  }

  console.log(
    'Generated Android launcher icons, adaptive foreground/background layers, splash screens, and 512px Play Store icon.'
  );
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

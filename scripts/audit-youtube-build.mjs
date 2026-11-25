#!/usr/bin/env node
/**
 * Automated YouTube Playables build auditor (`dist-youtube/`).
 *
 * Verifies:
 * 1. Official YouTube Playables SDK script (`https://www.youtube.com/game_api/v1`)
 *    is loaded in `index.html` BEFORE any game module script.
 * 2. Zero external CDN/font links or unexpected external network URLs in `index.html`
 *    and built assets.
 * 3. File size budgets:
 *    - Single file hard cap: 30 MiB
 *    - Initial load hard cap: 30 MiB (15 MiB preferred)
 *    - Total bundle hard cap: 250 MiB
 *    - Large file informational warnings (> 512 KiB)
 * 4. All local relative assets referenced in `src/` exist in `dist-youtube/`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST_YT = path.join(ROOT, 'dist-youtube');

const MIB = 1024 * 1024;
const KIB = 1024;
const MAX_SINGLE_FILE_BYTES = 30 * MIB;
const MAX_INITIAL_BYTES = 30 * MIB;
const PREFERRED_INITIAL_BYTES = 15 * MIB;
const MAX_TOTAL_BYTES = 250 * MIB;
const WARN_FILE_BYTES = 512 * KIB;

const ALLOWED_EXTERNAL_PREFIXES = [
  'https://www.youtube.com/game_api/v1',
  'http://www.w3.org/',
  'https://www.w3.org/',
];

function walkFiles(dir) {
  const out = [];
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

function formatMiB(bytes) {
  return `${(bytes / MIB).toFixed(2)} MiB`;
}

function formatKiB(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

export function auditYouTubeBuild(distDir = DIST_YT) {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(distDir)) {
    return {
      ok: false,
      errors: [`Output directory not found: ${distDir}`],
      warnings,
      metrics: null,
    };
  }

  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    errors.push('Missing index.html in dist-youtube/');
    return { ok: false, errors, warnings, metrics: null };
  }

  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  // 1. Official SDK script presence & ordering
  const sdkNeedle = 'https://www.youtube.com/game_api/v1';
  const sdkIdx = indexHtml.indexOf(sdkNeedle);
  const firstModuleScriptIdx = indexHtml.indexOf('<script type="module"');
  if (sdkIdx === -1) {
    errors.push(`index.html missing official YouTube Playables SDK script (${sdkNeedle})`);
  } else if (firstModuleScriptIdx !== -1 && sdkIdx > firstModuleScriptIdx) {
    errors.push('Official YouTube Playables SDK script must load BEFORE gameplay module scripts');
  }

  // 2. Check index.html for any unauthorized external URLs (fonts, analytics, APIs, WebSockets)
  const htmlUrls = indexHtml.match(/(?:https?|wss?):\/\/[^\s"'<>)]+/gi) || [];
  for (const url of htmlUrls) {
    const allowed = ALLOWED_EXTERNAL_PREFIXES.some((prefix) => url.startsWith(prefix));
    if (!allowed) {
      errors.push(`Unauthorized external URL in index.html: ${url}`);
    }
  }

  // 2b. Verify zero standalone PWA artifacts or manifest links leaked into dist-youtube/
  if (/rel=["']manifest["']/i.test(indexHtml)) {
    errors.push('YouTube Playables index.html must not include a PWA manifest link');
  }
  for (const forbiddenPwaPath of ['manifest.webmanifest', 'sw.js', 'offline.html', 'pwa']) {
    if (fs.existsSync(path.join(distDir, forbiddenPwaPath))) {
      errors.push(`Standalone PWA artifact leaked into dist-youtube/: ${forbiddenPwaPath}`);
    }
  }

  // 3. Walk all built files, check size caps, inspect JS/CSS bundles for unauthorized URLs
  const allFiles = walkFiles(distDir);
  let totalBytes = 0;
  let initialBytes = 0;
  let largestFile = { rel: '', bytes: 0 };
  const largeFiles = [];

  const initialFiles = new Set(['index.html']);
  const linkedRefs = indexHtml.match(/(?:src|href)="(\.[^"]+)"/g) || [];
  for (const ref of linkedRefs) {
    const m = ref.match(/="(\.[^"]+)"/);
    if (m && m[1]) {
      initialFiles.add(m[1].replace(/^\.\//, ''));
    }
  }

  for (const filePath of allFiles) {
    const rel = path.relative(distDir, filePath).replace(/\\/g, '/');
    const stat = fs.statSync(filePath);
    totalBytes += stat.size;
    if (initialFiles.has(rel)) {
      initialBytes += stat.size;
    }
    if (stat.size > largestFile.bytes) {
      largestFile = { rel, bytes: stat.size };
    }
    if (stat.size > MAX_SINGLE_FILE_BYTES) {
      errors.push(`Single file exceeds 30 MiB cap: ${rel} (${formatMiB(stat.size)})`);
    } else if (stat.size > WARN_FILE_BYTES) {
      largeFiles.push({ rel, bytes: stat.size });
    }

    if (rel.endsWith('.js') || rel.endsWith('.css')) {
      const text = fs.readFileSync(filePath, 'utf8');
      // Check for external network endpoints (ignore standard XML namespaces and YouTube SDK URL)
      const matches = text.match(/(?:https?|wss?):\/\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g) || [];
      for (const rawUrl of matches) {
        const url = rawUrl.replace(/[)'"`,;]+$/, '');
        if (ALLOWED_EXTERNAL_PREFIXES.some((p) => url.startsWith(p))) continue;
        // Ignore pure license / docs comments or vendor metadata domains if non-network strings
        if (
          url.startsWith('https://reactjs.org/') ||
          url.startsWith('https://react.dev/') ||
          url.startsWith('https://github.com/mrdoob/three')
        ) {
          continue;
        }
        // Fail on fonts, analytics, APIs, WebSockets, CDNs, Stripe checkout, or ad networks
        if (
          url.startsWith('ws://') ||
          url.startsWith('wss://') ||
          url.includes('fonts.googleapis.com') ||
          url.includes('fonts.gstatic.com') ||
          url.includes('google-analytics') ||
          url.includes('googletagmanager') ||
          url.includes('sentry.io') ||
          url.includes('stripe.com') ||
          url.includes('googlesyndication.com') ||
          url.includes('doubleclick.net') ||
          url.includes('pagead2') ||
          url.includes('/api/')
        ) {
          errors.push(`Forbidden external endpoint in ${rel}: ${url}`);
        }
      }
      if (/buy\.stripe\.com|5kQ9ASgXJ1q91tv3Iv2B200|adsbygoogle|googlesyndication/i.test(text)) {
        errors.push(`Forbidden checkout or advertising reference leaked into ${rel}`);
      }
    }
  }

  if (initialBytes > MAX_INITIAL_BYTES) {
    errors.push(`Initial bundle exceeds 30 MiB hard cap (${formatMiB(initialBytes)})`);
  } else if (initialBytes > PREFERRED_INITIAL_BYTES) {
    warnings.push(`Initial bundle exceeds 15 MiB preferred budget (${formatMiB(initialBytes)})`);
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    errors.push(`Total bundle exceeds 250 MiB hard cap (${formatMiB(totalBytes)})`);
  }

  // 4. Verify local assets referenced via resolveAssetUrl(...) exist in dist-youtube/
  const srcDir = path.join(ROOT, 'src');
  const srcFiles = walkFiles(srcDir).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  const missingAssets = new Set();
  for (const srcFile of srcFiles) {
    const content = fs.readFileSync(srcFile, 'utf8');
    const regex = /resolveAssetUrl\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const assetRel = m[1].replace(/^\/+/, '');
      const expectedPath = path.join(distDir, assetRel);
      if (!fs.existsSync(expectedPath)) {
        missingAssets.add(assetRel);
      }
    }
  }
  for (const missing of missingAssets) {
    errors.push(`Referenced local asset missing in dist-youtube/: ${missing}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      fileCount: allFiles.length,
      totalBytes,
      totalMiB: Number((totalBytes / MIB).toFixed(2)),
      initialBytes,
      initialMiB: Number((initialBytes / MIB).toFixed(2)),
      withinPreferredInitial15MiB: initialBytes <= PREFERRED_INITIAL_BYTES,
      withinTotalPreferred15MiB: totalBytes <= PREFERRED_INITIAL_BYTES,
      largestFile: {
        rel: largestFile.rel,
        bytes: largestFile.bytes,
        label: formatMiB(largestFile.bytes),
      },
      largeFilesOver512KiB: largeFiles.map((f) => ({
        rel: f.rel,
        kib: Number((f.bytes / KIB).toFixed(1)),
      })),
    },
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isCli) {
  const report = auditYouTubeBuild();
  console.log('=== YouTube Playables Build Audit ===');
  if (report.metrics) {
    console.log(`Files:           ${report.metrics.fileCount}`);
    console.log(`Initial Load:    ${report.metrics.initialMiB} MiB (<= 15 MiB preferred: ${report.metrics.withinPreferredInitial15MiB})`);
    console.log(`Total Bundle:    ${report.metrics.totalMiB} MiB (cap: 250 MiB, <= 15 MiB: ${report.metrics.withinTotalPreferred15MiB})`);
    console.log(`Largest File:    ${report.metrics.largestFile.rel} (${report.metrics.largestFile.label})`);
    if (report.metrics.largeFilesOver512KiB.length > 0) {
      console.log(`Files > 512 KiB: ${report.metrics.largeFilesOver512KiB.length}`);
      for (const lf of report.metrics.largeFilesOver512KiB) {
        console.log(`  - ${lf.rel}: ${lf.kib} KiB`);
      }
    }
  }
  if (report.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of report.warnings) console.log(`  [WARN] ${w}`);
  }
  if (report.errors.length > 0) {
    console.error('\nAudit FAILED:');
    for (const e of report.errors) console.error(`  [FAIL] ${e}`);
    process.exit(1);
  }
  console.log('\nAudit PASSED: dist-youtube/ meets YouTube Playables structural packaging checks.');
}

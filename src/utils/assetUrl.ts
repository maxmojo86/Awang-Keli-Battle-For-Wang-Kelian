/**
 * Resolves a public static asset path relative to the current Vite base URL (`./` in production
 * builds for itch.io / arbitrary subdirectory hosting, `/` in local Vite dev server).
 * Safe to import in Node.js server modules where `import.meta.env` may be undefined.
 */
export function resolveAssetUrl(assetPath: string): string {
  const clean = assetPath.replace(/^(\.\/|\/)+/, '');
  const metaEnv = (
    import.meta as ImportMeta & { env?: { BASE_URL?: string } }
  ).env;
  const rawBase = metaEnv?.BASE_URL ?? './';
  const normalizedBase = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  return `${normalizedBase}${clean}`;
}

import { getPlatformCapabilities, type PlatformCapabilities } from './platform.ts';

export type SupportConfigReason =
  | 'enabled_default'
  | 'enabled_override'
  | 'platform_disabled'
  | 'invalid_override'
  | 'missing_url';

export interface VoluntarySupportConfig {
  readonly enabled: boolean;
  readonly url: string | null;
  readonly isOverride: boolean;
  readonly reason: SupportConfigReason;
  readonly diagnostic: string | null;
}

export interface SupportResolutionOptions {
  capabilities?: PlatformCapabilities;
  overrideUrl?: string | null;
  defaultUrl?: string | null;
  isDev?: boolean;
  warn?: (message: string) => void;
}

declare global {
  const __VOLUNTARY_SUPPORT_ENABLED__: boolean | undefined;
  const __DEFAULT_SUPPORT_URL__: string | undefined;
  const __SUPPORT_URL_OVERRIDE__: string | undefined;
}

const warnedDiagnostics = new Set<string>();

function readBuildSupportEnabled(): boolean | null {
  try {
    if (typeof __VOLUNTARY_SUPPORT_ENABLED__ === 'boolean') {
      return __VOLUNTARY_SUPPORT_ENABLED__;
    }
  } catch {
    // Running outside Vite bundle (e.g., Node.js tsx tests)
  }
  return null;
}

function readBuildDefaultSupportUrl(): string {
  try {
    if (typeof __DEFAULT_SUPPORT_URL__ === 'string') {
      return __DEFAULT_SUPPORT_URL__;
    }
  } catch {
    // Running outside Vite bundle
  }
  return '';
}

function readBuildSupportOverride(): string {
  try {
    if (typeof __SUPPORT_URL_OVERRIDE__ === 'string') {
      return __SUPPORT_URL_OVERRIDE__;
    }
  } catch {
    // Running outside Vite bundle
  }
  return '';
}

function detectDevMode(): boolean {
  try {
    const env = (
      import.meta as ImportMeta & { env?: { DEV?: boolean; PROD?: boolean } }
    ).env;
    if (typeof env?.DEV === 'boolean') return env.DEV;
  } catch {
    // Running outside Vite
  }
  return false;
}

/**
 * Validates that a voluntary support destination is a well-formed HTTPS URL
 * with a real hostname and no embedded credentials or control characters.
 */
export function validateHttpsSupportUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject whitespace or ASCII control characters inside the URL string
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname;
  if (!host || !host.includes('.') || host.startsWith('.') || host.endsWith('.')) {
    return null;
  }

  return parsed.toString();
}

/**
 * Resolves the active voluntary support configuration for the current platform.
 *
 * - Strictly disabled for YouTube Playables and native Capacitor Android.
 * - Enabled only for standalone web and its installed PWA.
 * - Uses VITE_SUPPORT_URL override when explicitly set; if an explicit override
 *   fails HTTPS validation, hides the support control rather than falling back.
 */
export function resolveVoluntarySupportConfig(
  options?: SupportResolutionOptions
): VoluntarySupportConfig {
  const caps = options?.capabilities ?? getPlatformCapabilities();

  // Build-time hard gate: non-standalone Vite bundles always keep support disabled.
  if (!options?.capabilities) {
    const buildEnabled = readBuildSupportEnabled();
    if (buildEnabled === false) {
      return {
        enabled: false,
        url: null,
        isOverride: false,
        reason: 'platform_disabled',
        diagnostic: null,
      };
    }
  }

  if (!caps.voluntarySupportEnabled || caps.isYouTubePlayables || caps.isAndroid) {
    return {
      enabled: false,
      url: null,
      isOverride: false,
      reason: 'platform_disabled',
      diagnostic: null,
    };
  }

  const rawOverride =
    options && 'overrideUrl' in options ? options.overrideUrl : readBuildSupportOverride();
  const trimmedOverride = typeof rawOverride === 'string' ? rawOverride.trim() : '';

  if (trimmedOverride.length > 0) {
    const validOverride = validateHttpsSupportUrl(trimmedOverride);
    if (validOverride) {
      return {
        enabled: true,
        url: validOverride,
        isOverride: true,
        reason: 'enabled_override',
        diagnostic: null,
      };
    }

    const diagnostic =
      `[VoluntarySupport] Invalid VITE_SUPPORT_URL override ("${trimmedOverride}"). ` +
      'Expected a valid https:// URL. Voluntary support controls have been hidden.';
    const isDev = options?.isDev ?? detectDevMode();
    if (options?.warn) {
      options.warn(diagnostic);
    } else if (isDev && !warnedDiagnostics.has(diagnostic)) {
      warnedDiagnostics.add(diagnostic);
      console.warn(diagnostic);
    }

    return {
      enabled: false,
      url: null,
      isOverride: true,
      reason: 'invalid_override',
      diagnostic,
    };
  }

  const rawDefault =
    options && 'defaultUrl' in options ? options.defaultUrl : readBuildDefaultSupportUrl();
  const validDefault = validateHttpsSupportUrl(rawDefault);
  if (validDefault) {
    return {
      enabled: true,
      url: validDefault,
      isOverride: false,
      reason: 'enabled_default',
      diagnostic: null,
    };
  }

  return {
    enabled: false,
    url: null,
    isOverride: false,
    reason: 'missing_url',
    diagnostic: null,
  };
}

export function resetSupportDiagnosticCache(): void {
  warnedDiagnostics.clear();
}

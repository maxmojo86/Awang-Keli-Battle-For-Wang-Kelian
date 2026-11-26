import { getPlatformCapabilities } from './platform.ts';

export interface BackendRuntimeConfig {
  apiBaseUrl?: string;
  wsUrl?: string;
}

declare global {
  interface Window {
    __AWANG_KELI_CONFIG__?: BackendRuntimeConfig;
  }
}

export interface ResolvedBackendConfig {
  apiBaseUrl: string | null;
  wsUrl: string | null;
  isApiConfigured: boolean;
  isWsConfigured: boolean;
  isProductionStaticBuild: boolean;
}

function readEnvString(key: 'VITE_API_BASE_URL' | 'VITE_WS_URL'): string {
  const env = (
    import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }
  ).env;
  const raw = env?.[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function readRuntimeOverride(): BackendRuntimeConfig {
  if (typeof window === 'undefined') return {};
  return window.__AWANG_KELI_CONFIG__ ?? {};
}

function isExplicitlyDisabled(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return lower === 'none' || lower === 'off' || lower === 'false' || lower === 'disabled';
}

function normalizeHttpBase(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || isExplicitlyDisabled(trimmed)) return null;
  if (trimmed.toLowerCase() === 'same-origin') return '';
  if (trimmed.startsWith('/')) return trimmed.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
  return null;
}

function normalizeWsUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || isExplicitlyDisabled(trimmed)) return null;
  if (trimmed.toLowerCase() === 'same-origin') {
    if (typeof window === 'undefined') return null;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  if (trimmed.startsWith('/')) {
    if (typeof window === 'undefined') return null;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${trimmed}`;
  }
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

export function getBackendConfig(): ResolvedBackendConfig {
  const env = (
    import.meta as ImportMeta & { env?: { DEV?: boolean; PROD?: boolean } }
  ).env;
  const isDev = Boolean(env?.DEV);

  // Strict YouTube Playables isolation: never configure external HTTP or WebSocket endpoints.
  const caps = getPlatformCapabilities();
  if (caps.isYouTubePlayables || !caps.webSocketEnabled) {
    return {
      apiBaseUrl: null,
      wsUrl: null,
      isApiConfigured: false,
      isWsConfigured: false,
      isProductionStaticBuild: !isDev,
    };
  }

  const runtime = readRuntimeOverride();

  const rawApi =
    runtime.apiBaseUrl !== undefined
      ? runtime.apiBaseUrl.trim()
      : readEnvString('VITE_API_BASE_URL');
  const rawWs =
    runtime.wsUrl !== undefined
      ? runtime.wsUrl.trim()
      : readEnvString('VITE_WS_URL');

  // Standalone Web served by `server.ts` (AI Studio, Cloud Run, localhost) hosts `/api/*` and `/ws`
  // on the same origin. Default to same-origin when env vars are unset on http(s) web origins.
  // Android Capacitor WebViews (`https://localhost`) have no bundled Node server and require
  // explicit `VITE_API_BASE_URL` / `VITE_WS_URL` (or runtime override).
  const canDefaultSameOrigin =
    caps.platform === 'STANDALONE_WEB' &&
    typeof window !== 'undefined' &&
    Boolean(window.location?.host) &&
    /^https?:$/i.test(window.location.protocol ?? '');

  const effectiveApiRaw = rawApi || (canDefaultSameOrigin ? 'same-origin' : '');
  const effectiveWsRaw = rawWs || (canDefaultSameOrigin ? 'same-origin' : '');

  const apiBaseUrl = normalizeHttpBase(effectiveApiRaw);
  const wsUrl = normalizeWsUrl(effectiveWsRaw);

  return {
    apiBaseUrl,
    wsUrl,
    isApiConfigured: apiBaseUrl !== null,
    isWsConfigured: wsUrl !== null,
    isProductionStaticBuild: !isDev,
  };
}

export function buildApiUrl(apiPath: string): string | null {
  const { apiBaseUrl } = getBackendConfig();
  if (apiBaseUrl === null) return null;
  const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${apiBaseUrl}${cleanPath}`;
}

export function getMultiplayerWsUrl(): string | null {
  return getBackendConfig().wsUrl;
}

export function getResolvedWsHost(): string | null {
  const wsUrl = getMultiplayerWsUrl();
  if (!wsUrl) return null;
  try {
    return new URL(wsUrl).host;
  } catch {
    return wsUrl;
  }
}

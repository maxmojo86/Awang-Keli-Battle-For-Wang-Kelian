export type BuildTarget = 'standalone' | 'android' | 'youtube';

export type PlatformId = 'STANDALONE_WEB' | 'ANDROID' | 'YOUTUBE_PLAYABLES';

export interface PlatformCapabilities {
  readonly platform: PlatformId;
  readonly buildTarget: BuildTarget;
  readonly isYouTubePlayables: boolean;
  readonly isAndroid: boolean;
  readonly onlineMultiplayerEnabled: boolean;
  readonly webSocketEnabled: boolean;
  readonly externalLeaderboardsEnabled: boolean;
  readonly externalAnalyticsEnabled: boolean;
  readonly spatialVoiceEnabled: boolean;
  readonly youtubeSdkEnabled: boolean;
  readonly cloudSaveEnabled: boolean;
  readonly scoreSubmissionEnabled: boolean;
  readonly localStorageAllowed: boolean;
  readonly mobileControlsSupported: boolean;
  readonly pwaEnabled: boolean;
  readonly voluntarySupportEnabled: boolean;
  readonly modeDisplayLabel: string;
}

declare global {
  const __BUILD_TARGET__: BuildTarget | undefined;
  const __CORE_VERSION__: string | undefined;
  const __PWA_ENABLED__: boolean | undefined;
  const __PWA_CACHE_VERSION__: string | undefined;
}

export function getBuildTarget(): BuildTarget {
  try {
    if (typeof __BUILD_TARGET__ === 'string') {
      if (
        __BUILD_TARGET__ === 'youtube' ||
        __BUILD_TARGET__ === 'android' ||
        __BUILD_TARGET__ === 'standalone'
      ) {
        return __BUILD_TARGET__;
      }
    }
  } catch {
    // Running outside Vite bundle (e.g., Node.js tsx tests / server.ts)
  }

  try {
    const envTarget = (
      import.meta as ImportMeta & { env?: Record<string, string | undefined> }
    ).env?.VITE_BUILD_TARGET;
    if (envTarget === 'youtube' || envTarget === 'android' || envTarget === 'standalone') {
      return envTarget;
    }
  } catch {
    // Ignore
  }

  return 'standalone';
}

export interface PlatformRuntimeSignals {
  buildTarget?: BuildTarget;
  inYouTubePlayablesEnv?: boolean;
  isNativeAndroid?: boolean;
  isProdBuild?: boolean;
}

function detectProductionBuild(): boolean {
  try {
    if (typeof __PWA_ENABLED__ === 'boolean') {
      return __PWA_ENABLED__;
    }
  } catch {
    // Running outside Vite bundle
  }
  try {
    const env = (
      import.meta as ImportMeta & { env?: { PROD?: boolean; DEV?: boolean } }
    ).env;
    if (typeof env?.PROD === 'boolean') return env.PROD && !env.DEV;
  } catch {
    // Ignore
  }
  return false;
}

function detectRuntimeYouTubeEnv(): boolean {
  if (typeof window === 'undefined') return false;
  const yt = (window as unknown as { ytgame?: { IN_PLAYABLES_ENV?: boolean } }).ytgame;
  return Boolean(yt && yt.IN_PLAYABLES_ENV);
}

function detectRuntimeNativeAndroid(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (
    window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }
  ).Capacitor;
  try {
    return Boolean(cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'android');
  } catch {
    return false;
  }
}

/**
 * Resolves explicit, centralized platform capabilities from build-time target
 * and official runtime environment signals.
 */
export function resolvePlatformCapabilities(
  signals?: PlatformRuntimeSignals
): PlatformCapabilities {
  const buildTarget = signals?.buildTarget ?? getBuildTarget();
  const inYtEnv =
    signals?.inYouTubePlayablesEnv !== undefined
      ? signals.inYouTubePlayablesEnv
      : detectRuntimeYouTubeEnv();
  const isNativeAndroid =
    signals?.isNativeAndroid !== undefined
      ? signals.isNativeAndroid
      : detectRuntimeNativeAndroid();

  const isProdBuild =
    signals?.isProdBuild !== undefined
      ? signals.isProdBuild
      : detectProductionBuild();

  if (buildTarget === 'youtube' || inYtEnv) {
    return {
      platform: 'YOUTUBE_PLAYABLES',
      buildTarget: buildTarget === 'youtube' ? 'youtube' : buildTarget,
      isYouTubePlayables: true,
      isAndroid: false,
      onlineMultiplayerEnabled: false,
      webSocketEnabled: false,
      externalLeaderboardsEnabled: false,
      externalAnalyticsEnabled: false,
      spatialVoiceEnabled: false,
      youtubeSdkEnabled: true,
      cloudSaveEnabled: true,
      scoreSubmissionEnabled: true,
      localStorageAllowed: false,
      mobileControlsSupported: true,
      pwaEnabled: false,
      voluntarySupportEnabled: false,
      modeDisplayLabel: 'AI Battle Royale',
    };
  }

  if (buildTarget === 'android' || isNativeAndroid) {
    return {
      platform: 'ANDROID',
      buildTarget: buildTarget === 'android' ? 'android' : buildTarget,
      isYouTubePlayables: false,
      isAndroid: true,
      onlineMultiplayerEnabled: true,
      webSocketEnabled: true,
      externalLeaderboardsEnabled: true,
      externalAnalyticsEnabled: false,
      spatialVoiceEnabled: true,
      youtubeSdkEnabled: false,
      cloudSaveEnabled: false,
      scoreSubmissionEnabled: false,
      localStorageAllowed: true,
      mobileControlsSupported: true,
      pwaEnabled: false,
      voluntarySupportEnabled: false,
      modeDisplayLabel: 'Solo Royale',
    };
  }

  return {
    platform: 'STANDALONE_WEB',
    buildTarget: 'standalone',
    isYouTubePlayables: false,
    isAndroid: false,
    onlineMultiplayerEnabled: true,
    webSocketEnabled: true,
    externalLeaderboardsEnabled: true,
    externalAnalyticsEnabled: false,
    spatialVoiceEnabled: true,
    youtubeSdkEnabled: false,
    cloudSaveEnabled: false,
    scoreSubmissionEnabled: false,
    localStorageAllowed: true,
    mobileControlsSupported: true,
    pwaEnabled: isProdBuild,
    voluntarySupportEnabled: true,
    modeDisplayLabel: 'Solo Royale',
  };
}

let cachedCapabilities: PlatformCapabilities | null = null;

export function getPlatformCapabilities(): PlatformCapabilities {
  if (!cachedCapabilities) {
    cachedCapabilities = resolvePlatformCapabilities();
  }
  return cachedCapabilities;
}

export function resetPlatformCapabilitiesCache(): void {
  cachedCapabilities = null;
}

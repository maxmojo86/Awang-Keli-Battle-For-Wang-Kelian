/**
 * Official YouTube Playables SDK adapter (`https://www.youtube.com/game_api/v1`).
 *
 * Implements the verified global `ytgame` namespace safely with graceful fallbacks
 * so standalone web and Android builds never require the YouTube SDK.
 */

export interface OfficialYtGameSdk {
  readonly IN_PLAYABLES_ENV?: boolean;
  readonly SDK_VERSION?: string;
  readonly game?: {
    firstFrameReady?: () => void;
    gameReady?: () => void;
    loadData?: () => Promise<string>;
    saveData?: (data: string) => Promise<void>;
  };
  readonly system?: {
    onPause?: (cb: () => void) => () => void;
    onResume?: (cb: () => void) => () => void;
    isAudioEnabled?: () => boolean;
    onAudioEnabledChange?: (cb: (isAudioEnabled: boolean) => void) => () => void;
  };
  readonly engagement?: {
    sendScore?: (score: { value: number }) => Promise<void>;
  };
}

export const YOUTUBE_SDK_SCRIPT_URL = 'https://www.youtube.com/game_api/v1';
export const YOUTUBE_SAFE_SAVE_MAX_BYTES = 500 * 1024; // 500 KiB recommended ceiling (3 MiB hard limit)

function getGlobalYtGame(): OfficialYtGameSdk | null {
  if (typeof window === 'undefined') return null;
  const maybe = (window as unknown as { ytgame?: OfficialYtGameSdk }).ytgame;
  return maybe && typeof maybe === 'object' ? maybe : null;
}

export class YouTubePlayablesBridge {
  private readonly sdkProvider: () => OfficialYtGameSdk | null;
  private firstFrameSignaled = false;
  private gameReadySignaled = false;
  private cloudDataLoaded = false;
  private submittedMatchIds = new Set<string>();

  constructor(sdkProvider: () => OfficialYtGameSdk | null = getGlobalYtGame) {
    this.sdkProvider = sdkProvider;
  }

  public getSdk(): OfficialYtGameSdk | null {
    return this.sdkProvider();
  }

  public isInPlayablesEnv(): boolean {
    const sdk = this.sdkProvider();
    return Boolean(sdk && sdk.IN_PLAYABLES_ENV);
  }

  public hasSignaledFirstFrame(): boolean {
    return this.firstFrameSignaled;
  }

  public hasSignaledGameReady(): boolean {
    return this.gameReadySignaled;
  }

  public hasLoadedCloudData(): boolean {
    return this.cloudDataLoaded;
  }

  /**
   * Calls `ytgame.game.firstFrameReady()` exactly once after a real visual frame is rendered.
   */
  public signalFirstFrameReady(): boolean {
    if (this.firstFrameSignaled) return false;
    const sdk = this.sdkProvider();
    if (!sdk?.game?.firstFrameReady) return false;
    try {
      sdk.game.firstFrameReady();
      this.firstFrameSignaled = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Calls `ytgame.game.gameReady()` exactly once after the game is genuinely interactive.
   * Ensures `firstFrameReady()` has been signaled beforehand.
   */
  public signalGameReady(): boolean {
    if (this.gameReadySignaled) return false;
    if (!this.firstFrameSignaled) {
      this.signalFirstFrameReady();
    }
    const sdk = this.sdkProvider();
    if (!sdk?.game?.gameReady) return false;
    try {
      sdk.game.gameReady();
      this.gameReadySignaled = true;
      return true;
    } catch {
      return false;
    }
  }

  public subscribeLifecycle(
    onPause: () => void,
    onResume: () => void
  ): () => void {
    const sdk = this.sdkProvider();
    if (!sdk?.system) return () => {};
    let unsubPause: (() => void) | void;
    let unsubResume: (() => void) | void;
    try {
      unsubPause = sdk.system.onPause?.(onPause);
    } catch {
      // Ignore SDK hook failure
    }
    try {
      unsubResume = sdk.system.onResume?.(onResume);
    } catch {
      // Ignore SDK hook failure
    }
    return () => {
      try {
        if (typeof unsubPause === 'function') unsubPause();
      } catch {
        // Ignore cleanup failure
      }
      try {
        if (typeof unsubResume === 'function') unsubResume();
      } catch {
        // Ignore cleanup failure
      }
    };
  }

  public isAudioEnabled(): boolean {
    const sdk = this.sdkProvider();
    if (!sdk?.system?.isAudioEnabled) return true;
    try {
      return Boolean(sdk.system.isAudioEnabled());
    } catch {
      return true;
    }
  }

  public subscribeAudioEnabledChange(
    onAudioEnabledChange: (enabled: boolean) => void
  ): () => void {
    const sdk = this.sdkProvider();
    if (!sdk?.system?.onAudioEnabledChange) return () => {};
    let unsub: (() => void) | void;
    try {
      unsub = sdk.system.onAudioEnabledChange((enabled) => {
        onAudioEnabledChange(Boolean(enabled));
      });
    } catch {
      return () => {};
    }
    return () => {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {
        // Ignore cleanup failure
      }
    };
  }

  public async loadCloudData(): Promise<{ ok: boolean; data: string }> {
    const sdk = this.sdkProvider();
    if (!sdk?.game?.loadData) {
      this.cloudDataLoaded = true;
      return { ok: false, data: '' };
    }
    try {
      const raw = await sdk.game.loadData();
      this.cloudDataLoaded = true;
      return { ok: true, data: typeof raw === 'string' ? raw : '' };
    } catch {
      return { ok: false, data: '' };
    }
  }

  /**
   * Persists serialized cloud save data only after initial cloud load succeeded
   * and payload fits within the safe YouTube Playables size budget.
   */
  public async saveCloudData(serialized: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.cloudDataLoaded) {
      return { ok: false, reason: 'load_required_before_save' };
    }
    const byteLength = new TextEncoder().encode(serialized).byteLength;
    if (byteLength > YOUTUBE_SAFE_SAVE_MAX_BYTES) {
      return { ok: false, reason: 'payload_exceeds_limit' };
    }
    const sdk = this.sdkProvider();
    if (!sdk?.game?.saveData) {
      return { ok: false, reason: 'sdk_unavailable' };
    }
    try {
      await sdk.game.saveData(serialized);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'sdk_error' };
    }
  }

  /**
   * Submits an integer score through `ytgame.engagement.sendScore({ value })`
   * with strict deduplication per match ID.
   */
  public async submitScore(
    score: number,
    matchId: string
  ): Promise<{ submitted: boolean; reason?: string; value?: number }> {
    const cleanValue = Math.max(0, Math.floor(score));
    if (!Number.isFinite(cleanValue) || cleanValue <= 0) {
      return { submitted: false, reason: 'non_positive_score' };
    }
    if (!matchId || this.submittedMatchIds.has(matchId)) {
      return { submitted: false, reason: 'duplicate_submission' };
    }
    const sdk = this.sdkProvider();
    if (!sdk?.engagement?.sendScore) {
      return { submitted: false, reason: 'sdk_unavailable' };
    }
    this.submittedMatchIds.add(matchId);
    try {
      await sdk.engagement.sendScore({ value: cleanValue });
      return { submitted: true, value: cleanValue };
    } catch {
      this.submittedMatchIds.delete(matchId);
      return { submitted: false, reason: 'sdk_error' };
    }
  }
}

export const youtubePlayablesBridge = new YouTubePlayablesBridge();

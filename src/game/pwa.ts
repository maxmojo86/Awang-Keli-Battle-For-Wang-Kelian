import { getPlatformCapabilities, PlatformCapabilities } from './platform.ts';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

export type InstallGuidePlatform = 'android_chrome' | 'ios_safari' | 'desktop';

export type InstallPromptResult = 'accepted' | 'dismissed' | 'unavailable' | 'error';

export interface PwaStateSnapshot {
  readonly pwaEnabled: boolean;
  readonly isInstalled: boolean;
  readonly canPromptNative: boolean;
  readonly guidePlatform: InstallGuidePlatform;
  readonly swRegistered: boolean;
  readonly updateAvailable: boolean;
  readonly lastPromptResult: InstallPromptResult | null;
}

export interface ServiceWorkerRegistrationLike {
  readonly waiting: { postMessage: (msg: unknown) => void } | null;
  readonly installing: {
    state: string;
    addEventListener: (type: string, listener: () => void) => void;
  } | null;
  readonly scope?: string;
  addEventListener: (type: string, listener: () => void) => void;
}

export interface ServiceWorkerContainerLike {
  readonly controller: unknown;
  register: (
    scriptURL: string,
    options?: { scope?: string; updateViaCache?: 'imports' | 'all' | 'none' }
  ) => Promise<ServiceWorkerRegistrationLike>;
  addEventListener: (type: string, listener: () => void) => void;
}

export function isStandaloneDisplayMode(
  win: Pick<Window, 'matchMedia' | 'navigator'> | undefined =
    typeof window !== 'undefined' ? window : undefined
): boolean {
  if (!win) return false;
  try {
    if (win.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    if (win.matchMedia?.('(display-mode: fullscreen)')?.matches) return true;
  } catch {
    // Ignore matchMedia errors
  }
  const nav = win.navigator as (Navigator & { standalone?: boolean }) | undefined;
  return nav?.standalone === true;
}

export function detectInstallGuidePlatform(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints: number = typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0
): InstallGuidePlatform {
  const ua = userAgent.toLowerCase();
  const isIPhoneOrIPad =
    /iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && maxTouchPoints > 1);
  if (isIPhoneOrIPad) {
    return 'ios_safari';
  }
  if (ua.includes('android')) {
    return 'android_chrome';
  }
  return 'desktop';
}

export function isSecureOriginForSw(
  loc: Pick<Location, 'protocol' | 'hostname'> | undefined =
    typeof window !== 'undefined' ? window.location : undefined
): boolean {
  if (!loc) return false;
  if (loc.protocol === 'https:') return true;
  if (
    loc.protocol === 'http:' &&
    (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1' || loc.hostname === '[::1]')
  ) {
    return true;
  }
  return false;
}

export interface RegisterSwDeps {
  capabilities?: PlatformCapabilities;
  serviceWorker?: ServiceWorkerContainerLike | null;
  location?: Pick<Location, 'protocol' | 'hostname'>;
  onUpdateAvailable?: (registration: ServiceWorkerRegistrationLike) => void;
}

/**
 * Registers `/sw.js` with scope `/` and `updateViaCache: 'none'` ONLY in
 * production standalone web builds on secure origins.
 * Never forces `skipWaiting()` or reloads automatically during gameplay.
 */
export async function registerStandaloneServiceWorker(
  deps: RegisterSwDeps = {}
): Promise<ServiceWorkerRegistrationLike | null> {
  const caps = deps.capabilities ?? getPlatformCapabilities();
  if (!caps.pwaEnabled) return null;

  const loc = deps.location ?? (typeof window !== 'undefined' ? window.location : undefined);
  if (!isSecureOriginForSw(loc)) return null;

  const swContainer =
    deps.serviceWorker !== undefined
      ? deps.serviceWorker
      : typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? (navigator.serviceWorker as unknown as ServiceWorkerContainerLike)
        : null;

  if (!swContainer || typeof swContainer.register !== 'function') return null;

  try {
    const registration = await swContainer.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    if (registration.waiting && swContainer.controller) {
      deps.onUpdateAvailable?.(registration);
    }

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && swContainer.controller) {
          deps.onUpdateAvailable?.(registration);
        }
      });
    });

    return registration;
  } catch {
    return null;
  }
}

export class PwaManager {
  private initialized = false;
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private isInstalled = false;
  private swRegistered = false;
  private updateAvailable = false;
  private waitingRegistration: ServiceWorkerRegistrationLike | null = null;
  private lastPromptResult: InstallPromptResult | null = null;
  private awaitingControlledReload = false;
  private listeners = new Set<(snap: PwaStateSnapshot) => void>();
  private cleanupFns: Array<() => void> = [];

  public getSnapshot(): PwaStateSnapshot {
    const caps = getPlatformCapabilities();
    return {
      pwaEnabled: caps.pwaEnabled,
      isInstalled: this.isInstalled,
      canPromptNative: caps.pwaEnabled && !this.isInstalled && this.deferredPrompt !== null,
      guidePlatform: detectInstallGuidePlatform(),
      swRegistered: this.swRegistered,
      updateAvailable: caps.pwaEnabled && this.updateAvailable,
      lastPromptResult: this.lastPromptResult,
    };
  }

  public subscribe(listener: (snap: PwaStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }

  public init(): void {
    if (this.initialized || typeof window === 'undefined') return;
    const caps = getPlatformCapabilities();
    if (!caps.pwaEnabled) {
      return;
    }

    this.initialized = true;
    this.isInstalled = isStandaloneDisplayMode(window);

    const onBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      if (typeof promptEvent.prompt !== 'function') return;
      promptEvent.preventDefault();
      if (this.isInstalled) return;
      this.deferredPrompt = promptEvent;
      this.emit();
    };

    const onAppInstalled = () => {
      this.isInstalled = true;
      this.deferredPrompt = null;
      this.lastPromptResult = 'accepted';
      this.emit();
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    this.cleanupFns.push(() => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    });

    try {
      const standaloneMq = window.matchMedia?.('(display-mode: standalone)');
      if (standaloneMq) {
        const onModeChange = (ev: MediaQueryListEvent) => {
          if (ev.matches) {
            this.isInstalled = true;
            this.deferredPrompt = null;
            this.emit();
          }
        };
        standaloneMq.addEventListener?.('change', onModeChange);
        this.cleanupFns.push(() => {
          standaloneMq.removeEventListener?.('change', onModeChange);
        });
      }
    } catch {
      // Ignore matchMedia listener errors
    }

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const onControllerChange = () => {
        // Reload ONLY when the user explicitly clicked the safe-menu update control
        if (this.awaitingControlledReload) {
          this.awaitingControlledReload = false;
          window.location.reload();
        }
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      this.cleanupFns.push(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      });
    }

    const doRegister = () => {
      void registerStandaloneServiceWorker({
        capabilities: caps,
        onUpdateAvailable: (reg) => {
          this.waitingRegistration = reg;
          this.updateAvailable = true;
          this.emit();
        },
      }).then((reg) => {
        if (reg) {
          this.swRegistered = true;
          this.emit();
        }
      });
    };

    if (document.readyState === 'complete') {
      doRegister();
    } else {
      const onLoad = () => doRegister();
      window.addEventListener('load', onLoad, { once: true });
      this.cleanupFns.push(() => {
        window.removeEventListener('load', onLoad);
      });
    }

    this.emit();
  }

  /**
   * Triggers the captured `beforeinstallprompt` ONLY from a user click.
   * Always clears the consumed prompt immediately and waits for a fresh event
   * before offering the native prompt again.
   */
  public async triggerNativeInstall(): Promise<InstallPromptResult> {
    const caps = getPlatformCapabilities();
    if (!caps.pwaEnabled || this.isInstalled || !this.deferredPrompt) {
      this.lastPromptResult = 'unavailable';
      this.emit();
      return 'unavailable';
    }

    const promptEvent = this.deferredPrompt;
    // Clear immediately so a consumed prompt is never reused
    this.deferredPrompt = null;
    this.emit();

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === 'accepted') {
        this.isInstalled = true;
        this.lastPromptResult = 'accepted';
        this.emit();
        return 'accepted';
      }
      this.lastPromptResult = 'dismissed';
      this.emit();
      return 'dismissed';
    } catch {
      this.lastPromptResult = 'error';
      this.emit();
      return 'error';
    }
  }

  /**
   * Activates a waiting service worker update ONLY when invoked explicitly by the
   * user from a safe menu state (Title Screen). Never called during active gameplay.
   */
  public applyWaitingUpdate(): boolean {
    const waiting = this.waitingRegistration?.waiting;
    if (!waiting) return false;
    try {
      this.awaitingControlledReload = true;
      this.updateAvailable = false;
      this.emit();
      waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    } catch {
      this.awaitingControlledReload = false;
      return false;
    }
  }

  public dispose(): void {
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.cleanupFns = [];
    this.initialized = false;
    this.deferredPrompt = null;
  }
}

export const pwaManager = new PwaManager();

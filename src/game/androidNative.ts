import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { soundEngine } from './audio';

export type AndroidBackHandler = () => boolean;

interface RegisteredBackHandler {
  id: number;
  priority: number;
  handler: AndroidBackHandler;
}

type LifecycleListener = (state: { active: boolean }) => void;

const backHandlers: RegisteredBackHandler[] = [];
const lifecycleListeners = new Set<LifecycleListener>();
let nextHandlerId = 1;
let isAppCurrentlyActive = true;
let initialized = false;

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export function registerAndroidBackHandler(
  handler: AndroidBackHandler,
  priority = 0
): () => void {
  const entry: RegisteredBackHandler = {
    id: nextHandlerId++,
    priority,
    handler,
  };
  backHandlers.push(entry);
  return () => {
    const idx = backHandlers.findIndex((item) => item.id === entry.id);
    if (idx >= 0) {
      backHandlers.splice(idx, 1);
    }
  };
}

export function subscribeAppLifecycle(listener: LifecycleListener): () => void {
  lifecycleListeners.add(listener);
  return () => {
    lifecycleListeners.delete(listener);
  };
}

function emitLifecycleChange(active: boolean) {
  if (isAppCurrentlyActive === active) return;
  isAppCurrentlyActive = active;

  if (!active) {
    soundEngine.handleAppBackgrounded();
  } else {
    soundEngine.handleAppForegrounded();
  }

  for (const listener of lifecycleListeners) {
    try {
      listener({ active });
    } catch {
      // Keep other lifecycle listeners unaffected
    }
  }
}

export function dispatchAndroidBack(): boolean {
  // Highest priority first; most recently registered wins ties
  const ordered = [...backHandlers].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.id - a.id;
  });

  for (const entry of ordered) {
    try {
      if (entry.handler()) {
        return true;
      }
    } catch {
      // Continue down stack on handler error
    }
  }
  return false;
}

export async function exitAndroidApp(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await CapacitorApp.exitApp();
  } catch {
    // Ignore on non-Android hosts
  }
}

export async function setAndroidGameplayImmersive(gameplayActive: boolean): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#091116' });
    if (gameplayActive) {
      await StatusBar.hide();
    } else {
      await StatusBar.show();
    }
  } catch {
    // StatusBar plugin unavailable on web or older emulators
  }
}

export function initAndroidNativeShell(): () => void {
  if (initialized || typeof window === 'undefined') {
    return () => {};
  }
  initialized = true;

  const nativeAndroid = isNativeAndroid();
  if (nativeAndroid && typeof document !== 'undefined') {
    document.documentElement.classList.add('platform-android');
  }

  const handles: PluginListenerHandle[] = [];
  let disposed = false;

  const onPageHide = () => emitLifecycleChange(false);
  const onPageShow = () => emitLifecycleChange(true);
  const onWindowBlur = () => {
    // On Android WebView, brief focus shifts (e.g. volume HUD) fire blur without hiding;
    // only treat blur as background when the document is also hidden.
    if (typeof document !== 'undefined' && document.hidden) {
      emitLifecycleChange(false);
    }
  };
  const onVisibility = () => {
    if (typeof document === 'undefined') return;
    emitLifecycleChange(!document.hidden);
  };

  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('blur', onWindowBlur);
  document.addEventListener('visibilitychange', onVisibility);

  if (nativeAndroid) {
    void setAndroidGameplayImmersive(false);
    void SplashScreen.hide().catch(() => {});

    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (disposed) return;
      emitLifecycleChange(isActive);
    }).then((h) => {
      if (disposed) void h.remove();
      else handles.push(h);
    });

    void CapacitorApp.addListener('pause', () => {
      if (disposed) return;
      emitLifecycleChange(false);
    }).then((h) => {
      if (disposed) void h.remove();
      else handles.push(h);
    });

    void CapacitorApp.addListener('resume', () => {
      if (disposed) return;
      emitLifecycleChange(true);
    }).then((h) => {
      if (disposed) void h.remove();
      else handles.push(h);
    });

    void CapacitorApp.addListener('backButton', () => {
      if (disposed) return;
      dispatchAndroidBack();
    }).then((h) => {
      if (disposed) void h.remove();
      else handles.push(h);
    });
  }

  return () => {
    disposed = true;
    initialized = false;
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('blur', onWindowBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    for (const h of handles) {
      void h.remove().catch(() => {});
    }
    handles.length = 0;
  };
}

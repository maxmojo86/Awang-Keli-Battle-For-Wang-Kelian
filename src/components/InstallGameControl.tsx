import React, { useEffect, useRef, useState } from 'react';
import { Download, Monitor, RefreshCw, Share, Smartphone, Wifi, X } from 'lucide-react';
import { registerAndroidBackHandler } from '../game/androidNative';
import { soundEngine } from '../game/audio';
import { InstallGuidePlatform, pwaManager, PwaStateSnapshot } from '../game/pwa';

interface InstallGameControlProps {
  compact?: boolean;
  disabled?: boolean;
}

const GUIDE_TABS: Array<{ id: InstallGuidePlatform; label: string }> = [
  { id: 'android_chrome', label: 'Android' },
  { id: 'ios_safari', label: 'iPhone / iPad' },
  { id: 'desktop', label: 'Desktop' },
];

export const InstallGameControl: React.FC<InstallGameControlProps> = ({
  compact = false,
  disabled = false,
}) => {
  const [pwa, setPwa] = useState<PwaStateSnapshot>(() => pwaManager.getSnapshot());
  const [guideOpen, setGuideOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<InstallGuidePlatform>(
    () => pwaManager.getSnapshot().guidePlatform
  );
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);

  const triggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return pwaManager.subscribe((next) => {
      setPwa(next);
      if (next.isInstalled) {
        setGuideOpen(false);
        setStatusNote(null);
      }
    });
  }, []);

  useEffect(() => {
    if (!guideOpen) return;
    const unsubBack = registerAndroidBackHandler(() => {
      setGuideOpen(false);
      return true;
    }, 30);

    const rafId = window.requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setGuideOpen(false);
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      unsubBack();
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      triggerBtnRef.current?.focus?.();
    };
  }, [guideOpen]);

  if (!pwa.pwaEnabled) {
    return null;
  }

  const showInstallBtn = !pwa.isInstalled;
  const showUpdateBtn = pwa.updateAvailable;

  if (!showInstallBtn && !showUpdateBtn) {
    return null;
  }

  const handleInstallClick = async () => {
    if (disabled || promptBusy) return;
    soundEngine.unlockFromGesture();
    soundEngine.playUiConfirm(true);
    setStatusNote(null);

    if (pwa.canPromptNative) {
      setPromptBusy(true);
      try {
        const result = await pwaManager.triggerNativeInstall();
        if (result === 'error' || result === 'unavailable') {
          setSelectedPlatform(pwa.guidePlatform);
          setStatusNote('Use your browser menu below to finish installing.');
          setGuideOpen(true);
        }
      } finally {
        setPromptBusy(false);
      }
      return;
    }

    setSelectedPlatform(pwa.guidePlatform);
    setGuideOpen(true);
  };

  const handleApplyUpdate = () => {
    if (disabled) return;
    soundEngine.unlockFromGesture();
    soundEngine.playUiConfirm(true);
    pwaManager.applyWaitingUpdate();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {showInstallBtn && (
          <button
            ref={triggerBtnRef}
            type="button"
            disabled={disabled || promptBusy}
            onClick={() => void handleInstallClick()}
            aria-label="Install Game to Home Screen or Desktop"
            className={`compendium-plaque-subtle inline-flex items-center gap-1.5 rounded-[3px] text-[#f3d285] hover:border-[#f3d285] hover:text-[#fff6dd] active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] focus-visible:ring-offset-2 focus-visible:ring-offset-[#091116] ${
              compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'
            } font-semibold tracking-wide whitespace-nowrap`}
          >
            <Download className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} aria-hidden="true" />
            <span>Install Game</span>
          </button>
        )}

        {showUpdateBtn && (
          <button
            type="button"
            disabled={disabled}
            onClick={handleApplyUpdate}
            aria-label="Reload to apply new game update"
            className={`compendium-plaque-subtle inline-flex items-center gap-1.5 rounded-[3px] border-[#4ade80]/70 text-[#86efac] hover:border-[#86efac] hover:text-[#dcfce7] active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#86efac] focus-visible:ring-offset-2 focus-visible:ring-offset-[#091116] ${
              compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'
            } font-semibold tracking-wide whitespace-nowrap`}
          >
            <RefreshCw className={compact ? 'w-3 h-3 shrink-0' : 'w-3.5 h-3.5 shrink-0'} aria-hidden="true" />
            <span>Update Ready</span>
          </button>
        )}
      </div>

      {guideOpen && !pwa.isInstalled && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#04090d]/85 p-3 sm:p-5"
          style={{
            paddingTop: 'max(12px, env(safe-area-inset-top))',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
            paddingLeft: 'max(12px, env(safe-area-inset-left))',
            paddingRight: 'max(12px, env(safe-area-inset-right))',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setGuideOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-install-guide-heading"
            className="compendium-plaque w-full max-w-md max-h-[min(88dvh,580px)] flex flex-col rounded-sm overflow-hidden"
          >
            <div className="compendium-ribbon flex items-center justify-between gap-3 px-4 sm:px-5 py-3 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Download className="w-4 h-4 text-[#f3d285] shrink-0" aria-hidden="true" />
                <h2
                  id="pwa-install-guide-heading"
                  className="font-display text-lg font-semibold text-[#f3d285] truncate"
                >
                  Install Awang Keli
                </h2>
              </div>

              <button
                ref={closeBtnRef}
                type="button"
                onClick={() => setGuideOpen(false)}
                aria-label="Close installation guide"
                className="p-1.5 rounded-[2px] border border-[#5b4724] bg-[#0b1218] text-[#d9b25f] hover:border-[#f3d285] hover:text-[#f7f2e7] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto text-sm text-[#d6dfd9]">
              <p className="text-xs sm:text-[13px] text-[#b8c4bf] leading-relaxed">
                Add <strong className="text-[#f7f2e7]">AWANG KELI: BATTLE FOR WANG KELIAN</strong> to
                your home screen or desktop for full-screen standalone launch.
              </p>

              {statusNote && (
                <div
                  role="status"
                  className="px-3 py-2 rounded-[2px] border border-[#c99c4a]/45 bg-[#14222c] text-xs text-[#f3d285]"
                >
                  {statusNote}
                </div>
              )}

              {/* Platform selector tabs */}
              <div
                role="tablist"
                aria-label="Choose your device"
                className="grid grid-cols-3 gap-1.5"
              >
                {GUIDE_TABS.map((tab) => {
                  const active = selectedPlatform === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSelectedPlatform(tab.id)}
                      className={`px-2 py-2 text-xs font-semibold rounded-[2px] border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] ${
                        active
                          ? 'border-[#f3d285] bg-[#1a2e3b] text-[#f3d285]'
                          : 'border-[#334652] bg-[#0b1218] text-[#9cb0ba] hover:border-[#6b5023] hover:text-[#e6e4dd]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Platform-specific instructions */}
              <div
                role="tabpanel"
                className="p-3.5 rounded-[2px] border border-[#3d311d] bg-[#0b1218]/90 space-y-2.5"
              >
                {selectedPlatform === 'android_chrome' && (
                  <>
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#f3d285]">
                      <Smartphone className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Android Chrome</span>
                    </div>
                    <ol className="list-decimal list-inside space-y-1.5 text-xs sm:text-[13px] text-[#d6dfd9] leading-relaxed">
                      <li>
                        Tap the browser menu button (<strong className="text-[#f7f2e7]">⋮</strong>) in
                        the top-right corner of Chrome.
                      </li>
                      <li>
                        Tap <strong className="text-[#f7f2e7]">Install app</strong> or{' '}
                        <strong className="text-[#f7f2e7]">Add to Home screen</strong>.
                      </li>
                      <li>
                        Confirm <strong className="text-[#f7f2e7]">Install</strong> to add Awang Keli
                        to your launcher.
                      </li>
                    </ol>
                  </>
                )}

                {selectedPlatform === 'ios_safari' && (
                  <>
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#f3d285]">
                      <Share className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>iPhone / iPad Safari</span>
                    </div>
                    <ol className="list-decimal list-inside space-y-1.5 text-xs sm:text-[13px] text-[#d6dfd9] leading-relaxed">
                      <li>
                        Open this game in <strong className="text-[#f7f2e7]">Safari</strong> and tap
                        the <strong className="text-[#f7f2e7]">Share</strong> button.
                      </li>
                      <li>
                        Scroll down and tap{' '}
                        <strong className="text-[#f7f2e7]">Add to Home Screen</strong>.
                      </li>
                      <li>
                        Enable <strong className="text-[#f7f2e7]">Open as Web App</strong> if offered,
                        then tap <strong className="text-[#f7f2e7]">Add</strong>.
                      </li>
                    </ol>
                  </>
                )}

                {selectedPlatform === 'desktop' && (
                  <>
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#f3d285]">
                      <Monitor className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Desktop Chrome / Edge</span>
                    </div>
                    <ol className="list-decimal list-inside space-y-1.5 text-xs sm:text-[13px] text-[#d6dfd9] leading-relaxed">
                      <li>
                        Click the <strong className="text-[#f7f2e7]">Install</strong> icon on the
                        right side of the address bar, or open the browser menu.
                      </li>
                      <li>
                        Choose <strong className="text-[#f7f2e7]">Install Awang Keli</strong> (or{' '}
                        <strong className="text-[#f7f2e7]">Apps → Install this site as an app</strong>).
                      </li>
                      <li>
                        Confirm to launch Awang Keli in its own desktop window.
                      </li>
                    </ol>
                  </>
                )}
              </div>

              <div className="flex items-start gap-2 px-3 py-2 rounded-[2px] border border-[#243944] bg-[#0d171f] text-[11.5px] text-[#9cb0ba] leading-relaxed">
                <Wifi className="w-3.5 h-3.5 text-[#5eead4] shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  An active internet connection is required to load the game and play online
                  multiplayer.
                </span>
              </div>

              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="w-full py-2.5 text-xs font-semibold rounded-[2px] border border-[#f3d285]/45 bg-[#c99c4a] text-[#091116] hover:bg-[#dfb35f] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Music, Settings, Volume2, VolumeX, X } from 'lucide-react';
import { MenuMusicSnapshot, soundEngine } from '../game/audio';
import { getPlatformCapabilities } from '../game/platform';
import { DEFAULT_HUD_VISIBILITY } from '../game/settings';
import { AccessibilitySettings, GraphicsQuality } from '../game/types';
import { HudVisibilityControls } from './HudVisibilityControls';

interface TitleSettingsModalProps {
  open: boolean;
  settings: AccessibilitySettings;
  onUpdateSettings: (patch: Partial<AccessibilitySettings>) => void;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}

export const TitleSettingsModal: React.FC<TitleSettingsModalProps> = ({
  open,
  settings,
  onUpdateSettings,
  onClose,
  returnFocusRef,
}) => {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [menuMusic, setMenuMusic] = useState<MenuMusicSnapshot>(() =>
    soundEngine.getMenuMusicSnapshot()
  );

  useEffect(() => {
    return soundEngine.subscribeMenuMusic(setMenuMusic);
  }, []);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const rafId = window.requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
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
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      const restoreTarget = returnFocusRef?.current ?? previousFocusRef.current;
      restoreTarget?.focus?.();
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;

  const platformCaps = getPlatformCapabilities();
  const musicPct = Math.round((settings.musicVolume ?? 0.35) * 100);
  const volumePct = Math.round(settings.volume * 100);
  const voicePct = Math.round((settings.voiceVolume ?? 0.9) * 100);
  const graphicsQuality: GraphicsQuality = settings.graphicsQuality ?? 'auto';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#04090d]/85 p-3 sm:p-5"
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(12px, env(safe-area-inset-left))',
        paddingRight: 'max(12px, env(safe-area-inset-right))',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="title-settings-heading"
        className="compendium-plaque w-full max-w-md max-h-[min(88dvh,640px)] flex flex-col rounded-sm overflow-hidden"
      >
        <div className="compendium-ribbon flex items-center justify-between gap-3 px-4 sm:px-5 py-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Settings className="w-4 h-4 text-[#f3d285] shrink-0" aria-hidden="true" />
            <h2
              id="title-settings-heading"
              className="font-display text-lg sm:text-xl font-semibold text-[#f3d285] truncate"
            >
              Settings & Audio
            </h2>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close Settings"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[2px] border border-[#8a6a31] bg-[#142029] text-[#f7f2e7] hover:border-[#f3d285] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Close</span>
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain space-y-5 text-sm">
          {/* Audio Controls */}
          <section aria-labelledby="settings-audio-heading" className="space-y-3">
            <h3
              id="settings-audio-heading"
              className="font-display text-sm font-semibold text-[#f3d285]"
            >
              ◆ Audio Controls
            </h3>

            <div className="compendium-plaque-subtle rounded-[2px] p-3.5 space-y-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#e6e4dd]">Master Audio</span>
                <button
                  type="button"
                  aria-pressed={settings.muted}
                  onClick={() => {
                    const nextMuted = !settings.muted;
                    soundEngine.setMuted(nextMuted);
                    onUpdateSettings({ muted: nextMuted });
                    if (!nextMuted) {
                      soundEngine.unlockFromGesture();
                      void soundEngine.unlockMenuMusicFromGesture();
                      soundEngine.playUiConfirm(true);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[2px] border focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] ${
                    settings.muted
                      ? 'border-[#ef4444]/70 bg-[#3b1216] text-[#fecaca]'
                      : 'border-[#c99c4a] bg-[#14232d] text-[#f3d285]'
                  }`}
                >
                  {settings.muted ? (
                    <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{settings.muted ? 'Muted' : 'Active'}</span>
                </button>
              </div>

              <label className="block space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 text-[#cbd5e1]">
                    <Music className="w-3.5 h-3.5 text-[#f3d285]" aria-hidden="true" />
                    Music Volume
                  </span>
                  <span className="font-mono-num text-[#f3d285]">{musicPct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.musicVolume ?? 0.35}
                  aria-label="Music Volume"
                  onChange={(e) => {
                    const nextMusicVol = parseFloat(e.target.value);
                    soundEngine.setMusicVolume(nextMusicVol);
                    if (nextMusicVol > 0 && !settings.muted) {
                      soundEngine.unlockFromGesture();
                      void soundEngine.unlockMenuMusicFromGesture();
                    }
                    onUpdateSettings({ musicVolume: nextMusicVol });
                  }}
                  className="w-full accent-[#c99c4a] cursor-pointer"
                />
              </label>

              {menuMusic.status === 'error' && menuMusic.errorMessage && (
                <div
                  role="status"
                  className="flex items-center justify-between gap-2 rounded-[2px] border border-[#ef4444]/50 bg-[#2a1014] px-2.5 py-1.5 text-[11px] text-[#fecaca]"
                >
                  <span>{menuMusic.errorMessage}</span>
                  <button
                    type="button"
                    onClick={() => void soundEngine.retryMenuMusic()}
                    className="shrink-0 underline text-[#f3d285] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285]"
                  >
                    Retry
                  </button>
                </div>
              )}

              <label className="block space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#cbd5e1]">Sound Effects & Ambience Volume</span>
                  <span className="font-mono-num text-[#f3d285]">{volumePct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.volume}
                  aria-label="Sound Effects Volume"
                  onChange={(e) => {
                    const nextVol = parseFloat(e.target.value);
                    soundEngine.setVolume(nextVol);
                    if (nextVol > 0 && !settings.muted) {
                      soundEngine.unlockFromGesture();
                    }
                    onUpdateSettings({ volume: nextVol });
                  }}
                  className="w-full accent-[#c99c4a] cursor-pointer"
                />
              </label>

              {platformCaps.spatialVoiceEnabled && (
                <div className="pt-2 border-t border-[#22323e] space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[#cbd5e1]">Proximity Voice Mode</span>
                    <div className="compendium-track flex items-center gap-1 p-1 rounded-[2px]">
                      {(['open', 'ptt'] as const).map((vm) => (
                        <button
                          key={vm}
                          type="button"
                          aria-pressed={(settings.voiceMode ?? 'open') === vm}
                          onClick={() => onUpdateSettings({ voiceMode: vm })}
                          className={`px-2.5 py-1 text-xs rounded-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] ${
                            (settings.voiceMode ?? 'open') === vm
                              ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                              : 'text-[#9cb0ba] hover:text-white'
                          }`}
                        >
                          {vm === 'open' ? 'Open Mic' : 'PTT [V]'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="block space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#cbd5e1]">Proximity Voice Volume</span>
                      <span className="font-mono-num text-[#f3d285]">{voicePct}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.voiceVolume ?? 0.9}
                      aria-label="Proximity Voice Volume"
                      onChange={(e) =>
                        onUpdateSettings({ voiceVolume: parseFloat(e.target.value) })
                      }
                      className="w-full accent-[#c99c4a] cursor-pointer"
                    />
                  </label>
                </div>
              )}
            </div>
          </section>

          {/* Gameplay & Display Accessibility */}
          <section aria-labelledby="settings-display-heading" className="space-y-3">
            <h3
              id="settings-display-heading"
              className="font-display text-sm font-semibold text-[#f3d285]"
            >
              ◆ Display & Accessibility
            </h3>

            <div className="compendium-plaque-subtle rounded-[2px] p-3.5 space-y-3.5">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-[#e6e4dd]">Reduced Motion & Camera Shake</span>
                <input
                  type="checkbox"
                  checked={settings.reducedMotion}
                  onChange={(e) => onUpdateSettings({ reducedMotion: e.target.checked })}
                  className="accent-[#c99c4a] w-4 h-4 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-[#e6e4dd]">Visual Sound Cues</span>
                <input
                  type="checkbox"
                  checked={settings.visualSoundCues}
                  onChange={(e) => onUpdateSettings({ visualSoundCues: e.target.checked })}
                  className="accent-[#c99c4a] w-4 h-4 cursor-pointer"
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[#e6e4dd]">HUD Scale</span>
                <div className="compendium-track flex items-center gap-1 p-1 rounded-[2px]">
                  {(['compact', 'standard', 'large'] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      aria-pressed={settings.hudScale === sz}
                      onClick={() => onUpdateSettings({ hudScale: sz })}
                      className={`px-2.5 py-1 text-xs rounded-[2px] capitalize focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] ${
                        settings.hudScale === sz
                          ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                          : 'text-[#9cb0ba] hover:text-white'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[#e6e4dd]">Graphics Quality</span>
                <div className="compendium-track flex items-center gap-1 p-1 rounded-[2px]">
                  {(['auto', 'low', 'medium', 'high'] as const).map((q) => (
                    <button
                      key={q}
                      type="button"
                      aria-pressed={graphicsQuality === q}
                      onClick={() => onUpdateSettings({ graphicsQuality: q })}
                      className={`px-2 py-1 text-xs rounded-[2px] capitalize focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] ${
                        graphicsQuality === q
                          ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                          : 'text-[#9cb0ba] hover:text-white'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-[#22323e]">
                <HudVisibilityControls
                  hudVisibility={settings.hudVisibility ?? DEFAULT_HUD_VISIBILITY}
                  onChange={(hudVisibility) => onUpdateSettings({ hudVisibility })}
                />
              </div>
            </div>
          </section>
        </div>

        <div className="border-t border-[#263643] bg-[#0b1319] px-4 sm:px-5 py-3 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-[#9cb0ba]">
            {platformCaps.cloudSaveEnabled
              ? 'Saved via YouTube Playables Cloud'
              : 'Saved automatically on this device'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-[2px] border border-[#f3d285]/45 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

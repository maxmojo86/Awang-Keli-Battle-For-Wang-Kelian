import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, VolumeX } from 'lucide-react';
import { soundEngine } from '../game/audio';
import { AccessibilitySettings } from '../game/types';
import { HowToPlayModal } from './HowToPlayModal';
import { TitleSettingsModal } from './TitleSettingsModal';

export type TitleComposition =
  | 'pc_landscape'
  | 'tablet_landscape'
  | 'portrait'
  | 'phone_landscape';

export const TITLE_ASSETS = {
  backgroundPc: '/assets/aistudio/background_pc_3a680506.png',
  backgroundTablet: '/assets/aistudio/background_tablet_b14c26bb.png',
  backgroundMobile: '/assets/aistudio/background_mobile_7814b36a.png',
  titleLogo: '/assets/aistudio/title_logo_8afae8a7.png',
  buttonPlay: '/assets/aistudio/button_play_4a10f5b1.png',
  buttonHowToPlay: '/assets/aistudio/button_how_to_play_76f4c34d.png',
  buttonSettings: '/assets/aistudio/button_settings_d47aea02.png',
  buttonSound: '/assets/aistudio/button_sound_e94609b9.png',
} as const;

export function selectTitleComposition(width: number, height: number): TitleComposition {
  if (height > width) {
    return 'portrait';
  }
  if (height < 520) {
    return 'phone_landscape';
  }
  const aspect = width / Math.max(1, height);
  if (aspect < 1.56) {
    return 'tablet_landscape';
  }
  return 'pc_landscape';
}

export function getBackgroundForComposition(comp: TitleComposition): string {
  switch (comp) {
    case 'portrait':
      return TITLE_ASSETS.backgroundMobile;
    case 'tablet_landscape':
      return TITLE_ASSETS.backgroundTablet;
    case 'phone_landscape':
    case 'pc_landscape':
    default:
      return TITLE_ASSETS.backgroundPc;
  }
}

const loadedImageUrls = new Set<string>();

function preloadImage(url: string): Promise<void> {
  if (loadedImageUrls.has(url)) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    const done = () => {
      loadedImageUrls.add(url);
      resolve();
    };
    img.onload = done;
    img.onerror = () => resolve();
    img.src = url;
    if (img.complete) done();
  });
}

interface TitleScreenProps {
  settings: AccessibilitySettings;
  onUpdateSettings: (patch: Partial<AccessibilitySettings>) => void;
  onPlay: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  settings,
  onUpdateSettings,
  onPlay,
}) => {
  const [viewport, setViewport] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720,
  }));
  const [osReducedMotion, setOsReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isEnteringPlay, setIsEnteringPlay] = useState(false);

  const playButtonRef = useRef<HTMLButtonElement | null>(null);
  const howToPlayButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const playTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const updateViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);

    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMqChange = (e: MediaQueryListEvent) => setOsReducedMotion(e.matches);
    mq?.addEventListener?.('change', onMqChange);

    return () => {
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      mq?.removeEventListener?.('change', onMqChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (playTimerRef.current !== null) {
        window.clearTimeout(playTimerRef.current);
      }
    };
  }, []);

  const composition = useMemo(
    () => selectTitleComposition(viewport.width, viewport.height),
    [viewport.width, viewport.height]
  );
  const activeBackgroundUrl = getBackgroundForComposition(composition);

  const essentialUrls = useMemo(
    () => [
      activeBackgroundUrl,
      TITLE_ASSETS.titleLogo,
      TITLE_ASSETS.buttonPlay,
      TITLE_ASSETS.buttonHowToPlay,
      TITLE_ASSETS.buttonSettings,
      TITLE_ASSETS.buttonSound,
    ],
    [activeBackgroundUrl]
  );

  const [assetsReady, setAssetsReady] = useState<boolean>(() =>
    essentialUrls.every((u) => loadedImageUrls.has(u))
  );

  useEffect(() => {
    if (essentialUrls.every((u) => loadedImageUrls.has(u))) {
      setAssetsReady(true);
      return;
    }

    let cancelled = false;
    setAssetsReady(false);

    const safetyTimeout = window.setTimeout(() => {
      if (!cancelled) setAssetsReady(true);
    }, 2600);

    Promise.all(essentialUrls.map(preloadImage)).then(() => {
      if (!cancelled) {
        window.clearTimeout(safetyTimeout);
        setAssetsReady(true);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimeout);
    };
  }, [essentialUrls]);

  const reducedMotion = settings.reducedMotion || osReducedMotion;

  const handlePlayClick = () => {
    if (isEnteringPlay) return;
    setIsEnteringPlay(true);
    soundEngine.unlockFromGesture();
    soundEngine.playUiConfirm(false);

    const handoffMs = reducedMotion ? 90 : 180;
    playTimerRef.current = window.setTimeout(() => {
      onPlay();
    }, handoffMs);
  };

  const handleSoundToggle = () => {
    const nextMuted = !settings.muted;
    soundEngine.setMuted(nextMuted);
    onUpdateSettings({ muted: nextMuted });
    if (!nextMuted) {
      soundEngine.unlockFromGesture();
      soundEngine.playUiConfirm(true);
    }
  };

  const bgObjectPosition =
    composition === 'portrait'
      ? viewport.width / Math.max(1, viewport.height) < 0.54
        ? '76% 46%'
        : '70% 48%'
      : composition === 'phone_landscape'
        ? '80% 42%'
        : '76% center';

  const buttonMotionClasses = reducedMotion
    ? 'transition-opacity duration-100 hover:brightness-110 active:brightness-95'
    : 'transition-transform duration-150 ease-out hover:scale-[1.03] hover:brightness-110 active:scale-[0.97] active:brightness-95';

  const isPortrait = composition === 'portrait';
  const isPhoneLandscape = composition === 'phone_landscape';
  const isTabletLandscape = composition === 'tablet_landscape';

  const logoWidthStyle = isPortrait
    ? 'clamp(205px, 63vw, 400px)'
    : isPhoneLandscape
      ? 'clamp(170px, 28.5vw, 248px)'
      : isTabletLandscape
        ? 'clamp(270px, 37vw, 410px)'
        : 'clamp(290px, 32.5vw, 505px)';

  const menuWidthStyle = isPortrait
    ? 'clamp(176px, 44vw, 286px)'
    : isPhoneLandscape
      ? 'clamp(164px, 22.5vw, 212px)'
      : isTabletLandscape
        ? 'clamp(215px, 26vw, 292px)'
        : 'clamp(220px, 21vw, 326px)';

  const menuButtons = [
    {
      id: 'play',
      label: isEnteringPlay ? 'Opening match setup…' : 'Play',
      asset: TITLE_ASSETS.buttonPlay,
      ref: playButtonRef,
      onClick: handlePlayClick,
      disabled: isEnteringPlay,
    },
    {
      id: 'how-to-play',
      label: 'How to Play',
      asset: TITLE_ASSETS.buttonHowToPlay,
      ref: howToPlayButtonRef,
      onClick: () => {
        soundEngine.unlockFromGesture();
        soundEngine.playUiConfirm(true);
        setHowToPlayOpen(true);
      },
      disabled: isEnteringPlay,
    },
    {
      id: 'settings',
      label: 'Settings',
      asset: TITLE_ASSETS.buttonSettings,
      ref: settingsButtonRef,
      onClick: () => {
        soundEngine.unlockFromGesture();
        soundEngine.playUiConfirm(true);
        setSettingsOpen(true);
      },
      disabled: isEnteringPlay,
    },
  ] as const;

  return (
    <div
      data-title-composition={composition}
      className="relative w-full h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#091116] select-none"
    >
      {/* Selected Responsive Background (cover-scaled, keeps Awang Keli clear on right) */}
      <img
        src={activeBackgroundUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: bgObjectPosition }}
      />

      {/* Lightweight Asset Loading Curtain */}
      {!assetsReady && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-40 flex items-center justify-center bg-[#091116] p-6"
        >
          <div className="compendium-plaque rounded-sm px-6 py-4 flex items-center gap-3">
            <Loader2
              className={`w-5 h-5 text-[#f3d285] shrink-0 ${
                reducedMotion ? '' : 'animate-spin'
              }`}
              aria-hidden="true"
            />
            <span className="font-display text-sm sm:text-base text-[#f7f2e7]">
              Preparing Wang Kelian…
            </span>
          </div>
        </div>
      )}

      {/* Main Title Screen Content Layer (inside device safe areas, strictly within 100dvh) */}
      <div
        className={`relative z-10 w-full h-full flex flex-col justify-between overflow-hidden transition-opacity ${
          reducedMotion ? 'duration-100' : 'duration-300'
        } ${assetsReady ? 'opacity-100' : 'opacity-0'}`}
        style={{
          paddingTop: isPhoneLandscape
            ? 'max(18px, env(safe-area-inset-top))'
            : isPortrait
              ? 'max(26px, clamp(24px, 4.2vh, 52px), env(safe-area-inset-top))'
              : isTabletLandscape
                ? 'max(32px, env(safe-area-inset-top))'
                : 'max(40px, clamp(36px, 6vh, 72px), env(safe-area-inset-top))',
          paddingBottom: isPhoneLandscape
            ? 'max(16px, env(safe-area-inset-bottom))'
            : 'max(24px, env(safe-area-inset-bottom))',
          paddingLeft: isPhoneLandscape
            ? 'max(32px, clamp(30px, 4.8vw, 48px), env(safe-area-inset-left))'
            : isPortrait
              ? 'max(24px, clamp(24px, 5.8vw, 56px), env(safe-area-inset-left))'
              : isTabletLandscape
                ? 'max(44px, clamp(40px, 5.6vw, 72px), env(safe-area-inset-left))'
                : 'max(48px, clamp(44px, 6.2vw, 108px), env(safe-area-inset-left))',
          paddingRight: isPhoneLandscape
            ? 'max(24px, env(safe-area-inset-right))'
            : isPortrait
              ? 'max(24px, clamp(24px, 5.8vw, 56px), env(safe-area-inset-right))'
              : 'max(32px, clamp(28px, 3.6vw, 60px), env(safe-area-inset-right))',
        }}
      >
        {/* Upper-Right Safe Area Sound Toggle Button */}
        <div
          className="absolute z-20"
          style={{
            top: isPhoneLandscape
              ? 'max(18px, env(safe-area-inset-top))'
              : isPortrait
                ? 'max(22px, clamp(20px, 3vh, 36px), env(safe-area-inset-top))'
                : isTabletLandscape
                  ? 'max(26px, env(safe-area-inset-top))'
                  : 'max(28px, clamp(24px, 4.2vh, 48px), env(safe-area-inset-top))',
            right: isPhoneLandscape
              ? 'max(24px, env(safe-area-inset-right))'
              : isPortrait
                ? 'max(22px, clamp(20px, 4.5vw, 40px), env(safe-area-inset-right))'
                : isTabletLandscape
                  ? 'max(28px, env(safe-area-inset-right))'
                  : 'max(28px, clamp(24px, 3.2vw, 52px), env(safe-area-inset-right))',
          }}
        >
          <button
            type="button"
            onClick={handleSoundToggle}
            aria-pressed={settings.muted}
            aria-label={
              settings.muted
                ? 'Sound muted. Activate to unmute game audio'
                : 'Sound on. Activate to mute game audio'
            }
            title={settings.muted ? 'Unmute Audio' : 'Mute Audio'}
            className={`relative appearance-none border-0 bg-transparent p-0 m-0 cursor-pointer flex items-center justify-center overflow-visible rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] focus-visible:ring-offset-2 focus-visible:ring-offset-[#091116] ${
              isPhoneLandscape || isPortrait
                ? 'w-11 h-11 sm:w-13 sm:h-13'
                : 'w-13 h-13 lg:w-14 lg:h-14'
            } ${buttonMotionClasses}`}
          >
            <img
              src={TITLE_ASSETS.buttonSound}
              alt=""
              aria-hidden="true"
              draggable={false}
              width={1262}
              height={1246}
              className={`pointer-events-none select-none block max-w-none h-auto ${
                settings.muted ? 'brightness-75 saturate-50' : ''
              }`}
              style={{
                width: '150%',
                aspectRatio: '1262 / 1246',
              }}
            />

            {settings.muted && (
              <>
                <svg
                  viewBox="0 0 48 48"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 w-full h-full"
                >
                  <line
                    x1="10"
                    y1="10"
                    x2="38"
                    y2="38"
                    stroke="#ef4444"
                    strokeWidth="4.2"
                    strokeLinecap="round"
                  />
                  <line
                    x1="10"
                    y1="10"
                    x2="38"
                    y2="38"
                    stroke="#fef2f2"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -bottom-1.5 -right-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[2px] border border-[#fca5a5]/85 bg-[#7f1d1d] text-[9px] font-mono-num font-bold tracking-wider text-[#fef2f2] shadow"
                >
                  <VolumeX className="w-2.5 h-2.5" />
                  MUTE
                </span>
              </>
            )}
          </button>
        </div>

        {/* Left / Top-Sky Title & Menu Cluster (clear of Awang Keli's face & body) */}
        <main
          className={`flex flex-col items-start min-w-0 max-w-full ${
            isPhoneLandscape || isTabletLandscape
              ? 'my-auto justify-center'
              : 'justify-start'
          }`}
        >
          {/* Decorative Title Logo (kept clear of top-right sound button) */}
          <h1 className="sr-only">Awang Keli: Battle for Wang Kelian</h1>
          <div
            className="shrink-0 max-w-[calc(100%-64px)] sm:max-w-full"
            style={{ width: logoWidthStyle }}
          >
            <img
              src={TITLE_ASSETS.titleLogo}
              alt=""
              aria-hidden="true"
              draggable={false}
              width={2055}
              height={765}
              className="pointer-events-none select-none block w-full h-auto drop-shadow-[0_10px_22px_rgba(0,0,0,0.65)]"
              style={{ aspectRatio: '2055 / 765' }}
            />
          </div>

          {/* Primary Menu Buttons */}
          <nav
            aria-label="Main Menu"
            className={`flex flex-col items-stretch ${
              isPhoneLandscape
                ? 'mt-2 gap-2'
                : isPortrait
                  ? 'mt-[clamp(10px,2vh,22px)] gap-2.5 sm:gap-3.5'
                  : 'mt-[clamp(14px,2.4vh,28px)] gap-3 sm:gap-3.5'
            }`}
            style={{ width: menuWidthStyle }}
          >
            {menuButtons.map((btn) => (
              <button
                key={btn.id}
                ref={btn.ref}
                type="button"
                onClick={btn.onClick}
                disabled={btn.disabled}
                aria-label={btn.label}
                aria-busy={btn.id === 'play' && isEnteringPlay ? 'true' : undefined}
                className={`relative appearance-none border-0 bg-transparent p-0 m-0 w-full flex items-center justify-center overflow-visible rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] focus-visible:ring-offset-2 focus-visible:ring-offset-[#091116] ${
                  btn.disabled ? 'cursor-wait opacity-85' : `cursor-pointer ${buttonMotionClasses}`
                }`}
                style={{
                  aspectRatio: '4.6 / 1',
                  minHeight: isPhoneLandscape ? '40px' : '44px',
                }}
              >
                <img
                  src={btn.asset}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  width={2172}
                  height={724}
                  className="pointer-events-none select-none block max-w-none h-auto"
                  style={{
                    width: '108%',
                    aspectRatio: '2172 / 724',
                  }}
                />
                {btn.id === 'play' && isEnteringPlay && (
                  <span
                    role="status"
                    aria-live="polite"
                    className="pointer-events-none absolute inset-x-3 inset-y-1 flex items-center justify-center gap-1.5 rounded-[3px] bg-[#0b1218]/90 border border-[#f3d285] text-[11px] sm:text-xs font-mono-num font-semibold text-[#f3d285]"
                  >
                    <Loader2
                      className={`w-3.5 h-3.5 shrink-0 ${reducedMotion ? '' : 'animate-spin'}`}
                      aria-hidden="true"
                    />
                    <span>Entering…</span>
                  </span>
                )}
              </button>
            ))}
          </nav>
        </main>
      </div>

      {/* Responsive Scrollable Rules & Device Controls Overlay */}
      <HowToPlayModal
        open={howToPlayOpen}
        onClose={() => setHowToPlayOpen(false)}
        returnFocusRef={howToPlayButtonRef}
      />

      {/* Accessible Settings Overlay Synced With Game & LocalStorage */}
      <TitleSettingsModal
        open={settingsOpen}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        onClose={() => setSettingsOpen(false)}
        returnFocusRef={settingsButtonRef}
      />
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, VolumeX } from 'lucide-react';
import { registerAndroidBackHandler } from '../game/androidNative';
import { MenuMusicSnapshot, soundEngine } from '../game/audio';
import { AccessibilitySettings } from '../game/types';
import { HowToPlayModal } from './HowToPlayModal';
import { InstallGameControl } from './InstallGameControl';
import { TitleSettingsModal } from './TitleSettingsModal';
import { VoluntarySupportControl } from './VoluntarySupportControl';
import { resolveAssetUrl } from '../utils/assetUrl';

export type TitleComposition =
  | 'pc_landscape'
  | 'tablet_landscape'
  | 'portrait'
  | 'phone_landscape';

export const TITLE_ASSETS = {
  backgroundPc: resolveAssetUrl('assets/aistudio/background_pc_3a680506.webp'),
  backgroundTablet: resolveAssetUrl('assets/aistudio/background_tablet_b14c26bb.webp'),
  backgroundMobile: resolveAssetUrl('assets/aistudio/background_mobile_7814b36a.webp'),
  titleLogo: resolveAssetUrl('assets/aistudio/title_logo_8afae8a7.webp'),
  buttonPlay: resolveAssetUrl('assets/aistudio/button_play_4a10f5b1.webp'),
  buttonHowToPlay: resolveAssetUrl('assets/aistudio/button_how_to_play_76f4c34d.webp'),
  buttonSettings: resolveAssetUrl('assets/aistudio/button_settings_d47aea02.webp'),
  buttonSound: resolveAssetUrl('assets/aistudio/button_sound_e94609b9.webp'),
  creatorLogo: resolveAssetUrl('assets/aistudio/image_dbd82719.png'),
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
let hasPlayedTitleIntro = false;

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
  const [menuMusic, setMenuMusic] = useState<MenuMusicSnapshot>(() =>
    soundEngine.getMenuMusicSnapshot()
  );

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
    window.visualViewport?.addEventListener('resize', updateViewport);

    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMqChange = (e: MediaQueryListEvent) => setOsReducedMotion(e.matches);
    mq?.addEventListener?.('change', onMqChange);

    return () => {
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
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

  useEffect(() => {
    if (!howToPlayOpen && !settingsOpen) return;
    return registerAndroidBackHandler(() => {
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (howToPlayOpen) {
        setHowToPlayOpen(false);
        return true;
      }
      return false;
    }, 25);
  }, [howToPlayOpen, settingsOpen]);

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
      TITLE_ASSETS.creatorLogo,
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

  useEffect(() => {
    return soundEngine.subscribeMenuMusic(setMenuMusic);
  }, []);

  useEffect(() => {
    void soundEngine.preloadMenuMusic();
  }, []);

  const reducedMotion = settings.reducedMotion || osReducedMotion;
  const [introActive, setIntroActive] = useState<boolean>(() => !hasPlayedTitleIntro);

  useEffect(() => {
    if (!introActive || !assetsReady) return;
    hasPlayedTitleIntro = true;

    if (reducedMotion) {
      setIntroActive(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setIntroActive(false);
    }, 2080);

    return () => {
      window.clearTimeout(timer);
    };
  }, [introActive, assetsReady, reducedMotion]);

  const shouldAnimateIntro = introActive && assetsReady && !reducedMotion;

  const handlePlayClick = () => {
    if (isEnteringPlay) return;
    setIsEnteringPlay(true);
    soundEngine.unlockFromGesture();
    void soundEngine.unlockMenuMusicFromGesture();
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
      void soundEngine.unlockMenuMusicFromGesture();
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
  const isPhone = isPhoneLandscape || (isPortrait && viewport.width < 700);

  const logoWidthStyle = isPortrait
    ? 'clamp(248px, 70vw, 450px)'
    : isPhoneLandscape
      ? 'clamp(215px, 31vw, 285px)'
      : isTabletLandscape
        ? 'clamp(300px, 39vw, 440px)'
        : 'clamp(340px, 34vw, 600px)';

  const menuWidthStyle = isPortrait
    ? 'clamp(192px, 50vw, 290px)'
    : isPhoneLandscape
      ? 'clamp(176px, 23vw, 220px)'
      : isTabletLandscape
        ? 'clamp(230px, 26vw, 310px)'
        : 'clamp(236px, 21vw, 350px)';

  // Reserve space on the right in landscape compositions so centering the logo + menu
  // puts them optically in the middle of the screen without obscuring Awang Keli's face.
  const landscapeRightReserve = isPortrait
    ? undefined
    : isTabletLandscape || isPhoneLandscape
      ? 'max(14vw, env(safe-area-inset-right))'
      : 'max(11vw, env(safe-area-inset-right))';

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
        void soundEngine.unlockMenuMusicFromGesture();
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
        void soundEngine.unlockMenuMusicFromGesture();
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

      {/* Upper-Left Safe Area Standalone Web Install Game Control (hidden in dev/Android/YouTube/installed) */}
      <div
        className={`absolute z-20 transition-opacity ${
          reducedMotion ? 'duration-100' : 'duration-300'
        } ${assetsReady ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        style={{
          top: isPhoneLandscape
            ? 'max(14px, env(safe-area-inset-top))'
            : isPortrait
              ? 'max(18px, clamp(16px, 2.4vh, 30px), env(safe-area-inset-top))'
              : isTabletLandscape
                ? 'max(24px, env(safe-area-inset-top))'
                : 'max(26px, clamp(22px, 3.8vh, 44px), env(safe-area-inset-top))',
          left: isPhoneLandscape
            ? 'max(16px, env(safe-area-inset-left))'
            : isPortrait
              ? 'max(16px, clamp(16px, 3.6vw, 34px), env(safe-area-inset-left))'
              : isTabletLandscape
                ? 'max(24px, env(safe-area-inset-left))'
                : 'max(26px, clamp(22px, 3vw, 48px), env(safe-area-inset-left))',
        }}
      >
        <InstallGameControl
          compact={isPhoneLandscape || viewport.width < 420}
          disabled={isEnteringPlay}
        />
      </div>

      {/* Upper-Right Safe Area Sound Toggle Button */}
      <div
        className={`absolute z-20 transition-opacity ${
          reducedMotion ? 'duration-100' : 'duration-300'
        } ${assetsReady ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        style={{
          top: isPhoneLandscape
            ? 'max(18px, env(safe-area-inset-top))'
            : isPortrait
              ? 'max(20px, clamp(18px, 2.8vh, 34px), env(safe-area-inset-top))'
              : isTabletLandscape
                ? 'max(26px, env(safe-area-inset-top))'
                : 'max(28px, clamp(24px, 4.2vh, 48px), env(safe-area-inset-top))',
          right: isPhoneLandscape
            ? 'max(24px, env(safe-area-inset-right))'
            : isPortrait
              ? 'max(20px, clamp(18px, 4vw, 38px), env(safe-area-inset-right))'
              : isTabletLandscape
                ? 'max(28px, env(safe-area-inset-right))'
                : 'max(28px, clamp(24px, 3.2vw, 52px), env(safe-area-inset-right))',
        }}
      >
        <div className={shouldAnimateIntro ? 'animate-title-sound-intro' : undefined}>
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
      </div>

      {/* Main Title Screen Content Layer (inside device safe areas, reserves bottom space for fixed credit and scrolls cleanly on short viewports) */}
      <div
        className={`absolute inset-x-0 top-0 z-10 flex flex-col items-center justify-start overflow-y-auto overflow-x-hidden overscroll-contain transition-opacity ${
          reducedMotion ? 'duration-100' : 'duration-300'
        } ${assetsReady ? 'opacity-100' : 'opacity-0'}`}
        style={{
          bottom: isPhone
            ? 'calc(max(8px, env(safe-area-inset-bottom)) + 48px)'
            : 'calc(max(8px, env(safe-area-inset-bottom)) + 58px)',
          paddingTop: isPhoneLandscape
            ? 'max(16px, env(safe-area-inset-top))'
            : isPortrait
              ? viewport.width < 520
                ? 'max(66px, clamp(62px, 7.2vh, 78px), env(safe-area-inset-top))'
                : 'max(54px, clamp(48px, 5.5vh, 66px), env(safe-area-inset-top))'
              : isTabletLandscape
                ? 'max(28px, clamp(26px, 3.8vh, 42px), env(safe-area-inset-top))'
                : 'max(34px, clamp(28px, 4.2vh, 52px), env(safe-area-inset-top))',
          paddingBottom: isPhoneLandscape ? '10px' : '16px',
          paddingLeft: isPhoneLandscape
            ? 'max(24px, env(safe-area-inset-left))'
            : isPortrait
              ? 'max(20px, clamp(20px, 5vw, 48px), env(safe-area-inset-left))'
              : 'max(32px, clamp(28px, 3.5vw, 56px), env(safe-area-inset-left))',
          paddingRight: isPortrait
            ? 'max(20px, clamp(20px, 5vw, 48px), env(safe-area-inset-right))'
            : landscapeRightReserve,
        }}
      >

        {/* Centered Top-Middle Title Logo & Middle-Aligned Menu Stack (clear of Awang Keli) */}
        <main className="flex flex-col items-center justify-start min-w-0 max-w-full">
          {/* Decorative Prominent Top-Middle Title Logo */}
          <h1 className="sr-only">Awang Keli: Battle for Wang Kelian</h1>
          <div
            data-testid="title-logo-intro"
            className={`shrink-0 max-w-full ${
              shouldAnimateIntro ? 'animate-title-logo-intro' : ''
            }`}
            style={{ width: logoWidthStyle }}
          >
            <img
              src={TITLE_ASSETS.titleLogo}
              alt=""
              aria-hidden="true"
              draggable={false}
              width={2055}
              height={765}
              className="pointer-events-none select-none block w-full h-auto drop-shadow-[0_10px_24px_rgba(0,0,0,0.68)]"
              style={{ aspectRatio: '2055 / 765' }}
            />
          </div>

          {/* Primary Menu Buttons */}
          <nav
            aria-label="Main Menu"
            className={`flex flex-col items-stretch ${
              isPhoneLandscape
                ? 'mt-[clamp(10px,3.5vh,18px)] gap-2'
                : isPortrait
                  ? 'mt-[clamp(14px,2.2vh,24px)] gap-2.5 sm:gap-3.5'
                  : isTabletLandscape
                    ? 'mt-[clamp(24px,5.2vh,44px)] gap-3'
                    : 'mt-[clamp(26px,5.5vh,62px)] gap-3 sm:gap-4'
            }`}
            style={{ width: menuWidthStyle }}
          >
            {menuButtons.map((btn, idx) => (
              <div
                key={btn.id}
                data-testid={`title-btn-intro-${btn.id}`}
                className={`w-full ${
                  shouldAnimateIntro
                    ? idx === 0
                      ? 'animate-title-btn-1'
                      : idx === 1
                        ? 'animate-title-btn-2'
                        : 'animate-title-btn-3'
                    : ''
                }`}
              >
                <button
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
              </div>
            ))}
          </nav>

          {/* Compact Secondary Voluntary Support Control (Standalone Web & PWA Only) */}
          <div
            className={
              isPhoneLandscape
                ? 'mt-2.5 flex justify-center'
                : isPortrait
                  ? 'mt-3.5 flex justify-center'
                  : 'mt-4 flex justify-center'
            }
          >
            <VoluntarySupportControl
              variant="title"
              compact={isPhone}
              disabled={isEnteringPlay}
              reducedMotion={reducedMotion}
            />
          </div>
        </main>
      </div>

      {/* Compact Fixed Bottom-Center Creator Credit (Title Screen Only, Non-Interactive) */}
      <div
        data-testid="title-creator-credit"
        className={`fixed z-20 pointer-events-none select-none inline-flex flex-row items-center justify-center max-w-[calc(100vw-24px)] rounded-[4px] bg-[#091116]/68 border border-[#c99c4a]/22 shadow-[0_4px_14px_rgba(0,0,0,0.45)] transition-opacity ${
          isPhone ? 'gap-2 px-2.5 py-1' : 'gap-2.5 px-3 py-1'
        } ${reducedMotion ? 'duration-100' : 'duration-300'} ${
          assetsReady ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          bottom: 'max(8px, env(safe-area-inset-bottom))',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        <img
          src={TITLE_ASSETS.creatorLogo}
          alt="drmujahid logo"
          draggable={false}
          width={1118}
          height={1118}
          className="block shrink-0 aspect-square object-contain"
          style={{
            width: isPhone ? '32px' : '40px',
            height: 'auto',
          }}
        />
        <p
          className={`leading-tight whitespace-nowrap font-medium tracking-[0.02em] text-[#f5efe6] drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] ${
            isPhone ? 'text-[11px]' : 'text-[12px]'
          }`}
        >
          a Malaysian game by drmujahid
        </p>
      </div>

      {/* Concise Non-Blocking Audio Failure Status */}
      {menuMusic.status === 'error' && menuMusic.errorMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 z-30 max-w-[92vw] compendium-plaque rounded-[2px] px-3 py-1.5 flex items-center gap-2.5 text-[11px] sm:text-xs text-[#fecaca]"
          style={{
            bottom: isPhone
              ? 'calc(max(8px, env(safe-area-inset-bottom)) + 54px)'
              : 'calc(max(8px, env(safe-area-inset-bottom)) + 64px)',
          }}
        >
          <span className="truncate">{menuMusic.errorMessage}</span>
          <button
            type="button"
            onClick={() => void soundEngine.retryMenuMusic()}
            className="shrink-0 px-2 py-0.5 rounded-[2px] border border-[#f3d285]/60 bg-[#142029] text-[#f3d285] hover:border-[#f3d285] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285]"
          >
            Retry
          </button>
        </div>
      )}

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

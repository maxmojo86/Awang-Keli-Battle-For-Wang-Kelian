import React, { useEffect, useRef, useState } from 'react';
import {
  Pause,
  Play,
  Volume2,
  VolumeX,
  ArrowUpRight,
  LogOut,
  RotateCcw,
  Swords,
  Radar,
  ChevronLeft,
  ChevronRight,
  Crown,
  Eye,
  FileText,
  Mic,
  MicOff,
  Radio,
  CloudRain,
  CloudFog,
  Sun,
  Heart,
  Sparkles,
  Zap,
  Droplets,
  Wind,
  Shield,
  Skull,
  AlertTriangle,
  Users,
  Timer,
  Gauge,
  BatteryLow,
  MessageCircle,
} from 'lucide-react';
import {
  ACTIVE_ABILITIES,
  getEvolutionForm,
  getFormLabel,
  getMilestoneTier,
  getNextMilestone,
} from '../data/abilities';
import { EMOTE_SPECS, EmoteId, getEmoteSpec } from '../data/emotes';
import { getTerrainAt, getZoneAt } from '../game/arena';
import {
  isNativeAndroid,
  registerAndroidBackHandler,
  subscribeAppLifecycle,
} from '../game/androidNative';
import { soundEngine } from '../game/audio';
import { getEvolutionProgressInfo } from '../game/evolutionExperience';
import {
  multiplayerClient,
  type MultiplayerSnapshot,
  RemoteSimulationView,
} from '../game/multiplayerClient';
import { resolveHudDisplayName } from '../game/nameplate';
import { getPlatformCapabilities } from '../game/platform';
import { MatchReplayData, MatchReplayRecorder } from '../game/replay';
import { ArenaScene3D } from '../game/scene3d';
import { GameSimulation, PlayerInputState } from '../game/simulation';
import { spatialVoice, SpatialVoiceSnapshot } from '../game/spatialVoice';
import { drawPortraitToCanvas, subscribeCodexSpritesLoaded } from '../game/sprites';
import { DEFAULT_HUD_VISIBILITY } from '../game/settings';
import {
  AccessibilitySettings,
  AbilityId,
  AiDebugEntry,
  AiDifficulty,
  GraphicsQuality,
  HudSnapshot,
  LobbySize,
  MatchMode,
} from '../game/types';
import { youtubePlayablesBridge } from '../game/youtubePlayables';
import { AiDebugOverlay } from './AiDebugOverlay';
import { DamageHitOverlay } from './DamageHitOverlay';
import { EmoteWheel, pickEmoteIndexFromDelta } from './EmoteWheel';
import { EvolutionFormToast, EvolutionToastEvent } from './EvolutionFormToast';
import { EvolutionOverlay, EvolutionOverlayEvent } from './EvolutionOverlay';
import { HudVisibilityControls } from './HudVisibilityControls';
import { Minimap } from './Minimap';
import { MultiplayerDebugPanel } from './MultiplayerDebugPanel';

interface GameViewportProps {
  lobbySize: LobbySize;
  mode: MatchMode;
  playerName?: string;
  isMultiplayer?: boolean;
  multiplayerPlayerId?: string | null;
  multiplayerMatchId?: string | null;
  roomCode?: string | null;
  latencyMs?: number | null;
  mpSnapshot?: MultiplayerSnapshot;
  settings: AccessibilitySettings;
  onUpdateSettings: (patch: Partial<AccessibilitySettings>) => void;
  onMatchFinished: (finalHud: HudSnapshot, replay: MatchReplayData) => void;
  onExitToLobby: () => void;
  onRestart: () => void;
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatKeyCodeLabel(code: string | undefined): string {
  if (!code) return 'C';
  if (code.startsWith('Key')) return code.slice(3);
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  return code.slice(0, 4);
}

function AbilityIcon({ id, unlocked }: { id: AbilityId; unlocked: boolean }) {
  const opacity = unlocked ? 'opacity-100' : 'opacity-35 grayscale';
  switch (id) {
    case 'bite':
      return (
        <svg viewBox="0 0 32 32" className={`w-7 h-7 sm:w-8 sm:h-8 ${opacity}`} aria-hidden="true">
          <defs>
            <radialGradient id="ab-bite" cx="50%" cy="45%" r="55%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#1c0d10" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="url(#ab-bite)" />
          <path d="M6 12 L12 15 L15 9 L19 14 L26 10 L22 17 L26 21 L18 19 L14 25 L11 19 L6 21 L9 16 Z" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M10 14 L14 19 L18 14 L21 18" fill="none" stroke="#991b1b" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case 'evade':
      return (
        <svg viewBox="0 0 32 32" className={`w-7 h-7 sm:w-8 sm:h-8 ${opacity}`} aria-hidden="true">
          <defs>
            <radialGradient id="ab-evade" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.58" />
              <stop offset="100%" stopColor="#082032" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="url(#ab-evade)" />
          <path d="M7 11 L15 16 L7 21" fill="none" stroke="#a5f3fc" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 9 L23 16 L14 23" fill="none" stroke="#22d3ee" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M23 11 C26 14, 26 18, 23 21" fill="none" stroke="#e0f2fe" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'dash':
      return (
        <svg viewBox="0 0 32 32" className={`w-7 h-7 sm:w-8 sm:h-8 ${opacity}`} aria-hidden="true">
          <defs>
            <radialGradient id="ab-dash" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#082032" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="url(#ab-dash)" />
          <path d="M5 13 C11 8, 19 8, 26 13" fill="none" stroke="#7dd3fc" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M4 18 C11 13, 20 13, 27 18" fill="none" stroke="#38bdf8" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M8 23 C14 19, 20 19, 25 23" fill="none" stroke="#bae6fd" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M21 10 L27 14 L21 18" fill="none" stroke="#f7f2e7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'sonar':
      return <Radar className={`w-6 h-6 ${unlocked ? 'text-[#7dd3fc]' : 'text-[#4e5f6b]'}`} />;
    case 'veil':
      return (
        <svg viewBox="0 0 32 32" className={`w-7 h-7 sm:w-8 sm:h-8 ${opacity}`} aria-hidden="true">
          <defs>
            <radialGradient id="ab-veil" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#091514" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="url(#ab-veil)" />
          <path d="M7 18 C7 12, 13 9, 18 11 C23 12, 26 16, 24 20 C22 23, 10 24, 7 18 Z" fill="#134e4a" stroke="#5eead4" strokeWidth="1.3" />
          <path d="M11 16 C14 13, 20 14, 21 18" fill="none" stroke="#99f6e4" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="13" cy="18" r="1.4" fill="#ccfbf1" />
          <circle cx="19" cy="15" r="1.1" fill="#5eead4" />
        </svg>
      );
    case 'electroshock':
      return (
        <svg viewBox="0 0 32 32" className={`w-7 h-7 sm:w-8 sm:h-8 ${opacity}`} aria-hidden="true">
          <defs>
            <radialGradient id="ab-elec" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#0a1628" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="url(#ab-elec)" />
          <path d="M18 5 L10 17 L16 17 L13 27 L23 14 L17 14 Z" fill="#e0f2fe" stroke="#22d3ee" strokeWidth="1.3" strokeLinejoin="round" />
          <circle cx="16" cy="16" r="11" fill="none" stroke="#38bdf8" strokeWidth="0.9" strokeDasharray="3 3" />
        </svg>
      );
    case 'maelstrom':
      return (
        <svg viewBox="0 0 32 32" className={`w-7 h-7 sm:w-8 sm:h-8 ${opacity}`} aria-hidden="true">
          <defs>
            <radialGradient id="ab-mael" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#081226" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="url(#ab-mael)" />
          <path d="M16 6 C23 6, 26 12, 24 18 C22 23, 15 26, 10 22 C6 19, 7 12, 12 10 C16 8, 21 11, 20 16 C19 19, 14 20, 13 17" fill="none" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
          <circle cx="16" cy="16" r="2.2" fill="#f3d285" />
        </svg>
      );
  }
}

export const GameViewport: React.FC<GameViewportProps> = ({
  lobbySize,
  mode,
  playerName,
  isMultiplayer = false,
  multiplayerPlayerId = null,
  multiplayerMatchId = null,
  roomCode = null,
  latencyMs = null,
  mpSnapshot,
  settings,
  onUpdateSettings,
  onMatchFinished,
  onExitToLobby,
  onRestart,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const portraitRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<GameSimulation | null>(null);
  const remoteRef = useRef<RemoteSimulationView | null>(null);
  const replayRecorderRef = useRef<MatchReplayRecorder>(new MatchReplayRecorder());
  const inputRef = useRef<PlayerInputState>({
    moveX: 0,
    moveZ: 0,
    aimAngle: 0,
    biteHeld: false,
  });
  const sceneRef = useRef<ArenaScene3D | null>(null);
  const pausedRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onMatchFinishedRef = useRef(onMatchFinished);
  onMatchFinishedRef.current = onMatchFinished;
  const playerNameRef = useRef(playerName);
  playerNameRef.current = playerName;

  const [paused, setPaused] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [latestSnapshotTick, setLatestSnapshotTick] = useState<number | null>(null);
  const [spectateSpeed, setSpectateSpeed] = useState<1 | 2 | 4>(1);
  const spectateSpeedRef = useRef<1 | 2 | 4>(1);
  spectateSpeedRef.current = spectateSpeed;

  const [evolutionEvent, setEvolutionEvent] = useState<EvolutionOverlayEvent | null>(null);
  const [evolutionToast, setEvolutionToast] = useState<EvolutionToastEvent | null>(null);
  const prevPlayerFormRef = useRef<number>(1);
  const evoSeqRef = useRef<number>(0);

  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720,
  }));
  const [joyOffset, setJoyOffset] = useState({ x: 0, y: 0 });
  const [bitePressed, setBitePressed] = useState(false);
  const [voiceSnap, setVoiceSnap] = useState<SpatialVoiceSnapshot>(() =>
    spatialVoice.getSnapshot()
  );
  const [emoteWheelOpen, setEmoteWheelOpen] = useState(false);
  const [emoteHoverIdx, setEmoteHoverIdx] = useState<number | null>(null);
  const [emoteCooldownLeft, setEmoteCooldownLeft] = useState(0);
  const emoteWheelOpenRef = useRef(false);
  emoteWheelOpenRef.current = emoteWheelOpen;
  const emoteHoverIdxRef = useRef<number | null>(null);
  emoteHoverIdxRef.current = emoteHoverIdx;
  const emoteHoldStartRef = useRef(0);
  const emoteOpenedThisKeyRef = useRef(false);
  const emoteLastUsedAtRef = useRef(0);

  const joyOriginRef = useRef<{ x: number; y: number } | null>(null);
  const joySmoothRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const joyPointerIdRef = useRef<number | null>(null);
  const bitePointerIdRef = useRef<number | null>(null);
  const hudJoltRef = useRef<HTMLDivElement | null>(null);
  const [showAiDebug, setShowAiDebug] = useState(false);
  const showAiDebugRef = useRef(false);
  showAiDebugRef.current = showAiDebug;
  const platformCaps = getPlatformCapabilities();
  const [aiDebugEntries, setAiDebugEntries] = useState<AiDebugEntry[]>([]);
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>(
    settings.aiDifficulty ?? 'normal'
  );
  const lastTickRef = useRef<number>(performance.now());

  const handleDamageJolt = (jolt: { x: number; y: number }) => {
    const el = hudJoltRef.current;
    if (!el) return;
    if (Math.abs(jolt.x) < 0.05 && Math.abs(jolt.y) < 0.05) {
      el.style.transform = '';
    } else {
      el.style.transform = `translate3d(${jolt.x.toFixed(1)}px, ${jolt.y.toFixed(1)}px, 0)`;
    }
  };

  useEffect(() => {
    if (!isMultiplayer) return;
    return spatialVoice.subscribe(setVoiceSnap);
  }, [isMultiplayer]);

  useEffect(() => {
    if (emoteCooldownLeft <= 0) return;
    const id = window.setInterval(() => {
      const rem = Math.max(0, 1.1 - (performance.now() - emoteLastUsedAtRef.current) / 1000);
      setEmoteCooldownLeft(rem);
      if (rem <= 0) window.clearInterval(id);
    }, 80);
    return () => window.clearInterval(id);
  }, [emoteCooldownLeft]);

  const pushPlayerInput = (patch: Partial<PlayerInputState>, force = false) => {
    Object.assign(inputRef.current, patch);
    if (isMultiplayer) {
      multiplayerClient.sendPlayerInput(inputRef.current, force);
    } else {
      simRef.current?.setInput(patch);
    }
  };

  const dispatchAbility = (ability: AbilityId) => {
    if (isMultiplayer) {
      multiplayerClient.triggerAbility(ability);
    } else {
      simRef.current?.triggerPlayerAbility(ability);
    }
  };

  const dispatchEmote = (emoteId: EmoteId) => {
    const now = performance.now();
    const elapsed = (now - emoteLastUsedAtRef.current) / 1000;
    if (elapsed < 1.1) {
      setEmoteCooldownLeft(1.1 - elapsed);
      return;
    }
    soundEngine.startAmbient();
    emoteLastUsedAtRef.current = now;
    setEmoteCooldownLeft(1.1);
    setEmoteWheelOpen(false);
    setEmoteHoverIdx(null);
    if (isMultiplayer) {
      multiplayerClient.triggerEmote(emoteId);
    } else {
      simRef.current?.triggerPlayerEmote(emoteId);
    }
  };

  const finishWithReplay = (finalHud: HudSnapshot) => {
    soundEngine.stopAmbient();
    const liveEntity = isMultiplayer
      ? remoteRef.current?.getPlayer()
      : simRef.current?.getPlayer();
    const replayData = replayRecorderRef.current.finalize(finalHud, liveEntity);
    onMatchFinishedRef.current(finalHud, replayData);
  };

  useEffect(() => {
    const checkViewport = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setIsTouchDevice(
        'ontouchstart' in window || navigator.maxTouchPoints > 0 || isNativeAndroid()
      );
      setIsMobileViewport(w < 768);
      setViewportSize({ width: w, height: h });
    };
    checkViewport();
    window.addEventListener('resize', checkViewport);
    window.addEventListener('orientationchange', checkViewport);
    return () => {
      window.removeEventListener('resize', checkViewport);
      window.removeEventListener('orientationchange', checkViewport);
    };
  }, []);

  useEffect(() => {
    const pauseFromHost = () => {
      joyPointerIdRef.current = null;
      bitePointerIdRef.current = null;
      joyOriginRef.current = null;
      setJoyOffset({ x: 0, y: 0 });
      setBitePressed(false);
      pushPlayerInput({ moveX: 0, moveZ: 0, biteHeld: false }, true);
      if (!isMultiplayer && !pausedRef.current) {
        setPaused(true);
      }
    };
    const resumeFromHost = () => {
      lastTickRef.current = performance.now();
    };

    const unsubApp = subscribeAppLifecycle(({ active }) => {
      if (!active) pauseFromHost();
      else resumeFromHost();
    });
    const unsubYt = platformCaps.youtubeSdkEnabled
      ? youtubePlayablesBridge.subscribeLifecycle(pauseFromHost, resumeFromHost)
      : () => {};

    return () => {
      unsubApp();
      unsubYt();
    };
  }, [isMultiplayer, platformCaps.youtubeSdkEnabled]);

  useEffect(() => {
    return registerAndroidBackHandler(() => {
      if (emoteWheelOpenRef.current) {
        setEmoteWheelOpen(false);
        setEmoteHoverIdx(null);
        return true;
      }
      setPaused((prev) => !prev);
      return true;
    }, 20);
  }, []);

  const spectatingActive = Boolean(hud?.spectating?.active);
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) {
      lastTickRef.current = performance.now();
    }
    if (paused || spectatingActive) {
      joyPointerIdRef.current = null;
      bitePointerIdRef.current = null;
      joyOriginRef.current = null;
      setJoyOffset({ x: 0, y: 0 });
      setBitePressed(false);
      pushPlayerInput({ moveX: 0, moveZ: 0, biteHeld: false }, true);
    }
  }, [paused, spectatingActive]);

  useEffect(() => {
    soundEngine.setMuted(settings.muted);
    soundEngine.setVolume(settings.volume);
    soundEngine.setMusicVolume(settings.musicVolume ?? 0.35);
    sceneRef.current?.setReducedMotion(settings.reducedMotion);
    sceneRef.current?.setGraphicsQuality(settings.graphicsQuality ?? 'auto');
    sceneRef.current?.setShowStatusIcons(
      (settings.hudVisibility ?? DEFAULT_HUD_VISIBILITY).statusEffects
    );
    if (settings.aiDifficulty && simRef.current) {
      simRef.current.setAiDifficulty(settings.aiDifficulty);
      setAiDifficulty(settings.aiDifficulty);
    }
  }, [settings]);

  // Update portrait medallion whenever active (player or spectated) milestone sprite tier changes
  const activePortraitLevel = hud?.spectating?.active
    ? hud.spectating.targetLevel
    : hud?.player.level ?? 1;
  const activePortraitTier = getMilestoneTier(activePortraitLevel);
  useEffect(() => {
    const paint = () => {
      if (portraitRef.current) {
        drawPortraitToCanvas(activePortraitTier, portraitRef.current);
      }
    };
    paint();
    return subscribeCodexSpritesLoaded(paint);
  }, [activePortraitTier]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const sim = isMultiplayer ? null : new GameSimulation(lobbySize, mode, playerNameRef.current);
    if (sim && settingsRef.current.aiDifficulty) {
      sim.setAiDifficulty(settingsRef.current.aiDifficulty);
      setAiDifficulty(settingsRef.current.aiDifficulty);
    }
    const remoteView = isMultiplayer
      ? new RemoteSimulationView(multiplayerPlayerId || 'player', multiplayerMatchId ?? null)
      : null;

    simRef.current = sim;
    remoteRef.current = remoteView;
    inputRef.current = { moveX: 0, moveZ: 0, aimAngle: 0, biteHeld: false };

    const arena = new ArenaScene3D(container, settingsRef.current.reducedMotion, () =>
      setContextLost(true)
    );
    arena.setGraphicsQuality(settingsRef.current.graphicsQuality ?? 'auto');
    arena.setShowStatusIcons(
      (settingsRef.current.hudVisibility ?? DEFAULT_HUD_VISIBILITY).statusEffects
    );
    sceneRef.current = arena;

    soundEngine.startAmbient();
    setEvolutionEvent(null);
    setEvolutionToast(null);
    setLatestSnapshotTick(null);
    const replayRecorder = replayRecorderRef.current;
    replayRecorder.reset();

    if (sim) {
      const initSnap = sim.getHudSnapshot();
      prevPlayerFormRef.current = initSnap.player.form;
      replayRecorder.record(initSnap, sim.getPlayer());
      setHud(initSnap);
    } else {
      prevPlayerFormRef.current = 1;
      setHud(null);
    }

    const keysDown = new Set<string>();
    let mouseClientX = window.innerWidth * 0.5;
    let mouseClientY = window.innerHeight * 0.4;
    let mouseActive = false;
    let biteHeld = false;
    let finishedSent = false;
    let victoryTimeoutId: number | null = null;
    let remoteStatus: HudSnapshot['matchResult']['status'] = 'playing';

    const getActiveRenderable = () => (isMultiplayer ? remoteView! : sim!);

    const handleAuthoritativeFinish = (snap: HudSnapshot) => {
      if (snap.matchResult.status === 'playing') return;
      if (snap.player.alive && !finishedSent) {
        finishedSent = true;
        soundEngine.stopAmbient();
        if (snap.matchResult.status === 'victory') {
          const delayMs = settingsRef.current.reducedMotion ? 2000 : 3000;
          victoryTimeoutId = window.setTimeout(() => {
            finishWithReplay(snap);
          }, delayMs);
        } else {
          finishWithReplay(snap);
        }
      } else if (!snap.player.alive) {
        soundEngine.stopAmbient();
      }
    };

    const unsubWorld = isMultiplayer
      ? multiplayerClient.onWorldState((packet) => {
          if (!remoteView) return;
          const accepted = remoteView.applyServerState(packet);
          if (!accepted) return;
          remoteStatus = packet.status;
          setLatestSnapshotTick(packet.tick);
          const snap = packet.hud;
          replayRecorder.record(snap, remoteView.getPlayer());
          setHud(snap);

          const authoritativeForm = snap.evolutionProgress?.currentForm ?? snap.player.form;
          const authoritativeLevel = snap.evolutionProgress?.currentLevel ?? Math.min(100, snap.player.level);
          const allowEvolutionTrigger =
            snap.player.alive &&
            authoritativeForm > prevPlayerFormRef.current &&
            (snap.matchResult.status === 'playing' || authoritativeForm === 4);
          if (allowEvolutionTrigger) {
            prevPlayerFormRef.current = authoritativeForm;
            evoSeqRef.current += 1;
            setEvolutionEvent({
              form: authoritativeForm,
              level: authoritativeLevel,
              key: evoSeqRef.current,
            });
            setEvolutionToast(
              authoritativeForm < 4
                ? {
                    form: authoritativeForm,
                    level: authoritativeLevel,
                    key: evoSeqRef.current,
                    durationSec: Math.max(5.0, snap.player.evoBoostTimeLeft || 5.0),
                  }
                : null
            );
          } else if (!snap.player.alive) {
            setEvolutionToast(null);
          }

          if (packet.status !== 'playing') {
            handleAuthoritativeFinish(snap);
          }
        }, multiplayerMatchId ?? null)
      : () => {};

    const unsubMatchEnded = isMultiplayer
      ? multiplayerClient.onMatchEnded((endHud, meta) => {
          if (multiplayerMatchId && meta?.matchId && meta.matchId !== multiplayerMatchId) {
            return;
          }
          remoteStatus = endHud.matchResult.status;
          setHud(endHud);
          handleAuthoritativeFinish(endHud);
        })
      : () => {};

    const syncMoveFromKeys = () => {
      let mx = 0;
      let mz = 0;
      if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) mx -= 1;
      if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) mx += 1;
      if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) mz -= 1;
      if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) mz += 1;
      // Normalize diagonal keyboard input cleanly so diagonal speed matches cardinal speed
      if (mx !== 0 && mz !== 0) {
        mx *= Math.SQRT1_2;
        mz *= Math.SQRT1_2;
      }
      pushPlayerInput({ moveX: mx, moveZ: mz, biteHeld }, true);
    };

    const onWindowBlur = () => {
      keysDown.clear();
      biteHeld = false;
      pushPlayerInput({ moveX: 0, moveZ: 0, biteHeld: false }, true);
    };

    const updateMouseAim = () => {
      if (!mouseActive) return;
      const worldPt = arena.screenToSim(mouseClientX, mouseClientY);
      if (worldPt) {
        const p = getActiveRenderable().getPlayer();
        const ang = Math.atan2(worldPt.z - p.z, worldPt.x - p.x);
        pushPlayerInput({ aimAngle: ang });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        if (emoteWheelOpenRef.current) {
          setEmoteWheelOpen(false);
          setEmoteHoverIdx(null);
          return;
        }
        setPaused((prev) => !prev);
        return;
      }
      if (isMultiplayer) {
        spatialVoice.unlockAudioContext();
        if (e.code === 'KeyM' && !e.repeat) {
          const cur = spatialVoice.getSnapshot();
          if (cur.micEnabled) {
            spatialVoice.setMicMuted(!cur.micMuted);
          } else {
            void spatialVoice.enableMic();
          }
          return;
        }
        if (e.code === 'KeyV') {
          spatialVoice.setPttActive(true);
        }
      }
      if (!isMultiplayer && e.ctrlKey && e.shiftKey && e.code === 'KeyD' && !e.repeat) {
        e.preventDefault();
        setShowAiDebug((prev) => {
          const next = !prev;
          if (next && sim) {
            setAiDebugEntries(sim.getAiDebugSnapshot());
            setAiDifficulty(sim.getAiDifficulty());
          }
          return next;
        });
        return;
      }
      if (pausedRef.current) return;

      // Spectator & Death Cam keyboard controls when player is eliminated
      if (!getActiveRenderable().getPlayer().alive) {
        if (emoteWheelOpenRef.current) {
          setEmoteWheelOpen(false);
          setEmoteHoverIdx(null);
        }
        if (getActiveRenderable().getDeathCam?.()?.active && (e.code === 'Space' || e.code === 'Enter')) {
          e.preventDefault();
          if (isMultiplayer) multiplayerClient.sendSpectateAction('skip_death_cam');
          else sim?.skipDeathCam();
          return;
        }
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
          e.preventDefault();
          if (isMultiplayer) multiplayerClient.sendSpectateAction('prev');
          else sim?.cycleSpectateTarget(-1);
          return;
        }
        if (e.code === 'ArrowRight' || e.code === 'KeyD') {
          e.preventDefault();
          if (isMultiplayer) multiplayerClient.sendSpectateAction('next');
          else sim?.cycleSpectateTarget(1);
          return;
        }
        if (e.code === 'KeyL' || e.code === 'Tab') {
          e.preventDefault();
          if (isMultiplayer) multiplayerClient.sendSpectateAction('leader');
          else sim?.spectateLeader();
          return;
        }
        if (!isMultiplayer) {
          if (e.code === 'Digit1') {
            setSpectateSpeed(1);
            return;
          }
          if (e.code === 'Digit2') {
            setSpectateSpeed(2);
            return;
          }
          if (e.code === 'Digit3' || e.code === 'Digit4') {
            setSpectateSpeed(4);
            return;
          }
        }
        return;
      }

      if (e.code === 'KeyG' && !e.repeat) {
        e.preventDefault();
        if (emoteWheelOpenRef.current) {
          emoteOpenedThisKeyRef.current = false;
          setEmoteWheelOpen(false);
          setEmoteHoverIdx(null);
        } else {
          emoteOpenedThisKeyRef.current = true;
          emoteHoldStartRef.current = performance.now();
          setEmoteHoverIdx(null);
          setEmoteWheelOpen(true);
        }
        return;
      }

      if (emoteWheelOpenRef.current && e.code.startsWith('Digit')) {
        const idx = Number(e.code.slice(5)) - 1;
        if (idx >= 0 && idx < EMOTE_SPECS.length) {
          e.preventDefault();
          dispatchEmote(EMOTE_SPECS[idx].id);
          return;
        }
      }

      soundEngine.startAmbient();
      keysDown.add(e.code);
      syncMoveFromKeys();

      const evadeCode = settingsRef.current.evadeKey || 'KeyC';
      if (e.code === 'Space') {
        e.preventDefault();
        biteHeld = true;
        pushPlayerInput({ biteHeld: true }, true);
        dispatchAbility('bite');
      } else if (e.code === evadeCode && !e.repeat) {
        e.preventDefault();
        dispatchAbility('evade');
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        dispatchAbility('dash');
      } else if (e.code === 'KeyE') {
        dispatchAbility('sonar');
      } else if (e.code === 'KeyQ') {
        dispatchAbility('veil');
      } else if (e.code === 'KeyR') {
        dispatchAbility('electroshock');
      } else if (e.code === 'KeyF') {
        dispatchAbility('maelstrom');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyG' && emoteWheelOpenRef.current && emoteOpenedThisKeyRef.current) {
        emoteOpenedThisKeyRef.current = false;
        const heldMs = performance.now() - emoteHoldStartRef.current;
        if (heldMs >= 180) {
          const idx = emoteHoverIdxRef.current;
          if (idx !== null && idx >= 0 && idx < EMOTE_SPECS.length) {
            dispatchEmote(EMOTE_SPECS[idx].id);
          } else {
            setEmoteWheelOpen(false);
            setEmoteHoverIdx(null);
          }
        }
        return;
      }
      if (isMultiplayer && e.code === 'KeyV') {
        spatialVoice.setPttActive(false);
      }
      keysDown.delete(e.code);
      if (e.code === 'Space') {
        biteHeld = false;
      }
      syncMoveFromKeys();
    };

    const isUiControlTarget = (target: EventTarget | null) =>
      Boolean((target as HTMLElement | null)?.closest('button, [data-mobile-control="true"], [data-emote-wheel="true"]'));

    const onPointerMove = (e: PointerEvent) => {
      if (emoteWheelOpenRef.current && e.pointerType !== 'touch') {
        const dx = e.clientX - window.innerWidth / 2;
        const dy = e.clientY - window.innerHeight / 2;
        setEmoteHoverIdx(pickEmoteIndexFromDelta(dx, dy, 28));
        return;
      }
      if (e.pointerType === 'touch' || joyPointerIdRef.current !== null || bitePointerIdRef.current !== null) return;
      if (isUiControlTarget(e.target)) return;
      mouseClientX = e.clientX;
      mouseClientY = e.clientY;
      mouseActive = true;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (isUiControlTarget(e.target)) return;
      if (pausedRef.current) return;
      if (emoteWheelOpenRef.current) {
        setEmoteWheelOpen(false);
        setEmoteHoverIdx(null);
        return;
      }
      soundEngine.startAmbient();
      if (isMultiplayer) spatialVoice.unlockAudioContext();
      mouseClientX = e.clientX;
      mouseClientY = e.clientY;
      mouseActive = true;
      updateMouseAim();
      if (e.button === 0) {
        biteHeld = true;
        pushPlayerInput({ biteHeld: true }, true);
        dispatchAbility('bite');
      } else if (e.button === 2) {
        e.preventDefault();
        dispatchAbility('evade');
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (bitePointerIdRef.current !== null) return;
      if (e.button === 0 && biteHeld) {
        biteHeld = false;
        pushPlayerInput({ biteHeld: false }, true);
      }
    };

    const onResize = () => arena.resize();
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => arena.resize())
        : null;
    resizeObserver?.observe(container);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('resize', onResize);

    lastTickRef.current = performance.now();
    let hudTimer = 0;

    arena.startLoop(() => {
      const now = performance.now();
      const rawDt = Math.max(0, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
      // Guard against huge delta-time jumps after backgrounding or host pause
      const dt = rawDt > 0.25 ? 1 / 60 : Math.min(0.05, rawDt);

      const activeView = getActiveRenderable();
      const playerAlive = activeView.getPlayer().alive;

      if (isMultiplayer && remoteView) {
        if (playerAlive && !pausedRef.current && remoteStatus === 'playing') {
          updateMouseAim();
        }
        remoteView.setSpeakingPeers(spatialVoice.getSpeakingPeerIds());
        remoteView.advance(dt);
        arena.render(remoteView);
      } else if (sim) {
        if (!pausedRef.current && sim.status === 'playing') {
          if (playerAlive) {
            updateMouseAim();
            sim.step(dt);
          } else {
            const dc = sim.getDeathCam();
            if (dc && dc.active) {
              // 3-second slow-motion Death Cam: 0.26x speed ramping cleanly back to 1.0x in the final 0.5s
              const baseSlow = settingsRef.current.reducedMotion ? 0.45 : 0.26;
              const rampOut =
                dc.remaining < 0.5
                  ? baseSlow + (1 - baseSlow) * (1 - dc.remaining / 0.5)
                  : baseSlow;
              sim.step(dt * rampOut, dt);
            } else {
              const steps = spectateSpeedRef.current;
              for (let s = 0; s < steps && sim.status === 'playing'; s++) {
                sim.step(dt);
              }
            }
          }
        }
        arena.render(sim);
      }

      const trackedEntity = playerAlive
        ? activeView.getPlayer()
        : activeView.getSpectateTarget() ?? activeView.getPlayer();
      const matchPlaying = isMultiplayer ? remoteStatus === 'playing' : sim?.status === 'playing';

      if (isMultiplayer && remoteView) {
        spatialVoice.updateSpatialPositions(
          trackedEntity.x,
          trackedEntity.z,
          remoteView.kelis,
          remoteStatus === 'playing'
        );
      }

      soundEngine.updateAmbientEnvironment({
        dt,
        speed: Math.hypot(trackedEntity.vx, trackedEntity.vz),
        terrain: getTerrainAt(trackedEntity.x, trackedEntity.z),
        zoneId: getZoneAt(trackedEntity.x, trackedEntity.z).id,
        hazard: trackedEntity.activeHazard,
        weather: activeView.weather?.kind,
        weatherIntensity: activeView.weather?.intensity ?? 0,
        form: getEvolutionForm(trackedEntity.level),
        level: trackedEntity.level,
        deathCamActive: Boolean(!playerAlive && activeView.getDeathCam?.()?.active),
        paused: pausedRef.current || !matchPlaying,
      });

      if (matchPlaying && !pausedRef.current && activeView.endgameState) {
        soundEngine.updateEndgameTension(
          activeView.endgameState.substate,
          activeView.endgameState.tensionIntensity,
          settingsRef.current.reducedMotion
        );
      }

      if (sim) {
        hudTimer += dt;
        const hudInterval = sim.getDeathCam()?.active ? 0.045 : 0.065;
        if (hudTimer >= hudInterval || sim.status !== 'playing') {
          hudTimer = 0;
          const snap = sim.getHudSnapshot();
          replayRecorder.record(snap, sim.getPlayer());
          setHud(snap);
          if (showAiDebugRef.current) {
            setAiDebugEntries(sim.getAiDebugSnapshot());
          }

          const authoritativeForm = snap.evolutionProgress?.currentForm ?? snap.player.form;
          const authoritativeLevel = snap.evolutionProgress?.currentLevel ?? Math.min(100, snap.player.level);
          const allowEvolutionTrigger =
            snap.player.alive &&
            authoritativeForm > prevPlayerFormRef.current &&
            (snap.matchResult.status === 'playing' || authoritativeForm === 4);
          if (allowEvolutionTrigger) {
            prevPlayerFormRef.current = authoritativeForm;
            evoSeqRef.current += 1;
            setEvolutionEvent({
              form: authoritativeForm,
              level: authoritativeLevel,
              key: evoSeqRef.current,
            });
            setEvolutionToast(
              authoritativeForm < 4
                ? {
                    form: authoritativeForm,
                    level: authoritativeLevel,
                    key: evoSeqRef.current,
                    durationSec: Math.max(5.0, snap.player.evoBoostTimeLeft || 5.0),
                  }
                : null
            );
          } else if (!snap.player.alive) {
            setEvolutionToast(null);
          }

          if (sim.status !== 'playing' && playerAlive && !finishedSent) {
            finishedSent = true;
            soundEngine.stopAmbient();
            if (sim.status === 'victory') {
              const delayMs = settingsRef.current.reducedMotion ? 1850 : 2350;
              victoryTimeoutId = window.setTimeout(() => {
                finishWithReplay(snap);
              }, delayMs);
            } else {
              finishWithReplay(snap);
            }
          } else if (sim.status !== 'playing' && !playerAlive) {
            soundEngine.stopAmbient();
          }
        }
      }
    });

    return () => {
      if (victoryTimeoutId !== null) {
        window.clearTimeout(victoryTimeoutId);
      }
      unsubMatchEnded();
      unsubWorld();
      soundEngine.stopAmbient();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();
      arena.dispose();
    };
  }, [lobbySize, mode, isMultiplayer, multiplayerPlayerId, multiplayerMatchId]);

  const handleAbilityClick = (id: AbilityId) => {
    if (paused) return;
    soundEngine.startAmbient();
    dispatchAbility(id);
  };

  const handleJoyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (paused || joyPointerIdRef.current !== null) return;
    e.stopPropagation();
    e.preventDefault();
    joyPointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer capture errors
    }
    joyOriginRef.current = { x: e.clientX, y: e.clientY };
    joySmoothRef.current = { x: 0, y: 0 };
    setJoyOffset({ x: 0, y: 0 });
    soundEngine.startAmbient();
  };

  const handleJoyPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== joyPointerIdRef.current || !joyOriginRef.current) return;
    e.stopPropagation();
    const dx = e.clientX - joyOriginRef.current.x;
    const dy = e.clientY - joyOriginRef.current.y;
    const maxR =
      viewportSize.width < 768 ||
      (viewportSize.height < 520 && (isTouchDevice || viewportSize.width < 960))
        ? 28
        : 42;
    const deadzone = maxR * 0.16;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, maxR);
    const ang = Math.atan2(dy, dx);
    const ox = Math.cos(ang) * clamped;
    const oy = Math.sin(ang) * clamped;
    setJoyOffset({ x: ox, y: oy });

    if (dist > deadzone) {
      // Smooth radial remapping from deadzone edge (0..1) + low-latency touch jitter filter
      const normMag = Math.min(1, (clamped - deadzone) / Math.max(1, maxR - deadzone));
      const targetX = Math.cos(ang) * normMag;
      const targetZ = Math.sin(ang) * normMag;
      const smoothAlpha = 0.68;
      const sx = joySmoothRef.current.x + (targetX - joySmoothRef.current.x) * smoothAlpha;
      const sz = joySmoothRef.current.y + (targetZ - joySmoothRef.current.y) * smoothAlpha;
      joySmoothRef.current = { x: sx, y: sz };
      const smoothAng = Math.hypot(sx, sz) > 0.05 ? Math.atan2(sz, sx) : ang;
      pushPlayerInput({
        moveX: sx,
        moveZ: sz,
        aimAngle: smoothAng,
      });
    } else {
      joySmoothRef.current = { x: 0, y: 0 };
      pushPlayerInput({ moveX: 0, moveZ: 0 });
    }
  };

  const handleJoyPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== joyPointerIdRef.current) return;
    e.stopPropagation();
    joyPointerIdRef.current = null;
    joyOriginRef.current = null;
    joySmoothRef.current = { x: 0, y: 0 };
    setJoyOffset({ x: 0, y: 0 });
    pushPlayerInput({ moveX: 0, moveZ: 0 }, true);
  };

  const handleMobileBiteDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (paused || bitePointerIdRef.current !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    bitePointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer capture errors
    }
    setBitePressed(true);
    soundEngine.startAmbient();
    pushPlayerInput({ biteHeld: true }, true);
    dispatchAbility('bite');
  };

  const handleMobileBiteUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== bitePointerIdRef.current) return;
    e.stopPropagation();
    bitePointerIdRef.current = null;
    setBitePressed(false);
    pushPlayerInput({ biteHeld: false }, true);
  };

  const isShortLandscape =
    viewportSize.height < 520 && (isTouchDevice || viewportSize.width < 960);
  const isCompactMode = isMobileViewport || isShortLandscape || settings.hudScale === 'compact';
  const canPlaceControlsBesideBar = viewportSize.width >= 540;

  const scaleClass =
    isMobileViewport || isShortLandscape
      ? 'scale-100'
      : settings.hudScale === 'compact'
        ? 'scale-90'
        : settings.hudScale === 'large'
          ? 'scale-105'
          : 'scale-100';

  const p = hud?.player;
  const spec = hud?.spectating;
  const isSpectating = Boolean(spec?.active);
  const rawDeathCam = hud?.deathCam;
  const deathCam =
    isSpectating && rawDeathCam && rawDeathCam.active && rawDeathCam.remaining > 0
      ? rawDeathCam
      : null;
  const isDeathCam = Boolean(deathCam);
  const displayLevel = isSpectating && spec ? spec.targetLevel : p?.level ?? 1;
  const displayHp = isSpectating && spec ? spec.targetHp : p?.hp ?? 0;
  const displayMaxHp = isSpectating && spec ? spec.targetMaxHp : p?.maxHp ?? 1;
  const displayForm = isSpectating && spec ? spec.targetForm : p?.form ?? 1;
  const displayStamina = isSpectating && spec ? spec.targetStamina : p?.stamina ?? 100;
  const displayMaxStamina = isSpectating && spec ? spec.targetMaxStamina : p?.maxStamina ?? 100;
  const displayFatigued = isSpectating && spec ? spec.targetFatigued : p?.fatigued ?? false;
  const displayHazard = isSpectating && spec ? spec.targetHazard : p?.activeHazard ?? null;
  const displayName = resolveHudDisplayName({
    isSpectating,
    spectateTargetName: spec?.targetName,
    authoritativePlayerName: p?.name,
    fallbackPlayerName: playerName,
  });
  const displayZone = isSpectating && spec ? spec.targetZoneName : p?.zoneName ?? 'Wang Kelian';
  const displayKills = isSpectating && spec ? spec.targetKills : p?.kills ?? 0;

  const nextMilestone = getNextMilestone(displayLevel);
  const evoProgress =
    !isSpectating && hud?.evolutionProgress
      ? hud.evolutionProgress
      : getEvolutionProgressInfo(displayLevel);
  const evoStagePct = Math.round(evoProgress.evolutionStageProgress * 100);
  const hpPct = Math.max(0, Math.min(100, (displayHp / Math.max(1, displayMaxHp)) * 100));
  const stamPct = Math.max(0, Math.min(100, (displayStamina / Math.max(1, displayMaxStamina)) * 100));
  const reservePct = p ? Math.max(0, Math.min(100, (p.shoreReserve / p.maxShoreReserve) * 100)) : 100;

  const sonarSpec = ACTIVE_ABILITIES.find((a) => a.id === 'sonar')!;
  const selfBounty = hud?.bountyTargets?.find((b) => b.isSelf) ?? null;
  const hudVis = settings.hudVisibility ?? DEFAULT_HUD_VISIBILITY;
  const showMobileControls = !isSpectating && (isTouchDevice || isMobileViewport);
  const hotbarAbilities = ACTIVE_ABILITIES.filter(
    (a) => a.id !== 'sonar' && !(showMobileControls && (a.id === 'bite' || a.id === 'evade'))
  );
  const evadeKeyLabel = formatKeyCodeLabel(settings.evadeKey);

  const activeFloatingStatuses = hudVis.statusEffects
    ? sceneRef.current?.getActiveFloatingStatusIds() ?? []
    : [];

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-[#162b35] select-none"
      data-floating-status-icons={activeFloatingStatuses.join(',')}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Isolated WebGL Mount */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />
      <div className="sr-only" role="status" aria-live="polite">
        {displayHazard ? `Environmental condition: ${displayHazard.label}. ${displayHazard.summary}` : ''}
      </div>

      {/* Dynamic Weather Visibility Vignette (non-blocking, no backdrop-filter) */}
      {hud?.weather && hud.weather.intensity > 0.02 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[2] transition-opacity duration-300"
          style={{
            background:
              hud.weather.kind === 'basin_fog'
                ? `radial-gradient(circle at 50% 48%, rgba(186,214,216,0) 32%, rgba(138,172,178,${(0.36 * hud.weather.intensity).toFixed(3)}) 72%, rgba(88,122,130,${(0.62 * hud.weather.intensity).toFixed(3)}) 100%)`
                : `radial-gradient(circle at 50% 48%, rgba(12,30,44,0) 44%, rgba(14,34,50,${(0.28 * hud.weather.intensity).toFixed(3)}) 100%)`,
          }}
        />
      )}

      {/* Death Cam Cinematic Letterbox & Subtle Red Edge Tint (no backdrop-filter over WebGL) */}
      {isDeathCam && hud?.matchResult.status === 'playing' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5]">
          <div className="absolute top-0 inset-x-0 h-6 sm:h-10 bg-[#050a0f]/92 border-b border-[#8a6a31]/65" />
          <div className="absolute bottom-0 inset-x-0 h-6 sm:h-10 bg-[#050a0f]/92 border-t border-[#8a6a31]/65" />
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 48%, rgba(127,29,29,0) 56%, rgba(127,29,29,0.28) 100%)',
            }}
          />
        </div>
      )}

      {/* Directional Damage-Hit & Perimeter Blood Flare Overlay */}
      <DamageHitOverlay
        hits={hud?.recentDamageHits}
        viewportWidth={viewportSize.width}
        viewportHeight={viewportSize.height}
        compactMode={isCompactMode}
        reducedMotion={settings.reducedMotion}
        onJoltChange={handleDamageJolt}
      />

      {/* Metamorphosis Particle Overlay (non-blocking above WebGL) */}
      <EvolutionOverlay
        event={evolutionEvent}
        reducedMotion={settings.reducedMotion}
        onComplete={() => setEvolutionEvent(null)}
      />

      {/* Restrained Keli King Victory Screen-Space Golden Glow (non-blocking, preserves sprite visibility) */}
      {hud?.matchResult.status === 'victory' && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 transition-opacity duration-500"
          style={{
            background:
              'radial-gradient(circle at 50% 48%, rgba(255, 224, 130, 0.0) 34%, rgba(212, 166, 78, 0.16) 76%, rgba(164, 114, 34, 0.30) 100%)',
          }}
        />
      )}

      {contextLost && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#091117]/95 p-6 text-center">
          <div className="compendium-plaque max-w-sm space-y-3 rounded-sm p-6">
            <h2 className="font-display text-xl text-[#f7f2e7]">WebGL Context Interrupted</h2>
            <p className="text-sm text-[#a9b9c2]">
              Your graphics driver reset the 3D arena surface. Reload the match to resume play.
            </p>
            <button
              type="button"
              onClick={onRestart}
              className="px-4 py-2 text-xs font-semibold rounded-[2px] border border-[#f3d285]/50 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f]"
            >
              Restart Match
            </button>
          </div>
        </div>
      )}

      {isMultiplayer && !hud && !contextLost && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-40 flex items-center justify-center bg-[#091117]/92 p-6 text-center"
        >
          <div className="compendium-plaque max-w-sm space-y-3 rounded-sm p-6">
            <h2 className="font-display text-xl text-[#f7f2e7]">
              {mpSnapshot?.status === 'unavailable' || mpSnapshot?.status === 'disconnected'
                ? 'Multiplayer Connection Lost'
                : 'Connecting to basin…'}
            </h2>
            <p className="text-sm text-[#a9b9c2]">
              {mpSnapshot?.error
                ? mpSnapshot.error
                : roomCode
                  ? `Synchronizing live match state for Basin ${roomCode}.`
                  : 'Waiting for authoritative match snapshot from the basin server.'}
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              {(mpSnapshot?.status === 'disconnected' || mpSnapshot?.status === 'unavailable') && (
                <button
                  type="button"
                  onClick={() => multiplayerClient.connect()}
                  className="px-4 py-2 text-xs font-semibold rounded-[2px] border border-[#f3d285]/50 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f]"
                >
                  Retry Connection
                </button>
              )}
              <button
                type="button"
                onClick={onExitToLobby}
                className="px-4 py-2 text-xs font-semibold rounded-[2px] border border-[#5b4724] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a]"
              >
                Return to Lobby
              </button>
            </div>
          </div>
        </div>
      )}

      {hud && p && (
        <div
          ref={hudJoltRef}
          data-hud-mode={isCompactMode ? 'compact' : 'full'}
          className="pointer-events-none absolute safe-area-hud z-10 will-change-transform"
        >
          {/* Top-Left: Compendium Circular Brass Medallion + Vitals Plaque (Full or Compact Mode) */}
          {isCompactMode ? (
            <div className="pointer-events-auto absolute top-2 left-2 flex items-start gap-1.5 origin-top-left">
              {/* Compact Circular Medallion */}
              <div className="relative shrink-0">
                <div
                  className={`compendium-medallion relative w-11 h-11 rounded-full overflow-hidden ${
                    isSpectating ? 'border-[#fbbf24]' : ''
                  }`}
                >
                  <canvas ref={portraitRef} width={74} height={74} className="w-full h-full block" />
                  <div className="absolute bottom-0 inset-x-0 bg-[#081016]/95 text-center text-[8.5px] font-mono-num font-bold text-[#f3d285] border-t border-[#8a6a31] leading-tight py-px">
                    {displayLevel}
                  </div>
                </div>
                <div
                  title={getFormLabel(displayForm)}
                  className="absolute -bottom-0.5 -left-0.5 w-4 h-4 rounded-full border border-[#d4a64e] bg-[#0a1821] flex items-center justify-center"
                >
                  <svg viewBox="0 0 16 16" className="w-2.5 h-2.5" aria-hidden="true">
                    <path
                      d="M8 1.5 C8 1.5 3.5 6.8 3.5 10 A4.5 4.5 0 0 0 12.5 10 C12.5 6.8 8 1.5 8 1.5 Z"
                      fill={displayForm >= 4 ? '#fbbf24' : displayForm === 3 ? '#38bdf8' : displayForm === 2 ? '#5eead4' : '#60a5fa'}
                      stroke="#e0f2fe"
                      strokeWidth="0.9"
                    />
                  </svg>
                </div>
              </div>

              {/* Condensed Icon-Driven Progress Bars Plaque */}
              <div className="compendium-plaque w-32 sm:w-36 rounded-sm overflow-hidden">
                <div className="compendium-ribbon flex items-center justify-between gap-1 px-1.5 py-0.5 text-[9.5px]">
                  <span className="font-mono-num font-semibold text-[#f7f0dc] truncate">
                    {isSpectating
                      ? `Spec · ${displayName.slice(0, 7)}`
                      : `Lv.${displayLevel} ${displayName.slice(0, 8)}`}
                  </span>
                  <span className="inline-flex items-center gap-0.5 font-mono-num text-[#f3d285] shrink-0">
                    <Swords className="w-2.5 h-2.5 text-[#c99c4a]" />
                    {displayKills}
                  </span>
                </div>

                <div className="px-1.5 py-1 space-y-1">
                  {/* Condensed Crimson HP Bar */}
                  <div className="flex items-center gap-1" title={`HP ${Math.max(0, Math.round(displayHp))} / ${displayMaxHp}`}>
                    <Heart className="w-2.5 h-2.5 text-[#fca5a5] shrink-0" />
                    <div className="compendium-track relative flex-1 h-2.5 rounded-[2px] overflow-hidden">
                      <div
                        className="h-full transition-all duration-100"
                        style={{
                          width: `${hpPct}%`,
                          background: 'linear-gradient(180deg, #ef4444 0%, #991b1b 100%)',
                        }}
                      />
                    </div>
                    <span className="w-7 text-right text-[8.5px] font-mono-num font-semibold text-[#f8fafc] shrink-0">
                      {Math.max(0, Math.round(displayHp))}
                    </span>
                  </div>

                  {/* Condensed Evolution Progress Bar (compact mobile) */}
                  {hudVis.evolutionProgress && (
                    <div
                      data-hud-element="evolutionProgress"
                      className="flex items-center gap-1"
                      title={
                        evoProgress.isMaxLevel
                          ? 'KELI KING · All 100 Fragments Reunited'
                          : `${evoProgress.currentFormShortName} · Lv.${evoProgress.currentLevel} (${evoProgress.fragmentsToNextEvolution} to Lv.${evoProgress.nextEvolutionLevel})`
                      }
                    >
                      <Sparkles
                        className={`w-2.5 h-2.5 shrink-0 ${
                          evoProgress.isMaxLevel ? 'text-[#fde68a]' : 'text-[#7dd3fc]'
                        }`}
                      />
                      <div className="compendium-track relative flex-1 h-2 rounded-[2px] overflow-hidden">
                        <div
                          className="h-full transition-all duration-150"
                          style={{
                            width: `${evoProgress.isMaxLevel ? 100 : evoStagePct}%`,
                            background: evoProgress.isMaxLevel
                              ? 'linear-gradient(180deg, #fde68a 0%, #d97706 100%)'
                              : displayForm === 3
                                ? 'linear-gradient(180deg, #38bdf8 0%, #059669 100%)'
                                : displayForm === 2
                                  ? 'linear-gradient(180deg, #f3d285 0%, #b45309 100%)'
                                  : 'linear-gradient(180deg, #38bdf8 0%, #075985 100%)',
                          }}
                        />
                      </div>
                      <span
                        className={`w-9 text-right text-[8px] font-mono-num font-semibold shrink-0 ${
                          evoProgress.isMaxLevel ? 'text-[#fde68a]' : 'text-[#bae6fd]'
                        }`}
                      >
                        {evoProgress.isMaxLevel
                          ? 'KING'
                          : `${evoProgress.currentLevel}/${evoProgress.nextEvolutionLevel}`}
                      </span>
                    </div>
                  )}

                  {/* Condensed Emerald / Amber Stamina Bar */}
                  <div className="flex items-center gap-1" title={`Stamina ${Math.round(displayStamina)} / ${displayMaxStamina}`}>
                    <Zap className={`w-2.5 h-2.5 shrink-0 ${displayFatigued ? 'text-[#fbbf24]' : 'text-[#6ee7b7]'}`} />
                    <div className="compendium-track relative flex-1 h-2 rounded-[2px] overflow-hidden">
                      <div
                        className="h-full transition-all duration-100"
                        style={{
                          width: `${stamPct}%`,
                          background: displayFatigued
                            ? 'linear-gradient(180deg, #f59e0b 0%, #b45309 100%)'
                            : 'linear-gradient(180deg, #34d399 0%, #065f46 100%)',
                        }}
                      />
                    </div>
                    <span className="w-7 text-right text-[8.5px] font-mono-num font-semibold text-[#d1fae5] shrink-0">
                      {Math.round(stamPct)}%
                    </span>
                  </div>

                  {/* Condensed Shore Reserve Bar (Lv.40-79) */}
                  {!isSpectating && p.level >= 40 && p.level < 80 && (
                    <div className="flex items-center gap-1" title={`Shore Reserve ${p.shoreReserve.toFixed(1)}s`}>
                      <Timer className={`w-2.5 h-2.5 shrink-0 ${p.isOnShore ? 'text-[#f87171]' : 'text-[#f3d285]'}`} />
                      <div className="compendium-track relative flex-1 h-1.5 rounded-[1px] overflow-hidden">
                        <div
                          className="h-full transition-all duration-100"
                          style={{
                            width: `${reservePct}%`,
                            background: p.isOnShore
                              ? 'linear-gradient(90deg, #ef4444, #f59e0b)'
                              : 'linear-gradient(90deg, #c99c4a, #f3d285)',
                          }}
                        />
                      </div>
                      <span className="w-7 text-right text-[8.5px] font-mono-num text-[#fde68a] shrink-0">
                        {p.shoreReserve.toFixed(0)}s
                      </span>
                    </div>
                  )}

                  {/* Compact Icon Buffs & Alerts Row */}
                  {!isSpectating &&
                    ((hudVis.statusEffects &&
                      (Boolean(selfBounty) ||
                        (p.bountyBoostTimeLeft ?? 0) > 0 ||
                        p.dewTimeLeft > 0 ||
                        p.stormFinTimeLeft > 0 ||
                        p.thunderRoeTimeLeft > 0 ||
                        p.surgeTimeLeft > 0 ||
                        p.predatorTimeLeft > 0 ||
                        p.aegisTimeLeft > 0 ||
                        p.venomActive ||
                        p.stunned ||
                        displayFatigued ||
                        Boolean(displayHazard))) ||
                      !p.inSafeZone) && (
                      <div
                        data-hud-element="statusEffects"
                        className="pt-0.5 border-t border-[#202d37] flex flex-wrap items-center gap-1 text-[8.5px] font-mono-num font-semibold"
                      >
                        {hudVis.statusEffects && (
                          <>
                            {selfBounty && (
                              <span
                                title={`You are marked on the minimap (+${selfBounty.rewardPoints} Bounty Pts & Surge)`}
                                className="inline-flex items-center gap-0.5 px-1 py-px rounded-[2px] bg-[#2a0f12] border border-[#fbbf24]/75 text-[#fde68a]"
                              >
                                ◎ +{selfBounty.rewardPoints}
                              </span>
                            )}
                            {(p.bountyBoostTimeLeft ?? 0) > 0 && (
                              <span
                                title="Bounty Surge (+20% Speed & +Stamina Regen)"
                                className="inline-flex items-center gap-0.5 px-1 py-px rounded-[2px] bg-[#2a1d08] border border-[#fbbf24]/80 text-[#fde68a]"
                              >
                                ★ {Math.ceil(p.bountyBoostTimeLeft ?? 0)}s
                              </span>
                            )}
                            {p.dewTimeLeft > 0 && (
                              <span title="Monsoon Dew" className="inline-flex items-center gap-0.5 px-1 py-px rounded-[2px] bg-[#0b2726] border border-[#2dd4bf]/70 text-[#5eead4]">
                                <Droplets className="w-2.5 h-2.5" />
                                {Math.ceil(p.dewTimeLeft)}s
                              </span>
                            )}
                            {p.stormFinTimeLeft > 0 && (
                              <span title="Stormfin Catalyst" className="inline-flex items-center gap-0.5 px-1 py-px rounded-[2px] bg-[#0d2138] border border-[#60a5fa]/70 text-[#93c5fd]">
                                <Wind className="w-2.5 h-2.5" />
                                {Math.ceil(p.stormFinTimeLeft)}s
                              </span>
                            )}
                            {p.thunderRoeTimeLeft > 0 && (
                              <span title="Thunder Roe" className="inline-flex items-center gap-0.5 px-1 py-px rounded-[2px] bg-[#241338] border border-[#c084fc]/70 text-[#d8b4fe]">
                                <Zap className="w-2.5 h-2.5" />
                                {Math.ceil(p.thunderRoeTimeLeft)}s
                              </span>
                            )}
                            {p.surgeTimeLeft > 0 && (
                              <span title="Amphetide Surge" className="inline-flex items-center gap-0.5 px-1 py-px rounded-[2px] bg-[#0a2130] border border-[#38bdf8]/65 text-[#7dd3fc]">
                                <Gauge className="w-2.5 h-2.5" />
                                {Math.ceil(p.surgeTimeLeft)}s
                              </span>
                            )}
                            {p.predatorTimeLeft > 0 && (
                              <span title="Fang Charge" className="inline-flex items-center gap-0.5 px-1 py-px rounded-[2px] bg-[#2a0f18] border border-[#fb7185]/65 text-[#fda4af]">
                                <Swords className="w-2.5 h-2.5" />
                                {Math.ceil(p.predatorTimeLeft)}s
                              </span>
                            )}
                            {p.aegisTimeLeft > 0 && (
                              <span title="Carapace Aegis" className="inline-flex items-center gap-0.5 px-1 py-px rounded-[2px] bg-[#2a1f0b] border border-[#fbbf24]/65 text-[#fde68a]">
                                <Shield className="w-2.5 h-2.5" />
                                {Math.ceil(p.aegisTimeLeft)}s
                              </span>
                            )}
                            {p.venomActive && (
                              <span title="Venom Active" className="inline-flex items-center text-[#4ade80]">
                                <Skull className="w-2.5 h-2.5" />
                              </span>
                            )}
                            {displayFatigued && (
                              <span title="Fatigued" className="inline-flex items-center text-[#f59e0b]">
                                <BatteryLow className="w-2.5 h-2.5" />
                              </span>
                            )}
                            {displayHazard && (
                              <span
                                title={displayHazard.label}
                                className="inline-flex items-center gap-0.5 px-1 py-px rounded-[2px] bg-[#081016] border"
                                style={{ borderColor: displayHazard.color, color: displayHazard.color }}
                              >
                                <AlertTriangle className="w-2.5 h-2.5" />
                                <span className="truncate max-w-[54px]">{displayHazard.label.split(' ')[0]}</span>
                              </span>
                            )}
                          </>
                        )}
                        {!p.inSafeZone && (
                          <span title="Radioactive Water" className="inline-flex items-center gap-0.5 px-1 py-px rounded-[2px] bg-[#5c1616] border border-[#f59e0b] text-[#fef3c7]">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            Zone
                          </span>
                        )}
                      </div>
                    )}
                </div>
              </div>
            </div>
          ) : (
            <div className={`pointer-events-auto absolute top-3 left-3 flex items-start gap-2.5 origin-top-left ${scaleClass}`}>
              {/* Double-Beveled Circular Brass Portrait + Droplet Form Crest */}
              <div className="relative shrink-0">
                <div
                  className={`compendium-medallion relative w-16 h-16 sm:w-[74px] sm:h-[74px] rounded-full overflow-hidden ${
                    isSpectating ? 'border-[#fbbf24]' : ''
                  }`}
                >
                  <canvas ref={portraitRef} width={74} height={74} className="w-full h-full block" />
                  <div className="absolute bottom-0 inset-x-0 bg-[#081016]/92 text-center text-[10px] font-mono-num font-bold text-[#f3d285] border-t border-[#8a6a31] py-0.5">
                    Lv.{displayLevel}
                  </div>
                </div>
                {/* Aquatic Form Crest Badge (Plate 2 water-droplet jewel) */}
                <div
                  title={getFormLabel(displayForm)}
                  className="absolute -bottom-0.5 -left-0.5 w-6 h-6 rounded-full border border-[#d4a64e] bg-[#0a1821] flex items-center justify-center shadow-lg"
                >
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" aria-hidden="true">
                    <path
                      d="M8 1.5 C8 1.5 3.5 6.8 3.5 10 A4.5 4.5 0 0 0 12.5 10 C12.5 6.8 8 1.5 8 1.5 Z"
                      fill={displayForm >= 4 ? '#fbbf24' : displayForm === 3 ? '#38bdf8' : displayForm === 2 ? '#5eead4' : '#60a5fa'}
                      stroke="#e0f2fe"
                      strokeWidth="0.9"
                    />
                  </svg>
                </div>
              </div>

              {/* Ornate Beveled Dark-Iron & Gold Status Plaque */}
              <div className="compendium-plaque w-60 sm:w-72 rounded-sm overflow-hidden">
                {/* Header Ribbon */}
                <div className="compendium-ribbon flex items-center justify-between gap-2 px-2.5 py-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[9px] text-[#c99c4a]" aria-hidden="true">◆</span>
                    <span className="font-display text-sm font-semibold text-[#f7f0dc] truncate drop-shadow-sm">
                      {isSpectating ? `Spectating · ${displayName}` : `Lv.${displayLevel} ${displayName}`}
                    </span>
                  </div>
                  <span className="text-[10px] font-medium text-[#d9b25f] truncate shrink-0">
                    {displayZone}
                  </span>
                </div>

                <div className="p-2.5 space-y-1.5">
                  {isSpectating && (
                    <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-[#fbbf24] pb-1 border-b border-[#3a2f1c]">
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        Spectator Feed
                      </span>
                      <span className="font-mono-num text-[#9cb0ba]">
                        Your Run: Lv.{hud.matchResult.finalLevel}
                      </span>
                    </div>
                  )}

                  {/* Metallic Beveled Crimson HP Gauge */}
                  <div className="flex items-center gap-1.5">
                    <span className="w-7 text-[9.5px] font-mono-num font-bold text-[#fca5a5] shrink-0">
                      HP
                    </span>
                    <div className="compendium-track relative flex-1 h-4 rounded-[2px] overflow-hidden">
                      <div
                        className="h-full transition-all duration-100"
                        style={{
                          width: `${hpPct}%`,
                          background: 'linear-gradient(180deg, #ef4444 0%, #b91c1c 65%, #7f1d1d 100%)',
                        }}
                      />
                      <div className="compendium-bar-gloss pointer-events-none absolute inset-0" />
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono-num font-semibold text-white drop-shadow">
                        {Math.max(0, Math.round(displayHp))} / {displayMaxHp}
                      </span>
                    </div>
                  </div>

                  {/* Compact Evolution Progress Gauge (form, level, next threshold & fragments needed) */}
                  {hudVis.evolutionProgress && (
                    <div data-hud-element="evolutionProgress" className="space-y-0.5">
                      <div className="flex items-center justify-between text-[9px] font-mono-num leading-none">
                        <span
                          className={`font-semibold truncate ${
                            evoProgress.isMaxLevel
                              ? 'text-[#fde68a]'
                              : displayForm === 3
                                ? 'text-[#7dd3fc]'
                                : displayForm === 2
                                  ? 'text-[#f3d285]'
                                  : 'text-[#93c5fd]'
                          }`}
                        >
                          {evoProgress.currentFormShortName} · Lv.{evoProgress.currentLevel}
                        </span>
                        <span className="text-[#cbd5e1] shrink-0">
                          {evoProgress.isMaxLevel
                            ? '100 / 100 REUNITED'
                            : `-${evoProgress.fragmentsToNextEvolution} to Lv.${evoProgress.nextEvolutionLevel}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-7 text-[9.5px] font-mono-num font-bold text-[#7dd3fc] shrink-0">
                          {evoProgress.isMaxLevel ? 'MAX' : 'EVO'}
                        </span>
                        <div className="compendium-track relative flex-1 h-3.5 rounded-[2px] overflow-hidden">
                          <div
                            className="h-full transition-all duration-150"
                            style={{
                              width: `${evoProgress.isMaxLevel ? 100 : evoStagePct}%`,
                              background: evoProgress.isMaxLevel
                                ? 'linear-gradient(180deg, #fde68a 0%, #f59e0b 60%, #92400e 100%)'
                                : displayForm === 3
                                  ? 'linear-gradient(180deg, #38bdf8 0%, #0ea5e9 55%, #065f46 100%)'
                                  : displayForm === 2
                                    ? 'linear-gradient(180deg, #f3d285 0%, #d97706 65%, #78350f 100%)'
                                    : 'linear-gradient(180deg, #38bdf8 0%, #0284c7 65%, #075985 100%)',
                            }}
                          />
                          <div className="compendium-bar-gloss pointer-events-none absolute inset-0" />
                          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono-num font-semibold text-[#f1f5f9] drop-shadow">
                            {evoProgress.isMaxLevel
                              ? 'KELI KING · VICTORY'
                              : `FRAGMENTS ${evoProgress.currentLevel} / ${evoProgress.nextEvolutionLevel} (${evoProgress.currentLevel}/100)`}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Emerald / Amber Stamina Gauge */}
                  <div className="flex items-center gap-1.5">
                    <span className="w-7 text-[9.5px] font-mono-num font-bold text-[#6ee7b7] shrink-0">
                      STM
                    </span>
                    <div className="compendium-track relative flex-1 h-3 rounded-[2px] overflow-hidden">
                      <div
                        className="h-full transition-all duration-100"
                        style={{
                          width: `${stamPct}%`,
                          background: displayFatigued
                            ? 'linear-gradient(180deg, #f59e0b 0%, #b45309 75%)'
                            : 'linear-gradient(180deg, #34d399 0%, #059669 70%, #065f46 100%)',
                        }}
                      />
                      <div className="compendium-bar-gloss pointer-events-none absolute inset-0" />
                      <span className="absolute inset-0 flex items-center justify-center text-[8.5px] font-mono-num font-semibold text-[#f8fafc] drop-shadow">
                        {displayFatigued
                          ? `FATIGUED · ${Math.round(displayStamina)}%`
                          : `${Math.round(displayStamina)} / ${displayMaxStamina}`}
                      </span>
                    </div>
                  </div>

                  {/* Shore Exposure Reserve (Plate 4 Mid-Game Vignette Alert Gauge for Lv.40-79) */}
                  {!isSpectating && p.level >= 40 && p.level < 80 && (
                    <div
                      className={`mt-1 px-2 py-1 rounded-[2px] border ${
                        p.isOnShore
                          ? 'bg-[#2a1114]/90 border-[#ef4444]/70'
                          : 'bg-[#0b141c]/90 border-[#4e3d21]'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[9.5px] font-mono-num">
                        <span className={p.isOnShore ? 'text-[#fca5a5] font-semibold' : 'text-[#9cb0ba]'}>
                          {p.isOnShore ? 'Land Time · HP -7%/s at 0' : 'Shore Reserve'}
                        </span>
                        <span className={p.isOnShore ? 'text-[#fef08a] font-bold' : 'text-[#f3e6c8]'}>
                          {p.shoreReserve.toFixed(1)}s
                        </span>
                      </div>
                      <div className="compendium-track h-1.5 mt-0.5 rounded-[1px] overflow-hidden">
                        <div
                          className="h-full transition-all duration-100"
                          style={{
                            width: `${reservePct}%`,
                            background: p.isOnShore
                              ? 'linear-gradient(90deg, #ef4444, #f59e0b)'
                              : 'linear-gradient(90deg, #c99c4a, #f3d285)',
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Unboxed Compendium Metadata Footer */}
                  <div className="pt-1 border-t border-[#2a3844] flex items-center justify-between gap-2 text-[10px] text-[#a9b9c2]">
                    <span className="truncate">
                      {evoProgress.isMaxLevel
                        ? 'Supreme Colossus of Wang Kelian'
                        : hudVis.evolutionProgress && nextMilestone
                          ? `Next: Lv.${nextMilestone.level} ${nextMilestone.title}`
                          : getFormLabel(displayForm)}
                    </span>
                    <span className="font-mono-num text-[#f3d285] shrink-0">
                      {displayKills} Kills
                    </span>
                  </div>

                  {/* Active Status & Power-Up Buff Strip (beveled micro-plates) */}
                  {hudVis.statusEffects &&
                    !isSpectating &&
                    (Boolean(selfBounty) ||
                      p.venomActive ||
                      p.frenzyActive ||
                      p.surgeTimeLeft > 0 ||
                      p.predatorTimeLeft > 0 ||
                      p.aegisTimeLeft > 0 ||
                      p.dewTimeLeft > 0 ||
                      p.stormFinTimeLeft > 0 ||
                      p.thunderRoeTimeLeft > 0 ||
                      (p.bountyBoostTimeLeft ?? 0) > 0 ||
                      p.veilActive ||
                      p.stunned ||
                      displayFatigued) && (
                      <div
                        data-hud-element="statusEffects"
                        className="pt-1 border-t border-[#202d37] flex flex-wrap items-center gap-1.5 text-[9.5px] font-mono-num font-semibold"
                      >
                        {selfBounty && (
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-[#2a0f12] border border-[#fbbf24]/75 text-[#fde68a] whitespace-nowrap">
                            ◎ Bounty +{selfBounty.rewardPoints} Pts
                          </span>
                        )}
                        {(p.bountyBoostTimeLeft ?? 0) > 0 && (
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-[#2a1d08] border border-[#fbbf24]/80 text-[#fde68a] whitespace-nowrap">
                            ★ Bounty Surge {(p.bountyBoostTimeLeft ?? 0).toFixed(1)}s
                          </span>
                        )}
                        {p.dewTimeLeft > 0 && (
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-[#0b2726] border border-[#2dd4bf]/70 text-[#5eead4] whitespace-nowrap">
                            ● Dew {p.dewTimeLeft.toFixed(1)}s
                          </span>
                        )}
                        {p.stormFinTimeLeft > 0 && (
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-[#0d2138] border border-[#60a5fa]/70 text-[#93c5fd] whitespace-nowrap">
                            ● Stormfin {p.stormFinTimeLeft.toFixed(1)}s
                          </span>
                        )}
                        {p.thunderRoeTimeLeft > 0 && (
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-[#241338] border border-[#c084fc]/70 text-[#d8b4fe] whitespace-nowrap">
                            ● Thunder {p.thunderRoeTimeLeft.toFixed(1)}s
                          </span>
                        )}
                        {p.surgeTimeLeft > 0 && (
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-[#0a2130] border border-[#38bdf8]/65 text-[#7dd3fc] whitespace-nowrap">
                            ◆ Surge {p.surgeTimeLeft.toFixed(1)}s
                          </span>
                        )}
                        {p.predatorTimeLeft > 0 && (
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-[#2a0f18] border border-[#fb7185]/65 text-[#fda4af] whitespace-nowrap">
                            ◆ Predator {p.predatorTimeLeft.toFixed(1)}s
                          </span>
                        )}
                        {p.aegisTimeLeft > 0 && (
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-[#2a1f0b] border border-[#fbbf24]/65 text-[#fde68a] whitespace-nowrap">
                            ◆ Aegis {p.aegisTimeLeft.toFixed(1)}s
                          </span>
                        )}
                        {p.venomActive && <span className="text-[#4ade80]">Venom</span>}
                        {p.frenzyActive && <span className="text-[#fbbf24]">Frenzy</span>}
                        {p.veilActive && <span className="text-[#94a3b8]">Silt Veil</span>}
                        {p.stunned && <span className="text-[#f87171]">Stunned</span>}
                        {displayFatigued && <span className="text-[#f59e0b]">Fatigued -16% Spd</span>}
                      </div>
                    )}

                  {hudVis.statusEffects && displayHazard && (
                    <div
                      data-hud-element="statusEffects"
                      className="mt-1 px-2 py-1 rounded-[2px] bg-[#081016]/95 border text-[10px]"
                      style={{ borderColor: displayHazard.color }}
                    >
                      <div className="font-semibold" style={{ color: displayHazard.color }}>
                        ◆ {displayHazard.label}
                      </div>
                      <div className="text-[#d6d3c9] text-[9.5px] leading-tight">
                        {displayHazard.summary}
                      </div>
                    </div>
                  )}

                  {!p.inSafeZone && (
                    <div className="mt-1 px-2 py-1 rounded-[2px] bg-[#5c1616]/95 border border-[#f59e0b] text-[10px] font-medium text-[#fef3c7]">
                      {isSpectating ? 'Target in radioactive water' : 'Radioactive water · Return toward Jantung Tasik'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Top-Center: Compendium Ornate Diamond Ribbon Banners */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 ${
              isCompactMode
                ? canPlaceControlsBesideBar
                  ? 'top-2 max-w-[230px]'
                  : 'top-28 max-w-[220px]'
                : 'top-3 max-w-md w-[90vw] sm:w-auto'
            }`}
          >
            {!isSpectating && hud.tutorial && hud.tutorial.step < 4 && (
              <div
                className={`compendium-plaque pointer-events-auto flex items-center gap-2 rounded-sm ${
                  isCompactMode ? 'px-2.5 py-1 text-[10.5px]' : 'px-3.5 py-2 text-xs gap-3'
                }`}
              >
                <div className="min-w-0 truncate">
                  {!isCompactMode && (
                    <span className="font-display font-semibold text-[#f3d285]">First Match · </span>
                  )}
                  <span className="text-[#e6e4dd]">
                    {hud.tutorial.step === 0 && (isCompactMode ? 'Move & Bite' : 'Swim with WASD & bite with Click / Space.')}
                    {hud.tutorial.step === 1 && (isCompactMode ? 'Eat carcass' : 'Consume the nearby 10-fragment carcass.')}
                    {hud.tutorial.step === 2 && (isCompactMode ? 'Defeat Jerung' : 'Defeat Jerung & claim the 15-fragment carcass.')}
                    {hud.tutorial.step === 3 && (isCompactMode ? 'Lv.40: Haul ashore' : 'Reach Lv.40 and haul onto Tebing Kering shore.')}
                  </span>
                </div>
                {p.level < 40 && (
                  <button
                    type="button"
                    onClick={() => simRef.current?.skipToLandLesson()}
                    className={`rounded-[2px] border border-[#f3d285]/40 bg-[#c99c4a] text-[#0b1218] font-semibold hover:bg-[#e5b66c] whitespace-nowrap shrink-0 ${
                      isCompactMode ? 'px-1.5 py-0.5 text-[9.5px]' : 'px-2.5 py-1 text-[11px]'
                    }`}
                  >
                    {isCompactMode ? 'Lv.40' : 'Skip to Lv.40 Lesson'}
                  </button>
                )}
              </div>
            )}

            {hud.endgame &&
              (hud.endgame.substate === 'final_convergence' ||
                hud.endgame.substate === 'final_hunt') &&
              !hud.finalFeast?.active &&
              hud.matchResult.status === 'playing' && (
                <div
                  data-hud-element="endgame-status"
                  className={`compendium-plaque rounded-sm text-center ${
                    hud.endgame.substate === 'final_hunt'
                      ? 'border-[#f59e0b]/80'
                      : 'border-[#c99c4a]/65'
                  } ${isCompactMode ? 'px-2.5 py-0.5' : 'px-4 py-1'}`}
                >
                  <div className="flex items-center justify-center gap-2 font-mono-num">
                    <span
                      className={`font-display font-semibold tracking-wider ${
                        hud.endgame.substate === 'final_hunt'
                          ? 'text-[#fde68a]'
                          : 'text-[#f3d285]'
                      } ${isCompactMode ? 'text-[10px]' : 'text-[11px]'}`}
                    >
                      ◆{' '}
                      {hud.endgame.substate === 'final_hunt'
                        ? 'FINAL HUNT'
                        : 'FINAL CONVERGENCE'}
                    </span>
                    <span className="text-[10px] font-semibold text-[#fca5a5]">
                      {hud.endgame.aliveCount} KELIS LEFT
                    </span>
                    {hud.endgame.finalZoneLocked && (
                      <span className="text-[9.5px] font-semibold text-[#f3d285]">
                        · FINAL ARENA LOCKED
                      </span>
                    )}
                    {hud.endgame.contestedCarcassActive && (
                      <span className="text-[9.5px] font-semibold text-[#fb923c]">
                        · CONTESTED FEAST
                      </span>
                    )}
                    {!hud.endgame.contestedCarcassActive &&
                      !hud.endgame.finalZoneLocked &&
                      hud.endgame.highValueCarcassCount > 0 &&
                      !isCompactMode && (
                        <span className="text-[9.5px] text-[#fde047]">
                          · {hud.endgame.highValueCarcassCount} Rich Carcass
                          {hud.endgame.highValueCarcassCount > 1 ? 'es' : ''}
                        </span>
                      )}
                  </div>
                </div>
              )}

            {hud.finalFeast?.active && p.alive && !isSpectating && (
              <div
                className={`compendium-plaque rounded-sm border-[#fbbf24]/70 text-center ${
                  isCompactMode ? 'px-2.5 py-1' : 'px-4 py-1.5'
                }`}
              >
                <div className="flex items-center justify-center gap-2 font-mono-num">
                  <span className={`font-display font-semibold text-[#fde68a] ${isCompactMode ? 'text-[10.5px]' : 'text-xs'}`}>
                    ◆ FINAL FEAST
                  </span>
                  <span className={`text-[#fbbf24] font-semibold ${isCompactMode ? 'text-[10px]' : 'text-[11px]'}`}>
                    {hud.finalFeast.remainingFragments} Frag Left ({hud.finalFeast.remainingCarcasses.length} Carcass{hud.finalFeast.remainingCarcasses.length > 1 ? 'es' : ''})
                  </span>
                  {hud.finalFeast.remainingCarcasses[0] && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[#f3e6c8]">
                      <ArrowUpRight
                        className="w-3.5 h-3.5 text-[#fde68a]"
                        style={{
                          transform: `rotate(${(hud.finalFeast.remainingCarcasses[0].angle * 180) / Math.PI + 45}deg)`,
                        }}
                      />
                      {hud.finalFeast.remainingCarcasses[0].distance}u
                    </span>
                  )}
                </div>
              </div>
            )}

            {hudVis.banners &&
              !evolutionEvent &&
              !hud.finalFeast?.active &&
              hud.activeWorldEvent &&
              hud.activeWorldEvent.phase !== 'dormant' &&
              hud.activeWorldEvent.phase !== 'complete' && (
                <div
                  data-hud-element="world-event"
                  className={`compendium-plaque rounded-sm text-center ${
                    isCompactMode ? 'px-2.5 py-0.5' : 'px-3.5 py-1'
                  } ${
                    hud.activeWorldEvent.kind === 'flash_flood'
                      ? 'border-[#38bdf8]/70'
                      : hud.activeWorldEvent.kind === 'silt_bloom'
                        ? 'border-[#d97706]/70'
                        : hud.activeWorldEvent.kind === 'whirlpool'
                          ? 'border-[#2dd4bf]/70'
                          : 'border-[#fb923c]/70'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2 font-mono-num">
                    <span
                      className={`font-display font-semibold tracking-wide ${
                        isCompactMode ? 'text-[10px]' : 'text-[11px]'
                      } ${
                        hud.activeWorldEvent.kind === 'flash_flood'
                          ? 'text-[#7dd3fc]'
                          : hud.activeWorldEvent.kind === 'silt_bloom'
                            ? 'text-[#fbbf24]'
                            : hud.activeWorldEvent.kind === 'whirlpool'
                              ? 'text-[#5eead4]'
                              : 'text-[#fdba74]'
                      }`}
                    >
                      {hud.activeWorldEvent.label}
                    </span>
                    <span className="text-[9.5px] uppercase tracking-wider text-[#e2e8f0]">
                      {hud.activeWorldEvent.phase === 'warning'
                        ? 'Incoming'
                        : hud.activeWorldEvent.phase === 'dissipating'
                          ? 'Subsiding'
                          : 'Active'}{' '}
                      {Math.max(1, Math.ceil(hud.activeWorldEvent.remainingSec))}s
                    </span>
                    {!isCompactMode && (
                      <span className="text-[10px] text-[#cbd5e1]">
                        · {hud.activeWorldEvent.subtitle}
                      </span>
                    )}
                    {hud.playerThreatenedByEvent && p.alive && !isSpectating && (
                      <span className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold text-[#fde047]">
                        <ArrowUpRight
                          className="w-3.5 h-3.5 text-[#fde047]"
                          style={{
                            transform: `rotate(${(hud.playerThreatenedByEvent.escapeAngle * 180) / Math.PI + 45}deg)`,
                          }}
                        />
                        {isCompactMode ? 'Clear' : 'Escape'}
                      </span>
                    )}
                    {p.netEntangled && p.alive && !isSpectating && (
                      <span className="text-[9.5px] font-semibold text-[#fb923c]">
                        · Snagged
                      </span>
                    )}
                  </div>
                </div>
              )}

            {hudVis.banners && !evolutionEvent && hud.recentBanner && (
              <div
                data-hud-element="banners"
                className={`compendium-plaque rounded-sm text-center ${
                  isCompactMode ? 'px-2.5 py-1' : 'px-5 py-2'
                }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  {!isCompactMode && <span className="h-px w-5 bg-gradient-to-r from-transparent to-[#c99c4a]" />}
                  <span className={`font-display font-semibold text-[#f3d285] ${isCompactMode ? 'text-[11px]' : 'text-sm'}`}>
                    ◆ {hud.recentBanner.title} {!isCompactMode ? '◆' : ''}
                  </span>
                  {!isCompactMode && <span className="h-px w-5 bg-gradient-to-l from-transparent to-[#c99c4a]" />}
                </div>
                {!isCompactMode && (
                  <div className="text-[11px] text-[#d6d3c9] mt-0.5">
                    {hud.recentBanner.subtitle}
                  </div>
                )}
              </div>
            )}

            {p.feedingTargetName && p.feedingDuration > 0 && (
              <div
                className={`compendium-plaque rounded-sm text-center ${
                  isCompactMode ? 'w-44 px-2 py-1' : 'w-68 px-3 py-2'
                } ${p.feedingContested ? 'border-[#fb923c]' : ''}`}
              >
                <div className="flex items-center justify-between gap-1.5 mb-0.5">
                  <span
                    className={`${
                      isCompactMode ? 'text-[9.5px]' : 'text-[11px]'
                    } font-medium ${
                      p.feedingContested ? 'text-[#fdba74]' : 'text-[#f3d285]'
                    } truncate`}
                  >
                    {p.feedingWindupDone
                      ? isCompactMode
                        ? p.feedingTargetName
                        : `Consuming ${p.feedingTargetName}`
                      : `Locking ${p.feedingTargetName}`}
                  </span>
                  {p.feedingContested ? (
                    <span className="text-[9px] font-mono-num font-bold uppercase tracking-wider text-[#fb923c] shrink-0">
                      CONTESTED
                    </span>
                  ) : (p.feedingSessionFragments ?? 0) > 0 ? (
                    <span className="text-[9.5px] font-mono-num font-semibold text-[#4ade80] shrink-0">
                      +{p.feedingSessionFragments}
                    </span>
                  ) : null}
                </div>
                <div className={`compendium-track ${isCompactMode ? 'h-1.5' : 'h-2'} rounded-[2px] overflow-hidden`}>
                  <div
                    className="h-full transition-[width] duration-75"
                    style={{
                      width: `${Math.min(100, (p.feedingProgress / p.feedingDuration) * 100)}%`,
                      background: p.feedingContested
                        ? 'linear-gradient(90deg, #ea580c, #fbbf24)'
                        : p.feedingWindupDone
                        ? 'linear-gradient(90deg, #059669, #4ade80)'
                        : 'linear-gradient(90deg, #b45309, #f59e0b)',
                    }}
                  />
                </div>
                {!isCompactMode && (
                  <div className="text-[9.5px] text-[#94a3b8] mt-0.5">
                    Move away or Evade to cancel
                  </div>
                )}
              </div>
            )}

            {/* Player Combat Control State Indicator (Stunned / Staggered / Stun Immune) */}
            {!isSpectating && p.alive && (p.stunned || p.staggered || (p.stunResistTimeLeft ?? 0) > 0.05) && (
              <div
                className={`compendium-plaque-subtle flex items-center gap-1.5 rounded-[2px] font-mono-num font-semibold ${
                  isCompactMode ? 'px-2 py-0.5 text-[9.5px]' : 'px-3 py-1 text-[11px]'
                } ${
                  p.stunned
                    ? 'border-[#fbbf24] text-[#fde68a] bg-[#2a1a06]/90'
                    : p.staggered
                      ? 'border-[#fb923c] text-[#fed7aa] bg-[#2d1208]/90'
                      : 'border-[#38bdf8] text-[#bae6fd] bg-[#082032]/90'
                }`}
              >
                {p.stunned ? (
                  <>
                    <Zap className="w-3 h-3 text-[#fbbf24] shrink-0" />
                    <span>STUNNED</span>
                  </>
                ) : p.staggered ? (
                  <>
                    <AlertTriangle className="w-3 h-3 text-[#fb923c] shrink-0" />
                    <span>STAGGERED</span>
                  </>
                ) : (
                  <>
                    <Shield className="w-3 h-3 text-[#38bdf8] shrink-0" />
                    <span>STUN IMMUNE {(p.stunResistTimeLeft ?? 0).toFixed(1)}s</span>
                  </>
                )}
              </div>
            )}

            {/* Incoming Emote Signal / Taunt Feed */}
            {hudVis.banners && hud.recentEmotes && hud.recentEmotes.length > 0 && (
              <div data-hud-element="banners" className="flex flex-col items-center gap-1">
                {hud.recentEmotes.slice(0, isCompactMode ? 1 : 2).map((em) => {
                  const spec = getEmoteSpec(em.emoteId);
                  if (!spec) return null;
                  const dist = Math.hypot(em.x - p.x, em.z - p.z);
                  const dirAngle = dist > 220 ? Math.atan2(em.z - p.z, em.x - p.x) : null;
                  return (
                    <div
                      key={em.id}
                      style={{ borderColor: spec.color }}
                      className={`compendium-plaque-subtle flex items-center gap-1.5 rounded-[2px] ${
                        isCompactMode ? 'px-2 py-0.5 text-[9.5px]' : 'px-3 py-1 text-[11px]'
                      } text-[#f7f2e7] whitespace-nowrap`}
                    >
                      <span className="font-semibold" style={{ color: spec.color }}>
                        {em.senderName}
                      </span>
                      <span className="text-[#cbd5e1]">· {spec.label}</span>
                      {dirAngle !== null && (
                        <ArrowUpRight
                          className="w-3 h-3 shrink-0"
                          style={{
                            color: spec.color,
                            transform: `rotate(${(dirAngle * 180) / Math.PI + 45}deg)`,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top-Right: Brass Utility Row + Compact Telemetry / Wang Kelian Minimap + Proximity Voice */}
          <div
            className={`pointer-events-auto absolute flex flex-col items-end origin-top-right ${
              isCompactMode ? 'top-2 right-2 gap-1' : `top-3 right-3 gap-2 ${scaleClass}`
            }`}
          >
            <div className="flex items-center gap-1">
              {!isSpectating && p.alive && (
                <button
                  type="button"
                  onClick={() => {
                    setEmoteHoverIdx(null);
                    setEmoteWheelOpen((prev) => !prev);
                  }}
                  title="Quick-Access Emote Wheel [G] (Hold & Flick or Tap)"
                  aria-label="Open emote wheel"
                  aria-expanded={emoteWheelOpen}
                  className={`compendium-plaque-subtle flex items-center gap-1 ${
                    isCompactMode ? 'p-1.5' : 'px-2.5 py-2'
                  } rounded-[2px] text-[10.5px] font-mono-num transition-colors ${
                    emoteWheelOpen
                      ? 'border-[#f3d285] bg-[#1d2d39] text-[#f3d285]'
                      : emoteCooldownLeft > 0.05
                        ? 'opacity-75 text-[#9cb0ba]'
                        : 'text-[#f3e6c8] hover:border-[#c99c4a]'
                  }`}
                >
                  <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  {!isCompactMode && (
                    <span className="hidden sm:inline whitespace-nowrap">
                      {emoteCooldownLeft > 0.05 ? `${emoteCooldownLeft.toFixed(1)}s` : 'Emote [G]'}
                    </span>
                  )}
                </button>
              )}
              {isMultiplayer && platformCaps.spatialVoiceEnabled && (
                <>
                  {voiceSnap.micEnabled && voiceSnap.voiceMode === 'ptt' && (
                    <button
                      type="button"
                      onPointerDown={() => spatialVoice.setPttActive(true)}
                      onPointerUp={() => spatialVoice.setPttActive(false)}
                      onPointerLeave={() => spatialVoice.setPttActive(false)}
                      onPointerCancel={() => spatialVoice.setPttActive(false)}
                      title="Hold [V] to Push-to-Talk"
                      className={`compendium-plaque-subtle ${
                        isCompactMode ? 'px-2 py-1 text-[9.5px]' : 'px-2.5 py-1.5 text-[10.5px]'
                      } rounded-[2px] font-mono-num font-semibold transition-colors touch-none ${
                        voiceSnap.pttActive
                          ? 'border-[#4ade80] bg-[#133827] text-[#bbf7d0]'
                          : 'text-[#f3d285] hover:border-[#c99c4a]'
                      }`}
                    >
                      {voiceSnap.pttActive ? 'TX' : isCompactMode ? 'PTT' : 'HOLD [V]'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      spatialVoice.unlockAudioContext();
                      if (voiceSnap.micEnabled) {
                        spatialVoice.setMicMuted(!voiceSnap.micMuted);
                      } else {
                        void spatialVoice.enableMic();
                      }
                    }}
                    title={
                      !voiceSnap.micEnabled
                        ? 'Enable Microphone for Proximity Chat [M]'
                        : voiceSnap.micMuted
                          ? 'Unmute Microphone [M]'
                          : 'Mute Microphone [M]'
                    }
                    className={`compendium-plaque-subtle flex items-center gap-1.5 ${
                      isCompactMode ? 'p-1.5' : 'px-2.5 py-2'
                    } rounded-[2px] text-[10.5px] font-mono-num transition-colors ${
                      !voiceSnap.micEnabled
                        ? 'text-[#f3d285] hover:border-[#c99c4a]'
                        : voiceSnap.micMuted
                          ? 'border-[#ef4444]/60 text-[#fca5a5]'
                          : voiceSnap.localSpeaking
                            ? 'border-[#4ade80] text-[#4ade80]'
                            : 'border-[#38bdf8]/60 text-[#7dd3fc]'
                    }`}
                  >
                    {!voiceSnap.micEnabled || voiceSnap.micMuted ? (
                      <MicOff className="w-3.5 h-3.5" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                    {!isCompactMode && (
                      <span className="hidden sm:inline">
                        {!voiceSnap.micEnabled
                          ? 'Mic'
                          : voiceSnap.micMuted
                            ? 'Muted'
                            : voiceSnap.voiceMode === 'ptt'
                              ? 'PTT'
                              : 'Live'}
                      </span>
                    )}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onUpdateSettings({ muted: !settings.muted })}
                aria-label={settings.muted ? 'Unmute audio' : 'Mute audio'}
                className={`compendium-plaque-subtle ${isCompactMode ? 'p-1.5' : 'p-2'} rounded-[2px] text-[#f3e6c8] hover:border-[#c99c4a] transition-colors`}
              >
                {settings.muted ? <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              </button>
              <button
                type="button"
                onClick={() => setPaused((prev) => !prev)}
                aria-label="Pause match"
                className={`compendium-plaque-subtle ${isCompactMode ? 'p-1.5' : 'p-2'} rounded-[2px] text-[#f3e6c8] hover:border-[#c99c4a] transition-colors`}
              >
                {paused ? <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              </button>
            </div>

            {isCompactMode && hudVis.matchTelemetry && (
              <div
                data-hud-element="matchTelemetry"
                style={{ width: 102 }}
                className={`compendium-plaque-subtle flex items-center justify-between gap-1 px-1.5 py-0.5 rounded-[2px] text-[9px] font-mono-num text-[#d6d3c9] whitespace-nowrap ${
                  hud.zone.warningActive ? 'border-[#fbbf24]/80' : ''
                }`}
              >
                <span className="inline-flex items-center gap-0.5 text-white font-semibold" title="Remaining Kelis">
                  <Users className="w-2.5 h-2.5 text-[#c99c4a]" />
                  {hud.aliveCount}
                </span>
                <span
                  className={
                    hud.zone.isShrinking
                      ? 'text-[#fca5a5] font-semibold'
                      : hud.zone.warningActive
                        ? 'text-[#fbbf24] font-semibold'
                        : 'text-[#f3d285]'
                  }
                  title={
                    hud.zone.warningActive
                      ? `Zone closing in ${Math.ceil(hud.zone.warningTimer)}s`
                      : `Match Phase: ${hud.matchPhase ?? 'early'}`
                  }
                >
                  {hud.zone.warningActive
                    ? `!${Math.ceil(hud.zone.warningTimer)}s`
                    : formatClock(hud.matchTime)}
                </span>
                {hud.weather.kind === 'light_rain' ? (
                  <CloudRain className="w-2.5 h-2.5 text-[#7dd3fc] shrink-0" aria-label={hud.weather.label} />
                ) : hud.weather.kind === 'basin_fog' ? (
                  <CloudFog className="w-2.5 h-2.5 text-[#cbd5e1] shrink-0" aria-label={hud.weather.label} />
                ) : (
                  <Sun className="w-2.5 h-2.5 text-[#f3d285] shrink-0" aria-label={hud.weather.label} />
                )}
              </div>
            )}

            {hudVis.minimap && (
              <div data-hud-element="minimap">
                <Minimap
                  hud={hud}
                  showVoiceHorizon={isMultiplayer && (voiceSnap.micEnabled || voiceSnap.peers.length > 0)}
                  voicePeers={voiceSnap.peers}
                  compact={isCompactMode}
                />
              </div>
            )}

            {/* Spatial Proximity Voice Roster (Multiplayer) */}
            {isMultiplayer && platformCaps.spatialVoiceEnabled && (voiceSnap.error || voiceSnap.peers.length > 0) && (
              <div className={`${isCompactMode ? 'w-32' : 'w-48'} space-y-1`}>
                {voiceSnap.error && (
                  <div className="compendium-plaque-subtle rounded-[2px] border-[#ef4444]/60 px-2 py-1 text-[9.5px] text-[#fecaca] flex items-center justify-between gap-1.5">
                    <span className="truncate">{voiceSnap.error}</span>
                    <button
                      type="button"
                      onClick={() => spatialVoice.clearError()}
                      className="text-[#fca5a5] hover:text-white font-semibold shrink-0"
                    >
                      ×
                    </button>
                  </div>
                )}
                {voiceSnap.peers.slice(0, isCompactMode ? 2 : 4).map((peer) => {
                  const pct = Math.round(peer.proximityRatio * 100);
                  return (
                    <div
                      key={peer.id}
                      className={`compendium-plaque-subtle rounded-[2px] ${
                        isCompactMode ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]'
                      } flex items-center justify-between gap-1 ${
                        peer.speaking && peer.inRange
                          ? 'border-[#4ade80]/80'
                          : !peer.inRange
                            ? 'opacity-55'
                            : ''
                      }`}
                    >
                      <div className="min-w-0 flex items-center gap-1">
                        <Radio
                          className={`w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0 ${
                            peer.localMuted || peer.mutedByPeer
                              ? 'text-[#f87171]'
                              : peer.speaking && peer.inRange
                                ? 'text-[#4ade80]'
                                : 'text-[#7dd3fc]'
                          }`}
                        />
                        <span className="truncate text-[#f7f2e7] font-medium">{peer.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 font-mono-num">
                        {peer.alive && peer.inRange && (
                          <ArrowUpRight
                            className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#f3d285]"
                            style={{
                              transform: `rotate(${(peer.bearingRad * 180) / Math.PI + 45}deg)`,
                            }}
                          />
                        )}
                        <span className={peer.inRange ? 'text-[#9cb0ba]' : 'text-[#64748b]'}>
                          {!peer.alive ? 'KO' : peer.inRange ? (isCompactMode ? `${pct}%` : `${peer.distance}u · ${pct}%`) : 'Far'}
                        </span>
                        <button
                          type="button"
                          onClick={() => spatialVoice.togglePeerLocalMute(peer.id)}
                          title={peer.localMuted ? `Unmute ${peer.name}` : `Mute ${peer.name}`}
                          className="text-[#9cb0ba] hover:text-white"
                        >
                          {peer.localMuted ? (
                            <VolumeX className="w-3 h-3 text-[#f87171]" />
                          ) : (
                            <Volume2 className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Visual Sound Cues (Accessibility) */}
            {settings.visualSoundCues && hud.soundCues.length > 0 && (
              <div className={`${isCompactMode ? 'w-32' : 'w-48'} space-y-1`}>
                {hud.soundCues.slice(0, isCompactMode ? 2 : 3).map((cue) => (
                  <div
                    key={cue.id}
                    className={`compendium-plaque-subtle rounded-[2px] ${
                      isCompactMode ? 'px-1.5 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]'
                    } text-[#e6dfd0] flex items-center justify-between gap-1.5`}
                  >
                    <span className="truncate">{cue.label}</span>
                    {cue.directionAngle !== null && (
                      <ArrowUpRight
                        className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#f3d285] shrink-0"
                        style={{
                          transform: `rotate(${(cue.directionAngle * 180) / Math.PI + 45}deg)`,
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bottom-Right: Battle for Wang Kelian Ornate Plaque (Full Mode Only) */}
          {!isCompactMode && hudVis.matchTelemetry && (
            <div
              data-hud-element="matchTelemetry"
              className={`compendium-plaque pointer-events-auto hidden md:block absolute bottom-3 right-3 w-60 rounded-sm overflow-hidden origin-bottom-right ${scaleClass}`}
            >
              <div className="compendium-ribbon flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-[11px] font-display font-semibold text-[#f3d285]">
                <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                  <Swords className="w-3.5 h-3.5 text-[#c99c4a] shrink-0" />
                  <span className="truncate">Wang Kelian</span>
                </span>
                {hud.matchPhase && (
                  <span
                    className={`shrink-0 font-mono-num text-[9.5px] uppercase tracking-wider px-1 py-0.2 rounded-[2px] border ${
                      hud.matchPhase === 'endgame'
                        ? 'text-[#fca5a5] border-[#ef4444]/60 bg-[#2b0f12]/80'
                        : hud.matchPhase === 'mid'
                          ? 'text-[#fde68a] border-[#c99c4a]/60 bg-[#231a09]/80'
                          : 'text-[#99f6e4] border-[#2dd4bf]/40 bg-[#0b1f22]/80'
                    }`}
                  >
                    {hud.matchPhase === 'endgame'
                      ? 'Endgame'
                      : hud.matchPhase === 'mid'
                        ? 'Mid-Game'
                        : 'Early'}
                  </span>
                )}
              </div>
              <div className="p-2.5 space-y-1.5 font-mono-num">
                <div className="flex items-center justify-between text-xs text-[#d6d3c9]">
                  <span className="text-[11px] font-sans text-[#b8c4bf]">Remaining Kelis</span>
                  <span className="text-sm font-bold text-white">
                    {hud.aliveCount} <span className="text-[#8ea3ae] font-normal">/ {hud.totalEntrants}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-[#d6d3c9]">
                  <span className="text-[11px] font-sans text-[#b8c4bf]">
                    {isMultiplayer && roomCode ? `Basin ${roomCode}` : 'Match Time'}
                  </span>
                  <span className="text-[#f3d285] font-semibold">
                    {formatClock(hud.matchTime)}
                    {isMultiplayer && latencyMs !== null ? ` · ${latencyMs}ms` : ''}
                  </span>
                </div>
                <div className="pt-1 border-t border-[#22313d] flex items-center justify-between text-[10.5px] text-[#9cb0ba]">
                  <span>
                    {typeof hud.fragmentsToKing === 'number' && hud.fragmentsToKing > 0
                      ? `${hud.fragmentsToKing} to King${
                          hud.nextMilestoneLevel && hud.nextMilestoneLevel < 100
                            ? ` · Lv.${hud.nextMilestoneLevel}`
                            : ''
                        }`
                      : `Mass ${hud.livingMassSum}+${hud.carcassMassSum}=${hud.livingMassSum + hud.carcassMassSum}`}
                  </span>
                  <span
                    className={
                      hud.zone.finalZoneLocked
                        ? 'text-[#f3d285] font-semibold'
                        : hud.zone.isShrinking
                          ? 'text-[#fca5a5] font-semibold'
                          : hud.zone.warningActive
                            ? 'text-[#fbbf24] font-semibold animate-pulse'
                            : 'text-[#6ee7b7]'
                    }
                  >
                    {hud.zone.finalZoneLocked
                      ? '60/40 Locked'
                      : `P${hud.zone.phase} · ${
                          hud.zone.isShrinking
                            ? 'Closing'
                            : hud.zone.warningActive
                              ? `Soon ${Math.ceil(hud.zone.warningTimer)}s`
                              : `${Math.ceil(hud.zone.warningTimer)}s`
                        }`}
                  </span>
                </div>
                <div className="pt-1 border-t border-[#22313d] flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="inline-flex items-center gap-1 min-w-0 font-sans text-[#cbd5e1] truncate">
                    {hud.weather.kind === 'light_rain' ? (
                      <CloudRain className="w-3.5 h-3.5 text-[#7dd3fc] shrink-0" />
                    ) : hud.weather.kind === 'basin_fog' ? (
                      <CloudFog className="w-3.5 h-3.5 text-[#cbd5e1] shrink-0" />
                    ) : (
                      <Sun className="w-3.5 h-3.5 text-[#f3d285] shrink-0" />
                    )}
                    <span className="truncate">{hud.weather.label}</span>
                  </span>
                  <span
                    className={`shrink-0 whitespace-nowrap ${
                      hud.weather.kind === 'basin_fog'
                        ? 'text-[#cbd5e1]'
                        : hud.weather.kind === 'light_rain'
                          ? 'text-[#7dd3fc]'
                          : 'text-[#8ea3ae]'
                    }`}
                  >
                    {Math.round(hud.weather.visibilityRange * 100)}% Vis
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Off-Screen Sonar Indicators */}
          {hud.offscreenIndicators.map((ind) => {
            const radiusPx = Math.min(window.innerWidth, window.innerHeight) * 0.36;
            const x = window.innerWidth * 0.5 + Math.cos(ind.screenAngle) * radiusPx;
            const y = window.innerHeight * 0.5 + Math.sin(ind.screenAngle) * radiusPx;
            const col =
              ind.kind === 'danger'
                ? '#f87171'
                : ind.kind === 'prey'
                ? '#34d399'
                : ind.kind === 'hotspot'
                ? '#fb923c'
                : '#f3d285';
            const shape =
              ind.kind === 'danger'
                ? '▲'
                : ind.kind === 'prey'
                ? '●'
                : ind.kind === 'hotspot'
                ? '◎'
                : '◆';
            return (
              <div
                key={ind.id}
                className="compendium-plaque-subtle absolute -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-semibold"
                style={{ left: x, top: y, borderColor: col, color: col }}
              >
                {ind.kind === 'carcass'
                  ? `${shape} +${ind.level} Frag`
                  : ind.kind === 'hotspot'
                  ? `${shape} Activity ${ind.distance}u`
                  : `${shape} Lv.${ind.level}`}
              </div>
            );
          })}

          {/* Bottom-Center: Compendium RPG Action Bar + Circular Concentric Sonar Dish */}
          {!isSpectating ? (
            hudVis.abilityBar ? (
            <div
              data-hud-element="abilityBar"
              className={`pointer-events-auto absolute left-1/2 -translate-x-1/2 flex items-end origin-bottom ${
                isCompactMode ? 'bottom-2 gap-1.5' : `bottom-3 gap-2.5 ${scaleClass}`
              }`}
            >
              <div
                className={`compendium-plaque relative flex items-center rounded-sm ${
                  isCompactMode ? 'gap-1 p-1' : 'gap-1 sm:gap-1.5 p-1.5 sm:p-2'
                }`}
              >
                {hotbarAbilities.map((ab) => {
                  const unlocked = p.level >= ab.unlockLevel;
                  const cd =
                    ab.id === 'bite'
                      ? p.biteCooldown ?? 0
                      : p.cooldowns[ab.id as keyof typeof p.cooldowns] ?? 0;
                  const onCd = ab.id === 'bite' ? false : cd > 0.05;
                  const staminaCost = ab.staminaCost ?? 0;
                  const lowStamina =
                    unlocked &&
                    !onCd &&
                    ab.id !== 'bite' &&
                    staminaCost > 0 &&
                    p.stamina < staminaCost;
                  const stunLocked = unlocked && p.stunned;
                  const keyBadge =
                    ab.id === 'evade' ? `RMB/${evadeKeyLabel}` : ab.key.split(' / ')[0];
                  const isBiteActive = ab.id === 'bite' && (p.bitePhase === 'windup' || p.bitePhase === 'strike');

                  return (
                    <button
                      key={ab.id}
                      type="button"
                      disabled={!unlocked || onCd}
                      onPointerDown={(e) => {
                        if (e.pointerType === 'mouse' && e.button !== 0) return;
                        e.stopPropagation();
                        e.preventDefault();
                        if (unlocked && !onCd) handleAbilityClick(ab.id);
                      }}
                      onClick={(e) => {
                        if (e.detail === 0 && unlocked && !onCd) handleAbilityClick(ab.id);
                      }}
                      title={`${ab.name} (${ab.id === 'evade' ? `RMB / ${evadeKeyLabel}` : ab.key})${staminaCost > 0 ? ` · ${staminaCost} Stamina` : ''} — ${ab.description}`}
                      aria-label={ab.name}
                      className={`relative flex flex-col items-center justify-center rounded-[3px] transition-transform touch-none overflow-hidden ${
                        isCompactMode ? 'w-11 h-11' : 'w-12 h-12 sm:w-16 sm:h-16'
                      } ${
                        !unlocked
                          ? 'compendium-slot-locked text-[#4e5f6b] cursor-not-allowed'
                          : onCd || stunLocked
                          ? 'compendium-slot opacity-65 text-[#8fa1ad]'
                          : lowStamina
                          ? 'compendium-slot opacity-75 text-[#94a3b8] ring-1 ring-inset ring-[#38bdf8]/45'
                          : isBiteActive
                          ? 'compendium-slot ring-1 ring-inset ring-[#fbbf24] text-[#fef3c7]'
                          : 'compendium-slot text-[#f7f2e7] hover:brightness-110 active:scale-95'
                      }`}
                    >
                      {!isCompactMode && (
                        <span className="hidden sm:block absolute top-0.5 left-1 text-[8px] font-mono-num font-bold text-[#f3d285] drop-shadow">
                          {keyBadge}
                        </span>
                      )}
                      <AbilityIcon id={ab.id} unlocked={unlocked} />
                      {!isCompactMode ? (
                        <span className="text-[8.5px] font-medium truncate max-w-full px-1 mt-0.5 leading-tight">
                          {unlocked ? ab.name.split(' / ')[0] : `Lv.${ab.unlockLevel}`}
                        </span>
                      ) : !unlocked ? (
                        <span className="absolute bottom-0.5 inset-x-0 text-center text-[8px] font-mono-num font-bold text-[#8ea3ae] leading-none">
                          {ab.unlockLevel}
                        </span>
                      ) : null}
                      {onCd && unlocked && (
                        <div className="absolute inset-0 bg-[#05090d]/78 flex items-center justify-center text-xs font-mono-num font-bold text-[#fbbf24]">
                          {cd.toFixed(1)}
                        </div>
                      )}
                      {lowStamina && !stunLocked && (
                        <div className="pointer-events-none absolute bottom-0 inset-x-0 bg-[#082032]/85 text-center text-[7.5px] font-mono-num font-bold text-[#7dd3fc] leading-tight py-px">
                          {staminaCost} ST
                        </div>
                      )}
                    </button>
                  );
                })}
                {/* Compendium bottom diamond finial */}
                {!isCompactMode && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -bottom-2 left-1/2 -translate-x-1/2 text-[11px] leading-none text-[#f3d285] drop-shadow"
                  >
                    ◆
                  </span>
                )}
              </div>

              {/* Signature Circular Concentric Sonar Dish (Design Compendium Plate 2) */}
              {(() => {
                const unlocked = p.level >= sonarSpec.unlockLevel;
                const cd = p.cooldowns.sonar;
                const onCd = cd > 0.05;
                const isHunter = p.level >= 80;
                const accentStroke = isHunter ? '#fbbf24' : '#38bdf8';
                return (
                  <button
                    type="button"
                    disabled={!unlocked || onCd}
                    onPointerDown={(e) => {
                      if (e.pointerType === 'mouse' && e.button !== 0) return;
                      e.stopPropagation();
                      e.preventDefault();
                      if (unlocked && !onCd) handleAbilityClick('sonar');
                    }}
                    onClick={(e) => {
                      if (e.detail === 0 && unlocked && !onCd) handleAbilityClick('sonar');
                    }}
                    title={`${isHunter ? 'Hunter Sonar' : 'Echo Sonar'} (E) — ${sonarSpec.description}`}
                    aria-label={isHunter ? 'Hunter Sonar' : 'Echo Sonar'}
                    className={`compendium-medallion relative flex flex-col items-center justify-center rounded-full transition-transform touch-none overflow-hidden ${
                      isCompactMode ? 'w-12 h-12' : 'w-16 h-16 sm:w-[78px] sm:h-[78px]'
                    } ${
                      !unlocked
                        ? 'opacity-50 cursor-not-allowed grayscale'
                        : p.sonarActive
                        ? 'ring-2 ring-[#7dd3fc]/70'
                        : onCd
                        ? 'opacity-80'
                        : 'hover:brightness-110 active:scale-95'
                    }`}
                  >
                    {/* Concentric Radar Grid SVG */}
                    <svg viewBox="0 0 64 64" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                      <circle cx="32" cy="32" r="24" fill="none" stroke={accentStroke} strokeOpacity="0.28" strokeWidth="1" />
                      <circle cx="32" cy="32" r="15" fill="none" stroke={accentStroke} strokeOpacity="0.38" strokeWidth="1" />
                      <circle cx="32" cy="32" r="6" fill="none" stroke={accentStroke} strokeOpacity="0.45" strokeWidth="1" />
                      <line x1="32" y1="6" x2="32" y2="58" stroke={accentStroke} strokeOpacity="0.22" strokeWidth="0.8" />
                      <line x1="6" y1="32" x2="58" y2="32" stroke={accentStroke} strokeOpacity="0.22" strokeWidth="0.8" />
                    </svg>
                    {unlocked && p.sonarActive && (
                      <svg
                        viewBox="0 0 64 64"
                        className="animate-sonar-sweep absolute inset-0 w-full h-full pointer-events-none"
                        aria-hidden="true"
                      >
                        <path d="M32 32 L32 6 A26 26 0 0 1 54 19 Z" fill={accentStroke} fillOpacity="0.28" />
                        <line x1="32" y1="32" x2="32" y2="6" stroke={accentStroke} strokeWidth="1.6" />
                      </svg>
                    )}
                    <Radar className={`relative ${isCompactMode ? 'w-5 h-5' : 'w-5 h-5 sm:w-6 sm:h-6'} ${isHunter ? 'text-[#fde68a]' : 'text-[#7dd3fc]'}`} />
                    {(!isCompactMode || !unlocked || onCd) && (
                      <span className={`relative ${isCompactMode ? 'text-[8px]' : 'text-[9px] mt-0.5'} font-mono-num font-bold text-[#f7f2e7] drop-shadow leading-none`}>
                        {!unlocked
                          ? isCompactMode
                            ? '20'
                            : 'Lv.20'
                          : onCd
                          ? `${cd.toFixed(0)}s`
                          : isHunter
                          ? 'Hunter [E]'
                          : 'Sonar [E]'}
                      </span>
                    )}
                  </button>
                );
              })()}
            </div>
            ) : null
          ) : hud.matchResult.status === 'playing' && isDeathCam && deathCam ? (
            <div
              data-death-cam="active"
              className={`compendium-plaque pointer-events-auto absolute ${
                isCompactMode ? 'bottom-2 w-[92vw] max-w-sm px-3 py-2' : 'bottom-4 w-[92vw] max-w-lg px-4 py-2.5'
              } left-1/2 -translate-x-1/2 rounded-sm border-[#ef4444]/65 origin-bottom ${scaleClass}`}
            >
              <div className="flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono-num font-bold uppercase tracking-wider text-[#fca5a5]">
                    <Skull className="w-3.5 h-3.5 text-[#ef4444] shrink-0" />
                    <span className="truncate">
                      {isCompactMode ? 'Death Cam · Slow-Mo' : 'Death Cam · Rival Perspective'}
                    </span>
                    <span className="text-[#f3d285] shrink-0">
                      {deathCam.remaining.toFixed(1)}s
                    </span>
                  </div>
                  <div className="font-display text-sm sm:text-base font-semibold text-[#f7f2e7] truncate mt-0.5">
                    {deathCam.killerName} <span className="font-mono-num text-[#f3d285]">· Lv.{deathCam.killerLevel}</span>
                  </div>
                  <div className="text-[10.5px] sm:text-[11px] text-[#a9b9c2] truncate">
                    Finishing Blow: {deathCam.causeLabel}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    isMultiplayer
                      ? multiplayerClient.sendSpectateAction('skip_death_cam')
                      : simRef.current?.skipDeathCam()
                  }
                  title="Skip Death Cam (Space)"
                  className="shrink-0 px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap rounded-[2px] border border-[#5f4722] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a] hover:text-white"
                >
                  Skip {!isCompactMode && <span className="text-[#9cb0ba] font-mono-num">[Space]</span>}
                </button>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-[1px] bg-[#080f14] border border-[#2a3b47] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#dc2626] via-[#f59e0b] to-[#f3d285]"
                  style={{
                    width: `${Math.max(0, Math.min(100, (deathCam.remaining / Math.max(0.01, deathCam.duration)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ) : hud.matchResult.status === 'playing' ? (
            <div className={`compendium-plaque pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 w-[94vw] max-w-2xl rounded-sm px-4 py-3 origin-bottom ${scaleClass}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#fbbf24]">
                    <Eye className="w-4 h-4 shrink-0" />
                    <span className="truncate font-display">
                      Spectating {spec?.targetName ?? 'Survivors'} (Lv.{spec?.targetLevel ?? 0})
                    </span>
                  </div>
                  <div className="text-[11px] text-[#a9b9c2] truncate mt-0.5">
                    Eliminated at Lv.{hud.matchResult.finalLevel} by {hud.matchResult.killedBy}
                    {hud.matchResult.massTransferredTo
                      ? ` · Fragments claimed by ${hud.matchResult.massTransferredTo}`
                      : ''}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      isMultiplayer
                        ? multiplayerClient.sendSpectateAction('prev')
                        : simRef.current?.cycleSpectateTarget(-1)
                    }
                    title="Previous Keli (A / Left Arrow)"
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-[2px] border border-[#5f4722] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a]"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      isMultiplayer
                        ? multiplayerClient.sendSpectateAction('leader')
                        : simRef.current?.spectateLeader()
                    }
                    title="Follow Top Leader (L / Tab)"
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-[2px] border border-[#5f4722] bg-[#142029] text-[#f3d285] hover:border-[#c99c4a]"
                  >
                    <Crown className="w-3.5 h-3.5" />
                    Leader
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      isMultiplayer
                        ? multiplayerClient.sendSpectateAction('next')
                        : simRef.current?.cycleSpectateTarget(1)
                    }
                    title="Next Keli (D / Right Arrow)"
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-[2px] border border-[#5f4722] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a]"
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>

                  {!isMultiplayer && (
                    <div className="flex items-center rounded-[2px] border border-[#2a3b47] bg-[#0a1015] p-0.5">
                      {([1, 2, 4] as const).map((spd) => (
                        <button
                          key={spd}
                          type="button"
                          onClick={() => setSpectateSpeed(spd)}
                          className={`px-2 py-1 text-[11px] font-mono-num font-semibold rounded-[2px] ${
                            spectateSpeed === spd
                              ? 'bg-[#c99c4a] text-[#0b1218]'
                              : 'text-[#9cb0ba] hover:text-white'
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => finishWithReplay(hud)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[2px] bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f]"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Summary
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className={`compendium-plaque pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 w-[94vw] max-w-xl rounded-sm p-4 origin-bottom ${scaleClass}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-mono-num font-semibold tracking-wider text-[#f3d285]">
                    ◆ Match Completed · {formatClock(hud.matchTime)}
                  </div>
                  <div className="font-display text-lg font-semibold text-[#f7f2e7] truncate">
                    {hud.matchResult.winnerName
                      ? `${hud.matchResult.winnerName} Crowned Keli King (Lv.100)`
                      : 'No Survivors Remaining'}
                  </div>
                  <div className="text-xs text-[#a9b9c2] mt-0.5">
                    Your run: Lv.{hud.matchResult.finalLevel} · {hud.matchResult.kills} kills · Eliminated by {hud.matchResult.killedBy}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => finishWithReplay(hud)}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-[2px] bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f]"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    View Match Summary
                  </button>
                  {!isMultiplayer && (
                    <button
                      type="button"
                      onClick={onRestart}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-[2px] border border-[#5b4724] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Play Again
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Touch Controls: Left Directional Joystick + Right Standalone Bite & Feed */}
          {showMobileControls && (
            <>
              <div
                data-mobile-control="true"
                onPointerDown={handleJoyPointerDown}
                onPointerMove={handleJoyPointerMove}
                onPointerUp={handleJoyPointerEnd}
                onPointerCancel={handleJoyPointerEnd}
                aria-label="Movement directional joystick"
                className={`compendium-medallion pointer-events-auto absolute left-3 rounded-full flex items-center justify-center touch-none select-none ${
                  canPlaceControlsBesideBar ? 'bottom-2.5' : 'bottom-16'
                } ${isCompactMode ? 'w-20 h-20' : 'w-24 h-24'}`}
              >
                <div className="pointer-events-none absolute inset-1.5 rounded-full border border-[#c99c4a]/35" />
                <div
                  className={`rounded-full bg-gradient-to-b from-[#f3d285] to-[#a87c32] border border-[#fef3c7] shadow-lg pointer-events-none ${
                    isCompactMode ? 'w-8 h-8' : 'w-10 h-10'
                  }`}
                  style={{
                    transform: `translate(${joyOffset.x}px, ${joyOffset.y}px)`,
                  }}
                />
              </div>

              {/* Mobile Slip Evade Defensive Counterplay Button */}
              {(() => {
                const evadeCd = p.cooldowns.evade ?? 0;
                const evadeOnCd = evadeCd > 0.05;
                const evadeLowStam = p.stamina < 24;
                return (
                  <button
                    type="button"
                    data-mobile-control="true"
                    disabled={evadeOnCd || p.stunned}
                    onPointerDown={(e) => {
                      if (e.pointerType === 'mouse' && e.button !== 0) return;
                      e.stopPropagation();
                      e.preventDefault();
                      if (!evadeOnCd && !p.stunned) {
                        soundEngine.startAmbient();
                        dispatchAbility('evade');
                      }
                    }}
                    onClick={(e) => {
                      if (e.detail === 0 && !evadeOnCd && !p.stunned) {
                        soundEngine.startAmbient();
                        dispatchAbility('evade');
                      }
                    }}
                    aria-label="Slip Evade"
                    className={`pointer-events-auto absolute rounded-full border-2 flex flex-col items-center justify-center gap-0.5 touch-none select-none shadow-xl transition-transform overflow-hidden ${
                      canPlaceControlsBesideBar
                        ? isCompactMode
                          ? 'bottom-3 right-[88px]'
                          : 'bottom-3.5 right-[100px]'
                        : isCompactMode
                          ? 'bottom-[68px] right-[88px]'
                          : 'bottom-[70px] right-[100px]'
                    } ${isCompactMode ? 'w-12 h-12' : 'w-14 h-14'} ${
                      evadeOnCd || p.stunned
                        ? 'border-[#334155] bg-[#0a151d]/85 text-[#94a3b8] opacity-75'
                        : evadeLowStam
                          ? 'border-[#38bdf8]/40 bg-[#082032]/85 text-[#7dd3fc] opacity-75'
                          : p.evading
                            ? 'scale-95 border-[#67e8f9] bg-gradient-to-b from-[#0e7490] to-[#083344] text-[#ecfeff]'
                            : 'border-[#22d3ee] bg-gradient-to-b from-[#0e3a4c] to-[#071c26] text-[#cffafe] active:scale-95'
                    }`}
                  >
                    <Shield className={`${isCompactMode ? 'w-4 h-4' : 'w-5 h-5'} pointer-events-none`} />
                    <span className="text-[8px] font-display font-semibold tracking-wide pointer-events-none leading-none">
                      {evadeOnCd ? evadeCd.toFixed(1) : 'EVADE'}
                    </span>
                  </button>
                );
              })()}

              {(() => {
                const isFeedingNow = Boolean(p.feedingTargetName && p.feedingDuration > 0);
                const feedRatio = isFeedingNow
                  ? Math.min(1, Math.max(0, p.feedingProgress / p.feedingDuration))
                  : 0;
                const feedRecovering = (p.feedingRecoveryTimeLeft ?? 0) > 0.02;
                const showFeedMode =
                  isFeedingNow || (p.hasCarcassInRange && !p.hasPreyInRange);
                const ringCircumference = 2 * Math.PI * 34;
                const displayMass = isFeedingNow
                  ? p.feedingTargetMass ?? 0
                  : p.nearbyCarcassMass ?? 0;
                return (
                  <button
                    type="button"
                    data-mobile-control="true"
                    onPointerDown={handleMobileBiteDown}
                    onPointerUp={handleMobileBiteUp}
                    onPointerCancel={handleMobileBiteUp}
                    onClick={(e) => {
                      if (e.detail === 0) {
                        soundEngine.startAmbient();
                        dispatchAbility('bite');
                      }
                    }}
                    aria-label="Bite and Feed"
                    className={`pointer-events-auto absolute right-3 rounded-full border-2 flex flex-col items-center justify-center gap-0.5 touch-none select-none shadow-2xl transition-transform ${
                      canPlaceControlsBesideBar ? 'bottom-2.5' : 'bottom-16'
                    } ${isCompactMode ? 'w-[72px] h-[72px]' : 'w-20 h-20'} ${
                      isFeedingNow
                        ? p.feedingContested
                          ? 'scale-95 border-[#fb923c] bg-gradient-to-b from-[#5c2308] to-[#230e04] text-[#fed7aa]'
                          : 'scale-95 border-[#4ade80] bg-gradient-to-b from-[#134e31] to-[#082416] text-[#dcfce7]'
                        : bitePressed
                        ? 'scale-95 border-[#f3d285] bg-gradient-to-b from-[#7f1d1d] to-[#3f0f12] text-[#fef3c7]'
                        : feedRecovering && p.hasCarcassInRange && !p.hasPreyInRange
                        ? 'border-[#f59e0b]/70 bg-gradient-to-b from-[#332208] to-[#1a1104] text-[#fde68a]'
                        : p.hasPreyInRange
                        ? 'border-[#ef4444] bg-gradient-to-b from-[#451418] to-[#1a0b0e] text-[#fecaca]'
                        : p.hasCarcassInRange
                        ? 'border-[#4ade80] bg-gradient-to-b from-[#133827] to-[#0a1d15] text-[#bbf7d0]'
                        : 'compendium-medallion text-[#f7f2e7]'
                    }`}
                  >
                    {isFeedingNow && (
                      <svg
                        viewBox="0 0 76 76"
                        className="pointer-events-none absolute -inset-[3px] w-[calc(100%+6px)] h-[calc(100%+6px)] -rotate-90"
                        aria-hidden="true"
                      >
                        <circle
                          cx="38"
                          cy="38"
                          r="34"
                          fill="none"
                          stroke="rgba(15, 23, 42, 0.55)"
                          strokeWidth="4"
                        />
                        <circle
                          cx="38"
                          cy="38"
                          r="34"
                          fill="none"
                          stroke={p.feedingContested ? '#fb923c' : p.feedingWindupDone ? '#4ade80' : '#f59e0b'}
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={ringCircumference}
                          strokeDashoffset={ringCircumference * (1 - feedRatio)}
                        />
                      </svg>
                    )}
                    <Swords className={`${isCompactMode ? 'w-5 h-5' : 'w-6 h-6'} pointer-events-none`} />
                    <span className={`${isCompactMode ? 'text-[9.5px]' : 'text-[10.5px]'} font-display font-semibold tracking-wide pointer-events-none leading-none`}>
                      {showFeedMode ? 'FEED' : 'BITE'}
                    </span>
                    {showFeedMode && displayMass > 0 && (
                      <span className="text-[9px] font-mono-num font-bold text-[#fde68a] pointer-events-none leading-none">
                        +{displayMass}
                      </span>
                    )}
                  </button>
                );
              })()}
            </>
          )}

          {/* New Evolution Form Visual Notification Toast (with Temporary Stat Boost Icon) */}
          {hudVis.banners && (
            <EvolutionFormToast
              toast={p.alive ? evolutionToast : null}
              boostTimeLeft={p.evoBoostTimeLeft}
              paused={paused}
              compact={isCompactMode}
              canPlaceControlsBesideBar={canPlaceControlsBesideBar}
              reducedMotion={settings.reducedMotion}
              onDismiss={(key) => setEvolutionToast((prev) => (prev?.key === key ? null : prev))}
            />
          )}

          {/* Quick-Access Radial Emote Wheel */}
          <EmoteWheel
            open={emoteWheelOpen && !isSpectating && p.alive && !paused}
            selectedIndex={emoteHoverIdx}
            cooldownLeft={emoteCooldownLeft}
            compact={isCompactMode}
            onHoverIndex={setEmoteHoverIdx}
            onSelectEmote={dispatchEmote}
            onClose={() => {
              setEmoteWheelOpen(false);
              setEmoteHoverIdx(null);
            }}
          />
        </div>
      )}

      {/* Pause & Accessibility Overlay */}
      {paused && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
          <div className="compendium-plaque w-full max-w-md max-h-[90dvh] flex flex-col rounded-sm overflow-hidden">
            <div className="compendium-ribbon flex items-center justify-between px-5 py-3 shrink-0">
              <h2 className="font-display text-xl font-semibold text-[#f3d285]">
                {isMultiplayer ? '◆ Live Basin Options' : '◆ Match Paused'}
              </h2>
              <span className="text-xs font-mono-num text-[#d9b25f]">
                {isTouchDevice ? 'Back' : 'Esc'}
              </span>
            </div>

            <div className="p-5 sm:p-6 space-y-5 overflow-y-auto overscroll-contain">
              <div className="space-y-3 border-b border-[#253642] pb-4 text-sm">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-[#e2e8f0]">Reduced Camera Shake</span>
                  <input
                    type="checkbox"
                    checked={settings.reducedMotion}
                    onChange={(e) => onUpdateSettings({ reducedMotion: e.target.checked })}
                    className="accent-[#c99c4a] w-4 h-4"
                  />
                </label>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#e2e8f0]">Evade Key (also Right-Click)</span>
                  <div className="compendium-track flex items-center gap-1 p-1 rounded-[2px]">
                    {(['KeyC', 'KeyX', 'KeyZ', 'AltLeft'] as const).map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => onUpdateSettings({ evadeKey: code })}
                        className={`px-2 py-0.5 text-xs font-mono-num rounded-[2px] ${
                          (settings.evadeKey ?? 'KeyC') === code
                            ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                            : 'text-[#9cb0ba] hover:text-white'
                        }`}
                      >
                        {formatKeyCodeLabel(code)}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-[#e2e8f0]">Visual Sound Cues</span>
                  <input
                    type="checkbox"
                    checked={settings.visualSoundCues}
                    onChange={(e) => onUpdateSettings({ visualSoundCues: e.target.checked })}
                    className="accent-[#c99c4a] w-4 h-4"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-[#e2e8f0]">Mute Audio</span>
                  <input
                    type="checkbox"
                    checked={settings.muted}
                    onChange={(e) => onUpdateSettings({ muted: e.target.checked })}
                    className="accent-[#c99c4a] w-4 h-4"
                  />
                </label>

                <label className="flex items-center justify-between gap-3">
                  <span className="text-[#e2e8f0]">
                    Music Volume ({Math.round((settings.musicVolume ?? 0.35) * 100)}%)
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.musicVolume ?? 0.35}
                    aria-label="Music Volume"
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      soundEngine.setMusicVolume(v);
                      onUpdateSettings({ musicVolume: v });
                    }}
                    className="accent-[#c99c4a] w-32"
                  />
                </label>

                <label className="flex items-center justify-between gap-3">
                  <span className="text-[#e2e8f0]">
                    Effects Volume ({Math.round(settings.volume * 100)}%)
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.volume}
                    aria-label="Sound Effects Volume"
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      soundEngine.setVolume(v);
                      onUpdateSettings({ volume: v });
                    }}
                    className="accent-[#c99c4a] w-32"
                  />
                </label>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#e2e8f0]">HUD Scale</span>
                  <div className="compendium-track flex items-center gap-1 p-1 rounded-[2px]">
                    {(['compact', 'standard', 'large'] as const).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => onUpdateSettings({ hudScale: sz })}
                        className={`px-2 py-1 text-xs rounded-[2px] capitalize ${
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
                  <span className="text-[#e2e8f0]">Graphics Quality</span>
                  <div className="compendium-track flex items-center gap-1 p-1 rounded-[2px]">
                    {(['auto', 'low', 'medium', 'high'] as GraphicsQuality[]).map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => onUpdateSettings({ graphicsQuality: q })}
                        className={`px-2 py-1 text-xs rounded-[2px] capitalize ${
                          (settings.graphicsQuality ?? 'auto') === q
                            ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                            : 'text-[#9cb0ba] hover:text-white'
                        }`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-[#202e38]">
                  <HudVisibilityControls
                    hudVisibility={hudVis}
                    onChange={(hudVisibility) => onUpdateSettings({ hudVisibility })}
                    compact
                  />
                </div>

                {isMultiplayer && platformCaps.spatialVoiceEnabled && (
                  <div className="pt-2 border-t border-[#202e38] space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[#e2e8f0]">Proximity Mic</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            spatialVoice.unlockAudioContext();
                            if (voiceSnap.micEnabled) spatialVoice.disableMic();
                            else void spatialVoice.enableMic();
                          }}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-[2px] border ${
                            voiceSnap.micEnabled
                              ? 'border-[#4ade80]/60 bg-[#122e20] text-[#bbf7d0]'
                              : 'border-[#5b4724] bg-[#142029] text-[#f3d285]'
                          }`}
                        >
                          {voiceSnap.micEnabled ? 'Mic Enabled' : 'Enable Mic'}
                        </button>
                        <div className="compendium-track flex items-center gap-1 p-1 rounded-[2px]">
                          {(['open', 'ptt'] as const).map((vm) => (
                            <button
                              key={vm}
                              type="button"
                              onClick={() => onUpdateSettings({ voiceMode: vm })}
                              className={`px-2 py-0.5 text-xs rounded-[2px] ${
                                (settings.voiceMode ?? 'open') === vm
                                  ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                                  : 'text-[#9cb0ba] hover:text-white'
                              }`}
                            >
                              {vm === 'open' ? 'Open' : 'PTT [V]'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <label className="flex items-center justify-between gap-3">
                      <span className="text-[#e2e8f0]">Proximity Voice Volume</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={settings.voiceVolume ?? 0.9}
                        onChange={(e) =>
                          onUpdateSettings({ voiceVolume: parseFloat(e.target.value) })
                        }
                        className="accent-[#c99c4a] w-32"
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setPaused(false)}
                  className="w-full py-2.5 text-sm font-semibold rounded-[2px] border border-[#f3d285]/40 bg-[#c99c4a] text-[#0b1218] hover:bg-[#e5b66c] transition-colors"
                >
                  Resume Match
                </button>
                {!isMultiplayer && (
                  <button
                    type="button"
                    onClick={() => {
                      setPaused(false);
                      onRestart();
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-[2px] border border-[#5b4724] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a] transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Restart Match
                  </button>
                )}
                <button
                  type="button"
                  onClick={onExitToLobby}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-[2px] border border-[#2d404d] bg-[#0b1218] text-[#9cb0ba] hover:border-[#c99c4a] hover:text-white transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  {isMultiplayer ? 'Leave Basin & Exit' : 'Exit to Lobby'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Optional Dev-Only Local AI Debug Overlay (disabled by default; Ctrl+Shift+D) */}
      {showAiDebug && !isMultiplayer && simRef.current && (
        <AiDebugOverlay
          entries={aiDebugEntries}
          difficulty={aiDifficulty}
          matchSeed={simRef.current.getMatchSeed()}
          playerX={simRef.current.getPlayer().x}
          playerZ={simRef.current.getPlayer().z}
          pacingMetrics={simRef.current.getPacingMetrics()}
          onChangeDifficulty={(d) => {
            simRef.current?.setAiDifficulty(d);
            setAiDifficulty(d);
          }}
          onClose={() => setShowAiDebug(false)}
        />
      )}
      {isMultiplayer && mpSnapshot && (
        <MultiplayerDebugPanel
          snapshot={mpSnapshot}
          roomCode={roomCode}
          matchId={multiplayerMatchId}
          localPlayerId={multiplayerPlayerId}
          snapshotTick={latestSnapshotTick}
          positionClassName="bottom-3 left-3"
        />
      )}
    </div>
  );
};

import { useCallback, useEffect, useRef, useState } from 'react';
import { ComicReaderModal } from './components/ComicReaderModal';
import { DesignCodexModal } from './components/DesignCodexModal';
import { GameViewport } from './components/GameViewport';
import { LobbyPlayMode, LobbyScreen } from './components/LobbyScreen';
import { PostMatchScreen } from './components/PostMatchScreen';
import { TitleScreen } from './components/TitleScreen';
import { RegionCode, RegionFilter } from './data/regions';
import {
  exitAndroidApp,
  initAndroidNativeShell,
  registerAndroidBackHandler,
  setAndroidGameplayImmersive,
} from './game/androidNative';
import { soundEngine } from './game/audio';
import { getBackendConfig } from './game/backendConfig';
import { persistentSaveManager } from './game/cloudSave';
import { getPlatformCapabilities } from './game/platform';
import { computeMatchScoreFromHud, MatchScoreBreakdown } from './game/scoring';
import { loadSavedSettings, saveSettings } from './game/settings';
import {
  clearTopSurvivalTimes,
  fetchGlobalLeaderboard,
  getSavedPlayerName,
  getSavedPlayerRegion,
  getTopSurvivalTimes,
  GlobalLeaderboardResponse,
  GlobalLeaderboardSort,
  LeaderboardSaveState,
  LeaderboardUnavailableError,
  recordKeliKingSurvivalTime,
  savePlayerName,
  savePlayerRegion,
  submitGlobalSurvivalTime,
  SurvivalLeaderboardEntry,
} from './game/leaderboard';
import {
  LeaderboardResultEvent,
  multiplayerClient,
  MultiplayerSnapshot,
} from './game/multiplayerClient';
import { normalizeRoomCode } from './game/multiplayerTypes';
import { MatchReplayData } from './game/replay';
import { spatialVoice } from './game/spatialVoice';
import { AccessibilitySettings, HudSnapshot, LobbySize } from './game/types';
import { youtubePlayablesBridge } from './game/youtubePlayables';

type ScreenState = 'title' | 'lobby' | 'playing' | 'summary';

export default function App() {
  const platformCapabilities = getPlatformCapabilities();
  const [screen, setScreen] = useState<ScreenState>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('room')?.trim() && platformCapabilities.onlineMultiplayerEnabled) return 'lobby';
    } catch {
      // Ignore URL parse errors
    }
    return 'title';
  });
  const [lobbySize, setLobbySize] = useState<LobbySize>(20);
  const [mode, setMode] = useState<LobbyPlayMode>('royale');
  const [matchKey, setMatchKey] = useState(1);
  const [finalHud, setFinalHud] = useState<HudSnapshot | null>(null);
  const [finalReplay, setFinalReplay] = useState<MatchReplayData | null>(null);
  const [lastMatchScore, setLastMatchScore] = useState<MatchScoreBreakdown | null>(null);
  const [bestScore, setBestScore] = useState<number>(0);
  const [ytAudioEnabled, setYtAudioEnabled] = useState<boolean>(() =>
    platformCapabilities.youtubeSdkEnabled ? youtubePlayablesBridge.isAudioEnabled() : true
  );
  const [ytPaused, setYtPaused] = useState<boolean>(false);
  const [playerName, setPlayerName] = useState<string>(() => getSavedPlayerName());
  const [playerRegion, setPlayerRegion] = useState<RegionCode>(() => getSavedPlayerRegion());
  const [leaderboard, setLeaderboard] = useState<SurvivalLeaderboardEntry[]>(() =>
    getTopSurvivalTimes()
  );
  const [lastLeaderboardRank, setLastLeaderboardRank] = useState<number | null>(null);
  const backendConfig = getBackendConfig();
  const onlineLeaderboardAvailable =
    platformCapabilities.externalLeaderboardsEnabled && backendConfig.isApiConfigured;
  const onlineMultiplayerAvailable =
    platformCapabilities.onlineMultiplayerEnabled && backendConfig.isWsConfigured;

  const [globalLeaderboard, setGlobalLeaderboard] = useState<GlobalLeaderboardResponse | null>(
    null
  );
  const [globalLeaderboardLoading, setGlobalLeaderboardLoading] = useState<boolean>(
    onlineLeaderboardAvailable
  );
  const [globalLeaderboardUnavailable, setGlobalLeaderboardUnavailable] = useState<boolean>(
    !onlineLeaderboardAvailable
  );
  const [globalLeaderboardError, setGlobalLeaderboardError] = useState<string | null>(null);
  const [globalRegionFilter, setGlobalRegionFilter] = useState<RegionFilter>('ALL');
  const [globalSort, setGlobalSort] = useState<GlobalLeaderboardSort>('longest');
  const [lastGlobalRank, setLastGlobalRank] = useState<{
    globalRank: number | null;
    regionalRank: number | null;
    region: RegionCode;
  } | null>(null);
  const [leaderboardSaveState, setLeaderboardSaveState] = useState<LeaderboardSaveState>({
    status: 'idle',
    globalRank: null,
    regionalRank: null,
    region: null,
  });

  const [mpSnapshot, setMpSnapshot] = useState<MultiplayerSnapshot>(() =>
    multiplayerClient.getSnapshot()
  );
  const [activeMpSession, setActiveMpSession] = useState<{
    playerId: string;
    roomCode: string;
    matchId: string;
  } | null>(null);
  const screenRef = useRef<ScreenState>(screen);
  screenRef.current = screen;
  const activeMpSessionRef = useRef<{
    playerId: string;
    roomCode: string;
    matchId: string;
  } | null>(activeMpSession);
  activeMpSessionRef.current = activeMpSession;
  const lastMpMatchIdRef = useRef<string | null>(null);
  const pendingSoloSubmissionRef = useRef<{
    snap: HudSnapshot;
    playerName: string;
    region: RegionCode;
    submissionId: string;
  } | null>(null);

  const [epilogueUnlocked, setEpilogueUnlocked] = useState<boolean>(() => {
    if (!platformCapabilities.localStorageAllowed) return false;
    try {
      return localStorage.getItem('awang_keli_epilogue') === '1';
    } catch {
      return false;
    }
  });

  const [comicOpen, setComicOpen] = useState(false);
  const [comicInitialPage, setComicInitialPage] = useState(1);

  const [codexOpen, setCodexOpen] = useState(false);
  const [codexPlateId, setCodexPlateId] = useState('overview');

  const [settings, setSettings] = useState<AccessibilitySettings>(() =>
    loadSavedSettings()
  );
  const [exitPromptVisible, setExitPromptVisible] = useState(false);
  const lastTitleBackAtRef = useRef<number>(0);
  const exitToastTimerRef = useRef<number | null>(null);
  const recordedMatchKeyRef = useRef<number | null>(null);

  // YouTube Playables SDK lifecycle, audio state, and load-before-save cloud sync
  useEffect(() => {
    let active = true;
    let raf1 = 0;
    let raf2 = 0;

    if (platformCapabilities.youtubeSdkEnabled) {
      raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(() => {
          youtubePlayablesBridge.signalFirstFrameReady();
        });
      });
    }

    const unsubAudio = platformCapabilities.youtubeSdkEnabled
      ? youtubePlayablesBridge.subscribeAudioEnabledChange((enabled) => {
          setYtAudioEnabled(enabled);
        })
      : () => {};

    const unsubLifecycle = platformCapabilities.youtubeSdkEnabled
      ? youtubePlayablesBridge.subscribeLifecycle(
          () => setYtPaused(true),
          () => setYtPaused(false)
        )
      : () => {};

    void persistentSaveManager.load().then((loaded) => {
      if (!active) return;
      setBestScore(loaded.bestScore);
      if (loaded.epilogueUnlocked) {
        setEpilogueUnlocked(true);
      }
      if (platformCapabilities.cloudSaveEnabled) {
        setSettings((prev) => ({
          ...prev,
          ...persistentSaveManager.extractSettingsPatch(),
        }));
      }
      if (platformCapabilities.youtubeSdkEnabled) {
        youtubePlayablesBridge.signalGameReady();
      }
    });

    return () => {
      active = false;
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
      unsubAudio();
      unsubLifecycle();
    };
  }, [platformCapabilities.cloudSaveEnabled, platformCapabilities.youtubeSdkEnabled]);

  useEffect(() => {
    return initAndroidNativeShell();
  }, []);

  useEffect(() => {
    void setAndroidGameplayImmersive(screen === 'playing');
  }, [screen]);

  useEffect(() => {
    return () => {
      if (exitToastTimerRef.current !== null) {
        window.clearTimeout(exitToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const effectiveMuted = settings.muted || !ytAudioEnabled || ytPaused;
    soundEngine.setMuted(effectiveMuted);
    soundEngine.setVolume(settings.volume);
    soundEngine.setMusicVolume(settings.musicVolume ?? 0.35);
    if (platformCapabilities.spatialVoiceEnabled) {
      spatialVoice.setMasterMuted(effectiveMuted);
      spatialVoice.setVoiceVolume(settings.voiceVolume ?? 0.9);
      spatialVoice.setVoiceMode(settings.voiceMode ?? 'open');
    }
  }, [
    settings.muted,
    settings.volume,
    settings.musicVolume,
    settings.voiceVolume,
    settings.voiceMode,
    ytAudioEnabled,
    ytPaused,
    platformCapabilities.spatialVoiceEnabled,
  ]);

  useEffect(() => {
    return soundEngine.attachMenuMusicLifecycle();
  }, []);

  useEffect(() => {
    const wantsMenuSoundtrack = (screen === 'title' || screen === 'lobby') && !ytPaused;
    soundEngine.setMenuMusicWanted(wantsMenuSoundtrack, 0.85);
  }, [screen, ytPaused]);

  const refreshGlobalLeaderboard = useCallback(
    async (regionFilter: RegionFilter = globalRegionFilter, sort: GlobalLeaderboardSort = globalSort) => {
      if (!onlineLeaderboardAvailable) {
        setGlobalLeaderboardLoading(false);
        setGlobalLeaderboardUnavailable(true);
        setGlobalLeaderboardError(null);
        return;
      }
      setGlobalLeaderboardLoading(true);
      setGlobalLeaderboardError(null);
      try {
        const data = await fetchGlobalLeaderboard(regionFilter, sort, 100);
        setGlobalLeaderboard(data);
        setGlobalLeaderboardUnavailable(false);
        setGlobalLeaderboardError(null);
      } catch (err) {
        // Keep any previously loaded leaderboard intact rather than wiping it to empty
        if (err instanceof LeaderboardUnavailableError) {
          setGlobalLeaderboardUnavailable(true);
          setGlobalLeaderboardError(err.message);
        } else {
          setGlobalLeaderboardUnavailable(false);
          setGlobalLeaderboardError(
            err instanceof Error ? err.message : 'Unable to reach global rankings service.'
          );
        }
      } finally {
        setGlobalLeaderboardLoading(false);
      }
    },
    [globalRegionFilter, globalSort, onlineLeaderboardAvailable]
  );

  const refreshGlobalLeaderboardRef = useRef(refreshGlobalLeaderboard);
  refreshGlobalLeaderboardRef.current = refreshGlobalLeaderboard;

  const applyMultiplayerLeaderboardResult = useCallback((event: LeaderboardResultEvent) => {
    const relevantMatchId = activeMpSessionRef.current?.matchId ?? lastMpMatchIdRef.current;
    if (relevantMatchId && event.matchId !== relevantMatchId) {
      return;
    }

    if (event.status === 'saved') {
      setLastGlobalRank({
        globalRank: event.globalRank,
        regionalRank: event.regionalRank,
        region: event.region,
      });
      setLeaderboardSaveState({
        status: 'saved',
        globalRank: event.globalRank,
        regionalRank: event.regionalRank,
        region: event.region,
        message: null,
        retryable: false,
      });
      void refreshGlobalLeaderboardRef.current();
      return;
    }

    setLastGlobalRank(null);
    if (event.status === 'unavailable') {
      setLeaderboardSaveState({
        status: 'unavailable',
        globalRank: null,
        regionalRank: null,
        region: event.region,
        message: event.error || 'Global rankings database is currently unavailable.',
        retryable: false,
      });
      return;
    }
    if (event.status === 'ineligible') {
      setLeaderboardSaveState({
        status: 'ineligible',
        globalRank: null,
        regionalRank: null,
        region: event.region,
        message: event.error || 'Run did not qualify for global rankings.',
        retryable: false,
      });
      return;
    }
    setLeaderboardSaveState({
      status: 'failed',
      globalRank: null,
      regionalRank: null,
      region: event.region,
      message: event.error || 'Server could not save your multiplayer ranking after retrying.',
      retryable: false,
    });
  }, []);

  useEffect(() => {
    if (!platformCapabilities.onlineMultiplayerEnabled) {
      return;
    }
    const unsubState = multiplayerClient.subscribe(setMpSnapshot);
    const unsubLeaderboardResult = multiplayerClient.onLeaderboardResult(
      applyMultiplayerLeaderboardResult
    );
    const unsubStart = multiplayerClient.onMatchStarted((info) => {
      const currentSession = activeMpSessionRef.current;
      const isDuplicateActiveMatch =
        screenRef.current === 'playing' &&
        currentSession !== null &&
        currentSession.matchId === info.matchId &&
        currentSession.roomCode === info.roomCode &&
        currentSession.playerId === info.playerId;

      if (isDuplicateActiveMatch) {
        return;
      }

      soundEngine.setMenuMusicWanted(false, 0.75);
      pendingSoloSubmissionRef.current = null;
      lastMpMatchIdRef.current = info.matchId;
      setFinalHud(null);
      setFinalReplay(null);
      setLastMatchScore(null);
      setLastLeaderboardRank(null);
      setLastGlobalRank(null);
      setLeaderboardSaveState({
        status: 'idle',
        globalRank: null,
        regionalRank: null,
        region: null,
      });
      setActiveMpSession(info);
      setMode('multiplayer');
      setMatchKey((k) => k + 1);
      setScreen('playing');
    });

    if (onlineMultiplayerAvailable) {
      if (platformCapabilities.spatialVoiceEnabled) {
        spatialVoice.init();
      }
      multiplayerClient.connect();
    }

    // Auto-join Basin if ?room=CODE is present in the URL and multiplayer is available
    const params = new URLSearchParams(window.location.search);
    const roomParam = normalizeRoomCode(params.get('room') ?? '');
    let joinedInitial = false;
    const unsubWelcome =
      roomParam && onlineMultiplayerAvailable
        ? multiplayerClient.subscribe((snap) => {
            if (!joinedInitial && snap.status === 'connected' && !snap.currentRoom) {
              joinedInitial = true;
              setMode('multiplayer');
              multiplayerClient.joinRoom(roomParam, getSavedPlayerName(), getSavedPlayerRegion());
            }
          })
        : () => {};

    return () => {
      unsubWelcome();
      unsubStart();
      unsubLeaderboardResult();
      unsubState();
    };
  }, [
    applyMultiplayerLeaderboardResult,
    onlineMultiplayerAvailable,
    platformCapabilities.onlineMultiplayerEnabled,
    platformCapabilities.spatialVoiceEnabled,
  ]);

  const handleUpdateSettings = useCallback(
    (patch: Partial<AccessibilitySettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        saveSettings(next);
        void persistentSaveManager.savePatch((curr) => ({
          ...curr,
          settings: {
            reducedMotion: next.reducedMotion,
            visualSoundCues: next.visualSoundCues,
            hudScale: next.hudScale,
            graphicsQuality: next.graphicsQuality ?? 'auto',
            aiDifficulty: next.aiDifficulty ?? 'normal',
            muted: next.muted,
            volume: next.volume,
            musicVolume: next.musicVolume ?? 0.35,
          },
        }));
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (!onlineLeaderboardAvailable) return;
    void refreshGlobalLeaderboard(globalRegionFilter, globalSort);
  }, [globalRegionFilter, globalSort, onlineLeaderboardAvailable, refreshGlobalLeaderboard]);

  const handlePlayerNameChange = useCallback(
    (nextName: string) => {
      const saved = savePlayerName(nextName);
      setPlayerName(saved);
      if (platformCapabilities.onlineMultiplayerEnabled) {
        multiplayerClient.renamePlayer(saved, playerRegion);
      }
    },
    [platformCapabilities.onlineMultiplayerEnabled, playerRegion]
  );

  const handlePlayerRegionChange = useCallback(
    (nextRegion: RegionCode) => {
      const saved = savePlayerRegion(nextRegion);
      setPlayerRegion(saved);
      if (platformCapabilities.onlineMultiplayerEnabled) {
        multiplayerClient.updateRegion(saved);
      }
    },
    [platformCapabilities.onlineMultiplayerEnabled]
  );

  const handleClearLeaderboard = useCallback(() => {
    setLeaderboard(clearTopSurvivalTimes());
    setLastLeaderboardRank(null);
  }, []);

  const executeSoloLeaderboardSubmission = useCallback(
    async (payload: {
      snap: HudSnapshot;
      playerName: string;
      region: RegionCode;
      submissionId: string;
    }) => {
      setLeaderboardSaveState({
        status: 'saving',
        globalRank: null,
        regionalRank: null,
        region: payload.region,
        message: 'Saving solo ranking to Global Leaderboard...',
        retryable: false,
      });

      const outcome = await submitGlobalSurvivalTime(
        payload.snap,
        payload.playerName,
        payload.region,
        payload.submissionId
      );

      if (outcome.ok) {
        pendingSoloSubmissionRef.current = null;
        setLastGlobalRank({
          globalRank: outcome.result.globalRank,
          regionalRank: outcome.result.regionalRank,
          region: outcome.result.entry.region,
        });
        setLeaderboardSaveState({
          status: 'saved',
          globalRank: outcome.result.globalRank,
          regionalRank: outcome.result.regionalRank,
          region: outcome.result.entry.region,
          message: null,
          retryable: false,
        });
        void refreshGlobalLeaderboardRef.current();
        return;
      }

      setLastGlobalRank(null);
      setLeaderboardSaveState({
        status: outcome.status,
        globalRank: null,
        regionalRank: null,
        region: payload.region,
        message: outcome.error,
        retryable: outcome.retryable,
      });
    },
    []
  );

  const handleRetrySoloLeaderboardSave = useCallback(() => {
    const pending = pendingSoloSubmissionRef.current;
    if (!pending) return;
    void executeSoloLeaderboardSubmission(pending);
  }, [executeSoloLeaderboardSubmission]);

  const handleStartMatch = useCallback(() => {
    if (mode === 'multiplayer') return;
    soundEngine.setMenuMusicWanted(false, 0.75);
    pendingSoloSubmissionRef.current = null;
    lastMpMatchIdRef.current = null;
    setActiveMpSession(null);
    setFinalHud(null);
    setFinalReplay(null);
    setLastMatchScore(null);
    setLastLeaderboardRank(null);
    setLastGlobalRank(null);
    setLeaderboardSaveState({
      status: 'idle',
      globalRank: null,
      regionalRank: null,
      region: null,
    });
    setMatchKey((k) => k + 1);
    setScreen('playing');
  }, [mode]);

  const handleMatchFinished = useCallback(
    (snap: HudSnapshot, replayData: MatchReplayData) => {
      setFinalHud(snap);
      setFinalReplay(replayData);

      const scoreBreakdown = computeMatchScoreFromHud(snap);
      setLastMatchScore(scoreBreakdown);

      const alreadyRecorded = recordedMatchKeyRef.current === matchKey;
      if (!alreadyRecorded) {
        recordedMatchKeyRef.current = matchKey;
        const isKingVictory =
          snap.matchResult.status === 'victory' && snap.matchResult.finalLevel === 100;

        if (isKingVictory) {
          setEpilogueUnlocked(true);
          if (platformCapabilities.localStorageAllowed) {
            try {
              localStorage.setItem('awang_keli_epilogue', '1');
            } catch {
              // Ignore storage errors
            }
          }
          const result = recordKeliKingSurvivalTime(snap, playerName);
          setLeaderboard(result.entries);
          setLastLeaderboardRank(result.rank);
        } else {
          setLastLeaderboardRank(null);
        }

        if (snap.mode !== 'tutorial') {
          setBestScore((prev) => Math.max(prev, scoreBreakdown.totalScore));
          void persistentSaveManager.savePatch((curr) => ({
            ...curr,
            bestScore: Math.max(curr.bestScore, scoreBreakdown.totalScore),
            bestSurvivalSec: Math.max(
              curr.bestSurvivalSec,
              Math.floor(snap.matchResult.survivalTime)
            ),
            matchesCompleted: curr.matchesCompleted + 1,
            keliKingVictories: curr.keliKingVictories + (isKingVictory ? 1 : 0),
            epilogueUnlocked: curr.epilogueUnlocked || isKingVictory,
            recentMatches: [
              {
                completedAt: Date.now(),
                score: scoreBreakdown.totalScore,
                finalLevel: Math.max(1, Math.min(100, Math.round(snap.matchResult.finalLevel))),
                kills: Math.max(0, Math.floor(snap.matchResult.kills)),
                survivalSec: Math.max(0, Math.floor(snap.matchResult.survivalTime)),
                lobbySize: snap.lobbySize,
                victory: isKingVictory,
              },
              ...curr.recentMatches,
            ].slice(0, 10),
          }));

          if (platformCapabilities.scoreSubmissionEnabled && scoreBreakdown.totalScore > 0) {
            const ytMatchId = `yt-run-${matchKey}`;
            void youtubePlayablesBridge.submitScore(scoreBreakdown.totalScore, ytMatchId);
          }
        }

        if (activeMpSession) {
          // Multiplayer results are persisted exclusively by the authoritative server — never POST from the browser.
          pendingSoloSubmissionRef.current = null;
          lastMpMatchIdRef.current = activeMpSession.matchId;
          const serverResult = multiplayerClient.getLeaderboardResultForMatch(
            activeMpSession.matchId
          );
          if (serverResult) {
            applyMultiplayerLeaderboardResult(serverResult);
          } else if (!onlineLeaderboardAvailable) {
            setLastGlobalRank(null);
            setLeaderboardSaveState({
              status: 'unavailable',
              globalRank: null,
              regionalRank: null,
              region: playerRegion,
              message: 'Global rankings are not configured for this build.',
              retryable: false,
            });
          } else if (snap.matchResult.survivalTime < 1) {
            setLastGlobalRank(null);
            setLeaderboardSaveState({
              status: 'ineligible',
              globalRank: null,
              regionalRank: null,
              region: playerRegion,
              message: 'Survive at least 1 second to qualify for global rankings.',
              retryable: false,
            });
          } else {
            setLastGlobalRank(null);
            setLeaderboardSaveState({
              status: 'saving',
              globalRank: null,
              regionalRank: null,
              region: playerRegion,
              message: 'Confirming server-authoritative multiplayer ranking...',
              retryable: false,
            });
          }
        } else if (snap.mode === 'tutorial') {
          pendingSoloSubmissionRef.current = null;
          setLastGlobalRank(null);
          setLeaderboardSaveState({
            status: 'idle',
            globalRank: null,
            regionalRank: null,
            region: null,
          });
        } else if (!onlineLeaderboardAvailable) {
          pendingSoloSubmissionRef.current = null;
          setLastGlobalRank(null);
          setLeaderboardSaveState({
            status: 'unavailable',
            globalRank: null,
            regionalRank: null,
            region: playerRegion,
            message: 'Global rankings require a hosted backend API.',
            retryable: false,
          });
        } else if (snap.matchResult.survivalTime < 1) {
          pendingSoloSubmissionRef.current = null;
          setLastGlobalRank(null);
          setLeaderboardSaveState({
            status: 'ineligible',
            globalRank: null,
            regionalRank: null,
            region: playerRegion,
            message: 'Survive at least 1 second to qualify for global rankings.',
            retryable: false,
          });
        } else {
          const subId = `solo-${matchKey}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          const payload = {
            snap,
            playerName,
            region: playerRegion,
            submissionId: subId,
          };
          pendingSoloSubmissionRef.current = payload;
          void executeSoloLeaderboardSubmission(payload);
        }
      }

      setScreen('summary');
    },
    [
      activeMpSession,
      applyMultiplayerLeaderboardResult,
      executeSoloLeaderboardSubmission,
      matchKey,
      onlineLeaderboardAvailable,
      platformCapabilities.localStorageAllowed,
      platformCapabilities.scoreSubmissionEnabled,
      playerName,
      playerRegion,
    ]
  );

  const handleExitToLobby = useCallback(() => {
    if (activeMpSession) {
      multiplayerClient.leaveRoom();
      setActiveMpSession(null);
    }
    setScreen('lobby');
    if (onlineLeaderboardAvailable) {
      void refreshGlobalLeaderboardRef.current();
    }
  }, [activeMpSession, onlineLeaderboardAvailable]);

  const handleReturnFromSummary = useCallback(() => {
    // Keep player inside their Basin Room if still connected, so they can rematch or chat
    setActiveMpSession(null);
    setScreen('lobby');
    if (onlineLeaderboardAvailable) {
      void refreshGlobalLeaderboardRef.current();
    }
  }, [onlineLeaderboardAvailable]);

  const handleRematch = useCallback(() => {
    if (activeMpSession) {
      multiplayerClient.restartRoomMatch();
      return;
    }
    handleStartMatch();
  }, [activeMpSession, handleStartMatch]);

  const handleOpenComic = useCallback((page = 1) => {
    setComicInitialPage(page);
    setComicOpen(true);
  }, []);

  const handleOpenCodex = useCallback((plateId = 'overview') => {
    setCodexPlateId(plateId);
    setCodexOpen(true);
  }, []);

  useEffect(() => {
    if (!comicOpen && !codexOpen) return;
    return registerAndroidBackHandler(() => {
      if (codexOpen) {
        setCodexOpen(false);
        return true;
      }
      if (comicOpen) {
        setComicOpen(false);
        return true;
      }
      return false;
    }, 30);
  }, [comicOpen, codexOpen]);

  useEffect(() => {
    return registerAndroidBackHandler(() => {
      if (screen === 'summary') {
        handleReturnFromSummary();
        return true;
      }
      if (screen === 'lobby') {
        setScreen('title');
        return true;
      }
      if (screen === 'title') {
        const now = Date.now();
        if (now - lastTitleBackAtRef.current < 2000) {
          lastTitleBackAtRef.current = 0;
          setExitPromptVisible(false);
          void exitAndroidApp();
          return true;
        }
        lastTitleBackAtRef.current = now;
        setExitPromptVisible(true);
        if (exitToastTimerRef.current !== null) {
          window.clearTimeout(exitToastTimerRef.current);
        }
        exitToastTimerRef.current = window.setTimeout(() => {
          setExitPromptVisible(false);
        }, 2000);
        return true;
      }
      return false;
    }, 10);
  }, [screen, handleReturnFromSummary]);

  const isMpHost = Boolean(
    mpSnapshot.currentRoom && mpSnapshot.currentRoom.hostId === mpSnapshot.clientId
  );

  return (
    <div className="w-full min-h-[100dvh] bg-[#0c141a] overflow-x-hidden">
      {screen === 'title' && (
        <TitleScreen
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onPlay={() => setScreen('lobby')}
        />
      )}

      {screen === 'lobby' && (
        <LobbyScreen
          lobbySize={lobbySize}
          mode={platformCapabilities.onlineMultiplayerEnabled ? mode : mode === 'multiplayer' ? 'royale' : mode}
          playerName={playerName}
          playerRegion={playerRegion}
          bestScore={bestScore}
          leaderboard={leaderboard}
          globalLeaderboard={globalLeaderboard}
          globalLeaderboardLoading={globalLeaderboardLoading}
          globalLeaderboardUnavailable={globalLeaderboardUnavailable}
          globalLeaderboardError={globalLeaderboardError}
          onlineLeaderboardAvailable={onlineLeaderboardAvailable}
          onlineMultiplayerAvailable={onlineMultiplayerAvailable}
          globalRegionFilter={globalRegionFilter}
          globalSort={globalSort}
          epilogueUnlocked={epilogueUnlocked}
          settings={settings}
          mpSnapshot={mpSnapshot}
          onSelectLobbySize={setLobbySize}
          onSelectMode={setMode}
          onChangePlayerName={handlePlayerNameChange}
          onChangePlayerRegion={handlePlayerRegionChange}
          onSelectGlobalRegionFilter={setGlobalRegionFilter}
          onSelectGlobalSort={setGlobalSort}
          onRefreshGlobalLeaderboard={() => refreshGlobalLeaderboard(globalRegionFilter, globalSort)}
          onClearLeaderboard={handleClearLeaderboard}
          onUpdateSettings={handleUpdateSettings}
          onStartMatch={handleStartMatch}
          onOpenComic={handleOpenComic}
          onOpenCodex={handleOpenCodex}
          onReturnToTitle={() => setScreen('title')}
        />
      )}

      {screen === 'playing' && (
        <div className="w-full h-[100dvh] overflow-hidden">
          <GameViewport
            key={matchKey}
            lobbySize={lobbySize}
            mode={mode === 'tutorial' ? 'tutorial' : 'royale'}
            playerName={playerName}
            isMultiplayer={Boolean(activeMpSession)}
            multiplayerPlayerId={activeMpSession?.playerId ?? null}
            multiplayerMatchId={activeMpSession?.matchId ?? null}
            roomCode={activeMpSession?.roomCode ?? null}
            latencyMs={mpSnapshot.latencyMs}
            mpSnapshot={mpSnapshot}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onMatchFinished={handleMatchFinished}
            onExitToLobby={handleExitToLobby}
            onRestart={handleRematch}
          />
        </div>
      )}

      {screen === 'summary' && finalHud && (
        <PostMatchScreen
          hud={finalHud}
          replay={finalReplay}
          matchScore={lastMatchScore}
          bestScore={bestScore}
          leaderboardRank={lastLeaderboardRank}
          globalRankInfo={lastGlobalRank}
          leaderboardSaveState={leaderboardSaveState}
          onRetryLeaderboardSave={handleRetrySoloLeaderboardSave}
          isMultiplayer={Boolean(activeMpSession)}
          isMultiplayerHost={isMpHost}
          reducedMotion={settings.reducedMotion}
          onPlayAgain={handleRematch}
          onReturnLobby={handleReturnFromSummary}
          onOpenEpilogue={() => handleOpenComic(9)}
        />
      )}

      <ComicReaderModal
        open={comicOpen}
        epilogueUnlocked={epilogueUnlocked}
        initialPage={comicInitialPage}
        onClose={() => setComicOpen(false)}
      />

      <DesignCodexModal
        open={codexOpen}
        initialPlateId={codexPlateId}
        onClose={() => setCodexOpen(false)}
      />

      {exitPromptVisible && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 compendium-plaque rounded-[2px] px-4 py-2 text-xs font-medium text-[#f3e6c8] pointer-events-none"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          Press Back again to exit
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { ComicReaderModal } from './components/ComicReaderModal';
import { DesignCodexModal } from './components/DesignCodexModal';
import { GameViewport } from './components/GameViewport';
import { LobbyPlayMode, LobbyScreen } from './components/LobbyScreen';
import { PostMatchScreen } from './components/PostMatchScreen';
import { TitleScreen } from './components/TitleScreen';
import { RegionCode, RegionFilter } from './data/regions';
import { soundEngine } from './game/audio';
import { loadSavedSettings, saveSettings } from './game/settings';
import {
  clearTopSurvivalTimes,
  fetchGlobalLeaderboard,
  getSavedPlayerName,
  getSavedPlayerRegion,
  getTopSurvivalTimes,
  GlobalLeaderboardResponse,
  GlobalLeaderboardSort,
  recordKeliKingSurvivalTime,
  savePlayerName,
  savePlayerRegion,
  submitGlobalSurvivalTime,
  SurvivalLeaderboardEntry,
} from './game/leaderboard';
import { multiplayerClient, MultiplayerSnapshot } from './game/multiplayerClient';
import { MatchReplayData } from './game/replay';
import { spatialVoice } from './game/spatialVoice';
import { AccessibilitySettings, HudSnapshot, LobbySize } from './game/types';

type ScreenState = 'title' | 'lobby' | 'playing' | 'summary';

export default function App() {
  const [screen, setScreen] = useState<ScreenState>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('room')?.trim()) return 'lobby';
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
  const [playerName, setPlayerName] = useState<string>(() => getSavedPlayerName());
  const [playerRegion, setPlayerRegion] = useState<RegionCode>(() => getSavedPlayerRegion());
  const [leaderboard, setLeaderboard] = useState<SurvivalLeaderboardEntry[]>(() =>
    getTopSurvivalTimes()
  );
  const [lastLeaderboardRank, setLastLeaderboardRank] = useState<number | null>(null);
  const [globalLeaderboard, setGlobalLeaderboard] = useState<GlobalLeaderboardResponse | null>(
    null
  );
  const [globalLeaderboardLoading, setGlobalLeaderboardLoading] = useState<boolean>(true);
  const [globalLeaderboardError, setGlobalLeaderboardError] = useState<string | null>(null);
  const [globalRegionFilter, setGlobalRegionFilter] = useState<RegionFilter>('ALL');
  const [globalSort, setGlobalSort] = useState<GlobalLeaderboardSort>('longest');
  const [lastGlobalRank, setLastGlobalRank] = useState<{
    globalRank: number | null;
    regionalRank: number | null;
    region: RegionCode;
  } | null>(null);

  const [mpSnapshot, setMpSnapshot] = useState<MultiplayerSnapshot>(() =>
    multiplayerClient.getSnapshot()
  );
  const [activeMpSession, setActiveMpSession] = useState<{
    playerId: string;
    roomCode: string;
  } | null>(null);

  const [epilogueUnlocked, setEpilogueUnlocked] = useState<boolean>(() => {
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

  useEffect(() => {
    soundEngine.setMuted(settings.muted);
    soundEngine.setVolume(settings.volume);
    spatialVoice.setMasterMuted(settings.muted);
    spatialVoice.setVoiceVolume(settings.voiceVolume ?? 0.9);
    spatialVoice.setVoiceMode(settings.voiceMode ?? 'open');
  }, [
    settings.muted,
    settings.volume,
    settings.voiceVolume,
    settings.voiceMode,
  ]);

  useEffect(() => {
    spatialVoice.init();
    const unsubState = multiplayerClient.subscribe(setMpSnapshot);
    const unsubStart = multiplayerClient.onMatchStarted((info) => {
      setFinalHud(null);
      setFinalReplay(null);
      setLastLeaderboardRank(null);
      setLastGlobalRank(null);
      setActiveMpSession(info);
      setMode('multiplayer');
      setMatchKey((k) => k + 1);
      setScreen('playing');
    });

    multiplayerClient.connect();

    // Auto-join Basin if ?room=CODE is present in the URL
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room')?.trim().toUpperCase();
    let joinedInitial = false;
    const unsubWelcome = roomParam
      ? multiplayerClient.subscribe((snap) => {
          if (!joinedInitial && snap.status === 'connected' && !snap.currentRoom) {
            joinedInitial = true;
            setMode('multiplayer');
            multiplayerClient.joinRoom(roomParam, getSavedPlayerName());
          }
        })
      : () => {};

    return () => {
      unsubWelcome();
      unsubStart();
      unsubState();
    };
  }, []);

  const handleUpdateSettings = useCallback((patch: Partial<AccessibilitySettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const refreshGlobalLeaderboard = useCallback(
    async (regionFilter: RegionFilter = globalRegionFilter, sort: GlobalLeaderboardSort = globalSort) => {
      setGlobalLeaderboardLoading(true);
      setGlobalLeaderboardError(null);
      try {
        const data = await fetchGlobalLeaderboard(regionFilter, sort, 100);
        setGlobalLeaderboard(data);
      } catch (err) {
        setGlobalLeaderboardError(
          err instanceof Error ? err.message : 'Unable to reach global rankings service.'
        );
      } finally {
        setGlobalLeaderboardLoading(false);
      }
    },
    [globalRegionFilter, globalSort]
  );

  useEffect(() => {
    void refreshGlobalLeaderboard(globalRegionFilter, globalSort);
  }, [globalRegionFilter, globalSort, refreshGlobalLeaderboard]);

  const handlePlayerNameChange = useCallback((nextName: string) => {
    const saved = savePlayerName(nextName);
    setPlayerName(saved);
  }, []);

  const handlePlayerRegionChange = useCallback((nextRegion: RegionCode) => {
    const saved = savePlayerRegion(nextRegion);
    setPlayerRegion(saved);
  }, []);

  const handleClearLeaderboard = useCallback(() => {
    setLeaderboard(clearTopSurvivalTimes());
    setLastLeaderboardRank(null);
  }, []);

  const handleStartMatch = useCallback(() => {
    if (mode === 'multiplayer') return;
    setActiveMpSession(null);
    setFinalHud(null);
    setFinalReplay(null);
    setLastLeaderboardRank(null);
    setLastGlobalRank(null);
    setMatchKey((k) => k + 1);
    setScreen('playing');
  }, [mode]);

  const handleMatchFinished = useCallback(
    (snap: HudSnapshot, replayData: MatchReplayData) => {
      setFinalHud(snap);
      setFinalReplay(replayData);
      if (snap.matchResult.status === 'victory') {
        setEpilogueUnlocked(true);
        try {
          localStorage.setItem('awang_keli_epilogue', '1');
        } catch {
          // Ignore storage errors
        }
        const result = recordKeliKingSurvivalTime(snap, playerName);
        setLeaderboard(result.entries);
        setLastLeaderboardRank(result.rank);
      } else {
        setLastLeaderboardRank(null);
      }

      if (snap.mode !== 'tutorial' && snap.matchResult.survivalTime >= 1) {
        const subId = `run-${matchKey}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        void submitGlobalSurvivalTime(
          snap,
          playerName,
          playerRegion,
          Boolean(activeMpSession),
          subId
        ).then((res) => {
          if (res) {
            setLastGlobalRank({
              globalRank: res.globalRank,
              regionalRank: res.regionalRank,
              region: res.entry.region,
            });
            void refreshGlobalLeaderboard(globalRegionFilter, globalSort);
          }
        });
      } else {
        setLastGlobalRank(null);
      }

      setScreen('summary');
    },
    [
      activeMpSession,
      globalRegionFilter,
      globalSort,
      matchKey,
      playerName,
      playerRegion,
      refreshGlobalLeaderboard,
    ]
  );

  const handleExitToLobby = useCallback(() => {
    if (activeMpSession) {
      multiplayerClient.leaveRoom();
      setActiveMpSession(null);
    }
    setScreen('lobby');
  }, [activeMpSession]);

  const handleReturnFromSummary = useCallback(() => {
    // Keep player inside their Basin Room if still connected, so they can rematch or chat
    setActiveMpSession(null);
    setScreen('lobby');
  }, []);

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

  const isMpHost = Boolean(
    mpSnapshot.currentRoom && mpSnapshot.currentRoom.hostId === mpSnapshot.clientId
  );

  return (
    <div className="w-full min-h-screen bg-[#0c141a]">
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
          mode={mode}
          playerName={playerName}
          playerRegion={playerRegion}
          leaderboard={leaderboard}
          globalLeaderboard={globalLeaderboard}
          globalLeaderboardLoading={globalLeaderboardLoading}
          globalLeaderboardError={globalLeaderboardError}
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
        <div className="w-full h-screen">
          <GameViewport
            key={matchKey}
            lobbySize={lobbySize}
            mode={mode === 'tutorial' ? 'tutorial' : 'royale'}
            playerName={playerName}
            isMultiplayer={Boolean(activeMpSession)}
            multiplayerPlayerId={activeMpSession?.playerId ?? null}
            roomCode={activeMpSession?.roomCode ?? null}
            latencyMs={mpSnapshot.latencyMs}
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
          leaderboardRank={lastLeaderboardRank}
          globalRankInfo={lastGlobalRank}
          isMultiplayer={Boolean(activeMpSession)}
          isMultiplayerHost={isMpHost}
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
    </div>
  );
}

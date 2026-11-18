import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Check,
  Clock,
  Copy,
  Crown,
  Globe,
  LogOut,
  MapPin,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  ScrollText,
  Send,
  Trash2,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { EVOLUTION_MILESTONES } from '../data/abilities';
import { getRegionInfo, REGIONS, RegionCode, RegionFilter } from '../data/regions';
import { ZONE_METADATA } from '../game/arena';
import {
  DEFAULT_PLAYER_NAME,
  formatSurvivalDuration,
  GlobalLeaderboardResponse,
  GlobalLeaderboardSort,
  LeaderboardSortOrder,
  sortSurvivalEntries,
  SurvivalLeaderboardEntry,
} from '../game/leaderboard';
import { multiplayerClient, MultiplayerSnapshot } from '../game/multiplayerClient';
import { spatialVoice, SpatialVoiceSnapshot } from '../game/spatialVoice';
import { AccessibilitySettings, LobbySize, MatchMode } from '../game/types';
import { DESIGN_PLATES } from './DesignCodexModal';

export type LobbyPlayMode = MatchMode | 'multiplayer';

interface LobbyScreenProps {
  lobbySize: LobbySize;
  mode: LobbyPlayMode;
  playerName: string;
  playerRegion: RegionCode;
  leaderboard: SurvivalLeaderboardEntry[];
  globalLeaderboard: GlobalLeaderboardResponse | null;
  globalLeaderboardLoading: boolean;
  globalLeaderboardError: string | null;
  globalRegionFilter: RegionFilter;
  globalSort: GlobalLeaderboardSort;
  epilogueUnlocked: boolean;
  settings: AccessibilitySettings;
  mpSnapshot: MultiplayerSnapshot;
  onSelectLobbySize: (n: LobbySize) => void;
  onSelectMode: (m: LobbyPlayMode) => void;
  onChangePlayerName: (name: string) => void;
  onChangePlayerRegion: (region: RegionCode) => void;
  onSelectGlobalRegionFilter: (region: RegionFilter) => void;
  onSelectGlobalSort: (sort: GlobalLeaderboardSort) => void;
  onRefreshGlobalLeaderboard: () => void;
  onClearLeaderboard: () => void;
  onUpdateSettings: (patch: Partial<AccessibilitySettings>) => void;
  onStartMatch: () => void;
  onOpenComic: (page?: number) => void;
  onOpenCodex: (plateId?: string) => void;
}

const LOBBY_SIZES: LobbySize[] = [5, 10, 20, 25, 50, 100];

const HERO_ART = '/assets/aistudio/ChatGPT_Image_Nov_17__2026__03_53_25_PM_036eb1d0.png';
const LINEUP_ART = '/assets/aistudio/ChatGPT_Image_Nov_17__2026__03_53_55_PM_8cc3d559.png';

function formatRecordedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  lobbySize,
  mode,
  playerName,
  playerRegion,
  leaderboard,
  globalLeaderboard,
  globalLeaderboardLoading,
  globalLeaderboardError,
  globalRegionFilter,
  globalSort,
  epilogueUnlocked,
  settings,
  mpSnapshot,
  onSelectLobbySize,
  onSelectMode,
  onChangePlayerName,
  onChangePlayerRegion,
  onSelectGlobalRegionFilter,
  onSelectGlobalSort,
  onRefreshGlobalLeaderboard,
  onClearLeaderboard,
  onUpdateSettings,
  onStartMatch,
  onOpenComic,
  onOpenCodex,
}) => {
  const [nameDraft, setNameDraft] = useState(playerName);
  const [boardScope, setBoardScope] = useState<'global' | 'local'>('global');
  const [sortOrder, setSortOrder] = useState<LeaderboardSortOrder>('longest');
  const [confirmClear, setConfirmClear] = useState(false);
  const [joinCodeDraft, setJoinCodeDraft] = useState('');
  const [fillWithBots, setFillWithBots] = useState(true);
  const [chatDraft, setChatDraft] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [voiceSnap, setVoiceSnap] = useState<SpatialVoiceSnapshot>(() =>
    spatialVoice.getSnapshot()
  );

  useEffect(() => {
    return spatialVoice.subscribe(setVoiceSnap);
  }, []);

  useEffect(() => {
    setNameDraft(playerName);
  }, [playerName]);

  const commitName = () => {
    const trimmed = nameDraft.trim() || DEFAULT_PLAYER_NAME;
    onChangePlayerName(trimmed);
    return trimmed;
  };

  const commitNameAndStart = () => {
    const cleanName = commitName();
    if (mode === 'multiplayer') {
      if (mpSnapshot.currentRoom) {
        if (mpSnapshot.currentRoom.hostId === mpSnapshot.clientId) {
          multiplayerClient.startRoomMatch();
        }
      } else {
        multiplayerClient.createRoom(cleanName, lobbySize, fillWithBots);
      }
      return;
    }
    onStartMatch();
  };

  const handleCopyInvite = async (code: string) => {
    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      setCopiedCode(false);
    }
  };

  const currentRoom = mpSnapshot.currentRoom;
  const isHost = Boolean(currentRoom && currentRoom.hostId === mpSnapshot.clientId);
  const localParticipant = currentRoom?.participants.find(
    (p) => p.id === mpSnapshot.clientId
  );

  const sortedLeaderboard = sortSurvivalEntries(leaderboard, sortOrder);

  const baseFrag = Math.floor(100 / lobbySize);
  const remFrag = 100 % lobbySize;
  const distText =
    remFrag === 0
      ? `${lobbySize} entrants · ${baseFrag} fragments each`
      : `${lobbySize} entrants · ${remFrag} at Lv.${baseFrag + 1}, ${lobbySize - remFrag} at Lv.${baseFrag}`;

  return (
    <div className="min-h-screen bg-[#0c141a] text-[#e6e4dd] flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-20 border-b border-[#5b4724] bg-[#0b1218]/95 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-xl font-semibold tracking-tight text-[#f7f2e7] whitespace-nowrap shrink-0"
          >
            Awang Keli
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#b5c2c9]">
            <a href="#leaderboard" className="hover:text-[#f3d285] transition-colors whitespace-nowrap shrink-0">
              Leaderboard
            </a>
            <a href="#arena" className="hover:text-[#f3d285] transition-colors whitespace-nowrap shrink-0">
              Arena
            </a>
            <a href="#evolution" className="hover:text-[#f3d285] transition-colors whitespace-nowrap shrink-0">
              Evolution
            </a>
            <button
              type="button"
              onClick={() => onOpenCodex('bestiary-1')}
              className="hover:text-[#f3d285] transition-colors whitespace-nowrap shrink-0"
            >
              Bestiary
            </button>
            <button
              type="button"
              onClick={() => onOpenComic(1)}
              className="hover:text-[#f3d285] transition-colors whitespace-nowrap shrink-0"
            >
              Lore Comic
            </button>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={commitNameAndStart}
              className="px-4 py-2 text-xs font-semibold rounded border border-[#f3d285]/40 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] transition-colors whitespace-nowrap shrink-0"
            >
              {mode === 'multiplayer'
                ? currentRoom
                  ? isHost
                    ? 'Launch Basin'
                    : 'In Basin'
                  : 'Host Basin'
                : 'Enter Basin'}
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 sm:py-12 space-y-14">
        {/* Hero Split */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-5 flex flex-col justify-between space-y-6">
            <div className="space-y-3.5">
              <div className="text-xs font-medium text-[#d9b25f]">
                Wang Kelian, Perlis · 2.5D Survival-Evolution Battle Royale
              </div>
              <h1 className="font-display text-4xl sm:text-5xl font-semibold text-[#f7f2e7] leading-tight text-balance">
                100 Keli. One Body. One King.
              </h1>
              <p className="text-sm sm:text-[15px] text-[#b8c4bf] leading-relaxed">
                Stalk rivals through submerged palong gates, glowing limestone caverns, and lakeside jetties. Every fragment claimed reshapes your body from aquatic fry to the amphibious Keli King.
              </p>
            </div>

            {/* Ornate Brass-Framed Match Setup Panel */}
            <div className="compendium-plaque rounded-sm overflow-hidden">
              <div className="compendium-ribbon flex items-center justify-between px-4 py-2">
                <span className="text-xs font-display font-semibold text-[#f3d285]">
                  ◆ Basin Deployment
                </span>
                <span className="text-[10.5px] font-mono-num text-[#9cb0ba]">
                  100 Fragments
                </span>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="player-callsign" className="text-xs font-medium text-[#d9b25f] shrink-0">
                    Keli Name
                  </label>
                  <input
                    id="player-callsign"
                    type="text"
                    value={nameDraft}
                    maxLength={18}
                    placeholder={DEFAULT_PLAYER_NAME}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => onChangePlayerName(nameDraft)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onChangePlayerName(nameDraft);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-48 px-3 py-1.5 text-xs font-medium rounded-[2px] border border-[#4e3d21] bg-[#0b1218] text-[#f7f2e7] placeholder-[#5a6c75] focus:outline-none focus:border-[#c99c4a]"
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="player-region" className="text-xs font-medium text-[#d9b25f] shrink-0">
                    Region
                  </label>
                  <select
                    id="player-region"
                    value={playerRegion}
                    onChange={(e) => onChangePlayerRegion(e.target.value as RegionCode)}
                    className="w-48 px-2.5 py-1.5 text-xs font-medium rounded-[2px] border border-[#4e3d21] bg-[#0b1218] text-[#f7f2e7] focus:outline-none focus:border-[#c99c4a]"
                  >
                    {REGIONS.map((reg) => (
                      <option key={reg.code} value={reg.code}>
                        {reg.shortLabel} · {reg.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-[#d9b25f] shrink-0">Mode</span>
                  <div className="compendium-track flex items-center gap-1 p-1 rounded-[2px]">
                    <button
                      type="button"
                      onClick={() => onSelectMode('royale')}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-[2px] transition-colors whitespace-nowrap ${
                        mode === 'royale'
                          ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                          : 'text-[#a9b9c2] hover:text-white'
                      }`}
                    >
                      Solo Royale
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectMode('multiplayer')}
                      className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-[2px] transition-colors whitespace-nowrap ${
                        mode === 'multiplayer'
                          ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                          : 'text-[#a9b9c2] hover:text-white'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      Multiplayer
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectMode('tutorial')}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-[2px] transition-colors whitespace-nowrap ${
                        mode === 'tutorial'
                          ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                          : 'text-[#a9b9c2] hover:text-white'
                      }`}
                    >
                      Guide
                    </button>
                  </div>
                </div>

                {mode === 'royale' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[#a9b9c2]">Combatants</span>
                      <span className="font-mono-num text-[#f3d285]">{distText}</span>
                    </div>
                    <div className="grid grid-cols-6 gap-1.5">
                      {LOBBY_SIZES.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => onSelectLobbySize(n)}
                          className={`py-2 text-xs font-mono-num font-semibold rounded-[2px] border transition-colors ${
                            lobbySize === n
                              ? 'border-[#f3d285] bg-[#c99c4a] text-[#0b1218]'
                              : 'border-[#3d311d] bg-[#0b1218] text-[#d6d3c9] hover:border-[#c99c4a]'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {mode === 'multiplayer' && (
                  <div className="space-y-3 pt-1 border-t border-[#22313d]">
                    <div className="flex items-center justify-between text-[11px] font-mono-num">
                      <span className="text-[#9cb0ba]">
                        Server:{' '}
                        <span
                          className={
                            mpSnapshot.status === 'connected'
                              ? 'text-[#4ade80] font-semibold'
                              : 'text-[#fbbf24]'
                          }
                        >
                          {mpSnapshot.status === 'connected'
                            ? `Online${mpSnapshot.latencyMs !== null ? ` · ${mpSnapshot.latencyMs}ms` : ''}`
                            : mpSnapshot.status}
                        </span>
                      </span>
                      {!currentRoom && (
                        <button
                          type="button"
                          onClick={() => multiplayerClient.refreshRooms()}
                          className="inline-flex items-center gap-1 text-[#f3d285] hover:underline"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Refresh
                        </button>
                      )}
                    </div>

                    {mpSnapshot.error && (
                      <div className="px-2.5 py-1.5 rounded-[2px] border border-[#ef4444]/60 bg-[#3b1216]/90 text-[11px] text-[#fecaca] flex items-center justify-between gap-2">
                        <span>{mpSnapshot.error}</span>
                        <button
                          type="button"
                          onClick={() => multiplayerClient.clearError()}
                          className="text-[#fca5a5] hover:text-white font-semibold"
                        >
                          ×
                        </button>
                      </div>
                    )}

                    {!currentRoom ? (
                      <>
                        {/* Host Configuration */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-[#a9b9c2]">Max Combatants</span>
                            <label className="flex items-center gap-1.5 text-[11px] text-[#d6d3c9] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={fillWithBots}
                                onChange={(e) => setFillWithBots(e.target.checked)}
                                className="accent-[#c99c4a] w-3.5 h-3.5"
                              />
                              AI Bot Backfill
                            </label>
                          </div>
                          <div className="grid grid-cols-6 gap-1.5">
                            {LOBBY_SIZES.map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => onSelectLobbySize(n)}
                                className={`py-1.5 text-xs font-mono-num font-semibold rounded-[2px] border transition-colors ${
                                  lobbySize === n
                                    ? 'border-[#f3d285] bg-[#c99c4a] text-[#0b1218]'
                                    : 'border-[#3d311d] bg-[#0b1218] text-[#d6d3c9] hover:border-[#c99c4a]'
                                }`}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Join by Basin Code */}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={joinCodeDraft}
                            maxLength={8}
                            placeholder="Basin Code (e.g. WK842)"
                            onChange={(e) => setJoinCodeDraft(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && joinCodeDraft.trim()) {
                                const clean = commitName();
                                multiplayerClient.joinRoom(joinCodeDraft.trim(), clean);
                              }
                            }}
                            className="flex-1 px-2.5 py-1.5 text-xs font-mono-num uppercase rounded-[2px] border border-[#4e3d21] bg-[#0b1218] text-[#f7f2e7] placeholder-[#5a6c75] focus:outline-none focus:border-[#c99c4a]"
                          />
                          <button
                            type="button"
                            disabled={!joinCodeDraft.trim() || mpSnapshot.status !== 'connected'}
                            onClick={() => {
                              const clean = commitName();
                              multiplayerClient.joinRoom(joinCodeDraft.trim(), clean);
                            }}
                            className="px-3 py-1.5 text-xs font-semibold rounded-[2px] border border-[#5b4724] bg-[#142029] text-[#f3d285] hover:border-[#c99c4a] disabled:opacity-45"
                          >
                            Join Code
                          </button>
                        </div>

                        {/* Live Open Basins List */}
                        <div className="compendium-track rounded-[2px] p-2 max-h-32 overflow-y-auto space-y-1.5">
                          <div className="text-[10.5px] font-mono-num text-[#9cb0ba] px-1">
                            Open Basins ({mpSnapshot.rooms.length})
                          </div>
                          {mpSnapshot.rooms.length === 0 ? (
                            <div className="text-[11px] text-[#7c8f99] px-1 py-2">
                              No open basins yet. Host one below or enter a shared Basin Code.
                            </div>
                          ) : (
                            mpSnapshot.rooms.map((rm) => (
                              <div
                                key={rm.code}
                                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-[2px] bg-[#0e171f] border border-[#2a3b47]"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-[#f7f2e7] truncate">
                                    {rm.name}
                                  </div>
                                  <div className="text-[10px] font-mono-num text-[#9cb0ba]">
                                    {rm.code} · {rm.humanCount}/{rm.lobbySize} Kelis ·{' '}
                                    {rm.status === 'playing' ? 'In Match' : 'Staging'}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={rm.status === 'playing'}
                                  onClick={() => {
                                    const clean = commitName();
                                    multiplayerClient.joinRoom(rm.code, clean);
                                  }}
                                  className="px-2.5 py-1 text-[11px] font-semibold rounded-[2px] bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] disabled:opacity-40 shrink-0"
                                >
                                  {rm.status === 'playing' ? 'Live' : 'Join'}
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    ) : (
                      /* Active Joined Basin Staging Area */
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2 bg-[#0b1218] border border-[#4e3d21] rounded-[2px] px-3 py-2">
                          <div>
                            <div className="text-[10px] font-mono-num text-[#9cb0ba]">
                              BASIN CODE
                            </div>
                            <div className="font-mono-num text-base font-bold tracking-wider text-[#f3d285]">
                              {currentRoom.code}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyInvite(currentRoom.code)}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-[2px] border border-[#5b4724] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a]"
                            >
                              {copiedCode ? <Check className="w-3.5 h-3.5 text-[#4ade80]" /> : <Copy className="w-3.5 h-3.5" />}
                              {copiedCode ? 'Copied' : 'Invite'}
                            </button>
                            <button
                              type="button"
                              onClick={() => multiplayerClient.leaveRoom()}
                              className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-[2px] border border-[#3d2626] bg-[#1a0f12] text-[#fca5a5] hover:border-[#ef4444]"
                              title="Leave Basin"
                            >
                              <LogOut className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {isHost && (
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <div className="flex items-center gap-1">
                              {LOBBY_SIZES.map((n) => (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => multiplayerClient.updateRoomConfig(n, undefined)}
                                  className={`px-1.5 py-1 font-mono-num rounded-[2px] border ${
                                    currentRoom.lobbySize === n
                                      ? 'border-[#f3d285] bg-[#c99c4a] text-[#0b1218] font-bold'
                                      : 'border-[#2d404d] bg-[#0b1218] text-[#b5c2c9]'
                                  }`}
                                >
                                  {n}
                                </button>
                              ))}
                            </div>
                            <label className="flex items-center gap-1 text-[#d6d3c9] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={currentRoom.fillWithBots}
                                onChange={(e) =>
                                  multiplayerClient.updateRoomConfig(undefined, e.target.checked)
                                }
                                className="accent-[#c99c4a] w-3.5 h-3.5"
                              />
                              AI Fill
                            </label>
                          </div>
                        )}

                        {/* Roster */}
                        <div className="compendium-track rounded-[2px] p-2 max-h-28 overflow-y-auto space-y-1">
                          {currentRoom.participants.map((pt) => {
                            const peerVoice = voiceSnap.peers.find((vp) => vp.id === pt.id);
                            const isSelf = pt.id === mpSnapshot.clientId;
                            const isVoiceOn = isSelf ? voiceSnap.micEnabled : Boolean(pt.voiceEnabled);
                            const isMuted = isSelf ? voiceSnap.micMuted : Boolean(pt.voiceMuted);
                            const isSpeaking = isSelf
                              ? voiceSnap.localSpeaking
                              : Boolean(peerVoice?.speaking);
                            return (
                              <div
                                key={pt.id}
                                className="flex items-center justify-between text-xs px-1.5 py-1 rounded-[2px] bg-[#0e171f]"
                              >
                                <span className="flex items-center gap-1.5 text-[#f7f2e7] truncate">
                                  {pt.isHost && <Crown className="w-3.5 h-3.5 text-[#f3d285] shrink-0" />}
                                  <span className="truncate">{pt.name}</span>
                                  {isSelf && (
                                    <span className="text-[10px] text-[#7dd3fc]">(You)</span>
                                  )}
                                </span>
                                <span className="flex items-center gap-2 shrink-0">
                                  {isVoiceOn && (
                                    <span
                                      className={`inline-flex items-center gap-1 text-[10px] font-mono-num ${
                                        isMuted
                                          ? 'text-[#f87171]'
                                          : isSpeaking
                                            ? 'text-[#4ade80] font-semibold'
                                            : 'text-[#7dd3fc]'
                                      }`}
                                      title={
                                        isMuted
                                          ? 'Microphone muted'
                                          : isSpeaking
                                            ? 'Speaking'
                                            : 'Proximity voice connected'
                                      }
                                    >
                                      {isMuted ? (
                                        <MicOff className="w-3 h-3" />
                                      ) : (
                                        <Mic className="w-3 h-3" />
                                      )}
                                    </span>
                                  )}
                                  <span
                                    className={`text-[10.5px] font-mono-num ${
                                      pt.isHost
                                        ? 'text-[#f3d285]'
                                        : pt.ready
                                        ? 'text-[#4ade80]'
                                        : 'text-[#9cb0ba]'
                                    }`}
                                  >
                                    {pt.isHost ? 'HOST' : pt.ready ? 'READY' : 'WAITING'}
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                          {currentRoom.fillWithBots && (
                            <div className="text-[10.5px] font-mono-num text-[#9cb0ba] px-1.5 pt-0.5">
                              +{Math.max(0, currentRoom.lobbySize - currentRoom.participants.length)} AI Kelis · 100 fragments total
                            </div>
                          )}
                        </div>

                        {/* Hardware Proximity Voice Controls */}
                        <div className="compendium-track rounded-[2px] p-2 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-[#d6d3c9] flex items-center gap-1.5">
                              {voiceSnap.micEnabled && !voiceSnap.micMuted ? (
                                <Mic className="w-3.5 h-3.5 text-[#4ade80]" />
                              ) : (
                                <MicOff className="w-3.5 h-3.5 text-[#9cb0ba]" />
                              )}
                              Spatial Proximity Mic
                            </span>

                            <div className="flex items-center gap-1.5">
                              {voiceSnap.micEnabled && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUpdateSettings({
                                        voiceMode: voiceSnap.voiceMode === 'open' ? 'ptt' : 'open',
                                      })
                                    }
                                    className="px-2 py-0.5 text-[10px] font-mono-num rounded-[2px] border border-[#3d311d] bg-[#0b1218] text-[#d9b25f] hover:border-[#c99c4a]"
                                    title="Switch between Open Mic and Push-to-Talk (V)"
                                  >
                                    {voiceSnap.voiceMode === 'open' ? 'Open' : 'PTT [V]'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => spatialVoice.setMicMuted(!voiceSnap.micMuted)}
                                    className={`px-2 py-0.5 text-[10px] font-semibold rounded-[2px] border transition-colors ${
                                      voiceSnap.micMuted
                                        ? 'border-[#ef4444]/60 bg-[#3b1216] text-[#fecaca]'
                                        : 'border-[#4ade80]/50 bg-[#122e20] text-[#bbf7d0]'
                                    }`}
                                  >
                                    {voiceSnap.micMuted ? 'Muted' : 'Live'}
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                disabled={voiceSnap.permission === 'prompting'}
                                onClick={() => {
                                  spatialVoice.unlockAudioContext();
                                  if (voiceSnap.micEnabled) spatialVoice.disableMic();
                                  else void spatialVoice.enableMic();
                                }}
                                className={`px-2.5 py-1 text-[10.5px] font-semibold rounded-[2px] border transition-colors whitespace-nowrap ${
                                  voiceSnap.micEnabled
                                    ? 'border-[#5b4724] bg-[#142029] text-[#f3e6c8] hover:border-[#ef4444]'
                                    : 'border-[#c99c4a] bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f]'
                                }`}
                              >
                                {voiceSnap.permission === 'prompting'
                                  ? 'Allowing...'
                                  : voiceSnap.micEnabled
                                    ? 'Mic Off'
                                    : 'Enable Mic'}
                              </button>
                            </div>
                          </div>

                          {voiceSnap.micEnabled && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-[1px] bg-[#091015] overflow-hidden">
                                <div
                                  className="h-full transition-all duration-75"
                                  style={{
                                    width: `${Math.min(100, Math.round(voiceSnap.localMicLevel * 100))}%`,
                                    background: voiceSnap.localSpeaking ? '#4ade80' : '#38bdf8',
                                  }}
                                />
                              </div>
                              <span className="text-[10px] font-mono-num text-[#9cb0ba] shrink-0">
                                Basin range: 1,150u in match
                              </span>
                            </div>
                          )}

                          {voiceSnap.error && (
                            <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-[2px] border border-[#ef4444]/50 bg-[#3b1216]/80 text-[10.5px] text-[#fecaca]">
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
                        </div>

                        {/* Basin Chat */}
                        <div className="compendium-track rounded-[2px] p-2 space-y-1.5">
                          <div className="max-h-20 overflow-y-auto space-y-1 text-[11px]">
                            {currentRoom.chat.map((c) => (
                              <div key={c.id} className="leading-snug">
                                <span
                                  className={
                                    c.system
                                      ? 'text-[#d9b25f] font-medium'
                                      : 'text-[#7dd3fc] font-semibold'
                                  }
                                >
                                  {c.system ? '◆ ' : `${c.senderName}: `}
                                </span>
                                <span className={c.system ? 'text-[#a9b9c2]' : 'text-[#e6e4dd]'}>
                                  {c.text}
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={chatDraft}
                              maxLength={140}
                              placeholder="Message basin..."
                              onChange={(e) => setChatDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && chatDraft.trim()) {
                                  multiplayerClient.sendChat(chatDraft);
                                  setChatDraft('');
                                }
                              }}
                              className="flex-1 px-2 py-1 text-xs rounded-[2px] border border-[#3d311d] bg-[#0b1218] text-[#f7f2e7] placeholder-[#5a6c75] focus:outline-none focus:border-[#c99c4a]"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (!chatDraft.trim()) return;
                                multiplayerClient.sendChat(chatDraft);
                                setChatDraft('');
                              }}
                              className="p-1.5 rounded-[2px] border border-[#5b4724] bg-[#142029] text-[#f3d285] hover:border-[#c99c4a]"
                              aria-label="Send message"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  {mode === 'multiplayer' ? (
                    !currentRoom ? (
                      <button
                        type="button"
                        disabled={mpSnapshot.status !== 'connected'}
                        onClick={commitNameAndStart}
                        className="flex-1 flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-[2px] border border-[#f3d285]/40 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] disabled:opacity-45 transition-colors whitespace-nowrap"
                      >
                        <Users className="w-4 h-4" />
                        Host {lobbySize}-Keli Basin
                      </button>
                    ) : currentRoom.status === 'playing' ? (
                      <button
                        type="button"
                        disabled
                        className="flex-1 flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-[2px] border border-[#2d404d] bg-[#101a22] text-[#9cb0ba] opacity-75 whitespace-nowrap"
                      >
                        <Play className="w-4 h-4" />
                        Match In Progress...
                      </button>
                    ) : isHost ? (
                      <button
                        type="button"
                        onClick={() => multiplayerClient.startRoomMatch()}
                        className="flex-1 flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-[2px] border border-[#f3d285]/40 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] transition-colors whitespace-nowrap"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        Launch Match ({currentRoom.participants.length} Humans)
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => multiplayerClient.setReady(!localParticipant?.ready)}
                        className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-[2px] border transition-colors whitespace-nowrap ${
                          localParticipant?.ready
                            ? 'border-[#4ade80] bg-[#143524] text-[#bbf7d0]'
                            : 'border-[#f3d285]/40 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f]'
                        }`}
                      >
                        <Check className="w-4 h-4" />
                        {localParticipant?.ready ? 'Ready · Waiting for Host' : 'Mark Ready'}
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={commitNameAndStart}
                      className="flex-1 flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-[2px] border border-[#f3d285]/40 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] transition-colors whitespace-nowrap"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      {mode === 'tutorial' ? 'Start Guided First Match' : `Start ${lobbySize}-Keli Match`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenComic(1)}
                    className="flex items-center gap-1.5 px-3.5 py-3 text-xs font-medium rounded-[2px] border border-[#5b4724] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a] transition-colors whitespace-nowrap"
                  >
                    <BookOpen className="w-4 h-4 text-[#d9b25f]" />
                    Comic
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenCodex('overview')}
                    className="flex items-center gap-1.5 px-3.5 py-3 text-xs font-medium rounded-[2px] border border-[#5b4724] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a] transition-colors whitespace-nowrap"
                  >
                    <ScrollText className="w-4 h-4 text-[#d9b25f]" />
                    Bestiary
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Official 2.5D Concept Art Stage */}
          <div className="lg:col-span-7 flex flex-col">
            <div className="compendium-plaque relative flex-1 min-h-[280px] rounded-sm overflow-hidden">
              <img
                src={HERO_ART}
                alt="Awang Keli 2.5D lakeside gameplay concept view at Wang Kelian"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0b1218]/95 via-[#0b1218]/70 to-transparent px-4 py-3 flex items-center justify-between gap-4 border-t border-[#4e3d21]/60">
                <span className="text-xs text-[#e6dfd0]">
                  Elevated 2.5D arena · Directional sprites · Glowing cavern & wooden jetty
                </span>
                <button
                  type="button"
                  onClick={() => onOpenCodex('gameplay')}
                  className="text-xs font-medium text-[#f3d285] hover:underline whitespace-nowrap shrink-0"
                >
                  Inspect Plate
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-[#9cb0ba] mt-2.5 px-1">
              <span>100-fragment mass conservation · 4 amphibious forms</span>
              <span className="font-mono-num text-[#d9b25f]">
                {epilogueUnlocked ? 'Epilogue 08/08 Unlocked' : 'Comic Pages 01–07 Open'}
              </span>
            </div>
          </div>
        </section>

        {/* Global Top 100 Survival Times & Regional Rankings */}
        <section id="leaderboard" className="space-y-4 pt-4 border-t border-[#1e2d38]">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                {boardScope === 'global' ? (
                  <Globe className="w-5 h-5 text-[#f3d285]" />
                ) : (
                  <Crown className="w-5 h-5 text-[#f3d285]" />
                )}
                <h2 className="font-display text-2xl font-semibold text-[#f7f2e7]">
                  {boardScope === 'global'
                    ? 'Global Top 100 Survival Times'
                    : 'Local Top 10 Keli King Records'}
                </h2>
              </div>
              <p className="text-sm text-[#9cb0ba] mt-0.5">
                {boardScope === 'global'
                  ? `Compete for global and regional rankings as ${playerName} (${getRegionInfo(playerRegion).shortLabel} · ${getRegionInfo(playerRegion).name}).`
                  : 'Local hall of fame tracking how long players survived before reaching Keli King (Lv.100) status.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Scope Switcher: Global Top 100 vs Local Top 10 */}
              <div className="flex items-center gap-1 p-1 rounded-[2px] bg-[#0b1218] border border-[#2a3b47]">
                <button
                  type="button"
                  onClick={() => setBoardScope('global')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-[2px] transition-colors whitespace-nowrap shrink-0 ${
                    boardScope === 'global'
                      ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                      : 'text-[#a9b9c2] hover:text-white'
                  }`}
                >
                  Global Top 100
                </button>
                <button
                  type="button"
                  onClick={() => setBoardScope('local')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-[2px] transition-colors whitespace-nowrap shrink-0 ${
                    boardScope === 'local'
                      ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                      : 'text-[#a9b9c2] hover:text-white'
                  }`}
                >
                  Local Top 10
                </button>
              </div>

              {boardScope === 'global' ? (
                <>
                  <div className="flex items-center gap-1 p-1 rounded-[2px] bg-[#0b1218] border border-[#2a3b47]">
                    {(
                      [
                        { id: 'longest', label: 'Longest' },
                        { id: 'fastest_king', label: 'Fastest King' },
                        { id: 'kills', label: 'Most Kills' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onSelectGlobalSort(opt.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-[2px] transition-colors whitespace-nowrap shrink-0 ${
                          globalSort === opt.id
                            ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                            : 'text-[#a9b9c2] hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={onRefreshGlobalLeaderboard}
                    disabled={globalLeaderboardLoading}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-[2px] border border-[#4a3c22] bg-[#101920] text-[#f3e6c8] hover:border-[#c99c4a] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${globalLeaderboardLoading ? 'animate-spin' : ''}`}
                    />
                    Refresh
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1 p-1 rounded-[2px] bg-[#0b1218] border border-[#2a3b47]">
                    <button
                      type="button"
                      onClick={() => setSortOrder('longest')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-[2px] transition-colors whitespace-nowrap shrink-0 ${
                        sortOrder === 'longest'
                          ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                          : 'text-[#a9b9c2] hover:text-white'
                      }`}
                    >
                      Longest
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortOrder('fastest')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-[2px] transition-colors whitespace-nowrap shrink-0 ${
                        sortOrder === 'fastest'
                          ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                          : 'text-[#a9b9c2] hover:text-white'
                      }`}
                    >
                      Fastest
                    </button>
                  </div>

                  {leaderboard.length > 0 && !confirmClear && (
                    <button
                      type="button"
                      onClick={() => setConfirmClear(true)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-[2px] border border-[#3a301e] bg-[#101920] text-[#9cb0ba] hover:border-[#b91c1c] hover:text-[#fca5a5] transition-colors whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear
                    </button>
                  )}

                  {leaderboard.length > 0 && confirmClear && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onClearLeaderboard();
                          setConfirmClear(false);
                        }}
                        className="px-2.5 py-1.5 text-xs font-semibold rounded-[2px] bg-[#991b1b] text-[#fee2e2] hover:bg-[#b91c1c] transition-colors whitespace-nowrap shrink-0"
                      >
                        Confirm Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClear(false)}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-[2px] border border-[#2a3b47] bg-[#0b1218] text-[#b5c2c9] hover:text-white transition-colors whitespace-nowrap shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {boardScope === 'global' ? (
            <div className="space-y-3">
              {/* Regional Standings Filter Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                <button
                  type="button"
                  onClick={() => onSelectGlobalRegionFilter('ALL')}
                  className={`text-left px-3 py-2.5 rounded-[2px] border transition-colors ${
                    globalRegionFilter === 'ALL'
                      ? 'border-[#c99c4a] bg-[#16232e]'
                      : 'border-[#253440] bg-[#0d161d] hover:border-[#5b4724]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 text-xs font-semibold text-[#f3d285] whitespace-nowrap">
                    <span>ALL · Global</span>
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                  </div>
                  <div className="font-mono-num text-sm font-semibold text-[#f7f2e7] mt-1">
                    {globalLeaderboard?.entries[0] && globalRegionFilter === 'ALL'
                      ? formatSurvivalDuration(globalLeaderboard.entries[0].survivalTime)
                      : globalLeaderboard?.regionSummary.reduce<number | null>(
                            (best, r) =>
                              r.topSurvivalTime !== null &&
                              (best === null || r.topSurvivalTime > best)
                                ? r.topSurvivalTime
                                : best,
                            null
                          ) !== null
                        ? formatSurvivalDuration(
                            globalLeaderboard?.regionSummary.reduce<number>(
                              (best, r) =>
                                r.topSurvivalTime !== null && r.topSurvivalTime > best
                                  ? r.topSurvivalTime
                                  : best,
                              0
                            ) ?? 0
                          )
                        : '—'}
                  </div>
                  <div className="text-[11px] font-mono-num text-[#9cb0ba] mt-0.5">
                    {globalLeaderboard?.totalGlobal ?? 0} ranked
                  </div>
                </button>

                {REGIONS.map((reg) => {
                  const summary = globalLeaderboard?.regionSummary.find(
                    (s) => s.region === reg.code
                  );
                  const isSelected = globalRegionFilter === reg.code;
                  const isOwnRegion = playerRegion === reg.code;
                  return (
                    <button
                      key={reg.code}
                      type="button"
                      onClick={() => onSelectGlobalRegionFilter(reg.code)}
                      className={`text-left px-3 py-2.5 rounded-[2px] border transition-colors ${
                        isSelected
                          ? 'border-[#c99c4a] bg-[#16232e]'
                          : 'border-[#253440] bg-[#0d161d] hover:border-[#5b4724]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 text-xs font-semibold whitespace-nowrap">
                        <span className={isSelected ? 'text-[#f3d285]' : 'text-[#e6e4dd]'}>
                          {reg.shortLabel}
                        </span>
                        {isOwnRegion && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[#7dd3fc]">
                            <MapPin className="w-2.5 h-2.5" />
                            You
                          </span>
                        )}
                      </div>
                      <div className="font-mono-num text-sm font-semibold text-[#f7f2e7] mt-1">
                        {summary?.topSurvivalTime !== null && summary?.topSurvivalTime !== undefined
                          ? formatSurvivalDuration(summary.topSurvivalTime)
                          : '—'}
                      </div>
                      <div className="text-[11px] font-mono-num text-[#9cb0ba] mt-0.5 truncate">
                        {summary?.count ?? 0} runs · {reg.name}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Global Top 100 Table */}
              <div className="compendium-plaque rounded-sm overflow-hidden">
                {globalLeaderboardError ? (
                  <div className="px-6 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-[#fca5a5]">
                        Unable to Load Global Rankings
                      </div>
                      <p className="text-xs text-[#9cb0ba] mt-1">{globalLeaderboardError}</p>
                    </div>
                    <button
                      type="button"
                      onClick={onRefreshGlobalLeaderboard}
                      className="px-4 py-2 text-xs font-semibold rounded-[2px] border border-[#5b4724] bg-[#142029] text-[#f3d285] hover:border-[#c99c4a] transition-colors whitespace-nowrap shrink-0"
                    >
                      Retry Fetch
                    </button>
                  </div>
                ) : globalLeaderboardLoading && !globalLeaderboard ? (
                  <div className="px-6 py-8 text-sm text-[#9cb0ba]">
                    Fetching global top 100 survival rankings...
                  </div>
                ) : !globalLeaderboard || globalLeaderboard.entries.length === 0 ? (
                  <div className="px-6 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-[2px] border border-[#4a3c22] bg-[#0b1218] text-[#d9b25f] shrink-0">
                        <Globe className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[#f7f2e7]">
                          {globalRegionFilter === 'ALL'
                            ? 'No Global Survival Records Yet'
                            : `No ${getRegionInfo(globalRegionFilter).name} (${globalRegionFilter}) Records Yet`}
                        </div>
                        <p className="text-xs text-[#9cb0ba] mt-1 max-w-xl leading-relaxed">
                          Complete a Solo Royale or Multiplayer match to submit your survival time to the global top 100 and claim the top spot for {getRegionInfo(playerRegion).name}.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={commitNameAndStart}
                      className="px-4 py-2 text-xs font-semibold rounded-[2px] bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] transition-colors whitespace-nowrap self-start sm:self-center shrink-0"
                    >
                      Claim #1 Record
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead className="bg-[#0b1218] text-xs text-[#9cb0ba] sticky top-0 z-10 border-b border-[#22313d]">
                        <tr>
                          <th className="py-3 px-4 font-medium whitespace-nowrap">
                            {globalRegionFilter === 'ALL' ? 'Global' : `${globalRegionFilter} Rank`}
                          </th>
                          <th className="py-3 px-4 font-medium">Player</th>
                          <th className="py-3 px-4 font-medium">Region</th>
                          <th className="py-3 px-4 font-medium">Survival Time</th>
                          <th className="py-3 px-4 font-medium">Peak Level</th>
                          <th className="py-3 px-4 font-medium">Eliminations</th>
                          <th className="py-3 px-4 font-medium">Format</th>
                          <th className="py-3 px-4 font-medium text-right">Recorded</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1a2630]">
                        {globalLeaderboard.entries.map((entry) => {
                          const displayRank =
                            globalRegionFilter === 'ALL' ? entry.globalRank : entry.regionalRank;
                          const rankColor =
                            displayRank === 1
                              ? 'text-[#f3d285]'
                              : displayRank === 2
                                ? 'text-[#d6d3c9]'
                                : displayRank === 3
                                  ? 'text-[#d49a6a]'
                                  : 'text-[#8ea0aa]';
                          const isOwnEntry =
                            entry.playerName === playerName && entry.region === playerRegion;
                          return (
                            <tr
                              key={entry.id}
                              className={
                                isOwnEntry
                                  ? 'bg-[#15242f] hover:bg-[#192b38]'
                                  : 'hover:bg-[#142029]'
                              }
                            >
                              <td className="py-2.5 px-4 font-mono-num whitespace-nowrap">
                                <span className={`font-semibold ${rankColor}`}>
                                  #{displayRank}
                                </span>
                                {globalRegionFilter === 'ALL' ? (
                                  <span className="ml-2 text-[11px] text-[#7c8f99]">
                                    #{entry.regionalRank} {entry.region}
                                  </span>
                                ) : (
                                  <span className="ml-2 text-[11px] text-[#7c8f99]">
                                    Global #{entry.globalRank}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 font-medium text-[#f7f2e7] whitespace-nowrap">
                                {entry.playerName}
                              </td>
                              <td className="py-2.5 px-4 font-mono-num text-xs text-[#7dd3fc] whitespace-nowrap">
                                {entry.region}
                              </td>
                              <td className="py-2.5 px-4 font-mono-num font-semibold text-[#f3d285] whitespace-nowrap">
                                {formatSurvivalDuration(entry.survivalTime)}
                              </td>
                              <td className="py-2.5 px-4 font-mono-num text-xs whitespace-nowrap">
                                {entry.victory ? (
                                  <span className="text-[#4ade80] font-semibold">
                                    Lv.{entry.finalLevel} · King
                                  </span>
                                ) : (
                                  <span className="text-[#b8c4bf]">Lv.{entry.finalLevel}</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 font-mono-num text-[#d6d3c9]">
                                {entry.kills}
                              </td>
                              <td className="py-2.5 px-4 text-xs text-[#b8c4bf] whitespace-nowrap">
                                {entry.mode === 'multiplayer'
                                  ? `Multiplayer · ${entry.lobbySize}K`
                                  : `${entry.lobbySize}-Keli Royale`}
                              </td>
                              <td className="py-2.5 px-4 text-xs text-[#9cb0ba] text-right whitespace-nowrap">
                                {formatRecordedDate(entry.achievedAt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="compendium-plaque rounded-sm overflow-hidden">
              {sortedLeaderboard.length === 0 ? (
                <div className="px-6 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-[2px] border border-[#4a3c22] bg-[#0b1218] text-[#d9b25f] shrink-0">
                      <Clock className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[#f7f2e7]">
                        No Keli King Survival Records Yet
                      </div>
                      <p className="text-xs text-[#9cb0ba] mt-1 max-w-xl leading-relaxed">
                        Survive the Wang Kelian basin and reunite all 100 fragments to reach Keli King status. Your top 10 survival times are automatically saved in local storage.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={commitNameAndStart}
                    className="px-4 py-2 text-xs font-semibold rounded-[2px] bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] transition-colors whitespace-nowrap self-start sm:self-center shrink-0"
                  >
                    Claim #1 Record
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead className="bg-[#0b1218] text-xs text-[#9cb0ba]">
                      <tr>
                        <th className="py-3 px-4 font-medium w-16">Rank</th>
                        <th className="py-3 px-4 font-medium">Player</th>
                        <th className="py-3 px-4 font-medium">Survival Time</th>
                        <th className="py-3 px-4 font-medium">Eliminations</th>
                        <th className="py-3 px-4 font-medium">Match Format</th>
                        <th className="py-3 px-4 font-medium text-right">Crowned At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1a2630]">
                      {sortedLeaderboard.map((entry, idx) => {
                        const rank = idx + 1;
                        const rankColor =
                          rank === 1
                            ? 'text-[#f3d285]'
                            : rank === 2
                            ? 'text-[#d6d3c9]'
                            : rank === 3
                            ? 'text-[#d49a6a]'
                            : 'text-[#8ea0aa]';
                        return (
                          <tr key={entry.id} className="hover:bg-[#142029]">
                            <td className={`py-2.5 px-4 font-mono-num font-semibold ${rankColor}`}>
                              #{rank}
                            </td>
                            <td className="py-2.5 px-4 font-medium text-[#f7f2e7]">
                              {entry.playerName}
                            </td>
                            <td className="py-2.5 px-4 font-mono-num font-semibold text-[#f3d285]">
                              {formatSurvivalDuration(entry.survivalTime)}
                            </td>
                            <td className="py-2.5 px-4 font-mono-num text-[#d6d3c9]">
                              {entry.kills}
                            </td>
                            <td className="py-2.5 px-4 text-xs text-[#b8c4bf] whitespace-nowrap">
                              {entry.mode === 'tutorial'
                                ? 'First Match Guide'
                                : `${entry.lobbySize}-Keli Royale`}
                            </td>
                            <td className="py-2.5 px-4 text-xs text-[#9cb0ba] text-right whitespace-nowrap">
                              {formatRecordedDate(entry.achievedAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Bestiary & Design Sheets Strip */}
        <section className="space-y-4 pt-4 border-t border-[#1e2d38]">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#f7f2e7]">
                Field Bestiary & Design Compendium
              </h2>
              <p className="text-sm text-[#9cb0ba]">
                Inspect the official evolution lineup, anatomy studies, and level-band field notes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenCodex('overview')}
              className="text-xs font-medium text-[#f3d285] hover:underline whitespace-nowrap"
            >
              Open Full Codex (7 Plates)
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {DESIGN_PLATES.map((plate) => (
              <button
                key={plate.id}
                type="button"
                onClick={() => onOpenCodex(plate.id)}
                className="group text-left rounded border border-[#4a3c22] bg-[#101920] overflow-hidden hover:border-[#c99c4a] transition-colors"
              >
                <div className="aspect-[4/3] bg-[#0b1218] overflow-hidden">
                  <img
                    src={plate.src}
                    alt={plate.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                </div>
                <div className="p-2">
                  <div className="text-[11px] font-semibold text-[#f3e6c8] truncate">
                    {plate.title}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Arena Zones */}
        <section id="arena" className="space-y-5 pt-4 border-t border-[#1e2d38]">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#f7f2e7]">
              Six Zones of Wang Kelian
            </h2>
            <p className="text-sm text-[#9cb0ba]">
              Aquatic shortcuts stay navigable around Tebing Kering so smaller bodies can contest carcasses at any stage.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.values(ZONE_METADATA).map((zone) => (
              <div
                key={zone.id}
                className="compendium-plaque-subtle rounded-sm p-4 space-y-1.5"
              >
                <h3 className="font-display text-base font-semibold text-[#f3d285]">
                  ◆ {zone.name}
                </h3>
                <p className="text-sm text-[#b8c4bf] leading-relaxed">{zone.subtitle}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Evolution Milestones + Lineup Visual */}
        <section id="evolution" className="space-y-5 pt-4 border-t border-[#1e2d38]">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#f7f2e7]">
                Evolution & Abilities
              </h2>
              <p className="text-sm text-[#9cb0ba]">
                Living levels plus carcass mass always equal 100. Large feeds unlock every crossed milestone at once.
              </p>
            </div>
          </div>

          <div className="compendium-plaque rounded-sm overflow-hidden">
            <img
              src={LINEUP_ART}
              alt="Awang Keli evolution sprite lineup from Level 1 to Level 100"
              referrerPolicy="no-referrer"
              className="w-full max-h-96 object-cover object-top border-b border-[#4a3c22]"
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-[#0b1218] text-xs text-[#9cb0ba]">
                  <tr>
                    <th className="py-3 px-4 font-medium">Sprite</th>
                    <th className="py-3 px-4 font-medium">Level</th>
                    <th className="py-3 px-4 font-medium">Unlock</th>
                    <th className="py-3 px-4 font-medium">Key</th>
                    <th className="py-3 px-4 font-medium">Rule</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a2630]">
                  {EVOLUTION_MILESTONES.map((m) => (
                    <tr key={m.level} className="hover:bg-[#142029]">
                      <td className="py-1.5 px-4">
                        <div className="w-11 h-11 rounded border border-[#3a301e] bg-[#0b1218] flex items-center justify-center p-1">
                          <img
                            src={`/assets/sprites/keli_lv${m.level}.png`}
                            alt={`Awang Keli Lv.${m.level} sprite`}
                            referrerPolicy="no-referrer"
                            className="max-w-full max-h-full object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono-num font-semibold text-[#f3d285]">
                        Lv.{m.level}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-[#f7f2e7] whitespace-nowrap">
                        {m.title}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-xs text-[#9cb0ba] whitespace-nowrap">
                        {m.keyHint ?? 'Passive'}
                      </td>
                      <td className="py-2.5 px-4 text-[#b8c4bf]">{m.shortRule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Controls & Accessibility */}
        <section id="controls" className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-4 border-t border-[#1e2d38]">
          <div className="lg:col-span-7 space-y-4">
            <h2 className="font-display text-2xl font-semibold text-[#f7f2e7]">
              Combat & Inputs
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {[
                { key: 'WASD / Arrows', action: 'Swim & Crawl' },
                { key: 'Mouse', action: 'Aim Direction' },
                { key: 'Left Click / Space', action: 'Bite & Feed' },
                { key: 'Shift', action: 'Riptide Dash (Lv.10)' },
                { key: 'E', action: 'Echo / Hunter Sonar (Lv.20)' },
                { key: 'Q / R / F', action: 'Veil / Shock / Maelstrom' },
              ].map((item) => (
                <div
                  key={item.key}
                  className="compendium-plaque-subtle rounded-sm p-3"
                >
                  <div className="font-mono-num text-xs text-[#f3d285]">{item.key}</div>
                  <div className="text-sm font-medium text-[#f7f2e7] mt-0.5">{item.action}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-4">
            <h2 className="font-display text-2xl font-semibold text-[#f7f2e7]">
              Accessibility & Audio
            </h2>
            <div className="compendium-plaque-subtle rounded-sm p-4 space-y-3 text-sm">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-[#e2e8f0]">Reduced Camera Shake</span>
                <input
                  type="checkbox"
                  checked={settings.reducedMotion}
                  onChange={(e) => onUpdateSettings({ reducedMotion: e.target.checked })}
                  className="accent-[#c99c4a] w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-[#e2e8f0]">Visual Sound Cues</span>
                <input
                  type="checkbox"
                  checked={settings.visualSoundCues}
                  onChange={(e) => onUpdateSettings({ visualSoundCues: e.target.checked })}
                  className="accent-[#c99c4a] w-4 h-4"
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#e2e8f0]">Audio</span>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ muted: !settings.muted })}
                  className="flex items-center gap-1.5 px-3 py-1 rounded border border-[#5b4724] bg-[#0b1218] text-xs text-[#f3e6c8] hover:border-[#c99c4a]"
                >
                  {settings.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  {settings.muted ? 'Muted' : 'Sound On'}
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#1c2933] px-6 py-5 text-xs text-[#8ea0aa]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Awang Keli: Battle for Wang Kelian · Fictional setting in Perlis, Malaysia</span>
          <button
            type="button"
            onClick={() => onOpenComic(1)}
            className="text-[#f3d285] hover:underline"
          >
            Mojo Comix Vol. 1: Awang Keli · Setelah Tasik Senyap (by drmujahid)
          </button>
        </div>
      </footer>
    </div>
  );
};

import React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Crown,
  Globe,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trophy,
} from 'lucide-react';
import { RegionCode } from '../data/regions';
import { formatSurvivalDuration, LeaderboardSaveState } from '../game/leaderboard';
import { MatchReplayData } from '../game/replay';
import { computeMatchScoreFromHud, MatchScoreBreakdown } from '../game/scoring';
import { HudSnapshot } from '../game/types';
import { MatchReplayPanel } from './MatchReplayPanel';
import { KeliKingShowcase } from './KeliKingShowcase';
import { VictoryCelebrationCanvas } from './VictoryCelebrationCanvas';
import { VoluntarySupportControl } from './VoluntarySupportControl';

interface PostMatchScreenProps {
  hud: HudSnapshot;
  replay?: MatchReplayData | null;
  matchScore?: MatchScoreBreakdown | null;
  bestScore?: number;
  leaderboardRank?: number | null;
  globalRankInfo?: {
    globalRank: number | null;
    regionalRank: number | null;
    region: RegionCode;
  } | null;
  leaderboardSaveState?: LeaderboardSaveState | null;
  onRetryLeaderboardSave?: () => void;
  isMultiplayer?: boolean;
  isMultiplayerHost?: boolean;
  reducedMotion?: boolean;
  onPlayAgain: () => void;
  onReturnLobby: () => void;
  onOpenEpilogue: () => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const PostMatchScreen: React.FC<PostMatchScreenProps> = ({
  hud,
  replay = null,
  matchScore = null,
  bestScore = 0,
  leaderboardRank = null,
  globalRankInfo = null,
  leaderboardSaveState = null,
  onRetryLeaderboardSave,
  isMultiplayer = false,
  isMultiplayerHost = false,
  reducedMotion = false,
  onPlayAgain,
  onReturnLobby,
  onOpenEpilogue,
}) => {
  const { matchResult } = hud;
  const isVictory = matchResult.status === 'victory';
  const recentLedger = [...matchResult.ledger].reverse().slice(0, 28);
  const resolvedScore = matchScore ?? computeMatchScoreFromHud(hud);
  const displayBestScore = Math.max(bestScore, resolvedScore.totalScore);

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-[#091116] safe-area-page-x"
      style={{
        paddingTop: 'max(2rem, var(--sat))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      {isVictory && <VictoryCelebrationCanvas reducedMotion={reducedMotion} />}
      <div className="relative z-10 max-w-4xl mx-auto space-y-6">
        <section className="compendium-plaque rounded-sm overflow-hidden">
          <div className="compendium-ribbon flex items-center justify-between gap-3 px-6 py-3">
            <div className="text-xs font-mono-num font-semibold tracking-wider text-[#f3d285]">
              ◆{' '}
              {isVictory
                ? 'KELI KING TRANSFORMATION · 100 / 100 FRAGMENTS'
                : matchResult.winnerName
                ? `MATCH COMPLETED · WINNER: ${matchResult.winnerName.toUpperCase()} (LV.100)`
                : matchResult.status === 'playing'
                ? `ELIMINATED · ${hud.aliveCount} KELIS STILL BATTLING`
                : 'MATCH CONCLUDED · WANG KELIAN BASIN'}
            </div>
            <span className="text-[11px] font-mono-num text-[#a9b9c2] hidden sm:inline">
              {formatTime(hud.matchTime)}
            </span>
          </div>

          <div className="p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#f7f2e7] mb-3">
                  {isVictory
                    ? 'All 100 Fragments Reunited'
                    : matchResult.status === 'draw'
                    ? 'No Survivors Remaining'
                    : 'Your Fragments Scattered'}
                </h1>
                <p className="text-sm sm:text-base text-[#b8c4bf] leading-relaxed max-w-2xl">
                  {isVictory
                    ? 'Rising from Lubuk Hitam with shoulders broader than the timber doorway, Awang Keli lifts Aisyah’s faded red paper boat from the roots at Jantung Tasik and remembers his promise to come home.'
                    : matchResult.killedBy
                    ? `Eliminated by ${matchResult.deathCause || matchResult.killedBy}. ${
                        matchResult.massTransferredTo
                          ? `Your ${matchResult.finalLevel} fragments were claimed by ${matchResult.massTransferredTo}. `
                          : `Your ${matchResult.finalLevel} fragments remained in the basin. `
                      }${
                        matchResult.winnerName
                          ? `${matchResult.winnerName} went on to reunite all 100 fragments as Keli King.`
                          : ''
                      }`
                    : 'The basin claimed every remaining swimmer before 100 fragments could reunite.'}
                </p>
              </div>
              {(isVictory || Boolean(matchResult.winnerName)) && (
                <KeliKingShowcase
                  championName={matchResult.winnerName || hud.player.name}
                  reducedMotion={reducedMotion}
                  playVictoryIntro={isVictory}
                />
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[#263642]">
              <div className="compendium-plaque-subtle rounded-[2px] p-3">
                <div className="text-xs text-[#9cb0ba]">Final Level</div>
                <div className="font-mono-num text-2xl font-semibold text-[#f7f2e7] mt-0.5">
                  Lv.{matchResult.finalLevel}
                </div>
              </div>
              <div className="compendium-plaque-subtle rounded-[2px] p-3">
                <div className="text-xs text-[#9cb0ba]">Eliminations</div>
                <div className="font-mono-num text-2xl font-semibold text-[#f7f2e7] mt-0.5">
                  {matchResult.kills}
                </div>
              </div>
              <div className="compendium-plaque-subtle rounded-[2px] p-3">
                <div className="text-xs text-[#9cb0ba]">Survival Time</div>
                <div className="font-mono-num text-2xl font-semibold text-[#f7f2e7] mt-0.5">
                  {isVictory
                    ? formatSurvivalDuration(matchResult.survivalTime)
                    : formatTime(matchResult.survivalTime)}
                </div>
                {isVictory && leaderboardRank !== null && (
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#f3d285]">
                    <Crown className="w-3 h-3" />
                    <span>Local Top 10 #{leaderboardRank}</span>
                  </div>
                )}
                {leaderboardSaveState?.status === 'saved' &&
                (leaderboardSaveState.globalRank !== null ||
                  leaderboardSaveState.regionalRank !== null) ? (
                  <div
                    data-testid="leaderboard-save-saved"
                    className="mt-1 flex items-center gap-1 text-[11px] font-mono-num font-medium text-[#7dd3fc]"
                  >
                    <CheckCircle2 className="w-3 h-3 shrink-0 text-[#4ade80]" />
                    <span>
                      Saved ·{' '}
                      {leaderboardSaveState.globalRank !== null
                        ? `Global #${leaderboardSaveState.globalRank}`
                        : 'Recorded'}
                      {leaderboardSaveState.regionalRank !== null && leaderboardSaveState.region
                        ? ` · #${leaderboardSaveState.regionalRank} ${leaderboardSaveState.region}`
                        : ''}
                    </span>
                  </div>
                ) : leaderboardSaveState?.status === 'saving' ? (
                  <div
                    data-testid="leaderboard-save-saving"
                    className="mt-1 flex items-center gap-1 text-[11px] font-medium text-[#f3d285]"
                  >
                    <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
                    <span>Saving ranking…</span>
                  </div>
                ) : !leaderboardSaveState &&
                  globalRankInfo &&
                  (globalRankInfo.globalRank !== null || globalRankInfo.regionalRank !== null) ? (
                  <div className="mt-1 flex items-center gap-1 text-[11px] font-mono-num font-medium text-[#7dd3fc]">
                    <Globe className="w-3 h-3 shrink-0" />
                    <span>
                      {globalRankInfo.globalRank !== null ? `Global #${globalRankInfo.globalRank}` : 'Unranked'}
                      {globalRankInfo.regionalRank !== null
                        ? ` · #${globalRankInfo.regionalRank} ${globalRankInfo.region}`
                        : ''}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="compendium-plaque-subtle rounded-[2px] p-3">
                <div className="text-xs text-[#9cb0ba]">Mass Conservation</div>
                <div className="font-mono-num text-2xl font-semibold text-[#4ade80] mt-0.5">
                  {hud.livingMassSum + hud.carcassMassSum} / 100
                </div>
              </div>
            </div>

            {hud.mode !== 'tutorial' &&
              leaderboardSaveState &&
              (leaderboardSaveState.status === 'failed' ||
                leaderboardSaveState.status === 'unavailable' ||
                leaderboardSaveState.status === 'ineligible') && (
                <div
                  data-testid={`leaderboard-save-${leaderboardSaveState.status}`}
                  className={`mt-4 rounded-[2px] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs border ${
                    leaderboardSaveState.status === 'failed'
                      ? 'border-[#ef4444]/50 bg-[#3b1216]/75 text-[#fecaca]'
                      : leaderboardSaveState.status === 'unavailable'
                        ? 'border-[#5b4724] bg-[#142029] text-[#f3e6c8]'
                        : 'border-[#263642] bg-[#0e171f] text-[#9cb0ba]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {leaderboardSaveState.status === 'failed' ? (
                      <AlertTriangle className="w-4 h-4 shrink-0 text-[#f87171]" />
                    ) : (
                      <Globe className="w-4 h-4 shrink-0 text-[#d9b25f]" />
                    )}
                    <span>
                      {leaderboardSaveState.status === 'failed'
                        ? `Global ranking not saved: ${leaderboardSaveState.message || 'Please retry.'}`
                        : leaderboardSaveState.status === 'unavailable'
                          ? `Global leaderboard unavailable: ${leaderboardSaveState.message || 'Local record kept.'}`
                          : leaderboardSaveState.message || 'Run did not qualify for global rankings.'}
                    </span>
                  </div>
                  {leaderboardSaveState.retryable && onRetryLeaderboardSave && (
                    <button
                      type="button"
                      onClick={onRetryLeaderboardSave}
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold rounded-[2px] border border-[#f3d285]/50 bg-[#1a2630] text-[#f3d285] hover:border-[#f3d285] transition-colors whitespace-nowrap"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry Save
                    </button>
                  )}
                </div>
              )}

            {hud.mode !== 'tutorial' && (
              <div
                data-testid="match-score-summary"
                className="compendium-plaque-subtle rounded-[2px] px-4 py-3 mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <Trophy className="w-5 h-5 text-[#f3d285] shrink-0" />
                  <div>
                    <div className="text-[11px] text-[#9cb0ba] uppercase tracking-wider font-mono-num">
                      Match Score · Best {displayBestScore.toLocaleString()}
                    </div>
                    <div className="font-mono-num text-2xl font-bold text-[#f3d285]">
                      {resolvedScore.totalScore.toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono-num text-[#b8c4bf]">
                  <span>Defeats +{resolvedScore.defeatedScore}</span>
                  <span>Fragments +{resolvedScore.fragmentScore}</span>
                  <span>Survival +{resolvedScore.survivalScore}</span>
                  {resolvedScore.milestoneScore > 0 && (
                    <span>Milestones +{resolvedScore.milestoneScore}</span>
                  )}
                  {resolvedScore.victoryBonus > 0 && (
                    <span className="text-[#4ade80] font-semibold">
                      King +{resolvedScore.victoryBonus}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 mt-6">
              {isVictory && (
                <button
                  type="button"
                  onClick={onOpenEpilogue}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-[2px] border border-[#f3d285]/40 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] transition-colors whitespace-nowrap"
                >
                  <BookOpen className="w-4 h-4" />
                  Read Epilogue: Ke Hulu (08/08)
                </button>
              )}
              {(!isMultiplayer || isMultiplayerHost) && (
                <button
                  type="button"
                  onClick={onPlayAgain}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-[2px] transition-colors whitespace-nowrap ${
                    isVictory
                      ? 'border border-[#5b4724] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a]'
                      : 'border border-[#f3d285]/40 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f]'
                  }`}
                >
                  <RotateCcw className="w-4 h-4" />
                  {isMultiplayer ? 'Rematch Basin' : 'Play Again'}
                </button>
              )}
              <button
                type="button"
                onClick={onReturnLobby}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-[2px] border border-[#2d404d] bg-[#0b1218] text-[#c7d1cd] hover:border-[#c99c4a] hover:text-white transition-colors whitespace-nowrap"
              >
                <ArrowLeft className="w-4 h-4" />
                {isMultiplayer ? 'Return to Basin Room' : 'Return to Lobby'}
              </button>
              <VoluntarySupportControl
                variant="postmatch"
                reducedMotion={reducedMotion}
                className="sm:ml-auto"
              />
            </div>
          </div>
        </section>

        {replay && replay.frames.length > 0 && <MatchReplayPanel replay={replay} />}

        <section className="compendium-plaque rounded-sm overflow-hidden">
          <div className="compendium-ribbon flex items-center justify-between px-5 py-3.5">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#f3d285]">
                ◆ 100-Fragment Mass Ledger
              </h2>
              <p className="text-xs text-[#9cb0ba]">
                Every death and feed transaction preserves living levels plus carcass mass at 100.
              </p>
            </div>
            <div className="text-xs font-mono-num text-[#f3d285] whitespace-nowrap">
              {matchResult.ledger.length} events
            </div>
          </div>

          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#0b1218] text-[#9cb0ba] sticky top-0">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Time</th>
                  <th className="py-2.5 px-4 font-medium">Event</th>
                  <th className="py-2.5 px-4 font-medium">Actor</th>
                  <th className="py-2.5 px-4 font-medium">Target</th>
                  <th className="py-2.5 px-4 font-medium text-right">Fragments</th>
                  <th className="py-2.5 px-4 font-medium text-right">Living + Carcass</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a2630]">
                {recentLedger.map((row) => (
                  <tr key={row.id} className="hover:bg-[#142029]">
                    <td className="py-2 px-4 font-mono-num text-[#9cb0ba]">
                      {formatTime(row.time)}
                    </td>
                    <td className="py-2 px-4 capitalize text-[#f3d285]">
                      {row.type.replace('_', ' ')}
                    </td>
                    <td className="py-2 px-4 text-[#f7f2e7] font-medium">{row.actorName}</td>
                    <td className="py-2 px-4 text-[#b8c4bf]">{row.targetName}</td>
                    <td className="py-2 px-4 font-mono-num text-right text-[#f3d285]">
                      {row.fragments}
                    </td>
                    <td className="py-2 px-4 font-mono-num text-right text-[#4ade80]">
                      {row.totalLivingMass} + {row.totalCarcassMass} ={' '}
                      {row.totalLivingMass + row.totalCarcassMass}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

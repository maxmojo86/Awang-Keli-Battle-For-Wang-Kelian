import React from 'react';
import type {
  AiDebugEntry,
  AiDifficulty,
  AiPersonality,
  AiState,
  MatchPacingMetrics,
} from '../game/types.ts';

interface AiDebugOverlayProps {
  entries: AiDebugEntry[];
  difficulty: AiDifficulty;
  matchSeed: number;
  playerX: number;
  playerZ: number;
  pacingMetrics?: MatchPacingMetrics | null;
  onChangeDifficulty: (difficulty: AiDifficulty) => void;
  onClose: () => void;
}

const PERSONALITY_SHORT: Record<AiPersonality, string> = {
  aggressive_hunter: 'HUNTER',
  cautious_survivor: 'SURVIVOR',
  opportunistic_scavenger: 'SCAVENGER',
  patient_ambusher: 'AMBUSHER',
};

const STATE_COLOR: Record<AiState, string> = {
  ESCAPE_ZONE: 'text-rose-400',
  EVADE: 'text-cyan-300',
  RETREAT: 'text-amber-300',
  RECOVER: 'text-emerald-300',
  ATTACK: 'text-red-400',
  CHASE: 'text-orange-300',
  CONTEST_CARCASS: 'text-fuchsia-300',
  FEED: 'text-yellow-300',
  SCAVENGE: 'text-lime-300',
  AMBUSH: 'text-violet-300',
  HUNT: 'text-sky-300',
  EXPLORE: 'text-slate-300',
};

function directionArrow(angle: number): string {
  const deg = ((angle * 180) / Math.PI + 360) % 360;
  if (deg >= 337.5 || deg < 22.5) return '→';
  if (deg < 67.5) return '↘';
  if (deg < 112.5) return '↓';
  if (deg < 157.5) return '↙';
  if (deg < 202.5) return '←';
  if (deg < 247.5) return '↖';
  if (deg < 292.5) return '↑';
  return '↗';
}

export const AiDebugOverlay: React.FC<AiDebugOverlayProps> = ({
  entries,
  difficulty,
  matchSeed,
  playerX,
  playerZ,
  pacingMetrics = null,
  onChangeDifficulty,
  onClose,
}) => {
  const nearest = [...entries]
    .sort((a, b) => {
      const da = Math.hypot(a.x - playerX, a.z - playerZ);
      const db = Math.hypot(b.x - playerX, b.z - playerZ);
      return da - db;
    })
    .slice(0, 12);

  return (
    <div
      className="pointer-events-auto fixed top-16 left-3 z-[60] w-[360px] max-w-[92vw] rounded border border-amber-500/40 bg-[#08131a]/92 p-2.5 text-[11px] font-mono text-slate-100 shadow-2xl"
      data-testid="ai-debug-overlay"
    >
      <div className="flex items-center justify-between border-b border-slate-700/80 pb-1.5 mb-2">
        <div>
          <span className="font-bold text-amber-300">DEV AI INSPECTOR</span>
          <span className="ml-2 text-slate-400">
            seed:{matchSeed.toString(16).slice(0, 6)} · {entries.length} bots
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="px-1.5 py-0.5 text-[10px] text-slate-300 hover:text-white border border-slate-600 rounded"
        >
          ESC
        </button>
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-400">AI Difficulty:</span>
        <div className="flex gap-1">
          {(['easy', 'normal', 'hard'] as AiDifficulty[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChangeDifficulty(d)}
              className={`px-2 py-0.5 rounded uppercase text-[10px] border ${
                difficulty === d
                  ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-bold'
                  : 'bg-slate-900/70 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[300px] overflow-y-auto space-y-1 pr-0.5">
        {nearest.map((b) => {
          const dist = Math.round(Math.hypot(b.x - playerX, b.z - playerZ));
          return (
            <div
              key={b.botId}
              className="rounded bg-slate-900/80 border border-slate-800 px-2 py-1 leading-tight"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white truncate max-w-[140px]">
                  {b.name} <span className="text-amber-300">Lv.{b.level}</span>
                </span>
                <span className="text-[10px] text-slate-400">
                  {PERSONALITY_SHORT[b.personality]} · {dist}u
                </span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className={`font-bold ${STATE_COLOR[b.state]}`}>
                  {directionArrow(b.intentAngle)} {b.state}
                </span>
                <span className="text-slate-300">
                  HP:{b.hpPct}% ST:{b.staminaPct}% <span className="text-amber-200">({b.score})</span>
                </span>
              </div>
              {b.targetLabel && (
                <div className="text-[10px] text-slate-400 truncate">
                  Target: {b.targetLabel}
                </div>
              )}
            </div>
          );
        })}
        {nearest.length === 0 && (
          <div className="text-slate-400 text-center py-2">No active local bots</div>
        )}
      </div>

      {pacingMetrics && (
        <div className="mt-2 pt-1.5 border-t border-slate-700/80 text-[10px] text-slate-300 space-y-0.5">
          <div className="flex justify-between">
            <span className="text-amber-300 font-semibold uppercase">
              Pacing · {pacingMetrics.matchPhase}
            </span>
            <span>
              1st Hit: {pacingMetrics.timeToFirstEncounterSec !== null ? `${pacingMetrics.timeToFirstEncounterSec}s` : '—'} ·
              1st KO: {pacingMetrics.timeToFirstEliminationSec !== null ? `${pacingMetrics.timeToFirstEliminationSec}s` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>
              Enc:{pacingMetrics.encounterCount} · Dead:{Math.round(pacingMetrics.deadTimeSec)}s
            </span>
            <span>
              Contested:{pacingMetrics.contestedCarcassCount} · Hotspots:{pacingMetrics.hotspotsCreated}
            </span>
          </div>
        </div>
      )}

      <div className="mt-1.5 pt-1 border-t border-slate-800 text-[10px] text-slate-400 flex justify-between">
        <span>Toggle: Ctrl+Shift+D</span>
        <span>Local dev only</span>
      </div>
    </div>
  );
};

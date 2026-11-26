import React from 'react';
import type { MultiplayerSnapshot } from '../game/multiplayerClient';

interface MultiplayerDebugPanelProps {
  snapshot: MultiplayerSnapshot;
  roomCode?: string | null;
  matchId?: string | null;
  localPlayerId?: string | null;
  snapshotTick?: number | null;
  participantCount?: number | null;
  positionClassName?: string;
}

/**
 * Development-only multiplayer diagnostic panel.
 * Renders strictly in DEV mode (`import.meta.env.DEV`) and never appears in production builds.
 */
export const MultiplayerDebugPanel: React.FC<MultiplayerDebugPanelProps> = ({
  snapshot,
  roomCode,
  matchId,
  localPlayerId,
  snapshotTick,
  participantCount,
  positionClassName = 'bottom-3 left-3',
}) => {
  if (!import.meta.env.DEV) return null;

  const resolvedRoom = roomCode ?? snapshot.currentRoom?.code ?? snapshot.activeRoomCode ?? '—';
  const resolvedMatch = matchId ?? snapshot.activeMatchId ?? snapshot.currentRoom?.activeMatchId ?? '—';
  const resolvedPlayer = localPlayerId ?? snapshot.activeMatchPlayerId ?? snapshot.clientId ?? '—';
  const resolvedCount =
    participantCount ?? snapshot.currentRoom?.participants.length ?? 0;
  const resolvedTick = snapshotTick ?? snapshot.latestSnapshotTick;

  return (
    <aside
      data-testid="mp-dev-diagnostics"
      aria-label="Multiplayer development diagnostics"
      className={`pointer-events-none fixed ${positionClassName} z-40 rounded-[2px] border border-[#38bdf8]/45 bg-[#071017]/90 px-2.5 py-2 text-[10px] font-mono-num text-[#cbd5e1] shadow-lg max-w-[260px]`}
    >
      <div className="text-[9.5px] font-semibold tracking-wider text-[#7dd3fc] uppercase mb-1">
        MP Dev Diagnostics
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 leading-tight">
        <span className="text-[#94a3b8]">Host:</span>
        <span className="truncate text-[#f8fafc]">{snapshot.wsHost ?? 'unconfigured'}</span>
        <span className="text-[#94a3b8]">Status:</span>
        <span className="truncate text-[#f8fafc]">
          {snapshot.status}
          {snapshot.latencyMs !== null ? ` (${snapshot.latencyMs}ms)` : ''}
        </span>
        <span className="text-[#94a3b8]">Room:</span>
        <span className="truncate text-[#f3d285]">{resolvedRoom}</span>
        <span className="text-[#94a3b8]">Match:</span>
        <span className="truncate text-[#f8fafc]">{resolvedMatch}</span>
        <span className="text-[#94a3b8]">Player:</span>
        <span className="truncate text-[#f8fafc]">{resolvedPlayer}</span>
        <span className="text-[#94a3b8]">Humans:</span>
        <span className="truncate text-[#f8fafc]">{resolvedCount}</span>
        <span className="text-[#94a3b8]">Tick:</span>
        <span className="truncate text-[#4ade80]">
          {resolvedTick !== null && resolvedTick !== undefined ? resolvedTick : 'awaiting'}
        </span>
      </div>
    </aside>
  );
};

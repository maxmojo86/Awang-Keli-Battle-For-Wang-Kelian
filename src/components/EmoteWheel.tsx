import React, { useMemo, useRef } from 'react';
import {
  AlertTriangle,
  Flag,
  Shield,
  Swords,
  Utensils,
  X,
  Zap,
} from 'lucide-react';
import { EMOTE_SPECS, EmoteId } from '../data/emotes';

interface EmoteWheelProps {
  open: boolean;
  selectedIndex: number | null;
  cooldownLeft: number;
  compact: boolean;
  onHoverIndex: (idx: number | null) => void;
  onSelectEmote: (emoteId: EmoteId) => void;
  onClose: () => void;
}

export function pickEmoteIndexFromDelta(
  dx: number,
  dy: number,
  deadzonePx = 26
): number | null {
  const dist = Math.hypot(dx, dy);
  if (dist < deadzonePx) return null;
  // Wedge 0 is straight up (-PI/2); step clockwise by 60 deg (PI/3)
  let rel = Math.atan2(dy, dx) - (-Math.PI / 2 - Math.PI / 6);
  const twoPi = Math.PI * 2;
  rel = ((rel % twoPi) + twoPi) % twoPi;
  return Math.floor(rel / (twoPi / EMOTE_SPECS.length)) % EMOTE_SPECS.length;
}

function buildWedgePath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startRad: number,
  endRad: number
): string {
  const x1 = cx + Math.cos(startRad) * rOuter;
  const y1 = cy + Math.sin(startRad) * rOuter;
  const x2 = cx + Math.cos(endRad) * rOuter;
  const y2 = cy + Math.sin(endRad) * rOuter;
  const x3 = cx + Math.cos(endRad) * rInner;
  const y3 = cy + Math.sin(endRad) * rInner;
  const x4 = cx + Math.cos(startRad) * rInner;
  const y4 = cy + Math.sin(startRad) * rInner;

  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 0 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function EmoteGlyph({ id, color, compact }: { id: EmoteId; color: string; compact: boolean }) {
  const cls = compact ? 'w-4 h-4' : 'w-[18px] h-[18px]';
  switch (id) {
    case 'rally':
      return <Flag className={cls} style={{ color }} />;
    case 'danger':
      return <AlertTriangle className={cls} style={{ color }} />;
    case 'feast':
      return <Utensils className={cls} style={{ color }} />;
    case 'challenge':
      return <Swords className={cls} style={{ color }} />;
    case 'mock':
      return <Zap className={cls} style={{ color }} />;
    case 'respect':
      return <Shield className={cls} style={{ color }} />;
  }
}

export const EmoteWheel: React.FC<EmoteWheelProps> = ({
  open,
  selectedIndex,
  cooldownLeft,
  compact,
  onHoverIndex,
  onSelectEmote,
  onClose,
}) => {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const size = compact ? 236 : 292;
  const cx = size / 2;
  const cy = size / 2;
  const rInner = compact ? 40 : 48;
  const rOuter = compact ? 112 : 138;
  const rLabel = (rInner + rOuter) / 2;

  const wedges = useMemo(() => {
    const sector = (Math.PI * 2) / EMOTE_SPECS.length;
    const gap = 0.032;
    return EMOTE_SPECS.map((spec, idx) => {
      const centerAngle = -Math.PI / 2 + idx * sector;
      const startRad = centerAngle - sector / 2 + gap;
      const endRad = centerAngle + sector / 2 - gap;
      const path = buildWedgePath(cx, cy, rInner, rOuter, startRad, endRad);
      const lx = cx + Math.cos(centerAngle) * rLabel;
      const ly = cy + Math.sin(centerAngle) * rLabel;
      return { spec, idx, path, lx, ly };
    });
  }, [cx, cy, rInner, rOuter, rLabel]);

  if (!open) return null;

  const activeSpec =
    selectedIndex !== null && selectedIndex >= 0 && selectedIndex < EMOTE_SPECS.length
      ? EMOTE_SPECS[selectedIndex]
      : null;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = wheelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    onHoverIndex(pickEmoteIndexFromDelta(dx, dy, rInner * 0.85));
  };

  return (
    <div
      data-emote-wheel="true"
      className="pointer-events-auto fixed inset-0 z-[25] flex items-center justify-center"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          e.stopPropagation();
          onClose();
        }
      }}
      onPointerMove={handlePointerMove}
    >
      <div
        ref={wheelRef}
        data-emote-wheel="true"
        role="menu"
        aria-label="Quick-access emote wheel"
        style={{ width: size, height: size }}
        className="relative select-none touch-none"
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="block drop-shadow-[0_14px_28px_rgba(0,0,0,0.75)]"
        >
          <circle
            cx={cx}
            cy={cy}
            r={rOuter + 3}
            fill="rgba(7, 13, 18, 0.72)"
            stroke="#5f4722"
            strokeWidth={1.5}
          />
          {wedges.map(({ spec, idx, path }) => {
            const selected = selectedIndex === idx;
            const isTaunt = spec.category === 'taunt';
            const fill = selected
              ? isTaunt
                ? 'rgba(69, 20, 28, 0.96)'
                : 'rgba(17, 44, 62, 0.96)'
              : 'rgba(12, 21, 29, 0.92)';
            const stroke = selected ? spec.color : '#47361a';
            return (
              <path
                key={spec.id}
                d={path}
                fill={fill}
                stroke={stroke}
                strokeWidth={selected ? 2.2 : 1.1}
                className="cursor-pointer transition-colors"
                onPointerEnter={() => onHoverIndex(idx)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEmote(spec.id);
                }}
              />
            );
          })}
        </svg>

        {/* Wedge Icons & Single-Line Labels */}
        {wedges.map(({ spec, idx, lx, ly }) => {
          const selected = selectedIndex === idx;
          return (
            <button
              key={spec.id}
              type="button"
              role="menuitem"
              onPointerEnter={() => onHoverIndex(idx)}
              onClick={(e) => {
                e.stopPropagation();
                onSelectEmote(spec.id);
              }}
              style={{ left: lx, top: ly }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-0.5 px-1.5 py-1 rounded-[2px] pointer-events-auto focus-visible:outline-none ${
                selected ? 'scale-105' : 'opacity-90 hover:opacity-100'
              }`}
            >
              <EmoteGlyph id={spec.id} color={spec.color} compact={compact} />
              <span
                className={`${
                  compact ? 'text-[9.5px]' : 'text-[10.5px]'
                } font-semibold leading-none whitespace-nowrap ${
                  selected ? 'text-white' : 'text-[#e2e8f0]'
                }`}
              >
                {spec.shortLabel}
              </span>
              {!compact && (
                <span className="text-[8.5px] font-mono-num text-[#9cb0ba] leading-none">
                  [{spec.hotkey}]
                </span>
              )}
            </button>
          );
        })}

        {/* Inner Compendium Hub */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (activeSpec) onSelectEmote(activeSpec.id);
            else onClose();
          }}
          style={{ width: rInner * 1.9, height: rInner * 1.9 }}
          className="compendium-medallion absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full flex flex-col items-center justify-center text-center px-2 transition-colors hover:brightness-110"
        >
          {cooldownLeft > 0.05 ? (
            <>
              <span className="text-[11px] font-mono-num font-bold text-[#fbbf24] leading-tight">
                {cooldownLeft.toFixed(1)}s
              </span>
              <span className="text-[8.5px] text-[#9cb0ba] whitespace-nowrap">Cooldown</span>
            </>
          ) : activeSpec ? (
            <>
              <span
                className="text-[8.5px] font-mono-num uppercase tracking-wider leading-none"
                style={{ color: activeSpec.color }}
              >
                {activeSpec.category === 'taunt' ? 'Taunt' : 'Signal'}
              </span>
              <span className="text-[10.5px] font-display font-semibold text-[#f7f2e7] leading-tight mt-0.5 whitespace-nowrap">
                {activeSpec.shortLabel}
              </span>
            </>
          ) : (
            <>
              <X className="w-3.5 h-3.5 text-[#f3d285]" />
              <span className="text-[9px] font-medium text-[#cbd5e1] mt-0.5 whitespace-nowrap">
                {compact ? 'Close' : 'Cancel [G]'}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

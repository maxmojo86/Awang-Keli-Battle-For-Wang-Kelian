import React, { useEffect, useState } from 'react';
import { ChevronsUp, Crown, Gauge, Swords, Zap } from 'lucide-react';
import { getFormLabel } from '../data/abilities';
import { EvolutionForm } from '../game/types';

export interface EvolutionToastEvent {
  form: EvolutionForm;
  level: number;
  key: number;
  durationSec: number;
}

interface EvolutionFormToastProps {
  toast: EvolutionToastEvent | null;
  boostTimeLeft?: number;
  paused?: boolean;
  compact: boolean;
  canPlaceControlsBesideBar: boolean;
  reducedMotion: boolean;
  onDismiss: (key: number) => void;
}

interface FormToastTheme {
  accentHex: string;
  secondaryHex: string;
  badgeBg: string;
  barGradient: string;
}

function getToastTheme(form: EvolutionForm): FormToastTheme {
  switch (form) {
    case 2:
      return {
        accentHex: '#f3d285',
        secondaryHex: '#5eead4',
        badgeBg: 'rgba(19, 44, 42, 0.96)',
        barGradient: 'linear-gradient(90deg, #14b8a6, #f3d285)',
      };
    case 3:
      return {
        accentHex: '#7dd3fc',
        secondaryHex: '#4ade80',
        badgeBg: 'rgba(13, 35, 52, 0.96)',
        barGradient: 'linear-gradient(90deg, #0ea5e9, #4ade80)',
      };
    case 4:
    default:
      return {
        accentHex: '#fde68a',
        secondaryHex: '#f59e0b',
        badgeBg: 'rgba(46, 30, 10, 0.96)',
        barGradient: 'linear-gradient(90deg, #f59e0b, #fef08a)',
      };
  }
}

export const EvolutionFormToast: React.FC<EvolutionFormToastProps> = ({
  toast,
  boostTimeLeft,
  paused = false,
  compact,
  canPlaceControlsBesideBar,
  reducedMotion,
  onDismiss,
}) => {
  const [visible, setVisible] = useState(false);
  const [fallbackRemaining, setFallbackRemaining] = useState<number>(0);

  useEffect(() => {
    if (!toast) {
      setVisible(false);
      setFallbackRemaining(0);
      return;
    }

    setFallbackRemaining(toast.durationSec);
    const enterFrame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(enterFrame);
  }, [toast]);

  // Fallback wall-clock countdown when boostTimeLeft is not driven externally
  useEffect(() => {
    if (!toast || typeof boostTimeLeft === 'number' || paused) return;
    const intervalId = window.setInterval(() => {
      setFallbackRemaining((prev) => Math.max(0, prev - 0.1));
    }, 100);
    return () => window.clearInterval(intervalId);
  }, [toast, boostTimeLeft, paused]);

  const effectiveRemaining =
    toast == null
      ? 0
      : typeof boostTimeLeft === 'number'
        ? Math.max(0, boostTimeLeft)
        : fallbackRemaining;

  useEffect(() => {
    if (!toast) return;
    if (effectiveRemaining > 0.02) return;

    setVisible(false);
    const exitDelay = reducedMotion ? 80 : 200;
    const timer = window.setTimeout(() => {
      onDismiss(toast.key);
    }, exitDelay);
    return () => window.clearTimeout(timer);
  }, [toast, effectiveRemaining, reducedMotion, onDismiss]);

  if (!toast) return null;

  const theme = getToastTheme(toast.form);
  const formName = getFormLabel(toast.form);
  const progressPct = Math.max(
    0,
    Math.min(100, (effectiveRemaining / Math.max(0.1, toast.durationSec)) * 100)
  );
  const ringCircumference = 2 * Math.PI * 15;
  const ringOffset = ringCircumference * (1 - progressPct / 100);

  const positionClass = compact
    ? canPlaceControlsBesideBar
      ? 'bottom-16 max-w-[340px]'
      : 'bottom-[150px] max-w-[296px]'
    : 'bottom-24 sm:bottom-28 max-w-md';

  const motionClass = reducedMotion
    ? visible
      ? 'opacity-100'
      : 'opacity-0'
    : visible
      ? 'opacity-100 translate-y-0 scale-100'
      : 'opacity-0 translate-y-2 scale-[0.98]';

  return (
    <div
      role="status"
      aria-live="polite"
      data-evolution-toast="active"
      data-evolution-form={toast.form}
      className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-[18] w-[92vw] ${positionClass} transition-all ${
        reducedMotion ? 'duration-150' : 'duration-250 ease-out'
      } ${motionClass}`}
    >
      <div
        className="compendium-plaque rounded-sm overflow-hidden"
        style={{ borderColor: theme.accentHex }}
      >
        <div
          className={`flex items-center ${
            compact ? 'gap-2 px-2.5 py-1.5' : 'gap-3 px-3.5 py-2.5'
          }`}
        >
          {/* Temporary Stat Boost Medallion with Radial Timer Ring */}
          <div
            className={`relative shrink-0 flex items-center justify-center rounded-full border ${
              compact ? 'w-9 h-9' : 'w-11 h-11'
            }`}
            style={{
              backgroundColor: theme.badgeBg,
              borderColor: `${theme.accentHex}88`,
            }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 36 36"
              className="absolute inset-0 w-full h-full -rotate-90"
            >
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="#182630"
                strokeWidth="2.4"
              />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke={theme.secondaryHex}
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
              />
            </svg>
            <div className="relative flex items-center justify-center">
              {toast.form >= 4 ? (
                <Crown
                  className={compact ? 'w-4 h-4' : 'w-5 h-5'}
                  style={{ color: theme.accentHex }}
                />
              ) : (
                <Zap
                  className={compact ? 'w-4 h-4' : 'w-5 h-5'}
                  style={{ color: theme.accentHex }}
                />
              )}
              <ChevronsUp
                className="w-3 h-3 absolute -top-1.5 -right-2 drop-shadow"
                style={{ color: theme.secondaryHex }}
              />
            </div>
          </div>

          {/* Form Name & Metamorphosis Tier */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-mono-num font-semibold tracking-wider uppercase leading-none">
              <span style={{ color: theme.accentHex }} className="whitespace-nowrap">
                {compact
                  ? `Form ${toast.form} · Lv.${toast.level}`
                  : `New Evolution Form · Lv.${toast.level}`}
              </span>
            </div>
            <div
              className={`font-display font-bold text-[#f7f2e7] truncate leading-tight ${
                compact ? 'text-[13px] mt-0.5' : 'text-base mt-0.5'
              }`}
            >
              {formName}
            </div>
            <div
              className={`flex items-center gap-2 font-mono-num text-[#cbd5e1] ${
                compact ? 'text-[9.5px] mt-0.5' : 'text-[10.5px] mt-1'
              }`}
            >
              <span
                className="inline-flex items-center gap-1 font-semibold whitespace-nowrap"
                style={{ color: theme.secondaryHex }}
              >
                <Gauge className="w-3 h-3 shrink-0" aria-hidden="true" />
                +18% Spd
              </span>
              <span
                className="inline-flex items-center gap-1 font-semibold whitespace-nowrap"
                style={{ color: theme.accentHex }}
              >
                <Swords className="w-3 h-3 shrink-0" aria-hidden="true" />
                +15% Bite
              </span>
              <span className="ml-auto text-[#f3e6c8] font-bold whitespace-nowrap">
                {effectiveRemaining.toFixed(1)}s
              </span>
            </div>
          </div>
        </div>

        {/* Recessed Duration Bar */}
        <div className="compendium-track h-1 w-full overflow-hidden">
          <div
            className="h-full transition-[width] duration-100 ease-linear"
            style={{
              width: `${progressPct}%`,
              background: theme.barGradient,
            }}
          />
        </div>
      </div>
    </div>
  );
};

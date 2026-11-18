import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Gamepad2, Keyboard, Smartphone, X } from 'lucide-react';
import { ACTIVE_ABILITIES, EVOLUTION_MILESTONES } from '../data/abilities';

interface HowToPlayModalProps {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}

const ESTABLISHED_RULES = [
  'The match contains exactly 100 cell units (fragments).',
  'Defeated Kelis leave edible remains containing their full level.',
  'Eating adds the remains’ level to the eater’s level.',
  'Levels 1–39 are fully aquatic.',
  'Levels 40–79 have arms and a fish tail. They can fight ashore temporarily, then suffer health degeneration.',
  'Level 80 adds legs, permanent land access and Hunter Sonar.',
  'Hunter Sonar detects living Kelis with a strictly lower level.',
  'Reaching level 100 wins the match.',
];

function detectTouchCapable(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || coarse;
}

export const HowToPlayModal: React.FC<HowToPlayModalProps> = ({
  open,
  onClose,
  returnFocusRef,
}) => {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [isTouchPrimary, setIsTouchPrimary] = useState<boolean>(() => detectTouchCapable());
  const [viewBindingsMode, setViewBindingsMode] = useState<'touch' | 'desktop'>(() =>
    detectTouchCapable() ? 'touch' : 'desktop'
  );

  useEffect(() => {
    const syncDevice = () => {
      const touch = detectTouchCapable();
      setIsTouchPrimary(touch);
      setViewBindingsMode((prev) => (touch && window.innerWidth < 1024 ? 'touch' : prev));
    };
    window.addEventListener('resize', syncDevice);
    return () => window.removeEventListener('resize', syncDevice);
  }, []);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const rafId = window.requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      const restoreTarget = returnFocusRef?.current ?? previousFocusRef.current;
      restoreTarget?.focus?.();
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;

  const coreBindings =
    viewBindingsMode === 'touch'
      ? [
          { input: 'Left Virtual Joystick', action: 'Swim & Crawl Movement' },
          { input: 'Joystick Aim + Auto-Track', action: 'Aim Direction (locks on prey in bite windup)' },
          { input: 'Right BITE / FEED Dial', action: 'Tap to Bite · Hold near remains to Consume' },
          { input: 'Bottom Hotbar Slots & Sonar Dish', action: 'Tap unlocked Abilities when ready' },
          { input: 'Emote Button', action: 'Open Quick-Access Emote Wheel' },
          { input: 'Top-Right Pause Button', action: 'Pause Match & Audio/HUD Options' },
        ]
      : [
          { input: 'WASD / Arrow Keys', action: 'Swim & Crawl Movement' },
          { input: 'Mouse Cursor', action: 'Aim Direction' },
          { input: 'Left Click / Space', action: 'Bite & Feed (hold on remains to consume)' },
          { input: 'G (Hold or Tap) / 1–6', action: 'Quick-Access Emote Wheel' },
          { input: 'M / V (Multiplayer)', action: 'Toggle Mic / Push-to-Talk Voice' },
          { input: 'Esc', action: 'Pause & Match Options' },
        ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#04090d]/85 p-3 sm:p-5"
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(12px, env(safe-area-inset-left))',
        paddingRight: 'max(12px, env(safe-area-inset-right))',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-to-play-title"
        className="compendium-plaque w-full max-w-2xl max-h-[min(88dvh,760px)] flex flex-col rounded-sm overflow-hidden"
      >
        <div className="compendium-ribbon flex items-center justify-between gap-3 px-4 sm:px-5 py-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="w-4 h-4 text-[#f3d285] shrink-0" aria-hidden="true" />
            <h2
              id="how-to-play-title"
              className="font-display text-lg sm:text-xl font-semibold text-[#f3d285] truncate"
            >
              How to Play · Wang Kelian Rules
            </h2>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close How to Play"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[2px] border border-[#8a6a31] bg-[#142029] text-[#f7f2e7] hover:border-[#f3d285] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Close</span>
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain space-y-6 text-sm text-[#dce3e6]">
          {/* Core Rules */}
          <section aria-labelledby="rules-heading" className="space-y-3">
            <h3
              id="rules-heading"
              className="font-display text-base font-semibold text-[#f3d285]"
            >
              ◆ Basin Laws & Evolution Rules
            </h3>
            <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {ESTABLISHED_RULES.map((rule, idx) => (
                <li
                  key={rule}
                  className="compendium-plaque-subtle rounded-[2px] p-3 flex items-start gap-2.5 text-xs sm:text-[13px] leading-relaxed"
                >
                  <span className="font-mono-num font-bold text-[#f3d285] shrink-0 mt-0.5">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[#e6e4dd]">{rule}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Device-Derived Controls */}
          <section aria-labelledby="controls-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Gamepad2 className="w-4 h-4 text-[#f3d285]" aria-hidden="true" />
                <h3
                  id="controls-heading"
                  className="font-display text-base font-semibold text-[#f3d285]"
                >
                  Controls ({isTouchPrimary ? 'Touch Detected' : 'Keyboard & Mouse Detected'})
                </h3>
              </div>

              <div className="compendium-track inline-flex items-center gap-1 p-1 rounded-[2px]">
                <button
                  type="button"
                  onClick={() => setViewBindingsMode('desktop')}
                  aria-pressed={viewBindingsMode === 'desktop'}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] ${
                    viewBindingsMode === 'desktop'
                      ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                      : 'text-[#a9b9c2] hover:text-white'
                  }`}
                >
                  <Keyboard className="w-3 h-3" aria-hidden="true" />
                  Keyboard & Mouse
                </button>
                <button
                  type="button"
                  onClick={() => setViewBindingsMode('touch')}
                  aria-pressed={viewBindingsMode === 'touch'}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] ${
                    viewBindingsMode === 'touch'
                      ? 'bg-[#c99c4a] text-[#0b1218] font-semibold'
                      : 'text-[#a9b9c2] hover:text-white'
                  }`}
                >
                  <Smartphone className="w-3 h-3" aria-hidden="true" />
                  Touch
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {coreBindings.map((b) => (
                <div
                  key={b.input}
                  className="compendium-plaque-subtle rounded-[2px] px-3 py-2.5 flex flex-col gap-0.5"
                >
                  <span className="font-mono-num text-xs font-semibold text-[#f3d285]">
                    {b.input}
                  </span>
                  <span className="text-xs text-[#cbd5e1]">{b.action}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Ability Unlocks Derived Directly From ACTIVE_ABILITIES */}
          <section aria-labelledby="abilities-heading" className="space-y-3">
            <h3
              id="abilities-heading"
              className="font-display text-base font-semibold text-[#f3d285]"
            >
              ◆ Evolution Ability Bindings
            </h3>
            <div className="space-y-2">
              {ACTIVE_ABILITIES.map((ab) => {
                const keyLabel =
                  viewBindingsMode === 'touch'
                    ? ab.id === 'bite'
                      ? 'BITE / FEED Dial'
                      : ab.id === 'sonar'
                        ? 'Sonar Dish'
                        : `${ab.name} Slot`
                    : ab.key;
                return (
                  <div
                    key={ab.id}
                    className="compendium-plaque-subtle rounded-[2px] px-3 py-2.5 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#f7f2e7] text-xs sm:text-sm">
                          {ab.name}
                        </span>
                        <span className="font-mono-num text-[11px] text-[#5eead4]">
                          Lv.{ab.unlockLevel}
                        </span>
                      </div>
                      <p className="text-xs text-[#a9b9c2] mt-0.5 leading-relaxed">
                        {ab.description}
                      </p>
                    </div>
                    <span className="font-mono-num text-[11px] font-semibold px-2 py-1 rounded-[2px] border border-[#5b4724] bg-[#0b1218] text-[#f3d285] whitespace-nowrap shrink-0">
                      {keyLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Key Evolution Thresholds */}
          <section aria-labelledby="milestones-heading" className="space-y-2.5">
            <h3
              id="milestones-heading"
              className="font-display text-base font-semibold text-[#f3d285]"
            >
              ◆ Evolution Progression (Lv.1 → Lv.100)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {EVOLUTION_MILESTONES.filter((m) =>
                [1, 20, 40, 60, 80, 100].includes(m.level)
              ).map((m) => (
                <div
                  key={m.level}
                  className="compendium-plaque-subtle rounded-[2px] px-3 py-2 flex items-start gap-2.5"
                >
                  <span className="font-mono-num font-bold text-[#f3d285] shrink-0">
                    Lv.{m.level}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-[#f7f2e7]">{m.title}</div>
                    <div className="text-[#9cb0ba] leading-snug">{m.shortRule}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="border-t border-[#263643] bg-[#0b1319] px-4 sm:px-5 py-3 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-[2px] border border-[#f3d285]/45 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285]"
          >
            Back to Title Menu
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, HeartHandshake, X } from 'lucide-react';
import { registerAndroidBackHandler } from '../game/androidNative';
import { soundEngine } from '../game/audio';
import { resolveVoluntarySupportConfig } from '../game/support';

export interface VoluntarySupportControlProps {
  variant: 'title' | 'postmatch';
  compact?: boolean;
  disabled?: boolean;
  reducedMotion?: boolean;
  className?: string;
}

export const SUPPORT_COPY = {
  buttonLabel: 'Belanja Keli Makan 🐟',
  panelTitle: 'Belanja Keli Makan 🐟',
  description:
    'Suka main AWANG KELI? Belanja keli makan untuk membantu pembangunan game dan kos server multiplayer.',
  supportingText:
    'Sokongan anda adalah sukarela. Semua pemain tetap boleh bermain secara percuma. Tiada kelebihan gameplay diberikan.',
  externalNote: 'Checkout Stripe akan dibuka secara berasingan dalam tab atau tetingkap baharu.',
  primaryCta: 'Sokong melalui Stripe',
  secondaryCta: 'Teruskan bermain',
  closeLabel: 'Tutup panel Belanja Keli Makan',
} as const;

export const VoluntarySupportControl: React.FC<VoluntarySupportControlProps> = ({
  variant,
  compact = false,
  disabled = false,
  reducedMotion = false,
  className = '',
}) => {
  const support = useMemo(() => resolveVoluntarySupportConfig(), []);
  const [open, setOpen] = useState(false);

  const headingId = useId();
  const descriptionId = useId();

  const triggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        triggerBtnRef.current?.focus?.();
      }
      return;
    }

    wasOpenRef.current = true;

    const unsubBack = registerAndroidBackHandler(() => {
      setOpen(false);
      return true;
    }, 30);

    const rafId = window.requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
      unsubBack();
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!support.enabled || !support.url) {
    return null;
  }

  const handleOpen = () => {
    if (disabled) return;
    soundEngine.unlockFromGesture();
    soundEngine.playUiConfirm(true);
    setOpen(true);
  };

  const handleClose = () => {
    soundEngine.playUiConfirm(true);
    setOpen(false);
  };

  const motionClass = reducedMotion
    ? 'transition-colors duration-100'
    : 'transition-all duration-150 active:scale-[0.98]';

  const triggerClasses =
    variant === 'title'
      ? `inline-flex items-center justify-center gap-1.5 rounded-[3px] border border-[#34d399]/35 bg-[#0a181e]/88 text-[#e7f3ec] shadow-[0_4px_14px_rgba(0,0,0,0.45)] hover:border-[#f3d285]/75 hover:bg-[#0e2128]/95 hover:text-[#fff6dd] disabled:opacity-50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] focus-visible:ring-offset-2 focus-visible:ring-offset-[#091116] font-medium tracking-[0.015em] whitespace-nowrap ${
          compact ? 'px-3 py-1.5 text-[11px] min-h-[34px]' : 'px-3.5 py-1.5 text-xs min-h-[36px]'
        } ${motionClass}`
      : `inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs sm:text-sm font-medium rounded-[2px] border border-[#34d399]/40 bg-[#0d1f26] text-[#d8efe3] hover:border-[#f3d285]/80 hover:bg-[#122a33] hover:text-[#fff6dd] disabled:opacity-50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] focus-visible:ring-offset-2 focus-visible:ring-offset-[#091116] whitespace-nowrap ${motionClass}`;

  const modalContent =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            data-testid="voluntary-support-backdrop"
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#04090d]/85 p-3 sm:p-5"
            style={{
              paddingTop: 'max(12px, env(safe-area-inset-top))',
              paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
              paddingLeft: 'max(12px, env(safe-area-inset-left))',
              paddingRight: 'max(12px, env(safe-area-inset-right))',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                handleClose();
              }
            }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={headingId}
              aria-describedby={descriptionId}
              data-testid="voluntary-support-dialog"
              className="compendium-plaque w-full max-w-md max-h-[min(88dvh,540px)] flex flex-col rounded-sm overflow-hidden"
            >
              <div className="compendium-ribbon flex items-center justify-between gap-3 px-4 sm:px-5 py-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <HeartHandshake className="w-4 h-4 text-[#5eead4] shrink-0" aria-hidden="true" />
                  <h2
                    id={headingId}
                    className="font-display text-lg font-semibold text-[#f3d285] truncate"
                  >
                    {SUPPORT_COPY.panelTitle}
                  </h2>
                </div>

                <button
                  ref={closeBtnRef}
                  type="button"
                  onClick={handleClose}
                  aria-label={SUPPORT_COPY.closeLabel}
                  className="p-1.5 rounded-[2px] border border-[#5b4724] bg-[#0b1218] text-[#d9b25f] hover:border-[#f3d285] hover:text-[#f7f2e7] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="p-4 sm:p-5 space-y-4 overflow-y-auto text-sm text-[#d6dfd9]">
                <p id={descriptionId} className="text-[13.5px] sm:text-sm text-[#f3efe6] leading-relaxed">
                  {SUPPORT_COPY.description}
                </p>

                <div className="p-3 rounded-[2px] border border-[#24444a] bg-[#0a171d]/90 text-xs sm:text-[13px] text-[#b8cfc9] leading-relaxed">
                  {SUPPORT_COPY.supportingText}
                </div>

                <p className="flex items-start gap-2 text-[11.5px] text-[#9cb4bc] leading-relaxed">
                  <ExternalLink className="w-3.5 h-3.5 text-[#5eead4] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{SUPPORT_COPY.externalNote}</span>
                </p>

                <div className="flex flex-col gap-2.5 pt-1">
                  <a
                    href={support.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="voluntary-support-stripe-link"
                    className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-[2px] border border-[#f3d285]/50 bg-[#c99c4a] text-[#091116] hover:bg-[#dfb35f] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] focus-visible:ring-offset-2 focus-visible:ring-offset-[#091116] ${motionClass}`}
                  >
                    <span>{SUPPORT_COPY.primaryCta}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  </a>

                  <button
                    type="button"
                    onClick={handleClose}
                    data-testid="voluntary-support-dismiss-btn"
                    className={`w-full inline-flex items-center justify-center px-4 py-2.5 text-xs sm:text-sm font-medium rounded-[2px] border border-[#2d404d] bg-[#0b1218] text-[#c7d1cd] hover:border-[#c99c4a] hover:text-[#f7f2e7] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] focus-visible:ring-offset-2 focus-visible:ring-offset-[#091116] ${motionClass}`}
                  >
                    {SUPPORT_COPY.secondaryCta}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={triggerBtnRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={`voluntary-support-trigger-${variant}`}
        className={`${triggerClasses} ${className}`.trim()}
      >
        <span>{SUPPORT_COPY.buttonLabel}</span>
      </button>
      {modalContent}
    </>
  );
};

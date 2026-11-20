import React, { useEffect, useRef } from 'react';
import {
  KELI_KING_GRID_COLS,
  KELI_KING_ROW,
  KELI_KING_SHEET_META,
} from '../game/spriteAnimation';
import { resolveAssetUrl } from '../utils/assetUrl';

interface KeliKingShowcaseProps {
  championName?: string;
  reducedMotion?: boolean;
  /** Play Row 1 Victory once before transitioning into Row 0 Regal Idle */
  playVictoryIntro?: boolean;
}

// Module-level cached image so reopening PostMatchScreen never reloads the WebP sheet
let cachedKingImg: HTMLImageElement | null = null;
let cachedKingLoaded = false;
const listeners = new Set<() => void>();

function ensureKingImage(): HTMLImageElement | null {
  if (typeof window === 'undefined') return null;
  if (!cachedKingImg) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      cachedKingLoaded = true;
      listeners.forEach((fn) => fn());
    };
    img.src = resolveAssetUrl(KELI_KING_SHEET_META.assetPath);
    cachedKingImg = img;
  }
  return cachedKingImg;
}

export const KeliKingShowcase: React.FC<KeliKingShowcaseProps> = ({
  championName,
  reducedMotion = false,
  playVictoryIntro = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = ensureKingImage();
    let rafId = 0;
    let phase: 'victory' | 'idle' = playVictoryIntro && !reducedMotion ? 'victory' : 'idle';
    let phaseElapsed = 0;
    let lastTs = performance.now();

    const drawFrame = (now: number) => {
      const dt = Math.min(0.08, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;
      phaseElapsed += dt;

      let row: number = KELI_KING_ROW.idle;
      let col = 0;

      if (phase === 'victory') {
        row = KELI_KING_ROW.victory;
        const idx = Math.floor(phaseElapsed * KELI_KING_SHEET_META.victoryFps);
        if (idx >= KELI_KING_GRID_COLS) {
          phase = 'idle';
          phaseElapsed = 0;
          row = KELI_KING_ROW.idle;
          col = 0;
        } else {
          col = idx;
        }
      } else {
        row = KELI_KING_ROW.idle;
        const fps = reducedMotion ? 2.5 : KELI_KING_SHEET_META.idleFps;
        col = Math.floor(phaseElapsed * fps) % KELI_KING_GRID_COLS;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Subtle warm golden pedestal glow behind the sprite
      const pulse = reducedMotion ? 0 : Math.sin(now * 0.0032);
      const cx = w * 0.5;
      const cy = h * 0.56;
      const halo = ctx.createRadialGradient(cx, cy, w * 0.06, cx, cy, w * 0.48);
      halo.addColorStop(0, `rgba(255, 226, 138, ${0.26 + pulse * 0.04})`);
      halo.addColorStop(0.55, 'rgba(201, 156, 74, 0.10)');
      halo.addColorStop(1, 'rgba(201, 156, 74, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      // Subtle elliptical ground shadow under feet
      ctx.save();
      ctx.fillStyle = 'rgba(4, 10, 15, 0.55)';
      ctx.beginPath();
      ctx.ellipse(cx, h * 0.89, w * 0.3, h * 0.055, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (img && cachedKingLoaded && img.naturalWidth > 0) {
        const sx = col * KELI_KING_SHEET_META.cellWidth;
        const sy = row * KELI_KING_SHEET_META.cellHeight;
        const sw = KELI_KING_SHEET_META.cellWidth;
        const sh = KELI_KING_SHEET_META.cellHeight;

        const pad = 10;
        const scale = Math.min((w - pad * 2) / sw, (h - pad * 2) / sh);
        const dw = Math.round(sw * scale);
        const dh = Math.round(sh * scale);
        const dx = Math.round((w - dw) * 0.5);
        const dy = Math.round(h - dh - 8);

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      }

      rafId = requestAnimationFrame(drawFrame);
    };

    const onLoaded = () => {
      // Next RAF frame immediately paints the loaded sprite
    };
    listeners.add(onLoaded);
    rafId = requestAnimationFrame(drawFrame);

    return () => {
      listeners.delete(onLoaded);
      cancelAnimationFrame(rafId);
    };
  }, [playVictoryIntro, reducedMotion]);

  return (
    <div className="relative flex flex-col items-center justify-center shrink-0">
      <div className="relative rounded-[2px] border border-[#c99c4a]/50 bg-[#0b141c]/90 p-2 shadow-[0_0_28px_rgba(201,156,74,0.18)]">
        <canvas
          ref={canvasRef}
          width={240}
          height={232}
          aria-label={championName ? `${championName} as Level 100 Keli King` : 'Level 100 Keli King'}
          className="block w-40 h-[154px] sm:w-48 sm:h-[185px]"
          style={{ imageRendering: 'pixelated' }}
        />
        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-[#3b2f19] pt-1.5 px-1">
          <span className="text-[10px] font-mono-num font-semibold uppercase tracking-wider text-[#f3d285]">
            LV.100 KELI KING
          </span>
          {championName && (
            <span className="text-[10px] font-medium text-[#e6dfd1] truncate max-w-[96px]">
              {championName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

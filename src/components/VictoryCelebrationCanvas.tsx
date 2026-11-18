import React, { useEffect, useRef, useState } from 'react';

interface VictoryCelebrationCanvasProps {
  reducedMotion?: boolean;
}

interface FireworkRocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetY: number;
  color: string;
  trail: Array<{ x: number; y: number }>;
}

interface FireworkSpark {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  alpha: number;
  decay: number;
  radius: number;
  color: string;
  twinkleOffset: number;
}

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  rotation: number;
  rotationSpeed: number;
  tiltAngle: number;
  tiltSpeed: number;
  swayPhase: number;
  swaySpeed: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

// Wang Kelian celebratory palette: burnished brass, gold highlights, Aisyah's red paper boat,
// Jantung Tasik aqua glow, and warm ivory parchment.
const VICTORY_PALETTE = [
  '#f3d285',
  '#c99c4a',
  '#fde68a',
  '#e05245',
  '#f87171',
  '#5eead4',
  '#38bdf8',
  '#f7f2e7',
] as const;

const FIREWORK_PALETTES: ReadonlyArray<readonly string[]> = [
  ['#f3d285', '#fde68a', '#f7f2e7', '#c99c4a'],
  ['#e05245', '#f87171', '#f3d285', '#fde68a'],
  ['#5eead4', '#38bdf8', '#f7f2e7', '#f3d285'],
];

const MAX_SPARKS = 420;
const MAX_CONFETTI = 160;

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function drawStaticCelebrationFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);

  // Subtle decorative static bursts in upper corners for reduced-motion preference
  const anchors = [
    { cx: width * 0.14, cy: height * 0.16, palette: FIREWORK_PALETTES[0] },
    { cx: width * 0.86, cy: height * 0.18, palette: FIREWORK_PALETTES[2] },
  ];

  for (const anchor of anchors) {
    const rays = 14;
    for (let i = 0; i < rays; i += 1) {
      const angle = (Math.PI * 2 * i) / rays;
      const dist = 24 + (i % 3) * 16;
      const x = anchor.cx + Math.cos(angle) * dist;
      const y = anchor.cy + Math.sin(angle) * dist;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = anchor.palette[i % anchor.palette.length];
      ctx.beginPath();
      ctx.arc(x, y, i % 2 === 0 ? 2.6 : 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

export const VictoryCelebrationCanvas: React.FC<VictoryCelebrationCanvasProps> = ({
  reducedMotion = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [osReducedMotion, setOsReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => {
      setOsReducedMotion(event.matches);
    };
    mq.addEventListener?.('change', handleChange);
    return () => {
      mq.removeEventListener?.('change', handleChange);
    };
  }, []);

  const isReducedMotion = reducedMotion || osReducedMotion;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (isReducedMotion) {
        drawStaticCelebrationFrame(ctx, width, height);
      }
    };

    resize();
    window.addEventListener('resize', resize);

    if (isReducedMotion) {
      return () => {
        window.removeEventListener('resize', resize);
      };
    }

    const rockets: FireworkRocket[] = [];
    const sparks: FireworkSpark[] = [];
    const confetti: ConfettiPiece[] = [];

    const spawnConfettiBurst = (originX: number, originY: number, count: number, spreadUp = true) => {
      for (let i = 0; i < count; i += 1) {
        if (confetti.length >= MAX_CONFETTI) break;
        const angle = spreadUp
          ? -Math.PI / 2 + (Math.random() - 0.5) * 1.45
          : Math.random() * Math.PI * 2;
        const speed = spreadUp ? 220 + Math.random() * 320 : 80 + Math.random() * 190;
        const maxLife = 3.8 + Math.random() * 2.4;
        confetti.push({
          x: originX + (Math.random() - 0.5) * 28,
          y: originY + (Math.random() - 0.5) * 16,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          width: 6 + Math.random() * 5,
          height: 3.5 + Math.random() * 3.5,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 8,
          tiltAngle: Math.random() * Math.PI * 2,
          tiltSpeed: 4 + Math.random() * 6,
          swayPhase: Math.random() * Math.PI * 2,
          swaySpeed: 2.2 + Math.random() * 2.4,
          color: pickRandom(VICTORY_PALETTE),
          alpha: 0.92,
          life: 0,
          maxLife,
        });
      }
    };

    const explodeFirework = (x: number, y: number, primaryColor?: string) => {
      const palette = pickRandom(FIREWORK_PALETTES);
      const count = 34 + Math.floor(Math.random() * 18);
      for (let i = 0; i < count; i += 1) {
        if (sparks.length >= MAX_SPARKS) break;
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.18;
        const speed = 75 + Math.random() * 210;
        sparks.push({
          x,
          y,
          prevX: x,
          prevY: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 0.95,
          decay: 0.52 + Math.random() * 0.42,
          radius: 1.6 + Math.random() * 1.9,
          color: i % 5 === 0 && primaryColor ? primaryColor : pickRandom(palette),
          twinkleOffset: Math.random() * Math.PI * 2,
        });
      }
      // Accent inner ring of brighter gold embers
      const innerCount = 12;
      for (let i = 0; i < innerCount; i += 1) {
        if (sparks.length >= MAX_SPARKS) break;
        const angle = (Math.PI * 2 * i) / innerCount;
        const speed = 42 + Math.random() * 48;
        sparks.push({
          x,
          y,
          prevX: x,
          prevY: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          decay: 0.72 + Math.random() * 0.3,
          radius: 1.4,
          color: '#f7f2e7',
          twinkleOffset: Math.random() * Math.PI * 2,
        });
      }
    };

    const launchRocket = (side?: 'left' | 'right' | 'center') => {
      const startX =
        side === 'left'
          ? width * (0.1 + Math.random() * 0.16)
          : side === 'right'
            ? width * (0.74 + Math.random() * 0.16)
            : width * (0.24 + Math.random() * 0.52);
      const targetY = height * (0.14 + Math.random() * 0.28);
      const color = pickRandom(VICTORY_PALETTE);
      rockets.push({
        x: startX,
        y: height + 10,
        vx: (Math.random() - 0.5) * 65,
        vy: -(520 + Math.random() * 190),
        targetY,
        color,
        trail: [],
      });
    };

    // Immediate opening celebration volley on victory arrival
    explodeFirework(width * 0.2, height * 0.24, '#f3d285');
    explodeFirework(width * 0.8, height * 0.22, '#5eead4');
    spawnConfettiBurst(width * 0.16, height * 0.32, 32, true);
    spawnConfettiBurst(width * 0.84, height * 0.32, 32, true);
    launchRocket('center');

    let rafId = 0;
    let lastTs = performance.now();
    let elapsed = 0;
    let nextRocketAt = 0.55;
    let nextConfettiAt = 0.9;
    let paused = typeof document !== 'undefined' && document.hidden;

    const handleVisibilityChange = () => {
      paused = document.hidden;
      if (!paused) {
        lastTs = performance.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const step = (now: number) => {
      rafId = window.requestAnimationFrame(step);
      if (paused) return;

      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      elapsed += dt;

      // Choreographed volleys for the first 6.5s, followed by gentle celebratory embers
      if (elapsed >= nextRocketAt) {
        if (elapsed < 6.5) {
          const sides: Array<'left' | 'right' | 'center'> = ['left', 'right', 'center'];
          launchRocket(pickRandom(sides));
          nextRocketAt = elapsed + 0.65 + Math.random() * 0.55;
        } else {
          launchRocket(Math.random() < 0.5 ? 'left' : 'right');
          nextRocketAt = elapsed + 2.4 + Math.random() * 1.8;
        }
      }

      if (elapsed >= nextConfettiAt) {
        if (elapsed < 5.0) {
          const xPos = width * (0.12 + Math.random() * 0.76);
          spawnConfettiBurst(xPos, -10, 14, false);
          nextConfettiAt = elapsed + 0.85 + Math.random() * 0.45;
        } else {
          // Light celebratory drift from upper edge
          const xPos = width * (0.08 + Math.random() * 0.84);
          spawnConfettiBurst(xPos, -12, 4, false);
          nextConfettiAt = elapsed + 1.8 + Math.random() * 1.1;
        }
      }

      ctx.clearRect(0, 0, width, height);

      // Update & draw rising rockets
      for (let i = rockets.length - 1; i >= 0; i -= 1) {
        const r = rockets[i];
        r.trail.push({ x: r.x, y: r.y });
        if (r.trail.length > 7) {
          r.trail.shift();
        }
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.vy += 320 * dt;

        // Draw rocket tail
        if (r.trail.length > 1) {
          ctx.save();
          ctx.strokeStyle = r.color;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.globalAlpha = 0.65;
          ctx.beginPath();
          ctx.moveTo(r.trail[0].x, r.trail[0].y);
          for (let j = 1; j < r.trail.length; j += 1) {
            ctx.lineTo(r.trail[j].x, r.trail[j].y);
          }
          ctx.lineTo(r.x, r.y);
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.fillStyle = '#f7f2e7';
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (r.y <= r.targetY || r.vy >= -40) {
          explodeFirework(r.x, r.y, r.color);
          if (confetti.length < MAX_CONFETTI - 12 && elapsed < 7.0) {
            spawnConfettiBurst(r.x, r.y, 8, false);
          }
          rockets.splice(i, 1);
        }
      }

      // Update & draw firework sparks
      const sparkDrag = Math.pow(0.24, dt);
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const s = sparks[i];
        s.prevX = s.x;
        s.prevY = s.y;
        s.vx *= sparkDrag;
        s.vy = s.vy * sparkDrag + 175 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.alpha -= s.decay * dt;

        if (s.alpha <= 0.02) {
          sparks.splice(i, 1);
          continue;
        }

        const twinkle = 0.78 + 0.22 * Math.sin(elapsed * 18 + s.twinkleOffset);
        const drawAlpha = Math.max(0, Math.min(1, s.alpha * twinkle));

        ctx.save();
        ctx.globalAlpha = drawAlpha * 0.78;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.radius;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.prevX, s.prevY);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();

        ctx.globalAlpha = drawAlpha;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Update & draw tumbling confetti ribbons
      const confettiDrag = Math.pow(0.42, dt);
      for (let i = confetti.length - 1; i >= 0; i -= 1) {
        const c = confetti[i];
        c.life += dt;
        c.vx *= confettiDrag;
        c.vy = Math.min(195, c.vy * Math.pow(0.75, dt) + 215 * dt);
        c.swayPhase += c.swaySpeed * dt;
        c.x += (c.vx + Math.sin(c.swayPhase) * 34) * dt;
        c.y += c.vy * dt;
        c.rotation += c.rotationSpeed * dt;
        c.tiltAngle += c.tiltSpeed * dt;

        const fadeRatio = c.life > c.maxLife * 0.7
          ? 1 - (c.life - c.maxLife * 0.7) / (c.maxLife * 0.3)
          : 1;
        const drawAlpha = Math.max(0, Math.min(1, c.alpha * fadeRatio));

        if (c.life >= c.maxLife || c.y > height + 30 || drawAlpha <= 0.01) {
          confetti.splice(i, 1);
          continue;
        }

        const flutterScale = 0.25 + 0.75 * Math.abs(Math.cos(c.tiltAngle));
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rotation);
        ctx.globalAlpha = drawAlpha * 0.88;
        ctx.fillStyle = c.color;
        ctx.fillRect(
          -c.width * 0.5,
          (-c.height * flutterScale) * 0.5,
          c.width,
          c.height * flutterScale
        );
        ctx.restore();
      }
    };

    rafId = window.requestAnimationFrame(step);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      ctx.clearRect(0, 0, width, height);
    };
  }, [isReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="victory-celebration-canvas"
      aria-hidden="true"
      className="fixed inset-0 z-20 pointer-events-none w-full h-full"
    />
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { EvolutionForm } from '../game/types';

export interface EvolutionOverlayEvent {
  form: EvolutionForm;
  level: number;
  key: number;
}

interface EvolutionOverlayProps {
  event: EvolutionOverlayEvent | null;
  reducedMotion: boolean;
  onComplete?: () => void;
}

interface FormVisualSpec {
  kicker: string;
  title: string;
  detail: string;
  colors: string[];
  coreColor: string;
  ringColor: string;
  accentHex: string;
}

function getFormVisualSpec(form: EvolutionForm, level: number): FormVisualSpec {
  switch (form) {
    case 2:
      return {
        kicker: `Evolution · Lv.${level} / 100`,
        title: 'FIRST REFORMATION — SHORE ACCESS UNLOCKED',
        detail: 'Muscular forelimbs formed (no legs) · Bite stuns · 10s shore raids unlocked',
        colors: ['#f3d285', '#e69f45', '#5eead4', '#4ade80'],
        coreColor: '#fde68a',
        ringColor: '#f59e0b',
        accentHex: '#f3d285',
      };
    case 3:
      return {
        kicker: `Evolution · Lv.${level} / 100`,
        title: 'AMPHIBIOUS ASCENSION — LAND & WATER DOMINION',
        detail: 'Full amphibious anatomy · Permanent land access · Hunter Sonar unlocked',
        colors: ['#38bdf8', '#4ade80', '#fbbf24', '#bae6fd'],
        coreColor: '#a5f3fc',
        ringColor: '#38bdf8',
        accentHex: '#7dd3fc',
      };
    case 4:
    default:
      return {
        kicker: 'ALL 100 FRAGMENTS REUNITED · LV.100',
        title: 'KELI KING',
        detail: 'Raja Keli, Supreme Amphibious Colossus of Wang Kelian · Match Victory',
        colors: ['#fde68a', '#f59e0b', '#4ade80', '#fffbeb'],
        coreColor: '#fffbeb',
        ringColor: '#fbbf24',
        accentHex: '#fde68a',
      };
  }
}

interface ConvergeMote {
  startAngle: number;
  startDist: number;
  spin: number;
  size: number;
  color: string;
  delay: number;
  prevX: number;
  prevY: number;
}

interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  drag: number;
  buoyancy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  color: string;
  kind: 'shard' | 'orb' | 'droplet';
  rot: number;
  rotSpeed: number;
  swayPhase: number;
  swayAmp: number;
}

interface LightStreak {
  angle: number;
  speed: number;
  length: number;
  width: number;
  color: string;
  life: number;
  maxLife: number;
}

interface HelixSpark {
  angleOffset: number;
  radius: number;
  riseSpeed: number;
  spinSpeed: number;
  size: number;
  color: string;
  phase: number;
}

export const EvolutionOverlay: React.FC<EvolutionOverlayProps> = ({
  event,
  reducedMotion,
  onComplete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [crestVisible, setCrestVisible] = useState(false);

  useEffect(() => {
    if (!event || event.form < 2) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const spec = getFormVisualSpec(event.form, event.level);
    const totalDuration = reducedMotion ? 1.85 : event.form === 4 ? 2.4 : 2.15;
    const burstTime = reducedMotion ? 0.05 : 0.32;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
    };
    resize();
    window.addEventListener('resize', resize);

    const cx = () => width * 0.5;
    const cy = () => height * 0.49;

    const pickColor = (i: number) => spec.colors[i % spec.colors.length];

    // Phase 1: Fragment motes spiraling inward
    const convergeCount = event.form === 4 ? 42 : 32;
    const convergeMotes: ConvergeMote[] = reducedMotion
      ? []
      : Array.from({ length: convergeCount }, (_, i) => {
          const angle = (i / convergeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
          const dist = Math.min(width, height) * (0.24 + Math.random() * 0.22);
          return {
            startAngle: angle,
            startDist: dist,
            spin: 2.3 + Math.random() * 1.4,
            size: 2.5 + Math.random() * 3.5,
            color: pickColor(i),
            delay: Math.random() * 0.08,
            prevX: cx() + Math.cos(angle) * dist,
            prevY: cy() + Math.sin(angle) * dist,
          };
        });

    // Phase 2: Burst particles, radial streaks, and rising helical sparks
    const burstParticles: BurstParticle[] = [];
    const streaks: LightStreak[] = [];
    const helixCount = reducedMotion ? 22 : event.form === 4 ? 26 : 18;
    const helixSparks: HelixSpark[] = Array.from(
      { length: helixCount },
      (_, i) => ({
        angleOffset: (i / helixCount) * Math.PI * 2,
        radius: 36 + Math.random() * 78,
        riseSpeed: reducedMotion ? 28 + Math.random() * 24 : 78 + Math.random() * 72,
        spinSpeed: reducedMotion ? 0.5 : 3.2 + Math.random() * 1.8,
        size: 2 + Math.random() * 3.2,
        color: pickColor(i),
        phase: Math.random() * Math.PI * 2,
      })
    );

    let burstTriggered = false;
    const spawnBurst = () => {
      if (burstTriggered) return;
      burstTriggered = true;
      const originX = cx();
      const originY = cy();

      if (reducedMotion) {
        for (let i = 0; i < 24; i++) {
          const ang = Math.random() * Math.PI * 2;
          const dist = 24 + Math.random() * 130;
          burstParticles.push({
            x: originX + Math.cos(ang) * dist,
            y: originY + Math.sin(ang) * dist * 0.65,
            vx: (Math.random() - 0.5) * 14,
            vy: -18 - Math.random() * 24,
            drag: 0.985,
            buoyancy: -6,
            size: 2.2 + Math.random() * 3.2,
            alpha: 0.75,
            life: 0,
            maxLife: 1.35 + Math.random() * 0.45,
            color: pickColor(i),
            kind: 'orb',
            rot: 0,
            rotSpeed: 0,
            swayPhase: Math.random() * Math.PI * 2,
            swayAmp: 8,
          });
        }
        return;
      }

      const count = event.form === 4 ? 92 : 68;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
        const speed = 135 + Math.random() * (event.form === 4 ? 410 : 320);
        const kindRoll = Math.random();
        const kind: BurstParticle['kind'] =
          kindRoll < 0.42 ? 'shard' : kindRoll < 0.76 ? 'orb' : 'droplet';
        burstParticles.push({
          x: originX + Math.cos(ang) * 10,
          y: originY + Math.sin(ang) * 10,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed * 0.82 - 36,
          drag: kind === 'shard' ? 0.93 : 0.945,
          buoyancy: kind === 'orb' ? -58 : kind === 'droplet' ? 42 : -22,
          size: kind === 'shard' ? 3.5 + Math.random() * 4.5 : 2 + Math.random() * 3.8,
          alpha: 0.95,
          life: 0,
          maxLife: 0.95 + Math.random() * 0.85,
          color: pickColor(i),
          kind,
          rot: ang,
          rotSpeed: (Math.random() - 0.5) * 8,
          swayPhase: Math.random() * Math.PI * 2,
          swayAmp: 18 + Math.random() * 26,
        });
      }

      const streakCount = event.form === 4 ? 22 : 16;
      for (let i = 0; i < streakCount; i++) {
        const ang = (i / streakCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.14;
        streaks.push({
          angle: ang,
          speed: 440 + Math.random() * 380,
          length: 48 + Math.random() * 68,
          width: 1.5 + Math.random() * 2.4,
          color: pickColor(i),
          life: 0,
          maxLife: 0.44 + Math.random() * 0.24,
        });
      }
    };

    setCrestVisible(false);
    const crestShowTimer = window.setTimeout(() => setCrestVisible(true), reducedMotion ? 40 : 210);
    const crestHideTimer = window.setTimeout(
      () => setCrestVisible(false),
      (totalDuration - 0.32) * 1000
    );

    const startTs = performance.now();
    let prevTs = startTs;
    let rafId = 0;
    let done = false;

    const frame = (now: number) => {
      const elapsed = (now - startTs) / 1000;
      const dt = Math.min(0.05, (now - prevTs) / 1000);
      prevTs = now;

      if (elapsed >= totalDuration) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!done) {
          done = true;
          onCompleteRef.current?.();
        }
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const originX = cx();
      const originY = cy();
      const minDim = Math.min(width, height);

      // Subtle atmospheric edge-bloom pulse during burst
      if (elapsed >= burstTime && elapsed < burstTime + 0.95) {
        const bt = (elapsed - burstTime) / 0.95;
        const glowAlpha = reducedMotion
          ? Math.sin(bt * Math.PI) * 0.12
          : Math.sin(bt * Math.PI) * (event.form === 4 ? 0.24 : 0.17);
        const grad = ctx.createRadialGradient(
          originX,
          originY,
          minDim * 0.08,
          originX,
          originY,
          minDim * 0.62
        );
        grad.addColorStop(0, `${spec.coreColor}00`);
        grad.addColorStop(0.32, `${spec.ringColor}${Math.round(glowAlpha * 255).toString(16).padStart(2, '0')}`);
        grad.addColorStop(1, '#00000000');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      // Phase 1: Converging fragment spiral
      if (!reducedMotion && elapsed < burstTime + 0.08) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const m of convergeMotes) {
          const localT = Math.max(0, Math.min(1, (elapsed - m.delay) / Math.max(0.05, burstTime - m.delay)));
          if (localT <= 0 || localT >= 1) continue;
          const eased = 1 - Math.pow(1 - localT, 2.2);
          const curDist = m.startDist * (1 - eased);
          const curAng = m.startAngle + eased * m.spin;
          const x = originX + Math.cos(curAng) * curDist;
          const y = originY + Math.sin(curAng) * curDist * 0.84;

          ctx.strokeStyle = m.color;
          ctx.lineWidth = m.size * (0.7 + localT * 0.5);
          ctx.globalAlpha = 0.72 * Math.sin(localT * Math.PI);
          ctx.beginPath();
          ctx.moveTo(m.prevX, m.prevY);
          ctx.lineTo(x, y);
          ctx.stroke();

          ctx.fillStyle = spec.coreColor;
          ctx.globalAlpha = 0.9 * (1 - localT * 0.25);
          ctx.beginPath();
          ctx.arc(x, y, m.size * 0.75, 0, Math.PI * 2);
          ctx.fill();

          m.prevX = x;
          m.prevY = y;
        }

        // Gathering core glow just before burst
        const chargeT = Math.min(1, elapsed / burstTime);
        const coreR = 14 + chargeT * 42;
        const coreGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, coreR);
        coreGrad.addColorStop(0, `${spec.coreColor}cc`);
        coreGrad.addColorStop(0.55, `${spec.ringColor}55`);
        coreGrad.addColorStop(1, '#00000000');
        ctx.globalAlpha = chargeT * 0.85;
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(originX, originY, coreR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (elapsed >= burstTime) {
        spawnBurst();
        const postElapsed = elapsed - burstTime;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // Expanding concentric metamorphosis shockwaves
        if (!reducedMotion) {
          const ringWaves = event.form === 4 ? [0, 0.11, 0.22] : [0, 0.12];
          ringWaves.forEach((delay, idx) => {
            const wt = (postElapsed - delay) / 0.82;
            if (wt <= 0 || wt >= 1) return;
            const eased = 1 - Math.pow(1 - wt, 3);
            const r = minDim * (0.04 + eased * (0.44 + idx * 0.08));
            ctx.strokeStyle = idx === 0 ? spec.coreColor : spec.colors[idx % spec.colors.length];
            ctx.lineWidth = Math.max(1, (1 - wt) * (idx === 0 ? 5.5 : 3.2));
            ctx.globalAlpha = (1 - wt) * (idx === 0 ? 0.88 : 0.62);
            ctx.beginPath();
            ctx.ellipse(originX, originY, r, r * 0.78, 0, 0, Math.PI * 2);
            ctx.stroke();
          });
        } else {
          // Calm halo ring for reduced motion
          const rt = Math.min(1, postElapsed / 1.4);
          const alpha = Math.sin(rt * Math.PI) * 0.45;
          const r = 64 + rt * 44;
          ctx.strokeStyle = spec.ringColor;
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.ellipse(originX, originY, r, r * 0.78, 0, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Radial light streaks
        for (const s of streaks) {
          s.life += dt;
          if (s.life >= s.maxLife) continue;
          const st = s.life / s.maxLife;
          const dist = 20 + s.speed * (1 - Math.pow(1 - st, 2)) * 0.48;
          const x1 = originX + Math.cos(s.angle) * dist;
          const y1 = originY + Math.sin(s.angle) * dist * 0.84;
          const x2 = originX + Math.cos(s.angle) * (dist + s.length * (1 - st * 0.55));
          const y2 = originY + Math.sin(s.angle) * (dist + s.length * (1 - st * 0.55)) * 0.84;

          ctx.strokeStyle = s.color;
          ctx.lineWidth = s.width * (1 - st * 0.6);
          ctx.globalAlpha = (1 - st) * 0.85;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Rising helical mutation motes framing the creature silhouette
        const helixAlpha =
          postElapsed < 0.2
            ? postElapsed / 0.2
            : Math.max(0, 1 - Math.max(0, postElapsed - 0.9) / 0.9);
        if (helixAlpha > 0.01) {
          for (const h of helixSparks) {
            const ang = h.angleOffset + postElapsed * h.spinSpeed;
            const sway = Math.sin(postElapsed * 3 + h.phase) * 8;
            const hx = originX + Math.cos(ang) * (h.radius + sway);
            const hy = originY + 34 - postElapsed * h.riseSpeed + Math.sin(ang) * 14;
            ctx.fillStyle = h.color;
            ctx.globalAlpha = helixAlpha * 0.82;
            ctx.beginPath();
            ctx.arc(hx, hy, h.size, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Burst shards, glowing orbs, and droplets
        for (const p of burstParticles) {
          p.life += dt;
          if (p.life >= p.maxLife) continue;
          const pt = p.life / p.maxLife;
          p.vx *= Math.pow(p.drag, dt * 60);
          p.vy = p.vy * Math.pow(p.drag, dt * 60) + p.buoyancy * dt;
          p.x += (p.vx + Math.sin(p.life * 4.5 + p.swayPhase) * p.swayAmp) * dt;
          p.y += p.vy * dt;
          p.rot += p.rotSpeed * dt;

          const fade = pt < 0.15 ? pt / 0.15 : 1 - Math.pow((pt - 0.15) / 0.85, 1.5);
          ctx.globalAlpha = Math.max(0, p.alpha * fade);
          ctx.fillStyle = p.color;

          if (p.kind === 'shard') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            const s = p.size * (1 - pt * 0.35);
            ctx.beginPath();
            ctx.moveTo(0, -s * 1.45);
            ctx.lineTo(s * 0.7, 0);
            ctx.lineTo(0, s * 1.45);
            ctx.lineTo(-s * 0.7, 0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          } else if (p.kind === 'droplet') {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (1 - pt * 0.25), 0, Math.PI * 2);
            ctx.fill();
          } else {
            const r = p.size * (1.2 - pt * 0.4);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.restore();
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(crestShowTimer);
      window.clearTimeout(crestHideTimer);
      window.removeEventListener('resize', resize);
    };
  }, [event, reducedMotion]);

  if (!event || event.form < 2) return null;

  const spec = getFormVisualSpec(event.form, event.level);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {/* Non-blocking metamorphosis crest positioned cleanly above the creature silhouette */}
      <div
        className={`absolute left-1/2 top-[15%] -translate-x-1/2 flex flex-col items-center text-center transition-all ${
          reducedMotion ? 'duration-200' : 'duration-300 ease-out'
        } ${
          crestVisible
            ? 'opacity-100 translate-y-0 scale-100'
            : 'opacity-0 -translate-y-2 scale-95'
        }`}
      >
        <div
          className="compendium-plaque relative px-7 py-3.5 rounded-sm max-w-[90vw]"
          style={{ borderColor: spec.accentHex }}
        >
          <div className="flex items-center justify-center gap-2 text-[10px] font-mono-num font-semibold tracking-wider">
            <span className="h-px w-6 bg-gradient-to-r from-transparent to-[#c99c4a]" />
            <span style={{ color: spec.accentHex }}>◆ {spec.kicker} ◆</span>
            <span className="h-px w-6 bg-gradient-to-l from-transparent to-[#c99c4a]" />
          </div>
          <div className="font-display text-xl sm:text-2xl font-bold text-[#f7f2e7] mt-1 text-balance drop-shadow">
            {spec.title}
          </div>
          <div className="text-xs text-[#cbd5e1] mt-1">{spec.detail}</div>
        </div>
      </div>
    </div>
  );
};

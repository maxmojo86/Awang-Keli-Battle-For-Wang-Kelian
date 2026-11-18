import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, MapPin, TrendingUp, Award, Skull, Crown } from 'lucide-react';
import { getFormLabel } from '../data/abilities';
import { getTerrainAt, HAZARD_TILES, LANDMARKS, WORLD_SIZE } from '../game/arena';
import { MatchReplayData, ReplayEvent, sampleReplayAtTime } from '../game/replay';
import { EvolutionForm, HazardTileKind } from '../game/types';

interface MatchReplayPanelProps {
  replay: MatchReplayData;
}

const FORM_COLORS: Record<EvolutionForm, string> = {
  1: '#38bdf8',
  2: '#34d399',
  3: '#f59e0b',
  4: '#fde047',
};

const HAZARD_FILLS: Record<HazardTileKind, string> = {
  toxic_sludge: 'rgba(132, 204, 22, 0.24)',
  rapids: 'rgba(56, 189, 248, 0.22)',
  quagmire: 'rgba(217, 119, 6, 0.24)',
  thermal_vent: 'rgba(249, 115, 22, 0.24)',
};

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const MatchReplayPanel: React.FC<MatchReplayPanelProps> = ({ replay }) => {
  const terrainRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 2 | 4 | 8>(2);

  const canvasCssSize = 320;
  const duration = Math.max(0.1, replay.duration);

  // Build static 8x terrain backdrop once
  useEffect(() => {
    const offscreen = document.createElement('canvas');
    const size = 240;
    offscreen.width = size;
    offscreen.height = size;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(size, size);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const sx = (px / size) * WORLD_SIZE;
        const sz = (py / size) * WORLD_SIZE;
        const t = getTerrainAt(sx, sz);
        const idx = (py * size + px) * 4;
        if (t === 'cliff') {
          img.data[idx] = 16;
          img.data[idx + 1] = 23;
          img.data[idx + 2] = 29;
        } else if (t === 'shore') {
          const edge =
            getTerrainAt(sx - 28, sz) !== 'shore' ||
            getTerrainAt(sx + 28, sz) !== 'shore' ||
            getTerrainAt(sx, sz - 28) !== 'shore' ||
            getTerrainAt(sx, sz + 28) !== 'shore';
          img.data[idx] = edge ? 132 : 104;
          img.data[idx + 1] = edge ? 110 : 88;
          img.data[idx + 2] = edge ? 76 : 62;
        } else if (t === 'shallow') {
          img.data[idx] = 31;
          img.data[idx + 1] = 71;
          img.data[idx + 2] = 70;
        } else {
          img.data[idx] = 13;
          img.data[idx + 1] = 37;
          img.data[idx + 2] = 43;
        }
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    terrainRef.current = offscreen;
  }, []);

  // Playback loop
  useEffect(() => {
    if (!playing) return;
    let rafId = 0;
    let lastNow = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.08, (now - lastNow) / 1000);
      lastNow = now;
      setCurrentTime((prev) => {
        const next = prev + dt * speed;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [playing, speed, duration]);

  const currentPose = useMemo(
    () => sampleReplayAtTime(replay, currentTime),
    [replay, currentTime]
  );

  // Draw top-down 8x arena replay frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const pxTarget = Math.round(canvasCssSize * dpr);
    if (canvas.width !== pxTarget || canvas.height !== pxTarget) {
      canvas.width = pxTarget;
      canvas.height = pxTarget;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasCssSize, canvasCssSize);

    const toPx = (val: number) => (val / WORLD_SIZE) * canvasCssSize;

    // 1. Terrain backdrop
    if (terrainRef.current) {
      ctx.drawImage(terrainRef.current, 0, 0, canvasCssSize, canvasCssSize);
    } else {
      ctx.fillStyle = '#0c161c';
      ctx.fillRect(0, 0, canvasCssSize, canvasCssSize);
    }

    // 2. Subtle sector grid
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 0.75;
    for (let i = 1; i < 4; i++) {
      const g = (i / 4) * canvasCssSize;
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, canvasCssSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(canvasCssSize, g);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Subtle Hazard tile footprints
    for (const h of HAZARD_TILES) {
      const hx = toPx(h.x);
      const hy = toPx(h.z);
      ctx.save();
      ctx.translate(hx, hy);
      ctx.fillStyle = HAZARD_FILLS[h.kind];
      if (h.kind === 'rapids' && h.shape === 'rect') {
        ctx.rotate(h.angle ?? 0);
        const w = Math.max(4, toPx((h.halfL ?? 180) * 2));
        const d = Math.max(3, toPx((h.halfW ?? 90) * 2));
        ctx.fillRect(-w / 2, -d / 2, w, d);
      } else {
        const r = Math.max(3, toPx(h.radius));
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 4. Jantung Tasik center crosshair
    const jx = toPx(LANDMARKS.radioactiveDrum.x);
    const jy = toPx(LANDMARKS.radioactiveDrum.z);
    ctx.save();
    ctx.strokeStyle = 'rgba(243, 210, 133, 0.48)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(jx - 4, jy);
    ctx.lineTo(jx + 4, jy);
    ctx.moveTo(jx, jy - 4);
    ctx.lineTo(jx, jy + 4);
    ctx.stroke();
    ctx.restore();

    // 5. Safe Zone Circle at replay time t
    if (currentPose) {
      const zcx = toPx(currentPose.zoneCenterX);
      const zcy = toPx(currentPose.zoneCenterZ);
      const zr = Math.max(2, toPx(currentPose.zoneRadius));
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, canvasCssSize, canvasCssSize);
      ctx.arc(zcx, zcy, zr, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(127, 29, 29, 0.24)';
      ctx.fill();

      ctx.strokeStyle = 'rgba(74, 222, 128, 0.72)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(zcx, zcy, zr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Full match route preview (ghosted path)
    if (replay.frames.length >= 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      replay.frames.forEach((f, idx) => {
        const fx = toPx(f.x);
        const fy = toPx(f.z);
        if (idx === 0) ctx.moveTo(fx, fy);
        else ctx.lineTo(fx, fy);
      });
      ctx.stroke();
      ctx.restore();

      // 7. Progressed path up to currentTime colored by Evolution Form
      ctx.save();
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      for (let i = 1; i < replay.frames.length; i++) {
        const prev = replay.frames[i - 1];
        const curr = replay.frames[i];
        if (prev.t > currentTime) break;

        let endX = curr.x;
        let endZ = curr.z;
        if (curr.t > currentTime) {
          const alpha = (currentTime - prev.t) / Math.max(0.0001, curr.t - prev.t);
          endX = prev.x + (curr.x - prev.x) * alpha;
          endZ = prev.z + (curr.z - prev.z) * alpha;
        }

        ctx.strokeStyle = FORM_COLORS[curr.form];
        ctx.beginPath();
        ctx.moveTo(toPx(prev.x), toPx(prev.z));
        ctx.lineTo(toPx(endX), toPx(endZ));
        ctx.stroke();
      }
      ctx.restore();
    }

    // 8. Event Milestones along path (Fragments, Evolutions, Kills, Death/Victory)
    for (const ev of replay.events) {
      const ex = toPx(ev.x);
      const ey = toPx(ev.z);
      const reached = ev.t <= currentTime + 0.02;
      ctx.save();
      ctx.globalAlpha = reached ? 1 : 0.24;

      if (ev.kind === 'fragment') {
        ctx.fillStyle = '#4ade80';
        ctx.strokeStyle = '#091117';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ex, ey, ev.deltaFragments >= 10 ? 4.2 : 3.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (ev.kind === 'evolution') {
        ctx.fillStyle = '#f3d285';
        ctx.strokeStyle = '#091117';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(ex, ey - 5.5);
        ctx.lineTo(ex + 5.5, ey);
        ctx.lineTo(ex, ey + 5.5);
        ctx.lineTo(ex - 5.5, ey);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (ev.kind === 'death') {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(ex - 4.5, ey - 4.5);
        ctx.lineTo(ex + 4.5, ey + 4.5);
        ctx.moveTo(ex + 4.5, ey - 4.5);
        ctx.lineTo(ex - 4.5, ey + 4.5);
        ctx.stroke();
      } else if (ev.kind === 'victory') {
        ctx.fillStyle = '#fde047';
        ctx.strokeStyle = '#091117';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ex, ey, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (ev.kind === 'spawn') {
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 9. Animated Player Marker at currentTime
    if (currentPose) {
      const px = toPx(currentPose.x);
      const py = toPx(currentPose.z);
      ctx.save();
      ctx.translate(px, py);

      // Outer pulse halo
      ctx.strokeStyle = currentPose.alive ? FORM_COLORS[currentPose.form] : '#ef4444';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.rotate(currentPose.facingAngle);
      ctx.fillStyle = currentPose.alive ? '#facc15' : '#f87171';
      ctx.strokeStyle = '#091117';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(7.5, 0);
      ctx.lineTo(-5, -4.8);
      ctx.lineTo(-2.2, 0);
      ctx.lineTo(-5, 4.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, [replay, currentPose, currentTime]);

  // Build SVG path for Fragment Collection Progression chart
  const chartData = useMemo(() => {
    const w = 360;
    const h = 112;
    const padL = 26;
    const padR = 8;
    const padT = 10;
    const padB = 18;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const pts = replay.frames.map((f) => {
      const x = padL + (f.t / duration) * plotW;
      const y = padT + (1 - Math.min(100, Math.max(0, f.level)) / 100) * plotH;
      return { x, y, t: f.t, level: f.level };
    });

    if (pts.length === 0) {
      return { w, h, padL, padR, padT, padB, plotW, plotH, linePath: '', areaPath: '' };
    }

    const linePath = pts
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    const last = pts[pts.length - 1];
    const first = pts[0];
    const baselineY = padT + plotH;
    const areaPath = `${linePath} L ${last.x.toFixed(1)} ${baselineY} L ${first.x.toFixed(1)} ${baselineY} Z`;

    return { w, h, padL, padR, padT, padB, plotW, plotH, linePath, areaPath };
  }, [replay.frames, duration]);

  const jumpToTime = (t: number) => {
    const clamped = Math.max(0, Math.min(duration, t));
    setCurrentTime(clamped);
  };

  const handleChartScrub = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * chartData.w;
    const norm = Math.max(0, Math.min(1, (relX - chartData.padL) / chartData.plotW));
    setPlaying(false);
    jumpToTime(norm * duration);
  };

  const renderEventIcon = (ev: ReplayEvent) => {
    switch (ev.kind) {
      case 'victory':
        return <Crown className="w-3.5 h-3.5 text-[#fde047] shrink-0" />;
      case 'death':
        return <Skull className="w-3.5 h-3.5 text-[#f87171] shrink-0" />;
      case 'evolution':
        return <Award className="w-3.5 h-3.5 text-[#f3d285] shrink-0" />;
      case 'fragment':
      case 'kill':
        return <TrendingUp className="w-3.5 h-3.5 text-[#4ade80] shrink-0" />;
      default:
        return <MapPin className="w-3.5 h-3.5 text-[#7dd3fc] shrink-0" />;
    }
  };

  const playheadSvgX = chartData.padL + (currentTime / duration) * chartData.plotW;

  return (
    <section className="compendium-plaque rounded-sm overflow-hidden">
      <div className="compendium-ribbon flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#f3d285]">
            ◆ Basin Journey &amp; Fragment Replay
          </h2>
          <p className="text-xs text-[#9cb0ba]">
            Logged trajectory coordinates, zone shrinkage, and fragment evolution timeline across the 8× arena.
          </p>
        </div>
        <div className="text-xs font-mono-num text-[#f3d285] whitespace-nowrap">
          {formatClock(currentTime)} / {formatClock(duration)}
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
        {/* Left: Interactive 8x Arena Replay Map & Controls */}
        <div className="space-y-3">
          <div className="relative rounded-[2px] border border-[#4e3d21] bg-[#091117] overflow-hidden w-full max-w-[324px] mx-auto lg:mx-0">
            <canvas
              ref={canvasRef}
              style={{ width: canvasCssSize, height: canvasCssSize }}
              className="block w-full h-auto"
            />
            {currentPose && (
              <div className="pointer-events-none absolute top-2 left-2 right-2 flex items-center justify-between gap-2 text-[10px] font-mono-num">
                <span className="px-2 py-0.5 rounded-[2px] bg-[#091117]/85 border border-[#4e3d21] text-[#f3d285] font-semibold">
                  Lv.{currentPose.level} · {getFormLabel(currentPose.form)}
                </span>
                <span className="px-2 py-0.5 rounded-[2px] bg-[#091117]/85 border border-[#2a3b47] text-[#cbd5e1] truncate">
                  {currentPose.zoneName}
                </span>
              </div>
            )}
            {currentPose && (
              <div className="pointer-events-none absolute bottom-2 left-2 px-2 py-0.5 rounded-[2px] bg-[#091117]/85 border border-[#2a3b47] text-[10px] font-mono-num text-[#9cb0ba]">
                x:{Math.round(currentPose.x)} z:{Math.round(currentPose.z)}
              </div>
            )}
          </div>

          {/* Scrubber + Playback Bar */}
          <div className="max-w-[324px] mx-auto lg:mx-0 space-y-2">
            <div className="relative pt-1">
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={currentTime}
                onChange={(e) => {
                  setPlaying(false);
                  jumpToTime(parseFloat(e.target.value));
                }}
                aria-label="Replay timeline scrubber"
                className="w-full accent-[#c99c4a] cursor-pointer"
              />
              {/* Milestone event tick pips */}
              <div className="relative h-2 -mt-1 pointer-events-none">
                {replay.events.map((ev) => {
                  if (ev.kind === 'spawn') return null;
                  const pct = (ev.t / duration) * 100;
                  const bg =
                    ev.kind === 'victory'
                      ? '#fde047'
                      : ev.kind === 'death'
                        ? '#ef4444'
                        : ev.kind === 'evolution'
                          ? '#f3d285'
                          : '#4ade80';
                  return (
                    <span
                      key={ev.id}
                      style={{ left: `${pct}%`, backgroundColor: bg }}
                      className="absolute top-0 w-1 h-2 -translate-x-1/2 rounded-[1px]"
                    />
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (currentTime >= duration - 0.05) {
                      setCurrentTime(0);
                      setPlaying(true);
                    } else {
                      setPlaying((p) => !p);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[2px] border border-[#f3d285]/40 bg-[#c99c4a] text-[#0b1218] hover:bg-[#dfb35f] transition-colors whitespace-nowrap"
                >
                  {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {playing ? 'Pause' : currentTime >= duration - 0.05 ? 'Replay' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTime(0);
                    setPlaying(true);
                  }}
                  title="Restart Replay"
                  className="p-1.5 rounded-[2px] border border-[#5b4724] bg-[#142029] text-[#f3e6c8] hover:border-[#c99c4a] transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="compendium-track flex items-center gap-1 p-0.5 rounded-[2px]">
                {([1, 2, 4, 8] as const).map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setSpeed(spd)}
                    className={`px-2 py-1 text-[11px] font-mono-num rounded-[2px] transition-colors ${
                      speed === spd
                        ? 'bg-[#c99c4a] text-[#0b1218] font-bold'
                        : 'text-[#9cb0ba] hover:text-white'
                    }`}
                  >
                    {spd}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Journey Metrics, Fragment Timeline Chart, & Event Log */}
        <div className="space-y-4 min-w-0">
          {/* 4-Column Journey Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="compendium-plaque-subtle rounded-[2px] p-2.5">
              <div className="text-[11px] text-[#9cb0ba]">Distance Swum</div>
              <div className="font-mono-num text-lg font-semibold text-[#f7f2e7]">
                {replay.totalDistance.toLocaleString()}u
              </div>
            </div>
            <div className="compendium-plaque-subtle rounded-[2px] p-2.5">
              <div className="text-[11px] text-[#9cb0ba]">Peak Level</div>
              <div className="font-mono-num text-lg font-semibold text-[#f3d285]">
                Lv.{replay.peakLevel}
              </div>
            </div>
            <div className="compendium-plaque-subtle rounded-[2px] p-2.5">
              <div className="text-[11px] text-[#9cb0ba]">Fragments Claimed</div>
              <div className="font-mono-num text-lg font-semibold text-[#4ade80]">
                +{replay.totalFragmentsGained}
              </div>
            </div>
            <div className="compendium-plaque-subtle rounded-[2px] p-2.5">
              <div className="text-[11px] text-[#9cb0ba]">Zones Traversed</div>
              <div className="font-mono-num text-lg font-semibold text-[#7dd3fc]">
                {replay.zonesVisited.length}
              </div>
            </div>
          </div>

          {/* Fragment Level Progression Sparkline */}
          <div className="compendium-plaque-subtle rounded-[2px] p-3">
            <div className="flex items-center justify-between text-[11px] text-[#9cb0ba] mb-1.5">
              <span>Fragment Collection Curve (click chart to scrub)</span>
              <span className="font-mono-num text-[#e6dfd0]">
                Form I · II (40) · III (80) · IV (100)
              </span>
            </div>
            <svg
              viewBox={`0 0 ${chartData.w} ${chartData.h}`}
              onPointerDown={handleChartScrub}
              className="w-full h-28 cursor-crosshair select-none"
              role="img"
              aria-label="Fragment collection timeline chart"
            >
              {/* Threshold guide lines at Lv.40 and Lv.80 */}
              {[40, 80, 100].map((lvl) => {
                const y = chartData.padT + (1 - lvl / 100) * chartData.plotH;
                return (
                  <g key={lvl}>
                    <line
                      x1={chartData.padL}
                      y1={y}
                      x2={chartData.w - chartData.padR}
                      y2={y}
                      stroke="rgba(148, 163, 184, 0.18)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={2}
                      y={y + 3}
                      fill="#7c8f99"
                      fontSize="8.5"
                      fontFamily="monospace"
                    >
                      {lvl}
                    </text>
                  </g>
                );
              })}

              {chartData.areaPath && (
                <path d={chartData.areaPath} fill="rgba(56, 189, 248, 0.16)" />
              )}
              {chartData.linePath && (
                <path
                  d={chartData.linePath}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              )}

              {/* Event dots on the curve */}
              {replay.events.map((ev) => {
                if (ev.kind === 'spawn') return null;
                const ex = chartData.padL + (ev.t / duration) * chartData.plotW;
                const ey =
                  chartData.padT + (1 - Math.min(100, ev.level) / 100) * chartData.plotH;
                const col =
                  ev.kind === 'death'
                    ? '#ef4444'
                    : ev.kind === 'evolution'
                      ? '#f3d285'
                      : ev.kind === 'victory'
                        ? '#fde047'
                        : '#4ade80';
                return <circle key={ev.id} cx={ex} cy={ey} r="2.7" fill={col} />;
              })}

              {/* Vertical Scrub Playhead */}
              <line
                x1={playheadSvgX}
                y1={chartData.padT}
                x2={playheadSvgX}
                y2={chartData.padT + chartData.plotH}
                stroke="#f3d285"
                strokeWidth="1.4"
              />
            </svg>
          </div>

          {/* Interactive Fragment & Milestone Event Timeline */}
          <div className="compendium-track rounded-[2px] p-2 max-h-48 overflow-y-auto space-y-1">
            {replay.events.map((ev, idx) => {
              const nextEv = replay.events[idx + 1];
              const isCurrent =
                currentTime >= ev.t - 0.01 && (!nextEv || currentTime < nextEv.t - 0.01);
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    jumpToTime(ev.t);
                  }}
                  className={`w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-[2px] border text-xs transition-colors ${
                    isCurrent
                      ? 'bg-[#162631] border-[#c99c4a] text-[#f7f2e7]'
                      : 'bg-[#0c141b] border-transparent hover:border-[#2d404d] text-[#cbd5e1]'
                  }`}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    {renderEventIcon(ev)}
                    <div className="min-w-0">
                      <div className="font-medium truncate">{ev.label}</div>
                      <div className="text-[10.5px] text-[#9cb0ba] truncate">{ev.detail}</div>
                    </div>
                  </div>
                  <span className="font-mono-num text-[11px] text-[#f3d285] shrink-0">
                    {formatClock(ev.t)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

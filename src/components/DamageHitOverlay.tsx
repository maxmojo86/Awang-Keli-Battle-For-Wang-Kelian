import React, { useEffect, useRef, useState } from 'react';
import { DamageHitEvent } from '../game/types';

interface ActiveDamageHit extends DamageHitEvent {
  receivedAt: number;
  maxAgeMs: number;
}

interface DamageHitOverlayProps {
  hits: DamageHitEvent[] | undefined;
  viewportWidth: number;
  viewportHeight: number;
  compactMode: boolean;
  reducedMotion: boolean;
  onJoltChange?: (jolt: { x: number; y: number }) => void;
}

export const DamageHitOverlay: React.FC<DamageHitOverlayProps> = ({
  hits,
  viewportWidth,
  viewportHeight,
  compactMode,
  reducedMotion,
  onJoltChange,
}) => {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const activeRef = useRef<ActiveDamageHit[]>([]);
  const joltImpulseRef = useRef<{ x: number; y: number; power: number }>({
    x: 0,
    y: 0,
    power: 0,
  });
  const onJoltRef = useRef(onJoltChange);
  onJoltRef.current = onJoltChange;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const [renderHits, setRenderHits] = useState<Array<ActiveDamageHit & { progress: number }>>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!hits || hits.length === 0) return;
    const now = performance.now();
    let added = false;

    for (const hit of hits) {
      if (seenIdsRef.current.has(hit.id)) continue;
      seenIdsRef.current.add(hit.id);
      if (seenIdsRef.current.size > 60) {
        const oldest = seenIdsRef.current.values().next().value;
        if (oldest) seenIdsRef.current.delete(oldest);
      }

      const maxAgeMs = 880 + Math.round(hit.intensity * 360);
      activeRef.current.push({
        ...hit,
        receivedAt: now,
        maxAgeMs,
      });

      if (!reducedMotionRef.current) {
        const recoil = 4.5 + hit.intensity * 5.5;
        joltImpulseRef.current = {
          x: -Math.cos(hit.directionAngle) * recoil,
          y: -Math.sin(hit.directionAngle) * recoil,
          power: Math.min(1, joltImpulseRef.current.power + 0.55 + hit.intensity * 0.45),
        };
      }
      added = true;
    }

    if (activeRef.current.length > 6) {
      activeRef.current = activeRef.current.slice(-6);
    }

    if (added && rafRef.current === 0) {
      let lastTime = now;
      const tick = (ts: number) => {
        const dt = Math.min(0.05, Math.max(0.001, (ts - lastTime) / 1000));
        lastTime = ts;

        const nextActive: ActiveDamageHit[] = [];
        const nextRender: Array<ActiveDamageHit & { progress: number }> = [];

        for (const item of activeRef.current) {
          const age = ts - item.receivedAt;
          if (age < item.maxAgeMs) {
            nextActive.push(item);
            nextRender.push({
              ...item,
              progress: Math.max(0, Math.min(1, age / item.maxAgeMs)),
            });
          }
        }
        activeRef.current = nextActive;
        setRenderHits(nextRender);

        const jolt = joltImpulseRef.current;
        if (!reducedMotionRef.current && (jolt.power > 0.01 || Math.abs(jolt.x) > 0.1 || Math.abs(jolt.y) > 0.1)) {
          const decay = Math.exp(-16 * dt);
          jolt.x *= decay;
          jolt.y *= decay;
          jolt.power = Math.max(0, jolt.power - dt * 4.4);
          const jitterX = (Math.sin(ts * 0.095) * 0.7 + (Math.random() - 0.5) * 0.6) * jolt.power * 4.2;
          const jitterY = (Math.cos(ts * 0.11) * 0.7 + (Math.random() - 0.5) * 0.6) * jolt.power * 4.2;
          onJoltRef.current?.({
            x: jolt.x + jitterX,
            y: jolt.y + jitterY,
          });
        } else if (jolt.x !== 0 || jolt.y !== 0 || jolt.power !== 0) {
          jolt.x = 0;
          jolt.y = 0;
          jolt.power = 0;
          onJoltRef.current?.({ x: 0, y: 0 });
        }

        if (nextActive.length > 0 || jolt.power > 0.01) {
          rafRef.current = window.requestAnimationFrame(tick);
        } else {
          rafRef.current = 0;
          onJoltRef.current?.({ x: 0, y: 0 });
        }
      };
      rafRef.current = window.requestAnimationFrame(tick);
    }
  }, [hits]);

  useEffect(() => {
    if (reducedMotion) {
      joltImpulseRef.current = { x: 0, y: 0, power: 0 };
      onJoltRef.current?.({ x: 0, y: 0 });
    }
  }, [reducedMotion]);

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, []);

  if (renderHits.length === 0) return null;

  const latest = renderHits[renderHits.length - 1];
  const flashLife = Math.max(0, 1 - latest.progress * 2.1);
  const flashAlpha = flashLife * flashLife * (0.24 + latest.intensity * 0.28);
  const edgeX = 50 + Math.cos(latest.directionAngle) * 34;
  const edgeY = 50 + Math.sin(latest.directionAngle) * 34;

  const minDim = Math.min(viewportWidth, viewportHeight);
  const ringRx = compactMode
    ? Math.max(82, Math.min(viewportWidth * 0.34, minDim * 0.31))
    : Math.max(115, Math.min(viewportWidth * 0.25, minDim * 0.26));
  const ringRy = compactMode
    ? Math.max(72, Math.min(viewportHeight * 0.3, minDim * 0.27))
    : Math.max(96, Math.min(viewportHeight * 0.24, minDim * 0.24));

  return (
    <div
      aria-hidden="true"
      data-testid="damage-hit-overlay"
      className="pointer-events-none absolute inset-0 z-[7] overflow-hidden"
    >
      {/* Directional Edge Crimson Flash */}
      {flashAlpha > 0.008 && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 68% 68% at ${edgeX.toFixed(1)}% ${edgeY.toFixed(
              1
            )}%, rgba(220,38,38,${(flashAlpha * 0.72).toFixed(3)}) 0%, rgba(153,27,27,${(
              flashAlpha * 0.42
            ).toFixed(3)}) 38%, rgba(69,10,10,0) 76%)`,
            boxShadow: `inset 0 0 ${compactMode ? 48 : 88}px rgba(185,28,28,${(
              flashAlpha * 0.9
            ).toFixed(3)})`,
          }}
        />
      )}

      {/* Directional Hit Crescent Arcs Pointing Toward Attacking Rivals */}
      {renderHits.map((hit) => {
        const fade = Math.pow(Math.max(0, 1 - hit.progress), 1.55);
        const popScale =
          hit.progress < 0.14
            ? 0.86 + (hit.progress / 0.14) * 0.24
            : 1.1 - (hit.progress - 0.14) * 0.14;
        const opacity = fade * (0.58 + 0.42 * hit.intensity);
        const cx = viewportWidth * 0.5 + Math.cos(hit.directionAngle) * ringRx;
        const cy = viewportHeight * 0.5 + Math.sin(hit.directionAngle) * ringRy;
        const deg = (hit.directionAngle * 180) / Math.PI;
        const labelX = viewportWidth * 0.5 + Math.cos(hit.directionAngle) * (ringRx + (compactMode ? 18 : 26));
        const labelY = viewportHeight * 0.5 + Math.sin(hit.directionAngle) * (ringRy + (compactMode ? 18 : 26));

        return (
          <React.Fragment key={hit.id}>
            <div
              data-damage-direction={Math.round(deg)}
              className="absolute left-0 top-0"
              style={{
                width: compactMode ? 68 : 92,
                height: compactMode ? 68 : 92,
                opacity,
                transform: `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${deg.toFixed(
                  1
                )}deg) scale(${popScale.toFixed(3)})`,
              }}
            >
              <svg viewBox="0 0 96 96" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id={`hit-arc-${hit.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#991b1b" stopOpacity="0.15" />
                    <stop offset="65%" stopColor="#ef4444" stopOpacity="0.92" />
                    <stop offset="100%" stopColor="#fecaca" stopOpacity="1" />
                  </linearGradient>
                </defs>
                {/* Outer crimson impact crescent pointing along +X (0 deg) */}
                <path
                  d="M 52 14 C 72 24, 78 38, 78 48 C 78 58, 72 72, 52 82 C 64 69, 68 58, 68 48 C 68 38, 64 27, 52 14 Z"
                  fill={`url(#hit-arc-${hit.id})`}
                />
                {/* Sharp directional fang/chevron tip */}
                <path
                  d="M 78 40 L 92 48 L 78 56 L 82 48 Z"
                  fill="#fecaca"
                  stroke="#dc2626"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {hit.progress < 0.72 && (
              <div
                className="absolute left-0 top-0 whitespace-nowrap font-mono-num font-bold tracking-tight"
                style={{
                  opacity: Math.max(0, 1 - hit.progress / 0.72),
                  transform: `translate3d(${labelX.toFixed(1)}px, ${labelY.toFixed(
                    1
                  )}px, 0) translate(-50%, -50%)`,
                }}
              >
                <span
                  className={`inline-flex items-center gap-1 rounded-[2px] border border-[#ef4444]/65 bg-[#1b080b]/88 text-[#fecaca] shadow-sm ${
                    compactMode ? 'px-1 py-0.5 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'
                  }`}
                >
                  <span>-{hit.damage}</span>
                  {!compactMode && (
                    <span className="text-[#fca5a5]/85 font-sans font-semibold max-w-[84px] truncate">
                      {hit.attackerName}
                    </span>
                  )}
                </span>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

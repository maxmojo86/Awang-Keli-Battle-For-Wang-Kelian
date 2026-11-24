import React, { useEffect, useState, useRef } from 'react';
import { Map as MapIcon, Minimize2 } from 'lucide-react';
import {
  ECHO_SONAR_RADIUS,
  getTerrainAt,
  HAZARD_TILES,
  LANDMARKS,
  WORLD_CENTER,
  WORLD_SIZE,
} from '../game/arena';
import { VOICE_MAX_DISTANCE_SIM, SpatialPeerTelemetry } from '../game/spatialVoice';
import { HazardTileKind, HudSnapshot } from '../game/types';

interface MinimapProps {
  hud: HudSnapshot;
  showVoiceHorizon?: boolean;
  voicePeers?: SpatialPeerTelemetry[];
  compact?: boolean;
}

type MapZoomMode = 'arena' | 'local';

const HAZARD_COLORS: Record<
  HazardTileKind,
  { fill: string; stroke: string; dot: string; label: string }
> = {
  toxic_sludge: {
    fill: 'rgba(132, 204, 22, 0.44)',
    stroke: '#a3e635',
    dot: '#84cc16',
    label: 'Sludge',
  },
  rapids: {
    fill: 'rgba(56, 189, 248, 0.36)',
    stroke: '#7dd3fc',
    dot: '#38bdf8',
    label: 'Rapids',
  },
  quagmire: {
    fill: 'rgba(217, 119, 6, 0.44)',
    stroke: '#fbbf24',
    dot: '#d97706',
    label: 'Quagmire',
  },
  thermal_vent: {
    fill: 'rgba(249, 115, 22, 0.46)',
    stroke: '#fdba74',
    dot: '#f97316',
    label: 'Brine Vent',
  },
};

export const Minimap: React.FC<MinimapProps> = ({
  hud,
  showVoiceHorizon = false,
  voicePeers = [],
  compact = false,
}) => {
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [zoomMode, setZoomMode] = useState<MapZoomMode>('arena');
  const [showKey, setShowKey] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 && window.innerHeight >= 540 : true
  );
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const cssSize = compact ? 98 : 180;
  const terrainCacheSize = 224;

  // Build static 8x arena terrain raster once into an offscreen canvas
  useEffect(() => {
    const offscreen = document.createElement('canvas');
    offscreen.width = terrainCacheSize;
    offscreen.height = terrainCacheSize;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(terrainCacheSize, terrainCacheSize);
    for (let py = 0; py < terrainCacheSize; py++) {
      for (let px = 0; px < terrainCacheSize; px++) {
        const sx = (px / terrainCacheSize) * WORLD_SIZE;
        const sz = (py / terrainCacheSize) * WORLD_SIZE;
        const t = getTerrainAt(sx, sz);
        const idx = (py * terrainCacheSize + px) * 4;
        if (t === 'cliff') {
          img.data[idx] = 17;
          img.data[idx + 1] = 24;
          img.data[idx + 2] = 30;
        } else if (t === 'shore') {
          // Highlight shoreline rim slightly where adjacent pixels are water
          const edge =
            getTerrainAt(sx - 28, sz) !== 'shore' ||
            getTerrainAt(sx + 28, sz) !== 'shore' ||
            getTerrainAt(sx, sz - 28) !== 'shore' ||
            getTerrainAt(sx, sz + 28) !== 'shore';
          img.data[idx] = edge ? 142 : 114;
          img.data[idx + 1] = edge ? 118 : 95;
          img.data[idx + 2] = edge ? 82 : 66;
        } else if (t === 'shallow') {
          img.data[idx] = 35;
          img.data[idx + 1] = 77;
          img.data[idx + 2] = 75;
        } else {
          img.data[idx] = 15;
          img.data[idx + 1] = 42;
          img.data[idx + 2] = 47;
        }
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    terrainCanvasRef.current = offscreen;
  }, []);

  // Render dynamic layers (grid, safe zone, highlighted hazards, power-up spawns, contacts, player)
  useEffect(() => {
    if (compact && collapsed) return;
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const targetPx = Math.round(cssSize * dpr);
    if (canvas.width !== targetPx || canvas.height !== targetPx) {
      canvas.width = targetPx;
      canvas.height = targetPx;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);

    // Base karst background
    ctx.fillStyle = '#091015';
    ctx.fillRect(0, 0, cssSize, cssSize);

    const viewSpan = zoomMode === 'local' ? WORLD_SIZE / 2.5 : WORLD_SIZE;
    const centerX = zoomMode === 'local' ? hud.player.x : WORLD_CENTER;
    const centerZ = zoomMode === 'local' ? hud.player.z : WORLD_CENTER;
    const viewLeft = centerX - viewSpan * 0.5;
    const viewTop = centerZ - viewSpan * 0.5;

    const toPxX = (wx: number) => ((wx - viewLeft) / viewSpan) * cssSize;
    const toPxY = (wz: number) => ((wz - viewTop) / viewSpan) * cssSize;
    const scaleLen = (wLen: number) => (wLen / viewSpan) * cssSize;

    // 1. Static terrain raster projected into active viewport
    if (terrainCanvasRef.current) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        terrainCanvasRef.current,
        toPxX(0),
        toPxY(0),
        scaleLen(WORLD_SIZE),
        scaleLen(WORLD_SIZE)
      );
    }

    // 2. 8x Arena tactical 4x4 sector grid
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 0.75;
    const step = WORLD_SIZE / 4;
    for (let i = 0; i <= 4; i++) {
      const gx = toPxX(i * step);
      const gy = toPxY(i * step);
      ctx.beginPath();
      ctx.moveTo(gx, toPxY(0));
      ctx.lineTo(gx, toPxY(WORLD_SIZE));
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(toPxX(0), gy);
      ctx.lineTo(toPxX(WORLD_SIZE), gy);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Radioactive Safe Zone overlay & contraction perimeter
    const zoneCx = toPxX(hud.zone.centerX);
    const zoneCy = toPxY(hud.zone.centerZ);
    const zoneR = scaleLen(hud.zone.currentRadius);

    // Subtle danger wash outside the safe zone
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cssSize, cssSize);
    ctx.arc(zoneCx, zoneCy, Math.max(1, zoneR), 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(127, 29, 29, 0.28)';
    ctx.fill();

    const isFinalLocked = Boolean(hud.zone.finalZoneLocked || hud.endgame?.finalZoneLocked);

    ctx.strokeStyle = isFinalLocked
      ? 'rgba(251, 191, 36, 0.96)'
      : hud.zone.isShrinking
        ? 'rgba(248, 113, 113, 0.92)'
        : hud.zone.warningActive
          ? 'rgba(251, 191, 36, 0.92)'
          : 'rgba(74, 222, 128, 0.88)';
    ctx.lineWidth = isFinalLocked ? 2.1 : hud.zone.warningActive ? 1.85 : 1.6;
    if (!isFinalLocked) {
      if (hud.zone.isShrinking) {
        ctx.setLineDash([4, 3]);
      } else if (hud.zone.warningActive) {
        ctx.setLineDash([6, 2.5]);
      }
    }
    ctx.beginPath();
    ctx.arc(zoneCx, zoneCy, Math.max(1, zoneR), 0, Math.PI * 2);
    ctx.stroke();

    // Permanent outer brass halo when the 60/40 final arena is locked
    if (isFinalLocked) {
      ctx.strokeStyle = 'rgba(253, 230, 138, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(zoneCx, zoneCy, Math.max(2, zoneR + 2.5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // 4. Highlighted Hazard Tile Zones (24 sectors across the 8x arena)
    const activeHazardKind = hud.spectating?.active
      ? hud.spectating.targetHazard?.kind ?? null
      : hud.player.activeHazard?.kind ?? null;

    for (const h of HAZARD_TILES) {
      const hx = toPxX(h.x);
      const hy = toPxY(h.z);
      const pal = HAZARD_COLORS[h.kind];

      // Check whether the tracked entity is physically inside this tile
      let entityInside = false;
      if (activeHazardKind === h.kind) {
        const dx = hud.player.x - h.x;
        const dz = hud.player.z - h.z;
        if (h.shape === 'circle') {
          entityInside = dx * dx + dz * dz <= h.radius * h.radius;
        } else if (dx * dx + dz * dz <= h.radius * h.radius) {
          const ang = h.angle ?? 0;
          const cos = Math.cos(ang);
          const sin = Math.sin(ang);
          const along = dx * cos + dz * sin;
          const across = -dx * sin + dz * cos;
          entityInside = Math.abs(along) <= (h.halfL ?? 0) && Math.abs(across) <= (h.halfW ?? 0);
        }
      }

      ctx.save();
      ctx.translate(hx, hy);

      if (h.kind === 'rapids' && h.shape === 'rect') {
        ctx.rotate(h.angle ?? 0);
        const w = Math.max(5, scaleLen((h.halfL ?? 200) * 2));
        const d = Math.max(3, scaleLen((h.halfW ?? 100) * 2));
        ctx.fillStyle = pal.fill;
        ctx.strokeStyle = entityInside ? '#fef08a' : pal.stroke;
        ctx.lineWidth = entityInside ? 1.5 : 0.9;
        ctx.fillRect(-w / 2, -d / 2, w, d);
        ctx.strokeRect(-w / 2, -d / 2, w, d);

        // Directional current chevrons along stream axis
        ctx.strokeStyle = 'rgba(224, 242, 254, 0.85)';
        ctx.lineWidth = 1;
        const chevCount = zoomMode === 'local' ? 3 : 2;
        for (let c = 0; c < chevCount; c++) {
          const cx = ((c + 0.5) / chevCount - 0.5) * (w * 0.65);
          const s = Math.min(2.6, d * 0.28);
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.6, -s);
          ctx.lineTo(cx + s * 0.7, 0);
          ctx.lineTo(cx - s * 0.6, s);
          ctx.stroke();
        }
      } else {
        const r = Math.max(zoomMode === 'local' ? 5 : 3.2, scaleLen(h.radius));
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = pal.fill;
        ctx.fill();

        if (h.kind === 'toxic_sludge' || h.kind === 'quagmire') {
          ctx.setLineDash([2.5, 2]);
        }
        ctx.strokeStyle = entityInside ? '#fef08a' : pal.stroke;
        ctx.lineWidth = entityInside ? 1.6 : 1;
        ctx.stroke();
        ctx.setLineDash([]);

        if (h.kind === 'thermal_vent') {
          ctx.fillStyle = '#ffedd5';
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(1.1, r * 0.25), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    // 4b. Active Dynamic World Event Overlay (drawn below sonar/carcasses/Final Feast for clarity)
    const worldEv = hud.activeWorldEvent;
    if (
      worldEv &&
      worldEv.phase !== 'dormant' &&
      worldEv.phase !== 'complete' &&
      !hud.finalFeast?.active
    ) {
      const isWarn = worldEv.phase === 'warning';
      const pulse = 0.72 + 0.28 * Math.sin(hud.matchTime * 6.5);
      const ex = toPxX(worldEv.x);
      const ey = toPxY(worldEv.z);

      ctx.save();
      if (worldEv.kind === 'flash_flood') {
        ctx.translate(ex, ey);
        ctx.rotate(worldEv.flowAngle);
        const w = Math.max(10, scaleLen(worldEv.corridorHalfLength * 2));
        const h = Math.max(6, scaleLen(worldEv.corridorHalfWidth * 2));
        ctx.fillStyle = isWarn
          ? `rgba(56, 189, 248, ${(0.14 * pulse).toFixed(3)})`
          : 'rgba(56, 189, 248, 0.24)';
        ctx.strokeStyle = isWarn ? 'rgba(186, 230, 253, 0.85)' : '#38bdf8';
        ctx.lineWidth = isWarn ? 1.2 : 1.5;
        if (isWarn) ctx.setLineDash([4, 3]);
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
        ctx.setLineDash([]);

        // Directional current chevrons
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 1.1;
        for (let c = -1; c <= 1; c++) {
          const cx = c * (w * 0.24);
          const s = Math.min(3.5, h * 0.28);
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.6, -s);
          ctx.lineTo(cx + s * 0.7, 0);
          ctx.lineTo(cx - s * 0.6, s);
          ctx.stroke();
        }
      } else if (worldEv.kind === 'silt_bloom') {
        const r = Math.max(7, scaleLen(worldEv.radius));
        ctx.fillStyle = isWarn
          ? `rgba(217, 119, 6, ${(0.14 * pulse).toFixed(3)})`
          : 'rgba(180, 108, 38, 0.28)';
        ctx.strokeStyle = isWarn ? 'rgba(251, 191, 36, 0.85)' : '#d97706';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([3, 2.5]);
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (worldEv.kind === 'whirlpool') {
        const r = Math.max(7, scaleLen(worldEv.radius));
        ctx.fillStyle = isWarn
          ? `rgba(45, 212, 191, ${(0.12 * pulse).toFixed(3)})`
          : 'rgba(20, 184, 166, 0.24)';
        ctx.strokeStyle = isWarn ? 'rgba(153, 246, 228, 0.85)' : '#2dd4bf';
        ctx.lineWidth = 1.4;
        if (isWarn) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // Inner swirling arc indicator
        const rot = hud.matchTime * 3.2;
        ctx.strokeStyle = '#99f6e4';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(ex, ey, r * 0.52, rot, rot + Math.PI * 1.35);
        ctx.stroke();
      } else if (worldEv.kind === 'drifting_net') {
        // Drift path trajectory line
        ctx.strokeStyle = 'rgba(253, 186, 116, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(toPxX(worldEv.startX), toPxY(worldEv.startZ));
        ctx.lineTo(toPxX(worldEv.endX), toPxY(worldEv.endZ));
        ctx.stroke();
        ctx.setLineDash([]);

        // Moving net bar perpendicular to travel heading
        ctx.translate(ex, ey);
        ctx.rotate(worldEv.flowAngle + Math.PI * 0.5);
        const span = Math.max(7, scaleLen(worldEv.corridorHalfLength * 2));
        const thick = Math.max(3, scaleLen(worldEv.corridorHalfWidth * 2));
        ctx.fillStyle = isWarn
          ? `rgba(251, 146, 60, ${(0.35 * pulse).toFixed(3)})`
          : 'rgba(251, 146, 60, 0.72)';
        ctx.strokeStyle = '#ffedd5';
        ctx.lineWidth = 1.1;
        ctx.fillRect(-span * 0.5, -thick * 0.5, span, thick);
        ctx.strokeRect(-span * 0.5, -thick * 0.5, span, thick);
      }
      ctx.restore();
    }

    // 5. Jantung Tasik Convergence Marker (radioactive drum landmark)
    const jx = toPxX(LANDMARKS.radioactiveDrum.x);
    const jy = toPxY(LANDMARKS.radioactiveDrum.z);
    ctx.save();
    ctx.strokeStyle = 'rgba(243, 210, 133, 0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(jx - 3.5, jy);
    ctx.lineTo(jx + 3.5, jy);
    ctx.moveTo(jx, jy - 3.5);
    ctx.lineTo(jx, jy + 3.5);
    ctx.stroke();
    ctx.restore();

    // 6. Active Power-Up & Healing Item Spawn Locations (hud.pickups)
    for (const pk of hud.pickups) {
      const px = toPxX(pk.x);
      const py = toPxY(pk.z);
      const isHeal = pk.kind === 'kelp_salve';
      const isRainFed =
        Boolean(pk.rainFed) ||
        pk.kind === 'monsoon_dew' ||
        pk.kind === 'storm_fin' ||
        pk.kind === 'thunder_roe';

      const primaryColor = isHeal
        ? '#4ade80'
        : pk.kind === 'amphetide'
          ? '#38bdf8'
          : pk.kind === 'fang_charge'
            ? '#fb7185'
            : pk.kind === 'carapace_ward'
              ? '#fbbf24'
              : pk.kind === 'monsoon_dew'
                ? '#2dd4bf'
                : pk.kind === 'storm_fin'
                  ? '#60a5fa'
                  : '#c084fc';
      const haloColor = isHeal
        ? 'rgba(74, 222, 128, 0.28)'
        : pk.kind === 'amphetide'
          ? 'rgba(56, 189, 248, 0.28)'
          : pk.kind === 'fang_charge'
            ? 'rgba(251, 113, 133, 0.28)'
            : pk.kind === 'carapace_ward'
              ? 'rgba(251, 191, 36, 0.28)'
              : pk.kind === 'monsoon_dew'
                ? 'rgba(45, 212, 191, 0.36)'
                : pk.kind === 'storm_fin'
                  ? 'rgba(96, 165, 250, 0.36)'
                  : 'rgba(192, 132, 252, 0.36)';

      ctx.save();
      ctx.translate(px, py);

      // Soft spawn beacon halo
      ctx.fillStyle = haloColor;
      ctx.beginPath();
      ctx.arc(0, 0, zoomMode === 'local' ? (isRainFed ? 8 : 7) : isRainFed ? 6 : 5.2, 0, Math.PI * 2);
      ctx.fill();

      if (isHeal) {
        const arm = zoomMode === 'local' ? 4.1 : 3.3;
        const thick = zoomMode === 'local' ? 1.5 : 1.25;
        ctx.fillStyle = '#07110d';
        ctx.fillRect(-thick - 0.5, -arm - 0.5, thick * 2 + 1, arm * 2 + 1);
        ctx.fillRect(-arm - 0.5, -thick - 0.5, arm * 2 + 1, thick * 2 + 1);
        ctx.fillStyle = primaryColor;
        ctx.fillRect(-thick, -arm, thick * 2, arm * 2);
        ctx.fillRect(-arm, -thick, arm * 2, thick * 2);
      } else if (isRainFed) {
        // Rain-fed droplet crest with double outline
        const r = zoomMode === 'local' ? 4.5 : 3.6;
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, r + 1.8, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = primaryColor;
        ctx.strokeStyle = '#091117';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.15);
        ctx.quadraticCurveTo(r * 1.05, r * 0.25, 0, r);
        ctx.quadraticCurveTo(-r * 1.05, r * 0.25, 0, -r * 1.15);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        const r = zoomMode === 'local' ? 4.2 : 3.4;
        ctx.fillStyle = primaryColor;
        ctx.strokeStyle = '#091117';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 7. Echo Sonar local sweep ring + Spatial Voice proximity horizon + contacts
    if (showVoiceHorizon) {
      ctx.save();
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.38)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(
        toPxX(hud.player.x),
        toPxY(hud.player.z),
        scaleLen(VOICE_MAX_DISTANCE_SIM),
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.restore();

      for (const vp of voicePeers) {
        if (!vp.alive || !vp.inRange || !vp.speaking) continue;
        const vx = toPxX(hud.player.x + Math.cos(vp.bearingRad) * vp.distance);
        const vy = toPxY(hud.player.z + Math.sin(vp.bearingRad) * vp.distance);
        ctx.save();
        ctx.strokeStyle = '#4ade80';
        ctx.fillStyle = 'rgba(74, 222, 128, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(vx, vy, 5.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    if (hud.player.sonarActive && !hud.player.sonarIsHunter) {
      const visScale = hud.weather?.visibilityRange ?? 1;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(
        toPxX(hud.player.x),
        toPxY(hud.player.z),
        scaleLen(ECHO_SONAR_RADIUS * visScale),
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    for (const contact of hud.sonarContacts) {
      const cx = toPxX(contact.x);
      const cy = toPxY(contact.z);
      ctx.save();
      ctx.translate(cx, cy);

      if (contact.kind === 'danger') {
        ctx.fillStyle = '#f87171';
        ctx.beginPath();
        ctx.moveTo(0, -4.5);
        ctx.lineTo(4, 3.5);
        ctx.lineTo(-4, 3.5);
        ctx.closePath();
        ctx.fill();
      } else if (contact.kind === 'prey') {
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#e6b86e';
        ctx.beginPath();
        ctx.moveTo(0, -4);
        ctx.lineTo(3.8, 0);
        ctx.lineTo(0, 4);
        ctx.lineTo(-3.8, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // 7a. Approximate Activity Hotspots (combat, contested feeding, convergence, large carcasses)
    if (hud.activityHotspots && hud.activityHotspots.length > 0 && !hud.finalFeast?.active) {
      for (const hs of hud.activityHotspots) {
        const remaining = hs.expiresAt - hud.matchTime;
        if (remaining <= 0) continue;
        const fade = Math.min(1, remaining / 2.2);
        const hx = toPxX(hs.x);
        const hy = toPxY(hs.z);
        const baseR = Math.max(compact ? 6 : 8, scaleLen(hs.radius));
        const pulse = 0.88 + Math.sin(hud.matchTime * 4.5 + hx * 0.1) * 0.14;
        const colorRgb =
          hs.kind === 'contested_feed'
            ? '251, 146, 60'
            : hs.kind === 'large_carcass'
              ? '250, 204, 21'
              : hs.kind === 'convergence'
                ? '56, 189, 248'
                : '248, 113, 113';

        ctx.save();
        ctx.fillStyle = `rgba(${colorRgb}, ${(0.12 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(hx, hy, baseR, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(${colorRgb}, ${(0.68 * fade).toFixed(3)})`;
        ctx.lineWidth = 1.15;
        ctx.setLineDash([3, 2.5]);
        ctx.beginPath();
        ctx.arc(hx, hy, baseR * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Tactical large (30+ fragment) carcasses within ambush range, pulsing when actively fed on
    if (hud.tacticalCarcasses && hud.tacticalCarcasses.length > 0 && !hud.finalFeast?.active) {
      const inEndgame =
        hud.endgame?.substate === 'final_convergence' || hud.endgame?.substate === 'final_hunt';
      for (const tc of hud.tacticalCarcasses) {
        const tx = toPxX(tc.x);
        const ty = toPxY(tc.z);
        ctx.save();
        if (tc.activelyFed || (inEndgame && tc.mass >= 12)) {
          const pulse = tc.activelyFed
            ? 5.5 + Math.sin(hud.matchTime * (tc.contested ? 11 : 7)) * 2.2
            : 6.4;
          ctx.strokeStyle = tc.contested
            ? 'rgba(251, 146, 60, 0.92)'
            : tc.activelyFed
              ? 'rgba(253, 224, 71, 0.82)'
              : 'rgba(253, 224, 71, 0.58)';
          ctx.lineWidth = tc.contested ? 1.65 : 1.35;
          ctx.beginPath();
          ctx.arc(tx, ty, pulse + 1.8, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = tc.contested ? '#fb923c' : '#fde047';
        ctx.strokeStyle = '#1c1204';
        ctx.lineWidth = 1.1;
        const size = inEndgame ? 5.0 : 4.4;
        ctx.beginPath();
        ctx.moveTo(tx, ty - size);
        ctx.lineTo(tx + size, ty);
        ctx.lineTo(tx, ty + size);
        ctx.lineTo(tx - size, ty);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (!compact || zoomMode === 'local') {
          const tag = tc.contested ? `⚔+${tc.mass}` : `+${tc.mass}`;
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const tw = ctx.measureText(tag).width + 4;
          ctx.fillStyle = 'rgba(18, 12, 4, 0.88)';
          ctx.fillRect(tx - tw * 0.5, ty - 14, tw, 9);
          ctx.fillStyle = tc.contested ? '#fdba74' : '#fde68a';
          ctx.fillText(tag, tx, ty - 5.5);
        }
        ctx.restore();
      }
    }

    if (hud.finalFeast?.active && hud.finalFeast.remainingCarcasses.length > 0) {
      const pxGuide = toPxX(hud.player.x);
      const pyGuide = toPxY(hud.player.z);
      for (const carc of hud.finalFeast.remainingCarcasses) {
        const lx = toPxX(carc.x);
        const ly = toPxY(carc.z);
        ctx.save();
        // Subtle dashed guide line from sole survivor to each remaining fragment container
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.32)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pxGuide, pyGuide);
        ctx.lineTo(lx, ly);
        ctx.stroke();
        ctx.setLineDash([]);

        // Pulsing golden diamond beacon
        const pulse = 5.5 + Math.sin(hud.matchTime * 6) * 1.4;
        ctx.fillStyle = 'rgba(251, 191, 36, 0.28)';
        ctx.beginPath();
        ctx.arc(lx, ly, pulse + 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#fde68a';
        ctx.fillStyle = '#f59e0b';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 5);
        ctx.lineTo(lx + 5, ly);
        ctx.lineTo(lx, ly + 5);
        ctx.lineTo(lx - 5, ly);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (!compact || zoomMode === 'local') {
          const tag = `+${carc.mass}`;
          ctx.font = 'bold 8.5px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const tw = ctx.measureText(tag).width + 4;
          ctx.fillStyle = 'rgba(20, 14, 4, 0.9)';
          ctx.fillRect(lx - tw * 0.5, ly - 15, tw, 9.5);
          ctx.fillStyle = '#fde68a';
          ctx.fillText(tag, lx, ly - 6);
        }
        ctx.restore();
      }
    } else if (hud.lastRequiredCarcass) {
      const lx = toPxX(hud.lastRequiredCarcass.x);
      const ly = toPxY(hud.lastRequiredCarcass.z);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(lx - 4, ly - 4, 8, 8);
    }

    if (hud.spectatorDots) {
      for (const dot of hud.spectatorDots) {
        if (dot.isTarget) continue;
        const dx = toPxX(dot.x);
        const dy = toPxY(dot.z);
        ctx.fillStyle = dot.level >= 80 ? '#f87171' : '#5eead4';
        ctx.beginPath();
        ctx.arc(dx, dy, dot.level >= 80 ? 3.2 : 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 7b. Multiplayer Rival Bounty Targets (players who consumed multiple rivals)
    if (hud.bountyTargets && hud.bountyTargets.length > 0) {
      for (const bounty of hud.bountyTargets) {
        const bx = toPxX(bounty.x);
        const by = toPxY(bounty.z);
        const r = zoomMode === 'local' ? 8.2 : 6.4;

        ctx.save();
        ctx.translate(bx, by);

        // Outer amber-crimson halo
        ctx.fillStyle = 'rgba(239, 68, 68, 0.24)';
        ctx.beginPath();
        ctx.arc(0, 0, r + 2.2, 0, Math.PI * 2);
        ctx.fill();

        // Crosshair ring + 4 cardinal ticks
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.3;
        const tickIn = r * 0.58;
        const tickOut = r + 2.6;
        ctx.beginPath();
        ctx.moveTo(-tickOut, 0);
        ctx.lineTo(-tickIn, 0);
        ctx.moveTo(tickIn, 0);
        ctx.lineTo(tickOut, 0);
        ctx.moveTo(0, -tickOut);
        ctx.lineTo(0, -tickIn);
        ctx.moveTo(0, tickIn);
        ctx.lineTo(0, tickOut);
        ctx.stroke();

        if (!bounty.isSelf) {
          // Diamond target core
          const cr = zoomMode === 'local' ? 3.9 : 3.2;
          ctx.fillStyle = '#fbbf24';
          ctx.strokeStyle = '#7f1d1d';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(0, -cr);
          ctx.lineTo(cr, 0);
          ctx.lineTo(0, cr);
          ctx.lineTo(-cr, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        if (!compact || zoomMode === 'local') {
          const tag = `+${bounty.rewardPoints}`;
          ctx.font = 'bold 8.5px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const tw = ctx.measureText(tag).width + 4;
          ctx.fillStyle = 'rgba(28, 10, 12, 0.88)';
          ctx.fillRect(-tw * 0.5, -r - 12, tw, 10);
          ctx.fillStyle = '#fde68a';
          ctx.fillText(tag, 0, -r - 2.5);
        }

        ctx.restore();
      }
    }

    // 8. Player Current Position Beacon + Heading Cone + Directional Chevron
    const px = toPxX(hud.player.x);
    const py = toPxY(hud.player.z);
    ctx.save();
    ctx.translate(px, py);

    // Subtle position locator ring relative to the 8x arena
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(0, 0, zoomMode === 'local' ? 11 : 8.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.rotate(hud.player.facingAngle);

    // Forward sight cone
    ctx.fillStyle = 'rgba(250, 204, 21, 0.16)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, zoomMode === 'local' ? 18 : 13, -0.45, 0.45);
    ctx.closePath();
    ctx.fill();

    // High-visibility directional chevron
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#091117';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-4.8, -4.6);
    ctx.lineTo(-2.2, 0);
    ctx.lineTo(-4.8, 4.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 9. Dynamic Weather Fog / Light Rain Visibility Overlay on radar
    const weather = hud.weather;
    if (weather && weather.intensity > 0.03) {
      if (weather.kind === 'basin_fog') {
        const clearPx = Math.max(22, cssSize * 0.28 * weather.visibilityRange);
        const fogGrad = ctx.createRadialGradient(px, py, clearPx * 0.45, px, py, clearPx * 2.1);
        fogGrad.addColorStop(0, 'rgba(186, 214, 216, 0)');
        fogGrad.addColorStop(0.55, `rgba(154, 186, 190, ${0.24 * weather.intensity})`);
        fogGrad.addColorStop(1, `rgba(128, 162, 168, ${0.46 * weather.intensity})`);
        ctx.fillStyle = fogGrad;
        ctx.fillRect(0, 0, cssSize, cssSize);
      } else if (weather.kind === 'light_rain') {
        ctx.save();
        ctx.fillStyle = `rgba(30, 58, 95, ${0.14 * weather.intensity})`;
        ctx.fillRect(0, 0, cssSize, cssSize);
        ctx.strokeStyle = `rgba(125, 211, 252, ${0.22 * weather.intensity})`;
        ctx.lineWidth = 0.8;
        for (let i = -cssSize; i < cssSize * 1.5; i += 22) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i - 18, cssSize);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }, [hud, zoomMode, showVoiceHorizon, voicePeers, cssSize, compact, collapsed]);

  if (compact && collapsed) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setCollapsed(false);
        }}
        title="Expand Basin Minimap"
        aria-label="Expand Basin Minimap"
        className="compendium-plaque-subtle flex items-center gap-1 px-2 py-1.5 rounded-[2px] text-[10px] font-mono-num font-semibold text-[#f3d285] hover:border-[#c99c4a] transition-colors"
      >
        <MapIcon className="w-3.5 h-3.5 shrink-0" />
        <span>Map</span>
      </button>
    );
  }

  return (
    <div
      className="compendium-plaque rounded-sm overflow-hidden"
      style={{ width: cssSize + 4 }}
    >
      {/* Ornate Compendium Ribbon Header */}
      <div className={`compendium-ribbon flex items-center justify-between gap-1 ${compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]'} font-semibold text-[#f7f0dc]`}>
        <span className="inline-flex items-center gap-1 min-w-0 truncate">
          {!compact && <span className="text-[8px] text-[#c99c4a]" aria-hidden="true">◆</span>}
          <span className="truncate font-display tracking-wide">
            {compact
              ? zoomMode === 'arena'
                ? '8×'
                : '2.5×'
              : hud.spectating?.active
                ? 'Spectator Map'
                : hud.player.zoneName}
          </span>
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setZoomMode((prev) => (prev === 'arena' ? 'local' : 'arena'));
            }}
            title={
              zoomMode === 'arena'
                ? 'Showing Full 8x Arena (5,656u) · Click for 2.5x Local Radar'
                : 'Showing 2.5x Local Radar · Click for Full 8x Arena'
            }
            className="px-1.5 py-0.5 rounded-[2px] bg-[#0a1218] border border-[#6e5528] text-[9px] font-mono-num text-[#f3d285] hover:border-[#f3d285] transition-colors"
          >
            {compact ? (zoomMode === 'arena' ? '2.5×' : '8×') : zoomMode === 'arena' ? '8×' : '2.5×'}
          </button>
          {compact ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed(true);
              }}
              title="Minimize Minimap"
              aria-label="Minimize Minimap"
              className="p-0.5 rounded-[2px] bg-[#0a1218] border border-[#6e5528] text-[#b8c4bf] hover:border-[#c99c4a] transition-colors"
            >
              <Minimize2 className="w-2.5 h-2.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowKey((prev) => !prev);
              }}
              title="Toggle Hazard Zones & Power-Up Spawn Key"
              className={`px-1.5 py-0.5 rounded-[2px] border text-[9px] transition-colors ${
                showKey
                  ? 'bg-[#c99c4a] border-[#f3d285] text-[#091117] font-semibold'
                  : 'bg-[#0a1218] border-[#6e5528] text-[#b8c4bf] hover:border-[#c99c4a]'
              }`}
            >
              Key
            </button>
          )}
        </div>
      </div>

      {/* Minimap Canvas with Inner Brass Rim */}
      <div
        className={`relative ${compact ? '' : 'border-b border-[#4e3d21]'}`}
        style={{ width: cssSize, height: cssSize }}
      >
        <canvas
          ref={displayCanvasRef}
          style={{ width: cssSize, height: cssSize }}
          className="block"
        />
        {!compact && (
          <span className="pointer-events-none absolute top-1 left-1.5 px-1 rounded-[2px] bg-[#091117]/80 border border-[#3a2f1c] text-[8.5px] font-mono-num text-[#c9d4d0]">
            {zoomMode === 'arena' ? '5,656u · 8×' : 'Radar 2.5×'}
          </span>
        )}
        <span className="pointer-events-none absolute top-0.5 right-1 text-[8.5px] font-mono-num font-semibold text-[#f3d285]">
          N↑
        </span>
      </div>

      {/* Collapsible Hazard & Power-Up Spawn Legend */}
      {!compact && showKey && (
        <div className="px-2 py-1.5 bg-[#091117]/95 border-b border-[#2c3b46] space-y-1 text-[9px] leading-tight">
          <div className="flex items-center justify-between gap-1 text-[#cbd5e1]">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-[1px] bg-[#84cc16] border border-[#bef264]/60 inline-block" />
              Sludge
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-[1px] bg-[#38bdf8] border border-[#bae6fd]/60 inline-block" />
              Rapids
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-[1px] bg-[#d97706] border border-[#fcd34d]/60 inline-block" />
              Mud
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-[1px] bg-[#f97316] border border-[#fdba74]/60 inline-block" />
              Brine
            </span>
          </div>
          <div className="flex items-center justify-between gap-1 text-[#cbd5e1]">
            <span className="inline-flex items-center gap-0.5 text-[#4ade80] font-semibold">
              + Heal
            </span>
            <span className="inline-flex items-center gap-0.5 text-[#7dd3fc]">
              ◆ Surge
            </span>
            <span className="inline-flex items-center gap-0.5 text-[#fda4af]">
              ◆ Fang
            </span>
            <span className="inline-flex items-center gap-0.5 text-[#fde68a]">
              ◆ Aegis
            </span>
          </div>
          <div className="flex items-center justify-between gap-1 text-[#cbd5e1] pt-0.5 border-t border-[#1c2832]">
            <span className="text-[#94a3b8]">Rain-Fed:</span>
            <span className="text-[#2dd4bf]">● Dew</span>
            <span className="text-[#60a5fa]">● Storm</span>
            <span className="text-[#c084fc]">● Roe</span>
          </div>
          <div className="flex items-center justify-between gap-1 text-[#cbd5e1] pt-0.5 border-t border-[#1c2832]">
            <span className="inline-flex items-center gap-1 text-[#fde68a] font-semibold">
              <span className="w-2 h-2 rounded-full border border-[#fbbf24] bg-[#ef4444]/60 inline-block" />
              ◎ Rival Bounty
            </span>
            <span className="text-[#fca5a5]">Surge + Pts</span>
          </div>
        </div>
      )}

      {/* Permanent 60/40 Final Arena Boundary Indicator */}
      {(hud.zone.finalZoneLocked || hud.endgame?.finalZoneLocked) && !hud.finalFeast?.active && (
        <div
          className={`flex items-center justify-between gap-1 bg-[#1e1709]/95 border-b border-[#c99c4a]/70 font-mono-num ${
            compact ? 'px-1.5 py-0.5 text-[8.5px]' : 'px-2 py-1 text-[9.5px]'
          }`}
        >
          <span className="text-[#fde68a] font-semibold truncate">
            ◆ FINAL ARENA LOCKED
          </span>
          <span className="text-[#f3d285] shrink-0">
            {Math.round(hud.zone.finalLandPercent ?? 60)}/{Math.round(hud.zone.finalWaterPercent ?? 40)}
          </span>
        </div>
      )}

      {/* Active Final Feast Summary */}
      {hud.finalFeast?.active && (
        <div
          className={`flex items-center justify-between gap-1 bg-[#251908]/95 border-b border-[#c99c4a]/70 font-mono-num ${
            compact ? 'px-1.5 py-0.5 text-[8.5px]' : 'px-2 py-1 text-[9.5px]'
          }`}
        >
          <span className="text-[#fde68a] font-semibold truncate">
            ◆ Final Feast · {hud.finalFeast.remainingCarcasses.length} Left
          </span>
          <span className="text-[#fbbf24] shrink-0">
            +{hud.finalFeast.remainingFragments} Frag
          </span>
        </div>
      )}

      {/* Active Multiplayer Rival Bounty Summary */}
      {hud.bountyTargets && hud.bountyTargets.length > 0 && (
        <div
          className={`flex items-center justify-between gap-1 bg-[#1e0b0d]/95 border-b border-[#7f1d1d]/70 font-mono-num ${
            compact ? 'px-1.5 py-0.5 text-[8.5px]' : 'px-2 py-1 text-[9.5px]'
          }`}
        >
          <span className="text-[#fbbf24] font-semibold truncate">
            {hud.bountyTargets[0].isSelf
              ? `◎ You: +${hud.bountyTargets[0].rewardPoints}`
              : `◎ ${hud.bountyTargets[0].name}`}
          </span>
          <span className="text-[#fca5a5] shrink-0">
            {compact
              ? `+${hud.bountyTargets[0].rewardPoints}`
              : `${hud.bountyTargets.length} Bounty · +${hud.bountyTargets[0].rewardPoints} Pts`}
          </span>
        </div>
      )}

      {/* Coordinates & Active Drop Count */}
      {!compact && (
        <div className="flex items-center justify-between px-2 py-1 bg-[#0b1319] text-[9.5px] font-mono-num text-[#b8c4bf]">
          <span>
            x:{Math.round(hud.player.x)} y:{Math.round(hud.player.z)}
          </span>
          <span className="text-[#f3d285]">{hud.pickups.length} Spawns</span>
        </div>
      )}
    </div>
  );
};

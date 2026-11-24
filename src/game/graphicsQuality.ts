import type { GraphicsQuality, ResolvedGraphicsQuality } from './types.ts';

export interface GraphicsQualityConfig {
  readonly tier: ResolvedGraphicsQuality;
  readonly label: string;
  readonly maxPixelRatio: number;
  readonly shadowsEnabled: boolean;
  readonly ambientParticleScale: number;
  readonly weatherParticleScale: number;
  readonly effectRingLimit: number;
  readonly shadowMapSize: number;
}

export const GRAPHICS_QUALITY_PRESETS: Record<ResolvedGraphicsQuality, GraphicsQualityConfig> = {
  low: {
    tier: 'low',
    label: 'Low',
    maxPixelRatio: 1.0,
    shadowsEnabled: false,
    ambientParticleScale: 0.35,
    weatherParticleScale: 0.4,
    effectRingLimit: 6,
    shadowMapSize: 512,
  },
  medium: {
    tier: 'medium',
    label: 'Medium',
    maxPixelRatio: 1.5,
    shadowsEnabled: true,
    ambientParticleScale: 0.7,
    weatherParticleScale: 0.75,
    effectRingLimit: 10,
    shadowMapSize: 768,
  },
  high: {
    tier: 'high',
    label: 'High',
    maxPixelRatio: 2.0,
    shadowsEnabled: true,
    ambientParticleScale: 1.0,
    weatherParticleScale: 1.0,
    effectRingLimit: 16,
    shadowMapSize: 1024,
  },
};

export interface DevicePerformanceHints {
  isSoftwareGl?: boolean;
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  isCoarsePointer?: boolean;
  isYouTubePlayables?: boolean;
}

/**
 * Deterministically resolves automatic or manual graphics quality into a bounded visual profile.
 * Strictly visual — never alters gameplay physics, combat damage, hitboxes, AI, or fragments.
 */
export function resolveGraphicsQuality(
  preference: GraphicsQuality = 'auto',
  hints?: DevicePerformanceHints
): GraphicsQualityConfig {
  if (preference === 'low' || preference === 'medium' || preference === 'high') {
    return GRAPHICS_QUALITY_PRESETS[preference];
  }

  if (hints?.isSoftwareGl) {
    return GRAPHICS_QUALITY_PRESETS.low;
  }

  const mem =
    hints?.deviceMemoryGb ??
    (typeof navigator !== 'undefined'
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4)
      : 4);
  const cores =
    hints?.hardwareConcurrency ??
    (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4);
  const coarse =
    hints?.isCoarsePointer ??
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false);

  if (mem <= 2 || cores <= 2) {
    return GRAPHICS_QUALITY_PRESETS.low;
  }
  if (coarse || hints?.isYouTubePlayables || mem <= 4 || cores <= 4) {
    return GRAPHICS_QUALITY_PRESETS.medium;
  }
  return GRAPHICS_QUALITY_PRESETS.high;
}

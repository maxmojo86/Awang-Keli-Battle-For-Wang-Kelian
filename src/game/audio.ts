import { ArenaZoneId, HazardTileKind, TerrainType, WeatherKind } from './types';

export interface AmbientEnvironmentState {
  dt: number;
  speed: number;
  terrain: TerrainType;
  zoneId: ArenaZoneId;
  hazard: HazardTileKind | null;
  weather?: WeatherKind;
  weatherIntensity?: number;
  paused?: boolean;
}

export interface AmbientAcousticProfile {
  bedGain: number;
  bedCutoffHz: number;
  bedQ: number;
  rippleIntervalSec: number;
  rippleFreqMin: number;
  rippleFreqMax: number;
  rippleKind: 'drip' | 'ripple' | 'rush' | 'sizzle' | 'squelch';
  bubbleIntervalSec: number;
  bubbleFreqMin: number;
  bubbleFreqMax: number;
  bubbleGain: number;
}

export function getAmbientProfile(
  zoneId: ArenaZoneId,
  terrain: TerrainType,
  hazard: HazardTileKind | null,
  speed: number
): AmbientAcousticProfile {
  const moveRatio = Math.min(1, Math.max(0, speed / 210));

  // Base aquatic region acoustic character
  let profile: AmbientAcousticProfile;
  switch (zoneId) {
    case 'gua_kelam_tua':
      profile = {
        bedGain: 0.14,
        bedCutoffHz: 230,
        bedQ: 3.1,
        rippleIntervalSec: 1.05 - moveRatio * 0.55,
        rippleFreqMin: 680,
        rippleFreqMax: 1280,
        rippleKind: 'drip',
        bubbleIntervalSec: 1.5 - moveRatio * 0.5,
        bubbleFreqMin: 140,
        bubbleFreqMax: 290,
        bubbleGain: 0.06,
      };
      break;
    case 'terowong_bijih':
      profile = {
        bedGain: 0.17,
        bedCutoffHz: 460,
        bedQ: 1.2,
        rippleIntervalSec: 0.48 - moveRatio * 0.22,
        rippleFreqMin: 340,
        rippleFreqMax: 780,
        rippleKind: 'ripple',
        bubbleIntervalSec: 0.95 - moveRatio * 0.35,
        bubbleFreqMin: 160,
        bubbleFreqMax: 330,
        bubbleGain: 0.06,
      };
      break;
    case 'sungai_berselirat':
      profile = {
        bedGain: 0.15,
        bedCutoffHz: 520,
        bedQ: 1.1,
        rippleIntervalSec: 0.38 - moveRatio * 0.18,
        rippleFreqMin: 480,
        rippleFreqMax: 1050,
        rippleKind: 'ripple',
        bubbleIntervalSec: 1.05 - moveRatio * 0.35,
        bubbleFreqMin: 210,
        bubbleFreqMax: 410,
        bubbleGain: 0.055,
      };
      break;
    case 'tebing_kering':
      profile = {
        bedGain: 0.1,
        bedCutoffHz: 340,
        bedQ: 0.85,
        rippleIntervalSec: 0.72 - moveRatio * 0.3,
        rippleFreqMin: 360,
        rippleFreqMax: 720,
        rippleKind: 'ripple',
        bubbleIntervalSec: 1.65 - moveRatio * 0.45,
        bubbleFreqMin: 125,
        bubbleFreqMax: 250,
        bubbleGain: 0.045,
      };
      break;
    case 'jantung_tasik':
      profile = {
        bedGain: 0.18,
        bedCutoffHz: 265,
        bedQ: 2.2,
        rippleIntervalSec: 0.68 - moveRatio * 0.32,
        rippleFreqMin: 300,
        rippleFreqMax: 680,
        rippleKind: 'ripple',
        bubbleIntervalSec: 0.65 - moveRatio * 0.22,
        bubbleFreqMin: 130,
        bubbleFreqMax: 340,
        bubbleGain: 0.075,
      };
      break;
    case 'lubuk_hitam':
    default:
      profile = {
        bedGain: 0.15,
        bedCutoffHz: 215,
        bedQ: 1.0,
        rippleIntervalSec: 0.82 - moveRatio * 0.42,
        rippleFreqMin: 280,
        rippleFreqMax: 620,
        rippleKind: 'ripple',
        bubbleIntervalSec: 1.15 - moveRatio * 0.4,
        bubbleFreqMin: 105,
        bubbleFreqMax: 230,
        bubbleGain: 0.06,
      };
      break;
  }

  // Terrain depth / shoreline attenuation
  if (terrain === 'shore') {
    profile.bedGain *= 0.55;
    profile.bedCutoffHz = Math.max(180, profile.bedCutoffHz * 0.8);
    profile.rippleIntervalSec *= 1.9;
    profile.bubbleIntervalSec *= 1.8;
  } else if (terrain === 'shallow') {
    profile.bedCutoffHz = Math.min(820, profile.bedCutoffHz + 95);
    profile.rippleIntervalSec *= 0.84;
  }

  // Movement turbulence lifts cutoff & ripple pace
  profile.bedGain += moveRatio * 0.05;
  profile.bedCutoffHz += moveRatio * 140;

  // Hazard tile overrides give each hazard a distinct sound signature
  if (hazard === 'toxic_sludge') {
    profile.bedGain = 0.19 + moveRatio * 0.05;
    profile.bedCutoffHz = 290;
    profile.bedQ = 3.6;
    profile.rippleKind = 'squelch';
    profile.rippleIntervalSec = 0.58 - moveRatio * 0.22;
    profile.rippleFreqMin = 210;
    profile.rippleFreqMax = 430;
    profile.bubbleIntervalSec = 0.34 - moveRatio * 0.12;
    profile.bubbleFreqMin = 115;
    profile.bubbleFreqMax = 310;
    profile.bubbleGain = 0.11;
  } else if (hazard === 'rapids') {
    profile.bedGain = 0.27 + moveRatio * 0.06;
    profile.bedCutoffHz = 920;
    profile.bedQ = 0.9;
    profile.rippleKind = 'rush';
    profile.rippleIntervalSec = 0.22 - moveRatio * 0.08;
    profile.rippleFreqMin = 580;
    profile.rippleFreqMax = 1480;
    profile.bubbleIntervalSec = 0.42 - moveRatio * 0.14;
    profile.bubbleFreqMin = 280;
    profile.bubbleFreqMax = 620;
    profile.bubbleGain = 0.08;
  } else if (hazard === 'quagmire') {
    profile.bedGain = 0.13 + moveRatio * 0.04;
    profile.bedCutoffHz = 175;
    profile.bedQ = 2.5;
    profile.rippleKind = 'squelch';
    profile.rippleIntervalSec = 0.72 - moveRatio * 0.3;
    profile.rippleFreqMin = 120;
    profile.rippleFreqMax = 260;
    profile.bubbleIntervalSec = 0.48 - moveRatio * 0.18;
    profile.bubbleFreqMin = 68;
    profile.bubbleFreqMax = 155;
    profile.bubbleGain = 0.1;
  } else if (hazard === 'thermal_vent') {
    profile.bedGain = 0.22 + moveRatio * 0.05;
    profile.bedCutoffHz = 1280;
    profile.bedQ = 1.6;
    profile.rippleKind = 'sizzle';
    profile.rippleIntervalSec = 0.26 - moveRatio * 0.08;
    profile.rippleFreqMin = 920;
    profile.rippleFreqMax = 2100;
    profile.bubbleIntervalSec = 0.19 - moveRatio * 0.06;
    profile.bubbleFreqMin = 420;
    profile.bubbleFreqMax = 980;
    profile.bubbleGain = 0.095;
  }

  return profile;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientStarted = false;
  private ambientActive = false;
  private muted = false;
  private volume = 0.6;

  private rippleTimer = 0.35;
  private bubbleTimer = 0.7;
  private rainDropTimer = 0.2;
  private lastZoneId: ArenaZoneId | null = null;
  private lastTerrain: TerrainType | null = null;
  private lastHazard: HazardTileKind | null = null;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.03 * white) / 1.03;
      lastOut = output[i];
      output[i] *= 2.4;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.muted) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  public startAmbient() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    this.ambientActive = true;

    if (this.ambientStarted) {
      if (this.ambientGain) {
        this.ambientGain.gain.setTargetAtTime(0.14, ctx.currentTime, 0.18);
      }
      return;
    }

    this.ambientStarted = true;

    try {
      const noiseBuffer = this.getNoiseBuffer(ctx);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;

      this.ambientFilter = ctx.createBiquadFilter();
      this.ambientFilter.type = 'lowpass';
      this.ambientFilter.frequency.value = 240;
      this.ambientFilter.Q.value = 1.0;

      this.ambientGain = ctx.createGain();
      this.ambientGain.gain.value = 0.001;
      this.ambientGain.gain.setTargetAtTime(0.14, ctx.currentTime, 0.25);

      noise.connect(this.ambientFilter);
      this.ambientFilter.connect(this.ambientGain);
      this.ambientGain.connect(this.masterGain);
      noise.start();

      // Secondary filtered rain-patter noise bed
      const rainNoise = ctx.createBufferSource();
      rainNoise.buffer = noiseBuffer;
      rainNoise.loop = true;

      this.rainFilter = ctx.createBiquadFilter();
      this.rainFilter.type = 'bandpass';
      this.rainFilter.frequency.value = 1650;
      this.rainFilter.Q.value = 0.65;

      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0.0001;

      rainNoise.connect(this.rainFilter);
      this.rainFilter.connect(this.rainGain);
      this.rainGain.connect(this.masterGain);
      rainNoise.start(0, 0.7);
    } catch {
      // Ignore audio autoplay blocks cleanly
    }
  }

  public stopAmbient() {
    this.ambientActive = false;
    this.lastHazard = null;
    this.lastZoneId = null;
    this.lastTerrain = null;
    if (this.ambientGain && this.ctx) {
      this.ambientGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
    if (this.rainGain && this.ctx) {
      this.rainGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
  }

  /**
   * Modulates the ambient lake bed and triggers procedural water-rippling,
   * cavern droplet, whitewater rush, and hazard bubbling effects based on
   * the player's current region, terrain depth, hazard tile, and swim speed.
   */
  public updateAmbientEnvironment(state: AmbientEnvironmentState) {
    if (this.muted || !this.ambientActive) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain || !this.ambientGain || !this.ambientFilter) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    if (state.paused) {
      this.ambientGain.gain.setTargetAtTime(0, now, 0.12);
      if (this.rainGain) this.rainGain.gain.setTargetAtTime(0, now, 0.12);
      return;
    }

    const profile = getAmbientProfile(state.zoneId, state.terrain, state.hazard, state.speed);
    const weather = state.weather ?? 'clear';
    const wInt = Math.max(0, Math.min(1, state.weatherIntensity ?? 0));

    // Fog dampens upper frequencies for a hushed atmospheric mist; rain adds crisp patter bed
    const fogCutoffFactor = weather === 'basin_fog' ? 1 - 0.34 * wInt : 1;
    const effectiveBedGain = profile.bedGain * (weather === 'basin_fog' ? 1 - 0.18 * wInt : 1);

    // Smoothly morph water bed tone & volume
    this.ambientGain.gain.setTargetAtTime(effectiveBedGain, now, 0.22);
    this.ambientFilter.frequency.setTargetAtTime(profile.bedCutoffHz * fogCutoffFactor, now, 0.22);
    this.ambientFilter.Q.setTargetAtTime(profile.bedQ, now, 0.22);

    if (this.rainGain && this.rainFilter) {
      const targetRainGain =
        weather === 'light_rain' ? (state.terrain === 'shore' ? 0.085 : 0.115) * wInt : 0;
      this.rainGain.gain.setTargetAtTime(targetRainGain, now, 0.35);
      this.rainFilter.frequency.setTargetAtTime(state.terrain === 'shore' ? 1950 : 1480, now, 0.3);
    }

    // Immediate audio cue when crossing into a hazard tile or switching aquatic zones
    if (state.hazard !== this.lastHazard) {
      if (state.hazard !== null) {
        this.playHazardTransitionCue(state.hazard);
        this.bubbleTimer = Math.min(this.bubbleTimer, 0.18);
      }
      this.lastHazard = state.hazard;
    }

    if (
      state.zoneId !== this.lastZoneId ||
      (this.lastTerrain === 'shore' && (state.terrain === 'shallow' || state.terrain === 'deep'))
    ) {
      if (this.lastZoneId !== null) {
        this.triggerWaterRipple(profile, true);
      }
      this.lastZoneId = state.zoneId;
    }
    this.lastTerrain = state.terrain;

    const dt = Math.min(0.1, Math.max(0.001, state.dt));
    this.rippleTimer -= dt;
    if (this.rippleTimer <= 0) {
      this.rippleTimer = Math.max(0.12, profile.rippleIntervalSec * (0.75 + Math.random() * 0.5));
      this.triggerWaterRipple(profile, state.speed > 25);
    }

    this.bubbleTimer -= dt;
    if (this.bubbleTimer <= 0) {
      this.bubbleTimer = Math.max(0.1, profile.bubbleIntervalSec * (0.7 + Math.random() * 0.6));
      this.triggerBubble(profile, state.hazard);
    }

    if (weather === 'light_rain' && wInt > 0.15) {
      this.rainDropTimer -= dt;
      if (this.rainDropTimer <= 0) {
        this.rainDropTimer = (0.14 + Math.random() * 0.22) / Math.max(0.35, wInt);
        this.triggerRainPatter(wInt);
      }
    }
  }

  private triggerRainPatter(intensity: number) {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const base = 780 + Math.random() * 980;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.42, now + 0.038);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.022 * intensity, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.075);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  private playHazardTransitionCue(hazard: HazardTileKind) {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    if (hazard === 'toxic_sludge' || hazard === 'quagmire') {
      // Viscous double-glug entry
      [0, 0.08].forEach((offset, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const base = hazard === 'toxic_sludge' ? 125 + idx * 35 : 75 + idx * 20;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(base, now + offset);
        osc.frequency.exponentialRampToValueAtTime(base * 2.25, now + offset + 0.09);

        gain.gain.setValueAtTime(0.001, now + offset);
        gain.gain.linearRampToValueAtTime(0.11, now + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.11);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(now + offset);
        osc.stop(now + offset + 0.12);
      });
    } else if (hazard === 'rapids') {
      // Surging whitewater wash
      const src = ctx.createBufferSource();
      src.buffer = this.getNoiseBuffer(ctx);
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(620, now);
      filter.frequency.exponentialRampToValueAtTime(1350, now + 0.24);
      filter.Q.value = 1.6;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      src.start(now);
      src.stop(now + 0.36);
    } else if (hazard === 'thermal_vent') {
      // Geothermal steam sizzle + rapid boil pop
      const src = ctx.createBufferSource();
      src.buffer = this.getNoiseBuffer(ctx);
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1450;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      src.start(now);
      src.stop(now + 0.3);
    }
  }

  private triggerWaterRipple(profile: AmbientAcousticProfile, moving: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const fStart =
      profile.rippleFreqMin + Math.random() * (profile.rippleFreqMax - profile.rippleFreqMin);

    if (profile.rippleKind === 'drip') {
      // Resonant Gua Kelam cavern water droplet
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(fStart, now);
      osc.frequency.exponentialRampToValueAtTime(fStart * 1.48, now + 0.055);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(moving ? 0.065 : 0.048, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.15);
      return;
    }

    // Filtered noise ripple / stream rush / steam sizzle / mud squelch
    const src = ctx.createBufferSource();
    src.buffer = this.getNoiseBuffer(ctx);
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = profile.rippleKind === 'sizzle' ? 'highpass' : 'bandpass';
    filter.Q.value =
      profile.rippleKind === 'squelch' ? 4.8 : profile.rippleKind === 'rush' ? 1.8 : 3.0;
    filter.frequency.setValueAtTime(fStart, now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(80, fStart * (profile.rippleKind === 'squelch' ? 0.62 : 1.32)),
      now + 0.13
    );

    const amp =
      profile.rippleKind === 'rush'
        ? 0.085
        : profile.rippleKind === 'sizzle'
          ? 0.05
          : moving
            ? 0.065
            : 0.038;
    const dur = profile.rippleKind === 'rush' ? 0.2 : 0.14;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, Math.random() * 1.2);
    src.stop(now + dur + 0.02);
  }

  private triggerBubble(profile: AmbientAcousticProfile, hazard: HazardTileKind | null) {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const f0 =
      profile.bubbleFreqMin + Math.random() * (profile.bubbleFreqMax - profile.bubbleFreqMin);
    const dur = hazard === 'quagmire' ? 0.12 : hazard === 'thermal_vent' ? 0.06 : 0.085;
    const rise = hazard === 'toxic_sludge' ? 2.15 : hazard === 'thermal_vent' ? 1.85 : 1.7;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = hazard === 'toxic_sludge' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f0 * rise, now + dur);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(profile.bubbleGain, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.015);
  }

  /**
   * Iconic tin-mine shift whistle from Setelah Tasik Senyap
   */
  public playShiftWhistle() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const freqs = [587.33, 740.0, 880.0];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f * 0.98, now);
      osc.frequency.linearRampToValueAtTime(f, now + 0.15);
      osc.frequency.exponentialRampToValueAtTime(f * 0.96, now + 1.45);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(idx === 0 ? 0.13 : 0.06, now + 0.18);
      gain.gain.setValueAtTime(idx === 0 ? 0.11 : 0.05, now + 0.95);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.55);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now);
      osc.stop(now + 1.6);
    });
  }

  public playBite(heavy = false) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 180 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.14);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = heavy ? 680 : 900;

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playDash() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.28);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  public playSonar(isHunter: boolean) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const baseFreq = isHunter ? 880 : 660;
    [1, 1.5].forEach((mult, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * mult, now + i * 0.11);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * mult * 0.92, now + 0.75 + i * 0.11);

      gain.gain.setValueAtTime(0.001, now + i * 0.11);
      gain.gain.linearRampToValueAtTime(isHunter ? 0.16 : 0.12, now + i * 0.11 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85 + i * 0.11);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.11);
      osc.stop(now + 0.9 + i * 0.11);
    });
  }

  public playVeil() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.45);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  public playElectroshock() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.setValueAtTime(840, now + 0.04);
    osc.frequency.setValueAtTime(310, now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.32);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  public playMaelstrom() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(75, now);
    osc.frequency.linearRampToValueAtTime(190, now + 0.4);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.9);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;

    gain.gain.setValueAtTime(0.02, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.98);
  }

  public playFeedComplete() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    [330, 440].forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.07);
      gain.gain.setValueAtTime(0.15, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.22);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.24);
    });
  }

  public playEvolution() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    [220, 277.18, 329.63, 440].forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.08);
      gain.gain.setValueAtTime(0.16, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.45);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.48);
    });
  }

  public playDeath() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.55);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  public playPickup(isHealing: boolean) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const notes = isHealing ? [523.25, 659.25, 783.99] : [440, 587.33, 880];
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isHealing ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.055);
      gain.gain.setValueAtTime(0.001, now + idx * 0.055);
      gain.gain.linearRampToValueAtTime(0.14, now + idx * 0.055 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.24);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + idx * 0.055);
      osc.stop(now + idx * 0.055 + 0.26);
    });
  }

  public playRainFedPickup() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    [587.33, 783.99, 987.77, 1174.66].forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.048);
      gain.gain.setValueAtTime(0.001, now + idx * 0.048);
      gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.048 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.048 + 0.28);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + idx * 0.048);
      osc.stop(now + idx * 0.048 + 0.3);
    });
  }

  public playWeatherCue(kind: WeatherKind) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    if (kind === 'light_rain') {
      // Gentle distant wind & rain wash swell
      const src = ctx.createBufferSource();
      src.buffer = this.getNoiseBuffer(ctx);
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(520, now);
      filter.frequency.exponentialRampToValueAtTime(1450, now + 0.65);
      filter.Q.value = 1.1;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      src.start(now);
      src.stop(now + 1.0);
    } else if (kind === 'basin_fog') {
      // Deep hollow karst mist chime
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(196, now);
      osc.frequency.exponentialRampToValueAtTime(130.8, now + 0.85);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.95);
    }
  }
}

export const soundEngine = new SoundEngine();

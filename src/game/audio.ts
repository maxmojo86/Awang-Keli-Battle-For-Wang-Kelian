import { ArenaZoneId, EvolutionForm, HazardTileKind, TerrainType, WeatherKind } from './types';

export interface AmbientEnvironmentState {
  dt: number;
  speed: number;
  terrain: TerrainType;
  zoneId: ArenaZoneId;
  hazard: HazardTileKind | null;
  weather?: WeatherKind;
  weatherIntensity?: number;
  form?: EvolutionForm;
  level?: number;
  deathCamActive?: boolean;
  paused?: boolean;
}

export interface EvolutionAudioProfile {
  form: EvolutionForm;
  layerCount: number;
  tempoBpm: number;
  pulseIntervalSec: number;
  baseFreqHz: number;
  subFreqHz: number;
  droneGain: number;
  fifthGain: number;
  shimmerGain: number;
  droneCutoffHz: number;
  pulseGain: number;
  subGain: number;
  harmonicGain: number;
  bassCutoffHz: number;
  accentEvery: number;
  percussiveWeight: number;
}

export function getEvolutionAudioProfile(
  form: EvolutionForm,
  level = 1
): EvolutionAudioProfile {
  const clampedLevel = Math.max(1, Math.min(100, level));

  if (form === 1) {
    const p = Math.max(0, Math.min(1, (clampedLevel - 1) / 38));
    const tempoBpm = 54 + p * 6;
    return {
      form: 1,
      layerCount: 1,
      tempoBpm,
      pulseIntervalSec: 60 / tempoBpm,
      baseFreqHz: 55.0,
      subFreqHz: 27.5,
      droneGain: 0.042 + p * 0.008,
      fifthGain: 0,
      shimmerGain: 0,
      droneCutoffHz: 155 + p * 20,
      pulseGain: 0.068 + p * 0.01,
      subGain: 0.024 + p * 0.006,
      harmonicGain: 0.016 + p * 0.004,
      bassCutoffHz: 155 + p * 25,
      accentEvery: 4,
      percussiveWeight: 0,
    };
  }

  if (form === 2) {
    const p = Math.max(0, Math.min(1, (clampedLevel - 40) / 39));
    const tempoBpm = 72 + p * 8;
    return {
      form: 2,
      layerCount: 2,
      tempoBpm,
      pulseIntervalSec: 60 / tempoBpm,
      baseFreqHz: 61.74,
      subFreqHz: 30.87,
      droneGain: 0.056 + p * 0.008,
      fifthGain: 0.022 + p * 0.005,
      shimmerGain: 0.008 + p * 0.004,
      droneCutoffHz: 235 + p * 30,
      pulseGain: 0.095 + p * 0.012,
      subGain: 0.044 + p * 0.008,
      harmonicGain: 0.032 + p * 0.006,
      bassCutoffHz: 245 + p * 35,
      accentEvery: 2,
      percussiveWeight: 0.16,
    };
  }

  if (form === 3) {
    const p = Math.max(0, Math.min(1, (clampedLevel - 80) / 19));
    const tempoBpm = 92 + p * 8;
    return {
      form: 3,
      layerCount: 3,
      tempoBpm,
      pulseIntervalSec: 60 / tempoBpm,
      baseFreqHz: 73.42,
      subFreqHz: 36.71,
      droneGain: 0.068 + p * 0.008,
      fifthGain: 0.032 + p * 0.004,
      shimmerGain: 0.024 + p * 0.006,
      droneCutoffHz: 345 + p * 40,
      pulseGain: 0.122 + p * 0.01,
      subGain: 0.068 + p * 0.008,
      harmonicGain: 0.048 + p * 0.006,
      bassCutoffHz: 365 + p * 45,
      accentEvery: 4,
      percussiveWeight: 0.48,
    };
  }

  const tempoBpm = 112;
  return {
    form: 4,
    layerCount: 4,
    tempoBpm,
    pulseIntervalSec: 60 / tempoBpm,
    baseFreqHz: 82.41,
    subFreqHz: 41.2,
    droneGain: 0.084,
    fifthGain: 0.044,
    shimmerGain: 0.042,
    droneCutoffHz: 460,
    pulseGain: 0.145,
    subGain: 0.088,
    harmonicGain: 0.064,
    bassCutoffHz: 490,
    accentEvery: 4,
    percussiveWeight: 0.8,
  };
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

export const MENU_SOUNDTRACK_URL = '/assets/aistudio/Panggilan_Lubuk_Hitam_8b130ca5.mp3';

export type MenuMusicStatus =
  | 'idle'
  | 'awaiting_gesture'
  | 'loading'
  | 'blocked'
  | 'playing'
  | 'paused'
  | 'error';

export interface MenuMusicSnapshot {
  status: MenuMusicStatus;
  errorMessage: string | null;
  volume: number;
  muted: boolean;
  wanted: boolean;
  activeSourcesCount: number;
  fadeGainValue: number;
  musicGainValue: number;
  outputGainValue: number;
}

const XFADE_STEPS = 65;
const COS_XFADE_CURVE = new Float32Array(XFADE_STEPS);
const SIN_XFADE_CURVE = new Float32Array(XFADE_STEPS);
for (let i = 0; i < XFADE_STEPS; i++) {
  const phase = (i / (XFADE_STEPS - 1)) * (Math.PI * 0.5);
  COS_XFADE_CURVE[i] = Math.cos(phase);
  SIN_XFADE_CURVE[i] = Math.sin(phase);
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private outputGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private musicVolumeGain: GainNode | null = null;
  private musicFadeGain: GainNode | null = null;
  private musicDeckGains: [GainNode, GainNode] | null = null;

  private ambientGain: GainNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private fifthGain: GainNode | null = null;
  private shimmerGain: GainNode | null = null;
  private droneOscRoot: OscillatorNode | null = null;
  private droneOscFifth: OscillatorNode | null = null;
  private shimmerOsc: OscillatorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientStarted = false;
  private ambientActive = false;
  private muted = false;
  private volume = 0.65;
  private musicVolume = 0.35;

  // Menu soundtrack state (single instance across renders, resize & orientation changes)
  private rawAudioBytes: ArrayBuffer | null = null;
  private rawAudioPromise: Promise<ArrayBuffer | null> | null = null;
  private menuMusicBuffer: AudioBuffer | null = null;
  private decodePromise: Promise<AudioBuffer | null> | null = null;
  private menuMusicWanted = false;
  private menuMusicStatus: MenuMusicStatus = 'idle';
  private menuMusicError: string | null = null;
  private menuMusicPlaying = false;
  private wasPlayingBeforeHide = false;
  private gestureUnlocked = false;
  private gestureListenersAttached = false;
  private visibilityListenerAttached = false;
  private lifecycleRefCount = 0;
  private activeMusicSources = new Set<AudioBufferSourceNode>();
  private loopTimerId: number | null = null;
  private fadeOutStopTimerId: number | null = null;
  private loopEpoch = 0;
  private fadeEpoch = 0;
  private trackCtxStart = 0;
  private trackOffsetStart = 0.13;
  private pausedOffsetSec = 0.13;
  private menuMusicListeners = new Set<(snap: MenuMusicSnapshot) => void>();
  private unlockPromise: Promise<boolean> | null = null;
  private lastBlockedAttemptMs = 0;

  private rippleTimer = 0.35;
  private bubbleTimer = 0.7;
  private rainDropTimer = 0.2;
  private bassPulseTimer = 0.25;
  private bassBeatIndex = 0;
  private lastZoneId: ArenaZoneId | null = null;
  private lastTerrain: TerrainType | null = null;
  private lastHazard: HazardTileKind | null = null;
  private lastForm: EvolutionForm | null = null;

  private ensureAudioContextRaw(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      this.outputGain = ctx.createGain();
      this.outputGain.gain.value = this.muted ? 0 : 1;
      this.outputGain.connect(ctx.destination);

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.outputGain);

      this.musicVolumeGain = ctx.createGain();
      this.musicVolumeGain.gain.value = this.musicVolume;
      this.musicVolumeGain.connect(this.outputGain);

      this.musicFadeGain = ctx.createGain();
      this.musicFadeGain.gain.value = 0;
      this.musicFadeGain.connect(this.musicVolumeGain);

      const deckA = ctx.createGain();
      const deckB = ctx.createGain();
      deckA.gain.value = 0;
      deckB.gain.value = 0;
      deckA.connect(this.musicFadeGain);
      deckB.connect(this.musicFadeGain);
      this.musicDeckGains = [deckA, deckB];
    }
    return this.ctx;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    const ctx = this.ensureAudioContextRaw();
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
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

  public getMenuMusicSnapshot(): MenuMusicSnapshot {
    return {
      status: this.menuMusicStatus,
      errorMessage: this.menuMusicError,
      volume: this.musicVolume,
      muted: this.muted,
      wanted: this.menuMusicWanted,
      activeSourcesCount: this.activeMusicSources.size,
      fadeGainValue: this.musicFadeGain ? this.musicFadeGain.gain.value : 0,
      musicGainValue: this.musicVolumeGain ? this.musicVolumeGain.gain.value : this.musicVolume,
      outputGainValue: this.outputGain ? this.outputGain.gain.value : this.muted ? 0 : 1,
    };
  }

  public subscribeMenuMusic(listener: (snap: MenuMusicSnapshot) => void): () => void {
    this.menuMusicListeners.add(listener);
    listener(this.getMenuMusicSnapshot());
    return () => {
      this.menuMusicListeners.delete(listener);
    };
  }

  private notifyMenuMusic() {
    const snap = this.getMenuMusicSnapshot();
    for (const listener of this.menuMusicListeners) {
      listener(snap);
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.outputGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.outputGain.gain.cancelScheduledValues(now);
      this.outputGain.gain.setValueAtTime(this.outputGain.gain.value, now);
      this.outputGain.gain.setTargetAtTime(muted ? 0 : 1, now, 0.03);
    }
    this.notifyMenuMusic();
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 0.65));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  public setMusicVolume(vol: number) {
    this.musicVolume = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 0.35));
    if (this.musicVolumeGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.musicVolumeGain.gain.cancelScheduledValues(now);
      this.musicVolumeGain.gain.setValueAtTime(this.musicVolumeGain.gain.value, now);
      this.musicVolumeGain.gain.setTargetAtTime(this.musicVolume, now, 0.03);
    }
    this.notifyMenuMusic();
  }

  public unlockFromGesture(): boolean {
    if (this.muted || typeof window === 'undefined') return false;
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return true;
  }

  public attachMenuMusicLifecycle(): () => void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return () => {};
    }
    this.lifecycleRefCount += 1;
    if (!this.visibilityListenerAttached) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      this.visibilityListenerAttached = true;
    }
    return () => {
      this.lifecycleRefCount = Math.max(0, this.lifecycleRefCount - 1);
      if (this.lifecycleRefCount === 0) {
        this.disposeMenuMusic();
      }
    };
  }

  public preloadMenuMusic(): Promise<ArrayBuffer | null> {
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
      return Promise.resolve(null);
    }
    if (this.rawAudioBytes) {
      return Promise.resolve(this.rawAudioBytes);
    }
    if (this.rawAudioPromise) {
      return this.rawAudioPromise;
    }

    this.menuMusicError = null;
    if (this.menuMusicStatus === 'idle' || this.menuMusicStatus === 'error') {
      this.menuMusicStatus = this.gestureUnlocked ? 'loading' : 'awaiting_gesture';
      this.notifyMenuMusic();
    }

    this.rawAudioPromise = fetch(MENU_SOUNDTRACK_URL)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const buf = await res.arrayBuffer();
        if (!buf || buf.byteLength === 0) {
          throw new Error('Empty audio payload');
        }
        this.rawAudioBytes = buf;
        return buf;
      })
      .catch(() => {
        this.menuMusicError = 'Menu soundtrack unavailable — menu & SFX remain active.';
        this.menuMusicStatus = 'error';
        this.teardownGestureListeners();
        this.notifyMenuMusic();
        return null;
      });

    return this.rawAudioPromise;
  }

  public retryMenuMusic(): Promise<boolean> {
    this.rawAudioBytes = null;
    this.rawAudioPromise = null;
    this.menuMusicBuffer = null;
    this.decodePromise = null;
    this.menuMusicError = null;
    this.menuMusicStatus = this.gestureUnlocked ? 'loading' : 'awaiting_gesture';
    this.notifyMenuMusic();
    if (this.menuMusicWanted) {
      this.armGestureListeners();
      return this.unlockMenuMusicFromGesture();
    }
    return Promise.resolve(false);
  }

  public setMenuMusicWanted(wanted: boolean, fadeSec = 1.0) {
    if (wanted) {
      if (this.ambientActive) {
        this.stopAmbient();
      }
      this.menuMusicWanted = true;

      // Cancel any pending stop-after-fade-out timer immediately
      this.fadeEpoch += 1;
      if (this.fadeOutStopTimerId !== null) {
        window.clearTimeout(this.fadeOutStopTimerId);
        this.fadeOutStopTimerId = null;
      }

      if (this.menuMusicError) {
        this.menuMusicStatus = 'error';
        this.notifyMenuMusic();
        return;
      }

      const pageHidden = typeof document !== 'undefined' && document.hidden;
      if (pageHidden) {
        this.wasPlayingBeforeHide = true;
        this.menuMusicStatus = 'paused';
        this.notifyMenuMusic();
        return;
      }

      if (this.menuMusicPlaying && this.ctx && this.musicFadeGain) {
        // Already running (e.g. returned mid-fade-out): ramp back up smoothly
        const now = this.ctx.currentTime;
        const cur = Math.max(0, Math.min(1, this.musicFadeGain.gain.value));
        this.musicFadeGain.gain.cancelScheduledValues(now);
        this.musicFadeGain.gain.setValueAtTime(cur, now);
        this.musicFadeGain.gain.linearRampToValueAtTime(1.0, now + 1.5);
        this.menuMusicStatus = 'playing';
        this.notifyMenuMusic();
        return;
      }

      if (this.gestureUnlocked && !this.muted && this.ctx && this.ctx.state === 'running') {
        void this.startOrResumeDecodedLoop(this.ctx, 1.5);
      } else {
        this.menuMusicStatus = 'awaiting_gesture';
        this.armGestureListeners();
        this.notifyMenuMusic();
      }
      return;
    }

    // wanted === false (e.g. PLAY clicked -> fade out cleanly over ~1s)
    this.menuMusicWanted = false;
    this.wasPlayingBeforeHide = false;
    this.teardownGestureListeners();

    this.fadeEpoch += 1;
    const localFadeEpoch = this.fadeEpoch;
    if (this.fadeOutStopTimerId !== null) {
      window.clearTimeout(this.fadeOutStopTimerId);
      this.fadeOutStopTimerId = null;
    }

    if (!this.menuMusicPlaying || !this.ctx || !this.musicFadeGain) {
      this.menuMusicStatus = this.menuMusicError ? 'error' : 'paused';
      this.notifyMenuMusic();
      return;
    }

    const dur = Math.max(0.08, fadeSec);
    const now = this.ctx.currentTime;
    const currentGain = Math.max(0, Math.min(1, this.musicFadeGain.gain.value));
    this.musicFadeGain.gain.cancelScheduledValues(now);
    this.musicFadeGain.gain.setValueAtTime(currentGain, now);
    this.musicFadeGain.gain.linearRampToValueAtTime(0, now + dur);

    this.fadeOutStopTimerId = window.setTimeout(() => {
      if (localFadeEpoch !== this.fadeEpoch || this.menuMusicWanted) return;
      this.fadeOutStopTimerId = null;
      this.pauseActiveMusicSources(true);
      this.menuMusicStatus = this.menuMusicError ? 'error' : 'paused';
      this.notifyMenuMusic();
    }, Math.ceil(dur * 1000) + 50);
    this.notifyMenuMusic();
  }

  public unlockMenuMusicFromGesture(): Promise<boolean> {
    if (this.unlockPromise) return this.unlockPromise;
    const task = this.runUnlockMenuMusicFromGesture().finally(() => {
      if (this.unlockPromise === task) {
        this.unlockPromise = null;
      }
    });
    this.unlockPromise = task;
    return task;
  }

  private async runUnlockMenuMusicFromGesture(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (!this.menuMusicWanted || this.muted || this.menuMusicError) {
      return false;
    }
    const pageHidden = typeof document !== 'undefined' && document.hidden;
    if (pageHidden) {
      this.wasPlayingBeforeHide = true;
      return false;
    }

    const ctx = this.ensureAudioContextRaw();
    if (!ctx) return false;

    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
    } catch {
      this.gestureUnlocked = false;
      this.menuMusicStatus = 'blocked';
      this.lastBlockedAttemptMs = performance.now();
      this.armGestureListeners();
      this.notifyMenuMusic();
      return false;
    }

    if ((ctx.state as string) !== 'running') {
      this.gestureUnlocked = false;
      this.menuMusicStatus = 'blocked';
      this.lastBlockedAttemptMs = performance.now();
      this.armGestureListeners();
      this.notifyMenuMusic();
      return false;
    }

    this.gestureUnlocked = true;
    this.teardownGestureListeners();

    if (this.menuMusicPlaying) {
      return true;
    }

    return this.startOrResumeDecodedLoop(ctx, 1.5);
  }

  private handleGestureUnlockEvent = (e: Event) => {
    if (!this.menuMusicWanted || this.muted || this.menuMusicError) return;
    if (
      e.type !== 'keydown' &&
      this.menuMusicStatus === 'blocked' &&
      performance.now() - this.lastBlockedAttemptMs < 60
    ) {
      return;
    }
    void this.unlockMenuMusicFromGesture();
  };

  private armGestureListeners() {
    if (typeof window === 'undefined' || this.gestureListenersAttached) return;
    window.addEventListener('pointerdown', this.handleGestureUnlockEvent, {
      capture: true,
      passive: true,
    });
    window.addEventListener('click', this.handleGestureUnlockEvent, {
      capture: true,
      passive: true,
    });
    window.addEventListener('touchend', this.handleGestureUnlockEvent, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', this.handleGestureUnlockEvent, {
      capture: true,
      passive: true,
    });
    this.gestureListenersAttached = true;
  }

  private teardownGestureListeners() {
    if (typeof window === 'undefined' || !this.gestureListenersAttached) return;
    window.removeEventListener('pointerdown', this.handleGestureUnlockEvent, {
      capture: true,
    });
    window.removeEventListener('click', this.handleGestureUnlockEvent, {
      capture: true,
    });
    window.removeEventListener('touchend', this.handleGestureUnlockEvent, {
      capture: true,
    });
    window.removeEventListener('keydown', this.handleGestureUnlockEvent, {
      capture: true,
    });
    this.gestureListenersAttached = false;
  }

  private handleVisibilityChange = () => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      if (this.menuMusicPlaying) {
        this.wasPlayingBeforeHide = this.menuMusicWanted;
        this.pauseActiveMusicSources(false);
        this.menuMusicStatus = 'paused';
        this.notifyMenuMusic();
        if (this.ctx && !this.ambientActive && this.ctx.state === 'running') {
          this.ctx.suspend().catch(() => {});
        }
      }
      return;
    }

    // Page became visible again
    if (this.wasPlayingBeforeHide && this.menuMusicWanted && !this.muted && !this.menuMusicError) {
      this.wasPlayingBeforeHide = false;
      const ctx = this.ensureAudioContextRaw();
      if (!ctx) return;
      ctx
        .resume()
        .then(() => {
          if (
            (ctx.state as string) === 'running' &&
            this.menuMusicWanted &&
            !this.muted &&
            !document.hidden &&
            !this.menuMusicPlaying
          ) {
            void this.startOrResumeDecodedLoop(ctx, 1.2);
          }
        })
        .catch(() => {
          this.gestureUnlocked = false;
          this.menuMusicStatus = 'blocked';
          this.armGestureListeners();
          this.notifyMenuMusic();
        });
    }
  };

  private async ensureDecodedMenuBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
    if (this.menuMusicBuffer) return this.menuMusicBuffer;
    if (this.decodePromise) return this.decodePromise;

    this.menuMusicStatus = 'loading';
    this.notifyMenuMusic();

    this.decodePromise = (async () => {
      try {
        const raw = await this.preloadMenuMusic();
        if (!raw) {
          this.decodePromise = null;
          return null;
        }
        const decoded = await ctx.decodeAudioData(raw.slice(0));
        this.menuMusicBuffer = decoded;
        return decoded;
      } catch {
        this.menuMusicError = 'Soundtrack failed to decode cleanly.';
        this.menuMusicStatus = 'error';
        this.decodePromise = null;
        this.teardownGestureListeners();
        this.notifyMenuMusic();
        return null;
      }
    })();

    return this.decodePromise;
  }

  private getLoopBounds(buffer: AudioBuffer) {
    const headTrim = buffer.duration > 1.0 ? Math.min(0.13, buffer.duration * 0.04) : 0;
    const tailTrim =
      buffer.duration > 10 ? 1.5 : Math.min(0.12, buffer.duration * 0.08);
    const playableEnd = Math.max(headTrim + 0.35, buffer.duration - tailTrim);
    const span = Math.max(0.35, playableEnd - headTrim);
    const crossfadeSec = span > 8 ? 2.2 : Math.min(0.65, span * 0.28);
    return { headTrim, playableEnd, span, crossfadeSec };
  }

  private async startOrResumeDecodedLoop(
    ctx: AudioContext,
    fadeInDurationSec: number
  ): Promise<boolean> {
    const buffer = await this.ensureDecodedMenuBuffer(ctx);
    if (!buffer) return false;
    if (!this.menuMusicWanted || this.muted || (typeof document !== 'undefined' && document.hidden)) {
      this.menuMusicStatus = this.menuMusicError ? 'error' : 'paused';
      this.notifyMenuMusic();
      return false;
    }
    if (this.menuMusicPlaying) return true;
    if (!this.musicFadeGain || !this.musicDeckGains) return false;

    this.fadeEpoch += 1;
    if (this.fadeOutStopTimerId !== null) {
      window.clearTimeout(this.fadeOutStopTimerId);
      this.fadeOutStopTimerId = null;
    }
    if (this.loopTimerId !== null) {
      window.clearTimeout(this.loopTimerId);
      this.loopTimerId = null;
    }

    this.loopEpoch += 1;
    const myLoopEpoch = this.loopEpoch;
    const now = ctx.currentTime;

    const { headTrim, playableEnd } = this.getLoopBounds(buffer);
    const startOffset =
      this.pausedOffsetSec >= headTrim && this.pausedOffsetSec < playableEnd - 0.8
        ? this.pausedOffsetSec
        : headTrim;

    this.musicDeckGains[0].gain.cancelScheduledValues(now);
    this.musicDeckGains[1].gain.cancelScheduledValues(now);
    this.musicDeckGains[0].gain.setValueAtTime(1, now);
    this.musicDeckGains[1].gain.setValueAtTime(0, now);

    this.musicFadeGain.gain.cancelScheduledValues(now);
    this.musicFadeGain.gain.setValueAtTime(0, now);
    this.musicFadeGain.gain.linearRampToValueAtTime(1.0, now + fadeInDurationSec);

    if (this.outputGain) {
      this.outputGain.gain.cancelScheduledValues(now);
      this.outputGain.gain.setValueAtTime(this.muted ? 0 : 1, now);
    }
    if (this.musicVolumeGain) {
      this.musicVolumeGain.gain.cancelScheduledValues(now);
      this.musicVolumeGain.gain.setValueAtTime(this.musicVolume, now);
    }

    this.menuMusicPlaying = true;
    this.menuMusicStatus = 'playing';
    this.scheduleDeckPass(ctx, buffer, 0, now, startOffset, myLoopEpoch);
    this.notifyMenuMusic();
    return true;
  }

  private scheduleDeckPass(
    ctx: AudioContext,
    buffer: AudioBuffer,
    deckIdx: 0 | 1,
    startWhen: number,
    offsetSec: number,
    epoch: number
  ) {
    if (epoch !== this.loopEpoch || !this.menuMusicPlaying || !this.musicDeckGains) return;

    const { headTrim, playableEnd, crossfadeSec } = this.getLoopBounds(buffer);
    const safeOffset =
      offsetSec >= playableEnd - 0.5 ? headTrim : Math.max(headTrim, offsetSec);
    const remaining = Math.max(0.25, playableEnd - safeOffset);
    const xfade = Math.min(crossfadeSec, remaining * 0.45);
    const handoffDelta = Math.max(0.05, remaining - xfade);
    const handoffWhen = startWhen + handoffDelta;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.musicDeckGains[deckIdx]);
    this.activeMusicSources.add(src);
    src.onended = () => {
      this.activeMusicSources.delete(src);
      try {
        src.disconnect();
      } catch {
        // Ignore already disconnected source nodes
      }
    };

    try {
      src.start(startWhen, safeOffset, remaining + 0.05);
    } catch {
      this.activeMusicSources.delete(src);
      return;
    }

    this.trackCtxStart = startWhen;
    this.trackOffsetStart = safeOffset;

    const scheduleLeadMs = Math.max(
      25,
      Math.round((handoffWhen - ctx.currentTime - 0.18) * 1000)
    );

    this.loopTimerId = window.setTimeout(() => {
      if (
        epoch !== this.loopEpoch ||
        !this.menuMusicPlaying ||
        !this.musicDeckGains ||
        !this.ctx
      ) {
        return;
      }

      const nextIdx: 0 | 1 = deckIdx === 0 ? 1 : 0;
      const now = this.ctx.currentTime;
      const actualHandoff = Math.max(now + 0.02, handoffWhen);
      const outGain = this.musicDeckGains[deckIdx].gain;
      const inGain = this.musicDeckGains[nextIdx].gain;

      try {
        outGain.cancelScheduledValues(actualHandoff);
        outGain.setValueCurveAtTime(COS_XFADE_CURVE, actualHandoff, xfade);
        inGain.cancelScheduledValues(actualHandoff);
        inGain.setValueAtTime(0, now);
        inGain.setValueCurveAtTime(SIN_XFADE_CURVE, actualHandoff, xfade);
      } catch {
        // Fallback linear ramp if overlapping curves occur
        outGain.setValueAtTime(1, actualHandoff);
        outGain.linearRampToValueAtTime(0, actualHandoff + xfade);
        inGain.setValueAtTime(0, actualHandoff);
        inGain.linearRampToValueAtTime(1, actualHandoff + xfade);
      }

      this.scheduleDeckPass(this.ctx, buffer, nextIdx, actualHandoff, headTrim, epoch);
    }, scheduleLeadMs);
  }

  private pauseActiveMusicSources(resetToStart = false) {
    this.loopEpoch += 1;
    if (this.loopTimerId !== null) {
      window.clearTimeout(this.loopTimerId);
      this.loopTimerId = null;
    }

    if (this.ctx && this.menuMusicBuffer) {
      const { headTrim, span } = this.getLoopBounds(this.menuMusicBuffer);
      if (resetToStart) {
        const elapsed = Math.max(0, this.ctx.currentTime - this.trackCtxStart);
        this.pausedOffsetSec =
          headTrim + ((this.trackOffsetStart - headTrim + elapsed) % span);
      } else {
        const elapsed = Math.max(0, this.ctx.currentTime - this.trackCtxStart);
        this.pausedOffsetSec =
          headTrim + ((this.trackOffsetStart - headTrim + elapsed) % span);
      }
    }

    if (this.ctx && this.musicDeckGains) {
      const now = this.ctx.currentTime;
      this.musicDeckGains[0].gain.cancelScheduledValues(now);
      this.musicDeckGains[1].gain.cancelScheduledValues(now);
      this.musicDeckGains[0].gain.setValueAtTime(0, now);
      this.musicDeckGains[1].gain.setValueAtTime(0, now);
    }
    if (this.ctx && this.musicFadeGain) {
      const now = this.ctx.currentTime;
      this.musicFadeGain.gain.cancelScheduledValues(now);
      this.musicFadeGain.gain.setValueAtTime(0, now);
    }

    for (const src of this.activeMusicSources) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        // Ignore already stopped sources
      }
      try {
        src.disconnect();
      } catch {
        // Ignore already disconnected sources
      }
    }
    this.activeMusicSources.clear();
    this.menuMusicPlaying = false;
  }

  public disposeMenuMusic() {
    this.teardownGestureListeners();
    if (typeof document !== 'undefined' && this.visibilityListenerAttached) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.visibilityListenerAttached = false;
    }
    this.fadeEpoch += 1;
    if (this.fadeOutStopTimerId !== null) {
      window.clearTimeout(this.fadeOutStopTimerId);
      this.fadeOutStopTimerId = null;
    }
    this.pauseActiveMusicSources(false);
    this.menuMusicWanted = false;
    this.wasPlayingBeforeHide = false;
    this.menuMusicStatus = this.menuMusicError ? 'error' : 'idle';
    this.notifyMenuMusic();
  }

  public playUiConfirm(soft = false) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = soft ? 392 : 440;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.25, now + 0.075);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(soft ? 0.06 : 0.09, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0006, now + 0.14);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public startAmbient() {
    // Coordinate smoothly if the menu soundtrack was still active or fading
    if (this.menuMusicWanted || this.menuMusicPlaying) {
      this.setMenuMusicWanted(false, 1.0);
    }

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    this.ambientActive = true;

    if (this.ambientStarted) {
      if (this.ambientGain) {
        this.ambientGain.gain.setTargetAtTime(0.14, ctx.currentTime, 0.18);
      }
      this.bassPulseTimer = 0.25;
      this.bassBeatIndex = 0;
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

      // Evolution-synced harmonic drone bus (root -> fifth -> upper mist shimmer)
      this.droneFilter = ctx.createBiquadFilter();
      this.droneFilter.type = 'lowpass';
      this.droneFilter.frequency.value = 160;
      this.droneFilter.Q.value = 0.9;
      this.droneFilter.connect(this.masterGain);

      this.droneGain = ctx.createGain();
      this.droneGain.gain.value = 0.0001;
      this.droneGain.connect(this.droneFilter);

      this.fifthGain = ctx.createGain();
      this.fifthGain.gain.value = 0.0001;
      this.fifthGain.connect(this.droneFilter);

      this.shimmerGain = ctx.createGain();
      this.shimmerGain.gain.value = 0.0001;
      this.shimmerGain.connect(this.droneFilter);

      this.droneOscRoot = ctx.createOscillator();
      this.droneOscRoot.type = 'sine';
      this.droneOscRoot.frequency.value = 55;
      this.droneOscRoot.connect(this.droneGain);
      this.droneOscRoot.start();

      this.droneOscFifth = ctx.createOscillator();
      this.droneOscFifth.type = 'triangle';
      this.droneOscFifth.frequency.value = 82.4;
      this.droneOscFifth.connect(this.fifthGain);
      this.droneOscFifth.start();

      this.shimmerOsc = ctx.createOscillator();
      this.shimmerOsc.type = 'sine';
      this.shimmerOsc.frequency.value = 165;
      this.shimmerOsc.connect(this.shimmerGain);
      this.shimmerOsc.start();
    } catch {
      // Ignore audio autoplay blocks cleanly
    }
  }

  public stopAmbient() {
    this.ambientActive = false;
    this.lastHazard = null;
    this.lastZoneId = null;
    this.lastTerrain = null;
    this.lastForm = null;
    this.bassPulseTimer = 0.25;
    this.bassBeatIndex = 0;
    if (this.ambientGain && this.ctx) {
      this.ambientGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
    if (this.rainGain && this.ctx) {
      this.rainGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
    if (this.ctx) {
      const now = this.ctx.currentTime;
      if (this.droneGain) this.droneGain.gain.setTargetAtTime(0, now, 0.2);
      if (this.fifthGain) this.fifthGain.gain.setTargetAtTime(0, now, 0.2);
      if (this.shimmerGain) this.shimmerGain.gain.setTargetAtTime(0, now, 0.2);
    }
  }

  /**
   * Modulates the ambient lake bed and triggers procedural water-rippling,
   * cavern droplet, whitewater rush, hazard bubbling, and evolution-synced
   * harmonic drone & organic bass pulse layers.
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
      if (this.droneGain) this.droneGain.gain.setTargetAtTime(0, now, 0.12);
      if (this.fifthGain) this.fifthGain.gain.setTargetAtTime(0, now, 0.12);
      if (this.shimmerGain) this.shimmerGain.gain.setTargetAtTime(0, now, 0.12);
      return;
    }

    const profile = getAmbientProfile(state.zoneId, state.terrain, state.hazard, state.speed);
    const weather = state.weather ?? 'clear';
    const wInt = Math.max(0, Math.min(1, state.weatherIntensity ?? 0));
    const form: EvolutionForm = state.form ?? 1;
    const level =
      state.level ?? (form === 4 ? 100 : form === 3 ? 80 : form === 2 ? 40 : 1);
    const deathCamActive = Boolean(state.deathCamActive);
    const evoProfile = getEvolutionAudioProfile(form, level);

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

    // Morph continuous evolution harmonic drone layers
    const slowMoGainFactor = deathCamActive ? 0.72 : 1;
    const slowMoCutoffFactor = deathCamActive ? 0.65 : 1;
    const fogDroneCutoffFactor = weather === 'basin_fog' ? 1 - 0.25 * wInt : 1;

    if (this.droneFilter) {
      this.droneFilter.frequency.setTargetAtTime(
        evoProfile.droneCutoffHz * slowMoCutoffFactor * fogDroneCutoffFactor,
        now,
        0.35
      );
    }
    if (this.droneOscRoot && this.droneGain) {
      this.droneOscRoot.frequency.setTargetAtTime(evoProfile.baseFreqHz, now, 0.4);
      this.droneGain.gain.setTargetAtTime(evoProfile.droneGain * slowMoGainFactor, now, 0.35);
    }
    if (this.droneOscFifth && this.fifthGain) {
      this.droneOscFifth.frequency.setTargetAtTime(evoProfile.baseFreqHz * 1.498, now, 0.4);
      this.fifthGain.gain.setTargetAtTime(evoProfile.fifthGain * slowMoGainFactor, now, 0.4);
    }
    if (this.shimmerOsc && this.shimmerGain) {
      const shimmerRatio = form >= 4 ? 3.0 : 2.996;
      this.shimmerOsc.frequency.setTargetAtTime(evoProfile.baseFreqHz * shimmerRatio, now, 0.45);
      this.shimmerGain.gain.setTargetAtTime(evoProfile.shimmerGain * slowMoGainFactor, now, 0.45);
    }

    if (form !== this.lastForm) {
      if (this.lastForm !== null && form > this.lastForm) {
        // Pull the next rhythmic pulse closer so the evolved cadence locks in right after evolution
        this.bassPulseTimer = Math.min(this.bassPulseTimer, 0.24);
      }
      this.lastForm = form;
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

    this.bassPulseTimer -= dt;
    if (this.bassPulseTimer <= 0) {
      const beatIdx = this.bassBeatIndex;
      const swingFactor =
        form === 2 || form === 3 ? (beatIdx % 2 === 1 ? 0.92 : 1.08) : 1.0;
      const interval = evoProfile.pulseIntervalSec * (deathCamActive ? 1.65 : 1.0) * swingFactor;
      this.bassPulseTimer = Math.max(0.22, interval);
      this.bassBeatIndex = (beatIdx + 1) % 16;
      this.triggerOrganicBassPulse(evoProfile, beatIdx, deathCamActive);
    }
  }

  private triggerOrganicBassPulse(
    profile: EvolutionAudioProfile,
    beatIdx: number,
    deathCamActive: boolean
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const isDownbeat = beatIdx % profile.accentEvery === 0;
    const isSubAccent = profile.layerCount >= 2 && beatIdx % 2 === 1;
    const slowScale = deathCamActive ? 0.68 : 1;

    // Gentle Nusantara-inspired root / fourth / fifth anchor cycling in higher evolutions
    let pitchRatio = 1.0;
    if (profile.form >= 3) {
      const step = beatIdx % 8;
      if (step === 6) pitchRatio = 1.122; // whole step / second
      else if (step === 7) pitchRatio = 1.189; // minor third / warm return
      else if (step === 4) pitchRatio = 0.891; // subtle lower fifth-like dip
    } else if (profile.form === 2 && beatIdx % 4 === 3) {
      pitchRatio = 1.122;
    }

    const bodyFreq = profile.baseFreqHz * pitchRatio;
    const subFreq = profile.subFreqHz * pitchRatio;
    const pulseDur = Math.min(0.62, Math.max(0.28, profile.pulseIntervalSec * 0.66));

    // Layer 1: Organic membrane sub-thump (warm pitch settle)
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(subFreq * 1.32, now);
    subOsc.frequency.exponentialRampToValueAtTime(Math.max(22, subFreq), now + 0.11);

    const subAmp = (profile.subGain + profile.pulseGain * 0.45) * (isDownbeat ? 1.15 : 0.86) * slowScale;
    subGain.gain.setValueAtTime(0.0008, now);
    subGain.gain.linearRampToValueAtTime(subAmp, now + 0.032);
    subGain.gain.exponentialRampToValueAtTime(0.0005, now + pulseDur);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + pulseDur + 0.03);

    // Layer 2: Filtered organic triangle bass body
    const bodyOsc = ctx.createOscillator();
    const bodyFilter = ctx.createBiquadFilter();
    const bodyGain = ctx.createGain();

    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(bodyFreq * 1.03, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(bodyFreq, now + 0.09);

    bodyFilter.type = 'lowpass';
    bodyFilter.Q.value = profile.form >= 3 ? 2.1 : 1.3;
    const peakCutoff =
      profile.bassCutoffHz * (isDownbeat ? 1.25 : 0.95) * (deathCamActive ? 0.68 : 1);
    bodyFilter.frequency.setValueAtTime(Math.max(90, bodyFreq * 1.4), now);
    bodyFilter.frequency.exponentialRampToValueAtTime(Math.max(110, peakCutoff), now + 0.045);
    bodyFilter.frequency.exponentialRampToValueAtTime(Math.max(85, bodyFreq * 1.55), now + pulseDur * 0.92);

    const bodyAmp =
      (profile.pulseGain * 0.62 + profile.harmonicGain * 0.55) *
      (isDownbeat ? 1.12 : 0.85) *
      slowScale;
    bodyGain.gain.setValueAtTime(0.0008, now);
    bodyGain.gain.linearRampToValueAtTime(bodyAmp, now + 0.04);
    bodyGain.gain.exponentialRampToValueAtTime(0.0005, now + pulseDur);

    bodyOsc.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(this.masterGain);
    bodyOsc.start(now);
    bodyOsc.stop(now + pulseDur + 0.03);

    // Layer 3+: Form 2+ organic water-drum / caklempong accent tap
    if (profile.percussiveWeight > 0 && (isDownbeat || (profile.layerCount >= 3 && isSubAccent))) {
      const tapOsc = ctx.createOscillator();
      const tapGain = ctx.createGain();
      const tapFreq = bodyFreq * (isDownbeat ? 4.0 : 3.0);
      const tapAmp =
        0.042 * profile.percussiveWeight * (isDownbeat ? 1.0 : 0.62) * slowScale;

      tapOsc.type = profile.form >= 4 ? 'triangle' : 'sine';
      tapOsc.frequency.setValueAtTime(tapFreq * 1.04, now);
      tapOsc.frequency.exponentialRampToValueAtTime(tapFreq, now + 0.04);

      tapGain.gain.setValueAtTime(0.0006, now);
      tapGain.gain.linearRampToValueAtTime(tapAmp, now + 0.012);
      tapGain.gain.exponentialRampToValueAtTime(0.0004, now + 0.16);

      tapOsc.connect(tapGain);
      tapGain.connect(this.masterGain);
      tapOsc.start(now);
      tapOsc.stop(now + 0.18);
    }

    // Layer 4: Majestic Keli King fifth swell on downbeats
    if (profile.form >= 4 && isDownbeat) {
      const fifthOsc = ctx.createOscillator();
      const fifthPulseGain = ctx.createGain();
      fifthOsc.type = 'sine';
      fifthOsc.frequency.setValueAtTime(bodyFreq * 1.498, now);

      fifthPulseGain.gain.setValueAtTime(0.0006, now);
      fifthPulseGain.gain.linearRampToValueAtTime(0.034 * slowScale, now + 0.06);
      fifthPulseGain.gain.exponentialRampToValueAtTime(0.0004, now + pulseDur * 0.95);

      fifthOsc.connect(fifthPulseGain);
      fifthPulseGain.connect(this.masterGain);
      fifthOsc.start(now);
      fifthOsc.stop(now + pulseDur + 0.02);
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

  public playDamageHit(heavy = false) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // Low chest thump
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(heavy ? 128 : 155, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.14);
    thumpGain.gain.setValueAtTime(heavy ? 0.28 : 0.2, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    thump.connect(thumpGain);
    thumpGain.connect(this.masterGain);
    thump.start(now);
    thump.stop(now + 0.17);

    // Filtered water/scale impact crunch
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(heavy ? 480 : 640, now);
    filter.frequency.exponentialRampToValueAtTime(190, now + 0.12);
    filter.Q.value = 1.4;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(heavy ? 0.16 : 0.11, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now, Math.random() * 0.5);
    noise.stop(now + 0.14);
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

  public playEmoteCue(isTaunt: boolean) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const notes = isTaunt ? [392, 311.13] : [587.33, 880];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isTaunt ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.065);
      if (isTaunt) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 950;
        osc.connect(filter);
        filter.connect(gain);
      } else {
        osc.connect(gain);
      }
      gain.gain.setValueAtTime(0.001, now + idx * 0.065);
      gain.gain.linearRampToValueAtTime(isTaunt ? 0.11 : 0.12, now + idx * 0.065 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.065 + 0.22);
      gain.connect(this.masterGain!);
      osc.start(now + idx * 0.065);
      osc.stop(now + idx * 0.065 + 0.24);
    });
  }

  public playBountyCue(claimed: boolean) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const notes = claimed ? [523.25, 659.25, 783.99, 1046.5] : [329.63, 293.66, 440];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = claimed ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      if (!claimed) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 880;
        osc.connect(filter);
        filter.connect(gain);
      } else {
        osc.connect(gain);
      }
      gain.gain.setValueAtTime(0.001, now + idx * 0.07);
      gain.gain.linearRampToValueAtTime(claimed ? 0.14 : 0.095, now + idx * 0.07 + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.34);
      gain.connect(this.masterGain!);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.36);
    });
  }
}

export const soundEngine = new SoundEngine();

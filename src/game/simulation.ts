import {
  EVOLUTION_MILESTONES,
  getEvolutionForm,
} from '../data/abilities.ts';
import { type EmoteId, getEmoteSpec, VALID_EMOTE_IDS } from '../data/emotes.ts';
import {
  ARENA_SCALE,
  ECHO_SONAR_RADIUS,
  findNearestAccessiblePosition,
  findPickupSpawn,
  findWaterSpawn,
  getCurrentVectorAt,
  getHazardAt,
  getHazardModifierForForm,
  getTerrainAt,
  getZoneAt,
  hasClearObstacleLineOfSight,
  isPositionAccessible,
  LANDMARKS,
  resolveArenaCollision,
  resolveSweptMovement,
  scaleArenaCoord,
  scaleArenaDist,
  WORLD_CENTER,
  WORLD_SIZE,
} from './arena.ts';
import { soundEngine } from './audio.ts';
import {
  applyLocomotionVelocity,
  clampPostBurstVelocity,
  computeTurnRate,
  getLocomotionProfile,
  projectVelocityAlongCollisionNormal,
} from './movement.ts';
import type {
  ClientSfxEvent,
  RemoteKeliState,
  WorldStatePacket,
} from './multiplayerTypes.ts';
import {
  AiController,
  createSeededRng,
  type AiSimulationContext,
} from './enemyAI.ts';
import {
  generateFairWaterSpawns,
  MatchPacingDirector,
} from './matchPacing.ts';
import {
  computeInitialMilestoneMask,
  EVOLUTION_FORM_SPECS,
  type EvolutionEventKind,
  getEvolutionProgressInfo,
  resolveEvolutionTransition,
} from './evolutionExperience.ts';
import type {
  AbilityId,
  ActivityHotspot,
  AiDebugEntry,
  AiDifficulty,
  BountyTarget,
  CarcassEntity,
  DamageHitEvent,
  DamageImpulse,
  DeathCamState,
  EvolutionForm,
  FinalFeastState,
  FloatingCallout,
  HitReactKind,
  HitStopEvent,
  HudSnapshot,
  KeliEntity,
  LobbySize,
  MassLedgerEntry,
  MatchMode,
  MatchPacingMetrics,
  MatchPhase,
  PickupItem,
  PickupKind,
  SonarContact,
  SoundCue,
  TutorialStepState,
  WeatherKind,
  WeatherState,
  WorldEffect,
  ZoneState,
} from './types.ts';

export const TOTAL_MATCH_FRAGMENTS = 100;
export const BOUNTY_SURGE_DURATION_SEC = 8.0;

// Authoritative directional combat & counterplay tuning constants
export const BITE_CONE_HALF_ANGLE = 0.88; // ~50.4 deg each side (~100.8 deg forward cone)
export const BITE_CLOSE_FRONT_HALF_ANGLE = 1.25; // strictly < PI/2; never hits enemies behind
export const BITE_AIM_ASSIST_MAX_ANGLE = 0.62; // ~35.5 deg limited forward aim assist
export const BITE_WINDUP_SEC = 0.15;
export const BITE_STRIKE_SEC = 0.1;
export const BITE_RECOVERY_SEC = 0.22;
export const BITE_COOLDOWN_SEC = 0.16;
export const BITE_BUFFER_WINDOW_SEC = 0.15;
export const BITE_STAMINA_COST = 10;

export const EVADE_STAMINA_COST = 24;
export const EVADE_COOLDOWN_SEC = 2.2;
export const EVADE_DURATION_SEC = 0.22;
export const EVADE_DAMAGE_MITIGATION = 0.6; // 60% damage reduction during active evade window

export const DASH_STAMINA_COST = 18;
export const VEIL_STAMINA_COST = 12;
export const ELECTROSHOCK_STAMINA_COST = 14;
export const MAELSTROM_STAMINA_COST = 16;
export const STAMINA_REGEN_DELAY_SEC = 0.55;

export const STUN_RESIST_DURATION_SEC = 3.8;
export const STUN_STACK_DECAY_SEC = 6.0;

// Authoritative contested feeding & carcass pacing constants (Gameplay Improvement 03)
export const FEED_RANGE_BASE = 62;
export const FEED_CANCEL_RANGE_BUFFER = 14;
export const FEED_WINDUP_SEC = 0.45; // Initial lock-in windup before first fragment transfers
export const FEED_TICK_SEC_SMALL = 0.2; // Per-fragment transfer pace for 1–9 fragment carcasses
export const FEED_TICK_SEC_MEDIUM = 0.16; // Per-fragment transfer pace for 10–29 fragment carcasses
export const FEED_TICK_SEC_LARGE = 0.12; // Per-fragment transfer pace for 30+ fragment carcasses
export const FEED_INTERRUPT_RECOVERY_SEC = 0.25; // Brief readable recovery after combat interruption
export const FEED_MOVE_SPEED_MULT = 0.2; // 20% movement speed while committed to feeding
export const FEED_INTERRUPT_DAMAGE_THRESHOLD = 8; // Qualifying direct damage threshold to interrupt feeding
export const FEED_SOUND_ALERT_RANGE = 460; // Short-range ambush awareness cue for nearby rivals (not global)
export const LARGE_CARCASS_MINIMAP_RANGE = 1100; // Tactical minimap visibility range for large (30+) carcasses
export const MEDIUM_CARCASS_THRESHOLD = 10;
export const LARGE_CARCASS_THRESHOLD = 30;
export const FINAL_FEAST_FEED_WINDUP_SEC = 0.18;
export const FINAL_FEAST_FEED_TICK_SEC = 0.06;

function normalizeAngleDiff(target: number, source: number): number {
  let diff = target - source;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function rotateAngleTowards(current: number, target: number, maxStep: number): number {
  const diff = normalizeAngleDiff(target, current);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

export function isRainFedPickup(kind: PickupKind): boolean {
  return kind === 'monsoon_dew' || kind === 'storm_fin' || kind === 'thunder_roe';
}

const BOT_NAMES = [
  'Kelibat', 'Lumpur', 'Bisa', 'Palong', 'Selut', 'Jerung', 'Belut', 'Toman',
  'Haruan', 'Tapah', 'Baung', 'Patin', 'Sengat', 'Kapur', 'Gua', 'Arus',
  'Rakit', 'Rimau', 'Kilat', 'Senyap', 'Gelap', 'Terubuk', 'Lampam', 'Sembilang',
  'Kelah', 'Sebarau', 'Temoleh', 'Bujur', 'Duri', 'Keruh', 'Jernih', 'Pasir',
  'Batu', 'Akar', 'Daun', 'Lumut', 'Rumpai', 'Paya', 'Sungai', 'Lombong',
  'Besi', 'Timah', 'Karat', 'Wisel', 'Pelantar', 'Tebing', 'Lubuk', 'Pusar',
  'Ribut', 'Hujan', 'Kabut', 'Subuh', 'Senja', 'Malam', 'Embun', 'Bayang',
  'Gema', 'Denyut', 'Lapar', 'Ganas', 'Licin', 'Taji', 'Sari', 'Seri',
  'Jati', 'Cempaka', 'Melati', 'Kenanga', 'Tanjung', 'Teluk', 'Muara', 'Hulu',
  'Hilir', 'Selekoh', 'Jeram', 'Tasik', 'Kolam', 'Rawa', 'Beting', 'Pulau',
  'Kuala', 'Batu8', 'Perlis', 'Kelian', 'Nakawan', 'Setul', 'Chuping', 'Kaki',
  'Padang', 'Sena', 'Titi', 'Pintu', 'Sauk', 'Jala', 'Pukat', 'Bubu',
  'Tangkul', 'Kail', 'Umpan', 'Serampang',
];

export interface PlayerInputState {
  moveX: number; // -1..1
  moveZ: number; // -1..1
  aimAngle: number;
  biteHeld: boolean;
}

export interface HumanEntrant {
  id: string;
  name: string;
}

export interface SimulationOptions {
  humanEntrants?: HumanEntrant[];
  emitLocalSound?: boolean;
  isMultiplayerMatch?: boolean;
  aiDifficulty?: AiDifficulty;
  matchSeed?: number;
}

/**
 * Computes non-fragment leaderboard/bounty points for eliminating a high-threat rival.
 * Bounties NEVER generate evolution fragments.
 */
export function computeBountyReward(rivalsConsumed: number): number {
  if (rivalsConsumed < 2) return 0;
  if (rivalsConsumed === 2) return 500;
  if (rivalsConsumed === 3) return 800;
  return 1200;
}

interface PlayerMetaState {
  killedBy: string | null;
  deathCause: string | null;
  massTransferredTo: string | null;
  finalLevel: number;
  survivalTime: number;
  spectateTargetId: string | null;
  deathCam: DeathCamState | null;
  recentBanner: { title: string; subtitle: string; key: number } | null;
  bannerTimer: number;
  cameraShake: number;
  damageImpulse: DamageImpulse | null;
  hitStop: HitStopEvent | null;
  recentDamageHits: DamageHitEvent[];
  soundCues: SoundCue[];
  pendingSfx: ClientSfxEvent[];
}

export class GameSimulation {
  public kelis: KeliEntity[] = [];
  public carcasses: CarcassEntity[] = [];
  public pickups: PickupItem[] = [];
  public effects: WorldEffect[] = [];
  public callouts: FloatingCallout[] = [];
  public ledger: MassLedgerEntry[] = [];
  public soundCues: SoundCue[] = [];
  private recentEmotes: Array<{
    id: string;
    senderId: string;
    senderName: string;
    emoteId: EmoteId;
    x: number;
    z: number;
    time: number;
  }> = [];

  public mode: MatchMode;
  public lobbySize: LobbySize;
  private playerName: string;
  private humanEntrants: HumanEntrant[];
  private humanIds = new Set<string>();
  private primaryPlayerId: string;
  private emitLocalSound: boolean;
  private isMultiplayerMatch: boolean;

  public matchTime = 0;
  public zone: ZoneState;
  public weather: WeatherState;
  private weatherTargetKind: WeatherKind = 'clear';
  private lastNonClearWeather: WeatherKind = 'basin_fog';
  public tutorial: TutorialStepState | null = null;
  private pickupSpawnTimer = 3.2;

  public status: 'playing' | 'victory' | 'defeat' | 'draw' = 'playing';
  public winnerId: string | null = null;
  public winnerName: string | null = null;
  public finalFeastActive = false;
  public finalFeastTriggered = false;
  private matchConcluded = false;
  private victoryRecordCount = 0;
  public killedBy: string | null = null;
  public deathCause: string | null = null;
  public massTransferredTo: string | null = null;
  public playerFinalLevel = 1;
  public playerSurvivalTime = 0;
  public spectateTargetId: string | null = null;
  public deathCam: DeathCamState | null = null;

  public recentBanner: { title: string; subtitle: string; key: number } | null = null;
  private bannerTimer = 0;
  private bannerSeq = 1;
  private idSeq = 1;

  public cameraShake = 0;
  public damageImpulse: DamageImpulse | null = null;
  public hitStop: HitStopEvent | null = null;
  private recentDamageHits: DamageHitEvent[] = [];
  private inputsById = new Map<string, PlayerInputState>();
  private playerMetaById = new Map<string, PlayerMetaState>();
  private lastFeedAlertTimeByCarcass = new Map<string, number>();
  private prevPlayerX = 0;
  private prevPlayerZ = 0;
  private matchSeed: number;
  private explicitMatchSeed: boolean;
  private aiController: AiController;
  private botRegisterSeq = 0;
  private aiContext!: AiSimulationContext;
  private pacingDirector: MatchPacingDirector;
  private zonePaceMultiplier = 1.0;

  constructor(
    lobbySize: LobbySize,
    mode: MatchMode = 'royale',
    playerName = 'Awang (You)',
    options: SimulationOptions = {}
  ) {
    this.lobbySize = lobbySize;
    this.mode = mode;
    this.playerName = playerName.trim() || 'Awang (You)';
    this.emitLocalSound = options.emitLocalSound ?? true;
    this.isMultiplayerMatch =
      options.isMultiplayerMatch ?? (Boolean(options.humanEntrants && options.humanEntrants.length > 1));
    this.explicitMatchSeed = typeof options.matchSeed === 'number';
    this.matchSeed =
      typeof options.matchSeed === 'number'
        ? options.matchSeed >>> 0
        : (Math.floor(Math.random() * 0xffffffff) >>> 0);
    this.aiController = new AiController(this.matchSeed, options.aiDifficulty ?? 'normal');

    const entrants =
      options.humanEntrants && options.humanEntrants.length > 0
        ? options.humanEntrants.map((e) => ({
            id: e.id,
            name: e.name.trim() || 'Awang',
          }))
        : [{ id: 'player', name: this.playerName }];

    this.humanEntrants = entrants;
    this.primaryPlayerId = entrants[0].id;
    for (const ent of entrants) {
      this.humanIds.add(ent.id);
      this.inputsById.set(ent.id, {
        moveX: 0,
        moveZ: 0,
        aimAngle: 0,
        biteHeld: false,
      });
      this.playerMetaById.set(ent.id, {
        killedBy: null,
        deathCause: null,
        massTransferredTo: null,
        finalLevel: 1,
        survivalTime: 0,
        spectateTargetId: null,
        deathCam: null,
        recentBanner: null,
        bannerTimer: 0,
        cameraShake: 0,
        damageImpulse: null,
        hitStop: null,
        recentDamageHits: [],
        soundCues: [],
        pendingSfx: [],
      });
    }

    this.pacingDirector = new MatchPacingDirector(
      lobbySize,
      Math.max(lobbySize, entrants.length),
      this.matchSeed
    );
    const pacingProfile = this.pacingDirector.profile;
    const initialZoneRadius =
      mode === 'tutorial' ? scaleArenaDist(960) : pacingProfile.initialZoneRadius;

    this.zone = {
      centerX: scaleArenaCoord(1030),
      centerZ: scaleArenaCoord(1210), // converges smoothly toward Jantung Tasik
      currentRadius: initialZoneRadius,
      targetRadius: initialZoneRadius,
      phase: 1,
      warningTimer: mode === 'tutorial' ? 26 : pacingProfile.initialWarningSec,
      isShrinking: false,
      warningActive: false,
    };

    this.weather = {
      kind: 'clear',
      label: 'Clear Twilight',
      intensity: 0,
      remainingSec: mode === 'tutorial' ? 24 : 18 + Math.random() * 8,
      visibilityRange: 1.0,
    };

    this.aiContext = {
      matchTime: 0,
      finalFeastActive: false,
      zone: this.zone,
      weather: this.weather,
      kelis: this.kelis,
      carcasses: this.carcasses,
      pickups: this.pickups,
      directorHotspots: [],
      matchPhase: 'early',
      getMoveSpeed: (k) => this.getMoveSpeed(k),
      computeRadius: (lvl) => this.computeRadius(lvl),
      getFeedRange: (lvl) => this.getFeedRange(lvl),
      canFeedOnCarcass: (k, c, hyst) => this.canFeedOnCarcass(k, c, hyst),
      cancelFeeding: (k, reason) => this.cancelFeeding(k, reason),
      tryBiteOrFeed: (k, audio) => this.tryBiteOrFeed(k, audio),
      tryEvade: (k) => this.tryEvade(k),
      tryDash: (k) => this.tryDash(k),
      trySonar: (k) => this.trySonar(k),
      tryVeil: (k) => this.tryVeil(k),
      tryElectroshock: (k) => this.tryElectroshock(k),
      tryMaelstrom: (k) => this.tryMaelstrom(k),
    };

    this.initMatch();
  }

  private nextId(prefix: string): string {
    return `${prefix}-${this.idSeq++}`;
  }

  private computeMaxHp(level: number): number {
    return Math.round(90 + level * 6.5);
  }

  private computeRadius(level: number): number {
    return 14 + Math.min(24, level * 0.24);
  }

  private createKeli(
    id: string,
    name: string,
    isPlayer: boolean,
    x: number,
    z: number,
    level: number,
    spawnRng: () => number = Math.random,
    facingAngleOverride?: number
  ): KeliEntity {
    const intLevel = Math.max(0, Math.min(TOTAL_MATCH_FRAGMENTS, Math.trunc(level)));
    const maxHp = this.computeMaxHp(intLevel);
    return {
      id,
      name,
      isPlayer,
      x,
      z,
      vx: 0,
      vz: 0,
      facingAngle: facingAngleOverride ?? spawnRng() * Math.PI * 2,
      level: intLevel,
      hp: maxHp,
      maxHp,
      alive: true,

      isOnShore: false,
      isSubmerged: true,
      shoreReserve: 10,
      maxShoreReserve: 10,
      stamina: 100,
      maxStamina: 100,
      staminaRegenDelay: 0,
      fatigued: false,
      activeHazard: null,

      bitePhase: 'idle',
      bitePhaseTimer: 0,
      biteCooldown: 0,
      biteAimAngle: 0,
      biteHitApplied: false,
      biteBufferTimer: 0,
      biteAttackSeq: 0,
      biteHitTargetIds: [],
      biteDidHit: false,
      biteFatigued: false,

      evadeTimer: 0,
      evadeDirX: 0,
      evadeDirZ: 0,
      staggerTimer: 0,
      stunTimer: 0,
      stunResistTimer: 0,
      stunStacks: 0,
      stunStackDecayTimer: 0,
      recoilTimer: 0,
      recoilDirX: 0,
      recoilDirZ: 0,
      recoilStrength: 0,
      lastHitKind: null,

      venomTimer: 0,
      venomDps: 0,
      venomSourceId: null,
      frenzyTimer: 0,
      surgeTimer: 0,
      predatorTimer: 0,
      aegisTimer: 0,
      dewTimer: 0,
      stormFinTimer: 0,
      thunderRoeTimer: 0,
      evoBoostTimer: 0,
      highestFormReached: getEvolutionForm(Math.max(1, intLevel)),
      unlockedMilestoneMask: computeInitialMilestoneMask(Math.max(1, intLevel)),
      evolutionSeq: 0,
      lastEvolutionForm: getEvolutionForm(Math.max(1, intLevel)),
      lastEvolutionTime: -1,
      lastMinorLevelTime: -1,
      veilTimer: 0,
      dashTimer: 0,
      dashDirX: 0,
      dashDirZ: 0,
      hitFlashTimer: 0,

      sonarTimer: 0,
      sonarIsHunter: false,

      feedingTargetId: null,
      feedingProgress: 0,
      feedingDuration: 0,

      cooldowns: {
        evade: 0,
        dash: 0,
        sonar: 0,
        veil: 0,
        electroshock: 0,
        maelstrom: 0,
      },
      kills: 0,
      rivalsConsumed: 0,
      bountyReward: 0,
      bountyPoints: 0,
      bountyBoostTimer: 0,
      eliminatedAtLevel: undefined,
      damageDealt: 0,
      lastAttackerId: null,
      lastAttackerName: null,
      lastDamageCause: null,

      aiWanderAngle: spawnRng() * Math.PI * 2,
      aiGoalTimer: 0.5 + spawnRng() * 1.5,
      aiTargetId: null,
      aiAggression: 0.35 + spawnRng() * 0.55,
      aiRetreatingFromShore: false,
      activeEmote: null,
      emoteTimer: 0,
      emoteCooldown: 0,
    };
  }

  private initMatch() {
    if (this.mode === 'tutorial') {
      // Guided First Match: 100 fragments exact across player, safe carcass, contested carcass & AI rivals
      const player = this.createKeli(
        'player',
        this.playerName,
        true,
        LANDMARKS.tutorialStart.x,
        LANDMARKS.tutorialStart.z,
        5
      );
      this.kelis.push(player);
      this.prevPlayerX = player.x;
      this.prevPlayerZ = player.z;

      // Safe carcass (10 fragments -> lifts player to Lv.15)
      this.carcasses.push({
        id: this.nextId('carc'),
        x: LANDMARKS.tutorialSafeCarcass.x,
        z: LANDMARKS.tutorialSafeCarcass.z,
        mass: 10,
        initialMass: 10,
        evolutionPhaseAtDeath: 1,
        sourceName: 'Fallen Keli',
        createdAt: 0,
        bobPhase: 0,
        consumed: false,
        relocated: false,
      });

      // Contested carcass (15 fragments) guarded by a Lv.10 rival
      this.carcasses.push({
        id: this.nextId('carc'),
        x: LANDMARKS.tutorialContestedCarcass.x,
        z: LANDMARKS.tutorialContestedCarcass.z,
        mass: 15,
        initialMass: 15,
        evolutionPhaseAtDeath: 1,
        sourceName: 'Palong Straggler',
        createdAt: 0,
        bobPhase: 1.7,
        consumed: false,
        relocated: false,
      });

      const rival = this.createKeli(
        'bot-contested',
        'Jerung',
        false,
        LANDMARKS.tutorialContestedCarcass.x + 65,
        LANDMARKS.tutorialContestedCarcass.z - 40,
        10
      );
      this.kelis.push(rival);

      // Remaining 60 fragments distributed across 6 AI rivals (10 each) in far sectors
      for (let i = 0; i < 6; i++) {
        const sp = findWaterSpawn(i + 2, 8);
        this.kelis.push(
          this.createKeli(`bot-${i}`, BOT_NAMES[i], false, sp.x, sp.z, 10)
        );
      }

      this.tutorial = {
        step: 0,
        movedDistance: 0,
        bittenOnce: false,
        safeFed: false,
        contestedCleared: false,
        shoreVisited: false,
        shortcutUsed: false,
      };

      this.pushBanner(
        'First Match: Sungai Berselirat',
        'Use WASD to swim and Left Click / Space to bite.'
      );
    } else {
      const n = Math.max(
        1,
        Math.min(TOTAL_MATCH_FRAGMENTS, Math.max(this.lobbySize, this.humanEntrants.length))
      );
      const baseFrag = Math.floor(TOTAL_MATCH_FRAGMENTS / n);
      const remainder = TOTAL_MATCH_FRAGMENTS % n;

      // Shuffle indices for +1 remainder distribution (deterministic when matchSeed is set)
      const shuffleRng = this.explicitMatchSeed
        ? createSeededRng(this.matchSeed ^ 0x9e3779b9)
        : Math.random;
      const indices = Array.from({ length: n }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(shuffleRng() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      const bonusSet = new Set(indices.slice(0, remainder));

      // Stratified, distance-aware, seeded fair water spawn distribution
      const spawnRng = this.explicitMatchSeed
        ? createSeededRng(this.matchSeed ^ 0x517cc1b7)
        : Math.random;
      const fairSpawns = generateFairWaterSpawns(
        n,
        this.pacingDirector.profile,
        this.zone.centerX,
        this.zone.centerZ,
        spawnRng
      );

      // Place human players first, then fill remaining slots with AI bots
      for (let i = 0; i < n; i++) {
        const human = this.humanEntrants[i];
        const isHuman = Boolean(human);
        const startLvl = baseFrag + (bonusSet.has(i) ? 1 : 0);
        const sp = fairSpawns[i] ?? findWaterSpawn(i, n);
        const id = isHuman ? human.id : `bot-${i}`;
        const name = isHuman ? human.name : BOT_NAMES[(i - this.humanEntrants.length) % BOT_NAMES.length];
        const entity = this.createKeli(
          id,
          name,
          isHuman,
          sp.x,
          sp.z,
          startLvl,
          spawnRng,
          'facingAngle' in sp ? sp.facingAngle : undefined
        );
        this.kelis.push(entity);
        const meta = this.playerMetaById.get(id);
        if (meta) {
          meta.finalLevel = startLvl;
        }
        if (id === this.primaryPlayerId) {
          this.prevPlayerX = entity.x;
          this.prevPlayerZ = entity.z;
          this.playerFinalLevel = startLvl;
        }
      }

      const humanLabel =
        this.humanEntrants.length > 1
          ? `${this.humanEntrants.length} players · ${n} total Keli · 100 fragments in play`
          : `${n} Keli entered the basin · 100 fragments in play`;
      this.pushBanner('Battle for Wang Kelian', humanLabel);
    }

    // Deterministically register every AI bot with the utility AI controller
    for (const k of this.kelis) {
      if (!k.isPlayer) {
        this.aiController.registerBot(k, this.botRegisterSeq++);
      }
    }

    const initialPickups = this.mode === 'tutorial' ? 6 : 18;
    for (let i = 0; i < initialPickups; i++) {
      this.spawnRandomPickup(this.mode === 'tutorial');
    }
    this.pickupSpawnTimer = 3.2;

    this.recordLedger('spawn', 'Lubuk Hitam', `${this.kelis.length} Entrants`, 100);
    this.emitSfxGlobal('whistle');
    this.addSoundCue('Shift whistle echoes across Lubuk Hitam', null, 'info');
  }

  public getMatchSeed(): number {
    return this.matchSeed;
  }

  public getAiDifficulty(): AiDifficulty {
    return this.aiController.getDifficulty();
  }

  public setAiDifficulty(difficulty: AiDifficulty): void {
    this.aiController.setDifficulty(difficulty);
  }

  /**
   * Dev-only AI inspection snapshot. Never returns server AI state in multiplayer matches.
   */
  public getAiDebugSnapshot(): AiDebugEntry[] {
    if (this.isMultiplayerMatch) return [];
    return this.aiController.getDebugEntries(this.kelis);
  }

  public getPlayer(playerId = this.primaryPlayerId): KeliEntity {
    return this.kelis.find((k) => k.id === playerId) ?? this.kelis[0];
  }

  public setHumanConnected(playerId: string, connected: boolean) {
    const k = this.kelis.find((e) => e.id === playerId);
    if (!k) return;
    k.isPlayer = connected;
    if (!connected) {
      const inp = this.inputsById.get(playerId);
      if (inp) {
        inp.moveX = 0;
        inp.moveZ = 0;
        inp.biteHeld = false;
      }
    }
  }

  /**
   * Handles a human player disconnecting mid-match without ever losing fragments.
   * By default AI assumes control of the living Keli (keeping fragments in active play);
   * if eliminate=true, the Keli is cleanly converted into an accessible carcass.
   */
  public handlePlayerDisconnect(playerId: string, eliminate = false) {
    const k = this.kelis.find((e) => e.id === playerId);
    if (!k) return;
    this.setHumanConnected(playerId, false);
    if (eliminate && k.alive && this.status === 'playing' && !this.matchConcluded) {
      this.handleDeath(k, null, 'Disconnected', 'zone_death');
    }
  }

  public getTotalFragments(): number {
    const { living, carcass } = this.getMassSums();
    return living + carcass;
  }

  public getFragmentAudit(): {
    living: number;
    carcasses: number;
    total: number;
    valid: boolean;
    maxEntityFragments: number;
    hasFractional: boolean;
    deadHoldingFragments: number;
  } {
    let living = 0;
    let carcasses = 0;
    let maxEntityFragments = 0;
    let hasFractional = false;
    let deadHoldingFragments = 0;

    for (const k of this.kelis) {
      if (!Number.isInteger(k.level)) hasFractional = true;
      if (k.alive) {
        living += k.level;
        if (k.level > maxEntityFragments) maxEntityFragments = k.level;
      } else if (k.level !== 0) {
        deadHoldingFragments += k.level;
      }
    }

    for (const c of this.carcasses) {
      if (!Number.isInteger(c.mass)) hasFractional = true;
      if (!c.consumed && c.mass > 0) {
        carcasses += c.mass;
        if (c.mass > maxEntityFragments) maxEntityFragments = c.mass;
      }
    }

    const total = living + carcasses;
    const valid =
      total === TOTAL_MATCH_FRAGMENTS &&
      !hasFractional &&
      deadHoldingFragments === 0 &&
      maxEntityFragments <= TOTAL_MATCH_FRAGMENTS;

    return {
      living,
      carcasses,
      total,
      valid,
      maxEntityFragments,
      hasFractional,
      deadHoldingFragments,
    };
  }

  public getVictoryRecordCount(): number {
    return this.victoryRecordCount;
  }

  public getSpectateTarget(playerId = this.primaryPlayerId): KeliEntity | null {
    const alive = this.kelis.filter((k) => k.alive);
    if (alive.length === 0) return null;
    const meta = this.playerMetaById.get(playerId);
    const curId = meta ? meta.spectateTargetId : this.spectateTargetId;
    if (curId) {
      const found = alive.find((k) => k.id === curId);
      if (found) return found;
    }
    let best = alive[0];
    for (const k of alive) {
      if (k.level > best.level) best = k;
    }
    if (meta) meta.spectateTargetId = best.id;
    if (playerId === this.primaryPlayerId) this.spectateTargetId = best.id;
    return best;
  }

  public cycleSpectateTargetFor(playerId: string, dir: 1 | -1) {
    const alive = this.kelis
      .filter((k) => k.alive)
      .sort((a, b) => b.level - a.level || a.id.localeCompare(b.id));
    const meta = this.playerMetaById.get(playerId);
    if (alive.length === 0) {
      if (meta) meta.spectateTargetId = null;
      if (playerId === this.primaryPlayerId) this.spectateTargetId = null;
      return;
    }
    const curTarget = meta ? meta.spectateTargetId : this.spectateTargetId;
    const curIdx = alive.findIndex((k) => k.id === curTarget);
    const nextId =
      curIdx === -1 ? alive[0].id : alive[(curIdx + dir + alive.length) % alive.length].id;
    if (meta) meta.spectateTargetId = nextId;
    if (playerId === this.primaryPlayerId) this.spectateTargetId = nextId;
  }

  public cycleSpectateTarget(dir: 1 | -1) {
    this.cycleSpectateTargetFor(this.primaryPlayerId, dir);
  }

  public spectateLeaderFor(playerId: string) {
    const alive = this.kelis.filter((k) => k.alive);
    if (alive.length === 0) return;
    let best = alive[0];
    for (const k of alive) {
      if (k.level > best.level) best = k;
    }
    const meta = this.playerMetaById.get(playerId);
    if (meta) meta.spectateTargetId = best.id;
    if (playerId === this.primaryPlayerId) this.spectateTargetId = best.id;
  }

  public spectateLeader() {
    this.spectateLeaderFor(this.primaryPlayerId);
  }

  public getDeathCam(playerId = this.primaryPlayerId): DeathCamState | null {
    if (this.status !== 'playing') return null;
    const p = this.getPlayer(playerId);
    if (!p || p.alive) return null;
    const meta = this.playerMetaById.get(playerId);
    const dc = meta ? meta.deathCam : this.deathCam;
    if (!dc || !dc.active || dc.remaining <= 0) return null;
    return dc;
  }

  public skipDeathCamFor(playerId = this.primaryPlayerId) {
    const meta = this.playerMetaById.get(playerId);
    if (meta) {
      meta.deathCam = null;
    }
    if (playerId === this.primaryPlayerId) {
      this.deathCam = null;
    }
  }

  public skipDeathCam() {
    this.skipDeathCamFor(this.primaryPlayerId);
  }

  public setInputForPlayer(playerId: string, input: Partial<PlayerInputState>) {
    const existing = this.inputsById.get(playerId);
    if (existing) {
      Object.assign(existing, input);
    } else {
      this.inputsById.set(playerId, {
        moveX: input.moveX ?? 0,
        moveZ: input.moveZ ?? 0,
        aimAngle: input.aimAngle ?? 0,
        biteHeld: input.biteHeld ?? false,
      });
    }
  }

  public setInput(input: Partial<PlayerInputState>) {
    this.setInputForPlayer(this.primaryPlayerId, input);
  }

  public triggerAbilityForPlayer(playerId: string, ability: AbilityId) {
    const p = this.kelis.find((k) => k.id === playerId);
    if (!p || !p.alive || this.status !== 'playing' || this.matchConcluded) return;
    if (p.stunTimer > 0) return;

    if (ability === 'bite') {
      this.tryBiteOrFeed(p, true);
    } else if (ability === 'evade') {
      this.tryEvade(p);
    } else if (ability === 'dash') {
      this.tryDash(p);
    } else if (ability === 'sonar') {
      this.trySonar(p);
    } else if (ability === 'veil') {
      this.tryVeil(p);
    } else if (ability === 'electroshock') {
      this.tryElectroshock(p);
    } else if (ability === 'maelstrom') {
      this.tryMaelstrom(p);
    }
  }

  public triggerPlayerAbility(ability: AbilityId) {
    this.triggerAbilityForPlayer(this.primaryPlayerId, ability);
  }

  public triggerEmoteForPlayer(playerId: string, emoteId: EmoteId): boolean {
    if (this.status !== 'playing' || !VALID_EMOTE_IDS.has(emoteId)) return false;
    const k = this.kelis.find((e) => e.id === playerId);
    if (!k || !k.alive || (k.emoteCooldown ?? 0) > 0) return false;
    const spec = getEmoteSpec(emoteId);
    if (!spec) return false;

    k.activeEmote = emoteId;
    k.emoteTimer = 2.8;
    k.emoteCooldown = 1.1;

    this.effects.push({
      id: this.nextId('fx'),
      type: 'sonar_ring',
      x: k.x,
      z: k.z,
      angle: 0,
      radius: 92,
      duration: 0.55,
      elapsed: 0,
      ownerId: k.id,
      color: spec.ringColor,
    });

    this.recentEmotes.unshift({
      id: this.nextId('emo'),
      senderId: k.id,
      senderName: k.name,
      emoteId,
      x: k.x,
      z: k.z,
      time: this.matchTime,
    });
    if (this.recentEmotes.length > 6) this.recentEmotes.length = 6;

    this.addSoundCue(
      `${k.name} ${spec.calloutText}`,
      { x: k.x, z: k.z },
      spec.category === 'taunt' ? 'warning' : 'info'
    );

    const sfxKind = spec.category === 'taunt' ? 'emote_taunt' : 'emote_signal';
    for (const [pid] of this.playerMetaById.entries()) {
      const listener = this.getPlayer(pid);
      if (pid === k.id || (listener && Math.hypot(listener.x - k.x, listener.z - k.z) <= 950)) {
        this.emitSfxFor(pid, sfxKind);
      }
    }
    return true;
  }

  public triggerPlayerEmote(emoteId: EmoteId): boolean {
    return this.triggerEmoteForPlayer(this.primaryPlayerId, emoteId);
  }

  /**
   * Optional tutorial shortcut to the Lv.40 land lesson (maintains exact 100-fragment invariant!)
   */
  public skipToLandLesson() {
    if (this.mode !== 'tutorial' || !this.tutorial || this.status !== 'playing' || this.matchConcluded) return;
    const p = this.getPlayer();
    if (!p.alive || p.level >= 40) return;

    const needed = Math.trunc(40 - p.level);
    let gathered = 0;

    // Harvest from far bots first, preserving exact 100 total
    for (let i = this.kelis.length - 1; i >= 1 && gathered < needed; i--) {
      const bot = this.kelis[i];
      if (!bot.alive || bot.level <= 1) continue;
      const take = Math.trunc(Math.min(bot.level - 1, needed - gathered));
      if (take > 0) {
        bot.level -= take;
        bot.maxHp = this.computeMaxHp(bot.level);
        bot.hp = Math.min(bot.hp, bot.maxHp);
        gathered += take;
      }
    }

    if (gathered > 0) {
      this.grantFragments(p, gathered, 'Land Lesson Shortcut');
    }

    // Reposition player near Tebing Kering shoreline ramp so they can step ashore immediately
    p.x = LANDMARKS.tebingKeringLanding.x;
    p.z = LANDMARKS.tebingKeringLanding.z;
    p.hp = p.maxHp;
    this.tutorial.step = 3;
    this.tutorial.shortcutUsed = true;
    this.pushBanner(
      'First Reformation (Lv.40)',
      'Haul onto Tebing Kering shore! You have 10s reserve before exposure.'
    );
  }

  private emitSfxFor(playerId: string, kind: ClientSfxEvent['kind']) {
    const meta = this.playerMetaById.get(playerId);
    if (meta) {
      meta.pendingSfx.push({ kind });
    }
    if (this.emitLocalSound && playerId === this.primaryPlayerId) {
      this.playLocalSfx(kind);
    }
  }

  private emitSfxGlobal(kind: ClientSfxEvent['kind']) {
    for (const [pid, meta] of this.playerMetaById.entries()) {
      meta.pendingSfx.push({ kind });
      if (this.emitLocalSound && pid === this.primaryPlayerId) {
        this.playLocalSfx(kind);
      }
    }
  }

  private triggerHitStopFor(playerId: string, duration: number) {
    const clamped = Math.min(0.06, Math.max(0.025, duration));
    const meta = this.playerMetaById.get(playerId);
    if (meta) {
      meta.hitStop = {
        duration: clamped,
        seq: (meta.hitStop?.seq ?? 0) + 1,
      };
    }
    if (playerId === this.primaryPlayerId) {
      this.hitStop = {
        duration: clamped,
        seq: (this.hitStop?.seq ?? 0) + 1,
      };
    }
  }

  private playLocalSfx(kind: ClientSfxEvent['kind']) {
    switch (kind) {
      case 'bite':
        soundEngine.playBite(false);
        break;
      case 'bite_heavy':
        soundEngine.playBite(true);
        break;
      case 'bite_miss':
        soundEngine.playBiteMiss();
        break;
      case 'hit_confirm':
        soundEngine.playHitConfirm(false);
        break;
      case 'hit_crit':
        soundEngine.playHitConfirm(true);
        break;
      case 'hit_stun':
        soundEngine.playStunImpact();
        break;
      case 'hit_blocked':
        soundEngine.playBlockedHit();
        break;
      case 'evade':
        soundEngine.playEvade();
        break;
      case 'death':
        soundEngine.playDeath();
        break;
      case 'feed':
        soundEngine.playFeedComplete();
        break;
      case 'feed_start':
        soundEngine.playFeedStart();
        break;
      case 'feed_tick':
        soundEngine.playFeedTick();
        break;
      case 'feed_interrupt':
        soundEngine.playFeedInterrupt();
        break;
      case 'feed_nearby':
        soundEngine.playNearbyFeedAlert();
        break;
      case 'evolution':
        soundEngine.playEvolution();
        break;
      case 'level_up_minor':
        soundEngine.playMinorLevelUp(this.getPlayer().level);
        break;
      case 'ability_unlock':
        soundEngine.playAbilityUnlock();
        break;
      case 'evolution_form_2':
        soundEngine.playForm2Transformation();
        break;
      case 'evolution_form_3':
        soundEngine.playForm3Transformation();
        break;
      case 'evolution_king':
        soundEngine.playKeliKingAscension();
        break;
      case 'dash':
        soundEngine.playDash();
        break;
      case 'sonar':
        soundEngine.playSonar(false);
        break;
      case 'hunter_sonar':
        soundEngine.playSonar(true);
        break;
      case 'veil':
        soundEngine.playVeil();
        break;
      case 'electroshock':
        soundEngine.playElectroshock();
        break;
      case 'maelstrom':
        soundEngine.playMaelstrom();
        break;
      case 'pickup_heal':
        soundEngine.playPickup(true);
        break;
      case 'pickup_buff':
        soundEngine.playPickup(false);
        break;
      case 'pickup_rainfed':
        soundEngine.playRainFedPickup();
        break;
      case 'weather_rain':
        soundEngine.playWeatherCue('light_rain');
        break;
      case 'weather_fog':
        soundEngine.playWeatherCue('basin_fog');
        break;
      case 'emote_signal':
        soundEngine.playEmoteCue(false);
        break;
      case 'emote_taunt':
        soundEngine.playEmoteCue(true);
        break;
      case 'damage_hit':
        soundEngine.playDamageHit(false);
        break;
      case 'damage_hit_heavy':
        soundEngine.playDamageHit(true);
        break;
      case 'bounty_marked':
        soundEngine.playBountyCue(false);
        break;
      case 'bounty_claimed':
        soundEngine.playBountyCue(true);
        break;
      case 'whistle':
        soundEngine.playShiftWhistle();
        break;
    }
  }

  private pushBannerFor(playerId: string, title: string, subtitle: string) {
    const banner = { title, subtitle, key: this.bannerSeq++ };
    const meta = this.playerMetaById.get(playerId);
    if (meta) {
      meta.recentBanner = banner;
      meta.bannerTimer = 4.5;
    }
    if (playerId === this.primaryPlayerId) {
      this.recentBanner = banner;
      this.bannerTimer = 4.5;
    }
  }

  private pushBanner(title: string, subtitle: string) {
    const banner = { title, subtitle, key: this.bannerSeq++ };
    this.recentBanner = banner;
    this.bannerTimer = 4.5;
    for (const meta of this.playerMetaById.values()) {
      meta.recentBanner = { ...banner };
      meta.bannerTimer = 4.5;
    }
  }

  private addSoundCue(label: string, sourcePos: { x: number; z: number } | null, severity: 'info' | 'warning' | 'danger') {
    for (const [pid, meta] of this.playerMetaById.entries()) {
      const p = this.getPlayer(pid);
      const focus = p && p.alive ? p : this.getSpectateTarget(pid) ?? p;
      let dirAngle: number | null = null;
      if (sourcePos && focus) {
        const dist = Math.hypot(sourcePos.x - focus.x, sourcePos.z - focus.z);
        if (dist > 60) {
          dirAngle = Math.atan2(sourcePos.z - focus.z, sourcePos.x - focus.x);
        }
      }
      const cue: SoundCue = {
        id: this.nextId('cue'),
        label,
        directionAngle: dirAngle,
        severity,
        timestamp: this.matchTime,
      };
      meta.soundCues.unshift(cue);
      if (meta.soundCues.length > 5) meta.soundCues.length = 5;
      if (pid === this.primaryPlayerId) {
        this.soundCues = [...meta.soundCues];
      }
    }
  }

  private getMassSums(): { living: number; carcass: number } {
    let living = 0;
    for (const k of this.kelis) {
      if (k.alive) living += Math.trunc(k.level);
    }
    let carcass = 0;
    for (const c of this.carcasses) {
      if (!c.consumed && c.mass > 0) carcass += Math.trunc(c.mass);
    }
    return { living, carcass };
  }

  private recordLedger(
    type: MassLedgerEntry['type'],
    actorName: string,
    targetName: string,
    fragments: number
  ) {
    const { living, carcass } = this.getMassSums();
    this.ledger.push({
      id: this.nextId('led'),
      time: this.matchTime,
      type,
      actorName,
      targetName,
      fragments: Math.trunc(fragments),
      totalLivingMass: living,
      totalCarcassMass: carcass,
    });
  }

  public step(rawDt: number, realDt = rawDt) {
    if (this.status !== 'playing' || this.matchConcluded) return;
    const dt = Math.min(0.05, Math.max(0.0005, rawDt));
    const wallDt = Math.min(0.05, Math.max(0.0005, realDt));
    this.matchTime += dt;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.recentBanner = null;
    }
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.5);
    }
    if (this.deathCam && this.deathCam.active) {
      this.deathCam.remaining = Math.max(0, this.deathCam.remaining - wallDt);
      if (this.deathCam.remaining <= 0.0005) {
        this.deathCam = null;
      }
    }
    for (const meta of this.playerMetaById.values()) {
      if (meta.bannerTimer > 0) {
        meta.bannerTimer -= dt;
        if (meta.bannerTimer <= 0) meta.recentBanner = null;
      }
      if (meta.cameraShake > 0) {
        meta.cameraShake = Math.max(0, meta.cameraShake - dt * 2.5);
      }
      if (meta.deathCam && meta.deathCam.active) {
        meta.deathCam.remaining = Math.max(0, meta.deathCam.remaining - wallDt);
        if (meta.deathCam.remaining <= 0.0005) {
          meta.deathCam = null;
        }
      }
    }

    // 1. Update radioactive zone contraction & dynamic basin weather
    this.updateZone(dt);
    this.updateWeather(dt);

    // 1a. Lightweight 1 Hz Match Pacing Director (royale mode only)
    if (this.mode !== 'tutorial') {
      const dirRes = this.pacingDirector.step(
        dt,
        this.matchTime,
        this.zone,
        this.kelis,
        this.carcasses,
        this.primaryPlayerId,
        this.finalFeastActive
      );
      this.zonePaceMultiplier = dirRes.zonePaceMultiplier;
      this.aiContext.directorHotspots = dirRes.publicHotspots;
      this.aiContext.matchPhase = dirRes.phase;
      if (dirRes.zoneWarningJustTriggered) {
        this.addSoundCue('Radioactive zone closing soon', null, 'warning');
      }
      if (dirRes.phaseChanged) {
        if (dirRes.phase === 'mid') {
          this.pushBanner(
            'Mid-Game · Basin Pressure Rising',
            'Predators evolving · Watch for contested carcasses and zone shifts'
          );
        } else if (dirRes.phase === 'endgame') {
          this.pushBanner(
            'Endgame · Final Convergence',
            'Surviving Kelis closing in · Reunite 100 fragments to ascend'
          );
        }
      }
    }

    // 1b. Rebuild lightweight AI spatial grid once per step (O(N) for 100-Keli matches)
    this.aiController.beginStep(this.kelis, this.carcasses, this.pickups, this.matchTime);
    this.aiContext.matchTime = this.matchTime;
    this.aiContext.finalFeastActive = this.finalFeastActive;

    // 2. Update each living Keli (timers, player input / AI brain, movement, combat)
    for (let i = 0; i < this.kelis.length; i++) {
      if (this.status !== 'playing' || this.matchConcluded) break;
      const k = this.kelis[i];
      if (!k.alive) continue;
      this.updateKeliTimers(k, dt);
      if (!k.alive || this.status !== 'playing' || this.matchConcluded) continue;

      if (k.isPlayer) {
        this.applyPlayerControls(k, dt);
      } else {
        this.updateAiBrain(k, dt);
      }

      this.moveKeli(k, dt);
      this.updateBiteAndFeeding(k, dt);
      if (this.status !== 'playing' || this.matchConcluded) break;
      this.applyEnvironmentalEffects(k, dt);
    }

    if (this.status !== 'playing' || this.matchConcluded) return;

    // 3. Final Feast phase check & carcass currents / accessibility recovery
    this.updateFinalFeast(dt);
    this.updateCarcasses(dt);

    // 3b. Random healing & power-up items (including rain-fed drops)
    this.updatePickups(dt);

    // 4. World VFX & callouts
    this.updateEffects(dt);

    // 5. Tutorial step tracking
    if (this.mode === 'tutorial' && this.tutorial) {
      this.updateTutorialProgress();
    }

    // 6. Check win/loss/draw conditions
    this.evaluateMatchOutcome();
  }

  private getWeatherTargetVisibility(kind: WeatherKind): number {
    if (kind === 'basin_fog') return 0.58;
    if (kind === 'light_rain') return 0.84;
    return 1.0;
  }

  private getWeatherLabel(kind: WeatherKind): string {
    if (kind === 'light_rain') return 'Light Monsoon Rain';
    if (kind === 'basin_fog') return 'Basin Mist & Fog';
    return 'Clear Twilight';
  }

  private updateWeather(dt: number) {
    if (this.mode === 'tutorial' && this.tutorial && this.tutorial.step < 1) {
      return; // Keep Step 1 serene so new players focus on movement & basic bite
    }

    this.weather.remainingSec -= dt;
    if (this.weather.remainingSec <= 0) {
      if (this.weatherTargetKind === 'clear') {
        // Trigger occasional light rain or dense fog across Wang Kelian
        const nextKind: WeatherKind =
          this.lastNonClearWeather === 'basin_fog'
            ? Math.random() < 0.78
              ? 'light_rain'
              : 'basin_fog'
            : Math.random() < 0.65
              ? 'basin_fog'
              : 'light_rain';

        this.lastNonClearWeather = nextKind;
        this.weatherTargetKind = nextKind;
        this.weather.kind = nextKind;
        this.weather.label = this.getWeatherLabel(nextKind);
        this.weather.remainingSec = nextKind === 'light_rain' ? 24 + Math.random() * 10 : 20 + Math.random() * 9;

        if (nextKind === 'light_rain') {
          this.emitSfxGlobal('weather_rain');
          this.pushBanner(
            'Light Monsoon Rain',
            'Visibility softens · Rain-fed power-ups blooming across the flooded basin'
          );
          this.addSoundCue('Light rain moving across the basin', null, 'info');
          // Immediately sprout 3 rain-fed power-ups across flooded water
          for (let i = 0; i < 3; i++) {
            if (this.pickups.length < 30) {
              this.spawnRainFedPickup();
            }
          }
          this.pickupSpawnTimer = Math.min(this.pickupSpawnTimer, 1.4);
        } else {
          this.emitSfxGlobal('weather_fog');
          this.pushBanner(
            'Dense Basin Fog',
            'Karst mist reduces sight & Echo Sonar range across the lagoon'
          );
          this.addSoundCue('Thick fog rolling over Wang Kelian', null, 'warning');
          // Occasional mist-condensed dew drop in deeper water
          if (this.pickups.length < 26) {
            this.spawnRainFedPickup('monsoon_dew');
          }
        }
      } else {
        this.weatherTargetKind = 'clear';
        this.weather.kind = 'clear';
        this.weather.label = this.getWeatherLabel('clear');
        this.weather.remainingSec = 22 + Math.random() * 12;
        this.addSoundCue('Skies clearing over Wang Kelian', null, 'info');
      }
    }

    const targetIntensity = this.weatherTargetKind === 'clear' ? 0 : 1;
    const rampRate = this.weatherTargetKind === 'clear' ? 0.32 : 0.42;
    this.weather.intensity += (targetIntensity - this.weather.intensity) * Math.min(1, dt * rampRate * 2.5);
    if (Math.abs(targetIntensity - this.weather.intensity) < 0.01) {
      this.weather.intensity = targetIntensity;
    }

    const targetVis = this.getWeatherTargetVisibility(this.weatherTargetKind);
    this.weather.visibilityRange += (targetVis - this.weather.visibilityRange) * Math.min(1, dt * 0.9);
  }

  private updateZone(dt: number) {
    if (this.finalFeastActive) {
      this.zone.warningActive = false;
      return; // Pause radioactive contraction during Final Feast so the sole survivor can collect remaining fragments
    }
    if (this.mode === 'tutorial' && this.tutorial && this.tutorial.step < 4) {
      this.zone.warningActive = false;
      return; // Pause radioactive contraction during early guided steps
    }

    const usePacingProfile = this.mode !== 'tutorial';
    const profile = this.pacingDirector.profile;

    if (!this.zone.isShrinking) {
      // Gently accelerate idle wait countdown during verified lulls while preserving the full pre-contraction warning window
      const canAccelerateWait =
        usePacingProfile &&
        this.zonePaceMultiplier > 1.0 &&
        this.zone.warningTimer > profile.preContractionAlertSec;
      const stepDt = canAccelerateWait ? dt * this.zonePaceMultiplier : dt;
      if (canAccelerateWait) {
        this.zone.warningTimer = Math.max(
          profile.preContractionAlertSec,
          this.zone.warningTimer - stepDt
        );
      } else {
        this.zone.warningTimer -= dt;
      }

      if (this.zone.warningTimer <= 0 && this.zone.phase < 5) {
        this.zone.isShrinking = true;
        this.zone.warningActive = false;
        this.zone.phase += 1;
        const radii = usePacingProfile
          ? profile.zoneRadii
          : [
              scaleArenaDist(960),
              scaleArenaDist(720),
              scaleArenaDist(490),
              scaleArenaDist(300),
              scaleArenaDist(160),
            ];
        this.zone.targetRadius = radii[this.zone.phase - 1] ?? scaleArenaDist(160);
        if (this.zone.phase >= 2) {
          this.pushBanner(
            'Radioactive Zone Contracting',
            `Phase ${this.zone.phase} · Move toward Jantung Tasik`
          );
          this.emitSfxGlobal('whistle');
          this.addSoundCue('Radioactive zone closing in', null, 'warning');
        }
      }
    } else {
      const shrinkSpeed = usePacingProfile ? profile.shrinkSpeed : Math.round(24 * ARENA_SCALE);
      this.zone.currentRadius = Math.max(
        this.zone.targetRadius,
        this.zone.currentRadius - shrinkSpeed * dt
      );
      if (this.zone.currentRadius <= this.zone.targetRadius + 0.5) {
        this.zone.currentRadius = this.zone.targetRadius;
        this.zone.isShrinking = false;
        this.zone.warningTimer = usePacingProfile ? profile.phasePauseSec : 28;
      }
    }
  }

  private updateKeliTimers(k: KeliEntity, dt: number) {
    if (k.biteCooldown > 0) k.biteCooldown = Math.max(0, k.biteCooldown - dt);
    if (k.biteBufferTimer > 0) k.biteBufferTimer = Math.max(0, k.biteBufferTimer - dt);
    if (k.staminaRegenDelay > 0) k.staminaRegenDelay = Math.max(0, k.staminaRegenDelay - dt);
    const prevEvade = k.evadeTimer;
    if (k.evadeTimer > 0) {
      k.evadeTimer = Math.max(0, k.evadeTimer - dt);
      if (prevEvade > 0 && k.evadeTimer <= 0) {
        clampPostBurstVelocity(k, this.getMoveSpeed(k));
      }
    }
    if (k.staggerTimer > 0) k.staggerTimer = Math.max(0, k.staggerTimer - dt);

    const prevStun = k.stunTimer;
    if (k.stunTimer > 0) {
      k.stunTimer = Math.max(0, k.stunTimer - dt);
      if (prevStun > 0 && k.stunTimer <= 0 && k.stunStacks >= 2) {
        // Grant temporary stun immunity after repeated stun stacks so stun-locking is impossible
        k.stunResistTimer = Math.max(k.stunResistTimer, STUN_RESIST_DURATION_SEC);
        k.stunStacks = 0;
        k.stunStackDecayTimer = 0;
      }
    }
    if (k.stunResistTimer > 0) k.stunResistTimer = Math.max(0, k.stunResistTimer - dt);
    if (k.stunStackDecayTimer > 0) {
      k.stunStackDecayTimer = Math.max(0, k.stunStackDecayTimer - dt);
      if (k.stunStackDecayTimer <= 0 && k.stunTimer <= 0) {
        k.stunStacks = 0;
      }
    }
    if (k.recoilTimer > 0) {
      k.recoilTimer = Math.max(0, k.recoilTimer - dt);
      if (k.recoilTimer <= 0) {
        k.recoilStrength = 0;
      }
    }
    if ((k.feedingRecoveryTimer ?? 0) > 0) {
      k.feedingRecoveryTimer = Math.max(0, (k.feedingRecoveryTimer ?? 0) - dt);
    }
    if ((k.feedingFeedbackCooldown ?? 0) > 0) {
      k.feedingFeedbackCooldown = Math.max(0, (k.feedingFeedbackCooldown ?? 0) - dt);
    }
    if ((k.shoreSplashCooldown ?? 0) > 0) {
      k.shoreSplashCooldown = Math.max(0, (k.shoreSplashCooldown ?? 0) - dt);
    }
    if ((k.locomotionFxTimer ?? 0) > 0) {
      k.locomotionFxTimer = Math.max(0, (k.locomotionFxTimer ?? 0) - dt);
    }

    if (k.frenzyTimer > 0) k.frenzyTimer = Math.max(0, k.frenzyTimer - dt);
    if (k.surgeTimer > 0) k.surgeTimer = Math.max(0, k.surgeTimer - dt);
    if (k.predatorTimer > 0) k.predatorTimer = Math.max(0, k.predatorTimer - dt);
    if (k.aegisTimer > 0) k.aegisTimer = Math.max(0, k.aegisTimer - dt);
    if (k.dewTimer > 0) {
      k.dewTimer = Math.max(0, k.dewTimer - dt);
      k.hp = Math.min(k.maxHp, k.hp + k.maxHp * 0.045 * dt);
      k.stamina = Math.min(k.maxStamina, k.stamina + 10 * dt);
      if (k.stamina >= 32) k.fatigued = false;
    }
    if (k.stormFinTimer > 0) k.stormFinTimer = Math.max(0, k.stormFinTimer - dt);
    if (k.thunderRoeTimer > 0) k.thunderRoeTimer = Math.max(0, k.thunderRoeTimer - dt);
    if (k.evoBoostTimer > 0) k.evoBoostTimer = Math.max(0, k.evoBoostTimer - dt);
    if ((k.bountyBoostTimer ?? 0) > 0) {
      k.bountyBoostTimer = Math.max(0, (k.bountyBoostTimer ?? 0) - dt);
      k.stamina = Math.min(k.maxStamina, k.stamina + 24 * dt);
      if (k.stamina >= 32) k.fatigued = false;
    }
    if (k.veilTimer > 0) k.veilTimer = Math.max(0, k.veilTimer - dt);
    const prevDash = k.dashTimer;
    if (k.dashTimer > 0) {
      k.dashTimer = Math.max(0, k.dashTimer - dt);
      if (prevDash > 0 && k.dashTimer <= 0) {
        clampPostBurstVelocity(k, this.getMoveSpeed(k));
      }
    }
    if (k.sonarTimer > 0) k.sonarTimer = Math.max(0, k.sonarTimer - dt);
    if (k.hitFlashTimer > 0) k.hitFlashTimer = Math.max(0, k.hitFlashTimer - dt);
    if ((k.emoteCooldown ?? 0) > 0) {
      k.emoteCooldown = Math.max(0, (k.emoteCooldown ?? 0) - dt);
    }
    if ((k.emoteTimer ?? 0) > 0) {
      k.emoteTimer = Math.max(0, (k.emoteTimer ?? 0) - dt);
      if (k.emoteTimer <= 0) {
        k.activeEmote = null;
      }
    }

    const cdScale = k.stormFinTimer > 0 ? 1.55 : 1.0;
    k.cooldowns.evade = Math.max(0, k.cooldowns.evade - dt * cdScale);
    k.cooldowns.dash = Math.max(0, k.cooldowns.dash - dt * cdScale);
    k.cooldowns.sonar = Math.max(0, k.cooldowns.sonar - dt * cdScale);
    k.cooldowns.veil = Math.max(0, k.cooldowns.veil - dt * cdScale);
    k.cooldowns.electroshock = Math.max(0, k.cooldowns.electroshock - dt * cdScale);
    k.cooldowns.maelstrom = Math.max(0, k.cooldowns.maelstrom - dt * cdScale);

    // Venom DoT ticks
    if (k.venomTimer > 0) {
      k.venomTimer = Math.max(0, k.venomTimer - dt);
      const dmg = k.venomDps * dt;
      k.hp -= dmg;
      if (k.hp <= 0) {
        const attacker = this.kelis.find((e) => e.id === k.venomSourceId) ?? null;
        this.handleDeath(
          k,
          attacker,
          attacker ? `${attacker.name}'s Venom Bite` : 'Residual Venom',
          'venom_kill'
        );
      }
    }
  }

  private applyPlayerControls(p: KeliEntity, dt: number) {
    const profile = getLocomotionProfile(p.level, p.isOnShore);

    if (p.stunTimer > 0) {
      applyLocomotionVelocity(p, 0, 0, 0, dt, profile);
      return;
    }

    const input = this.inputsById.get(p.id) ?? {
      moveX: 0,
      moveZ: 0,
      aimAngle: p.facingAngle,
      biteHeld: false,
    };

    const len = Math.hypot(input.moveX, input.moveZ);
    const speed = this.getMoveSpeed(p);

    if (p.evadeTimer > 0) {
      p.vx = p.evadeDirX * speed * 2.4;
      p.vz = p.evadeDirZ * speed * 2.4;
      const evadeAngle = Math.atan2(p.evadeDirZ, p.evadeDirX);
      p.moveAngle = evadeAngle;
      p.facingAngle = rotateAngleTowards(p.facingAngle, evadeAngle, 16 * dt);
      return;
    }

    if (p.dashTimer > 0) {
      p.vx = p.dashDirX * speed * 2.55;
      p.vz = p.dashDirZ * speed * 2.55;
      const dashAngle = Math.atan2(p.dashDirZ, p.dashDirX);
      p.moveAngle = dashAngle;
      if (p.bitePhase === 'idle') {
        p.facingAngle = rotateAngleTowards(p.facingAngle, dashAngle, 15 * dt);
      }
    } else if (len > 0.05) {
      const nx = input.moveX / len;
      const nz = input.moveZ / len;

      // Voluntary feeding cancel: actively pulling away from the carcass while not holding feed cancels cleanly
      if (p.feedingTargetId && !input.biteHeld) {
        const carc = this.carcasses.find((c) => c.id === p.feedingTargetId && !c.consumed && c.mass > 0);
        if (carc) {
          const toX = carc.x - p.x;
          const toZ = carc.z - p.z;
          const toLen = Math.hypot(toX, toZ);
          const dotAway = toLen > 0.001 ? (nx * toX + nz * toZ) / toLen : -1;
          if (dotAway < -0.5) {
            p.feedingCancelHoldTimer = (p.feedingCancelHoldTimer ?? 0) + dt;
            if (p.feedingCancelHoldTimer >= 0.14) {
              this.cancelFeeding(p, 'voluntary');
            }
          } else {
            p.feedingCancelHoldTimer = 0;
          }
        }
      } else if (p.feedingCancelHoldTimer) {
        p.feedingCancelHoldTimer = 0;
      }

      const effectiveSpeed = this.getMoveSpeed(p);
      const moveScale =
        p.bitePhase === 'windup'
          ? 0.58
          : p.bitePhase === 'recovery'
          ? 0.68
          : 1.0;
      const analogMag = Math.min(1, len);
      const currentSpeed = applyLocomotionVelocity(
        p,
        nx * analogMag,
        nz * analogMag,
        effectiveSpeed * moveScale,
        dt,
        profile
      );
      if (p.bitePhase === 'idle' && !p.feedingTargetId) {
        const desired = Math.atan2(nz, nx);
        const turnRate = computeTurnRate(profile, currentSpeed, effectiveSpeed);
        p.facingAngle = rotateAngleTowards(p.facingAngle, desired, turnRate * dt);
      }
    } else {
      if (p.feedingCancelHoldTimer) p.feedingCancelHoldTimer = 0;
      applyLocomotionVelocity(p, 0, 0, 0, dt, profile);
    }

    // Separate attack-facing from locomotion direction: during bite phases align smoothly with
    // locked biteAimAngle; while stationary track mouse/aimAngle smoothly with zero 180-deg snapping.
    if (p.bitePhase !== 'idle') {
      p.facingAngle = rotateAngleTowards(p.facingAngle, p.biteAimAngle, 18 * dt);
    } else if (len <= 0.05 && !p.feedingTargetId) {
      const idleTurnRate = Math.max(11, profile.lowSpeedTurnRate);
      p.facingAngle = rotateAngleTowards(p.facingAngle, input.aimAngle, idleTurnRate * dt);
    }

    // Held bite/feed
    if (input.biteHeld) {
      this.tryBiteOrFeed(p, false);
    }
  }

  private getMoveSpeed(k: KeliEntity): number {
    let base = 158 + Math.min(48, k.level * 0.45);
    if (k.isOnShore) {
      base *= getLocomotionProfile(k.level, true).shoreSpeedMult;
    }
    if (k.activeHazard) {
      const mod = getHazardModifierForForm(k.activeHazard, getEvolutionForm(k.level));
      const hasSwift = k.surgeTimer > 0 || k.stormFinTimer > 0;
      const effectiveMult =
        hasSwift && mod.speedMult < 1
          ? 1 - (1 - mod.speedMult) * 0.5
          : mod.speedMult;
      base *= effectiveMult;
    }
    if (k.staggerTimer > 0) base *= 0.46;
    if (k.fatigued) base *= 0.84;
    if (k.frenzyTimer > 0) base *= 1.18;
    if (k.surgeTimer > 0) base *= 1.28;
    if (k.stormFinTimer > 0) base *= 1.22;
    if (k.evoBoostTimer > 0) base *= 1.18;
    if ((k.bountyBoostTimer ?? 0) > 0) base *= 1.2;
    if (k.feedingTargetId) base *= FEED_MOVE_SPEED_MULT; // 20% speed while committing to a feed
    return base;
  }

  private moveKeli(k: KeliEntity, dt: number) {
    if (!k.alive) return;

    // Water current push when in water (zone streams + rapids hazard tiles)
    let curX = 0;
    let curZ = 0;
    const prevHazard = k.activeHazard;
    const prevOnShore = k.isOnShore;
    const activeHazardTile = getHazardAt(k.x, k.z);
    if (!k.isOnShore) {
      const cur = getCurrentVectorAt(k.x, k.z);
      curX = cur.vx;
      curZ = cur.vz;
      if (activeHazardTile && activeHazardTile.kind === 'rapids') {
        const form = getEvolutionForm(k.level);
        // Heavier legs catch more lateral current drift; streamlined aquatic rides smoothly
        const flowScale = form === 1 ? 0.85 : form === 2 ? 1.05 : 1.25;
        curX += activeHazardTile.flowVx * flowScale;
        curZ += activeHazardTile.flowVz * flowScale;
      }
    }

    const nextX = k.x + (k.vx + curX) * dt;
    const nextZ = k.z + (k.vz + curZ) * dt;
    const radius = this.computeRadius(k.level);
    const canGoAshore = k.level >= 40;

    // Swept multi-pass collision prevents tunneling during Dash/Evade and projects velocity tangentially
    const resolved = resolveSweptMovement(k.x, k.z, nextX, nextZ, radius, canGoAshore);
    k.x = resolved.x;
    k.z = resolved.z;

    if (resolved.collided || resolved.blockedByShore) {
      projectVelocityAlongCollisionNormal(k, resolved.normalX, resolved.normalZ);
    }

    if (k.isPlayer && resolved.blockedByShore && Math.random() < 0.06) {
      this.spawnCallout(k.x, k.z, 'Shore requires Lv.40', '#d4a359');
    }

    const terrain = getTerrainAt(k.x, k.z);
    k.isOnShore = terrain === 'shore';
    k.isSubmerged = terrain === 'deep';

    // Restrained, pooled movement visual cues (culled near player & bounded for 100-Keli perf)
    if (this.effects.length < 72) {
      const primary = this.kelis[0];
      const nearView =
        k.isPlayer ||
        !primary ||
        Math.hypot(k.x - primary.x, k.z - primary.z) < 720;

      if (nearView) {
        if (prevOnShore !== k.isOnShore && (k.shoreSplashCooldown ?? 0) <= 0) {
          k.shoreSplashCooldown = 0.45;
          this.effects.push({
            id: this.nextId('fx'),
            type: 'shore_splash',
            x: k.x,
            z: k.z,
            angle: k.moveAngle ?? k.facingAngle,
            radius: 26 + radius * 0.75,
            duration: 0.42,
            elapsed: 0,
            ownerId: k.id,
            color: '#bae6fd',
          });
        } else if ((k.locomotionFxTimer ?? 0) <= 0 && k.dashTimer <= 0 && k.evadeTimer <= 0) {
          const speed = Math.hypot(k.vx, k.vz);
          if (!k.isOnShore && speed > 58) {
            k.locomotionFxTimer = Math.max(0.24, 0.44 - speed * 0.0008);
            this.effects.push({
              id: this.nextId('fx'),
              type: 'water_ripple',
              x: k.x - Math.cos(k.moveAngle ?? k.facingAngle) * (radius * 0.45),
              z: k.z - Math.sin(k.moveAngle ?? k.facingAngle) * (radius * 0.45),
              angle: k.moveAngle ?? k.facingAngle,
              radius: 18 + radius * 0.55 + Math.min(14, speed * 0.05),
              duration: 0.48,
              elapsed: 0,
              ownerId: k.id,
              color: '#7dd3fc',
            });
          } else if (k.isOnShore && speed > 36) {
            const isForm2Drag = k.level >= 40 && k.level < 80;
            k.locomotionFxTimer = isForm2Drag ? 0.36 : 0.3;
            this.effects.push({
              id: this.nextId('fx'),
              type: 'land_dust',
              x: k.x,
              z: k.z,
              angle: k.moveAngle ?? k.facingAngle,
              radius: (isForm2Drag ? 22 : 18) + radius * 0.45,
              duration: 0.42,
              elapsed: 0,
              ownerId: k.id,
              color: isForm2Drag ? '#a68966' : '#c4a882',
            });
          }
        }
      }
    }

    const newHazardTile = getHazardAt(k.x, k.z);
    k.activeHazard = newHazardTile?.kind ?? null;
    if (k.isPlayer && newHazardTile && newHazardTile.kind !== prevHazard) {
      const mod = getHazardModifierForForm(newHazardTile.kind, getEvolutionForm(k.level));
      this.spawnCallout(k.x, k.z, mod.label.toUpperCase(), mod.color);
    }

    // Track movement for tutorial
    if (k.isPlayer && this.tutorial && this.tutorial.step === 0) {
      this.tutorial.movedDistance += Math.hypot(k.x - this.prevPlayerX, k.z - this.prevPlayerZ);
      this.prevPlayerX = k.x;
      this.prevPlayerZ = k.z;
    }
  }

  private applyEnvironmentalEffects(k: KeliEntity, dt: number) {
    if (!k.alive) return;

    const form = getEvolutionForm(k.level);
    const hazardMod = k.activeHazard ? getHazardModifierForForm(k.activeHazard, form) : null;

    // 1. Stamina & Hazard Tile Drain / Recovery
    if (hazardMod && hazardMod.staminaRate < 0) {
      const rate =
        k.surgeTimer > 0 || k.stormFinTimer > 0
          ? hazardMod.staminaRate * 0.45
          : hazardMod.staminaRate;
      k.stamina = Math.max(0, k.stamina + rate * dt);
    } else if (k.staminaRegenDelay <= 0) {
      const baseRegen = k.isOnShore ? 12 : 20;
      const bonusRegen = hazardMod ? Math.max(0, hazardMod.staminaRate) : 0;
      k.stamina = Math.min(k.maxStamina, k.stamina + (baseRegen + bonusRegen) * dt);
    }

    if (k.stamina <= 15) {
      if (!k.fatigued && k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'STAMINA FATIGUED', '#f59e0b');
      }
      k.fatigued = true;
    } else if (k.stamina >= 32) {
      k.fatigued = false;
    }

    // 2. Shoreline Exposure Rule (Lv 40-79: 10s reserve, accelerated by Scorched Brine Vents, frozen by Aegis Ward/Monsoon Dew)
    if (k.level >= 40 && k.level < 80) {
      if (k.aegisTimer > 0 || k.dewTimer > 0) {
        k.shoreReserve = k.maxShoreReserve;
      } else if (k.isOnShore) {
        if (k.shoreReserve > 0) {
          const reserveMult = hazardMod ? hazardMod.shoreReserveMult : 1;
          k.shoreReserve = Math.max(0, k.shoreReserve - dt * reserveMult);
        } else {
          k.hp -= k.maxHp * 0.07 * dt;
          if (k.hp <= 0) {
            this.handleDeath(k, null, 'Shoreline Exposure (Dehydration)', 'exposure_death');
            return;
          }
        }
      } else {
        k.shoreReserve = Math.min(k.maxShoreReserve, k.shoreReserve + 2.5 * dt);
      }
    } else if (k.level >= 80) {
      k.shoreReserve = k.maxShoreReserve;
    }

    // 2. Radioactive Zone Outside Damage (suspended during Final Feast cleanup)
    if (!this.finalFeastActive) {
      const distFromZone = Math.hypot(k.x - this.zone.centerX, k.z - this.zone.centerZ);
      if (distFromZone > this.zone.currentRadius) {
        const zoneDps = 6 + this.zone.phase * 3.5;
        k.hp -= zoneDps * dt;
        if (k.hp <= 0) {
          this.handleDeath(k, null, 'Radioactive Zone', 'zone_death');
        }
      }
    }
  }

  private findClosestPrey(k: KeliEntity, maxEdgeDist: number): KeliEntity | null {
    let closest: KeliEntity | null = null;
    let bestEdgeDist = Infinity;
    const veilRevealDist = 42 * this.weather.visibilityRange;

    for (const other of this.kelis) {
      if (!other.alive || other.id === k.id) continue;
      const centerDist = Math.hypot(other.x - k.x, other.z - k.z);
      if (other.veilTimer > 0 && centerDist > veilRevealDist) continue;
      const edgeDist = centerDist - this.computeRadius(other.level);
      if (edgeDist <= maxEdgeDist && edgeDist < bestEdgeDist) {
        bestEdgeDist = edgeDist;
        closest = other;
      }
    }
    return closest;
  }

  private findClosestPreyInCone(
    k: KeliEntity,
    maxEdgeDist: number,
    aimAngle: number,
    halfAngle: number
  ): KeliEntity | null {
    let closest: KeliEntity | null = null;
    let bestScore = Infinity;
    const veilRevealDist = 42 * this.weather.visibilityRange;

    for (const other of this.kelis) {
      if (!other.alive || other.id === k.id) continue;
      const dx = other.x - k.x;
      const dz = other.z - k.z;
      const centerDist = Math.hypot(dx, dz);
      if (other.veilTimer > 0 && centerDist > veilRevealDist) continue;
      const edgeDist = centerDist - this.computeRadius(other.level);
      if (edgeDist > maxEdgeDist) continue;

      const angToOther = centerDist > 0.001 ? Math.atan2(dz, dx) : aimAngle;
      const absDiff = Math.abs(normalizeAngleDiff(angToOther, aimAngle));
      if (absDiff > halfAngle) continue;

      const score = edgeDist + absDiff * 36;
      if (score < bestScore) {
        bestScore = score;
        closest = other;
      }
    }
    return closest;
  }

  public getFeedRange(level: number): number {
    return FEED_RANGE_BASE + this.computeRadius(level);
  }

  public getFeedPacing(mass: number): {
    windupSec: number;
    tickSec: number;
    batchSize: number;
    totalDuration: number;
  } {
    const safeMass = Math.max(1, Math.trunc(mass));
    if (this.finalFeastActive) {
      const windupSec = FINAL_FEAST_FEED_WINDUP_SEC;
      const tickSec = FINAL_FEAST_FEED_TICK_SEC;
      const batchSize = safeMass > 16 ? 2 : 1;
      const remainingTicks = Math.max(0, Math.ceil((safeMass - 1) / batchSize));
      return {
        windupSec,
        tickSec,
        batchSize,
        totalDuration: windupSec + remainingTicks * tickSec,
      };
    }

    const windupSec = FEED_WINDUP_SEC;
    const tickSec =
      safeMass >= LARGE_CARCASS_THRESHOLD
        ? FEED_TICK_SEC_LARGE
        : safeMass >= MEDIUM_CARCASS_THRESHOLD
        ? FEED_TICK_SEC_MEDIUM
        : FEED_TICK_SEC_SMALL;
    const batchSize = 1;
    return {
      windupSec,
      tickSec,
      batchSize,
      totalDuration: windupSec + Math.max(0, safeMass - 1) * tickSec,
    };
  }

  public canFeedOnCarcass(
    k: KeliEntity,
    carc: CarcassEntity,
    includeHysteresis = false
  ): {
    ok: boolean;
    reason:
      | 'dead'
      | 'match_ended'
      | 'stunned'
      | 'staggered'
      | 'evading'
      | 'recovering'
      | 'depleted'
      | 'range'
      | 'obstacle'
      | 'shore'
      | null;
  } {
    if (!k.alive) return { ok: false, reason: 'dead' };
    if (this.status !== 'playing' || this.matchConcluded) return { ok: false, reason: 'match_ended' };
    if (k.stunTimer > 0) return { ok: false, reason: 'stunned' };
    if (k.staggerTimer > 0) return { ok: false, reason: 'staggered' };
    if (k.evadeTimer > 0 || k.dashTimer > 0) return { ok: false, reason: 'evading' };
    if ((k.feedingRecoveryTimer ?? 0) > 0 && k.feedingTargetId !== carc.id) {
      return { ok: false, reason: 'recovering' };
    }
    if (carc.consumed || carc.mass <= 0) return { ok: false, reason: 'depleted' };
    if (getTerrainAt(carc.x, carc.z) === 'shore' && k.level < 40) {
      return { ok: false, reason: 'shore' };
    }

    const maxRange = this.getFeedRange(k.level) + (includeHysteresis ? FEED_CANCEL_RANGE_BUFFER : 0);
    const dist = Math.hypot(carc.x - k.x, carc.z - k.z);
    if (dist > maxRange) return { ok: false, reason: 'range' };

    if (!hasClearObstacleLineOfSight(k.x, k.z, carc.x, carc.z)) {
      return { ok: false, reason: 'obstacle' };
    }

    return { ok: true, reason: null };
  }

  public cancelFeeding(
    k: KeliEntity,
    _reason: 'voluntary' | 'depleted' | 'out_of_range' | 'obstacle' | 'ability' = 'voluntary'
  ): boolean {
    if (!k.feedingTargetId) return false;
    k.feedingTargetId = null;
    k.feedingProgress = 0;
    k.feedingWindupDone = false;
    k.feedingTickTimer = 0;
    k.feedingSessionFragments = 0;
    k.feedingCancelHoldTimer = 0;
    return true;
  }

  public cancelFeedingForPlayer(playerId = this.primaryPlayerId): boolean {
    const p = this.kelis.find((k) => k.id === playerId);
    if (!p || !p.alive) return false;
    return this.cancelFeeding(p, 'voluntary');
  }

  private interruptFeeding(target: KeliEntity, attacker: KeliEntity | null): boolean {
    if (!target.feedingTargetId) return false;
    target.feedingTargetId = null;
    target.feedingProgress = 0;
    target.feedingWindupDone = false;
    target.feedingTickTimer = 0;
    target.feedingSessionFragments = 0;
    target.feedingCancelHoldTimer = 0;
    target.feedingRecoveryTimer = Math.max(
      target.feedingRecoveryTimer ?? 0,
      FEED_INTERRUPT_RECOVERY_SEC
    );

    if (target.isPlayer) {
      this.emitSfxFor(target.id, 'feed_interrupt');
    }
    if (attacker?.isPlayer && attacker.id !== target.id) {
      this.emitSfxFor(attacker.id, 'feed_interrupt');
    }
    if (target.isPlayer || attacker?.isPlayer) {
      this.spawnCallout(target.x, target.z, 'FEED INTERRUPTED', '#fb923c');
    }
    this.effects.push({
      id: this.nextId('fx'),
      type: 'feed_splash',
      x: target.x,
      z: target.z,
      angle: Math.random() * Math.PI * 2,
      radius: 28,
      duration: 0.32,
      elapsed: 0,
      ownerId: target.id,
      color: '#fb923c',
    });
    return true;
  }

  private notifyNearbyFeedingAlert(feeder: KeliEntity, carc: CarcassEntity) {
    const prevTime = this.lastFeedAlertTimeByCarcass.get(carc.id) ?? -99;
    if (this.matchTime - prevTime < 2.2) return;
    this.lastFeedAlertTimeByCarcass.set(carc.id, this.matchTime);

    // Record local feeding audio disturbance so nearby bots within FEED_SOUND_ALERT_RANGE can react
    this.aiController.recordFeedingDisturbance(
      carc.x,
      carc.z,
      carc.id,
      feeder.id,
      carc.mass,
      this.matchTime
    );

    for (const [pid, meta] of this.playerMetaById.entries()) {
      if (pid === feeder.id) continue;
      const listener = this.getPlayer(pid);
      if (!listener || !listener.alive) continue;
      const dist = Math.hypot(carc.x - listener.x, carc.z - listener.z);
      if (dist > FEED_SOUND_ALERT_RANGE) continue;

      const dirAngle = dist > 48 ? Math.atan2(carc.z - listener.z, carc.x - listener.x) : null;
      const cue: SoundCue = {
        id: this.nextId('cue'),
        label: `Feeding nearby (+${Math.trunc(carc.mass)})`,
        directionAngle: dirAngle,
        severity: carc.mass >= LARGE_CARCASS_THRESHOLD ? 'danger' : 'warning',
        timestamp: this.matchTime,
      };
      meta.soundCues.unshift(cue);
      if (meta.soundCues.length > 5) meta.soundCues.length = 5;
      if (pid === this.primaryPlayerId) {
        this.soundCues = [...meta.soundCues];
      }
      this.emitSfxFor(pid, 'feed_nearby');
    }
  }

  private tryBiteOrFeed(k: KeliEntity, playPlayerAudio: boolean) {
    if (!k.alive || this.status !== 'playing' || this.matchConcluded) return;
    if (k.stunTimer > 0 || k.evadeTimer > 0) return;

    const strikeReach = 64 + this.computeRadius(k.level);
    const input = k.isPlayer ? this.inputsById.get(k.id) : undefined;
    const baseAim = input ? input.aimAngle : k.facingAngle;

    // Prevent simultaneous feeding and attacking: while actively feeding on a valid carcass,
    // repeated feed/bite inputs are idempotent and never trigger an offensive bite mid-feed.
    if (k.feedingTargetId) {
      const activeCarc = this.carcasses.find(
        (c) => c.id === k.feedingTargetId && !c.consumed && c.mass > 0
      );
      if (activeCarc && this.canFeedOnCarcass(k, activeCarc, true).ok) {
        const carcAngle = Math.atan2(activeCarc.z - k.z, activeCarc.x - k.x);
        k.facingAngle = rotateAngleTowards(k.facingAngle, carcAngle, 0.45);
        if (input) input.aimAngle = carcAngle;
        return;
      }
      this.cancelFeeding(k, activeCarc ? 'out_of_range' : 'depleted');
    }

    // Only treat rivals as immediate combat interference if they are in front AND not behind the carcass being contested
    const closestInFront = this.findClosestPreyInCone(k, strikeReach, baseAim, BITE_CONE_HALF_ANGLE);
    const closestInFrontDist = closestInFront
      ? Math.hypot(closestInFront.x - k.x, closestInFront.z - k.z)
      : Infinity;

    // Select nearest valid feedable carcass (checking range, LOS, shore Lv.40, and recovery)
    let nearestCarc: CarcassEntity | null = null;
    let nearestCarcDist = Infinity;
    let nearestBlockedReason: 'obstacle' | 'shore' | 'recovering' | null = null;
    let nearestBlockedDist = Infinity;

    for (const c of this.carcasses) {
      if (c.consumed || c.mass <= 0) continue;
      const d = Math.hypot(c.x - k.x, c.z - k.z);
      const check = this.canFeedOnCarcass(k, c, false);
      if (check.ok) {
        if (d < nearestCarcDist) {
          nearestCarcDist = d;
          nearestCarc = c;
        }
      } else if (
        (check.reason === 'obstacle' || check.reason === 'shore' || check.reason === 'recovering') &&
        d <= this.getFeedRange(k.level) + 12 &&
        d < nearestBlockedDist
      ) {
        nearestBlockedDist = d;
        nearestBlockedReason = check.reason;
      }
    }

    const rivalBlocksFeed =
      Boolean(closestInFront) &&
      (!nearestCarc || closestInFrontDist <= nearestCarcDist + 24);

    // Deliberate feeding if valid carcass is in range, not mid-attack, and no rival is closer/clashing in front
    if (
      nearestCarc &&
      k.bitePhase === 'idle' &&
      k.staggerTimer <= 0 &&
      !rivalBlocksFeed
    ) {
      const carcAngle = Math.atan2(nearestCarc.z - k.z, nearestCarc.x - k.x);
      k.facingAngle = rotateAngleTowards(k.facingAngle, carcAngle, 0.45);
      if (input) {
        input.aimAngle = carcAngle;
      }
      const pacing = this.getFeedPacing(nearestCarc.mass);
      k.feedingTargetId = nearestCarc.id;
      k.feedingProgress = 0;
      k.feedingDuration = pacing.totalDuration;
      k.feedingWindupDone = false;
      k.feedingTickTimer = 0;
      k.feedingSessionFragments = 0;
      k.feedingCancelHoldTimer = 0;

      if (k.isPlayer) {
        this.emitSfxFor(k.id, 'feed_start');
      }
      this.notifyNearbyFeedingAlert(k, nearestCarc);
      return;
    }

    // Clear feedback if player explicitly attempted to feed on an unavailable nearby carcass
    if (
      k.isPlayer &&
      playPlayerAudio &&
      !closestInFront &&
      nearestBlockedReason &&
      (k.feedingFeedbackCooldown ?? 0) <= 0
    ) {
      k.feedingFeedbackCooldown = 0.85;
      const msg =
        nearestBlockedReason === 'obstacle'
          ? 'BLOCKED BY ROCK'
          : nearestBlockedReason === 'shore'
          ? 'SHORE REQUIRES LV.40'
          : 'FEED RECOVERING';
      this.spawnCallout(k.x, k.z, msg, '#f59e0b');
      this.emitSfxFor(k.id, 'hit_blocked');
      return;
    }

    // Input buffering (~150ms) near the end of recovery, cooldown, or brief stagger
    if (k.staggerTimer > 0) {
      if (k.staggerTimer <= BITE_BUFFER_WINDOW_SEC) {
        k.biteBufferTimer = BITE_BUFFER_WINDOW_SEC;
      }
      return;
    }

    if (k.bitePhase !== 'idle' || k.biteCooldown > 0) {
      const inBufferWindow =
        (k.bitePhase === 'recovery' && k.bitePhaseTimer <= BITE_BUFFER_WINDOW_SEC) ||
        (k.bitePhase === 'idle' && k.biteCooldown > 0 && k.biteCooldown <= BITE_BUFFER_WINDOW_SEC);
      if (inBufferWindow) {
        k.biteBufferTimer = BITE_BUFFER_WINDOW_SEC;
      }
      return;
    }

    // Directional aim with strictly bounded forward aim assistance (never snaps behind player)
    let aimAngle = baseAim;
    const assistedTarget = this.findClosestPreyInCone(
      k,
      strikeReach + (k.isPlayer ? 42 : 16),
      baseAim,
      BITE_AIM_ASSIST_MAX_ANGLE
    );
    if (assistedTarget) {
      const preyAngle = Math.atan2(assistedTarget.z - k.z, assistedTarget.x - k.x);
      const diff = normalizeAngleDiff(preyAngle, baseAim);
      const maxAssistTurn = k.isPlayer ? 0.42 : 0.25;
      aimAngle = baseAim + Math.max(-maxAssistTurn, Math.min(maxAssistTurn, diff));
    }

    // Stamina cost: full strike uses BITE_STAMINA_COST; low stamina still permits a slower fatigued bite
    const isFatiguedBite = k.stamina < BITE_STAMINA_COST;
    k.stamina = Math.max(0, k.stamina - BITE_STAMINA_COST);
    k.staminaRegenDelay = Math.max(
      k.staminaRegenDelay,
      isFatiguedBite ? STAMINA_REGEN_DELAY_SEC * 0.75 : STAMINA_REGEN_DELAY_SEC
    );
    if (k.stamina <= 15) {
      k.fatigued = true;
    }

    k.bitePhase = 'windup';
    k.bitePhaseTimer = BITE_WINDUP_SEC;
    k.biteAimAngle = aimAngle;
    k.biteHitApplied = false;
    k.biteDidHit = false;
    k.biteFatigued = isFatiguedBite;
    k.biteBufferTimer = 0;
    k.biteAttackSeq += 1;
    k.biteHitTargetIds = [];

    if (k.isPlayer && (playPlayerAudio || input?.biteHeld)) {
      this.emitSfxFor(k.id, k.level >= 40 ? 'bite_heavy' : 'bite');
      if (this.tutorial && this.tutorial.step === 0) {
        this.tutorial.bittenOnce = true;
      }
    }
  }

  private updateBiteAndFeeding(k: KeliEntity, dt: number) {
    if (!k.alive || this.status !== 'playing' || this.matchConcluded) {
      if (k.feedingTargetId) this.cancelFeeding(k, 'depleted');
      return;
    }

    // Interrupt feeding or bite windup if stunned or staggered; cleanly cancel on evade/dash
    if (k.stunTimer > 0 || k.staggerTimer > 0) {
      if (k.feedingTargetId) {
        this.interruptFeeding(k, null);
      }
      if (k.bitePhase === 'windup') {
        k.bitePhase = 'idle';
        k.bitePhaseTimer = 0;
      }
    } else if (k.evadeTimer > 0 || k.dashTimer > 0) {
      if (k.feedingTargetId) {
        this.cancelFeeding(k, 'ability');
      }
      if (k.bitePhase === 'windup') {
        k.bitePhase = 'idle';
        k.bitePhaseTimer = 0;
      }
    }

    // 1. Progressive contested feeding commitment channel
    if (k.feedingTargetId) {
      const carc = this.carcasses.find(
        (c) => c.id === k.feedingTargetId && !c.consumed && c.mass > 0
      );
      if (!carc) {
        this.cancelFeeding(k, 'depleted');
      } else {
        const check = this.canFeedOnCarcass(k, carc, true);
        if (!check.ok) {
          this.cancelFeeding(
            k,
            check.reason === 'obstacle'
              ? 'obstacle'
              : check.reason === 'depleted'
              ? 'depleted'
              : 'out_of_range'
          );
        } else {
          // Smoothly face the carcass while feeding
          const carcAngle = Math.atan2(carc.z - k.z, carc.x - k.x);
          k.facingAngle = rotateAngleTowards(k.facingAngle, carcAngle, 10 * dt);
          const prevFeedProgress = k.feedingProgress;
          k.feedingProgress += dt;

          // Notify pacing director when 2+ Kelis genuinely contest this carcass (~2 Hz check)
          if (
            this.mode !== 'tutorial' &&
            Math.floor(k.feedingProgress * 2) > Math.floor(prevFeedProgress * 2)
          ) {
            let activeFeeders = 0;
            let allVeiled = true;
            for (let fi = 0; fi < this.kelis.length; fi++) {
              const fk = this.kelis[fi];
              if (fk.alive && fk.feedingTargetId === carc.id) {
                activeFeeders++;
                if (fk.veilTimer <= 0) allVeiled = false;
              }
            }
            if (activeFeeders >= 2) {
              this.pacingDirector.recordContestedFeed(
                carc.id,
                carc.x,
                carc.z,
                carc.mass,
                this.matchTime,
                allVeiled
              );
            }
          }

          if (Math.random() < 0.24) {
            this.effects.push({
              id: this.nextId('fx'),
              type: 'feed_splash',
              x: carc.x,
              z: carc.z,
              angle: Math.random() * Math.PI * 2,
              radius: 22,
              duration: 0.35,
              elapsed: 0,
              ownerId: k.id,
              color: '#e6b86e',
            });
          }

          const pacing = this.getFeedPacing(carc.mass);

          // Single-step full completion support (e.g., 1-fragment carcass or synthetic full-channel completion)
          if (!k.feedingWindupDone && k.feedingProgress >= k.feedingDuration) {
            this.completeFeed(k, carc.id);
          } else if (!k.feedingWindupDone && k.feedingProgress >= pacing.windupSec) {
            // Initial windup finished: transfer first fragment atomically and enter progressive tick loop
            k.feedingWindupDone = true;
            k.feedingTickTimer = Math.max(0, k.feedingProgress - pacing.windupSec);
            this.transferCarcassFragments(k, carc.id, 1, { keepChannel: true });
            if (k.feedingTargetId === carc.id && !carc.consumed && carc.mass > 0) {
              const remPacing = this.getFeedPacing(carc.mass);
              k.feedingDuration =
                k.feedingProgress +
                Math.max(1, Math.ceil(carc.mass / remPacing.batchSize)) * remPacing.tickSec;
            }
          } else if (k.feedingWindupDone) {
            k.feedingTickTimer = (k.feedingTickTimer ?? 0) + dt;
            while (
              k.feedingTickTimer >= pacing.tickSec &&
              k.feedingTargetId === carc.id &&
              !carc.consumed &&
              carc.mass > 0 &&
              k.alive &&
              !this.matchConcluded
            ) {
              k.feedingTickTimer -= pacing.tickSec;
              const transferred = this.transferCarcassFragments(k, carc.id, pacing.batchSize, {
                keepChannel: true,
              });
              if (transferred <= 0) break;
            }
            if (k.feedingTargetId === carc.id && !carc.consumed && carc.mass > 0) {
              const remPacing = this.getFeedPacing(carc.mass);
              const remTime = Math.max(
                0.05,
                Math.ceil(carc.mass / remPacing.batchSize) * remPacing.tickSec -
                  (k.feedingTickTimer ?? 0)
              );
              k.feedingDuration = k.feedingProgress + remTime;
            }
          }
        }
      }
    }

    // 2. Bite telegraph (windup) -> active hit window (strike) -> vulnerable recovery -> cooldown
    if (k.bitePhase === 'idle') {
      // Execute buffered bite immediately once cooldown/stagger/evade clears
      if (
        k.biteBufferTimer > 0 &&
        k.biteCooldown <= 0 &&
        k.stunTimer <= 0 &&
        k.staggerTimer <= 0 &&
        k.evadeTimer <= 0
      ) {
        k.biteBufferTimer = 0;
        this.tryBiteOrFeed(k, k.isPlayer);
      }
      return;
    }

    k.bitePhaseTimer -= dt;

    if (k.bitePhase === 'windup' && k.bitePhaseTimer <= 0) {
      k.bitePhase = 'strike';
      k.bitePhaseTimer = BITE_STRIKE_SEC;
      k.biteHitApplied = true;
      const reach =
        (64 + this.computeRadius(k.level)) * (k.thunderRoeTimer > 0 ? 1.2 : 1.0);
      this.effects.push({
        id: this.nextId('fx'),
        type: 'bite_arc',
        x: k.x,
        z: k.z,
        angle: k.biteAimAngle,
        radius: reach,
        duration: 0.22,
        elapsed: 0,
        ownerId: k.id,
        color: k.thunderRoeTimer > 0 ? '#c084fc' : k.level >= 30 ? '#6ee7b7' : '#f3e8d2',
      });
      this.processBiteActiveWindow(k);
    } else if (k.bitePhase === 'strike') {
      // Active hit frames check each candidate at most once via k.biteHitTargetIds
      this.processBiteActiveWindow(k);
      if (k.bitePhaseTimer <= 0) {
        if (!k.biteDidHit && k.isPlayer) {
          this.emitSfxFor(k.id, 'bite_miss');
        }
        k.bitePhase = 'recovery';
        k.bitePhaseTimer =
          k.frenzyTimer > 0 || k.predatorTimer > 0
            ? 0.14
            : k.biteFatigued
            ? 0.28
            : BITE_RECOVERY_SEC;
      }
    } else if (k.bitePhase === 'recovery' && k.bitePhaseTimer <= 0) {
      k.bitePhase = 'idle';
      k.biteCooldown =
        k.frenzyTimer > 0 || k.predatorTimer > 0
          ? 0.1
          : k.biteFatigued
          ? 0.22
          : BITE_COOLDOWN_SEC;
      k.biteHitTargetIds = [];
    }
  }

  private processBiteActiveWindow(attacker: KeliEntity) {
    if (!attacker.alive || this.status !== 'playing' || this.matchConcluded) return;
    if (!attacker.biteHitTargetIds) attacker.biteHitTargetIds = [];

    const reach =
      (64 + this.computeRadius(attacker.level)) * (attacker.thunderRoeTimer > 0 ? 1.2 : 1.0);
    const baseDmg =
      (19 + attacker.level * 1.15) *
      (attacker.predatorTimer > 0 ? 1.32 : 1.0) *
      (attacker.thunderRoeTimer > 0 ? 1.28 : 1.0) *
      (attacker.evoBoostTimer > 0 ? 1.15 : 1.0) *
      (attacker.biteFatigued ? 0.78 : 1.0);

    for (const target of this.kelis) {
      if (!target.alive || target.id === attacker.id) continue;
      // Strict single-hit guard per attack window
      if (attacker.biteHitTargetIds.includes(target.id)) continue;

      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + this.computeRadius(target.level)) continue;

      // Strict directional hit detection: NEVER hit enemies behind the attacker
      const angToTarget = dist > 0.001 ? Math.atan2(dz, dx) : attacker.biteAimAngle;
      const absDiff = Math.abs(normalizeAngleDiff(angToTarget, attacker.biteAimAngle));
      const allowedHalfAngle =
        dist <= 22 ? BITE_CLOSE_FRONT_HALF_ANGLE : BITE_CONE_HALF_ANGLE;
      if (absDiff > allowedHalfAngle) continue;

      attacker.biteHitTargetIds.push(target.id);
      attacker.biteDidHit = true;

      const isCrit =
        !attacker.biteFatigued &&
        (absDiff <= 0.34 || attacker.predatorTimer > 0 || attacker.thunderRoeTimer > 0);
      const dmg = isCrit ? baseDmg * 1.25 : baseDmg;
      const dirX = dist > 0.001 ? dx / dist : Math.cos(attacker.biteAimAngle);
      const dirZ = dist > 0.001 ? dz / dist : Math.sin(attacker.biteAimAngle);
      const knockbackDist = isCrit ? 22 : attacker.level >= 40 ? 18 : 13;

      const damageOutcome = this.applyDamage(target, attacker, dmg, 'Bite', {
        isCrit,
        impactDirX: dirX,
        impactDirZ: dirZ,
        knockbackDist,
      });

      if (!target.alive || damageOutcome.mitigatedByEvade) continue;

      // Lv 30: Venom Bite
      if (attacker.level >= 30) {
        target.venomTimer = 3.6;
        target.venomDps = 5.5 + attacker.level * 0.12;
        target.venomSourceId = attacker.id;
      }

      // Lv 40+: Bite Stuns via unified diminishing-returns control state machine; Lv 1-39 brief stagger
      if (attacker.level >= 40) {
        this.applyControlEffect(target, attacker, 'stun', 0.55);
      } else {
        this.applyControlEffect(target, attacker, 'stagger', isCrit ? 0.2 : 0.14);
      }
    }
  }

  /**
   * Authoritative control-effect state machine enforcing stagger, stun, diminishing returns,
   * and temporary stun resistance so repeated CC cannot permanently stun-lock any Keli.
   */
  public applyControlEffect(
    target: KeliEntity,
    source: KeliEntity | null,
    kind: 'stagger' | 'stun',
    baseDuration: number
  ): 'applied' | 'resisted' | 'evaded' {
    if (!target.alive || this.matchConcluded || this.status !== 'playing') return 'resisted';
    if (target.evadeTimer > 0) return 'evaded';

    if (kind === 'stagger') {
      if (target.stunTimer > 0) return 'resisted';
      target.staggerTimer = Math.max(target.staggerTimer, baseDuration);
      if (target.feedingTargetId) {
        this.interruptFeeding(target, source);
      }
      if (target.bitePhase === 'windup') {
        target.bitePhase = 'idle';
        target.bitePhaseTimer = 0;
      }
      return 'applied';
    }

    // Hard stun with temporary immunity & diminishing returns
    if (target.stunResistTimer > 0) {
      if (target.isPlayer || source?.isPlayer) {
        this.spawnCallout(target.x, target.z, 'STUN IMMUNE', '#38bdf8');
        if (source?.isPlayer) this.emitSfxFor(source.id, 'hit_blocked');
        if (target.isPlayer) this.emitSfxFor(target.id, 'hit_blocked');
      }
      return 'resisted';
    }

    if (target.stunStacks >= 2) {
      target.stunResistTimer = STUN_RESIST_DURATION_SEC;
      target.stunStacks = 0;
      target.stunStackDecayTimer = 0;
      if (target.isPlayer || source?.isPlayer) {
        this.spawnCallout(target.x, target.z, 'STUN RESIST!', '#38bdf8');
        if (source?.isPlayer) this.emitSfxFor(source.id, 'hit_blocked');
        if (target.isPlayer) this.emitSfxFor(target.id, 'hit_blocked');
      }
      return 'resisted';
    }

    const drScale = target.stunStacks === 0 ? 1.0 : 0.5;
    const effectiveDuration = Math.max(0.18, baseDuration * drScale);
    target.stunTimer = Math.max(target.stunTimer, effectiveDuration);
    target.staggerTimer = 0;
    target.stunStacks += 1;
    target.stunStackDecayTimer = STUN_STACK_DECAY_SEC;
    target.lastHitKind = 'stun';

    // Interrupt feeding & active bite windup on stun
    if (target.feedingTargetId) {
      this.interruptFeeding(target, source);
    }
    if (target.bitePhase === 'windup') {
      target.bitePhase = 'idle';
      target.bitePhaseTimer = 0;
    }

    this.effects.push({
      id: this.nextId('fx'),
      type: 'stun_burst',
      x: target.x,
      z: target.z,
      angle: 0,
      radius: 38 + this.computeRadius(target.level),
      duration: 0.42,
      elapsed: 0,
      ownerId: source?.id ?? target.id,
      color: '#fbbf24',
    });

    if (target.isPlayer || source?.isPlayer) {
      this.spawnCallout(
        target.x,
        target.z,
        drScale < 1 ? 'STUNNED (50%)' : 'STUNNED',
        '#f59e0b'
      );
      if (source?.isPlayer) {
        this.emitSfxFor(source.id, 'hit_stun');
        this.triggerHitStopFor(source.id, 0.048);
      }
      if (target.isPlayer) {
        this.emitSfxFor(target.id, 'hit_stun');
        this.triggerHitStopFor(target.id, 0.042);
      }
    }
    return 'applied';
  }

  private applyDamage(
    target: KeliEntity,
    attacker: KeliEntity | null,
    amount: number,
    cause: string,
    opts?: {
      isCrit?: boolean;
      impactDirX?: number;
      impactDirZ?: number;
      knockbackDist?: number;
    }
  ): { appliedDamage: number; mitigatedByEvade: boolean; hitKind: HitReactKind } {
    if (!target.alive || this.matchConcluded || this.status !== 'playing') {
      return { appliedDamage: 0, mitigatedByEvade: false, hitKind: 'normal' };
    }

    const mitigatedByEvade = target.evadeTimer > 0;
    let finalAmount = target.aegisTimer > 0 ? amount * 0.65 : amount;
    if (mitigatedByEvade) {
      finalAmount *= 1 - EVADE_DAMAGE_MITIGATION;
    }

    const hitKind: HitReactKind = mitigatedByEvade
      ? 'mitigated'
      : opts?.isCrit
      ? 'crit'
      : 'normal';

    target.hp -= finalAmount;
    target.hitFlashTimer = mitigatedByEvade ? 0.1 : opts?.isCrit ? 0.22 : 0.16;
    target.lastHitKind = hitKind;

    // Directional recoil & arena-safe knockback
    let dirX = opts?.impactDirX ?? 0;
    let dirZ = opts?.impactDirZ ?? 0;
    if (Math.hypot(dirX, dirZ) < 0.001 && attacker && attacker.id !== target.id) {
      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001) {
        dirX = dx / d;
        dirZ = dz / d;
      }
    }
    if (Math.hypot(dirX, dirZ) > 0.001) {
      const recoilPower = mitigatedByEvade ? 0.35 : opts?.isCrit ? 1.0 : 0.72;
      target.recoilDirX = dirX;
      target.recoilDirZ = dirZ;
      target.recoilStrength = recoilPower;
      target.recoilTimer = mitigatedByEvade ? 0.14 : opts?.isCrit ? 0.28 : 0.2;

      const kb = (opts?.knockbackDist ?? 0) * (mitigatedByEvade ? 0.35 : 1.0);
      if (kb > 0.5 && target.hp > 0) {
        const pushed = resolveSweptMovement(
          target.x,
          target.z,
          target.x + dirX * kb,
          target.z + dirZ * kb,
          this.computeRadius(target.level),
          target.level >= 40
        );
        target.x = pushed.x;
        target.z = pushed.z;
        if (pushed.collided || pushed.blockedByShore) {
          projectVelocityAlongCollisionNormal(target, pushed.normalX, pushed.normalZ);
        }
      }
    }

    if (attacker) {
      attacker.damageDealt += finalAmount;
      target.lastAttackerId = attacker.id;
      target.lastAttackerName = attacker.name;
      target.lastDamageCause = cause;
      if (this.mode !== 'tutorial' && attacker.id !== target.id && finalAmount > 0) {
        this.pacingDirector.recordCombatEvent(
          target.x,
          target.z,
          this.matchTime,
          target.veilTimer > 0 || attacker.veilTimer > 0,
          target.id === this.primaryPlayerId || attacker.id === this.primaryPlayerId
        );
      }
    }

    // Impact water splash / crit burst / mitigated guard ring
    this.effects.push({
      id: this.nextId('fx'),
      type: mitigatedByEvade
        ? 'mitigated_ring'
        : opts?.isCrit
        ? 'crit_impact'
        : 'impact_splash',
      x: target.x,
      z: target.z,
      angle: Math.atan2(dirZ, dirX),
      radius: (mitigatedByEvade ? 30 : opts?.isCrit ? 44 : 28) + this.computeRadius(target.level) * 0.5,
      duration: mitigatedByEvade ? 0.3 : opts?.isCrit ? 0.38 : 0.28,
      elapsed: 0,
      ownerId: attacker?.id ?? target.id,
      color: mitigatedByEvade ? '#22d3ee' : opts?.isCrit ? '#fbbf24' : '#e0f2fe',
    });

    if (target.isPlayer || attacker?.isPlayer) {
      const intensity = Math.min(
        1,
        Math.max(
          mitigatedByEvade ? 0.2 : 0.32,
          (finalAmount / Math.max(35, target.maxHp * 0.3)) * (opts?.isCrit ? 1.22 : 1.0)
        )
      );

      if (target.isPlayer && attacker && attacker.id !== target.id) {
        const dx = attacker.x - target.x;
        const dz = attacker.z - target.z;
        const dist = Math.hypot(dx, dz);
        const directionAngle = dist > 0.001 ? Math.atan2(dz, dx) : target.facingAngle + Math.PI;
        const shakeAdd = mitigatedByEvade ? 0.16 : 0.32 + intensity * 0.42;
        const hitEvent: DamageHitEvent = {
          id: this.nextId('hit'),
          attackerId: attacker.id,
          attackerName: attacker.name,
          cause: mitigatedByEvade ? `${cause} (Evaded)` : cause,
          damage: Math.max(1, Math.round(finalAmount)),
          directionAngle,
          intensity,
          timestamp: this.matchTime,
        };
        const impulseX = -Math.cos(directionAngle);
        const impulseZ = -Math.sin(directionAngle);

        const tm = this.playerMetaById.get(target.id);
        if (tm) {
          tm.cameraShake = Math.min(0.95, tm.cameraShake + shakeAdd);
          tm.recentDamageHits = tm.recentDamageHits
            .filter((h) => this.matchTime - h.timestamp < 1.4)
            .slice(-5);
          tm.recentDamageHits.push(hitEvent);
          tm.damageImpulse = {
            x: impulseX,
            z: impulseZ,
            strength: intensity,
            seq: (tm.damageImpulse?.seq ?? 0) + 1,
          };
        }

        if (target.id === this.primaryPlayerId) {
          this.cameraShake = Math.min(0.95, this.cameraShake + shakeAdd);
          this.recentDamageHits = this.recentDamageHits
            .filter((h) => this.matchTime - h.timestamp < 1.4)
            .slice(-5);
          this.recentDamageHits.push(hitEvent);
          this.damageImpulse = {
            x: impulseX,
            z: impulseZ,
            strength: intensity,
            seq: (this.damageImpulse?.seq ?? 0) + 1,
          };
        }

        if (mitigatedByEvade) {
          this.emitSfxFor(target.id, 'hit_blocked');
        } else {
          this.emitSfxFor(target.id, intensity >= 0.65 || opts?.isCrit ? 'damage_hit_heavy' : 'damage_hit');
          if (opts?.isCrit || intensity >= 0.68) {
            this.triggerHitStopFor(target.id, opts?.isCrit ? 0.044 : 0.032);
          }
        }
      } else if (target.isPlayer) {
        const tm = this.playerMetaById.get(target.id);
        if (tm) tm.cameraShake = Math.min(0.6, tm.cameraShake + 0.22);
        if (target.id === this.primaryPlayerId) {
          this.cameraShake = Math.min(0.6, this.cameraShake + 0.22);
        }
      }

      if (attacker?.isPlayer && target.id !== attacker.id) {
        const atkShake = mitigatedByEvade ? 0.08 : opts?.isCrit ? 0.34 : 0.18;
        const am = this.playerMetaById.get(attacker.id);
        if (am) am.cameraShake = Math.min(0.65, am.cameraShake + atkShake);
        if (attacker.id === this.primaryPlayerId) {
          this.cameraShake = Math.min(0.65, this.cameraShake + atkShake);
        }
        if (mitigatedByEvade) {
          this.emitSfxFor(attacker.id, 'hit_blocked');
        } else if (opts?.isCrit) {
          this.emitSfxFor(attacker.id, 'hit_crit');
          this.triggerHitStopFor(attacker.id, 0.046);
        } else {
          this.emitSfxFor(attacker.id, 'hit_confirm');
          this.triggerHitStopFor(attacker.id, 0.03);
        }
      }

      const dmgInt = Math.max(1, Math.round(finalAmount));
      if (mitigatedByEvade) {
        this.spawnCallout(target.x, target.z, `EVADED -${dmgInt}`, '#22d3ee');
      } else if (opts?.isCrit) {
        this.spawnCallout(target.x, target.z, `CRIT -${dmgInt}!`, '#fbbf24');
      } else {
        this.spawnCallout(target.x, target.z, `-${dmgInt}`, '#f87171');
      }
    }

    if (target.hp <= 0) {
      this.handleDeath(
        target,
        attacker,
        attacker ? `${attacker.name} (${cause})` : cause,
        'kill'
      );
    } else if (
      target.feedingTargetId &&
      !mitigatedByEvade &&
      attacker &&
      attacker.id !== target.id &&
      (finalAmount >= FEED_INTERRUPT_DAMAGE_THRESHOLD || finalAmount >= target.maxHp * 0.04)
    ) {
      // Qualifying direct combat damage interrupts active feeding and applies brief recovery
      this.interruptFeeding(target, attacker);
    }

    return { appliedDamage: finalAmount, mitigatedByEvade, hitKind };
  }

  private handleDeath(
    victim: KeliEntity,
    killer: KeliEntity | null,
    causeLabel: string,
    ledgerType: MassLedgerEntry['type']
  ) {
    // Idempotent guard prevents simultaneous-kill duplication or post-victory deaths
    if (!victim.alive || this.matchConcluded || this.status !== 'playing') return;
    victim.alive = false;
    victim.hp = 0;
    victim.feedingTargetId = null;
    victim.feedingProgress = 0;
    victim.feedingWindupDone = false;
    victim.feedingTickTimer = 0;
    victim.feedingSessionFragments = 0;
    victim.feedingCancelHoldTimer = 0;

    // Atomically transfer ALL integer fragments out of the defeated Keli's active inventory
    const droppedMass = Math.max(0, Math.trunc(victim.level));
    victim.level = 0;
    victim.eliminatedAtLevel = droppedMass;

    if (killer && killer.id !== victim.id) {
      killer.kills += 1;
    }

    // Create carcass with exact transferred integer fragments at a guaranteed accessible coordinate
    if (droppedMass > 0) {
      const anyCanGoAshore = this.kelis.some((k) => k.alive && k.level >= 40);
      const accessible = isPositionAccessible(victim.x, victim.z, 16, anyCanGoAshore);
      const safePos = accessible
        ? { x: victim.x, z: victim.z }
        : findNearestAccessiblePosition(
            victim.x,
            victim.z,
            16,
            anyCanGoAshore,
            this.zone.centerX,
            this.zone.centerZ,
            this.zone.currentRadius
          );
      const evolutionPhaseAtDeath: 1 | 2 | 3 =
        droppedMass >= 80 ? 3 : droppedMass >= 40 ? 2 : 1;
      const carc: CarcassEntity = {
        id: this.nextId('carc'),
        x: safePos.x,
        z: safePos.z,
        mass: droppedMass,
        initialMass: droppedMass,
        evolutionPhaseAtDeath,
        sourceId: victim.id,
        sourceName: victim.name,
        createdAt: this.matchTime,
        bobPhase: Math.random() * Math.PI * 2,
        consumed: false,
        relocated: !accessible,
      };
      this.carcasses.push(carc);
    }

    this.recordLedger(
      ledgerType,
      killer ? killer.name : causeLabel,
      victim.name,
      droppedMass
    );
    if (this.mode !== 'tutorial') {
      this.pacingDirector.recordElimination(
        victim.x,
        victim.z,
        droppedMass,
        this.matchTime,
        victim.veilTimer > 0
      );
    }

    // Non-fragment Bounty Claim: grants temporary movement speed + stamina surge,
    // non-fragment leaderboard/bounty points, and combat notification — NEVER extra fragments!
    if (
      this.isMultiplayerMatch &&
      (victim.bountyReward ?? 0) > 0 &&
      killer &&
      killer.id !== victim.id &&
      killer.alive
    ) {
      const bountyPts = Math.trunc(victim.bountyReward!);
      victim.bountyReward = 0;
      killer.bountyPoints = (killer.bountyPoints ?? 0) + bountyPts;
      killer.bountyBoostTimer = Math.max(killer.bountyBoostTimer ?? 0, BOUNTY_SURGE_DURATION_SEC);
      killer.stamina = Math.min(killer.maxStamina, killer.stamina + 40);
      killer.fatigued = false;

      this.spawnCallout(killer.x, killer.z, `BOUNTY +${bountyPts} PTS · SURGE!`, '#fbbf24');
      this.pushBanner(
        'Rival Bounty Claimed!',
        `${killer.name} defeated ${victim.name} (+${bountyPts} Bounty Pts · Speed & Stamina Surge)`
      );
      this.addSoundCue(
        `${killer.name} claimed +${bountyPts} Bounty Pts on ${victim.name}`,
        { x: killer.x, z: killer.z },
        'info'
      );
      this.emitSfxGlobal('bounty_claimed');
    } else {
      victim.bountyReward = 0;
    }

    if (this.humanIds.has(victim.id)) {
      const killedByName = killer ? killer.name : causeLabel;
      const meta = this.playerMetaById.get(victim.id);
      const deathCamData: DeathCamState | null =
        killer && killer.id !== victim.id
          ? {
              active: true,
              killerId: killer.id,
              killerName: killer.name,
              killerLevel: killer.level,
              causeLabel,
              deathX: victim.x,
              deathZ: victim.z,
              remaining: 3.0,
              duration: 3.0,
            }
          : null;

      if (meta) {
        meta.killedBy = killedByName;
        meta.deathCause = causeLabel;
        meta.finalLevel = droppedMass;
        meta.survivalTime = this.matchTime;
        meta.spectateTargetId = killer && killer.alive ? killer.id : null;
        meta.deathCam = deathCamData ? { ...deathCamData } : null;
      }
      if (victim.id === this.primaryPlayerId) {
        this.killedBy = killedByName;
        this.deathCause = causeLabel;
        this.playerFinalLevel = droppedMass;
        this.playerSurvivalTime = this.matchTime;
        this.spectateTargetId = killer && killer.alive ? killer.id : null;
        this.deathCam = deathCamData ? { ...deathCamData } : null;
      }
      this.emitSfxFor(victim.id, 'death');
      this.getSpectateTarget(victim.id);
      this.pushBannerFor(
        victim.id,
        `Eliminated by ${killedByName}`,
        deathCamData
          ? 'Death Cam · Tracking finishing blow before Spectator Mode'
          : 'Spectating live match until Keli King is crowned'
      );
    }

    this.addSoundCue(`${victim.name} slain (${droppedMass} fragments)`, { x: victim.x, z: victim.z }, 'info');
  }

  /**
   * Atomically transfers integer fragments from an unclaimed carcass to a living Keli.
   * Supports both full consumption and partial/incomplete transfers while preventing
   * double-claiming, duplication, or exceeding 100 evolution fragments.
   */
  public transferCarcassFragments(
    eater: KeliEntity,
    carcassId: string,
    maxAmount?: number,
    opts?: { keepChannel?: boolean }
  ): number {
    if (!eater.alive || this.matchConcluded || this.status !== 'playing') return 0;

    const carcassIndex = this.carcasses.findIndex((c) => c.id === carcassId);
    if (carcassIndex === -1) return 0;
    const carc = this.carcasses[carcassIndex];
    if (!carc || carc.consumed || carc.mass <= 0) return 0;

    const available = Math.trunc(carc.mass);
    const capacity = Math.max(0, TOTAL_MATCH_FRAGMENTS - Math.trunc(eater.level));
    const requested =
      maxAmount === undefined ? available : Math.max(0, Math.trunc(maxAmount));
    const transfer = Math.min(available, capacity, requested);
    if (transfer <= 0) return 0;

    // Deduct from carcass BEFORE crediting eater so total never momentarily exceeds 100
    carc.mass = available - transfer;
    const fullyConsumed = carc.mass <= 0;
    const keepChannel = Boolean(opts?.keepChannel) && !fullyConsumed;
    const prevSession = eater.feedingSessionFragments ?? 0;
    const nextSession = prevSession + transfer;

    if (fullyConsumed) {
      carc.mass = 0;
      carc.consumed = true;
      this.carcasses.splice(carcassIndex, 1);
      this.lastFeedAlertTimeByCarcass.delete(carc.id);

      // Immediately cancel every competing Keli's active feed channel on this carcass
      for (const other of this.kelis) {
        if (other.feedingTargetId === carc.id) {
          this.cancelFeeding(other, 'depleted');
        }
      }
    } else if (keepChannel) {
      eater.feedingSessionFragments = nextSession;
    } else {
      this.cancelFeeding(eater, 'voluntary');
    }

    this.grantFragments(eater, transfer, carc.sourceName);

    // Health restore on feed (incremental during progressive ticks + completion bonus on finish)
    const heal = keepChannel
      ? eater.maxHp * (0.018 * transfer)
      : opts?.keepChannel
      ? eater.maxHp * (0.16 + transfer * 0.012)
      : eater.maxHp * (0.3 + transfer * 0.015);
    eater.hp = Math.min(eater.maxHp, eater.hp + heal);

    // Lv.70 Feeding Frenzy
    if (eater.level >= 70) {
      eater.frenzyTimer = 4.5;
    }

    this.recordLedger('feed', eater.name, `${carc.sourceName}'s Remains`, transfer);

    if (carc.sourceId && this.humanIds.has(carc.sourceId)) {
      const deadMeta = this.playerMetaById.get(carc.sourceId);
      if (deadMeta) {
        deadMeta.massTransferredTo = eater.name;
        if (deadMeta.deathCam && deadMeta.deathCam.killerId === eater.id) {
          deadMeta.deathCam.killerLevel = eater.level;
        }
      }
      if (carc.sourceId === this.primaryPlayerId) {
        this.massTransferredTo = eater.name;
        if (this.deathCam && this.deathCam.killerId === eater.id) {
          this.deathCam.killerLevel = eater.level;
        }
      }
    }

    if (eater.isPlayer) {
      if (keepChannel) {
        this.emitSfxFor(eater.id, 'feed_tick');
        this.spawnCallout(
          eater.x,
          eater.z,
          transfer === 1 ? '+1 FRAGMENT' : `+${transfer} FRAGMENTS`,
          '#e6b86e'
        );
      } else {
        this.emitSfxFor(eater.id, 'feed');
        const labelAmount = opts?.keepChannel && nextSession > transfer ? nextSession : transfer;
        this.spawnCallout(
          eater.x,
          eater.z,
          labelAmount === 1 ? '+1 FRAGMENT' : `+${labelAmount} FRAGMENTS`,
          '#fde047'
        );
      }
    }

    if (fullyConsumed && carc.sourceId && carc.sourceId !== eater.id) {
      eater.rivalsConsumed = (eater.rivalsConsumed ?? 0) + 1;
      if (this.isMultiplayerMatch && !this.matchConcluded) {
        const prevReward = eater.bountyReward ?? 0;
        const nextReward = computeBountyReward(eater.rivalsConsumed);
        eater.bountyReward = nextReward;
        if (nextReward > prevReward) {
          const title =
            prevReward === 0
              ? `Rival Bounty: ${eater.name}`
              : `Bounty Escalated: ${eater.name}`;
          const subtitle = `Consumed ${eater.rivalsConsumed} rivals · +${nextReward} Bounty Pts & Surge on defeat · Marked on Minimap`;
          this.pushBanner(title, subtitle);
          this.addSoundCue(
            `${eater.name} marked with a +${nextReward} Rival Bounty`,
            { x: eater.x, z: eater.z },
            'danger'
          );
          this.emitSfxGlobal('bounty_marked');
        }
      }
    }

    // Immediate atomic victory resolution if eater legitimately reached 100 fragments
    if (eater.level === TOTAL_MATCH_FRAGMENTS) {
      this.resolveVictory(eater, carc.sourceName);
    }

    return transfer;
  }

  private completeFeed(eater: KeliEntity, carcassId: string) {
    this.transferCarcassFragments(eater, carcassId);
  }

  private evolutionEventLog: Array<{
    entityId: string;
    kind: EvolutionEventKind;
    form: EvolutionForm;
    level: number;
    time: number;
    seq: number;
  }> = [];

  public getEvolutionEventLog() {
    return this.evolutionEventLog.slice();
  }

  private recordEvolutionEvent(
    entityId: string,
    kind: EvolutionEventKind,
    form: EvolutionForm,
    level: number,
    seq: number
  ) {
    this.evolutionEventLog.push({
      entityId,
      kind,
      form,
      level,
      time: this.matchTime,
      seq,
    });
    if (this.evolutionEventLog.length > 160) {
      this.evolutionEventLog.splice(0, this.evolutionEventLog.length - 160);
    }
  }

  private grantFragments(eater: KeliEntity, amount: number, sourceLabel: string) {
    if (!eater.alive || this.matchConcluded || this.status !== 'playing') return;
    const intAmount = Math.trunc(amount);
    if (intAmount <= 0) return;

    const prevLevel = Math.trunc(eater.level);
    const prevForm = getEvolutionForm(prevLevel);
    const nextLevel = Math.min(TOTAL_MATCH_FRAGMENTS, prevLevel + intAmount);
    if (nextLevel <= prevLevel) return;

    const prevHighestForm = eater.highestFormReached ?? prevForm;
    const prevMask = eater.unlockedMilestoneMask ?? computeInitialMilestoneMask(prevLevel);
    const transition = resolveEvolutionTransition(prevLevel, nextLevel, prevHighestForm, prevMask);

    eater.level = nextLevel;
    eater.highestFormReached = transition.newHighestForm;
    eater.unlockedMilestoneMask = transition.newMilestoneMask;

    const newMax = this.computeMaxHp(eater.level);
    const hpDelta = Math.max(0, newMax - eater.maxHp);
    eater.maxHp = newMax;
    eater.hp = Math.min(eater.maxHp, eater.hp + hpDelta);
    if (this.mode !== 'tutorial') {
      this.pacingDirector.recordEvolutionLevel(eater.level, this.matchTime);
    }

    if (transition.majorFormTriggered) {
      const form = transition.majorFormTriggered;
      const spec = EVOLUTION_FORM_SPECS[form];
      eater.evolutionSeq = (eater.evolutionSeq ?? 0) + 1;
      eater.lastEvolutionForm = form;
      eater.lastEvolutionTime = this.matchTime;
      this.recordEvolutionEvent(
        eater.id,
        transition.kind ?? (form === 4 ? 'form_4' : form === 3 ? 'form_3' : 'form_2'),
        form,
        eater.level,
        eater.evolutionSeq
      );

      // Authoritative world transformation VFX for BOTH players and AI bots (bounded for 100-Keli matches)
      if (this.effects.length < 96) {
        this.effects.push({
          id: this.nextId('fx'),
          type: 'evolution_burst',
          x: eater.x,
          z: eater.z,
          angle: 0,
          radius: form === 4 ? 155 : form === 3 ? 118 : 96,
          duration: form === 4 ? 1.25 : 0.95,
          elapsed: 0,
          ownerId: eater.id,
          color: spec.burstHex,
        });
      }

      if (eater.isPlayer) {
        eater.evoBoostTimer = Math.max(eater.evoBoostTimer, 5.0);
        const sfxKind: ClientSfxEvent['kind'] =
          form === 4
            ? 'evolution_king'
            : form === 3
              ? 'evolution_form_3'
              : 'evolution_form_2';
        this.emitSfxFor(eater.id, sfxKind);
        if (form < 4) {
          this.pushBannerFor(eater.id, spec.bannerTitle, spec.bannerSubtitle);
        }
      }
    } else if (transition.unlockedMilestones.length > 0) {
      const latest = transition.unlockedMilestones[transition.unlockedMilestones.length - 1];
      this.recordEvolutionEvent(
        eater.id,
        'ability_unlock',
        transition.newHighestForm,
        eater.level,
        eater.evolutionSeq ?? 0
      );
      if (this.effects.length < 72) {
        this.effects.push({
          id: this.nextId('fx'),
          type: 'level_pulse',
          x: eater.x,
          z: eater.z,
          angle: 0,
          radius: 58,
          duration: 0.45,
          elapsed: 0,
          ownerId: eater.id,
          color: '#7dd3fc',
        });
      }
      if (eater.isPlayer) {
        const names = transition.unlockedMilestones
          .map((u) => `Lv.${u.level} ${u.title}`)
          .join(' · ');
        this.pushBannerFor(eater.id, `Evolution Unlocked: ${latest.title}`, names);
        this.emitSfxFor(eater.id, 'ability_unlock');
      }
    } else if (transition.minorLevelsGained > 0) {
      const prevMinor = eater.lastMinorLevelTime ?? -10;
      eater.lastMinorLevelTime = this.matchTime;
      if (eater.isPlayer) {
        if (this.matchTime - prevMinor >= 0.14) {
          this.emitSfxFor(eater.id, 'level_up_minor');
        }
        if (this.effects.length < 72) {
          this.effects.push({
            id: this.nextId('fx'),
            type: 'level_pulse',
            x: eater.x,
            z: eater.z,
            angle: 0,
            radius: 36 + eater.level * 0.28,
            duration: 0.32,
            elapsed: 0,
            ownerId: eater.id,
            color: '#bae6fd',
          });
        }
      } else if (this.effects.length < 40 && this.matchTime - prevMinor >= 0.35) {
        this.effects.push({
          id: this.nextId('fx'),
          type: 'level_pulse',
          x: eater.x,
          z: eater.z,
          angle: 0,
          radius: 32,
          duration: 0.28,
          elapsed: 0,
          ownerId: eater.id,
          color: '#bae6fd',
        });
      }
    }

    if (eater.level >= TOTAL_MATCH_FRAGMENTS) {
      this.resolveVictory(eater, sourceLabel);
    }
  }

  private tryEvade(k: KeliEntity): boolean {
    if (
      !k.alive ||
      this.status !== 'playing' ||
      this.matchConcluded ||
      k.cooldowns.evade > 0 ||
      k.evadeTimer > 0 ||
      k.stunTimer > 0 ||
      k.staggerTimer > 0
    ) {
      return false;
    }

    if (k.stamina < EVADE_STAMINA_COST) {
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'LOW STAMINA', '#f59e0b');
        this.emitSfxFor(k.id, 'hit_blocked');
      }
      return false;
    }

    k.stamina = Math.max(0, k.stamina - EVADE_STAMINA_COST);
    k.staminaRegenDelay = Math.max(k.staminaRegenDelay, STAMINA_REGEN_DELAY_SEC);
    if (k.stamina <= 15) k.fatigued = true;
    k.cooldowns.evade = EVADE_COOLDOWN_SEC;
    k.evadeTimer = EVADE_DURATION_SEC;

    // Cancel feeding cleanly (zero recovery penalty) or bite windup so the player can reactively dodge
    this.cancelFeeding(k, 'ability');
    if (k.bitePhase === 'windup') {
      k.bitePhase = 'idle';
      k.bitePhaseTimer = 0;
    }

    // Evade direction: active movement vector -> sidestep from nearest winding-up attacker -> facing direction
    const input = k.isPlayer ? this.inputsById.get(k.id) : undefined;
    let dirX = 0;
    let dirZ = 0;
    if (input && Math.hypot(input.moveX, input.moveZ) > 0.1) {
      const mLen = Math.hypot(input.moveX, input.moveZ);
      dirX = input.moveX / mLen;
      dirZ = input.moveZ / mLen;
    } else if (!k.isPlayer && Math.hypot(k.vx, k.vz) > 12) {
      const vLen = Math.hypot(k.vx, k.vz);
      dirX = k.vx / vLen;
      dirZ = k.vz / vLen;
    } else {
      const ang = k.facingAngle;
      dirX = Math.cos(ang);
      dirZ = Math.sin(ang);
    }

    k.evadeDirX = dirX;
    k.evadeDirZ = dirZ;

    this.effects.push({
      id: this.nextId('fx'),
      type: 'evade_wake',
      x: k.x,
      z: k.z,
      angle: Math.atan2(dirZ, dirX),
      radius: 36 + this.computeRadius(k.level) * 0.4,
      duration: 0.34,
      elapsed: 0,
      ownerId: k.id,
      color: '#22d3ee',
    });

    if (k.isPlayer) {
      this.emitSfxFor(k.id, 'evade');
    }
    return true;
  }

  private tryDash(k: KeliEntity) {
    if (
      !k.alive ||
      this.status !== 'playing' ||
      this.matchConcluded ||
      k.level < 10 ||
      k.cooldowns.dash > 0 ||
      k.dashTimer > 0 ||
      k.stunTimer > 0 ||
      k.staggerTimer > 0 ||
      k.evadeTimer > 0
    ) {
      return;
    }
    if (k.stamina < DASH_STAMINA_COST) {
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'LOW STAMINA', '#f59e0b');
        this.emitSfxFor(k.id, 'hit_blocked');
      }
      return;
    }
    k.cooldowns.dash = 3.5;
    k.dashTimer = k.fatigued ? 0.17 : 0.24;
    k.stamina = Math.max(0, k.stamina - DASH_STAMINA_COST);
    k.staminaRegenDelay = Math.max(k.staminaRegenDelay, STAMINA_REGEN_DELAY_SEC);
    if (k.stamina <= 15) k.fatigued = true;

    const input = k.isPlayer ? this.inputsById.get(k.id) : undefined;
    let angle = k.facingAngle;
    if (input && Math.hypot(input.moveX, input.moveZ) > 0.1) {
      angle = Math.atan2(input.moveZ, input.moveX);
    }
    k.dashDirX = Math.cos(angle);
    k.dashDirZ = Math.sin(angle);
    this.cancelFeeding(k, 'ability');

    this.effects.push({
      id: this.nextId('fx'),
      type: 'dash_wake',
      x: k.x,
      z: k.z,
      angle: angle,
      radius: 40,
      duration: 0.35,
      elapsed: 0,
      ownerId: k.id,
      color: '#5eead4',
    });

    if (k.isPlayer) this.emitSfxFor(k.id, 'dash');
  }

  private trySonar(k: KeliEntity) {
    if (k.level < 20 || k.cooldowns.sonar > 0 || k.stunTimer > 0) return;
    const isHunter = k.level >= 80;
    const effectiveEchoRadius = Math.round(ECHO_SONAR_RADIUS * this.weather.visibilityRange);
    // Lv.20 Echo Sonar: 4.2s, 12s CD; Lv.80 Hunter Sonar: 7s, 16s CD
    k.sonarIsHunter = isHunter;
    k.sonarTimer = isHunter ? 7.0 : 4.2;
    k.cooldowns.sonar = isHunter ? 16.0 : 12.0;

    this.effects.push({
      id: this.nextId('fx'),
      type: 'sonar_ring',
      x: k.x,
      z: k.z,
      angle: 0,
      radius: isHunter ? scaleArenaDist(900) : effectiveEchoRadius,
      duration: 1.1,
      elapsed: 0,
      ownerId: k.id,
      color: isHunter ? '#fbbf24' : '#2dd4bf',
    });

    if (k.isPlayer) {
      this.emitSfxFor(k.id, isHunter ? 'hunter_sonar' : 'sonar');
      this.spawnCallout(
        k.x,
        k.z,
        isHunter ? 'HUNTER SONAR (GLOBAL)' : `ECHO SONAR (${effectiveEchoRadius}u)`,
        isHunter ? '#fbbf24' : '#2dd4bf'
      );
    }
    this.addSoundCue(`${k.name} pulsed sonar nearby`, { x: k.x, z: k.z }, 'info');
  }

  private tryVeil(k: KeliEntity) {
    if (k.level < 50 || k.cooldowns.veil > 0 || k.stunTimer > 0) return;
    if (k.stamina < VEIL_STAMINA_COST) {
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'LOW STAMINA', '#f59e0b');
        this.emitSfxFor(k.id, 'hit_blocked');
      }
      return;
    }
    k.stamina = Math.max(0, k.stamina - VEIL_STAMINA_COST);
    k.staminaRegenDelay = Math.max(k.staminaRegenDelay, 0.45);
    k.cooldowns.veil = 10.0;
    k.veilTimer = 4.0;
    this.cancelFeeding(k, 'ability');

    this.effects.push({
      id: this.nextId('fx'),
      type: 'veil_cloud',
      x: k.x,
      z: k.z,
      angle: 0,
      radius: 110,
      duration: 4.0,
      elapsed: 0,
      ownerId: k.id,
      color: '#1b2624',
    });

    if (k.isPlayer) this.emitSfxFor(k.id, 'veil');
  }

  private tryElectroshock(k: KeliEntity) {
    if (k.level < 60 || k.cooldowns.electroshock > 0 || k.stunTimer > 0) return;
    if (k.stamina < ELECTROSHOCK_STAMINA_COST) {
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'LOW STAMINA', '#f59e0b');
        this.emitSfxFor(k.id, 'hit_blocked');
      }
      return;
    }
    k.stamina = Math.max(0, k.stamina - ELECTROSHOCK_STAMINA_COST);
    k.staminaRegenDelay = Math.max(k.staminaRegenDelay, 0.45);
    k.cooldowns.electroshock = 11.0;
    this.cancelFeeding(k, 'ability');
    const radius = 155;
    const dmg = (26 + k.level * 0.65) * (k.predatorTimer > 0 ? 1.38 : 1.0);

    this.effects.push({
      id: this.nextId('fx'),
      type: 'electroshock',
      x: k.x,
      z: k.z,
      angle: 0,
      radius,
      duration: 0.48,
      elapsed: 0,
      ownerId: k.id,
      color: '#67e8f9',
    });

    for (const target of this.kelis) {
      if (!target.alive || target.id === k.id) continue;
      const dx = target.x - k.x;
      const dz = target.z - k.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= radius + this.computeRadius(target.level)) {
        const dirX = dist > 0.001 ? dx / dist : Math.cos(k.facingAngle);
        const dirZ = dist > 0.001 ? dz / dist : Math.sin(k.facingAngle);
        const res = this.applyDamage(target, k, dmg, 'Electroshock', {
          impactDirX: dirX,
          impactDirZ: dirZ,
          knockbackDist: 16,
        });
        if (target.alive && !res.mitigatedByEvade) {
          this.applyControlEffect(target, k, 'stun', 0.9);
        }
      }
    }

    if (k.isPlayer) {
      this.emitSfxFor(k.id, 'electroshock');
      const km = this.playerMetaById.get(k.id);
      if (km) km.cameraShake = Math.min(0.7, km.cameraShake + 0.3);
      if (k.id === this.primaryPlayerId) {
        this.cameraShake = Math.min(0.7, this.cameraShake + 0.3);
      }
    }
    this.addSoundCue('Electroshock crackled nearby', { x: k.x, z: k.z }, 'warning');
  }

  private tryMaelstrom(k: KeliEntity) {
    if (k.level < 90 || k.cooldowns.maelstrom > 0 || k.stunTimer > 0) return;
    if (k.stamina < MAELSTROM_STAMINA_COST) {
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'LOW STAMINA', '#f59e0b');
        this.emitSfxFor(k.id, 'hit_blocked');
      }
      return;
    }
    k.stamina = Math.max(0, k.stamina - MAELSTROM_STAMINA_COST);
    k.staminaRegenDelay = Math.max(k.staminaRegenDelay, 0.45);
    k.cooldowns.maelstrom = 14.0;
    this.cancelFeeding(k, 'ability');

    this.effects.push({
      id: this.nextId('fx'),
      type: 'maelstrom',
      x: k.x,
      z: k.z,
      angle: 0,
      radius: 265,
      duration: 2.2,
      elapsed: 0,
      ownerId: k.id,
      color: '#38bdf8',
    });

    if (k.isPlayer) {
      this.emitSfxFor(k.id, 'maelstrom');
    }
    this.addSoundCue(`${k.name} unleashed Maelstrom`, { x: k.x, z: k.z }, 'danger');
  }

  private updateAiBrain(bot: KeliEntity, dt: number) {
    // In tutorial early steps, keep far bots passive so player learns safely
    if (this.mode === 'tutorial' && this.tutorial && this.tutorial.step < 2 && bot.id !== 'bot-contested') {
      bot.vx *= 0.9;
      bot.vz *= 0.9;
      return;
    }

    this.aiController.updateBot(bot, dt, this.aiContext);
  }

  /**
   * Detects and manages the FINAL FEAST phase when a single living Keli remains below Lv.100
   * while unclaimed carcasses still hold fragments in the arena.
   */
  private updateFinalFeast(dt: number) {
    if (this.status !== 'playing' || this.matchConcluded) {
      this.finalFeastActive = false;
      return;
    }

    const aliveKelis = this.kelis.filter((k) => k.alive);
    const activeCarcasses = this.carcasses.filter((c) => !c.consumed && c.mass > 0);
    const soleSurvivor = aliveKelis.length === 1 ? aliveKelis[0] : null;
    const shouldBeActive = Boolean(
      soleSurvivor &&
        soleSurvivor.level < TOTAL_MATCH_FRAGMENTS &&
        activeCarcasses.length > 0
    );

    if (!shouldBeActive) {
      this.finalFeastActive = false;
      return;
    }

    const survivor = soleSurvivor!;
    const canGoAshore = survivor.level >= 40;
    const remainingFragments = activeCarcasses.reduce((acc, c) => acc + Math.trunc(c.mass), 0);

    if (!this.finalFeastActive) {
      this.finalFeastActive = true;
      this.finalFeastTriggered = true;

      // Immediately ensure every remaining carcass is reachable by the sole survivor
      let relocatedCount = 0;
      for (const c of activeCarcasses) {
        const outOfZone =
          Math.hypot(c.x - this.zone.centerX, c.z - this.zone.centerZ) >
          Math.max(80, this.zone.currentRadius - 35);
        if (!isPositionAccessible(c.x, c.z, 16, canGoAshore) || outOfZone) {
          const safePos = findNearestAccessiblePosition(
            c.x,
            c.z,
            16,
            canGoAshore,
            this.zone.centerX,
            this.zone.centerZ,
            this.zone.currentRadius
          );
          c.x = safePos.x;
          c.z = safePos.z;
          c.relocated = true;
          relocatedCount += 1;
        }
      }

      const relocNote =
        relocatedCount > 0 ? ' Trapped fragments surfaced into open water.' : '';
      this.pushBanner(
        `FINAL FEAST · ${remainingFragments} Fragments Remain`,
        `Last Keli standing! Follow the golden beacons to claim ${activeCarcasses.length} remaining carcass${activeCarcasses.length > 1 ? 'es' : ''} and reach Lv.100.${relocNote}`
      );
      this.addSoundCue(
        `Final Feast: ${remainingFragments} unclaimed fragments marked on minimap`,
        { x: activeCarcasses[0].x, z: activeCarcasses[0].z },
        'warning'
      );
      this.emitSfxGlobal('sonar');
    }

    // Keep Final Feast short and purposeful: briskly draw distant carcasses along safe water
    // toward the survivor's sector so there is zero tedious arena-wide backtracking.
    for (const c of activeCarcasses) {
      const dx = survivor.x - c.x;
      const dz = survivor.z - c.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 220) {
        const pullSpeed = Math.min(340, 140 + dist * 0.16);
        const stepDist = Math.min(dist - 160, pullSpeed * dt);
        const nx = c.x + (dx / dist) * stepDist;
        const nz = c.z + (dz / dist) * stepDist;
        const resolved = resolveArenaCollision(nx, nz, 14, canGoAshore);
        if (isPositionAccessible(resolved.x, resolved.z, 14, canGoAshore)) {
          c.x = resolved.x;
          c.z = resolved.z;
        } else {
          const safePos = findNearestAccessiblePosition(
            nx,
            nz,
            16,
            canGoAshore,
            survivor.x,
            survivor.z,
            Math.max(320, dist)
          );
          c.x = safePos.x;
          c.z = safePos.z;
          c.relocated = true;
        }
      }
    }
  }

  private updateCarcasses(dt: number) {
    const aliveKelis = this.kelis.filter((k) => k.alive);
    const anyCanGoAshore = aliveKelis.some((k) => k.level >= 40);

    for (const c of this.carcasses) {
      if (c.consumed || c.mass <= 0) continue;
      c.bobPhase += dt * 2.4;

      // Water current drift
      if (getTerrainAt(c.x, c.z) !== 'shore') {
        const cur = getCurrentVectorAt(c.x, c.z);
        c.x += cur.vx * 0.35 * dt;
        c.z += cur.vz * 0.35 * dt;
      }

      // Radioactive zone current pulls out-of-zone carcasses back inside safe zone!
      const dx = c.x - this.zone.centerX;
      const dz = c.z - this.zone.centerZ;
      const dist = Math.hypot(dx, dz);
      if (dist > this.zone.currentRadius - 55 && dist > 1) {
        const zonePull = Math.round(95 * ARENA_SCALE) * dt;
        c.x -= (dx / dist) * zonePull;
        c.z -= (dz / dist) * zonePull;
      }

      // Keep clear of solid rock interiors and inaccessible shoreline (when no survivor is Lv.40+)
      const res = resolveArenaCollision(c.x, c.z, 12, anyCanGoAshore);
      c.x = res.x;
      c.z = res.z;

      // Recover any carcass still trapped on shore/cliff/obstacle
      if (!isPositionAccessible(c.x, c.z, 14, anyCanGoAshore)) {
        const recovered = findNearestAccessiblePosition(
          c.x,
          c.z,
          16,
          anyCanGoAshore,
          this.zone.centerX,
          this.zone.centerZ,
          this.zone.currentRadius
        );
        c.x = recovered.x;
        c.z = recovered.z;
        c.relocated = true;
      }
    }
  }

  private rollPickupKind(): PickupKind {
    const r = Math.random();
    if (r < 0.44) return 'kelp_salve';
    if (r < 0.64) return 'amphetide';
    if (r < 0.84) return 'fang_charge';
    return 'carapace_ward';
  }

  private rollRainFedPickupKind(): PickupKind {
    const r = Math.random();
    if (r < 0.36) return 'monsoon_dew';
    if (r < 0.7) return 'storm_fin';
    return 'thunder_roe';
  }

  private spawnRainFedPickup(explicitKind?: PickupKind) {
    const pos = findPickupSpawn(
      this.zone.centerX,
      this.zone.centerZ,
      this.zone.currentRadius,
      this.pickups,
      165,
      true
    );
    const kind = explicitKind ?? this.rollRainFedPickupKind();
    this.pickups.push({
      id: this.nextId('pk'),
      kind,
      x: pos.x,
      z: pos.z,
      createdAt: this.matchTime,
      bobPhase: Math.random() * Math.PI * 2,
      rainFed: true,
    });
  }

  private spawnRandomPickup(avoidTutorialStart = false) {
    const spawnRainFed =
      !avoidTutorialStart && this.weather.kind === 'light_rain' && Math.random() < 0.68;
    let pos = findPickupSpawn(
      this.zone.centerX,
      this.zone.centerZ,
      this.zone.currentRadius,
      this.pickups,
      180,
      spawnRainFed
    );
    if (avoidTutorialStart) {
      for (let i = 0; i < 6; i++) {
        if (Math.hypot(pos.x - LANDMARKS.tutorialStart.x, pos.z - LANDMARKS.tutorialStart.z) >= 220) {
          break;
        }
        pos = findPickupSpawn(
          this.zone.centerX,
          this.zone.centerZ,
          this.zone.currentRadius,
          this.pickups
        );
      }
    }
    const kind = spawnRainFed ? this.rollRainFedPickupKind() : this.rollPickupKind();
    this.pickups.push({
      id: this.nextId('pk'),
      kind,
      x: pos.x,
      z: pos.z,
      createdAt: this.matchTime,
      bobPhase: Math.random() * Math.PI * 2,
      rainFed: spawnRainFed,
    });
  }

  private applyPickupEffect(k: KeliEntity, pk: PickupItem) {
    let ringColor = '#4ade80';
    const rainFed = isRainFedPickup(pk.kind);

    if (pk.kind === 'kelp_salve') {
      const heal = Math.round(k.maxHp * 0.35);
      k.hp = Math.min(k.maxHp, k.hp + heal);
      k.stamina = Math.min(k.maxStamina, k.stamina + 40);
      if (k.stamina >= 32) k.fatigued = false;
      k.venomTimer = 0;
      ringColor = '#4ade80';
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, `+${heal} HP · KELP SALVE`, '#4ade80');
      }
    } else if (pk.kind === 'amphetide') {
      k.surgeTimer = 6.5;
      k.stamina = k.maxStamina;
      k.fatigued = false;
      ringColor = '#38bdf8';
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'SURGE PEARL · +28% SPD', '#38bdf8');
      }
    } else if (pk.kind === 'fang_charge') {
      k.predatorTimer = 7.0;
      k.cooldowns.evade = Math.max(0, k.cooldowns.evade - 0.8);
      k.cooldowns.dash = Math.max(0, k.cooldowns.dash - 1.5);
      k.cooldowns.sonar = Math.max(0, k.cooldowns.sonar - 1.5);
      k.cooldowns.veil = Math.max(0, k.cooldowns.veil - 1.5);
      k.cooldowns.electroshock = Math.max(0, k.cooldowns.electroshock - 1.5);
      k.cooldowns.maelstrom = Math.max(0, k.cooldowns.maelstrom - 1.5);
      ringColor = '#fb7185';
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'FANG CORE · +38% DMG', '#fb7185');
      }
    } else if (pk.kind === 'carapace_ward') {
      k.aegisTimer = 8.0;
      k.shoreReserve = k.maxShoreReserve;
      ringColor = '#fbbf24';
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'AEGIS WARD · -35% DMG TAKEN', '#fbbf24');
      }
    } else if (pk.kind === 'monsoon_dew') {
      const heal = Math.round(k.maxHp * 0.25);
      k.hp = Math.min(k.maxHp, k.hp + heal);
      k.stamina = Math.min(k.maxStamina, k.stamina + 60);
      k.fatigued = false;
      k.venomTimer = 0;
      k.shoreReserve = k.maxShoreReserve;
      k.dewTimer = 7.0;
      ringColor = '#2dd4bf';
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, `MONSOON DEW · +${heal} HP & REGEN`, '#2dd4bf');
      }
    } else if (pk.kind === 'storm_fin') {
      k.stormFinTimer = 8.0;
      k.stamina = k.maxStamina;
      k.fatigued = false;
      ringColor = '#60a5fa';
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'STORMFIN · +22% SPD & CD HASTE', '#60a5fa');
      }
    } else {
      // thunder_roe: empowers bites + reach, resets dash, and discharges a revealing static ripple
      k.thunderRoeTimer = 8.0;
      k.cooldowns.dash = 0;
      ringColor = '#c084fc';
      for (const other of this.kelis) {
        if (!other.alive || other.id === k.id) continue;
        if (Math.hypot(other.x - k.x, other.z - k.z) <= 130) {
          other.veilTimer = 0;
        }
      }
      if (k.isPlayer) {
        this.spawnCallout(k.x, k.z, 'THUNDER ROE · +32% BITE & REACH', '#c084fc');
      }
    }

    if (k.isPlayer) {
      this.emitSfxFor(
        k.id,
        rainFed ? 'pickup_rainfed' : pk.kind === 'kelp_salve' ? 'pickup_heal' : 'pickup_buff'
      );
    }

    this.effects.push({
      id: this.nextId('fx'),
      type: 'sonar_ring',
      x: k.x,
      z: k.z,
      angle: 0,
      radius: pk.kind === 'thunder_roe' ? 130 : 52,
      duration: 0.44,
      elapsed: 0,
      ownerId: k.id,
      color: ringColor,
    });
  }

  private updatePickups(dt: number) {
    const isRaining = this.weather.kind === 'light_rain';
    const maxPickups = this.mode === 'tutorial' ? 10 : isRaining ? 30 : 24;
    this.pickupSpawnTimer -= dt;
    if (this.pickupSpawnTimer <= 0) {
      this.pickupSpawnTimer = isRaining ? 2.2 : 3.8;
      if (this.pickups.length < maxPickups) {
        this.spawnRandomPickup();
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.bobPhase += dt * 3.1;

      const outOfZone =
        Math.hypot(pk.x - this.zone.centerX, pk.z - this.zone.centerZ) >
        Math.max(40, this.zone.currentRadius - 25);
      if (this.matchTime - pk.createdAt >= 75 || outOfZone) {
        this.pickups.splice(i, 1);
        continue;
      }

      for (let j = 0; j < this.kelis.length; j++) {
        const k = this.kelis[j];
        if (!k.alive) continue;
        const collectRadius = this.computeRadius(k.level) + 24;
        if (Math.hypot(k.x - pk.x, k.z - pk.z) <= collectRadius) {
          this.applyPickupEffect(k, pk);
          this.pickups.splice(i, 1);
          break;
        }
      }
    }
  }

  private updateEffects(dt: number) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.elapsed += dt;

      // Active Maelstrom vortex pulls nearby rivals & carcasses inward (with collision safety)!
      if (fx.type === 'maelstrom' && fx.elapsed < fx.duration) {
        const anyCanGoAshore = this.kelis.some((e) => e.alive && e.level >= 40);
        for (const k of this.kelis) {
          if (!k.alive || k.id === fx.ownerId) continue;
          const dx = fx.x - k.x;
          const dz = fx.z - k.z;
          const d = Math.hypot(dx, dz);
          if (d < fx.radius && d > 22) {
            const pull = 175 * dt;
            const resolved = resolveSweptMovement(
              k.x,
              k.z,
              k.x + (dx / d) * pull,
              k.z + (dz / d) * pull,
              this.computeRadius(k.level),
              k.level >= 40
            );
            k.x = resolved.x;
            k.z = resolved.z;
          }
        }
        for (const c of this.carcasses) {
          if (c.consumed || c.mass <= 0) continue;
          const dx = fx.x - c.x;
          const dz = fx.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d < fx.radius && d > 18) {
            const pull = 210 * dt;
            const resolved = resolveSweptMovement(
              c.x,
              c.z,
              c.x + (dx / d) * pull,
              c.z + (dz / d) * pull,
              12,
              anyCanGoAshore
            );
            c.x = resolved.x;
            c.z = resolved.z;
          }
        }
      }

      if (fx.elapsed >= fx.duration) {
        this.effects.splice(i, 1);
      }
    }

    for (let i = this.callouts.length - 1; i >= 0; i--) {
      this.callouts[i].elapsed += dt;
      if (this.callouts[i].elapsed >= this.callouts[i].duration) {
        this.callouts.splice(i, 1);
      }
    }
  }

  private spawnCallout(x: number, z: number, text: string, color: string) {
    // Stagger nearby concurrent callouts slightly so rapid damage & status labels remain readable
    let nearbyCount = 0;
    for (const c of this.callouts) {
      if (c.elapsed < 0.35 && Math.hypot(c.x - x, c.z - z) < 38) {
        nearbyCount += 1;
      }
    }
    const offsetAngle = (nearbyCount * 2.15) % (Math.PI * 2);
    const offsetRadius = nearbyCount > 0 ? Math.min(28, 12 + nearbyCount * 7) : 0;
    this.callouts.push({
      id: this.nextId('txt'),
      x: x + Math.cos(offsetAngle) * offsetRadius,
      z: z + Math.sin(offsetAngle) * offsetRadius,
      text,
      color,
      elapsed: 0,
      duration: 1.05,
    });
    if (this.callouts.length > 28) {
      this.callouts.shift();
    }
  }

  private updateTutorialProgress() {
    if (!this.tutorial) return;
    const p = this.getPlayer();

    if (this.tutorial.step === 0) {
      if (this.tutorial.movedDistance > 90 && this.tutorial.bittenOnce) {
        this.tutorial.step = 1;
        this.pushBanner(
          'Step 2 · Safe Feeding',
          'Swim to the nearby carcass and hold Click or Space to consume its fragments.'
        );
      }
    } else if (this.tutorial.step === 1) {
      if (p.level >= 15) {
        this.tutorial.safeFed = true;
        this.tutorial.step = 2;
        this.pushBanner(
          'Step 3 · Contested Carcass',
          'A rival guards the 15-fragment carcass ahead. Use Shift (Dash) & Bite to claim it!'
        );
      }
    } else if (this.tutorial.step === 2) {
      const rival = this.kelis.find((k) => k.id === 'bot-contested');
      if ((!rival || !rival.alive) && p.level >= 25) {
        this.tutorial.contestedCleared = true;
        this.tutorial.step = 3;
        this.pushBanner(
          'Step 4 · Shore Excursion (Lv.40)',
          'Reach Lv.40 (or use "Skip to Lv.40 Lesson") and haul onto Tebing Kering shore!'
        );
      }
    } else if (this.tutorial.step === 3) {
      if (p.isOnShore && p.level >= 40) {
        this.tutorial.shoreVisited = true;
        this.tutorial.step = 4;
        this.pushBanner(
          'Training Complete · Reunite All 100',
          'Watch your 10s Shore Reserve. Hunt the remaining rivals to become Keli King!'
        );
      }
    }
  }

  /**
   * Authoritative, single-fire victory resolution.
   * Victory is strictly awarded when one living Keli legitimately owns all 100 fragments.
   */
  private resolveVictory(king: KeliEntity, sourceLabel?: string) {
    if (this.matchConcluded || this.status !== 'playing') return;
    if (!king.alive || Math.trunc(king.level) !== TOTAL_MATCH_FRAGMENTS) return;

    this.matchConcluded = true;
    this.victoryRecordCount += 1;
    this.finalFeastActive = false;
    this.winnerId = king.id;
    this.winnerName = king.name;
    this.status = king.id === this.primaryPlayerId ? 'victory' : 'defeat';
    this.pacingDirector.recordConclusion('level_100_king', this.matchTime);
    for (const k of this.kelis) {
      if (k.feedingTargetId) this.cancelFeeding(k, 'depleted');
      // Halt all locomotion & active bursts cleanly so the Keli King and survivors never drift post-victory
      k.vx = 0;
      k.vz = 0;
      k.dashTimer = 0;
      k.evadeTimer = 0;
    }

    const subtitle = sourceLabel
      ? `Reunited all 100 fragments from ${sourceLabel}`
      : 'Reunited all 100 evolution fragments in Wang Kelian';
    this.pushBanner(`${king.name} became the Keli King!`, subtitle);
    this.emitSfxGlobal('whistle');

    for (const [pid, meta] of this.playerMetaById.entries()) {
      const entity = this.getPlayer(pid);
      if (pid === king.id) {
        meta.finalLevel = TOTAL_MATCH_FRAGMENTS;
        meta.survivalTime = this.matchTime;
      } else {
        meta.spectateTargetId = king.id;
        if (!meta.killedBy) {
          meta.killedBy = king.name;
          meta.deathCause = `${king.name} reunited all 100 fragments first`;
          meta.finalLevel = entity.alive
            ? Math.trunc(entity.level)
            : (entity.eliminatedAtLevel ?? meta.finalLevel);
          meta.survivalTime = this.matchTime;
        }
      }
    }

    if (king.id === this.primaryPlayerId) {
      this.playerFinalLevel = TOTAL_MATCH_FRAGMENTS;
      this.playerSurvivalTime = this.matchTime;
    } else {
      this.spectateTargetId = king.id;
      if (!this.killedBy) {
        this.killedBy = king.name;
        this.deathCause = `${king.name} reunited all 100 fragments first`;
        const primary = this.getPlayer();
        this.playerFinalLevel = primary.alive
          ? Math.trunc(primary.level)
          : (primary.eliminatedAtLevel ?? this.playerFinalLevel);
        this.playerSurvivalTime = this.matchTime;
      }
    }
  }

  private evaluateMatchOutcome() {
    if (this.matchConcluded || this.status !== 'playing') return;

    const aliveKelis = this.kelis.filter((k) => k.alive);

    // Victory ONLY occurs when a living Keli legitimately owns all 100 fragments
    const king = aliveKelis.find((k) => Math.trunc(k.level) === TOTAL_MATCH_FRAGMENTS);
    if (king) {
      this.resolveVictory(king);
      return;
    }

    // Special Case: If only 1 Keli remains with < 100 fragments and unclaimed carcasses exist,
    // NEVER award immediate victory — keep Final Feast active until all 100 fragments are reunited!
    if (aliveKelis.length === 1 && aliveKelis[0].level < TOTAL_MATCH_FRAGMENTS) {
      return;
    }

    if (aliveKelis.length === 0) {
      this.matchConcluded = true;
      this.finalFeastActive = false;
      this.status = 'draw';
      this.pacingDirector.recordConclusion('draw_mutual_elimination', this.matchTime);
      for (const k of this.kelis) {
        if (k.feedingTargetId) this.cancelFeeding(k, 'depleted');
      }
      for (const [pid, meta] of this.playerMetaById.entries()) {
        const entity = this.getPlayer(pid);
        if (entity.alive || meta.survivalTime === 0) {
          meta.finalLevel = entity.alive
            ? Math.trunc(entity.level)
            : (entity.eliminatedAtLevel ?? meta.finalLevel);
          meta.survivalTime = this.matchTime;
        }
      }
      if (this.getPlayer().alive || this.playerSurvivalTime === 0) {
        const primary = this.getPlayer();
        this.playerFinalLevel = primary.alive
          ? Math.trunc(primary.level)
          : (primary.eliminatedAtLevel ?? this.playerFinalLevel);
        this.playerSurvivalTime = this.matchTime;
      }
    }
  }

  public getMatchPhase(): MatchPhase {
    return this.pacingDirector.getPhase();
  }

  public getActivityHotspots(): ActivityHotspot[] {
    return this.pacingDirector.getActiveHotspots(this.matchTime);
  }

  public getPacingMetrics(): MatchPacingMetrics {
    return this.pacingDirector.getMetrics();
  }

  public getHudSnapshot(playerId = this.primaryPlayerId): HudSnapshot {
    const p = this.getPlayer(playerId);
    const meta = this.playerMetaById.get(playerId);
    const aliveKelis = this.kelis.filter((k) => k.alive);
    const { living, carcass } = this.getMassSums();

    let topLeader = aliveKelis[0] ?? p;
    for (const k of aliveKelis) {
      if (k.level > topLeader.level) topLeader = k;
    }

    const spectateTarget = !p.alive ? this.getSpectateTarget(playerId) : null;
    const focus = p.alive ? p : spectateTarget ?? p;

    // Sonar contacts (around player if alive, or spectated Keli if spectating)
    const sonarContacts: SonarContact[] = [];
    const effectiveEchoRadius = ECHO_SONAR_RADIUS * this.weather.visibilityRange;
    if (focus.alive && focus.sonarTimer > 0) {
      for (const other of aliveKelis) {
        if (other.id === focus.id) continue;
        const dist = Math.hypot(other.x - focus.x, other.z - focus.z);
        if (focus.sonarIsHunter) {
          // Hunter Sonar (Lv.80+): global scan of STRICTLY lower-level living Kelis (including on land!)
          if (other.level < focus.level) {
            sonarContacts.push({
              id: other.id,
              kind: 'prey',
              x: other.x,
              z: other.z,
              level: other.level,
              name: other.name,
              isOnShore: other.isOnShore,
            });
          }
        } else {
          // Echo Sonar (Lv.20-79): local scan scaled by weather visibility
          if (dist <= effectiveEchoRadius) {
            sonarContacts.push({
              id: other.id,
              kind: other.level > focus.level ? 'danger' : 'prey',
              x: other.x,
              z: other.z,
              level: other.level,
              name: other.name,
              isOnShore: other.isOnShore,
            });
          }
        }
      }

      for (const c of this.carcasses) {
        const dist = Math.hypot(c.x - focus.x, c.z - focus.z);
        if (dist <= effectiveEchoRadius) {
          sonarContacts.push({
            id: c.id,
            kind: 'carcass',
            x: c.x,
            z: c.z,
            level: c.mass,
            name: `${c.sourceName} Remains`,
            isOnShore: getTerrainAt(c.x, c.z) === 'shore',
          });
        }
      }
    }

    // Final Feast phase: reveal ALL remaining carcasses on minimap & directional HUD arrows
    const activeCarcasses = this.carcasses.filter((c) => !c.consumed && c.mass > 0);
    let lastRequiredCarcass: { x: number; z: number; mass: number } | null = null;
    let finalFeast: FinalFeastState | null = null;

    if (
      this.finalFeastActive &&
      aliveKelis.length === 1 &&
      aliveKelis[0].level < TOTAL_MATCH_FRAGMENTS &&
      activeCarcasses.length > 0
    ) {
      const markers = activeCarcasses
        .map((c) => {
          const dx = c.x - focus.x;
          const dz = c.z - focus.z;
          return {
            id: c.id,
            x: c.x,
            z: c.z,
            mass: Math.trunc(c.mass),
            distance: Math.round(Math.hypot(dx, dz)),
            angle: Math.atan2(dz, dx),
            sourceName: c.sourceName,
          };
        })
        .sort((a, b) => a.distance - b.distance);

      finalFeast = {
        active: true,
        remainingFragments: markers.reduce((sum, m) => sum + m.mass, 0),
        remainingCarcasses: markers,
      };
      if (markers.length > 0) {
        lastRequiredCarcass = {
          x: markers[0].x,
          z: markers[0].z,
          mass: markers[0].mass,
        };
      }
    }

    // Off-screen indicators for confirmed sonar targets and Final Feast carcasses
    const offscreenIndicators: HudSnapshot['offscreenIndicators'] = [];
    const seenIndicatorIds = new Set<string>();
    if (finalFeast) {
      for (const m of finalFeast.remainingCarcasses) {
        if (m.distance > 180) {
          seenIndicatorIds.add(m.id);
          offscreenIndicators.push({
            id: m.id,
            kind: 'carcass',
            screenAngle: m.angle,
            distance: m.distance,
            level: m.mass,
          });
        }
      }
    }
    for (const contact of sonarContacts) {
      if (seenIndicatorIds.has(contact.id)) continue;
      const dx = contact.x - focus.x;
      const dz = contact.z - focus.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 260) {
        seenIndicatorIds.add(contact.id);
        offscreenIndicators.push({
          id: contact.id,
          kind: contact.kind,
          screenAngle: Math.atan2(dz, dx),
          distance: Math.round(dist),
          level: contact.level,
        });
      }
    }

    // Weather-respecting public activity hotspots (suppressed during Final Feast)
    const maxHotspotVisRange =
      (focus.sonarTimer > 0 ? 2600 : 1950) * this.weather.visibilityRange;
    const activityHotspots: ActivityHotspot[] =
      this.finalFeastActive || this.mode === 'tutorial'
        ? []
        : this.pacingDirector
            .getActiveHotspots(this.matchTime)
            .filter((h) => Math.hypot(h.x - focus.x, h.z - focus.z) <= maxHotspotVisRange)
            .map((h) => ({ ...h }));

    if (!finalFeast && offscreenIndicators.length < 2 && activityHotspots.length > 0) {
      let nearestHs: ActivityHotspot | null = null;
      let nearestHsDist = Infinity;
      for (const hs of activityHotspots) {
        const d = Math.hypot(hs.x - focus.x, hs.z - focus.z);
        if (d > 360 && d < nearestHsDist) {
          nearestHsDist = d;
          nearestHs = hs;
        }
      }
      if (nearestHs && !seenIndicatorIds.has(nearestHs.id)) {
        seenIndicatorIds.add(nearestHs.id);
        offscreenIndicators.push({
          id: nearestHs.id,
          kind: 'hotspot',
          screenAngle: Math.atan2(nearestHs.z - focus.z, nearestHs.x - focus.x),
          distance: Math.round(nearestHsDist),
          level: Math.round(nearestHs.radius),
        });
      }
    }

    const feedingCarcass = focus.feedingTargetId
      ? this.carcasses.find((c) => c.id === focus.feedingTargetId && !c.consumed && c.mass > 0) ?? null
      : null;

    // Count active feeders per carcass for contested-feeding HUD and minimap ambush visibility
    const feedersPerCarcass = new Map<string, number>();
    for (const k of aliveKelis) {
      if (k.feedingTargetId) {
        feedersPerCarcass.set(k.feedingTargetId, (feedersPerCarcass.get(k.feedingTargetId) ?? 0) + 1);
      }
    }
    const feedingCompetitorCount = feedingCarcass
      ? feedersPerCarcass.get(feedingCarcass.id) ?? 1
      : 0;
    const feedingContested = feedingCompetitorCount >= 2;

    const tacticalCarcasses: NonNullable<HudSnapshot['tacticalCarcasses']> = [];
    for (const c of activeCarcasses) {
      if (c.mass < LARGE_CARCASS_THRESHOLD) continue;
      const dist = Math.hypot(c.x - focus.x, c.z - focus.z);
      if (dist <= LARGE_CARCASS_MINIMAP_RANGE) {
        const count = feedersPerCarcass.get(c.id) ?? 0;
        tacticalCarcasses.push({
          id: c.id,
          x: c.x,
          z: c.z,
          mass: Math.trunc(c.mass),
          activelyFed: count > 0,
          contested: count >= 2,
        });
      }
    }

    const zoneMeta = getZoneAt(focus.x, focus.z);
    const inSafeZone =
      Math.hypot(focus.x - this.zone.centerX, focus.z - this.zone.centerZ) <= this.zone.currentRadius;

    const spectatorDots = !p.alive
      ? aliveKelis.map((k) => ({
          id: k.id,
          x: k.x,
          z: k.z,
          level: k.level,
          isTarget: spectateTarget?.id === k.id,
        }))
      : undefined;

    const playerRadius = this.computeRadius(p.level);
    const hasPreyInRange = p.alive && Boolean(this.findClosestPrey(p, 64 + playerRadius + 95));
    let hasCarcassInRange = false;
    let nearbyCarcassMass: number | null = null;
    let nearbyCarcassBlockedReason: 'obstacle' | 'shore' | 'recovering' | null = null;
    if (p.alive) {
      let bestDist = Infinity;
      let bestBlockedDist = Infinity;
      for (const c of activeCarcasses) {
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        const check = this.canFeedOnCarcass(p, c, p.feedingTargetId === c.id);
        if (check.ok && d < bestDist) {
          bestDist = d;
          hasCarcassInRange = true;
          nearbyCarcassMass = Math.trunc(c.mass);
        } else if (
          (check.reason === 'obstacle' || check.reason === 'shore' || check.reason === 'recovering') &&
          d <= this.getFeedRange(p.level) + 12 &&
          d < bestBlockedDist
        ) {
          bestBlockedDist = d;
          nearbyCarcassBlockedReason = check.reason;
        }
      }
    }

    const pForm = getEvolutionForm(p.level);
    const pHazardMod = p.activeHazard ? getHazardModifierForForm(p.activeHazard, pForm) : null;
    const specHazardMod =
      spectateTarget && spectateTarget.activeHazard
        ? getHazardModifierForForm(spectateTarget.activeHazard, getEvolutionForm(spectateTarget.level))
        : null;

    const perPlayerStatus: 'playing' | 'victory' | 'defeat' | 'draw' =
      this.status === 'draw'
        ? 'draw'
        : this.winnerId
        ? this.winnerId === p.id
          ? 'victory'
          : 'defeat'
        : 'playing';

    const cues = meta ? meta.soundCues : this.soundCues;
    const banner = meta ? meta.recentBanner : this.recentBanner;

    return {
      matchTime: this.matchTime,
      mode: this.mode,
      lobbySize: this.lobbySize,
      aliveCount: aliveKelis.length,
      totalEntrants: this.kelis.length,
      livingMassSum: living,
      carcassMassSum: carcass,
      topLeaderLevel: topLeader.level,
      topLeaderName: topLeader.name,
      player: {
        id: p.id,
        name: p.name,
        alive: p.alive,
        level: p.level,
        form: pForm,
        hp: p.hp,
        maxHp: p.maxHp,
        isOnShore: p.isOnShore,
        shoreReserve: p.shoreReserve,
        maxShoreReserve: p.maxShoreReserve,
        stamina: p.stamina,
        maxStamina: p.maxStamina,
        fatigued: p.fatigued,
        activeHazard: pHazardMod
          ? {
              kind: pHazardMod.kind,
              label: pHazardMod.label,
              summary: pHazardMod.summary,
              speedMult: pHazardMod.speedMult,
              staminaRate: pHazardMod.staminaRate,
              color: pHazardMod.color,
            }
          : null,
        zoneName: zoneMeta.name,
        inSafeZone,
        stunned: p.stunTimer > 0,
        staggered: p.staggerTimer > 0,
        stunResistTimeLeft: Math.round(p.stunResistTimer * 100) / 100,
        evading: p.evadeTimer > 0,
        bitePhase: p.bitePhase,
        biteCooldown: Math.round(p.biteCooldown * 100) / 100,
        venomActive: p.venomTimer > 0,
        frenzyActive: p.frenzyTimer > 0,
        surgeTimeLeft: p.surgeTimer,
        predatorTimeLeft: p.predatorTimer,
        aegisTimeLeft: p.aegisTimer,
        dewTimeLeft: p.dewTimer,
        stormFinTimeLeft: p.stormFinTimer,
        thunderRoeTimeLeft: p.thunderRoeTimer,
        evoBoostTimeLeft: Math.round(p.evoBoostTimer * 100) / 100,
        bountyBoostTimeLeft: Math.round((p.bountyBoostTimer ?? 0) * 100) / 100,
        bountyPoints: p.bountyPoints ?? 0,
        veilActive: p.veilTimer > 0,
        sonarActive: focus.sonarTimer > 0,
        sonarIsHunter: focus.sonarIsHunter,
        sonarTimeLeft: focus.sonarTimer,
        feedingProgress: focus.feedingProgress,
        feedingDuration: focus.feedingDuration,
        feedingTargetName: feedingCarcass ? `${feedingCarcass.sourceName} (+${feedingCarcass.mass})` : null,
        feedingTargetMass: feedingCarcass ? Math.trunc(feedingCarcass.mass) : 0,
        feedingWindupDone: Boolean(focus.feedingWindupDone),
        feedingSessionFragments: focus.feedingSessionFragments ?? 0,
        feedingContested,
        feedingCompetitorCount,
        feedingRecoveryTimeLeft: Math.round((p.feedingRecoveryTimer ?? 0) * 100) / 100,
        cooldowns: { ...p.cooldowns },
        kills: p.kills,
        hasPreyInRange,
        hasCarcassInRange,
        nearbyCarcassMass,
        nearbyCarcassBlockedReason,
        x: focus.x,
        z: focus.z,
        facingAngle: focus.facingAngle,
      },
      zone: { ...this.zone },
      weather: { ...this.weather },
      matchPhase: this.pacingDirector.getPhase(),
      fragmentsToKing: Math.max(0, TOTAL_MATCH_FRAGMENTS - Math.trunc(p.level)),
      nextMilestoneLevel:
        p.level >= TOTAL_MATCH_FRAGMENTS
          ? null
          : EVOLUTION_MILESTONES.find((m) => m.level > p.level)?.level ?? TOTAL_MATCH_FRAGMENTS,
      evolutionProgress: getEvolutionProgressInfo(
        p.level,
        p.evolutionSeq ?? 0,
        p.lastEvolutionForm ?? getEvolutionForm(p.level)
      ),
      activityHotspots,
      sonarContacts,
      tacticalCarcasses,
      pickups: this.pickups.map((pk) => ({
        id: pk.id,
        kind: pk.kind,
        x: pk.x,
        z: pk.z,
        rainFed: pk.rainFed,
      })),
      lastRequiredCarcass,
      finalFeast,
      offscreenIndicators: offscreenIndicators.slice(0, 8),
      recentBanner: banner ? { ...banner } : null,
      soundCues: cues.filter((c) => this.matchTime - c.timestamp < 4.5),
      tutorial: this.tutorial ? { ...this.tutorial } : null,
      spectating: !p.alive
        ? {
            active: true,
            targetId: spectateTarget?.id ?? null,
            targetName: spectateTarget?.name ?? null,
            targetLevel: spectateTarget?.level ?? 0,
            targetKills: spectateTarget?.kills ?? 0,
            targetHp: spectateTarget?.hp ?? 0,
            targetMaxHp: spectateTarget?.maxHp ?? 1,
            targetForm: getEvolutionForm(spectateTarget?.level ?? 1),
            targetStamina: spectateTarget?.stamina ?? 0,
            targetMaxStamina: spectateTarget?.maxStamina ?? 100,
            targetFatigued: spectateTarget?.fatigued ?? false,
            targetHazard: specHazardMod
              ? {
                  kind: specHazardMod.kind,
                  label: specHazardMod.label,
                  summary: specHazardMod.summary,
                  speedMult: specHazardMod.speedMult,
                  staminaRate: specHazardMod.staminaRate,
                  color: specHazardMod.color,
                }
              : null,
            targetZoneName: spectateTarget ? getZoneAt(spectateTarget.x, spectateTarget.z).name : 'Wang Kelian',
            targetX: spectateTarget?.x ?? p.x,
            targetZ: spectateTarget?.z ?? p.z,
            targetFacingAngle: spectateTarget?.facingAngle ?? p.facingAngle,
            aliveOptionsCount: aliveKelis.length,
          }
        : null,
      spectatorDots,
      deathCam: this.getDeathCam(playerId) ? { ...this.getDeathCam(playerId)! } : null,
      bountyTargets: this.isMultiplayerMatch
        ? aliveKelis
            .filter((k) => (k.bountyReward ?? 0) > 0)
            .map<BountyTarget>((k) => ({
              id: k.id,
              name: k.name,
              x: k.x,
              z: k.z,
              level: k.level,
              rivalsConsumed: k.rivalsConsumed ?? 0,
              rewardPoints: k.bountyReward ?? 0,
              isSelf: k.id === p.id,
            }))
            .sort((a, b) => b.rewardPoints - a.rewardPoints || b.level - a.level)
        : [],
      recentDamageHits: (meta ? meta.recentDamageHits : this.recentDamageHits)
        .filter((h) => this.matchTime - h.timestamp < 1.35)
        .map((h) => ({ ...h })),
      recentEmotes: this.recentEmotes.filter((em) => this.matchTime - em.time < 3.8),
      matchResult: {
        status: perPlayerStatus,
        winnerId: this.winnerId,
        winnerName: this.winnerName,
        killedBy: meta ? meta.killedBy : this.killedBy,
        deathCause: meta ? meta.deathCause : this.deathCause,
        massTransferredTo: meta ? meta.massTransferredTo : this.massTransferredTo,
        finalLevel: p.alive
          ? Math.trunc(p.level)
          : (p.eliminatedAtLevel ?? (meta ? meta.finalLevel : this.playerFinalLevel)),
        kills: p.kills,
        bountyPoints: p.bountyPoints ?? 0,
        survivalTime: p.alive
          ? this.matchTime
          : meta
          ? meta.survivalTime
          : this.playerSurvivalTime,
        finalFeastTriggered: this.finalFeastTriggered,
        ledger: [...this.ledger],
      },
    };
  }

  public getRemoteWorldStateFor(playerId: string, tick: number): WorldStatePacket {
    const hud = this.getHudSnapshot(playerId);
    const meta = this.playerMetaById.get(playerId);
    const sfx = meta ? meta.pendingSfx.splice(0, meta.pendingSfx.length) : [];
    const shake = meta ? meta.cameraShake : this.cameraShake;
    const hitStop = meta ? meta.hitStop : this.hitStop;

    const kelis: RemoteKeliState[] = this.kelis
      .filter((k) => k.alive)
      .map((k) => ({
        id: k.id,
        name: k.name,
        isPlayer: k.id === playerId,
        x: Math.round(k.x * 10) / 10,
        z: Math.round(k.z * 10) / 10,
        vx: Math.round(k.vx * 10) / 10,
        vz: Math.round(k.vz * 10) / 10,
        facingAngle: Math.round(k.facingAngle * 1000) / 1000,
        level: k.level,
        hp: Math.round(k.hp * 10) / 10,
        maxHp: k.maxHp,
        alive: k.alive,
        isOnShore: k.isOnShore,
        isSubmerged: k.isSubmerged,
        shoreReserve: Math.round(k.shoreReserve * 10) / 10,
        maxShoreReserve: k.maxShoreReserve,
        stamina: Math.round(k.stamina * 10) / 10,
        maxStamina: k.maxStamina,
        fatigued: k.fatigued,
        activeHazard: k.activeHazard,
        bitePhase: k.bitePhase,
        biteAimAngle: Math.round(k.biteAimAngle * 1000) / 1000,
        evadeTimer: Math.round(k.evadeTimer * 100) / 100,
        staggerTimer: Math.round(k.staggerTimer * 100) / 100,
        stunTimer: Math.round(k.stunTimer * 100) / 100,
        stunResistTimer: Math.round(k.stunResistTimer * 100) / 100,
        recoilTimer: Math.round(k.recoilTimer * 100) / 100,
        recoilDirX: Math.round(k.recoilDirX * 100) / 100,
        recoilDirZ: Math.round(k.recoilDirZ * 100) / 100,
        recoilStrength: Math.round(k.recoilStrength * 100) / 100,
        lastHitKind: k.lastHitKind ?? null,
        venomTimer: Math.round(k.venomTimer * 100) / 100,
        frenzyTimer: Math.round(k.frenzyTimer * 100) / 100,
        veilTimer: Math.round(k.veilTimer * 100) / 100,
        dashTimer: Math.round(k.dashTimer * 100) / 100,
        hitFlashTimer: Math.round(k.hitFlashTimer * 100) / 100,
        surgeTimer: Math.round(k.surgeTimer * 100) / 100,
        predatorTimer: Math.round(k.predatorTimer * 100) / 100,
        aegisTimer: Math.round(k.aegisTimer * 100) / 100,
        dewTimer: Math.round(k.dewTimer * 100) / 100,
        stormFinTimer: Math.round(k.stormFinTimer * 100) / 100,
        thunderRoeTimer: Math.round(k.thunderRoeTimer * 100) / 100,
        evoBoostTimer: Math.round(k.evoBoostTimer * 100) / 100,
        highestFormReached: k.highestFormReached ?? getEvolutionForm(k.level),
        evolutionSeq: k.evolutionSeq ?? 0,
        lastEvolutionForm: k.lastEvolutionForm ?? getEvolutionForm(k.level),
        lastEvolutionTime: k.lastEvolutionTime ?? -1,
        lastMinorLevelTime: k.lastMinorLevelTime ?? -1,
        sonarTimer: Math.round(k.sonarTimer * 100) / 100,
        sonarIsHunter: k.sonarIsHunter,
        kills: k.kills,
        rivalsConsumed: k.rivalsConsumed ?? 0,
        bountyReward: k.bountyReward ?? 0,
        bountyPoints: k.bountyPoints ?? 0,
        bountyBoostTimer: Math.round((k.bountyBoostTimer ?? 0) * 100) / 100,
        feedingTargetId: k.feedingTargetId,
        feedingProgress: Math.round(k.feedingProgress * 100) / 100,
        feedingDuration: Math.round(k.feedingDuration * 100) / 100,
        feedingRecoveryTimer: Math.round((k.feedingRecoveryTimer ?? 0) * 100) / 100,
        feedingSessionFragments: k.feedingSessionFragments ?? 0,
        cooldowns: { ...k.cooldowns },
        activeEmote: k.activeEmote ?? null,
      }));

    return {
      tick,
      serverTime: Date.now(),
      matchTime: this.matchTime,
      status: hud.matchResult.status,
      cameraShake: shake,
      hitStop: hitStop ? { ...hitStop } : null,
      zone: { ...this.zone },
      weather: { ...this.weather },
      kelis,
      carcasses: this.carcasses.map((c) => ({
        ...c,
        x: Math.round(c.x * 10) / 10,
        z: Math.round(c.z * 10) / 10,
        evolutionPhaseAtDeath:
          c.evolutionPhaseAtDeath ?? (c.mass >= 80 ? 3 : c.mass >= 40 ? 2 : 1),
        initialMass: c.initialMass ?? c.mass,
      })),
      pickups: this.pickups.map((pk) => ({
        ...pk,
        x: Math.round(pk.x * 10) / 10,
        z: Math.round(pk.z * 10) / 10,
      })),
      effects: this.effects.map((fx) => ({
        ...fx,
        x: Math.round(fx.x * 10) / 10,
        z: Math.round(fx.z * 10) / 10,
      })),
      callouts: this.callouts.map((c) => ({
        ...c,
        x: Math.round(c.x * 10) / 10,
        z: Math.round(c.z * 10) / 10,
      })),
      hud,
      sfx,
    };
  }
}

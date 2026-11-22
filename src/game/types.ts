import type { EmoteId } from '../data/emotes.ts';

export type LobbySize = 5 | 10 | 20 | 25 | 50 | 100;
export type MatchMode = 'royale' | 'tutorial';

export type EvolutionForm = 1 | 2 | 3 | 4;
// 1: Lv 1-39 Aquatic (limbless fish)
// 2: Lv 40-79 First Reformation (two arms, fish tail, no legs)
// 3: Lv 80-99 Amphibious (two legs, permanent land access)
// 4: Lv 100 Keli King (final colossus)

export type ArenaZoneId =
  | 'lubuk_hitam'
  | 'gua_kelam_tua'
  | 'terowong_bijih'
  | 'sungai_berselirat'
  | 'tebing_kering'
  | 'jantung_tasik';

export type TerrainType = 'deep' | 'shallow' | 'shore' | 'cliff';

export type HazardTileKind = 'toxic_sludge' | 'rapids' | 'quagmire' | 'thermal_vent';

export interface ActiveHazardStatus {
  kind: HazardTileKind;
  label: string;
  summary: string;
  speedMult: number;
  staminaRate: number;
  color: string;
}

export type PickupKind =
  | 'kelp_salve'
  | 'amphetide'
  | 'fang_charge'
  | 'carapace_ward'
  | 'monsoon_dew'
  | 'storm_fin'
  | 'thunder_roe';

export interface PickupItem {
  id: string;
  kind: PickupKind;
  x: number;
  z: number;
  createdAt: number;
  bobPhase: number;
  rainFed?: boolean;
}

export type WeatherKind = 'clear' | 'light_rain' | 'basin_fog';

export interface WeatherState {
  kind: WeatherKind;
  label: string;
  intensity: number; // 0..1 smooth transition envelope
  remainingSec: number;
  visibilityRange: number; // 1.0 clear, 0.84 light_rain, 0.58 basin_fog
}

export type WorldEventKind =
  | 'flash_flood'
  | 'silt_bloom'
  | 'whirlpool'
  | 'drifting_net';

export type WorldEventPhase =
  | 'dormant'
  | 'warning'
  | 'active'
  | 'dissipating'
  | 'complete';

export interface ActiveWorldEventState {
  id: string;
  seq: number;
  kind: WorldEventKind;
  label: string;
  subtitle: string;
  phase: WorldEventPhase;
  phaseElapsed: number;
  phaseDuration: number;
  remainingSec: number;
  intensity: number; // 0..1 smooth ramp
  x: number;
  z: number;
  radius: number;
  corridorHalfLength: number;
  corridorHalfWidth: number;
  flowAngle: number;
  flowSpeed: number;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  driftProgress: number; // 0..1 for drifting_net
  createdAt: number;
}

export interface PlayerEventThreat {
  kind: WorldEventKind;
  label: string;
  escapeAngle: number;
  severity: 'warning' | 'active';
}

export type BitePhase = 'idle' | 'windup' | 'strike' | 'recovery';

export type HitReactKind = 'normal' | 'crit' | 'stun' | 'mitigated';

export type AbilityId =
  | 'bite'
  | 'evade'
  | 'dash'
  | 'sonar'
  | 'veil'
  | 'electroshock'
  | 'maelstrom';

export interface AbilityCooldowns {
  evade: number;
  dash: number;
  sonar: number;
  veil: number;
  electroshock: number;
  maelstrom: number;
}

export interface KeliEntity {
  id: string;
  name: string;
  isPlayer: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facingAngle: number;
  level: number;
  hp: number;
  maxHp: number;
  alive: boolean;

  // Shoreline, stamina & terrain
  moveAngle?: number;
  shoreSplashCooldown?: number;
  locomotionFxTimer?: number;
  isOnShore: boolean;
  isSubmerged: boolean;
  shoreReserve: number; // max 10s for Lv 40-79
  maxShoreReserve: number;
  stamina: number;
  maxStamina: number;
  staminaRegenDelay: number;
  fatigued: boolean;
  activeHazard: HazardTileKind | null;

  // Combat & status
  bitePhase: BitePhase;
  bitePhaseTimer: number;
  biteCooldown: number;
  biteAimAngle: number;
  biteHitApplied: boolean;
  biteBufferTimer: number;
  biteAttackSeq: number;
  biteHitTargetIds?: string[];
  biteDidHit?: boolean;
  biteFatigued?: boolean;

  evadeTimer: number;
  evadeDirX: number;
  evadeDirZ: number;
  staggerTimer: number;
  stunTimer: number;
  stunResistTimer: number;
  stunStacks: number;
  stunStackDecayTimer: number;
  recoilTimer: number;
  recoilDirX: number;
  recoilDirZ: number;
  recoilStrength: number;
  lastHitKind?: HitReactKind | null;
  // Separate bounded movement-impairment state for Jaring Hanyut (never alters stunTimer / stunResistTimer)
  netEntangleTimer?: number;
  netImmunityTimer?: number;

  venomTimer: number;
  venomDps: number;
  venomSourceId: string | null;
  frenzyTimer: number;
  veilTimer: number;
  dashTimer: number;
  dashDirX: number;
  dashDirZ: number;
  hitFlashTimer: number;
  surgeTimer: number;
  predatorTimer: number;
  aegisTimer: number;
  dewTimer: number;
  stormFinTimer: number;
  thunderRoeTimer: number;
  evoBoostTimer: number;
  highestFormReached?: EvolutionForm;
  unlockedMilestoneMask?: number;
  evolutionSeq?: number;
  lastEvolutionForm?: EvolutionForm;
  lastEvolutionTime?: number;
  lastMinorLevelTime?: number;

  // Sonar
  sonarTimer: number;
  sonarIsHunter: boolean;

  // Feeding
  feedingTargetId: string | null;
  feedingProgress: number;
  feedingDuration: number;
  feedingWindupDone?: boolean;
  feedingTickTimer?: number;
  feedingRecoveryTimer?: number;
  feedingSessionFragments?: number;
  feedingCancelHoldTimer?: number;
  feedingFeedbackCooldown?: number;

  cooldowns: AbilityCooldowns;
  kills: number;
  rivalsConsumed?: number;
  bountyReward?: number;
  bountyPoints?: number;
  bountyBoostTimer?: number;
  eliminatedAtLevel?: number;
  damageDealt: number;
  lastAttackerId: string | null;
  lastAttackerName: string | null;
  lastDamageCause: string | null;

  // AI brain (server/local simulation only — never serialized into multiplayer packets)
  aiWanderAngle: number;
  aiGoalTimer: number;
  aiTargetId: string | null;
  aiAggression: number;
  aiRetreatingFromShore: boolean;
  aiPersonality?: AiPersonality;
  aiState?: AiState;
  aiStateScore?: number;
  aiIntentAngle?: number;
  aiTargetLabel?: string | null;

  activeEmote?: EmoteId | null;
  emoteTimer?: number;
  emoteCooldown?: number;
  isSpeaking?: boolean;
}

export interface CarcassEntity {
  id: string;
  x: number;
  z: number;
  mass: number;
  initialMass?: number;
  evolutionPhaseAtDeath?: 1 | 2 | 3;
  sourceId?: string;
  sourceName: string;
  createdAt: number;
  bobPhase: number;
  consumed?: boolean;
  relocated?: boolean;
}

export type EffectType =
  | 'bite_arc'
  | 'sonar_ring'
  | 'veil_cloud'
  | 'electroshock'
  | 'maelstrom'
  | 'dash_wake'
  | 'evade_wake'
  | 'impact_splash'
  | 'crit_impact'
  | 'stun_burst'
  | 'mitigated_ring'
  | 'evolution_burst'
  | 'level_pulse'
  | 'feed_splash'
  | 'shore_splash'
  | 'land_dust'
  | 'water_ripple';

export interface WorldEffect {
  id: string;
  type: EffectType;
  x: number;
  z: number;
  angle: number;
  radius: number;
  duration: number;
  elapsed: number;
  ownerId: string;
  color: string;
}

export interface HitStopEvent {
  duration: number;
  seq: number;
}

export interface FloatingCallout {
  id: string;
  x: number;
  z: number;
  text: string;
  color: string;
  elapsed: number;
  duration: number;
}

export interface MassLedgerEntry {
  id: string;
  time: number;
  type: 'spawn' | 'kill' | 'feed' | 'venom_kill' | 'zone_death' | 'exposure_death';
  actorName: string;
  targetName: string;
  fragments: number;
  totalLivingMass: number;
  totalCarcassMass: number;
}

export interface SonarContact {
  id: string;
  kind: 'prey' | 'danger' | 'carcass';
  x: number;
  z: number;
  level: number;
  name: string;
  isOnShore: boolean;
}

export type MatchPhase = 'early' | 'mid' | 'endgame';

export type ActivityHotspotKind =
  | 'combat'
  | 'contested_feed'
  | 'convergence'
  | 'large_carcass';

export interface ActivityHotspot {
  id: string;
  kind: ActivityHotspotKind;
  x: number;
  z: number;
  radius: number;
  intensity: number; // 0..1 visual emphasis
  createdAt: number;
  expiresAt: number;
  label: string;
}

export interface MatchPacingMetrics {
  lobbySize: LobbySize;
  matchSeed: number;
  matchPhase: MatchPhase;
  totalMatchDurationSec: number;
  timeToFirstEncounterSec: number | null;
  timeToFirstEliminationSec: number | null;
  encounterCount: number;
  avgEncounterIntervalSec: number | null;
  deadTimeSec: number;
  contestedCarcassCount: number;
  hotspotsCreated: number;
  evolutionMilestonesSec: Partial<Record<20 | 40 | 60 | 80 | 100, number>>;
  phaseTransitionTimesSec: Partial<Record<MatchPhase, number>>;
  conclusionCause: string | null;
}

export interface ZoneState {
  centerX: number;
  centerZ: number;
  currentRadius: number;
  targetRadius: number;
  phase: number;
  warningTimer: number;
  isShrinking: boolean;
  /** True during the pre-contraction alert window before the zone begins moving. */
  warningActive?: boolean;
}

export interface TutorialStepState {
  step: 0 | 1 | 2 | 3 | 4;
  // 0: Move & Bite in shallows
  // 1: Safe carcass feed
  // 2: Contested carcass duel
  // 3: Optional Lv.40 Shore excursion lesson
  // 4: Free survival to Lv.100
  movedDistance: number;
  bittenOnce: boolean;
  safeFed: boolean;
  contestedCleared: boolean;
  shoreVisited: boolean;
  shortcutUsed: boolean;
}

export interface SoundCue {
  id: string;
  label: string;
  directionAngle: number | null; // relative to player, null if global
  severity: 'info' | 'warning' | 'danger';
  timestamp: number;
}

export interface DamageHitEvent {
  id: string;
  attackerId: string;
  attackerName: string;
  cause: string;
  damage: number;
  directionAngle: number;
  intensity: number;
  timestamp: number;
}

export interface DamageImpulse {
  x: number;
  z: number;
  strength: number;
  seq: number;
}

export interface BountyTarget {
  id: string;
  name: string;
  x: number;
  z: number;
  level: number;
  rivalsConsumed: number;
  rewardPoints: number;
  isSelf: boolean;
}

export interface FinalFeastCarcassMarker {
  id: string;
  x: number;
  z: number;
  mass: number;
  distance: number;
  angle: number;
  sourceName: string;
}

export interface FinalFeastState {
  active: boolean;
  remainingFragments: number;
  remainingCarcasses: FinalFeastCarcassMarker[];
}

export interface HudEvolutionProgress {
  currentLevel: number;
  currentForm: EvolutionForm;
  currentFormName: string;
  currentFormShortName: string;
  formLabel: string;
  nextEvolutionLevel: number | null;
  fragmentsToNextEvolution: number;
  evolutionStageProgress: number;
  overallProgress: number;
  nextAbilityLevel: number | null;
  nextAbilityTitle: string | null;
  isMaxLevel: boolean;
  evolutionSeq: number;
  lastMajorForm: EvolutionForm;
}

export interface HudSnapshot {
  matchTime: number;
  mode: MatchMode;
  lobbySize: LobbySize;
  aliveCount: number;
  totalEntrants: number;
  livingMassSum: number;
  carcassMassSum: number;
  topLeaderLevel: number;
  topLeaderName: string;

  player: {
    id: string;
    name: string;
    alive: boolean;
    level: number;
    form: EvolutionForm;
    hp: number;
    maxHp: number;
    isOnShore: boolean;
    shoreReserve: number;
    maxShoreReserve: number;
    stamina: number;
    maxStamina: number;
    fatigued: boolean;
    activeHazard: ActiveHazardStatus | null;
    zoneName: string;
    inSafeZone: boolean;
    stunned: boolean;
    staggered?: boolean;
    stunResistTimeLeft?: number;
    netEntangled?: boolean;
    evading?: boolean;
    bitePhase?: BitePhase;
    biteCooldown?: number;
    venomActive: boolean;
    frenzyActive: boolean;
    veilActive: boolean;
    surgeTimeLeft: number;
    predatorTimeLeft: number;
    aegisTimeLeft: number;
    dewTimeLeft: number;
    stormFinTimeLeft: number;
    thunderRoeTimeLeft: number;
    evoBoostTimeLeft: number;
    bountyBoostTimeLeft?: number;
    bountyPoints?: number;
    sonarActive: boolean;
    sonarIsHunter: boolean;
    sonarTimeLeft: number;
    feedingProgress: number;
    feedingDuration: number;
    feedingTargetName: string | null;
    feedingTargetMass?: number;
    feedingWindupDone?: boolean;
    feedingSessionFragments?: number;
    feedingContested?: boolean;
    feedingCompetitorCount?: number;
    feedingRecoveryTimeLeft?: number;
    nearbyCarcassMass?: number | null;
    nearbyCarcassBlockedReason?: string | null;
    cooldowns: AbilityCooldowns;
    kills: number;
    hasPreyInRange: boolean;
    hasCarcassInRange: boolean;
    x: number;
    z: number;
    facingAngle: number;
  };

  zone: ZoneState;
  weather: WeatherState;
  activeWorldEvent?: ActiveWorldEventState | null;
  playerThreatenedByEvent?: PlayerEventThreat | null;
  matchPhase?: MatchPhase;
  fragmentsToKing?: number;
  nextMilestoneLevel?: number | null;
  evolutionProgress?: HudEvolutionProgress;
  activityHotspots?: ActivityHotspot[];
  pickups: Array<{ id: string; kind: PickupKind; x: number; z: number; rainFed?: boolean }>;
  sonarContacts: SonarContact[];
  tacticalCarcasses?: Array<{
    id: string;
    x: number;
    z: number;
    mass: number;
    activelyFed: boolean;
    contested: boolean;
  }>;
  lastRequiredCarcass: { x: number; z: number; mass: number } | null;
  finalFeast?: FinalFeastState | null;
  offscreenIndicators: Array<{
    id: string;
    kind: 'prey' | 'danger' | 'carcass' | 'hotspot';
    screenAngle: number;
    distance: number;
    level: number;
  }>;
  recentBanner: { title: string; subtitle: string; key: number } | null;
  soundCues: SoundCue[];
  tutorial: TutorialStepState | null;

  spectating: {
    active: boolean;
    targetId: string | null;
    targetName: string | null;
    targetLevel: number;
    targetKills: number;
    targetHp: number;
    targetMaxHp: number;
    targetForm: EvolutionForm;
    targetStamina: number;
    targetMaxStamina: number;
    targetFatigued: boolean;
    targetHazard: ActiveHazardStatus | null;
    targetZoneName: string;
    targetX: number;
    targetZ: number;
    targetFacingAngle: number;
    aliveOptionsCount: number;
  } | null;

  spectatorDots?: Array<{
    id: string;
    x: number;
    z: number;
    level: number;
    isTarget: boolean;
  }>;

  deathCam: DeathCamState | null;
  bountyTargets?: BountyTarget[];
  recentDamageHits?: DamageHitEvent[];
  recentEmotes?: Array<{
    id: string;
    senderId: string;
    senderName: string;
    emoteId: EmoteId;
    x: number;
    z: number;
    time: number;
  }>;

  matchResult: {
    status: 'playing' | 'victory' | 'defeat' | 'draw';
    winnerId?: string | null;
    winnerName: string | null;
    killedBy: string | null;
    deathCause: string | null;
    massTransferredTo: string | null;
    finalLevel: number;
    kills: number;
    bountyPoints?: number;
    survivalTime: number;
    finalFeastTriggered?: boolean;
    ledger: MassLedgerEntry[];
  };
}

export interface DeathCamState {
  active: boolean;
  killerId: string;
  killerName: string;
  killerLevel: number;
  causeLabel: string;
  deathX: number;
  deathZ: number;
  remaining: number;
  duration: number;
}

export interface HudVisibilitySettings {
  minimap: boolean;
  evolutionProgress: boolean;
  statusEffects: boolean;
  matchTelemetry: boolean;
  abilityBar: boolean;
  banners: boolean;
}

export interface AccessibilitySettings {
  reducedMotion: boolean;
  visualSoundCues: boolean;
  hudScale: 'compact' | 'standard' | 'large';
  hudVisibility: HudVisibilitySettings;
  muted: boolean;
  volume: number;
  musicVolume?: number;
  voiceVolume?: number;
  voiceMode?: 'open' | 'ptt';
  evadeKey?: string;
}

export type AiDifficulty = 'easy' | 'normal' | 'hard';

export type AiPersonality =
  | 'aggressive_hunter'
  | 'cautious_survivor'
  | 'opportunistic_scavenger'
  | 'patient_ambusher';

export type AiState =
  | 'EXPLORE'
  | 'HUNT'
  | 'CHASE'
  | 'ATTACK'
  | 'EVADE'
  | 'RETREAT'
  | 'AMBUSH'
  | 'SCAVENGE'
  | 'FEED'
  | 'CONTEST_CARCASS'
  | 'RECOVER'
  | 'ESCAPE_ZONE';

export interface AiDebugEntry {
  botId: string;
  name: string;
  level: number;
  personality: AiPersonality;
  state: AiState;
  targetId: string | null;
  targetLabel: string | null;
  hpPct: number;
  staminaPct: number;
  score: number;
  intentAngle: number;
  x: number;
  z: number;
}


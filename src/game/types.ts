import type { EmoteId } from '../data/emotes';

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

export type BitePhase = 'idle' | 'windup' | 'strike' | 'recovery';

export type AbilityId = 'bite' | 'dash' | 'sonar' | 'veil' | 'electroshock' | 'maelstrom';

export interface AbilityCooldowns {
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
  isOnShore: boolean;
  isSubmerged: boolean;
  shoreReserve: number; // max 10s for Lv 40-79
  maxShoreReserve: number;
  stamina: number;
  maxStamina: number;
  fatigued: boolean;
  activeHazard: HazardTileKind | null;

  // Combat & status
  bitePhase: BitePhase;
  bitePhaseTimer: number;
  biteCooldown: number;
  biteAimAngle: number;
  biteHitApplied: boolean;

  stunTimer: number;
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

  // Sonar
  sonarTimer: number;
  sonarIsHunter: boolean;

  // Feeding
  feedingTargetId: string | null;
  feedingProgress: number;
  feedingDuration: number;

  cooldowns: AbilityCooldowns;
  kills: number;
  rivalsConsumed?: number;
  bountyReward?: number;
  damageDealt: number;
  lastAttackerId: string | null;
  lastAttackerName: string | null;
  lastDamageCause: string | null;

  // AI brain
  aiWanderAngle: number;
  aiGoalTimer: number;
  aiTargetId: string | null;
  aiAggression: number;
  aiRetreatingFromShore: boolean;

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
  sourceId?: string;
  sourceName: string;
  createdAt: number;
  bobPhase: number;
}

export type EffectType =
  | 'bite_arc'
  | 'sonar_ring'
  | 'veil_cloud'
  | 'electroshock'
  | 'maelstrom'
  | 'dash_wake'
  | 'evolution_burst'
  | 'feed_splash';

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

export interface ZoneState {
  centerX: number;
  centerZ: number;
  currentRadius: number;
  targetRadius: number;
  phase: number;
  warningTimer: number;
  isShrinking: boolean;
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
    sonarActive: boolean;
    sonarIsHunter: boolean;
    sonarTimeLeft: number;
    feedingProgress: number;
    feedingDuration: number;
    feedingTargetName: string | null;
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
  pickups: Array<{ id: string; kind: PickupKind; x: number; z: number; rainFed?: boolean }>;
  sonarContacts: SonarContact[];
  lastRequiredCarcass: { x: number; z: number; mass: number } | null;
  offscreenIndicators: Array<{
    id: string;
    kind: 'prey' | 'danger' | 'carcass';
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
    winnerName: string | null;
    killedBy: string | null;
    deathCause: string | null;
    massTransferredTo: string | null;
    finalLevel: number;
    kills: number;
    survivalTime: number;
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

export interface AccessibilitySettings {
  reducedMotion: boolean;
  visualSoundCues: boolean;
  hudScale: 'compact' | 'standard' | 'large';
  muted: boolean;
  volume: number;
  voiceVolume?: number;
  voiceMode?: 'open' | 'ptt';
}

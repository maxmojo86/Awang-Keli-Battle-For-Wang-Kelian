import {
  EVOLUTION_MILESTONES,
  getEvolutionForm,
} from '../data/abilities';
import {
  ARENA_SCALE,
  ECHO_SONAR_RADIUS,
  findPickupSpawn,
  findWaterSpawn,
  getCurrentVectorAt,
  getHazardAt,
  getHazardModifierForForm,
  getTerrainAt,
  getZoneAt,
  LANDMARKS,
  resolveArenaCollision,
  scaleArenaCoord,
  scaleArenaDist,
  WORLD_CENTER,
  WORLD_SIZE,
} from './arena';
import { soundEngine } from './audio';
import {
  ClientSfxEvent,
  RemoteKeliState,
  WorldStatePacket,
} from './multiplayerTypes';
import {
  AbilityId,
  CarcassEntity,
  FloatingCallout,
  HudSnapshot,
  KeliEntity,
  LobbySize,
  MassLedgerEntry,
  MatchMode,
  PickupItem,
  PickupKind,
  SonarContact,
  SoundCue,
  TutorialStepState,
  WeatherKind,
  WeatherState,
  WorldEffect,
  ZoneState,
} from './types';

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
}

interface PlayerMetaState {
  killedBy: string | null;
  deathCause: string | null;
  massTransferredTo: string | null;
  finalLevel: number;
  survivalTime: number;
  spectateTargetId: string | null;
  recentBanner: { title: string; subtitle: string; key: number } | null;
  bannerTimer: number;
  cameraShake: number;
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

  public mode: MatchMode;
  public lobbySize: LobbySize;
  private playerName: string;
  private humanEntrants: HumanEntrant[];
  private humanIds = new Set<string>();
  private primaryPlayerId: string;
  private emitLocalSound: boolean;

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
  public killedBy: string | null = null;
  public deathCause: string | null = null;
  public massTransferredTo: string | null = null;
  public playerFinalLevel = 1;
  public playerSurvivalTime = 0;
  public spectateTargetId: string | null = null;

  public recentBanner: { title: string; subtitle: string; key: number } | null = null;
  private bannerTimer = 0;
  private bannerSeq = 1;
  private idSeq = 1;

  public cameraShake = 0;
  private inputsById = new Map<string, PlayerInputState>();
  private playerMetaById = new Map<string, PlayerMetaState>();
  private prevPlayerX = 0;
  private prevPlayerZ = 0;

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
        recentBanner: null,
        bannerTimer: 0,
        cameraShake: 0,
        soundCues: [],
        pendingSfx: [],
      });
    }

    this.zone = {
      centerX: scaleArenaCoord(1030),
      centerZ: scaleArenaCoord(1210), // converges smoothly toward Jantung Tasik
      currentRadius: scaleArenaDist(960),
      targetRadius: scaleArenaDist(960),
      phase: 1,
      warningTimer: 26,
      isShrinking: false,
    };

    this.weather = {
      kind: 'clear',
      label: 'Clear Twilight',
      intensity: 0,
      remainingSec: mode === 'tutorial' ? 24 : 18 + Math.random() * 8,
      visibilityRange: 1.0,
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
    level: number
  ): KeliEntity {
    const maxHp = this.computeMaxHp(level);
    return {
      id,
      name,
      isPlayer,
      x,
      z,
      vx: 0,
      vz: 0,
      facingAngle: Math.random() * Math.PI * 2,
      level,
      hp: maxHp,
      maxHp,
      alive: true,

      isOnShore: false,
      isSubmerged: true,
      shoreReserve: 10,
      maxShoreReserve: 10,
      stamina: 100,
      maxStamina: 100,
      fatigued: false,
      activeHazard: null,

      bitePhase: 'idle',
      bitePhaseTimer: 0,
      biteCooldown: 0,
      biteAimAngle: 0,
      biteHitApplied: false,

      stunTimer: 0,
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
        dash: 0,
        sonar: 0,
        veil: 0,
        electroshock: 0,
        maelstrom: 0,
      },
      kills: 0,
      damageDealt: 0,
      lastAttackerId: null,
      lastAttackerName: null,
      lastDamageCause: null,

      aiWanderAngle: Math.random() * Math.PI * 2,
      aiGoalTimer: 0.5 + Math.random() * 1.5,
      aiTargetId: null,
      aiAggression: 0.35 + Math.random() * 0.55,
      aiRetreatingFromShore: false,
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
        sourceName: 'Fallen Keli',
        createdAt: 0,
        bobPhase: 0,
      });

      // Contested carcass (15 fragments) guarded by a Lv.10 rival
      this.carcasses.push({
        id: this.nextId('carc'),
        x: LANDMARKS.tutorialContestedCarcass.x,
        z: LANDMARKS.tutorialContestedCarcass.z,
        mass: 15,
        sourceName: 'Palong Straggler',
        createdAt: 0,
        bobPhase: 1.7,
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
      const n = Math.max(this.lobbySize, this.humanEntrants.length) as LobbySize;
      const baseFrag = Math.floor(100 / n);
      const remainder = 100 % n;

      // Shuffle indices for random +1 remainder distribution
      const indices = Array.from({ length: n }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      const bonusSet = new Set(indices.slice(0, remainder));

      // Place human players first, then fill remaining slots with AI bots
      for (let i = 0; i < n; i++) {
        const human = this.humanEntrants[i];
        const isHuman = Boolean(human);
        const startLvl = baseFrag + (bonusSet.has(i) ? 1 : 0);
        const sp = findWaterSpawn(i, n);
        const id = isHuman ? human.id : `bot-${i}`;
        const name = isHuman ? human.name : BOT_NAMES[(i - this.humanEntrants.length) % BOT_NAMES.length];
        const entity = this.createKeli(id, name, isHuman, sp.x, sp.z, startLvl);
        this.kelis.push(entity);
        if (id === this.primaryPlayerId) {
          this.prevPlayerX = entity.x;
          this.prevPlayerZ = entity.z;
        }
      }

      const humanLabel =
        this.humanEntrants.length > 1
          ? `${this.humanEntrants.length} players · ${n} total Keli · 100 fragments in play`
          : `${n} Keli entered the basin · 100 fragments in play`;
      this.pushBanner('Battle for Wang Kelian', humanLabel);
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
    if (!p || !p.alive || this.status !== 'playing') return;

    if (ability === 'bite') {
      this.tryBiteOrFeed(p, true);
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

  /**
   * Optional tutorial shortcut to the Lv.40 land lesson (maintains exact 100-fragment invariant!)
   */
  public skipToLandLesson() {
    if (this.mode !== 'tutorial' || !this.tutorial || this.status !== 'playing') return;
    const p = this.getPlayer();
    if (!p.alive || p.level >= 40) return;

    const needed = 40 - p.level;
    let gathered = 0;

    // Harvest from far bots first, preserving exact 100 total
    for (let i = this.kelis.length - 1; i >= 1 && gathered < needed; i--) {
      const bot = this.kelis[i];
      if (!bot.alive || bot.level <= 1) continue;
      const take = Math.min(bot.level - 1, needed - gathered);
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

  private playLocalSfx(kind: ClientSfxEvent['kind']) {
    switch (kind) {
      case 'bite':
        soundEngine.playBite(false);
        break;
      case 'bite_heavy':
        soundEngine.playBite(true);
        break;
      case 'death':
        soundEngine.playDeath();
        break;
      case 'feed':
        soundEngine.playFeedComplete();
        break;
      case 'evolution':
        soundEngine.playEvolution();
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
      if (k.alive) living += k.level;
    }
    let carcass = 0;
    for (const c of this.carcasses) {
      carcass += c.mass;
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
      fragments,
      totalLivingMass: living,
      totalCarcassMass: carcass,
    });
  }

  public step(rawDt: number) {
    if (this.status !== 'playing') return;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.matchTime += dt;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.recentBanner = null;
    }
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.5);
    }
    for (const meta of this.playerMetaById.values()) {
      if (meta.bannerTimer > 0) {
        meta.bannerTimer -= dt;
        if (meta.bannerTimer <= 0) meta.recentBanner = null;
      }
      if (meta.cameraShake > 0) {
        meta.cameraShake = Math.max(0, meta.cameraShake - dt * 2.5);
      }
    }

    // 1. Update radioactive zone contraction & dynamic basin weather
    this.updateZone(dt);
    this.updateWeather(dt);

    // 2. Update each living Keli (timers, player input / AI brain, movement, combat)
    for (let i = 0; i < this.kelis.length; i++) {
      const k = this.kelis[i];
      if (!k.alive) continue;
      this.updateKeliTimers(k, dt);

      if (k.isPlayer) {
        this.applyPlayerControls(k, dt);
      } else {
        this.updateAiBrain(k, dt);
      }

      this.moveKeli(k, dt);
      this.updateBiteAndFeeding(k, dt);
      this.applyEnvironmentalEffects(k, dt);
    }

    // 3. Carcass currents & zone boundary retrieval
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
    if (this.mode === 'tutorial' && this.tutorial && this.tutorial.step < 4) {
      return; // Pause radioactive contraction during early guided steps
    }

    if (!this.zone.isShrinking) {
      this.zone.warningTimer -= dt;
      if (this.zone.warningTimer <= 0 && this.zone.phase < 5) {
        this.zone.isShrinking = true;
        this.zone.phase += 1;
        const radii = [
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
      const shrinkSpeed = Math.round(24 * ARENA_SCALE);
      this.zone.currentRadius = Math.max(
        this.zone.targetRadius,
        this.zone.currentRadius - shrinkSpeed * dt
      );
      if (this.zone.currentRadius <= this.zone.targetRadius + 0.5) {
        this.zone.currentRadius = this.zone.targetRadius;
        this.zone.isShrinking = false;
        this.zone.warningTimer = 28;
      }
    }
  }

  private updateKeliTimers(k: KeliEntity, dt: number) {
    if (k.biteCooldown > 0) k.biteCooldown = Math.max(0, k.biteCooldown - dt);
    if (k.stunTimer > 0) k.stunTimer = Math.max(0, k.stunTimer - dt);
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
    if (k.veilTimer > 0) k.veilTimer = Math.max(0, k.veilTimer - dt);
    if (k.dashTimer > 0) k.dashTimer = Math.max(0, k.dashTimer - dt);
    if (k.sonarTimer > 0) k.sonarTimer = Math.max(0, k.sonarTimer - dt);
    if (k.hitFlashTimer > 0) k.hitFlashTimer = Math.max(0, k.hitFlashTimer - dt);

    const cdScale = k.stormFinTimer > 0 ? 1.55 : 1.0;
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
    if (p.stunTimer > 0) {
      p.vx *= 0.85;
      p.vz *= 0.85;
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

    if (p.dashTimer > 0) {
      p.vx = p.dashDirX * speed * 2.55;
      p.vz = p.dashDirZ * speed * 2.55;
    } else if (len > 0.05) {
      const nx = input.moveX / len;
      const nz = input.moveZ / len;
      p.vx = nx * speed;
      p.vz = nz * speed;
      if (p.bitePhase === 'idle' && !p.feedingTargetId) {
        p.facingAngle = Math.atan2(nz, nx);
      }
    } else {
      p.vx *= Math.pow(0.05, dt);
      p.vz *= Math.pow(0.05, dt);
    }

    // Track closest prey smoothly during bite windup & lock facing to bite cone
    if (p.bitePhase === 'windup') {
      const strikeReach = 64 + this.computeRadius(p.level);
      const trackedPrey = this.findClosestPrey(p, strikeReach + 95);
      if (trackedPrey) {
        const preyAngle = Math.atan2(trackedPrey.z - p.z, trackedPrey.x - p.x);
        p.biteAimAngle = preyAngle;
        input.aimAngle = preyAngle;
      }
    }

    if (p.bitePhase !== 'idle') {
      p.facingAngle = p.biteAimAngle;
    } else if (len <= 0.05 && !p.feedingTargetId) {
      p.facingAngle = input.aimAngle;
    }

    // Held bite/feed
    if (input.biteHeld) {
      this.tryBiteOrFeed(p, false);
    }
  }

  private getMoveSpeed(k: KeliEntity): number {
    let base = 158 + Math.min(48, k.level * 0.45);
    if (k.isOnShore) {
      base *= k.level >= 80 ? 0.96 : 0.72; // Lv 40-79 drags on arms, Lv 80+ walks cleanly
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
    if (k.fatigued) base *= 0.84;
    if (k.frenzyTimer > 0) base *= 1.18;
    if (k.surgeTimer > 0) base *= 1.28;
    if (k.stormFinTimer > 0) base *= 1.22;
    if (k.feedingTargetId) base *= 0.28; // Slowed while committing to a feed
    return base;
  }

  private moveKeli(k: KeliEntity, dt: number) {
    if (!k.alive) return;

    // Water current push when in water (zone streams + rapids hazard tiles)
    let curX = 0;
    let curZ = 0;
    const prevHazard = k.activeHazard;
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

    const resolved = resolveArenaCollision(nextX, nextZ, radius, canGoAshore);
    k.x = resolved.x;
    k.z = resolved.z;

    if (k.isPlayer && resolved.blockedByShore && Math.random() < 0.06) {
      this.spawnCallout(k.x, k.z, 'Shore requires Lv.40', '#d4a359');
    }

    const terrain = getTerrainAt(k.x, k.z);
    k.isOnShore = terrain === 'shore';
    k.isSubmerged = terrain === 'deep';

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
    } else {
      const baseRegen = k.isOnShore ? 10 : 16;
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

    // 2. Radioactive Zone Outside Damage
    const distFromZone = Math.hypot(k.x - this.zone.centerX, k.z - this.zone.centerZ);
    if (distFromZone > this.zone.currentRadius) {
      const zoneDps = 6 + this.zone.phase * 3.5;
      k.hp -= zoneDps * dt;
      if (k.hp <= 0) {
        this.handleDeath(k, null, 'Radioactive Zone', 'zone_death');
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

  private tryBiteOrFeed(k: KeliEntity, playPlayerAudio: boolean) {
    if (!k.alive || k.stunTimer > 0) return;

    const biteRange = 54 + this.computeRadius(k.level);
    const strikeReach = 64 + this.computeRadius(k.level);

    // Closest live prey inside immediate strike envelope vs broader auto-aim reach
    const closestInStrike = this.findClosestPrey(k, strikeReach);
    const hasLiveTargetInFront = Boolean(closestInStrike);

    // Check nearest carcass inside feeding range
    let nearestCarc: CarcassEntity | null = null;
    let nearestCarcDist = Infinity;
    for (const c of this.carcasses) {
      const d = Math.hypot(c.x - k.x, c.z - k.z);
      if (d <= biteRange + 22 && d < nearestCarcDist) {
        nearestCarcDist = d;
        nearestCarc = c;
      }
    }

    const input = k.isPlayer ? this.inputsById.get(k.id) : undefined;

    // Deliberate feeding if carcass is right in front and no immediate live clash
    if (nearestCarc && (!hasLiveTargetInFront || k.feedingTargetId === nearestCarc.id)) {
      const carcAngle = Math.atan2(nearestCarc.z - k.z, nearestCarc.x - k.x);
      k.facingAngle = carcAngle;
      if (input) {
        input.aimAngle = carcAngle;
      }
      if (k.feedingTargetId !== nearestCarc.id) {
        k.feedingTargetId = nearestCarc.id;
        k.feedingProgress = 0;
        // Proposed 0.5–1.6s commitment window scaling with carcass mass
        k.feedingDuration = Math.min(1.65, 0.5 + nearestCarc.mass * 0.025);
      }
      return;
    }

    // Cancel active feeding if initiating a combat bite
    k.feedingTargetId = null;
    k.feedingProgress = 0;

    if (k.bitePhase !== 'idle' || k.biteCooldown > 0) return;

    // Auto-direct toward the closest prey so both the keli and bite cone face the target
    const closestPrey = k.isPlayer
      ? closestInStrike ?? this.findClosestPrey(k, strikeReach + 95)
      : closestInStrike;

    let aimAngle = input ? input.aimAngle : k.facingAngle;
    if (closestPrey) {
      aimAngle = Math.atan2(closestPrey.z - k.z, closestPrey.x - k.x);
      k.facingAngle = aimAngle;
      if (input) {
        input.aimAngle = aimAngle;
      }
    }

    k.bitePhase = 'windup';
    k.bitePhaseTimer = 0.13;
    k.biteAimAngle = aimAngle;
    k.biteHitApplied = false;

    if (k.isPlayer && (playPlayerAudio || input?.biteHeld)) {
      this.emitSfxFor(k.id, k.level >= 40 ? 'bite_heavy' : 'bite');
      if (this.tutorial && this.tutorial.step === 0) {
        this.tutorial.bittenOnce = true;
      }
    }
  }

  private updateBiteAndFeeding(k: KeliEntity, dt: number) {
    if (!k.alive) return;

    // 1. Feeding commitment channel
    if (k.feedingTargetId) {
      const carcIdx = this.carcasses.findIndex((c) => c.id === k.feedingTargetId);
      if (carcIdx === -1 || k.stunTimer > 0) {
        k.feedingTargetId = null;
        k.feedingProgress = 0;
      } else {
        const carc = this.carcasses[carcIdx];
        const dist = Math.hypot(carc.x - k.x, carc.z - k.z);
        if (dist > 78 + this.computeRadius(k.level)) {
          k.feedingTargetId = null;
          k.feedingProgress = 0;
        } else {
          k.feedingProgress += dt;
          if (Math.random() < 0.22) {
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
          if (k.feedingProgress >= k.feedingDuration) {
            this.completeFeed(k, carcIdx);
          }
        }
      }
    }

    // 2. Bite telegraph -> strike -> recovery
    if (k.bitePhase === 'idle') return;
    k.bitePhaseTimer -= dt;

    if (k.bitePhase === 'windup' && k.bitePhaseTimer <= 0) {
      k.bitePhase = 'strike';
      k.bitePhaseTimer = 0.08;
      this.executeBiteHit(k);
    } else if (k.bitePhase === 'strike' && k.bitePhaseTimer <= 0) {
      k.bitePhase = 'recovery';
      k.bitePhaseTimer = k.frenzyTimer > 0 || k.predatorTimer > 0 ? 0.13 : 0.21;
    } else if (k.bitePhase === 'recovery' && k.bitePhaseTimer <= 0) {
      k.bitePhase = 'idle';
      k.biteCooldown = k.frenzyTimer > 0 || k.predatorTimer > 0 ? 0.12 : 0.2;
    }
  }

  private executeBiteHit(attacker: KeliEntity) {
    const reach =
      (64 + this.computeRadius(attacker.level)) * (attacker.thunderRoeTimer > 0 ? 1.2 : 1.0);
    const dmg =
      (19 + attacker.level * 1.15) *
      (attacker.predatorTimer > 0 ? 1.38 : 1.0) *
      (attacker.thunderRoeTimer > 0 ? 1.32 : 1.0);

    this.effects.push({
      id: this.nextId('fx'),
      type: 'bite_arc',
      x: attacker.x,
      z: attacker.z,
      angle: attacker.biteAimAngle,
      radius: reach,
      duration: 0.2,
      elapsed: 0,
      ownerId: attacker.id,
      color: attacker.thunderRoeTimer > 0 ? '#c084fc' : attacker.level >= 30 ? '#6ee7b7' : '#f3e8d2',
    });

    for (const target of this.kelis) {
      if (!target.alive || target.id === attacker.id) continue;
      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + this.computeRadius(target.level)) continue;

      const angToTarget = Math.atan2(dz, dx);
      let diff = angToTarget - attacker.biteAimAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 1.05 && dist > 26) continue;

      this.applyDamage(target, attacker, dmg, 'Bite');

      // Lv 30: Venom Bite
      if (attacker.level >= 30 && target.alive) {
        target.venomTimer = 3.6;
        target.venomDps = 5.5 + attacker.level * 0.12;
        target.venomSourceId = attacker.id;
      }

      // Lv 40: Bite Stuns
      if (attacker.level >= 40 && target.alive) {
        target.stunTimer = Math.max(target.stunTimer, 0.6);
        this.spawnCallout(target.x, target.z, 'STUNNED', '#f59e0b');
      }

      // Knockback
      if (dist > 0.1) {
        target.x += (dx / dist) * 14;
        target.z += (dz / dist) * 14;
      }
    }
  }

  private applyDamage(
    target: KeliEntity,
    attacker: KeliEntity | null,
    amount: number,
    cause: string
  ) {
    if (!target.alive) return;
    const finalAmount = target.aegisTimer > 0 ? amount * 0.65 : amount;
    target.hp -= finalAmount;
    target.hitFlashTimer = 0.16;
    if (attacker) {
      attacker.damageDealt += finalAmount;
      target.lastAttackerId = attacker.id;
      target.lastAttackerName = attacker.name;
      target.lastDamageCause = cause;
    }

    if (target.isPlayer || attacker?.isPlayer) {
      if (target.isPlayer) {
        const tm = this.playerMetaById.get(target.id);
        if (tm) tm.cameraShake = Math.min(0.6, tm.cameraShake + 0.22);
      }
      if (attacker?.isPlayer) {
        const am = this.playerMetaById.get(attacker.id);
        if (am) am.cameraShake = Math.min(0.6, am.cameraShake + 0.18);
      }
      if (target.id === this.primaryPlayerId || attacker?.id === this.primaryPlayerId) {
        this.cameraShake = Math.min(0.6, this.cameraShake + 0.22);
      }
      this.spawnCallout(target.x, target.z, `-${Math.round(finalAmount)}`, '#f87171');
    }

    if (target.hp <= 0) {
      this.handleDeath(
        target,
        attacker,
        attacker ? `${attacker.name} (${cause})` : cause,
        'kill'
      );
    }
  }

  private handleDeath(
    victim: KeliEntity,
    killer: KeliEntity | null,
    causeLabel: string,
    ledgerType: MassLedgerEntry['type']
  ) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.feedingTargetId = null;

    if (killer && killer.id !== victim.id) {
      killer.kills += 1;
    }

    // Victim's FULL level becomes an edible carcass (100-fragment rule!)
    const carc: CarcassEntity = {
      id: this.nextId('carc'),
      x: victim.x,
      z: victim.z,
      mass: victim.level,
      sourceId: victim.id,
      sourceName: victim.name,
      createdAt: this.matchTime,
      bobPhase: Math.random() * Math.PI * 2,
    };
    this.carcasses.push(carc);

    this.recordLedger(
      ledgerType,
      killer ? killer.name : causeLabel,
      victim.name,
      victim.level
    );

    if (this.humanIds.has(victim.id)) {
      const killedByName = killer ? killer.name : causeLabel;
      const meta = this.playerMetaById.get(victim.id);
      if (meta) {
        meta.killedBy = killedByName;
        meta.deathCause = causeLabel;
        meta.finalLevel = victim.level;
        meta.survivalTime = this.matchTime;
        meta.spectateTargetId = killer && killer.alive ? killer.id : null;
      }
      if (victim.id === this.primaryPlayerId) {
        this.killedBy = killedByName;
        this.deathCause = causeLabel;
        this.playerFinalLevel = victim.level;
        this.playerSurvivalTime = this.matchTime;
        this.spectateTargetId = killer && killer.alive ? killer.id : null;
      }
      this.emitSfxFor(victim.id, 'death');
      this.getSpectateTarget(victim.id);
      this.pushBannerFor(
        victim.id,
        `Eliminated by ${killedByName}`,
        'Spectating live match until Keli King is crowned'
      );
    }

    this.addSoundCue(`${victim.name} slain (${victim.level} fragments)`, { x: victim.x, z: victim.z }, 'info');
  }

  private completeFeed(eater: KeliEntity, carcassIndex: number) {
    const carc = this.carcasses[carcassIndex];
    if (!carc || !eater.alive) return;

    this.carcasses.splice(carcassIndex, 1);
    eater.feedingTargetId = null;
    eater.feedingProgress = 0;

    const gained = carc.mass;
    this.grantFragments(eater, gained, carc.sourceName);

    // Health restore on feed
    const heal = eater.maxHp * (0.3 + gained * 0.015);
    eater.hp = Math.min(eater.maxHp, eater.hp + heal);

    // Lv.70 Feeding Frenzy
    if (eater.level >= 70) {
      eater.frenzyTimer = 4.5;
    }

    this.recordLedger('feed', eater.name, `${carc.sourceName}'s Remains`, gained);

    if (carc.sourceId && this.humanIds.has(carc.sourceId)) {
      const deadMeta = this.playerMetaById.get(carc.sourceId);
      if (deadMeta) deadMeta.massTransferredTo = eater.name;
      if (carc.sourceId === this.primaryPlayerId) {
        this.massTransferredTo = eater.name;
      }
    }

    if (eater.isPlayer) {
      this.emitSfxFor(eater.id, 'feed');
      this.spawnCallout(eater.x, eater.z, `+${gained} FRAGMENTS`, '#e6b86e');
    }
  }

  private grantFragments(eater: KeliEntity, amount: number, sourceLabel: string) {
    const prevLevel = eater.level;
    const prevForm = getEvolutionForm(prevLevel);
    eater.level = Math.min(100, eater.level + amount);
    const newMax = this.computeMaxHp(eater.level);
    const hpDelta = Math.max(0, newMax - eater.maxHp);
    eater.maxHp = newMax;
    eater.hp = Math.min(eater.maxHp, eater.hp + hpDelta);

    // Unlock all crossed milestone notifications cleanly when large meals jump several thresholds
    if (eater.isPlayer) {
      const unlocked = EVOLUTION_MILESTONES.filter(
        (m) => m.level > prevLevel && m.level <= eater.level
      );
      if (unlocked.length > 0) {
        const latest = unlocked[unlocked.length - 1];
        const names = unlocked.map((u) => `Lv.${u.level} ${u.title}`).join(' · ');
        this.pushBannerFor(eater.id, `Evolution Unlocked: ${latest.title}`, names);
        this.emitSfxFor(eater.id, 'evolution');
      }
      if (getEvolutionForm(eater.level) > prevForm) {
        this.effects.push({
          id: this.nextId('fx'),
          type: 'evolution_burst',
          x: eater.x,
          z: eater.z,
          angle: 0,
          radius: 90,
          duration: 0.7,
          elapsed: 0,
          ownerId: eater.id,
          color: '#e6b86e',
        });
      }
    }
    if (eater.level >= 100) {
      this.pushBanner(`${eater.name} became the Keli King!`, `Reunited all 100 fragments from ${sourceLabel}`);
    }
  }

  private tryDash(k: KeliEntity) {
    if (k.level < 10 || k.cooldowns.dash > 0 || k.stunTimer > 0) return;
    k.cooldowns.dash = 3.5;
    k.dashTimer = k.fatigued ? 0.17 : 0.24;
    k.stamina = Math.max(0, k.stamina - 10);
    const angle = k.facingAngle;
    k.dashDirX = Math.cos(angle);
    k.dashDirZ = Math.sin(angle);
    k.feedingTargetId = null;

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
    k.cooldowns.veil = 10.0;
    k.veilTimer = 4.0;

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
    k.cooldowns.electroshock = 11.0;
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
      if (Math.hypot(target.x - k.x, target.z - k.z) <= radius + this.computeRadius(target.level)) {
        this.applyDamage(target, k, dmg, 'Electroshock');
        if (target.alive) {
          target.stunTimer = Math.max(target.stunTimer, 0.9);
          this.spawnCallout(target.x, target.z, 'SHOCKED', '#67e8f9');
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
    k.cooldowns.maelstrom = 14.0;

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
    if (bot.stunTimer > 0) {
      bot.vx *= 0.85;
      bot.vz *= 0.85;
      return;
    }

    // In tutorial early steps, keep far bots passive so player learns safely
    if (this.mode === 'tutorial' && this.tutorial && this.tutorial.step < 2 && bot.id !== 'bot-contested') {
      bot.vx *= 0.9;
      bot.vz *= 0.9;
      return;
    }

    bot.aiGoalTimer -= dt;
    const distFromZone = Math.hypot(bot.x - this.zone.centerX, bot.z - this.zone.centerZ);

    // 1. Retreat if outside safe zone
    if (distFromZone > this.zone.currentRadius - 80) {
      const ang = Math.atan2(this.zone.centerZ - bot.z, this.zone.centerX - bot.x);
      bot.facingAngle = ang;
      const spd = this.getMoveSpeed(bot);
      bot.vx = Math.cos(ang) * spd;
      bot.vz = Math.sin(ang) * spd;
      return;
    }

    // 1b. Steer out of stamina-draining hazards when fatigued or low stamina
    if (bot.activeHazard && (bot.fatigued || bot.stamina < 38)) {
      const mod = getHazardModifierForForm(bot.activeHazard, getEvolutionForm(bot.level));
      if (mod.staminaRate < -8) {
        const toSafeAng = Math.atan2(this.zone.centerZ - bot.z, this.zone.centerX - bot.x);
        bot.facingAngle = toSafeAng;
        const spd = this.getMoveSpeed(bot);
        bot.vx = Math.cos(toSafeAng) * spd;
        bot.vz = Math.sin(toSafeAng) * spd;
        return;
      }
    }

    // 2. Lv 40-79 retreat from shore before exposure kills them
    if (bot.level >= 40 && bot.level < 80 && bot.isOnShore && bot.shoreReserve < 2.8) {
      bot.aiRetreatingFromShore = true;
    } else if (!bot.isOnShore) {
      bot.aiRetreatingFromShore = false;
    }

    if (bot.aiRetreatingFromShore) {
      const ang = Math.atan2(this.zone.centerZ - bot.z, this.zone.centerX - bot.x);
      bot.facingAngle = ang;
      const spd = this.getMoveSpeed(bot);
      bot.vx = Math.cos(ang) * spd;
      bot.vz = Math.sin(ang) * spd;
      if (bot.level >= 10 && bot.cooldowns.dash <= 0) this.tryDash(bot);
      return;
    }

    // 3. Scan surroundings (respecting Silt Veil disruption & weather visibility!)
    const vis = this.weather.visibilityRange;
    let nearestThreat: KeliEntity | null = null;
    let nearestThreatDist = 420 * vis;
    let nearestPrey: KeliEntity | null = null;
    let nearestPreyDist = 480 * vis;

    for (const other of this.kelis) {
      if (!other.alive || other.id === bot.id) continue;
      // Silt Veil disrupts bot targeting!
      if (other.veilTimer > 0) continue;
      if (other.isOnShore && bot.level < 40) continue;

      const d = Math.hypot(other.x - bot.x, other.z - bot.z);
      if (other.level > bot.level * 1.15 && d < nearestThreatDist) {
        nearestThreat = other;
        nearestThreatDist = d;
      } else if (other.level <= bot.level * 1.1 && d < nearestPreyDist) {
        nearestPrey = other;
        nearestPreyDist = d;
      }
    }

    // Nearest reachable carcass (search globally if no prey is close so endgame survivors reunite all 100 fragments)
    let nearestCarc: CarcassEntity | null = null;
    let nearestCarcDist = nearestPrey ? 560 * vis : WORLD_SIZE * 1.5;
    for (const c of this.carcasses) {
      if (getTerrainAt(c.x, c.z) === 'shore' && bot.level < 40) continue;
      const d = Math.hypot(c.x - bot.x, c.z - bot.z);
      if (d < nearestCarcDist) {
        nearestCarcDist = d;
        nearestCarc = c;
      }
    }

    // Nearest useful healing/power-up pickup (including rain-fed spawns)
    let nearestPickup: PickupItem | null = null;
    let nearestPickupDist = bot.hp < bot.maxHp * 0.65 ? 360 * vis : 240 * vis;
    for (const pk of this.pickups) {
      if (getTerrainAt(pk.x, pk.z) === 'shore' && bot.level < 40) continue;
      const isHealDrop = pk.kind === 'kelp_salve' || pk.kind === 'monsoon_dew';
      if (isHealDrop && bot.hp >= bot.maxHp * 0.85 && bot.venomTimer <= 0) continue;
      const d = Math.hypot(pk.x - bot.x, pk.z - bot.z);
      const maxSearch = (isHealDrop && bot.hp < bot.maxHp * 0.65 ? 360 : pk.rainFed ? 280 : 220) * vis;
      if (d < maxSearch && d < nearestPickupDist) {
        nearestPickupDist = d;
        nearestPickup = pk;
      }
    }

    const spd = this.getMoveSpeed(bot);

    // Decision hierarchy
    if (nearestThreat && nearestThreatDist < 230 && bot.hp < bot.maxHp * 0.75) {
      // Flee threat
      const fleeAng = Math.atan2(bot.z - nearestThreat.z, bot.x - nearestThreat.x);
      bot.facingAngle = fleeAng;
      bot.vx = Math.cos(fleeAng) * spd;
      bot.vz = Math.sin(fleeAng) * spd;
      if (bot.level >= 50 && bot.cooldowns.veil <= 0) this.tryVeil(bot);
      else if (bot.level >= 10 && bot.cooldowns.dash <= 0) this.tryDash(bot);
      return;
    }

    if (
      nearestPickup &&
      (((nearestPickup.kind === 'kelp_salve' || nearestPickup.kind === 'monsoon_dew') &&
        bot.hp < bot.maxHp * 0.65) ||
        nearestPickupDist < 185)
    ) {
      const ang = Math.atan2(nearestPickup.z - bot.z, nearestPickup.x - bot.x);
      bot.facingAngle = ang;
      bot.vx = Math.cos(ang) * spd;
      bot.vz = Math.sin(ang) * spd;
      return;
    }

    if (nearestCarc && (nearestCarcDist < 170 || !nearestPrey)) {
      const ang = Math.atan2(nearestCarc.z - bot.z, nearestCarc.x - bot.x);
      bot.facingAngle = ang;
      if (nearestCarcDist > 42) {
        bot.vx = Math.cos(ang) * spd;
        bot.vz = Math.sin(ang) * spd;
      } else {
        bot.vx *= 0.5;
        bot.vz *= 0.5;
        this.tryBiteOrFeed(bot, false);
      }
      return;
    }

    if (nearestPrey && (bot.hp > bot.maxHp * 0.35 || nearestPreyDist < 120)) {
      const ang = Math.atan2(nearestPrey.z - bot.z, nearestPrey.x - bot.x);
      bot.facingAngle = ang;
      bot.vx = Math.cos(ang) * spd;
      bot.vz = Math.sin(ang) * spd;

      if (nearestPreyDist < 72 + this.computeRadius(bot.level)) {
        this.tryBiteOrFeed(bot, false);
      } else if (bot.level >= 60 && nearestPreyDist < 130 && bot.cooldowns.electroshock <= 0) {
        this.tryElectroshock(bot);
      } else if (bot.level >= 90 && nearestPreyDist < 240 && bot.cooldowns.maelstrom <= 0) {
        this.tryMaelstrom(bot);
      } else if (bot.level >= 10 && nearestPreyDist < 220 && bot.cooldowns.dash <= 0 && bot.aiAggression > 0.55) {
        this.tryDash(bot);
      }
      return;
    }

    // Patrol / wander toward Jantung Tasik
    if (bot.aiGoalTimer <= 0) {
      bot.aiGoalTimer = 1.6 + Math.random() * 2.2;
      const toCenter = Math.atan2(this.zone.centerZ - bot.z, this.zone.centerX - bot.x);
      bot.aiWanderAngle = toCenter + (Math.random() - 0.5) * 1.9;
      if (bot.level >= 20 && bot.cooldowns.sonar <= 0 && Math.random() < 0.35) {
        this.trySonar(bot);
      }
    }

    bot.facingAngle = bot.aiWanderAngle;
    bot.vx = Math.cos(bot.aiWanderAngle) * spd * 0.72;
    bot.vz = Math.sin(bot.aiWanderAngle) * spd * 0.72;
  }

  private updateCarcasses(dt: number) {
    for (const c of this.carcasses) {
      c.bobPhase += dt * 2.4;

      // Water current drift
      if (getTerrainAt(c.x, c.z) !== 'shore') {
        const cur = getCurrentVectorAt(c.x, c.z);
        c.x += cur.vx * 0.35 * dt;
        c.z += cur.vz * 0.35 * dt;
      }

      // Radioactive zone current pulls inaccessible carcasses back inside safe zone!
      const dx = c.x - this.zone.centerX;
      const dz = c.z - this.zone.centerZ;
      const dist = Math.hypot(dx, dz);
      if (dist > this.zone.currentRadius - 55 && dist > 1) {
        const zonePull = Math.round(65 * ARENA_SCALE) * dt;
        c.x -= (dx / dist) * zonePull;
        c.z -= (dz / dist) * zonePull;
      }

      // Keep clear of solid rock interiors
      const res = resolveArenaCollision(c.x, c.z, 12, true);
      c.x = res.x;
      c.z = res.z;
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

      // Active Maelstrom vortex pulls nearby rivals & carcasses inward!
      if (fx.type === 'maelstrom' && fx.elapsed < fx.duration) {
        for (const k of this.kelis) {
          if (!k.alive || k.id === fx.ownerId) continue;
          const dx = fx.x - k.x;
          const dz = fx.z - k.z;
          const d = Math.hypot(dx, dz);
          if (d < fx.radius && d > 22) {
            const pull = 175 * dt;
            k.x += (dx / d) * pull;
            k.z += (dz / d) * pull;
          }
        }
        for (const c of this.carcasses) {
          const dx = fx.x - c.x;
          const dz = fx.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d < fx.radius && d > 18) {
            const pull = 210 * dt;
            c.x += (dx / d) * pull;
            c.z += (dz / d) * pull;
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
    this.callouts.push({
      id: this.nextId('txt'),
      x,
      z,
      text,
      color,
      elapsed: 0,
      duration: 1.0,
    });
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

  private evaluateMatchOutcome() {
    const aliveKelis = this.kelis.filter((k) => k.alive);

    // Check if anyone reached Level 100
    const king = aliveKelis.find((k) => k.level >= 100);
    if (king) {
      this.winnerId = king.id;
      this.winnerName = king.name;
      this.status = king.id === this.primaryPlayerId ? 'victory' : 'defeat';
      this.emitSfxGlobal('whistle');

      for (const [pid, meta] of this.playerMetaById.entries()) {
        const entity = this.getPlayer(pid);
        if (pid === king.id) {
          meta.finalLevel = 100;
          meta.survivalTime = this.matchTime;
        } else {
          meta.spectateTargetId = king.id;
          if (!meta.killedBy) {
            meta.killedBy = king.name;
            meta.deathCause = `${king.name} reunited all 100 fragments first`;
            meta.finalLevel = entity.level;
            meta.survivalTime = this.matchTime;
          }
        }
      }

      if (king.id === this.primaryPlayerId) {
        this.playerFinalLevel = 100;
        this.playerSurvivalTime = this.matchTime;
      } else {
        this.spectateTargetId = king.id;
        if (!this.killedBy) {
          this.killedBy = king.name;
          this.deathCause = `${king.name} reunited all 100 fragments first`;
          this.playerFinalLevel = this.getPlayer().level;
          this.playerSurvivalTime = this.matchTime;
        }
      }
      return;
    }

    if (aliveKelis.length === 0) {
      this.status = 'draw';
      for (const [pid, meta] of this.playerMetaById.entries()) {
        const entity = this.getPlayer(pid);
        if (entity.alive || meta.survivalTime === 0) {
          meta.finalLevel = entity.level;
          meta.survivalTime = this.matchTime;
        }
      }
      if (this.getPlayer().alive || this.playerSurvivalTime === 0) {
        this.playerFinalLevel = this.getPlayer().level;
        this.playerSurvivalTime = this.matchTime;
      }
    }
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

    // Keep the last required carcass identifiable when player is the sole survivor < 100
    let lastRequiredCarcass: { x: number; z: number; mass: number } | null = null;
    if (aliveKelis.length === 1 && aliveKelis[0].id === p.id && p.level < 100 && this.carcasses.length > 0) {
      const c = this.carcasses[0];
      lastRequiredCarcass = { x: c.x, z: c.z, mass: c.mass };
    }

    // Off-screen indicators for confirmed sonar targets
    const offscreenIndicators: HudSnapshot['offscreenIndicators'] = [];
    for (const contact of sonarContacts) {
      const dx = contact.x - focus.x;
      const dz = contact.z - focus.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 260) {
        offscreenIndicators.push({
          id: contact.id,
          kind: contact.kind,
          screenAngle: Math.atan2(dz, dx),
          distance: Math.round(dist),
          level: contact.level,
        });
      }
    }

    const feedingCarcass = focus.feedingTargetId
      ? this.carcasses.find((c) => c.id === focus.feedingTargetId) ?? null
      : null;

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
    const hasCarcassInRange =
      p.alive &&
      this.carcasses.some((c) => Math.hypot(c.x - p.x, c.z - p.z) <= 54 + playerRadius + 22);

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
        venomActive: p.venomTimer > 0,
        frenzyActive: p.frenzyTimer > 0,
        surgeTimeLeft: p.surgeTimer,
        predatorTimeLeft: p.predatorTimer,
        aegisTimeLeft: p.aegisTimer,
        dewTimeLeft: p.dewTimer,
        stormFinTimeLeft: p.stormFinTimer,
        thunderRoeTimeLeft: p.thunderRoeTimer,
        veilActive: p.veilTimer > 0,
        sonarActive: focus.sonarTimer > 0,
        sonarIsHunter: focus.sonarIsHunter,
        sonarTimeLeft: focus.sonarTimer,
        feedingProgress: focus.feedingProgress,
        feedingDuration: focus.feedingDuration,
        feedingTargetName: feedingCarcass ? `${feedingCarcass.sourceName} (+${feedingCarcass.mass})` : null,
        cooldowns: { ...p.cooldowns },
        kills: p.kills,
        hasPreyInRange,
        hasCarcassInRange,
        x: focus.x,
        z: focus.z,
        facingAngle: focus.facingAngle,
      },
      zone: { ...this.zone },
      weather: { ...this.weather },
      sonarContacts,
      pickups: this.pickups.map((pk) => ({
        id: pk.id,
        kind: pk.kind,
        x: pk.x,
        z: pk.z,
        rainFed: pk.rainFed,
      })),
      lastRequiredCarcass,
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
      matchResult: {
        status: perPlayerStatus,
        winnerName: this.winnerName,
        killedBy: meta ? meta.killedBy : this.killedBy,
        deathCause: meta ? meta.deathCause : this.deathCause,
        massTransferredTo: meta ? meta.massTransferredTo : this.massTransferredTo,
        finalLevel: p.alive ? p.level : meta ? meta.finalLevel : this.playerFinalLevel,
        kills: p.kills,
        survivalTime: p.alive
          ? this.matchTime
          : meta
          ? meta.survivalTime
          : this.playerSurvivalTime,
        ledger: [...this.ledger],
      },
    };
  }

  public getRemoteWorldStateFor(playerId: string, tick: number): WorldStatePacket {
    const hud = this.getHudSnapshot(playerId);
    const meta = this.playerMetaById.get(playerId);
    const sfx = meta ? meta.pendingSfx.splice(0, meta.pendingSfx.length) : [];
    const shake = meta ? meta.cameraShake : this.cameraShake;

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
        stunTimer: Math.round(k.stunTimer * 100) / 100,
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
        sonarTimer: Math.round(k.sonarTimer * 100) / 100,
        sonarIsHunter: k.sonarIsHunter,
        kills: k.kills,
        feedingTargetId: k.feedingTargetId,
        feedingProgress: Math.round(k.feedingProgress * 100) / 100,
        feedingDuration: Math.round(k.feedingDuration * 100) / 100,
        cooldowns: { ...k.cooldowns },
      }));

    return {
      tick,
      serverTime: Date.now(),
      matchTime: this.matchTime,
      status: hud.matchResult.status,
      cameraShake: shake,
      zone: { ...this.zone },
      weather: { ...this.weather },
      kelis,
      carcasses: this.carcasses.map((c) => ({
        ...c,
        x: Math.round(c.x * 10) / 10,
        z: Math.round(c.z * 10) / 10,
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
      hud,
      sfx,
    };
  }
}

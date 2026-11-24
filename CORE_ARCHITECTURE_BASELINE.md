# AWANG KELI: BATTLE FOR WANG KELIAN — CORE ARCHITECTURE BASELINE

- **Core Architecture Version**: `1.0.0-core-freeze`
- **Structural Status**: `CORE_STRUCTURE_COMPLETE`
- **Scope**: Incremental structural baseline consolidating Gameplay Improvements 01–10.

---

## 1. Preserved Gameplay Invariants (Updates 01–10)

1. **100-Fragment Mass Conservation (Update 01)**:
   - Every match starts and ends with exactly `100` integer evolution fragments conserved across all living Kelis and carcasses (`sum(living.level) + sum(carcass.remainingMass) === 100`).
   - All transfers are atomic integer operations; bounties and match scores never mint or destroy evolution fragments.
   - Single-fire authoritative Level `100` Keli King victory resolution.
2. **Directional Bite Combat & Counterplay (Update 02)**:
   - Directional arc bite windup/strike/recovery, Slip Evade i-frames, stamina & fatigue, stun resistance & stagger windows, directional hit feedback.
3. **Contested Progressive Carcass Feeding (Update 03)**:
   - Progressive feeding ticks, multi-Keli contested feeding, interruption & recovery windows, shoreline/water carcass accessibility safeguards.
4. **Utility-Based AI System (Update 04)**:
   - Four distinct personalities (`aggressive`, `opportunistic`, `cautious`, `scavenger`), three difficulty tiers (`easy`, `normal`, `hard`), deterministic seeded decisions, spatial grid indexing, obstacle-aware steering.
5. **Deterministic Locomotion & Collision (Update 05)**:
   - Evolution-dependent movement speeds and terrain rules (Lv.1–39 aquatic-only; Lv.40–79 amphibious shore-crawling with 2 arms and NO legs + shore exposure reserve; Lv.80+ full amphibious mobility), swept collision & shoreline sliding, client reconciliation, mobile touch joystick.
6. **Match Pacing & Activity Hotspots (Update 06)**:
   - Lobby-size pacing profiles (`5`, `10`, `20`, `25`, `50`, `100`), `MatchPacingDirector`, fair spawn spacing, three match phases (`early`, `mid`, `endgame`), activity hotspots.
7. **Evolution Presentations & Sprite Fidelity (Update 07)**:
   - Approved catfish anatomy (glossy completely black featureless eyes, Lv.40–79 two arms/no legs, Lv.80+ full limbs), Level 40 First Reformation, Level 80 Amphibious Ascension, Keli King Victory → Regal Idle, multiplayer presentation guards.
8. **Dynamic World Events (Update 08)**:
   - Four deterministic environmental events (`Kepala Air` flash flood, `Air Keruh` silt bloom, `Pusaran Dalam` whirlpool, `Jaring Hanyut` drifting net) managed by `EnvironmentalEventDirector` with authoritative multiplayer synchronization.
9. **Endgame Confrontation & Presentation Guard (Update 09)**:
   - `EndgameDirector` substates (`FINAL_CONVERGENCE`, `FINAL_HUNT`, `FINAL_FEAST`, `KELI_KING_VICTORY`), `EndgamePresentationGuard`, Final Hunt AI aggression, accelerated Final Feast, Node.js v22 native TypeScript ESM startup compatibility.
10. **Permanent 60/40 Final Arena & Cross-Platform Architecture (Update 10)**:
    - Permanent final safe zone centered on the existing Wang Kelian shoreline at `(3820, 3560)`, radius `480u`:
      - **59.89% playable dry land** (tolerance `57%–63%`)
      - **40.11% playable water** (tolerance `37%–43%`, 100% single connected swim body)
      - **0.15% blocked obstacles excluded**
    - Single-fire permanent lock (`finalZoneLocked = true`, `finalZoneLockSeq = 1`): once reached, safe-zone contraction halts permanently.
    - Fair non-shrinking stalemate information pulses replace post-lock shrinking (respects Silt Veil stealth, never teleports Kelis, never modifies stats, never spawns free fragments).
    - Deterministic draw resolution (`resolveDraw`) prevents unrecoverable zero-survivor stalls.

---

## 2. Platform Capability Matrix

| Capability | Standalone Web (`standalone`) | Android / Capacitor (`android`) | YouTube Playables (`youtube`) |
| --- | :---: | :---: | :---: |
| Core Simulation & 60/40 Final Arena | Yes | Yes | Yes |
| Local AI Battle Royale (5–100 Kelis) | Yes | Yes | Yes |
| Real-Time Authoritative WS Multiplayer | Yes | Yes | **No (Disabled)** |
| Global/Regional External Leaderboard API | Yes | Yes | **No (Disabled)** |
| WebRTC Spatial Proximity Voice | Yes | Yes | **No (Disabled)** |
| Official YouTube Playables SDK (`ytgame`) | No | No | **Yes** |
| Cloud Save (`ytgame.game.loadData/saveData`) | No (localStorage) | No (localStorage) | **Yes (Zero localStorage)** |
| Deterministic Engagement Score (`sendScore`) | Local summary | Local summary | **Yes (Deduplicated)** |
| Visual-Only Graphics Quality Modes | Auto/Low/Med/High | Auto/Low/Med/High | Auto/Low/Med/High |
| Touch + Desktop + Responsive Aspect Ratios | Yes | Yes | Yes |

---

## 3. Reproducible Build & Verification Commands

- **Type-check**: `npm run lint` (`tsc --noEmit`)
- **Automated Test Suite (13 suites, 229 tests)**: `npm test` (`tsx --test tests/*.test.ts`)
- **Standalone Web Build (`dist/`)**: `npm run build:standalone`
- **Android Web Bundle Build (`dist/`)**: `npm run build:android` (sync with `npm run android:sync`)
- **YouTube Playables Build (`dist-youtube/`) + Automated Audit**: `npm run build:youtube`
- **Standalone YouTube Audit Only**: `npm run audit:youtube`
- **Production Node.js v22 Server Start**: `NODE_ENV=production node server.ts` (verify `GET /api/health`)

---

## 4. Deployment Prerequisites & Verification Limits

- **Standalone Web / Multiplayer Server**: Node.js v22+, reverse proxy with WebSocket upgrade support (`/ws`) and HTTP health probe (`/api/health`).
- **Android Packaging**: Android SDK / Gradle + Capacitor (`npx cap sync android`), release keystore for Play Store AAB signing, and live physical device testing.
- **YouTube Playables Submission**: Requires Google Play / YouTube Playables Partner Portal upload of zipped `dist-youtube/` and official verification inside the live YouTube Playables SDK Test Suite browser harness.

---

## 5. Known Limitations (Honest Scope Disclosure)

- Headless CI/container tests verify deterministic simulation performance, bundle compliance, SDK contract integration with mocks, and Node.js v22 production startup; they cannot replace live WebGL GPU frame profiling on physical low-end Android phones, multi-client internet WebSocket load testing, or YouTube Partner Portal runtime certification.
- Audio playback in browsers still obeys standard autoplay user-gesture rules until initial interaction (and respects `ytgame.system.isAudioEnabled()` / `onAudioEnabledChange()` in YouTube Playables).

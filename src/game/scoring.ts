import type { HudSnapshot } from './types.ts';

export const SCORE_FORMULA_VERSION = 1;

export interface MatchScoreInput {
  defeatedOpponents: number;
  consumedFragments: number;
  survivalSeconds: number;
  finalLevel: number;
  isKeliKingVictory: boolean;
  matchCompleted: boolean;
}

export interface MatchScoreBreakdown {
  readonly formulaVersion: number;
  readonly totalScore: number;
  readonly defeatedScore: number;
  readonly fragmentScore: number;
  readonly survivalScore: number;
  readonly milestoneScore: number;
  readonly victoryBonus: number;
  readonly completionBonus: number;
}

/**
 * Deterministic, auditable match scoring formula for local AI Battle Royale runs
 * and YouTube Playables engagement score submission.
 *
 * Completely independent of the conserved 100 integer evolution fragment economy.
 */
export function computeMatchScore(input: MatchScoreInput): MatchScoreBreakdown {
  const kills = Math.max(0, Math.floor(input.defeatedOpponents));
  const frags = Math.max(0, Math.min(100, Math.floor(input.consumedFragments)));
  const survival = Math.max(0, Math.floor(input.survivalSeconds));
  const level = Math.max(1, Math.min(100, Math.floor(input.finalLevel)));

  const defeatedScore = kills * 250;
  const fragmentScore = frags * 15;
  const survivalScore = Math.min(2400, survival * 4);

  let milestoneScore = 0;
  if (level >= 20) milestoneScore += 100;
  if (level >= 40) milestoneScore += 300;
  if (level >= 60) milestoneScore += 250;
  if (level >= 80) milestoneScore += 600;

  const victoryBonus = input.isKeliKingVictory && level === 100 ? 1500 : 0;
  const completionBonus = input.matchCompleted ? 200 : 0;

  const totalScore =
    defeatedScore +
    fragmentScore +
    survivalScore +
    milestoneScore +
    victoryBonus +
    completionBonus;

  return {
    formulaVersion: SCORE_FORMULA_VERSION,
    totalScore,
    defeatedScore,
    fragmentScore,
    survivalScore,
    milestoneScore,
    victoryBonus,
    completionBonus,
  };
}

export function computeMatchScoreFromHud(hud: HudSnapshot): MatchScoreBreakdown {
  const isKing = hud.matchResult.status === 'victory' && hud.matchResult.finalLevel === 100;
  const consumed = Math.max(0, hud.matchResult.finalLevel - 1);
  return computeMatchScore({
    defeatedOpponents: hud.matchResult.kills,
    consumedFragments: consumed,
    survivalSeconds: hud.matchResult.survivalTime,
    finalLevel: hud.matchResult.finalLevel,
    isKeliKingVictory: isKing,
    matchCompleted: hud.matchResult.status !== 'playing',
  });
}

/**
 * Deduplicates match score submissions so the same completed match can never be submitted twice.
 */
export class ScoreSubmissionGuard {
  private readonly submittedMatchIds = new Set<string>();

  public canSubmit(matchId: string): boolean {
    return Boolean(matchId) && !this.submittedMatchIds.has(matchId);
  }

  public markSubmitted(matchId: string): boolean {
    if (!this.canSubmit(matchId)) return false;
    this.submittedMatchIds.add(matchId);
    // Keep bounded history
    if (this.submittedMatchIds.size > 128) {
      const oldest = this.submittedMatchIds.values().next().value;
      if (oldest !== undefined) {
        this.submittedMatchIds.delete(oldest);
      }
    }
    return true;
  }

  public reset(): void {
    this.submittedMatchIds.clear();
  }
}

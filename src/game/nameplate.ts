export interface NameplateCacheKeyInput {
  level: number;
  hpBucket: number;
  isPlayer: boolean;
  name: string;
  isHigherLevel: boolean;
  stunned: boolean;
  staggered: boolean;
  stunResist: boolean;
  evading: boolean;
  venom: boolean;
  speaking: boolean;
  emoteId: string;
  bountyPts: number;
}

export function formatEntityNameplateName(name: string | undefined | null, isPlayer: boolean): string {
  const cleaned = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (cleaned) return cleaned.slice(0, 12);
  return isPlayer ? 'Awang Keli' : 'Keli';
}

export function formatOverheadNameplateLabel(
  name: string | undefined | null,
  level: number,
  isPlayer: boolean,
  isSpeaking = false
): string {
  const resolved = formatEntityNameplateName(name, isPlayer);
  const baseLabel = `Lv.${level} ${resolved}`;
  return isSpeaking ? `(( )) ${baseLabel}` : baseLabel;
}

export function buildNameplateCacheKey(input: NameplateCacheKeyInput): string {
  return [
    input.level,
    input.hpBucket,
    input.isPlayer ? 1 : 0,
    input.name,
    input.isHigherLevel ? 'd' : 'p',
    input.stunned ? 's' : '',
    input.staggered ? 'g' : '',
    input.stunResist ? 'r' : '',
    input.evading ? 'e' : '',
    input.venom ? 'v' : '',
    input.speaking ? 'm' : '',
    input.emoteId,
    input.bountyPts,
  ].join('|');
}

export function resolveHudDisplayName(options: {
  isSpectating: boolean;
  spectateTargetName?: string | null;
  authoritativePlayerName?: string | null;
  fallbackPlayerName?: string | null;
}): string {
  if (options.isSpectating) {
    const specName = options.spectateTargetName?.trim();
    return specName || 'Final Kelis';
  }
  const authName = options.authoritativePlayerName?.trim();
  if (authName) return authName;
  const fallback = options.fallbackPlayerName?.trim();
  if (fallback) return fallback;
  return 'Awang Keli';
}

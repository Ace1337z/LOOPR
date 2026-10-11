/**
 * LOOPR Casual ELO.
 *
 * Plain ELO is trivially farmable: two accounts, alternate throwaway wins,
 * inflate both ratings. So every result here is discounted by how much it
 * actually proves:
 *
 *   - tag confidence  a logged training drill proves less than a league result
 *   - provisional     a new player moves fast, but is pulled back to the mean
 *   - opponent info   beating someone with no history proves very little
 *
 * Sanctioned (tournament) ELO is NOT computed here. It arrives from organisers
 * and is trusted, so mixing the two would let a 40-year-old veteran decay by
 * losing a friendly to a beginner.
 */

export type MatchTag = 'friendly' | 'training' | 'ladder' | 'league';

export interface EloPlayer {
  /** Stable player id. Used to reject self-matches; omit only in pure maths tests. */
  id?: string;
  rating: number;
  /** Matches already logged, including this one. */
  gamesPlayed: number;
}

export interface EloInput {
  player: EloPlayer;
  opponent: EloPlayer;
  /** 1 = player won, 0 = player lost. */
  score: 0 | 1;
  tag: MatchTag;
  /** Matches these two have already played. Absent = never played. */
  repeatPairMatches?: number;
}

export interface EloDelta {
  delta: number;
  rating: number;
  /** False once the player has served enough matches to trust the number. */
  provisional: boolean;
}

export interface EloPair {
  winner: EloDelta;
  loser: EloDelta;
}

export const DEFAULT_RATING = 1500;
export const PROVISIONAL_MATCHES = 8;
export const MIN_RATING = 100;
export const MAX_RATING = 3000;

const K_STABLE = 32;
const K_PROVISIONAL = 48;

/** Fraction of a provisional rating's gap to the population mean that is closed per match. */
const MEAN_REGRESSION = 0.25;

/** Beating a player with no history is barely evidence. */
const UNPROVEN_OPPONENT_DISCOUNT = 0.5;

/**
 * A-B-A-B farming keeps opponents inside the same tight rating band, so the
 * discount above never bites. Rematches decay instead: the third meeting
 * between two players proves much less than the first.
 */
const REPEAT_PAIR_DISCOUNTS = [1, 0.6, 0.35, 0.2, 0.1];

function repeatPairDiscount(repeatPairMatches = 0): number {
  return REPEAT_PAIR_DISCOUNTS[Math.min(repeatPairMatches, REPEAT_PAIR_DISCOUNTS.length - 1)];
}

const TAG_CONFIDENCE: Record<MatchTag, number> = {
  training: 0.5,
  friendly: 0.8,
  ladder: 1,
  league: 1,
};

export function isProvisional(gamesPlayed: number): boolean {
  return gamesPlayed < PROVISIONAL_MATCHES;
}

export function tagConfidence(tag: MatchTag): number {
  return TAG_CONFIDENCE[tag] ?? 0.8;
}

/** Probability the player beats the opponent, pre-result. */
export function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

function clamp(rating: number): number {
  // Guards Infinity/NaN reaching storage from absurd inputs.
  if (!Number.isFinite(rating)) return DEFAULT_RATING;
  return Math.min(MAX_RATING, Math.max(MIN_RATING, rating));
}

function step(player: EloPlayer, opponent: EloPlayer, score: 0 | 1, tag: MatchTag, pairDiscount: number): EloDelta {
  const playerProvisional = isProvisional(player.gamesPlayed);
  const opponentProvisional = isProvisional(opponent.gamesPlayed);

  const expected = expectedScore(player.rating, opponent.rating);
  const k = (playerProvisional ? K_PROVISIONAL : K_STABLE) * tagConfidence(tag);
  const discount = (opponentProvisional ? UNPROVEN_OPPONENT_DISCOUNT : 1) * pairDiscount;

  let delta = k * discount * (score - expected);

  if (playerProvisional) {
    // Pull back toward the mean, but keep most of the genuine result.
    const regression = (DEFAULT_RATING - player.rating) * MEAN_REGRESSION;
    delta = delta * (1 - MEAN_REGRESSION) + regression;
  }

  const rating = clamp(Math.round(player.rating + delta));
  return {
    delta: rating - player.rating,
    rating,
    provisional: isProvisional(player.gamesPlayed + 1),
  };
}

/** Rates both sides of one result. Callers must persist winner and loser together. */
export function ratePair(input: EloInput): EloPair {
  const { player, opponent, score, tag } = input;

  if (!Number.isInteger(score) || (score !== 0 && score !== 1)) {
    throw new RangeError(`score must be 0 or 1, received ${String(score)}`);
  }
  if (input.repeatPairMatches != null && input.repeatPairMatches < 0) {
    throw new RangeError('repeatPairMatches cannot be negative');
  }
  // Rating alone cannot detect a self-match: two distinct players can both sit
  // at 1500 with 20 games. Only identity can.
  if (player.id != null && player.id === opponent.id) {
    throw new RangeError('a player cannot be logged as their own opponent');
  }

  const pairDiscount = repeatPairDiscount(input.repeatPairMatches);
  const winner = score === 1 ? player : opponent;
  const loser = score === 1 ? opponent : player;

  return {
    winner: step(winner, loser, 1, tag, pairDiscount),
    loser: step(loser, winner, 0, tag, pairDiscount),
  };
}

/**
 * Best-of-N set scores. Table tennis is best of 3 or 5, so the loser can still
 * take half the games. Returns null when the score is not a completed match.
 */
export function validateSetScore(
  winnerSets: number,
  loserSets: number,
  bestOf: 3 | 5,
): { valid: true } | { valid: false; reason: string } {
  if (!Number.isInteger(winnerSets) || !Number.isInteger(loserSets)) {
    return { valid: false, reason: 'set counts must be whole numbers' };
  }
  if (winnerSets < 0 || loserSets < 0) {
    return { valid: false, reason: 'set counts cannot be negative' };
  }

  const target = (bestOf + 1) / 2;
  if (winnerSets !== target) {
    return { valid: false, reason: `a best-of-${bestOf} match is won at ${target} sets, received ${winnerSets}` };
  }
  if (loserSets >= target || loserSets > target - 1) {
    return { valid: false, reason: `loser cannot take ${loserSets} sets in a best-of-${bestOf}` };
  }
  return { valid: true };
}
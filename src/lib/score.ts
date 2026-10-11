/**
 * Set score editing for a logged match.
 *
 * Kept out of the screen because the clamping rules are easy to get wrong and
 * worth testing: a player must never be able to enter 2-2 in a best-of-3, and
 * "best of 5" is chosen by the total games played, not toggled by hand.
 */

export type Format = 3 | 5;

export interface Score {
  mine: number;
  theirs: number;
  format: Format;
}

export const INITIAL_SCORE: Score = { mine: 0, theirs: 0, format: 3 };

/** Sets needed to win, e.g. 2 for best-of-3. */
export function setsToWin(format: Format): number {
  return (format + 1) / 2;
}

/**
 * Best-of-5 requires five or more games played, so a 2-2 score is still
 * best-of-3 until someone takes the fifth set.
 */
export function inferFormat(mine: number, theirs: number): Format {
  return mine + theirs >= 3 ? 5 : 3;
}

/**
 * Total sets a losing side may have, given the format.
 *
 * Best-of-3: loser may hold 0 or 1. Best-of-5: loser may hold 0, 1 or 2. Note
 * a 2-2 score is reachable in best-of-5 while still undecided, which is exactly
 * why this takes the format rather than reading the totals.
 */
export function maxLoserSets(format: Format): number {
  return setsToWin(format) - 1;
}

/**
 * Applies a step to one side, keeping the score a legal unfinished-or-finished
 * result. Adding to the trailing side can complete the match; adding to the
 * leading side just moves the deficit along.
 *
 * If the player is already a set ahead, stepping the opponent is the only way
 * to grow the match, so `side` is honoured rather than assumed to be the
 * player.
 */
export function adjust(score: Score, side: 'mine' | 'theirs', delta: 1 | -1): Score {
  const target = setsToWin(score.format);
  const mine = Math.max(0, score.mine + (side === 'mine' ? delta : 0));
  const theirs = Math.max(0, score.theirs + (side === 'theirs' ? delta : 0));

  const leader: 'mine' | 'theirs' = mine === theirs ? 'mine' : mine > theirs ? 'mine' : 'theirs';
  const leaderSets = leader === 'mine' ? mine : theirs;
  const trailerSets = leader === 'mine' ? theirs : mine;

  // A leader cannot exceed what the format allows without the match ending.
  if (leaderSets > target) {
    return score;
  }
  // The trailer may not tie or lead: that would be a different result, so the
  // leading side is pushed up instead to keep the recorded winner correct.
  if (trailerSets > maxLoserSets(score.format)) {
    return leader === 'mine' ? { ...score, mine: target } : { ...score, theirs: target };
  }

  const next = leader === 'mine' ? { mine, theirs } : { mine: theirs, theirs: mine };
  return { ...next, format: inferFormat(mine, theirs) };
}

export function isFinished(score: Score): boolean {
  const target = setsToWin(score.format);
  return score.mine === target || score.theirs === target;
}

export function winnerOf(score: Score): 'mine' | 'theirs' | null {
  const target = setsToWin(score.format);
  if (score.mine === target) return 'mine';
  if (score.theirs === target) return 'theirs';
  return null;
}
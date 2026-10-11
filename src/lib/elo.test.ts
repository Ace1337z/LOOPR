/**
 * Self-check for the ELO engine. Run: npm test
 *
 * These encode the anti-farming rules, not just arithmetic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RATING,
  PROVISIONAL_MATCHES,
  expectedScore,
  isProvisional,
  ratePair,
  validateSetScore,
  type EloPlayer,
} from './elo.ts';

const novice = (rating = DEFAULT_RATING, gamesPlayed = 0): EloPlayer => ({ rating, gamesPlayed });

test('even matchup is a coin flip', () => {
  assert.equal(expectedScore(1500, 1500), 0.5);
  assert.ok(Math.abs(expectedScore(1900, 1500) - 10 / 11) < 1e-9);
});

test('winning an even matchup gains rating, losing it drops', () => {
  const { winner, loser } = ratePair({
    player: novice(1500, 20),
    opponent: novice(1500, 20),
    score: 1,
    tag: 'friendly',
  });
  assert.ok(winner.delta > 0, 'winner gains');
  assert.ok(loser.delta < 0, 'loser drops');
  assert.equal(winner.rating + loser.rating, 3000, 'zero-sum when both stable');
});

test('rematch farming with one opponent barely moves the rating', () => {
  // A-B-A-B: farmer alternates wins off a single willing partner. Without the
  // rematch discount this pattern inflates both by ~12 points a game.
  const farmer = { id: 'farmer', rating: 1500, gamesPlayed: 50 };
  let opponent = { id: 'partner', rating: 1500, gamesPlayed: 50 };
  let rating = farmer.rating;

  for (let i = 0; i < 20; i++) {
    const result = ratePair({
      player: { ...farmer, rating },
      opponent,
      score: 1,
      tag: 'friendly',
      repeatPairMatches: i,
    });
    rating = result.winner.rating;
    opponent = { ...opponent, rating: result.loser.rating, gamesPlayed: opponent.gamesPlayed + 1 };
  }
  assert.ok(rating < 1600, `rematch farming must saturate, landed at ${rating}`);
});

test('beating a much weaker player gains less than beating an equal', () => {
  const base = { gamesPlayed: 50 } as const;
  const vsWeak = ratePair({ player: { ...base, rating: 2000 }, opponent: { ...base, rating: 1500 }, score: 1, tag: 'ladder' }).winner.delta;
  const vsEven = ratePair({ player: { ...base, rating: 1500 }, opponent: { ...base, rating: 1500 }, score: 1, tag: 'ladder' }).winner.delta;
  assert.ok(vsWeak < vsEven, `upsets must be worth less: ${vsWeak} vs ${vsEven}`);
});

test('training matches move ratings less than league matches', () => {
  const base = { player: novice(1500, 50), opponent: novice(1500, 50), score: 1, repeatPairMatches: 0 } as const;
  const training = ratePair({ ...base, tag: 'training' }).winner.delta;
  const league = ratePair({ ...base, tag: 'league' }).winner.delta;
  assert.ok(training < league, `${training} < ${league}`);
});

test('a first meeting is worth more than a fifth', () => {
  const base = { player: { rating: 1500, gamesPlayed: 50 }, opponent: { rating: 1500, gamesPlayed: 50 }, score: 1 as const, tag: 'ladder' as const };
  const first = ratePair({ ...base, repeatPairMatches: 0 }).winner.delta;
  const fifth = ratePair({ ...base, repeatPairMatches: 4 }).winner.delta;
  assert.ok(fifth < first, `${fifth} < ${first}`);
});

test('a new player regresses toward the mean after losing', () => {
  // Beat up on repeatedly, but a provisional account cannot drift far.
  let rating = DEFAULT_RATING;
  for (let i = 0; i < 6; i++) {
    rating = ratePair({
      player: { rating, gamesPlayed: i },
      opponent: novice(2200, 50),
      score: 0,
      tag: 'ladder',
    }).loser.rating;
  }
  assert.ok(rating > DEFAULT_RATING - 400, `provisional floor, landed at ${rating}`);
});

test('provisional flag clears after the threshold', () => {
  assert.equal(isProvisional(PROVISIONAL_MATCHES - 1), true);
  assert.equal(isProvisional(PROVISIONAL_MATCHES), false);
  const { winner } = ratePair({
    player: novice(1500, PROVISIONAL_MATCHES - 1),
    opponent: novice(1500, PROVISIONAL_MATCHES - 1),
    score: 1,
    tag: 'friendly',
  });
  assert.equal(winner.provisional, false);
});

test('rating is clamped to sane bounds', () => {
  const { winner } = ratePair({
    player: novice(2990, 100),
    opponent: novice(100, 100),
    score: 1,
    tag: 'league',
  });
  assert.ok(winner.rating <= 3000, `clamped high, got ${winner.rating}`);
});

test('rejects invalid input', () => {
  assert.throws(
    () => ratePair({ player: novice(), opponent: novice(), score: 0.5 as never, tag: 'friendly' }),
    RangeError,
  );
  assert.throws(
    () => ratePair({ player: { ...novice(), id: 'a' }, opponent: { ...novice(), id: 'a' }, score: 1, tag: 'friendly' }),
    RangeError,
    'self-match',
  );
  // Distinct players sharing identical stats is legal and must not throw.
  assert.doesNotThrow(() =>
    ratePair({ player: { ...novice(), id: 'a' }, opponent: { ...novice(), id: 'b' }, score: 1, tag: 'friendly' }),
  );
});

test('set score validation matches best-of-N', () => {
  assert.equal(validateSetScore(2, 0, 3).valid, true);
  assert.equal(validateSetScore(2, 1, 3).valid, true);
  assert.equal(validateSetScore(3, 2, 5).valid, true);
  assert.equal(validateSetScore(2, 2, 3).valid, false, '2-2 is not a best-of-3');
  assert.equal(validateSetScore(1, 0, 3).valid, false, 'match is not finished');
  assert.equal(validateSetScore(2, 2, 5).valid, false, '2-2 is not a best-of-5 finish');
  assert.equal(validateSetScore(-1, 0, 3).valid, false);
});
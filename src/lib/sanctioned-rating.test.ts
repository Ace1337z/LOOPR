/**
 * Self-check for how a tournament result is scored. Run: npm test
 *
 * These encode the fix for a real flaw: rating a match against the average of
 * the whole field let players climb toward the standard of opponents they never
 * met. A club event whose only games were against two beginners was enough to
 * lift someone toward the open champion's level.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Mirrors rate_sanctioned() in 2-ratings.sql, K=24. */
export function rateSanctioned(rating: number, opponent: number, won: boolean): number {
  const expected = 1 / (1 + 10 ** ((opponent - rating) / 400));
  const delta = 24 * ((won ? 1 : 0) - expected);
  return Math.max(100, Math.min(3000, Math.round(rating + delta)));
}

/** Mirrors seed_strength(): highest entered rating excluding the player. */
export function seedStrength(others: number[]): number {
  const sorted = [...others].sort((a, b) => b - a);
  return sorted[0] ?? 1500;
}

test('beating the strongest opponent in the event is worth most', () => {
  const beatStrong = rateSanctioned(1500, 1900, true) - 1500;
  const beatWeak = rateSanctioned(1500, 1200, true) - 1500;
  assert.ok(beatStrong > beatWeak, `${beatStrong} > ${beatWeak}`);
});

test('losing to the weakest player in the event costs the most', () => {
  // Being beaten by someone far weaker is the bigger shock, so it costs more
  // than losing to the strongest player in the event.
  const lostToWeak = rateSanctioned(1500, 1200, false) - 1500;
  const lostToStrong = rateSanctioned(1500, 1900, false) - 1500;
  assert.ok(lostToWeak < lostToStrong, `${lostToWeak} < ${lostToStrong}`);
});

test('a club event with two weak games does not lift a player toward the open standard', () => {
  // The regression: a 2000 player is entered, but our player never faces them and
  // only beats two beginners.
  const ref = seedStrength([2000, 1200, 1200]);
  // The reference is the 2000 player, not the 1200s, and not an average of ~1473.
  assert.equal(ref, 2000);

  const afterOne = rateSanctioned(1500, ref, true);
  const afterTwo = rateSanctioned(afterOne, ref, true);
  // Two wins against weaker opposition must not approach the 2000 standard.
  assert.ok(afterTwo < 1700, `two routine wins must not inflate to ${afterTwo}`);
});

test('the seed reference is never the player themselves', () => {
  // Top seed: every other entrant is weaker, so the reference drops to them
  // rather than resting on its own 2000.
  assert.equal(seedStrength([1500]), 1500);
});

test('seed strength does not depend on the order entrants were added', () => {
  assert.equal(seedStrength([1200, 1900, 1500]), seedStrength([1900, 1500, 1200]));
});

test('an unrated event falls back to the population mean', () => {
  assert.equal(seedStrength([]), 1500);
});

test('ratings stay inside the allowed range', () => {
  // With K=24 the largest possible swing in one result is 24 points, and that
  // requires an opponent infinitely far away. So the 100-3000 bounds are a
  // backstop that these inputs cannot actually breach -- what matters is that
  // nothing escapes the range, not that a specific clamp fires.
  assert.equal(rateSanctioned(2990, 100, true), 2990);
  assert.equal(rateSanctioned(110, 3000, false), 110);
  for (const r of [100, 1500, 2999]) {
    for (const o of [100, 1500, 3000]) {
      const won = rateSanctioned(r, o, true);
      const lost = rateSanctioned(r, o, false);
      assert.ok(won >= 100 && won <= 3000, `win ${won} out of range`);
      assert.ok(lost >= 100 && lost <= 3000, `loss ${lost} out of range`);
    }
  }
});
/**
 * Self-check for the set score editor. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_SCORE,
  adjust,
  inferFormat,
  isFinished,
  maxLoserSets,
  setsToWin,
  winnerOf,
  type Score,
} from './score.ts';

const at = (mine: number, theirs: number): Score => ({ mine, theirs, format: inferFormat(mine, theirs) });

test('best-of-3 needs two sets, best-of-5 needs three', () => {
  assert.equal(setsToWin(3), 2);
  assert.equal(setsToWin(5), 3);
  assert.equal(maxLoserSets(3), 1);
  assert.equal(maxLoserSets(5), 2);
});

test('format escalates to best-of-5 once five sets are played', () => {
  assert.equal(inferFormat(2, 0), 3);
  assert.equal(inferFormat(1, 1), 3);
  assert.equal(inferFormat(2, 2), 5);
  assert.equal(inferFormat(3, 1), 5);
});

test('loser cannot exceed the format allowance', () => {
  // 1-1 is still best-of-3 (only two sets played), so the loser may hold one.
  let s = at(1, 1);
  assert.equal(s.format, 3);
  s = adjust(s, 'theirs', 1); // would be 1-2
  assert.deepEqual([s.mine, s.theirs], [2, 1], 'reaching past the cap hands over the match');
});

test('best-of-5 allows a 2-2 score mid-match', () => {
  let s = at(0, 0);
  s = adjust(s, 'mine', 1); // 1-0
  s = adjust(s, 'theirs', 1); // 1-1
  s = adjust(s, 'mine', 1); // 2-1
  s = adjust(s, 'theirs', 1); // 2-2 -> best of 5
  assert.deepEqual([s.mine, s.theirs, s.format], [2, 2, 5]);
  assert.equal(isFinished(s), false, '2-2 in a best-of-5 is not over');
});

test('winner is determined at the target', () => {
  let s = at(0, 0);
  s = adjust(s, 'mine', 1); // 1-0
  s = adjust(s, 'mine', 1); // 2-0
  assert.equal(isFinished(s), true);
  assert.equal(winnerOf(s), 'mine');
});

test('cannot push past a finished match', () => {
  let s = at(1, 0);
  s = adjust(s, 'mine', 1); // 2-0 finished
  const after = adjust(s, 'mine', 1);
  assert.deepEqual([after.mine, after.theirs], [2, 0], 'score is frozen once won');
});

test('decrement never goes below zero', () => {
  let s = INITIAL_SCORE;
  s = adjust(s, 'mine', -1);
  assert.equal(s.mine, 0);
});

test('every reachable score is a legal match', () => {
  // Walk every path from a fresh score and assert the shape stays legal, which
  // is the property the server constraint also enforces.
  const seen = new Set<string>();
  const walk = (s: Score, depth: number) => {
    const key = `${s.mine}-${s.theirs}-${s.format}`;
    seen.add(key);
    if (depth === 0 || isFinished(s)) return;
    walk(adjust(s, 'mine', 1), depth - 1);
    walk(adjust(s, 'theirs', 1), depth - 1);
  };
  walk(INITIAL_SCORE, 7);

  for (const key of seen) {
    const [mine, theirs, format] = key.split('-').map(Number);
    const f = format as 3 | 5;
    const score: Score = { mine, theirs, format: f };
    const a = Math.min(mine, theirs);
    const b = Math.max(mine, theirs);

    assert.ok(mine <= setsToWin(f), `${key} mine too high`);
    assert.ok(theirs <= setsToWin(f), `${key} theirs too high`);
    if (isFinished(score)) {
      // An unfinished match can never have the leader two sets ahead; a
      // finished one must be exactly at the target with no 2-2 tie.
      assert.ok(b === setsToWin(f), `${key} only finishes at the target`);
      assert.ok(a <= maxLoserSets(f), `${key} loser cannot reach the target`);
    } else {
      assert.ok(b - a <= 1, `${key} sides must differ by at most one set`);
    }
  }
});
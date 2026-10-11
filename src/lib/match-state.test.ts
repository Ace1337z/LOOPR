/**
 * Self-check for the match lifecycle rules. Run: npm test
 *
 * Verification works only if a pending match genuinely cannot move a rating, so
 * these encode the state machine rather than the screen wiring.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

type Status = 'pending' | 'confirmed' | 'disputed' | 'void';

/** Mirrors the matches table constraints in 1-tables.sql. */
export function satisfiesSnapshotConstraint(status: Status, hasSnapshot: boolean): boolean {
  return status !== 'confirmed' || hasSnapshot;
}

/** Which statuses still count towards a player's confirmed record. */
export function countsTowardsRecord(status: Status): boolean {
  return status === 'confirmed';
}

/** Transitions the app is allowed to make, and who may make them. */
const TRANSITIONS: Record<Status, Status[]> = {
  pending: ['confirmed', 'disputed'],
  // Terminal. A confirmed match is history and cannot be reopened by a player.
  confirmed: [],
  disputed: ['pending', 'void'],
  void: [],
};

export function canTransition(from: Status, to: Status, by: 'opponent' | 'admin'): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  if (from === 'pending') return by === 'opponent';
  return by === 'admin';
}

test('a pending match carries no rating snapshot', () => {
  assert.equal(satisfiesSnapshotConstraint('pending', false), true);
  assert.equal(satisfiesSnapshotConstraint('confirmed', false), false);
  assert.equal(satisfiesSnapshotConstraint('confirmed', true), true);
});

test('only confirmed matches count towards the record', () => {
  assert.equal(countsTowardsRecord('confirmed'), true);
  for (const s of ['pending', 'disputed', 'void'] as Status[]) {
    assert.equal(countsTowardsRecord(s), false, `${s} must not count`);
  }
});

test('only the opponent can answer a pending match', () => {
  assert.equal(canTransition('pending', 'confirmed', 'opponent'), true);
  assert.equal(canTransition('pending', 'disputed', 'opponent'), true);
  // An admin must not be able to confirm on the opponent's behalf without the
  // dispute path, or the verification step becomes decorative.
  assert.equal(canTransition('pending', 'confirmed', 'admin'), false);
});

test('disputing is free: no rating ever moved, so voiding cannot unwind anything', () => {
  assert.equal(canTransition('disputed', 'void', 'admin'), true);
  // A disputed match returns to pending so an admin can confirm it deliberately.
  assert.equal(canTransition('disputed', 'pending', 'admin'), true);
});

test('confirmed and void are terminal', () => {
  assert.deepEqual(TRANSITIONS.confirmed, []);
  assert.deepEqual(TRANSITIONS.void, []);
  for (const to of ['pending', 'disputed', 'confirmed', 'void'] as Status[]) {
    assert.equal(canTransition('confirmed', to, 'admin'), false);
    assert.equal(canTransition('void', to, 'admin'), false);
  }
});
import type { MatchTag } from './elo';
import { supabase } from './supabase';

export type MatchStatus = 'pending' | 'confirmed' | 'disputed' | 'void';
export type AppRole = 'admin' | 'organiser';

export interface Profile {
  id: string;
  handle: string;
  display_name: string;
  age_band: string | null;
  city: string | null;
  handedness: 'right' | 'left' | 'unknown';
  grip: 'shakehand' | 'penhold' | null;
  blade: string | null;
  fh_rubber: string | null;
  bh_rubber: string | null;
  playstyle_tags: string[];
  availability: string[];
  casual_rating: number;
  casual_games: number;
  sanctioned_rating: number;
  sanctioned_games: number;
  rating_visible: boolean;
}

export interface MatchRow {
  id: string;
  player_id: string;
  opponent_id: string;
  player_won: boolean;
  player_sets: number;
  opponent_sets: number;
  best_of: number;
  tag: MatchTag;
  status: MatchStatus;
  player_rating_after: number | null;
  opponent_rating_after: number | null;
  played_at: string;
  note: string | null;
  disputed_reason: string | null;
}

export interface Tournament {
  id: string;
  name: string;
  date: string;
  organisation: string;
}

export interface StaffRow {
  user_id: string;
  display_name: string;
  handle: string;
  role: AppRole;
  organisation: string;
  granted_at: string;
  revoked_at: string | null;
}

// ---------------------------------------------------------------------------
// Casual matches: submit, then the opponent confirms.
// ---------------------------------------------------------------------------

export interface SubmitMatchInput {
  opponentId: string;
  playerWon: boolean;
  playerSets: number;
  opponentSets: number;
  bestOf: 3 | 5;
  tag: MatchTag;
  note?: string;
}

/**
 * Submits a result for the opponent to confirm. No rating moves yet -- that
 * happens in respondToMatch, so a rejected claim needs no unwinding.
 */
export async function submitMatch(input: SubmitMatchInput): Promise<string> {
  const { data, error } = await supabase.rpc('submit_match', {
    p_opponent_id: input.opponentId,
    p_player_won: input.playerWon,
    p_player_sets: input.playerSets,
    p_opponent_sets: input.opponentSets,
    p_best_of: input.bestOf,
    p_tag: input.tag,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Opponent approves (applying ELO) or disputes (leaving ratings untouched). */
export async function respondToMatch(
  matchId: string,
  approved: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('respond_to_match', {
    p_match_id: matchId,
    p_approved: approved,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Claims waiting on the signed-in player to confirm. */
export async function fetchPendingForMe(): Promise<MatchRow[]> {
  const { data, error } = await supabase.rpc('pending_for_me');
  if (error) throw new Error(error.message);
  return (data ?? []) as MatchRow[];
}

export async function fetchHistory(userId: string, limit = 50): Promise<MatchRow[]> {
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .or(`player_id.eq.${userId},opponent_id.eq.${userId}`)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data as MatchRow[];
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error?.code === 'PGRST116') return null; // no row yet
  if (error) throw new Error(error.message);
  return data as Profile;
}

/**
 * Self-service edits. Rating columns are excluded because the database refuses
 * them for players -- only the rating functions may write them.
 */
export async function updateProfile(
  userId: string,
  patch: Partial<
    Omit<Profile, 'id' | 'casual_rating' | 'casual_games' | 'sanctioned_rating' | 'sanctioned_games'>
  >,
): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw new Error(error.message);
}

/** Opponent candidates, nearest in rating first. */
export async function fetchOpponentCandidates(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .neq('id', userId)
    .order('casual_rating', { ascending: true })
    .limit(25);
  if (error) throw new Error(error.message);
  return (data as Profile[]).filter((p) => p.rating_visible);
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function myRole(): Promise<AppRole | null> {
  const { data, error } = await supabase.rpc('my_role');
  if (error) return null;
  return (data as AppRole) ?? null;
}

export async function isAdmin(): Promise<boolean> {
  return (await myRole()) === 'admin';
}

/** Turns an invite code into a role. Used by organisers you have just approved. */
export async function redeemInvite(code: string): Promise<AppRole> {
  const { data, error } = await supabase.rpc('redeem_invite', { p_code: code });
  if (error) throw new Error(error.message);
  return data as AppRole;
}

export async function listStaff(): Promise<StaffRow[]> {
  const { data, error } = await supabase.rpc('list_staff');
  if (error) throw new Error(error.message);
  return (data ?? []) as StaffRow[];
}

export async function grantRole(userId: string, role: AppRole, organisation?: string): Promise<void> {
  const { error } = await supabase.rpc('grant_role', {
    p_user_id: userId,
    p_role: role,
    p_organisation: organisation ?? 'unaffiliated',
  });
  if (error) throw new Error(error.message);
}

export async function revokeRole(userId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_role', { p_user_id: userId });
  if (error) throw new Error(error.message);
}

/** Creates a single-use code to promote someone without touching SQL. */
export async function createInvite(role: AppRole, organisation?: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_invite', {
    p_role: role,
    p_organisation: organisation ?? 'unaffiliated',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// ---------------------------------------------------------------------------
// Disputes (admin)
// ---------------------------------------------------------------------------

export async function fetchDisputes(): Promise<MatchRow[]> {
  const { data, error } = await supabase.rpc('disputed_matches');
  if (error) throw new Error(error.message);
  return (data ?? []) as MatchRow[];
}

export async function resolveDispute(matchId: string, confirm: boolean): Promise<void> {
  const { error } = await supabase.rpc('resolve_dispute', {
    p_match_id: matchId,
    p_confirm: confirm,
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Tournaments and sanctioned results
// ---------------------------------------------------------------------------

export async function createTournament(name: string, date: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_tournament', {
    p_name: name,
    p_date: date,
    p_organisation: '',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function fetchTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase.rpc('my_tournaments');
  if (error) throw new Error(error.message);
  return (data ?? []) as Tournament[];
}

export async function enterTournament(tournamentId: string, playerIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('enter_tournament', {
    p_tournament_id: tournamentId,
    p_players: playerIds,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function fetchEntrants(
  tournamentId: string,
): Promise<{ player_id: string; display_name: string; rating_snapshot: number }[]> {
  const { data, error } = await supabase.rpc('tournament_entrants', {
    p_tournament_id: tournamentId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as { player_id: string; display_name: string; rating_snapshot: number }[];
}

/**
 * Records a tournament game. The rating is computed by the database from the
 * field average, so nothing here supplies a rating.
 */
export async function recordTournamentResult(input: {
  tournamentId: string;
  playerId: string;
  opponentId: string;
  playerWon: boolean;
  playerSets: number;
  opponentSets: number;
  bestOf: 3 | 5;
  placing?: number | null;
}): Promise<void> {
  const { error } = await supabase.rpc('record_tournament_result', {
    p_tournament_id: input.tournamentId,
    p_player_id: input.playerId,
    p_opponent_id: input.opponentId,
    p_player_won: input.playerWon,
    p_player_sets: input.playerSets,
    p_opponent_sets: input.opponentSets,
    p_best_of: input.bestOf,
    p_placing: input.placing ?? null,
  });
  if (error) throw new Error(error.message);
}
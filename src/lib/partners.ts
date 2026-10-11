import { supabase } from './supabase';

export type Availability = 'weekday_morning' | 'weekday_evening' | 'weekend';

export interface PartnerProfile {
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
  casual_rating: number;
  casual_games: number;
  availability: Availability[];
  rating_visible: boolean;
}

/** Availability slots, matching the check constraint in 1-tables.sql. */
export const AVAILABILITY_SLOTS: { value: Availability; label: string }[] = [
  { value: 'weekday_morning', label: 'Weekday mornings' },
  { value: 'weekday_evening', label: 'Weekday evenings' },
  { value: 'weekend', label: 'Weekends' },
];

export interface PartnerFilters {
  /** Inclusive rating window around the signed-in player. */
  ratingWindow: number;
  city: string | null;
  availability: Availability | 'any';
}

/**
 * Players who could actually train with you, nearest in rating first.
 *
 * Ratings are only comparable within a band, so the window is deliberately
 * narrow: someone 300 points away is not a sparring partner, however keen.
 */
export async function findPartners(meId: string, filters: PartnerFilters): Promise<PartnerProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .neq('id', meId)
    .eq('rating_visible', true)
    .order('casual_rating', { ascending: true })
    .limit(100);

  if (error) throw new Error(error.message);

  const rows = (data as PartnerProfile[]).filter((p) => {
    // A player who has not set availability is still a real player, so show
    // them rather than hiding them behind a scheduling filter they never opted
    // into.
    if (filters.availability !== 'any') {
      if (p.availability.length > 0 && !p.availability.includes(filters.availability)) return false;
    }
    if (filters.city && p.city && p.city !== filters.city) return false;
    return true;
  });

  return rows;
}

/**
 * Narrows candidates to a rating band around the viewer. Done client-side
 * because the viewer is only shown players who chose to be listed; a server
 * query would expose hidden ratings through ordering alone.
 */
export function withinWindow(me: PartnerProfile, candidate: PartnerProfile, window: number): boolean {
  return Math.abs(candidate.casual_rating - me.casual_rating) <= window;
}

export function citiesFrom(players: PartnerProfile[]): string[] {
  return [...new Set(players.map((p) => p.city).filter((c): c is string => !!c))].sort();
}
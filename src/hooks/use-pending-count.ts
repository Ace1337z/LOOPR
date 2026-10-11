import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { fetchPendingForMe } from '@/lib/db';
import { supabase } from '@/lib/supabase';

/**
 * Number of results waiting on the signed-in player to confirm.
 *
 * Refreshes on app foreground and whenever a match changes. Supabase Realtime is
 * included on the free tier and needs no extra setup, which is why this is
 * preferred over push notifications for the pilot -- real push needs paid Apple
 * and Google accounts before a tester can see anything.
 */
export function usePendingCount(userId: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    const load = () => {
      fetchPendingForMe()
        .then((rows) => {
          if (active) setCount(rows.length);
        })
        .catch(() => undefined);
    };

    load();

    // Returning to the app is the common case: a player finishes a match, puts
    // the phone down, and comes back to the result sitting there.
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') load();
    };
    const sub = AppState.addEventListener('change', onChange);

    // Realtime pushes a change the moment the opponent submits, so the badge is
    // right even if the app was already open.
    const channel = supabase
      .channel(`pending:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `opponent_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();

    return () => {
      active = false;
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return count;
}
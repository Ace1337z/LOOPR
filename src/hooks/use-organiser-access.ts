import { useEffect, useState } from 'react';

import { myRole, type AppRole } from '@/lib/db';

export interface RoleState {
  role: AppRole | null;
  isOrganiser: boolean;
  isAdmin: boolean;
  loading: boolean;
}

/**
 * Shared role state for the tab bar, the organiser screen and the redeem flow.
 *
 * "isOrganiser" here means "holds any staff role". The database re-checks every
 * write, so this only decides what to show.
 */
export function useOrganiserAccess(userId: string | undefined): RoleState {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  // Only the async path sets state; a signed-out read returns the initial
  // values without a cascading render.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    myRole()
      .then((r) => {
        if (active) setRole(r);
      })
      .catch(() => {
        if (active) setRole(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const active = userId ? role : null;
  return {
    role: active,
    isOrganiser: active !== null,
    isAdmin: active === 'admin',
    loading: userId ? loading : false,
  };
}
import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { sessionStorage } from './session-storage';

/**
 * Supabase auth storage.
 *
 * The session holds refresh tokens, so it is kept in the Keychain / Keystore
 * rather than plain AsyncStorage. A secure store is not readable by other
 * apps, which matters on a rooted or shared device.
 */
const secureStorage = sessionStorage;

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      // Sessions refresh on app foreground; without this a player who leaves the
      // app open overnight comes back to a logged-out profile.
      detectSessionInUrl: false,
    },
  },
);

export const IS_WEB = Platform.OS === 'web';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * expo-secure-store has no web implementation, so the web build falls back to
 * localStorage. That is acceptable for a pilot (the browser session is already
 * script-accessible), but it must be revisited before public web launch.
 */
const memoryFallback = new Map<string, string>();

const nativeStore = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: async (key: string, value: string) => {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const webStore = {
  getItem: async (key: string) => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      memoryFallback.set(key, value);
    }
  },
  removeItem: async (key: string) => {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      memoryFallback.delete(key);
    }
  },
};

export const sessionStorage = Platform.OS === 'web' ? webStore : nativeStore;
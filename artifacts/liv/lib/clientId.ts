import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Anonymous ID for this app install. It identifies no one; it only lets Liv
 * apply fair daily limits on new web research and count catalog requests once
 * per person. Replace with real account IDs when accounts exist.
 */
const KEY = 'liv-client-id-v1';
let cached: Promise<string> | null = null;

function makeId() {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

export function getClientId(): Promise<string> {
  if (!cached) {
    cached = AsyncStorage.getItem(KEY)
      .then(async (existing) => {
        if (existing) return existing;
        const id = makeId();
        await AsyncStorage.setItem(KEY, id).catch(() => {});
        return id;
      })
      .catch(() => makeId());
  }
  return cached;
}

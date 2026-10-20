import { useSyncExternalStore } from 'react';

/** Kleiner Store für die Abspielposition – vermeidet Re-Render der ganzen App bei jedem Frame. */
let value = 0;
const listeners = new Set();

export const playhead = {
  get: () => value,
  set(v) {
    if (v === value) return;
    value = v;
    listeners.forEach((l) => l());
  },
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const usePlayhead = () => useSyncExternalStore(playhead.subscribe, playhead.get);

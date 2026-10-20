import { useCallback, useState } from 'react';

const LIMIT = 150;

/** Undo/Redo-fähiger Projektzustand. */
export function useHistory(initial) {
  const [h, setH] = useState({ past: [], present: initial, future: [] });

  /** Änderung anwenden. record=false für Zwischenschritte (z. B. beim Ziehen). */
  const set = useCallback((updater, record = true) => {
    setH((s) => {
      const next = typeof updater === 'function' ? updater(s.present) : updater;
      if (next === s.present) return s;
      if (!record) return { ...s, present: next };
      return { past: [...s.past.slice(-LIMIT), s.present], present: next, future: [] };
    });
  }, []);

  /** Nach einer Zieh-Aktion: Ausgangszustand als einen Undo-Schritt ablegen. */
  const commitFrom = useCallback((snapshot) => {
    setH((s) => (s.present === snapshot ? s : { past: [...s.past.slice(-LIMIT), snapshot], present: s.present, future: [] }));
  }, []);

  const undo = useCallback(() => {
    setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  }, []);

  const redo = useCallback(() => {
    setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  const reset = useCallback((doc) => setH({ past: [], present: doc, future: [] }), []);

  return { doc: h.present, set, commitFrom, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

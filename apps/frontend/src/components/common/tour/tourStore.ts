import { create } from 'zustand';
import type { TourId } from './tours';
import { useAuthStore } from '../../../stores/authStore';

// Tours are tracked per user: someone logging in for the first time sees them
// even if another user already went through them on this computer.
function seenKey() {
  const user = useAuthStore.getState().user;
  // v2: recorridos rehechos (modo práctica, por rubro y plan): cada usuario los vuelve a ver una vez
  return `ventra_tours_seen_v2:${user?.id || user?.username || 'anon'}`;
}

function readSeen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(seenKey()) || '{}');
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, boolean>) {
  try {
    localStorage.setItem(seenKey(), JSON.stringify(seen));
  } catch {
    /* storage unavailable: the tour just shows again next time */
  }
}

interface TourState {
  activeTour: TourId | null;
  /** La bienvenida del primer uso está abierta: los recorridos automáticos esperan */
  paused: boolean;
  setPaused: (paused: boolean) => void;
  start: (id: TourId) => void;
  /** Starts the tour only the first time the user lands on its screen. */
  startIfUnseen: (id: TourId) => void;
  finish: () => void;
  /** Corta el recorrido sin darlo por visto (se fue de la pantalla a mitad de camino). */
  cancel: (id: TourId) => void;
  hasSeen: (id: TourId) => boolean;
  markSeen: (id: TourId) => void;
  resetAll: () => void;
}

/**
 * Acciones que una pantalla le presta al recorrido (abrir la ventana de cobro, armar un ticket
 * de práctica...). Los pasos las piden por nombre (TourStep.run); 'practice:start' y
 * 'practice:end' las usan los recorridos con modo práctica (PRACTICE_TOURS).
 */
const tourActions = new Map<string, () => void>();
export function registerTourActions(actions: Record<string, () => void>) {
  for (const [k, fn] of Object.entries(actions)) tourActions.set(k, fn);
  return () => { for (const [k, fn] of Object.entries(actions)) if (tourActions.get(k) === fn) tourActions.delete(k); };
}
export const runTourAction = (name: string) => { try { tourActions.get(name)?.(); } catch (e) { console.warn('[Recorrido]', name, e); } };
export const hasTourAction = (name: string) => tourActions.has(name);

export const useTourStore = create<TourState>((set, get) => ({
  activeTour: null,
  paused: false,
  setPaused: (paused) => set({ paused }),
  start: (id) => set({ activeTour: id }),
  startIfUnseen: (id) => {
    if (!get().paused && !get().hasSeen(id) && !get().activeTour) set({ activeTour: id });
  },
  finish: () => {
    const id = get().activeTour;
    if (id) writeSeen({ ...readSeen(), [id]: true });
    set({ activeTour: null });
  },
  cancel: (id) => {
    if (get().activeTour === id) set({ activeTour: null });
  },
  hasSeen: (id) => !!readSeen()[id],
  markSeen: (id) => writeSeen({ ...readSeen(), [id]: true }),
  resetAll: () => writeSeen({}),
}));

// The tour's key listener is registered here, at import time, so it runs before
// every screen's own capture listener (the POS hotkeys and the payment modal
// both listen on window in capture phase — Enter there would finish a sale).
let tourKeyHandler: ((e: KeyboardEvent) => void) | null = null;
export function setTourKeyHandler(handler: ((e: KeyboardEvent) => void) | null) {
  tourKeyHandler = handler;
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => tourKeyHandler?.(e), true);
}

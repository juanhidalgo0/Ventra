import { create } from 'zustand';
import type { TourId } from './tours';
import { useAuthStore } from '../../../stores/authStore';

// Tours are tracked per user: someone logging in for the first time sees them
// even if another user already went through them on this computer.
function seenKey() {
  const user = useAuthStore.getState().user;
  return `ventra_tours_seen:${user?.id || user?.username || 'anon'}`;
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
  start: (id: TourId) => void;
  /** Starts the tour only the first time the user lands on its screen. */
  startIfUnseen: (id: TourId) => void;
  finish: () => void;
  hasSeen: (id: TourId) => boolean;
  resetAll: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  activeTour: null,
  start: (id) => set({ activeTour: id }),
  startIfUnseen: (id) => {
    if (!get().hasSeen(id) && !get().activeTour) set({ activeTour: id });
  },
  finish: () => {
    const id = get().activeTour;
    if (id) writeSeen({ ...readSeen(), [id]: true });
    set({ activeTour: null });
  },
  hasSeen: (id) => !!readSeen()[id],
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

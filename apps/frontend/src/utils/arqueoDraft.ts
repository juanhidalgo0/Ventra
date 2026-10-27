// Borrador del arqueo de un turno: lo que el cajero lleva cargado (billetes, terminales,
// notas, el paso) y si había elegido el Cierre Z. Se guarda en esta PC mientras cuenta,
// así cerrar la pantalla o recargar no pierde el conteo ni convierte el Z en un X.
export interface ArqueoDraft {
  withZ?: boolean;
  step?: number;
  bills?: Record<number, number>;
  cloverInputs?: number[];
  mpInputs?: number[];
  mpManual?: boolean;
  notes?: string;
  savedAt?: number;
}

const KEY = (sessionId: string) => `ventra_arqueo_borrador_${sessionId}`;
// Un borrador de hace más de una semana ya no sirve: el turno se arqueó o se resolvió de otra forma
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function readArqueoDraft(sessionId?: string | null): ArqueoDraft | null {
  if (!sessionId) return null;
  try {
    const raw = localStorage.getItem(KEY(sessionId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as ArqueoDraft;
    if (!draft || typeof draft !== 'object') return null;
    if (draft.savedAt && Date.now() - draft.savedAt > MAX_AGE) {
      localStorage.removeItem(KEY(sessionId));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveArqueoDraft(sessionId: string | undefined | null, patch: ArqueoDraft) {
  if (!sessionId) return;
  try {
    const prev = readArqueoDraft(sessionId) || {};
    localStorage.setItem(KEY(sessionId), JSON.stringify({ ...prev, ...patch, savedAt: Date.now() }));
  } catch {}
}

export function clearArqueoDraft(sessionId?: string | null) {
  if (!sessionId) return;
  try { localStorage.removeItem(KEY(sessionId)); } catch {}
}

/** Si en este turno se había elegido el Cierre Z (aunque se haya cerrado la pantalla) */
export function arqueoWantsZ(sessionId?: string | null): boolean {
  return !!readArqueoDraft(sessionId)?.withZ;
}

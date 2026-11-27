/**
 * Tamaño de la letra de esta PC (Configuración → Tamaño de la letra, o Ctrl + / Ctrl − / Ctrl 0).
 *
 * En la app de escritorio se usa el zoom de la ventana (como el Ctrl + de un navegador): agranda
 * todo y reacomoda las pantallas sin que nada se salga. En el navegador ese zoom no se puede tocar
 * desde la página, pero el Ctrl + del propio navegador hace lo mismo y lo recuerda solo.
 */
const KEY = 'ventra_ui_zoom';
export const ZOOM_STEPS = [0.9, 1, 1.1, 1.25, 1.4] as const;
export const ZOOM_LABELS: Record<number, string> = { 0.9: 'Chica', 1: 'Normal', 1.1: 'Grande', 1.25: 'Muy grande', 1.4: 'Enorme' };
export const ZOOM_EVENT = 'ventra:ui-zoom';

const webview = () => {
  const t = (window as any).__TAURI__;
  return t?.webview?.getCurrentWebview?.() || null;
};

/** ¿Se puede cambiar desde la app? (solo en la de escritorio) */
export const canZoom = () => !!webview();

export function getUiZoom(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return ZOOM_STEPS.includes(v as any) ? v : 1;
  } catch { return 1; }
}

export async function setUiZoom(value: number) {
  const v = ZOOM_STEPS.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best), 1 as number);
  try { localStorage.setItem(KEY, String(v)); } catch { /* sin guardado: dura hasta cerrar */ }
  try { await webview()?.setZoom(v); } catch (e) { console.warn('[Tamaño de letra]', e); }
  window.dispatchEvent(new CustomEvent(ZOOM_EVENT, { detail: v }));
  return v;
}

export function stepUiZoom(dir: 1 | -1) {
  const cur = getUiZoom();
  const i = ZOOM_STEPS.indexOf(cur as any);
  const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i < 0 ? 1 : i) + dir))];
  return setUiZoom(next);
}

let installed = false;
/** Al abrir: aplica el tamaño guardado y escucha Ctrl + / Ctrl − / Ctrl 0 (solo en la app de escritorio) */
export function installUiZoom() {
  if (installed || !canZoom()) return;
  installed = true;
  const saved = getUiZoom();
  if (saved !== 1) void setUiZoom(saved);
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); void stepUiZoom(1).then(notify); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); void stepUiZoom(-1).then(notify); }
    else if (e.key === '0') { e.preventDefault(); void setUiZoom(1).then(notify); }
  });
}

function notify(v: number) {
  import('react-hot-toast').then(({ default: toast }) => toast(`Letra: ${ZOOM_LABELS[v] || `${Math.round(v * 100)}%`}`, { id: 'ui-zoom', duration: 1400 }));
}

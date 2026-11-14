/**
 * Boleta escaneada con el celular, leída en segundo plano (2026-11-14).
 *
 * Antes la pantalla esperaba la respuesta de la IA con todo trabado (no se podía cerrar ni usar la app,
 * hasta 5 minutos). Ahora: se suben las fotos (con el % a la vista), el servidor responde al toque y la
 * lectura sigue allá. Esta tienda pregunta cómo va cada 3 s, aunque se cierre la ventanita o se cambie
 * de pantalla; si la ventanita está cerrada cuando termina, avisa con un cartel. Si la app se cierra,
 * al volver a abrirla sigue preguntando (el número de lectura queda guardado en el teléfono).
 */
import { create } from 'zustand';
import toast from 'react-hot-toast';
import api from '../services/api';

const KEY = 'scan_invoice_job';
const POLL_MS = 3000;
/** Más que esto ya no es una lectura lenta: algo se cortó */
const GIVE_UP_MS = 12 * 60_000;

export type ScanStage = 'idle' | 'uploading' | 'reading' | 'done' | 'error';

interface ScanJobState {
  stage: ScanStage;
  id: string | null;
  startedAt: number;
  photos: number;
  uploadPct: number;
  result: any | null;
  error: string | null;
  /** La ventanita de escanear está abierta: muestra el resultado ella, sin cartel */
  watching: boolean;
  /** Sube cada vez que termina una lectura (la lista de compras se recarga) */
  finished: number;
}

export const useScanJob = create<ScanJobState>(() => ({
  stage: 'idle', id: null, startedAt: 0, photos: 0, uploadPct: 0, result: null, error: null, watching: false, finished: 0,
}));

const save = (v: { id: string; startedAt: number; photos: number } | null) => {
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
};

/** "Boleta de Vital: se cargó sola" (para el cartel cuando la ventanita está cerrada). Pura. */
export function resultSummary(r: any): string {
  const who = r?.matchedSupplier?.name || r?.supplierName || 'del proveedor';
  const what = r?.status === 'DUPLICATE' ? 'ya estaba cargada, no se volvió a cargar'
    : r?.auto ? 'se cargó sola' : 'quedó en Compras → Por revisar';
  const others = Array.isArray(r?.others) && r.others.length ? ` (y ${r.others.length} comprobante${r.others.length === 1 ? '' : 's'} más)` : '';
  return `Boleta ${r?.matchedSupplier?.name || r?.supplierName ? `de ${who}` : who}: ${what}${others}.`;
}

function finish(patch: Partial<ScanJobState>) {
  save(null);
  const s = useScanJob.getState();
  useScanJob.setState({ ...patch, finished: s.finished + 1 });
  if (!s.watching) {
    if (patch.stage === 'done') toast.success(resultSummary(patch.result), { duration: 9000 });
    else if (patch.error) toast.error(patch.error, { duration: 9000 });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let fails = 0;

async function poll() {
  timer = null;
  const { id, stage, startedAt } = useScanJob.getState();
  if (!id || stage !== 'reading') return;
  try {
    const { data } = await api.get(`/purchases/scan-invoice-bg/${id}`, { silent: true, timeout: 15000 } as any);
    fails = 0;
    if (useScanJob.getState().id !== id) return;
    if (data?.status === 'done') return finish({ stage: 'done', result: data.result, error: null });
    if (data?.status === 'error') return finish({ stage: 'error', error: data.error || 'No se pudo leer la boleta. Probá de nuevo.' });
  } catch (err: any) {
    // La caja se reinició y perdió la lectura
    if (err?.response?.status === 404) return finish({ stage: 'error', error: 'Se cortó la lectura (la caja se reinició). Fijate en Compras si quedó y, si no, sacala de nuevo.' });
    fails++;
  }
  if (Date.now() - startedAt > GIVE_UP_MS) return finish({ stage: 'error', error: 'La lectura tardó demasiado. Fijate en Compras si quedó y, si no, probá de nuevo.' });
  // Sin conexión un rato: se espera un poco más entre preguntas
  timer = setTimeout(poll, fails ? Math.min(POLL_MS * (fails + 1), 20000) : POLL_MS);
}

function schedule(now = false) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(poll, now ? 0 : POLL_MS);
}

// Al volver a la app (el teléfono pausa los temporizadores en segundo plano) se pregunta enseguida
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && useScanJob.getState().stage === 'reading') schedule(true); });
}

/** Al abrir la app: si quedó una lectura en curso, se sigue preguntando */
export function resumeScanJob() {
  if (useScanJob.getState().stage !== 'idle') return;
  let v: any = null;
  try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* nada */ }
  if (!v?.id) return;
  if (Date.now() - Number(v.startedAt) > GIVE_UP_MS) { save(null); return; }
  useScanJob.setState({ stage: 'reading', id: v.id, startedAt: Number(v.startedAt) || Date.now(), photos: Number(v.photos) || 0, result: null, error: null });
  schedule(true);
}

/**
 * Sube las fotos y deja la lectura andando. Tira error solo si no se pudieron subir (sin conexión, etc.):
 * así la pantalla puede guardarla en espera. Con una caja vieja (sin lectura en segundo plano) espera
 * la respuesta como antes.
 */
export async function startScanJob(files: File[], manualTotal?: number): Promise<void> {
  useScanJob.setState({ stage: 'uploading', id: null, startedAt: Date.now(), photos: files.length, uploadPct: 0, result: null, error: null });
  const form = () => { const f = new FormData(); files.forEach((x) => f.append('files', x)); if (manualTotal && manualTotal > 0) f.append('manualTotal', String(manualTotal)); return f; };
  const onUploadProgress = (e: any) => { if (e?.total) useScanJob.setState({ uploadPct: Math.min(100, Math.round((e.loaded / e.total) * 100)) }); };
  try {
    const { data } = await api.post('/purchases/scan-invoice-bg', form(), { timeout: 180000, onUploadProgress } as any);
    const startedAt = Date.now();
    useScanJob.setState({ stage: 'reading', id: data.id, startedAt, uploadPct: 100 });
    save({ id: data.id, startedAt, photos: files.length });
    schedule();
  } catch (err: any) {
    if (err?.response?.status !== 404) { useScanJob.setState({ stage: 'idle', uploadPct: 0 }); throw err; }
    // Caja sin la versión nueva: como antes, esperando la respuesta
    useScanJob.setState({ stage: 'reading', startedAt: Date.now() });
    try {
      const { data } = await api.post('/purchases/scan-invoice', form(), { timeout: 290000, onUploadProgress } as any);
      finish({ stage: 'done', result: data, error: null });
    } catch (e: any) {
      finish({ stage: 'error', error: e?.response?.data?.message || 'No se pudo leer la boleta. Probá de nuevo.' });
    }
  }
}

/** "Escanear otra": vuelve al principio (la lectura en curso, si hay, sigue en el servidor) */
export function resetScanJob() {
  const s = useScanJob.getState();
  if (s.stage === 'uploading' || s.stage === 'reading') return;
  useScanJob.setState({ stage: 'idle', id: null, result: null, error: null, uploadPct: 0, photos: 0 });
}

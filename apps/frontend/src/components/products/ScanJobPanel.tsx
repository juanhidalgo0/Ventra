import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Clock, FileText, Minimize2, X } from 'lucide-react';
import api from '../../services/api';
import { PURCHASES_CHANGED_EVENT } from './ScannedPurchasesWatcher';

/**
 * Lectura de boletas en segundo plano (ver ScanJobsService en el backend).
 * - Las fotos se suben y la lectura sigue en el servidor: no hay espera que se corte ni límite de fotos.
 * - Se ve foto por foto qué encontró (proveedor, hoja, productos) en vez de una barra inventada.
 * - "Seguir vendiendo" la minimiza a una pastilla; al terminar avisa con un botón para revisar.
 * - Al final, cada comprobante es una pestaña en Compras para revisarlo y confirmarlo de a uno.
 */

const JOB_KEY = 'ventra_scan_job';
/** Lo lee Compras al abrir: los ids de las boletas a revisar en pestañas */
export const REVIEW_KEY = 'purchases_review_batch';
export const OPEN_REVIEW_EVENT = 'ventra:open-review';

export interface ScanJobView {
  id: string;
  status: 'reading' | 'grouping' | 'done' | 'error';
  createdAt: number;
  finishedAt: number | null;
  total: number;
  done: number;
  photos: { index: number; name: string; state: 'queued' | 'reading' | 'done' | 'failed'; found?: { supplierName: string; invoiceNumber: string; pageNumber: number; pageCount: number; items: number; issue?: string }; error?: string }[];
  documents: { purchaseId: string | null; status: string; supplierName: string; invoiceNumber: string; docType: string; images: number[]; items: number; ok: boolean | null; message: string; why: string[] }[];
  error: string | null;
  limitMessage: string | null;
  left: number | null;
}

interface ScanJobState {
  job: ScanJobView | null;
  /** Las fotos de esta lectura (solo en esta pantalla): para verlas al lado al revisar */
  files: File[];
  urls: string[];
  open: boolean;
  setJob: (job: ScanJobView | null) => void;
  setOpen: (open: boolean) => void;
}

export const useScanJob = create<ScanJobState>((set) => ({
  job: null,
  files: [],
  urls: [],
  open: false,
  setJob: (job) => set({ job }),
  setOpen: (open) => set({ open }),
}));

/** Las fotos de la última lectura que le tocan a un comprobante (por número de foto) */
export function photosFor(images: number[] | null | undefined): string[] {
  const { urls } = useScanJob.getState();
  if (!urls.length || !Array.isArray(images)) return [];
  return images.map((i) => urls[i]).filter(Boolean);
}

/** Abre Compras con estas boletas en pestañas */
export function openReview(ids: string[]) {
  const list = ids.filter(Boolean);
  if (!list.length) return;
  try {
    sessionStorage.setItem(REVIEW_KEY, JSON.stringify(list));
  } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new CustomEvent(OPEN_REVIEW_EVENT, { detail: list }));
}

/** Empieza a leer estas fotos. Devuelve cuando el servidor ya las tiene (unos segundos). */
export async function startScanJob(files: File[], manualTotal?: string) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  if (manualTotal && files.length === 1) form.append('manualTotal', manualTotal);
  const { data } = await api.post('/purchases/scan-jobs', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 } as any);
  const prev = useScanJob.getState().urls;
  prev.forEach((u) => URL.revokeObjectURL(u));
  useScanJob.setState({ job: data, files, urls: files.map((f) => URL.createObjectURL(f)), open: true });
  try { sessionStorage.setItem(JOB_KEY, data.id); } catch { /* nada */ }
  return data as ScanJobView;
}

const running = (j: ScanJobView | null) => !!j && (j.status === 'reading' || j.status === 'grouping');
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const docLabel = (d: ScanJobView['documents'][number]) => `${d.supplierName || 'Proveedor sin nombre'}${d.invoiceNumber ? ` N° ${d.invoiceNumber}` : ''}`;

/** Montado una vez en el layout: pregunta cómo va la lectura y muestra la ventana o la pastilla */
export default function ScanJobPanel() {
  const navigate = useNavigate();
  const { job, open, urls, setJob, setOpen } = useScanJob();
  const [now, setNow] = useState(Date.now());

  // Si se recargó la página en medio de una lectura, se retoma (sin las fotos, que quedaron en la otra)
  useEffect(() => {
    let id = '';
    try { id = sessionStorage.getItem(JOB_KEY) || ''; } catch { /* nada */ }
    if (!id || useScanJob.getState().job) return;
    api.get(`/purchases/scan-jobs/${id}`, { silent: true } as any).then(({ data }) => { if (running(data)) setJob(data); }).catch(() => { try { sessionStorage.removeItem(JOB_KEY); } catch { /* nada */ } });
  }, []);

  // Pregunta cada 1,5 s mientras lee
  useEffect(() => {
    if (!running(job)) return;
    const t = window.setInterval(async () => {
      try {
        const { data } = await api.get(`/purchases/scan-jobs/${job!.id}`, { silent: true } as any);
        const was = useScanJob.getState().job;
        setJob(data);
        if (!running(data) && running(was)) finished(data);
      } catch { /* sin conexión un momento: se reintenta */ }
    }, 1500);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(t); window.clearInterval(tick); };
  }, [job?.id, job?.status]);

  const finished = (j: ScanJobView) => {
    try { sessionStorage.removeItem(JOB_KEY); } catch { /* nada */ }
    window.dispatchEvent(new CustomEvent(PURCHASES_CHANGED_EVENT));
    // Minimizada: avisa con un botón para revisar
    if (!useScanJob.getState().open) {
      const ids = j.documents.filter((d) => d.purchaseId && d.status === 'PENDING').map((d) => d.purchaseId!) as string[];
      if (j.status === 'error') toast.error(j.error || 'No se pudieron leer las boletas', { duration: 12000 });
      else toast((t) => (
        <span className="flex items-center gap-3">
          <span className="text-[13.5px]"><b>Terminé de leer tus boletas</b><span className="block text-slate-600">{ids.length} para revisar y confirmar</span></span>
          <button onClick={() => { toast.dismiss(t.id); review(ids); }} className="shrink-0 h-9 px-3 rounded-lg bg-rose-600 text-white text-[13px] font-bold cursor-pointer">Revisar</button>
        </span>
      ), { duration: 20000, id: 'scan-job-done' });
    }
  };

  const review = (ids: string[]) => {
    setOpen(false);
    openReview(ids);
    navigate('/purchases');
  };

  const pendingIds = useMemo(() => (job?.documents || []).filter((d) => d.purchaseId && d.status === 'PENDING').map((d) => d.purchaseId!) as string[], [job]);
  if (!job) return null;
  const elapsed = (job.finishedAt || now) - job.createdAt;
  // Cada foto tarda de 15 a 60 s y se leen de a 3
  const estimate = Math.max(1, Math.ceil(Math.ceil(job.total / 3) * 40 / 60));

  if (!open) {
    if (!running(job)) return null;
    return (
      <button onClick={() => setOpen(true)} className="fixed left-4 bottom-4 z-[170] h-11 pl-3 pr-4 rounded-full bg-slate-900 text-white text-[13px] font-bold shadow-lg inline-flex items-center gap-2 cursor-pointer hover:bg-slate-800">
        <Loader2 className="w-4 h-4 animate-spin keep-animated" />
        {job.status === 'grouping' ? 'Juntando las hojas…' : `Leyendo boletas ${job.done} de ${job.total}`}
      </button>
    );
  }

  const close = () => { setOpen(false); if (!running(job)) setJob(null); };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            {running(job) ? <Loader2 className="w-5 h-5 animate-spin keep-animated" /> : job.status === 'error' ? <XCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[16px] font-bold text-slate-800">
              {job.status === 'reading' ? 'Leyendo tus boletas' : job.status === 'grouping' ? 'Juntando las hojas de cada factura' : job.status === 'error' ? 'No se pudieron leer' : 'Listo: ya las leí'}
            </h3>
            <p className="text-[13px] text-slate-500 mt-0.5">
              {running(job)
                ? <>{job.done} de {job.total} {job.total === 1 ? 'foto' : 'fotos'} · {mmss(elapsed)}{job.total > 1 && elapsed < 15000 ? ` · suele tardar unos ${estimate} min` : ''}</>
                : job.status === 'done' ? `${job.documents.length} ${job.documents.length === 1 ? 'comprobante' : 'comprobantes'} en ${job.total} ${job.total === 1 ? 'foto' : 'fotos'} · ${mmss(elapsed)}` : job.error}
            </p>
          </div>
          {running(job)
            ? <button onClick={() => setOpen(false)} title="Minimizar" className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"><Minimize2 className="w-4 h-4" /></button>
            : <button onClick={close} title="Cerrar" className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"><X className="w-4 h-4" /></button>}
        </div>

        {running(job) && (
          <div className="h-1.5 bg-slate-100">
            <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${Math.round(((job.done + (job.status === 'grouping' ? 0.5 : 0)) / (job.total + 0.5)) * 100)}%` }} />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {/* Terminado: un renglón por comprobante */}
          {job.status === 'done' && job.documents.map((d, k) => (
            <div key={k} className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
              {d.status === 'DUPLICATE' ? <FileText className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                : d.ok === true ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                : <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-slate-800 truncate">{docLabel(d)}{d.docType && d.docType !== 'factura' ? <span className="font-semibold text-slate-500"> · {d.docType}</span> : null}</p>
                <p className="text-[12.5px] text-slate-600">
                  {d.status === 'DUPLICATE' ? 'Ya estaba cargada: no se vuelve a sumar.'
                    : d.status === 'ERROR' ? d.message
                    : `${d.items} productos · ${d.ok === true ? 'los renglones cierran con el total' : d.why.length ? `revisar: ${d.why.join(', ')}` : d.message}`}
                </p>
              </div>
            </div>
          ))}

          {/* Mientras lee (o si falló alguna): foto por foto */}
          {(job.status !== 'done' || job.photos.some((p) => p.state === 'failed')) && job.photos
            .filter((p) => job.status !== 'done' || p.state === 'failed')
            .map((p) => (
            <div key={p.index} className={`flex items-center gap-3 rounded-xl px-2 py-2 ${p.state === 'failed' ? 'bg-[#fef2f2]' : ''}`}>
              <div className="w-11 h-11 rounded-lg bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                {urls[p.index] ? <img src={urls[p.index]} alt="" className="w-full h-full object-cover" /> : <FileText className="w-5 h-5 text-slate-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold text-slate-800">Foto {p.index + 1}</p>
                <p className={`text-[12.5px] ${p.state === 'failed' ? 'text-[#b91c1c]' : 'text-slate-500'}`}>
                  {p.state === 'queued' && 'En espera'}
                  {p.state === 'reading' && 'Leyendo renglón por renglón… si algo no cierra, la vuelvo a leer'}
                  {p.state === 'done' && p.found && <>
                    {p.found.supplierName || 'Proveedor'}{p.found.pageCount > 1 ? ` · hoja ${p.found.pageNumber || '?'} de ${p.found.pageCount}` : ''} · {p.found.items} productos
                    {p.found.issue && <span className="block text-amber-700">Ojo: {p.found.issue}</span>}
                  </>}
                  {p.state === 'failed' && (p.error || 'No se pudo leer')}
                </p>
              </div>
              <span className="shrink-0">
                {p.state === 'queued' && <Clock className="w-4 h-4 text-slate-300" />}
                {p.state === 'reading' && <Loader2 className="w-4 h-4 text-rose-500 animate-spin keep-animated" />}
                {p.state === 'done' && <CheckCircle2 className={`w-4 h-4 ${p.found?.issue ? 'text-amber-500' : 'text-emerald-600'}`} />}
                {p.state === 'failed' && <XCircle className="w-4 h-4 text-[#dc2626]" />}
              </span>
            </div>
          ))}
          {job.limitMessage && <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{job.limitMessage}</p>}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2 sm:items-center">
          {running(job) ? (
            <>
              <p className="text-[12.5px] text-slate-500 flex-1">Podés seguir usando Ventra: la lectura sigue sola y te aviso cuando termine.</p>
              <button onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[13px] font-bold cursor-pointer">Seguir vendiendo</button>
            </>
          ) : job.status === 'done' && pendingIds.length ? (
            <>
              <p className="text-[12.5px] text-slate-500 flex-1">Quedaron en Compras → Por revisar. Nada se cargó todavía.</p>
              <button onClick={() => review(pendingIds)} className="h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold cursor-pointer">
                Revisar {pendingIds.length === 1 ? 'la boleta' : `las ${pendingIds.length} boletas`}
              </button>
            </>
          ) : (
            <button onClick={close} className="h-10 px-4 rounded-xl border border-slate-300 text-slate-700 text-[13px] font-bold cursor-pointer sm:ml-auto">Cerrar</button>
          )}
        </div>
      </div>
    </div>
  );
}

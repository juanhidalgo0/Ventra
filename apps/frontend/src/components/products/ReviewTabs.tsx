import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, Trash2, Info, Flag, Copy } from 'lucide-react';
import api from '../../services/api';
import NewPurchaseScreen from './NewPurchaseScreen';
import { photosFor } from './ScanJobPanel';
import DuplicatesModal from './DuplicatesModal';
import CreditNotePanel from './CreditNotePanel';
import { useManagerAccess } from '../../utils/managerAccess';

/**
 * Las boletas leídas, una pestaña por comprobante (2026-11-12, pedido del dueño: "verlas una a una, fácil").
 * Arriba las pestañas con el estado de cada una; abajo la compra de la pestaña elegida, con la foto al lado.
 * Al confirmar una pasa sola a la siguiente; lo que no se confirma queda en Compras → Por revisar.
 */
export default function ReviewTabs({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [active, setActive] = useState<string>(ids[0]);
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [reported, setReported] = useState<string[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const canManage = useManagerAccess();

  const load = async () => {
    try {
      const { data } = await api.get(`/purchases/batch?ids=${encodeURIComponent(ids.join(','))}`);
      setRows(data || []);
      return data || [];
    } catch {
      toast.error('No se pudieron abrir las boletas');
      setRows([]);
      return [];
    }
  };
  useEffect(() => { load(); }, [ids.join(',')]);

  if (!rows) {
    return <div className="h-full flex items-center justify-center text-slate-500 gap-2"><Loader2 className="w-5 h-5 animate-spin keep-animated" /> Abriendo las boletas…</div>;
  }
  const open = rows.filter((r) => r.status === 'PENDING' && !doneIds.includes(r.id));
  if (!rows.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-600">
        <p className="text-[14px] font-semibold">Esas boletas ya no están para revisar.</p>
        <button onClick={onClose} className="h-10 px-4 rounded-xl bg-slate-900 text-white text-[13px] font-bold cursor-pointer">Volver a Compras</button>
      </div>
    );
  }
  const current = rows.find((r) => r.id === active) || open[0] || rows[0];

  const label = (r: any) => r.supplier?.name || r.draft?.supplierName || 'Proveedor';
  const stateOf = (r: any): 'done' | 'ok' | 'check' => {
    if (doneIds.includes(r.id) || r.status !== 'PENDING') return 'done';
    return r.draft?.check?.ok === true && !(r.draft?.why || []).length ? 'ok' : 'check';
  };

  const next = () => {
    const nowDone = [...doneIds, current.id];
    setDoneIds(nowDone);
    const rest = rows.filter((r) => r.status === 'PENDING' && !nowDone.includes(r.id));
    if (!rest.length) {
      toast.success(nowDone.length === 1 ? 'Listo: boleta cargada.' : `Listo: cargaste las ${nowDone.length} boletas.`, { duration: 6000 });
      onClose();
      return;
    }
    // La siguiente a la derecha; si no hay, la primera que falte
    const after = rows.slice(rows.findIndex((r) => r.id === current.id) + 1).find((r) => rest.includes(r));
    setActive((after || rest[0]).id);
  };

  const discard = async () => {
    if (!window.confirm(`¿Descartar la boleta de ${label(current)}? No se carga nada y sale de "Por revisar".`)) return;
    try {
      await api.delete(`/purchases/${current.id}`);
      try { localStorage.removeItem(`purchase_draft2:${current.id}`); } catch { /* nada */ }
      toast.success('Boleta descartada');
      const left = rows.filter((r) => r.id !== current.id);
      setRows(left);
      const rest = left.filter((r) => r.status === 'PENDING' && !doneIds.includes(r.id));
      if (!rest.length) onClose(); else setActive(rest[0].id);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo descartar');
    }
  };

  /** "Leyó mal": un toque avisa a Ventra (con lo que quiera contar); no cambia nada de la compra */
  const misread = async () => {
    const note = window.prompt('¿Qué leyó mal? (opcional: por ejemplo "las cantidades de la yerba", "faltó un renglón")', '');
    if (note === null) return;
    try {
      await api.post(`/purchases/${current.id}/misread`, { note });
      setReported((r) => [...r, current.id]);
      toast.success('Gracias: le avisamos a Ventra para que la próxima boleta de este proveedor salga bien.', { duration: 6000 });
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo avisar. Probá de nuevo.');
    }
  };

  const why: string[] = current.draft?.why || [];
  const check = current.draft?.check;
  const st = stateOf(current);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Pestañas: una por boleta */}
      <div className="shrink-0 flex items-center gap-2 px-3 pt-2 pb-1 bg-white border-b border-slate-200">
        <button onClick={onClose} title="Volver a Compras" className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer shrink-0"><ArrowLeft className="w-5 h-5 text-slate-600" /></button>
        <div className="flex-1 min-w-0 flex items-end gap-1 overflow-x-auto custom-scrollbar">
          {rows.map((r, k) => {
            const s = stateOf(r);
            const on = r.id === current.id;
            return (
              <button key={r.id} onClick={() => setActive(r.id)}
                className={`shrink-0 max-w-[240px] h-10 px-3 rounded-t-xl border border-b-0 inline-flex items-center gap-2 text-[13px] cursor-pointer transition-colors ${on ? 'bg-slate-50 border-slate-300 text-slate-900 font-bold' : 'bg-white border-transparent text-slate-500 hover:bg-slate-50 font-semibold'}`}>
                {s === 'done' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : s === 'ok' ? <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
                <span className="truncate">{k + 1}. {label(r)}</span>
              </button>
            );
          })}
        </div>
        {canManage && (
          <button onClick={() => setShowDuplicates(true)} title="El mismo producto cargado dos veces: juntalos" className="shrink-0 h-8 px-2.5 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer">
            <Copy className="w-3.5 h-3.5" /> Repetidos
          </button>
        )}
        {showDuplicates && <DuplicatesModal onClose={() => setShowDuplicates(false)} />}
        {st !== 'done' && current.draft && (
          <button onClick={misread} disabled={!!current.draft.misreadAt || reported.includes(current.id)}
            title="Avisale a Ventra que la IA leyó mal esta boleta: la revisan para que la próxima salga bien"
            className="shrink-0 h-8 px-2.5 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 inline-flex items-center gap-1 cursor-pointer disabled:cursor-default">
            <Flag className="w-3.5 h-3.5" /> {current.draft.misreadAt || reported.includes(current.id) ? 'Avisado' : 'Leyó mal'}
          </button>
        )}
        <span className="shrink-0 text-[12px] font-semibold text-slate-500 hidden md:block">{open.length ? `Faltan ${open.length} de ${rows.length}` : 'Todas revisadas'}</span>
      </div>

      {/* Por qué hay que mirar esta (fijo, no un aviso que se va) */}
      {st !== 'done' && (why.length > 0 || (check && check.ok === false)) && (
        <div className="shrink-0 mx-3 mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-start gap-2.5 text-[13px] text-amber-900">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <div className="flex-1 min-w-0">
            {check && check.ok === false && <p className="font-semibold">{check.message}</p>}
            {why.length > 0 && <p>Revisala porque {why.join(', ')}.</p>}
          </div>
          <button onClick={discard} className="shrink-0 h-8 px-2.5 rounded-lg text-[12px] font-semibold text-amber-900 hover:bg-amber-100 inline-flex items-center gap-1 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /> Descartar</button>
        </div>
      )}
      {st === 'ok' && (
        <div className="shrink-0 mx-3 mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Los renglones cierran con el total de la boleta. Mirá los productos nuevos y confirmá.
        </div>
      )}

      <div className="flex-1 min-h-0">
        {st === 'done' ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-600">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            <p className="text-[15px] font-bold">Esta boleta ya está cargada</p>
            {open.length > 0 && <button onClick={() => setActive(open[0].id)} className="mt-2 h-10 px-4 rounded-xl bg-rose-600 text-white text-[13px] font-bold cursor-pointer">Ir a la siguiente</button>}
          </div>
        ) : (
          current.draft?.creditNote
            // Nota de crédito: no es una compra, se confirma aparte (resta deuda; stock solo si se devolvió)
            ? <CreditNotePanel key={current.id} purchase={current} onDone={next} onDiscard={discard} />
            : <NewPurchaseScreen key={current.id} initialPurchase={current} photos={photosFor(current.draft?.images)} onBack={onClose} onConfirmed={next} />
        )}
      </div>
    </div>
  );
}

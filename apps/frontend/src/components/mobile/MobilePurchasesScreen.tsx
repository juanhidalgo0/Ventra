import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, X, ShoppingBag, Camera, ChevronRight } from 'lucide-react';
import ScanInvoiceSheet from './ScanInvoiceSheet';
import ReviewInvoiceSheet from './ReviewInvoiceSheet';
import api from '../../services/api';
import { flushScans, queuedScans } from '../../utils/scanQueue';
import { useScanJob } from '../../utils/scanInvoiceJob';
import { useManagerAccess } from '../../utils/managerAccess';
import { ScreenHeader, headerInput, Chips, Sheet, EmptyState, ListSkeleton, money, qty } from './ui';

type Filter = 'ALL' | 'OWED' | 'PAID';

/** Compras a proveedores en el celular: qué entró, cuánto costó y qué falta pagar. */
export default function MobilePurchasesScreen() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selected, setSelected] = useState<any | null>(null);
  const [limit, setLimit] = useState(60);
  const [scanning, setScanning] = useState(false);
  const scanStage = useScanJob((s) => s.stage);

  const load = () => api.get('/purchases').then((r) => setRows((r.data || []).filter((p: any) => p.status !== 'CANCELLED'))).catch(() => { setRows([]); toast.error('No pudimos traer las compras'); });
  // Boletas sacadas sin conexión: se mandan solas al abrir y cuando vuelve internet (tanda 6.4)
  const [queued, setQueued] = useState(0);
  const flush = async () => {
    const sent = await flushScans();
    setQueued((await queuedScans()).length);
    if (sent) { toast.success(sent === 1 ? 'Se mandó la boleta que estaba en espera' : `Se mandaron ${sent} boletas que estaban en espera`); load(); }
  };
  useEffect(() => {
    load();
    flush();
    const on = () => { flush(); };
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);
  // Revisar, corregir y confirmar desde el celular: el dueño o un encargado confirma; los demás pueden corregir
  const canApprove = useManagerAccess();
  const [reviewing, setReviewing] = useState<any | null>(null);
  const pending = (rows || []).filter((p) => p.status === 'PENDING');

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  // Una boleta "Por revisar" no es una compra todavía: no suma a lo comprado ni a la deuda hasta confirmarla
  const confirmed = (rows || []).filter((p) => p.status !== 'PENDING');
  const monthTotal = confirmed.filter((p) => new Date(p.createdAt) >= monthStart).reduce((s, p) => s + p.total, 0);
  const owed = confirmed.filter((p) => p.paymentStatus === 'OWED');

  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (rows || [])
      .filter((p) => filter === 'ALL' || (p.status !== 'PENDING' && p.paymentStatus === filter))
      .filter((p) => !t || `${p.supplier?.name || ''} ${p.invoiceNumber || ''} ${(p.items || []).map((i: any) => i.productName).join(' ')}`.toLowerCase().includes(t));
  }, [rows, search, filter]);
  useEffect(() => setLimit(60), [search, filter]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader
        back
        title="Compras"
      >
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 px-3 py-2.5">
            <p className="text-[11.5px] text-rose-100">Comprado este mes</p>
            <p className="text-[18px] font-bold tabular-nums">{money(monthTotal)}</p>
          </div>
          <div className="rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 px-3 py-2.5">
            <p className="text-[11.5px] text-rose-100">Falta pagar</p>
            <p className="text-[18px] font-bold tabular-nums">{money(owed.reduce((s, p) => s + p.total, 0))}</p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3.5 inset-y-0 my-auto w-[18px] h-[18px] text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Proveedor, factura o producto" className={`${headerInput} pl-10 pr-9`} />
          {search && <button onClick={() => setSearch('')} className="absolute right-1.5 inset-y-0 my-auto w-7 h-7 flex items-center justify-center" aria-label="Borrar búsqueda"><X className="w-4 h-4 text-slate-400" /></button>}
        </div>
        <div className="mt-3">
          <Chips<Filter> options={[{ id: 'ALL', label: 'Todas' }, { id: 'OWED', label: 'A pagar', count: owed.length }, { id: 'PAID', label: 'Pagadas' }]} value={filter} onChange={setFilter} />
        </div>
      </ScreenHeader>

      {/* Escanear la boleta: lo más usado desde el celular, bien a mano */}
      <div className="px-4 pt-3">
        <button onClick={() => setScanning(true)} className="w-full flex items-center gap-3 rounded-2xl bg-rose-600 text-white px-4 py-3.5 text-left active:scale-[0.99] shadow-sm">
          <span className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Camera className="w-6 h-6" /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15.5px] font-bold">Escanear boleta</span>
            <span className="block text-[12.5px] text-rose-100">Sacale foto a la factura del proveedor: se carga sola para revisar en la PC</span>
          </span>
          <ChevronRight className="w-5 h-5 text-rose-200 shrink-0" />
        </button>
        {(scanStage === 'reading' || scanStage === 'uploading') && !scanning && (
          <button onClick={() => setScanning(true)} className="mt-2 w-full flex items-center gap-2 rounded-xl bg-sky-50 border border-sky-100 px-3 py-2 text-left text-[12.5px] font-semibold text-sky-800">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-sky-600 border-t-transparent animate-spin shrink-0" />
            La IA está leyendo una boleta: te avisamos cuando termine. Tocá para ver.
          </button>
        )}
        {pending.length > 0 && (
          <p className="mt-2 text-[12.5px] text-amber-800 font-semibold">{pending.length === 1 ? '1 boleta escaneada espera' : `${pending.length} boletas escaneadas esperan`} {canApprove ? 'que las revises: tocá una para corregirla y confirmarla' : 'revisión: tocá una para corregirla'}.</p>
        )}
        {queued > 0 && (
          <p className="mt-1.5 text-[12.5px] text-sky-800 font-semibold">{queued === 1 ? '1 boleta espera' : `${queued} boletas esperan`} conexión: se manda{queued === 1 ? '' : 'n'} sola{queued === 1 ? '' : 's'} cuando vuelva internet.</p>
        )}
      </div>
      <ScanInvoiceSheet open={scanning} onClose={() => setScanning(false)} onDone={load} />

      <div
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 500 && limit < list.length) setLimit((l) => l + 60); }}
      >
        {rows === null ? <ListSkeleton /> : list.length === 0 ? (
          <EmptyState icon={ShoppingBag} title={search ? 'Sin resultados' : 'No hay compras'} text={!search ? 'Escaneá la boleta del proveedor con el botón de arriba, o cargala desde la PC.' : undefined} />
        ) : (
          <div className="px-4 py-3">
            <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
              {list.slice(0, limit).map((p) => (
                <button key={p.id} onClick={() => (p.status === 'PENDING' && p.draft ? setReviewing(p) : setSelected(p))} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
                  <span className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center shrink-0"><ShoppingBag className="w-[18px] h-[18px] text-rose-600" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14.5px] font-medium text-slate-800 truncate">{p.supplier?.name || 'Sin proveedor'}</span>
                    <span className="block text-[12px] text-slate-500 truncate">{new Date(p.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · {(p.status === 'PENDING' ? p.draft?.items?.length : p.items?.length) || 0} productos{p.invoiceNumber ? ` · Fact. ${p.invoiceNumber}` : ''}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[14.5px] font-semibold text-slate-900 tabular-nums">{money(p.total)}</span>
                    {p.status === 'PENDING'
                      ? <span className="block text-[11px] font-semibold text-amber-700">Por revisar</span>
                      : <span className={`block text-[11px] font-semibold ${p.paymentStatus === 'OWED' ? 'text-red-600' : 'text-emerald-600'}`}>{p.paymentStatus === 'OWED' ? 'A pagar' : 'Pagada'}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <ReviewInvoiceSheet purchase={reviewing} open={!!reviewing} onClose={() => setReviewing(null)} onDone={load} canConfirm={canApprove} />

      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected?.supplier?.name || 'Compra'}>
        {selected && (
          <div className="space-y-4 pt-1">
            <div className="text-center">
              <p className="text-[30px] font-bold text-slate-900 tabular-nums tracking-tight">{money(selected.total)}</p>
              <p className="text-[13px] text-slate-500">
                {new Date(selected.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
                {selected.invoiceNumber ? ` · Factura ${selected.invoiceNumber}` : ''}
              </p>
              <span className={`inline-block mt-2 text-[12px] font-semibold px-2.5 py-1 rounded-full ${selected.paymentStatus === 'OWED' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                {selected.paymentStatus === 'OWED' ? 'A pagar' : `Pagada${selected.paymentMethod ? ` · ${selected.paymentMethod}` : ''}`}
              </span>
            </div>
            <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
              {(selected.items || []).map((i: any) => (
                <div key={i.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13.5px] text-slate-800 leading-snug">{i.productName}</p>
                    <p className="text-[12px] text-slate-500 tabular-nums">{qty(i.quantity)} × {money(i.cost)}</p>
                  </div>
                  <p className="text-[13.5px] font-medium text-slate-800 tabular-nums">{money(i.total)}</p>
                </div>
              ))}
            </div>
            {selected.notes && <p className="rounded-2xl bg-slate-50 px-4 py-3 text-[13.5px] text-slate-700">{selected.notes}</p>}
            {selected.status === 'PENDING' && selected.draft && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
                <p className="text-[13.5px] font-bold text-amber-900">Boleta escaneada por revisar</p>
                <p className="text-[12.5px] text-amber-900">{(selected.draft.items || []).length} productos{selected.draft.check?.message ? ` · ${selected.draft.check.message}` : ''}{selected.draft.editedOnPhone?.by ? ` · la corrigió ${selected.draft.editedOnPhone.by}` : ''}</p>
                <p className="text-[12px] text-amber-800">Todavía no suma stock ni deuda.</p>
                <button onClick={() => { setReviewing(selected); setSelected(null); }} className="w-full h-12 rounded-xl bg-rose-600 text-white font-bold text-[15px] active:scale-[0.99]">{canApprove ? 'Revisar y confirmar' : 'Revisar y corregir'}</button>
              </div>
            )}
            <p className="text-[12px] text-slate-400 text-center">Cargada por {selected.user?.fullName || '—'}</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}

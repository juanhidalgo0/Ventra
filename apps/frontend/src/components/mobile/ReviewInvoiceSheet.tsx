import { useEffect, useMemo, useState } from 'react';
import CashSourcePicker, { CashSource } from '../common/CashSourcePicker';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, ChevronRight, Search, Trash2, Plus, PackagePlus, Link2 } from 'lucide-react';
import api from '../../services/api';
import { Sheet, PrimaryButton, money, qty, parseAmount } from './ui';
import ScanNotesPanel, { applyRaiseGroup, type ScanNote } from '../products/ScanNotesPanel';
import { useStoredPhotos } from '../products/InvoiceBoletaView';
import InvoiceCards from './InvoiceCards';

/**
 * Revisar y corregir una boleta escaneada desde el celular (2026-11-14).
 *
 * Hasta acá el celular solo dejaba confirmar las boletas "limpias"; las demás había que pasarlas a la PC.
 * Ahora se puede tocar cada renglón (producto, cantidad, costo, precio de venta, borrarlo), elegir el
 * proveedor, el número y si se pagó o queda a cuenta, viendo en vivo si los renglones suman el total.
 *
 * Mientras no se confirma, la boleta sigue "Por revisar": no suma stock, no cambia precios y NO es deuda.
 * "Guardar" deja las correcciones para terminarla después (en el celular o en la PC); "Confirmar" (dueño o
 * encargado) la carga de verdad.
 */

type Line = {
  name: string; sku?: string; barcode?: string; quantity: number; cost: number; total: number;
  suggestedSalePrice?: number; unitsPerPack?: number; doubtful?: boolean; reasons?: string[];
  candidates?: { id: string; name: string; costPrice?: number; salePrice?: number }[];
  product?: { id: string; name: string; salePrice?: number; costPrice?: number } | null;
  shared?: any; handPrice?: number | null; changePct?: number | null; edited?: boolean;
  [k: string]: any;
};

const toLines = (items: any[]): Line[] => (items || []).map((it) => ({ ...it, quantity: Number(it.quantity) || 0, cost: Number(it.cost) || 0, total: Number(it.total) || (Number(it.quantity) || 0) * (Number(it.cost) || 0) }));
const numStr = (n: number | undefined | null) => (n === undefined || n === null || !isFinite(n) ? '' : String(Math.round(n * 100) / 100).replace('.', ','));
/** Con IVA, como figura en la boleta (los costos de la lectura siempre vienen sin IVA) */
const withIva = (lines: Line[]) => lines.reduce((s, l) => s + l.quantity * l.cost, 0) * 1.21;

export default function ReviewInvoiceSheet({ purchase, open, onClose, onDone, canConfirm }: {
  purchase: any | null; open: boolean; onClose: () => void; onDone: () => void; canConfirm: boolean;
}) {
  const d = purchase?.draft || {};
  const [lines, setLines] = useState<Line[]>([]);
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [printed, setPrinted] = useState('');
  const [payment, setPayment] = useState<'PAID' | 'OWED'>('OWED');
  const [cashSource, setCashSource] = useState<CashSource | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<'' | 'save' | 'confirm'>('');
  const [editing, setEditing] = useState<number | null>(null);
  const [pickSupplier, setPickSupplier] = useState(false);
  const [confirmAnyway, setConfirmAnyway] = useState(false);
  // Avisos de la boleta resueltos con su botón (regalos, boleta vieja, correcciones a mano, aumentos)
  const [notesDone, setNotesDone] = useState<Set<number>>(new Set());
  // De a un renglón (tarjetas con el pedacito de foto) o la lista de siempre
  const [view, setView] = useState<'tarjetas' | 'lista'>('tarjetas');
  // Las fotos de la boleta que quedaron guardadas con la compra
  const storedPhotos = useStoredPhotos(purchase?.id, open);

  useEffect(() => {
    if (!purchase || !open) return;
    const dd = purchase.draft || {};
    setLines(toLines(dd.items));
    const sid = dd.matchedSupplier?.id || purchase.supplierId;
    setSupplier(sid ? { id: sid, name: dd.matchedSupplier?.name || purchase.supplier?.name || dd.supplierName || 'Proveedor' } : null);
    setInvoiceNumber(dd.invoiceNumber || purchase.invoiceNumber || '');
    setPrinted(Number(dd.printedTotal) > 0 ? numStr(Number(dd.printedTotal)) : '');
    setPayment(dd.paymentSuggested === 'PAID' ? 'PAID' : 'OWED');
    setDirty(false); setConfirmAnyway(false); setEditing(null); setNotesDone(new Set());
  }, [purchase?.id, open]);

  const runNote = async (note: ScanNote, index: number) => {
    const a = note.action;
    if (!a) return;
    const mark = () => setNotesDone((prev) => new Set(prev).add(index));
    if (a.type === 'applyHand') {
      // Lo anotado a mano: la cantidad corregida
      change((ls) => ls.map((l) => (l.handQuantity !== null && l.handQuantity !== undefined && Number(l.handQuantity) >= 0 ? { ...l, quantity: Number(l.handQuantity), handQuantity: null, edited: true } : l)));
      mark();
    } else if (a.type === 'handTotal' && Number(a.amount) > 0) {
      setPrinted(String(Math.round(Number(a.amount) * 100) / 100).replace('.', ','));
      setDirty(true); setConfirmAnyway(false);
      mark();
    } else if (a.type === 'updateCosts') {
      change((ls) => ls.map((l) => (l.stockOnly ? { ...l, stockOnly: false } : l)));
      mark();
    } else if (a.type === 'raiseGroup') {
      if (await applyRaiseGroup(a, `Aumento de ${supplier?.name || 'proveedor'} (boleta ${invoiceNumber || ''})`.trim())) mark();
    }
  };

  const sum = withIva(lines);
  const printedN = parseAmount(printed);
  const diff = printedN > 0 ? sum - printedN : null;
  const closes = diff !== null && Math.abs(diff) <= Math.max(50, printedN * 0.005);
  const toLook = lines.filter((l) => !l.edited && (l.doubtful || (!l.product && l.candidates?.length)));
  const blockedReason = d.creditNote ? 'Es una nota de crédito: confirmala en la PC.' : d.remitoMatch ? 'Parece la factura de un remito ya cargado: confirmala en la PC para no sumar el stock dos veces.' : '';

  const change = (fn: (l: Line[]) => Line[]) => { setLines(fn); setDirty(true); setConfirmAnyway(false); };
  const body = () => ({
    items: lines.map(({ edited, ...l }) => ({ ...l, total: Math.round(l.quantity * l.cost * 100) / 100, ...(edited ? { doubtful: false, reasons: [] } : {}) })),
    supplierId: supplier?.id || null,
    invoiceNumber,
    paymentSuggested: payment,
    printedTotal: printedN > 0 ? printedN : null,
  });

  const save = async (quiet = false) => {
    setSaving('save');
    try {
      await api.put(`/purchases/${purchase.id}/draft`, body());
      setDirty(false);
      if (!quiet) { toast.success('Cambios guardados. Sigue por revisar: no se tocó el stock ni la deuda.'); onDone(); onClose(); }
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudieron guardar los cambios');
      return false;
    } finally {
      setSaving('');
    }
  };

  const confirm = async () => {
    if (!supplier) { toast.error('Elegí el proveedor'); setPickSupplier(true); return; }
    if (!lines.length) return toast.error('La boleta no tiene renglones');
    if ((diff !== null && !closes || toLook.length) && !confirmAnyway) { setConfirmAnyway(true); return; }
    setSaving('confirm');
    try {
      if (dirty) await api.put(`/purchases/${purchase.id}/draft`, body());
      await api.put(`/purchases/${purchase.id}/confirm`, {
        supplierId: supplier.id,
        invoiceNumber: invoiceNumber || undefined,
        invoiceDate: d.invoiceDate || undefined,
        manualTotal: printedN > 0 ? printedN : undefined,
        paymentStatus: payment,
        cashSource: payment === 'PAID' ? cashSource : null,
        items: lines.filter((l) => l.quantity > 0).map((it) => ({
          productId: it.product?.id || undefined, quantity: it.quantity, cost: it.cost, buyFormat: 'UNIT',
          // Regalo: el producto queda con el costo sin regalo; boleta vieja: solo suma stock
          freeUnits: Number(it.freeUnits) > 0 && it.quantity > Number(it.freeUnits) ? Number(it.freeUnits) : undefined,
          stockOnly: it.product && it.stockOnly ? true : undefined,
          salePrice: it.product && (it.stockOnly || it.gift) ? undefined : it.suggestedSalePrice || undefined, source: { code: it.sku || undefined, name: it.name },
          newProductData: it.product ? undefined : { name: String(it.shared?.confidence === 'alta' && it.shared?.name ? it.shared.name : it.name).toUpperCase(), barcode: it.barcode || undefined, sku: it.sku || undefined, salePrice: it.suggestedSalePrice, taxRate: 21 },
        })),
      });
      toast.success(payment === 'OWED' ? 'Boleta confirmada: se sumó el stock y quedó a cuenta del proveedor' : 'Boleta confirmada: se sumó el stock y se actualizaron los precios');
      onDone(); onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo confirmar. Revisala en la PC.');
    } finally {
      setSaving('');
    }
  };

  const tryClose = () => {
    if (saving) return;
    if (dirty && !window.confirm('Tenés cambios sin guardar. ¿Salir igual?')) return;
    onClose();
  };

  return (
    <>
      <Sheet open={open && !!purchase} onClose={tryClose} title="Revisar boleta"
        footer={
          <div className="space-y-2">
            {confirmAnyway && (
              <p className="text-[12.5px] font-semibold text-amber-800 text-center">
                {diff !== null && !closes ? `Los renglones no suman el total (diferencia ${money(Math.abs(diff))}). ` : ''}
                {toLook.length ? `Quedan ${toLook.length} ${toLook.length === 1 ? 'renglón' : 'renglones'} para mirar. ` : ''}Tocá de nuevo para confirmar igual.
              </p>
            )}
            {canConfirm && !blockedReason ? (
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <button onClick={() => save()} disabled={!!saving || !dirty} className="h-12 px-4 rounded-2xl border border-slate-300 text-slate-700 font-semibold text-[14px] disabled:opacity-40">{saving === 'save' ? 'Guardando…' : 'Guardar'}</button>
                <PrimaryButton onClick={confirm} loading={saving === 'confirm'} disabled={!!saving}>{confirmAnyway ? 'Confirmar igual' : 'Confirmar boleta'}</PrimaryButton>
              </div>
            ) : (
              <PrimaryButton onClick={() => save()} loading={saving === 'save'} disabled={!dirty}>{dirty ? 'Guardar correcciones' : 'Sin cambios'}</PrimaryButton>
            )}
          </div>
        }>
        {purchase && (
          <div className="space-y-3.5 pt-1 pb-2">
            {/* Lo que la lectura marcó para mirar */}
            {(d.why || []).length > 0 && (
              <div className="rounded-2xl bg-amber-50 border border-amber-100 px-3.5 py-2.5 text-[12.5px] text-amber-900">
                <b>Para mirar:</b> {(d.why || []).join('; ')}.
              </div>
            )}
            {Array.isArray(d.scanNotes) && d.scanNotes.length > 0 && <ScanNotesPanel notes={d.scanNotes} done={notesDone} onAction={runNote} compact />}
            {blockedReason && <p className="rounded-2xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-[12.5px] font-semibold text-red-800">{blockedReason}</p>}

            {/* Proveedor y número */}
            <button onClick={() => setPickSupplier(true)} className="w-full flex items-center gap-3 rounded-2xl border border-slate-200 px-3.5 py-3 text-left">
              <span className="flex-1 min-w-0">
                <span className="block text-[11.5px] text-slate-500">Proveedor</span>
                <span className={`block text-[15px] font-semibold truncate ${supplier ? 'text-slate-900' : 'text-red-700'}`}>{supplier?.name || 'Elegí el proveedor'}</span>
              </span>
              <ChevronRight className="w-5 h-5 text-slate-400" />
            </button>
            <div className="grid grid-cols-2 gap-2">
              <label className="rounded-2xl border border-slate-200 px-3.5 py-2">
                <span className="block text-[11.5px] text-slate-500">N° de factura</span>
                <input value={invoiceNumber} onChange={(e) => { setInvoiceNumber(e.target.value); setDirty(true); }} className="w-full bg-transparent outline-none text-[15px] font-semibold text-slate-900" placeholder="0001-00001234" />
              </label>
              <label className="rounded-2xl border border-slate-200 px-3.5 py-2">
                <span className="block text-[11.5px] text-slate-500">Total de la boleta</span>
                <input inputMode="decimal" value={printed} onChange={(e) => { setPrinted(e.target.value.replace(/[^\d.,]/g, '')); setDirty(true); setConfirmAnyway(false); }} className="w-full bg-transparent outline-none text-[15px] font-semibold text-slate-900 tabular-nums" placeholder="$ con IVA" />
              </label>
            </div>

            {/* ¿Cierra? en vivo */}
            <div className={`rounded-2xl px-3.5 py-2.5 text-[13px] flex gap-2.5 items-start ${diff === null ? 'bg-slate-50 text-slate-700' : closes ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
              {diff !== null && closes ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
              <span>
                Los renglones suman <b className="tabular-nums">{money(sum)}</b> con IVA
                {diff === null ? '. Poné el total de la boleta para controlar que cierre.' : closes ? ': coincide con la boleta.' : <>; la boleta dice <b className="tabular-nums">{money(printedN)}</b> ({diff > 0 ? 'sobran' : 'faltan'} {money(Math.abs(diff))}).</>}
              </span>
            </div>

            {/* Renglones: de a uno en tarjetas (con el pedacito de foto) o la lista de siempre */}
            <div className="flex justify-end">
              <div className="inline-flex rounded-xl border border-slate-300 overflow-hidden text-[12.5px] font-semibold">
                {(['tarjetas', 'lista'] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setView(v)} className={`h-8 px-3 ${view === v ? 'bg-slate-900 text-white' : 'text-slate-700'}`}>{v === 'tarjetas' ? 'De a uno' : 'Lista'}</button>
                ))}
              </div>
            </div>
            {view === 'tarjetas' && lines.length > 0 && (
              <InvoiceCards lines={lines} photos={storedPhotos} photoImages={Array.isArray(d.images) ? d.images.map(Number) : null} turns={Array.isArray(d.photoTurns) ? d.photoTurns.map(Number) : []}
                onOk={(i) => change((ls) => ls.map((l, j) => (j === i ? { ...l, edited: true } : l)))}
                onHand={(i) => change((ls) => ls.map((l, j) => (j === i && l.handQuantity !== null && l.handQuantity !== undefined ? { ...l, quantity: Number(l.handQuantity), handQuantity: null, edited: true } : l)))}
                onEdit={(i) => setEditing(i)} />
            )}
            <div className={view === 'tarjetas' ? 'hidden' : ''}>
              <p className="px-1 pb-1.5 text-[12px] font-semibold text-slate-500">{lines.length} {lines.length === 1 ? 'renglón' : 'renglones'} · tocá uno para corregirlo</p>
              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {lines.map((l, i) => {
                  const look = !l.edited && !!(l.doubtful || (!l.product && l.candidates?.length));
                  return (
                    <button key={i} onClick={() => setEditing(i)} className={`w-full text-left px-3.5 py-2.5 active:bg-slate-50 ${look ? 'bg-amber-50/60' : ''}`}>
                      <div className="flex justify-between gap-3">
                        <span className="min-w-0 text-[13.5px] text-slate-800 leading-snug">
                          {l.product?.name || l.name}
                          {!l.product && <span className="ml-1.5 text-[11px] font-semibold text-sky-700">nuevo</span>}
                          {l.edited && <span className="ml-1.5 text-[11px] font-semibold text-emerald-700">corregido</span>}
                        </span>
                        <span className="text-[13.5px] font-medium text-slate-900 tabular-nums shrink-0">{money(l.quantity * l.cost)}</span>
                      </div>
                      <p className="text-[12px] text-slate-500 tabular-nums">{qty(l.quantity)} × {money(l.cost)} sin IVA{l.suggestedSalePrice ? ` · venta ${money(l.suggestedSalePrice)}` : ''}</p>
                      {look && <p className="text-[11.5px] font-semibold text-amber-800">Mirar: {(l.reasons || []).join(', ') || 'puede que ya lo tengas cargado'}</p>}
                      {Array.isArray(l.info) && l.info.length > 0 && <p className="text-[11.5px] text-emerald-700">{(l.stockOnly ? l.info : l.info.filter((t: string) => !t.startsWith('boleta del'))).join(' · ')}</p>}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => { change((ls) => [...ls, { name: 'PRODUCTO', quantity: 1, cost: 0, total: 0, product: null, candidates: [], edited: true }]); setEditing(lines.length); }}
                className="mt-2 w-full h-11 rounded-xl border border-dashed border-slate-300 text-slate-600 text-[13.5px] font-semibold flex items-center justify-center gap-1.5">
                <Plus className="w-4 h-4" /> Agregar un renglón que faltó
              </button>
            </div>

            {/* Pago */}
            <div>
              <p className="px-1 pb-1.5 text-[12px] font-semibold text-slate-500">¿Cómo se paga?</p>
              <div className="grid grid-cols-2 gap-2">
                {([['OWED', 'Queda a cuenta'], ['PAID', 'Ya está pagada']] as const).map(([v, label]) => (
                  <button key={v} onClick={() => { setPayment(v); setDirty(true); }} className={`h-11 rounded-xl text-[14px] font-semibold border ${payment === v ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-700'}`}>{label}</button>
                ))}
              </div>
              {payment === 'PAID' && <div className="mt-2"><CashSourcePicker value={cashSource} onChange={setCashSource} /></div>}
            </div>
            <p className="text-[12px] text-slate-500 px-1">Hasta que se confirme, esta boleta no suma stock, no cambia precios y no cuenta como deuda.{!canConfirm ? ' La confirma el dueño o un encargado.' : ''}</p>
          </div>
        )}
      </Sheet>

      <LineEditor
        line={editing !== null ? lines[editing] : null}
        onClose={() => setEditing(null)}
        onSave={(l) => { change((ls) => ls.map((x, k) => (k === editing ? { ...l, edited: true } : x))); setEditing(null); }}
        onDelete={() => { change((ls) => ls.filter((_, k) => k !== editing)); setEditing(null); }}
      />
      <SupplierPicker open={pickSupplier} onClose={() => setPickSupplier(false)} suggested={d.supplierName || ''}
        onPick={(s) => { setSupplier(s); setDirty(true); setPickSupplier(false); }} />
    </>
  );
}

/** Corregir un renglón: qué producto es, cantidad, costo y precio de venta */
function LineEditor({ line, onClose, onSave, onDelete }: { line: Line | null; onClose: () => void; onSave: (l: Line) => void; onDelete: () => void }) {
  const [product, setProduct] = useState<Line['product']>(null);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [cost, setCost] = useState('');
  const [sale, setSale] = useState('');
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<any[]>([]);
  useEffect(() => {
    if (!line) return;
    setProduct(line.product || null); setName(line.name || ''); setQ(numStr(line.quantity)); setCost(numStr(line.cost));
    setSale(numStr(line.suggestedSalePrice)); setSearch(''); setFound([]);
  }, [line]);
  useEffect(() => {
    const t = search.trim();
    if (t.length < 2) { setFound([]); return; }
    const h = setTimeout(() => {
      api.get('/products', { params: { search: t, take: 8, isActive: 'true' }, silent: true } as any)
        .then((r) => setFound((Array.isArray(r.data) ? r.data : r.data?.items || r.data?.data || []).slice(0, 8))).catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(h);
  }, [search]);

  const pick = (p: any) => {
    setProduct({ id: p.id, name: p.name, salePrice: p.salePrice, costPrice: p.costPrice });
    if (p.salePrice && !parseAmount(sale)) setSale(numStr(p.salePrice));
    setSearch(''); setFound([]);
  };
  const qN = parseAmount(q), costN = parseAmount(cost);
  const candidates = (line?.candidates || []).filter((c) => c.id !== product?.id);

  return (
    <Sheet open={!!line} onClose={onClose} title="Corregir renglón"
      footer={<PrimaryButton onClick={() => line && onSave({ ...line, product, name: name.trim() || line.name, quantity: qN, cost: costN, total: qN * costN, suggestedSalePrice: parseAmount(sale) || line.suggestedSalePrice, doubtful: false, reasons: [] })} disabled={qN <= 0}>Listo</PrimaryButton>}>
      {line && (
        <div className="space-y-3.5 pt-1 pb-2">
          <p className="text-[12.5px] text-slate-500">En la boleta dice: <b className="text-slate-800">{line.name}</b>{line.sku ? ` (cód. ${line.sku})` : ''}</p>

          <div className="rounded-2xl border border-slate-200 px-3.5 py-3 space-y-2.5">
            <p className="text-[12px] font-semibold text-slate-500">¿Qué producto es?</p>
            {product ? (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2">
                <Link2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="flex-1 min-w-0 text-[13.5px] font-semibold text-emerald-900 truncate">{product.name}</span>
                <button onClick={() => setProduct(null)} className="text-[12px] font-semibold text-slate-600 underline">Es nuevo</button>
              </div>
            ) : (
              <div className="rounded-xl bg-sky-50 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-sky-800"><PackagePlus className="w-4 h-4" /> Producto nuevo: se crea al confirmar con este nombre</p>
                <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full bg-white rounded-lg border border-sky-100 px-2.5 py-1.5 text-[14px] outline-none" />
              </div>
            )}
            {candidates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((c) => (
                  <button key={c.id} onClick={() => pick(c)} className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12.5px] font-semibold text-amber-900">¿Es {c.name}?</button>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-3 inset-y-0 my-auto w-4 h-4 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar otro producto de tu lista" className="w-full h-10 rounded-xl bg-slate-50 border border-slate-200 pl-9 pr-3 text-[14px] outline-none focus:bg-white" />
            </div>
            {found.length > 0 && (
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {found.map((p) => (
                  <button key={p.id} onClick={() => pick(p)} className="w-full flex justify-between gap-2 px-3 py-2 text-left text-[13px]">
                    <span className="min-w-0 truncate text-slate-800">{p.name}</span>
                    <span className="shrink-0 text-slate-500 tabular-nums">{money(p.salePrice || 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="rounded-2xl border border-slate-200 px-3.5 py-2">
              <span className="block text-[11.5px] text-slate-500">Cantidad (unidades)</span>
              <input inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value.replace(/[^\d.,]/g, ''))} className="w-full bg-transparent outline-none text-[17px] font-bold tabular-nums" />
            </label>
            <label className="rounded-2xl border border-slate-200 px-3.5 py-2">
              <span className="block text-[11.5px] text-slate-500">Costo c/u sin IVA</span>
              <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.,]/g, ''))} className="w-full bg-transparent outline-none text-[17px] font-bold tabular-nums" />
            </label>
          </div>
          <p className="px-1 text-[12.5px] text-slate-600 tabular-nums">Total del renglón: <b>{money(qN * costN)}</b> sin IVA · {money(qN * costN * 1.21)} con IVA</p>
          <label className="block rounded-2xl border border-slate-200 px-3.5 py-2">
            <span className="block text-[11.5px] text-slate-500">Precio de venta{product?.salePrice ? ` (hoy ${money(product.salePrice)})` : ''}</span>
            <input inputMode="decimal" value={sale} onChange={(e) => setSale(e.target.value.replace(/[^\d.,]/g, ''))} className="w-full bg-transparent outline-none text-[17px] font-bold tabular-nums" />
          </label>
          <button onClick={onDelete} className="w-full h-11 rounded-xl text-red-700 text-[14px] font-semibold flex items-center justify-center gap-1.5"><Trash2 className="w-4 h-4" /> Sacar este renglón</button>
        </div>
      )}
    </Sheet>
  );
}

/** Elegir el proveedor (o crearlo con el nombre que leyó la IA) */
function SupplierPicker({ open, onClose, onPick, suggested }: { open: boolean; onClose: () => void; onPick: (s: { id: string; name: string }) => void; suggested: string }) {
  const [list, setList] = useState<any[] | null>(null);
  const [t, setT] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!open) return;
    setT('');
    api.get('/suppliers').then((r) => setList(r.data || [])).catch(() => setList([]));
  }, [open]);
  const shown = useMemo(() => {
    const s = t.trim().toLowerCase();
    return (list || []).filter((x) => !s || String(x.name || '').toLowerCase().includes(s)).slice(0, 50);
  }, [list, t]);
  const newName = (t.trim() || suggested).trim();
  const create = async () => {
    if (!newName) return;
    setCreating(true);
    try {
      const { data } = await api.post('/suppliers', { name: newName });
      onPick({ id: data.id, name: data.name });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo crear el proveedor');
    } finally {
      setCreating(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Proveedor">
      <div className="space-y-3 pt-1 pb-2">
        <div className="relative">
          <Search className="absolute left-3 inset-y-0 my-auto w-4 h-4 text-slate-400" />
          <input value={t} onChange={(e) => setT(e.target.value)} placeholder="Buscar proveedor" className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 pl-9 pr-3 text-[15px] outline-none focus:bg-white" />
        </div>
        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 max-h-[45vh] overflow-y-auto">
          {list === null ? <p className="px-3.5 py-3 text-[13px] text-slate-500">Cargando…</p> : shown.length === 0 ? <p className="px-3.5 py-3 text-[13px] text-slate-500">No hay proveedores con ese nombre.</p> : shown.map((s) => (
            <button key={s.id} onClick={() => onPick({ id: s.id, name: s.name })} className="w-full px-3.5 py-3 text-left text-[14.5px] text-slate-800 active:bg-slate-50">{s.name}</button>
          ))}
        </div>
        {newName && !shown.some((s) => String(s.name).toLowerCase() === newName.toLowerCase()) && (
          <button onClick={create} disabled={creating} className="w-full h-11 rounded-xl border border-dashed border-slate-300 text-slate-700 text-[13.5px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Plus className="w-4 h-4" /> {creating ? 'Creando…' : `Crear "${newName}"`}
          </button>
        )}
      </div>
    </Sheet>
  );
}

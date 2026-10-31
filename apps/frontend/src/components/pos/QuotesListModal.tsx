import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, X, Search, ShoppingCart, Share2, Trash2, RefreshCw, Ban, Printer, ClipboardList, AlertTriangle, KeyRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { usePOSStore } from '../../stores/posStore';
import { useFeature } from '../../stores/businessStore';
import { buildQuickSaleProduct, QUICK_SALE_PRODUCT_ID } from './QuickSaleModal';
import { QuotePreview, quoteToWorkOrderDraft, quoteWhatsappUrl } from './QuoteDocument';

const STATUS_TABS: Record<string, string> = {
  PENDING: 'Pendientes', CONVERTED: 'Aceptados', EXPIRED: 'Vencidos', CANCELLED: 'Rechazados', ALL: 'Todos',
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'PENDIENTE', cls: 'bg-amber-100 text-amber-800' },
  CONVERTED: { label: 'ACEPTADO', cls: 'bg-emerald-100 text-emerald-800' },
  EXPIRED: { label: 'VENCIDO', cls: 'bg-orange-100 text-orange-800' },
  CANCELLED: { label: 'RECHAZADO', cls: 'bg-slate-100 text-slate-600' },
};

const moneyOf = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
/** Renglón con un producto del catálogo (las promos, lo borrado y la venta rápida no lo tienen) */
const isLinked = (item: any) => !!item.product && item.product.id !== QUICK_SALE_PRODUCT_ID;
const priceChanged = (item: any) => isLinked(item) && Math.abs(Number(item.product.salePrice) - item.unitPrice) > 0.009;

type QuoteAction = 'cart' | 'order';

interface QuotesListModalProps {
  onClose: () => void;
  /** Sin esto no se puede cargar al carrito: la lista se abrió desde Encargos */
  onLoadCart?: () => void;
  /** Desde Encargos, el borrador va directo al editor; desde la caja, se navega hasta ahí */
  onToWorkOrder?: (draft: any) => void;
}

export default function QuotesListModal({ onClose, onLoadCart, onToWorkOrder }: QuotesListModalProps) {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [preview, setPreview] = useState<any | null>(null);
  const [review, setReview] = useState<{ quote: any; action: QuoteAction } | null>(null);
  const [ownerKey, setOwnerKey] = useState<{ quote: any; reason: string; pass: string } | null>(null);
  const canWorkOrder = useFeature('workorders');
  const navigate = useNavigate();

  const { addToCart, clearCart, setActiveQuote } = usePOSStore();

  const fetchQuotes = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/quotes', {
        params: { status: statusFilter !== 'ALL' ? statusFilter : undefined }
      });
      setQuotes(res.data || []);
    } catch (err) {
      toast.error('Error al cargar presupuestos');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotes();
  }, [statusFilter]);

  const loadToCart = (quote: any, todayPrices: boolean) => {
    clearCart();
    quote.items.forEach((item: any) => {
      const name = `${item.productName || item.product?.name || 'Item'}${item.specs ? ` (${String(item.specs).slice(0, 80)})` : ''}`;
      if (isLinked(item)) {
        addToCart({ ...item.product, name }, todayPrices ? undefined : item.unitPrice, item.quantity);
      } else {
        // Sin producto en el catálogo: entra como venta rápida, con su nombre y su precio
        addToCart({ ...buildQuickSaleProduct(item.unitPrice), name, lineTag: item.id }, item.unitPrice, item.quantity);
      }
    });
    // Al cobrar este ticket, el presupuesto queda aceptado
    setActiveQuote({ id: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName || '' });

    // Las promos se recalculan en el carrito: si el total no da igual, que se vea antes de cobrar
    const cartTotal = usePOSStore.getState().getFinalTotal();
    if (!todayPrices && Math.abs(cartTotal - quote.total) > 0.5) {
      toast(`El presupuesto decía ${moneyOf(quote.total)} y el carrito da ${moneyOf(cartTotal)}. Revisalo antes de cobrar.`, { icon: '⚠️', duration: 8000 });
    }

    onLoadCart?.();
    onClose();
  };

  const toWorkOrder = (quote: any, todayPrices: boolean) => {
    const draft = quoteToWorkOrderDraft(quote, todayPrices);
    if (onToWorkOrder) {
      onToWorkOrder(draft);
    } else {
      try { sessionStorage.setItem('ventra_workorder_from_online', JSON.stringify(draft)); } catch { /* sin espacio: se carga a mano */ }
      navigate('/encargos?nuevo=1');
    }
    onClose();
  };

  // Vencido, con precios que cambiaron o con renglones fuera del catálogo: se pregunta antes de seguir
  const start = (quote: any, action: QuoteAction) => {
    if (!quote.items?.length) {
      toast.error('Este presupuesto no tiene productos');
      return;
    }
    const needsReview = quote.status === 'EXPIRED' || quote.items.some(priceChanged) || (action === 'cart' && quote.items.some((i: any) => !isLinked(i)));
    if (needsReview) { setReview({ quote, action }); return; }
    if (action === 'cart') loadToCart(quote, false);
    else toWorkOrder(quote, false);
  };

  const proceed = (todayPrices: boolean) => {
    if (!review) return;
    const { quote, action } = review;
    setReview(null);
    if (action === 'cart') loadToCart(quote, todayPrices);
    else toWorkOrder(quote, todayPrices);
  };

  const handleRejectQuote = async (quote: any) => {
    if (!window.confirm(`¿Marcar el presupuesto ${quote.quoteNumber} como rechazado?`)) return;
    try {
      await api.patch(`/quotes/${quote.id}/status`, { status: 'CANCELLED' });
      toast.success('Presupuesto marcado como rechazado');
      fetchQuotes();
    } catch (err) {
      toast.error('No se pudo cambiar el estado');
    }
  };

  // Borrar lo autoriza el dueño: si el servidor pide la clave, se pide y se reintenta
  const removeQuote = async (quote: any, adminPassword?: string) => {
    try {
      await api.delete('/quotes/' + quote.id, { data: adminPassword ? { adminPassword } : {} });
      setQuotes((list) => list.filter(q => q.id !== quote.id));
      setOwnerKey(null);
      toast.success('Presupuesto eliminado');
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.needsAdmin) {
        if (adminPassword) toast.error(data.message);
        setOwnerKey({ quote, reason: data.message, pass: '' });
      } else {
        toast.error(data?.message || 'Error al eliminar presupuesto');
      }
    }
  };

  const handleDeleteQuote = (quote: any) => {
    if (!window.confirm('¿Seguro que deseas eliminar este presupuesto?')) return;
    removeQuote(quote);
  };

  // Campos con los nombres del servidor; un dato vacío no debe romper la lista
  const filteredQuotes = quotes.filter(q =>
    (q.clientName || '').toLowerCase().includes(search.toLowerCase()) ||
    (q.clientPhone || '').includes(search) ||
    String(q.quoteNumber || '').includes(search)
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
              <FileText className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Presupuestos Guardados</h2>
              <p className="text-xs text-slate-500">{onLoadCart ? 'Cargá cotizaciones pendientes directamente al carrito con 1 clic' : 'Cuando el cliente acepta, pasalo a encargo'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-slate-200 bg-white flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por cliente, número o teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-amber-500"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {['PENDING', 'CONVERTED', 'EXPIRED', 'CANCELLED', 'ALL'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                  statusFilter === st
                    ? 'bg-amber-500 border-amber-500 text-white shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {STATUS_TABS[st]}
              </button>
            ))}
          </div>
        </div>

        {/* Quotes List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
              <p className="text-xs font-medium">Cargando presupuestos...</p>
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <FileText className="w-10 h-10 mx-auto stroke-1 text-slate-300" />
              <p className="text-sm font-semibold">No se encontraron presupuestos</p>
              <p className="text-xs text-slate-400">{onLoadCart ? 'Podés crear uno nuevo desde el carrito en el botón "Presup."' : 'Podés crear uno nuevo desde Nuevo encargo, con el botón "Presupuesto".'}</p>
            </div>
          ) : (
            filteredQuotes.map((quote) => (
              <div
                key={quote.id}
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-amber-300 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200">
                      {quote.quoteNumber}
                    </span>
                    <h3 className="font-bold text-slate-900 text-sm">{quote.clientName}</h3>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${(STATUS_BADGE[quote.status] || STATUS_BADGE.CANCELLED).cls}`}>
                      {(STATUS_BADGE[quote.status] || { label: quote.status }).label}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
                    <span>{new Date(quote.createdAt).toLocaleDateString('es-AR')}</span>
                    <span>•</span>
                    <span>{quote.items?.length || 0} artículos</span>
                    {quote.clientPhone && (
                      <>
                        <span>•</span>
                        <span>{quote.clientPhone}</span>
                      </>
                    )}
                  </div>
                  {quote.notes && (
                    <p className="text-[11px] text-slate-600 italic">"{quote.notes}"</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:self-center">
                  <span className="text-base font-extrabold text-slate-900 mr-2">
                    ${Number(quote.total).toLocaleString('es-AR')}
                  </span>

                  <button
                    onClick={() => window.open(quoteWhatsappUrl(quote), '_blank')}
                    className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all border border-emerald-200 cursor-pointer"
                    title="Compartir por WhatsApp"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setPreview(quote)}
                    className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-all cursor-pointer"
                    title="Ver e imprimir en hoja A4"
                  >
                    <Printer className="w-4 h-4" />
                  </button>

                  {/* Aceptados y rechazados ya no se cobran desde acá */}
                  {(quote.status === 'PENDING' || quote.status === 'EXPIRED') && (
                    <>
                      <button
                        onClick={() => handleRejectQuote(quote)}
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
                        title="El cliente no lo aceptó: marcar como rechazado"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                      {canWorkOrder && (
                        <button
                          onClick={() => start(quote, 'order')}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
                        >
                          <ClipboardList className="w-4 h-4" />
                          <span>Pasar a encargo</span>
                        </button>
                      )}
                      {onLoadCart && (
                        <button
                          onClick={() => start(quote, 'cart')}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
                        >
                          <ShoppingCart className="w-4 h-4" />
                          <span>Cargar Carrito</span>
                        </button>
                      )}
                    </>
                  )}

                  <button
                    onClick={() => handleDeleteQuote(quote)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                    title="Eliminar presupuesto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>

      {review && (() => {
        const { quote, action } = review;
        const changed = quote.items.filter(priceChanged);
        const unlinked = action === 'cart' ? quote.items.filter((i: any) => !isLinked(i)) : [];
        const todayTotal = quote.items.reduce((s: number, i: any) => s + (isLinked(i) ? Number(i.product.salePrice) : i.unitPrice) * i.quantity, 0);
        return (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-3">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900"><AlertTriangle className="w-5 h-5 text-amber-600" /> Revisá el presupuesto {quote.quoteNumber}</h3>
              <ul className="text-sm text-slate-700 space-y-2 list-disc pl-5">
                {quote.status === 'EXPIRED' && <li>Venció el {new Date(quote.validUntil).toLocaleDateString('es-AR')}.</li>}
                {changed.length > 0 && <li>
                  Cambió el precio de {changed.length === 1 ? '1 producto' : `${changed.length} productos`}:
                  <span className="block mt-1 text-xs text-slate-600">
                    {changed.slice(0, 5).map((i: any) => <span key={i.id} className="block">{i.productName}: {moneyOf(i.unitPrice)} → {moneyOf(i.product.salePrice)}</span>)}
                  </span>
                </li>}
                {unlinked.length > 0 && <li>{unlinked.length === 1 ? '1 renglón no está' : `${unlinked.length} renglones no están`} en el catálogo: {unlinked.map((i: any) => i.productName).join(', ')}. Se cobra como venta rápida y <b>no descuenta stock</b>.</li>}
              </ul>
              <div className="flex flex-col gap-2 pt-1">
                <button onClick={() => proceed(false)} className="h-11 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold cursor-pointer">Usar el precio del presupuesto ({moneyOf(quote.total)})</button>
                {changed.length > 0 && <button onClick={() => proceed(true)} className="h-11 rounded-xl border border-slate-300 text-slate-800 hover:bg-slate-50 text-sm font-bold cursor-pointer">Usar los precios de hoy ({moneyOf(todayTotal)})</button>}
                <button onClick={() => setReview(null)} className="h-10 text-sm font-semibold text-slate-500 cursor-pointer">Volver</button>
              </div>
            </div>
          </div>
        );
      })()}

      {ownerKey && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <form role="dialog" aria-modal="true" className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (ownerKey.pass) removeQuote(ownerKey.quote, ownerKey.pass); }}>
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-900"><KeyRound className="w-5 h-5 text-amber-600" /> Lo autoriza el dueño</h3>
            <p className="text-sm text-slate-600">{ownerKey.reason}</p>
            <input type="password" autoFocus value={ownerKey.pass} onChange={(e) => setOwnerKey({ ...ownerKey, pass: e.target.value })} placeholder="Clave del administrador"
              className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm outline-none focus:border-amber-500" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOwnerKey(null)} className="btn-secondary">Volver</button>
              <button type="submit" disabled={!ownerKey.pass} className="btn-primary">Autorizar y borrar</button>
            </div>
          </form>
        </div>
      )}

      {preview && <QuotePreview quote={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
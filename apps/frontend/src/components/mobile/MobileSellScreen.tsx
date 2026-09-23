import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { haptic } from '../../utils/haptics';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Search, ScanLine, Minus, Plus, Trash2, ShoppingBag, ChevronRight, Check, Wallet, X, Star, Tag,
  Banknote, CreditCard, Smartphone, UserRound,
} from 'lucide-react';
import api from '../../services/api';
import { usePOSStore } from '../../stores/posStore';
import { ScreenHeader, headerInput, Chips, Sheet, PrimaryButton, MoneyInput, EmptyState, money, qty, parseAmount } from './ui';
import BarcodeScanner, { canScanBarcodes } from './BarcodeScanner';
import { useCashSession } from './useCashSession';
import { applySurcharges, getPaymentMethods } from './checkout';

const PAGE = 40;

const methodIcon = (id: string) =>
  id === 'CASH' ? Banknote : id === 'DEBT' ? UserRound : /mercado|mp|qr|transfer/i.test(id) ? Smartphone : CreditCard;

export default function MobileSellScreen() {
  const {
    products, categories, clients, cart, addToCart, updateQuantity, removeFromCart, clearCart,
    getFinalTotal, getTotal, getDiscounts, getItemCount, getCheckoutPayload, getCartItemsWithDiscounts, setProducts,
  } = usePOSStore();
  const cash = useCashSession();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [scanning, setScanning] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const cartQty = useMemo(() => {
    const map: Record<string, number> = {};
    for (const i of cart) if (!i.isPromo && !i.isReturn) map[i.productId] = (map[i.productId] || 0) + i.quantity;
    return map;
  }, [cart]);

  const categoryOptions = useMemo(() => {
    const used = new Set(products.map((p: any) => p.categoryId).filter(Boolean));
    return [
      { id: 'ALL', label: 'Todos' },
      ...(products.some((p: any) => p.isFavorite) ? [{ id: 'FAV', label: 'Favoritos' }] : []),
      ...categories.filter((c: any) => used.has(c.id)).map((c: any) => ({ id: c.id as string, label: c.name as string })),
    ];
  }, [categories, products]);

  const filtered = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return products.filter((p: any) => {
      if (p.isActive === false) return false;
      if (category === 'FAV' && !p.isFavorite) return false;
      if (category !== 'ALL' && category !== 'FAV' && p.categoryId !== category) return false;
      if (!terms.length) return true;
      const token = p._searchToken || p.name?.toLowerCase() || '';
      return terms.every((t) => token.includes(t));
    });
  }, [products, search, category]);

  useEffect(() => { setLimit(PAGE); listRef.current?.scrollTo({ top: 0 }); }, [search, category]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600 && limit < filtered.length) setLimit((l) => l + PAGE);
  };

  const add = (p: any) => {
    addToCart(p);
    navigator.vibrate?.(12);
  };

  const onCode = useCallback((code: string) => {
    const c = code.trim().toUpperCase();
    const list = usePOSStore.getState().products;
    const p = list.find((x: any) =>
      (x.barcode || '').toUpperCase() === c ||
      (x.sku || '').toUpperCase() === c ||
      x.additionalBarcodes?.some((b: any) => (b.barcode || '').toUpperCase() === c),
    );
    if (p) {
      usePOSStore.getState().addToCart(p);
      haptic(15);
      toast.success(p.name, { id: 'scan', duration: 1200 });
    } else {
      haptic([40, 60, 40]);
      toast.error(`No hay un producto con el código ${code}`, { id: 'scan' });
    }
  }, []);

  const total = getFinalTotal();
  const count = getItemCount();

  // Sin caja abierta en este celular no se puede cobrar
  if (!cash.loading && !cash.session) {
    return <OpenCashGate terminalName={cash.terminalName} onOpen={cash.open} />;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <ScreenHeader
        title="Vender"
        subtitle={cash.session ? `Cobrando en ${cash.session.terminalName || cash.terminalName}` : 'Cargando caja…'}
        action={canScanBarcodes() ? (
          <button onClick={() => setScanning(true)} className="h-10 px-3.5 rounded-full bg-orange-200 text-orange-900 flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform">
            <ScanLine className="w-[18px] h-[18px]" />
            <span className="text-[13px] font-semibold">Escanear</span>
          </button>
        ) : undefined}
      >
        <div className="relative">
          <Search className="absolute left-3.5 inset-y-0 my-auto w-[18px] h-[18px] text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o código"
            enterKeyHint="search"
            className={`${headerInput} pl-10 pr-10`}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 inset-y-0 my-auto w-7 h-7 rounded-full flex items-center justify-center" aria-label="Borrar búsqueda">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          )}
        </div>
        {categoryOptions.length > 1 && <div className="mt-3"><Chips options={categoryOptions} value={category} onChange={setCategory} /></div>}
      </ScreenHeader>

      <div ref={listRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-3 pb-28">
        {filtered.length === 0 ? (
          <EmptyState
            icon={category === 'FAV' ? Star : Search}
            title={products.length === 0 ? 'Cargando productos…' : category === 'FAV' && !search ? 'Todavía no marcaste favoritos' : 'No encontramos productos'}
            text={search ? `Nada coincide con “${search}”.` : undefined}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.slice(0, limit).map((p: any) => (
              <ProductTile key={p.id} product={p} inCart={cartQty[p.id] || 0} onAdd={() => add(p)} />
            ))}
          </div>
        )}
      </div>

      {/* Barra del carrito */}
      <AnimatePresence>
        {cart.length > 0 && (
          <motion.button
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            onClick={() => setCartOpen(true)}
            className="absolute left-3 right-3 bottom-3 h-[60px] rounded-2xl bg-rose-600 text-white flex items-center px-4 gap-3 shadow-[0_10px_30px_rgba(14,110,82,0.35)] active:scale-[0.99]"
          >
            <span className="relative">
              <ShoppingBag className="w-6 h-6" />
              <span className="absolute -top-2 -right-2.5 min-w-[20px] h-5 px-1 rounded-full bg-orange-200 text-orange-900 text-[11px] font-bold flex items-center justify-center">
                {qty(count)}
              </span>
            </span>
            <span className="flex-1 text-left ml-1">
              <span className="block text-[11.5px] text-rose-100 leading-none">Ver carrito</span>
              <span className="block text-[18px] font-bold tabular-nums leading-tight">{money(total)}</span>
            </span>
            <span
              onClick={(e) => { e.stopPropagation(); setCheckoutOpen(true); }}
              className="h-10 px-4 rounded-xl bg-orange-200 text-orange-900 text-[14px] font-bold flex items-center gap-1"
            >
              Cobrar <ChevronRight className="w-4 h-4" />
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Carrito */}
      <Sheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        title={`Carrito · ${qty(count)} ${count === 1 ? 'producto' : 'productos'}`}
        footer={
          <div className="space-y-3">
            {getDiscounts() > 0 && (
              <div className="flex justify-between text-[13px]">
                <span className="text-slate-500">Subtotal {money(getTotal())}</span>
                <span className="text-emerald-700 font-medium flex items-center gap-1"><Tag className="w-3.5 h-3.5" /> −{money(getDiscounts())} en promos</span>
              </div>
            )}
            <PrimaryButton onClick={() => { setCartOpen(false); setCheckoutOpen(true); }} disabled={cart.length === 0}>
              Cobrar {money(total)}
            </PrimaryButton>
          </div>
        }
      >
        {cart.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="El carrito está vacío" />
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {cart.map((item) => (
                <div key={item.cartKey} className="py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-slate-800 leading-snug line-clamp-2">{item.name}</p>
                    <p className="text-[12.5px] text-slate-500 tabular-nums">{money(item.price)} c/u · <span className="text-slate-800 font-semibold">{money(item.price * item.quantity)}</span></p>
                  </div>
                  {item.isPromo ? (
                    <button onClick={() => removeFromCart(item.cartKey)} className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center" aria-label="Quitar">
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </button>
                  ) : (
                    <Stepper
                      value={item.quantity}
                      onChange={(v) => (v <= 0 ? removeFromCart(item.cartKey) : updateQuantity(item.cartKey, v))}
                    />
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => { clearCart(); setCartOpen(false); }} className="mt-2 text-[13px] font-medium text-red-600 py-2">
              Vaciar carrito
            </button>
          </>
        )}
      </Sheet>

      <CheckoutSheet
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        sessionId={cash.session?.id}
        total={total}
        clients={clients}
        buildItems={getCheckoutPayload}
        appliedPromos={() => getCartItemsWithDiscounts().appliedPromosInfo}
        products={products}
        onDone={(soldCart) => {
          // El stock baja acá mismo; el catálogo completo se refresca en segundo plano
          const sold: Record<string, number> = {};
          for (const i of soldCart) sold[i.productId] = (sold[i.productId] || 0) + i.quantity;
          setProducts(usePOSStore.getState().products.map((p: any) => (sold[p.id] && !p.unlimitedStock ? { ...p, stock: (p.stock ?? 0) - sold[p.id] } : p)));
          clearCart();
          cash.refresh();
        }}
      />

      {scanning && <BarcodeScanner onCode={onCode} onClose={() => setScanning(false)} />}
    </div>
  );
}

function ProductTile({ product: p, inCart, onAdd }: { product: any; inCart: number; onAdd: () => void }) {
  const [imgOk, setImgOk] = useState(true);
  // Los productos virtuales (cargas, pagos) tienen stock "infinito": no se muestra
  const showStock = !p.unlimitedStock && typeof p.stock === 'number' && p.stock < 99999;
  const low = showStock && p.stock <= (p.minStock || 0);
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onAdd}
      className={`relative text-left bg-white rounded-2xl p-2.5 border transition-colors ${inCart ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-200/80'}`}
    >
      <div className="aspect-[4/3] rounded-xl bg-slate-50 overflow-hidden flex items-center justify-center">
        {p.imageUrl && imgOk ? (
          <img src={p.imageUrl} alt="" loading="lazy" onError={() => setImgOk(false)} className="w-full h-full object-cover" />
        ) : (
          <span className="text-[26px] font-bold text-rose-200">{(p.name || '?').trim()[0]}</span>
        )}
      </div>
      <p className="mt-2 text-[13px] font-medium text-slate-800 leading-snug line-clamp-2 min-h-[2.5em]">{p.name}</p>
      <div className="mt-1 flex items-end justify-between gap-1">
        <p className="text-[15px] font-bold text-slate-900 tabular-nums">{money(p.salePrice)}</p>
        {showStock && (
          <span className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded-md ${p.stock <= 0 ? 'bg-red-50 text-red-600' : low ? 'bg-amber-50 text-amber-800' : 'text-slate-400'}`}>
            {p.stock <= 0 ? 'Sin stock' : `${qty(p.stock)} u.`}
          </span>
        )}
      </div>
      {inCart > 0 && (
        <span className="absolute top-1.5 right-1.5 min-w-[26px] h-[26px] px-1.5 rounded-full bg-rose-600 text-white text-[12px] font-bold flex items-center justify-center shadow">
          {qty(inCart)}
        </span>
      )}
    </motion.button>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <div className="flex items-center rounded-xl bg-slate-100 shrink-0">
      <button onClick={() => onChange(value - 1)} className="w-9 h-9 flex items-center justify-center active:scale-90" aria-label="Uno menos">
        {value <= 1 ? <Trash2 className="w-4 h-4 text-red-600" /> : <Minus className="w-4 h-4 text-slate-700" />}
      </button>
      {editing ? (
        <input
          autoFocus
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { const v = parseAmount(draft); if (v > 0) onChange(v); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-12 h-9 text-center bg-white rounded-lg text-[14px] font-semibold outline-none"
        />
      ) : (
        <button onClick={() => { setDraft(qty(value)); setEditing(true); }} className="min-w-[36px] h-9 text-[14px] font-semibold text-slate-900 tabular-nums">
          {qty(value)}
        </button>
      )}
      <button onClick={() => onChange(value + 1)} className="w-9 h-9 flex items-center justify-center active:scale-90" aria-label="Uno más">
        <Plus className="w-4 h-4 text-slate-700" />
      </button>
    </div>
  );
}

function CheckoutSheet({ open, onClose, sessionId, total, clients, buildItems, appliedPromos, products, onDone }: {
  open: boolean; onClose: () => void; sessionId?: string; total: number; clients: any[];
  buildItems: () => any[]; appliedPromos: () => any[]; products: any[]; onDone: (soldCart: { productId: string; quantity: number }[]) => void;
}) {
  const methods = useMemo(getPaymentMethods, [open]);
  const [method, setMethod] = useState('CASH');
  const [received, setReceived] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [surcharges, setSurcharges] = useState<any[]>([]);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState<{ total: number; change: number; number?: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMethod('CASH'); setReceived(''); setClientId(''); setClientSearch(''); setDone(null);
    api.get('/surcharges').then((r) => setSurcharges(r.data || [])).catch(() => setSurcharges([]));
  }, [open]);

  const { items, totalSurcharge } = useMemo(
    () => (open ? applySurcharges(buildItems(), products, surcharges, method) : { items: [], totalSurcharge: 0 }),
    [open, method, surcharges, total],
  );
  const finalTotal = Math.round((total + totalSurcharge) * 100) / 100;
  const receivedAmount = parseAmount(received);
  const change = method === 'CASH' && receivedAmount > finalTotal ? receivedAmount - finalTotal : 0;
  const cashShort = method === 'CASH' && received !== '' && receivedAmount < finalTotal;

  const quickBills = useMemo(() => {
    const out = new Set<number>();
    for (const step of [100, 500, 1000, 2000, 10000, 20000]) {
      const v = Math.ceil(finalTotal / step) * step;
      if (v > finalTotal) out.add(v);
    }
    return [...out].sort((a, b) => a - b).slice(0, 4);
  }, [finalTotal]);

  const filteredClients = useMemo(() => {
    const t = clientSearch.trim().toLowerCase();
    return clients
      .filter((c: any) => c.isActive !== false && (!t || `${c.name} ${c.dni || ''} ${c.phone || ''}`.toLowerCase().includes(t)))
      .slice(0, 30);
  }, [clients, clientSearch]);

  const confirm = async () => {
    if (!sessionId) return toast.error('No hay una caja abierta en este celular');
    if (method === 'DEBT' && !clientId) return toast.error('Elegí el cliente');
    setProcessing(true);
    try {
      const { data } = await api.post('/sales', {
        sessionId,
        items,
        payments: [{ method, amount: finalTotal }],
        clientId: method === 'DEBT' ? clientId : undefined,
        appliedPromotions: appliedPromos(),
      });
      navigator.vibrate?.([20, 40, 20]);
      haptic([20, 40, 30]);
      setDone({ total: finalTotal, change, number: data?.saleNumber });
      onDone(items);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo registrar la venta. Probá de nuevo.');
    } finally {
      setProcessing(false);
    }
  };

  if (done) {
    return (
      <Sheet open={open} onClose={onClose} footer={<PrimaryButton onClick={onClose}>Nueva venta</PrimaryButton>}>
        <div className="flex flex-col items-center text-center pt-4 pb-2">
          <motion.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 18 }}
            className="w-20 h-20 rounded-full bg-rose-600 flex items-center justify-center"
          >
            <Check className="w-10 h-10 text-white" strokeWidth={3} />
          </motion.span>
          <p className="mt-5 text-[15px] text-slate-500">Venta registrada{done.number ? ` · N.º ${done.number}` : ''}</p>
          <p className="text-[34px] font-bold text-slate-900 tabular-nums tracking-tight">{money(done.total)}</p>
          {done.change > 0 && (
            <div className="mt-4 w-full rounded-2xl bg-orange-50 border border-orange-200 py-3">
              <p className="text-[12.5px] text-orange-800">Vuelto</p>
              <p className="text-[26px] font-bold text-orange-900 tabular-nums">{money(done.change)}</p>
            </div>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Cobrar"
      footer={
        <PrimaryButton onClick={confirm} loading={processing} disabled={cashShort || (method === 'DEBT' && !clientId) || total <= 0}>
          Confirmar {money(finalTotal)}
        </PrimaryButton>
      }
    >
      <div className="text-center py-2">
        <p className="text-[12.5px] text-slate-500">Total a cobrar</p>
        <p className="text-[36px] font-bold text-slate-900 tabular-nums tracking-tight leading-tight">{money(finalTotal)}</p>
        {totalSurcharge > 0 && <p className="text-[12px] text-amber-700">Incluye {money(totalSurcharge)} de recargo por el medio de pago</p>}
      </div>

      <p className="mt-3 mb-2 text-[12.5px] font-medium text-slate-500">Medio de pago</p>
      <div className="grid grid-cols-2 gap-2">
        {methods.map((m) => {
          const Icon = methodIcon(m.id);
          const on = method === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`h-14 rounded-2xl border flex items-center gap-2.5 px-3 text-left transition-colors ${on ? 'border-rose-600 bg-rose-50 ring-1 ring-rose-600' : 'border-slate-200 bg-white'}`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${on ? 'text-rose-700' : 'text-slate-500'}`} />
              <span className={`text-[13.5px] font-medium leading-tight ${on ? 'text-rose-800' : 'text-slate-700'}`}>{m.name}</span>
            </button>
          );
        })}
      </div>

      {method === 'CASH' && (
        <div className="mt-5">
          <p className="mb-2 text-[12.5px] font-medium text-slate-500">¿Con cuánto paga? (opcional)</p>
          <MoneyInput value={received} onChange={setReceived} placeholder={String(Math.round(finalTotal))} />
          <div className="flex gap-2 mt-2">
            <button onClick={() => setReceived(String(Math.round(finalTotal)))} className="flex-1 h-9 rounded-xl bg-slate-100 text-[12.5px] font-medium text-slate-700">Justo</button>
            {quickBills.map((b) => (
              <button key={b} onClick={() => setReceived(String(b))} className="flex-1 h-9 rounded-xl bg-slate-100 text-[12.5px] font-medium text-slate-700 tabular-nums">
                {money(b)}
              </button>
            ))}
          </div>
          {change > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-2xl bg-orange-50 border border-orange-200 px-4 py-3">
              <span className="text-[14px] text-orange-800">Vuelto</span>
              <span className="text-[20px] font-bold text-orange-900 tabular-nums">{money(change)}</span>
            </div>
          )}
          {cashShort && <p className="mt-2 text-[12.5px] text-red-600">El monto es menor que el total.</p>}
        </div>
      )}

      {method === 'DEBT' && (
        <div className="mt-5">
          <p className="mb-2 text-[12.5px] font-medium text-slate-500">¿A qué cliente se le anota?</p>
          <div className="relative">
            <Search className="absolute left-3 inset-y-0 my-auto w-4 h-4 text-slate-400" />
            <input
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Buscar cliente"
              className="w-full h-11 pl-9 pr-3 rounded-2xl bg-slate-100 text-[14px] outline-none focus:bg-white focus:ring-2 focus:ring-rose-200"
            />
          </div>
          <div className="mt-2 max-h-56 overflow-y-auto rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {filteredClients.length === 0 && <p className="p-4 text-center text-[13px] text-slate-500">No hay clientes con ese nombre.</p>}
            {filteredClients.map((c: any) => (
              <button key={c.id} onClick={() => setClientId(c.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 text-left ${clientId === c.id ? 'bg-rose-50' : 'bg-white'}`}>
                <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 text-[13px] font-semibold flex items-center justify-center shrink-0">{(c.name || '?')[0]}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] text-slate-800 truncate">{c.name}</span>
                  {typeof c.balance === 'number' && c.balance !== 0 && (
                    <span className={`block text-[11.5px] ${c.balance > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {c.balance > 0 ? `Debe ${money(c.balance)}` : `A favor ${money(-c.balance)}`}
                    </span>
                  )}
                </span>
                {clientId === c.id && <Check className="w-4 h-4 text-rose-600" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function OpenCashGate({ terminalName, onOpen }: { terminalName: string | null; onOpen: (amount?: number) => Promise<any> }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      await onOpen(parseAmount(amount));
      toast.success('Caja abierta');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo abrir la caja');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader title="Vender" subtitle={terminalName || undefined} />
      <div className="flex-1 overflow-y-auto px-5 pt-10">
        <div className="flex flex-col items-center text-center">
          <span className="w-16 h-16 rounded-3xl bg-rose-50 flex items-center justify-center">
            <Wallet className="w-7 h-7 text-rose-600" />
          </span>
          <p className="mt-4 text-[18px] font-semibold text-slate-900">Abrí la caja para vender</p>
          <p className="mt-1 text-[13.5px] text-slate-500 max-w-xs">
            Este celular funciona como una caja más. Las ventas que hagas quedan registradas en {terminalName || 'esta terminal'}.
          </p>
        </div>
        <PrimaryButton className="mt-8" onClick={open} loading={busy}>Abrir caja</PrimaryButton>
      </div>
    </div>
  );
}

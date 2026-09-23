import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, X, Plus, Truck, Phone, MessageCircle, Mail, HandCoins, ShoppingBag } from 'lucide-react';
import api from '../../services/api';
import { ScreenHeader, headerInput, Chips, Sheet, PrimaryButton, MoneyInput, EmptyState, ListSkeleton, money, parseAmount } from './ui';

type Filter = 'ALL' | 'DEBT';

const waLink = (phone: string) => {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = `549${digits}`;
  return `https://wa.me/${digits}`;
};

/** Proveedores en el celular: a quién le debés, sus compras y registrar pagos. */
export default function MobileSuppliersScreen() {
  const [suppliers, setSuppliers] = useState<any[] | null>(null);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selected, setSelected] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      api.get('/suppliers').then((r) => r.data || []).catch(() => []),
      api.get('/purchases').then((r) => r.data || []).catch(() => []),
    ]);
    setSuppliers(s);
    setPurchases(p);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Misma regla que la PC: la deuda es la suma de las compras marcadas "debo"
  const debtOf = useCallback((id: string) => purchases.filter((p) => p.supplierId === id && p.paymentStatus === 'OWED' && p.status !== 'CANCELLED').reduce((s, p) => s + p.total, 0), [purchases]);
  const totalDebt = useMemo(() => (suppliers || []).reduce((s, x) => s + debtOf(x.id), 0), [suppliers, debtOf]);
  const withDebt = (suppliers || []).filter((s) => debtOf(s.id) > 0).length;

  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (suppliers || [])
      .filter((s) => filter === 'ALL' || debtOf(s.id) > 0)
      .filter((s) => !t || `${s.name} ${s.contact || ''} ${s.phone || ''}`.toLowerCase().includes(t))
      .sort((a, b) => (filter === 'DEBT' ? debtOf(b.id) - debtOf(a.id) : a.name.localeCompare(b.name, 'es')));
  }, [suppliers, search, filter, debtOf]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader
        back
        title="Proveedores"
        action={
          <button onClick={() => setCreating(true)} className="h-10 px-3.5 rounded-full bg-orange-200 text-orange-900 flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform">
            <Plus className="w-[18px] h-[18px]" /><span className="text-[13px] font-bold">Nuevo</span>
          </button>
        }
      >
        <div className="rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 px-4 py-3 mb-3">
          <p className="text-[12px] text-rose-100">Les debés en total</p>
          <p className="text-[26px] font-bold tabular-nums tracking-tight">{money(totalDebt)}</p>
          <p className="text-[12px] text-rose-100">{withDebt} {withDebt === 1 ? 'proveedor' : 'proveedores'} con deuda</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3.5 inset-y-0 my-auto w-[18px] h-[18px] text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar proveedor" className={`${headerInput} pl-10 pr-9`} />
          {search && <button onClick={() => setSearch('')} className="absolute right-1.5 inset-y-0 my-auto w-7 h-7 flex items-center justify-center" aria-label="Borrar búsqueda"><X className="w-4 h-4 text-slate-400" /></button>}
        </div>
        <div className="mt-3">
          <Chips<Filter> options={[{ id: 'ALL', label: 'Todos', count: suppliers?.length }, { id: 'DEBT', label: 'Con deuda', count: withDebt }]} value={filter} onChange={setFilter} />
        </div>
      </ScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {suppliers === null ? <ListSkeleton /> : list.length === 0 ? (
          <EmptyState icon={Truck} title={search ? 'Sin resultados' : filter === 'DEBT' ? 'No le debés a nadie' : 'Todavía no hay proveedores'} />
        ) : (
          <div className="px-4 py-3">
            <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
              {list.map((s) => {
                const debt = debtOf(s.id);
                return (
                  <button key={s.id} onClick={() => setSelected(s)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
                    <span className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center shrink-0"><Truck className="w-[18px] h-[18px] text-rose-600" /></span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14.5px] font-medium text-slate-800 truncate">{s.name}</span>
                      <span className="block text-[12px] text-slate-500 truncate">{s._count?.products || 0} productos · {s._count?.purchases || 0} compras</span>
                    </span>
                    <span className={`text-[14.5px] font-bold tabular-nums shrink-0 ${debt > 0 ? 'text-red-600' : 'text-slate-400'}`}>{debt > 0 ? money(debt) : 'Al día'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <SupplierSheet
        supplier={selected}
        purchases={selected ? purchases.filter((p) => p.supplierId === selected.id) : []}
        debt={selected ? debtOf(selected.id) : 0}
        onClose={() => setSelected(null)}
        onChanged={load}
      />
      <NewSupplierSheet open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
    </div>
  );
}

function SupplierSheet({ supplier: s, purchases, debt, onClose, onChanged }: { supplier: any | null; purchases: any[]; debt: number; onClose: () => void; onChanged: () => void }) {
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Efectivo');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPaying(false); setAmount(''); setReference(''); setMethod('Efectivo'); }, [s]);

  const pay = async () => {
    const value = parseAmount(amount);
    if (value <= 0) return;
    setBusy(true);
    try {
      await api.post(`/suppliers/${s.id}/payments`, { amount: value, method, reference, notes: '' });
      toast.success('Pago registrado');
      setPaying(false);
      onChanged();
    } catch {
      toast.error('No se pudo registrar el pago');
    } finally {
      setBusy(false);
    }
  };

  const recent = [...purchases].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 20);

  return (
    <Sheet
      open={!!s}
      onClose={onClose}
      title={s?.name}
      footer={s ? (paying ? (
        <div className="flex gap-2">
          <button onClick={() => setPaying(false)} className="h-12 px-5 rounded-2xl bg-slate-100 text-[15px] font-semibold text-slate-700">Volver</button>
          <PrimaryButton onClick={pay} loading={busy} disabled={parseAmount(amount) <= 0}>Registrar pago</PrimaryButton>
        </div>
      ) : (
        <PrimaryButton onClick={() => { setAmount(debt > 0 ? String(Math.round(debt)) : ''); setPaying(true); }}><HandCoins className="w-4 h-4" /> Registrar pago</PrimaryButton>
      )) : undefined}
    >
      {s && (paying ? (
        <div className="space-y-4 pt-1">
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
          <div className="flex flex-wrap gap-2">
            {['Efectivo', 'Transferencia', 'Cheque', 'Mercado Pago'].map((m) => (
              <button key={m} onClick={() => setMethod(m)} className={`h-9 px-3.5 rounded-full border text-[13px] font-medium ${method === m ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>{m}</button>
            ))}
          </div>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Referencia (n.º de factura, comprobante…)" className="w-full h-11 px-3.5 rounded-2xl bg-slate-100 text-[14px] outline-none focus:bg-white focus:ring-2 focus:ring-rose-200" />
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          <div className={`rounded-2xl px-4 py-3 ${debt > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
            <p className={`text-[12px] ${debt > 0 ? 'text-red-700' : 'text-emerald-800'}`}>{debt > 0 ? 'Le debés' : 'Estás al día'}</p>
            <p className={`text-[28px] font-bold tabular-nums tracking-tight ${debt > 0 ? 'text-red-700' : 'text-emerald-800'}`}>{money(debt)}</p>
          </div>
          {(s.phone || s.email) && (
            <div className="flex gap-2">
              {s.phone && <a href={`tel:${s.phone}`} className="flex-1 h-11 rounded-xl border border-slate-200 flex items-center justify-center gap-2 text-[14px] font-medium text-slate-700"><Phone className="w-4 h-4" /> Llamar</a>}
              {s.phone && <a href={waLink(s.phone)} target="_blank" rel="noopener noreferrer" className="flex-1 h-11 rounded-xl border border-slate-200 flex items-center justify-center gap-2 text-[14px] font-medium text-slate-700"><MessageCircle className="w-4 h-4" /> WhatsApp</a>}
              {!s.phone && s.email && <a href={`mailto:${s.email}`} className="flex-1 h-11 rounded-xl border border-slate-200 flex items-center justify-center gap-2 text-[14px] font-medium text-slate-700"><Mail className="w-4 h-4" /> Email</a>}
            </div>
          )}
          {s.stats && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-slate-50 px-3 py-2.5"><p className="text-[11.5px] text-slate-500">Vendiste de sus productos</p><p className="text-[15px] font-bold text-slate-900 tabular-nums">{money(s.stats.totalSales)}</p></div>
              <div className="rounded-2xl bg-slate-50 px-3 py-2.5"><p className="text-[11.5px] text-slate-500">Ganancia</p><p className="text-[15px] font-bold text-emerald-700 tabular-nums">{money(s.stats.netProfit)}</p></div>
            </div>
          )}
          <div>
            <p className="text-[12.5px] font-semibold text-slate-500 mb-2">Compras</p>
            {recent.length === 0 ? <p className="text-[13px] text-slate-500 text-center py-4">Todavía no hay compras.</p> : (
              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {recent.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <ShoppingBag className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] text-slate-800">{new Date(p.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}{p.invoiceNumber ? ` · Fact. ${p.invoiceNumber}` : ''}</span>
                      <span className="block text-[11.5px] text-slate-500">{p.items?.length || 0} productos</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-[14px] font-semibold text-slate-900 tabular-nums">{money(p.total)}</span>
                      <span className={`block text-[11px] font-semibold ${p.status === 'CANCELLED' ? 'text-slate-400' : p.paymentStatus === 'OWED' ? 'text-red-600' : 'text-emerald-600'}`}>
                        {p.status === 'CANCELLED' ? 'Anulada' : p.paymentStatus === 'OWED' ? 'Debés' : 'Pagada'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

function NewSupplierSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', contact: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setForm({ name: '', contact: '', phone: '', email: '' }); }, [open]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    if (!form.name.trim()) return toast.error('Poné el nombre');
    setBusy(true);
    try {
      await api.post('/suppliers', { ...form, name: form.name.trim() });
      toast.success('Proveedor creado');
      onCreated();
    } catch {
      toast.error('No se pudo crear el proveedor');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full h-12 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white';
  return (
    <Sheet open={open} onClose={onClose} title="Nuevo proveedor" footer={<PrimaryButton onClick={save} loading={busy}>Crear proveedor</PrimaryButton>}>
      <div className="space-y-3 pt-1">
        <input className={input} placeholder="Nombre o razón social" value={form.name} onChange={set('name')} autoFocus />
        <input className={input} placeholder="Persona de contacto" value={form.contact} onChange={set('contact')} />
        <input className={input} placeholder="Teléfono" inputMode="tel" value={form.phone} onChange={set('phone')} />
        <input className={input} placeholder="Email" inputMode="email" value={form.email} onChange={set('email')} />
      </div>
    </Sheet>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, X, UserPlus, Users, Phone, MessageCircle, ArrowDownRight, ArrowUpRight, HandCoins, Pencil, MapPin } from 'lucide-react';
import { hasFeature } from '../../stores/businessStore';
import api from '../../services/api';
import { ScreenHeader, headerInput, Chips, Sheet, PrimaryButton, MoneyInput, EmptyState, ListSkeleton, money, parseAmount } from './ui';
import { useCashSession } from './useCashSession';
import { getPaymentMethods } from './checkout';

type Filter = 'DEBT' | 'ALL';

const waLink = (phone: string, text: string) => {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = `549${digits}`; // celular argentino sin prefijo
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
};

/** Cuentas corrientes (fiado) en el celular: quién debe, cuánto, cobrar y recordar por WhatsApp. */
export default function MobileClientsScreen() {
  const [clients, setClients] = useState<any[] | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('DEBT');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.get('/clients').then((r) => setClients(r.data || [])).catch(() => { setClients([]); toast.error('No pudimos traer los clientes'); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const debtors = useMemo(() => (clients || []).filter((c) => c.balance > 0.5), [clients]);
  const totalDebt = debtors.reduce((s, c) => s + c.balance, 0);

  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (clients || [])
      .filter((c) => (filter === 'DEBT' ? c.balance > 0.5 : true))
      .filter((c) => !t || `${c.name} ${c.dni || ''} ${c.phone || ''}`.toLowerCase().includes(t))
      .sort((a, b) => (filter === 'DEBT' ? b.balance - a.balance : a.name.localeCompare(b.name, 'es')));
  }, [clients, search, filter]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader
        back
        title="Fiado"
        subtitle="Cuentas corrientes"
        action={
          <button onClick={() => setCreating(true)} className="h-10 px-3.5 rounded-full bg-orange-200 text-orange-900 flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform">
            <UserPlus className="w-[18px] h-[18px]" />
            <span className="text-[13px] font-bold">Cliente</span>
          </button>
        }
      >
        <div className="rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 px-4 py-3 mb-3">
          <p className="text-[12px] text-rose-100">Te deben en total</p>
          <p className="text-[26px] font-bold tabular-nums tracking-tight">{money(totalDebt)}</p>
          <p className="text-[12px] text-rose-100">{debtors.length} {debtors.length === 1 ? 'cliente' : 'clientes'} con deuda</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3.5 inset-y-0 my-auto w-[18px] h-[18px] text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente" className={`${headerInput} pl-10 pr-9`} />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-1.5 inset-y-0 my-auto w-7 h-7 flex items-center justify-center" aria-label="Borrar búsqueda">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          )}
        </div>
        <div className="mt-3">
          <Chips<Filter> options={[{ id: 'DEBT', label: 'Deben', count: debtors.length }, { id: 'ALL', label: 'Todos', count: clients?.length }]} value={filter} onChange={setFilter} />
        </div>
      </ScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {clients === null ? <ListSkeleton /> : list.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? 'Sin resultados' : filter === 'DEBT' ? 'Nadie te debe' : 'Todavía no hay clientes'}
            text={filter === 'DEBT' && !search ? 'Cuando vendas a cuenta corriente, los vas a ver acá.' : undefined}
          />
        ) : (
          <div className="px-4 py-3">
            <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
              {list.slice(0, 300).map((c) => (
                <button key={c.id} onClick={() => setSelectedId(c.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
                  <span className="w-10 h-10 rounded-full bg-rose-50 text-rose-700 font-semibold flex items-center justify-center shrink-0">{(c.name || '?')[0].toUpperCase()}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14.5px] font-medium text-slate-800 truncate">{c.name}</span>
                    <span className="block text-[12px] text-slate-500 truncate">{c.phone || c.dni || 'Sin teléfono'}</span>
                  </span>
                  <span className={`text-[15px] font-bold tabular-nums shrink-0 ${c.balance > 0.5 ? 'text-red-600' : c.balance < -0.5 ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {c.balance > 0.5 ? money(c.balance) : c.balance < -0.5 ? `+${money(-c.balance)}` : 'Al día'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <ClientSheet clientId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
      <NewClientSheet open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }}
        localities={Array.from(new Set((clients || []).map((c: any) => (c.locality || '').trim()).filter(Boolean))).sort() as string[]} />
    </div>
  );
}

function ClientSheet({ clientId, onClose, onChanged }: { clientId: string | null; onClose: () => void; onChanged: () => void }) {
  const [client, setClient] = useState<any | null>(null);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    if (!clientId) return;
    api.get(`/clients/${clientId}`).then((r) => setClient(r.data)).catch(() => { toast.error('No pudimos abrir el cliente'); onClose(); });
  }, [clientId]);
  useEffect(() => { setClient(null); setPaying(false); load(); }, [clientId]);

  const store = localStorage.getItem('gd_store_name') || 'el negocio';
  const reminder = client ? `Hola ${client.name.split(' ')[0]}! Te escribo de ${store}. Te recuerdo que tenés un saldo pendiente de ${money(client.balance)}. ¡Gracias!` : '';

  return (
    <Sheet
      open={!!clientId}
      onClose={onClose}
      title={client?.name}
      footer={client && !paying && client.balance > 0.5 ? (
        <div className="flex gap-2">
          {client.phone && (
            <a href={waLink(client.phone, reminder)} target="_blank" rel="noopener noreferrer" className="h-12 px-4 rounded-2xl bg-emerald-50 text-emerald-700 font-semibold text-[14px] flex items-center gap-2 shrink-0">
              <MessageCircle className="w-4 h-4" /> Recordar
            </a>
          )}
          <PrimaryButton onClick={() => setPaying(true)}><HandCoins className="w-4 h-4" /> Registrar pago</PrimaryButton>
        </div>
      ) : undefined}
    >
      {!client ? (
        <div className="h-48 flex items-center justify-center"><span className="w-6 h-6 border-2 border-rose-200 border-t-rose-600 rounded-full animate-spin" /></div>
      ) : paying ? (
        <PaymentForm client={client} onCancel={() => setPaying(false)} onDone={() => { setPaying(false); load(); onChanged(); }} />
      ) : editing ? (
        <NewClientSheet open editing={client} onClose={() => setEditing(false)} onCreated={() => { setEditing(false); load(); onChanged(); }} />
      ) : (
        <div className="space-y-4 pt-1">
          <div className={`rounded-2xl px-4 py-3 ${client.balance > 0.5 ? 'bg-red-50' : 'bg-emerald-50'}`}>
            <p className={`text-[12px] ${client.balance > 0.5 ? 'text-red-700' : 'text-emerald-800'}`}>{client.balance > 0.5 ? 'Debe' : client.balance < -0.5 ? 'Saldo a favor' : 'Está al día'}</p>
            <p className={`text-[30px] font-bold tabular-nums tracking-tight ${client.balance > 0.5 ? 'text-red-700' : 'text-emerald-800'}`}>{money(Math.abs(client.balance))}</p>
            {client.creditLimit ? <p className="text-[12px] text-slate-500">Límite de crédito {money(client.creditLimit)}</p> : null}
          </div>
          {(client.address || client.locality) && (
            <p className="text-[13.5px] text-slate-600 flex items-start gap-1.5"><MapPin className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" /> {[client.address, client.locality].filter(Boolean).join(', ')}</p>
          )}
          <button onClick={() => setEditing(true)} className="w-full h-11 rounded-xl border border-slate-200 flex items-center justify-center gap-2 text-[14px] font-medium text-slate-700"><Pencil className="w-4 h-4" /> Editar datos</button>
          {client.phone && (
            <div className="flex gap-2">
              <a href={`tel:${client.phone}`} className="flex-1 h-11 rounded-xl border border-slate-200 flex items-center justify-center gap-2 text-[14px] font-medium text-slate-700"><Phone className="w-4 h-4" /> Llamar</a>
              <a href={waLink(client.phone, `Hola ${client.name.split(' ')[0]}!`)} target="_blank" rel="noopener noreferrer" className="flex-1 h-11 rounded-xl border border-slate-200 flex items-center justify-center gap-2 text-[14px] font-medium text-slate-700"><MessageCircle className="w-4 h-4" /> WhatsApp</a>
            </div>
          )}
          <div>
            <p className="text-[12.5px] font-semibold text-slate-500 mb-2">Últimos movimientos</p>
            {(client.movements || []).length === 0 ? (
              <p className="text-[13px] text-slate-500 py-4 text-center">Sin movimientos todavía.</p>
            ) : (
              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {client.movements.map((m: any) => {
                  // Una devolución del reparto es un DEBT negativo: baja la deuda como un pago
                  const isReturn = m.type === 'DEBT' && Number(m.amount) < 0;
                  const isDebt = m.type === 'DEBT' && !isReturn;
                  const items = m.sale?.items?.map((i: any) => i.productName).filter((n: string) => !n.startsWith('PAGO CUENTA')).join(', ');
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isDebt ? 'bg-red-50' : 'bg-emerald-50'}`}>
                        {isDebt ? <ArrowUpRight className="w-4 h-4 text-red-600" /> : <ArrowDownRight className="w-4 h-4 text-emerald-700" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13.5px] text-slate-800 truncate">{isDebt ? (items || m.description || 'Compra a cuenta') : isReturn ? `Devolución${items ? `: ${items}` : ''}` : 'Pago'}</span>
                        <span className="block text-[11.5px] text-slate-500">{new Date(m.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · saldo {money(m.balanceAfter)}</span>
                      </span>
                      <span className={`text-[14px] font-semibold tabular-nums ${isDebt ? 'text-red-600' : 'text-emerald-700'}`}>{isDebt ? '+' : '−'}{money(Math.abs(m.amount))}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Mismo registro que el POS de la PC (CobroCtaCteModal): baja la deuda y entra como venta en la caja. */
function PaymentForm({ client, onCancel, onDone }: { client: any; onCancel: () => void; onDone: () => void }) {
  const cash = useCashSession();
  const methods = useMemo(() => getPaymentMethods().filter((m) => m.id !== 'DEBT'), []);
  const [amount, setAmount] = useState(String(Math.round(client.balance)));
  const [method, setMethod] = useState('CASH');
  const [busy, setBusy] = useState(false);
  const value = parseAmount(amount);

  const save = async () => {
    if (!cash.session) return toast.error('Abrí una caja para registrar el cobro');
    if (value <= 0) return;
    setBusy(true);
    const desc = `Pago a Cuenta Corriente (Método: ${method})`;
    try {
      await api.post(`/clients/${client.id}/movement`, { type: 'PAYMENT', amount: value, description: desc });
      await api.post('/sales', {
        sessionId: cash.session.id,
        clientId: client.id,
        payments: [{ method, amount: value }],
        items: [{ productId: 'PAGO_CTA_CTE', productName: `PAGO CUENTA CORRIENTE - ${client.name}`, quantity: 1, price: value, total: value }],
        notes: desc,
      });
      toast.success(`Cobro de ${money(value)} registrado`);
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo registrar el cobro');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pt-1">
      <p className="text-[13px] text-slate-500">Debe {money(client.balance)}. ¿Cuánto paga?</p>
      <MoneyInput value={amount} onChange={setAmount} autoFocus />
      <div className="grid grid-cols-2 gap-2">
        {methods.map((m) => (
          <button key={m.id} onClick={() => setMethod(m.id)} className={`h-12 rounded-2xl border text-[14px] font-medium ${method === m.id ? 'border-rose-600 bg-rose-50 text-rose-800 ring-1 ring-rose-600' : 'border-slate-200 text-slate-700'}`}>
            {m.name}
          </button>
        ))}
      </div>
      {!cash.loading && !cash.session && (
        <p className="text-[12.5px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2">Para cobrar necesitás una caja abierta. Abrila desde "Vender".</p>
      )}
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="h-12 px-5 rounded-2xl bg-slate-100 text-[15px] font-semibold text-slate-700">Volver</button>
        <PrimaryButton onClick={save} loading={busy} disabled={value <= 0 || !cash.session}>Cobrar {value > 0 ? money(value) : ''}</PrimaryButton>
      </div>
    </div>
  );
}

const IVA_OPTIONS: [string, string][] = [
  ['CONSUMIDOR_FINAL', 'Consumidor final'],
  ['RESPONSABLE_INSCRIPTO', 'Responsable inscripto'],
  ['MONOTRIBUTO', 'Monotributo'],
  ['EXENTO', 'Exento'],
];
const EMPTY = { name: '', phone: '', dni: '', address: '', locality: '', cuit: '', ivaCondition: 'CONSUMIDOR_FINAL', creditLimit: '' };

/**
 * Crear o corregir un cliente. En la distribuidora también la localidad (la zona del reparto),
 * la CUIT y la condición frente al IVA (para la nota de venta y la factura).
 */
function NewClientSheet({ open, onClose, onCreated, editing, localities = [] }: { open: boolean; onClose: () => void; onCreated: () => void; editing?: any | null; localities?: string[] }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const delivery = hasFeature('delivery');
  useEffect(() => {
    if (!open) return;
    setForm(editing ? {
      name: editing.name || '', phone: editing.phone || '', dni: editing.dni || '', address: editing.address || '',
      locality: editing.locality || '', cuit: editing.cuit || '', ivaCondition: editing.ivaCondition || 'CONSUMIDOR_FINAL',
      creditLimit: editing.creditLimit ? String(editing.creditLimit) : '',
    } : EMPTY);
  }, [open, editing]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    if (!form.name.trim()) return toast.error('Poné el nombre');
    setBusy(true);
    const body: any = {
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      dni: form.dni.trim() || undefined,
      address: form.address.trim() || undefined,
      creditLimit: form.creditLimit ? parseAmount(form.creditLimit) : undefined,
    };
    if (delivery) Object.assign(body, { locality: form.locality.trim() || undefined, cuit: form.cuit.replace(/\D/g, '') || undefined, ivaCondition: form.ivaCondition });
    try {
      if (editing) await api.patch(`/clients/${editing.id}`, body);
      else await api.post('/clients', body);
      toast.success(editing ? 'Cliente actualizado' : 'Cliente creado');
      onCreated();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar el cliente');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full h-12 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white';
  const label = 'block text-[12.5px] font-medium text-slate-500 mb-1';
  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Datos del cliente' : 'Nuevo cliente'} footer={<PrimaryButton onClick={save} loading={busy}>{editing ? 'Guardar' : 'Crear cliente'}</PrimaryButton>}>
      <div className="space-y-3 pt-1">
        <input className={input} placeholder={delivery ? 'Nombre del comercio' : 'Nombre y apellido'} value={form.name} onChange={set('name')} autoFocus={!editing} />
        <input className={input} placeholder="Teléfono (para WhatsApp)" inputMode="tel" value={form.phone} onChange={set('phone')} />
        <input className={input} placeholder="Dirección (opcional)" value={form.address} onChange={set('address')} />
        {delivery && (
          <>
            <div>
              <label className={label}>Localidad (la zona del reparto)</label>
              <input className={input} list="mobile-client-localities" placeholder="Ej.: Verónica" value={form.locality} onChange={set('locality')} />
              <datalist id="mobile-client-localities">{localities.map((l) => <option key={l} value={l} />)}</datalist>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>CUIT</label>
                <input className={input} placeholder="Sin guiones" inputMode="numeric" value={form.cuit} onChange={set('cuit')} />
              </div>
              <div>
                <label className={label}>IVA</label>
                <select className={input} value={form.ivaCondition} onChange={set('ivaCondition')}>
                  {IVA_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
          </>
        )}
        {!delivery && <input className={input} placeholder="DNI (opcional)" inputMode="numeric" value={form.dni} onChange={set('dni')} />}
        <div>
          <label className={label}>Límite de crédito (opcional)</label>
          <input className={input} placeholder="Sin límite" inputMode="decimal" value={form.creditLimit} onChange={set('creditLimit')} />
        </div>
      </div>
    </Sheet>
  );
}

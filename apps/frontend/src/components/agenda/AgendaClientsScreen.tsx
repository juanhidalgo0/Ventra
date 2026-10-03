import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, Users, Phone, MessageCircle, CalendarDays, AlertTriangle, StickyNote } from 'lucide-react';
import { useOnlineOrders, startOnlineOrdersSync } from '../../services/onlineStoreOrders';
import {
  subscribeClients, rebuildClients, fetchClientBookings, saveClientNote, localNow, dayLabel, hhmm,
  type AgendaClient, type Booking,
} from '../../services/agenda';
import { usePlanStore, isAgendaOnly } from '../../stores/planStore';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader, money } from '../mobile/ui';
import { Modal, STATUS, label } from './agendaUi';

type Filter = 'ALL' | 'NEXT' | 'NO_SHOW';

const shortDay = (k: string) => { const [, m, d] = k.split('-'); return `${+d}/${+m}`; };
const waLink = (phone: string, text: string) => {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '549' + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};
/** Lo último que pasó con el cliente: para ordenar la lista. */
const lastActivity = (c: AgendaClient) => [c.next?.dateKey, c.lastVisit, c.firstDate].filter(Boolean).sort().pop() || '';

/**
 * Clientes de la agenda: se arman solos con los turnos (por teléfono, o por nombre si no
 * dejaron teléfono). Visitas, faltas, cuánto gastó, próximo turno y una nota del dueño.
 */
export default function AgendaClientsScreen() {
  const mobile = useOwnerMobile().active;
  const agendaOnly = usePlanStore((s) => isAgendaOnly(s.features));
  const { storeId } = useOnlineOrders();
  const [clients, setClients] = useState<AgendaClient[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [open, setOpen] = useState<AgendaClient | null>(null);

  useEffect(() => { startOnlineOrdersSync(); }, []);
  useEffect(() => {
    if (!storeId) return;
    return subscribeClients(storeId, (list) => {
      setClients(list);
      // La lista nació después que la agenda: la primera vez se arma con los turnos guardados
      const flag = `agenda_clients_built:${storeId}`;
      if (!list.length && !localStorage.getItem(flag)) {
        localStorage.setItem(flag, '1');
        rebuildClients(storeId).catch((err) => { console.warn('[Agenda] No se pudieron armar los clientes', err); localStorage.removeItem(flag); });
      }
    }, () => setClients([]));
  }, [storeId]);

  const today = localNow().dateKey;
  const month = today.slice(0, 7);
  const all = clients || [];
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return all
      .filter((c) => (c.visits || 0) + (c.noShows || 0) + (c.next ? 1 : 0) > 0 || c.note)
      .filter((c) => filter === 'ALL' || (filter === 'NEXT' ? !!c.next && c.next.dateKey >= today : (c.noShows || 0) > 0))
      .filter((c) => !term || c.name.toLowerCase().includes(term) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)))
      .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)) || a.name.localeCompare(b.name));
  }, [all, q, filter, today]);
  const fresh = all.filter((c) => c.firstDate?.startsWith(month)).length;
  const withNext = all.filter((c) => c.next && c.next.dateKey >= today).length;

  const subtitle = clients === null ? 'Cargando…' : `${all.length} cliente${all.length === 1 ? '' : 's'}${fresh ? ` · ${fresh} nuevo${fresh === 1 ? '' : 's'} este mes` : ''}`;

  const body = !storeId ? (
    <p className="p-10 text-center text-[14px] text-slate-500">Primero armá tu página de turnos en Agenda.</p>
  ) : (
    <div className={`${mobile ? 'px-4 py-4 pb-24' : 'p-6 max-w-5xl w-full mx-auto'} space-y-3`}>
      <div className="flex items-center gap-2 h-12 px-3.5 rounded-2xl bg-white border border-slate-200 focus-within:border-rose-500">
        <Search className="w-4.5 h-4.5 text-slate-400 shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o teléfono" className="flex-1 min-w-0 bg-transparent text-[14.5px] outline-none" />
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {([['ALL', 'Todos'], ['NEXT', `Con turno${withNext ? ` (${withNext})` : ''}`], ['NO_SHOW', 'Faltaron alguna vez']] as const).map(([id, text]) => (
          <button key={id} onClick={() => setFilter(id)} className={`h-9 px-3.5 rounded-full text-[13px] font-semibold border shrink-0 ${filter === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>{text}</button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
        {clients === null ? (
          <p className="px-4 py-10 text-center text-[13.5px] text-slate-400">Cargando…</p>
        ) : shown.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Users className="w-9 h-9 text-slate-300 mx-auto" />
            <p className="mt-2 text-[13.5px] text-slate-500">{all.length ? 'Ningún cliente coincide con la búsqueda.' : 'Tus clientes aparecen acá solos a medida que reservan o cargás turnos.'}</p>
          </div>
        ) : shown.map((c) => (
          <button key={c.key} onClick={() => setOpen(c)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-50">
            <span className="w-10 h-10 rounded-full bg-rose-50 text-rose-700 flex items-center justify-center text-[15px] font-bold shrink-0">{(c.name || '?')[0].toUpperCase()}</span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="text-[14.5px] font-semibold text-slate-900 truncate">{c.name || 'Sin nombre'}</span>
                {c.note && <StickyNote className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
              </span>
              <span className="block text-[12.5px] text-slate-500 truncate">
                {c.next && c.next.dateKey >= today
                  ? <span className="text-emerald-700 font-medium">Próximo: {dayLabel(c.next.dateKey, true)} {hhmm(c.next.startMin)}</span>
                  : `${c.visits || 0} visita${c.visits === 1 ? '' : 's'}${c.lastVisit ? ` · última ${shortDay(c.lastVisit)}` : ''}`}
                {(c.noShows || 0) > 0 && <span className="text-red-600"> · faltó {c.noShows}</span>}
              </span>
            </span>
            {(c.spent || 0) > 0 && <span className="text-[13.5px] font-semibold text-slate-700 tabular-nums shrink-0">{money(c.spent)}</span>}
          </button>
        ))}
      </div>
      {open && storeId && <ClientDetail storeId={storeId} client={all.find((c) => c.key === open.key) || open} onClose={() => setOpen(null)} />}
    </div>
  );

  if (mobile) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <ScreenHeader back={!agendaOnly} title="Clientes" subtitle={subtitle} />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{body}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl w-full mx-auto px-6 pt-6">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-rose-600">AGENDA</p>
        <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">Clientes</h1>
        <p className="text-[13px] text-slate-500">{subtitle}</p>
      </div>
      {body}
    </div>
  );
}

function ClientDetail({ storeId, client: c, onClose }: { storeId: string; client: AgendaClient; onClose: () => void }) {
  const [history, setHistory] = useState<Booking[] | null>(null);
  const [note, setNote] = useState(c.note || '');
  const [saving, setSaving] = useState(false);
  const today = localNow().dateKey;
  const businessName = localStorage.getItem('gd_store_name') || '';

  useEffect(() => {
    fetchClientBookings(storeId, c.key, c.name).then(setHistory).catch(() => setHistory([]));
  }, [storeId, c.key, c.name, c.visits, c.noShows, c.next?.dateKey]);

  const saveNote = async () => {
    setSaving(true);
    try { await saveClientNote(storeId, c, note); toast.success('Nota guardada'); } catch { toast.error('No se pudo guardar la nota'); } finally { setSaving(false); }
  };
  const hello = `Hola ${c.name.split(' ')[0]}!${businessName ? ` Te escribimos de *${businessName}*.` : ''} `;

  return (
    <Modal title={c.name || 'Cliente'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {[['Visitas', String(c.visits || 0)], ['Faltas', String(c.noShows || 0)], ['Gastó', money(c.spent || 0)]].map(([t, v]) => (
            <div key={t} className="rounded-2xl bg-slate-50 px-3 py-3 text-center">
              <p className="text-[18px] font-bold text-slate-900 tabular-nums truncate">{v}</p>
              <p className="text-[11.5px] font-medium text-slate-500">{t}</p>
            </div>
          ))}
        </div>

        {(c.noShows || 0) >= 2 && (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 text-red-800 text-[13px] px-3 py-2.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> Faltó {c.noShows} veces: conviene confirmarle el turno el día anterior.</p>
        )}

        {c.phone && (
          <div className="grid grid-cols-2 gap-2">
            <a href={waLink(c.phone, hello)} target="_blank" rel="noopener" className="h-11 rounded-xl bg-[#1FAF55] text-white text-[13.5px] font-semibold flex items-center justify-center gap-1.5"><MessageCircle className="w-4 h-4" /> WhatsApp</a>
            <a href={`tel:${c.phone}`} className="h-11 rounded-xl bg-slate-100 text-slate-700 text-[13.5px] font-semibold flex items-center justify-center gap-1.5"><Phone className="w-4 h-4" /> {c.phone}</a>
          </div>
        )}

        <div>
          <label className={label}>Nota (solo la ves vos)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="Ej.: prefiere a Mía, alérgica a la tintura X"
            className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[14px] outline-none focus:border-rose-500 focus:bg-white resize-none" />
          {note !== (c.note || '') && (
            <button disabled={saving} onClick={saveNote} className="mt-2 h-10 px-4 rounded-xl bg-rose-600 text-white text-[13.5px] font-semibold disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar nota'}</button>
          )}
        </div>

        <div>
          <p className={label}>Turnos</p>
          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {history === null ? <p className="px-3 py-6 text-center text-[13px] text-slate-400">Cargando…</p>
              : history.length === 0 ? <p className="px-3 py-6 text-center text-[13px] text-slate-400">Sin turnos.</p>
              : history.map((b) => {
                const st = b.payment ? { label: `Cobrado ${money(b.payment.amount)}`, cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' } : STATUS[b.status];
                return (
                  <div key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                    <CalendarDays className={`w-4 h-4 shrink-0 ${b.dateKey >= today && (b.status === 'PENDING' || b.status === 'CONFIRMED') ? 'text-emerald-600' : 'text-slate-300'}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-semibold text-slate-800 truncate">{b.serviceName}{b.staffName ? ` · ${b.staffName}` : ''}</span>
                      <span className="block text-[12px] text-slate-500">{dayLabel(b.dateKey, true)} · {hhmm(b.startMin)}</span>
                    </span>
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ring-1 ring-inset shrink-0 ${st.cls}`}>{st.label}</span>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Ban, Settings, Clock, User, Phone, MessageCircle, Check, X, Trash2,
  ExternalLink, Scissors, Users, SlidersHorizontal, CalendarClock,
} from 'lucide-react';
import { useOnlineOrders, startOnlineOrdersSync } from '../../services/onlineStoreOrders';
import { loadStoreConfig, saveStoreConfig, dayRanges, withRanges, type StoreConfig, type DayHours } from '../../services/onlineStore';
import {
  fullAgenda, subscribeBookings, freeStarts, canDo, occupies, localNow, addDays, weekday, dayLabel, hhmm, toMin, newId, STAFF_COLORS,
  createManualBooking, createBlock, setBookingStatus, deleteBooking, whatsappToCustomer,
  type AgendaConfig, type AgendaService, type AgendaStaff, type Booking, type BookingStatus,
} from '../../services/agenda';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader, money } from '../mobile/ui';

const PUBLIC_BASE = 'https://tienda.ventra.store';
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const STATUS: Record<BookingStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Por confirmar', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  CONFIRMED: { label: 'Confirmado', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  DONE: { label: 'Atendido', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  NO_SHOW: { label: 'No vino', cls: 'bg-red-50 text-red-700 ring-red-200' },
  CANCELLED: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
  BLOCK: { label: 'Bloqueado', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

const input = 'w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[14.5px] outline-none focus:border-rose-500 focus:bg-white';
const label = 'block mb-1.5 text-[12.5px] font-medium text-slate-500';

/**
 * Agenda de turnos (planes Tienda y Full): los clientes reservan desde la tienda online
 * y el comercio los ve, confirma, carga a mano, bloquea horarios y configura servicios y
 * profesionales. Datos en Firestore (ver services/agenda.ts).
 */
export default function AgendaScreen() {
  const mobile = useOwnerMobile().active;
  const { storeId } = useOnlineOrders();
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [tab, setTab] = useState<'agenda' | 'config'>('agenda');

  useEffect(() => { startOnlineOrdersSync(); }, []);
  useEffect(() => {
    if (!storeId) return;
    loadStoreConfig(storeId).then((c) => {
      setConfig(c);
      if (!(c as any).agenda?.services?.length) setTab('config');
    }).catch(() => toast.error('No se pudo cargar la tienda'));
  }, [storeId]);

  const agenda = useMemo(() => fullAgenda((config as any)?.agenda), [config]);
  const saveAgenda = async (next: AgendaConfig) => {
    if (!storeId) return;
    await saveStoreConfig(storeId, { agenda: next } as any);
    setConfig((c) => (c ? ({ ...c, agenda: next } as any) : c));
  };

  const publicUrl = config?.subdomain ? `${PUBLIC_BASE}/${config.subdomain}` : null;
  const subtitle = !config ? (storeId ? 'Cargando…' : 'Primero armá tu tienda online')
    : agenda.enabled ? (config.isPublished ? 'Tomando turnos online' : 'Activa · la tienda no está publicada') : 'Turnos online apagados';

  const tabs = (
    <div className={`inline-flex p-1 rounded-xl ${mobile ? 'bg-white/15' : 'bg-slate-100'}`}>
      {([['agenda', 'Agenda', CalendarDays], ['config', 'Configurar', Settings]] as const).map(([id, text, Icon]) => (
        <button key={id} onClick={() => setTab(id)}
          className={`h-9 px-3.5 rounded-lg text-[13.5px] font-semibold flex items-center gap-1.5 ${tab === id ? (mobile ? 'bg-white text-rose-700' : 'bg-white text-slate-900 shadow-sm') : (mobile ? 'text-white/85' : 'text-slate-500')}`}>
          <Icon className="w-4 h-4" /> {text}
        </button>
      ))}
    </div>
  );

  const body = !storeId || !config ? (
    <div className="p-10 text-center text-[14px] text-slate-500">{storeId ? 'Cargando…' : 'Para tomar turnos online primero armá tu tienda en Tienda online.'}</div>
  ) : tab === 'agenda' ? (
    <DayView storeId={storeId} agenda={agenda} businessName={config.businessName} mobile={mobile} onConfigure={() => setTab('config')} />
  ) : (
    <ConfigView agenda={agenda} storeHours={config.hours} mobile={mobile} onSave={saveAgenda} publicUrl={publicUrl} />
  );

  if (mobile) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <ScreenHeader back title="Agenda" subtitle={subtitle}>{tabs}</ScreenHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{body}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl w-full mx-auto px-6 pt-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.14em] text-rose-600">TURNOS ONLINE</p>
          <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">Agenda</h1>
          <p className="text-[13px] text-slate-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {publicUrl && agenda.enabled && (
            <button onClick={() => window.open(`${publicUrl}#turnos`, '_blank', 'noopener')} className="h-10 px-4 rounded-xl bg-white border border-slate-200 text-[13.5px] font-semibold text-slate-700 flex items-center gap-2">
              <ExternalLink className="w-4 h-4" /> Ver en la tienda
            </button>
          )}
          {tabs}
        </div>
      </div>
      {body}
    </div>
  );
}

// ─── Agenda del día ─────────────────────────────────────────

function DayView({ storeId, agenda, businessName, mobile, onConfigure }: { storeId: string; agenda: AgendaConfig; businessName: string; mobile: boolean; onConfigure: () => void }) {
  const today = localNow().dateKey;
  const [day, setDay] = useState(today);
  const [staffFilter, setStaffFilter] = useState<string>('ALL');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [blocking, setBlocking] = useState(false);

  // Se escucha una ventana alrededor del día elegido (para los contadores de la tira de días)
  const from = addDays(day, -3), to = addDays(day, 10);
  useEffect(() => {
    setLoading(true);
    return subscribeBookings(storeId, from, to, (list) => { setBookings(list); setLoading(false); }, () => setLoading(false));
  }, [storeId, from, to]);

  const staff = agenda.staff.filter((s) => s.active !== false);
  const staffById = useMemo(() => Object.fromEntries(agenda.staff.map((s, i) => [s.id, { ...s, color: s.color || STAFF_COLORS[i % STAFF_COLORS.length] }])), [agenda.staff]);
  const ofDay = bookings.filter((b) => b.dateKey === day && (staffFilter === 'ALL' || b.staffId === staffFilter || b.staffId === 'ALL'));
  const visible = ofDay.filter((b) => b.status !== 'CANCELLED');
  const cancelled = ofDay.filter((b) => b.status === 'CANCELLED');
  const countFor = (k: string) => bookings.filter((b) => b.dateKey === k && b.kind === 'booking' && occupies(b)).length;
  const pending = bookings.filter((b) => b.status === 'PENDING' && b.dateKey >= today).length;
  const strip = Array.from({ length: 7 }, (_, i) => addDays(day, i - 3));
  const dayIncome = visible.filter((b) => b.kind === 'booking').reduce((s, b) => s + (Number(b.price) || 0), 0);

  if (!agenda.services.length || !staff.length) {
    return (
      <div className={`${mobile ? 'px-4 py-6' : 'p-6 max-w-5xl mx-auto'}`}>
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
          <CalendarClock className="w-10 h-10 text-rose-500 mx-auto" />
          <p className="mt-3 text-[16px] font-bold text-slate-900">Configurá tu agenda</p>
          <p className="text-[13.5px] text-slate-500 mt-1 max-w-sm mx-auto">Cargá tus servicios (con duración y precio) y quiénes atienden, con sus horarios. Después activás los turnos online y tus clientes reservan desde tu tienda.</p>
          <button onClick={onConfigure} className="mt-4 h-11 px-5 rounded-xl bg-rose-600 text-white text-[14px] font-semibold">Empezar</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${mobile ? 'px-4 py-4' : 'p-6 max-w-5xl w-full mx-auto'} space-y-4`}>
      {!agenda.enabled && (
        <button onClick={onConfigure} className="w-full text-left bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <CalendarClock className="w-5 h-5 text-amber-700 shrink-0" />
          <span className="flex-1 text-[13.5px] text-amber-900">Los turnos online están apagados: podés cargar turnos a mano, pero tus clientes todavía no pueden reservar. Tocá para activarlos.</span>
          <ChevronRight className="w-4 h-4 text-amber-700" />
        </button>
      )}
      {pending > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-[13.5px] text-amber-900 font-medium">
          {pending === 1 ? 'Hay 1 turno por confirmar' : `Hay ${pending} turnos por confirmar`}
        </div>
      )}

      {/* Días */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-2 flex items-center gap-1">
        <button onClick={() => setDay(addDays(day, -1))} className="w-9 h-14 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-50" aria-label="Día anterior"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1 grid grid-cols-7 gap-1">
          {strip.map((k) => {
            const n = countFor(k), on = k === day;
            return (
              <button key={k} onClick={() => setDay(k)} className={`${mobile ? 'h-16' : 'h-14'} min-w-0 rounded-xl flex flex-col items-center justify-center ${on ? 'bg-rose-600 text-white' : k === today ? 'bg-rose-50 text-rose-700' : 'text-slate-700 hover:bg-slate-50'}`}>
                <span className="text-[11px] font-semibold uppercase opacity-80">{DAY_NAMES[weekday(k)].slice(0, 3)}</span>
                <span className="text-[17px] font-bold leading-tight">{+k.slice(8)}</span>
                <span className={`text-[10px] font-semibold ${on ? 'text-white/85' : 'text-slate-400'}`}>{n ? (mobile ? n : `${n} turno${n === 1 ? '' : 's'}`) : '·'}</span>
              </button>
            );
          })}
        </div>
        <button onClick={() => setDay(addDays(day, 1))} className="w-9 h-14 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-50" aria-label="Día siguiente"><ChevronRight className="w-5 h-5" /></button>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[18px] font-bold text-slate-900">{dayLabel(day)}</p>
          <p className="text-[12.5px] text-slate-500">
            {visible.filter((b) => b.kind === 'booking').length} turnos{dayIncome ? ` · ${money(dayIncome)}` : ''}
            {day !== today && <button onClick={() => setDay(today)} className="ml-2 font-semibold text-rose-700">Ir a hoy</button>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setBlocking(true)} className="h-10 px-3.5 rounded-xl bg-white border border-slate-200 text-[13.5px] font-semibold text-slate-700 flex items-center gap-1.5"><Ban className="w-4 h-4" /> Bloquear</button>
          <button onClick={() => setCreating(true)} className="h-10 px-3.5 rounded-xl bg-rose-600 text-white text-[13.5px] font-semibold flex items-center gap-1.5"><Plus className="w-4 h-4" /> Turno</button>
        </div>
      </div>

      {staff.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {[{ id: 'ALL', name: 'Todos', color: '#0f172a' }, ...staff.map((s) => staffById[s.id])].map((s) => (
            <button key={s.id} onClick={() => setStaffFilter(s.id)}
              className={`h-9 px-3.5 rounded-full text-[13px] font-semibold border shrink-0 flex items-center gap-1.5 ${staffFilter === s.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>
              {s.id !== 'ALL' && <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />}{s.name}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
        {loading ? (
          <p className="px-4 py-10 text-center text-[13.5px] text-slate-400">Cargando…</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13.5px] text-slate-400">No hay turnos {day === today ? 'hoy' : 'este día'}.</p>
        ) : visible.map((b) => {
          const st = STATUS[b.status];
          const color = b.staffId === 'ALL' ? '#94a3b8' : staffById[b.staffId]?.color || '#94a3b8';
          return (
            <button key={b.id} onClick={() => setOpen(b)} className="w-full flex items-stretch gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-50">
              <span className="w-14 shrink-0">
                <span className="block text-[15px] font-bold text-slate-900 tabular-nums">{hhmm(b.startMin)}</span>
                <span className="block text-[11.5px] text-slate-400 tabular-nums">{hhmm(b.endMin)}</span>
              </span>
              <span className="w-1 rounded-full shrink-0" style={{ background: color }} />
              <span className="flex-1 min-w-0">
                {b.kind === 'block' ? (
                  <>
                    <span className="block text-[14.5px] font-semibold text-slate-600">Bloqueado{b.reason ? ` · ${b.reason}` : ''}</span>
                    <span className="block text-[12.5px] text-slate-400">{b.staffId === 'ALL' ? 'Todo el local' : b.staffName}</span>
                  </>
                ) : (
                  <>
                    <span className="block text-[14.5px] font-semibold text-slate-900 truncate">{b.customerName}</span>
                    <span className="block text-[12.5px] text-slate-500 truncate">{b.serviceName}{b.staffName ? ` · ${b.staffName}` : ''}{b.source === 'online' ? ' · online' : ''}</span>
                  </>
                )}
              </span>
              <span className="shrink-0 self-center"><span className={`text-[11px] font-semibold px-2 py-1 rounded-full ring-1 ring-inset ${st.cls}`}>{st.label}</span></span>
            </button>
          );
        })}
      </div>
      {cancelled.length > 0 && <p className="text-[12.5px] text-slate-400 px-1">{cancelled.length} cancelado{cancelled.length === 1 ? '' : 's'} este día</p>}

      {open && <BookingDetail storeId={storeId} booking={bookings.find((b) => b.id === open.id) || open} businessName={businessName} onClose={() => setOpen(null)} />}
      {creating && <NewBooking storeId={storeId} agenda={agenda} bookings={bookings} initialDay={day} onClose={() => setCreating(false)} />}
      {blocking && <NewBlock storeId={storeId} agenda={agenda} initialDay={day} onClose={() => setBlocking(false)} />}
    </div>
  );
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full sm:max-w-lg max-h-[92dvh] flex flex-col bg-white rounded-t-[26px] sm:rounded-3xl shadow-2xl">
        <div className="flex items-center gap-3 px-5 pt-4 pb-2">
          <h3 className="flex-1 text-[18px] font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center" aria-label="Cerrar"><X className="w-4 h-4 text-slate-600" /></button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && <div className="px-5 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))] border-t border-slate-100">{footer}</div>}
      </div>
    </div>
  );
}

function BookingDetail({ storeId, booking: b, businessName, onClose }: { storeId: string; booking: Booking; businessName: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const st = STATUS[b.status];
  const act = async (status: BookingStatus, msg: string) => {
    setBusy(true);
    try { await setBookingStatus(storeId, b.id, status); toast.success(msg); } catch { toast.error('No se pudo guardar'); } finally { setBusy(false); }
  };
  const wa = (kind: 'confirm' | 'remind' | 'cancel') => window.open(whatsappToCustomer(b, businessName, kind), '_blank', 'noopener');

  if (b.kind === 'block') {
    return (
      <Modal title="Horario bloqueado" onClose={onClose}
        footer={<button disabled={busy} onClick={async () => { setBusy(true); try { await deleteBooking(storeId, b.id); toast.success('Horario liberado'); onClose(); } catch { toast.error('No se pudo liberar'); setBusy(false); } }} className="w-full h-12 rounded-2xl bg-red-50 text-red-700 font-semibold flex items-center justify-center gap-2"><Trash2 className="w-4 h-4" /> Liberar horario</button>}>
        <div className="space-y-2 text-[14px] text-slate-700">
          <p><b>{dayLabel(b.dateKey)}</b>, de {hhmm(b.startMin)} a {hhmm(b.endMin)}</p>
          <p>{b.staffId === 'ALL' ? 'Todo el local' : b.staffName}{b.reason ? ` · ${b.reason}` : ''}</p>
        </div>
      </Modal>
    );
  }

  const upcoming = b.status === 'PENDING' || b.status === 'CONFIRMED';
  return (
    <Modal title={b.customerName || 'Turno'} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset ${st.cls}`}>{st.label}</span>
          {b.code && <span className="text-[12px] font-mono font-semibold text-slate-500 bg-slate-100 rounded-md px-2 py-1">#{b.code}</span>}
          <span className="text-[12px] text-slate-400">{b.source === 'online' ? 'Reservado desde la tienda' : 'Cargado a mano'}</span>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4 space-y-2.5 text-[14px] text-slate-700">
          <p className="flex items-center gap-2.5"><CalendarDays className="w-4 h-4 text-slate-400" /> {dayLabel(b.dateKey)}, {hhmm(b.startMin)} a {hhmm(b.endMin)}</p>
          <p className="flex items-center gap-2.5"><Scissors className="w-4 h-4 text-slate-400" /> {b.serviceName}{b.price ? ` · ${money(b.price)}` : ''}</p>
          {b.staffName && <p className="flex items-center gap-2.5"><User className="w-4 h-4 text-slate-400" /> {b.staffName}</p>}
          {b.customerPhone && <p className="flex items-center gap-2.5"><Phone className="w-4 h-4 text-slate-400" /> <a className="text-rose-700 font-medium" href={`tel:${b.customerPhone}`}>{b.customerPhone}</a></p>}
          {b.customerNote && <p className="text-[13px] text-slate-500 whitespace-pre-line border-t border-slate-200 pt-2.5">“{b.customerNote}”</p>}
        </div>

        {b.customerPhone && (
          <div>
            <p className={label}>Avisarle por WhatsApp</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => wa('confirm')} className="h-11 rounded-xl bg-[#1FAF55] text-white text-[13.5px] font-semibold flex items-center justify-center gap-1.5"><MessageCircle className="w-4 h-4" /> Confirmación</button>
              <button onClick={() => wa('remind')} className="h-11 rounded-xl bg-emerald-50 text-emerald-800 text-[13.5px] font-semibold flex items-center justify-center gap-1.5"><Clock className="w-4 h-4" /> Recordatorio</button>
            </div>
          </div>
        )}

        <div>
          <p className={label}>Estado</p>
          <div className="grid grid-cols-2 gap-2">
            {b.status === 'PENDING' && <button disabled={busy} onClick={() => act('CONFIRMED', 'Turno confirmado')} className="h-11 rounded-xl bg-rose-600 text-white text-[13.5px] font-semibold flex items-center justify-center gap-1.5"><Check className="w-4 h-4" /> Confirmar</button>}
            {b.status !== 'DONE' && b.status !== 'CANCELLED' && <button disabled={busy} onClick={() => act('DONE', 'Marcado como atendido')} className="h-11 rounded-xl bg-sky-50 text-sky-800 text-[13.5px] font-semibold">Atendido</button>}
            {upcoming && <button disabled={busy} onClick={() => act('NO_SHOW', 'Marcado: no vino')} className="h-11 rounded-xl bg-slate-100 text-slate-700 text-[13.5px] font-semibold">No vino</button>}
            {upcoming && (
              <button disabled={busy} onClick={async () => {
                if (!confirm('¿Cancelar este turno? El horario queda libre.')) return;
                await act('CANCELLED', 'Turno cancelado');
                if (b.customerPhone && confirm('¿Le avisás por WhatsApp que se canceló?')) wa('cancel');
              }} className="h-11 rounded-xl bg-red-50 text-red-700 text-[13.5px] font-semibold">Cancelar turno</button>
            )}
            {!upcoming && <button disabled={busy} onClick={() => act('CONFIRMED', 'Turno reactivado')} className="h-11 rounded-xl bg-slate-100 text-slate-700 text-[13.5px] font-semibold">Volver a confirmado</button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DayPicker({ value, onChange, days = 30 }: { value: string; onChange: (k: string) => void; days?: number }) {
  const today = localNow().dateKey;
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
      {Array.from({ length: days }, (_, i) => addDays(today, i)).map((k) => (
        <button key={k} onClick={() => onChange(k)} className={`w-14 h-14 shrink-0 rounded-xl flex flex-col items-center justify-center border ${k === value ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>
          <span className="text-[10.5px] font-semibold uppercase opacity-80">{i18nShort(k)}</span>
          <span className="text-[16px] font-bold leading-tight">{+k.slice(8)}</span>
        </button>
      ))}
    </div>
  );
}
const i18nShort = (k: string) => (k === localNow().dateKey ? 'Hoy' : DAY_NAMES[weekday(k)].slice(0, 3));

function NewBooking({ storeId, agenda, bookings, initialDay, onClose }: { storeId: string; agenda: AgendaConfig; bookings: Booking[]; initialDay: string; onClose: () => void }) {
  const services = agenda.services.filter((s) => s.active !== false);
  const staffAll = agenda.staff.filter((s) => s.active !== false);
  const [serviceId, setServiceId] = useState(services[0]?.id || '');
  const service = services.find((s) => s.id === serviceId);
  const staffOk = service ? staffAll.filter((s) => canDo(s, service)) : [];
  const [staffId, setStaffId] = useState('');
  const staff = staffOk.find((s) => s.id === staffId) || staffOk[0];
  const [day, setDay] = useState(initialDay < localNow().dateKey ? localNow().dateKey : initialDay);
  const [start, setStart] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Para cargar a mano no se exige anticipación; hoy, solo desde la hora actual
  const now = localNow();
  const slots = service && staff ? freeStarts(agenda, staff, service, day, bookings, day === now.dateKey ? now.min : 0) : [];
  useEffect(() => { setStart(null); }, [serviceId, staffId, day]);

  const save = async () => {
    const t = custom ? toMin(custom) : start;
    if (!service || !staff) return toast.error('Elegí servicio y profesional');
    if (t == null) return toast.error('Elegí el horario');
    if (!name.trim()) return toast.error('Escribí el nombre del cliente');
    if (custom && !slots.includes(t) && !confirm('Ese horario se superpone con otro turno o está fuera del horario. ¿Cargarlo igual?')) return;
    setBusy(true);
    try {
      await createManualBooking(storeId, { dateKey: day, startMin: t, service, staff, customerName: name, customerPhone: phone, customerNote: note });
      toast.success('Turno cargado');
      onClose();
    } catch { toast.error('No se pudo cargar el turno'); setBusy(false); }
  };

  return (
    <Modal title="Nuevo turno" onClose={onClose} footer={<button disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-rose-600 text-white font-semibold disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar turno'}</button>}>
      <div className="space-y-4">
        <div>
          <span className={label}>Servicio</span>
          <select className={input} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} min{s.price ? ` · ${money(s.price)}` : ''}</option>)}
          </select>
        </div>
        {staffOk.length > 1 && (
          <div>
            <span className={label}>Profesional</span>
            <div className="flex flex-wrap gap-2">
              {staffOk.map((s) => (
                <button key={s.id} onClick={() => setStaffId(s.id)} className={`h-9 px-3.5 rounded-full text-[13px] font-semibold border ${staff?.id === s.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>{s.name}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <span className={label}>Día</span>
          <DayPicker value={day} onChange={setDay} days={Math.max(30, agenda.maxDaysAhead)} />
        </div>
        <div>
          <span className={label}>Horario libre</span>
          {slots.length ? (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
              {slots.map((t) => (
                <button key={t} onClick={() => { setStart(t); setCustom(''); }} className={`h-10 rounded-lg text-[13.5px] font-semibold tabular-nums border ${start === t && !custom ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>{hhmm(t)}</button>
              ))}
            </div>
          ) : <p className="text-[13px] text-slate-400">No quedan horarios libres ese día.</p>}
          <div className="mt-2 flex items-center gap-2 text-[12.5px] text-slate-500">
            Otro horario:
            <input type="time" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-200 text-[14px]" />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><span className={label}>Cliente</span><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" /></div>
          <div><span className={label}>WhatsApp (opcional)</span><input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="11 5555-5555" /></div>
        </div>
        <div><span className={label}>Nota (opcional)</span><input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: trae su propio tinte" /></div>
      </div>
    </Modal>
  );
}

function NewBlock({ storeId, agenda, initialDay, onClose }: { storeId: string; agenda: AgendaConfig; initialDay: string; onClose: () => void }) {
  const staff = agenda.staff.filter((s) => s.active !== false);
  const [staffId, setStaffId] = useState('ALL');
  const [day, setDay] = useState(initialDay < localNow().dateKey ? localNow().dateKey : initialDay);
  const [allDay, setAllDay] = useState(false);
  const [from, setFrom] = useState('13:00');
  const [to, setTo] = useState('14:00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const s = allDay ? 0 : toMin(from), e = allDay ? 24 * 60 : toMin(to);
    if (e <= s) return toast.error('La hora de fin tiene que ser después del inicio');
    setBusy(true);
    try {
      await createBlock(storeId, { dateKey: day, startMin: s, endMin: e, staffId, staffName: staff.find((x) => x.id === staffId)?.name, reason });
      toast.success('Horario bloqueado');
      onClose();
    } catch { toast.error('No se pudo bloquear'); setBusy(false); }
  };
  return (
    <Modal title="Bloquear horario" onClose={onClose} footer={<button disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-slate-900 text-white font-semibold disabled:opacity-60">Bloquear</button>}>
      <div className="space-y-4">
        <p className="text-[13px] text-slate-500">Nadie va a poder reservar en ese horario (almuerzo, trámite, día libre).</p>
        <div>
          <span className={label}>Quién</span>
          <div className="flex flex-wrap gap-2">
            {[{ id: 'ALL', name: 'Todo el local' }, ...staff].map((s) => (
              <button key={s.id} onClick={() => setStaffId(s.id)} className={`h-9 px-3.5 rounded-full text-[13px] font-semibold border ${staffId === s.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>{s.name}</button>
            ))}
          </div>
        </div>
        <div><span className={label}>Día</span><DayPicker value={day} onChange={setDay} days={90} /></div>
        <label className="flex items-center gap-2 text-[14px] text-slate-700"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="w-4 h-4 accent-rose-600" /> Todo el día</label>
        {!allDay && (
          <div className="flex items-center gap-2 text-[13px] text-slate-500">
            De <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 px-2 rounded-lg border border-slate-200 text-[14px]" />
            a <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 px-2 rounded-lg border border-slate-200 text-[14px]" />
          </div>
        )}
        <div><span className={label}>Motivo (opcional)</span><input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Almuerzo" /></div>
      </div>
    </Modal>
  );
}

// ─── Configuración ─────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${on ? 'bg-rose-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

function Card({ icon: Icon, title, hint, children, action }: { icon: any; title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5">
      <div className="flex items-start gap-3 mb-3">
        <span className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center shrink-0"><Icon className="w-[18px] h-[18px] text-rose-600" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-slate-900">{title}</p>
          {hint && <p className="text-[12.5px] text-slate-500">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const DURATIONS = [10, 15, 20, 30, 40, 45, 60, 75, 90, 120, 150, 180, 240];

function ConfigView({ agenda, storeHours, mobile, onSave, publicUrl }: { agenda: AgendaConfig; storeHours?: DayHours[]; mobile: boolean; onSave: (a: AgendaConfig) => Promise<void>; publicUrl: string | null }) {
  const [a, setA] = useState<AgendaConfig>(agenda);
  const [saving, setSaving] = useState(false);
  const [editingStaff, setEditingStaff] = useState<string | null>(null);
  useEffect(() => { setA(agenda); }, [agenda]);
  const dirty = JSON.stringify(a) !== JSON.stringify(agenda);

  const baseHours = (): DayHours[] => (storeHours && storeHours.length === 7 ? storeHours : [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: d !== 0, from: '09:00', to: '19:00' }))).map((h) => ({ ...h, ranges: dayRanges(h).map((r) => ({ ...r })) }));
  const setService = (id: string, p: Partial<AgendaService>) => setA({ ...a, services: a.services.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const setStaff = (id: string, p: Partial<AgendaStaff>) => setA({ ...a, staff: a.staff.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  const save = async () => {
    const services = a.services.filter((s) => s.name.trim());
    const staff = a.staff.filter((s) => s.name.trim());
    if (a.enabled && (!services.length || !staff.length)) return toast.error('Para tomar turnos online cargá al menos un servicio y un profesional');
    setSaving(true);
    try {
      await onSave({ ...a, services: services.map((s) => ({ ...s, name: s.name.trim(), price: Number(s.price) || 0 })), staff: staff.map((s) => ({ ...s, name: s.name.trim() })) });
      toast.success('Agenda guardada');
    } catch { toast.error('No se pudo guardar'); } finally { setSaving(false); }
  };

  return (
    <div className={`${mobile ? 'px-4 py-4 pb-28' : 'p-6 max-w-5xl w-full mx-auto pb-28'} space-y-4`}>
      <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 flex items-center gap-4">
        <div className="flex-1">
          <p className="text-[15px] font-bold text-slate-900">Tomar turnos online</p>
          <p className="text-[12.5px] text-slate-500">{a.enabled ? `Tus clientes reservan desde la tienda${publicUrl ? ` (${publicUrl})` : ''}.` : 'Apagado: la tienda no muestra la reserva de turnos.'}</p>
        </div>
        <Toggle on={a.enabled} onChange={(v) => setA({ ...a, enabled: v })} />
      </section>

      <Card icon={Scissors} title="Servicios" hint="Lo que el cliente elige al reservar, con cuánto dura y cuánto sale."
        action={<button onClick={() => setA({ ...a, services: [...a.services, { id: newId(), name: '', durationMin: 30, price: 0, active: true }] })} className="h-9 px-3 rounded-xl bg-rose-50 text-rose-700 text-[13px] font-semibold flex items-center gap-1"><Plus className="w-4 h-4" /> Agregar</button>}>
        {a.services.length === 0 ? <p className="text-[13px] text-slate-400 py-2">Todavía no cargaste servicios. Ej.: “Corte de pelo · 30 min”.</p> : (
          <div className="space-y-3">
            {a.services.map((s) => (
              <div key={s.id} className={`rounded-xl border border-slate-200 p-3 ${s.active === false ? 'opacity-60' : ''}`}>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input className={input} value={s.name} onChange={(e) => setService(s.id, { name: e.target.value })} placeholder="Nombre del servicio" />
                  <button onClick={() => { if (confirm(`¿Borrar "${s.name || 'este servicio'}"?`)) setA({ ...a, services: a.services.filter((x) => x.id !== s.id) }); }} className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center" aria-label="Borrar"><Trash2 className="w-4 h-4 text-slate-500" /></button>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <select className={input} value={s.durationMin} onChange={(e) => setService(s.id, { durationMin: Number(e.target.value) })}>
                    {Array.from(new Set([...DURATIONS, s.durationMin])).sort((x, y) => x - y).map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60} min` : ''}`}</option>)}
                  </select>
                  <div className="relative"><span className="absolute left-3 inset-y-0 flex items-center text-slate-400">$</span>
                    <input className={`${input} pl-7`} inputMode="numeric" value={s.price || ''} onChange={(e) => setService(s.id, { price: Number(e.target.value.replace(/\D/g, '')) || 0 })} placeholder="Precio (opcional)" /></div>
                </div>
                <input className={`${input} mt-2`} value={s.description || ''} onChange={(e) => setService(s.id, { description: e.target.value })} placeholder="Descripción corta (opcional)" />
                {a.staff.length > 1 && (
                  <div className="mt-2">
                    <p className="text-[12px] text-slate-500 mb-1">{s.staffIds?.length ? 'Lo hacen solo:' : 'Lo hacen todos. Si lo hacen solo algunos, tocalos:'}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {a.staff.map((p) => {
                        const on = !!s.staffIds?.includes(p.id);
                        return <button key={p.id} onClick={() => setService(s.id, { staffIds: on ? (s.staffIds || []).filter((x) => x !== p.id) : [...(s.staffIds || []), p.id] })}
                          className={`h-8 px-3 rounded-full text-[12.5px] font-semibold border ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>{p.name || 'Sin nombre'}</button>;
                      })}
                    </div>
                  </div>
                )}
                <label className="mt-2 flex items-center gap-2 text-[13px] text-slate-600"><input type="checkbox" className="w-4 h-4 accent-rose-600" checked={s.active !== false} onChange={(e) => setService(s.id, { active: e.target.checked })} /> Se puede reservar online</label>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card icon={Users} title="Profesionales" hint="Quiénes atienden y en qué horarios. Cada uno tiene su propia agenda."
        action={<button onClick={() => { const id = newId(); setA({ ...a, staff: [...a.staff, { id, name: '', color: STAFF_COLORS[a.staff.length % STAFF_COLORS.length], hours: baseHours(), active: true }] }); setEditingStaff(id); }} className="h-9 px-3 rounded-xl bg-rose-50 text-rose-700 text-[13px] font-semibold flex items-center gap-1"><Plus className="w-4 h-4" /> Agregar</button>}>
        {a.staff.length === 0 ? <p className="text-[13px] text-slate-400 py-2">Agregá a quienes atienden. Si trabajás solo/a, agregate a vos.</p> : (
          <div className="space-y-3">
            {a.staff.map((p) => (
              <div key={p.id} className={`rounded-xl border border-slate-200 p-3 ${p.active === false ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: p.color }} />
                  <input className={input} value={p.name} onChange={(e) => setStaff(p.id, { name: e.target.value })} placeholder="Nombre" />
                  <button onClick={() => setEditingStaff(editingStaff === p.id ? null : p.id)} className="h-11 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[13px] font-semibold text-slate-700 shrink-0">{editingStaff === p.id ? 'Listo' : 'Horarios'}</button>
                  <button onClick={() => { if (confirm(`¿Borrar a ${p.name || 'este profesional'}? Sus turnos ya cargados no se borran.`)) setA({ ...a, staff: a.staff.filter((x) => x.id !== p.id), services: a.services.map((s) => ({ ...s, staffIds: (s.staffIds || []).filter((x) => x !== p.id) })) }); }} className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0" aria-label="Borrar"><Trash2 className="w-4 h-4 text-slate-500" /></button>
                </div>
                <p className="text-[12px] text-slate-500 mt-1.5">{hoursSummary(p.hours)}</p>
                {editingStaff === p.id && (
                  <div className="mt-2">
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {STAFF_COLORS.map((c) => <button key={c} onClick={() => setStaff(p.id, { color: c })} className={`w-7 h-7 rounded-full ${p.color === c ? 'ring-2 ring-offset-2 ring-slate-900' : ''}`} style={{ background: c }} aria-label="Color" />)}
                    </div>
                    <HoursEditor hours={p.hours} onChange={(hours) => setStaff(p.id, { hours })} />
                    <label className="mt-2 flex items-center gap-2 text-[13px] text-slate-600"><input type="checkbox" className="w-4 h-4 accent-rose-600" checked={p.active !== false} onChange={(e) => setStaff(p.id, { active: e.target.checked })} /> Atiende (desmarcalo si está de vacaciones)</label>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card icon={SlidersHorizontal} title="Reglas de reserva">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><span className={label}>Mostrar horarios cada</span>
            <select className={input} value={a.slotStepMin} onChange={(e) => setA({ ...a, slotStepMin: Number(e.target.value) })}>{[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}</select></div>
          <div><span className={label}>Tiempo libre entre turnos</span>
            <select className={input} value={a.bufferMin} onChange={(e) => setA({ ...a, bufferMin: Number(e.target.value) })}>{[0, 5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m ? `${m} minutos` : 'Sin tiempo libre'}</option>)}</select></div>
          <div><span className={label}>Reservar con al menos</span>
            <select className={input} value={a.minNoticeMin} onChange={(e) => setA({ ...a, minNoticeMin: Number(e.target.value) })}>{[[0, 'Sin anticipación'], [30, '30 minutos'], [60, '1 hora'], [120, '2 horas'], [240, '4 horas'], [720, '12 horas'], [1440, '1 día'], [2880, '2 días']].map(([m, t]) => <option key={m} value={m}>{t} de anticipación</option>)}</select></div>
          <div><span className={label}>Se puede reservar hasta</span>
            <select className={input} value={a.maxDaysAhead} onChange={(e) => setA({ ...a, maxDaysAhead: Number(e.target.value) })}>{[7, 14, 21, 30, 60, 90].map((d) => <option key={d} value={d}>{d} días para adelante</option>)}</select></div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <div className="flex-1">
            <p className="text-[14px] font-semibold text-slate-800">Confirmar automáticamente</p>
            <p className="text-[12.5px] text-slate-500">{a.autoConfirm ? 'Los turnos reservados online quedan confirmados al instante.' : 'Los turnos online quedan “Por confirmar” hasta que los confirmes vos.'}</p>
          </div>
          <Toggle on={a.autoConfirm} onChange={(v) => setA({ ...a, autoConfirm: v })} />
        </div>
      </Card>

      <div className={`fixed ${mobile ? 'left-0 right-0 bottom-[calc(64px+env(safe-area-inset-bottom))] px-4' : 'left-auto right-6 bottom-6'} z-30 transition-all ${dirty ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
        <button onClick={save} disabled={saving} className={`${mobile ? 'w-full' : 'px-8'} h-12 rounded-2xl bg-rose-600 text-white font-semibold shadow-lg shadow-rose-600/30 disabled:opacity-60`}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </div>
  );
}

function hoursSummary(hours: DayHours[]) {
  const open = WEEK.filter((d) => hours?.[d]?.open && dayRanges(hours[d]).length);
  if (!open.length) return 'Sin horarios: no se le pueden reservar turnos';
  return open.map((d) => `${DAY_NAMES[d].slice(0, 3)} ${dayRanges(hours[d]).map((r) => `${r.from}–${r.to}`).join(' y ')}`).join(' · ');
}

function HoursEditor({ hours, onChange }: { hours: DayHours[]; onChange: (h: DayHours[]) => void }) {
  const time = 'h-9 px-2 rounded-lg border border-slate-200 bg-white text-[13.5px] text-slate-800';
  const setDay = (idx: number, h: DayHours) => onChange(hours.map((x, i) => (i === idx ? h : x)));
  return (
    <div className="rounded-xl bg-slate-50 divide-y divide-slate-200/70">
      {WEEK.map((idx) => {
        const h = hours[idx] || { open: false, from: '09:00', to: '19:00' };
        const ranges = dayRanges(h);
        return (
          <div key={idx} className="px-3 py-2.5 flex items-start gap-3">
            <label className="w-24 shrink-0 flex items-center gap-2 pt-1.5 text-[13.5px] font-medium text-slate-700">
              <input type="checkbox" className="w-4 h-4 accent-rose-600" checked={h.open} onChange={(e) => setDay(idx, { ...h, open: e.target.checked })} /> {DAY_NAMES[idx].slice(0, 3)}
            </label>
            {h.open ? (
              <div className="flex-1 space-y-1.5">
                {ranges.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[12.5px] text-slate-500 flex-wrap">
                    <input type="time" className={time} value={r.from} onChange={(e) => setDay(idx, withRanges(h, ranges.map((x, j) => (j === i ? { ...x, from: e.target.value } : x))))} />
                    a
                    <input type="time" className={time} value={r.to} onChange={(e) => setDay(idx, withRanges(h, ranges.map((x, j) => (j === i ? { ...x, to: e.target.value } : x))))} />
                    {ranges.length > 1 && <button onClick={() => setDay(idx, withRanges(h, ranges.filter((_, j) => j !== i)))} className="font-semibold text-slate-400 px-1">Quitar</button>}
                  </div>
                ))}
                <div className="flex gap-3">
                  {ranges.length < 3 && <button onClick={() => setDay(idx, withRanges(h, [...ranges, { from: '17:00', to: '20:00' }]))} className="text-[12.5px] font-semibold text-rose-700">+ Turno</button>}
                  {idx === 1 && <button onClick={() => onChange(hours.map((d, j) => (j === 0 ? d : { ...h, ranges: ranges.map((r) => ({ ...r })) })))} className="text-[12.5px] font-semibold text-slate-500">Copiar a lun–sáb</button>}
                </div>
              </div>
            ) : <span className="pt-1.5 text-[13px] text-slate-400">No atiende</span>}
          </div>
        );
      })}
    </div>
  );
}

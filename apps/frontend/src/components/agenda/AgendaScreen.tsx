import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Ban, Settings, Clock, User, Phone, MessageCircle, Check, X, Trash2,
  ExternalLink, ClipboardList, Users, SlidersHorizontal, CalendarClock, Globe, Loader2, Banknote, Share2, HelpCircle, Eye, ShoppingCart, BellRing,
} from 'lucide-react';
import { useOnlineOrders, startOnlineOrdersSync } from '../../services/onlineStoreOrders';
import { loadStoreConfig, saveStoreConfig, resolveStoreId, isSubdomainAvailable, dayRanges, withRanges, type StoreConfig, type DayHours } from '../../services/onlineStore';
import { usePlanStore, isAgendaOnly } from '../../stores/planStore';
import { setStoreSetting } from '../../services/storeSettings';
import { AGENDA_TEMPLATES, detectAgendaKind, type AgendaTemplate } from '../../services/agendaTemplates';
import { useAutoTour } from '../common/tour/GuidedTour';
import { useTourStore } from '../common/tour/tourStore';
import { setTourScreen, AGENDA_WORDS } from '../common/tour/tourContext';
import { useClientPreview, demoShareInstead } from '../../services/clientPreview';
import { IS_DEMO_BUILD } from '../../demo/flag';
import { useNavigate } from 'react-router-dom';
import { addTurnoToCart } from '../pos/turnoCobro';
import api from '../../services/api';
import {
  fullAgenda, subscribeBookings, freeStarts, canDo, occupies, localNow, addDays, weekday, dayLabel, hhmm, toMin, newId, STAFF_COLORS,
  createManualBooking, createBlock, setBookingStatus, deleteBooking, whatsappToCustomer, chargeBooking, unchargeBooking, PAY_METHODS,
  rescheduleBooking, fetchBookingsRange, markReminded, depositPaid, depositFor,
  type AgendaConfig, type AgendaService, type AgendaStaff, type Booking, type BookingStatus,
} from '../../services/agenda';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader, money } from '../mobile/ui';
import { Modal, STATUS, input, label, PUBLIC_BASE } from './agendaUi';
import { GettingStartedCard } from '../onboarding/GettingStarted';

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Agenda de turnos (planes Tienda, Agenda y Full): los clientes reservan desde la tienda
 * online y el comercio los ve, confirma, carga a mano, bloquea horarios y configura
 * servicios y profesionales. Datos en Firestore (ver services/agenda.ts).
 * Con el plan Agenda (solo turnos) es la pantalla de inicio: la "tienda" es solo la
 * página de reservas, y se arma y se publica desde acá.
 */
export default function AgendaScreen() {
  const mobile = useOwnerMobile().active;
  const agendaOnly = usePlanStore((s) => isAgendaOnly(s.features));
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
  // Los recorridos hablan el idioma del rubro (pacientes, alumnos, barberos...)
  setTourScreen({ agendaKind: detectAgendaKind(agenda), mobile });
  const ready = !!storeId && !!config;
  useAutoTour('agenda', ready && tab === 'agenda' && agenda.services.length > 0 && agenda.staff.length > 0);
  useAutoTour('agendaConfig', ready && tab === 'config');
  const startTour = useTourStore((s) => s.start);
  const saveAgenda = async (next: AgendaConfig) => {
    if (!storeId) return;
    // Solo turnos: la página existe para reservar, así que se publica o no junto con la agenda
    const extra = agendaOnly ? { isPublished: next.enabled } : {};
    await saveStoreConfig(storeId, { agenda: next, ...extra } as any);
    setConfig((c) => (c ? ({ ...c, agenda: next, ...extra } as any) : c));
  };
  const savePage = async (id: string, page: PageData) => {
    await saveStoreConfig(id, page);
    setConfig((c) => (c ? { ...c, ...page } : c));
    // Sin nombre de comercio todavía (plan Agenda recién creado): se usa el de la página
    if (!localStorage.getItem('gd_store_name')) setStoreSetting('store_name', page.businessName);
    if (!storeId) {
      // Recién creada: la agenda (y los avisos de reservas) arrancan con esta tienda
      useOnlineOrders.setState({ storeId: id });
      startOnlineOrdersSync();
    }
  };

  const publicUrl = config?.subdomain ? `${PUBLIC_BASE}/${config.subdomain}` : null;
  // Compartir el link es lo que trae los primeros turnos: en el celular abre el menú de compartir
  const shareLink = async () => {
    if (!publicUrl || demoShareInstead(storeId, 'turnos')) return;
    const url = `${publicUrl}#turnos`;
    const text = `Reservá tu turno en ${config?.businessName || 'nuestro local'}:`;
    try {
      if (navigator.share) await navigator.share({ title: config?.businessName, text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); toast.success('Link copiado: pegalo en tu WhatsApp o Instagram'); }
      setStoreSetting('agenda_link_shared', '1');
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast.error('No se pudo compartir el link');
    }
  };
  const canShare = !!publicUrl && agenda.enabled;
  // Vista del cliente: la página de turnos como la ven los clientes (aunque no esté publicada)
  const showPreview = useClientPreview((s) => s.show);
  const canPreview = !!storeId && !!config && agenda.services.length > 0 && agenda.staff.length > 0;
  const preview = () => storeId && showPreview(storeId, 'turnos');
  const subtitle = !storeId ? 'Armá tu página de turnos' : !config ? 'Cargando…'
    : agenda.enabled ? (config.isPublished || agendaOnly ? 'Tomando turnos online' : 'Activa · la tienda no está publicada') : 'Turnos online apagados';

  const tabs = (
    <div className={`inline-flex p-1 rounded-xl ${mobile ? 'bg-white/15' : 'bg-slate-100'}`}>
      {([['agenda', 'Agenda', CalendarDays], ['config', 'Configurar', Settings]] as const).map(([id, text, Icon]) => (
        <button key={id} onClick={() => setTab(id)} data-tour={id === 'config' ? 'agenda-tab-config' : undefined}
          className={`ag-press transition-colors h-9 px-3.5 rounded-lg text-[13.5px] font-semibold flex items-center gap-1.5 ${tab === id ? (mobile ? 'bg-white text-rose-700' : 'bg-white text-slate-900 shadow-sm') : (mobile ? 'text-white/85' : 'text-slate-500')}`}>
          <Icon className="w-4 h-4" /> {text}
        </button>
      ))}
    </div>
  );

  const body = !storeId ? (
    <PageSetup mobile={mobile} agendaOnly={agendaOnly} onSave={savePage} />
  ) : !config ? (
    <div className="p-10 text-center text-[14px] text-slate-500">Cargando…</div>
  ) : tab === 'agenda' ? (
    <DayView storeId={storeId} agenda={agenda} businessName={config.businessName} slug={config.subdomain} mobile={mobile} onConfigure={() => setTab('config')} />
  ) : (
    <ConfigView agenda={agenda} storeHours={config.hours} mobile={mobile} onSave={saveAgenda} publicUrl={publicUrl}
      page={agendaOnly ? <PageSetup mobile={mobile} agendaOnly storeId={storeId} initial={config} onSave={savePage} embedded /> : null} />
  );

  if (mobile) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <ScreenHeader back={!agendaOnly} title="Agenda" subtitle={subtitle}
          action={storeId && config ? (
            <span className="flex items-center gap-1.5">
              {canPreview && <button data-tour="agenda-preview" onClick={preview} className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0 active:bg-white/25 ag-press" aria-label="Ver como cliente"><Eye className="w-5 h-5" /></button>}
              <button onClick={() => startTour(tab === 'config' ? 'agendaConfig' : 'agenda')} className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0 active:bg-white/25 ag-press" aria-label="Cómo funciona"><HelpCircle className="w-5 h-5" /></button>
              {canShare && <button data-tour="agenda-share" onClick={shareLink} className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0 active:bg-white/25 ag-press" aria-label="Compartir mi link"><Share2 className="w-5 h-5" /></button>}
            </span>
          ) : undefined}>
          {storeId && tabs}
        </ScreenHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain"><div key={tab} className="ag-fade">{body}</div></div>
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
          {canShare && (
            <button data-tour="agenda-share" onClick={shareLink} className="ag-press h-10 px-4 rounded-xl bg-rose-600 text-white text-[13.5px] font-semibold flex items-center gap-2">
              <Share2 className="w-4 h-4" /> Compartir mi link
            </button>
          )}
          {canPreview && (
            <button data-tour="agenda-preview" onClick={preview} className="ag-press h-10 px-4 rounded-xl bg-white border border-slate-200 text-[13.5px] font-semibold text-slate-700 flex items-center gap-2">
              <Eye className="w-4 h-4" /> Ver como cliente
            </button>
          )}
          {/* La página real (en la demo no existe en internet) */}
          {!IS_DEMO_BUILD && publicUrl && agenda.enabled && (config?.isPublished || agendaOnly) && (
            <button onClick={() => window.open(`${publicUrl}#turnos`, '_blank', 'noopener')} title={agendaOnly ? 'Abrir mi página' : 'Abrir en la tienda'} aria-label={agendaOnly ? 'Abrir mi página' : 'Abrir en la tienda'} className="ag-press w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center">
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          {storeId && tabs}
        </div>
      </div>
      <div key={tab} className="ag-fade">{body}</div>
    </div>
  );
}

// ─── Agenda del día ─────────────────────────────────────────

function DayView({ storeId, agenda, businessName, slug, mobile, onConfigure }: { storeId: string; agenda: AgendaConfig; businessName: string; slug?: string; mobile: boolean; onConfigure: () => void }) {
  const agendaOnly = usePlanStore((s) => isAgendaOnly(s.features));
  const today = localNow().dateKey;
  const [day, setDay] = useState(today);
  const [staffFilter, setStaffFilter] = useState<string>('ALL');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reminding, setReminding] = useState(false);
  // Hacia dónde se movió el día: la tira y la lista entran desde ese lado
  const prevDay = useRef(day);
  const dir = day === prevDay.current ? '' : day > prevDay.current ? 'ag-from-right' : 'ag-from-left';
  useEffect(() => { prevDay.current = day; }, [day]);
  // Turnos que cambiaron de estado o se cobraron (acá o desde otro equipo): destellan una vez
  const seen = useRef<Map<string, string> | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  useEffect(() => {
    const sig = (b: Booking) => `${b.status}|${b.payment ? 1 : 0}`;
    const prev = seen.current;
    seen.current = new Map(bookings.map((b) => [b.id, sig(b)]));
    if (!prev) return;
    const changed = bookings.filter((b) => prev.has(b.id) && prev.get(b.id) !== sig(b)).map((b) => b.id);
    if (!changed.length) return;
    setFlash(new Set(changed));
    const t = setTimeout(() => setFlash(new Set()), 1200);
    return () => clearTimeout(t);
  }, [bookings]);
  // Reloj para la línea de "ahora" y el turno en curso
  const [nowMin, setNowMin] = useState(() => localNow().min);
  useEffect(() => { const t = setInterval(() => setNowMin(localNow().min), 30000); return () => clearInterval(t); }, []);

  // Se escucha una ventana alrededor del día elegido (para los contadores de la tira de días)
  // Vista Día (lista) o Semana (calendario lunes a domingo); se recuerda en este equipo
  const [view, setView] = useState<'day' | 'week'>(() => { try { return localStorage.getItem('agenda_view') === 'week' ? 'week' : 'day'; } catch { return 'day'; } });
  const changeView = (v: 'day' | 'week') => { setView(v); try { localStorage.setItem('agenda_view', v); } catch { /* sin almacenamiento */ } };
  const monday = addDays(day, -((weekday(day) + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // Se escucha una ventana que cubre la tira de días y la semana entera
  const from = [addDays(day, -3), monday].sort()[0], to = [addDays(day, 10), weekDays[6]].sort()[1];
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
  // Sin caja, los turnos se cobran acá: se muestra cuánto entró del total del día
  const canCharge = usePlanStore((s) => !s.features.caja);
  const dayCharged = visible.reduce((s, b) => s + (b.payment ? Number(b.payment.amount) || 0 : 0), 0);

  if (!agenda.services.length || !staff.length) {
    return (
      <div className={`${mobile ? 'px-4 py-6' : 'p-6 max-w-5xl mx-auto'} space-y-4`}>
        {agendaOnly && mobile && <GettingStartedCard mobile />}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
          <CalendarClock className="w-10 h-10 text-rose-500 mx-auto" />
          <p className="mt-3 text-[16px] font-bold text-slate-900">Configurá tu agenda</p>
          <p className="text-[13.5px] text-slate-500 mt-1 max-w-sm mx-auto">Cargá tus servicios (con duración y precio) y quiénes atienden, con sus horarios. Después activás los turnos online y tus clientes reservan desde {agendaOnly ? 'tu página' : 'tu tienda'}.</p>
          <button onClick={onConfigure} className="mt-4 h-11 px-5 rounded-xl bg-rose-600 text-white text-[14px] font-semibold">Empezar</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${mobile ? 'px-4 py-4' : 'p-6 max-w-5xl w-full mx-auto'} space-y-4`}>
      {agendaOnly && mobile && <GettingStartedCard mobile />}
      {!agenda.enabled && (
        <button onClick={onConfigure} className="w-full text-left bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <CalendarClock className="w-5 h-5 text-amber-700 shrink-0" />
          <span className="flex-1 text-[13.5px] text-amber-900">Los turnos online están apagados: podés cargar turnos a mano, pero tus clientes todavía no pueden reservar. Tocá para activarlos.</span>
          <ChevronRight className="w-4 h-4 text-amber-700" />
        </button>
      )}
      {/* Recordatorios de mañana: un toque por cliente, quedan marcados */}
      {(() => {
        const tomorrow = addDays(today, 1);
        const list = bookings.filter((b) => b.dateKey === tomorrow && b.kind === 'booking' && (b.status === 'PENDING' || b.status === 'CONFIRMED') && b.customerPhone);
        const left = list.filter((b) => !b.remindedAt).length;
        if (!list.length || !left) return null;
        return (
          <button onClick={() => setReminding(true)} className="anim-rise ag-press w-full text-left bg-sky-50 border border-sky-200 rounded-2xl p-4 flex items-center gap-3">
            <BellRing className="w-5 h-5 text-sky-700 shrink-0" />
            <span className="flex-1 text-[13.5px] text-sky-900">
              <b>Mañana tenés {list.length} turno{list.length === 1 ? '' : 's'}.</b> {left === list.length ? 'Mandales el recordatorio por WhatsApp' : `Faltan ${left} recordatorio${left === 1 ? '' : 's'}`}: así nadie se olvida.
            </span>
            <ChevronRight className="w-4 h-4 text-sky-700" />
          </button>
        );
      })()}
      {pending > 0 && (
        <div className="anim-rise bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-[13.5px] text-amber-900 font-medium">
          {pending === 1 ? 'Hay 1 turno por confirmar' : `Hay ${pending} turnos por confirmar`}
        </div>
      )}

      {/* Días */}
      <div data-tour="agenda-days" className="bg-white rounded-2xl border border-slate-200/80 p-2 flex items-center gap-1 overflow-hidden">
        <button onClick={() => setDay(addDays(day, view === 'week' ? -7 : -1))} className="ag-press w-9 h-14 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-50" aria-label="Día anterior"><ChevronLeft className="w-5 h-5" /></button>
        <div key={day} className={`flex-1 grid grid-cols-7 gap-1 ${dir}`}>
          {strip.map((k) => {
            const n = countFor(k), on = k === day;
            return (
              <button key={k} onClick={() => setDay(k)} className={`ag-press transition-colors ${mobile ? 'h-16' : 'h-14'} min-w-0 rounded-xl flex flex-col items-center justify-center ${on ? 'bg-rose-600 text-white' : k === today ? 'bg-rose-50 text-rose-700' : 'text-slate-700 hover:bg-slate-50'}`}>
                <span className="text-[11px] font-semibold uppercase opacity-80">{DAY_NAMES[weekday(k)].slice(0, 3)}</span>
                <span className="text-[17px] font-bold leading-tight">{+k.slice(8)}</span>
                <span className={`text-[10px] font-semibold ${on ? 'text-white/85' : 'text-slate-400'}`}>{n ? (mobile ? n : `${n} turno${n === 1 ? '' : 's'}`) : '·'}</span>
              </button>
            );
          })}
        </div>
        <button onClick={() => setDay(addDays(day, view === 'week' ? 7 : 1))} className="ag-press w-9 h-14 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-50" aria-label="Día siguiente"><ChevronRight className="w-5 h-5" /></button>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[18px] font-bold text-slate-900">{view === 'week' ? `Semana del ${+monday.slice(8)}/${+monday.slice(5, 7)} al ${+weekDays[6].slice(8)}/${+weekDays[6].slice(5, 7)}` : dayLabel(day)}</p>
          <p className="text-[12.5px] text-slate-500">
            {visible.filter((b) => b.kind === 'booking').length} turnos
            {canCharge && dayCharged ? ` · cobrado ${money(dayCharged)}${dayIncome > dayCharged ? ` de ${money(dayIncome)}` : ''}` : dayIncome ? ` · ${money(dayIncome)}` : ''}
            {day !== today && <button onClick={() => setDay(today)} className="ml-2 font-semibold text-rose-700">Ir a hoy</button>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div data-tour="agenda-view" className="inline-flex p-1 rounded-xl bg-slate-100">
            {([['day', 'Día'], ['week', 'Semana']] as const).map(([v, t]) => (
              <button key={v} onClick={() => changeView(v)} className={`ag-press transition-colors h-8 px-3 rounded-lg text-[13px] font-semibold ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{t}</button>
            ))}
          </div>
          <button data-tour="agenda-block" onClick={() => setBlocking(true)} className="ag-press h-10 px-3.5 rounded-xl bg-white border border-slate-200 text-[13.5px] font-semibold text-slate-700 flex items-center gap-1.5"><Ban className="w-4 h-4" /> Bloquear</button>
          <button data-tour="agenda-new" onClick={() => setCreating(true)} className="ag-press h-10 px-3.5 rounded-xl bg-rose-600 text-white text-[13.5px] font-semibold flex items-center gap-1.5"><Plus className="w-4 h-4" /> Turno</button>
        </div>
      </div>

      {staff.length > 1 && (
        <div data-tour="agenda-staff" className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {[{ id: 'ALL', name: 'Todos', color: '#0f172a' }, ...staff.map((s) => staffById[s.id])].map((s) => (
            <button key={s.id} onClick={() => setStaffFilter(s.id)}
              className={`ag-press transition-colors h-9 px-3.5 rounded-full text-[13px] font-semibold border shrink-0 flex items-center gap-1.5 ${staffFilter === s.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>
              {s.id !== 'ALL' && <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />}{s.name}
            </button>
          ))}
        </div>
      )}

      {view === 'week' ? (
        <WeekGrid key={`${monday}-${staffFilter}`} className={dir} days={weekDays} today={today} nowMin={nowMin} loading={loading} agenda={agenda} staffById={staffById}
          bookings={bookings.filter((b) => weekDays.includes(b.dateKey) && b.status !== 'CANCELLED' && (staffFilter === 'ALL' || b.staffId === staffFilter || b.staffId === 'ALL'))}
          onOpen={setOpen} onDay={(k) => { setDay(k); changeView('day'); }} />
      ) : (
      <div data-tour="agenda-list" key={`${day}-${staffFilter}`} className={`bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden ${dir}`}>
        {loading ? (
          <div aria-label="Cargando" className="divide-y divide-slate-100">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <span className="w-14 space-y-1.5"><span className="block h-3.5 w-11 rounded ag-skel" /><span className="block h-2.5 w-8 rounded ag-skel" /></span>
                <span className="w-1 h-9 rounded-full ag-skel" />
                <span className="flex-1 space-y-1.5"><span className="block h-3.5 w-2/5 rounded ag-skel" /><span className="block h-2.5 w-3/5 rounded ag-skel" /></span>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-10 text-center ag-fade">
            <CalendarDays className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="mt-2 text-[13.5px] text-slate-400">No hay turnos {day === today ? 'hoy' : 'este día'}.</p>
            <button onClick={() => setCreating(true)} className="mt-2 text-[13px] font-semibold text-rose-700">Cargar uno</button>
          </div>
        ) : visible.map((b, i) => {
          const st = STATUS[b.status];
          const color = b.staffId === 'ALL' ? '#94a3b8' : staffById[b.staffId]?.color || '#94a3b8';
          const isToday = day === today;
          const live = isToday && b.kind === 'booking' && occupies(b) && b.status !== 'DONE' && b.startMin <= nowMin && nowMin < b.endMin;
          const past = isToday && b.kind === 'booking' && b.endMin <= nowMin && b.status !== 'PENDING';
          // Línea de "ahora" antes del primer turno que todavía no empezó
          const nowLine = isToday && b.startMin > nowMin && (i === 0 || visible[i - 1].startMin <= nowMin);
          return (
            <div key={b.id}>
              {nowLine && (
                <div className="flex items-center gap-2 px-4 py-1 ag-fade" aria-label="Ahora">
                  <span className="text-[11px] font-bold text-rose-600 tabular-nums">{hhmm(nowMin)}</span>
                  <span className="relative w-2 h-2 rounded-full bg-rose-600 ag-live" />
                  <span className="flex-1 h-px bg-rose-200" />
                </div>
              )}
              <button onClick={() => setOpen(b)} style={{ '--i': i } as React.CSSProperties}
                className={`ag-item w-full flex items-stretch gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 ${flash.has(b.id) ? 'ag-flash' : ''} ${live ? 'bg-emerald-50/50' : ''}`}>
                <span className={`w-14 shrink-0 transition-opacity ${past ? 'opacity-60' : ''}`}>
                  <span className="block text-[15px] font-bold text-slate-900 tabular-nums">{hhmm(b.startMin)}</span>
                  <span className="block text-[11.5px] text-slate-400 tabular-nums">{hhmm(b.endMin)}</span>
                </span>
                <span className="w-1 rounded-full shrink-0" style={{ background: color }} />
                <span className={`flex-1 min-w-0 transition-opacity ${past ? 'opacity-60' : ''}`}>
                  {b.kind === 'block' ? (
                    <>
                      <span className="block text-[14.5px] font-semibold text-slate-600">Bloqueado{b.reason ? ` · ${b.reason}` : ''}</span>
                      <span className="block text-[12.5px] text-slate-400">{b.staffId === 'ALL' ? 'Todo el local' : b.staffName}</span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5 text-[14.5px] font-semibold text-slate-900 min-w-0">
                        {live && <span className="relative w-2 h-2 rounded-full bg-emerald-500 shrink-0 ag-live" aria-label="En curso" />}
                        <span className="truncate">{b.customerName}</span>
                      </span>
                      <span className="block text-[12.5px] text-slate-500 truncate">{live ? 'En curso · ' : ''}{b.serviceName}{b.staffName ? ` · ${b.staffName}` : ''}{b.source === 'online' ? ' · online' : ''}</span>
                    </>
                  )}
                </span>
                <span className="shrink-0 self-center">
                  {b.payment
                    ? <span className="text-[11px] font-semibold px-2 py-1 rounded-full ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200 transition-colors">Cobrado</span>
                    : <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ring-1 ring-inset transition-colors ${st.cls}`}>{st.label}</span>}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      )}
      {view === 'day' && cancelled.length > 0 && <p className="text-[12.5px] text-slate-400 px-1">{cancelled.length} cancelado{cancelled.length === 1 ? '' : 's'} este día</p>}

      {open && <BookingDetail storeId={storeId} agenda={agenda} slug={slug} booking={bookings.find((b) => b.id === open.id) || open} businessName={businessName} onClose={() => setOpen(null)} onMoved={(b) => setDay(b.dateKey)} />}
      {creating && <NewBooking storeId={storeId} agenda={agenda} bookings={bookings} initialDay={day} onClose={() => setCreating(false)} />}
      {reminding && <RemindersSheet storeId={storeId} businessName={businessName} slug={slug} list={bookings.filter((b) => b.dateKey === addDays(today, 1) && b.kind === 'booking' && (b.status === 'PENDING' || b.status === 'CONFIRMED') && b.customerPhone).sort((a, b) => a.startMin - b.startMin)} onClose={() => setReminding(false)} />}
      {blocking && <NewBlock storeId={storeId} agenda={agenda} initialDay={day} onClose={() => setBlocking(false)} />}
    </div>
  );
}

function BookingDetail({ storeId, agenda, slug, booking: b, businessName, onClose, onMoved }: { storeId: string; agenda: AgendaConfig; slug?: string; booking: Booking; businessName: string; onClose: () => void; onMoved: (b: Booking) => void }) {
  const navigate = useNavigate();
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [charging, setCharging] = useState(false);
  const canCharge = usePlanStore((s) => !s.features.caja);
  const st = STATUS[b.status];
  const act = async (status: BookingStatus, msg: string) => {
    setBusy(true);
    try { await setBookingStatus(storeId, b.id, status, b); toast.success(msg); } catch { toast.error('No se pudo guardar'); } finally { setBusy(false); }
  };
  const uncharge = async () => {
    if (!confirm('¿Quitar el cobro de este turno? Sigue figurando como atendido.')) return;
    setBusy(true);
    try { await unchargeBooking(storeId, b); toast.success('Cobro quitado'); } catch { toast.error('No se pudo guardar'); } finally { setBusy(false); }
  };
  const wa = (kind: 'confirm' | 'remind' | 'cancel' | 'moved', bk: Booking = b) => window.open(whatsappToCustomer(bk, businessName, kind, slug), '_blank', 'noopener');
  // Con caja, el turno se cobra en el punto de venta: entra al ticket y al cobrarse queda pagado acá
  const chargeInCaja = () => {
    addTurnoToCart(storeId, b);
    toast.success('Turno agregado al ticket de la caja');
    onClose();
    navigate('/pos');
  };

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

  const upcoming = b.status === 'PENDING' || b.status === 'CONFIRMED' || b.status === 'AWAITING_PAYMENT';
  if (charging) return <ChargeSheet storeId={storeId} booking={b} onClose={() => setCharging(false)} onDone={onClose} />;
  if (moving) return (
    <RescheduleSheet storeId={storeId} agenda={agenda} booking={b} onClose={() => setMoving(false)} onDone={(nb) => {
      setMoving(false); onMoved(nb);
      if (nb.customerPhone && confirm('¿Le avisás por WhatsApp el nuevo horario?')) wa('moved', nb);
    }} />
  );
  return (
    <Modal title={b.customerName || 'Turno'} onClose={onClose}
      footer={b.status !== 'CANCELLED' && b.status !== 'NO_SHOW' ? (
        b.payment ? (
          <div className="flex items-center gap-3">
            <span className="flex-1 min-w-0 text-[14px] text-emerald-800 font-semibold flex items-center gap-2"><Check className="w-4 h-4 shrink-0" /> Cobrado {money(b.payment.amount)} · {b.payment.method}</span>
            <button disabled={busy} onClick={uncharge} className="h-10 px-3 rounded-xl bg-slate-100 text-slate-600 text-[13px] font-semibold shrink-0">Quitar cobro</button>
          </div>
        ) : canCharge ? (
          <button onClick={() => setCharging(true)} className="w-full h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-semibold flex items-center justify-center gap-2 active:scale-[0.99]">
            <Banknote className="w-5 h-5" /> Cobrar{b.price ? ` ${money(Math.max(0, b.price - depositPaid(b)))}` : ''}
          </button>
        ) : (
          <button onClick={chargeInCaja} className="w-full h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-semibold flex items-center justify-center gap-2 active:scale-[0.99]">
            <ShoppingCart className="w-5 h-5" /> Cobrar en la caja{b.price ? ` ${money(Math.max(0, b.price - depositPaid(b)))}` : ''}
          </button>
        )
      ) : undefined}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset ${st.cls}`}>{st.label}</span>
          {b.code && <span className="text-[12px] font-mono font-semibold text-slate-500 bg-slate-100 rounded-md px-2 py-1">#{b.code}</span>}
          <span className="text-[12px] text-slate-400">{b.source === 'online' ? 'Reservado desde la tienda' : 'Cargado a mano'}</span>
          {b.cancelledBy === 'client' && b.status === 'CANCELLED' && <span className="text-[12px] font-semibold text-red-600">Lo canceló el cliente desde su link</span>}
          {(b.cancelledBy as string) === 'expired' && b.status === 'CANCELLED' && <span className="text-[12px] font-semibold text-slate-500">No pagó la seña a tiempo</span>}
          {b.deposit && (depositPaid(b)
            ? <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">Seña pagada {money(depositPaid(b))} · Mercado Pago</span>
            : b.status === 'AWAITING_PAYMENT' ? <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full bg-sky-50 text-sky-700">Seña de {money(b.deposit.amount)} sin pagar todavía</span> : null)}
          {b.deposit?.refundNeeded && <span className="text-[12px] font-semibold text-red-600">Pagó la seña tarde y el horario ya estaba ocupado: reprogramalo o devolvé la seña</span>}
          {b.movedFrom && <span className="text-[12px] text-slate-400">Reprogramado (antes {dayLabel(b.movedFrom.dateKey, true)} {hhmm(b.movedFrom.startMin)})</span>}
        </div>
        <div className="rounded-2xl bg-slate-50 p-4 space-y-2.5 text-[14px] text-slate-700">
          <p className="flex items-center gap-2.5"><CalendarDays className="w-4 h-4 text-slate-400" /> {dayLabel(b.dateKey)}, {hhmm(b.startMin)} a {hhmm(b.endMin)}</p>
          <p className="flex items-center gap-2.5"><ClipboardList className="w-4 h-4 text-slate-400" /> {b.serviceName}{b.price ? ` · ${money(b.price)}` : ''}</p>
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
            {b.status === 'AWAITING_PAYMENT' && <button disabled={busy} onClick={() => act('CONFIRMED', 'Turno confirmado sin seña')} className="h-11 rounded-xl bg-rose-600 text-white text-[13.5px] font-semibold flex items-center justify-center gap-1.5"><Check className="w-4 h-4" /> Confirmar sin seña</button>}
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
            {!b.payment && b.status !== 'DONE' && (
              <button disabled={busy} onClick={() => setMoving(true)} className="ag-press h-11 rounded-xl bg-slate-100 text-slate-700 text-[13.5px] font-semibold flex items-center justify-center gap-1.5"><CalendarClock className="w-4 h-4" /> Reprogramar</button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Cobro de un turno: monto (por defecto el precio del servicio) y medio de pago. */
function ChargeSheet({ storeId, booking: b, onClose, onDone }: { storeId: string; booking: Booking; onClose: () => void; onDone: () => void }) {
  // Lo que falta: el precio menos la seña que ya pagó por Mercado Pago
  const [amount, setAmount] = useState(String(Math.max(0, (Number(b.price) || 0) - depositPaid(b)) || ''));
  const [method, setMethod] = useState(PAY_METHODS[0]);
  const [busy, setBusy] = useState(false);
  const value = Number(String(amount).replace(/\./g, '').replace(',', '.')) || 0;
  const save = async () => {
    if (value <= 0 && !confirm('¿Registrar el turno como atendido sin cobrar nada?')) return;
    setBusy(true);
    try {
      await chargeBooking(storeId, b, { method, amount: value });
      toast.success(value > 0 ? `Cobrado ${money(value)} · ${method}` : 'Marcado como atendido');
      onDone();
    } catch { toast.error('No se pudo guardar el cobro'); setBusy(false); }
  };
  return (
    <Modal title="Cobrar turno" onClose={onClose}
      footer={<button disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-semibold disabled:opacity-60">{busy ? 'Guardando…' : value > 0 ? `Cobrar ${money(value)}` : 'Guardar'}</button>}>
      <div className="space-y-4">
        <p className="text-[13.5px] text-slate-500">{b.customerName} · {b.serviceName}{b.staffName ? ` · ${b.staffName}` : ''}</p>
        <div>
          <label className={label}>Monto</label>
          <div className="flex items-center h-14 rounded-xl bg-slate-50 border border-slate-200 focus-within:border-rose-500 focus-within:bg-white px-3">
            <span className="text-[20px] font-bold text-slate-400 mr-1">$</span>
            <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} className="flex-1 min-w-0 bg-transparent text-[24px] font-bold text-slate-900 outline-none tabular-nums" />
          </div>
        </div>
        <div>
          <label className={label}>Medio de pago</label>
          <div className="grid grid-cols-2 gap-2">
            {PAY_METHODS.map((m) => (
              <button key={m} onClick={() => setMethod(m)} className={`h-11 rounded-xl text-[13.5px] font-semibold border ${method === m ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-700 border-slate-200'}`}>{m}</button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Semana en calendario: una columna por día (lunes a domingo) y los turnos ubicados por hora,
 * con el color de quien atiende. Si dos turnos se pisan (varios profesionales), van lado a lado.
 */
function WeekGrid({ days, today, nowMin, loading, agenda, staffById, bookings, onOpen, onDay, className }: {
  days: string[]; today: string; nowMin: number; loading: boolean; agenda: AgendaConfig; staffById: Record<string, any>;
  bookings: Booking[]; onOpen: (b: Booking) => void; onDay: (k: string) => void; className?: string;
}) {
  // Franja horaria: de la primera apertura al último cierre de la semana (y lo que haya fuera de eso)
  let first = 24 * 60, last = 0;
  for (const st of agenda.staff) for (const h of st.hours || []) if (h?.open) for (const r of dayRanges(h)) { first = Math.min(first, toMin(r.from)); last = Math.max(last, toMin(r.to)); }
  for (const b of bookings) if (b.kind === 'booking') { first = Math.min(first, b.startMin); last = Math.max(last, b.endMin); }
  if (first >= last) { first = 9 * 60; last = 20 * 60; }
  const startH = Math.floor(first / 60), endH = Math.ceil(last / 60);
  const PX = 0.9; // píxeles por minuto
  const height = (endH - startH) * 60 * PX;
  const top = (m: number) => (Math.max(m, startH * 60) - startH * 60) * PX;

  // Carriles por día: los turnos que se pisan se reparten el ancho
  const lanesOf = (list: Booking[]) => {
    const sorted = [...list].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    const ends: number[] = [];
    const lane = new Map<string, number>();
    for (const b of sorted) {
      let i = ends.findIndex((e) => e <= b.startMin);
      if (i < 0) { i = ends.length; ends.push(0); }
      ends[i] = b.endMin; lane.set(b.id, i);
    }
    return { lane, count: Math.max(1, ends.length) };
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-200/80 overflow-x-auto ${className || ''}`}>
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-slate-100 sticky top-0 bg-white z-10">
          <span />
          {days.map((k) => (
            <button key={k} onClick={() => onDay(k)} className={`ag-press py-2 text-center ${k === today ? 'text-rose-700' : 'text-slate-600'} hover:bg-slate-50`}>
              <span className="block text-[11px] font-semibold uppercase">{DAY_NAMES[weekday(k)].slice(0, 3)}</span>
              <span className={`inline-flex w-7 h-7 items-center justify-center rounded-full text-[14px] font-bold ${k === today ? 'bg-rose-600 text-white' : ''}`}>{+k.slice(8)}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[48px_repeat(7,1fr)] relative" style={{ height }}>
          {/* Horas */}
          <div className="relative">
            {Array.from({ length: endH - startH }, (_, i) => (
              <span key={i} className="absolute right-2 text-[10.5px] text-slate-400 tabular-nums -translate-y-1/2" style={{ top: i * 60 * PX }}>{i ? hhmm((startH + i) * 60) : ''}</span>
            ))}
          </div>
          {days.map((k) => {
            const list = bookings.filter((b) => b.dateKey === k);
            const { lane, count } = lanesOf(list.filter((b) => b.kind === 'booking'));
            return (
              <div key={k} className={`relative border-l border-slate-100 ${k === today ? 'bg-rose-50/30' : ''}`}>
                {Array.from({ length: endH - startH }, (_, i) => <span key={i} className="absolute inset-x-0 border-t border-slate-100" style={{ top: i * 60 * PX }} />)}
                {list.filter((b) => b.kind === 'block').map((b) => (
                  <button key={b.id} onClick={() => onOpen(b)} title={`Bloqueado${b.reason ? ` · ${b.reason}` : ''}`}
                    className="absolute inset-x-0.5 rounded-md bg-slate-100 border border-dashed border-slate-300 text-[10.5px] text-slate-500 px-1 overflow-hidden text-left"
                    style={{ top: top(b.startMin), height: Math.max(14, (Math.min(b.endMin, endH * 60) - Math.max(b.startMin, startH * 60)) * PX) }}>
                    Bloqueado{b.reason ? ` · ${b.reason}` : ''}
                  </button>
                ))}
                {list.filter((b) => b.kind === 'booking').map((b, i) => {
                  const color = staffById[b.staffId]?.color || '#94a3b8';
                  const l = lane.get(b.id) || 0;
                  const h = Math.max(18, (b.endMin - b.startMin) * PX - 2);
                  const faded = b.status === 'NO_SHOW' || b.status === 'AWAITING_PAYMENT';
                  return (
                    <button key={b.id} onClick={() => onOpen(b)} style={{ '--i': i, top: top(b.startMin) + 1, height: h, left: `calc(${(l / count) * 100}% + 2px)`, width: `calc(${100 / count}% - 4px)`, background: `${color}1f`, borderLeft: `3px solid ${color}` } as React.CSSProperties}
                      className={`ag-item absolute rounded-md px-1.5 py-0.5 text-left overflow-hidden hover:brightness-95 transition ${faded ? 'opacity-60' : ''}`}
                      title={`${hhmm(b.startMin)} ${b.customerName} · ${b.serviceName}`}>
                      <span className="block text-[11px] font-bold text-slate-900 truncate leading-tight">{hhmm(b.startMin)} {b.customerName}</span>
                      {h > 30 && <span className="block text-[10.5px] text-slate-600 truncate leading-tight">{b.serviceName}</span>}
                      {b.payment && h > 44 && <span className="block text-[10px] font-semibold text-emerald-700">Cobrado</span>}
                    </button>
                  );
                })}
                {k === today && nowMin >= startH * 60 && nowMin <= endH * 60 && (
                  <span className="absolute inset-x-0 z-[5] pointer-events-none" style={{ top: top(nowMin) }}>
                    <span className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-rose-600 ag-live" />
                    <span className="block h-px bg-rose-500" />
                  </span>
                )}
              </div>
            );
          })}
          {loading && <div className="absolute inset-0 bg-white/60 flex items-center justify-center"><Loader2 className="w-6 h-6 text-rose-600 animate-spin" /></div>}
        </div>
      </div>
    </div>
  );
}

/** Recordatorios de mañana: cada uno abre WhatsApp con el mensaje (y el link del turno) y queda marcado. */
function RemindersSheet({ storeId, businessName, slug, list, onClose }: { storeId: string; businessName: string; slug?: string; list: Booking[]; onClose: () => void }) {
  const [sent, setSent] = useState<Set<string>>(new Set());
  const send = (b: Booking) => {
    window.open(whatsappToCustomer(b, businessName, 'remind', slug), '_blank', 'noopener');
    setSent((s) => new Set(s).add(b.id));
    markReminded(storeId, b.id).catch(() => {});
  };
  const done = list.filter((b) => b.remindedAt || sent.has(b.id)).length;
  return (
    <Modal title="Recordatorios de mañana" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-500">Tocá cada uno: se abre WhatsApp con el mensaje listo y el link para que vea o cancele su turno. {done ? `Mandados: ${done} de ${list.length}.` : ''}</p>
        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {list.map((b, i) => {
            const ok = !!b.remindedAt || sent.has(b.id);
            return (
              <div key={b.id} style={{ '--i': i } as React.CSSProperties} className="ag-item flex items-center gap-3 px-3.5 py-3">
                <span className="w-12 shrink-0 text-[14px] font-bold text-slate-900 tabular-nums">{hhmm(b.startMin)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold text-slate-900 truncate">{b.customerName}</span>
                  <span className="block text-[12px] text-slate-500 truncate">{b.serviceName}{b.staffName ? ` · ${b.staffName}` : ''}</span>
                </span>
                <button onClick={() => send(b)} className={`ag-press h-9 px-3 rounded-xl text-[12.5px] font-semibold flex items-center gap-1.5 shrink-0 transition-colors ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-[#1FAF55] text-white'}`}>
                  {ok ? <><Check className="w-4 h-4" /> Enviado</> : <><MessageCircle className="w-4 h-4" /> WhatsApp</>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/** Reprogramar: mismo servicio y duración; se elige día, profesional y un horario libre. */
function RescheduleSheet({ storeId, agenda, booking: b, onClose, onDone }: { storeId: string; agenda: AgendaConfig; booking: Booking; onClose: () => void; onDone: (b: Booking) => void }) {
  const today = localNow().dateKey;
  const service = agenda.services.find((s) => s.id === b.serviceId);
  const staffAll = agenda.staff.filter((s) => s.active !== false && (!service || canDo(s, service)));
  const [staffId, setStaffId] = useState(staffAll.some((s) => s.id === b.staffId) ? b.staffId : staffAll[0]?.id || '');
  const staff = staffAll.find((s) => s.id === staffId);
  const [day, setDay] = useState(b.dateKey < today ? today : b.dateKey);
  const [dayBookings, setDayBookings] = useState<Booking[] | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setDayBookings(null); setStart(null);
    fetchBookingsRange(storeId, day, day).then((l) => alive && setDayBookings(l)).catch(() => alive && setDayBookings([]));
    return () => { alive = false; };
  }, [storeId, day]);
  // Duración real del turno (aunque el servicio haya cambiado después)
  const svc = { ...(service || { id: b.serviceId || '', name: b.serviceName || '', price: 0 }), durationMin: Math.max(5, b.endMin - b.startMin) } as AgendaService;
  const now = localNow();
  const slots = staff && dayBookings ? freeStarts(agenda, staff, svc, day, dayBookings, day === now.dateKey ? now.min : 0, b.id) : [];
  const save = async () => {
    const t = custom ? toMin(custom) : start;
    if (!staff) return toast.error('Elegí quién lo atiende');
    if (t == null) return toast.error('Elegí el nuevo horario');
    if (custom && !slots.includes(t) && !confirm('Ese horario se superpone con otro turno o está fuera del horario. ¿Moverlo igual?')) return;
    setBusy(true);
    try {
      const nb = await rescheduleBooking(storeId, b, { dateKey: day, startMin: t, staff });
      toast.success(`Turno movido: ${dayLabel(day, true)}, ${hhmm(t)}`);
      onDone(nb);
    } catch { toast.error('No se pudo mover el turno'); setBusy(false); }
  };
  return (
    <Modal title="Reprogramar turno" onClose={onClose}
      footer={<button disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-rose-600 text-white font-semibold disabled:opacity-60">{busy ? 'Guardando…' : 'Mover turno'}</button>}>
      <div className="space-y-4">
        <p className="text-[13.5px] text-slate-500">{b.customerName} · {b.serviceName} · ahora {dayLabel(b.dateKey, true).toLowerCase()} {hhmm(b.startMin)}</p>
        {staffAll.length > 1 && (
          <div>
            <span className={label}>{cap1(AGENDA_WORDS[detectAgendaKind(agenda)].staffUno)}</span>
            <div className="flex flex-wrap gap-2">
              {staffAll.map((s) => (
                <button key={s.id} onClick={() => { setStaffId(s.id); setStart(null); }} className={`ag-press h-9 px-3.5 rounded-full text-[13px] font-semibold border ${staffId === s.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>{s.name}</button>
              ))}
            </div>
          </div>
        )}
        <div><span className={label}>Día</span><DayPicker value={day} onChange={setDay} days={Math.max(30, agenda.maxDaysAhead)} /></div>
        <div>
          <span className={label}>Horario libre</span>
          {!dayBookings ? (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">{Array.from({ length: 8 }, (_, i) => <span key={i} className="h-10 rounded-lg ag-skel" />)}</div>
          ) : slots.length ? (
            <div key={`${staffId}-${day}`} className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
              {slots.map((t, i) => (
                <button key={t} style={{ '--i': i } as React.CSSProperties} onClick={() => { setStart(t); setCustom(''); }} className={`ag-item ag-press transition-colors h-10 rounded-lg text-[13.5px] font-semibold tabular-nums border ${start === t && !custom ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>{hhmm(t)}</button>
              ))}
            </div>
          ) : <p className="text-[13px] text-slate-400">No quedan horarios libres ese día.</p>}
          <div className="mt-2 flex items-center gap-2 text-[12.5px] text-slate-500">
            Otro horario:
            <input type="time" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-200 text-[14px]" />
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
        <button key={k} onClick={() => onChange(k)} className={`ag-press transition-colors w-14 h-14 shrink-0 rounded-xl flex flex-col items-center justify-center border ${k === value ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>
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
            <span className={label}>{cap1(AGENDA_WORDS[detectAgendaKind(agenda)].staffUno)}</span>
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
            <div key={`${serviceId}-${staff?.id}-${day}`} className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
              {slots.map((t, i) => (
                <button key={t} style={{ '--i': i } as React.CSSProperties} onClick={() => { setStart(t); setCustom(''); }} className={`ag-item ag-press transition-colors h-10 rounded-lg text-[13.5px] font-semibold tabular-nums border ${start === t && !custom ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>{hhmm(t)}</button>
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
        <div><span className={label}>Nota (opcional)</span><input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: es la primera vez que viene" /></div>
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
      <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ease-out ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function Card({ icon: Icon, title, hint, children, action, tour }: { icon: any; title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode; tour?: string }) {
  return (
    <section data-tour={tour} className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5">
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

type PageData = Pick<StoreConfig, 'businessName' | 'subdomain' | 'whatsappNumber'>;

const slugOf = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * Nombre, dirección web y WhatsApp de la página donde reservan los clientes. Sin tienda
 * todavía, la crea (es lo primero que ve un comercio del plan Agenda); con `embedded`
 * edita esos datos dentro de Configurar.
 */
function PageSetup({ mobile, agendaOnly, storeId, initial, onSave, embedded }: {
  mobile: boolean; agendaOnly: boolean; storeId?: string; initial?: Partial<PageData>;
  onSave: (storeId: string, page: PageData) => Promise<void>; embedded?: boolean;
}) {
  const [name, setName] = useState(initial?.businessName || localStorage.getItem('gd_store_name') || '');
  const [slug, setSlug] = useState(initial?.subdomain || '');
  const [slugTouched, setSlugTouched] = useState(!!initial?.subdomain);
  const [wa, setWa] = useState(initial?.whatsappNumber || '');
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  const [saving, setSaving] = useState(false);
  // La dirección no se cambia una vez creada: es el link que ya circula entre los clientes
  const fixedSlug = !!initial?.subdomain;
  const dirty = !embedded || name !== (initial?.businessName || '') || wa !== (initial?.whatsappNumber || '') || (!fixedSlug && !!slug);

  useEffect(() => { if (!slugTouched) setSlug(slugOf(name)); }, [name, slugTouched]);
  useEffect(() => {
    if (fixedSlug || slug.length < 3) { setSlugState('idle'); return; }
    setSlugState('checking');
    const t = setTimeout(() => {
      isSubdomainAvailable(slug, storeId || '').then((ok) => setSlugState(ok ? 'ok' : 'taken')).catch(() => setSlugState('idle'));
    }, 450);
    return () => clearTimeout(t);
  }, [slug, fixedSlug, storeId]);

  const submit = async () => {
    const businessName = name.trim();
    const whatsappNumber = wa.replace(/\D/g, '');
    if (businessName.length < 2) return toast.error('Poné el nombre de tu negocio');
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return toast.error('La dirección va de 3 a 40 letras, números o guiones');
    if (slugState === 'taken') return toast.error('Esa dirección ya la usa otro comercio. Elegí otra.');
    if (whatsappNumber.length < 8) return toast.error('Poné tu WhatsApp con código de área (ej. 3815551234)');
    setSaving(true);
    try {
      const id = storeId || await resolveStoreId();
      if (!fixedSlug && !(await isSubdomainAvailable(slug, id))) {
        setSlugState('taken');
        toast.error('Esa dirección ya la usa otro comercio. Elegí otra.');
        return;
      }
      await onSave(id, { businessName, subdomain: slug, whatsappNumber });
      toast.success(embedded ? 'Datos guardados' : 'Listo: ahora cargá tus servicios y horarios');
    } catch (err) {
      console.error(err);
      toast.error('No se pudo guardar. Revisá la conexión y probá de nuevo.');
    } finally { setSaving(false); }
  };

  const fields = (
    <div className="space-y-3">
      <div>
        <label className={label}>Nombre del negocio</label>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Estudio Norte" />
      </div>
      <div>
        <label className={label}>Dirección de tu página</label>
        <div className={`flex items-center h-11 rounded-xl border border-slate-200 overflow-hidden ${fixedSlug ? 'bg-slate-100' : 'bg-slate-50 focus-within:border-rose-500 focus-within:bg-white'}`}>
          <span className="pl-3 text-[13.5px] text-slate-400 shrink-0">tienda.ventra.store/</span>
          <input className="flex-1 min-w-0 h-full pr-3 bg-transparent text-[14.5px] outline-none disabled:text-slate-500" value={slug} disabled={fixedSlug}
            onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)); }} placeholder="estudio-norte" />
        </div>
        {!fixedSlug && slug.length >= 3 && slugState !== 'idle' && (
          <p className={`mt-1.5 text-[12.5px] font-medium flex items-center gap-1.5 ${slugState === 'ok' ? 'text-emerald-600' : slugState === 'taken' ? 'text-red-600' : 'text-slate-400'}`}>
            {slugState === 'checking' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando…</>}
            {slugState === 'ok' && <><Check className="w-3.5 h-3.5" /> Disponible</>}
            {slugState === 'taken' && <><X className="w-3.5 h-3.5" /> Ya la usa otro comercio</>}
          </p>
        )}
      </div>
      <div>
        <label className={label}>WhatsApp para tus clientes</label>
        <input className={input} value={wa} onChange={(e) => setWa(e.target.value)} inputMode="tel" placeholder="Ej.: 3815551234" />
      </div>
    </div>
  );

  if (embedded) {
    return (
      <Card tour="agenda-cfg-page" icon={Globe} title="Tu página de turnos" hint="Cómo te encuentran tus clientes para reservar."
        action={dirty ? <button onClick={submit} disabled={saving} className="h-9 px-3 rounded-xl bg-rose-600 text-white text-[13px] font-semibold disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar'}</button> : undefined}>
        {fields}
      </Card>
    );
  }

  return (
    <div className={mobile ? 'px-4 py-5' : 'p-6 max-w-xl w-full mx-auto'}>
      <section className="bg-white rounded-2xl border border-slate-200/80 p-5">
        <span className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center"><CalendarDays className="w-6 h-6 text-rose-600" /></span>
        <h2 className="mt-3 text-[18px] font-bold text-slate-900">Armá tu página de turnos</h2>
        <p className="mt-1 mb-4 text-[13.5px] text-slate-500 leading-relaxed">
          {agendaOnly
            ? 'Es el link que les pasás a tus clientes para que reserven solos. Después cargás tus servicios, tu equipo y los horarios.'
            : 'Tus clientes reservan desde tu tienda online. Si todavía no la armaste, empezá por estos datos; el resto lo completás en Tienda online.'}
        </p>
        {fields}
        <button onClick={submit} disabled={saving} className="mt-5 w-full h-12 rounded-xl bg-rose-600 text-white text-[15px] font-semibold disabled:opacity-60 active:scale-[0.99]">
          {saving ? 'Creando…' : 'Crear mi página'}
        </button>
      </section>
    </div>
  );
}

function ConfigView({ agenda, storeHours, mobile, onSave, publicUrl, page }: { agenda: AgendaConfig; storeHours?: DayHours[]; mobile: boolean; onSave: (a: AgendaConfig) => Promise<void>; publicUrl: string | null; page?: React.ReactNode }) {
  const [a, setA] = useState<AgendaConfig>(agenda);
  const [saving, setSaving] = useState(false);
  const [editingStaff, setEditingStaff] = useState<string | null>(null);
  useEffect(() => { setA(agenda); }, [agenda]);
  const dirty = JSON.stringify(a) !== JSON.stringify(agenda);
  const words = AGENDA_WORDS[detectAgendaKind(a)];

  const baseHours = (): DayHours[] => (storeHours && storeHours.length === 7 ? storeHours : [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: d !== 0, from: '09:00', to: '19:00' }))).map((h) => ({ ...h, ranges: dayRanges(h).map((r) => ({ ...r })) }));
  const setService = (id: string, p: Partial<AgendaService>) => setA({ ...a, services: a.services.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const setStaff = (id: string, p: Partial<AgendaStaff>) => setA({ ...a, staff: a.staff.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  // Arranque rápido: servicios típicos del rubro y, si no hay nadie, el dueño como profesional
  const applyTemplate = (t: AgendaTemplate) => {
    const me = (() => { try { const u = JSON.parse(localStorage.getItem('user') || 'null'); return (u?.fullName || '').split(' ')[0]; } catch { return ''; } })();
    setA({
      ...a,
      kind: t.id,
      services: t.services.map((x) => ({ ...x, id: newId() })),
      staff: a.staff.length ? a.staff : [{ id: newId(), name: me || 'Yo', color: STAFF_COLORS[0], hours: baseHours(), active: true }],
    });
    toast.success('Listo: revisá las duraciones, poné tus precios y guardá');
  };
  const missingPrices = a.services.filter((x) => x.active !== false && x.name.trim() && !(Number(x.price) > 0)).length;

  const save = async () => {
    const services = a.services.filter((s) => s.name.trim());
    const staff = a.staff.filter((s) => s.name.trim());
    if (a.enabled && (!services.length || !staff.length)) return toast.error('Para tomar turnos online cargá al menos un servicio y un profesional');
    if (a.enabled && missingPrices && !confirm(`${missingPrices === 1 ? 'Un servicio no tiene' : `${missingPrices} servicios no tienen`} precio: tus clientes lo van a ver sin precio. ¿Guardar igual?`)) return;
    setSaving(true);
    try {
      await onSave({ ...a, services: services.map((s) => ({ ...s, name: s.name.trim(), price: Number(s.price) || 0 })), staff: staff.map((s) => ({ ...s, name: s.name.trim() })) });
      toast.success('Agenda guardada');
    } catch (err) { console.error('[Agenda] No se pudo guardar la configuración', err); toast.error('No se pudo guardar'); } finally { setSaving(false); }
  };

  return (
    <div className={`${mobile ? 'px-4 py-4 pb-28' : 'p-6 max-w-5xl w-full mx-auto pb-28'} space-y-4`}>
      {page}
      <section data-tour="agenda-cfg-online" className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 flex items-center gap-4">
        <div className="flex-1">
          <p className="text-[15px] font-bold text-slate-900">Tomar turnos online</p>
          <p className="text-[12.5px] text-slate-500">
            {a.enabled
              ? `Tus clientes reservan desde ${page ? 'tu página' : 'la tienda'}${publicUrl ? ` (${publicUrl})` : ''}.`
              : page ? 'Apagado: tu página no toma reservas.' : 'Apagado: la tienda no muestra la reserva de turnos.'}
          </p>
        </div>
        <Toggle on={a.enabled} onChange={(v) => setA({ ...a, enabled: v })} />
      </section>

      <Card tour="agenda-cfg-kind" icon={Globe} title="¿A qué te dedicás?" hint="Adapta los textos y los consejos. La agenda funciona igual para cualquier rubro.">
        <div className="flex flex-wrap gap-1.5">
          {[...AGENDA_TEMPLATES.map((t) => ({ id: t.id as string, label: `${t.emoji} ${t.title}` })), { id: 'otro', label: 'Otro' }].map((o) => {
            const on = (a.kind && AGENDA_TEMPLATES.some((t) => t.id === a.kind) ? a.kind : 'otro') === o.id;
            return (
              <button key={o.id} onClick={() => setA({ ...a, kind: o.id === 'otro' ? undefined : o.id })}
                className={`ag-press transition-colors h-9 px-3.5 rounded-full text-[13px] font-semibold border ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'}`}>{o.label}</button>
            );
          })}
        </div>
      </Card>

      <Card tour="agenda-cfg-services" icon={ClipboardList} title="Servicios" hint="Lo que el cliente elige al reservar, con cuánto dura y cuánto sale."
        action={<button onClick={() => setA({ ...a, services: [...a.services, { id: newId(), name: '', durationMin: 30, price: 0, active: true }] })} className="h-9 px-3 rounded-xl bg-rose-50 text-rose-700 text-[13px] font-semibold flex items-center gap-1"><Plus className="w-4 h-4" /> Agregar</button>}>
        {a.services.length === 0 ? (
          <div className="py-1">
            <p className="text-[13px] text-slate-500 mb-2.5">Empezá con los servicios típicos de tu rubro y después los ajustás:</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {AGENDA_TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => applyTemplate(t)} className="ag-press transition-colors h-12 rounded-xl border border-slate-200 bg-white hover:border-rose-300 hover:bg-rose-50/50 text-[14px] font-semibold text-slate-800 flex items-center justify-center gap-2">
                  <span className="text-[18px]">{t.emoji}</span> {t.title}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-slate-400 mt-2.5">¿Otro rubro? Tocá “Agregar” y cargalos a mano.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {missingPrices > 0 && <p className="text-[12.5px] font-medium text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Completá los precios: {missingPrices === 1 ? 'falta 1' : `faltan ${missingPrices}`}.</p>}
            {a.services.map((s, i) => (
              <div key={s.id} style={{ '--i': i } as React.CSSProperties} className={`ag-item rounded-xl border border-slate-200 p-3 ${s.active === false ? 'opacity-60' : ''}`}>
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

      <Card tour="agenda-cfg-staff" icon={Users} title={words.staff.charAt(0).toUpperCase() + words.staff.slice(1)} hint={a.kind === 'deportes' ? 'Cada cancha con sus horarios: se reserva por separado.' : 'Quiénes atienden y en qué horarios. Cada uno tiene su propia agenda.'}
        action={<button onClick={() => { const id = newId(); setA({ ...a, staff: [...a.staff, { id, name: '', color: STAFF_COLORS[a.staff.length % STAFF_COLORS.length], hours: baseHours(), active: true }] }); setEditingStaff(id); }} className="h-9 px-3 rounded-xl bg-rose-50 text-rose-700 text-[13px] font-semibold flex items-center gap-1"><Plus className="w-4 h-4" /> Agregar</button>}>
        {a.staff.length === 0 ? <p className="text-[13px] text-slate-400 py-2">Agregá a quienes atienden. Si trabajás solo/a, agregate a vos.</p> : (
          <div className="space-y-3">
            {a.staff.map((p, i) => (
              <div key={p.id} style={{ '--i': i } as React.CSSProperties} className={`ag-item rounded-xl border border-slate-200 p-3 ${p.active === false ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: p.color }} />
                  <input className={input} value={p.name} onChange={(e) => setStaff(p.id, { name: e.target.value })} placeholder="Nombre" />
                  <button onClick={() => setEditingStaff(editingStaff === p.id ? null : p.id)} className="h-11 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[13px] font-semibold text-slate-700 shrink-0">{editingStaff === p.id ? 'Listo' : 'Horarios'}</button>
                  <button onClick={() => { if (confirm(`¿Borrar a ${p.name || 'este profesional'}? Sus turnos ya cargados no se borran.`)) setA({ ...a, staff: a.staff.filter((x) => x.id !== p.id), services: a.services.map((s) => ({ ...s, staffIds: (s.staffIds || []).filter((x) => x !== p.id) })) }); }} className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0" aria-label="Borrar"><Trash2 className="w-4 h-4 text-slate-500" /></button>
                </div>
                <p className="text-[12px] text-slate-500 mt-1.5">{hoursSummary(p.hours)}</p>
                {editingStaff === p.id && (
                  <div className="mt-2 anim-rise">
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

      <Card tour="agenda-cfg-rules" icon={SlidersHorizontal} title="Reglas de reserva">
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
        <DepositRules a={a} setA={setA} />
      </Card>

      <div className={`fixed ${mobile ? 'left-0 right-0 bottom-[calc(64px+env(safe-area-inset-bottom))] px-4' : 'left-auto right-6 bottom-20'} z-30 transition-all duration-300 ease-out ${dirty ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
        <button onClick={save} disabled={saving} className={`${mobile ? 'w-full' : 'px-8'} h-12 rounded-2xl bg-rose-600 text-white font-semibold shadow-lg shadow-rose-600/30 disabled:opacity-60`}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </div>
  );
}

/**
 * Seña con Mercado Pago al reservar online. La cobra la nube con la cuenta de MP conectada del
 * comercio (Configuración → Integraciones); sin cuenta conectada no se puede prender.
 */
function DepositRules({ a, setA }: { a: AgendaConfig; setA: (a: AgendaConfig) => void }) {
  const [mp, setMp] = useState<null | { connected: boolean; nickname?: string | null; needsReconnect?: boolean }>(null);
  useEffect(() => {
    api.get('/mercadopago/status', { silent: true } as any).then(({ data }) => setMp(data)).catch(() => setMp({ connected: false }));
  }, []);
  const d = a.deposit || { enabled: false, mode: 'percent' as const, value: 30 };
  const set = (p: Partial<typeof d>) => setA({ ...a, deposit: { ...d, ...p } });
  const can = !!mp?.connected && !mp.needsReconnect;
  const example = a.services.find((s) => s.active !== false && Number(s.price) > 0);
  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-slate-800">Pedir seña con Mercado Pago</p>
          <p className="text-[12.5px] text-slate-500">
            {d.enabled && can ? 'Para reservar online, el cliente paga la seña. Si no la paga en 20 minutos, el horario se libera solo.'
              : 'Menos faltazos: el turno se confirma cuando el cliente paga la seña, y la plata entra a tu cuenta de Mercado Pago.'}
          </p>
        </div>
        <Toggle on={d.enabled && can} onChange={(v) => { if (!can) return toast.error('Primero conectá tu cuenta de Mercado Pago'); set({ enabled: v }); }} />
      </div>
      {mp && !can && (
        <a href="#/settings?tab=integraciones" className="mt-2 inline-flex text-[12.5px] font-semibold text-rose-700">
          {mp.needsReconnect ? 'Tu Mercado Pago se desconectó: volvé a conectarlo →' : 'Conectá tu cuenta en Configuración → Integraciones →'}
        </a>
      )}
      {can && <p className="mt-1 text-[12px] text-emerald-700 font-medium">Mercado Pago conectado{mp?.nickname ? ` · ${mp.nickname}` : ''}</p>}
      {d.enabled && can && (
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2 items-center anim-rise">
          <div className="inline-flex p-1 rounded-xl bg-slate-100">
            {([['percent', '% del precio'], ['fixed', 'Monto fijo']] as const).map(([m, t]) => (
              <button key={m} onClick={() => set({ mode: m, value: m === 'percent' ? 30 : 5000 })} className={`ag-press h-9 px-3 rounded-lg text-[13px] font-semibold ${d.mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{t}</button>
            ))}
          </div>
          <div className="relative">
            {d.mode === 'fixed' && <span className="absolute left-3 inset-y-0 flex items-center text-slate-400">$</span>}
            <input className={`${input} ${d.mode === 'fixed' ? 'pl-7' : 'pr-8'}`} inputMode="numeric" value={d.value || ''} onChange={(e) => set({ value: Math.min(d.mode === 'percent' ? 100 : 10_000_000, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
            {d.mode === 'percent' && <span className="absolute right-3 inset-y-0 flex items-center text-slate-400">%</span>}
          </div>
          {example && <p className="col-span-2 text-[12px] text-slate-500">Ejemplo: {example.name} ({money(example.price)}) → seña de {money(depositFor({ ...a, deposit: { ...d, enabled: true } }, example))}.</p>}
        </div>
      )}
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

const cap1 = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

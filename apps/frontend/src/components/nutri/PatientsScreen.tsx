import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserPlus, Stethoscope, CalendarClock, AlertTriangle, ChevronRight, WifiOff, BellRing, MessageCircle, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import { subscribePatients, daysBetween, ageOn, fmt, controlsToRemind, reminderText, whenLabel, markReminded, type Patient } from '../../services/nutri';
import { loadStoreConfig } from '../../services/onlineStore';
import { publicStoreUrl } from '../../utils/storeLinks';
import { subscribeClients, localNow, nextOf, waPhone, type AgendaClient } from '../../services/agenda';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader, HeaderAction } from '../mobile/ui';
import PatientForm from './PatientForm';
import { useNutriStore, WeightDelta, Pill, shortDate, initials, SEX_LABEL } from './nutriUi';

type Filter = 'ACTIVE' | 'OVERDUE' | 'ARCHIVED';

/** Sin volver hace más de 45 días y sin control a futuro: conviene escribirle. */
const OVERDUE_DAYS = 45;
const overdue = (p: Patient, today: string) =>
  !p.archived && !!p.lastVisit && !(p.nextControl && p.nextControl >= today)
  && (p.nextControl ? p.nextControl < today : daysBetween(p.lastVisit, today) > OVERDUE_DAYS);

/** Lo último que pasó con el paciente: su última consulta o, si todavía no tuvo, el alta. */
const recency = (p: Patient) => p.lastVisit || (p.createdAt?.seconds ? localNow(p.createdAt.seconds * 1000).dateKey : '');

/**
 * Inicio del consultorio de nutrición: los pacientes, con su último peso y cuándo vuelven.
 * Arriba, quienes tienen turno en la agenda y todavía no tienen ficha.
 */
export default function PatientsScreen() {
  const mobile = useOwnerMobile().active;
  const navigate = useNavigate();
  const { storeId, error, retry } = useNutriStore();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [clients, setClients] = useState<AgendaClient[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [creating, setCreating] = useState<{ name?: string; phone?: string } | null>(null);

  useEffect(() => { if (storeId) return subscribePatients(storeId, setPatients, () => setPatients([])); }, [storeId]);
  useEffect(() => { if (storeId) return subscribeClients(storeId, setClients, () => setClients([])); }, [storeId]);
  // Link de reservas para el recordatorio del control (si la página de turnos está publicada)
  const [bookingUrl, setBookingUrl] = useState<string | undefined>();
  useEffect(() => {
    if (!storeId) return;
    loadStoreConfig(storeId).then((c) => setBookingUrl(c.isPublished && c.subdomain ? publicStoreUrl(c.subdomain, 'turnos') : undefined)).catch(() => {});
  }, [storeId]);

  const today = localNow().dateKey;
  const all = patients || [];
  const active = all.filter((p) => !p.archived);
  const late = active.filter((p) => overdue(p, today));
  const seenThisMonth = active.filter((p) => p.lastVisit?.startsWith(today.slice(0, 7))).length;
  const toRemind = controlsToRemind(active, today);
  const remind = (p: Patient) => {
    const from = (() => { try { return localStorage.getItem('gd_store_name') || ''; } catch { return ''; } })();
    const text = reminderText(p, today, { from, bookingUrl });
    if (p.phone) window.open(`https://wa.me/${waPhone(p.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    else { navigator.clipboard?.writeText(text).catch(() => {}); toast.success('Sin teléfono: copiamos el mensaje'); }
    if (storeId) markReminded(storeId, p).catch(() => {});
  };

  // Turnos de la agenda sin ficha (por teléfono o nombre, la misma clave que usa la agenda)
  const withFile = new Set(all.map((p) => p.agendaKey).filter(Boolean));
  const noFile = clients.filter((c) => !withFile.has(c.key) && (nextOf(c, today) || c.visits > 0))
    .sort((a, b) => (nextOf(a, today)?.dateKey || 'z').localeCompare(nextOf(b, today)?.dateKey || 'z')).slice(0, 6);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return all
      .filter((p) => (filter === 'ARCHIVED' ? p.archived : !p.archived) && (filter !== 'OVERDUE' || overdue(p, today)))
      .filter((p) => !term || p.name.toLowerCase().includes(term) || (digits.length >= 3 && ((p.phone || '').replace(/\D/g, '').includes(digits) || (p.dni || '').includes(digits))))
      .sort((a, b) => recency(b).localeCompare(recency(a)) || a.name.localeCompare(b.name));
  }, [all, q, filter, today]);

  const subtitle = patients === null ? 'Cargando…' : `${active.length} paciente${active.length === 1 ? '' : 's'}${seenThisMonth ? ` · ${seenThisMonth} atendido${seenThisMonth === 1 ? '' : 's'} este mes` : ''}`;
  const open = (id: string) => navigate(`/pacientes/${id}`);

  const body = error ? (
    <div className="p-10 text-center">
      <WifiOff className="w-9 h-9 text-slate-300 mx-auto" />
      <p className="mt-2 text-[14px] text-slate-600">{error}</p>
      <p className="text-[12.5px] text-slate-400">Los pacientes se guardan en la nube: hace falta internet para verlos.</p>
      <button onClick={retry} className="mt-4 h-10 px-4 rounded-xl bg-rose-600 text-white text-[13.5px] font-semibold">Reintentar</button>
    </div>
  ) : (
    <div className={`${mobile ? 'px-4 py-4 pb-24' : 'p-6 max-w-5xl w-full mx-auto'} space-y-3`}>
      {toRemind.length > 0 && filter !== 'ARCHIVED' && (
        <div className="rounded-2xl bg-white border border-emerald-200 p-3.5">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900"><BellRing className="w-4 h-4 text-emerald-600" /> Para recordarles el control</p>
          <div className="mt-1.5 divide-y divide-slate-100">
            {toRemind.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-2">
                <button onClick={() => open(p.id)} className="flex-1 min-w-0 text-left">
                  <span className="block text-[13.5px] font-semibold text-slate-800 truncate">{p.name}</span>
                  <span className="block text-[12px] text-slate-500">Control {whenLabel(p.nextControl!, today)}</span>
                </button>
                <button onClick={() => remind(p)} className="h-9 px-3 rounded-full bg-[#1FAF55] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 shrink-0"><MessageCircle className="w-3.5 h-3.5" /> Recordar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {noFile.length > 0 && filter !== 'ARCHIVED' && (
        <div className="rounded-2xl bg-white border border-slate-200/80 p-3.5">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900"><CalendarClock className="w-4 h-4 text-rose-600" /> Tienen turno y todavía no tienen ficha</p>
          <div className="mt-2.5 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            {noFile.map((c) => {
              const next = nextOf(c, today);
              return (
                <button key={c.key} onClick={() => setCreating({ name: c.name, phone: c.phone })}
                  className="shrink-0 text-left rounded-xl border border-dashed border-slate-300 hover:border-rose-400 hover:bg-rose-50/40 px-3 py-2 max-w-[220px]">
                  <span className="block text-[13.5px] font-semibold text-slate-800 truncate">{c.name}</span>
                  <span className="block text-[12px] text-slate-500 truncate">{next ? `Turno ${next.dateKey === today ? 'hoy' : shortDate(next.dateKey)}` : `${c.visits} turno${c.visits === 1 ? '' : 's'}`} · <span className="text-rose-700 font-semibold">Crear ficha</span></span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 h-12 px-3.5 rounded-2xl bg-white border border-slate-200 focus-within:border-rose-500">
        <Search className="w-4.5 h-4.5 text-slate-400 shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono o DNI" className="flex-1 min-w-0 bg-transparent text-[14.5px] outline-none" />
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        <Pill active={filter === 'ACTIVE'} onClick={() => setFilter('ACTIVE')}>Activos</Pill>
        <Pill active={filter === 'OVERDUE'} onClick={() => setFilter('OVERDUE')}>Sin control{late.length ? ` (${late.length})` : ''}</Pill>
        <Pill active={filter === 'ARCHIVED'} onClick={() => setFilter('ARCHIVED')}>Archivados</Pill>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
        {patients === null ? (
          <p className="px-4 py-10 text-center text-[13.5px] text-slate-400">Cargando…</p>
        ) : shown.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Stethoscope className="w-9 h-9 text-slate-300 mx-auto" />
            <p className="mt-2 text-[13.5px] text-slate-500">
              {all.length === 0 ? 'Todavía no cargaste pacientes.' : filter === 'OVERDUE' ? 'Todos tus pacientes tienen el control al día.' : filter === 'ARCHIVED' ? 'No hay pacientes archivados.' : 'Ningún paciente coincide con la búsqueda.'}
            </p>
            {all.length === 0 && (
              <button onClick={() => setCreating({})} className="mt-4 h-10 px-4 rounded-xl bg-rose-600 text-white text-[13.5px] font-semibold inline-flex items-center gap-1.5"><UserPlus className="w-4 h-4" /> Cargar el primero</button>
            )}
          </div>
        ) : shown.map((p) => {
          const age = ageOn(p.birthDate, today);
          const late = overdue(p, today);
          return (
            <button key={p.id} onClick={() => open(p.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-50">
              <span className="w-10 h-10 rounded-full bg-rose-50 text-rose-700 flex items-center justify-center text-[14px] font-bold shrink-0">{initials(p.name)}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14.5px] font-semibold text-slate-900 truncate">{p.name}</span>
                <span className="block text-[12.5px] text-slate-500 truncate">
                  {[age != null ? `${age} años` : null, p.sex ? SEX_LABEL[p.sex] : null, p.obraSocial].filter(Boolean).join(' · ') || 'Sin datos personales'}
                </span>
                <span className="block text-[12.5px] truncate">
                  {late ? (
                    <span className="text-amber-700 font-medium inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Sin control desde {shortDate(p.lastVisit)}</span>
                  ) : p.nextControl && p.nextControl >= today ? (
                    <span className="text-emerald-700 font-medium">Próximo control {p.nextControl === today ? 'hoy' : shortDate(p.nextControl)}</span>
                  ) : p.lastVisit ? (
                    <span className="text-slate-500">Última consulta {shortDate(p.lastVisit)}</span>
                  ) : <span className="text-slate-400">Sin consultas todavía</span>}
                </span>
              </span>
              {p.lastWeight != null && (
                <span className="text-right shrink-0">
                  <span className="block text-[14px] font-bold text-slate-800 tabular-nums">{fmt(p.lastWeight)} kg</span>
                  <WeightDelta from={p.firstWeight} to={p.lastWeight} goalWeight={p.goalWeight} className="text-[12px]" />
                </span>
              )}
              {!mobile && <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />}
            </button>
          );
        })}
      </div>
      {creating && storeId && <PatientForm storeId={storeId} prefill={creating} onClose={() => setCreating(null)} onSaved={open} />}
    </div>
  );

  if (mobile) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <ScreenHeader title="Pacientes" subtitle={subtitle} action={storeId ? <HeaderAction icon={UserPlus} label="Nuevo" onClick={() => setCreating({})} /> : undefined} />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{body}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl w-full mx-auto px-6 pt-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.14em] text-rose-600">CONSULTORIO</p>
          <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">Pacientes</h1>
          <p className="text-[13px] text-slate-500">{subtitle}</p>
        </div>
        {storeId && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => navigate('/pacientes/obras-sociales')} className="h-11 px-4 rounded-xl bg-white border border-slate-200 text-slate-700 text-[14px] font-semibold inline-flex items-center gap-2"><FileSpreadsheet className="w-4.5 h-4.5" /> Obras sociales</button>
            <button onClick={() => setCreating({})} className="h-11 px-4 rounded-xl bg-rose-600 text-white text-[14px] font-semibold inline-flex items-center gap-2"><UserPlus className="w-4.5 h-4.5" /> Nuevo paciente</button>
          </div>
        )}
      </div>
      {body}
    </div>
  );
}

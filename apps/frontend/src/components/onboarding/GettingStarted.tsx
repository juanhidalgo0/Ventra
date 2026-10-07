import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, X } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useGettingStarted, useStartHidden, type StartStep } from '../../utils/gettingStarted';

const isAdmin = (role?: string) => role === 'ADMIN' || sessionStorage.getItem('admin_unlocked') === 'true';

function StepList({ steps, onGo }: { steps: StartStep[]; onGo: (s: StartStep) => void }) {
  // El primer paso pendiente va resaltado: es "lo que sigue"
  const nextId = steps.find((s) => !s.done)?.id;
  return (
    <ol className="divide-y divide-slate-100">
      {steps.map((s, i) => {
        const next = s.id === nextId;
        return (
          <li key={s.id}>
            <button onClick={() => onGo(s)} disabled={s.done}
              className={`group w-full flex items-start gap-3 py-3 text-left ${s.done ? 'cursor-default' : 'cursor-pointer'}`}>
              <span className={`mt-px w-5 h-5 rounded-full grid place-items-center shrink-0 text-[11px] font-semibold tabular-nums ${s.done ? 'bg-rose-600 text-white' : next ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-500'}`}>
                {s.done ? <Check className="w-3 h-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-[14px] ${s.done ? 'text-slate-400' : 'font-medium text-slate-900'}`}>{s.title}</span>
                {!s.done && <span className="block mt-0.5 text-[13px] text-slate-500 leading-snug">{s.hint}</span>}
                {next && <span className="inline-flex items-center gap-1 mt-2 h-8 px-3 rounded-lg bg-slate-900 group-hover:bg-slate-800 text-white text-[13px] font-medium transition-colors">Empezar <ChevronRight className="w-3.5 h-3.5" /></span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Anillo de avance: chico, sin colores fuertes */
function Ring({ percent, size = 16 }: { percent: number; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-200" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} className="text-rose-600 transition-[stroke-dashoffset] duration-500" />
    </svg>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
      <div className="h-full rounded-full bg-rose-600 transition-all duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
    </div>
  );
}

/** Tarjeta de "Primeros pasos" para el inicio (celular) y la agenda. Se va sola al completarla. */
export function GettingStartedCard({ mobile }: { mobile: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const { hidden, hide } = useStartHidden();
  const { steps, done, total, complete } = useGettingStarted(isAdmin(role) && !hidden, mobile, pathname);
  if (!steps || complete || hidden || !total) return null;
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900">Primeros pasos</p>
          <p className="text-[13px] text-slate-500 tabular-nums">{done} de {total} listos</p>
        </div>
        <button onClick={hide} className="w-8 h-8 rounded-lg hover:bg-slate-100 grid place-items-center text-slate-400" aria-label="Ocultar primeros pasos"><X className="w-4 h-4" /></button>
      </div>
      <Progress done={done} total={total} />
      <div className="mt-1"><StepList steps={steps} onGo={(s) => navigate(s.to)} /></div>
    </section>
  );
}

/** Píldora de la barra superior (PC) con el panel de pasos. */
export function GettingStartedPill() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const { hidden, hide } = useStartHidden();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { steps, done, total, percent, complete } = useGettingStarted(isAdmin(role) && !hidden, false, pathname);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!steps || complete || hidden || !total) return null;
  return (
    <div ref={ref} className="relative hidden md:block">
      <button onClick={() => setOpen((v) => !v)} title="Lo que te falta para arrancar" aria-expanded={open}
        className={`flex items-center gap-2 h-8 pl-2.5 pr-3 rounded-lg border text-slate-700 transition-colors ${open ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
        <Ring percent={percent} />
        <span className="text-[13px] font-medium whitespace-nowrap">Primeros pasos</span>
        <span className="text-[12px] text-slate-500 tabular-nums">{done}/{total}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-[80] w-[360px] bg-white rounded-xl border border-slate-200 shadow-[0_16px_40px_-12px_rgba(15,23,42,0.25)]">
          <div className="px-4 pt-4">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-[15px] font-semibold text-slate-900">Primeros pasos</p>
              <span className="text-[13px] text-slate-500 tabular-nums">{done} de {total}</span>
            </div>
            <Progress done={done} total={total} />
          </div>
          <div className="px-4 max-h-[60vh] overflow-y-auto"><StepList steps={steps} onGo={(s) => { setOpen(false); navigate(s.to); }} /></div>
          <div className="px-4 py-3 border-t border-slate-100">
            <button onClick={() => { hide(); setOpen(false); }} className="text-[13px] text-slate-500 hover:text-slate-900 transition-colors">Ocultar la lista</button>
          </div>
        </div>
      )}
    </div>
  );
}

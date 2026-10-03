import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, Rocket, X } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useGettingStarted, useStartHidden, type StartStep } from '../../utils/gettingStarted';

const isAdmin = (role?: string) => role === 'ADMIN' || sessionStorage.getItem('admin_unlocked') === 'true';

function StepList({ steps, onGo }: { steps: StartStep[]; onGo: (s: StartStep) => void }) {
  // El primer paso pendiente va resaltado: es "lo que sigue"
  const nextId = steps.find((s) => !s.done)?.id;
  return (
    <ol className="space-y-1.5">
      {steps.map((s) => (
        <li key={s.id}>
          <button onClick={() => onGo(s)} disabled={s.done}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${s.id === nextId ? 'bg-rose-50 ring-1 ring-rose-200' : s.done ? '' : 'hover:bg-slate-50'}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${s.done ? 'bg-emerald-500 text-white' : s.id === nextId ? 'border-2 border-rose-500' : 'border-2 border-slate-300'}`}>
              {s.done && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
            </span>
            <span className="flex-1 min-w-0">
              <span className={`block text-[13.5px] font-semibold ${s.done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{s.title}</span>
              {!s.done && <span className="block text-[12px] text-slate-500 truncate">{s.hint}</span>}
            </span>
            {!s.done && <ChevronRight className={`w-4 h-4 shrink-0 ${s.id === nextId ? 'text-rose-600' : 'text-slate-300'}`} />}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
      <div className="h-full rounded-full bg-rose-500 transition-all duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
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
    <section className="bg-white rounded-2xl border border-slate-200/80 p-4">
      <div className="flex items-start gap-3 mb-3">
        <span className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center shrink-0"><Rocket className="w-4.5 h-4.5 text-rose-600" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-slate-900">Primeros pasos</p>
          <p className="text-[12.5px] text-slate-500">{done} de {total} listos</p>
        </div>
        <button onClick={hide} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400" aria-label="Ocultar primeros pasos"><X className="w-4 h-4" /></button>
      </div>
      <Progress done={done} total={total} />
      <div className="mt-3"><StepList steps={steps} onGo={(s) => navigate(s.to)} /></div>
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
      <button onClick={() => setOpen((v) => !v)} title="Lo que te falta para arrancar"
        className="flex items-center gap-2.5 h-8 pl-3 pr-3 rounded-full bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-800 transition-colors">
        <Rocket className="w-3.5 h-3.5 text-orange-600" />
        <span className="text-[12px] font-semibold whitespace-nowrap">Primeros pasos {done}/{total}</span>
        <span className="w-14 h-1.5 rounded-full bg-orange-200/70 overflow-hidden">
          <span className="block h-full rounded-full bg-orange-600 transition-all" style={{ width: `${percent}%` }} />
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-[80] w-[340px] bg-white rounded-2xl border border-slate-200 shadow-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[15px] font-bold text-slate-900">Primeros pasos</p>
            <span className="text-[12px] font-semibold text-slate-500">{done} de {total}</span>
          </div>
          <Progress done={done} total={total} />
          <div className="mt-3 max-h-[60vh] overflow-y-auto"><StepList steps={steps} onGo={(s) => { setOpen(false); navigate(s.to); }} /></div>
          <button onClick={() => { hide(); setOpen(false); }} className="mt-3 w-full text-center text-[12.5px] font-medium text-slate-400 hover:text-slate-600">No mostrar más</button>
        </div>
      )}
    </div>
  );
}

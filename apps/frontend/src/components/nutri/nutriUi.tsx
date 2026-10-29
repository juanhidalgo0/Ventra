import { useEffect, useState } from 'react';
import { nutriStoreId, fmt, type Patient } from '../../services/nutri';

/** Piezas compartidas por las pantallas del consultorio (pacientes, ficha y consultas). */

/** Id del consultorio en la nube. error = sin conexión con la cuenta. */
export function useNutriStore() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    nutriStoreId().then((id) => alive && setStoreId(id)).catch((e) => alive && setError(e?.message || 'No pudimos conectar con tu cuenta de Ventra.'));
    return () => { alive = false; };
  }, [attempt]);
  return { storeId, error, retry: () => setAttempt((n) => n + 1) };
}

export const TONE: Record<'ok' | 'warn' | 'bad' | 'info', string> = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
};

export const SEX_LABEL = { F: 'Mujer', M: 'Varón' } as const;

export const shortDate = (k?: string) => { if (!k) return ''; const [y, m, d] = k.split('-'); return `${+d}/${+m}/${y.slice(2)}`; };

export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

/** Diferencia de peso con signo y color: bajar es verde salvo que el objetivo sea subir. */
export function WeightDelta({ from, to, goalWeight, className = '' }: { from?: number; to?: number; goalWeight?: number; className?: string }) {
  if (from == null || to == null || from === to) return null;
  const diff = Math.round((to - from) * 10) / 10;
  const wantsUp = goalWeight != null && goalWeight > from;
  const good = wantsUp ? diff > 0 : diff < 0;
  return <span className={`tabular-nums font-semibold ${good ? 'text-emerald-600' : 'text-amber-600'} ${className}`}>{diff > 0 ? '+' : '−'}{fmt(Math.abs(diff))} kg</span>;
}

export function Stat({ label, value, unit, hint, chip }: { label: string; value: string; unit?: string; hint?: React.ReactNode; chip?: { label: string; tone: keyof typeof TONE } | null }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 px-4 py-3.5 min-w-0">
      <p className="text-[12px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-[22px] font-bold text-slate-900 tabular-nums leading-tight truncate">{value}{unit && value !== '—' && <span className="text-[13px] font-semibold text-slate-400 ml-1">{unit}</span>}</p>
      {hint && <p className="text-[12px] text-slate-500 mt-0.5 truncate">{hint}</p>}
      {chip && <span className={`inline-block mt-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ${TONE[chip.tone]}`}>{chip.label}</span>}
    </div>
  );
}

/** Lo que conviene tener a la vista en cada consulta: alergias, intolerancias, patologías y medicación. */
export function alertsOf(p: Patient): { label: string; text: string }[] {
  const h = p.history || {};
  return ([['Alergias', h.allergies], ['Intolerancias', h.intolerances], ['Patologías', h.pathologies], ['Medicación', h.medication]] as const)
    .filter(([, v]) => v && v.trim())
    .map(([label, text]) => ({ label, text: text!.trim() }));
}

export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`h-9 px-3.5 rounded-full text-[13px] font-semibold border shrink-0 ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>{children}</button>
  );
}

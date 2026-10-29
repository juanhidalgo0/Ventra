import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingDown } from 'lucide-react';
import { fmt, type EvolutionPoint } from '../../services/nutri';
import { Pill, shortDate } from './nutriUi';

// Verde de la marca (paso 500, el 600 queda grisáceo como línea) y violeta para la segunda serie:
// validados con el script de paleta (daltonismo y contraste sobre blanco).
const C1 = '#17925F';
const C2 = '#6D5BD0';

type Metric = 'weight' | 'bmi' | 'waistHip' | 'fatPct' | 'sumFolds';
const METRICS: { id: Metric; label: string; unit: string; series: { key: keyof EvolutionPoint; name: string; color: string }[] }[] = [
  { id: 'weight', label: 'Peso', unit: 'kg', series: [{ key: 'weight', name: 'Peso', color: C1 }] },
  { id: 'bmi', label: 'IMC', unit: '', series: [{ key: 'bmi', name: 'IMC', color: C1 }] },
  { id: 'waistHip', label: 'Cintura y cadera', unit: 'cm', series: [{ key: 'waist', name: 'Cintura', color: C1 }, { key: 'hip', name: 'Cadera', color: C2 }] },
  { id: 'fatPct', label: '% de grasa', unit: '%', series: [{ key: 'fatPct', name: '% de grasa', color: C1 }] },
  { id: 'sumFolds', label: 'Σ pliegues', unit: 'mm', series: [{ key: 'sumFolds', name: 'Suma de 4 pliegues', color: C1 }] },
];

/** Marcas redondas del eje (cada 1, 2, 5, 10…), sin puntos pegados al borde. */
function niceTicks(min: number, max: number): number[] {
  const span = Math.max(max - min, 1);
  const step = [0.5, 1, 2, 5, 10, 20, 50].find((s) => span / s <= 4) ?? 100;
  let lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  // Que ningún punto quede pegado al borde
  if (min - lo < step * 0.15) lo -= step;
  if (hi - max < step * 0.15) hi += step;
  const out: number[] = [];
  for (let v = Math.max(0, lo); v <= hi + 1e-9; v += step) out.push(Math.round(v * 10) / 10);
  return out;
}

/**
 * Evolución del paciente consulta a consulta. Un gráfico por medida (nunca dos escalas en el
 * mismo): cintura y cadera van juntas porque las dos son centímetros.
 */
export default function EvolutionCharts({ points, goalWeight, compact = false }: { points: EvolutionPoint[]; goalWeight?: number; compact?: boolean }) {
  const available = METRICS.filter((m) => m.series.some((s) => points.filter((p) => p[s.key] != null).length >= 1));
  const [picked, setPicked] = useState<Metric>('weight');
  const metric = available.find((m) => m.id === picked) || available[0];

  const data = useMemo(() => (metric ? points.filter((p) => metric.series.some((s) => p[s.key] != null)) : []), [points, metric]);

  if (!metric) {
    return <p className="py-8 text-center text-[13px] text-slate-400">Cuando cargues mediciones en las consultas, acá ves cómo evolucionan.</p>;
  }

  const showGoal = metric.id === 'weight' && goalWeight != null;
  const values = data.flatMap((p) => metric.series.map((s) => p[s.key] as number | undefined)).filter((v): v is number => v != null);
  if (showGoal) values.push(goalWeight!);
  const min = Math.min(...values), max = Math.max(...values);
  const ticks = niceTicks(min, max);
  const first = data[0], last = data[data.length - 1];
  const main = metric.series[0].key;
  const change = data.length >= 2 && first[main] != null && last[main] != null ? (last[main] as number) - (first[main] as number) : null;

  return (
    <div>
      {!compact && available.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 mb-3">
          {available.map((m) => <Pill key={m.id} active={m.id === metric.id} onClick={() => setPicked(m.id)}>{m.label}</Pill>)}
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className="text-[13px] font-bold text-slate-900">{metric.label}{metric.unit && <span className="font-normal text-slate-400"> · {metric.unit}</span>}</p>
        {metric.series.length > 1 ? (
          <span className="flex items-center gap-3 text-[12px] text-slate-600">
            {metric.series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="w-3 h-[3px] rounded-full" style={{ background: s.color }} />{s.name}</span>)}
          </span>
        ) : change != null && (
          <span className="text-[12px] text-slate-500 inline-flex items-center gap-1">
            {change < 0 && <TrendingDown className="w-3.5 h-3.5" />}
            {change > 0 ? '+' : change < 0 ? '−' : ''}{fmt(Math.abs(change))}{metric.unit ? ` ${metric.unit}` : ''} desde {shortDate(first.dateKey)}
          </span>
        )}
      </div>
      {data.length < 2 ? (
        <p className="py-6 text-center text-[13px] text-slate-400">
          Hay una sola medición ({fmt(data[0]?.[main] as number)}{metric.unit ? ` ${metric.unit}` : ''} el {shortDate(data[0]?.dateKey)}). Con la próxima consulta ves la evolución.
        </p>
      ) : (
        <div className={compact ? 'h-44' : 'h-60'}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#EEF2F6" vertical={false} />
              <XAxis dataKey="dateKey" tickFormatter={(k) => shortDate(k).slice(0, -3)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={{ stroke: '#E2E8F0' }} tickLine={false} minTickGap={16} />
              <YAxis domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => fmt(v)} />
              <Tooltip
                cursor={{ stroke: '#94A3B8', strokeWidth: 1 }}
                labelFormatter={(k) => shortDate(String(k))}
                formatter={(v: any, name: any) => [`${fmt(Number(v))}${metric.unit ? ` ${metric.unit}` : ''}`, name]}
                contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12.5, boxShadow: '0 8px 24px -12px rgba(15,23,42,.25)' }}
              />
              {showGoal && <ReferenceLine y={goalWeight} stroke="#94A3B8" strokeDasharray="4 4" label={{ value: `Objetivo ${fmt(goalWeight!)}`, position: 'insideTopRight', fill: '#64748B', fontSize: 11 }} />}
              {metric.series.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} connectNulls
                  dot={{ r: 4, fill: s.color, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

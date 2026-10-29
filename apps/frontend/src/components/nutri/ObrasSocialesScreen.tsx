import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, FileSpreadsheet } from 'lucide-react';
import { subscribePatients, fetchConsultasBetween, coverageLabel, type Patient, type Consulta } from '../../services/nutri';
import { localNow } from '../../services/agenda';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader } from '../mobile/ui';
import { useNutriStore, shortDate } from './nutriUi';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthRange = (ym: string) => { const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]; };
const shiftMonth = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

type Row = { patient: Patient; consulta: Consulta };

/** Planilla CSV (separada por ; para que Excel en español la abra en columnas) */
function downloadCsv(name: string, rows: Row[]) {
  const cell = (v: string | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Fecha', 'Paciente', 'DNI', 'Obra social', 'N° de afiliado', 'Plan', 'Primera consulta'].map(cell).join(';')];
  for (const { patient: p, consulta: c } of rows) {
    const cov = c.coverage?.type === 'obra_social' ? c.coverage : null;
    lines.push([shortDate(c.dateKey), p.name, p.dni, cov?.name, cov?.number, cov?.plan, c.first ? 'Sí' : 'No'].map(cell).join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Consultas del mes por obra social, para presentarlas (y cuántas fueron particulares o de packs). */
export default function ObrasSocialesScreen() {
  const mobile = useOwnerMobile().active;
  const navigate = useNavigate();
  const { storeId, error } = useNutriStore();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [month, setMonth] = useState(localNow().dateKey.slice(0, 7));
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { if (storeId) return subscribePatients(storeId, setPatients, () => setPatients([])); }, [storeId]);
  useEffect(() => {
    if (!storeId || !patients) return;
    let alive = true;
    setRows(null);
    const [from, to] = monthRange(month);
    fetchConsultasBetween(storeId, patients, from, to).then((r) => alive && setRows(r)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [storeId, patients, month]);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows || []) if (r.consulta.coverage?.type === 'obra_social') {
      const k = r.consulta.coverage.name;
      map.set(k, [...(map.get(k) || []), r]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows]);
  const counts = useMemo(() => {
    const c = { particular: 0, pack: 0, obra_social: 0 };
    for (const r of rows || []) c[r.consulta.coverage?.type || 'particular']++;
    return c;
  }, [rows]);
  const [y, m] = month.split('-').map(Number);
  const title = `${MONTHS[m - 1]} ${y}`;
  const thisMonth = localNow().dateKey.slice(0, 7);

  const body = (
    <div className={`${mobile ? 'px-4 py-4 pb-24' : 'p-6 max-w-4xl w-full mx-auto'} space-y-3`}>
      <div className="flex items-center gap-2">
        <button onClick={() => setMonth((x) => shiftMonth(x, -1))} className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center" aria-label="Mes anterior"><ChevronLeft className="w-4 h-4" /></button>
        <p className="flex-1 text-center text-[15px] font-bold text-slate-900 capitalize">{title}</p>
        <button disabled={month >= thisMonth} onClick={() => setMonth((x) => shiftMonth(x, 1))} className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center disabled:opacity-40" aria-label="Mes siguiente"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {([['Obra social', counts.obra_social], ['Particulares', counts.particular], ['De packs', counts.pack]] as const).map(([t, n]) => (
          <div key={t} className="rounded-2xl bg-white border border-slate-200/80 px-3 py-2.5">
            <p className="text-[12px] text-slate-500">{t}</p>
            <p className="text-[20px] font-bold text-slate-900 tabular-nums">{rows ? n : '—'}</p>
          </div>
        ))}
      </div>
      {error && <p className="text-center text-[13.5px] text-slate-500 py-6">{error}</p>}
      {rows === null && !error && <p className="text-center text-[13.5px] text-slate-400 py-10">Buscando las consultas…</p>}
      {rows && !groups.length && (
        <div className="rounded-2xl bg-white border border-slate-200/80 p-8 text-center">
          <FileSpreadsheet className="w-9 h-9 text-slate-300 mx-auto" />
          <p className="mt-2 text-[13.5px] text-slate-500">En {title} no hubo consultas por obra social. Se cuentan las que se cargan con la obra social del paciente.</p>
        </div>
      )}
      {groups.map(([name, list]) => (
        <section key={name} className="rounded-2xl bg-white border border-slate-200/80 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <p className="flex-1 text-[14.5px] font-bold text-slate-900">{name} <span className="font-normal text-slate-500">· {list.length} consulta{list.length === 1 ? '' : 's'}</span></p>
            <button onClick={() => downloadCsv(`Consultas_${name.replace(/\W+/g, '_')}_${month}.csv`, list)} className="h-9 px-3 rounded-full bg-slate-100 text-slate-700 text-[12.5px] font-semibold inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Planilla</button>
          </div>
          <div className="divide-y divide-slate-100">
            {list.map(({ patient: p, consulta: c }) => {
              const cov = c.coverage?.type === 'obra_social' ? c.coverage : null;
              return (
                <button key={c.id} onClick={() => navigate(`/pacientes/${p.id}`)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50">
                  <span className="w-12 text-[13px] font-semibold text-slate-700 tabular-nums">{shortDate(c.dateKey)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-semibold text-slate-900 truncate">{p.name}</span>
                    <span className="block text-[12px] text-slate-500 truncate">{[cov?.number && `Afiliado ${cov.number}`, cov?.plan && `Plan ${cov.plan}`, p.dni && `DNI ${p.dni}`].filter(Boolean).join(' · ') || coverageLabel(c.coverage)}</span>
                  </span>
                  {c.first && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">Primera</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {groups.length > 1 && rows && (
        <button onClick={() => downloadCsv(`Consultas_obras_sociales_${month}.csv`, groups.flatMap(([, l]) => l))} className="w-full h-11 rounded-2xl bg-white border border-slate-200 text-slate-700 text-[13.5px] font-semibold inline-flex items-center justify-center gap-1.5"><Download className="w-4 h-4" /> Planilla con todas</button>
      )}
    </div>
  );

  if (mobile) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <ScreenHeader back title="Obras sociales" subtitle="Consultas del mes para presentar" />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{body}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
      <div className="max-w-4xl w-full mx-auto px-6 pt-5">
        <button onClick={() => navigate('/pacientes')} className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="w-4 h-4" /> Pacientes</button>
        <h1 className="mt-1 text-[24px] font-bold text-slate-900 tracking-tight">Obras sociales</h1>
        <p className="text-[13px] text-slate-500">Las consultas del mes por obra social, para presentarlas. Bajá la planilla y abrila en Excel.</p>
      </div>
      {body}
    </div>
  );
}

import { useRef } from 'react';
import { Store, Image as ImageIcon } from 'lucide-react';
import { dayRanges, withRanges, type DayHours, type StoreConfig } from '../../services/onlineStore';

/**
 * Piezas de la apariencia de la página pública (ventra_stores/{id}): las usan Tienda online →
 * Apariencia y Agenda → Configurar → Mi página. Es la misma página, así que se editan igual.
 */

export function Switch({ on, small }: { on: boolean; small?: boolean }) {
  return (
    <span className={`keep-style relative inline-flex shrink-0 rounded-full p-0.5 transition-colors ${small ? 'h-5 w-9' : 'h-6 w-11'}`} style={{ backgroundColor: on ? '#10b981' : '#cbd5e1' }}>
      <span className={`keep-style block rounded-full bg-white shadow transition-transform ${small ? 'h-4 w-4' : 'h-5 w-5'} ${on ? (small ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0'}`} />
    </span>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-10 rounded-lg cursor-pointer border border-slate-300 shrink-0" />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-slate-800">{label}</span>
        <span className="block text-[12px] text-slate-500 font-mono uppercase">{value}</span>
      </span>
    </label>
  );
}

export function ImagePick({ label, hint, src, contain, onPick, onClear }: { label: string; hint: string; src?: string; contain?: boolean; onPick: (f: File) => void; onClear: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-slate-800">{label}</span>
        {src && <button type="button" onClick={onClear} className="text-[12px] font-semibold text-slate-400 hover:text-rose-600">Quitar</button>}
      </div>
      <p className="text-[12px] text-slate-500">{hint}</p>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
      <button type="button" onClick={() => ref.current?.click()}
        className="mt-2 w-full h-28 rounded-xl bg-slate-50 border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden hover:border-rose-400 hover:bg-white transition-colors group">
        {src ? (
          <img src={src} alt="" className={contain ? 'max-h-full max-w-full object-contain p-2' : 'w-full h-full object-cover'} />
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-slate-400 group-hover:text-slate-600">
            <ImageIcon className="w-5 h-5" />
            <span className="text-[12px] font-semibold">Subir {label.toLowerCase()}</span>
          </span>
        )}
      </button>
    </div>
  );
}

/** Portada, logo, nombre y el botón principal, como los ve el cliente. */
export function StorePreview({ config, accent, subtitle, cta = 'Ver carrito', note = 'Se actualiza mientras editás. Tus clientes lo ven recién al publicar.' }: { config: Pick<StoreConfig, 'announcement' | 'bannerUrl' | 'logoUrl' | 'businessName' | 'secondaryColor'>; accent: string; subtitle: string; cta?: string; note?: string }) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-slate-500 mb-2">Vista previa</p>
      <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm bg-white">
        {config.announcement && <div className="px-3 py-1.5 text-center text-[11.5px] font-semibold text-white truncate" style={{ backgroundColor: accent }}>{config.announcement}</div>}
        <div className="aspect-[3/1] bg-slate-100 overflow-hidden">
          {config.bannerUrl ? <img src={config.bannerUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${accent}, ${config.secondaryColor || accent})` }} />}
        </div>
        <div className="p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl border-2 border-white shadow-md -mt-10 overflow-hidden shrink-0 flex items-center justify-center" style={{ backgroundColor: config.logoUrl ? '#fff' : accent }}>
            {config.logoUrl ? <img src={config.logoUrl} alt="" className="w-full h-full object-cover" /> : <Store className="w-5 h-5 text-white" />}
          </div>
          <div className="min-w-0">
            <p className="text-[14.5px] font-bold text-slate-900 truncate">{config.businessName || 'Mi negocio'}</p>
            <p className="text-[12px] text-slate-500 truncate">{subtitle}</p>
          </div>
          <span className="ml-auto text-white text-[11.5px] font-bold px-3 py-2 rounded-lg shrink-0" style={{ backgroundColor: accent }}>{cta}</span>
        </div>
      </div>
      <p className="text-[12px] text-slate-500 mt-2">{note}</p>
    </div>
  );
}

const WEEK = [
  { idx: 1, label: 'Lunes' }, { idx: 2, label: 'Martes' }, { idx: 3, label: 'Miércoles' }, { idx: 4, label: 'Jueves' },
  { idx: 5, label: 'Viernes' }, { idx: 6, label: 'Sábado' }, { idx: 0, label: 'Domingo' },
];

/** Horarios del local (los que la página muestra con "Abierto ahora"). Cada día puede tener hasta 3 turnos. */
export function StoreHoursEditor({ hours, onChange }: { hours?: DayHours[]; onChange: (h: DayHours[]) => void }) {
  const allHours = hours || [0, 1, 2, 3, 4, 5, 6].map(() => ({ open: false, from: '09:00', to: '20:00' }));
  return (
    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
      {WEEK.map(({ idx, label }) => {
        const h = allHours[idx] || { open: false, from: '09:00', to: '20:00' };
        const ranges = dayRanges(h);
        const saveDay = (next: typeof h) => { const list = [...allHours]; list[idx] = next; onChange(list); };
        const setRange = (i: number, patch: Partial<{ from: string; to: string }>) =>
          saveDay(withRanges(h, ranges.map((r, j) => (j === i ? { ...r, ...patch } : r))));
        return (
          <div key={idx} className="flex flex-wrap sm:flex-nowrap items-start gap-x-4 gap-y-1.5 px-4 py-3">
            <button type="button" onClick={() => saveDay({ ...h, open: !h.open })} className="flex items-center gap-3 w-36 h-9 shrink-0">
              <Switch on={h.open} small />
              <span className={`text-[14px] font-semibold ${h.open ? 'text-slate-800' : 'text-slate-400'}`}>{label}</span>
            </button>
            {h.open ? (
              <div className="flex-1 flex flex-col gap-1.5">
                {ranges.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[13px] text-slate-500">
                    <input type="time" value={r.from} onChange={(e) => setRange(i, { from: e.target.value })} className="h-9 border border-slate-300 rounded-lg px-2 text-slate-800" />
                    a
                    <input type="time" value={r.to} onChange={(e) => setRange(i, { to: e.target.value })} className="h-9 border border-slate-300 rounded-lg px-2 text-slate-800" />
                    {ranges.length > 1 && (
                      <button type="button" onClick={() => saveDay(withRanges(h, ranges.filter((_, j) => j !== i)))} className="text-[12.5px] font-semibold text-slate-400 hover:text-rose-600 px-1.5">Quitar</button>
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-4">
                  {ranges.length < 3 && (
                    <button type="button" onClick={() => {
                      const last = ranges[ranges.length - 1];
                      saveDay(withRanges(h, [...ranges, { from: last && last.to < '17:00' ? '17:00' : '20:00', to: last && last.to < '17:00' ? '21:00' : '23:00' }]));
                    }} className="text-[12.5px] font-semibold text-rose-700 hover:underline">+ Agregar otro horario</button>
                  )}
                  {idx === 1 && (
                    <button type="button" onClick={() => onChange(allHours.map((d, j) => (j === 0 ? d : { ...h, ranges: [...ranges] })))} className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">
                      Copiar a lunes–sábado
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <span className="text-[13px] text-slate-400 h-9 flex items-center">Cerrado</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Weight, ScanLine, Wand2, Download, PackagePlus, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import { setStoreSetting, STORE_SETTINGS_EVENT } from '../../services/storeSettings';
import { useBusinessStore } from '../../stores/businessStore';
import { money, parseAmount } from '../mobile/ui';
import {
  readScaleFormat, cleanScaleFormat, parseScaleLabel, detectScaleFormat, describeScaleFormat, buildPluIndex, scaleLine, DEFAULT_SCALE_FORMAT,
  type ScaleFormat,
} from '../../utils/scaleLabel';
import CutsLoader from '../carniceria/CutsLoader';
import { loadCatalog, pluOf } from '../carniceria/cuts';

/**
 * Configuración → Balanza (carnicería, fiambrería): cómo viene armado el código de las etiquetas.
 * Se prueba pasando una etiqueta por el lector; si no la lee bien, se detecta el formato solo con
 * esa misma etiqueta y lo que tiene impreso. También baja la lista de códigos y precios para
 * cargarla en la balanza.
 */
export default function ScaleSettingsCard() {
  const rubros = useBusinessStore((s) => s.profiles);
  const [format, setFormat] = useState<ScaleFormat>(readScaleFormat);
  const [products, setProducts] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [plu, setPlu] = useState('');
  const [kind, setKind] = useState<'price' | 'weight'>('price');
  const [value, setValue] = useState('');
  const [found, setFound] = useState<ScaleFormat | null | undefined>(undefined);
  const [manual, setManual] = useState(false);
  const [showLoader, setShowLoader] = useState(false);

  const reload = () => loadCatalog().then(setProducts).catch(() => {});
  useEffect(() => { reload(); }, []);
  // Otro equipo cambió el formato
  useEffect(() => {
    const on = (e: Event) => { if (((e as CustomEvent<string[]>).detail || []).includes('scale_format')) setFormat(readScaleFormat()); };
    window.addEventListener(STORE_SETTINGS_EVENT, on);
    return () => window.removeEventListener(STORE_SETTINGS_EVENT, on);
  }, []);

  const pluIndex = useMemo(() => buildPluIndex(products), [products]);
  const withPlu = useMemo(() => products.filter((p) => pluOf(p) != null), [products]);
  const clean = code.replace(/\D/g, '');
  const read = clean.length === 13 ? parseScaleLabel(clean, format) : null;
  const product = read ? pluIndex.get(read.plu) : null;
  const line = read && product ? scaleLine(Number(product.salePrice) || 0, read) : null;

  const save = (f: ScaleFormat) => {
    const c = cleanScaleFormat(f);
    setFormat(c);
    setStoreSetting('scale_format', JSON.stringify(c));
  };

  const detect = () => {
    const v = kind === 'weight' ? { kg: parseFloat(value.replace(',', '.')) } : { amount: parseAmount(value) };
    const [best] = detectScaleFormat(clean, plu, v);
    setFound(best || null);
  };

  const downloadList = () => {
    const rows = [...withPlu].sort((a, b) => (pluOf(a) || 0) - (pluOf(b) || 0));
    const csv = ['PLU;Nombre;Precio;Unidad', ...rows.map((p) => `${pluOf(p)};${String(p.name || '').replace(/;/g, ',')};${Number(p.salePrice || 0).toFixed(2).replace('.', ',')};${p.unit === 'KG' ? 'kg' : 'unidad'}`)].join('\r\n');
    const href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = 'codigos-para-la-balanza.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  const num = (k: keyof ScaleFormat, label: string, min: number, max: number) => (
    <label className="block">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      <input type="number" min={min} max={max} value={format[k] as number}
        onChange={(e) => {
          const next = { ...format, [k]: Number(e.target.value) };
          // Código e importe tienen que entrar en las 12 cifras antes del verificador
          if (next.pluStart + next.pluLen <= 12 - next.valueLen) save(next);
          else toast.error('Así no entra: el código y el importe se pasan de las 12 cifras. Achicá primero el otro.', { id: 'scale-fit' });
        }}
        className="mt-0.5 w-full h-8 px-2 rounded-lg border border-slate-300 text-[13px] tabular-nums" />
    </label>
  );

  return (
    <div className="card p-6 space-y-4">
      <h3 className="text-[15px] font-bold text-slate-900 tracking-tight flex items-center gap-2.5 pb-3 border-b border-slate-100">
        <Weight className="w-4.5 h-4.5 text-emerald-500" /> Balanza y etiquetas
      </h3>
      <p className="text-[12px] text-slate-600 leading-snug">
        La caja lee el código que imprime la balanza: busca el producto por su <b>código de balanza</b> y lo suma con los kilos y el importe de la etiqueta.
        Tenés <b>{withPlu.length}</b> producto{withPlu.length === 1 ? '' : 's'} con código de balanza.
      </p>

      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11.5px] text-slate-600">
        <span className="font-bold text-slate-700">Formato: </span>{describeScaleFormat(format)}
      </div>

      {/* Probar con una etiqueta */}
      <div className="space-y-2">
        <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider">Probar con una etiqueta</label>
        <div className="relative">
          <ScanLine className="absolute left-3 inset-y-0 my-auto w-4 h-4 text-slate-400" />
          <input value={code} onChange={(e) => { setCode(e.target.value); setFound(undefined); }} inputMode="numeric"
            placeholder="Pasá una etiqueta de la balanza por el lector"
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-300 text-[13px] tabular-nums outline-none focus:border-emerald-500" />
        </div>
        {clean.length === 13 && (
          read && product ? (
            <p className="text-[12.5px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 flex gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
              <span>Código {read.plu}: <b>{product.name}</b> · {read.kind === 'weight' ? `${read.kg!.toLocaleString('es-AR')} kg` : money(read.amount!)}
                {line && read.kind === 'price' && ` → ${line.qty.toLocaleString('es-AR')} kg`}. Si es lo que dice la etiqueta, la balanza ya está lista.</span>
            </p>
          ) : (
            <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{read ? `Leída como código ${read.plu} (${read.kind === 'weight' ? `${read.kg} kg` : money(read.amount!)}), pero ningún producto tiene ese código de balanza.` : 'Con este formato no se lee como etiqueta de balanza.'} Contanos qué dice la etiqueta y lo ajustamos solo:</span>
            </p>
          )
        )}
        {clean.length === 13 && !(read && product) && (
          <div className="grid grid-cols-2 sm:grid-cols-[1fr,auto,1fr,auto] gap-2 items-end">
            <label className="block">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Código del producto</span>
              <input value={plu} onChange={(e) => setPlu(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="PLU" className="mt-0.5 w-full h-9 px-2 rounded-lg border border-slate-300 text-[13px] tabular-nums" />
            </label>
            <div className="flex rounded-lg border border-slate-300 overflow-hidden h-9 text-[12px] font-semibold">
              {(['price', 'weight'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)} className={`px-2.5 ${kind === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}>{k === 'price' ? 'Importe' : 'Peso'}</button>
              ))}
            </div>
            <label className="block">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{kind === 'price' ? 'Importe impreso ($)' : 'Peso impreso (kg)'}</span>
              <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" className="mt-0.5 w-full h-9 px-2 rounded-lg border border-slate-300 text-[13px] tabular-nums" />
            </label>
            <button type="button" onClick={detect} disabled={!plu || !value}
              className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-[12.5px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-40">
              <Wand2 className="w-3.5 h-3.5" /> Detectar
            </button>
          </div>
        )}
        {found === null && <p className="text-[12px] text-red-700">No encontramos ese código y ese {kind === 'price' ? 'importe' : 'peso'} adentro de la etiqueta. Revisá los números (o ajustalo a mano abajo).</p>}
        {found && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 space-y-2">
            <p className="text-[12px] text-emerald-900">{describeScaleFormat(found)}</p>
            <button type="button" onClick={() => { save(found); setFound(undefined); toast.success('Listo: la caja ya lee las etiquetas de tu balanza'); }}
              className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[12.5px] font-bold">Usar este formato</button>
          </div>
        )}
      </div>

      {/* A mano */}
      <div>
        <button type="button" onClick={() => setManual((v) => !v)} className="text-[11.5px] font-semibold text-slate-600 flex items-center gap-1 hover:text-slate-900">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${manual ? 'rotate-180' : ''}`} /> Ajustar a mano
        </button>
        {manual && (
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Empieza con</span>
              <input value={format.prefix} onChange={(e) => save({ ...format, prefix: e.target.value.replace(/\D/g, '').slice(0, 3) || '2' })} className="mt-0.5 w-full h-8 px-2 rounded-lg border border-slate-300 text-[13px] tabular-nums" />
            </label>
            {num('pluStart', 'El código arranca en la cifra (desde 0)', 1, 4)}
            {num('pluLen', 'Cifras del código', 1, 7)}
            <label className="block">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Trae</span>
              <select value={format.kind} onChange={(e) => save({ ...format, kind: e.target.value as ScaleFormat['kind'] })} className="mt-0.5 w-full h-8 px-2 rounded-lg border border-slate-300 text-[13px]">
                <option value="price">El importe</option>
                <option value="weight">El peso (gramos)</option>
              </select>
            </label>
            {num('valueLen', 'Cifras del importe o peso', 3, 7)}
            {format.kind === 'price' && num('decimals', 'Decimales del importe', 0, 2)}
            <button type="button" onClick={() => save({ ...DEFAULT_SCALE_FORMAT })} className="col-span-2 sm:col-span-3 justify-self-start text-[11.5px] font-semibold text-slate-500 hover:underline">Volver al de fábrica</button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => setShowLoader(true)} className="h-9 px-3 rounded-xl border border-slate-300 hover:bg-slate-50 text-[12.5px] font-semibold text-slate-700 flex items-center gap-1.5">
          <PackagePlus className="w-4 h-4 text-emerald-600" /> Cargar cortes, fiambres y quesos
        </button>
        <button type="button" onClick={downloadList} disabled={!withPlu.length} className="h-9 px-3 rounded-xl border border-slate-300 hover:bg-slate-50 text-[12.5px] font-semibold text-slate-700 flex items-center gap-1.5 disabled:opacity-40"
          title="Planilla con código, nombre y precio para pasar a la balanza">
          <Download className="w-4 h-4 text-emerald-600" /> Lista para la balanza
        </button>
      </div>

      {showLoader && <CutsLoader rubros={rubros} onClose={() => setShowLoader(false)} onDone={reload} />}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Loader2, Check } from 'lucide-react';
import api from '../../services/api';
import { parseAmount } from '../mobile/ui';
import { PROFILE_LABELS, type BusinessProfile } from '../../stores/businessStore';
import { CUT_PRESETS, loadCatalog, mergeIntoPosCatalog, nextPlu, normName } from './cuts';

interface Row { name: string; category: string; color: string; on: boolean; price: string; exists: boolean }

/**
 * Cargar de una los cortes de la carnicería (o los fiambres y quesos): se marcan los que vende,
 * se les pone el precio por kilo y quedan creados por kilo, con su código de balanza correlativo.
 * Los que ya tiene (mismo nombre) no se repiten.
 */
export default function CutsLoader({ rubros, onClose, onDone }: { rubros: BusinessProfile[]; onClose: () => void; onDone?: () => void }) {
  const available = rubros.filter((r) => CUT_PRESETS[r]);
  const [rubro, setRubro] = useState<BusinessProfile>(available[0] || 'CARNICERIA');
  const [rows, setRows] = useState<Row[]>([]);
  const [startPlu, setStartPlu] = useState(10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    loadCatalog().then((products) => {
      if (!alive) return;
      const have = new Set(products.map((p: any) => normName(p.name || '')));
      setStartPlu(nextPlu(products));
      setRows((CUT_PRESETS[rubro] || []).flatMap((g) => g.items.map((name) => {
        const exists = have.has(normName(name));
        return { name, category: g.category, color: g.color, on: !exists, price: '', exists };
      })));
    }).catch(() => toast.error('No se pudieron leer tus productos'));
    return () => { alive = false; };
  }, [rubro]);

  const groups = useMemo(() => {
    const out: { category: string; rows: { row: Row; i: number }[] }[] = [];
    rows.forEach((row, i) => {
      let g = out.find((x) => x.category === row.category);
      if (!g) out.push((g = { category: row.category, rows: [] }));
      g.rows.push({ row, i });
    });
    return out;
  }, [rows]);

  const chosen = rows.filter((r) => r.on && !r.exists);
  const withoutPrice = chosen.filter((r) => !(parseAmount(r.price) > 0)).length;
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const setGroup = (category: string, on: boolean) => setRows((rs) => rs.map((r) => (r.category === category && !r.exists ? { ...r, on } : r)));

  const save = async () => {
    if (!chosen.length) return;
    setSaving(true);
    const since = new Date(Date.now() - 2000).toISOString();
    try {
      // Categorías: las que ya existen se usan, las que faltan se crean
      const { data: cats } = await api.get('/categories', { silent: true } as any);
      const catId = new Map<string, string>((cats || []).map((c: any) => [normName(c.name || ''), c.id]));
      for (const g of new Map(chosen.map((r) => [r.category, r.color]))) {
        if (!catId.has(normName(g[0]))) {
          const { data } = await api.post('/categories', { name: g[0], color: g[1] });
          catId.set(normName(g[0]), data.id);
        }
      }
      let plu = startPlu;
      let created = 0;
      for (const r of chosen) {
        // Si el código está ocupado (lo cargaron recién en otro equipo), sigue con el próximo
        for (let tries = 0; tries < 5; tries++) {
          try {
            await api.post('/products', {
              name: r.name.toUpperCase(), sku: String(plu), unit: 'KG', presentationType: 'UNIT',
              salePrice: parseAmount(r.price) || 0, costPrice: 0, stock: 0, minStock: 0,
              categoryId: catId.get(normName(r.category)) || null,
              trackExpiry: rubro === 'FIAMBRERIA' ? true : undefined,
            }, { silent: true } as any);
            created++;
            plu++;
            break;
          } catch (err: any) {
            if (err?.response?.status === 409 || /sku|unique/i.test(String(err?.response?.data?.message || ''))) { plu++; continue; }
            throw err;
          }
        }
      }
      await mergeIntoPosCatalog(since);
      toast.success(`Listo: ${created} producto${created === 1 ? '' : 's'} por kilo, con código de balanza del ${startPlu} al ${plu - 1}`, { duration: 6000 });
      onDone?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudieron cargar todos. Revisá en Productos lo que quedó.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="cuts-title" onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl bg-white sm:rounded-3xl shadow-2xl flex flex-col max-h-[100dvh] sm:max-h-[90dvh]">
        <div className="px-5 pt-5 pb-3 flex items-start gap-3 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <h2 id="cuts-title" className="text-[19px] font-bold text-slate-900 tracking-tight">
              {rubro === 'FIAMBRERIA' ? 'Cargar fiambres y quesos' : 'Cargar los cortes'}
            </h2>
            <p className="text-[13px] text-slate-500 leading-snug mt-0.5">
              Marcá los que vendés y poné el precio por kilo. Quedan por kilo, con código de balanza desde el <b className="text-slate-700">{startPlu}</b>.
            </p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0" aria-label="Cerrar"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        {available.length > 1 && (
          <div className="px-5 pt-3 flex gap-2">
            {available.map((r) => (
              <button key={r} onClick={() => setRubro(r)}
                className={`px-3 h-8 rounded-lg text-[13px] font-semibold ${rubro === r ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {PROFILE_LABELS[r].emoji} {PROFILE_LABELS[r].title}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {groups.map((g) => (
            <section key={g.category}>
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-500">{g.category}</h3>
                <div className="flex gap-3 text-[12px] font-semibold">
                  <button onClick={() => setGroup(g.category, true)} className="text-rose-700 hover:underline">Todos</button>
                  <button onClick={() => setGroup(g.category, false)} className="text-slate-500 hover:underline">Ninguno</button>
                </div>
              </div>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                {g.rows.map(({ row, i }) => (
                  <li key={row.name} className={`flex items-center gap-3 px-3 py-2 ${row.exists ? 'opacity-50' : ''}`}>
                    <button type="button" role="checkbox" aria-checked={row.on && !row.exists} disabled={row.exists} onClick={() => patch(i, { on: !row.on })}
                      className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${row.on && !row.exists ? 'bg-rose-600 text-white' : 'border-2 border-slate-300'}`}>
                      {row.on && !row.exists && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                    </button>
                    <span className="flex-1 min-w-0 text-[14px] font-medium text-slate-800 truncate">{row.name}</span>
                    {row.exists ? (
                      <span className="text-[12px] text-slate-500">Ya lo tenés</span>
                    ) : (
                      <label className="flex items-center gap-1 text-[12px] text-slate-500">
                        $
                        <input inputMode="decimal" value={row.price} disabled={!row.on} placeholder="0"
                          onChange={(e) => patch(i, { price: e.target.value.replace(/[^\d.,]/g, '') })}
                          className="w-24 h-8 px-2 rounded-lg border border-slate-300 text-right text-[14px] text-slate-900 tabular-nums outline-none focus:border-rose-500 disabled:bg-slate-50" />
                        el kilo
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!rows.length && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
        </div>

        <div className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)] sm:pb-5 border-t border-slate-100">
          {withoutPrice > 0 && (
            <p className="text-[12px] text-amber-700 mb-2">{withoutPrice} sin precio: quedan en $ 0 hasta que se lo pongas (en Productos o con Aumentar precios).</p>
          )}
          <button disabled={!chosen.length || saving} onClick={save}
            className="w-full h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-bold disabled:opacity-40 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {chosen.length ? `Cargar ${chosen.length} producto${chosen.length === 1 ? '' : 's'}` : 'Marcá al menos uno'}
          </button>
        </div>
      </div>
    </div>
  );
}

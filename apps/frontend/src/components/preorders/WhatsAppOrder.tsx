import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Sparkles, Loader2, ImagePlus, Trash2, AlertTriangle, Check } from 'lucide-react';
import api from '../../services/api';

/**
 * Pedido de WhatsApp con IA: se pega el mensaje del cliente (o la foto de su lista) y la IA de
 * Ventra lo pasa a productos del catálogo. Se revisa acá (lo dudoso en amarillo, lo que no
 * encontró en rojo) y se guarda como un pedido más: precios del catálogo, stock comprometido
 * hasta que sale el reparto.
 */

const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const qtyFmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });

interface Line { key: string; productId: string | null; asked: string; note: string; confidence: 'alta' | 'media' | 'baja'; qty: number; byPack: boolean }

/** El cliente que mejor coincide con el nombre que aparece en el mensaje */
function guessClient(hint: string, clients: any[]) {
  const h = norm(hint);
  if (h.length < 3) return null;
  const exact = clients.find((c) => norm(c.name) === h);
  if (exact) return exact;
  const words = h.split(' ').filter((w) => w.length > 2);
  let best: any = null;
  let score = 0;
  for (const c of clients) {
    const n = norm(c.name);
    const s = words.filter((w) => n.includes(w)).length;
    if (s > score) { best = c; score = s; }
  }
  return score >= Math.min(2, words.length) ? best : null;
}

export default function WhatsAppOrder({ products, clients, onClose, onCreate }: {
  products: any[];
  clients: any[];
  onClose: () => void;
  /** Arma el pedido como uno del vendedor (lo guarda PreventaScreen) */
  onCreate: (order: { client: any; items: { productId: string; productName: string; quantity: number; packSize: number | null; unitPrice: number }[]; notes: string }) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [clientId, setClientId] = useState('');
  const [notes, setNotes] = useState('');
  const [left, setLeft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const sortedProducts = useMemo(() => [...products].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es')), [products]);
  const sortedClients = useMemo(() => [...clients].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es')), [clients]);

  const addFiles = (list: FileList | File[] | null) => {
    const imgs = Array.from(list || []).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) setFiles((prev) => [...prev, ...imgs].slice(0, 4));
  };

  const read = async () => {
    if (!text.trim() && !files.length) { toast.error('Pegá el mensaje del cliente o agregá la foto del pedido'); return; }
    setReading(true);
    try {
      const form = new FormData();
      form.append('text', text);
      files.forEach((f) => form.append('files', f));
      const { data } = await api.post('/ai/order', form, { timeout: 160000 } as any);
      const ls: Line[] = (data.items || []).map((it: any, i: number) => {
        const p = it.productId ? byId.get(it.productId) : null;
        const size = p && Number(p.unitsPerPack) > 1 ? Number(p.unitsPerPack) : 0;
        const byPack = !!(size && it.packSize);
        return { key: `l${i}`, productId: p ? p.id : null, asked: it.asked, note: it.note, confidence: it.confidence, qty: byPack ? it.quantity / size : it.quantity, byPack };
      });
      setLines(ls);
      setLeft(typeof data.left === 'number' ? data.left : null);
      const guess = guessClient(data.client || text.split('\n')[0] || '', clients);
      if (guess && !clientId) setClientId(guess.id);
      setNotes(data.note || '');
      if (!ls.length) toast('No encontramos productos en el mensaje. Revisalo o cargá el pedido a mano.', { icon: 'ℹ️' });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo leer el pedido. Probá de nuevo.', { duration: 7000 });
    } finally {
      setReading(false);
    }
  };

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => (ls || []).map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const create = async () => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) { toast.error('Elegí el cliente del pedido'); return; }
    const ok = (lines || []).filter((l) => l.productId && l.qty > 0);
    if (!ok.length) { toast.error('El pedido no tiene productos del catálogo'); return; }
    const missing = (lines || []).filter((l) => !l.productId);
    if (missing.length && !window.confirm(`${missing.length === 1 ? 'Un renglón no tiene' : `${missing.length} renglones no tienen`} producto elegido y no va${missing.length === 1 ? '' : 'n'} a entrar:\n\n${missing.map((m) => `• ${m.asked}`).join('\n')}\n\n¿Crear el pedido igual?`)) return;
    setSaving(true);
    try {
      await onCreate({
        client,
        notes: ['Pedido por WhatsApp', notes.trim()].filter(Boolean).join('. '),
        items: ok.map((l) => {
          const p: any = byId.get(l.productId!);
          const size = l.byPack && Number(p.unitsPerPack) > 1 ? Number(p.unitsPerPack) : 0;
          // Precio del catálogo (el servidor lo vuelve a calcular igual): el del bulto o el de la unidad
          const unitPrice = size ? (Number(p.packPrice) > 0 ? Number(p.packPrice) : Number(p.salePrice) * size) / size : Number(p.salePrice) || 0;
          return { productId: p.id, productName: p.name, quantity: size ? l.qty * size : l.qty, packSize: size || null, unitPrice };
        }),
      });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar el pedido');
    } finally {
      setSaving(false);
    }
  };

  const tone = (l: Line) => (!l.productId ? 'border-rose-300 bg-rose-50/60' : l.confidence === 'alta' ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50/60');

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/60 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Pedido de WhatsApp" onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-2xl max-h-[94dvh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <span className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-bold text-slate-900 leading-tight">Pedido de WhatsApp</p>
            <p className="text-[12.5px] text-slate-500">Pegá el mensaje del cliente o la foto de su lista: lo pasamos a tus productos para que lo revises.</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer" aria-label="Cerrar"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!lines ? (
            <>
              <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus rows={7} maxLength={6000}
                onPaste={(e) => { if (e.clipboardData?.files?.length) { addFiles(e.clipboardData.files); } }}
                placeholder={'Ej.: Hola! te paso el pedido de Almacén Don Tito\n3 cajas de coca 2,25\n2 bultos de fideos spaghetti\n10 yerbas de 1 kg'}
                className="w-full px-3.5 py-3 rounded-xl bg-slate-50 border border-slate-200 text-[14px] outline-none focus:border-emerald-500 focus:bg-white resize-none" />
              <div className="flex items-center gap-2 flex-wrap">
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                <button onClick={() => fileRef.current?.click()} className="h-9 px-3.5 rounded-xl border border-slate-300 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center gap-1.5">
                  <ImagePlus className="w-4 h-4" /> Agregar foto
                </button>
                {files.map((f, i) => (
                  <span key={i} className="h-9 pl-3 pr-1 rounded-xl bg-slate-100 text-[12.5px] text-slate-700 flex items-center gap-1">
                    {f.name.slice(0, 18) || 'foto'}
                    <button onClick={() => setFiles((fs) => fs.filter((_, k) => k !== i))} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-600 cursor-pointer" aria-label="Sacar la foto"><X className="w-3.5 h-3.5" /></button>
                  </span>
                ))}
              </div>
              <p className="text-[12px] text-slate-500">Los audios no se pueden leer: en el celular, mantené apretado el audio en WhatsApp para transcribirlo y pegá el texto. En la PC también podés pegar la foto con Ctrl+V.</p>
            </>
          ) : (
            <>
              <div>
                <p className="text-[12.5px] font-semibold text-slate-700 mb-1.5">Cliente</p>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                  className={`w-full h-11 px-3 rounded-xl border text-[14px] outline-none ${clientId ? 'border-slate-200 bg-white' : 'border-rose-300 bg-rose-50/60'}`}>
                  <option value="">Elegí el cliente…</option>
                  {sortedClients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.locality ? ` · ${c.locality}` : ''}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <p className="text-[12.5px] font-semibold text-slate-700">Productos <span className="font-normal text-slate-500">· revisá lo que está en amarillo o rojo</span></p>
                {lines.map((l) => {
                  const p: any = l.productId ? byId.get(l.productId) : null;
                  const size = p && Number(p.unitsPerPack) > 1 ? Number(p.unitsPerPack) : 0;
                  return (
                    <div key={l.key} className={`rounded-xl border px-3 py-2.5 ${tone(l)}`}>
                      <p className="text-[12px] text-slate-500 truncate">Pidió: “{l.asked}”{l.note ? ` · ${l.note}` : ''}</p>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <input type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(l.key, { qty: Math.max(0, Number(e.target.value) || 0) })}
                          className="w-20 h-9 px-2 rounded-lg border border-slate-300 text-[14px] font-bold text-right outline-none focus:border-slate-500 bg-white" aria-label="Cantidad" />
                        {size ? (
                          <select value={l.byPack ? 'b' : 'u'} onChange={(e) => setLine(l.key, { byPack: e.target.value === 'b' })} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px] bg-white outline-none" aria-label="Bulto o unidad">
                            <option value="b">bultos x{size}</option>
                            <option value="u">unidades</option>
                          </select>
                        ) : <span className="text-[13px] text-slate-500">u.</span>}
                        <select value={l.productId || ''} onChange={(e) => setLine(l.key, { productId: e.target.value || null, confidence: 'alta', byPack: l.byPack && !!(byId.get(e.target.value)?.unitsPerPack > 1) })}
                          className="flex-1 min-w-[180px] h-9 px-2 rounded-lg border border-slate-300 text-[13px] bg-white outline-none" aria-label="Producto">
                          <option value="">— No está en el catálogo —</option>
                          {sortedProducts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <button onClick={() => setLines((ls) => (ls || []).filter((x) => x.key !== l.key))} className="w-9 h-9 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center cursor-pointer" aria-label="Sacar el renglón"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      {p && Number.isFinite(Number(p.stock)) && (l.byPack && size ? l.qty * size : l.qty) > Number(p.stock) && (
                        <p className="mt-1 text-[12px] text-amber-800 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Hay {qtyFmt(Number(p.stock))} en stock</p>
                      )}
                    </div>
                  );
                })}
                {lines.length === 0 && <p className="text-[13px] text-slate-500">No se encontraron productos.</p>}
              </div>

              <div>
                <p className="text-[12.5px] font-semibold text-slate-700 mb-1.5">Aclaración (opcional)</p>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} className="w-full h-10 px-3 rounded-xl border border-slate-200 text-[14px] outline-none focus:border-slate-400" />
              </div>
              {left !== null && <p className="text-[11.5px] text-slate-400">Te quedan {left} pedidos leídos con IA este mes.</p>}
            </>
          )}
        </div>

        <div className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] border-t border-slate-100 flex gap-2">
          {!lines ? (
            <button onClick={read} disabled={reading} className="flex-1 h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60">
              {reading ? <><Loader2 className="w-4 h-4 animate-spin" /> Leyendo el pedido…</> : <><Sparkles className="w-4 h-4" /> Leer el pedido</>}
            </button>
          ) : (
            <>
              <button onClick={() => setLines(null)} className="h-12 px-4 rounded-2xl border border-slate-300 text-slate-700 font-semibold text-[14px] cursor-pointer">Volver</button>
              <button onClick={create} disabled={saving} className="flex-1 h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Crear el pedido
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

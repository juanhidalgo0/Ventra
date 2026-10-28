import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search, Plus, Trash2, ChevronUp, ChevronDown, Save, Image as ImageIcon, FileText, Tag, Download, Share2, Printer, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api, { resolveServerUrl } from '../../services/api';
import { useMarketingStore } from '../../stores/marketingStore';
import { ACCENTS, drawSocialImage, exportSocialImage, type SocialFormat, type SocialStyle } from '../../utils/socialImage';
import { buildPriceListDocument } from '../../utils/priceListSheet';
import ShelfLabelModal from '../products/ShelfLabelModal';

export type GroupView = 'social' | 'list' | 'labels';

const SETTINGS_KEY = 'social_image_settings';
const local = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const money = (n: number) => `$ ${Number(n || 0).toLocaleString('es-AR')}`;

/** Una foto que se pueda dibujar en el lienzo: las de otros sitios las trae la PC (?inline=1) */
export const drawableImage = (p: any): string | null => {
  if (!p?.imageUrl) return null;
  if (String(p.imageUrl).startsWith('data:')) return p.imageUrl;
  return `${resolveServerUrl(`/api/product-images/${p.id}`)}?inline=1`;
};

function loadPrefs() {
  const d = { format: 'feed' as SocialFormat, style: 'clasico' as SocialStyle, accent: '#e11d48', showImages: true, showCodes: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return d; }
}

/**
 * Un grupo de productos ("Cervezas", "Ofertas de la semana"): se arma una vez y sirve para
 * reimprimir las etiquetas cuando cambian los precios, hacer la imagen para redes y la lista
 * de precios en A4. Los precios salen siempre del sistema, al momento.
 */
export default function MarketingEditor({ groupId, onBack, initialView = 'social' }: { groupId: string | null; onBack: () => void; initialView?: GroupView }) {
  const { groups, createGroup, updateGroup } = useMarketingStore();
  const [savedId, setSavedId] = useState<string | null>(groupId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<GroupView>(initialView);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [prevPrices, setPrevPrices] = useState<Record<string, number | null>>({});
  const [showLabels, setShowLabels] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const listRef = useRef<HTMLIFrameElement>(null);

  const store = useMemo(() => ({ name: local('gd_store_name'), logo: local('gd_store_logo') || null, phone: local('gd_store_phone'), address: local('gd_store_address') }), []);
  const canShare = typeof navigator !== 'undefined' && !!(navigator as any).canShare;

  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs)); } catch { /* sin espacio */ } }, [prefs]);

  useEffect(() => {
    if (!groupId) return;
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    setName(g.name);
    setDescription(g.description || '');
    setItems(g.items.map((i) => i.product).filter(Boolean));
  }, [groupId]);

  // El título de la imagen arranca con el nombre del grupo; la bajada, con la vigencia
  useEffect(() => { if (!title && name) setTitle(name); }, [name]);
  useEffect(() => {
    if (subtitle) return;
    const until = new Date(Date.now() + 7 * 864e5).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
    setSubtitle(description || `Precios válidos hasta el ${until}`);
  }, [description]);

  useEffect(() => {
    api.get('/categories').then(({ data }) => setCategories((Array.isArray(data) ? data : []).filter((c: any) => c.isActive !== false).map((c: any) => ({ id: c.id, name: c.name })))).catch(() => {});
    // Los que bajaron de precio en el último mes: salen como oferta con el precio anterior tachado
    api.get('/products/price-changes', { params: { days: 30 } }).then(({ data }) => {
      setPrevPrices(Object.fromEntries((data || []).map((r: any) => [r.id, r.prevSalePrice])));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (search.trim().length < 2) { setResults([]); return; }
      setSearching(true);
      try {
        const { data } = await api.get('/products', { params: { search: search.trim(), take: 60 } });
        setResults(Array.isArray(data) ? data : data?.data || []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const addMany = (list: any[]) => {
    const have = new Set(items.map((p) => p.id));
    const fresh = list.filter((p) => p && !have.has(p.id) && (have.add(p.id), true));
    if (!fresh.length) return 0;
    setItems((prev) => [...prev, ...fresh.filter((p) => !prev.some((x) => x.id === p.id))]);
    setDirty(true);
    return fresh.length;
  };

  const addCategory = async (categoryId: string) => {
    if (!categoryId) return;
    setAdding(true);
    try {
      const { data } = await api.get('/products', { params: { categoryId, take: 500 } });
      const list = (Array.isArray(data) ? data : data?.data || []).filter((p: any) => p.isActive !== false);
      const n = addMany(list);
      toast.success(n ? `Se agregaron ${n} productos` : 'Ya estaban todos en el grupo');
    } catch { toast.error('No se pudo cargar la categoría'); } finally { setAdding(false); }
  };

  const onSearchEnter = async () => {
    const code = search.trim();
    if (!code) return;
    const exact = results.find((p) => p.barcode === code || p.sku === code);
    if (exact) { addMany([exact]); setSearch(''); return; }
    if (results.length === 1) { addMany(results); setSearch(''); }
  };

  const move = (i: number, d: number) => {
    setItems((prev) => {
      const j = i + d;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  };

  const save = async (silent = false) => {
    if (!name.trim()) { toast.error('Ponele un nombre al grupo (por ejemplo, Cervezas)'); return false; }
    setSaving(true);
    try {
      const data = items.map((p, idx) => ({ productId: p.id, order: idx }));
      if (savedId) await updateGroup(savedId, name.trim(), description.trim() || undefined, data);
      else {
        await createGroup(name.trim(), description.trim() || undefined, data);
        const created = useMarketingStore.getState().groups.find((g) => g.name === name.trim());
        if (created) setSavedId(created.id);
      }
      setDirty(false);
      if (!silent) toast.success('Grupo guardado');
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar el grupo');
      return false;
    } finally { setSaving(false); }
  };

  // Imagen para redes: se vuelve a dibujar con cada cambio
  const socialItems = useMemo(() => items.map((p) => ({
    name: p.name, price: Number(p.salePrice) || 0, prevPrice: prevPrices[p.id] ?? null, image: drawableImage(p),
  })), [items, prevPrices]);
  useEffect(() => {
    if (view !== 'social' || !canvasRef.current) return;
    let alive = true;
    setDrawing(true);
    drawSocialImage(canvasRef.current, socialItems, {
      format: prefs.format, style: prefs.style, accent: prefs.accent, title: title || name || 'Ofertas', subtitle,
      storeName: store.name, logo: store.logo, phone: store.phone, address: store.address, showImages: prefs.showImages,
    }).catch(() => {}).finally(() => { if (alive) setDrawing(false); });
    return () => { alive = false; };
  }, [view, socialItems, prefs, title, subtitle, name]);

  const download = async (share: boolean) => {
    if (!canvasRef.current) return;
    try {
      const how = await exportSocialImage(canvasRef.current, `${(title || name || 'ofertas').replace(/[^\w-]+/g, '_')}.png`, share);
      toast.success(how === 'shared' ? 'Listo para compartir' : 'Imagen descargada');
    } catch {
      toast.error('No se pudo armar la imagen. Probá sin fotos.');
    }
  };

  const listDoc = useMemo(() => buildPriceListDocument(items.map((p) => ({
    name: p.name, price: Number(p.salePrice) || 0, code: p.barcode || null,
    image: p.imageUrl ? (String(p.imageUrl).startsWith('data:') ? p.imageUrl : resolveServerUrl(`/api/product-images/${p.id}`) || null) : null,
  })), {
    title: title || name || 'Lista de precios', subtitle, storeName: store.name, logo: store.logo, phone: store.phone, address: store.address,
    accent: prefs.accent, showImages: prefs.showImages, showCodes: prefs.showCodes,
  }), [items, title, name, subtitle, prefs]);

  const fitList = () => {
    const iframe = listRef.current;
    const d = iframe?.contentDocument;
    if (!iframe || !d) return;
    const zoom = Math.min(1, (iframe.clientWidth - 40) / (210 * 3.7795));
    const s = d.createElement('style'); s.media = 'screen'; s.textContent = `.page { zoom: ${zoom.toFixed(3)}; }`;
    d.head.appendChild(s);
  };
  const printList = () => { const w = listRef.current?.contentWindow; if (w) { w.focus(); w.print(); } };

  const back = async () => {
    if (dirty && !window.confirm('Hay cambios sin guardar en el grupo. ¿Salir igual?')) return;
    onBack();
  };

  const tab = (id: GroupView, label: string, Icon: any) => (
    <button onClick={() => setView(id)} className={`flex items-center gap-1.5 px-3.5 h-9 rounded-lg text-[13px] font-semibold ${view === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center gap-3 shrink-0">
        <button onClick={back} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" title="Volver"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1 min-w-0">
          <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} placeholder="Nombre del grupo (ej.: Cervezas)"
            className="w-full text-lg font-black text-slate-900 outline-none bg-transparent placeholder:text-slate-300" />
          <input value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} placeholder="Descripción (opcional)"
            className="w-full text-[12.5px] text-slate-500 outline-none bg-transparent placeholder:text-slate-300" />
        </div>
        <button onClick={() => save()} disabled={saving || (!dirty && !!savedId)}
          className="h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold flex items-center gap-1.5 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {dirty || !savedId ? 'Guardar grupo' : 'Guardado'}
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Productos del grupo */}
        <div className="w-[340px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSearchEnter(); } }}
                placeholder="Buscar o escanear productos…" className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-300 text-[13px] outline-none focus:border-rose-400" />
            </div>
            <select value="" onChange={(e) => addCategory(e.target.value)} disabled={adding}
              className="w-full h-9 px-2 rounded-lg border border-slate-300 bg-white text-[12.5px] text-slate-700">
              <option value="">{adding ? 'Agregando…' : '+ Agregar toda una categoría…'}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {search.trim().length >= 2 && (
              <div className="rounded-xl border border-slate-200 max-h-64 overflow-y-auto">
                <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px] border-b border-slate-100 bg-slate-50 sticky top-0">
                  <span className="text-slate-500">{searching ? 'Buscando…' : `${results.length} resultados`}</span>
                  {results.length > 0 && <button onClick={() => { const n = addMany(results); toast.success(n ? `Se agregaron ${n}` : 'Ya estaban todos'); setSearch(''); }} className="font-bold text-rose-600">Agregar todos</button>}
                </div>
                {results.map((p) => (
                  <button key={p.id} onClick={() => addMany([p])} className="w-full text-left px-2.5 py-1.5 hover:bg-rose-50 flex items-center gap-2 border-b border-slate-50 last:border-0">
                    <span className="flex-1 min-w-0 text-[12.5px] font-semibold text-slate-800 truncate">{p.name}</span>
                    <span className="text-[11.5px] text-slate-500">{money(p.salePrice)}</span>
                    <Plus className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="px-3 py-2 flex items-center justify-between text-[11.5px] text-slate-500">
            <span><b className="text-slate-800">{items.length}</b> {items.length === 1 ? 'producto' : 'productos'}</span>
            {items.length > 0 && <button onClick={() => { if (window.confirm('¿Sacar todos los productos del grupo?')) { setItems([]); setDirty(true); } }} className="font-semibold hover:text-rose-600">Vaciar</button>}
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
            {!items.length && <p className="text-center text-[12.5px] text-slate-400 mt-8 px-6">Buscá productos, escaneá códigos o agregá una categoría entera.</p>}
            {items.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-200">
                <span className="w-5 text-[10.5px] text-slate-400 text-right">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-semibold text-slate-800 truncate">{p.name}</span>
                  <span className="block text-[11px] text-slate-500">{money(p.salePrice)}{prevPrices[p.id] && prevPrices[p.id]! > p.salePrice ? ' · bajó de precio' : ''}</span>
                </span>
                <button onClick={() => move(i, -1)} className="p-0.5 text-slate-400 hover:text-slate-700" title="Subir"><ChevronUp className="w-4 h-4" /></button>
                <button onClick={() => move(i, 1)} className="p-0.5 text-slate-400 hover:text-slate-700" title="Bajar"><ChevronDown className="w-4 h-4" /></button>
                <button onClick={() => { setItems((prev) => prev.filter((x) => x.id !== p.id)); setDirty(true); }} className="p-0.5 text-slate-400 hover:text-rose-600" title="Sacar"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* Lo que se hace con el grupo */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-4 pt-3 flex items-center gap-1.5 shrink-0">
            {tab('social', 'Imagen para redes', ImageIcon)}
            {tab('list', 'Lista de precios A4', FileText)}
            {tab('labels', 'Etiquetas de góndola', Tag)}
          </div>

          {view === 'social' && (
            <div className="flex-1 min-h-0 flex gap-4 p-4">
              <div className="w-64 shrink-0 space-y-3 overflow-y-auto">
                <div>
                  <p className="text-[11px] font-bold text-slate-500 mb-1">Formato</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([['feed', 'Publicación', '1080×1080'], ['story', 'Historia / estado', '1080×1920']] as const).map(([id, l, s]) => (
                      <button key={id} onClick={() => setPrefs({ ...prefs, format: id })} className={`p-2 rounded-lg border text-left ${prefs.format === id ? 'border-rose-500 bg-rose-50' : 'border-slate-300 bg-white'}`}>
                        <span className="block text-[12.5px] font-bold text-slate-800">{l}</span><span className="block text-[10.5px] text-slate-500">{s}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-500 mb-1">Estilo</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([['clasico', 'Clásico'], ['oscuro', 'Oscuro'], ['color', 'Color']] as const).map(([id, l]) => (
                      <button key={id} onClick={() => setPrefs({ ...prefs, style: id })} className={`h-8 rounded-lg border text-[12px] font-semibold ${prefs.style === id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-500 mb-1">Color</p>
                  <div className="flex gap-1.5">
                    {ACCENTS.map((a) => (
                      <button key={a.id} onClick={() => setPrefs({ ...prefs, accent: a.id })} title={a.name}
                        className={`w-8 h-8 rounded-full border-2 ${prefs.accent === a.id ? 'border-slate-900 scale-110' : 'border-white shadow'}`} style={{ background: a.id }} />
                    ))}
                  </div>
                </div>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500">Título</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} className="mt-1 w-full h-9 px-2.5 rounded-lg border border-slate-300 text-[13px]" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500">Bajada</span>
                  <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={60} className="mt-1 w-full h-9 px-2.5 rounded-lg border border-slate-300 text-[13px]" />
                </label>
                <label className="flex items-center gap-2 text-[12.5px] text-slate-700">
                  <input type="checkbox" checked={prefs.showImages} onChange={(e) => setPrefs({ ...prefs, showImages: e.target.checked })} className="rounded" /> Fotos de los productos
                </label>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Lleva {store.logo ? 'el logo y ' : ''}{store.name ? `el nombre de ${store.name}` : 'el nombre del comercio'}{store.phone ? ' y tu WhatsApp' : ''}. Se cambian en Configuración → Tu comercio. Los que bajaron de precio salen como oferta.
                </p>
                <div className="space-y-1.5 pt-1">
                  <button onClick={() => download(false)} disabled={!items.length} className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"><Download className="w-4 h-4" /> Descargar imagen</button>
                  {canShare && <button onClick={() => download(true)} disabled={!items.length} className="w-full h-10 rounded-xl border border-slate-300 bg-white text-slate-700 text-[13px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"><Share2 className="w-4 h-4" /> Compartir</button>}
                </div>
              </div>
              <div className="flex-1 min-w-0 flex items-center justify-center bg-slate-200/60 rounded-2xl p-4 relative">
                {!items.length ? <p className="text-slate-500 text-[13px]">Agregá productos al grupo para ver la imagen.</p> : (
                  <canvas ref={canvasRef} className="max-w-full max-h-full rounded-lg shadow-xl bg-white" style={{ aspectRatio: prefs.format === 'feed' ? '1 / 1' : '9 / 16' }} />
                )}
                {drawing && items.length > 0 && <Loader2 className="w-5 h-5 animate-spin text-slate-500 absolute top-4 right-4" />}
              </div>
            </div>
          )}

          {view === 'list' && (
            <div className="flex-1 min-h-0 flex gap-4 p-4">
              <div className="w-64 shrink-0 space-y-3">
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500">Título</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={50} className="mt-1 w-full h-9 px-2.5 rounded-lg border border-slate-300 text-[13px]" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500">Bajada</span>
                  <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={80} className="mt-1 w-full h-9 px-2.5 rounded-lg border border-slate-300 text-[13px]" />
                </label>
                <div className="flex gap-1.5">
                  {ACCENTS.map((a) => (
                    <button key={a.id} onClick={() => setPrefs({ ...prefs, accent: a.id })} title={a.name}
                      className={`w-7 h-7 rounded-full border-2 ${prefs.accent === a.id ? 'border-slate-900' : 'border-white shadow'}`} style={{ background: a.id }} />
                  ))}
                </div>
                <label className="flex items-center gap-2 text-[12.5px] text-slate-700"><input type="checkbox" checked={prefs.showImages} onChange={(e) => setPrefs({ ...prefs, showImages: e.target.checked })} className="rounded" /> Fotos</label>
                <label className="flex items-center gap-2 text-[12.5px] text-slate-700"><input type="checkbox" checked={prefs.showCodes} onChange={(e) => setPrefs({ ...prefs, showCodes: e.target.checked })} className="rounded" /> Códigos de barras</label>
                <button onClick={printList} disabled={!items.length} className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"><Printer className="w-4 h-4" /> Imprimir o guardar PDF</button>
              </div>
              <iframe ref={listRef} title="Lista de precios" srcDoc={listDoc} onLoad={fitList} className="flex-1 min-w-0 rounded-2xl border border-slate-200 bg-slate-100" />
            </div>
          )}

          {view === 'labels' && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-3"><Tag className="w-7 h-7" /></div>
              <p className="text-[16px] font-bold text-slate-900">Etiquetas de góndola de este grupo</p>
              <p className="text-[13px] text-slate-500 mt-1 max-w-md">Con los precios de hoy. Cuando suban, volvé acá y reimprimilas todas de una, sin buscarlas una por una.</p>
              <button onClick={() => setShowLabels(true)} disabled={!items.length}
                className="mt-4 h-11 px-6 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-bold flex items-center gap-2 disabled:opacity-50">
                <Printer className="w-4 h-4" /> Preparar {items.length} {items.length === 1 ? 'etiqueta' : 'etiquetas'}
              </button>
            </div>
          )}
        </div>
      </div>

      {showLabels && <ShelfLabelModal initialProductIds={items.map((p) => p.id)} prevPrices={prevPrices} onClose={() => setShowLabels(false)} />}
    </div>
  );
}

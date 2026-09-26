import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Camera, Images, Search, Trash2, X, ImageOff, ScanLine, ChevronRight, Pencil } from 'lucide-react';
import api, { resolveServerUrl } from '../../services/api';
import ImageCropModal from '../common/ImageCropModal';
import { Sheet, PrimaryButton, ProductThumb, headerInput } from './ui';

/** Lado de la foto guardada: nítida en la ficha y liviana para la base y la sincronización. */
const SIDE = 480;
/** El servidor acepta cuerpos JSON de hasta 100 KB: la foto (en base64) tiene que entrar holgada. */
const MAX_CHARS = 90_000;

type SearchOption = { url: string; thumb: string; title: string; source: string };

/** Vuelve a codificar la foto bajando la calidad (y si hace falta el tamaño) hasta que pese lo justo. */
function fitSize(dataUrl: string): Promise<string> {
  if (dataUrl.length <= MAX_CHARS) return Promise.resolve(dataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('No se pudo procesar la foto'));
    img.onload = () => {
      let side = Math.min(SIDE, img.width);
      let q = 0.72;
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      for (let i = 0; i < 8; i++) {
        c.width = side; c.height = Math.round(side * (img.height / img.width));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', q);
        if (out.length <= MAX_CHARS) return resolve(out);
        if (q > 0.5) q -= 0.08; else side = Math.round(side * 0.85);
      }
      reject(new Error('La foto es demasiado pesada'));
    };
    img.src = dataUrl;
  });
}

/**
 * Foto del producto en la ficha del celular: verla en grande, sacarla con la cámara,
 * elegirla de la galería, buscarla en internet o quitarla. Se guarda en el producto,
 * así que aparece en todas las cajas y en la tienda online.
 */
export default function ProductPhoto({ product, onSaved }: { product: any; onSaved: (imageUrl: string | null) => void }) {
  const src = resolveServerUrl(product.imageUrl) || null;
  const [viewer, setViewer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const save = async (value: string | null) => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/products/${product.id}`, { imageUrl: value ?? '' });
      // Una foto de internet la baja y la achica el servidor: se usa la que quedó guardada
      const stored: string | null = value === null ? null : (data?.imageUrl || value);
      onSaved(stored);
      toast.success(value === null ? 'Foto quitada' : 'Foto actualizada');
      return true;
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar la foto');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Elegí una imagen');
    setCropFile(file);
  };

  const pick = (input: React.RefObject<HTMLInputElement>) => {
    setMenu(false);
    input.current?.click();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => (src ? setViewer(true) : setMenu(true))}
        className="relative w-[84px] h-[84px] shrink-0 rounded-2xl active:scale-95 transition-transform"
        aria-label={src ? 'Ver foto' : 'Agregar foto'}
      >
        {src
          ? <ProductThumb src={src} className="w-full h-full rounded-2xl border border-slate-200 p-1" iconClass="w-7 h-7" />
          : (
            <span className="w-full h-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-1 text-slate-500">
              <Camera className="w-6 h-6" strokeWidth={1.8} />
              <span className="text-[11px] font-semibold leading-none">Agregar foto</span>
            </span>
          )}
        {src && (
          <span className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-rose-600 text-white flex items-center justify-center ring-[3px] ring-white shadow">
            <Pencil className="w-3.5 h-3.5" />
          </span>
        )}
        {saving && (
          <span className="absolute inset-0 rounded-2xl bg-white/80 flex items-center justify-center">
            <span className="w-6 h-6 border-2 border-rose-200 border-t-rose-600 rounded-full animate-spin" />
          </span>
        )}
      </button>

      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={galleryInput} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <PhotoViewer
        open={viewer}
        src={src}
        name={product.name}
        onClose={() => setViewer(false)}
        onChange={() => { setViewer(false); setMenu(true); }}
        onRemove={() => { setViewer(false); setConfirmRemove(true); }}
      />

      <Sheet open={menu} onClose={() => setMenu(false)} title={src ? 'Cambiar foto' : 'Agregar foto'}>
        <div className="pt-1 pb-1 space-y-2">
          <MenuRow icon={Camera} title="Sacar foto" text="Con la cámara del celular" onClick={() => pick(cameraInput)} />
          <MenuRow icon={Images} title="Elegir de la galería" text="Una foto que ya tengas guardada" onClick={() => pick(galleryInput)} />
          <MenuRow icon={Search} title="Buscar en internet" text="Fotos del producto en catálogos de tiendas" onClick={() => { setMenu(false); setSearching(true); }} />
          {src && <MenuRow icon={Trash2} title="Quitar foto" danger onClick={() => { setMenu(false); setConfirmRemove(true); }} />}
        </div>
      </Sheet>

      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title="¿Quitar la foto?">
        <p className="text-[14px] text-slate-600 pt-1">El producto va a quedar sin foto en la caja y en la tienda online. Podés agregar otra cuando quieras.</p>
        <div className="grid grid-cols-2 gap-2 mt-5 pb-1">
          <button onClick={() => setConfirmRemove(false)} className="h-12 rounded-2xl bg-slate-100 text-[15px] font-semibold text-slate-700 active:bg-slate-200">Cancelar</button>
          <PrimaryButton tone="danger" loading={saving} onClick={async () => { if (await save(null)) setConfirmRemove(false); }}>Quitar foto</PrimaryButton>
        </div>
      </Sheet>

      <SearchSheet
        open={searching}
        product={product}
        onClose={() => setSearching(false)}
        onPick={async (url) => { if (await save(url)) setSearching(false); }}
      />

      {cropFile && (
        <ImageCropModal
          file={cropFile}
          aspect={1}
          outWidth={SIDE}
          outHeight={SIDE}
          title="Encuadrá la foto"
          hint="Queda cuadrada, como se ve en la caja y en la tienda."
          onCancel={() => setCropFile(null)}
          onDone={async (dataUrl) => {
            setCropFile(null);
            try {
              await save(await fitSize(dataUrl));
            } catch (err: any) {
              toast.error(err.message || 'No se pudo procesar la foto');
            }
          }}
        />
      )}
    </>
  );
}

function MenuRow({ icon: Icon, title, text, onClick, danger }: { icon: any; title: string; text?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 active:bg-slate-100 text-left">
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-red-50 text-red-600' : 'bg-rose-50 text-rose-700'}`}>
        <Icon className="w-5 h-5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-[15px] font-semibold ${danger ? 'text-red-600' : 'text-slate-900'}`}>{title}</span>
        {text && <span className="block text-[12.5px] text-slate-500">{text}</span>}
      </span>
      {!danger && <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />}
    </button>
  );
}

/** La foto a pantalla completa, con las acciones abajo al alcance del pulgar. */
function PhotoViewer({ open, src, name, onClose, onChange, onRemove }: {
  open: boolean; src: string | null; name: string; onClose: () => void; onChange: () => void; onRemove: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && src && (
        <motion.div
          className="fixed inset-0 z-[300] bg-slate-950 flex flex-col keep-animated mobile-app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={`Foto de ${name}`}
        >
          <div className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
            <p className="flex-1 min-w-0 text-[14px] font-semibold text-white/90 truncate">{name}</p>
            <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20" aria-label="Cerrar">
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center px-4" onClick={onClose}>
            <motion.div
              className="w-full max-w-[520px] aspect-square rounded-3xl bg-white overflow-hidden flex items-center justify-center p-4"
              initial={{ scale: 0.92 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
            >
              <img src={src} alt={name} className="max-w-full max-h-full object-contain" />
            </motion.div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <button onClick={onChange} className="h-12 rounded-2xl bg-white text-slate-900 text-[15px] font-semibold flex items-center justify-center gap-2 active:bg-slate-100">
              <Camera className="w-5 h-5" /> Cambiar foto
            </button>
            <button onClick={onRemove} className="h-12 w-12 rounded-2xl bg-white/10 text-red-300 flex items-center justify-center active:bg-white/20" aria-label="Quitar foto">
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Solo el nombre, sin medidas ni presentación: así los buscadores encuentran más fotos. */
const cleanQuery = (name: string) => (name || '').replace(/\s+X\s*\d.*$/i, '').replace(/\s+/g, ' ').trim();

/**
 * Buscar la foto en internet: primero la que coincide con el código de barras (la más
 * confiable) y después las de catálogos de tiendas por nombre.
 */
function SearchSheet({ open, product, onClose, onPick }: { open: boolean; product: any; onClose: () => void; onPick: (url: string) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchOption[] | null>(null);
  const [byBarcode, setByBarcode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const run = useRef(0);

  const search = async (q: string) => {
    if (!q.trim()) return;
    const id = ++run.current;
    setLoading(true); setError(null); setResults(null);
    try {
      const { data } = await api.get<SearchOption[]>('/products/images/search', { params: { q: q.trim() }, timeout: 60000 });
      if (id === run.current) setResults(Array.isArray(data) ? data : []);
    } catch (err: any) {
      if (id === run.current) setError(err.response?.data?.message || 'No se pudo buscar. Revisá la conexión y probá de nuevo.');
    } finally {
      if (id === run.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const q = cleanQuery(product.name);
    setQuery(q); setByBarcode(null); setPicking(null);
    search(q);
    const code = String(product.barcode || '');
    if (/^\d{8,14}$/.test(code)) {
      api.get(`/products/search-external-image/${code}`)
        .then(({ data }) => setByBarcode(data?.imageUrl || null))
        .catch(() => {});
    }
  }, [open, product.id]);

  const pick = async (url: string) => {
    if (picking) return;
    setPicking(url);
    try { await onPick(url); } finally { setPicking(null); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Buscar foto">
      <form onSubmit={(e) => { e.preventDefault(); search(query); }} className="flex gap-2 pt-1">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 inset-y-0 my-auto w-[18px] h-[18px] text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
            placeholder="Nombre del producto"
            className={`${headerInput} pl-10 bg-slate-50 border border-slate-200 shadow-none`}
          />
        </div>
        <button type="submit" disabled={loading} className="h-11 px-4 rounded-2xl bg-rose-600 text-white text-[14px] font-semibold disabled:opacity-60 active:bg-rose-700">Buscar</button>
      </form>

      {byBarcode && (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500 mb-2"><ScanLine className="w-4 h-4" /> Coincide con el código de barras</p>
          <ResultTile url={byBarcode} thumb={byBarcode} title={product.name} source="Código de barras" busy={picking === byBarcode} disabled={!!picking} onPick={pick} wide />
        </div>
      )}

      <p className="mt-4 mb-2 text-[12.5px] font-semibold text-slate-500">{byBarcode ? 'Otras fotos' : 'Resultados'}</p>
      {error && <p className="text-[13.5px] text-red-600 py-6 text-center">{error}</p>}
      {loading && (
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-square rounded-2xl bg-slate-100 animate-pulse" />)}
        </div>
      )}
      {results && results.length === 0 && !loading && (
        <div className="flex flex-col items-center gap-2 py-10 text-slate-500 text-[13.5px] text-center">
          <ImageOff className="w-8 h-8 text-slate-300" />
          No encontramos fotos. Probá con menos palabras o con la marca.
        </div>
      )}
      {results && results.length > 0 && !loading && (
        <div className="grid grid-cols-2 gap-2.5 pb-2">
          {results.map((r) => (
            <ResultTile key={r.url} url={r.url} thumb={r.thumb} title={r.title} source={r.source} busy={picking === r.url} disabled={!!picking} onPick={pick} />
          ))}
        </div>
      )}
    </Sheet>
  );
}

function ResultTile({ url, thumb, title, source, busy, disabled, onPick, wide }: {
  url: string; thumb: string; title: string; source: string; busy: boolean; disabled: boolean; onPick: (url: string) => void; wide?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <button
      type="button"
      onClick={() => onPick(url)}
      disabled={disabled}
      className={`relative text-left rounded-2xl border border-slate-200 bg-white overflow-hidden active:scale-[0.97] transition-transform disabled:opacity-60 ${wide ? 'w-full flex items-center gap-3 p-2' : ''}`}
    >
      <span className={`${wide ? 'w-20 h-20 rounded-xl' : 'aspect-square'} bg-white flex items-center justify-center p-2 shrink-0`}>
        <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="max-w-full max-h-full object-contain" />
      </span>
      <span className={`block ${wide ? 'flex-1 min-w-0' : 'px-2.5 py-2 border-t border-slate-100'}`}>
        <span className="block text-[12px] text-slate-700 leading-tight line-clamp-2">{title}</span>
        <span className="block text-[10.5px] text-slate-400 mt-0.5">{source}</span>
      </span>
      {busy && (
        <span className="absolute inset-0 bg-white/75 flex items-center justify-center">
          <span className="w-6 h-6 border-2 border-rose-200 border-t-rose-600 rounded-full animate-spin" />
        </span>
      )}
    </button>
  );
}

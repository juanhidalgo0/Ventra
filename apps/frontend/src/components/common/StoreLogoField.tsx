import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ImagePlus, Trash2, Loader2 } from 'lucide-react';
import { setStoreSetting } from '../../services/storeSettings';

/** Clave de localStorage donde lo leen las hojas (ver storeSettings: store_logo) */
export const STORE_LOGO_KEY = 'gd_store_logo';
export const readStoreLogo = () => { try { return localStorage.getItem(STORE_LOGO_KEY) || ''; } catch { return ''; } };

// El logo viaja con los ajustes del comercio a todas las cajas: se achica a lo que se ve en la hoja
// (unos 40 x 20 mm, a buena resolución) sobre fondo blanco, en PNG si queda liviano y si no en JPEG.
const MAX_W = 480;
const MAX_H = 200;
const MAX_CHARS = 280_000;

function fileToLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo no es una imagen'));
      img.onload = () => {
        const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        let out = canvas.toDataURL('image/png');
        if (out.length > MAX_CHARS * 0.6) out = canvas.toDataURL('image/jpeg', 0.88);
        if (out.length > MAX_CHARS) out = canvas.toDataURL('image/jpeg', 0.7);
        if (out.length > MAX_CHARS) reject(new Error('El logo es muy pesado'));
        else resolve(out);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Logo del comercio para las impresiones (nota de venta, remito, factura). Opcional: se guarda al
 * elegirlo y se puede quitar. Lo comparten todas las cajas del comercio.
 */
export default function StoreLogoField({ onChange, compact }: { onChange?: (logo: string) => void; compact?: boolean }) {
  const [logo, setLogo] = useState(readStoreLogo);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const apply = (value: string) => {
    setStoreSetting('store_logo', value);
    setLogo(value);
    onChange?.(value);
  };
  const pick = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      apply(await fileToLogo(file));
      toast.success('Logo guardado: va a salir en las impresiones');
    } catch (err: any) {
      toast.error(err?.message === 'El logo es muy pesado' ? 'El logo es muy pesado: probá con una imagen más simple o más chica.' : 'No se pudo usar esa imagen. Probá con un PNG o JPG.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className={`flex items-center gap-3 ${compact ? '' : 'p-3 rounded-xl border border-slate-200 bg-slate-50/60'}`}>
      <div className="w-24 h-12 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden shrink-0">
        {logo ? <img src={logo} alt="Logo del comercio" className="max-w-full max-h-full object-contain" /> : <span className="text-[10.5px] text-slate-400">Sin logo</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-slate-800">Logo para las impresiones</p>
        <p className="text-[11.5px] text-slate-500 leading-snug">Opcional. Sale arriba de las notas de venta, remitos y facturas.</p>
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
        className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center gap-1.5 disabled:opacity-50 shrink-0">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} {logo ? 'Cambiar' : 'Subir logo'}
      </button>
      {logo && (
        <button type="button" onClick={() => apply('')} className="h-9 w-9 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center cursor-pointer shrink-0" aria-label="Quitar el logo" title="Quitar el logo">
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

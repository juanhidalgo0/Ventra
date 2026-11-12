import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ImagePlus, Loader2, RefreshCw, X } from 'lucide-react';
import { fileToLogo } from '../common/StoreLogoField';

/**
 * Elegir el logo del comercio con vista previa: muestra cómo sale arriba de un ticket o una nota
 * de venta antes de guardarlo. No guarda nada: quien lo usa decide cuándo (setStoreSetting
 * 'store_logo', el mismo lugar que usa Configuración).
 */
export default function LogoPicker({ name, logo, onChange }: { name: string; logo: string; onChange: (logo: string) => void }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await fileToLogo(file));
    } catch (err: any) {
      toast.error(err?.message === 'El logo es muy pesado' ? 'El logo es muy pesado: probá con una imagen más simple o más chica.' : 'No se pudo usar esa imagen. Probá con un PNG o JPG.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  const open = () => inputRef.current?.click();

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {/* Vista previa: el encabezado de un comprobante, como sale impreso */}
      <div className="relative mx-auto max-w-[300px] rounded-2xl bg-white border border-slate-200 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.25)] px-6 pt-5 pb-4">
        <button type="button" onClick={open} disabled={busy}
          className={`w-full h-[88px] rounded-xl flex items-center justify-center overflow-hidden ${logo ? 'bg-white' : 'border-2 border-dashed border-rose-300 bg-rose-50/60 hover:bg-rose-50 text-rose-700'}`}
          aria-label={logo ? 'Cambiar el logo' : 'Elegir el logo'}>
          {busy ? <Loader2 className="w-6 h-6 animate-spin text-rose-600" />
            : logo ? <img src={logo} alt="Logo del comercio" className="max-w-full max-h-full object-contain" />
            : <span className="flex flex-col items-center gap-1"><ImagePlus className="w-6 h-6" /><span className="text-[13px] font-bold">Elegir imagen</span></span>}
        </button>
        <p className="mt-3 text-center text-[14px] font-bold text-slate-900 truncate">{name.trim() || 'Tu comercio'}</p>
        <div className="mt-3 border-t border-dashed border-slate-200 pt-3 space-y-1.5" aria-hidden="true">
          <div className="flex justify-between"><span className="h-2 w-24 rounded bg-slate-100" /><span className="h-2 w-10 rounded bg-slate-100" /></div>
          <div className="flex justify-between"><span className="h-2 w-16 rounded bg-slate-100" /><span className="h-2 w-8 rounded bg-slate-100" /></div>
          <div className="flex justify-between pt-1"><span className="h-2.5 w-12 rounded bg-slate-200" /><span className="h-2.5 w-14 rounded bg-slate-200" /></div>
        </div>
      </div>
      {logo ? (
        <div className="mt-3 flex justify-center gap-2">
          <button type="button" onClick={open} className="h-9 px-3.5 rounded-full border border-slate-200 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Cambiar
          </button>
          <button type="button" onClick={() => onChange('')} className="h-9 px-3.5 rounded-full border border-slate-200 text-[13px] font-semibold text-slate-500 hover:bg-slate-50 flex items-center gap-1.5">
            <X className="w-3.5 h-3.5" /> Quitar
          </button>
        </div>
      ) : (
        <p className="mt-3 text-center text-[12.5px] text-slate-400">PNG o JPG. Mejor con fondo blanco o transparente.</p>
      )}
    </div>
  );
}

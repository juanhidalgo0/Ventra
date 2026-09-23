import { useState } from 'react';
import { Download, Share, PlusSquare } from 'lucide-react';
import { usePwaInstall } from '../../utils/pwaInstall';
import { Sheet } from './ui';

/**
 * Tarjeta "Instalá Ventra en tu celular". Con Chrome/Android instala con un toque;
 * en iPhone abre los pasos de Safari. No aparece si la app ya está instalada.
 */
export default function InstallAppCard({ className = '' }: { className?: string }) {
  const { mode, install } = usePwaInstall();
  const [iosHelp, setIosHelp] = useState(false);
  if (!mode) return null;

  return (
    <>
      <button
        onClick={() => (mode === 'prompt' ? install() : setIosHelp(true))}
        className={`w-full flex items-center gap-3 rounded-2xl bg-white border border-slate-200/80 p-3.5 text-left active:scale-[0.99] transition-transform ${className}`}
      >
        <img src="icon-192.png" alt="" className="w-11 h-11 rounded-xl shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-[14.5px] font-semibold text-slate-900">Instalá Ventra en tu celular</span>
          <span className="block text-[12px] text-slate-500">Se abre desde la pantalla de inicio, como una app.</span>
        </span>
        <span className="h-9 px-3 rounded-full bg-rose-600 text-white text-[12.5px] font-semibold flex items-center gap-1 shrink-0">
          <Download className="w-3.5 h-3.5" /> Instalar
        </span>
      </button>

      <Sheet open={iosHelp} onClose={() => setIosHelp(false)} title="Instalar en iPhone">
        <ol className="space-y-4 pt-1 pb-2">
          <li className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-rose-50 text-rose-700 text-[13px] font-bold flex items-center justify-center shrink-0">1</span>
            <span className="text-[14.5px] text-slate-700 pt-0.5">Abrí esta página en <b>Safari</b>.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-rose-50 text-rose-700 text-[13px] font-bold flex items-center justify-center shrink-0">2</span>
            <span className="text-[14.5px] text-slate-700 pt-0.5">Tocá <Share className="inline w-4 h-4 -mt-0.5 text-sky-600" /> <b>Compartir</b>, abajo en el centro.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-rose-50 text-rose-700 text-[13px] font-bold flex items-center justify-center shrink-0">3</span>
            <span className="text-[14.5px] text-slate-700 pt-0.5">Elegí <PlusSquare className="inline w-4 h-4 -mt-0.5" /> <b>Agregar a pantalla de inicio</b> y después <b>Agregar</b>.</span>
          </li>
        </ol>
      </Sheet>
    </>
  );
}

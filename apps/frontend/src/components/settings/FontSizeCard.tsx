import { useEffect, useState } from 'react';
import { Type } from 'lucide-react';
import { SettingsCard } from './SettingsUI';
import { canZoom, getUiZoom, setUiZoom, ZOOM_STEPS, ZOOM_LABELS, ZOOM_EVENT } from '../../utils/uiZoom';

/** Tamaño de la letra de esta PC: para quien no ve bien la pantalla o la tiene lejos del mostrador. */
export default function FontSizeCard() {
  const [zoom, setZoom] = useState(getUiZoom());
  const desktop = canZoom();

  useEffect(() => {
    const on = (e: Event) => setZoom(Number((e as CustomEvent).detail) || 1);
    window.addEventListener(ZOOM_EVENT, on);
    return () => window.removeEventListener(ZOOM_EVENT, on);
  }, []);

  return (
    <SettingsCard icon={Type} title="Tamaño de la letra" scope="pc"
      description={desktop ? 'Agranda toda la pantalla, también la caja.' : 'En el navegador se cambia con el teclado.'}>
      {desktop ? (
        <>
          <div className="mt-4 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Tamaño de la letra">
            {ZOOM_STEPS.map((s) => (
              <button key={s} role="radio" aria-checked={zoom === s} onClick={() => setUiZoom(s).then(setZoom)}
                className={`rounded-xl border py-2.5 flex flex-col items-center gap-1 transition-colors ${zoom === s ? 'border-rose-500 bg-rose-50 text-rose-700 ring-2 ring-rose-500/20' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                <span className="font-bold leading-none" style={{ fontSize: `${Math.round(15 * s)}px` }}>Aa</span>
                <span className="text-[11px] font-semibold">{ZOOM_LABELS[s]}</span>
              </button>
            ))}
          </div>
          <p className="text-[12.5px] text-slate-500 mt-3">Atajos: <b>Ctrl +</b> agranda, <b>Ctrl −</b> achica y <b>Ctrl 0</b> vuelve a normal.</p>
        </>
      ) : (
        <p className="mt-3 text-[13px] text-slate-600 leading-relaxed">
          Usá <b>Ctrl y +</b> para agrandar, <b>Ctrl y −</b> para achicar y <b>Ctrl y 0</b> para volver a normal. El navegador lo recuerda para la próxima vez.
        </p>
      )}
    </SettingsCard>
  );
}

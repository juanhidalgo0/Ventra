import { useEffect, useState } from 'react';
import { WifiOff, X, RefreshCw, Check } from 'lucide-react';
import { OFFLINE_EVENT, dataState } from '../../services/offlineStart';

const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const hour = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return new Date().toDateString() === d.toDateString()
    ? `de hoy a las ${hour}`
    : `del ${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })} a las ${hour}`;
};

/**
 * Arriba, chico: si lo que se ve no está al día. "Actualizando datos" mientras se bajan los
 * nuevos (se ven los guardados en el equipo), "Sin señal" si no hay conexión, y un instante
 * "Datos al día" cuando terminó (ver services/offlineStart).
 */
export default function OfflineStartBanner({ inline = false }: { inline?: boolean }) {
  const [st, setSt] = useState(dataState());
  const [hidden, setHidden] = useState(false);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const next = dataState();
      setSt(next);
      setHidden(false);
      if (!next.mode && Date.now() - next.justUpdatedAt < 1500) {
        setShowDone(true);
        window.setTimeout(() => setShowDone(false), 2200);
      }
    };
    window.addEventListener(OFFLINE_EVENT, onChange);
    // Lo que cambió entre que se dibujó y se suscribió (arranca justo cuando la app se abre)
    setSt(dataState());
    return () => window.removeEventListener(OFFLINE_EVENT, onChange);
  }, []);

  // En el celular es una franja propia arriba de todo: empuja el contenido, no lo tapa.
  // En la PC, una píldora chica arriba al centro.
  const pill = inline
    ? 'keep-style shrink-0 w-full flex items-center gap-2.5 pl-4 pr-2 pt-[calc(env(safe-area-inset-top)+0.4rem)] pb-1.5 border-b'
    : 'keep-style fixed top-2 left-1/2 -translate-x-1/2 z-[9500] w-[calc(100%-24px)] max-w-md flex items-center gap-2.5 pl-3.5 pr-1.5 py-2 rounded-2xl border shadow-sm';
  if (showDone && !st.mode) {
    return (
      <div role="status" className={`${pill} pr-3.5 bg-emerald-50 border-emerald-200 text-emerald-900`}>
        <Check className="w-4 h-4 shrink-0" />
        <p className="flex-1 min-w-0 text-[13px] font-semibold">Datos al día</p>
      </div>
    );
  }
  if (!st.mode || hidden) return null;
  const updating = st.mode === 'updating';
  return (
    <div role="status" className={`${pill} ${updating ? 'bg-sky-50 border-sky-200 text-sky-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
      {updating ? <RefreshCw className="w-4 h-4 shrink-0 animate-spin keep-animated" /> : <WifiOff className="w-4 h-4 shrink-0" />}
      <p className="flex-1 min-w-0 text-[12.5px] leading-snug">
        {updating
          ? <><strong>Actualizando datos…</strong> Mientras tanto ves los {when(st.since)}.</>
          : <><strong>Sin señal.</strong> Usás los datos {when(st.since)}. Lo que cargues se guarda y se manda solo.</>}
      </p>
      <button onClick={() => setHidden(true)} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-black/5 cursor-pointer shrink-0" aria-label="Ocultar aviso">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

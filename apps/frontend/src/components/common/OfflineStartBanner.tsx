import { useEffect, useState } from 'react';
import { WifiOff, X } from 'lucide-react';
import { OFFLINE_EVENT, offlineStartedWith } from '../../services/offlineStart';

/**
 * La app arrancó sin señal con lo último que bajó este equipo (ver services/offlineStart).
 * Se avisa arriba, chico, y desaparece solo cuando el servidor vuelve a contestar.
 */
export default function OfflineStartBanner() {
  const [since, setSince] = useState<string | null>(offlineStartedWith());
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const onChange = () => { setSince(offlineStartedWith()); setHidden(false); };
    window.addEventListener(OFFLINE_EVENT, onChange);
    return () => window.removeEventListener(OFFLINE_EVENT, onChange);
  }, []);
  if (!since || hidden) return null;
  const d = new Date(since);
  const today = new Date().toDateString() === d.toDateString();
  const hour = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const when = today ? `de hoy a las ${hour}` : `del ${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })} a las ${hour}`;
  return (
    <div role="status" className="keep-style fixed top-2 left-1/2 -translate-x-1/2 z-[9500] w-[calc(100%-24px)] max-w-md flex items-center gap-2.5 pl-3.5 pr-1.5 py-2 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 shadow-sm">
      <WifiOff className="w-4 h-4 shrink-0" />
      <p className="flex-1 min-w-0 text-[12.5px] leading-snug">
        <strong>Sin señal.</strong> Usás los datos {when}. Lo que cargues se guarda y se manda solo.
      </p>
      <button onClick={() => setHidden(true)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-amber-100 cursor-pointer shrink-0" aria-label="Ocultar aviso">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

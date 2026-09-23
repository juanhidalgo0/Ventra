import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BellRing, ChevronRight } from 'lucide-react';
import { pushState, enablePush, registerPushToken, type PushState } from '../../services/pushNotifications';

/** Invita a activar los avisos de pedidos nuevos en el celular. Desaparece una vez activados. */
export default function PushCard() {
  const [state, setState] = useState<PushState>(pushState());
  const [busy, setBusy] = useState(false);

  // Con permiso ya dado, se renueva el registro en silencio (los tokens cambian)
  useEffect(() => { if (state === 'granted') registerPushToken().catch(() => {}); }, [state]);

  if (state === 'unsupported' || state === 'granted') return null;
  if (state === 'denied') {
    return (
      <div className="w-full rounded-2xl bg-white border border-slate-200/80 p-4 text-[12.5px] text-slate-500">
        Los avisos están bloqueados. Para recibirlas, activá las notificaciones de Ventra en los ajustes del celular.
      </div>
    );
  }
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const s = await enablePush();
          setState(s);
          if (s === 'granted') toast.success('Listo: las notificaciones quedaron activadas');
        } catch (e: any) {
          toast.error(e?.message || 'No se pudieron activar los avisos');
        } finally { setBusy(false); }
      }}
      className="w-full flex items-center gap-3 rounded-2xl bg-rose-600 text-white p-4 text-left active:scale-[0.99] transition-transform disabled:opacity-70"
    >
      <span className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center shrink-0"><BellRing className="w-5 h-5" /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold">Activar notificaciones</span>
        <span className="block text-[12px] text-rose-100">Pedidos, cierres de caja, stock bajo y más, aunque la app esté cerrada.</span>
      </span>
      <ChevronRight className="w-4 h-4 text-white/70" />
    </button>
  );
}

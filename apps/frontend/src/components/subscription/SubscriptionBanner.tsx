import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Lock } from 'lucide-react';
import api from '../../services/api';
import { openExternal, SUBSCRIPTION_CHANGED, type SubscriptionStatus } from './SubscriptionPanel';

/** Franja superior cuando la suscripción está en gracia o en solo lectura. */
export default function SubscriptionBanner() {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const load = () => api.get('/subscription/status').then(({ data }) => alive && setStatus(data)).catch(() => {});
    load();
    const interval = window.setInterval(load, 5 * 60 * 1000);
    window.addEventListener(SUBSCRIPTION_CHANGED, load);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener(SUBSCRIPTION_CHANGED, load);
    };
  }, []);

  if (!status || !['GRACE', 'READ_ONLY', 'NEEDS_LINK'].includes(status.state)) return null;

  if (status.state === 'NEEDS_LINK') {
    return (
      <div role="alert" className="keep-style mx-2 md:mx-0 mb-3 px-4 py-2.5 rounded-xl border bg-red-50 border-red-200 text-red-800 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] font-semibold">
        <Lock className="w-4 h-4 shrink-0" />
        <span className="flex-1 min-w-[200px]">Esta PC no está vinculada a una suscripción: no se puede vender hasta vincularla con tu cuenta de Ventra.</span>
        <button onClick={() => navigate('/settings?tab=suscripcion')} className="h-8 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[12px] font-bold">
          Vincular esta PC
        </button>
      </div>
    );
  }

  const readOnly = status.state === 'READ_ONLY';
  const days = status.daysLeft ?? 0;
  const text = readOnly
    ? 'Suscripción vencida: Ventra está en modo solo lectura. No se pueden hacer ventas ni registrar cambios.'
    : days === 0
      ? 'Tu suscripción venció: hoy es el último día de gracia.'
      : `Tu suscripción venció: ${days === 1 ? 'queda 1 día' : `quedan ${days} días`} de gracia.`;

  return (
    <div
      role="alert"
      className={`keep-style mx-2 md:mx-0 mb-3 px-4 py-2.5 rounded-xl border flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] font-semibold ${
        readOnly ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'
      }`}
    >
      {readOnly ? <Lock className="w-4 h-4 shrink-0" /> : <Clock className="w-4 h-4 shrink-0" />}
      <span className="flex-1 min-w-[200px]">{text}</span>
      <button onClick={() => openExternal('https://ventra.store/#planes')} className={`h-8 px-3 rounded-lg text-white text-[12px] font-bold ${readOnly ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
        Renovar
      </button>
      <button onClick={() => navigate('/settings?tab=suscripcion')} className="h-8 px-3 rounded-lg border border-current/30 text-[12px] font-bold hover:bg-white/60">
        Ver suscripción
      </button>
    </div>
  );
}

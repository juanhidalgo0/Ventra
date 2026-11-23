import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Bell, BellRing, LogOut, CalendarX } from 'lucide-react';
import AgendaScreen, { AgendaProCtx } from './AgendaScreen';
import { useAuthStore } from '../../stores/authStore';
import { enablePush, pushState, registerPushToken, type PushState } from '../../services/pushNotifications';
import api from '../../services/api';
import { ensureVentraSession, sessionProStaffId } from '../../services/ventraFirebase';

const narrow = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches;

/**
 * Lo que ve un profesional de la agenda con usuario propio (barbero, estilista...): solo su
 * agenda, sin la caja ni los menús del comercio. La nube igual le deja ver y tocar solo sus
 * turnos (firestore.rules), esto es para no mostrarle pantallas que no le sirven.
 */
export default function ProAgendaShell({ staffId }: { staffId: string }) {
  const logout = useAuthStore((s) => s.logout);
  const [mobile, setMobile] = useState(narrow);
  const [push, setPush] = useState<PushState>(() => pushState());
  // La sesión de la nube del profesional: si no se abre (sin internet, o le sacaron el acceso) se dice
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    ensureVentraSession()
      .then(() => { if (alive && sessionProStaffId() !== staffId) setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [staffId, attempt]);

  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 767px)');
    if (!mq) return;
    const on = () => setMobile(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  // Celular ya habilitado: se renueva su token (los avisos de sus turnos van a su sesión)
  useEffect(() => { registerPushToken().catch(() => {}); }, []);
  // Si el dueño le cambió o le sacó el acceso, se entera sin volver a entrar
  useEffect(() => {
    api.get('/auth/me', { silent: true } as any).then(({ data }) => {
      const current = useAuthStore.getState().user;
      if (data?.id && current?.id === data.id) useAuthStore.getState().setUser({ ...current, ...data });
    }).catch(() => {});
  }, []);

  const turnOnPush = async () => {
    try {
      const st = await enablePush();
      setPush(st);
      if (st === 'granted') toast.success('Listo: te avisamos cuando te reserven un turno');
      else if (st === 'denied') toast.error('Los avisos están bloqueados en este navegador. Habilitalos desde la configuración del celular.');
    } catch {
      toast.error('No se pudieron activar los avisos');
    }
  };
  const exit = () => {
    if (window.confirm('¿Salir de tu agenda? Para volver a entrar vas a necesitar tu usuario y tu clave.')) logout();
  };

  const round = 'w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0 active:bg-white/25 ag-press';
  const pill = 'ag-press h-10 px-4 rounded-xl bg-white border border-slate-200 text-[13.5px] font-semibold text-slate-700 flex items-center gap-2';
  const canPush = push === 'default';
  const actions = mobile ? (
    <span className="flex items-center gap-1.5">
      {canPush && <button onClick={turnOnPush} className={round} aria-label="Activar avisos"><Bell className="w-5 h-5" /></button>}
      <button onClick={exit} className={round} aria-label="Salir"><LogOut className="w-5 h-5" /></button>
    </span>
  ) : (
    <>
      {canPush && <button onClick={turnOnPush} className={pill}><BellRing className="w-4 h-4" /> Avisarme de mis turnos</button>}
      <button onClick={exit} className={pill}><LogOut className="w-4 h-4" /> Salir</button>
    </>
  );

  return (
    <AgendaProCtx.Provider value={staffId}>
      <div className={`${mobile ? 'mobile-app h-[100dvh]' : 'h-screen'} flex flex-col bg-slate-50`}>
        {failed ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3">
            <CalendarX className="w-10 h-10 text-slate-300" />
            <p className="text-[16px] font-bold text-slate-900">No pudimos abrir tu agenda</p>
            <p className="text-[13.5px] text-slate-500 max-w-sm">Revisá que tengas internet. Si sigue igual, pedile al dueño del local que revise tu acceso en la agenda.</p>
            <div className="flex gap-2">
              <button onClick={() => setAttempt((n) => n + 1)} className="h-11 px-5 rounded-xl bg-rose-600 text-white text-[14px] font-semibold">Reintentar</button>
              <button onClick={exit} className="h-11 px-5 rounded-xl bg-white border border-slate-200 text-[14px] font-semibold text-slate-700">Salir</button>
            </div>
          </div>
        ) : <AgendaScreen proActions={actions} forceMobile={mobile} />}
      </div>
    </AgendaProCtx.Provider>
  );
}

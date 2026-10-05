import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, ExternalLink, KeyRound, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { openExternal } from '../../utils/externalLinks';
import { useAuthStore } from '../../stores/authStore';
import { wsService } from '../../services/websocket';

/**
 * "Olvidé la contraseña del administrador" (ver PasswordRecoveryService en el backend):
 * se entra con la cuenta de Google de la suscripción en el navegador y se elige una
 * contraseña nueva para un administrador. Reemplaza a la clave maestra.
 */

/** Dirección de la página de Google: solo localhost o el dominio propio están autorizados en Firebase. */
function recoveryPageUrl(id: string): string | null {
  const base = String(api.defaults.baseURL || '/api');
  const abs = base.startsWith('http') ? new URL(base) : new URL(base, window.location.origin);
  const host = abs.hostname;
  if (host === '127.0.0.1' || host === 'localhost') abs.hostname = 'localhost';
  else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null; // caja conectada por red a otra PC
  return `${abs.origin}${abs.pathname.replace(/\/$/, '')}/auth/recover/page?id=${id}`;
}

export default function AdminRecovery({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'start' | 'waiting' | 'choose'>('start');
  const [req, setReq] = useState<{ id: string; hint: string } | null>(null);
  const [admins, setAdmins] = useState<{ username: string; fullName: string }[]>([]);
  const [username, setUsername] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const open = async () => {
    setError('');
    setBusy(true);
    try {
      const { data } = req ? { data: req } : await api.post('/auth/recover/start');
      const url = recoveryPageUrl(data.id);
      if (!url) {
        setError('Esto se hace desde la PC principal del local (la que tiene el servidor de Ventra).');
        return;
      }
      setReq(data);
      openExternal(url);
      setStep('waiting');
      if (poll.current) clearInterval(poll.current);
      const startedAt = Date.now();
      poll.current = setInterval(async () => {
        if (Date.now() - startedAt > 10 * 60 * 1000) {
          clearInterval(poll.current!);
          setReq(null);
          setStep('start');
          setError('Pasaron 10 minutos. Empezá de nuevo.');
          return;
        }
        try {
          const { data: st } = await api.get('/auth/recover/status', { params: { id: data.id }, silent: true } as any);
          if (!st.verified) return;
          clearInterval(poll.current!);
          setAdmins(st.admins || []);
          setUsername(st.admins?.[0]?.username || '');
          setStep('choose');
        } catch (err: any) {
          if (err.response?.status === 404) {
            clearInterval(poll.current!);
            setReq(null);
            setStep('start');
            setError('El pedido venció. Empezá de nuevo.');
          }
        }
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo empezar. Revisá internet y probá de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{4,}$/.test(pass)) return setError('La contraseña va solo con números, de al menos 4.');
    if (pass !== pass2) return setError('Las dos contraseñas no coinciden.');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/recover/reset', { id: req!.id, username, newPassword: pass });
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      useAuthStore.setState({ user: data.user, isAuthenticated: true, isLoading: false });
      wsService.connect();
      toast.success(`Listo: ${data.user.username} tiene contraseña nueva`);
      navigate('/pos');
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo guardar');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-7 relative" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="absolute top-4 right-4 w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center">
          <X className="w-4 h-4" />
        </button>
        <div className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
          {step === 'choose' ? <KeyRound className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
        </div>

        {step === 'start' && (
          <>
            <h2 className="text-lg font-bold text-slate-900">Recuperar el acceso de administrador</h2>
            <p className="text-[13.5px] text-slate-600 mt-2 leading-relaxed">
              Se abre el navegador para que entres con la <b>cuenta de Google con la que pagás Ventra</b>. Después elegís una contraseña nueva para el administrador.
            </p>
            <button type="button" onClick={open} disabled={busy} className="mt-5 w-full h-12 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ExternalLink className="w-4 h-4" />} Entrar con Google
            </button>
          </>
        )}

        {step === 'waiting' && (
          <>
            <h2 className="text-lg font-bold text-slate-900">Terminá en el navegador</h2>
            <p className="text-[13.5px] text-slate-600 mt-2 leading-relaxed">
              Entrá con Google con la cuenta <b>{req?.hint}</b>. Cuando termine, esta ventana sigue sola.
            </p>
            <div className="mt-5 flex items-center gap-3 text-[13px] text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-rose-600" /> Esperando la cuenta de Google…
            </div>
            <button type="button" onClick={open} className="mt-4 text-[13px] font-semibold text-rose-600 hover:underline">No se abrió el navegador: abrirlo de nuevo</button>
          </>
        )}

        {step === 'choose' && (
          <form onSubmit={save}>
            <h2 className="text-lg font-bold text-slate-900">Contraseña nueva</h2>
            {admins.length === 0 ? (
              <p className="text-[13.5px] text-slate-600 mt-2">Este comercio no tiene administradores activos. Escribile a soporte.</p>
            ) : (
              <>
                <label className="block text-[11px] font-bold text-rose-600 uppercase tracking-widest mt-4 mb-1.5">Administrador</label>
                <select value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 text-sm font-semibold">
                  {admins.map((a) => <option key={a.username} value={a.username}>{a.username}{a.fullName && a.fullName !== a.username ? ` · ${a.fullName}` : ''}</option>)}
                </select>
                <label className="block text-[11px] font-bold text-rose-600 uppercase tracking-widest mt-4 mb-1.5">Contraseña nueva (solo números)</label>
                <input type="password" inputMode="numeric" value={pass} onChange={(e) => setPass(e.target.value.replace(/\D/g, ''))} autoFocus className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 text-sm font-semibold" />
                <label className="block text-[11px] font-bold text-rose-600 uppercase tracking-widest mt-3 mb-1.5">Repetila</label>
                <input type="password" inputMode="numeric" value={pass2} onChange={(e) => setPass2(e.target.value.replace(/\D/g, ''))} className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 text-sm font-semibold" />
                <button type="submit" disabled={busy || !pass || !pass2} className="mt-5 w-full h-12 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                  {busy && <Loader2 className="w-5 h-5 animate-spin" />} Guardar y entrar
                </button>
                <p className="text-[11.5px] text-slate-500 mt-3">Se guarda en todas las cajas del comercio.</p>
              </>
            )}
          </form>
        )}

        {error && <p className="mt-4 text-[13px] font-semibold text-red-600">{error}</p>}
      </div>
    </div>
  );
}

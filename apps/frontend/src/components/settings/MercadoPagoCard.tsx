import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import { AlertTriangle, BadgeCheck, CreditCard, ExternalLink, Loader2, Plus, RotateCw, Search, Smartphone, Unlink, Wallet } from 'lucide-react';
import api from '../../services/api';
import { openExternal } from '../subscription/SubscriptionPanel';
import { getPointTerminals, setPointTerminals, terminalLabel, type PointTerminalChoice } from '../../utils/mpPoint';
import { comingSoon } from '../../utils/comingSoon';
import { ComingSoonCard } from '../common/ComingSoon';

interface MpConnection {
  connected: boolean;
  nickname?: string | null;
  email?: string | null;
  name?: string | null;
  liveMode?: boolean;
  connectedAt?: string | null;
  needsReconnect?: boolean;
  countTransfers?: boolean;
}

interface Pending { url: string; qr: string; expiresAt: number }

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }) : null;

/**
 * Configuración → Integraciones: conexión de la cuenta de Mercado Pago del comercio.
 * Se conecta escaneando un QR con el celular (autorización oficial de Mercado Pago);
 * los tokens quedan en la nube de Ventra, nunca en esta PC.
 */
export default function MercadoPagoCard() {
  if (comingSoon('mercadoPago')) {
    return (
      <ComingSoonCard
        title="Mercado Pago"
        description="Muy pronto vas a poder conectar tu cuenta para cobrar con el Point desde la caja y cuadrar los cobros automáticamente en el cierre."
        icon={Wallet}
      />
    );
  }
  return <MercadoPagoCardActive />;
}

function MercadoPagoCardActive() {
  const [status, setStatus] = useState<MpConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = async () => {
    try {
      const { data } = await api.get('/mercadopago/status');
      setStatus(data);
      setError(null);
      return data as MpConnection;
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo consultar Mercado Pago.');
      return null;
    }
  };

  useEffect(() => {
    load();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  // Con el QR a la vista, preguntar cada 3 s si ya se autorizó en el celular
  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (!pending) return;
    const before = status?.connectedAt ?? null;
    pollRef.current = window.setInterval(async () => {
      if (Date.now() > pending.expiresAt) {
        setPending(null);
        toast.error('El código venció. Generá uno nuevo.');
        return;
      }
      try {
        const { data } = await api.get('/mercadopago/status');
        if (data.connected && data.connectedAt !== before && !data.needsReconnect) {
          setStatus(data);
          setPending(null);
          toast.success('¡Mercado Pago quedó conectado!');
        }
      } catch { /* reintenta en el próximo ciclo */ }
    }, 3000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const connect = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/mercadopago/connect');
      const qr = await QRCode.toDataURL(data.url, { margin: 1, width: 440, errorCorrectionLevel: 'M' });
      setPending({ url: data.url, qr, expiresAt: Date.now() + (data.expiresInSeconds || 900) * 1000 });
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo iniciar la conexión');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('¿Desconectar la cuenta de Mercado Pago? Ventra deja de poder cobrar con la maquinita y de ver los pagos recibidos.')) return;
    setBusy(true);
    try {
      const { data } = await api.post('/mercadopago/disconnect');
      setPointTerminals([]);
      setStatus(data);
      toast.success('Mercado Pago desconectado');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo desconectar');
    } finally {
      setBusy(false);
    }
  };

  const setCountTransfers = async (value: boolean) => {
    setBusy(true);
    try {
      const { data } = await api.post('/mercadopago/settings', { countTransfers: value });
      setStatus(data);
      toast.success(value ? 'Las transferencias recibidas ahora cuentan como cobros' : 'Las transferencias recibidas ya no cuentan');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const who = status?.nickname || status?.email || status?.name || 'Cuenta de Mercado Pago';

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 flex items-center justify-center shrink-0">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white tracking-tight">Mercado Pago</h3>
            <p className="text-[13px] text-slate-500 mt-0.5">
              Conectá la cuenta del comercio para que Ventra controle los cobros con Mercado Pago y cuadre la caja.
            </p>
          </div>
        </div>
        {status?.connected && !status.needsReconnect && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-semibold whitespace-nowrap bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800">
            <BadgeCheck className="w-3.5 h-3.5" /> Conectado
          </span>
        )}
      </div>

      {!status && !error && (
        <p className="text-[13px] text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Consultando…</p>
      )}

      {error && !status && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-[13px] text-amber-900 dark:text-amber-200 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {status?.connected && !pending && (
        <div className="space-y-3">
          {status.needsReconnect && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-[13px] text-amber-900 dark:text-amber-200 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Mercado Pago dejó de autorizar a Ventra (se quitó el permiso o venció). Volvé a conectar la cuenta.</span>
            </div>
          )}
          <dl className="grid sm:grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <dt className="text-slate-500">Cuenta</dt>
              <dd className="font-bold text-slate-900 dark:text-white mt-0.5 break-all">{who}</dd>
              {status.email && status.email !== who && <dd className="text-slate-500 text-[12px] break-all">{status.email}</dd>}
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <dt className="text-slate-500">Conectada</dt>
              <dd className="font-bold text-slate-900 dark:text-white mt-0.5">{fmtDate(status.connectedAt) || '—'}</dd>
              {status.liveMode === false && <dd className="text-amber-700 text-[12px] font-semibold">Cuenta de prueba</dd>}
            </div>
          </dl>
          {!status.needsReconnect && (
            <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-3 cursor-pointer select-none">
              <span>
                <span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Contar transferencias recibidas</span>
                <span className="block text-[12px] text-slate-500 leading-snug">
                  Activalo si tus clientes te pagan por transferencia a esta cuenta. Dejalo apagado si es una cuenta personal
                  donde entran transferencias que no son del negocio: así solo cuentan los cobros con QR y maquinita.
                </span>
              </span>
              <input
                type="checkbox"
                checked={!!status.countTransfers}
                disabled={busy}
                onChange={(e) => setCountTransfers(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-rose-600 cursor-pointer shrink-0"
              />
            </label>
          )}
          {!status.needsReconnect && <PointTerminalSection />}
        </div>
      )}

      {pending && (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 p-5 flex flex-col sm:flex-row items-center gap-5">
          <img src={pending.qr} alt="Código QR para conectar Mercado Pago" className="w-44 h-44 rounded-xl bg-white p-2 shrink-0" />
          <div className="space-y-2 text-center sm:text-left">
            <p className="text-[14px] font-bold text-slate-900 dark:text-white flex items-center justify-center sm:justify-start gap-2">
              <Smartphone className="w-4 h-4" /> Escaneá el código con tu celular
            </p>
            <ol className="text-[13px] text-slate-600 dark:text-slate-300 space-y-1 list-decimal pl-5 text-left">
              <li>Abrí la cámara y apuntá al código.</li>
              <li>Entrá con la cuenta de Mercado Pago <b>del negocio</b> (la de las maquinitas).</li>
              <li>Tocá <b>Autorizar</b>. Esta pantalla se actualiza sola.</li>
            </ol>
            <p className="text-[12px] text-slate-500 flex items-center justify-center sm:justify-start gap-1.5 pt-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Esperando la autorización… (el código vence a los 15 minutos)
            </p>
            <div className="flex flex-wrap justify-center sm:justify-start gap-x-4 gap-y-1 pt-1">
              <button onClick={() => openExternal(pending.url)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-rose-600 hover:underline">
                Prefiero hacerlo en esta PC <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setPending(null)} className="text-[13px] font-semibold text-slate-500 hover:underline">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {status && !pending && (
        <div className="flex flex-wrap gap-2 pt-1">
          {(!status.connected || status.needsReconnect) && (
            <button onClick={connect} disabled={busy} className="h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold inline-flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
              {status.connected ? 'Volver a conectar' : 'Conectar Mercado Pago'}
            </button>
          )}
          {status.connected && (
            <button onClick={disconnect} disabled={busy} className="h-10 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-[13px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60">
              <Unlink className="w-4 h-4" /> Desconectar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface Terminal { id: string; operatingMode: string | null; posId: string | number | null; externalPosId: string | null }

/**
 * Maquinitas Point que usa ESTA caja (una o varias, cada una con un nombre). Con alguna
 * elegida, en el POS "Mercado Pago" manda el monto a la maquinita y la venta queda
 * registrada solo si el pago se aprueba.
 */
function PointTerminalSection() {
  const [chosen, setChosen] = useState<PointTerminalChoice[]>(() => getPointTerminals());
  const [list, setList] = useState<Terminal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [restartHint, setRestartHint] = useState(false);

  const save = (next: PointTerminalChoice[]) => {
    setPointTerminals(next);
    setChosen(next);
  };

  const search = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/mercadopago/terminals');
      setList(data.terminals || []);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudieron buscar las maquinitas');
    } finally {
      setLoading(false);
    }
  };

  const add = async (t: Terminal) => {
    setLoading(true);
    try {
      if (t.operatingMode !== 'PDV') {
        await api.post('/mercadopago/terminals/pdv', { terminalId: t.id });
        setRestartHint(true);
      }
      save([...chosen, { id: t.id, label: t.externalPosId ? `Caja ${t.externalPosId}` : `Maquinita ${chosen.length + 1}` }]);
      toast.success('Maquinita agregada a esta caja');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo configurar la maquinita');
    } finally {
      setLoading(false);
    }
  };

  const rename = (id: string, label: string) => save(chosen.map((c) => (c.id === id ? { ...c, label } : c)));

  const remove = (id: string) => {
    const c = chosen.find((x) => x.id === id);
    if (!window.confirm(`¿Quitar "${c?.label}" de esta caja?${chosen.length === 1 ? ' Mercado Pago vuelve a registrarse a mano, sin control.' : ''}`)) return;
    save(chosen.filter((x) => x.id !== id));
  };

  const available = list?.filter((t) => !chosen.some((c) => c.id === t.id)) ?? null;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <div>
        <h4 className="text-[14px] font-bold text-slate-900 dark:text-white">Maquinitas de esta caja</h4>
        <p className="text-[12.5px] text-slate-500 mt-0.5">
          {chosen.length
            ? 'Al cobrar con Mercado Pago, el monto aparece solo en la maquinita y la venta se registra cuando el pago se aprueba.' + (chosen.length > 1 ? ' Con varias, el cajero elige en cuál cobra.' : '')
            : 'Agregá las Point de esta caja para que el POS les mande el monto. Así ninguna venta queda cargada como Mercado Pago sin haberse cobrado.'}
        </p>
      </div>

      {chosen.length > 0 && (
        <ul className="space-y-2">
          {chosen.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3">
              <CreditCard className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0" />
              <div className="min-w-0 flex-1">
                <input
                  value={c.label}
                  onChange={(e) => rename(c.id, e.target.value.slice(0, 30))}
                  onBlur={(e) => { if (!e.target.value.trim()) rename(c.id, terminalLabel(c.id)); }}
                  aria-label="Nombre de la maquinita"
                  className="w-full bg-transparent text-[13px] font-bold text-slate-900 dark:text-white outline-none border-b border-transparent focus:border-emerald-500"
                />
                <p className="text-[11.5px] text-slate-500">{terminalLabel(c.id)} · tocá el nombre para cambiarlo</p>
              </div>
              <button onClick={() => remove(c.id)} className="text-[12px] font-semibold text-slate-500 hover:text-red-600 shrink-0">Quitar</button>
            </li>
          ))}
        </ul>
      )}

      {restartHint && (
        <div className="rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 p-3 text-[13px] text-sky-900 dark:text-sky-200 flex gap-2">
          <RotateCw className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <b>Reiniciá la maquinita</b> (apagala y prendela). Después, en la maquinita, <i>Más opciones → Configuraciones → Modo de vinculación</i> tiene que decir <b>Punto de Venta (PDV)</b>.
          </span>
        </div>
      )}

      {available && (
        available.length === 0 ? (
          <p className="text-[13px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
            {list && list.length
              ? 'Todas las maquinitas de la cuenta ya están agregadas a esta caja.'
              : <>No encontramos maquinitas Point en esta cuenta. Revisá que la Point esté vinculada a la misma cuenta de Mercado Pago que conectaste (en la app: <i>Tu negocio → Point</i>) y volvé a buscar.</>}
          </p>
        ) : (
          <ul className="space-y-2">
            {available.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-slate-900 dark:text-white">{terminalLabel(t.id)}</p>
                  <p className="text-[12px] text-slate-500">
                    {t.operatingMode === 'PDV' ? 'Modo punto de venta' : 'Modo independiente (se pasa a punto de venta al agregarla)'}
                    {t.externalPosId ? ` · Caja ${t.externalPosId}` : ''}
                  </p>
                </div>
                <button onClick={() => add(t)} disabled={loading} className="h-9 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[12.5px] font-bold disabled:opacity-50 shrink-0 inline-flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> Agregar
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      <button onClick={search} disabled={loading} className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        {chosen.length ? 'Agregar otra maquinita' : 'Buscar maquinitas'}
      </button>
    </div>
  );
}

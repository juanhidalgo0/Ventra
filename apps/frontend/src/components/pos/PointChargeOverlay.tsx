import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, RotateCw, X } from 'lucide-react';
import api from '../../services/api';
import { getLastPointTerminalId, setLastPointTerminalId, type PointTerminalChoice } from '../../utils/mpPoint';
import { watchPointOrder } from '../../services/mpOrderWatch';

type Phase = 'choose' | 'sending' | 'waiting' | 'at_terminal' | 'paid' | 'failed' | 'error';

interface Order {
  id: string;
  status: string | null;
  statusDetail: string | null;
  reference: string;
}

const POLL_MS = 2000;
/** Con el aviso en vivo de Mercado Pago, la consulta queda solo de respaldo */
const POLL_LIVE_MS = 8000;
/** La order vence a los 5 min en Mercado Pago; un poco más y se deja de esperar */
const GIVE_UP_MS = 6 * 60 * 1000;

const FAILED_TEXT: Record<string, string> = {
  canceled: 'El cobro se canceló.',
  expired: 'El cobro venció: nadie pagó en la maquinita.',
  failed: 'El pago fue rechazado.',
  refunded: 'El pago fue devuelto.',
};

/**
 * Cobro de Mercado Pago en la maquinita Point: manda el monto, espera a que el cliente
 * pague y recién ahí avisa (onPaid) para registrar la venta. Si no se paga, la venta no
 * se registra como Mercado Pago.
 */
export default function PointChargeOverlay({
  amount,
  terminals,
  formatPrice,
  onPaid,
  onBack,
  onManual,
}: {
  amount: number;
  /** Maquinitas de esta caja: con más de una, el cajero elige en cuál cobra */
  terminals: PointTerminalChoice[];
  formatPrice: (n: number) => string;
  onPaid: (reference: string) => void;
  onBack: () => void;
  /** Registrar igual como Mercado Pago sin confirmar (sin internet o maquinita rota) */
  onManual: () => void;
}) {
  const [terminal, setTerminal] = useState<PointTerminalChoice | null>(() => (terminals.length === 1 ? terminals[0] : null));
  const [highlight, setHighlight] = useState(() => Math.max(0, terminals.findIndex((t) => t.id === getLastPointTerminalId())));
  const [phase, setPhase] = useState<Phase>(terminals.length === 1 ? 'sending' : 'choose');
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const orderRef = useRef<Order | null>(null);
  const doneRef = useRef(false);

  // Manda el cobro y consulta hasta que se paga, se cancela o vence
  useEffect(() => {
    if (!terminal) return;
    setLastPointTerminalId(terminal.id);
    let alive = true;
    let timer: number | undefined;
    let live = false;
    let stopWatch: (() => void) | null = null;
    const startedAt = Date.now();
    doneRef.current = false;
    orderRef.current = null;
    setPhase('sending');
    setMessage(null);

    const finish = (o: Order) => {
      if (doneRef.current) return;
      if (o.status === 'processed') {
        doneRef.current = true;
        setPhase('paid');
        // Un instante para que el cajero vea el "aprobado"
        window.setTimeout(() => onPaid(o.reference), 700);
        return true;
      }
      if (o.status && FAILED_TEXT[o.status]) {
        doneRef.current = true;
        setPhase('failed');
        setMessage(FAILED_TEXT[o.status]);
        return true;
      }
      setPhase(o.status === 'at_terminal' || o.status === 'action_required' ? 'at_terminal' : 'waiting');
      return false;
    };

    const poll = async () => {
      if (!alive || doneRef.current || !orderRef.current) return;
      try {
        const { data } = await api.get(`/mercadopago/point/orders/${orderRef.current.id}`);
        setOffline(false);
        if (!alive) return;
        orderRef.current = data;
        if (finish(data)) return;
      } catch (err: any) {
        if (!alive) return;
        if (err.response?.status === 409) {
          setPhase('error');
          setMessage(err.response.data?.message || 'Mercado Pago no está conectado.');
          return;
        }
        setOffline(true); // sin internet: se sigue intentando
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setPhase('error');
        setMessage('La maquinita no respondió. Fijate en la maquinita si el pago salió aprobado antes de volver a cobrar.');
        return;
      }
      timer = window.setTimeout(poll, live ? POLL_LIVE_MS : POLL_MS);
    };

    (async () => {
      try {
        const externalReference = `ventra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const { data } = await api.post('/mercadopago/point/charge', { terminalId: terminal.id, amount, externalReference, description: 'Venta' });
        if (!alive) return;
        orderRef.current = data;
        if (finish(data)) return;
        timer = window.setTimeout(poll, POLL_MS);
        // Aviso en vivo: Mercado Pago avisa a la nube y la nube a esta caja
        stopWatch = watchPointOrder(data.id, (o) => {
          if (!alive || doneRef.current) return;
          orderRef.current = o;
          finish(o);
        }, () => { live = true; });
      } catch (err: any) {
        if (!alive) return;
        setPhase('error');
        setMessage(err.response?.data?.message || 'No se pudo mandar el cobro a la maquinita. Revisá internet.');
      }
    })();

    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
      stopWatch?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, terminal]);

  const pick = (t: PointTerminalChoice) => {
    setTerminal(t);
    setAttempt((a) => a + 1);
  };

  /** Después de un fallo: volver a elegir maquinita (por si el cliente pasa a otra) */
  const chooseAgain = () => {
    setTerminal(null);
    setPhase('choose');
    setMessage(null);
  };

  const cancel = async () => {
    const o = orderRef.current;
    if (!o || phase === 'choose' || phase === 'error' || phase === 'failed') return onBack();
    if (phase === 'at_terminal') {
      setMessage('El cliente ya está pagando: cancelalo desde la maquinita.');
      return;
    }
    try {
      await api.post(`/mercadopago/point/orders/${o.id}/cancel`);
      doneRef.current = true;
      onBack();
    } catch (err: any) {
      setMessage(err.response?.data?.message || 'No se pudo cancelar: cancelalo desde la maquinita.');
    }
  };

  // Escape = cancelar (la ventana de cobro de atrás no recibe teclas mientras tanto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'choose') {
        const n = Number(e.key);
        if (n >= 1 && n <= terminals.length) { e.preventDefault(); e.stopImmediatePropagation(); pick(terminals[n - 1]); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); setHighlight((h) => (h + 1) % terminals.length); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); setHighlight((h) => (h - 1 + terminals.length) % terminals.length); return; }
        if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); pick(terminals[highlight]); return; }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const confirmManual = () => {
    if (window.confirm('¿Ya cobraste este monto en la maquinita de Mercado Pago?\n\nLa venta se registra como Mercado Pago SIN confirmar y queda marcada para revisar en el cierre.')) {
      onManual();
    }
  };

  const waiting = phase === 'sending' || phase === 'waiting' || phase === 'at_terminal';
  const title = {
    choose: '¿En qué maquinita cobrás?',
    sending: 'Enviando el cobro a la maquinita…',
    waiting: 'Pasale la maquinita al cliente',
    at_terminal: 'El cliente está pagando…',
    paid: '¡Pago aprobado!',
    failed: 'El pago no se completó',
    error: 'No se pudo cobrar con la maquinita',
  }[phase];

  return (
    // Los clics no llegan al fondo de la ventana de cobro (que se cierra al tocarlo)
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="card w-full max-w-md p-7 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex justify-center mb-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
            phase === 'paid' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'
              : phase === 'failed' || phase === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300'
              : 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300'}`}>
            {phase === 'paid' ? <CheckCircle2 className="w-9 h-9" /> : phase === 'failed' || phase === 'error' ? <AlertTriangle className="w-8 h-8" /> : <CreditCard className="w-8 h-8" />}
          </div>
        </div>

        <p className="text-[12px] font-bold uppercase tracking-widest text-slate-500">Mercado Pago{terminal ? ` · ${terminal.label}` : ''}</p>
        <p className="text-4xl font-bold text-slate-900 dark:text-white tabular-nums my-2">{formatPrice(amount)}</p>
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h2>

        {waiting && (
          <p className="mt-2 text-[13px] text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {offline ? 'Sin conexión, reintentando…' : phase === 'at_terminal' ? 'Esperando que Mercado Pago apruebe el pago' : 'El monto ya aparece en la pantalla de la maquinita'}
          </p>
        )}
        {phase === 'choose' && (
          <div className="mt-4 grid gap-2">
            {terminals.map((t, i) => (
              <button
                key={t.id}
                onClick={() => pick(t)}
                onMouseEnter={() => setHighlight(i)}
                className={`h-12 px-4 rounded-xl border-2 text-left flex items-center gap-3 transition-colors ${i === highlight
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
              >
                <span className="w-7 h-7 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-[13px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="text-[15px] font-bold text-slate-900 dark:text-white truncate">{t.label}</span>
                <CreditCard className="w-4 h-4 text-slate-400 ml-auto shrink-0" />
              </button>
            ))}
          </div>
        )}
        {message && <p className="mt-3 text-[13px] text-slate-700 dark:text-slate-300">{message}</p>}

        <div className="mt-6 flex flex-col gap-2">
          {(phase === 'failed' || phase === 'error') && (
            <button onClick={() => setAttempt((a) => a + 1)} className="h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-bold inline-flex items-center justify-center gap-2">
              <RotateCw className="w-4 h-4" /> Volver a mandar el cobro
            </button>
          )}
          {(phase === 'failed' || phase === 'error') && terminals.length > 1 && (
            <button onClick={chooseAgain} className="h-11 rounded-xl border border-slate-300 dark:border-slate-700 text-[14px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800">
              <CreditCard className="w-4 h-4" /> Cobrar en otra maquinita
            </button>
          )}
          {phase !== 'paid' && (
            <button onClick={cancel} className="h-11 rounded-xl border border-slate-300 dark:border-slate-700 text-[14px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800">
              <X className="w-4 h-4" /> {phase === 'choose' ? 'Volver (Esc)' : waiting ? 'Cancelar cobro (Esc)' : 'Elegir otro medio de pago'}
            </button>
          )}
          {phase === 'error' && (
            <button onClick={confirmManual} className="text-[12.5px] font-semibold text-slate-500 hover:underline mt-1">
              Ya lo cobré en la maquinita: registrar sin confirmar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

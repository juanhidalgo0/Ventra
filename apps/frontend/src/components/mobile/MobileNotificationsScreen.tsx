import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ShoppingBag, CalendarDays, CalendarClock, Timer, Wallet, FileWarning, PackageMinus, Ban, Sunset, Moon, Send } from 'lucide-react';
import { ScreenHeader, ListSkeleton } from './ui';
import PushCard from './PushCard';
import { loadNotifyPrefs, saveNotifyPrefs, pushState, testLocalNotification, testPushFromCloud, DEFAULT_NOTIFY_PREFS, type NotifyPrefs } from '../../services/pushNotifications';

type BoolKey = 'orders' | 'orderIdle' | 'bookings' | 'cashDiff' | 'invoiceFail' | 'lowStock' | 'expiry' | 'mpUnmatched' | 'saleCancel' | 'dailySummary';

const ITEMS: { key: BoolKey; icon: any; tint: string; title: string; text: string }[] = [
  { key: 'orders', icon: ShoppingBag, tint: 'bg-emerald-50 text-emerald-700', title: 'Pedidos online nuevos', text: 'Apenas un cliente hace un pedido en tu tienda.' },
  { key: 'orderIdle', icon: Timer, tint: 'bg-emerald-50 text-emerald-700', title: 'Pedido sin atender', text: 'Si pasan 15 minutos y nadie lo empezó a preparar.' },
  { key: 'bookings', icon: CalendarDays, tint: 'bg-rose-50 text-rose-700', title: 'Turnos nuevos', text: 'Cuando un cliente reserva un turno desde tu tienda.' },
  { key: 'cashDiff', icon: Wallet, tint: 'bg-red-50 text-red-700', title: 'Cierre de caja con diferencia', text: 'Cuando el efectivo contado no coincide con el esperado.' },
  { key: 'lowStock', icon: PackageMinus, tint: 'bg-amber-50 text-amber-700', title: 'Stock mínimo', text: 'Cuando un producto llega a su stock mínimo. Se agrupan en un solo aviso y cada producto avisa una vez hasta que lo repongas.' },
  { key: 'expiry', icon: CalendarClock, tint: 'bg-amber-50 text-amber-700', title: 'Vencimientos', text: 'Una vez por día, si hay productos vencidos o por vencer.' },
  { key: 'mpUnmatched', icon: Wallet, tint: 'bg-sky-50 text-sky-700', title: 'Pagos de Mercado Pago sin venta', text: 'Si entra un pago a Mercado Pago y la venta se cargó con otro medio (o no se cargó).' },
  { key: 'invoiceFail', icon: FileWarning, tint: 'bg-red-50 text-red-700', title: 'Factura rechazada', text: 'Si ARCA no acepta una factura.' },
  { key: 'saleCancel', icon: Ban, tint: 'bg-slate-100 text-slate-700', title: 'Ventas anuladas', text: 'Cuando se anula una venta de $20.000 o más.' },
  { key: 'dailySummary', icon: Sunset, tint: 'bg-sky-50 text-sky-700', title: 'Resumen del día', text: 'Cuánto vendiste hoy, comparado con el mismo día de la semana pasada.' },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Qué notificaciones recibe el dueño en el celular, y el horario de silencio. */
export default function MobileNotificationsScreen() {
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);

  useEffect(() => {
    loadNotifyPrefs().then(setPrefs).catch(() => { setPrefs(DEFAULT_NOTIFY_PREFS); toast.error('No se pudieron cargar tus preferencias'); });
  }, []);

  const change = async (patch: Partial<NotifyPrefs>) => {
    if (!prefs) return;
    const prev = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try { await saveNotifyPrefs(next); }
    catch { setPrefs(prev); toast.error('No se pudo guardar. Revisá la conexión.'); }
  };

  const state = pushState();
  const [testing, setTesting] = useState(false);

  const runTest = async () => {
    setTesting(true);
    try {
      await testLocalNotification();
      const r = await testPushFromCloud();
      if (!r.devices) toast.error('Este celular no quedó registrado en la nube');
      else if (!r.sent) toast.error(`La nube no pudo entregar el aviso (${(r.errors || []).join(', ') || 'sin detalle'})`);
      else toast.success(`Enviado a ${r.sent} de ${r.devices} celular${r.devices > 1 ? 'es' : ''}. Debería llegar en unos segundos.`);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo probar');
    } finally { setTesting(false); }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader back title="Notificaciones" subtitle="Elegí qué avisos te llegan al celular" />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
        <PushCard />
        {state === 'unsupported' && (
          <p className="text-[12.5px] text-slate-500 bg-white rounded-2xl border border-slate-200/80 p-4">
            Para recibir notificaciones, instalá Ventra en el celular (botón "Instalar app") y entrá desde el ícono.
          </p>
        )}

        {state === 'granted' && (
          <button disabled={testing} onClick={runTest} className="w-full flex items-center gap-3 rounded-2xl bg-white border border-slate-200/80 p-4 text-left active:scale-[0.99] disabled:opacity-60">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50 text-emerald-700"><Send className="w-[18px] h-[18px]" /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14.5px] font-semibold text-slate-800">{testing ? 'Enviando…' : 'Enviar aviso de prueba'}</span>
              <span className="block text-[12px] text-slate-500 leading-snug">Llegan dos: uno armado en el celular y otro desde la nube.</span>
            </span>
          </button>
        )}

        {!prefs ? <ListSkeleton rows={6} /> : (
          <>
            <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100">
              {ITEMS.map(({ key, icon: Icon, tint, title, text }) => (
                <button key={key} onClick={() => change({ [key]: !prefs[key] } as Partial<NotifyPrefs>)} className="w-full flex items-center gap-3 p-4 text-left">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tint}`}><Icon className="w-[18px] h-[18px]" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14.5px] font-semibold text-slate-800">{title}</span>
                    <span className="block text-[12px] text-slate-500 leading-snug">{text}</span>
                  </span>
                  <Switch on={prefs[key]} />
                </button>
              ))}
            </div>

            {prefs.dailySummary && (
              <div className="bg-white rounded-2xl border border-slate-200/80 p-4 flex items-center justify-between gap-3">
                <span className="text-[14px] font-medium text-slate-700">Hora del resumen</span>
                <select value={prefs.summaryHour} onChange={(e) => change({ summaryHour: Number(e.target.value) })} className="h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[14px]">
                  {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                </select>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-indigo-50 text-indigo-700"><Moon className="w-[18px] h-[18px]" /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14.5px] font-semibold text-slate-800">Horario de silencio</span>
                  <span className="block text-[12px] text-slate-500 leading-snug">En ese horario no te llegan avisos, salvo los pedidos. El stock bajo te llega al terminar el silencio.</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="text-[12px] text-slate-500">Desde
                  <select value={prefs.quietFrom} onChange={(e) => change({ quietFrom: Number(e.target.value) })} className="mt-1 w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[14px] text-slate-800">
                    {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                  </select>
                </label>
                <label className="text-[12px] text-slate-500">Hasta
                  <select value={prefs.quietTo} onChange={(e) => change({ quietTo: Number(e.target.value) })} className="mt-1 w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[14px] text-slate-800">
                    {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                  </select>
                </label>
              </div>
              {prefs.quietFrom === prefs.quietTo && <p className="mt-2 text-[12px] text-slate-400">Con el mismo horario, el silencio queda desactivado.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={`w-12 h-7 rounded-full p-0.5 transition-colors shrink-0 ${on ? 'bg-rose-600' : 'bg-slate-300'}`}>
      <span className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </span>
  );
}

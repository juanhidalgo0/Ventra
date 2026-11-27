import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { X, Copy, Gift, Loader2, MessageCircle, Check } from 'lucide-react';
import api from '../../services/api';
import { openExternal } from '../../utils/externalLinks';
import { useVentri, VentriImg } from '../common/Ventri';

/**
 * "Invitá un comercio": el link propio del dueño. El invitado prueba Ventra 30 días (en vez de 7)
 * y cuando paga su primer mes, el dueño gana un mes gratis (se le devuelve su próximo cobro).
 * La cuenta y los meses viven en la nube (firebase/functions/referrals.js).
 */
const OPEN_EVENT = 'ventra:invite-store';
export const openInviteStore = () => window.dispatchEvent(new Event(OPEN_EVENT));

interface Referral {
  linked: boolean;
  code?: string;
  link?: string;
  invited?: number;
  paying?: number;
  credits?: number;
  earned?: number;
  maxPerYear?: number;
  leftThisYear?: number;
}

const message = (link: string) =>
  `¡Hola! Uso Ventra para el negocio: la caja, el stock, las boletas con una foto y los cierres. Me re sirve. Con mi link lo probás 30 días gratis: ${link}`;

export default function InviteStore() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Referral | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ventri = useVentri();

  useEffect(() => {
    const onOpen = () => { setOpen(true); setError(null); setData(null); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.get<Referral>('/subscription/referral')
      .then(({ data: d }) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e?.response?.status === 403 ? 'Solo el dueño puede invitar comercios.' : 'No hay conexión con ventra.store. Revisá internet y probá de nuevo.'); });
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const copy = async () => {
    if (!data?.link) return;
    try {
      await navigator.clipboard.writeText(message(data.link));
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
      toast.success('Mensaje copiado: pegalo donde quieras');
    } catch { toast.error('No se pudo copiar'); }
  };
  const whatsapp = () => data?.link && openExternal(`https://wa.me/?text=${encodeURIComponent(message(data.link))}`);

  return createPortal(
    <div className="fixed inset-0 z-[9300] bg-slate-900/55 flex items-end sm:items-center justify-center sm:p-4 anim-veil" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="invite-title" onClick={(e) => e.stopPropagation()}
        className="keep-style w-full sm:max-w-md max-h-[92vh] overflow-y-auto custom-scrollbar bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl anim-pop">
        <div className="relative px-6 pt-6 pb-5 text-white" style={{ background: 'linear-gradient(150deg,#062e23 0%,#0b5a43 55%,#17925f 100%)' }}>
          <button onClick={() => setOpen(false)} aria-label="Cerrar" className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] font-extrabold uppercase tracking-[0.16em] text-white/70">Invitá un comercio</p>
              <h2 id="invite-title" className="mt-1 text-[24px] leading-[1.1] font-black">Ganá un mes <span className="text-yellow-300">gratis</span> por cada comercio que se sume</h2>
            </div>
            {ventri ? <VentriImg cara="guino" size={74} entra /> : <Gift className="w-12 h-12 text-yellow-300 shrink-0" />}
          </div>
        </div>

        <div className="px-6 py-5">
          {!data && !error && <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
          {error && <p className="py-4 text-[14px] text-slate-600 dark:text-slate-300">{error}</p>}
          {data && !data.linked && (
            <div className="py-2 text-[14px] text-slate-600 dark:text-slate-300 leading-relaxed">
              <p className="font-semibold text-slate-900 dark:text-slate-100">Esta caja todavía no está vinculada a tu cuenta de ventra.store.</p>
              <p className="mt-1.5">Vinculala desde Configuración → Suscripción y vas a tener tu link para invitar.</p>
            </div>
          )}
          {data?.linked && data.link && (
            <>
              <ol className="space-y-3">
                {[
                  ['Mandale tu link', 'A otro comercio: el de enfrente, un proveedor, un amigo.'],
                  ['Prueba 30 días gratis', 'Con tu link tiene un mes entero de prueba, en vez de 7 días.'],
                  ['Vos ganás un mes', 'Cuando paga su primer mes, tu próximo mes de Ventra sale gratis.'],
                ].map(([t, d], k) => (
                  <li key={t} className="flex gap-3">
                    <span className="w-7 h-7 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[13px] font-black flex items-center justify-center shrink-0">{k + 1}</span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-bold text-slate-900 dark:text-slate-100">{t}</span>
                      <span className="block text-[12.5px] text-slate-500 dark:text-slate-400 leading-snug">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>

              <div className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3.5 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tu link</p>
                <p className="mt-0.5 text-[14px] font-semibold text-slate-900 dark:text-slate-100 break-all select-all">{data.link.replace('https://', '')}</p>
              </div>

              <div className="mt-3 flex gap-2">
                <button onClick={whatsapp} className="flex-1 h-11 rounded-xl bg-[#25D366] hover:brightness-95 text-white text-[14px] font-bold flex items-center justify-center gap-2">
                  <MessageCircle className="w-4.5 h-4.5" /> Mandar por WhatsApp
                </button>
                <button onClick={copy} className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-[13.5px] font-semibold flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} Copiar
                </button>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                {[
                  [data.invited || 0, (data.invited || 0) === 1 ? 'se anotó' : 'se anotaron'],
                  [data.paying || 0, 'ya pagan'],
                  [data.earned || 0, (data.earned || 0) === 1 ? 'mes ganado' : 'meses ganados'],
                ].map(([n, l]) => (
                  <div key={String(l)} className="rounded-xl bg-slate-50 dark:bg-slate-800/60 py-2.5">
                    <p className="text-[20px] font-black text-slate-900 dark:text-slate-100 tabular-nums">{n}</p>
                    <p className="text-[11.5px] text-slate-500 dark:text-slate-400">{l}</p>
                  </div>
                ))}
              </div>
              {(data.credits || 0) > 0 && (
                <p className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200 text-[13px] font-semibold px-3.5 py-2.5">
                  🎁 Tenés {data.credits === 1 ? '1 mes gratis para usar: se aplica en tu próximo cobro.' : `${data.credits} meses gratis para usar: se aplican en tus próximos cobros.`}
                </p>
              )}
              <p className="mt-4 text-[11.5px] text-slate-400 leading-snug">
                Hasta {data.maxPerYear || 12} meses por año. El mes gratis se aplica en tu próximo cobro: Mercado Pago te cobra y Ventra te lo devuelve en el acto. Cuenta solo para comercios nuevos en Ventra.
              </p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronUp, Sparkles, Smartphone, X } from 'lucide-react';
import QRCode from 'qrcode';
import { usePlanStore, planHome, PLANS, type PlanId } from '../../stores/planStore';

const PLANS_URL = 'https://ventra.store/#planes';

/**
 * La demo vista como en un celular, desde la PC: la misma app dentro de un iframe de ancho
 * de teléfono (la app decide su versión por el ancho, así que se ve igual que en uno real).
 * El iframe comparte la sesión y el plan elegido. Y un QR para abrirla en el celular propio.
 */
function PhonePreview({ onClose }: { onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  // Arranca en la pantalla actual; el celular del dueño abre en su inicio
  const src = window.location.href;
  useEffect(() => {
    QRCode.toDataURL(window.location.origin, { margin: 1, width: 220 }).then(setQr).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[95] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center gap-10 p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="relative shrink-0 bg-slate-950 rounded-[46px] p-3 shadow-2xl ring-1 ring-white/10"
        style={{ width: 390 + 24, height: 'min(868px, calc(100vh - 48px))' }}>
        <span className="absolute top-5 left-1/2 -translate-x-1/2 w-24 h-6 rounded-full bg-black z-10" />
        <iframe title="Ventra en el celular" src={src} className="w-full h-full rounded-[36px] bg-white border-0" />
      </div>
      <div onClick={(e) => e.stopPropagation()} className="hidden lg:block w-[260px] text-white">
        <p className="text-[22px] font-bold leading-tight">Así lo ve el dueño en su celular</p>
        <p className="mt-2 text-[14px] text-white/70">Es la app real: tocá, cobrá y navegá como en un teléfono. Para probarla en el tuyo, escaneá el código.</p>
        {qr && <img src={qr} alt="QR para abrir la demo en el celular" className="mt-5 w-40 h-40 rounded-2xl bg-white p-2" />}
        <button onClick={onClose} className="mt-6 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-[13.5px] font-semibold flex items-center gap-2"><X className="w-4 h-4" /> Volver a la PC</button>
      </div>
      <button onClick={onClose} className="lg:hidden absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center" aria-label="Cerrar"><X className="w-5 h-5" /></button>
    </div>
  );
}

/**
 * Solo en la demo pública: qué plan se está probando y cómo cambiarlo sin salir, para
 * comparar Caja, Tienda, Agenda y Full con los mismos datos. Y el atajo a contratarlo.
 */
export default function DemoPlanSwitcher({ mobile }: { mobile: boolean }) {
  const navigate = useNavigate();
  const { isDemo, plan, setDemoPlan } = usePlanStore();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Lo que se cambie adentro del celular (por ejemplo el plan) se ve al volver
  const closePhone = () => { setPhone(false); usePlanStore.getState().load(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [open]);

  if (!isDemo || !plan || !(plan in PLANS)) return null;
  const current = plan as PlanId;

  const pick = (id: PlanId) => {
    setOpen(false);
    if (id === current) return;
    setDemoPlan(id);
    navigate(planHome(PLANS[id].features, mobile), { replace: true });
  };

  return (
    <>
    <div ref={ref} className="fixed left-1/2 -translate-x-1/2 z-[85]"
      style={{ bottom: mobile ? 'calc(env(safe-area-inset-bottom) + 78px)' : '16px' }}>
      {open && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-[300px] bg-white rounded-2xl border border-slate-200 shadow-2xl p-2">
          <p className="px-2.5 pt-1.5 pb-2 text-[12px] font-semibold text-slate-500">Probá la demo como…</p>
          {(['caja', 'tienda', 'agenda', 'full'] as PlanId[]).map((id) => (
            <button key={id} onClick={() => pick(id)}
              className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left ${id === current ? 'bg-rose-50' : 'hover:bg-slate-50'}`}>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-bold text-slate-900">{PLANS[id].name}</span>
                <span className="block text-[12px] text-slate-500">{PLANS[id].tagline}</span>
              </span>
              {id === current && <Check className="w-4 h-4 text-rose-600 shrink-0" />}
            </button>
          ))}
          <a href={PLANS_URL} target="_blank" rel="noopener"
            className="mt-1.5 flex items-center justify-center h-10 rounded-xl bg-rose-600 text-white text-[13.5px] font-bold">
            Contratar {PLANS[current].name}
          </a>
        </div>
      )}
      <div className="flex items-center rounded-full bg-slate-900 text-white shadow-xl">
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="h-10 pl-3 pr-3 rounded-full flex items-center gap-2 text-[13px] font-semibold whitespace-nowrap">
          <Sparkles className="w-4 h-4 text-amber-300" />
          <span className="text-white/70">Demo ·</span> {PLANS[current].name}
          <ChevronUp className={`w-4 h-4 transition-transform ${open ? '' : 'rotate-180'}`} />
        </button>
        {!mobile && (
          <button onClick={() => { setOpen(false); setPhone(true); }} title="Ver cómo se ve en el celular"
            className="h-10 pl-3 pr-3.5 border-l border-white/15 flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap hover:bg-white/10 rounded-r-full">
            <Smartphone className="w-4 h-4" /> Ver en celular
          </button>
        )}
      </div>
    </div>
    {/* Fuera de la barra: su transform haría que el "fixed" del marco se ubique respecto de ella */}
    {phone && <PhonePreview onClose={closePhone} />}
    </>
  );
}

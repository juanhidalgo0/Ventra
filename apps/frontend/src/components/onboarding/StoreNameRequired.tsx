import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Store } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { setStoreSetting, whenStoreSettingsReady, STORE_SETTINGS_EVENT } from '../../services/storeSettings';
import { IS_DEMO_BUILD } from '../../demo/flag';

const hasName = () => (localStorage.getItem('gd_store_name') || '').trim().length >= 2;
/** "Más tarde": no se vuelve a pedir hasta que se abra Ventra de nuevo */
const LATER_KEY = 'store_name_later';
const postponed = () => { try { return sessionStorage.getItem(LATER_KEY) === '1'; } catch { return false; } };
/** Nunca encima de la caja: pedir el nombre no puede frenar una venta */
const SELLING_PATHS = ['/pos', '/inicio'];

/**
 * El nombre del comercio sale en los tickets, las notas de venta, los remitos y las facturas.
 * Si el dueño entra y no está cargado (salteó la bienvenida, o el comercio ya trabajaba antes
 * de que se pidiera), se le pide acá. Nunca bloquea las ventas: no aparece en la caja, se puede
 * dejar para más tarde (vuelve a aparecer al abrir Ventra de nuevo) y los cajeros no lo ven.
 * Mientras la bienvenida del primer uso está abierta no aparece: ella misma lo pregunta.
 */
export default function StoreNameRequired({ mobile }: { mobile: boolean }) {
  const role = useAuthStore((s) => s.user?.role);
  const { pathname } = useLocation();
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (role !== 'ADMIN' || IS_DEMO_BUILD) { setShow(false); return; }
    let alive = true;
    const check = () => {
      if (!alive) return;
      // La bienvenida (onboarding_done sin marcar) pregunta el nombre ella misma
      setShow(!hasName() && !postponed() && localStorage.getItem('onboarding_done') === '1');
    };
    whenStoreSettingsReady().then(check);
    // El nombre puede llegar de otra caja, o la bienvenida puede terminar sin él
    window.addEventListener(STORE_SETTINGS_EVENT, check);
    const timer = window.setInterval(check, 4000);
    return () => { alive = false; window.removeEventListener(STORE_SETTINGS_EVENT, check); window.clearInterval(timer); };
  }, [role]);

  if (!show || SELLING_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return null;

  const valid = name.trim().length >= 2;
  const later = () => {
    try { sessionStorage.setItem(LATER_KEY, '1'); } catch { /* sin almacenamiento: se cierra igual */ }
    setShow(false);
  };
  const save = () => {
    if (!valid) return;
    setStoreSetting('store_name', name.trim().slice(0, 60));
    setShow(false);
    toast.success('Nombre del comercio guardado');
  };

  return (
    <div className="fixed inset-0 z-[95] bg-slate-900/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center">
      <div role="dialog" aria-modal="true" aria-labelledby="store-name-title"
        className={`w-full sm:max-w-md bg-white shadow-2xl p-6 ${mobile ? 'rounded-t-3xl pb-[calc(env(safe-area-inset-bottom)+24px)]' : 'rounded-3xl'}`}>
        <div className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
          <Store className="w-5 h-5" />
        </div>
        <h2 id="store-name-title" className="text-[21px] font-bold text-slate-900 tracking-tight leading-tight">¿Cómo se llama tu comercio?</h2>
        <p className="mt-1.5 text-[14px] text-slate-500 leading-snug">
          Sale en los tickets, las notas de venta, los remitos y las facturas. Lo podés cambiar después en Configuración.
        </p>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder="Ej.: Distribuidora Don Pepe"
          className="mt-5 w-full h-13 py-3 px-4 rounded-2xl bg-slate-50 border-2 border-slate-200 text-[16px] font-semibold text-slate-900 outline-none focus:border-rose-500 focus:bg-white" />
        <button disabled={!valid} onClick={save}
          className="mt-4 w-full py-3.5 rounded-2xl bg-rose-600 text-white text-[15px] font-bold disabled:opacity-40 active:scale-[0.99] transition-transform">
          Guardar
        </button>
        <button onClick={later} className="mt-2 w-full py-2.5 rounded-2xl text-[13.5px] font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50">
          Más tarde
        </button>
      </div>
    </div>
  );
}

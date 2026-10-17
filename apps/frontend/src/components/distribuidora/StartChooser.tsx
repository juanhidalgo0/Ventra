import { Navigate, useNavigate } from 'react-router-dom';
import { useWorkRole, WORK_PATH } from '../../services/workRole';
import { ClipboardList, Truck, ShoppingCart, Check } from 'lucide-react';

/**
 * Distribuidora: cada equipo (el celular del vendedor, el del chofer, la PC del mostrador) dice
 * qué hace, y Ventra entra directo ahí. Se guarda en el equipo: no depende del usuario.
 */
export const DEVICE_START_KEY = 'ventra_device_start';
export type DeviceStart = 'preventa' | 'reparto' | 'pos';
export const deviceStart = (): DeviceStart | null => {
  try { const v = localStorage.getItem(DEVICE_START_KEY); return v === 'preventa' || v === 'reparto' || v === 'pos' ? v : null; } catch { return null; }
};
export const START_PATH: Record<DeviceStart, string> = { preventa: '/preventa', reparto: '/reparto', pos: '/pos' };

const OPTIONS: { key: DeviceStart; title: string; text: string; icon: any }[] = [
  { key: 'preventa', title: 'Tomar pedidos', text: 'Soy vendedor: recorro clientes y les tomo el pedido.', icon: ClipboardList },
  { key: 'reparto', title: 'Hacer el reparto', text: 'Soy chofer: entrego, cobro y rindo al volver.', icon: Truck },
  { key: 'pos', title: 'Venta de mostrador', text: 'Atiendo a los clientes que vienen al depósito.', icon: ShoppingCart },
];

export default function StartChooser() {
    const navigate = useNavigate();
  const current = deviceStart();
  // El dueño ya le dijo qué hace a este usuario: no hay nada que elegir
  const assigned = useWorkRole();
  if (assigned) return <Navigate to={WORK_PATH[assigned]} replace />;
  const choose = (k: DeviceStart) => {
    try { localStorage.setItem(DEVICE_START_KEY, k); } catch { /* sin almacenamiento: entra igual */ }
    navigate(START_PATH[k], { replace: true });
  };
  return (
    <div className="h-full overflow-y-auto bg-slate-50 flex items-start sm:items-center justify-center">
      <div className="w-full max-w-md px-5 py-8 space-y-5">
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-tight">¿Qué hacés con este equipo?</h1>
          <p className="text-[14px] text-slate-500 mt-1.5">Ventra va a abrir directo ahí cada vez que entres. Lo podés cambiar cuando quieras.</p>
        </div>
        <div className="space-y-2.5">
          {OPTIONS.map((o) => (
            <button key={o.key} onClick={() => choose(o.key)}
              className={`w-full text-left px-4 py-4 rounded-2xl border-2 bg-white flex items-center gap-4 cursor-pointer transition-colors active:scale-[0.99] ${current === o.key ? 'border-rose-600' : 'border-slate-200 hover:border-slate-300'}`}>
              <span className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0"><o.icon className="w-6 h-6" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-bold text-slate-900">{o.title}</span>
                <span className="block text-[13px] text-slate-500 leading-snug">{o.text}</span>
              </span>
              {current === o.key && <Check className="w-5 h-5 text-rose-600 shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

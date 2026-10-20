import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wallet, Receipt, LogOut, Repeat, Lock, ChevronRight } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useBusinessStore } from '../../stores/businessStore';
import { useWorkRole, workRoleLabel } from '../../services/workRole';
import { getClientId } from '../../utils/clientId';
import { ScreenHeader, Sheet, PrimaryButton, MoneyInput, money, parseAmount } from './ui';
import { useCashSession } from './useCashSession';
import ExpenseSheet from './ExpenseSheet';

/**
 * "Más" de un empleado en el celular: solo lo suyo. Su caja (cerrarla al terminar el turno),
 * anotar un gasto, cambiar lo que hace este equipo y cerrar sesión. Lo del negocio (reportes,
 * proveedores, configuración) es del dueño y no aparece.
 */
export default function StaffMoreScreen() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const role = useWorkRole();
  const distrib = useBusinessStore((s) => !!s.features.preorders);
  const sells = role !== 'CHOFER' && role !== 'VENDEDOR';
  const cash = useCashSession();
  const [expense, setExpense] = useState(false);
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);

  const closeCash = async () => {
    if (!cash.session) return;
    setBusy(true);
    try {
      await api.post(`/cash/${cash.session.id}/close`, { clientId: getClientId(), closingAmountCounted: parseAmount(counted), closingNotes: 'Cerrada desde el celular' });
      toast.success('Caja cerrada');
      setClosing(false);
      cash.refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cerrar la caja');
    } finally {
      setBusy(false);
    }
  };

  const row = (icon: any, title: string, text: string, onClick: () => void, tone = 'text-slate-800') => {
    const Icon = icon;
    return (
      <button onClick={onClick} className="w-full flex items-center gap-3 px-4 min-h-[60px] py-2.5 text-left active:bg-slate-50">
        <span className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0"><Icon className={`w-5 h-5 ${tone}`} /></span>
        <span className="flex-1 min-w-0">
          <span className={`block text-[15px] font-semibold ${tone}`}>{title}</span>
          {text && <span className="block text-[12.5px] text-slate-500 leading-snug">{text}</span>}
        </span>
        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
      </button>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader title={user?.fullName || user?.username || 'Mi cuenta'} subtitle={workRoleLabel(role) || 'Empleado'} />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-10">
        {sells && (
          <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden divide-y divide-slate-100">
            <div className="px-4 py-3 flex items-center gap-3">
              <span className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center shrink-0"><Wallet className="w-5 h-5 text-rose-600" /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-semibold text-slate-900">Mi caja</span>
                <span className="block text-[12.5px] text-slate-500">
                  {cash.loading ? 'Cargando…' : cash.session ? `Abierta en ${cash.session.terminalName}` : 'Cerrada. Se abre al vender.'}
                </span>
              </span>
            </div>
            {cash.session && row(Receipt, 'Anotar un gasto', 'Lo que pagaste con plata de la caja', () => setExpense(true))}
            {cash.session && row(Lock, 'Cerrar caja', 'Al terminar tu turno: contás el efectivo', () => { setCounted(''); setClosing(true); })}
          </section>
        )}

        {/* Pedidos y Reparto ya son pestañas de quien los usa */}
        {distrib && !role && (
          <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
            {row(Repeat, 'Cambiar lo que hago en este equipo', 'Tomar pedidos, reparto o mostrador', () => navigate('/empezar'))}
          </section>
        )}

        <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          {row(LogOut, 'Cerrar sesión', '', logout, 'text-red-600')}
        </section>
      </div>

      <ExpenseSheet open={expense} onClose={() => setExpense(false)} onSaved={() => { setExpense(false); cash.refresh(); }} />

      <Sheet open={closing} onClose={() => setClosing(false)} title="Cerrar caja"
        footer={<PrimaryButton onClick={closeCash} loading={busy} disabled={counted === ''}>Cerrar caja</PrimaryButton>}>
        <p className="text-[14px] text-slate-600 mb-3">¿Cuánto efectivo hay en el cajón? Contalo y anotalo: la diferencia la ve el dueño.</p>
        <MoneyInput value={counted} onChange={setCounted} autoFocus />
        {cash.session?.openingAmount > 0 && <p className="mt-2 text-[12.5px] text-slate-500">Arrancó con {money(cash.session.openingAmount)} de fondo.</p>}
      </Sheet>
    </div>
  );
}

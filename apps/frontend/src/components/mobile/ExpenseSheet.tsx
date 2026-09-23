import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Wallet } from 'lucide-react';
import api from '../../services/api';
import { Sheet, PrimaryButton, MoneyInput, EmptyState, money, parseAmount } from './ui';

/**
 * Mismas categorías y mismo formato de descripción que el POS de la PC (GastosModal):
 * "[Categoría] MOTIVO | METODO: CASH". Así la pantalla de Gastos de la PC los clasifica
 * igual (fijos / variables) sin importar desde dónde se cargaron.
 */
export const EXPENSE_CATEGORIES = [
  { id: 'Mercadería / Insumos', label: 'Mercadería', fixed: false },
  { id: 'Servicios (Luz, Agua, etc)', label: 'Servicios', fixed: true },
  { id: 'Sueldos / Adelantos', label: 'Sueldos', fixed: true },
  { id: 'Impuestos', label: 'Impuestos', fixed: true },
  { id: 'Mantenimiento', label: 'Mantenimiento', fixed: false },
  { id: 'Otro', label: 'Otro', fixed: false },
];
const WITHDRAWAL = 'Retiro a caja fuerte';

export function parseExpense(mov: any) {
  const desc: string = mov.description || '';
  const m = desc.match(/^\[(.+?)\]\s*(.*?)(?:\s*\|\s*METODO:\s*(\S+))?\s*$/);
  let category = m ? m[1] : 'Otro';
  if (!m && /liquidaci[oó]n de sueldo/i.test(desc)) category = 'Sueldos / Adelantos';
  const text = (m ? m[2] : desc).trim();
  const meta = EXPENSE_CATEGORIES.find((c) => c.id === category);
  return {
    category,
    label: meta?.label || category,
    fixed: meta?.fixed ?? false,
    text: text ? text.charAt(0) + text.slice(1).toLowerCase() : 'Gasto',
    method: m?.[3] === 'TRANSFER' ? 'Transferencia' : 'Efectivo',
  };
}

export default function ExpenseSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [sessions, setSessions] = useState<any[] | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(''); setCategory(''); setNote(''); setMethod('CASH'); setSessions(null);
    api.get('/cash/active')
      .then(({ data }) => {
        const list = (data || []).map((s: any) => ({ id: s.id, terminalName: s.terminalName, userName: s.user?.fullName }));
        setSessions(list);
        setSessionId(list[0]?.id || '');
      })
      .catch(() => setSessions([]));
  }, [open]);

  const value = parseAmount(amount);
  const isWithdrawal = category === WITHDRAWAL;
  const needsNote = !isWithdrawal;

  const save = async () => {
    if (!sessionId || value <= 0) return;
    if (!category) return toast.error('Elegí en qué se gastó');
    if (needsNote && !note.trim()) return toast.error('Escribí el motivo');
    setBusy(true);
    try {
      const mapped = isWithdrawal ? 'Otro' : category;
      const text = isWithdrawal ? 'RETIRO A CAJA FUERTE' : note.trim().toUpperCase();
      await api.post(`/cash/${sessionId}/movement`, {
        type: isWithdrawal ? 'WITHDRAWAL' : 'EXPENSE',
        amount: value,
        description: `[${mapped}] ${text} | METODO: ${method}`,
      });
      toast.success(isWithdrawal ? 'Retiro registrado' : 'Gasto cargado');
      onSaved();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const chip = (on: boolean) => `h-9 px-3.5 rounded-full border text-[13px] font-medium ${on ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Cargar gasto"
      footer={sessions && sessions.length > 0 ? (
        <PrimaryButton onClick={save} loading={busy} disabled={value <= 0 || !sessionId}>Guardar {value > 0 ? money(value) : ''}</PrimaryButton>
      ) : undefined}
    >
      {sessions === null ? (
        <div className="h-40 flex items-center justify-center"><span className="w-6 h-6 border-2 border-rose-200 border-t-rose-600 rounded-full animate-spin" /></div>
      ) : sessions.length === 0 ? (
        <EmptyState icon={Wallet} title="No hay cajas abiertas" text="Los gastos salen del efectivo de una caja. Abrí una caja para poder cargarlos." />
      ) : (
        <div className="space-y-5 pt-1">
          <MoneyInput value={amount} onChange={setAmount} autoFocus />

          <div>
            <p className="mb-2 text-[12.5px] font-medium text-slate-500">¿En qué se gastó?</p>
            <div className="flex flex-wrap gap-2">
              {EXPENSE_CATEGORIES.map((c) => (
                <button key={c.id} onClick={() => setCategory(c.id)} className={chip(category === c.id)}>{c.label}</button>
              ))}
              <button onClick={() => setCategory(WITHDRAWAL)} className={chip(isWithdrawal)}>Retiro a caja fuerte</button>
            </div>
            {needsNote && (
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Motivo (ej: pago de luz de agosto)"
                className="mt-3 w-full h-11 px-3.5 rounded-2xl bg-slate-100 text-[14px] outline-none focus:bg-white focus:ring-2 focus:ring-rose-200"
              />
            )}
          </div>

          {!isWithdrawal && (
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-slate-500">¿Cómo se pagó?</p>
              <div className="flex gap-2">
                <button onClick={() => setMethod('CASH')} className={chip(method === 'CASH')}>Efectivo de la caja</button>
                <button onClick={() => setMethod('TRANSFER')} className={chip(method === 'TRANSFER')}>Transferencia</button>
              </div>
            </div>
          )}

          {sessions.length > 1 ? (
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-slate-500">¿De qué caja?</p>
              <div className="space-y-2">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSessionId(s.id)}
                    className={`w-full flex items-center justify-between px-3.5 h-12 rounded-2xl border text-left ${sessionId === s.id ? 'border-rose-600 bg-rose-50' : 'border-slate-200 bg-white'}`}
                  >
                    <span className="text-[14px] font-medium text-slate-800">{s.terminalName}</span>
                    <span className="text-[12px] text-slate-500">{s.userName}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-500">Se registra en la caja {sessions[0].terminalName}.</p>
          )}
        </div>
      )}
    </Sheet>
  );
}

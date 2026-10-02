import { useEffect, useState } from 'react';
import { X, CalendarClock, RefreshCw, Trash2, Check } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../../services/api';
import { expiryLabel } from '../products/ExpiryLotsEditor';

interface Props { onClose: () => void; onChanged?: () => void }

const GROUPS = [
  { key: 'expired', title: 'Vencidos', test: (d: number) => d < 0 },
  { key: 'week', title: 'Vencen esta semana', test: (d: number) => d >= 0 && d <= 7 },
  { key: 'later', title: 'Próximos', test: (d: number) => d > 7 },
];

export default function ExpiringProductsModal({ onClose, onChanged }: Props) {
  const [lots, setLots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/products/expiring');
      setLots(data || []);
    } catch {
      toast.error('No se pudieron cargar los vencimientos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const act = async (lot: any, kind: 'writeoff' | 'remove') => {
    if (kind === 'writeoff' && !confirm(`¿Dar de baja ${lot.quantity || 0} u. de ${lot.product.name} como merma? Se descuentan del stock.`)) return;
    setBusyId(lot.id);
    try {
      if (kind === 'writeoff') await api.post(`/products/lots/${lot.id}/write-off`);
      else await api.patch(`/products/lots/${lot.id}`, { status: 'REMOVED' });
      setLots(l => l.filter(x => x.id !== lot.id));
      toast.success(kind === 'writeoff' ? 'Merma registrada' : 'Lote quitado');
      onChanged?.();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo actualizar el lote');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
            <CalendarClock className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-slate-800">Productos por vencer</h3>
            <p className="text-[12px] text-slate-500">Lotes vencidos o dentro del aviso configurado en cada producto</p>
          </div>
          <button onClick={load} className="p-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50" title="Refrescar">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {!loading && lots.length === 0 && (
            <p className="text-center text-sm text-slate-500 py-10">No hay productos por vencer. 🎉</p>
          )}
          {GROUPS.map(g => {
            const items = lots.filter(l => g.test(l.daysLeft));
            if (items.length === 0) return null;
            return (
              <section key={g.key}>
                <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-500 mb-2">{g.title} · {items.length}</h4>
                <div className="space-y-1.5">
                  {items.map(l => {
                    const lbl = expiryLabel(l.daysLeft);
                    return (
                      <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 px-3 py-2">
                        <div className="flex-1 min-w-[180px]">
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{l.product.name}</p>
                          <p className="text-[11.5px] text-slate-500">
                            {new Date(l.expiresAt).toLocaleDateString('es-AR')} · {l.quantity ? `${l.quantity} u. en el lote` : 'sin cantidad'} · stock {l.product.stock}
                          </p>
                        </div>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${lbl.cls}`}>{lbl.text}</span>
                        <button disabled={busyId === l.id} onClick={() => act(l, 'writeoff')}
                          className="h-8 px-2.5 rounded-lg border border-rose-200 text-rose-700 text-[12px] font-semibold flex items-center gap-1 hover:bg-rose-50 disabled:opacity-50">
                          <Trash2 className="w-3.5 h-3.5" /> Merma
                        </button>
                        <button disabled={busyId === l.id} onClick={() => act(l, 'remove')}
                          className="h-8 px-2.5 rounded-lg border border-slate-300 text-slate-700 text-[12px] font-semibold flex items-center gap-1 hover:bg-slate-50 disabled:opacity-50"
                          title="Ya no está en el local (se vendió o se retiró)">
                          <Check className="w-3.5 h-3.5" /> Ya no está
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

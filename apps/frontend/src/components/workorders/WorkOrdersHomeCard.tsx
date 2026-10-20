import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, Plus, ChevronRight } from 'lucide-react';
import api from '../../services/api';
import { useFeature } from '../../stores/businessStore';
import { dueLabel } from './workOrderUtils';

/** En el inicio (imprenta): lo que hay que entregar, con los atrasados primero. */
export default function WorkOrdersHomeCard() {
  const on = useFeature('workorders');
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[] | null>(null);
  useEffect(() => {
    if (!on) return;
    api.get('/work-orders', { params: { status: 'ACTIVOS' }, silent: true } as any).then(({ data }) => setOrders(data || [])).catch(() => setOrders([]));
  }, [on]);
  if (!on) return null;

  const now = Date.now();
  const list = orders || [];
  const late = list.filter((o) => o.dueAt && new Date(o.dueAt).getTime() < now).length;
  const today = list.filter((o) => { if (!o.dueAt) return false; const d = new Date(o.dueAt); return d.getTime() >= now && d.toDateString() === new Date().toDateString(); }).length;
  const ready = list.filter((o) => o.status === 'LISTO').length;
  const next = list.slice(0, 3);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="px-4 pt-3.5 pb-2 flex items-center gap-2">
        <span className="w-9 h-9 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center"><Printer className="w-[18px] h-[18px]" /></span>
        <p className="flex-1 text-[15px] font-semibold text-slate-900">Encargos</p>
        <button onClick={() => navigate('/encargos?nuevo=1')} className="h-9 px-3 rounded-xl bg-rose-600 text-white text-[13px] font-semibold flex items-center gap-1"><Plus className="w-4 h-4" /> Nuevo</button>
      </div>
      <div className="grid grid-cols-3 gap-2 px-4 pb-3">
        {[['Atrasados', late, late ? 'text-red-700' : 'text-slate-900'], ['Para hoy', today, 'text-slate-900'], ['Listos', ready, 'text-emerald-700']].map(([l, n, tone]) => (
          <div key={l as string} className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-[11.5px] text-slate-500">{l}</p>
            <p className={`text-[20px] font-bold tabular-nums ${tone}`}>{orders ? n : '—'}</p>
          </div>
        ))}
      </div>
      {next.length > 0 && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {next.map((o) => (
            <button key={o.id} onClick={() => navigate(`/encargos?id=${o.id}`)} className="w-full text-left px-4 py-2.5 flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-slate-900 truncate">{o.client?.name || 'Sin cliente'}</span>
                <span className="block text-[12px] text-slate-500 truncate">{(o.items || []).map((i: any) => i.description).join(', ')}</span>
              </span>
              <span className={`text-[12.5px] font-semibold shrink-0 ${o.dueAt && new Date(o.dueAt).getTime() < now ? 'text-red-700' : 'text-slate-700'}`}>{dueLabel(o.dueAt)}</span>
            </button>
          ))}
        </div>
      )}
      <button onClick={() => navigate('/encargos')} className="w-full px-4 py-3 border-t border-slate-100 flex items-center justify-between text-[13.5px] font-semibold text-rose-700">
        {list.length ? `Ver los ${list.length} encargos` : 'Ver encargos'} <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

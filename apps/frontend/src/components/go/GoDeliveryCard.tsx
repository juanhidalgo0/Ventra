import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bike, ChevronRight } from 'lucide-react';
import api from '../../services/api';

/** Configuración → Integraciones: vender en la app GO Delivery (ver GoScreen). */
export default function GoDeliveryCard() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ linked: boolean; storeName?: string } | null>(null);
  useEffect(() => {
    api.get('/go/status', { silent: true } as any).then(({ data }) => setStatus(data)).catch(() => setStatus({ linked: false }));
  }, []);
  return (
    <div className="card p-6 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><Bike className="w-5 h-5" /></div>
      <div className="flex-1 min-w-0">
        <h3 className="text-[15px] font-bold text-slate-900 tracking-tight">GO Delivery</h3>
        <p className="text-[13px] text-slate-500 break-words">
          {status?.linked
            ? <>Vinculado como <b className="text-slate-700">{status.storeName}</b>. Tus productos y precios se actualizan solos en la app.</>
            : 'Publicá tus productos en la app GO y recibí pedidos. Necesitás el código que te da GO.'}
        </p>
      </div>
      <button onClick={() => navigate('/go')} className="h-10 px-4 rounded-xl bg-slate-900 text-white text-[13.5px] font-bold flex items-center justify-center gap-1 shrink-0">
        {status?.linked ? 'Abrir' : 'Vincular'} <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

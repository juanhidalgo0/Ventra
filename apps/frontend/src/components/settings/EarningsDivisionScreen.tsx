import { useState, useEffect } from 'react';
import { 
  Calculator, 
  TrendingUp, 
  Smartphone, 
  Store, 
  DollarSign, 
  Calendar, 
  RefreshCw, 
  AlertCircle,
  Users2
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

interface SystemStats {
  billing: number;
  cost: number;
  netProfit: number;
  commissions?: number;
  delivery?: number;
  count: number;
}

interface ConsolidatedStats {
  billing: number;
  netProfit: number;
  splitPerPartner: number;
}

interface ConsolidatedMetricsResponse {
  pos: SystemStats;
  go: SystemStats;
  consolidated: ConsolidatedStats;
}

export default function EarningsDivisionScreen() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<ConsolidatedMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  interface PartnerConfig {
    name: string;
    percentage: number;
  }

  const [partners, setPartners] = useState<PartnerConfig[]>(() => {
    const saved = localStorage.getItem('earnings_division_partners');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return [
      { name: 'Socio 1', percentage: 33.33 },
      { name: 'Socio 2', percentage: 33.33 },
      { name: 'Socio 3', percentage: 33.34 }
    ];
  });

  useEffect(() => {
    localStorage.setItem('earnings_division_partners', JSON.stringify(partners));
  }, [partners]);

  const handlePartnerCountChange = (count: number) => {
    const validCount = Math.max(1, Math.min(10, count));
    setPartners(prev => {
      if (prev.length === validCount) return prev;
      if (prev.length < validCount) {
        const added: PartnerConfig[] = Array.from({ length: validCount - prev.length }, (_, i) => ({
          name: `Socio ${prev.length + i + 1}`,
          percentage: 0
        }));
        return [...prev, ...added];
      } else {
        return prev.slice(0, validCount);
      }
    });
  };

  const handleDistributeEqually = () => {
    const count = partners.length;
    const baseVal = parseFloat((100 / count).toFixed(2));
    const newPartners = partners.map((p, idx) => {
      if (idx === count - 1) {
        const currentSum = baseVal * (count - 1);
        const remainder = parseFloat((100 - currentSum).toFixed(2));
        return { ...p, percentage: remainder };
      }
      return { ...p, percentage: baseVal };
    });
    setPartners(newPartners);
  };

  const googleUserStr = localStorage.getItem('google_authenticated_user');
  const googleUser = googleUserStr ? JSON.parse(googleUserStr) : null;
  const email = googleUser?.email;

  const loadMetrics = async () => {
    if (!email) {
      setError('No hay ninguna cuenta de Google vinculada. Por favor, conéctela en la configuración de la tienda.');
      return;
    }

    setLoading(true);
    setError(null);

    let fromStr = '';
    let toStr = '';

    const today = new Date();
    if (period === 'today') {
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      fromStr = startOfToday.toISOString();
    } else if (period === 'week') {
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - 7);
      fromStr = startOfWeek.toISOString();
    } else if (period === 'month') {
      const startOfMonth = new Date(today);
      startOfMonth.setMonth(today.getMonth() - 1);
      fromStr = startOfMonth.toISOString();
    } else if (period === 'custom') {
      if (fromDate) fromStr = new Date(fromDate).toISOString();
      if (toDate) {
        const endOfToDate = new Date(toDate);
        endOfToDate.setHours(23, 59, 59, 999);
        toStr = endOfToDate.toISOString();
      }
    }

    try {
      const { data } = await api.get('/sales/consolidated-metrics', {
        params: { email, from: fromStr, to: toStr }
      });
      setMetrics(data);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.message || 'Error al obtener las métricas consolidadas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [period, fromDate, toDate]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(val);
  };

  if (!email) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 bg-slate-50">
        <div className="card max-w-md p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center mx-auto mb-4 border border-amber-100">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h3 className="text-base font-black text-slate-800 uppercase tracking-wider">Tienda Online Desconectada</h3>
          <p className="text-xs text-slate-700 font-bold mt-2 leading-relaxed">
            Debes vincular una cuenta de Google en esta terminal desde la configuración de la Tienda Online para poder sincronizar y ver el consolidado financiero con GoDelivery.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-6 bg-slate-50 p-6 overflow-y-auto custom-scrollbar pb-16">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between shrink-0">
        <div className="flex items-center gap-4 text-left">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shadow-inner">
            <Calculator className="w-6 h-6 animate-pulse-soft" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-800">Consolidado y División de Ganancias</h3>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.15em] mt-0.5">Auditoría consolidada de tienda física y app móvil entre socios</p>
          </div>
        </div>

        <button 
          onClick={loadMetrics}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-400 bg-white text-xs font-extrabold uppercase tracking-wider text-slate-650 hover:bg-slate-50 transition-all cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 text-slate-700 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* Period Selector */}
      <div className="bg-white p-4 rounded-2xl border border-slate-150 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex bg-slate-100 border border-slate-400 rounded-xl p-1 shrink-0">
          <button 
            onClick={() => setPeriod('today')} 
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${period === 'today' ? 'bg-white text-rose-650 shadow-sm' : 'text-slate-700 hover:text-slate-800'}`}
          >
            Hoy
          </button>
          <button 
            onClick={() => setPeriod('week')} 
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${period === 'week' ? 'bg-white text-rose-650 shadow-sm' : 'text-slate-700 hover:text-slate-800'}`}
          >
            7 Días
          </button>
          <button 
            onClick={() => setPeriod('month')} 
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${period === 'month' ? 'bg-white text-rose-650 shadow-sm' : 'text-slate-700 hover:text-slate-800'}`}
          >
            30 Días
          </button>
          <button 
            onClick={() => setPeriod('custom')} 
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${period === 'custom' ? 'bg-white text-rose-650 shadow-sm' : 'text-slate-700 hover:text-slate-800'}`}
          >
            Personalizado
          </button>
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <input 
              type="date" 
              value={fromDate} 
              onChange={(e) => setFromDate(e.target.value)} 
              className="bg-slate-50 border border-slate-400 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none" 
            />
            <span className="text-xs font-black text-slate-600 uppercase">al</span>
            <input 
              type="date" 
              value={toDate} 
              onChange={(e) => setToDate(e.target.value)} 
              className="bg-slate-50 border border-slate-400 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none" 
            />
          </div>
        )}
      </div>

      {error ? (
        <div className="bg-rose-50 border border-rose-150 p-4 rounded-xl text-rose-700 text-xs font-bold flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : loading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12">
          <div className="w-12 h-12 border-4 border-rose-100 border-t-rose-600 rounded-full animate-spin mb-4" />
          <p className="text-xs font-black uppercase tracking-wider text-slate-600">Consolidando bases de datos física y digital...</p>
        </div>
      ) : metrics ? (
        <div className="space-y-6">
          {/* Main Consolidated Output */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Consolidated Card */}
            <div className="bg-gradient-to-tr from-slate-900 via-rose-950 to-slate-900 p-6 rounded-3xl text-white shadow-xl flex flex-col justify-between border border-rose-500/20 text-left">
              <div>
                <span className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Total Combinado Consolidado</span>
                <h2 className="text-4xl font-black mt-2 leading-none">{formatCurrency(metrics.consolidated.billing)}</h2>
                <p className="text-xs text-slate-600 font-bold mt-2">Facturación consolidada (POS + App Go + Comisiones + Repartos)</p>
              </div>
              <div className="mt-8 pt-4 border-t border-white/10 flex justify-between items-center">
                <div>
                  <span className="text-[10px] text-emerald-400 font-black uppercase tracking-wider block">Ganancia Neta Consolidada</span>
                  <span className="text-2xl font-black text-emerald-400">{formatCurrency(metrics.consolidated.netProfit)}</span>
                </div>
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                  <DollarSign className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Split per partner Output */}
            <div className="bg-white p-6 rounded-3xl border border-slate-150 shadow-sm flex flex-col justify-between text-left space-y-4">
              <div className="flex items-center justify-between border-b border-slate-300 pb-3 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center border border-amber-100">
                    <Users2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-800">División de Utilidades</h4>
                    <p className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mt-0.5">Configuración personalizada de socios</p>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-end justify-between gap-4 shrink-0">
                <div className="flex-1">
                  <label className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Cantidad de Socios</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={partners.length}
                    onChange={e => handlePartnerCountChange(parseInt(e.target.value) || 1)}
                    className="w-full bg-slate-50 border border-slate-400 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:bg-white focus:border-rose-500 transition-all"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleDistributeEqually}
                  className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-650 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border-0 cursor-pointer"
                >
                  Equitativo
                </button>
              </div>

              {/* Partners List */}
              <div className="space-y-2.5 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar flex-1">
                {partners.map((partner, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-slate-50 border border-slate-150 rounded-xl p-2">
                    <input
                      type="text"
                      value={partner.name}
                      placeholder={`Socio ${idx + 1}`}
                      onChange={e => {
                        const updated = [...partners];
                        updated[idx].name = e.target.value;
                        setPartners(updated);
                      }}
                      className="flex-1 bg-white border border-slate-400 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:border-rose-500 uppercase"
                    />
                    <div className="w-20 relative flex items-center">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        value={partner.percentage}
                        onChange={e => {
                          const updated = [...partners];
                          updated[idx].percentage = parseFloat(e.target.value) || 0;
                          setPartners(updated);
                        }}
                        className="w-full bg-white border border-slate-400 rounded-lg pl-2 pr-6 py-1 text-xs font-bold text-right outline-none focus:border-rose-500"
                      />
                      <span className="absolute right-2 text-xs font-bold text-slate-600 pointer-events-none">%</span>
                    </div>
                    <div className="w-28 text-right font-extrabold text-xs text-slate-700">
                      {formatCurrency(metrics.consolidated.netProfit * (partner.percentage / 100))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Validation Badge */}
              <div className="pt-3 flex items-center justify-between border-t border-slate-300 shrink-0">
                <span className="text-[10px] font-black text-slate-600 uppercase">Suma Total</span>
                {Math.abs(partners.reduce((sum, p) => sum + p.percentage, 0) - 100) < 0.01 ? (
                  <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-250 px-2.5 py-1 rounded-full uppercase">
                    Distribución Válida (100%)
                  </span>
                ) : (
                  <span className="text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-250 px-2.5 py-1 rounded-full uppercase">
                    Suma: {partners.reduce((sum, p) => sum + p.percentage, 0).toFixed(2)}% (Debe ser 100%)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Detailed Breakdown POS vs GoDelivery */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* POS Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm space-y-4 text-left">
              <h4 className="text-[10.5px] font-black text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-300 pb-3">
                <Store className="w-4 h-4 text-rose-500" /> Ventra POS (Tienda Física y Web)
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-400 shadow-inner">
                  <span className="text-[8.5px] font-black text-slate-600 uppercase tracking-wider block mb-1">Ventas Brutas</span>
                  <span className="text-lg font-black text-slate-800">{formatCurrency(metrics.pos.billing)}</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-400 shadow-inner">
                  <span className="text-[8.5px] font-black text-slate-600 uppercase tracking-wider block mb-1">Transacciones</span>
                  <span className="text-lg font-black text-slate-800">{metrics.pos.count}</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-400 shadow-inner col-span-2">
                  <span className="text-[8.5px] font-black text-slate-600 uppercase tracking-wider block mb-1">Utilidad Neta del POS</span>
                  <span className="text-lg font-black text-emerald-600">{formatCurrency(metrics.pos.netProfit)}</span>
                </div>
              </div>
            </div>

            {/* GoDelivery Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm space-y-4 text-left">
              <h4 className="text-[10.5px] font-black text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-300 pb-3">
                <Smartphone className="w-4 h-4 text-rose-500" /> Go Delivery (Aplicación Móvil)
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-400 shadow-inner">
                  <span className="text-[8.5px] font-black text-slate-600 uppercase tracking-wider block mb-1">Ventas Digitales</span>
                  <span className="text-lg font-black text-slate-800">{formatCurrency(metrics.go.billing)}</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-400 shadow-inner">
                  <span className="text-[8.5px] font-black text-slate-600 uppercase tracking-wider block mb-1">Pedidos</span>
                  <span className="text-lg font-black text-slate-800">{metrics.go.count}</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-400 shadow-inner col-span-2 flex justify-between items-center">
                  <div>
                    <span className="text-[8.5px] font-black text-slate-600 uppercase tracking-wider block mb-1">Comisiones Cobradas a Comercios</span>
                    <span className="text-sm font-extrabold text-rose-600">{formatCurrency(metrics.go.commissions || 0)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[8.5px] font-black text-slate-600 uppercase tracking-wider block mb-1">Liquidaciones a Repartidores</span>
                    <span className="text-sm font-extrabold text-rose-600">{formatCurrency(metrics.go.delivery || 0)}</span>
                  </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-400 shadow-inner col-span-2">
                  <span className="text-[8.5px] font-black text-slate-600 uppercase tracking-wider block mb-1">Utilidad Neta de la App (Ventas)</span>
                  <span className="text-lg font-black text-emerald-600">{formatCurrency(metrics.go.netProfit)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-8 rounded-2xl border border-slate-150 shadow-sm text-center">
          <p className="text-xs text-slate-700 font-bold uppercase">No se pudieron recuperar datos de consolidado</p>
        </div>
      )}
    </div>
  );
}

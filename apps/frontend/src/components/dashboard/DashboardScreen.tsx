import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { 
  DollarSign, 
  ShoppingCart, 
  TrendingUp, 
  AlertTriangle, 
  ArrowUpRight,
  ArrowDownRight,
  Package,
  Calendar,
  ChevronDown,
  PieChart,
  Users,
  Wallet,
  Truck,
  CheckCircle2,
  Clock,
  ArrowRight,
  FileText,
  Calculator,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import LowStockAlertsModal from './LowStockAlertsModal';

export default function DashboardScreen() {
  const [summary, setSummary] = useState<any>(null);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showLowStock, setShowLowStock] = useState(false);
  const [license, setLicense] = useState<any>(null);

  useEffect(() => {
    let isMounted = true;
    api.get('/auth/license/status')
      .then(({ data }) => {
        if (isMounted) setLicense(data);
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, []);

  const getDemoDaysRemaining = () => {
    if (!license || !license.expiresAt) return 0;
    const exp = new Date(license.expiresAt);
    const today = new Date();
    const diff = exp.getTime() - today.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  // Filters State
  const [filterMode, setFilterMode] = useState<'month' | 'day' | 'range'>('month');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedDay, setSelectedDay] = useState<string>(new Date().toISOString().split('T')[0]);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const years = [2025, 2026, 2027, 2028];

  // Google account status inside Dashboard
  const [localGoogleUser, setLocalGoogleUser] = useState<any>(() => {
    const saved = localStorage.getItem('google_authenticated_user');
    return saved ? JSON.parse(saved) : null;
  });

  const handleDisconnectGoogle = () => {
    if (confirm('¿Estás seguro de desvincular la cuenta de Google? Los productos ya no se sincronizarán con GoDelivery.')) {
      localStorage.removeItem('google_authenticated_user');
      setLocalGoogleUser(null);
      toast.success('Cuenta de Google desvinculada');
    }
  };

  const getDateRange = () => {
    let from: string = '';
    let to: string = '';
    
    if (filterMode === 'month') {
      const fromDate = new Date(selectedYear, selectedMonth, 1);
      const toDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999);
      from = fromDate.toISOString();
      to = toDate.toISOString();
    } else if (filterMode === 'day') {
      const fromDate = new Date(selectedDay + 'T00:00:00');
      const toDate = new Date(selectedDay + 'T23:59:59.999');
      from = fromDate.toISOString();
      to = toDate.toISOString();
    } else if (filterMode === 'range') {
      const fromDate = new Date(startDate + 'T00:00:00');
      const toDate = new Date(endDate + 'T23:59:59.999');
      from = fromDate.toISOString();
      to = toDate.toISOString();
    }
    return { from, to };
  };

  useEffect(() => {
    loadData();
  }, [filterMode, selectedMonth, selectedYear, selectedDay, startDate, endDate]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const { from, to } = getDateRange();
      const params: any = {};
      if (from) params.from = from;
      if (to) params.to = to;

      const [resSummary, resDashboard] = await Promise.all([
        api.get('/sales/today-summary', { params }),
        api.get('/sales/dashboard', { params })
      ]).catch(() => [ { data: {} }, { data: {} } ]);
      
      setSummary(resSummary.data || {});
      setDashboardData(resDashboard.data || {});
    } catch {
      setSummary({});
      setDashboardData({});
    } finally { 
      setIsLoading(false); 
    }
  };

  const fmt = (p: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(p || 0);

  const downloadCSV = (filename: string, headers: string[], rows: any[][]) => {
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + [headers.join(","), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadPDF = (title: string, htmlContent: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(`
        <html>
          <head>
            <title>${title}</title>
            <style>
              body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; padding: 40px; }
              h1 { font-size: 24px; color: #0f172a; margin-bottom: 5px; }
              h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-top: 0; margin-bottom: 30px; }
              .header { border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 30px; }
              table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
              th { background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569; font-weight: 700; text-align: left; padding: 12px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
              td { padding: 12px; border-bottom: 1px solid #f1f5f9; color: #334155; }
              .text-right { text-align: right; }
              .font-bold { font-weight: bold; }
              .grid { display: grid; grid-template-cols: repeat(4, 1fr); gap: 20px; margin-bottom: 30px; }
              .card { background-color: #f8fafc; border: 1px solid #f1f5f9; padding: 15px; border-radius: 12px; }
              .card-title { font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 5px; }
              .card-value { font-size: 18px; font-weight: bold; color: #0f172a; }
              .footer { margin-top: 50px; font-size: 10px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 20px; }
            </style>
          </head>
          <body>
            ${htmlContent}
            <div class="footer">Generado por Sistema de Gestión de Kiosco - ${new Date().toLocaleDateString('es-AR')}</div>
            <script>
              window.onload = function() {
                window.print();
                setTimeout(function() { window.frameElement.remove(); }, 100);
              };
            </script>
          </body>
        </html>
      `);
      doc.close();
    }
  };

  const exportConsolidatedExcel = () => {
    if (!summary || !dashboardData) return;
    const { from, to } = getDateRange();
    const periodStr = from ? `${from.split('T')[0]}_a_${to.split('T')[0]}` : 'General';
    
    const rows = [
      ['Reporte Consolidado de Dashboard - Kiosco'],
      ['Período', periodStr],
      ['Fecha de Generación', new Date().toLocaleDateString('es-AR')],
      [],
      ['MÉTRICAS FINANCIERAS'],
      ['Métrica', 'Valor'],
      ['Ventas Totales', fmt(summary.totalRevenue)],
      ['Costo de Mercadería', fmt(summary.totalCost)],
      ['Egresos Operativos', fmt(summary.expenses)],
      ['Ganancia Neta', fmt(summary.totalRevenue - summary.totalCost - summary.expenses)],
      ['Rendimiento Neto', summary.totalRevenue > 0 ? `${Math.round(((summary.totalRevenue - summary.totalCost - summary.expenses) / summary.totalRevenue) * 100)}%` : '0%'],
      [],
      ['TOP 10 PRODUCTOS VENDIDOS'],
      ['Producto', 'Unidades Vendidas', 'Ingresos', 'Stock Actual'],
      ...(dashboardData.topProducts || []).map((p: any) => [p.name, p.quantity, fmt(p.revenue), p.stock]),
      [],
      ['TOP CLIENTES'],
      ['Cliente', 'Compras', 'Total Gastado'],
      ...(dashboardData.topClients || []).map((c: any) => [c.name, c.salesCount, fmt(c.totalSpent)])
    ];
    
    downloadCSV(`Consolidado_Dashboard_${periodStr}.csv`, [], rows);
    toast.success('Excel exportado correctamente');
  };

  const exportConsolidatedPDF = () => {
    if (!summary || !dashboardData) return;
    const { from, to } = getDateRange();
    const periodStr = from ? `${from.split('T')[0]} hasta ${to.split('T')[0]}` : 'General';

    const productsHtml = (dashboardData.topProducts || []).map((p: any, i: number) => `
      <tr>
        <td>${i + 1}</td>
        <td class="font-bold">${p.name}</td>
        <td class="text-right">${p.quantity} u.</td>
        <td class="text-right">${fmt(p.revenue)}</td>
        <td class="text-right">${p.stock}</td>
      </tr>
    `).join('');

    const clientsHtml = (dashboardData.topClients || []).map((c: any, i: number) => `
      <tr>
        <td>${i + 1}</td>
        <td class="font-bold">${c.name}</td>
        <td class="text-right">${c.salesCount}</td>
        <td class="text-right">${fmt(c.totalSpent)}</td>
      </tr>
    `).join('');

    const htmlContent = `
      <div class="header">
        <h1>REPORTE FINANCIERO CONSOLIDADO</h1>
        <h2>Período: ${periodStr}</h2>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-title">Ganancia Bruta</div>
          <div class="card-value">${fmt(summary.totalRevenue)}</div>
        </div>
        <div class="card">
          <div class="card-title">Egresos Operativos</div>
          <div class="card-value" style="color: #ef4444;">${fmt(summary.expenses)}</div>
        </div>
        <div class="card">
          <div class="card-title">Ganancia Neta</div>
          <div class="card-value" style="color: #10b981;">${fmt(summary.totalRevenue - summary.totalCost - summary.expenses)}</div>
        </div>
        <div class="card">
          <div class="card-title">Rendimiento Neto</div>
          <div class="card-value">${summary.totalRevenue > 0 ? Math.round(((summary.totalRevenue - summary.totalCost - summary.expenses) / summary.totalRevenue) * 100) : 0}%</div>
        </div>
      </div>

      <h3 style="font-size: 14px; text-transform: uppercase; color: #475569; margin-top: 30px;">Top Productos Vendidos</h3>
      <table>
        <thead>
          <tr>
            <th style="width: 5%">#</th>
            <th>Producto</th>
            <th class="text-right">Cant. Vendida</th>
            <th class="text-right">Ingresos</th>
            <th class="text-right">Stock</th>
          </tr>
        </thead>
        <tbody>
          ${productsHtml || '<tr><td colspan="5" style="text-align: center; color: #94a3b8;">Sin movimientos en el período</td></tr>'}
        </tbody>
      </table>

      <h3 style="font-size: 14px; text-transform: uppercase; color: #475569; margin-top: 30px;">Top Clientes</h3>
      <table>
        <thead>
          <tr>
            <th style="width: 5%">#</th>
            <th>Cliente</th>
            <th class="text-right">Compras</th>
            <th class="text-right">Total Gastado</th>
          </tr>
        </thead>
        <tbody>
          ${clientsHtml || '<tr><td colspan="4" style="text-align: center; color: #94a3b8;">Sin movimientos en el período</td></tr>'}
        </tbody>
      </table>
    `;

    downloadPDF(`Consolidado_${periodStr.replace(/ /g, '')}`, htmlContent);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-3 border-rose-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-medium text-slate-450 uppercase tracking-widest">Cargando Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-2 space-y-4 custom-scrollbar">
      {license?.isDemo && (
        <div className="bg-gradient-to-r from-rose-500/10 to-pink-500/10 border border-rose-200 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-rose-500 text-white flex items-center justify-center font-black text-lg shrink-0 shadow-md border-2 border-rose-400">
              📢
            </div>
            <div>
              <p className="text-[9px] font-extrabold text-rose-600 uppercase tracking-widest leading-none">Modo de Evaluación Activo</p>
              <h4 className="text-sm font-bold text-slate-800 leading-tight mt-1.5">VERSION DEMO: {getDemoDaysRemaining()} DÍAS RESTANTES</h4>
              <p className="text-[10px] text-slate-700 font-semibold mt-1">Tu licencia DEMO vencerá pronto. Contáctate con soporte para adquirir una licencia definitiva.</p>
            </div>
          </div>
        </div>
      )}
      {/* Google Terminal Session Status Banner */}
      {localGoogleUser ? (
        <div className="google-banner-active bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-200/80 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm animate-in fade-in-50 duration-300">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            {localGoogleUser.picture ? (
              <img 
                src={localGoogleUser.picture} 
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-full border-2 border-emerald-500 shadow-md shrink-0 object-cover" 
                alt="Google Profile" 
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  const parent = (e.target as HTMLImageElement).parentElement;
                  if (parent) {
                    const fallback = document.createElement('div');
                    fallback.className = "w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-base shrink-0 shadow-md border-2 border-emerald-500";
                    fallback.innerText = localGoogleUser.name?.[0] || 'G';
                    parent.appendChild(fallback);
                  }
                }}
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-base shrink-0">
                {localGoogleUser.name?.[0]}
              </div>
            )}
            <div>
              <p className="text-[9px] font-extrabold text-emerald-600 uppercase tracking-widest leading-none">Sesión Corporativa de Google Activa</p>
              <h4 className="text-sm font-bold text-slate-800 leading-tight mt-1.5">{localGoogleUser.name} <span className="text-xs font-semibold text-slate-600">({localGoogleUser.email})</span></h4>
              <p className="text-[10px] text-slate-455 font-semibold mt-1">Esta terminal está vinculada correctamente. Los productos se sincronizarán en tiempo real con GoDelivery.</p>
            </div>
          </div>
          <button 
            onClick={handleDisconnectGoogle} 
            className="w-full md:w-auto px-5 py-2.5 rounded-xl border border-rose-250 bg-rose-50 text-rose-600 hover:bg-rose-100/80 transition-all font-extrabold text-xs shadow-sm active:scale-95 cursor-pointer shrink-0 text-center"
          >
            Desconectar Google
          </button>
        </div>
      ) : (
        <div className="google-banner-pending bg-gradient-to-r from-rose-500/10 to-amber-500/10 border border-amber-200/80 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm animate-in fade-in-50 duration-300">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-amber-500 text-white flex items-center justify-center font-black text-lg shrink-0 shadow-md border-2 border-amber-400">
              G
            </div>
            <div>
              <p className="text-[9px] font-extrabold text-amber-600 uppercase tracking-widest leading-none">Vinculación con GoDelivery Pendiente</p>
              <h4 className="text-sm font-bold text-slate-800 leading-tight mt-1.5">Conectá tu cuenta de Google</h4>
              <p className="text-[10px] text-slate-455 font-semibold mt-1">Vinculá una cuenta de Google para habilitar la sincronización en tiempo real de tus productos con la tienda online GoDelivery.</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 self-start md:self-auto shrink-0">
            <button 
              onClick={() => {
                  const activePort = sessionStorage.getItem('active_backend_port') || '3001';
                  const authUrl = `http://localhost:${activePort}/api/auth/google/login-page`;
                
                // Open external browser using Rust command to ensure compatibility
                if ((window as any).__TAURI__) {
                  const invokeFn = (window as any).__TAURI__.core?.invoke || (window as any).__TAURI__.invoke;
                  if (invokeFn) {
                    invokeFn('open_browser', { url: authUrl }).catch(() => window.open(authUrl, '_blank'));
                  } else {
                    window.open(authUrl, '_blank');
                  }
                } else {
                  window.open(authUrl, '_blank');
                }
                toast("Iniciando sesión segura en tu navegador...");
                
                // Poll status every 1 second
                const pollInterval = setInterval(async () => {
                  try {
                    const { data } = await api.get('/auth/google-link-status');
                    if (data.linked && data.user) {
                      clearInterval(pollInterval);
                      localStorage.setItem('google_authenticated_user', JSON.stringify(data.user));
                      setLocalGoogleUser(data.user);
                      toast.success('¡Cuenta de Google vinculada con éxito!');
                    }
                  } catch (e) {
                    // Ignore transient polling errors
                  }
                }, 1000);

                // Auto stop polling after 5 minutes
                setTimeout(() => clearInterval(pollInterval), 300000);
              }}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-md active:scale-95 transition-all cursor-pointer flex items-center gap-2 border border-slate-750"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.113-5.136 4.113-3.072 0-5.565-2.493-5.565-5.565s2.493-5.565 5.565-5.565c1.378 0 2.637.5 3.613 1.328l3.06-3.06C18.822 3.912 15.69 2.25 12 2.25 6.615 2.25 2.25 6.615 2.25 12s4.365 9.75 9.75 9.75c5.07 0 9.27-3.66 9.27-9.2 0-.6-.054-1.17-.154-1.728H12.24z"/></svg>
              Iniciar sesión con Google
            </button>
          </div>
        </div>
      )}

      {/* Premium Period / Date Selector & Exports Bar */}
      <div className="bg-white border border-slate-400 rounded-2xl p-3 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full lg:w-auto">
          {/* Selector de modo */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-full sm:w-auto justify-between sm:justify-start">
            {[
              { id: 'month', label: 'Por Mes' },
              { id: 'day', label: 'Día' },
              { id: 'range', label: 'Rango' }
            ].map(mode => (
              <button
                key={mode.id}
                onClick={() => setFilterMode(mode.id as any)}
                className={`flex-1 sm:flex-none px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold transition-all cursor-pointer text-center ${
                  filterMode === mode.id 
                    ? 'bg-rose-500 text-white shadow-sm' 
                    : 'text-slate-700 hover:text-slate-800'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* Selector de Mes */}
          {filterMode === 'month' && (
            <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-left-2 duration-200 w-full sm:w-auto">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="flex-1 sm:flex-none bg-slate-50 border border-slate-400 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none"
              >
                {months.map((m, idx) => (
                  <option key={m} value={idx}>{m}</option>
                ))}
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="flex-1 sm:flex-none bg-slate-50 border border-slate-400 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none"
              >
                {years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}

          {/* Selector de Día */}
          {filterMode === 'day' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200 w-full sm:w-auto">
              <input
                type="date"
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="w-full sm:w-auto bg-slate-50 border border-slate-400 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500"
              />
            </div>
          )}

          {/* Selector de Rango */}
          {filterMode === 'range' && (
            <div className="flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200 w-full sm:w-auto">
              <span className="text-[10px] font-bold text-slate-600 uppercase">Desde</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 sm:flex-none bg-slate-50 border border-slate-400 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500"
              />
              <span className="text-[10px] font-bold text-slate-600 uppercase">Hasta</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1 sm:flex-none bg-slate-50 border border-slate-400 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500"
              />
            </div>
          )}
        </div>

        {/* Botones de exportación */}
        <div className="flex items-center gap-2 w-full lg:w-auto">
          <button
            onClick={exportConsolidatedExcel}
            className="flex-1 lg:flex-none justify-center px-3 py-2.5 rounded-xl border border-slate-400 bg-white text-slate-700 hover:bg-slate-50 transition-all font-bold text-xs shadow-sm flex items-center gap-2 active:scale-95 cursor-pointer"
            title="Descargar Excel con todos los datos consolidados del período"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>Excel</span>
          </button>
          <button
            onClick={exportConsolidatedPDF}
            className="flex-1 lg:flex-none justify-center px-3 py-2.5 rounded-xl bg-slate-800 text-white hover:bg-slate-700 transition-all font-bold text-xs shadow-sm flex items-center gap-2 active:scale-95 cursor-pointer"
            title="Exportar Reporte Financiero PDF del período"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>PDF Consolidado</span>
          </button>
        </div>
      </div>

      {/* Top Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Productos', value: summary?.totalProducts || '0', sub: `${summary?.totalProducts || 0} activos`, icon: Package, accent: 'bg-rose-600 text-white' },
          { label: 'Ventas Semanales', value: fmt(summary?.weeklyTotal || 0), sub: 'Últimos 7 días', icon: TrendingUp, accent: 'bg-slate-800 text-white' },
          { label: 'Ventas de Hoy', value: fmt(summary?.totalRevenue || 0), sub: `${summary?.totalSales || 0} ventas completadas`, icon: ShoppingCart, accent: 'bg-rose-500 text-white' },
          { 
            label: 'Alertas Stock', 
            value: summary?.lowStockCount || '0', 
            sub: summary?.lowStockCount > 0 ? `${summary.lowStockCount} críticos (clic para ver)` : 'Todo en orden', 
            icon: AlertTriangle, 
            accent: summary?.lowStockCount > 0 ? 'bg-amber-500 text-white cursor-pointer hover:bg-amber-600 transition-all active:scale-[0.98]' : 'bg-emerald-600 text-white',
            action: summary?.lowStockCount > 0 ? () => setShowLowStock(true) : undefined
          }
        ].map((card, i) => (
          <div 
            key={card.label} 
            onClick={card.action}
            className={`${card.accent} p-5 rounded-xl relative overflow-hidden shadow-md`}
          >
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold tracking-wider opacity-80 uppercase">{card.label}</p>
                <card.icon className="w-5 h-5 opacity-45" />
              </div>
              <h3 className="text-2xl font-bold mb-1">{card.value}</h3>
              <p className="text-[10px] font-medium opacity-70">{card.sub}</p>
            </div>
            <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          </div>
        ))}
      </div>

      {/* Main Stats Row */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 bg-white p-6 rounded-xl border border-slate-400 relative overflow-hidden">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-rose-500" /> Análisis Financiero
              </h3>
              <p className="text-xs text-slate-700 font-medium mt-1">Ganancias y egresos acumulados</p>
            </div>
            <div className="text-xs font-bold text-slate-650 bg-slate-50 border border-slate-150 px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm">
              <Calendar className="w-3.5 h-3.5 text-rose-500" />
              <span>
                {filterMode === 'month' && `${months[selectedMonth]} ${selectedYear}`}
                {filterMode === 'day' && `Día: ${selectedDay}`}
                {filterMode === 'range' && `Rango: ${startDate} al ${endDate}`}
              </span>
            </div>
          </div>
          
          <div className="h-[280px] w-full pr-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dashboardData?.history || []}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#e11d48" stopOpacity={0.12}/>
                    <stop offset="95%" stopColor="#e11d48" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.12}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(value) => fmt(Number(value))} />
                <Area type="monotone" name="Ingresos (Ventas)" dataKey="sales" stroke="#e11d48" strokeWidth={2.5} fill="url(#colorSales)" />
                <Area type="monotone" name="Ganancia Neta" dataKey="profit" stroke="#10b981" strokeWidth={2.5} fill="url(#colorProfit)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span className="text-[10px] font-bold text-slate-700 uppercase">Ingresos por POS</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-bold text-slate-700 uppercase">Ganancia Estimada</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-400 flex flex-col">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-5 border-b border-slate-300 pb-3">Resumen Financiero</h3>
          <div className="space-y-5 flex-1">
            {[
              { label: 'Ganancia Bruta', val: fmt(summary?.totalRevenue || 0), color: 'text-emerald-600', icon: ArrowUpRight, bg: 'bg-emerald-50 border border-emerald-200' },
              { label: 'Egresos Operativos', val: fmt(summary?.expenses || 0), color: 'text-rose-600', icon: ArrowDownRight, bg: 'bg-rose-50 border border-rose-200' },
              { label: 'Ganancia Neta', val: fmt((summary?.totalRevenue || 0) - (summary?.totalCost || 0) - (summary?.expenses || 0)), color: 'text-emerald-600', icon: DollarSign, bg: 'bg-emerald-50 border border-emerald-200' },
              { 
                label: 'Rendimiento Neto', 
                val: summary?.totalRevenue > 0 ? `${Math.round(((summary.totalRevenue - summary.totalCost - summary.expenses) / summary.totalRevenue) * 100)}%` : '0%', 
                color: 'text-indigo-600', 
                icon: PieChart, 
                bg: 'bg-indigo-50 border border-indigo-200' 
              }
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg ${item.bg} flex items-center justify-center ${item.color}`}>
                    <item.icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-slate-700 uppercase tracking-wider">{item.label}</p>
                    <p className={`text-sm font-bold ${item.color}`}>{item.val}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Grid Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Resumen del Mes */}
        <div className="bg-white p-5 rounded-xl border border-slate-400">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-5 flex items-center justify-between">
            <span>Resumen del Mes</span>
            <ChevronDown className="w-4 h-4 text-slate-600" />
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Efectivo del Mes', icon: Wallet, color: 'text-rose-500', value: fmt(summary?.monthlyStats?.cash) },
              { label: 'Facturación', icon: FileText, color: 'text-rose-600', value: fmt(summary?.monthlyStats?.revenue) },
              { label: 'Compras del Mes', icon: Package, color: 'text-emerald-600', value: fmt(summary?.monthlyStats?.purchases) },
              { label: 'Pagos a Proveedores', icon: Truck, color: 'text-amber-600', value: fmt(summary?.monthlyStats?.supplierPayments) },
              { label: 'Ventas por Cajas', icon: Calculator, color: 'text-blue-600', value: fmt(summary?.monthlyStats?.boxSales) },
              { label: 'Consumo Interno', icon: ShoppingCart, color: 'text-orange-600', value: fmt(summary?.monthlyStats?.internalConsumption) }
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between text-xs text-slate-700 border-b border-slate-300 pb-3 last:border-0">
                <div className="flex items-center gap-2.5">
                  <item.icon className={`w-4 h-4 ${item.color}`} />
                  <span className="font-medium">{item.label}</span>
                </div>
                <span className="font-bold text-slate-800">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top 10 Clientes */}
        <div className="bg-white p-5 rounded-xl border border-slate-400 flex flex-col overflow-hidden h-[340px]">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 w-full text-left flex items-center gap-2 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Top Clientes
          </h3>
          <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-3.5">
            {(!dashboardData?.topClients || dashboardData.topClients.length === 0) ? (
              <div className="py-12 text-center my-auto flex flex-col items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-3 border border-slate-400">
                  <Users className="w-5 h-5 text-slate-405" />
                </div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Sin ventas a cuenta corriente hoy</p>
              </div>
            ) : (
              dashboardData.topClients.map((client: any, i: number) => (
                <div key={client.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-50 last:border-0 pb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 font-black flex items-center justify-center shrink-0 border border-emerald-100 text-xs shadow-sm">
                      {i + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate">{client.name}</p>
                      <p className="text-[9px] text-slate-600 font-semibold">{client.salesCount} compras</p>
                    </div>
                  </div>
                  <span className="font-extrabold text-slate-800 shrink-0">{fmt(client.totalSpent)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Productos */}
        <div className="bg-white p-5 rounded-xl border border-slate-400 flex flex-col overflow-hidden h-[340px]">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 w-full text-left flex items-center gap-2 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Top Productos
          </h3>
          <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-3">
            {(!dashboardData?.topProducts || dashboardData.topProducts.length === 0) ? (
              <div className="py-12 text-center my-auto flex flex-col items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-3 border border-slate-400">
                  <Package className="w-5 h-5 text-slate-405" />
                </div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Sin ventas registradas en el periodo</p>
              </div>
            ) : (
              dashboardData.topProducts.map((p: any, i: number) => (
                <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-50 last:border-0 pb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 font-black flex items-center justify-center shrink-0 border border-amber-100 text-xs shadow-sm">
                      {i + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate" title={p.name}>{p.name}</p>
                      <p className="text-[9px] text-slate-600 font-semibold">{p.quantity} unidades vendidas</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-extrabold text-slate-800 block">{fmt(p.revenue)}</span>
                    <span className="text-[9px] text-slate-600 block font-medium">Stock: {p.stock}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* More Grid Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Rentabilidad */}
        <div className="bg-white p-5 rounded-xl border border-slate-400 flex flex-col justify-between h-[180px]">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center justify-between shrink-0">
            Margen Comercial <ChevronDown className="w-4 h-4 text-slate-600" />
          </h3>
          <div className="flex items-center gap-4 py-2">
            <div className="w-14 h-14 rounded-2xl border-4 border-emerald-100 flex items-center justify-center shrink-0 relative bg-emerald-50">
              <CheckCircle2 className="w-7 h-7 text-emerald-500" />
            </div>
            <div>
              <p className="text-base font-extrabold text-emerald-600 tracking-tight leading-none">
                {summary?.totalRevenue > 0 ? Math.round((summary.netProfit / summary.totalRevenue) * 100) : 0}%
              </p>
              <p className="text-[9.5px] font-bold text-slate-600 uppercase tracking-wider mt-1.5">Margen Operativo de Hoy</p>
              <p className="text-[10px] text-slate-700 font-medium leading-tight mt-1">Refleja la ganancia neta sobre la facturación bruta actual.</p>
            </div>
          </div>
        </div>

        {/* Cuentas Corrientes */}
        <div className="bg-white p-5 rounded-xl border border-slate-400 flex flex-col justify-between h-[180px]">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 shrink-0">Cuentas Corrientes</h3>
          <div className="space-y-1">
            <h4 className="text-2xl font-black text-rose-650 tracking-tight">{fmt(summary?.totalClientBalance || 0)}</h4>
            <p className="text-[10px] text-slate-600 font-extrabold uppercase tracking-wider">Saldo Pendiente de Clientes</p>
            <p className="text-[10.5px] text-slate-700 font-medium leading-tight">Total acumulado de deudas de clientes activos en cuenta corriente.</p>
          </div>
        </div>

        {/* Control de Caja */}
        <div className="bg-white p-5 rounded-xl border border-slate-400 flex flex-col justify-between h-[180px]">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 shrink-0">Control de Caja</h3>
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className={`w-2 h-2 rounded-full ${summary?.activeSessionsCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
              <span className={`text-[10px] font-extrabold uppercase tracking-wider ${summary?.activeSessionsCount > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                {summary?.activeSessionsCount > 0 ? `${summary.activeSessionsCount} Caja(s) Activa(s)` : 'Caja Cerrada'}
              </span>
            </div>
            <h4 className="text-2xl font-black text-slate-800 tracking-tight">{fmt(summary?.activeSessionsCash || 0)}</h4>
            <p className="text-[10px] text-slate-600 font-extrabold uppercase tracking-wider mt-1">Efectivo Físico en Caja</p>
          </div>
        </div>
      </div>

      {/* Final Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Deuda Proveedores */}
        <div className="bg-white p-5 rounded-xl border border-slate-400 flex items-center justify-between h-[150px]">
          <div className="min-w-0 flex-1 pr-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Deuda Proveedores</h3>
            <h4 className="text-2xl font-black text-rose-650 tracking-tight">{fmt(summary?.totalSupplierDebt || 0)}</h4>
            <p className="text-[9.5px] text-slate-600 font-extrabold uppercase tracking-wider mt-1.5">Saldos Pendientes de Compras</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 shrink-0 shadow-inner">
            <Truck className="w-6 h-6" />
          </div>
        </div>

        {/* Stock Bajo */}
        <div 
          onClick={() => setShowLowStock(true)}
          className={`p-5 rounded-xl border flex items-center justify-between h-[150px] cursor-pointer hover:shadow-md transition-all active:scale-[0.98] ${
            summary?.lowStockCount > 0 
              ? 'bg-amber-50/50 border-amber-250' 
              : 'bg-white border-slate-400'
          }`}
        >
          <div className="min-w-0 flex-1 pr-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Alertas Stock</h3>
            <div className="flex items-center gap-1.5">
              {summary?.lowStockCount > 0 ? (
                <>
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                  <h4 className="text-sm font-extrabold text-amber-700">{summary.lowStockCount} Críticos</h4>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <h4 className="text-sm font-extrabold text-slate-700">Todo en orden</h4>
                </>
              )}
            </div>
            <p className="text-[9.5px] text-slate-600 font-semibold mt-2.5">
              {summary?.lowStockCount > 0 ? 'Haz clic para ver y reabastecer' : 'Todos los productos tienen stock suficiente'}
            </p>
          </div>
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${
            summary?.lowStockCount > 0 ? 'bg-amber-100 border border-amber-200 text-amber-600' : 'bg-emerald-50 border border-emerald-100 text-emerald-500'
          }`}>
            {summary?.lowStockCount > 0 ? <AlertTriangle className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />}
          </div>
        </div>
      </div>

      {/* Feed de Actividad Reciente */}
      <div className="bg-white p-6 rounded-xl border border-slate-400 flex flex-col overflow-hidden">
        <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-widest mb-6 w-full text-left flex items-center gap-2 border-b border-slate-300 pb-3">
          <Clock className="w-4 h-4 text-rose-500 animate-pulse" /> Actividad Reciente del Sistema
        </h3>
        <div className="space-y-4 text-left w-full">
          {(!summary?.latestMovements || summary.latestMovements.length === 0) ? (
            <div className="py-8 text-center text-slate-600">
              <p className="text-xs font-semibold">Sin movimientos registrados hoy</p>
            </div>
          ) : (
            summary.latestMovements.map((log: any) => {
              const time = new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const date = new Date(log.createdAt).toLocaleDateString([], { day: '2-digit', month: '2-digit' });
              
              let desc = `${log.action} ${log.entityType}`;
              if (log.entityType === 'SALE') {
                desc = log.action === 'CREATE' ? 'Nueva Venta registrada en el POS' : 'Venta cancelada o devuelta';
              } else if (log.entityType === 'CASH_REGISTER') {
                desc = log.action === 'OPEN' ? 'Apertura de turno de caja' : 'Cierre de turno y arqueo de caja';
              } else if (log.entityType === 'PRODUCT') {
                desc = log.action === 'CREATE' ? 'Nuevo producto registrado' : log.action === 'UPDATE' ? 'Producto modificado' : 'Producto eliminado';
              } else if (log.entityType === 'PURCHASE') {
                desc = 'Nueva compra a proveedor registrada';
              }

              return (
                <div key={log.id} className="flex items-center justify-between text-xs py-2 border-b border-slate-50/50 last:border-0 pb-3 hover:bg-slate-50/30 px-2 rounded-lg transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                    <div>
                      <p className="font-bold text-slate-700">{desc}</p>
                      <p className="text-[9.5px] text-slate-600 mt-0.5">
                        Por <span className="font-semibold text-slate-700">{log.user?.fullName || log.user?.username || 'Sistema'}</span>
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-150">
                    {date} {time}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Stock Alerts Panel */}
      <AnimatePresence>
        {showLowStock && (
          <LowStockAlertsModal 
            key="low-stock-modal"
            onClose={() => { 
              setShowLowStock(false); 
              loadData(); 
            }} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

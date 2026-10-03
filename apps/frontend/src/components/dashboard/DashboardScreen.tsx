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
import { PageHeader, Panel, StatCard, EmptyState, Segmented, ui } from '../ui/Page';
import { escapeHtml } from '../../utils/escapeHtml';

export default function DashboardScreen() {
  const [summary, setSummary] = useState<any>(null);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showLowStock, setShowLowStock] = useState(false);

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
            <title>${escapeHtml(title)}</title>
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
        <td class="font-bold">${escapeHtml(p.name)}</td>
        <td class="text-right">${p.quantity} u.</td>
        <td class="text-right">${fmt(p.revenue)}</td>
        <td class="text-right">${p.stock}</td>
      </tr>
    `).join('');

    const clientsHtml = (dashboardData.topClients || []).map((c: any, i: number) => `
      <tr>
        <td>${i + 1}</td>
        <td class="font-bold">${escapeHtml(c.name)}</td>
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

  const periodLabel = filterMode === 'month'
    ? `${months[selectedMonth]} ${selectedYear}`
    : filterMode === 'day'
      ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
      : `Del ${new Date(`${startDate}T12:00:00`).toLocaleDateString('es-AR')} al ${new Date(`${endDate}T12:00:00`).toLocaleDateString('es-AR')}`;

  if (isLoading) {
    // Esqueleto con la forma de la pantalla: se nota que carga sin un spinner suelto
    return (
      <div className="h-full overflow-hidden p-2 sm:p-3 space-y-5">
        <div className="h-12 w-64 rounded-lg bg-slate-200/60 dark:bg-slate-800 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[132px] rounded-2xl bg-slate-200/50 dark:bg-slate-800 animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3 h-[360px] rounded-2xl bg-slate-200/50 dark:bg-slate-800 animate-pulse" />
          <div className="h-[360px] rounded-2xl bg-slate-200/50 dark:bg-slate-800 animate-pulse" />
        </div>
      </div>
    );
  }

  const revenue = summary?.totalRevenue || 0;
  const netProfit = (summary?.totalRevenue || 0) - (summary?.totalCost || 0) - (summary?.expenses || 0);
  const netYield = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;
  const lowStock = summary?.lowStockCount || 0;

  const activityDot: Record<string, string> = {
    SALE: 'bg-rose-500',
    CASH_REGISTER: 'bg-slate-400',
    PRODUCT: 'bg-sky-500',
    PURCHASE: 'bg-amber-500',
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-[1480px] mx-auto p-2 sm:p-3 space-y-5 anim-fade">
        <PageHeader
          title="Dashboard"
          description={<span className="first-letter:uppercase inline-block">{periodLabel}</span>}
          actions={
            <>
              <Segmented
                options={[{ id: 'month', label: 'Mes' }, { id: 'day', label: 'Día' }, { id: 'range', label: 'Rango' }]}
                value={filterMode}
                onChange={(v) => setFilterMode(v)}
              />
              {filterMode === 'month' && (
                <>
                  <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} className={ui.field}>
                    {months.map((m, idx) => <option key={m} value={idx}>{m}</option>)}
                  </select>
                  <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className={ui.field}>
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </>
              )}
              {filterMode === 'day' && (
                <input type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} className={ui.field} />
              )}
              {filterMode === 'range' && (
                <>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={ui.field} aria-label="Desde" />
                  <span className="text-[13px] text-slate-400">a</span>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={ui.field} aria-label="Hasta" />
                </>
              )}
              <span className="hidden sm:block w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
              <button
                onClick={exportConsolidatedExcel}
                className={`${ui.btn} ${ui.btnSecondary}`}
                title="Descargar Excel con todos los datos consolidados del período"
              >
                <Download className="w-4 h-4 text-emerald-600" /> Excel
              </button>
              <button
                onClick={exportConsolidatedPDF}
                className={`${ui.btn} ${ui.btnDark}`}
                title="Exportar reporte financiero PDF del período"
              >
                <FileText className="w-4 h-4" /> PDF consolidado
              </button>
            </>
          }
        />

        {/* Indicadores principales */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label={filterMode === 'month' ? 'Ventas del mes' : filterMode === 'day' ? 'Ventas del día' : 'Ventas del período'}
            value={fmt(revenue)}
            hint={`Ganancia neta ${fmt(netProfit)}`}
            icon={TrendingUp}
            tone="brand"
          />
          <StatCard
            label="Transacciones"
            value={(summary?.totalSales || 0).toLocaleString('es-AR')}
            hint={summary?.totalSales > 0 ? `Ticket promedio ${fmt(revenue / summary.totalSales)}` : 'Todavía sin ventas'}
            icon={ShoppingCart}
            tone="info"
          />
          <StatCard
            label="Productos"
            value={(summary?.totalProducts || 0).toLocaleString('es-AR')}
            hint={`${summary?.totalProducts || 0} activos`}
            icon={Package}
          />
          <StatCard
            label="Alertas de stock"
            value={lowStock}
            valueTone={lowStock > 0 ? 'warning' : 'neutral'}
            hint={lowStock > 0 ? 'Tocá para ver y reponer' : 'Todo en orden'}
            icon={lowStock > 0 ? AlertTriangle : CheckCircle2}
            tone={lowStock > 0 ? 'warning' : 'success'}
            onClick={() => setShowLowStock(true)}
          />
        </div>

        {/* Gráfico + resumen financiero */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <Panel
            className="lg:col-span-3"
            title="Ingresos y ganancia"
            action={
              <div className="flex items-center gap-4 text-[12.5px] text-slate-500">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#0E6E52]" /> Ingresos</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#34AC7E]" /> Ganancia neta</span>
              </div>
            }
          >
            <div className="h-[280px] w-full -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dashboardData?.history || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0E6E52" stopOpacity={0.14} />
                      <stop offset="95%" stopColor="#0E6E52" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34AC7E" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#34AC7E" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#eef2f6" />
                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} dy={6} />
                  <YAxis
                    stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} width={64}
                    tickFormatter={(v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000).toLocaleString('es-AR')}k` : `$${v}`)}
                  />
                  <Tooltip
                    formatter={(value) => fmt(Number(value))}
                    contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px -12px rgba(15,23,42,.25)', fontSize: 12.5, padding: '8px 12px' }}
                    labelStyle={{ fontWeight: 600, color: '#0f172a', marginBottom: 4 }}
                    cursor={{ stroke: '#cbd5e1', strokeDasharray: '4 4' }}
                  />
                  <Area type="monotone" name="Ingresos" dataKey="sales" stroke="#0E6E52" strokeWidth={2.25} fill="url(#colorSales)" isAnimationActive={false} />
                  <Area type="monotone" name="Ganancia neta" dataKey="profit" stroke="#34AC7E" strokeWidth={2.25} fill="url(#colorProfit)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Resumen financiero">
            <dl className="divide-y divide-slate-100 dark:divide-slate-800">
              {[
                { label: 'Ganancia bruta', val: fmt(summary?.totalRevenue || 0), cls: 'text-slate-900 dark:text-white', icon: ArrowUpRight, iconCls: 'text-emerald-500' },
                { label: 'Egresos operativos', val: fmt(summary?.expenses || 0), cls: summary?.expenses > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white', icon: ArrowDownRight, iconCls: 'text-red-500' },
                { label: 'Ganancia neta', val: fmt(netProfit), cls: netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600', icon: DollarSign, iconCls: 'text-emerald-500' },
                { label: 'Rendimiento neto', val: `${netYield}%`, cls: 'text-slate-900 dark:text-white', icon: PieChart, iconCls: 'text-slate-400' },
              ].map((item) => (
                <div key={item.label} className="py-3.5 first:pt-1 last:pb-0">
                  <dt className="flex items-center gap-1.5 text-[12.5px] text-slate-500 dark:text-slate-400">
                    <item.icon className={`w-3.5 h-3.5 ${item.iconCls}`} /> {item.label}
                  </dt>
                  <dd className={`text-[19px] font-bold tracking-[-0.02em] mt-1 ${item.cls}`}>{item.val}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>

        {/* Resumen del mes + rankings */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Panel title="Resumen del mes">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {[
                { label: 'Efectivo del mes', icon: Wallet, value: fmt(summary?.monthlyStats?.cash) },
                { label: 'Facturación', icon: FileText, value: fmt(summary?.monthlyStats?.revenue) },
                { label: 'Compras del mes', icon: Package, value: fmt(summary?.monthlyStats?.purchases) },
                { label: 'Pagos a proveedores', icon: Truck, value: fmt(summary?.monthlyStats?.supplierPayments) },
                { label: 'Ventas por cajas', icon: Calculator, value: fmt(summary?.monthlyStats?.boxSales) },
                { label: 'Consumo interno', icon: ShoppingCart, value: fmt(summary?.monthlyStats?.internalConsumption) },
              ].map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 text-[13px]">
                  <span className="flex items-center gap-2.5 text-slate-600 dark:text-slate-300 min-w-0">
                    <item.icon className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={2} />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white shrink-0">{item.value}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Mejores clientes" bodyClassName="overflow-y-auto custom-scrollbar max-h-[300px]">
            {(!dashboardData?.topClients || dashboardData.topClients.length === 0) ? (
              <EmptyState icon={Users} title="Sin ventas a cuenta corriente" description="Cuando vendas a clientes con cuenta corriente, los que más compran aparecen acá." />
            ) : (
              <ol className="divide-y divide-slate-100 dark:divide-slate-800">
                {dashboardData.topClients.map((client: any, i: number) => (
                  <li key={client.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 text-[12px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{client.name}</p>
                        <p className="text-[12px] text-slate-500">{client.salesCount} {client.salesCount === 1 ? 'compra' : 'compras'}</p>
                      </div>
                    </div>
                    <span className="text-[13px] font-semibold text-slate-900 dark:text-white shrink-0">{fmt(client.totalSpent)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Productos más vendidos" bodyClassName="overflow-y-auto custom-scrollbar max-h-[300px]">
            {(!dashboardData?.topProducts || dashboardData.topProducts.length === 0) ? (
              <EmptyState icon={Package} title="Sin ventas en el período" description="Los productos que más salen van a aparecer acá, con su stock actual." />
            ) : (
              <ol className="divide-y divide-slate-100 dark:divide-slate-800">
                {dashboardData.topProducts.map((p: any, i: number) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 text-[12px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate" title={p.name}>{p.name}</p>
                        <p className="text-[12px] text-slate-500">{p.quantity} vendidos · stock {p.stock}</p>
                      </div>
                    </div>
                    <span className="text-[13px] font-semibold text-slate-900 dark:text-white shrink-0">{fmt(p.revenue)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        {/* Salud del negocio */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Margen operativo"
            value={`${summary?.totalRevenue > 0 ? Math.round((summary.netProfit / summary.totalRevenue) * 100) : 0}%`}
            hint="Ganancia neta sobre lo facturado"
            icon={PieChart}
            tone="success"
          />
          <StatCard
            label="Saldo de cuentas corrientes"
            value={fmt(summary?.totalClientBalance || 0)}
            valueTone={summary?.totalClientBalance > 0 ? 'danger' : 'neutral'}
            hint="Lo que te deben tus clientes"
            icon={Users}
            tone="brand"
          />
          <StatCard
            label="Efectivo en caja"
            value={fmt(summary?.activeSessionsCash || 0)}
            hint={summary?.activeSessionsCount > 0
              ? <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{summary.activeSessionsCount} {summary.activeSessionsCount === 1 ? 'caja abierta' : 'cajas abiertas'}</span>
              : 'Caja cerrada'}
            icon={Wallet}
          />
          <StatCard
            label="Deuda con proveedores"
            value={fmt(summary?.totalSupplierDebt || 0)}
            valueTone={summary?.totalSupplierDebt > 0 ? 'danger' : 'neutral'}
            hint="Saldos pendientes de compras"
            icon={Truck}
            tone="warning"
          />
        </div>

        {/* Actividad reciente */}
        <Panel title="Actividad reciente" icon={Clock}>
          {(!summary?.latestMovements || summary.latestMovements.length === 0) ? (
            <EmptyState title="Sin movimientos hoy" description="Ventas, aperturas de caja y cambios de productos se registran acá a medida que ocurren." />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {summary.latestMovements.map((log: any) => {
                const time = new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const date = new Date(log.createdAt).toLocaleDateString([], { day: '2-digit', month: '2-digit' });

                let desc = `${log.action} ${log.entityType}`;
                if (log.entityType === 'SALE') {
                  desc = log.action === 'CREATE' ? 'Nueva venta registrada en el POS' : 'Venta cancelada o devuelta';
                } else if (log.entityType === 'CASH_REGISTER') {
                  desc = log.action === 'OPEN' ? 'Apertura de turno de caja' : 'Cierre de turno y arqueo de caja';
                } else if (log.entityType === 'PRODUCT') {
                  desc = log.action === 'CREATE' ? 'Nuevo producto registrado' : log.action === 'UPDATE' ? 'Producto modificado' : 'Producto eliminado';
                } else if (log.entityType === 'PURCHASE') {
                  desc = 'Nueva compra a proveedor registrada';
                }

                return (
                  <li key={log.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${activityDot[log.entityType] || 'bg-slate-300'}`} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-slate-800 dark:text-slate-100 truncate">{desc}</p>
                        <p className="text-[12px] text-slate-500">{log.user?.fullName || log.user?.username || 'Sistema'}</p>
                      </div>
                    </div>
                    <span className="text-[12px] text-slate-400 shrink-0">{date} · {time}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
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

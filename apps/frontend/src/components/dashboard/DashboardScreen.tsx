import { useState, useEffect } from 'react';
import api from '../../services/api';
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
  Calculator
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
import ExportButtons from '../common/ExportButtons';
import type { Report } from '../../utils/report';

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

  /** El tablero del período en Excel o PDF: indicadores, resumen del mes, día por día y rankings */
  const buildReport = (): Report | null => {
    if (!summary || !dashboardData) return null;
    const rev = summary.totalRevenue || 0;
    const net = rev - (summary.totalCost || 0) - (summary.expenses || 0);
    const ms = summary.monthlyStats || {};
    const history: any[] = dashboardData.history || [];
    return {
      title: 'Dashboard del negocio',
      subtitle: periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1),
      fileName: `Dashboard ${periodLabel}`,
      summary: [
        { label: 'Ventas', value: rev, type: 'money' },
        { label: 'Costo de mercadería', value: summary.totalCost || 0, type: 'money' },
        { label: 'Egresos operativos', value: summary.expenses || 0, type: 'money', tone: summary.expenses > 0 ? 'bad' : undefined },
        { label: 'Ganancia neta', value: net, type: 'money', tone: net >= 0 ? 'good' : 'bad' },
        { label: 'Rendimiento neto', value: rev > 0 ? (net / rev) * 100 : 0, type: 'percent' },
        { label: 'Transacciones', value: summary.totalSales || 0, type: 'int' },
        { label: 'Ticket promedio', value: summary.totalSales > 0 ? rev / summary.totalSales : 0, type: 'money' },
        { label: 'Productos activos', value: summary.totalProducts || 0, type: 'int' },
        { label: 'Alertas de stock', value: summary.lowStockCount || 0, type: 'int', tone: summary.lowStockCount > 0 ? 'warn' : undefined },
        { label: 'Saldo de cuentas corrientes', value: summary.totalClientBalance || 0, type: 'money' },
        { label: 'Efectivo en cajas abiertas', value: summary.activeSessionsCash || 0, type: 'money' },
        { label: 'Deuda con proveedores', value: summary.totalSupplierDebt || 0, type: 'money', tone: summary.totalSupplierDebt > 0 ? 'bad' : undefined },
      ],
      tables: [
        {
          title: 'Resumen del mes',
          columns: [{ header: 'Concepto' }, { header: 'Importe', type: 'money' }],
          rows: [
            ['Efectivo del mes', ms.cash || 0],
            ['Facturación', ms.revenue || 0],
            ['Compras del mes', ms.purchases || 0],
            ['Pagos a proveedores', ms.supplierPayments || 0],
            ['Ventas por cajas', ms.boxSales || 0],
            ['Consumo interno', ms.internalConsumption || 0],
          ],
        },
        {
          title: 'Ingresos y ganancia por día',
          columns: [{ header: 'Fecha', type: 'date' }, { header: 'Ingresos', type: 'money' }, { header: 'Ganancia neta', type: 'money' }],
          rows: history.map((h) => [/^\d{4}-\d{2}-\d{2}$/.test(h.date) ? `${h.date}T12:00:00` : h.date, h.sales || 0, h.profit || 0]),
          totals: history.length ? ['Total', history.reduce((s, h) => s + (h.sales || 0), 0), history.reduce((s, h) => s + (h.profit || 0), 0)] : undefined,
          emptyText: 'Sin ventas en el período',
        },
        {
          title: 'Productos más vendidos',
          columns: [{ header: '#', type: 'int' }, { header: 'Producto' }, { header: 'Unidades vendidas', type: 'number' }, { header: 'Ingresos', type: 'money' }, { header: 'Stock actual', type: 'number' }],
          rows: (dashboardData.topProducts || []).map((p: any, i: number) => [i + 1, p.name, p.quantity, p.revenue, p.stock]),
          emptyText: 'Sin ventas en el período',
        },
        {
          title: 'Mejores clientes',
          columns: [{ header: '#', type: 'int' }, { header: 'Cliente' }, { header: 'Compras', type: 'int' }, { header: 'Total comprado', type: 'money' }],
          rows: (dashboardData.topClients || []).map((c: any, i: number) => [i + 1, c.name, c.salesCount, c.totalSpent]),
          emptyText: 'Sin ventas a cuenta corriente en el período',
        },
      ],
    };
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
              <ExportButtons build={buildReport} />
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
                { label: 'Ventas', val: fmt(summary?.totalRevenue || 0), cls: 'text-slate-900 dark:text-white', icon: ArrowUpRight, iconCls: 'text-emerald-500' },
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

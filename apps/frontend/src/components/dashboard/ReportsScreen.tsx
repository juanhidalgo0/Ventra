import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import AskBusiness, { useCanAskBusiness } from '../common/AskBusiness';
import { YearReviewBanner } from '../yearReview/YearReview';
import toast from 'react-hot-toast';
import { 
  BarChart3, 
  TrendingUp, 
  Layers, 
  RefreshCw, 
  Package, 
  AlertTriangle, 
  Activity, 
  LineChart, 
  XCircle, 
  CornerUpLeft,
  X,
  Search,
  Calendar,
  Info,
  DollarSign,
  TrendingDown,
  Percent,
  CheckCircle2,
  Box,
  Smartphone
} from 'lucide-react';
import ExportButtons from '../common/ExportButtons';
import type { Report } from '../../utils/report';

interface ReportCard {
  id: string;
  title: string;
  description: string;
  category: 'FINANCIAL' | 'INVENTORY' | 'ANALYSIS' | 'SALES';
  tag: 'FREE' | 'BASIC' | 'PRO' | 'FULL';
  icon: any;
  color: string;
}

// ----------------------------------------------------
// Custom Native Premium SVG Chart Components
// ----------------------------------------------------

const DailyRevenueChart = ({ dailyData }: { dailyData: any[] }) => {
  if (!dailyData || !Array.isArray(dailyData) || dailyData.length === 0) return null;

  const maxVal = Math.max(...dailyData.map(d => Math.max(d.revenue, d.cost)), 1000);
  const days = dailyData.length;
  
  const width = 800;
  const height = 240;
  const paddingX = 40;
  const paddingY = 20;

  const getX = (index: number) => paddingX + (index * (width - 2 * paddingX) / (days - 1));
  const getY = (value: number) => height - paddingY - (value * (height - 2 * paddingY) / maxVal);

  const revenuePoints = dailyData.map((d, i) => `${getX(i)},${getY(d.revenue)}`);
  const costPoints = dailyData.map((d, i) => `${getX(i)},${getY(d.cost)}`);

  const revenuePath = `M ${revenuePoints.join(' L ')}`;
  const costPath = `M ${costPoints.join(' L ')}`;

  const revenueAreaPath = `${revenuePath} L ${getX(days - 1)},${height - paddingY} L ${getX(0)},${height - paddingY} Z`;
  const costAreaPath = `${costPath} L ${getX(days - 1)},${height - paddingY} L ${getX(0)},${height - paddingY} Z`;

  return (
    <div className="p-6 bg-white border border-slate-300 rounded-3xl shadow-sm mb-6">
      <h4 className="text-[11px] font-bold uppercase text-slate-600 tracking-wider mb-4">Curva Diaria de Rendimiento (Facturación vs Costos)</h4>
      
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[700px] h-auto overflow-visible">
          <defs>
            <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.00" />
            </linearGradient>
            <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.00" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
            const y = paddingY + r * (height - 2 * paddingY);
            const val = maxVal * (1 - r);
            return (
              <g key={idx}>
                <line x1={paddingX} y1={y} x2={width - paddingX} y2={y} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                <text x={paddingX - 8} y={y + 4} textAnchor="end" className="text-[9px] font-bold fill-slate-400">
                  {new Intl.NumberFormat('es-AR', { notation: 'compact' }).format(val)}
                </text>
              </g>
            );
          })}

          {/* X axis lines for dates (approx every 5 days) */}
          {dailyData.map((d, i) => {
            if (i % 5 !== 0 && i !== days - 1) return null;
            const x = getX(i);
            return (
              <g key={i}>
                <line x1={x} y1={paddingY} x2={x} y2={height - paddingY} stroke="#f1f5f9" strokeWidth="1" />
                <text x={x} y={height - paddingY + 14} textAnchor="middle" className="text-[9px] font-bold fill-slate-400">
                  Día {d.day}
                </text>
              </g>
            );
          })}

          {/* Areas */}
          <path d={revenueAreaPath} fill="url(#revenueGrad)" />
          <path d={costAreaPath} fill="url(#costGrad)" />

          {/* Lines */}
          <path d={revenuePath} fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d={costPath} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Points */}
          {dailyData.map((d, i) => {
            if (d.revenue === 0 && d.cost === 0) return null;
            return (
              <g key={i}>
                {d.revenue > 0 && (
                  <circle cx={getX(i)} cy={getY(d.revenue)} r="4" fill="#10b981" stroke="#fff" strokeWidth="1.5" />
                )}
                {d.cost > 0 && (
                  <circle cx={getX(i)} cy={getY(d.cost)} r="3" fill="#ef4444" stroke="#fff" strokeWidth="1.5" />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex gap-5 mt-3 justify-center text-[10px] font-bold uppercase tracking-wider text-slate-700">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 bg-emerald-500 rounded-full" />
          <span>Facturación</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 bg-red-500 rounded-full" />
          <span>Costo total</span>
        </div>
      </div>
    </div>
  );
};

const DonutChart = ({ data }: { data: any[] }) => {
  if (!data || !Array.isArray(data)) return null;
  const total = data.reduce((sum, item) => sum + item.sales, 0);
  if (total === 0) return null;

  let cumulativePercent = 0;
  const radius = 60;
  const circ = 2 * Math.PI * radius; // ~377

  return (
    <div className="flex flex-col md:flex-row items-center justify-center gap-10 p-6 bg-white border border-slate-300 rounded-3xl shadow-sm mb-6">
      <div className="relative w-48 h-48 flex-shrink-0">
        <svg viewBox="0 0 200 200" className="w-full h-full">
          <circle cx="100" cy="100" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="16" />
          
          {data.map((item, idx) => {
            if (item.sales === 0) return null;
            const percent = item.sales / total;
            const strokeLength = percent * circ;
            const strokeOffset = circ - strokeLength;
            const rotation = (cumulativePercent * 360) - 90;
            cumulativePercent += percent;

            return (
              <circle
                key={idx}
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth="16"
                strokeDasharray={`${strokeLength} ${circ - strokeLength}`}
                strokeDashoffset={0}
                transform={`rotate(${rotation} 100 100)`}
                strokeLinecap="round"
                className="transition-all duration-300 hover:stroke-[18] cursor-pointer"
              />
            );
          })}
          
          <text x="100" y="98" textAnchor="middle" className="text-[10px] font-bold fill-slate-400 uppercase tracking-widest">Ventas</text>
          <text x="100" y="118" textAnchor="middle" className="text-xs font-bold fill-slate-800 tracking-tight">
            {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(total)}
          </text>
        </svg>
      </div>

      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
        {data.map((item, idx) => {
          const percent = total > 0 ? (item.sales / total) * 100 : 0;
          if (item.sales === 0) return null;
          return (
            <div key={idx} className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-300">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-xs font-bold text-slate-700 truncate max-w-[120px]">{item.name}</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-slate-800 block">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(item.sales)}</span>
                <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block">{percent.toFixed(1)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CostVsSaleBar = ({ cost, sale }: { cost: number; sale: number }) => {
  const safeCost = cost || 0;
  const safeSale = sale || 0;
  const max = Math.max(safeCost, safeSale);
  if (max === 0) return null;
  const costPercent = (safeCost / max) * 100;
  const salePercent = (safeSale / max) * 100;

  return (
    <div className="p-6 bg-white border border-slate-300 rounded-3xl shadow-sm mb-6 space-y-5">
      <h4 className="text-[11px] font-bold uppercase text-slate-600 tracking-wider">Comparativa de Capital: Costo de Adquisición vs. Retorno Potencial</h4>
      
      <div className="space-y-4">
        {/* Cost Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-bold text-slate-700">
            <span>Capital a Costo</span>
            <span className="text-rose-600 font-bold">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(cost)}</span>
          </div>
          <div className="h-4 bg-slate-50 rounded-full overflow-hidden border border-slate-300 flex">
            <motion.div 
              initial={{ width: 0 }} 
              animate={{ width: `${costPercent}%` }} 
              transition={{ duration: 0.8 }} 
              className="h-full bg-gradient-to-r from-rose-500 to-rose-600 rounded-full"
            />
          </div>
        </div>

        {/* Sale Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-bold text-slate-700">
            <span>Valor de Venta Estimado</span>
            <span className="text-emerald-600 font-bold">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(sale)}</span>
          </div>
          <div className="h-4 bg-slate-50 rounded-full overflow-hidden border border-slate-300 flex">
            <motion.div 
              initial={{ width: 0 }} 
              animate={{ width: `${salePercent}%` }} 
              transition={{ duration: 0.8 }} 
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const ABCProgressChart = ({ data }: { data: any[] }) => {
  if (!data || !Array.isArray(data)) return null;
  const totalItems = data.length;
  if (totalItems === 0) return null;

  const aItems = data.filter(p => p.classification === 'A');
  const bItems = data.filter(p => p.classification === 'B');
  const cItems = data.filter(p => p.classification === 'C');

  const aRevenue = aItems.reduce((sum, p) => sum + p.revenue, 0);
  const bRevenue = bItems.reduce((sum, p) => sum + p.revenue, 0);
  const cRevenue = cItems.reduce((sum, p) => sum + p.revenue, 0);
  const totalRevenue = aRevenue + bRevenue + cRevenue;

  const aPercentRev = totalRevenue > 0 ? (aRevenue / totalRevenue) * 100 : 0;
  const bPercentRev = totalRevenue > 0 ? (bRevenue / totalRevenue) * 100 : 0;
  const cPercentRev = totalRevenue > 0 ? (cRevenue / totalRevenue) * 100 : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {[
        { cls: 'A', count: aItems.length, rev: aRevenue, percent: aPercentRev, color: 'bg-emerald-500 border-emerald-100 text-emerald-600 bg-emerald-50' },
        { cls: 'B', count: bItems.length, rev: bRevenue, percent: bPercentRev, color: 'bg-blue-500 border-blue-100 text-blue-600 bg-blue-50' },
        { cls: 'C', count: cItems.length, rev: cRevenue, percent: cPercentRev, color: 'bg-slate-400 border-slate-300 text-slate-700 bg-slate-50' }
      ].map((item) => (
        <div key={item.cls} className="p-5 rounded-3xl border-2 bg-white flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-slate-50 rounded-full blur-xl opacity-60" />
          
          <div>
            <div className="flex justify-between items-center mb-3">
              <span className={`text-xs font-bold px-3 py-1 rounded-xl uppercase tracking-wider ${item.color.split(' ')[2]} ${item.color.split(' ')[3]}`}>Clase {item.cls}</span>
              <span className="text-xs font-bold text-slate-600">{item.count} Prods</span>
            </div>
            
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Aporte de Ingresos</p>
            <p className="text-2xl font-bold text-slate-800">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(item.rev)}</p>
          </div>

          <div className="mt-5 space-y-1.5">
            <div className="flex justify-between text-[10px] font-bold uppercase text-slate-600">
              <span>Porcentaje de ventas</span>
              <span>{item.percent.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-slate-50 rounded-full overflow-hidden border border-slate-300 flex">
              <motion.div 
                initial={{ width: 0 }} 
                animate={{ width: `${item.percent}%` }} 
                transition={{ duration: 0.8 }} 
                className={`h-full ${item.color.split(' ')[0]} rounded-full`}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ----------------------------------------------------
// Main Reports Screen Component
// ----------------------------------------------------

export default function ReportsScreen() {
  const isManager = useCanAskBusiness();
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [abcFilter, setAbcFilter] = useState<'ALL' | 'A' | 'B' | 'C'>('ALL');

  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const years = [2025, 2026, 2027, 2028];
  /** Arma el informe que se ve en pantalla para bajarlo en Excel o PDF (ver utils/report) */
  const buildReport = (): Report | null => {
    if (!reportData || !activeReport) return null;
    const card = reportCards.find((r) => r.id === activeReport);
    const monthly = ['rentabilidad', 'rentabilidad_categoria', 'rotacion_inventario', 'movimientos', 'perdidas', 'devoluciones', 'cargas_virtuales'].includes(activeReport);
    const period = `${months[selectedMonth]} ${selectedYear}`;
    const subtitle = monthly ? `Período: ${period}` : `Al ${new Date().toLocaleDateString('es-AR')}`;
    const fileName = `${card?.title || 'Informe'} ${monthly ? period : new Date().toLocaleDateString('es-AR').replace(/\//g, '-')}`;
    const base = { title: card?.title || 'Informe', subtitle, fileName };
    const sum = (arr: any[], f: (x: any) => number) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
    const MOV: Record<string, string> = { ENTRY: 'Entrada', EXIT: 'Salida', ADJUSTMENT: 'Ajuste', SALE: 'Venta', RETURN: 'Devolución', PURCHASE: 'Compra', TRANSFER: 'Transferencia' };

    if (activeReport === 'stock_actual') {
      const list: any[] = reportData;
      const cost = sum(list, (p) => p.costPrice * p.stock);
      const sale = sum(list, (p) => p.salePrice * p.stock);
      return {
        ...base, title: 'Stock actual',
        summary: [
          { label: 'Productos activos', value: list.length, type: 'int' },
          { label: 'Unidades en stock', value: sum(list, (p) => p.stock), type: 'number' },
          { label: 'Valor a costo', value: cost, type: 'money' },
          { label: 'Valor a venta', value: sale, type: 'money', tone: 'good' },
        ],
        tables: [{
          title: 'Productos',
          columns: [{ header: 'Producto' }, { header: 'Código' }, { header: 'Categoría' }, { header: 'Stock', type: 'number' }, { header: 'Mínimo', type: 'number' }, { header: 'Costo', type: 'money' }, { header: 'Precio de venta', type: 'money' }, { header: 'Valor a costo', type: 'money' }, { header: 'Valor a venta', type: 'money' }],
          rows: list.map((p) => [p.name, p.sku || p.barcode || '', p.category?.name || '', p.stock, p.minStock ?? null, p.costPrice, p.salePrice, p.costPrice * p.stock, p.salePrice * p.stock]),
          totals: ['Total', '', '', sum(list, (p) => p.stock), null, null, null, cost, sale],
        }],
      };
    }
    if (activeReport === 'stock_bajo') {
      const list: any[] = reportData;
      return {
        ...base, title: 'Stock bajo',
        summary: [
          { label: 'Productos para reponer', value: list.length, type: 'int', tone: list.length ? 'bad' : 'good' },
          { label: 'Sin stock', value: list.filter((p) => p.stock <= 0).length, type: 'int', tone: 'bad' },
          { label: 'Costo de reponer al mínimo', value: sum(list, (p) => Math.max(0, (p.minStock || 0) - p.stock) * (p.costPrice || 0)), type: 'money' },
        ],
        tables: [{
          title: 'Productos con stock igual o menor al mínimo',
          columns: [{ header: 'Producto' }, { header: 'Código' }, { header: 'Stock actual', type: 'number' }, { header: 'Mínimo', type: 'number' }, { header: 'Faltan', type: 'number' }, { header: 'Costo', type: 'money' }, { header: 'Costo de reponer', type: 'money' }],
          rows: list.map((p) => { const falta = Math.max(0, (p.minStock || 0) - p.stock); return [p.name, p.sku || p.barcode || '', p.stock, p.minStock, falta, p.costPrice, falta * (p.costPrice || 0)]; }),
          emptyText: 'No hay productos con stock bajo',
        }],
      };
    }
    if (activeReport === 'rentabilidad') {
      const d = reportData;
      const days = (d.dailyData || []).filter((x: any) => x.revenue || x.cost);
      return {
        ...base,
        summary: [
          { label: 'Facturación', value: d.totalSales, type: 'money' },
          { label: 'Costo de ventas', value: d.totalCost, type: 'money' },
          { label: 'Ganancia', value: d.netProfit, type: 'money', tone: d.netProfit >= 0 ? 'good' : 'bad' },
          { label: 'Margen promedio', value: d.margin, type: 'percent' },
        ],
        tables: [
          {
            title: 'Productos más rentables',
            columns: [{ header: '#', type: 'int' }, { header: 'Producto' }, { header: 'Cantidad vendida', type: 'number' }, { header: 'Ingresos', type: 'money' }, { header: 'Costo', type: 'money' }, { header: 'Ganancia', type: 'money' }, { header: 'Margen', type: 'percent' }],
            rows: (d.topProfitable || []).map((p: any, i: number) => [i + 1, p.name, p.qty, p.revenue, p.cost, p.profit, p.revenue > 0 ? (p.profit / p.revenue) * 100 : null]),
          },
          {
            title: 'Día por día',
            columns: [{ header: 'Fecha', type: 'date' }, { header: 'Facturación', type: 'money' }, { header: 'Costo', type: 'money' }, { header: 'Ganancia', type: 'money' }, { header: 'Margen', type: 'percent' }],
            rows: days.map((x: any) => [new Date(selectedYear, selectedMonth, x.day), x.revenue, x.cost, x.profit ?? x.revenue - x.cost, x.revenue > 0 ? ((x.revenue - x.cost) / x.revenue) * 100 : null]),
            totals: ['Total', d.totalSales, d.totalCost, d.netProfit, d.margin],
            emptyText: 'No hubo ventas en el mes',
          },
        ],
      };
    }
    if (activeReport === 'rentabilidad_categoria') {
      const list: any[] = reportData;
      const sales = sum(list, (c) => c.sales), cost = sum(list, (c) => c.cost), profit = sum(list, (c) => c.profit);
      return {
        ...base,
        summary: [
          { label: 'Ventas', value: sales, type: 'money' },
          { label: 'Costo', value: cost, type: 'money' },
          { label: 'Ganancia', value: profit, type: 'money', tone: profit >= 0 ? 'good' : 'bad' },
          { label: 'Margen', value: sales > 0 ? (profit / sales) * 100 : 0, type: 'percent' },
        ],
        tables: [{
          title: 'Por categoría',
          columns: [{ header: 'Categoría' }, { header: 'Ventas', type: 'money' }, { header: '% de las ventas', type: 'percent' }, { header: 'Costo', type: 'money' }, { header: 'Ganancia', type: 'money' }, { header: 'Margen', type: 'percent' }],
          rows: list.map((c) => [c.name, c.sales, sales > 0 ? (c.sales / sales) * 100 : 0, c.cost, c.profit, c.sales > 0 ? (c.profit / c.sales) * 100 : 0]),
          totals: ['Total', sales, 100, cost, profit, sales > 0 ? (profit / sales) * 100 : 0],
        }],
      };
    }
    if (activeReport === 'rotacion_inventario') {
      const list: any[] = reportData;
      const total = sum(list, (p) => p.revenue);
      const cls = (k: string) => list.filter((p) => p.classification === k);
      const shown = list.filter((p) => abcFilter === 'ALL' || p.classification === abcFilter);
      return {
        ...base, subtitle: `${subtitle}${abcFilter !== 'ALL' ? ` · Solo clase ${abcFilter}` : ''}`,
        summary: (['A', 'B', 'C'] as const).map((k) => ({ label: `Clase ${k} · ${cls(k).length} productos`, value: total > 0 ? (sum(cls(k), (p) => p.revenue) / total) * 100 : 0, type: 'percent' as const, tone: k === 'C' ? 'warn' as const : 'good' as const })),
        tables: [{
          title: 'Clasificación ABC',
          columns: [{ header: '#', type: 'int' }, { header: 'Producto' }, { header: 'Unidades vendidas', type: 'number' }, { header: 'Facturación', type: 'money' }, { header: '% de la facturación', type: 'percent' }, { header: 'Clase' }],
          rows: shown.map((p, i) => [i + 1, p.name, p.qty, p.revenue, total > 0 ? (p.revenue / total) * 100 : 0, p.classification]),
          totals: ['Total', '', sum(shown, (p) => p.qty), sum(shown, (p) => p.revenue), total > 0 ? (sum(shown, (p) => p.revenue) / total) * 100 : 0, ''],
          emptyText: 'No hubo ventas en el período',
        }],
        notes: ['A: los productos que suman el 80% de la facturación. B: el 15% siguiente. C: el 5% restante (baja rotación).'],
      };
    }
    if (activeReport === 'valorizacion') {
      const d = reportData;
      return {
        ...base,
        summary: [
          { label: 'Unidades en stock', value: d.itemCount, type: 'number' },
          { label: 'Valor a costo', value: d.totalCost, type: 'money' },
          { label: 'Valor a venta', value: d.totalSale, type: 'money' },
          { label: 'Markup promedio', value: d.margin, type: 'percent' },
          { label: 'Ganancia potencial', value: d.potentialProfit, type: 'money', tone: 'good' },
        ],
        tables: [],
        notes: ['La ganancia potencial es lo que quedaría si se vende todo el stock actual a los precios de hoy.'],
      };
    }
    if (activeReport === 'perdidas') {
      const list: any[] = reportData;
      const cost = sum(list, (m) => Math.abs(m.quantity) * (m.product?.costPrice || 0));
      return {
        ...base,
        summary: [
          { label: 'Registros de pérdida', value: list.length, type: 'int' },
          { label: 'Unidades perdidas', value: sum(list, (m) => Math.abs(m.quantity)), type: 'number', tone: 'bad' },
          { label: 'Costo aproximado', value: cost, type: 'money', tone: 'bad' },
        ],
        tables: [{
          title: 'Pérdidas y mermas',
          columns: [{ header: 'Fecha', type: 'datetime' }, { header: 'Producto' }, { header: 'Cantidad', type: 'number' }, { header: 'Costo unitario', type: 'money' }, { header: 'Costo perdido', type: 'money' }, { header: 'Motivo' }],
          rows: list.map((m) => [m.createdAt, m.product?.name || '', Math.abs(m.quantity), m.product?.costPrice ?? null, Math.abs(m.quantity) * (m.product?.costPrice || 0), m.reason || '']),
          totals: ['Total', '', sum(list, (m) => Math.abs(m.quantity)), null, cost, ''],
          emptyText: 'Sin pérdidas registradas en el período',
        }],
      };
    }
    if (activeReport === 'movimientos') {
      const list: any[] = reportData;
      return {
        ...base,
        summary: [
          { label: 'Movimientos', value: list.length, type: 'int' },
          { label: 'Unidades que entraron', value: sum(list.filter((m) => m.type === 'ENTRY'), (m) => Math.abs(m.quantity)), type: 'number', tone: 'good' },
          { label: 'Unidades que salieron', value: sum(list.filter((m) => m.type === 'EXIT'), (m) => Math.abs(m.quantity)), type: 'number', tone: 'bad' },
        ],
        tables: [{
          title: 'Movimientos de inventario',
          columns: [{ header: 'Fecha', type: 'datetime' }, { header: 'Producto' }, { header: 'Tipo' }, { header: 'Cantidad', type: 'number' }, { header: 'Referencia / motivo' }],
          rows: list.map((m) => [m.createdAt, m.product?.name || '', MOV[m.type] || m.type, m.quantity, m.reference || m.reason || '']),
          emptyText: 'Sin movimientos en el período',
        }],
      };
    }
    if (activeReport === 'devoluciones') {
      const list: any[] = reportData.list || [];
      const amount = (s: any) => s.status === 'CANCELLED' ? (s.total || 0) : sum((s.items || []).filter((i: any) => i.quantity < 0), (i) => Math.abs(i.total));
      const detail = (s: any) => s.status === 'CANCELLED' ? 'Venta cancelada completa' : (s.items || []).filter((i: any) => i.quantity < 0).map((i: any) => `${Math.abs(i.quantity)}x ${i.productName}`).join(', ');
      return {
        ...base,
        summary: [
          { label: 'Devoluciones y cancelaciones', value: list.length, type: 'int' },
          { label: 'Cancelaciones', value: list.filter((s) => s.status === 'CANCELLED').length, type: 'int' },
          { label: 'Total devuelto', value: reportData.totalRefunded, type: 'money', tone: 'bad' },
        ],
        tables: [{
          title: 'Detalle',
          columns: [{ header: 'Ticket' }, { header: 'Fecha', type: 'datetime' }, { header: 'Tipo' }, { header: 'Cajero' }, { header: 'Detalle' }, { header: 'Monto devuelto', type: 'money' }],
          rows: list.map((s) => [`N° ${s.saleNumber}`, s.createdAt, s.status === 'CANCELLED' ? 'Cancelación' : 'Cambio', s.user?.fullName || '', detail(s), amount(s)]),
          totals: ['Total', null, '', '', '', sum(list, amount)],
          emptyText: 'No hubo devoluciones en el período',
        }],
      };
    }
    if (activeReport === 'cargas_virtuales') {
      const d = reportData;
      const items: any[] = d.items || [];
      return {
        ...base,
        summary: [
          { label: 'Carga virtual 1', value: d.totalVirtual1, type: 'money' },
          { label: 'Carga virtual 2', value: d.totalVirtual2, type: 'money' },
          { label: 'Total', value: d.totalVirtualAmount, type: 'money', tone: 'good' },
          { label: 'Operaciones', value: items.length, type: 'int' },
        ],
        tables: [{
          title: 'Cargas',
          columns: [{ header: 'Fecha', type: 'datetime' }, { header: 'Tipo de carga' }, { header: 'Monto', type: 'money' }],
          rows: items.map((it) => [it.createdAt, it.type, it.amount]),
          totals: ['Total', '', d.totalVirtualAmount],
          emptyText: 'No hubo cargas virtuales en el período',
        }],
      };
    }
    return null;
  };



  const reportCards: ReportCard[] = [
    {
      id: 'rentabilidad',
      title: 'Rentabilidad',
      description: 'Análisis completo de ganancias, márgenes y productos más rentables.',
      category: 'FINANCIAL',
      tag: 'FREE',
      icon: TrendingUp,
      color: 'from-emerald-500/10 to-teal-500/10 text-emerald-600 border-emerald-100 hover:border-emerald-300'
    },
    {
      id: 'rentabilidad_categoria',
      title: 'Rentabilidad por Categoría',
      description: 'Análisis de ventas, ganancias y márgenes agrupados por categoría de productos.',
      category: 'FINANCIAL',
      tag: 'BASIC',
      icon: Layers,
      color: 'from-blue-500/10 to-rose-500/10 text-blue-600 border-blue-100 hover:border-blue-300'
    },
    {
      id: 'rotacion_inventario',
      title: 'Rotación de Inventario',
      description: 'Velocidad de rotación, productos estrella y clasificación ABC (últimos 30 días).',
      category: 'INVENTORY',
      tag: 'PRO',
      icon: RefreshCw,
      color: 'from-purple-500/10 to-pink-500/10 text-purple-600 border-purple-100 hover:border-purple-300'
    },
    {
      id: 'stock_actual',
      title: 'Stock Actual',
      description: 'Reporte detallado del inventario actual con valores y estados.',
      category: 'INVENTORY',
      tag: 'FREE',
      icon: Package,
      color: 'from-sky-500/10 to-cyan-500/10 text-sky-600 border-sky-100 hover:border-sky-300'
    },
    {
      id: 'stock_bajo',
      title: 'Stock Bajo',
      description: 'Productos con stock por debajo del mínimo establecido.',
      category: 'INVENTORY',
      tag: 'FREE',
      icon: AlertTriangle,
      color: 'from-rose-500/10 to-orange-500/10 text-rose-600 border-rose-100 hover:border-rose-300'
    },
    {
      id: 'movimientos',
      title: 'Movimientos',
      description: 'Historial de movimientos de inventario por período.',
      category: 'INVENTORY',
      tag: 'BASIC',
      icon: Activity,
      color: 'from-violet-500/10 to-rose-500/10 text-violet-600 border-violet-100 hover:border-violet-300'
    },
    {
      id: 'valorizacion',
      title: 'Valorización',
      description: 'Valor total del inventario actual y análisis de costos.',
      category: 'ANALYSIS',
      tag: 'FULL',
      icon: LineChart,
      color: 'from-amber-500/10 to-orange-500/10 text-amber-600 border-amber-100 hover:border-amber-300'
    },
    {
      id: 'perdidas',
      title: 'Pérdidas',
      description: 'Análisis de pérdidas por vencimiento o deterioro.',
      category: 'ANALYSIS',
      tag: 'FULL',
      icon: XCircle,
      color: 'from-red-500/10 to-rose-500/10 text-red-600 border-red-100 hover:border-red-300'
    },
    {
      id: 'devoluciones',
      title: 'Devoluciones',
      description: 'Análisis de devoluciones y cambios: quién devuelve más, productos frecuentes y motivos.',
      category: 'SALES',
      tag: 'FULL',
      icon: CornerUpLeft,
      color: 'from-fuchsia-500/10 to-pink-500/10 text-fuchsia-600 border-fuchsia-100 hover:border-fuchsia-300'
    },
    {
      id: 'cargas_virtuales',
      title: 'Cargas Virtuales',
      description: 'Reporte detallado de cargas virtuales (1 y 2) vendidas en el periodo.',
      category: 'SALES',
      tag: 'FULL',
      icon: Smartphone,
      color: 'from-rose-500/10 to-blue-500/10 text-rose-600 border-rose-100 hover:border-rose-300'
    }
  ];

  const fmt = (p: any) => {
    const num = Number(p);
    if (isNaN(num) || !isFinite(num)) return '$0';
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(num);
  };

  const fmtDate = (d: string) => {
    try {
      const date = new Date(d);
      if (isNaN(date.getTime())) return 'N/A';
      return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'N/A';
    }
  };

  useEffect(() => {
    let active = true;
    
    const load = async () => {
      if (!activeReport) return;
      setReportData(null);
      setIsLoading(true);
      try {
        const fromDate = new Date(selectedYear, selectedMonth, 1);
        const toDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);

        const params = {
          from: fromDate.toISOString(),
          to: toDate.toISOString()
        };

        let dataResult: any = null;

        if (activeReport === 'stock_actual') {
          const { data } = await api.get('/products', { params: { take: 10000 } });
          dataResult = Array.isArray(data) ? data : [];
        } else if (activeReport === 'stock_bajo') {
          const { data } = await api.get('/products', { params: { lowStock: 'true', take: 10000 } });
          dataResult = Array.isArray(data) ? data : [];
        } else if (activeReport === 'cargas_virtuales') {
          const { data } = await api.get('/sales/virtual-metrics', { params });
          dataResult = data;
        } else if (activeReport === 'movimientos') {
          const { data } = await api.get('/products/movements/all', { params: { ...params, limit: 2000 } });
          dataResult = Array.isArray(data) ? data : [];
        } else if (activeReport === 'rentabilidad' || activeReport === 'rentabilidad_categoria' || activeReport === 'rotacion_inventario' || activeReport === 'devoluciones' || activeReport === 'valorizacion') {
          // Se calcula en el servidor sobre todas las ventas del mes (antes se bajaban hasta 2500 y se sumaban acá)
          const { data } = await api.get(`/sales/reports/${activeReport}`, { params: { ...params, tzOffset: fromDate.getTimezoneOffset() } });
          if (activeReport === 'rentabilidad') {
            const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
            const dailyData = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, revenue: 0, cost: 0, profit: 0 }));
            for (const d of data?.daily || []) {
              if (d.day >= 1 && d.day <= daysInMonth) dailyData[d.day - 1] = d;
            }
            const { daily: _daily, ...totals } = data || {};
            dataResult = { ...totals, topProfitable: data?.topProfitable || [], dailyData };
          } else {
            dataResult = data ?? (activeReport === 'devoluciones' ? { list: [], totalRefunded: 0 } : []);
          }
        } else if (activeReport === 'perdidas') {
          const { data: movements } = await api.get('/products/movements/all', { params: { ...params, limit: 5000 } });
          if (Array.isArray(movements)) {
            dataResult = movements.filter((m: any) => {
              const d = new Date(m.createdAt);
              const isLoss = m.type === 'EXIT' && (
                m.reason?.toLowerCase().includes('vencido') || 
                m.reason?.toLowerCase().includes('vencimiento') ||
                m.reason?.toLowerCase().includes('roto') ||
                m.reason?.toLowerCase().includes('rotura') ||
                m.reason?.toLowerCase().includes('merma') ||
                m.reason?.toLowerCase().includes('perdida') ||
                m.reason?.toLowerCase().includes('deterioro')
              );
              return isLoss && d >= fromDate && d <= toDate;
            });
          } else {
            dataResult = [];
          }
        }

        if (active) {
          setReportData(dataResult);
        }
      } catch (err: any) {
        console.error('Error loading report:', err);
        if (active) {
          toast.error('Error al cargar datos del reporte');
          setReportData(null);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [activeReport, selectedMonth, selectedYear]);

  const filteredReports = reportCards.filter(r => 
    r.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    r.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col gap-5 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-emerald-500" /> Analítica y Reportes
          </h1>
          <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest mt-0.5">Análisis y estadísticas de tu negocio</p>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search 
            className="absolute left-4 w-4 h-4 text-slate-600" 
            style={{ top: '50%', transform: 'translateY(-50%)' }} 
          />
          <input 
            type="text" 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            placeholder="Buscar reportes..." 
            className="w-full bg-white border border-slate-300 rounded-2xl pl-11 pr-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-emerald-500 transition-all placeholder:text-slate-600"
          />
        </div>
      </div>

      {/* Grid of Report Cards */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <YearReviewBanner className="mb-5" />
        {isManager && <div className="mb-5"><AskBusiness /></div>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 pb-6">
          {filteredReports.map((report) => (
            <button
              key={report.id}
              onClick={() => {
                setReportData(null);
                setActiveReport(report.id);
              }}
              className="card p-6 flex flex-col items-start text-left border border-slate-300 hover:border-slate-300 hover:shadow-xl hover:shadow-slate-500/5 transition-all duration-300 group select-none cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-center justify-between w-full">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-300 flex items-center justify-center shrink-0">
                  <report.icon className={`w-6 h-6 ${report.color.split(' ')[2]}`} />
                </div>
              </div>
              <h3 className="text-sm font-bold text-slate-800 tracking-tight mt-5 group-hover:text-emerald-600 transition-colors">
                {report.title}
              </h3>
              <p className="text-[11px] text-slate-600 font-bold uppercase tracking-wider mt-1">
                {report.category}
              </p>
              <p className="text-[11px] text-slate-600/80 font-medium leading-relaxed mt-2.5">
                {report.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Modal with Live Data Report */}
      <AnimatePresence>
        {activeReport && (
          <motion.div 
            key="reports-modal"
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" 
            onClick={() => setActiveReport(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              onClick={(e) => e.stopPropagation()} 
              className="bg-white rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col h-[90vh]"
            >
              {/* Modal Header */}
              <div className="px-8 py-6 border-b border-slate-300 flex items-center justify-between bg-white shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                    {reportCards.find(r => r.id === activeReport)?.title}
                  </h2>
                  <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest mt-0.5">Reportes & Estadísticas en Vivo</p>
                </div>

                <div className="flex items-center gap-3">
                  {/* Calendar Filters inside Modal */}
                  {['rentabilidad', 'rentabilidad_categoria', 'rotacion_inventario', 'movimientos', 'perdidas', 'devoluciones', 'cargas_virtuales'].includes(activeReport) && (
                    <div className="flex items-center gap-1">
                      <select 
                        value={selectedMonth} 
                        onChange={(e) => setSelectedMonth(Number(e.target.value))} 
                        className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-[10px] font-bold text-slate-700 outline-none capitalize"
                      >
                        {months.map((m, i) => (
                          <option key={m} value={i}>{m}</option>
                        ))}
                      </select>
                      <select 
                        value={selectedYear} 
                        onChange={(e) => setSelectedYear(Number(e.target.value))} 
                        className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-[10px] font-bold text-slate-700 outline-none"
                      >
                        {years.map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {reportData && (
                    <div className="ml-2 border-l border-slate-300 pl-3">
                      <ExportButtons variant="compact" build={buildReport} />
                    </div>
                  )}

                  <button 
                    onClick={() => setActiveReport(null)} 
                    className="p-2 hover:bg-slate-50 rounded-xl text-slate-600 hover:text-slate-600 transition-all cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="p-8 overflow-y-auto custom-scrollbar flex-1 bg-slate-50/20">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center text-slate-600 font-medium">
                    Calculando y cargando estadísticas...
                  </div>
                ) : !reportData ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2">
                    <Info className="w-8 h-8 text-slate-300 animate-pulse" />
                    <p className="text-xs">No se pudieron cargar los datos.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Render specific report based on selection */}
                    
                    {/* A. STOCK ACTUAL */}
                    {activeReport === 'stock_actual' && (
                      <div className="space-y-4">
                        {/* Summary Header */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white border border-slate-300 p-4 rounded-2xl shadow-sm">
                          <div>
                            <span className="text-[9px] font-bold text-slate-600 uppercase">Productos Activos</span>
                            <p className="text-lg font-bold text-slate-700 mt-0.5">{reportData.length}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-slate-600 uppercase">Stock Total</span>
                            <p className="text-lg font-bold text-slate-700 mt-0.5">{reportData.reduce((s: number, p: any) => s + p.stock, 0)} u.</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-slate-600 uppercase">Valor a Costo</span>
                            <p className="text-lg font-bold text-rose-600 mt-0.5">{fmt(reportData.reduce((s: number, p: any) => s + (p.costPrice * p.stock), 0))}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-slate-600 uppercase">Valor a Venta</span>
                            <p className="text-lg font-bold text-emerald-600 mt-0.5">{fmt(reportData.reduce((s: number, p: any) => s + (p.salePrice * p.stock), 0))}</p>
                          </div>
                        </div>

                        {/* List */}
                        <div className="bg-white border border-slate-300 rounded-2xl overflow-x-auto shadow-sm">
                          <table className="w-full min-w-[650px] text-xs text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-300 text-[9px] font-bold text-slate-600 uppercase tracking-widest"><th className="p-3 pl-4">Producto</th><th className="p-3">SKU</th><th className="p-3 text-right">Stock</th><th className="p-3 text-right">P. Costo</th><th className="p-3 text-right">P. Venta</th><th className="p-3 text-right pr-4">Total Costo</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {reportData.map((p: any) => (
                                <tr key={p.id} className="hover:bg-slate-50/40 text-slate-700">
                                  <td className="p-3 pl-4 font-bold text-slate-800">{p.name}</td>
                                  <td className="p-3 text-slate-600 font-semibold">{p.sku || 'N/A'}</td>
                                  <td className="p-3 text-right font-bold text-slate-600">{p.stock}</td>
                                  <td className="p-3 text-right font-medium text-slate-700">{fmt(p.costPrice)}</td>
                                  <td className="p-3 text-right font-bold text-slate-700">{fmt(p.salePrice)}</td>
                                  <td className="p-3 text-right pr-4 font-bold text-slate-900">{fmt(p.costPrice * p.stock)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* B. STOCK BAJO */}
                    {activeReport === 'stock_bajo' && (
                      <div className="space-y-4">
                        {reportData.length === 0 ? (
                          <div className="flex flex-col items-center justify-center p-8 gap-3 bg-white rounded-2xl border border-slate-300 shadow-sm text-slate-600">
                            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                            <p className="text-sm font-semibold">Excelente! No hay productos con stock bajo en este momento.</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3">
                              <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
                              <p className="text-xs font-semibold text-rose-700">Se encontraron {reportData.length} productos con existencias iguales o inferiores a su mínimo establecido.</p>
                            </div>
                            <div className="bg-white border border-slate-300 rounded-2xl overflow-x-auto shadow-sm">
                              <table className="w-full min-w-[600px] text-xs text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-300 text-[9px] font-bold text-slate-600 uppercase tracking-widest"><th className="p-3 pl-4">Producto</th><th className="p-3">SKU</th><th className="p-3 text-right">Stock Actual</th><th className="p-3 text-right pr-4">Mínimo</th></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {reportData.map((p: any) => (
                                    <tr key={p.id} className="hover:bg-slate-50/40 text-slate-700">
                                      <td className="p-3 pl-4 font-bold text-slate-800">{p.name}</td>
                                      <td className="p-3 text-slate-600 font-semibold">{p.sku || 'N/A'}</td>
                                      <td className="p-3 text-right font-bold text-rose-600">{p.stock}</td>
                                      <td className="p-3 text-right pr-4 font-bold text-slate-700">{p.minStock}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* C. RENTABILIDAD */}
                    {activeReport === 'rentabilidad' && (
                      <div className="space-y-6">
                        {/* 4 Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="p-4 rounded-2xl bg-white border border-slate-300 shadow-sm">
                            <span className="text-[9px] font-bold text-slate-600 uppercase block">Facturación</span>
                            <span className="text-xl font-bold text-slate-800 mt-1 block">{fmt(reportData.totalSales)}</span>
                          </div>
                          <div className="p-4 rounded-2xl bg-white border border-slate-300 shadow-sm">
                            <span className="text-[9px] font-bold text-slate-600 uppercase block">Costo de Ventas</span>
                            <span className="text-xl font-bold text-slate-800 mt-1 block">{fmt(reportData.totalCost)}</span>
                          </div>
                          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 shadow-sm">
                            <span className="text-[9px] font-bold text-emerald-600 uppercase block">Ganancia Neta</span>
                            <span className="text-xl font-bold text-emerald-700 mt-1 block">{fmt(reportData.netProfit)}</span>
                          </div>
                          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100 shadow-sm">
                            <span className="text-[9px] font-bold text-rose-600 uppercase block">Margen Promedio</span>
                            <span className="text-xl font-bold text-rose-700 mt-1 block">{reportData.margin.toFixed(1)}%</span>
                          </div>
                        </div>

                        {/* Premium SVG Area Line Chart */}
                        <DailyRevenueChart dailyData={reportData.dailyData} />

                        {/* Top Most Profitable Products */}
                        <div>
                          <h4 className="text-xs font-bold uppercase text-slate-600 tracking-wider mb-3">Top 10 Productos Más Rentables</h4>
                          <div className="bg-white border border-slate-300 rounded-2xl overflow-x-auto shadow-sm">
                            <table className="w-full min-w-[650px] text-xs text-left border-collapse">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-300 text-[9px] font-bold text-slate-600 uppercase tracking-widest"><th className="p-3 pl-4">Producto</th><th className="p-3 text-right">Cant. Vendida</th><th className="p-3 text-right">Ingresos</th><th className="p-3 text-right">Costo</th><th className="p-3 text-right pr-4">Ganancia</th></tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {reportData.topProfitable.map((p: any, i: number) => (
                                  <tr key={i} className="hover:bg-slate-50/40 text-slate-700">
                                    <td className="p-3 pl-4 font-bold text-slate-800">{p.name}</td>
                                    <td className="p-3 text-right text-slate-700 font-semibold">{p.qty}</td>
                                    <td className="p-3 text-right text-slate-600 font-bold">{fmt(p.revenue)}</td>
                                    <td className="p-3 text-right text-slate-600 font-medium">{fmt(p.cost)}</td>
                                    <td className="p-3 text-right pr-4 font-bold text-emerald-600">{fmt(p.profit)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* D. RENTABILIDAD POR CATEGORÍA */}
                    {activeReport === 'rentabilidad_categoria' && (
                      <div className="space-y-4">
                        {reportData.length === 0 ? (
                          <p className="text-xs text-slate-600 text-center py-10">No se registraron ventas en este período.</p>
                        ) : (
                          <>
                            {/* Premium SVG Donut Chart */}
                            <DonutChart data={reportData} />
                            
                            <div className="bg-white border border-slate-300 rounded-2xl overflow-x-auto shadow-sm">
                              <table className="w-full min-w-[650px] text-xs text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-300 text-[9px] font-bold text-slate-600 uppercase tracking-widest"><th className="p-3 pl-4">Categoría</th><th className="p-3 text-right">Ventas Totales</th><th className="p-3 text-right">Costos</th><th className="p-3 text-right">Ganancia</th><th className="p-3 text-right pr-4">Margen %</th></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {reportData.map((c: any, i: number) => (
                                    <tr key={i} className="hover:bg-slate-50/40 text-slate-700">
                                      <td className="p-3 pl-4 font-bold text-slate-800 flex items-center gap-2">
                                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                                        {c.name}
                                      </td>
                                      <td className="p-3 text-right font-semibold text-slate-600">{fmt(c.sales)}</td>
                                      <td className="p-3 text-right text-slate-600 font-medium">{fmt(c.cost)}</td>
                                      <td className="p-3 text-right font-bold text-slate-800">{fmt(c.profit)}</td>
                                      <td className="p-3 text-right pr-4 font-bold text-emerald-600">{c.sales > 0 ? ((c.profit / c.sales) * 100).toFixed(1) : 0}%</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* E. ROTACIÓN DE INVENTARIO */}
                    {activeReport === 'rotacion_inventario' && (
                      <div className="space-y-4">
                        <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex gap-3 text-xs leading-relaxed text-rose-700">
                          <Info className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">Clasificación ABC de Inventario</p>
                            <p className="mt-0.5 text-rose-600"><b>A:</b> Productos críticos que representan el 80% de tus ingresos. <b>B:</b> Productos de rotación media (15% de ingresos). <b>C:</b> Productos de baja rotación (5% restante).</p>
                          </div>
                        </div>

                        {reportData.length === 0 ? (
                          <p className="text-xs text-slate-600 text-center py-10">No se registraron ventas en este período.</p>
                        ) : (
                          <>
                            {/* Premium SVG ABC Classification cards */}
                            <ABCProgressChart data={reportData} />

                            {/* Filtro ABC */}
                            <div className="flex items-center justify-between bg-slate-50 border border-slate-150 p-4 rounded-2xl shadow-sm">
                              <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">Filtrar por clasificación:</span>
                              <div className="flex gap-2">
                                {(['ALL', 'A', 'B', 'C'] as const).map((type) => (
                                  <button
                                    key={type}
                                    type="button"
                                    onClick={() => setAbcFilter(type)}
                                    className={`px-4 py-2 rounded-xl text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                                      abcFilter === type
                                        ? 'bg-rose-600 text-white shadow-md active:scale-95'
                                        : 'bg-white border border-slate-400 text-slate-700 hover:bg-slate-100 hover:text-slate-700 active:scale-95'
                                    }`}
                                  >
                                    {type === 'ALL' ? 'Todos' : `Clase ${type}`}
                                  </button>
                                ))}
                              </div>
                            </div>
                            
                            <div className="bg-white border border-slate-300 rounded-2xl overflow-x-auto shadow-sm">
                              <table className="w-full min-w-[650px] text-xs text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-300 text-[9px] font-bold text-slate-600 uppercase tracking-widest"><th className="p-3 pl-4">Producto</th><th className="p-3 text-right">U. Vendidas</th><th className="p-3 text-right">Facturación</th><th className="p-3 text-right pr-4">Clasificación</th></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {reportData
                                    .filter((p: any) => abcFilter === 'ALL' || p.classification === abcFilter)
                                    .map((p: any, i: number) => (
                                      <tr key={i} className="hover:bg-slate-50/40 text-slate-700">
                                        <td className="p-3 pl-4 font-bold text-slate-800">{p.name}</td>
                                        <td className="p-3 text-right text-slate-700 font-semibold">{p.qty}</td>
                                        <td className="p-3 text-right font-bold text-slate-700">{fmt(p.revenue)}</td>
                                        <td className="p-3 text-right pr-4">
                                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-lg border uppercase tracking-wider ${p.classification === 'A' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : p.classification === 'B' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-slate-50 text-slate-600 border-slate-300'}`}>
                                            Clase {p.classification}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* F. VALORIZACIÓN */}
                    {activeReport === 'valorizacion' && (
                      <div className="space-y-6">
                        {/* 4 Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="p-4 rounded-2xl bg-white border border-slate-300 shadow-sm">
                            <span className="text-[9px] font-bold text-slate-600 uppercase block">Existencias Totales</span>
                            <span className="text-xl font-bold text-slate-800 mt-1 block">{reportData.itemCount} u.</span>
                          </div>
                          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100 shadow-sm">
                            <span className="text-[9px] font-bold text-rose-600 uppercase block">Valor a Costo</span>
                            <span className="text-xl font-bold text-rose-700 mt-1 block">{fmt(reportData.totalCost)}</span>
                          </div>
                          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 shadow-sm">
                            <span className="text-[9px] font-bold text-emerald-600 uppercase block">Valor a Venta</span>
                            <span className="text-xl font-bold text-emerald-700 mt-1 block">{fmt(reportData.totalSale)}</span>
                          </div>
                          <div className="p-4 rounded-2xl bg-white border border-slate-300 shadow-sm">
                            <span className="text-[9px] font-bold text-slate-600 uppercase block">Markup / Retorno Potencial</span>
                            <span className="text-xl font-bold text-slate-800 mt-1 block">{reportData.margin.toFixed(1)}%</span>
                          </div>
                        </div>

                        {/* Premium Double Bar Chart */}
                        <CostVsSaleBar cost={reportData.totalCost} sale={reportData.totalSale} />

                        <div className="p-6 rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/10 flex items-center justify-between">
                          <div>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-100 block">GANANCIA POTENCIAL EN ESTANTERÍAS</span>
                            <h3 className="text-2xl font-bold mt-1">{fmt(reportData.potentialProfit)}</h3>
                            <p className="text-[10px] text-emerald-100 font-bold mt-1.5">Si vendés el 100% de la mercadería disponible a precio de catálogo.</p>
                          </div>
                          <DollarSign className="w-12 h-12 text-white/30" />
                        </div>
                      </div>
                    )}

                    {/* G. PÉRDIDAS */}
                    {activeReport === 'perdidas' && (
                      <div className="space-y-4">
                        {reportData.length === 0 ? (
                          <div className="flex flex-col items-center justify-center p-8 gap-3 bg-white rounded-2xl border border-slate-300 shadow-sm text-slate-600">
                            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                            <p className="text-sm font-semibold">Sin pérdidas operativas registradas por merma en este mes.</p>
                          </div>
                        ) : (
                          <div className="bg-white border border-slate-300 rounded-2xl overflow-x-auto shadow-sm">
                            <table className="w-full min-w-[600px] text-xs text-left border-collapse">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-300 text-[9px] font-bold text-slate-600 uppercase tracking-widest"><th className="p-3 pl-4">Producto</th><th className="p-3">Fecha</th><th className="p-3 text-right">Cant. Mermada</th><th className="p-3 pr-4">Motivo</th></tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {reportData.map((m: any) => (
                                  <tr key={m.id} className="hover:bg-slate-50/40 text-slate-700">
                                    <td className="p-3 pl-4 font-bold text-slate-800">{m.product?.name}</td>
                                    <td className="p-3 text-slate-600 font-medium">{fmtDate(m.createdAt)}</td>
                                    <td className="p-3 text-right font-bold text-red-600">{m.quantity}</td>
                                    <td className="p-3 pr-4 text-slate-600 font-semibold">{m.reason || 'No especificado'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* H. MOVIMIENTOS */}
                    {activeReport === 'movimientos' && (
                      <div className="space-y-4">
                        <div className="bg-white border border-slate-300 rounded-2xl overflow-x-auto shadow-sm">
                          <table className="w-full min-w-[650px] text-xs text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-300 text-[9px] font-bold text-slate-600 uppercase tracking-widest"><th className="p-3 pl-4">Producto</th><th className="p-3">Tipo</th><th className="p-3 text-right">Cantidad</th><th className="p-3">Fecha/Hora</th><th className="p-3 pr-4">Detalle / Referencia</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {reportData.map((m: any) => (
                                <tr key={m.id} className="hover:bg-slate-50/40 text-slate-700">
                                  <td className="p-3 pl-4 font-bold text-slate-800">{m.product?.name}</td>
                                  <td className="p-3">
                                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-lg border uppercase tracking-wider ${m.type === 'ENTRY' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : m.type === 'EXIT' ? 'bg-rose-50 text-rose-600 border-rose-100' : m.type === 'SALE' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                      {m.type === 'ENTRY' ? 'Entrada' : m.type === 'EXIT' ? 'Salida/Merma' : m.type === 'SALE' ? 'Venta' : 'Devolución'}
                                    </span>
                                  </td>
                                  <td className={`p-3 text-right font-bold ${m.quantity > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>{m.quantity}</td>
                                  <td className="p-3 text-slate-600 font-medium">{fmtDate(m.createdAt)}</td>
                                  <td className="p-3 pr-4 text-slate-700 font-semibold">{m.reference || m.reason || 'N/A'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* I. DEVOLUCIONES */}
                    {activeReport === 'devoluciones' && (
                      <div className="space-y-4">
                        {reportData.list.length === 0 ? (
                          <div className="flex flex-col items-center justify-center p-8 gap-3 bg-white rounded-2xl border border-slate-300 shadow-sm text-slate-600">
                            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                            <p className="text-sm font-semibold">Excelente! No se registraron cancelaciones o devoluciones en este período.</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center justify-between">
                              <span className="text-xs font-semibold text-rose-700">Total devuelto/reembolsado en efectivo a clientes:</span>
                              <span className="text-base font-bold text-rose-600">{fmt(reportData.totalRefunded)}</span>
                            </div>

                            <div className="bg-white border border-slate-300 rounded-2xl overflow-x-auto shadow-sm">
                              <table className="w-full min-w-[700px] text-xs text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-300 text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                                    <th className="p-3 pl-4">Ticket</th>
                                    <th className="p-3">Fecha</th>
                                    <th className="p-3">Cajero</th>
                                    <th className="p-3">Detalle Devolución</th>
                                    <th className="p-3 text-right pr-4">Monto Devuelto</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {reportData.list.map((sale: any) => {
                                    const isCancelled = sale.status === 'CANCELLED';
                                    const returnAmount = isCancelled 
                                      ? (sale.total || 0) 
                                      : (sale.items?.filter((i: any) => i.quantity < 0).reduce((sum: number, i: any) => sum + Math.abs(i.total), 0) || 0);
                                    
                                    const returnedItemsNames = isCancelled 
                                      ? 'Cancelación Total de Venta' 
                                      : sale.items?.filter((i: any) => i.quantity < 0).map((i: any) => `${Math.abs(i.quantity)}x ${i.productName}`).join(', ');

                                    return (
                                      <tr key={sale.id} className="hover:bg-slate-50/40 text-slate-700">
                                        <td className="p-3 pl-4 font-bold text-slate-800">
                                          #{sale.saleNumber}
                                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-lg border uppercase tracking-wider ml-2 ${isCancelled ? 'bg-rose-50 text-rose-650 border-rose-100' : 'bg-amber-50 text-amber-650 border-amber-100'}`}>
                                            {isCancelled ? 'Cancelación' : 'Cambio'}
                                          </span>
                                        </td>
                                        <td className="p-3 text-slate-600 font-medium">{fmtDate(sale.createdAt)}</td>
                                        <td className="p-3 text-slate-700 font-semibold">{sale.user?.fullName || 'N/A'}</td>
                                        <td className="p-3 text-slate-600 font-medium italic">{returnedItemsNames}</td>
                                        <td className="p-3 text-right pr-4 font-bold text-rose-600">-{fmt(returnAmount)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* J. CARGAS VIRTUALES */}
                    {activeReport === 'cargas_virtuales' && (
                      <div className="space-y-6">
                        {/* Grid cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="p-5 bg-rose-50/45 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block mb-1">Carga Virtual 1</span>
                            <span className="text-2xl font-black text-rose-600 dark:text-rose-400">{fmt(reportData.totalVirtual1)}</span>
                          </div>
                          <div className="p-5 bg-blue-50/45 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider block mb-1">Carga Virtual 2</span>
                            <span className="text-2xl font-black text-blue-600 dark:text-blue-400">{fmt(reportData.totalVirtual2)}</span>
                          </div>
                          <div className="p-5 bg-emerald-50/45 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-1">Total Acumulado</span>
                            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{fmt(reportData.totalVirtualAmount)}</span>
                          </div>
                        </div>

                        {/* List of transactions */}
                        <div className="bg-white border border-slate-300 rounded-2xl overflow-x-auto shadow-sm">
                          <table className="w-full min-w-[600px] text-xs text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-300 text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                                <th className="p-3 pl-4">Fecha / Hora</th>
                                <th className="p-3">Tipo de Carga</th>
                                <th className="p-3 text-right pr-4">Monto</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {reportData.items.length === 0 ? (
                                <tr>
                                  <td colSpan={3} className="p-8 text-center text-slate-400 font-medium italic">
                                    No se registraron cargas virtuales en este período.
                                  </td>
                                </tr>
                              ) : (
                                reportData.items.map((item: any, idx: number) => (
                                  <tr key={idx} className="hover:bg-slate-50/40 text-slate-700">
                                    <td className="p-3 pl-4 font-medium text-slate-650">{fmtDate(item.createdAt)}</td>
                                    <td className="p-3">
                                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-lg border uppercase tracking-wider ${item.type.includes('1') ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                        {item.type}
                                      </span>
                                    </td>
                                    <td className="p-3 text-right pr-4 font-extrabold text-slate-800">{fmt(item.amount)}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

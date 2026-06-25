import { useState, useEffect } from 'react';
import api from '../../services/api';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { 
  History, 
  Search, 
  X, 
  ChevronDown, 
  ChevronUp, 
  Calendar, 
  DollarSign, 
  TrendingUp, 
  Wallet, 
  ShoppingBag,
  CreditCard,
  Ban,
  Eye,
  ArrowRightLeft,
  FileText,
  User,
  Download
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

export default function HistorialScreen() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  // State
  const [sales, setSales] = useState<any[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Date Filters
  const [filterMode, setFilterMode] = useState<'month' | 'day' | 'range'>('month');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedDay, setSelectedDay] = useState<string>(new Date().toISOString().split('T')[0]);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [activeTab, setActiveTab] = useState<'SUMMARY' | 'SALES' | 'ORDERS' | 'QUOTES' | 'RETURNS'>('SUMMARY');
  const [isLoading, setIsLoading] = useState(true);

  // Month & Year list for selectors
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const years = [2025, 2026, 2027, 2028];

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
              h1 { font-size: 22px; color: #0f172a; margin-bottom: 5px; }
              h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-top: 0; margin-bottom: 25px; }
              .header { border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 25px; }
              table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
              th { background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569; font-weight: 700; text-align: left; padding: 10px; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; }
              td { padding: 10px; border-bottom: 1px solid #f1f5f9; color: #334155; }
              .text-right { text-align: right; }
              .font-bold { font-weight: bold; }
              .grid { display: grid; grid-template-cols: repeat(4, 1fr); gap: 15px; margin-bottom: 25px; }
              .card { background-color: #f8fafc; border: 1px solid #f1f5f9; padding: 12px; border-radius: 10px; }
              .card-title { font-size: 8px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
              .card-value { font-size: 16px; font-weight: bold; color: #0f172a; }
              .footer { margin-top: 40px; font-size: 9px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 15px; }
            </style>
          </head>
          <body>
            ${htmlContent}
            <div class="footer">Generado por Kiosco Historial de Caja - ${new Date().toLocaleDateString('es-AR')}</div>
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

  const handleExportExcel = () => {
    const { from, to } = getDateRange();
    let periodName = 'General';
    if (filterMode === 'month') {
      periodName = `Mes_${months[selectedMonth]}_${selectedYear}`;
    } else if (filterMode === 'day') {
      periodName = `Dia_${selectedDay}`;
    } else if (filterMode === 'range') {
      periodName = `Rango_${startDate}_a_${endDate}`;
    }

    const cashSalesCount = completedSales.filter(s => s.paymentMethodSummary === 'CASH').length;
    const cardSalesCount = completedSales.filter(s => s.paymentMethodSummary === 'CLOVER').length;
    const mpSalesCount = completedSales.filter(s => s.paymentMethodSummary === 'MERCADOPAGO').length;
    const debtSalesCount = completedSales.filter(s => s.paymentMethodSummary === 'DEBT').length;
    const mixedSalesCount = completedSales.filter(s => s.paymentMethodSummary === 'MIXED').length;

    const rows = [
      ['REPORTE PROFESIONAL - HISTORIAL DE VENTAS Y CAJA'],
      ['Período seleccionado', periodName.replace(/_/g, ' ')],
      ['Fecha de generación', new Date().toLocaleDateString('es-AR')],
      [],
      ['RESUMEN GENERAL'],
      ['Indicador', 'Valor'],
      ['Total Facturado', fmt(totalSold)],
      ['Ganancia Bruta', fmt(grossProfit)],
      ['Total Transacciones', salesCount],
      ['Ticket Promedio', fmt(averageTicket)],
      [],
      ['VENTAS SEGÚN MÉTODO DE PAGO'],
      ['Método de Pago', 'Cantidad de Ventas', 'Monto Cobrado'],
      ['Efectivo', cashSalesCount, fmt(cashTotal)],
      ['Clover/Tarjeta', cardSalesCount, fmt(cardTotal)],
      ['Mercado Pago', mpSalesCount, fmt(mpTotal)],
      ['Cuenta Corriente / Deuda', debtSalesCount, fmt(completedSales.filter(s => s.paymentMethodSummary === 'DEBT').reduce((sum: number, s: any) => sum + s.total, 0))],
      ['Cobro Mixto', mixedSalesCount, fmt(completedSales.filter(s => s.paymentMethodSummary === 'MIXED').reduce((sum: number, s: any) => sum + s.total, 0))],
      [],
      ['DETALLE DE TRANSACCIONES'],
      ['Nro Ticket', 'Fecha', 'Cajero', 'Método de Pago', 'Total', 'Estado'],
      ...sales.map((s: any) => [
        `#${s.saleNumber}`,
        fmtDate(s.createdAt),
        s.user?.username || '',
        s.paymentMethodSummary || '',
        s.total,
        s.status === 'CANCELLED' ? 'Cancelada' : 'Completada'
      ])
    ];
    
    downloadCSV(`Reporte_Historial_Caja_${periodName}.csv`, [], rows);
    toast.success('Excel exportado correctamente');
  };

  const handleExportPDF = () => {
    const { from, to } = getDateRange();
    let periodName = 'General';
    if (filterMode === 'month') {
      periodName = `Mes_${months[selectedMonth]} ${selectedYear}`;
    } else if (filterMode === 'day') {
      periodName = `Día ${selectedDay}`;
    } else if (filterMode === 'range') {
      periodName = `Rango ${startDate} al ${endDate}`;
    }

    const cashSalesCount = completedSales.filter(s => s.paymentMethodSummary === 'CASH').length;
    const cardSalesCount = completedSales.filter(s => s.paymentMethodSummary === 'CLOVER').length;
    const mpSalesCount = completedSales.filter(s => s.paymentMethodSummary === 'MERCADOPAGO').length;
    const debtSalesCount = completedSales.filter(s => s.paymentMethodSummary === 'DEBT').length;
    const mixedSalesCount = completedSales.filter(s => s.paymentMethodSummary === 'MIXED').length;

    const rowsHtml = sales.map((s: any) => `
      <tr>
        <td class="font-bold">#${s.saleNumber}</td>
        <td>${fmtDate(s.createdAt)}</td>
        <td>${s.user?.username || ''}</td>
        <td>${s.paymentMethodSummary || ''}</td>
        <td class="text-right font-bold">${fmt(s.total)}</td>
        <td class="${s.status === 'CANCELLED' ? 'text-rose-500' : 'text-emerald-500'} font-bold">${s.status === 'CANCELLED' ? 'Cancelada' : 'Completada'}</td>
      </tr>
    `).join('');

    const htmlContent = `
      <div class="header">
        <h1>REPORTE DE VENTAS Y CAJA</h1>
        <h2>Período: ${periodName}</h2>
      </div>

      <div class="grid">
        <div class="card"><div class="card-title">Total Facturado</div><div class="card-value">${fmt(totalSold)}</div></div>
        <div class="card"><div class="card-title">Ganancia Bruta</div><div class="card-value" style="color: #10b981;">${fmt(grossProfit)}</div></div>
        <div class="card"><div class="card-title">Total Transacciones</div><div class="card-value">${salesCount}</div></div>
        <div class="card"><div class="card-title">Ticket Promedio</div><div class="card-value">${fmt(averageTicket)}</div></div>
      </div>

      <h3 style="font-size: 13px; text-transform: uppercase; color: #475569; margin-top: 25px;">Ventas por Método de Pago</h3>
      <table>
        <thead>
          <tr>
            <th>Método de Pago</th>
            <th class="text-right">Cantidad de Ventas</th>
            <th class="text-right">Monto Cobrado</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Efectivo</td><td class="text-right font-bold">${cashSalesCount}</td><td class="text-right font-bold">${fmt(cashTotal)}</td></tr>
          <tr><td>Clover / Tarjeta</td><td class="text-right font-bold">${cardSalesCount}</td><td class="text-right font-bold">${fmt(cardTotal)}</td></tr>
          <tr><td>Mercado Pago</td><td class="text-right font-bold">${mpSalesCount}</td><td class="text-right font-bold">${fmt(mpTotal)}</td></tr>
          <tr><td>Cuenta Corriente / Deuda</td><td class="text-right font-bold">${debtSalesCount}</td><td class="text-right font-bold">${fmt(completedSales.filter(s => s.paymentMethodSummary === 'DEBT').reduce((sum: number, s: any) => sum + s.total, 0))}</td></tr>
          <tr><td>Cobro Mixto</td><td class="text-right font-bold">${mixedSalesCount}</td><td class="text-right font-bold">${fmt(completedSales.filter(s => s.paymentMethodSummary === 'MIXED').reduce((sum: number, s: any) => sum + s.total, 0))}</td></tr>
        </tbody>
      </table>

      <h3 style="font-size: 13px; text-transform: uppercase; color: #475569; margin-top: 25px;">Detalle de Transacciones</h3>
      <table>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Fecha/Hora</th>
            <th>Cajero</th>
            <th>Método Pago</th>
            <th class="text-right">Monto</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="6" style="text-align: center;">Sin registros de ventas en el período</td></tr>'}
        </tbody>
      </table>
    `;

    downloadPDF(`Reporte_Historial_Caja_${periodName.replace(/ /g, '_')}`, htmlContent);
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
    loadSales();
  }, [filterMode, selectedMonth, selectedYear, selectedDay, startDate, endDate]);

  const loadSales = async () => {
    setIsLoading(true);
    try {
      const { from, to } = getDateRange();
      const params: any = {};
      if (from) params.from = from;
      if (to) params.to = to;

      const { data } = await api.get('/sales', { params });
      setSales(data);
    } catch {
      toast.error('Error al cargar historial de ventas');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelSale = async (id: string) => {
    if (!window.confirm('¿Seguro que querés cancelar esta venta? Se devolverán los productos al stock.')) return;
    try {
      await api.post(`/sales/${id}/cancel`);
      toast.success('Venta cancelada correctamente');
      loadSales();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al cancelar la venta');
    }
  };

  const fmt = (p: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(p);
  const fmtDate = (d: string) => new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  // Calculate Metrics based on completed sales
  const completedSales = sales.filter(s => s.status === 'COMPLETED');
  const cancelledSales = sales.filter(s => s.status === 'CANCELLED');

  const totalSold = completedSales.reduce((sum, s) => sum + s.total, 0);
  const salesCount = completedSales.length;
  
  // Gross Profit calculation (Revenue - Cost)
  // For each completed sale, sum the costs of items
  let totalCost = 0;
  completedSales.forEach((sale) => {
    sale.items?.forEach((item: any) => {
      totalCost += (item.product?.costPrice || 0) * item.quantity;
    });
  });
  const grossProfit = totalSold - totalCost;
  const grossMargin = totalSold > 0 ? (grossProfit / totalSold) * 100 : 0;

  // Payments breakdown
  let cashTotal = 0;
  let cardTotal = 0; // Clover / Tarjeta
  let mpTotal = 0; // Mercado Pago
  
  completedSales.forEach((sale) => {
    sale.payments?.forEach((pay: any) => {
      if (pay.method === 'CASH') cashTotal += pay.amount;
      else if (pay.method === 'CLOVER') cardTotal += pay.amount;
      else if (pay.method === 'MERCADOPAGO') mpTotal += pay.amount;
    });
  });

  const totalPayments = cashTotal + cardTotal + mpTotal;
  const cashPercentage = totalPayments > 0 ? (cashTotal / totalPayments) * 100 : 0;
  const cardPercentage = totalPayments > 0 ? (cardTotal / totalPayments) * 100 : 0;
  const mpPercentage = totalPayments > 0 ? (mpTotal / totalPayments) * 100 : 0;

  const averageTicket = salesCount > 0 ? totalSold / salesCount : 0;

  // Filtered sales for the "Ventas" tab list
  const filteredSales = sales.filter((sale) => {
    const saleNumStr = String(sale.saleNumber);
    const cashierName = sale.user?.fullName?.toLowerCase() || '';
    const cashierUsername = sale.user?.username?.toLowerCase() || '';
    const query = searchQuery.toLowerCase();
    
    return saleNumStr.includes(query) || cashierName.includes(query) || cashierUsername.includes(query);
  });

  const methodBadge = (m: string, clientName?: string) => {
    const styles: any = { 
      CASH: 'bg-emerald-50 text-emerald-600 border border-emerald-100', 
      CLOVER: 'bg-amber-50 text-amber-600 border border-amber-100', 
      MERCADOPAGO: 'bg-blue-50 text-blue-600 border border-blue-100', 
      MIXED: 'bg-purple-50 text-purple-600 border border-purple-100', 
      DEBT: 'bg-pink-50 text-pink-600 border border-pink-100' 
    };
    const labels: any = { 
      CASH: 'Efectivo', 
      CLOVER: 'Clover/Tarj.', 
      MERCADOPAGO: 'MercadoPago', 
      MIXED: 'Cobro Mixto', 
      DEBT: clientName ? `Adeudado: ${clientName}` : 'Cta. Cte.' 
    };
    return <span className={`text-[9px] px-2.5 py-1 rounded-xl font-bold uppercase tracking-tight ${styles[m] || 'bg-slate-50 text-slate-700'}`}>{labels[m] || m}</span>;
  };

  return (
    <div className="h-full flex flex-col gap-5 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <History className="w-7 h-7 text-indigo-500" /> Historial de Caja
          </h1>
          <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest mt-0.5">Ventas y movimientos operativos</p>
        </div>

        {/* Date Selector & Exports Bar */}
        <div className="flex flex-wrap items-center gap-3 shrink-0 justify-between lg:justify-end">
          {/* Selector de modo */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {[
              { id: 'month', label: 'Por Mes' },
              { id: 'day', label: 'Por Día' },
              { id: 'range', label: 'Rango' }
            ].map(mode => (
              <button
                key={mode.id}
                onClick={() => setFilterMode(mode.id as any)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  filterMode === mode.id 
                    ? 'bg-indigo-600 text-white shadow-sm' 
                    : 'text-slate-700 hover:text-slate-800'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* Selector de Mes */}
          {filterMode === 'month' && (
            <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-left-2 duration-200">
              <select 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(Number(e.target.value))} 
                className="bg-white border border-slate-300 rounded-2xl px-4 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all cursor-pointer capitalize"
              >
                {months.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
              <select 
                value={selectedYear} 
                onChange={(e) => setSelectedYear(Number(e.target.value))} 
                className="bg-white border border-slate-300 rounded-2xl px-4 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all cursor-pointer"
              >
                {years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}

          {/* Selector de Día */}
          {filterMode === 'day' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
              <input
                type="date"
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="bg-white border border-slate-300 rounded-2xl px-4 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all"
              />
            </div>
          )}

          {/* Selector de Rango */}
          {filterMode === 'range' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Desde</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-white border border-slate-300 rounded-2xl px-4 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all"
              />
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Hasta</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-white border border-slate-300 rounded-2xl px-4 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all"
              />
            </div>
          )}

          <div className="hidden lg:block h-8 w-px bg-slate-200" />

          {/* Botones de descarga */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              className="px-4 py-2 rounded-2xl border border-slate-400 bg-white text-slate-700 hover:bg-slate-50 transition-all font-bold text-xs shadow-sm flex items-center gap-1.5 active:scale-95 cursor-pointer"
              title="Descargar Excel"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Excel</span>
            </button>
            <button
              onClick={handleExportPDF}
              className="px-4 py-2 rounded-2xl bg-slate-800 text-white hover:bg-slate-700 transition-all font-bold text-xs shadow-sm flex items-center gap-1.5 active:scale-95 cursor-pointer"
              title="Exportar PDF"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation tabs at the top */}
      <div className="flex flex-col md:flex-row gap-3 md:justify-between md:items-center bg-white/50 backdrop-blur-sm p-4 rounded-2xl border border-slate-300/50 shrink-0 shadow-sm">
        <div className="flex gap-2 p-1 rounded-2xl bg-slate-50 border border-slate-300/40 overflow-x-auto whitespace-nowrap scrollbar-hide w-full md:w-auto">
          <button 
            onClick={() => setActiveTab('SUMMARY')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${activeTab === 'SUMMARY' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
          >
            Resumen
          </button>
          <button 
            onClick={() => setActiveTab('SALES')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${activeTab === 'SALES' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
          >
            Ventas ({sales.length})
          </button>
          <button 
            onClick={() => setActiveTab('ORDERS')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${activeTab === 'ORDERS' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
          >
            Pedidos
          </button>
          <button 
            onClick={() => setActiveTab('QUOTES')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${activeTab === 'QUOTES' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
          >
            Presupuestos
          </button>
          <button 
            onClick={() => setActiveTab('RETURNS')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${activeTab === 'RETURNS' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
          >
            Devoluciones ({cancelledSales.length})
          </button>
        </div>

        {activeTab === 'SALES' && (
          <div className="relative w-full md:w-72 flex items-center">
            <Search className="absolute left-4 w-4 h-4 text-slate-600 pointer-events-none" />
            <input 
              type="text" 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              placeholder="Buscar por ticket o cajero..." 
              className="w-full bg-slate-50 border border-slate-300 rounded-2xl pl-11 pr-4 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all placeholder:text-slate-600"
            />
          </div>
        )}
      </div>

      {/* Main Content Areas */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full card flex items-center justify-center text-slate-600 text-sm font-medium">
            Cargando historial de ventas...
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {/* 1. SUMMARY TAB */}
            {activeTab === 'SUMMARY' && (
              <motion.div 
                key="summary"
                initial={{ opacity: 0, y: 15 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: -15 }}
                className="h-full flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-1"
              >
                {/* 4 Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
                  {/* TOTAL VENDIDO */}
                  <div className="p-5 rounded-2xl bg-white border border-slate-300 shadow-sm flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 block">TOTAL VENDIDO</span>
                      <span className="text-2xl font-bold text-slate-800 mt-1 block">{fmt(totalSold)}</span>
                      <span className="text-[10px] font-bold text-slate-600 block mt-1.5">Ventas facturadas en el mes</span>
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-500">
                      <DollarSign className="w-6 h-6" />
                    </div>
                  </div>

                  {/* GANANCIA BRUTA */}
                  <div className="p-5 rounded-2xl bg-white border border-slate-300 shadow-sm flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 block">GANANCIA BRUTA</span>
                      <span className="text-2xl font-bold text-slate-800 mt-1 block">{fmt(grossProfit)}</span>
                      <span className="text-[10px] font-bold text-emerald-500 block mt-1.5 uppercase tracking-tighter">Margen: {grossMargin.toFixed(1)}%</span>
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-500">
                      <TrendingUp className="w-6 h-6" />
                    </div>
                  </div>

                  {/* VENTAS EN EFECTIVO */}
                  <div className="p-5 rounded-2xl bg-white border border-slate-300 shadow-sm flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 block">VENTAS EN EFECTIVO</span>
                      <span className="text-2xl font-bold text-slate-800 mt-1 block">{cashPercentage.toFixed(0)}%</span>
                      <span className="text-[10px] font-bold text-slate-600 block mt-1.5">Con Tarjeta/MP: {(100 - cashPercentage).toFixed(0)}%</span>
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-500">
                      <Wallet className="w-6 h-6" />
                    </div>
                  </div>

                  {/* TOTAL DE VENTAS */}
                  <div className="p-5 rounded-2xl bg-white border border-slate-300 shadow-sm flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 block">TOTAL DE VENTAS</span>
                      <span className="text-2xl font-bold text-slate-800 mt-1 block">{salesCount}</span>
                      <span className="text-[10px] font-bold text-slate-700 block mt-1.5 uppercase">Ticket prom: {fmt(averageTicket)}</span>
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-purple-50 flex items-center justify-center text-purple-500">
                      <ShoppingBag className="w-6 h-6" />
                    </div>
                  </div>
                </div>

                {/* Payments breakdown */}
                <div className="card p-6 flex flex-col gap-6 shrink-0">
                  <div>
                    <h3 className="text-xs font-bold uppercase text-slate-700 tracking-wider">Desglose de Pagos</h3>
                    <p className="text-[10px] text-slate-600 font-bold mt-0.5 uppercase tracking-wide">Distribución del flujo de ingresos</p>
                  </div>

                  <div className="space-y-4">
                    {/* Efectivo */}
                    <div>
                      <div className="flex justify-between text-xs font-bold text-slate-600 mb-1.5">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Cobrado en Efectivo</span>
                        <span>{fmt(cashTotal)} ({cashPercentage.toFixed(1)}%)</span>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${cashPercentage}%` }} />
                      </div>
                    </div>

                    {/* Tarjeta */}
                    <div>
                      <div className="flex justify-between text-xs font-bold text-slate-600 mb-1.5">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Cobrado en Tarjeta (Clover)</span>
                        <span>{fmt(cardTotal)} ({cardPercentage.toFixed(1)}%)</span>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full" style={{ width: `${cardPercentage}%` }} />
                      </div>
                    </div>

                    {/* Mercado Pago */}
                    <div>
                      <div className="flex justify-between text-xs font-bold text-slate-600 mb-1.5">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Cobrado en Mercado Pago</span>
                        <span>{fmt(mpTotal)} ({mpPercentage.toFixed(1)}%)</span>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${mpPercentage}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* 2. SALES TAB */}
            {activeTab === 'SALES' && (
              <motion.div 
                key="sales"
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="h-full card p-6 flex flex-col overflow-hidden"
              >
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {filteredSales.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-3">
                      <History className="w-12 h-12 mb-3 opacity-30" />
                      <p className="text-sm font-medium">No se encontraron ventas para este período.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredSales.map((sale) => (
                        <div key={sale.id} className="rounded-2xl border border-slate-300/80 overflow-hidden hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-500/5 transition-all">
                          <button 
                            onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)} 
                            className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50/50 transition-colors"
                          >
                            <div className="flex items-center gap-4 flex-wrap">
                              <span className="text-xs font-bold text-slate-800">#{sale.saleNumber}</span>
                              <span className="text-xs text-slate-600 font-medium">{fmtDate(sale.createdAt)}</span>
                              <span className="text-xs text-slate-600 font-semibold flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> {sale.user?.username}</span>
                              {methodBadge(sale.paymentMethodSummary, sale.client?.name)}
                              {sale.status === 'CANCELLED' && (
                                <span className="text-[9px] px-2.5 py-0.5 rounded-xl bg-rose-50 text-rose-500 font-bold border border-rose-100 uppercase tracking-tight">Cancelada</span>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-sm font-bold text-slate-800">{fmt(sale.total)}</span>
                              {expandedId === sale.id ? <ChevronUp className="w-4 h-4 text-slate-600" /> : <ChevronDown className="w-4 h-4 text-slate-600" />}
                            </div>
                          </button>
                          
                          <AnimatePresence>
                            {expandedId === sale.id && (
                              <motion.div 
                                initial={{ height: 0, opacity: 0 }} 
                                animate={{ height: 'auto', opacity: 1 }} 
                                exit={{ height: 0, opacity: 0 }} 
                                className="overflow-hidden bg-slate-50/30 border-t border-slate-300/50"
                              >
                                <div className="px-6 py-5 space-y-4">
                                  {/* Table of items */}
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-[9px] font-bold text-slate-600 uppercase tracking-widest pb-2 border-b border-slate-300"><th className="text-left pb-2">Producto</th><th className="text-right pb-2">Cant.</th><th className="text-right pb-2">P. Unit</th><th className="text-right pb-2">Subtotal</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100/50">
                                      {sale.items?.map((item: any) => (
                                        <tr key={item.id} className="text-slate-600"><td className="py-2.5 font-bold text-slate-700">{item.productName}</td><td className="text-right text-slate-700">{item.quantity}</td><td className="text-right text-slate-700">{fmt(item.unitPrice)}</td><td className="text-right font-bold text-slate-700">{fmt(item.total)}</td></tr>
                                      ))}
                                    </tbody>
                                  </table>

                                  {/* Payments detail */}
                                  <div className="flex flex-wrap gap-2.5 pt-3 border-t border-slate-300/50">
                                    {sale.payments.map((p: any, i: number) => (
                                      <span key={i} className="text-[10px] text-slate-700 bg-white px-3 py-1.5 rounded-xl border border-slate-300/70 font-semibold">
                                        {p.method === 'CASH' ? '💵 Efectivo' : p.method === 'CLOVER' ? '💳 Clover' : p.method === 'DEBT' ? '👛 Cta. Cte.' : '📱 MP'}: <b className="text-slate-800 font-bold ml-1">{fmt(p.amount)}</b>
                                      </span>
                                    ))}
                                  </div>

                                  {/* Cancel action */}
                                  {sale.status === 'COMPLETED' && (
                                    <div className="flex justify-end pt-3 border-t border-slate-300/40">
                                      <button 
                                        onClick={() => handleCancelSale(sale.id)}
                                        className="flex items-center gap-1.5 py-2 px-4 rounded-xl border border-rose-100 text-rose-600 bg-rose-50/20 hover:bg-rose-50 text-[10px] font-bold uppercase tracking-tight transition-all active:scale-[0.98]"
                                      >
                                        <Ban className="w-3.5 h-3.5" /> Cancelar / Devolver Venta
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* 3. ORDERS TAB */}
            {activeTab === 'ORDERS' && (
              <motion.div 
                key="orders"
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="h-full card p-8 flex flex-col items-center justify-center text-center gap-4"
              >
                <div className="w-16 h-16 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-500">
                  <ArrowRightLeft className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-700">Integración con Pedidos Web</h3>
                  <p className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mt-1 max-w-[280px] leading-relaxed mx-auto">
                    Los pedidos del Catálogo Online se gestionan en la pestaña <b>"Pedidos Recibidos"</b> de la barra lateral.
                  </p>
                </div>
              </motion.div>
            )}

            {/* 4. QUOTES TAB */}
            {activeTab === 'QUOTES' && (
              <motion.div 
                key="quotes"
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="h-full card p-8 flex flex-col items-center justify-center text-center gap-4"
              >
                <div className="w-16 h-16 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-500">
                  <FileText className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-700">Presupuestos y Cotizaciones</h3>
                  <p className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mt-1 max-w-[280px] leading-relaxed mx-auto">
                    Los presupuestos de clientes se gestionan en la pestaña <b>"Presupuestos"</b> de la barra lateral.
                  </p>
                </div>
              </motion.div>
            )}

            {/* 5. RETURNS TAB */}
            {activeTab === 'RETURNS' && (
              <motion.div 
                key="returns"
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="h-full card p-6 flex flex-col overflow-hidden"
              >
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {cancelledSales.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-3">
                      <Ban className="w-12 h-12 mb-3 opacity-30 text-rose-400" />
                      <p className="text-sm font-medium">No hay devoluciones o cancelaciones en este período.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {cancelledSales.map((sale) => (
                        <div key={sale.id} className="rounded-2xl border border-rose-100 bg-rose-50/5 p-4 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-800">#{sale.saleNumber}</span>
                              <span className="text-[9px] px-2 py-0.5 rounded-lg bg-rose-50 text-rose-500 font-bold border border-rose-100 uppercase tracking-tight">Cancelada</span>
                            </div>
                            <p className="text-[10px] text-slate-600 font-medium mt-1">
                              Fecha: {fmtDate(sale.createdAt)} — Cajero: {sale.user?.username}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-bold text-rose-600">-{fmt(sale.total)}</span>
                            <p className="text-[9px] text-slate-600 font-bold uppercase tracking-wider mt-0.5">Efectivo devuelto</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

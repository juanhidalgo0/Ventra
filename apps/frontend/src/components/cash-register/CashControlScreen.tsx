import { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { Calendar, User, Search, Wallet, RefreshCw, XCircle, Clock, History, TrendingUp, ArrowDownRight, LayoutDashboard, AlertCircle, ChevronRight, Filter, DollarSign, Lock, X, Printer, Package, CheckCircle2, Smartphone, CreditCard, Play, Download, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { wsService } from '../../services/websocket';

export default function CashControlScreen() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<'month' | 'day' | 'range'>('month');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedDay, setSelectedDay] = useState<string>(new Date().toISOString().split('T')[0]);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [sellerFilter, setSellerFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState<any>(null);
  
  // States for live monitoring and closing
  const [monitoringSession, setMonitoringSession] = useState<any>(null);
  const [closingSession, setClosingSession] = useState<any>(null);
  const [closingAmount, setClosingAmount] = useState<number>(0);
  const [closingNotes, setClosingNotes] = useState<string>('');
  const [hideTotals, setHideTotals] = useState<boolean>(false);

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
              table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10px; }
              th { background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569; font-weight: 700; text-align: left; padding: 8px; text-transform: uppercase; font-size: 8px; letter-spacing: 0.05em; }
              td { padding: 8px; border-bottom: 1px solid #f1f5f9; color: #334155; }
              .text-right { text-align: right; }
              .font-bold { font-weight: bold; }
              .grid { display: grid; grid-template-cols: repeat(5, 1fr); gap: 15px; margin-bottom: 25px; }
              .card { background-color: #f8fafc; border: 1px solid #f1f5f9; padding: 12px; border-radius: 10px; }
              .card-title { font-size: 8px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
              .card-value { font-size: 15px; font-weight: bold; color: #0f172a; }
              .footer { margin-top: 40px; font-size: 9px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 15px; }
            </style>
          </head>
          <body>
            ${htmlContent}
            <div class="footer">Generado por Kiosco Cash Control - ${new Date().toLocaleDateString('es-AR')}</div>
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
    const headers = [
      'Terminal', 'Responsable', 'Apertura', 'Cierre', 
      'Monto Apertura', 'Ventas Totales', 'Gastos', 'Monto Cierre', 'Diferencia'
    ];
    const rows = closedSessions.map((s: any) => {
      const salesTotal = s.sales?.reduce((sum: number, v: any) => sum + v.total, 0) || 0;
      const expensesTotal = s.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((sum: number, m: any) => sum + m.amount, 0) || 0;
      return [
        s.terminalName,
        s.user?.fullName,
        new Date(s.openedAt).toLocaleString('es-AR'),
        s.closedAt ? new Date(s.closedAt).toLocaleString('es-AR') : '',
        s.openingAmount,
        salesTotal,
        expensesTotal,
        s.closingAmount || 0,
        s.difference || 0
      ];
    });
    
    downloadCSV(`Historial_Cajas.csv`, headers, rows);
    toast.success('Excel exportado correctamente');
  };

  const handleExportPDF = () => {
    const rowsHtml = closedSessions.map((s: any) => {
      const salesTotal = s.sales?.reduce((sum: number, v: any) => sum + v.total, 0) || 0;
      const expensesTotal = s.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((sum: number, m: any) => sum + m.amount, 0) || 0;
      return `
        <tr>
          <td class="font-bold">${s.terminalName}</td>
          <td>${s.user?.fullName}</td>
          <td>${new Date(s.openedAt).toLocaleDateString('es-AR')}</td>
          <td>${s.closedAt ? new Date(s.closedAt).toLocaleDateString('es-AR') : 'Abierta'}</td>
          <td class="text-right">${fmt(s.openingAmount)}</td>
          <td class="text-right">${fmt(salesTotal)}</td>
          <td class="text-right">${fmt(expensesTotal)}</td>
          <td class="text-right">${fmt(s.closingAmount || 0)}</td>
          <td class="text-right font-bold" style="color: ${(s.difference || 0) < 0 ? '#ef4444' : '#10b981'};">${fmt(s.difference || 0)}</td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
      <div class="header">
        <h1>Historial de Turnos y Cierres de Caja</h1>
        <h2>Resumen Operativo</h2>
      </div>

      <div class="grid">
        <div class="card"><div class="card-title">Ventas Totales</div><div class="card-value">${fmt(totalSales)}</div></div>
        <div class="card"><div class="card-title">Gastos Operativos</div><div class="card-value" style="color: #ef4444;">${fmt(totalExpenses)}</div></div>
        <div class="card"><div class="card-title">Cobros Deuda</div><div class="card-value" style="color: #6366f1;">${fmt(totalDebtCollection)}</div></div>
        <div class="card"><div class="card-title">Balance Neto</div><div class="card-value">${fmt(balance)}</div></div>
        <div class="card"><div class="card-title">Diferencias</div><div class="card-value" style="color: ${totalDifferences < 0 ? '#ef4444' : '#10b981'};">${fmt(totalDifferences)}</div></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Terminal</th>
            <th>Responsable</th>
            <th>Apertura</th>
            <th>Cierre</th>
            <th class="text-right">M. Apertura</th>
            <th class="text-right">Ventas</th>
            <th class="text-right">Gastos</th>
            <th class="text-right">M. Cierre</th>
            <th class="text-right">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="9" style="text-align: center;">Sin registros de caja cerrados</td></tr>'}
        </tbody>
      </table>
    `;

    downloadPDF(`Historial_Cajas`, htmlContent);
  };

  const denominations = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10];

  const selectedSessionData = useMemo(() => {
    if (!selectedSession) return null;

    let notesClean = selectedSession.closingNotes || '';
    let metadata = {
      bills: {} as Record<number, number>,
      virtualClover: 0,
      virtualMP1: 0,
      virtualMP2: 0,
      closedBy: ''
    };

    if (selectedSession.closingNotes && selectedSession.closingNotes.includes('[METADATA]')) {
      const parts = selectedSession.closingNotes.split('[METADATA]');
      notesClean = parts[0].trim();
      try {
        const parsed = JSON.parse(parts[1]);
        metadata = {
          bills: parsed.bills || {},
          virtualClover: parsed.virtualClover || 0,
          virtualMP1: parsed.virtualMP1 || 0,
          virtualMP2: parsed.virtualMP2 || 0,
          closedBy: parsed.closedBy || ''
        };
      } catch (err) {
        console.error("Error parsing metadata from closingNotes", err);
      }
    }

    const cashSales = selectedSession.sales?.reduce((s: number, v: any) => s + (v.payments?.filter((p: any) => p.method === 'CASH').reduce((a: number, p: any) => a + p.amount, 0) || 0), 0) || 0;
    const cloverSales = selectedSession.sales?.reduce((s: number, v: any) => s + (v.payments?.filter((p: any) => p.method === 'CLOVER').reduce((a: number, p: any) => a + p.amount, 0) || 0), 0) || 0;
    const mpSales = selectedSession.sales?.reduce((s: number, v: any) => s + (v.payments?.filter((p: any) => p.method === 'MERCADOPAGO').reduce((a: number, p: any) => a + p.amount, 0) || 0), 0) || 0;
    const debtSales = selectedSession.sales?.reduce((s: number, v: any) => s + (v.payments?.filter((p: any) => p.method === 'DEBT').reduce((a: number, p: any) => a + p.amount, 0) || 0), 0) || 0;
    const expenses = selectedSession.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((s: number, m: any) => s + m.amount, 0) || 0;

    const countedCash = Object.entries(metadata.bills).reduce((acc, [den, qty]) => acc + (Number(den) * qty), 0);

    const summary = {
      paymentBreakdown: {
        CASH: cashSales,
        CLOVER: cloverSales,
        MERCADOPAGO: mpSales,
        DEBT: debtSales
      },
      cashExpense: expenses,
      countedCash: countedCash
    };

    return {
      notesClean,
      metadata,
      summary
    };
  }, [selectedSession]);

  useEffect(() => {
    loadSessions();
    wsService.connect();
    const handleUpdate = () => {
      // Reload active and history in background without setting full screen loader for a seamless feel!
      api.get('/cash/history').then(res => setSessions(res.data || [])).catch(() => {});
      api.get('/cash/active').then(res => setActiveSessions(res.data || [])).catch(() => {});
    };
    wsService.on('cash:updated', handleUpdate);
    wsService.on('sale:created', handleUpdate);
    return () => {
      wsService.off('cash:updated', handleUpdate);
      wsService.off('sale:created', handleUpdate);
    };
  }, []);

  const loadSessions = async () => {
    setIsLoading(true);
    try {
      const [resHistory, resActive] = await Promise.all([
        api.get('/cash/history'),
        api.get('/cash/active')
      ]);
      setSessions(resHistory.data || []);
      setActiveSessions(resActive.data || []);
    } catch {
      toast.error('Error al sincronizar las cajas');
    } finally { setIsLoading(false); }
  };

  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);

  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  // Filter sessions
  const filteredSessions = sessions.filter(s => {
    const date = new Date(s.openedAt);
    let matchesDate = false;
    
    if (filterMode === 'month') {
      matchesDate = date.getMonth() === selectedMonth && date.getFullYear() === selectedYear;
    } else if (filterMode === 'day') {
      const dayStr = date.toISOString().split('T')[0];
      matchesDate = dayStr === selectedDay;
    } else if (filterMode === 'range') {
      const dayStr = date.toISOString().split('T')[0];
      matchesDate = dayStr >= startDate && dayStr <= endDate;
    }

    const matchesSeller = sellerFilter === 'all' || s.user?.id === sellerFilter;
    const matchesSearch = searchQuery === '' || 
      s.terminalName?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      s.user?.fullName?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDate && matchesSeller && matchesSearch;
  });

  const closedSessions = filteredSessions.filter(s => s.closedAt);

  // Stats Calculations
  const totalSales = closedSessions.reduce((acc, s) => acc + (s.sales?.reduce((sum: number, v: any) => sum + v.total, 0) || 0), 0);
  const totalExpenses = closedSessions.reduce((acc, s) => acc + (s.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((sum: number, m: any) => sum + m.amount, 0) || 0), 0);
  const totalDebtCollection = 0; // To be implemented with payments
  const totalDifferences = closedSessions.reduce((acc, s) => acc + (s.difference || 0), 0);
  const balance = totalSales - totalExpenses;

  const users = Array.from(new Set(sessions.map(s => JSON.stringify(s.user)))).map(s => JSON.parse(s)).filter(u => u);

  return (
    <div className="h-full flex flex-col gap-6 bg-[#f8fafc] p-6 overflow-y-auto custom-scrollbar">
      {/* Header & Filters */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Control de Caja</h1>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.3em] mt-1">Historial completo de cierres por turno</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
             <button onClick={handleExportExcel} className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-white border border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm active:scale-95 cursor-pointer">
                <Download className="w-3.5 h-3.5 text-emerald-600" /> Descargar Excel
             </button>
             <button onClick={handleExportPDF} className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800 text-white hover:bg-slate-700 transition-all text-[10px] font-bold uppercase tracking-widest shadow-sm active:scale-95 cursor-pointer">
                <FileText className="w-3.5 h-3.5" /> Exportar PDF
             </button>
             <button onClick={loadSessions} className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-white border border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm cursor-pointer">
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Actualizar Datos
             </button>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex flex-wrap items-center gap-4">
            {/* Modo de filtro */}
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
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {/* Selector de Mes */}
            {filterMode === 'month' && (
              <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-150 animate-in fade-in slide-in-from-left-2 duration-200">
                <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} className="bg-transparent px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest outline-none cursor-pointer">
                  {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
                <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className="bg-white shadow-sm rounded-lg text-[10px] font-bold text-slate-800 uppercase tracking-widest border border-slate-100 px-3 py-1.5 outline-none cursor-pointer">
                  {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
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
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {/* Selector de Rango */}
            {filterMode === 'range' && (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Desde</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Hasta</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500"
                />
              </div>
            )}
            
            <div className="h-8 w-px bg-slate-100" />
            
            <div className="flex items-center gap-2 text-slate-400">
              <User className="w-4 h-4" />
              <select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} className="bg-transparent text-[10px] font-bold text-slate-500 uppercase tracking-widest outline-none cursor-pointer">
                <option value="all">Todos los vendedores</option>
                {users.map((u: any, idx: number) => <option key={u.id || `seller-${idx}`} value={u.id}>{u.fullName}</option>)}
              </select>
            </div>
          </div>

          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Buscar por terminal o responsable..." className="w-full bg-slate-50/50 border border-slate-100 rounded-2xl pl-11 pr-4 py-3 text-[11px] font-bold text-slate-600 outline-none focus:bg-white focus:border-indigo-200 transition-all shadow-inner" />
          </div>
        </div>
      </div>

      {/* Stats Summary Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'Ventas Totales', val: fmt(totalSales), sub: 'Ingresos del mes', icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-100' },
          { label: 'Gastos Operativos', val: fmt(totalExpenses), sub: 'Egresos registrados', icon: ArrowDownRight, color: 'text-rose-500', bg: 'bg-rose-50', border: 'border-rose-100' },
          { label: 'Cobros Deuda', val: fmt(totalDebtCollection), sub: 'Cuentas corrientes', icon: Wallet, color: 'text-indigo-500', bg: 'bg-indigo-50', border: 'border-indigo-100' },
          { label: 'Balance Neto', val: fmt(balance), sub: 'Rendimiento real', icon: LayoutDashboard, color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200' },
          { label: 'Diferencias', val: fmt(totalDifferences), sub: 'Faltantes de caja', icon: AlertCircle, color: totalDifferences < 0 ? 'text-rose-500' : 'text-emerald-600', bg: totalDifferences < 0 ? 'bg-rose-50' : 'bg-emerald-50', border: totalDifferences < 0 ? 'border-rose-100' : 'border-emerald-100' }
        ].map((s, idx) => (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }} key={s.label} className={`bg-white p-6 rounded-2xl border ${s.border} shadow-sm group hover:shadow-md transition-all`}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center ${s.color} transition-transform group-hover:scale-110 shadow-sm`}>
                <s.icon className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</span>
            </div>
            <h4 className="text-2xl font-bold text-slate-800 tracking-tighter mb-1">{s.val}</h4>
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{s.sub}</p>
              <div className={`w-1.5 h-1.5 rounded-full ${s.bg.replace('bg-', 'bg-')}`} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Active Sessions Panel */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between px-2">
          <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Cajas Activas ({activeSessions.length})
          </h3>
          <div className="flex items-center gap-4">
             <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-slate-600 transition-colors">
                <input type="checkbox" checked={hideTotals} onChange={(e) => setHideTotals(e.target.checked)} className="rounded-md border-slate-200 text-indigo-600 focus:ring-indigo-500" /> Ocultar Totales
             </label>
          </div>
        </div>

        {activeSessions.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center">
             <div className="w-16 h-16 rounded-xl bg-slate-50 flex items-center justify-center mb-4"><Lock className="w-8 h-8 text-slate-200" /></div>
             <p className="text-[11px] font-bold text-slate-300 uppercase tracking-widest">No hay cajas abiertas en este momento</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activeSessions.map((s) => (
              <motion.div key={s.id} className="bg-white p-7 rounded-2xl border border-slate-200/80 hover:border-indigo-200 shadow-sm relative overflow-hidden group transition-all duration-300">
                <div className="flex items-start justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white text-lg font-black shadow-md shadow-indigo-105 shrink-0">
                      {s.terminalName?.[0] || 'T'}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-base font-bold text-slate-800 tracking-tight truncate">{s.terminalName}</h4>
                      <p className="text-[10px] font-bold text-slate-400 truncate">{s.user?.fullName}</p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[9px] font-bold uppercase tracking-widest border border-emerald-100/80 shrink-0">Activa</span>
                </div>
                
                <div className="grid grid-cols-2 gap-8 mb-8">
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Efectivo Esperado</p>
                    <p className="text-xl font-black text-indigo-600 tracking-tighter">{hideTotals ? '***' : fmt(s.expectedAmount || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Apertura Inicial</p>
                    <p className="text-xl font-bold text-slate-700 tracking-tighter">{hideTotals ? '***' : fmt(s.openingAmount)}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-4 pt-6 border-t border-slate-100">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0" /> 
                      <span>Desde {new Date(s.openedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <span className="text-[9px] font-extrabold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100/50">Turno en Vivo</span>
                  </div>

                  <div className="mt-2 shrink-0">
                    <button 
                      onClick={() => setMonitoringSession(s)}
                      className="w-full px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-[10.5px] font-extrabold text-white uppercase tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-100 active:scale-[0.97]"
                    >
                      <Play className="w-4 h-4 text-indigo-200 shrink-0" /> Ver Estado de Caja
                    </button>
                  </div>
                </div>
                <div className="absolute top-0 right-0 w-1.5 h-full bg-indigo-500" />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Historial Section */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col p-10 min-h-[500px]">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center text-white shadow-lg">
              <History className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 tracking-tight">Historial de Cierres</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Registros permanentes de auditoría</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button className="p-3 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-all text-slate-400">
                <Filter className="w-5 h-5" />
             </button>
          </div>
        </div>
        
        {closedSessions.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-20 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
            <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center mb-6 shadow-sm">
              <Search className="w-8 h-8 text-slate-200" />
            </div>
            <p className="text-sm font-bold text-slate-400 uppercase tracking-[0.3em] mb-3">Sin cierres registrados</p>
            <p className="text-[11px] text-slate-300 font-bold max-w-xs leading-relaxed">No hay movimientos de cierre para los filtros seleccionados actualmente.</p>
          </div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[650px] text-left">
              <thead>
                <tr className="border-b border-slate-50">
                  <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4">Terminal / Responsable</th>
                  <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4">Apertura</th>
                  <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 text-right">Efectivo</th>
                  <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 text-right">Diferencia</th>
                  <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 text-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {closedSessions.map((s) => (
                  <tr key={s.id} onClick={() => setSelectedSession(s)} className="border-b border-slate-50/50 hover:bg-slate-50/50 transition-colors group cursor-pointer">
                    <td className="py-5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600">{s.terminalName?.[0]}</div>
                        <div>
                          <p className="text-[11px] font-bold text-slate-700">{s.terminalName}</p>
                          <p className="text-[9px] font-bold text-slate-400">{s.user?.fullName}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-5 px-4">
                      <p className="text-[11px] font-bold text-slate-700">{new Date(s.openedAt).toLocaleDateString()}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase">{new Date(s.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </td>
                    <td className="py-5 px-4 text-right">
                      <p className="text-[11px] font-bold text-slate-700">{fmt(s.closingAmountCounted || 0)}</p>
                    </td>
                    <td className="py-5 px-4 text-right">
                      <span className={`text-[11px] font-bold ${s.difference >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {s.difference > 0 && '+'}{fmt(s.difference || 0)}
                      </span>
                    </td>
                    <td className="py-5 px-4 text-center">
                      <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold uppercase tracking-widest border border-slate-200">Finalizada</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-zreport, #printable-zreport * {
            visibility: visible !important;
          }
          #printable-zreport {
            display: block !important;
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: 100% !important;
            background: white !important;
            z-index: 9999999 !important;
            font-family: 'Outfit', 'Inter', sans-serif !important;
            font-size: 13px !important;
            line-height: 1.5 !important;
            color: #1e293b !important;
            padding: 15mm !important;
          }
          @page {
            size: A4;
            margin: 0;
          }
        }
      `}</style>
      {/* Closed Session Details Modal */}
      <AnimatePresence>
        {selectedSession && selectedSessionData && (
          <motion.div 
            key="history-details-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedSession(null)}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.98, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.98, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-500 flex items-center justify-center">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Detalles de Arqueo y Conciliación</h3>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Sesión ID: #{selectedSession.id?.substring(0, 8).toUpperCase()}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedSession(null)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-rose-500 transition-all"><X className="w-5 h-5" /></button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/20">
                {/* Meta details grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-white border border-slate-200/60 p-4 rounded-xl shadow-sm">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Responsable</span>
                    <span className="text-xs font-bold text-slate-800">{selectedSession.user?.fullName || '---'}</span>
                  </div>
                  <div className="bg-white border border-slate-200/60 p-4 rounded-xl shadow-sm">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Terminal</span>
                    <span className="text-xs font-extrabold text-slate-800 uppercase block">{selectedSession.terminalName}</span>
                  </div>
                  <div className="bg-white border border-slate-200/60 p-4 rounded-xl shadow-sm">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Apertura</span>
                    <span className="text-[10.5px] font-semibold text-slate-700 block">{new Date(selectedSession.openedAt).toLocaleString('es-AR')}</span>
                  </div>
                  <div className="bg-white border border-slate-200/60 p-4 rounded-xl shadow-sm">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Cierre</span>
                    <span className="text-[10.5px] font-semibold text-slate-700 block">{new Date(selectedSession.closedAt).toLocaleString('es-AR')}</span>
                  </div>
                </div>

                {/* Arqueo Efectivo desglosado */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left: Table of Bills counted */}
                  <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-3">
                    <h4 className="text-xs font-bold text-slate-750 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                      <Lock className="w-4 h-4 text-rose-500" /> Billetes Declarados
                    </h4>
                    {Object.keys(selectedSessionData.metadata.bills).length > 0 ? (
                      <div className="max-h-[220px] overflow-y-auto custom-scrollbar pr-2">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                              <th className="pb-2">Billetes</th>
                              <th className="pb-2 text-center">Cantidad</th>
                              <th className="pb-2 text-right">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {denominations.map((den) => {
                              const qty = selectedSessionData.metadata.bills[den] || 0;
                              if (qty === 0) return null; // Only show counted bills to save screen height
                              return (
                                <tr key={den} className="border-b border-slate-50 last:border-0 font-medium">
                                  <td className="py-2 font-bold text-slate-500">$ {den.toLocaleString()}</td>
                                  <td className="py-2 text-center text-slate-700">{qty}</td>
                                  <td className="py-2 text-right font-bold text-slate-800">{fmt(den * qty)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-slate-400">
                        <p className="text-xs font-bold uppercase tracking-wider">Desglose no registrado</p>
                        <p className="text-[10px] text-slate-300 font-semibold mt-1">Este cierre se realizó en una versión previa.</p>
                      </div>
                    )}
                  </div>

                  {/* Right: Cash conciliación metrics */}
                  <div className="bg-white rounded-xl border border-slate-200/80 p-5 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-750 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100 mb-4">
                        <DollarSign className="w-4 h-4 text-emerald-500" /> Resumen de Efectivo
                      </h4>
                      <div className="space-y-3.5 text-xs text-slate-500 font-medium">
                        <div className="flex justify-between">
                           <span>Ventas Efectivo Registradas</span>
                          <span className="font-bold text-slate-700">{fmt(selectedSessionData.summary.paymentBreakdown?.CASH || 0)}</span>
                        </div>
                        <div className="flex justify-between text-rose-500">
                          <span>(-) Egresos / Gastos Registrados</span>
                          <span className="font-bold">-{fmt(selectedSessionData.summary.cashExpense || 0)}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-100 pt-3">
                          <span className="font-semibold text-slate-600">Efectivo Esperado</span>
                          <span className="font-extrabold text-slate-800">{fmt(selectedSession.closingAmountExpected || 0)}</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-100 pb-3">
                          <span className="font-semibold text-indigo-600">Efectivo Arqueado Físico</span>
                          <span className="font-extrabold text-indigo-700">{fmt(selectedSessionData.summary.countedCash || 0)}</span>
                        </div>
                      </div>
                    </div>
                    <div className={`mt-4 p-4 rounded-xl border flex items-center justify-between ${selectedSession.difference === 0 ? 'bg-emerald-50/50 border-emerald-200/60' : 'bg-rose-50/50 border-rose-200/60'}`}>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Desviación Efectivo</span>
                      <span className={`text-base font-extrabold ${selectedSession.difference >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {selectedSession.difference > 0 && '+'}{fmt(selectedSession.difference || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Sección 2: Cuentas Virtuales y Posnet */}
                <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4">
                  <h4 className="text-xs font-bold text-slate-755 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Smartphone className="w-4 h-4 text-indigo-500" /> Conciliación Cuentas Virtuales y Crédito
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Clover */}
                    <div className="bg-slate-50/50 border border-slate-200/60 p-4 rounded-xl space-y-2">
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Clover (Posnet)</span>
                        <span className="text-[9px] font-extrabold text-indigo-500 uppercase">Tarjetas</span>
                      </div>
                      <div className="grid grid-cols-3 text-xs gap-2 pt-1">
                        <div>
                          <p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Esperado</p>
                          <p className="font-bold text-slate-600">{fmt(selectedSessionData.summary.paymentBreakdown?.CLOVER || 0)}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Declarado</p>
                          <p className="font-bold text-slate-700">{fmt(selectedSessionData.metadata.virtualClover || 0)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Diferencia</p>
                          <p className={`font-extrabold ${(selectedSessionData.metadata.virtualClover - (selectedSessionData.summary.paymentBreakdown?.CLOVER || 0)) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {fmt(selectedSessionData.metadata.virtualClover - (selectedSessionData.summary.paymentBreakdown?.CLOVER || 0))}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* MercadoPago */}
                    <div className="bg-slate-50/50 border border-slate-200/60 p-4 rounded-xl space-y-2">
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">MercadoPago (Cajas 1 y 2)</span>
                        <span className="text-[9px] font-extrabold text-teal-600 uppercase">Virtual</span>
                      </div>
                      <div className="grid grid-cols-3 text-xs gap-2 pt-1">
                        <div>
                          <p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Esperado</p>
                          <p className="font-bold text-slate-600">{fmt(selectedSessionData.summary.paymentBreakdown?.MERCADOPAGO || 0)}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Declarado</p>
                          <p className="font-bold text-slate-700">{fmt(selectedSessionData.metadata.virtualMP1 + selectedSessionData.metadata.virtualMP2)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Diferencia</p>
                          <p className={`font-extrabold ${((selectedSessionData.metadata.virtualMP1 + selectedSessionData.metadata.virtualMP2) - (selectedSessionData.summary.paymentBreakdown?.MERCADOPAGO || 0)) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {fmt((selectedSessionData.metadata.virtualMP1 + selectedSessionData.metadata.virtualMP2) - (selectedSessionData.summary.paymentBreakdown?.MERCADOPAGO || 0))}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Cuenta Corriente */}
                    <div className="bg-pink-50/40 border border-pink-200/60 p-4 rounded-xl space-y-2">
                      <div className="flex justify-between border-b border-pink-100 pb-1.5">
                        <span className="text-[10px] font-bold text-pink-700 uppercase tracking-wider">Cuenta Corriente</span>
                        <span className="text-[9px] font-extrabold text-pink-500 uppercase">A Crédito</span>
                      </div>
                      <div className="grid grid-cols-2 text-xs gap-2 pt-1 font-semibold text-slate-600">
                        <div>
                          <p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Total Ventas</p>
                          <p className="font-bold text-slate-700">{fmt(selectedSessionData.summary.paymentBreakdown?.DEBT || 0)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Estado</p>
                          <p className="font-bold text-pink-600 uppercase text-[9px]">No Afecta Caja</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detalle de Movimientos Manuales (Egresos/Gastos) */}
                {selectedSession.cashMovements && selectedSession.cashMovements.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-3">
                    <h4 className="text-xs font-bold text-slate-750 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                      <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin-slow" /> Detalle de Egresos y Movimientos del Turno
                    </h4>
                    <div className="overflow-x-auto max-h-[200px] pr-1 custom-scrollbar">
                      <table className="w-full text-left text-xs font-semibold text-slate-600 border-collapse">
                        <thead>
                          <tr className="border-b border-slate-100 text-[10px] uppercase text-slate-400 font-bold tracking-wider">
                            <th className="pb-2 text-left">Categoría</th>
                            <th className="pb-2 text-left">Descripción</th>
                            <th className="pb-2 text-left">Hora</th>
                            <th className="pb-2 text-right">Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedSession.cashMovements.map((mov: any) => {
                            const desc = mov.description || '';
                            const categoryMatch = desc.match(/^\[(.*?)\]/);
                            const category = categoryMatch ? categoryMatch[1] : 'Otro';
                            const cleanDescription = desc.replace(/^\[.*?\]/, '').trim();
                            
                            const getCatStyles = (cat: string) => {
                              const map: any = {
                                'Otro': 'bg-slate-50 text-slate-600 border-slate-100',
                                'Mercadería / Insumos': 'bg-emerald-50 text-emerald-600 border-emerald-100',
                                'Servicios (Luz, Agua, etc)': 'bg-blue-50 text-blue-600 border-blue-100',
                                'Sueldos / Adelantos': 'bg-indigo-50 text-indigo-600 border-indigo-100',
                                'Mantenimiento': 'bg-amber-50 text-amber-600 border-amber-100',
                                'Impuestos': 'bg-rose-50 text-rose-600 border-rose-100'
                              };
                              return map[cat] || 'bg-slate-50 text-slate-600 border-slate-100';
                            };

                            return (
                              <tr key={mov.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40 transition-colors">
                                <td className="py-2.5">
                                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${getCatStyles(category)}`}>
                                    {category}
                                  </span>
                                </td>
                                <td className="py-2.5 text-slate-700 font-bold">{cleanDescription || 'Gasto operativo'}</td>
                                <td className="py-2.5 text-slate-400 font-medium">{new Date(mov.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                <td className="py-2.5 text-right font-black text-rose-600">
                                  - {fmt(mov.amount)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Notes */}
                {selectedSessionData.notesClean && (
                  <div className="bg-amber-50/40 border border-amber-200/60 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-amber-700 uppercase tracking-wider block mb-1">Observaciones / Anotaciones</span>
                    <p className="text-xs font-medium text-slate-600 italic">"{selectedSessionData.notesClean}"</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center shrink-0">
                <button 
                  onClick={() => window.print()}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  <Printer className="w-4 h-4" /> Imprimir Arqueo A4
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mr-2">Desviación Total Conciliación:</span>
                  <span className={`text-xl font-extrabold ${selectedSession.difference === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {selectedSession.difference > 0 ? '+' : ''}{fmt(selectedSession.difference || 0)}
                  </span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Cierre de Caja en Vivo para Administrador */}
      <AnimatePresence>
        {closingSession && (
          <motion.div 
            key="closing-session-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setClosingSession(null)}
            className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.98, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.98, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 p-6 space-y-4 overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Lock className="w-5 h-5 text-rose-500" /> Cerrar Caja ({closingSession.terminalName})
                </h3>
                <button onClick={() => setClosingSession(null)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X className="w-5 h-5" /></button>
              </div>

              <div>
                <p className="text-xs text-slate-500 font-semibold mb-2">Cajero: <span className="font-bold text-slate-700">{closingSession.user?.fullName}</span></p>
                <div className="p-3 bg-indigo-50 border border-indigo-150 rounded-xl mb-4 text-xs font-semibold text-indigo-700">
                  El monto esperado en caja según el sistema es de <span className="font-extrabold">{fmt(closingSession.expectedAmount || 0)}</span>.
                </div>
                
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Monto físico contado ($)</label>
                <input 
                  type="number" 
                  value={closingAmount || ''} 
                  onChange={(e) => setClosingAmount(Number(e.target.value))} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-lg font-bold text-slate-800 outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner" 
                  placeholder="Contá el efectivo en caja..." 
                  autoFocus 
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Observaciones / Notas de cierre</label>
                <textarea 
                  value={closingNotes} 
                  onChange={(e) => setClosingNotes(e.target.value)} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner h-20 resize-none" 
                  placeholder="Escribe alguna diferencia o comentario..." 
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={async () => {
                    try {
                      await api.post(`/cash/${closingSession.id}/close`, { 
                        closingAmountCounted: closingAmount, 
                        closingNotes 
                      });
                      toast.success(`Caja de ${closingSession.terminalName} cerrada con éxito`);
                      setClosingSession(null);
                      loadSessions();
                    } catch (err: any) {
                      toast.error(err.response?.data?.message || 'Error al cerrar caja');
                    }
                  }}
                  className="flex-1 bg-rose-500 hover:bg-rose-600 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" /> Confirmar Cierre
                </button>
                <button onClick={() => setClosingSession(null)} className="px-5 py-3.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
                  Cancelar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Monitoreo en Tiempo Real */}
      <AnimatePresence>
        {monitoringSession && (
          <motion.div 
            key="monitoring-session-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMonitoringSession(null)}
            className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.98, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.98, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-500 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Monitoreo en Tiempo Real</h3>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{monitoringSession.terminalName} - Responsable: {monitoringSession.user?.fullName}</p>
                  </div>
                </div>
                <button onClick={() => setMonitoringSession(null)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X className="w-5 h-5" /></button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {/* Metric Summary Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 border border-indigo-100 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider block mb-1">Efectivo en Caja en Vivo</span>
                    <span className="text-2xl font-black text-indigo-700">{fmt(monitoringSession.expectedAmount)}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200/60 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Fondo de Apertura</span>
                    <span className="text-2xl font-bold text-slate-700">{fmt(monitoringSession.openingAmount)}</span>
                  </div>
                </div>

                {/* Live sales breakdown by payment method */}
                <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4">
                  <h4 className="text-xs font-bold text-slate-750 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                    <DollarSign className="w-4 h-4 text-emerald-500" /> Desglose de Ventas del Turno
                  </h4>
                  <div className="space-y-3.5 text-xs text-slate-500 font-semibold">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Wallet className="w-4 h-4 text-blue-500 shrink-0" />
                        <span>Ventas en Efectivo</span>
                      </div>
                      <span className="font-extrabold text-slate-800">{fmt(monitoringSession.cashSales || 0)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 text-slate-600">
                        <CreditCard className="w-4 h-4 text-amber-500 shrink-0" />
                        <span>Ventas Clover (Posnet)</span>
                      </div>
                      <span className="font-extrabold text-slate-800">{fmt(monitoringSession.cloverSales || 0)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Smartphone className="w-4 h-4 text-sky-500 shrink-0" />
                        <span>Ventas MercadoPago (Virtual)</span>
                      </div>
                      <span className="font-extrabold text-slate-800">{fmt(monitoringSession.mpSales || 0)}</span>
                    </div>
                    <div className="flex justify-between items-center text-pink-650 animate-in fade-in duration-300">
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-pink-500 shrink-0" />
                        <span>Ventas Cuenta Corriente (Crédito)</span>
                      </div>
                      <span className="font-extrabold">{fmt(monitoringSession.debtSales || 0)}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-slate-100 pt-3 text-slate-800 font-bold">
                      <span>Total Facturado del Turno</span>
                      <span className="text-sm font-black text-emerald-600">
                        {fmt((monitoringSession.cashSales || 0) + (monitoringSession.cloverSales || 0) + (monitoringSession.mpSales || 0) + (monitoringSession.debtSales || 0))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Cash movements breakdown */}
                <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-3">
                  <h4 className="text-xs font-bold text-slate-750 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                    <RefreshCw className="w-4 h-4 text-indigo-500" /> Movimientos Manuales (Entradas/Salidas)
                  </h4>
                  {monitoringSession.cashMovements && monitoringSession.cashMovements.length > 0 ? (
                    <div className="max-h-[160px] overflow-y-auto pr-1 custom-scrollbar space-y-2">
                      {monitoringSession.cashMovements.map((mov: any) => (
                        <div key={mov.id} className="flex justify-between items-center text-xs py-1.5 border-b border-slate-50 last:border-0 font-medium">
                          <div>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider mr-2 ${
                              mov.type === 'INCOME' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'
                            }`}>
                              {mov.type === 'INCOME' ? 'Ingreso' : mov.type === 'EXPENSE' ? 'Gasto' : 'Retiro'}
                            </span>
                            <span className="text-slate-600 font-semibold">{mov.description || 'Sin descripción'}</span>
                          </div>
                          <span className={`font-bold ${
                            mov.type === 'INCOME' ? 'text-emerald-600' : 'text-rose-600'
                          }`}>
                            {mov.type === 'INCOME' ? '+' : '-'}{fmt(mov.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 py-4 text-center font-bold uppercase tracking-wider">No se registraron entradas ni salidas manuales</p>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center shrink-0">
                <button 
                  onClick={() => {
                    const sessionToClose = monitoringSession;
                    setMonitoringSession(null);
                    setTimeout(() => {
                      setClosingSession(sessionToClose);
                      setClosingAmount(sessionToClose.expectedAmount || 0);
                      setClosingNotes('');
                    }, 200);
                  }}
                  className="px-5 py-2.5 rounded-xl border border-rose-200 bg-rose-50/50 hover:bg-rose-100 text-rose-600 font-extrabold text-xs uppercase tracking-wider shadow-sm transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  <XCircle className="w-4.5 h-4.5 text-rose-500" /> Cerrar Caja
                </button>
                
                <button 
                  onClick={() => setMonitoringSession(null)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-750 font-bold text-xs uppercase tracking-wider shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  Entendido
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Printable Z-Report (A4) in History */}
      {selectedSession && selectedSessionData && (
        <div id="printable-zreport" className="hidden">
          <div style={{ padding: '10mm', fontFamily: 'sans-serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #e2e8f0', paddingBottom: '5mm', marginBottom: '8mm' }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 900, color: '#e11d48', letterSpacing: '-0.03em' }}>
                  {(localStorage.getItem('gd_store_name') || 'GO! Punto de Venta').toUpperCase()}
                </h1>
                <p style={{ margin: '1mm 0 0 0', fontSize: '10px', fontWeight: 'bold', color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sistema de Control e Inventario de Caja</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#1e293b' }}>REPORTE DE ARQUEO DE CAJA (Z)</h2>
                <p style={{ margin: '1mm 0 0 0', fontSize: '10px', fontWeight: 'bold', color: '#e11d48' }}>ID: #{selectedSession.id?.substring(0, 8).toUpperCase()}</p>
              </div>
            </div>

            {/* Session Metadata Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4mm', marginBottom: '8mm', background: '#f8fafc', padding: '4mm', borderRadius: '4mm', border: '1px solid #f1f5f9' }}>
              <div>
                <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Apertura Por</span>
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#1e293b' }}>{selectedSession.user?.fullName || 'Administrador'}</span>
              </div>
              <div>
                <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Cerrado Por</span>
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#1e293b' }}>{selectedSessionData.metadata?.closedBy || selectedSession.user?.fullName || 'Administrador'}</span>
              </div>
              <div>
                <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Terminal</span>
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#1e293b' }}>{selectedSession.terminalName || 'Terminal Principal'}</span>
              </div>
              <div>
                <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Apertura</span>
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#475569' }}>{new Date(selectedSession.openedAt).toLocaleString('es-AR')}</span>
              </div>
              <div>
                <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Cierre</span>
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#475569' }}>{new Date(selectedSession.closedAt).toLocaleString('es-AR')}</span>
              </div>
            </div>

            {/* A: Arqueo Físico de Billetes */}
            <div style={{ marginBottom: '8mm' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', paddingBottom: '2mm', marginBottom: '4mm' }}>Sección A: Arqueo de Efectivo Físico</h3>
              <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 'bold' }}>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Denominación</th>
                    <th style={{ textAlign: 'center', padding: '6px' }}>Cantidad Declarada</th>
                    <th style={{ textAlign: 'right', padding: '6px' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody style={{ borderBottom: '1px solid #e2e8f0' }}>
                  {denominations.map((den) => {
                    const qty = selectedSessionData.metadata.bills[den] || 0;
                    return (
                      <tr key={den} style={{ borderBottom: '1px solid #f8fafc' }}>
                        <td style={{ padding: '6px', fontWeight: 'bold' }}>$ {den.toLocaleString()}</td>
                        <td style={{ padding: '6px', textAlign: 'center', fontWeight: 'bold', color: qty > 0 ? '#1e293b' : '#cbd5e1' }}>{qty}</td>
                        <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(den * qty)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8mm', marginTop: '3mm', fontSize: '11px' }}>
                <div><span style={{ color: '#64748b' }}>Ventas Efectivo: </span><span style={{ fontWeight: 'bold' }}>{fmt(selectedSessionData.summary.paymentBreakdown?.CASH || 0)}</span></div>
                <div><span style={{ color: '#64748b' }}>Egresos/Gastos: </span><span style={{ fontWeight: 'bold', color: '#ef4444' }}>-{fmt(selectedSessionData.summary.cashExpense || 0)}</span></div>
                <div><span style={{ color: '#1e293b', fontWeight: 'bold' }}>Total Esperado: </span><span style={{ fontWeight: 'bold' }}>{fmt(selectedSession.closingAmountExpected || 0)}</span></div>
                <div><span style={{ color: '#e11d48', fontWeight: 'bold' }}>Total Contado: </span><span style={{ fontWeight: 'bold', color: '#e11d48' }}>{fmt(selectedSessionData.summary.countedCash || 0)}</span></div>
              </div>
            </div>

            {/* B: Arqueo Virtual y Posnets */}
            <div style={{ marginBottom: '8mm' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', paddingBottom: '2mm', marginBottom: '4mm' }}>Sección B: Tarjetas y Cuentas Virtuales</h3>
              <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 'bold' }}>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Medio de Pago</th>
                    <th style={{ textAlign: 'right', padding: '6px' }}>Esperado Sistema</th>
                    <th style={{ textAlign: 'right', padding: '6px' }}>Declarado Físico</th>
                    <th style={{ textAlign: 'right', padding: '6px' }}>Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ padding: '6px', fontWeight: 'bold' }}>Clover (Posnet)</td>
                    <td style={{ padding: '6px', textAlign: 'right' }}>{fmt(selectedSessionData.summary.paymentBreakdown?.CLOVER || 0)}</td>
                    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(selectedSessionData.metadata.virtualClover || 0)}</td>
                    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold', color: (selectedSessionData.metadata.virtualClover - (selectedSessionData.summary.paymentBreakdown?.CLOVER || 0)) >= 0 ? '#10b981' : '#ef4444' }}>{fmt(selectedSessionData.metadata.virtualClover - (selectedSessionData.summary.paymentBreakdown?.CLOVER || 0))}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ padding: '6px', fontWeight: 'bold' }}>MercadoPago (Caja 1 y 2)</td>
                    <td style={{ padding: '6px', textAlign: 'right' }}>{fmt(selectedSessionData.summary.paymentBreakdown?.MERCADOPAGO || 0)}</td>
                    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(selectedSessionData.metadata.virtualMP1 + selectedSessionData.metadata.virtualMP2)}</td>
                    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold', color: ((selectedSessionData.metadata.virtualMP1 + selectedSessionData.metadata.virtualMP2) - (selectedSessionData.summary.paymentBreakdown?.MERCADOPAGO || 0)) >= 0 ? '#10b981' : '#ef4444' }}>{fmt((selectedSessionData.metadata.virtualMP1 + selectedSessionData.metadata.virtualMP2) - (selectedSessionData.summary.paymentBreakdown?.MERCADOPAGO || 0))}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ padding: '6px', fontWeight: 'bold' }}>Cuenta Corriente (A Crédito)</td>
                    <td style={{ padding: '6px', textAlign: 'right' }}>{fmt(selectedSessionData.summary.paymentBreakdown?.DEBT || 0)}</td>
                    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>-</td>
                    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold', color: '#64748b' }}>No Afecta Caja</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* C: Conciliación General y Firmas */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '8mm', marginTop: '6mm', borderTop: '2px solid #334155', paddingTop: '6mm' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '11px', fontWeight: 'bold', color: '#1e293b', textTransform: 'uppercase' }}>Observaciones del Cierre</h4>
                <p style={{ margin: '2mm 0 0 0', fontSize: '10px', color: '#475569', fontStyle: 'italic', background: '#f8fafc', padding: '3mm', borderRadius: '2mm', minHeight: '15mm', border: '1px solid #f1f5f9' }}>{selectedSessionData.notesClean || 'Sin observaciones registradas para este turno.'}</p>
              </div>
              <div style={{ background: '#f8fafc', padding: '4mm', borderRadius: '4mm', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2.5mm', fontSize: '11px' }}>
                  <span style={{ fontWeight: 'bold', color: '#64748b' }}>TOTAL ESPERADO:</span>
                  <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{fmt(selectedSession.closingAmountExpected || 0)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3.5mm', fontSize: '11px' }}>
                  <span style={{ fontWeight: 'bold', color: '#64748b' }}>TOTAL DECLARADO:</span>
                  <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{fmt(selectedSession.closingAmountCounted || 0)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #e11d48', paddingTop: '3mm', fontSize: '14px', fontWeight: 'bold' }}>
                  <span style={{ color: '#e11d48' }}>DESVIACIÓN NETO:</span>
                  <span style={{ color: selectedSession.difference === 0 ? '#10b981' : '#ef4444' }}>{selectedSession.difference > 0 ? '+' : ''}{fmt(selectedSession.difference || 0)}</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '20mm', display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 'bold', color: '#64748b' }}>
              <div style={{ borderTop: '2px solid #cbd5e1', width: '60mm', textAlign: 'center', paddingTop: '2.5mm' }}>Firma Cajero</div>
              <div style={{ borderTop: '2px solid #cbd5e1', width: '60mm', textAlign: 'center', paddingTop: '2.5mm' }}>Firma Dueño / Supervisor</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import api from '../../services/api';
import { getClientId } from '../../utils/clientId';
import { holdLogout } from '../../utils/logoutHold';
import { Calendar, ChevronDown, ChevronRight, DollarSign, Download, Search, Users, Copy, Wallet, CheckCircle2, TrendingDown, Receipt, ChevronUp, Clock, AlertCircle, RefreshCw, FileText, Printer, FileOutput, User, XCircle, History, TrendingUp, ArrowDownRight, LayoutDashboard, Lock, X, Package, Smartphone, CreditCard, Play, Filter, ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { wsService } from '../../services/websocket';
import CierreDiaModal from './CierreDiaModal';
import XReportPrint, { parseXSession } from './XReportPrint';
import { cashClosingResult } from '../../utils/cashDifference';
import { useAuthStore } from '../../stores/authStore';
import { PageHeader, Panel, StatCard, EmptyState, Segmented, ui } from '../ui/Page';
import { escapeHtml } from '../../utils/escapeHtml';
import { MpSessionControl } from './MpReconcilePanel';

export default function CashControlScreen() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<'all' | 'month' | 'day' | 'range'>('all');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedDay, setSelectedDay] = useState<string>(new Date().toISOString().split('T')[0]);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [sellerFilter, setSellerFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [isLoadingSessionDetails, setIsLoadingSessionDetails] = useState(false);

  const handleSelectSession = async (s: any) => {
    setSelectedSession(s);
    if (!s.sales || s.sales.length === 0) {
      setIsLoadingSessionDetails(true);
      try {
        const res = await api.get(`/cash/session/${s.id}`);
        if (res.data) {
          setSelectedSession(res.data);
        }
      } catch (err) {
        console.error('Error fetching session details:', err);
      } finally {
        setIsLoadingSessionDetails(false);
      }
    }
  };
  const [isGeneratingZ, setIsGeneratingZ] = useState(false);
  const [zReportData, setZReportData] = useState<any>(null);
  const [isHistoryZReport, setIsHistoryZReport] = useState(false);
  const [zReports, setZReports] = useState<any[]>([]);
  const [activeHistoryTab, setActiveHistoryTab] = useState<'X' | 'Z'>('X');
  const [showFilters, setShowFilters] = useState(true);
  const [showLocalFilters, setShowLocalFilters] = useState(false);
  const [localDay, setLocalDay] = useState('');
  const [localCashier, setLocalCashier] = useState('all');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  
  // Infinite scroll states
  const [hasMoreSessions, setHasMoreSessions] = useState(true);
  const [hasMoreZReports, setHasMoreZReports] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const observerTarget = useRef<HTMLDivElement>(null);
  
  // States for live monitoring and closing
  const [monitoringSession, setMonitoringSession] = useState<any>(null);
  const [closingSession, setClosingSession] = useState<any>(null);
  const [closingAmount, setClosingAmount] = useState<number>(0);
  const [closingNotes, setClosingNotes] = useState<string>('');

  // Turnos cerrados (por cualquier cajero) que quedaron sin arqueo — p.ej. por un cierre
  // inesperado de la app durante el conteo. Mientras existan, bloquean la generación del
  // Cierre Z para toda la tienda, así que el admin necesita poder verlos y resolverlos
  // aunque no sean su propio turno.
  const [pendingArqueosAll, setPendingArqueosAll] = useState<any[]>([]);
  const [resolvingArqueo, setResolvingArqueo] = useState<any>(null);
  const [arqueoAmount, setArqueoAmount] = useState<number>(0);
  const [arqueoNotes, setArqueoNotes] = useState<string>('');

  const loadPendingArqueosAll = useCallback(async () => {
    try {
      const { data } = await api.get('/cash/pending-arqueos/all');
      setPendingArqueosAll(data || []);
    } catch {
      // Silencioso: no bloquea el resto del dashboard si falla
    }
  }, []);
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
            <title>${escapeHtml(title)}</title>
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

  const getSessionSalesTotal = (s: any) => {
    if (s?.closingSummary) {
      try {
        const parsed = typeof s.closingSummary === 'string' ? JSON.parse(s.closingSummary) : s.closingSummary;
        if (typeof parsed?.totalRevenue === 'number') return parsed.totalRevenue;
      } catch {}
    }
    if (s?.sales && Array.isArray(s.sales)) {
      return s.sales.reduce((sum: number, v: any) => sum + (v.total || 0), 0);
    }
    return s?.closingAmountExpected || 0;
  };

  const handleExportExcel = () => {
    const headers = [
      'Terminal', 'Responsable', 'Apertura', 'Cierre', 
      'Ventas Totales', 'Gastos', 'Monto Cierre', 'Diferencia'
    ];
    const rows = closedSessions.map((s: any) => {
      const salesTotal = getSessionSalesTotal(s);
      const expensesTotal = s.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((sum: number, m: any) => sum + m.amount, 0) || 0;
      return [
        s.terminalName,
        s.user?.fullName,
        new Date(s.openedAt).toLocaleString('es-AR'),
        s.closedAt ? new Date(s.closedAt).toLocaleString('es-AR') : '',
        salesTotal,
        expensesTotal,
        s.closingAmountCounted || 0,
        cashClosingResult(s).totalDiff
      ];
    });
    
    downloadCSV(`Historial_Cajas.csv`, headers, rows);
    toast.success('Excel exportado correctamente');
  };

  const handleExportZReportExcel = () => {
    if (filteredZReports.length === 0) {
      toast.error('No hay reportes Z para exportar con los filtros seleccionados');
      return;
    }
    const headers = [
      'ID Reporte', 'Cajero / Responsable', 'Fecha y Hora', 
      'Esperado Sistema', 'Declarado Total', 'Diferencia', 'Turnos Incluidos'
    ];
    const rows = filteredZReports.map((z: any) => {
      const turnsCount = z.summaryParsed?.sessions?.length || z.sessions?.length || 1;
      return [
        z.id?.substring(0, 8) || '',
        z.generatedBy?.fullName || 'Sistema',
        new Date(z.generatedAt).toLocaleString('es-AR'),
        z.totalExpected || 0,
        z.totalDeclared || 0,
        z.differenceTotal || 0,
        turnsCount
      ];
    });
    downloadCSV(`Reportes_Z_Historial.csv`, headers, rows);
  };

  const handleGenerateZReport = async () => {
    // Sin sesión cerrada hasta que aparezca el cartel del Z (la traba la toma después el cartel)
    const release = holdLogout();
    try {
      setIsGeneratingZ(true);
      const { data } = await api.post('/cash/z-report/generate', { clientId: getClientId() });
      setZReportData(data);
      setIsHistoryZReport(false);
      loadSessions();
      loadPendingArqueosAll();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al generar Reporte Z. Recuerda que todos los turnos deben estar arqueados primero.');
    } finally {
      setIsGeneratingZ(false);
      setTimeout(release, 3000);
    }
  };

  const handleExportPDF = () => {
    const rowsHtml = closedSessions.map((s: any) => {
      const salesTotal = getSessionSalesTotal(s);
      const expensesTotal = s.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((sum: number, m: any) => sum + m.amount, 0) || 0;
      const totalDiff = cashClosingResult(s).totalDiff;
      return `
        <tr>
          <td class="font-bold">${escapeHtml(s.terminalName)}</td>
          <td>${escapeHtml(s.user?.fullName)}</td>
          <td>${new Date(s.openedAt).toLocaleDateString('es-AR')}</td>
          <td>${s.closedAt ? new Date(s.closedAt).toLocaleDateString('es-AR') : 'Abierta'}</td>
          <td class="text-right">${fmt(salesTotal)}</td>
          <td class="text-right">${fmt(expensesTotal)}</td>
          <td class="text-right">${fmt(s.closingAmountCounted || 0)}</td>
          <td class="text-right font-bold" style="color: ${totalDiff < 0 ? '#ef4444' : '#10b981'};">${fmt(totalDiff)}</td>
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

  const selectedSessionData = useMemo(() => parseXSession(selectedSession), [selectedSession]);

  useEffect(() => {
    loadSessions();
    loadPendingArqueosAll();
    let updateTimer: any = null;
    const handleUpdate = () => {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        api.get('/cash/history').then(res => setSessions(res.data || [])).catch(() => {});
        api.get('/cash/active').then(res => setActiveSessions(res.data || [])).catch(() => {});
        api.get('/cash/z-reports').then(res => setZReports(res.data || [])).catch(() => {});
        loadPendingArqueosAll();
      }, 500);
    };
    wsService.on('cash:updated', handleUpdate);
    wsService.on('sale:created', handleUpdate);
    return () => {
      if (updateTimer) clearTimeout(updateTimer);
      wsService.off('cash:updated', handleUpdate);
      wsService.off('sale:created', handleUpdate);
    };
  }, []);

  const PAGE_SIZE = 30;

  const loadMoreSessions = useCallback(async () => {
    if (isLoadingMore || !hasMoreSessions) return;
    setIsLoadingMore(true);
    try {
      const res = await api.get('/cash/history', {
        params: { skip: sessions.length, limit: PAGE_SIZE }
      });
      const newItems = res.data || [];
      if (newItems.length < PAGE_SIZE) {
        setHasMoreSessions(false);
      }
      setSessions(prev => {
        const existingIds = new Set(prev.map((s: any) => s.id));
        const toAdd = newItems.filter((s: any) => !existingIds.has(s.id));
        return [...prev, ...toAdd];
      });
    } catch (e) {
      console.error('Error loading more sessions:', e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMoreSessions, sessions.length]);

  const loadMoreZReports = useCallback(async () => {
    if (isLoadingMore || !hasMoreZReports) return;
    setIsLoadingMore(true);
    try {
      const res = await api.get('/cash/z-reports', {
        params: { skip: zReports.length, limit: PAGE_SIZE }
      });
      const newItems = res.data || [];
      if (newItems.length < PAGE_SIZE) {
        setHasMoreZReports(false);
      }
      setZReports(prev => {
        const existingIds = new Set(prev.map((z: any) => z.id));
        const toAdd = newItems.filter((z: any) => !existingIds.has(z.id));
        return [...prev, ...toAdd];
      });
    } catch (e) {
      console.error('Error loading more Z reports:', e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMoreZReports, zReports.length]);

  useEffect(() => {
    const target = observerTarget.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          if (activeHistoryTab === 'X' && hasMoreSessions && !isLoadingMore) {
            loadMoreSessions();
          } else if (activeHistoryTab === 'Z' && hasMoreZReports && !isLoadingMore) {
            loadMoreZReports();
          }
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(target);
    return () => {
      observer.unobserve(target);
      observer.disconnect();
    };
  }, [activeHistoryTab, hasMoreSessions, hasMoreZReports, isLoadingMore, loadMoreSessions, loadMoreZReports]);

  const loadSessions = async () => {
    setIsLoading(true);
    try {
      const [resHistory, resActive, resZReports, resUsers] = await Promise.all([
        api.get('/cash/history', { params: { skip: 0, limit: PAGE_SIZE } }),
        api.get('/cash/active'),
        api.get('/cash/z-reports', { params: { skip: 0, limit: PAGE_SIZE } }).catch(() => ({ data: [] })),
        api.get('/users').catch(() => ({ data: [] }))
      ]);
      const histData = resHistory.data || [];
      setSessions(histData);
      setHasMoreSessions(histData.length >= PAGE_SIZE);

      setActiveSessions(resActive.data || []);
      
      const zData = resZReports.data || [];
      setZReports(zData);
      setHasMoreZReports(zData.length >= PAGE_SIZE);

      setAllUsers(resUsers.data || []);
    } catch {
      toast.error('Error al sincronizar las cajas');
    } finally { setIsLoading(false); }
  };

  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);

  const formatDateAR = (dateStr?: string | Date | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatTimeAR = (dateStr?: string | Date | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const filteredSessions = sessions.filter(s => {
    const date = new Date(s.openedAt);
    let matchesDate = false;
    
    if (filterMode === 'all') {
      matchesDate = true;
    } else if (filterMode === 'month') {
      matchesDate = date.getMonth() === selectedMonth && date.getFullYear() === selectedYear;
    } else if (filterMode === 'day') {
      const dayStr = date.toISOString().split('T')[0];
      matchesDate = dayStr === selectedDay;
    } else if (filterMode === 'range') {
      const dayStr = date.toISOString().split('T')[0];
      matchesDate = dayStr >= startDate && dayStr <= endDate;
    }

    const matchesSeller = sellerFilter === 'all' || s.user?.id === sellerFilter;
    const timeStrOpened = new Date(s.openedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }).toLowerCase();
    const timeStrClosed = s.closedAt ? new Date(s.closedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }).toLowerCase() : '';
    const matchesSearch = searchQuery === '' || 
      s.terminalName?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      s.user?.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      timeStrOpened.includes(searchQuery.toLowerCase()) ||
      timeStrClosed.includes(searchQuery.toLowerCase());
    return matchesDate && matchesSeller && matchesSearch;
  });

  const filteredZReports = zReports.filter(z => {
    const date = new Date(z.generatedAt);
    let matchesDate = false;
    
    if (filterMode === 'all') {
      matchesDate = true;
    } else if (filterMode === 'month') {
      matchesDate = date.getMonth() === selectedMonth && date.getFullYear() === selectedYear;
    } else if (filterMode === 'day') {
      const dayStr = date.toISOString().split('T')[0];
      matchesDate = dayStr === selectedDay;
    } else if (filterMode === 'range') {
      const dayStr = date.toISOString().split('T')[0];
      matchesDate = dayStr >= startDate && dayStr <= endDate;
    }

    const matchesSeller = sellerFilter === 'all' || z.generatedBy?.id === sellerFilter || z.generatedById === sellerFilter;
    const timeStr = new Date(z.generatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }).toLowerCase();
    const matchesSearch = searchQuery === '' || 
      z.generatedBy?.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      z.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      timeStr.includes(searchQuery.toLowerCase());
    return matchesDate && matchesSeller && matchesSearch;
  });

  const locallyFilteredSessions = useMemo(() => {
    return filteredSessions.filter(s => {
      if (localCashier !== 'all' && s.user?.id !== localCashier) return false;
      if (localDay) {
        const openedDay = new Date(s.openedAt).toISOString().split('T')[0];
        if (openedDay !== localDay) return false;
      }
      return true;
    });
  }, [filteredSessions, localCashier, localDay]);

  const locallyFilteredClosedSessions = useMemo(() => {
    return [...locallyFilteredSessions]
      .filter(s => s.closedAt)
      .sort((a, b) => {
        const timeA = new Date(a.openedAt).getTime();
        const timeB = new Date(b.openedAt).getTime();
        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      });
  }, [locallyFilteredSessions, sortOrder]);

  const locallyFilteredZReports = useMemo(() => {
    return [...filteredZReports]
      .filter(z => {
        if (localCashier !== 'all' && z.generatedBy?.id !== localCashier && z.generatedById !== localCashier) return false;
        if (localDay) {
          const generatedDay = new Date(z.generatedAt).toISOString().split('T')[0];
          if (generatedDay !== localDay) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.generatedAt).getTime();
        const timeB = new Date(b.generatedAt).getTime();
        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      });
  }, [filteredZReports, localCashier, localDay, sortOrder]);

  const sortedActiveSessions = useMemo(() => {
    return [...activeSessions].sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
  }, [activeSessions]);

  const closedSessions = filteredSessions.filter(s => s.closedAt);

  const totalSales = closedSessions.reduce((acc, s) => {
    return acc + getSessionSalesTotal(s);
  }, 0);

  const totalExpenses = closedSessions.reduce((acc, s) => {
    return acc + (s.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((sum: number, m: any) => sum + m.amount, 0) || 0);
  }, 0);

  const totalDebtCollection = closedSessions.reduce((acc, s) => {
    return acc + (s.cashMovements?.filter((m: any) => m.type === 'INCOME' && m.description?.toLowerCase().includes('cuenta corriente')).reduce((sum: number, m: any) => sum + m.amount, 0) || 0);
  }, 0); 

  const totalDifferences = closedSessions.reduce((acc, s) => acc + cashClosingResult(s).totalDiff, 0);

  const balance = totalSales - totalExpenses;

  const users = useMemo(() => {
    if (allUsers && allUsers.length > 0) {
      return allUsers;
    }
    const allUsersStr = [
      ...sessions.map(s => JSON.stringify(s.user)),
      ...zReports.map(z => JSON.stringify(z.generatedBy))
    ];
    return Array.from(new Set(allUsersStr)).map(s => {
      try { return JSON.parse(s); } catch { return null; }
    }).filter(u => u && u.id);
  }, [allUsers, sessions, zReports]);

  const th = 'py-2.5 px-3 text-[12px] font-medium text-slate-500 dark:text-slate-400';
  const sortButton = (label: string) => (
    <button
      onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
      className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
      title={sortOrder === 'desc' ? 'Más recientes primero (clic para ver las más antiguas)' : 'Más antiguas primero (clic para ver las más recientes)'}
    >
      {label}
      {sortOrder === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
    </button>
  );

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
    <div className="max-w-[1480px] mx-auto flex flex-col gap-5 p-2 sm:p-3 anim-fade">
      <PageHeader
        title="Control de caja"
        description="Cajas abiertas, cierres por turno (X) y cierres diarios (Z)"
        actions={
          <>
            <button onClick={loadSessions} className={`${ui.btn} ${ui.btnSecondary}`} title="Actualizar">
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /> Actualizar
            </button>
            <button onClick={handleExportExcel} className={`${ui.btn} ${ui.btnSecondary}`}>
              <Download className="w-4 h-4 text-emerald-600" /> Excel
            </button>
            <button onClick={handleExportPDF} className={`${ui.btn} ${ui.btnSecondary}`}>
              <FileText className="w-4 h-4" /> PDF
            </button>
            <button disabled={isGeneratingZ} onClick={handleGenerateZReport} className={`${ui.btn} ${ui.btnPrimary}`}>
              <FileOutput className="w-4 h-4" /> {isGeneratingZ ? 'Generando…' : 'Generar cierre Z'}
            </button>
          </>
        }
      />

      {pendingArqueosAll.length > 0 && (
        <div className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13.5px] font-semibold text-amber-900 dark:text-amber-200">
                {pendingArqueosAll.length} turno{pendingArqueosAll.length > 1 ? 's' : ''} cerrado{pendingArqueosAll.length > 1 ? 's' : ''} sin arqueo
              </p>
              <p className="text-[12.5px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                {pendingArqueosAll.map(p => `${p.user?.fullName || 'Desconocido'} (${p.terminalName})`).join(', ')}. El cierre Z se puede generar cuando estén contados.
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {pendingArqueosAll.map(p => (
              <button
                key={p.id}
                onClick={() => { setResolvingArqueo(p); setArqueoAmount(0); setArqueoNotes(''); }}
                className={`${ui.btn} bg-amber-600 hover:bg-amber-700 text-white`}
              >
                Contar {p.terminalName}
              </button>
            ))}
          </div>
        </div>
      )}

      {showFilters && (
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              options={[{ id: 'all', label: 'Todo' }, { id: 'month', label: 'Mes' }, { id: 'day', label: 'Día' }, { id: 'range', label: 'Rango' }]}
              value={filterMode}
              onChange={(v) => setFilterMode(v as any)}
            />
            {filterMode === 'month' && (
              <>
                <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} className={ui.field}>
                  {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
                <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className={ui.field}>
                  {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
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
            <select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} className={ui.field}>
              <option value="all">Todos los vendedores</option>
              {users.map((u: any, idx: number) => <option key={u.id || `seller-${idx}`} value={u.id}>{u.fullName}</option>)}
            </select>
          </div>

          <div className="relative w-full lg:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Buscar terminal o responsable" className={`${ui.field} w-full pl-9`} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Ventas totales" value={fmt(totalSales)} hint="Ingresos del período" icon={TrendingUp} tone="brand" />
        <StatCard label="Gastos operativos" value={fmt(totalExpenses)} hint="Egresos registrados" icon={ArrowDownRight} tone="danger" />
        <StatCard label="Cobros de deuda" value={fmt(totalDebtCollection)} hint="Cuentas corrientes" icon={Wallet} tone="info" />
        <StatCard label="Balance neto" value={fmt(balance)} hint="Ventas menos gastos" icon={LayoutDashboard} />
        <StatCard
          label="Diferencias"
          value={fmt(totalDifferences)}
          valueTone={totalDifferences < 0 ? 'danger' : totalDifferences > 0 ? 'success' : 'neutral'}
          hint={totalDifferences < 0 ? 'Faltante en caja' : totalDifferences > 0 ? 'Sobrante en caja' : 'Sin diferencias'}
          icon={AlertCircle}
          tone={totalDifferences < 0 ? 'danger' : 'success'}
        />
      </div>

      <Panel
        title={<span className="flex items-center gap-2">Cajas abiertas <span className="text-slate-400 font-medium">{activeSessions.length}</span></span>}
        action={
          <label className="flex items-center gap-2 text-[12.5px] text-slate-500 cursor-pointer hover:text-slate-700 transition-colors select-none">
            <input type="checkbox" checked={hideTotals} onChange={(e) => setHideTotals(e.target.checked)} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" /> Ocultar montos
          </label>
        }
      >
        {isLoading && activeSessions.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1].map(i => <div key={i} className="h-[132px] rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
          </div>
        ) : activeSessions.length === 0 ? (
          <EmptyState icon={Lock} title="No hay cajas abiertas" description="Cuando un cajero abre su turno en el punto de venta, la caja aparece acá en vivo." className="py-6" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedActiveSessions.map((s) => (
              <div key={s.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-rose-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {s.terminalName?.[0] || 'T'}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-[14px] font-semibold text-slate-900 dark:text-white truncate">{s.terminalName}</h4>
                      <p className="text-[12.5px] text-slate-500 truncate">{s.user?.fullName}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 text-[12px] font-medium shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Abierta
                  </span>
                </div>

                <div>
                  <p className="text-[12.5px] text-slate-500">Efectivo esperado</p>
                  <p className="text-[22px] font-bold text-slate-900 dark:text-white tracking-[-0.02em] leading-tight">{hideTotals ? '•••••' : fmt(s.expectedAmount || 0)}</p>
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
                    <Clock className="w-3.5 h-3.5 shrink-0" /> Desde las {formatTimeAR(s.openedAt)}
                  </span>
                  <button onClick={() => setMonitoringSession(s)} className={`${ui.btn} ${ui.btnSecondary} h-8 px-3`}>
                    <Play className="w-3.5 h-3.5 text-rose-600" /> Ver estado
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col p-5 min-h-[500px]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-[14px] font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-slate-400" /> Historial de cierres
              <span className="text-slate-400 font-medium">
                {activeHistoryTab === 'X' ? locallyFilteredClosedSessions.length : locallyFilteredZReports.length}
              </span>
            </h2>
            <p className="text-[12.5px] text-slate-500 mt-0.5">Registro permanente para auditoría</p>
          </div>
          <button
            onClick={() => setShowLocalFilters(!showLocalFilters)}
            className={`${ui.btn} ${showLocalFilters ? 'bg-rose-50 border border-rose-200 text-rose-700' : ui.btnSecondary}`}
          >
            <Filter className="w-4 h-4" />
            {showLocalFilters ? 'Ocultar filtros' : 'Filtrar'}
          </button>
        </div>

        {showLocalFilters && (
          <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 mb-3 flex flex-wrap gap-3 items-end">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-slate-500">Día</span>
              <input type="date" value={localDay} onChange={(e) => setLocalDay(e.target.value)} className={ui.field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-slate-500">Cajero</span>
              <select value={localCashier} onChange={(e) => setLocalCashier(e.target.value)} className={ui.field}>
                <option value="all">Todos los cajeros</option>
                {users.map((u: any, idx: number) => <option key={u.id || `local-seller-${idx}`} value={u.id}>{u.fullName}</option>)}
              </select>
            </label>
            {(localDay || localCashier !== 'all') && (
              <button onClick={() => { setLocalDay(''); setLocalCashier('all'); }} className={`${ui.btn} ${ui.btnSecondary}`}>
                Limpiar filtros
              </button>
            )}
          </div>
        )}

        <div className="flex border-b border-slate-200 dark:border-slate-800 mb-1 gap-6">
          {([['X', 'Cierres de turno (X)'], ['Z', 'Cierres diarios (Z)']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveHistoryTab(id)}
              className={`pb-2.5 -mb-px text-[13px] font-medium border-b-2 transition-colors cursor-pointer ${activeHistoryTab === id ? 'border-rose-600 text-slate-900 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeHistoryTab === 'X' ? (
          isLoading && sessions.length === 0 ? (
            <div className="space-y-2 py-3">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
            </div>
          ) : locallyFilteredClosedSessions.length === 0 ? (
            <EmptyState icon={History} title="Sin cierres para mostrar" description="Cuando se cierre un turno en el punto de venta, su reporte X queda guardado acá." className="flex-1" />
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[650px] text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className={th}>Terminal y responsable</th>
                    <th className={th}>{sortButton('Apertura')}</th>
                    <th className={`${th} text-right`}>Venta del sistema</th>
                    <th className={`${th} text-right`}>Diferencia</th>
                    <th className={`${th} text-center`}>Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {locallyFilteredClosedSessions.map((s) => (
                    <tr key={s.id} onClick={() => handleSelectSession(s)} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[12px] font-semibold text-slate-600 dark:text-slate-300 shrink-0">{s.terminalName?.[0]}</div>
                          <div>
                            <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{s.terminalName}</p>
                            <p className="text-[12px] text-slate-500">{s.user?.fullName}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <p className="text-[13px] font-medium text-slate-800 dark:text-slate-100">{formatDateAR(s.openedAt)}</p>
                        <p className="text-[12px] text-slate-500">{formatTimeAR(s.openedAt)}</p>
                      </td>
                      <td className="py-3 px-3 text-right text-[13px] font-semibold text-slate-900 dark:text-white">
                        {(() => {
                          try {
                            if (s.closingSummary) {
                              const parsed = JSON.parse(s.closingSummary);
                              if (parsed && typeof parsed.totalRevenue === 'number') {
                                return fmt(parsed.totalRevenue);
                              }
                            }
                          } catch (e) {}
                          return fmt(s.closingAmountExpected || 0);
                        })()}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {(() => {
                          const totalDiff = cashClosingResult(s).totalDiff;
                          return (
                            <span className={`text-[13px] font-semibold ${totalDiff === 0 ? 'text-slate-500' : totalDiff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {totalDiff > 0 && '+'}{fmt(totalDiff)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[12px] font-medium">Cerrada</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          locallyFilteredZReports.length === 0 ? (
            <EmptyState icon={FileOutput} title="Sin cierres Z" description="Generá el cierre Z al final del día para consolidar todos los turnos." className="flex-1" />
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[650px] text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className={th}>Reporte y responsable</th>
                    <th className={th}>{sortButton('Emitido')}</th>
                    <th className={`${th} text-right`}>Esperado</th>
                    <th className={`${th} text-right`}>Declarado</th>
                    <th className={`${th} text-right`}>Diferencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {locallyFilteredZReports.map((z) => (
                    <tr key={z.id} onClick={() => { setZReportData(z); setIsHistoryZReport(true); }} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center text-[12px] font-bold text-rose-700 dark:text-rose-400 shrink-0">Z</div>
                          <div>
                            <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 font-mono">#Z-{z.id?.substring(0, 8).toUpperCase()}</p>
                            <p className="text-[12px] text-slate-500">{z.generatedBy?.fullName || 'Administrador'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <p className="text-[13px] font-medium text-slate-800 dark:text-slate-100">{formatDateAR(z.generatedAt)}</p>
                        <p className="text-[12px] text-slate-500">{formatTimeAR(z.generatedAt)}</p>
                      </td>
                      <td className="py-3 px-3 text-right text-[13px] font-semibold text-slate-900 dark:text-white">{fmt(z.totalExpected || 0)}</td>
                      <td className="py-3 px-3 text-right text-[13px] font-semibold text-slate-900 dark:text-white">{fmt(z.totalDeclared || 0)}</td>
                      <td className="py-3 px-3 text-right">
                        <span className={`text-[13px] font-semibold ${z.differenceTotal === 0 ? 'text-slate-500' : z.differenceTotal > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {z.differenceTotal > 0 && '+'}{fmt(z.differenceTotal || 0)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Infinite Scroll Sentinel & Status Indicators */}
        <div ref={observerTarget} className="py-3 flex flex-col items-center justify-center gap-2 border-t border-slate-100 dark:border-slate-800 mt-3">
          {isLoadingMore && (
            <div className="flex items-center gap-2 text-slate-500 text-[12.5px]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Cargando cierres anteriores…</span>
            </div>
          )}

          {!isLoadingMore && ((activeHistoryTab === 'X' && hasMoreSessions) || (activeHistoryTab === 'Z' && hasMoreZReports)) && (
            <button
              onClick={() => activeHistoryTab === 'X' ? loadMoreSessions() : loadMoreZReports()}
              className={`${ui.btn} ${ui.btnSecondary}`}
            >
              Cargar cierres anteriores
            </button>
          )}

          {!isLoadingMore && ((activeHistoryTab === 'X' && !hasMoreSessions && locallyFilteredClosedSessions.length > 0) || (activeHistoryTab === 'Z' && !hasMoreZReports && locallyFilteredZReports.length > 0)) && (
            <div className="flex items-center gap-2 text-slate-400 text-[12.5px] py-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Estos son todos los registros ({activeHistoryTab === 'X' ? locallyFilteredClosedSessions.length : locallyFilteredZReports.length} {activeHistoryTab === 'X' ? 'turnos' : 'reportes'})</span>
            </div>
          )}
        </div>
      </div>
    </div>

      <style>{`
        @media print {
          #root {
            display: none !important;
          }
          #printable-zreport, #printable-zreport * {
            visibility: visible !important;
          }
          #printable-zreport {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: auto !important;
            background: white !important;
            z-index: 9999999 !important;
            font-family: 'Outfit Variable', 'Inter Variable', sans-serif !important;
            font-size: 12.5px !important;
            line-height: 1.3 !important;
            color: #000000 !important;
            padding: 5mm !important;
          }
          @page {
            size: A4;
            margin: 0;
          }
        }
      `}</style>
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
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-500 flex items-center justify-center">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Detalles de Arqueo y Conciliación</h3>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Sesión ID: #{selectedSession.id?.substring(0, 8).toUpperCase()}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedSession(null)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-rose-500 transition-all"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/20">
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                              if (qty === 0) return null;
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
                        <div className="flex justify-between text-rose-500">
                          <span>(-) Retiros a Caja Fuerte</span>
                          <span className="font-bold">-{fmt(selectedSessionData.summary.cashWithdrawal || 0)}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-100 pt-3">
                          <span className="font-semibold text-slate-600">Efectivo Esperado</span>
                          <span className="font-extrabold text-slate-800">{fmt(selectedSession.closingAmountExpected || 0)}</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-100 pb-3">
                          <span className="font-semibold text-rose-600">Efectivo Arqueado Físico</span>
                          <span className="font-extrabold text-rose-700">{fmt(selectedSessionData.summary.countedCash || 0)}</span>
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

                {/* Lo que Mercado Pago cobró de verdad en este turno (si la cuenta está conectada) */}
                <MpSessionControl sessionId={selectedSession.id} readOnly={selectedSession.status !== 'OPEN'} />

                <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4">
                  <h4 className="text-xs font-bold text-slate-755 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Smartphone className="w-4 h-4 text-rose-500" /> Conciliación Cuentas Virtuales y Crédito
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-slate-50/50 border border-slate-200/60 p-4 rounded-xl space-y-2">
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Clover (Posnet)</span>
                        <span className="text-[9px] font-extrabold text-rose-500 uppercase">Tarjetas</span>
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

                {selectedSession.cashMovements && selectedSession.cashMovements.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-3">
                    <h4 className="text-xs font-bold text-slate-750 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                      <RefreshCw className="w-4 h-4 text-rose-500 animate-spin-slow" /> Detalle de Egresos y Movimientos del Turno
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
                            let cleanDescription = desc.replace(/^\[.*?\]/, '').trim();
                            
                            const wageMatch = cleanDescription.match(/(?:liquidación|liquidacion) de sueldo para (.*?) por .*? trabajadas/i);
                            if (wageMatch) {
                              const cashierName = wageMatch[1].trim();
                              cleanDescription = `SUELDO: ${cashierName.toUpperCase()} - ${fmt(mov.amount)}`;
                            }
                            
                            const getCatStyles = (cat: string) => {
                              const map: any = {
                                'Otro': 'bg-slate-50 text-slate-600 border-slate-100',
                                'Mercadería / Insumos': 'bg-emerald-50 text-emerald-600 border-emerald-100',
                                'Servicios (Luz, Agua, etc)': 'bg-blue-50 text-blue-600 border-blue-100',
                                'Sueldos / Adelantos': 'bg-rose-50 text-rose-600 border-rose-100',
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

                {selectedSessionData.notesClean && (
                  <div className="bg-amber-50/40 border border-amber-200/60 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-amber-700 uppercase tracking-wider block mb-1">Observaciones / Anotaciones</span>
                    <p className="text-xs font-medium text-slate-600 italic">"{selectedSessionData.notesClean}"</p>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center shrink-0">
                <button 
                  onClick={() => window.print()}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  <Printer className="w-4 h-4" /> Imprimir Arqueo A4
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mr-2">Desviación Total Conciliación:</span>
                  {(() => {
                    const cashDiff = selectedSession.difference || 0;
                    const cloverDiff = selectedSessionData.metadata.virtualClover - (selectedSessionData.summary.paymentBreakdown?.CLOVER || 0);
                    const mpDiff = (selectedSessionData.metadata.virtualMP1 + selectedSessionData.metadata.virtualMP2) - (selectedSessionData.summary.paymentBreakdown?.MERCADOPAGO || 0);
                    const totalDiff = cashDiff + cloverDiff + mpDiff;
                    return (
                      <span className={`text-xl font-extrabold ${totalDiff === 0 ? 'text-emerald-650' : totalDiff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {totalDiff > 0 ? '+' : ''}{fmt(totalDiff)}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                <div className="p-3 bg-rose-50 border border-rose-150 rounded-xl mb-4 text-xs font-semibold text-rose-700">
                  El monto esperado en caja según el sistema es de <span className="font-extrabold">{fmt(closingSession.expectedAmount || 0)}</span>.
                </div>
                
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Monto físico contado ($)</label>
                <input 
                  type="number" 
                  value={closingAmount || ''} 
                  onChange={(e) => setClosingAmount(Number(e.target.value))} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-lg font-bold text-slate-800 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                  placeholder="Contá el efectivo en caja..." 
                  autoFocus 
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Observaciones / Notas de cierre</label>
                <textarea 
                  value={closingNotes} 
                  onChange={(e) => setClosingNotes(e.target.value)} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner h-20 resize-none" 
                  placeholder="Escribe alguna diferencia o comentario..." 
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={async () => {
                    if (!window.confirm("¿Estás seguro de que deseas cerrar la caja?\n\nRecordá verificar si ya te cobraste tu sueldo de hoy.")) {
                      return;
                    }
                    try {
                      await api.post(`/cash/${closingSession.id}/close`, { 
                        clientId: getClientId(),
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

      <AnimatePresence>
        {resolvingArqueo && (
          <motion.div
            key="resolving-arqueo-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setResolvingArqueo(null)}
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
                  <AlertCircle className="w-5 h-5 text-amber-500" /> Resolver Arqueo ({resolvingArqueo.terminalName})
                </h3>
                <button onClick={() => setResolvingArqueo(null)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X className="w-5 h-5" /></button>
              </div>

              <div>
                <p className="text-xs text-slate-500 font-semibold mb-2">Cajero: <span className="font-bold text-slate-700">{resolvingArqueo.user?.fullName}</span></p>
                <div className="p-3 bg-amber-50 border border-amber-150 rounded-xl mb-4 text-xs font-semibold text-amber-700">
                  Este turno se cerró sin completar el conteo de caja. El monto esperado según el sistema es de <span className="font-extrabold">{fmt(resolvingArqueo.closingAmountExpected || 0)}</span>.
                </div>

                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Monto físico contado ($)</label>
                <input
                  type="number"
                  value={arqueoAmount || ''}
                  onChange={(e) => setArqueoAmount(Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-lg font-bold text-slate-800 outline-none focus:bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-inner"
                  placeholder="Contá el efectivo en caja..."
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Observaciones / Notas de arqueo</label>
                <textarea
                  value={arqueoNotes}
                  onChange={(e) => setArqueoNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-inner h-20 resize-none"
                  placeholder="Ej: turno cerrado sin arqueo por corte de luz, se contó después..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={async () => {
                    try {
                      await api.post(`/cash/${resolvingArqueo.id}/arqueo`, {
                        closingAmountCounted: arqueoAmount,
                        closingNotes: arqueoNotes
                      });
                      toast.success(`Arqueo de ${resolvingArqueo.terminalName} completado`);
                      setResolvingArqueo(null);
                      loadPendingArqueosAll();
                      loadSessions();
                    } catch (err: any) {
                      toast.error(err.response?.data?.message || 'Error al completar el arqueo');
                    }
                  }}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" /> Confirmar Arqueo
                </button>
                <button onClick={() => setResolvingArqueo(null)} className="px-5 py-3.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
                  Cancelar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-rose-50 to-rose-100/50 border border-rose-100 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-rose-500 uppercase tracking-wider block mb-1">Efectivo en Caja en Vivo</span>
                    <span className="text-2xl font-black text-rose-700">{fmt(monitoringSession.expectedAmount)}</span>
                  </div>
                </div>

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

                <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-3">
                  <h4 className="text-xs font-bold text-slate-750 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                    <RefreshCw className="w-4 h-4 text-rose-500" /> Movimientos Manuales (Entradas/Salidas)
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

      {selectedSession && <XReportPrint session={selectedSession} />}
      <AnimatePresence>
        {zReportData && (
          <CierreDiaModal
            zReport={zReportData}
            isHistory={isHistoryZReport}
            onClose={() => {
              const wasHistory = isHistoryZReport;
              setZReportData(null);
              setIsHistoryZReport(false);
              if (!wasHistory) {
                useAuthStore.getState().logout();
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

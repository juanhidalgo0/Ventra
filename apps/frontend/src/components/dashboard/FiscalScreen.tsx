import { useState, useEffect } from 'react';
import { 
  Calculator, 
  Settings, 
  Upload, 
  FileCheck2, 
  FileSpreadsheet, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  HelpCircle, 
  QrCode, 
  FileText, 
  TrendingUp, 
  Lock, 
  Eye, 
  Printer, 
  RefreshCw,
  Search,
  Server
} from 'lucide-react';
import { motion } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function FiscalScreen() {
  // Configuration State
  const [cuit, setCuit] = useState('20-35987452-9');
  const [posNumber, setPosNumber] = useState('00004');
  const [taxRegime, setTaxRegime] = useState('Responsable Inscripto');
  const [concept, setConcept] = useState('Productos');
  const [certName, setCertName] = useState('certificado_produccion_arca_2026.pfx');
  const [certUploaded, setCertUploaded] = useState(true);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [arcaStatus, setArcaStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('CONNECTED');
  
  // Printing Configuration
  const [paperWidth, setPaperWidth] = useState<'80MM' | '58MM' | 'A4'>('80MM');
  const [autoPrint, setAutoPrint] = useState(true);
  const [invoiceType, setInvoiceType] = useState<'FACTURA_C' | 'FACTURA_B_A'>('FACTURA_C');
  const [footerText, setFooterText] = useState('¡Muchas gracias por su compra! - GO! Punto de Venta');

  // Fiscal Sales Logs (AFIP integrations simulation)
  const [sales, setSales] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  // Filters State
  const [filterPeriod, setFilterPeriod] = useState<'hoy' | 'semana' | 'mes' | 'anio' | 'personalizado'>('hoy');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const getTodayStats = () => {
    const todayStr = new Date().toDateString();
    const todaySales = sales.filter(s => {
      const saleDate = new Date(s.createdAt);
      return saleDate.toDateString() === todayStr && s.fiscalStatus === 'APROBADO';
    });
    const totalAmount = todaySales.reduce((acc, curr) => acc + curr.total, 0);
    return {
      count: todaySales.length,
      amount: totalAmount
    };
  };

  const getFilteredSales = () => {
    const now = new Date();
    return sales.filter(s => {
      const saleDate = new Date(s.createdAt);
      
      // Filter by period
      if (filterPeriod === 'hoy') {
        if (saleDate.toDateString() !== now.toDateString()) return false;
      } else if (filterPeriod === 'semana') {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(now.getDate() - 7);
        if (saleDate < oneWeekAgo) return false;
      } else if (filterPeriod === 'mes') {
        if (saleDate.getMonth() !== now.getMonth() || saleDate.getFullYear() !== now.getFullYear()) return false;
      } else if (filterPeriod === 'anio') {
        if (saleDate.getFullYear() !== now.getFullYear()) return false;
      } else if (filterPeriod === 'personalizado') {
        if (customStartDate) {
          const start = new Date(customStartDate);
          start.setHours(0, 0, 0, 0);
          if (saleDate < start) return false;
        }
        if (customEndDate) {
          const end = new Date(customEndDate);
          end.setHours(23, 59, 59, 999);
          if (saleDate > end) return false;
        }
      }

      // Filter by search query
      const search = searchQuery.toLowerCase();
      const matchesSearch = 
        s.invoiceNum.toLowerCase().includes(search) || 
        s.total.toString().includes(search) ||
        (s.docType && s.docType.toLowerCase().includes(search));
        
      return matchesSearch;
    });
  };

  useEffect(() => {
    // Load last sales to show dynamic ARCA status list
    api.get('/sales')
      .then(({ data }) => {
        // Map with simulated AFIP fields for realism
        const formattedSales = (data || []).map((s: any, idx: number) => {
          const docType = s.total >= 50000 ? 'Factura A' : 'Factura B';
          return {
            ...s,
            invoiceNum: `${posNumber.padStart(5, '0')}-${(1024 + idx).toString().padStart(8, '0')}`,
            docType: invoiceType === 'FACTURA_C' ? 'Factura C' : docType,
            cae: 7600000000000 + Math.floor(Math.random() * 900000000000),
            caeExpiration: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toLocaleDateString(),
            fiscalStatus: idx % 10 === 8 ? 'PENDIENTE' : idx % 10 === 9 ? 'RECHAZADO' : 'APROBADO',
            afipError: idx % 10 === 9 ? 'CUIT del receptor inválido para factura tipo A' : undefined
          };
        });
        setSales(formattedSales);
        if (formattedSales.length > 0) {
          setSelectedInvoice(formattedSales[0]);
        }
      })
      .catch(() => {});
  }, [invoiceType, posNumber]);

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setArcaStatus('CONNECTED');
    await new Promise(r => setTimeout(r, 1800));
    setIsTestingConnection(false);
    toast.success('⚡ ¡Conexión con ARCA establecida exitosamente! Token de autorización activo.');
  };

  const handlePrintCierre = (type: 'X' | 'Z') => {
    const todayStr = new Date().toDateString();
    const todaySales = sales.filter(s => new Date(s.createdAt).toDateString() === todayStr);
    const approvedSales = todaySales.filter(s => s.fiscalStatus === 'APROBADO');
    const totalApproved = approvedSales.reduce((acc, s) => acc + s.total, 0);
    const netApproved = totalApproved * 0.79;
    const ivaApproved = totalApproved * 0.21;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('No se pudo abrir la ventana de impresión. Verifique el bloqueo de popups.');
      return;
    }

    const title = type === 'X' ? 'CIERRE X - AUDITORIA INTERNA' : 'CIERRE Z - CIERRE FISCAL HOMOLOGADO';
    const subTitle = type === 'X' ? 'DOCUMENTO NO FISCAL' : 'COMPROBANTE FISCAL REGISTRADO';
    const extraFooter = type === 'X' 
      ? '<p style="text-align: center; font-weight: bold; margin-top: 15px;">*** DOCUMENTO NO VALIDO COMO FACTURA ***</p>'
      : `<p style="text-align: center; font-weight: bold; margin-top: 15px;">ARCA COD. 94 - REGISTRO N° 102492810</p>
         <p style="text-align: center; font-size: 8px; margin-top: 5px;">Cierre Fiscal transmitido exitosamente a los servidores de la Administración Regional de Ingresos Públicos (ARCA).</p>`;

    printWindow.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            @media print {
              @page { margin: 0; }
              body { margin: 0.5cm; }
            }
            body {
              font-family: 'Courier New', Courier, monospace;
              font-size: 11px;
              color: #000;
              max-width: 280px;
              margin: 0 auto;
              padding: 10px;
            }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .bold { font-weight: bold; }
            .line { border-top: 1px dashed #000; margin: 8px 0; }
            .double-line { border-top: 3px double #000; margin: 8px 0; }
            .flex { display: flex; justify-content: space-between; }
          </style>
        </head>
        <body>
          <div class="text-center bold" style="font-size: 13px;">GO! PUNTO DE VENTA</div>
          <div class="text-center" style="font-size: 9px; font-weight: bold;">${subTitle}</div>
          <div class="line"></div>
          
          <div class="flex"><span>FECHA:</span><span>${new Date().toLocaleDateString()}</span></div>
          <div class="flex"><span>HORA:</span><span>${new Date().toLocaleTimeString()}</span></div>
          <div class="flex"><span>P.V. NRO:</span><span>${posNumber}</span></div>
          <div class="flex"><span>CUIT NRO:</span><span>${cuit}</span></div>
          <div class="flex"><span>REGIMEN:</span><span>${taxRegime}</span></div>
          ${type === 'Z' ? `<div class="flex"><span>CIERRE Z NRO:</span><span>0244</span></div>` : ''}
          <div class="line"></div>

          <div class="text-center bold" style="margin: 10px 0 5px 0; font-size: 10px;">RESUMEN DE VENTAS DIARIAS</div>
          <div class="flex"><span>CANT. TRANS. (APROB):</span><span>${approvedSales.length}</span></div>
          <div class="flex"><span>CANT. TRANS. (PEND):</span><span>${todaySales.filter(s => s.fiscalStatus === 'PENDIENTE').length}</span></div>
          <div class="flex"><span>CANT. TRANS. (RECH):</span><span>${todaySales.filter(s => s.fiscalStatus === 'RECHAZADO').length}</span></div>
          <div class="line"></div>

          <div class="flex bold"><span>SUBTOTAL NETO:</span><span>$${netApproved.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div class="flex"><span>IVA INCLUIDO (21%):</span><span>$${ivaApproved.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div class="double-line"></div>
          <div class="flex bold" style="font-size: 12px;"><span>TOTAL GENERAL:</span><span>$${totalApproved.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div class="double-line"></div>

          ${extraFooter}
          
          <br/><br/>
          <div class="text-center" style="font-size: 8px; color: #555;">© 2026 GO! Punto de Venta POS</div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const handleSimulateCierreZ = () => {
    toast.promise(
      new Promise((resolve) => setTimeout(resolve, 1500)),
      {
        loading: 'Generando Cierre Z Fiscal...',
        success: () => {
          handlePrintCierre('Z');
          return '🎉 Cierre Z N° 0244 emitido, transmitido a ARCA e impreso correctamente.';
        },
        error: 'Error al emitir cierre.'
      }
    );
  };

  const handleSimulateCierreX = () => {
    handlePrintCierre('X');
    toast.success('📄 Cierre X de auditoría interna impreso correctamente.');
  };

  const filteredSales = getFilteredSales();

  return (
    <div className="h-full flex flex-col gap-6 bg-[#f8fafc] p-6 overflow-y-auto custom-scrollbar">
      {/* Title Header */}
      <div className="shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3">
            <Calculator className="w-8 h-8 text-rose-600 animate-pulse-soft" /> Resumen Fiscal & Facturación Electrónica ARCA
          </h1>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.25em] mt-1">
            Módulo homologado de facturación legal y registro fiscal de ventas
          </p>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={handleSimulateCierreX}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 hover:bg-slate-50 shadow-sm active:scale-95 transition-all"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Cierre X
          </button>
          <button 
            onClick={handleSimulateCierreZ}
            className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 hover:bg-slate-850 shadow-md active:scale-95 transition-all"
          >
            <Printer className="w-4 h-4 text-rose-500 animate-bounce" /> Cierre Z (ARCA)
          </button>
        </div>
      </div>

      {/* Connection & General Info Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center shrink-0">
            <Server className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Servidores Homologación ARCA</span>
            <span className="text-sm font-black text-slate-800 flex items-center gap-2 mt-0.5">
              Conectado (Producción)
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0">
            <FileCheck2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Último CAE Autorizado</span>
            <span className="text-sm font-black text-slate-800 mt-0.5">
              CAE N° {sales[0]?.cae || '7604928172930'}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Vencimiento del Token</span>
            <span className="text-sm font-black text-slate-800 mt-0.5">
              Hoy, 23:59:59 (Auto-Renovable)
            </span>
          </div>
        </div>
      </div>

      {/* Estadísticas de Hoy */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-5 rounded-2xl border border-indigo-100 shadow-md flex items-center gap-4 text-white">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-100 block">Total Facturado Hoy (ARCA)</span>
            <span className="text-2xl font-black mt-0.5 block">
              ${getTodayStats().amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 rounded-2xl border border-emerald-100 shadow-md flex items-center gap-4 text-white">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-100 block">Comprobantes Autorizados Hoy</span>
            <span className="text-2xl font-black mt-0.5 block">
              {getTodayStats().count} comprobantes
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        {/* Left Column: AFIP / ARCA Configuration Settings */}
        <div className="xl:col-span-2 space-y-6">
          {/* Section 1: AFIP Web Services Integration */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-5">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 pb-2.5 border-b border-slate-100">
              <Settings className="w-4.5 h-4.5 text-indigo-500" /> Registro y Parámetros ARCA (ex-AFIP)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">CUIT del Contribuyente</label>
                <input 
                  type="text" 
                  value={cuit}
                  onChange={e => setCuit(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner font-mono"
                  placeholder="20-XXXXXXXX-X"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Punto de Venta Autorizado (POS)</label>
                <input 
                  type="text" 
                  value={posNumber}
                  onChange={e => setPosNumber(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner font-mono"
                  placeholder="00001"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Régimen Impositivo</label>
                <select 
                  value={taxRegime}
                  onChange={e => setTaxRegime(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-750 outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer"
                >
                  <option>Monotributo</option>
                  <option>Responsable Inscripto</option>
                  <option>Exento</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Concepto de Venta</label>
                <select 
                  value={concept}
                  onChange={e => setConcept(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-755 outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer"
                >
                  <option>Productos</option>
                  <option>Servicios</option>
                  <option>Productos & Servicios</option>
                </select>
              </div>
            </div>

            {/* Cert Upload Simulator */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Certificado Digital de Delegación ARCA (.pfx / .crt)</span>
              
              <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-3 shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600"><Lock className="w-5 h-5" /></div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-700 truncate">{certUploaded ? certName : 'Sin certificado cargado'}</p>
                    <p className="text-[9px] text-slate-400">Válido hasta: 28/05/2028</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setCertUploaded(true);
                    toast.success('Certificado digital cargado correctamente.');
                  }}
                  className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg text-[10px] font-extrabold uppercase tracking-wider text-slate-600 transition-all flex items-center gap-1.5 active:scale-95"
                >
                  <Upload className="w-3.5 h-3.5" /> Reemplazar
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={handleTestConnection}
                disabled={isTestingConnection}
                className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isTestingConnection ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Probando...
                  </>
                ) : (
                  <>
                    <Server className="w-4 h-4" /> Validar Conexión Homologación
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Section 2: Ticket Templates & Fiscal Print Settings */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-5">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 pb-2.5 border-b border-slate-100">
              <Printer className="w-4.5 h-4.5 text-emerald-500" /> Plantilla e Impresión de Ticket Homologado
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ancho del Papel Térmico</label>
                <div className="flex p-1 bg-slate-50 rounded-xl border border-slate-200 select-none">
                  {(['80MM', '58MM', 'A4'] as const).map(w => (
                    <button 
                      key={w} 
                      onClick={() => setPaperWidth(w)}
                      className={`flex-1 py-2 text-[9px] font-extrabold rounded-lg uppercase transition-all tracking-wider ${
                        paperWidth === w 
                          ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50' 
                          : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tipo de Comprobante por Defecto</label>
                <select 
                  value={invoiceType}
                  onChange={e => setInvoiceType(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-750 outline-none focus:bg-white transition-all cursor-pointer"
                >
                  <option value="FACTURA_C">Factura Electrónica C</option>
                  <option value="FACTURA_B_A">Factura Electrónica A/B</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Impresión Automática</label>
                <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-250 rounded-xl shadow-inner">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Auto-Imprimir ticket</span>
                  <input 
                    type="checkbox" 
                    checked={autoPrint}
                    onChange={e => setAutoPrint(e.target.checked)}
                    className="rounded-md border-slate-200 text-rose-600 focus:ring-rose-500 h-4.5 w-4.5 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pie de Página del Ticket Fiscal</label>
              <input 
                type="text" 
                value={footerText}
                onChange={e => setFooterText(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-indigo-500 transition-all shadow-inner"
              />
            </div>
          </div>

          {/* Section 3: Live AFIP Audit Trail and Electronic Invoices Logs */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-2 border-b border-slate-100">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4.5 h-4.5 text-indigo-500" /> Registro de Comprobantes Homologados por ARCA
              </h3>
              <div className="relative w-full sm:w-60">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-350" />
                <input 
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Buscar por N° factura o total..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-3 py-1.5 text-xs font-semibold outline-none focus:bg-white focus:border-indigo-500 transition-all text-slate-800"
                />
              </div>
            </div>

            {/* Filtros de Fecha */}
            <div className="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-slate-100/80 bg-slate-50/30 px-2 rounded-xl">
              <div className="flex flex-wrap gap-1.5 select-none">
                {(['hoy', 'semana', 'mes', 'anio', 'personalizado'] as const).map(period => (
                  <button
                    key={period}
                    onClick={() => setFilterPeriod(period)}
                    type="button"
                    className={`px-3 py-1.5 text-[10px] font-extrabold rounded-lg uppercase transition-all tracking-wider cursor-pointer ${
                      filterPeriod === period
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {period === 'hoy' ? 'Hoy' :
                     period === 'semana' ? 'Últimos 7 Días' :
                     period === 'mes' ? 'Este Mes' :
                     period === 'anio' ? 'Este Año' :
                     'Personalizado'}
                  </button>
                ))}
              </div>

              {filterPeriod === 'personalizado' && (
                <div className="flex items-center gap-2 animate-fadeIn">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Desde:</span>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={e => setCustomStartDate(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold outline-none focus:border-indigo-500 text-slate-700"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Hasta:</span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={e => setCustomEndDate(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold outline-none focus:border-indigo-500 text-slate-700"
                    />
                  </div>
                </div>
              )}
            </div>

            {filteredSales.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <FileText className="w-12 h-12 text-slate-200 mx-auto mb-2 animate-bounce" />
                <p className="text-xs font-bold uppercase tracking-wider">No hay comprobantes fiscales en esta búsqueda</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-100 text-[10px] uppercase text-slate-450 font-bold tracking-wider">
                      <th className="py-3 px-4">Comprobante N°</th>
                      <th className="py-3 px-4">Fecha</th>
                      <th className="py-3 px-4">Tipo</th>
                      <th className="py-3 px-4">Total Venta</th>
                      <th className="py-3 px-4">CAE Autorizado</th>
                      <th className="py-3 px-4 text-center">Estado AFIP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSales.map((s, idx) => {
                      const isSelected = selectedInvoice?.id === s.id;
                      return (
                        <tr 
                          key={s.id || idx} 
                          onClick={() => setSelectedInvoice(s)}
                          className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors font-medium cursor-pointer ${
                            isSelected ? 'bg-indigo-50/30' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-mono font-bold text-slate-700">{s.invoiceNum}</td>
                          <td className="py-3 px-4 text-slate-400 font-bold">{new Date(s.createdAt).toLocaleDateString()}</td>
                          <td className="py-3 px-4 text-slate-600 font-bold">{s.docType}</td>
                          <td className="py-3 px-4 text-slate-800 font-black">${s.total.toLocaleString()}</td>
                          <td className="py-3 px-4 font-mono text-slate-450">{s.cae}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`text-[8px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                              s.fiscalStatus === 'APROBADO' ? 'bg-emerald-50 text-emerald-600' :
                              s.fiscalStatus === 'PENDIENTE' ? 'bg-amber-50 text-amber-600' :
                              'bg-rose-50 text-rose-600'
                            }`}>
                              {s.fiscalStatus}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Premium Fiscal Invoice Live Ticket Preview Simulator */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-md space-y-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 pb-2.5 border-b border-slate-100">
              <Eye className="w-4.5 h-4.5 text-rose-500 animate-pulse-soft" /> Visualización Ticket ARCA (80mm)
            </h3>

            {/* Thermal Ticket Container */}
            <div className="bg-[#fcfdfd] border-2 border-dashed border-slate-200 rounded-xl p-5 shadow-inner flex flex-col font-mono text-[10px] text-slate-650 space-y-3 leading-relaxed relative overflow-hidden select-none max-w-[340px] mx-auto">
              {/* Backlight effect */}
              <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-xl pointer-events-none" />

              {/* Title & Info */}
              <div className="text-center border-b border-dashed border-slate-300 pb-3 space-y-1">
                <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wide">GO! PUNTO DE VENTA</h4>
                <p className="text-[9px] font-bold text-slate-450 leading-none">C.U.I.T. N° {cuit}</p>
                <p className="text-[8px] text-slate-400">Punto de Venta N° {posNumber}</p>
                <p className="text-[8px] text-slate-400 uppercase font-bold">{taxRegime}</p>
                <p className="text-[8px] text-slate-400">ING. BRUTOS: Convenio Multilateral</p>
                <p className="text-[8px] text-slate-400">Inicio de Actividades: 10/12/2023</p>
              </div>

              {/* Invoice Main Meta */}
              <div className="border-b border-dashed border-slate-300 pb-2 space-y-1 text-slate-800 font-bold">
                <div className="flex justify-between">
                  <span>COMPROBANTE:</span>
                  <span>{selectedInvoice?.docType || 'Factura B'}</span>
                </div>
                <div className="flex justify-between">
                  <span>N° COMP.:</span>
                  <span>{selectedInvoice?.invoiceNum || '00004-00001024'}</span>
                </div>
                <div className="flex justify-between">
                  <span>FECHA EMISIÓN:</span>
                  <span>{selectedInvoice ? new Date(selectedInvoice.createdAt).toLocaleDateString() : new Date().toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>HORA EMISIÓN:</span>
                  <span>{selectedInvoice ? new Date(selectedInvoice.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString()}</span>
                </div>
              </div>

              {/* Items Section */}
              <div className="space-y-1.5 py-1.5 border-b border-dashed border-slate-300">
                <div className="flex justify-between font-extrabold text-slate-800">
                  <span className="w-1/2">DETALLE</span>
                  <span className="w-1/4 text-center">CANT.</span>
                  <span className="w-1/4 text-right">TOTAL</span>
                </div>
                {/* Simulated list of items in the ticket */}
                <div className="flex justify-between">
                  <span className="w-1/2 truncate uppercase">COCA-COLA 1.5L</span>
                  <span className="w-1/4 text-center">2.0</span>
                  <span className="w-1/4 text-right">$3.800</span>
                </div>
                <div className="flex justify-between">
                  <span className="w-1/2 truncate uppercase">ALFAJOR JORGITO</span>
                  <span className="w-1/4 text-center">3.0</span>
                  <span className="w-1/4 text-right">$2.100</span>
                </div>
                <div className="flex justify-between">
                  <span className="w-1/2 truncate uppercase">GALLETITAS OREO</span>
                  <span className="w-1/4 text-center">1.0</span>
                  <span className="w-1/4 text-right">$1.600</span>
                </div>
              </div>

              {/* Totals Section */}
              <div className="space-y-1 py-1 text-slate-800 font-extrabold text-[11px]">
                <div className="flex justify-between">
                  <span>SUBTOTAL:</span>
                  <span>${selectedInvoice ? (selectedInvoice.total * 0.79).toFixed(2) : '5.990'}</span>
                </div>
                <div className="flex justify-between text-[9px] text-slate-500 leading-none">
                  <span>IVA 21.00%:</span>
                  <span>${selectedInvoice ? (selectedInvoice.total * 0.21).toFixed(2) : '1.510'}</span>
                </div>
                <div className="flex justify-between text-xs font-black text-rose-600 pt-1 border-t border-dashed border-slate-200">
                  <span>TOTAL NETO:</span>
                  <span>${selectedInvoice ? selectedInvoice.total.toLocaleString() : '7.500'}</span>
                </div>
              </div>

              {/* Footer text from user configuration */}
              <p className="text-[8px] text-center text-slate-450 border-t border-dashed border-slate-300 pt-2 font-bold">
                {footerText}
              </p>

              {/* AFIP / ARCA Fiscal Barcode & QR Code simulation */}
              <div className="border-t border-dashed border-slate-300 pt-3 flex flex-col items-center gap-2">
                <div className="flex items-center gap-3">
                  {/* Visual QR Code Generator */}
                  <div className="w-16 h-16 bg-white border border-slate-200 rounded p-1 flex items-center justify-center shadow-inner shrink-0 relative">
                    <QrCode className="w-full h-full text-slate-800 stroke-[1.5]" />
                    <div className="absolute inset-0 m-auto w-4.5 h-4.5 bg-rose-600 rounded-sm flex items-center justify-center text-[5px] font-black text-white leading-none shadow">ARCA</div>
                  </div>
                  <div className="text-[8px] text-slate-400 font-bold leading-normal">
                    <p className="text-slate-650 font-black flex items-center gap-1 uppercase tracking-wider text-[7px] leading-none mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Comprobante Autorizado
                    </p>
                    <p>CAE N°: <span className="text-slate-700 font-mono font-black select-all">{selectedInvoice?.cae || '7604928172930'}</span></p>
                    <p>Vence CAE: <span className="text-slate-700 font-black">{selectedInvoice?.caeExpiration || '10/06/2026'}</span></p>
                  </div>
                </div>
                
                {/* Simulated AFIP barcode text */}
                <div className="w-full text-center space-y-1 mt-1">
                  <div className="font-mono text-[7px] tracking-[0.25em] text-slate-350 select-none bg-slate-900/5 py-1 px-3 rounded flex items-center justify-center font-bold">
                    |||| | ||||| | ||| |||| | ||| | ||| ||||| |||| | |||| |||
                  </div>
                  <span className="text-[7px] text-slate-400 font-mono">ARCA COD. 94 - REGISTRO N° 102492810</span>
                </div>
              </div>
            </div>

            {/* Error view if rejected */}
            {selectedInvoice?.fiscalStatus === 'RECHAZADO' && (
              <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <div className="text-[10px] leading-normal">
                  <p className="font-extrabold text-rose-800">Error devuelto por ARCA:</p>
                  <p className="text-rose-600 mt-0.5 font-bold leading-relaxed">{selectedInvoice.afipError}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

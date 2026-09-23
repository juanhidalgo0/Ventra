import { useState, useEffect, useRef } from 'react';
import { usePOSStore } from '../../stores/posStore';
import { motion } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { X, Banknote, CreditCard, Smartphone, Shuffle, Check, Printer, CornerDownLeft, QrCode, AlertCircle, AlertTriangle, HelpCircle , FileText } from 'lucide-react';
import InvoiceModal from './InvoiceModal';
import TicketReceipt from './TicketReceipt';
import { MangoIcon } from '../common/MangoLogo';
import { useAutoTour } from '../common/tour/GuidedTour';
import { useTourStore } from '../common/tour/tourStore';
import { lockShortcuts, isFunctionKey } from '../../utils/shortcutLock';
import { hasFeature } from '../../stores/businessStore';

// Native Web Audio API chime for sale completion (Zero external audio file dependencies)
function playSaleSuccessSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;
    // Pleasant 3-note harmonic arpeggio (B5 -> E6 -> B6) mimicking cash register bell
    const notes = [
      { freq: 987.77, start: 0, duration: 0.12 },
      { freq: 1318.51, start: 0.10, duration: 0.14 },
      { freq: 1975.53, start: 0.22, duration: 0.35 }
    ];

    notes.forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + start);

      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.18, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + duration);
    });

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1200);
  } catch (e) {
    // Audio autoplay restrictions or unsupported
  }
}

export default function PaymentModal({ total, sessionId, onClose, onSuccess, isDebtPayment, debtClient, onSurchargeChange }: { total: number; sessionId: string; onClose: () => void; onSuccess: () => void; isDebtPayment?: boolean; debtClient?: any; onSurchargeChange?: (surcharge: number) => void }) {
  const storeName = (localStorage.getItem('gd_store_name') || 'Ventra POS').toUpperCase();
  const { cart, getCartItemsWithDiscounts, getCheckoutPayload, products, setLastSale } = usePOSStore();
  useAutoTour('payment', !isDebtPayment);

  // Mientras se cobra, ningún atajo F del sistema responde (ni los del navegador,
  // como F5 que recargaría la página): solo se usa esta ventana.
  useEffect(() => {
    const release = lockShortcuts();
    const swallowFKeys = (e: KeyboardEvent) => {
      if (isFunctionKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', swallowFKeys, true);
    return () => {
      release();
      window.removeEventListener('keydown', swallowFKeys, true);
    };
  }, []);
  const posnets = (() => {
    const stored = localStorage.getItem('posnet_configs');
    if (stored) {
      try {
        return JSON.parse(stored) as { id: string; name: string }[];
      } catch {}
    }
    return [
      { id: 'CLOVER', name: 'Clover' },
      { id: 'MERCADOPAGO', name: 'MercadoPago' }
    ];
  })();

  const [paymentType, setPaymentType] = useState<string | null>(null);

  const [mixedMethod1, setMixedMethod1] = useState<string>('CASH');
  const [mixedMethod2, setMixedMethod2] = useState<string>(posnets[0]?.id || 'CLOVER');
  const [mixedAmount1, setMixedAmount1] = useState(0);
  const [mixedAmount2, setMixedAmount2] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [clientSearch, setClientSearch] = useState('');
  const [pickedUpBy, setPickedUpBy] = useState('');
  const [isAcopio, setIsAcopio] = useState(false);

   const [showSuccess, setShowSuccess] = useState(false);
   // Facturación electrónica: sólo se ofrece si el comercio la tiene activada
   const [fiscalEnabled, setFiscalEnabled] = useState(false);
   const [fiscalConfig, setFiscalConfig] = useState<any | null>(null);
   const [showInvoice, setShowInvoice] = useState(false);
   /** Comprobante ya emitido para esta venta: bloquea volver a facturar e imprime el CAE */
   const [invoice, setInvoice] = useState<any | null>(null);
   const [invoiceQr, setInvoiceQr] = useState<string | null>(null);
   const [showPreview, setShowPreview] = useState(true);
   const [createdSale, setCreatedSale] = useState<any>(null);

  const [surcharges, setSurcharges] = useState<any[]>([]);
  useEffect(() => {
    api.get('/surcharges').then(res => setSurcharges(res.data)).catch(() => {});
  }, []);

  const processingRef = useRef(false);

  const getSurchargeForCategory = (categoryId: string, method: string) => {
    if (!method || method === 'CASH' || method === 'DEBT') return 0;
    const match = surcharges.find(s => s.categoryId === categoryId && s.paymentMethods.includes(method));
    return match ? match.percentage : 0;
  };

  const getAdjustedTotalAndItems = () => {
    let totalSurcharge = 0;
    const surchargedProductsList: { name: string; originalPrice: number; newPrice: number; percentage: number }[] = [];
    
    const baseItems = getCheckoutPayload();
    
    const adjustedItems = baseItems.map(item => {
      const product = products?.find((p: any) => p.id === item.productId);
      const categoryId = item.categoryId || product?.categoryId;
      
      if (!categoryId || paymentType === 'DEBT' || paymentType === 'CASH' || !paymentType) {
        return { ...item };
      }
      
      let percentage = 0;
      if (paymentType === 'MIXED') {
        const p1 = getSurchargeForCategory(categoryId, mixedMethod1);
        const p2 = getSurchargeForCategory(categoryId, mixedMethod2);
        
        const totalPay = mixedAmount1 + mixedAmount2;
        if (totalPay > 0) {
          const weight1 = mixedAmount1 / totalPay;
          const weight2 = mixedAmount2 / totalPay;
          percentage = (p1 * weight1) + (p2 * weight2);
        } else {
          percentage = Math.max(p1, p2);
        }
      } else if (paymentType) {
        percentage = getSurchargeForCategory(categoryId, paymentType);
      }
      
      if (percentage > 0) {
        const originalPrice = item.price ?? (product ? product.salePrice : 0);
        // Round surcharge per unit to nearest integer peso to avoid fractional decimals
        const surchargePerUnit = Math.round(originalPrice * (percentage / 100));
        const newPrice = originalPrice + surchargePerUnit;
        
        totalSurcharge += surchargePerUnit * item.quantity;
        
        const productName = product ? product.name : (item.productId === 'VIRTUAL_LOAD_1' ? 'Carga Virtual 1' : item.productId === 'VIRTUAL_LOAD_2' ? 'Carga Virtual 2' : 'Producto');
        surchargedProductsList.push({
          name: productName,
          originalPrice,
          newPrice,
          percentage: Number(percentage.toFixed(1))
        });
        
        return {
          ...item,
          price: newPrice
        };
      }
      
      return { ...item };
    });
    
    const finalTotal = total + totalSurcharge;
    
    return {
      adjustedItems,
      finalTotal,
      totalSurcharge,
      surchargedProductsList
    };
  };

  const { adjustedItems, finalTotal, totalSurcharge, surchargedProductsList } = getAdjustedTotalAndItems();

  useEffect(() => {
    onSurchargeChange?.(totalSurcharge);
    return () => {
      onSurchargeChange?.(0);
    };
  }, [totalSurcharge, onSurchargeChange]);

  const disableChangeCalc = localStorage.getItem('pos_disable_change_calculator') === 'true';
  const perfMode = localStorage.getItem('performance_mode') === 'true';
  const MotionDiv = (perfMode ? 'div' : motion.div) as any;
  const [cashReceived, setCashReceived] = useState(0);

  useEffect(() => {
    if (disableChangeCalc) {
      setCashReceived(finalTotal);
    }
  }, [finalTotal, disableChangeCalc]);

  const change = paymentType === 'CASH' ? Math.max(0, cashReceived - finalTotal) : 0;
  const mixedTotal = mixedAmount1 + mixedAmount2;
  const mixedValid = Math.abs(mixedTotal - finalTotal) < 0.01 && mixedMethod1 !== mixedMethod2;

  const formatPrice = (p: number) => {
    const rounded = Math.round((Number(p) || 0) * 100) / 100;
    return new Intl.NumberFormat('es-AR', { 
      style: 'currency', 
      currency: 'ARS', 
      minimumFractionDigits: 0,
      maximumFractionDigits: rounded % 1 === 0 ? 0 : 2
    }).format(rounded);
  };

  // Smart Cash Bill suggestions & quick increments (ARS bills: $1.000, $2.000, $5.000, $10.000, $20.000)
  const smartCashOptions = (() => {
    if (finalTotal <= 0 || disableChangeCalc) return [];
    const options = new Set<number>();
    // Exact amount
    options.add(finalTotal);

    // Next round denominations
    const roundSteps = [500, 1000, 2000, 5000, 10000, 20000];
    for (const step of roundSteps) {
      if (finalTotal < step) {
        options.add(step);
      } else {
        const nextRound = Math.ceil(finalTotal / step) * step;
        if (nextRound > finalTotal) {
          options.add(nextRound);
        }
      }
    }

    // Filter and sort ascending (take top 4-5 smart targets)
    return Array.from(options).sort((a, b) => a - b).slice(0, 5);
  })();

  const quickIncrements = [1000, 2000, 5000, 10000, 20000];

  useEffect(() => { if (paymentType === 'MIXED') setMixedAmount2(Math.max(0, finalTotal - mixedAmount1)); }, [mixedAmount1, finalTotal, paymentType]);
  
  useEffect(() => {
    if (finalTotal < 0 && paymentType !== 'DEBT') {
      setPaymentType('DEBT');
    }
  }, [finalTotal, paymentType]);

  const input1Ref = useRef<HTMLInputElement>(null);
  const input2Ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if ((paymentType === 'DEBT' || finalTotal < 0) && !isDebtPayment) {
      api.get('/clients').then(res => setClients(res.data)).catch(() => {});
    }
  }, [paymentType, isDebtPayment, finalTotal]);

  // Main input keyboard shortcut listener (1-5 for payment types, Enter to confirm)
  useEffect(() => {
    if (isProcessing || showSuccess) return;
    let lastKeyTime = 0;
    let lastFastBurstTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const timeDiff = now - lastKeyTime;
      lastKeyTime = now;

      // 1. Detect rapid hardware barcode scanner bursts (<55ms between keys)
      if (timeDiff <= 55) {
        lastFastBurstTime = now;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // If a fast scanner burst was detected recently (<150ms ago), ignore the trailing Enter or chars from barcode
      if (now - lastFastBurstTime < 150) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const activeElement = document.activeElement;
      const isInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
      
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Method switching with keys '1'..'5'
      // Allowed when NOT in a text input (e.g. client search or cash amount typing),
      // OR when in cash mode with change calculator disabled
      const isClientSearchInput = activeElement?.getAttribute('placeholder')?.includes('cliente') || activeElement === input1Ref.current || activeElement === input2Ref.current;

      if (!isInput || (disableChangeCalc && paymentType === 'CASH') || !isClientSearchInput) {
        if (['1', '2', '3', '4', '5'].includes(e.key) && (!isInput || disableChangeCalc || paymentType !== 'CASH')) {
          e.preventDefault();
          if (e.key === '1') setPaymentType('CASH');
          posnets.forEach((p, idx) => {
            if (e.key === String(idx + 2)) setPaymentType(p.id);
          });
          if (e.key === String(posnets.length + 2)) setPaymentType('MIXED');
          if (e.key === '5' && !isDebtPayment) setPaymentType('DEBT');
          return;
        }
      }

      // Enter key to confirm sale
      if (e.key === 'Enter') {
        if (!paymentType) return;

        if (paymentType === 'CASH') {
          if (disableChangeCalc || cashReceived >= finalTotal) {
            e.preventDefault();
            handleConfirm();
          }
        } else if (paymentType === 'MIXED') {
          if (mixedValid) {
            e.preventDefault();
            handleConfirm();
          }
        } else if (paymentType === 'DEBT') {
          if (selectedClientId || isDebtPayment) {
            e.preventDefault();
            handleConfirm();
          }
        } else {
          // Posnets (Clover, MercadoPago, etc.)
          e.preventDefault();
          handleConfirm();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isProcessing, showSuccess, paymentType, selectedClientId, onClose, isDebtPayment, disableChangeCalc, cashReceived, finalTotal, mixedValid, posnets]);

  // ¿El comercio factura? Se consulta una vez al abrir el cobro, no en cada venta
  useEffect(() => {
    let vivo = true;
    api.get('/fiscal/config')
      .then(({ data }) => { if (vivo) { setFiscalEnabled(Boolean(data?.enabled)); setFiscalConfig(data); } })
      .catch(() => { /* sin módulo fiscal configurado: el POS sigue como siempre */ });
    return () => { vivo = false; };
  }, []);

  // Success screen keyboard shortcut listener (F9 to print, Enter for new sale)
  useEffect(() => {
    if (!showSuccess) return;
    const handleSuccessKeys = (e: KeyboardEvent) => {
      if (e.key === 'F9') {
        e.preventDefault();
        handlePrint();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleNewSale();
      } else if ((e.key === 'f' || e.key === 'F') && fiscalEnabled && !showInvoice && !invoice) {
        e.preventDefault();
        setShowInvoice(true);
      }
    };
    window.addEventListener('keydown', handleSuccessKeys);
    return () => window.removeEventListener('keydown', handleSuccessKeys);
  }, [showSuccess, createdSale, fiscalEnabled, showInvoice, invoice]);

  /**
   * Manda el ticket a la impresora y avisa qué pasó.
   *
   * El navegador no permite saber si hay una impresora conectada ni si el papel salió:
   * lo único observable es si el diálogo de impresión llegó a abrirse (`beforeprint`) y
   * cuándo se cerró (`afterprint`). Eso es lo que se informa, sin prometer de más.
   */
  const handlePrint = () => {
    const aviso = toast.loading('Enviando el ticket a la impresora...');
    let abrio = false;

    const alAbrir = () => { abrio = true; };
    const alCerrar = () => {
      limpiar();
      toast.success('Ticket enviado a la impresora', { id: aviso, duration: 3000 });
    };
    const limpiar = () => {
      window.removeEventListener('beforeprint', alAbrir);
      window.removeEventListener('afterprint', alCerrar);
      clearTimeout(vigilante);
    };

    // Si el diálogo nunca aparece, casi siempre es que el equipo no tiene ninguna impresora
    const vigilante = setTimeout(() => {
      if (!abrio) {
        limpiar();
        toast.error('No se abrió la impresión. Revisá que haya una impresora instalada en la PC.', {
          id: aviso,
          duration: 7000,
        });
      }
    }, 3000);

    window.addEventListener('beforeprint', alAbrir);
    window.addEventListener('afterprint', alCerrar);

    // Un respiro para que el aviso se dibuje: window.print() congela la pantalla mientras está abierto
    setTimeout(() => {
      try {
        window.print();
      } catch (err) {
        limpiar();
        toast.error('No se pudo imprimir el ticket', { id: aviso });
      }
    }, 60);
  };

  const handleNewSale = () => {
    onSuccess();
  };

  const handleConfirm = async () => {
    if (processingRef.current) return;
    if (paymentType === 'DEBT' && !selectedClientId && !isDebtPayment) {
      toast.error('Seleccioná un cliente para la cuenta corriente');
      return;
    }
    if (isAcopio && !selectedClientId && !isDebtPayment) {
      toast.error('Para venta a acopio debés seleccionar un cliente');
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);
    try {
      const payments = paymentType === 'MIXED'
        ? [
            { method: mixedMethod1, amount: mixedAmount1 },
            { method: mixedMethod2, amount: mixedAmount2 }
          ].filter(p => p.amount > 0)
        : [{ method: paymentType, amount: finalTotal }];
      let saleData: any = null;
      if (isDebtPayment && debtClient) {
        const finalDesc = `Pago a Cuenta Corriente (Método: ${paymentType})`;

        // 1. Register movement in customer current account (reduces debt)
        await api.post(`/clients/${debtClient.id}/movement`, {
          type: 'PAYMENT',
          amount: finalTotal,
          description: finalDesc
        });

        // 2. Register a real sale in the database to record expected money (cash/posnet/mixed) and generate a ticket
        const response = await api.post('/sales', {
          sessionId,
          clientId: debtClient.id,
          payments,
          items: [
            {
              productId: 'PAGO_CTA_CTE',
              productName: `PAGO CUENTA CORRIENTE - ${debtClient.name}`,
              quantity: 1,
              price: finalTotal,
              total: finalTotal
            }
          ],
          notes: finalDesc
        });
        
        saleData = response.data;
        setCreatedSale(saleData);
      } else {
        const { appliedPromosInfo } = getCartItemsWithDiscounts();
        const response = await api.post('/sales', { 
          sessionId, 
          items: adjustedItems, 
          payments,
          clientId: (paymentType === 'DEBT' || isAcopio) ? selectedClientId : undefined,
          pickedUpBy: (paymentType === 'DEBT' || isAcopio) && pickedUpBy ? pickedUpBy.trim() : undefined,
          isAcopio: isAcopio ? true : undefined,
          appliedPromotions: appliedPromosInfo
        });
        saleData = response.data;
        setCreatedSale(saleData);
      }

      // El ticket no lleva QR ni CAE: la facturación electrónica con ARCA todavía no
      // está implementada, así que imprimirlos daría por autorizado un comprobante
      // que ARCA nunca autorizó. Se agregan recién cuando exista la integración real.

      // Play sale confirmation chime
      playSaleSuccessSound();

      // Store as last completed sale for instant 1-click reprinting
      if (saleData) {
        setLastSale(saleData);
      }

      setShowSuccess(true);
    } catch (err: any) {
      if (!err.response && !isDebtPayment) {
        // Network connection error: Queue sale offline
        const { appliedPromosInfo } = getCartItemsWithDiscounts();
        const payments = paymentType === 'MIXED'
          ? [
              { method: mixedMethod1, amount: mixedAmount1 },
              { method: mixedMethod2, amount: mixedAmount2 }
            ].filter(p => p.amount > 0)
          : [{ method: paymentType, amount: finalTotal }];

        const offlinePayload = {
          sessionId,
          items: adjustedItems,
          payments,
          clientId: paymentType === 'DEBT' ? selectedClientId : undefined,
          pickedUpBy: paymentType === 'DEBT' && pickedUpBy ? pickedUpBy.trim() : undefined,
          appliedPromotions: appliedPromosInfo,
          queuedAt: new Date().toISOString()
        };
        const offlineQueue = JSON.parse(localStorage.getItem('pos_offline_sales_queue') || '[]');
        offlineQueue.push(offlinePayload);
        localStorage.setItem('pos_offline_sales_queue', JSON.stringify(offlineQueue));

        const dummySale = {
          id: 'offline_' + Date.now(),
          saleNumber: 'OFF-' + String(Date.now()).slice(-4),
          total: finalTotal,
          createdAt: new Date().toISOString(),
          paymentMethodSummary: paymentType,
          items: adjustedItems.map(ai => ({
            productName: (ai as any).productName || products?.find((p: any) => p.id === ai.productId)?.name || 'Producto',
            quantity: ai.quantity,
            unitPrice: ai.price,
            total: (ai.price || 0) * ai.quantity
          })),
          isOffline: true
        };
        setCreatedSale(dummySale);
        playSaleSuccessSound();
        setLastSale(dummySale);
        setShowSuccess(true);
        toast('⚡ Venta guardada en MODO OFFLINE (se sincronizará automáticamente)', { icon: '⚡' });
        return;
      }
      toast.error(err.response?.data?.message || 'Error al procesar la venta');
    } finally { 
      setIsProcessing(false); 
      processingRef.current = false;
    }
  };

  const mainMethods = [
    { key: 'CASH', label: 'Efectivo', icon: Banknote, color: '#10b981', num: '1' },
    ...posnets.map((p, idx) => {
      const isMP = p.id === 'MERCADOPAGO' || p.name.toLowerCase().includes('mercadopago');
      return {
        key: p.id,
        label: p.name,
        icon: isMP ? Smartphone : CreditCard,
        color: '#0f766e',
        num: String(idx + 2)
      };
    }),
    { key: 'MIXED', label: 'Mixto', icon: Shuffle, color: '#64748b', num: String(posnets.length + 2) },
  ];

  const filteredClients = clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()));

  // Render Success State Screen
  if (showSuccess && createdSale) {
    const saleDate = new Date(createdSale.createdAt).toLocaleString('es-AR');
    return (
      <>
        <MotionDiv 
          {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <MotionDiv 
            {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.95, opacity: 0 } })} 
            className="card w-full max-w-xl p-8 text-center bg-white dark:bg-slate-900 shadow-2xl relative overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800"
          >
            <style>{`
              @media print {
                @page {
                  size: 80mm 297mm;
                  margin: 0 !important;
                }
                * {
                  transform: none !important;
                  animation: none !important;
                }
                html, body, #root {
                  margin: 0 !important;
                  padding: 0 !important;
                  background: #fff !important;
                  width: 80mm !important;
                }
                body * {
                  visibility: hidden !important;
                }
                #printable-receipt, #printable-receipt * {
                  visibility: visible !important;
                }
                #printable-receipt {
                  display: block !important;
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 80mm !important;
                  max-width: 80mm !important;
                  font-family: 'Courier New', Courier, monospace !important;
                  font-size: 8.5pt !important;
                  line-height: 1.4 !important;
                  color: #000 !important;
                  background: #fff !important;
                  padding: 4mm 4mm 12mm 4mm !important;
                  margin: 0 !important;
                  box-sizing: border-box !important;
                }
              }
            `}</style>

          <div className="absolute top-0 left-0 w-full h-2.5 bg-gradient-to-r from-emerald-400 to-teal-500" />
          
          <div className="flex justify-center mb-6">
            <MotionDiv 
              {...(perfMode ? {} : { initial: { scale: 0 }, animate: { scale: [0, 1.2, 1] }, transition: { duration: 0.5 } })} 
              className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border-4 border-emerald-100 dark:border-emerald-800 flex items-center justify-center text-emerald-500 shadow-lg shadow-emerald-50 dark:shadow-none"
            >
              <Check className="w-10 h-10 stroke-[4]" />
            </MotionDiv>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">¡Venta Registrada!</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider mb-4">Ticket N° #{createdSale.saleNumber.toString().padStart(6, '0')}</p>

          {createdSale.isOffline && (
            <div className="mb-4 py-2 px-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-2xl text-amber-800 dark:text-amber-300 text-xs font-bold max-w-sm mx-auto flex items-center justify-center gap-2">
              <span>⚡ Modo Offline: se sincronizará automáticamente</span>
            </div>
          )}

          {/* Change Display - Only shown if change calculator is enabled AND change > 0 */}
          {paymentType === 'CASH' && !disableChangeCalc && change > 0 && (
            <div className="mb-6 p-5 rounded-3xl bg-emerald-50/50 dark:bg-emerald-900/20 border border-emerald-100/50 dark:border-emerald-800/50 max-w-sm mx-auto shadow-sm">
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest block mb-1">Vuelto a entregar</span>
              <span className="text-4xl font-bold text-emerald-600 dark:text-emerald-500 tracking-tight">{formatPrice(change)}</span>
              <div className="flex justify-between items-center mt-3 pt-3 border-t border-emerald-100/50 dark:border-emerald-800/50 text-[10px] text-slate-600 dark:text-slate-400 font-bold uppercase">
                <span>Cobrado: {formatPrice(cashReceived)}</span>
                <span>Total: {formatPrice(finalTotal)}</span>
              </div>
            </div>
          )}

          {/* Normal Confirmation display for other methods or when change calc is disabled / change is 0 */}
          {(paymentType !== 'CASH' || disableChangeCalc || change <= 0) && (
            <div className="mb-6 p-5 rounded-3xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 max-w-sm mx-auto text-left space-y-2">
              <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300">
                <span>Método de cobro</span>
                <span className="text-rose-600 dark:text-rose-400 uppercase font-bold tracking-wider">{paymentType === 'CASH' ? 'Efectivo' : paymentType}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300">
                <span>Total facturado</span>
                <span className="text-slate-800 dark:text-slate-100 font-bold">{formatPrice(finalTotal)}</span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className={`grid ${fiscalEnabled ? 'grid-cols-3 max-w-lg' : 'grid-cols-2 max-w-sm'} gap-3 mx-auto`}>
            {fiscalEnabled && (
              invoice ? (
                // Ya facturada: el comprobante es uno solo, así que se muestra en vez de ofrecer otro
                <div className="flex flex-col items-center justify-center gap-1 p-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/30">
                  <Check className="w-5 h-5 stroke-[3] text-emerald-600" />
                  <span className="text-[10px] uppercase tracking-widest text-emerald-800 dark:text-emerald-300 font-bold text-center leading-tight">
                    {(invoice.type || '').replace('FACTURA_', 'Factura ')}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {String(invoice.pointOfSale ?? 0).padStart(4, '0')}-{String(invoice.number ?? 0).padStart(8, '0')}
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => setShowInvoice(true)}
                  className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl border-2 border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/50 transition-all font-bold hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-sm"
                >
                  <FileText className="w-6 h-6 stroke-[2.5]" />
                  <span className="text-[10px] uppercase tracking-widest text-teal-900 dark:text-teal-200 font-bold">Facturar</span>
                  <span className="text-[8px] font-bold text-teal-500 dark:text-teal-300 opacity-80 uppercase tracking-wider bg-white dark:bg-teal-950 border border-teal-100 dark:border-teal-800 px-2 py-0.5 rounded-md mt-1 shadow-sm">[F]</span>
                </button>
              )
            )}
            <button onClick={handlePrint} className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl border-2 border-rose-600 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-all font-bold hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-sm">
              <Printer className="w-6 h-6 stroke-[2.5]" />
              <span className="text-[10px] uppercase tracking-widest text-rose-900 dark:text-rose-200 font-bold">Imprimir Ticket</span>
              <span className="text-[8px] font-bold text-rose-400 dark:text-rose-300 opacity-80 uppercase tracking-wider bg-white dark:bg-rose-950 border border-rose-100 dark:border-rose-800 px-2 py-0.5 rounded-md mt-1 shadow-sm">[F9]</span>
            </button>

            <button onClick={handleNewSale} className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl border-2 border-emerald-600 bg-emerald-500 text-white hover:bg-emerald-600 transition-all font-bold hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-lg shadow-emerald-200">
              <CornerDownLeft className="w-6 h-6 stroke-[3]" />
              <span className="text-[10px] uppercase tracking-widest text-white font-bold">Nueva Venta</span>
              <span className="text-[8px] font-bold text-emerald-100 bg-emerald-600 border border-emerald-500 px-2 py-0.5 rounded-md mt-1 shadow-sm">[ENTER]</span>
            </button>
          </div>

          {/* Lo mismo que sale en papel, para revisarlo sin gastar un ticket */}
          <div className="mt-6 max-w-[300px] mx-auto text-left">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[9.5px] font-bold uppercase tracking-widest text-slate-400">Vista previa del ticket</span>
              <button
                onClick={() => setShowPreview((v) => !v)}
                className="text-[9.5px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {showPreview ? 'Ocultar' : 'Ver'}
              </button>
            </div>
            {showPreview && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white p-3 max-h-72 overflow-y-auto custom-scrollbar shadow-inner">
                <TicketReceipt
                  createdSale={createdSale}
                  storeName={storeName}
                  invoice={invoice}
                  invoiceQr={invoiceQr}
                  pickedUpBy={pickedUpBy}
                  formatPrice={formatPrice}
                />
              </div>
            )}
          </div>
          </MotionDiv>
        </MotionDiv>

        {showInvoice && createdSale && (
          <InvoiceModal
            saleId={createdSale.id}
            saleNumber={createdSale.saleNumber}
            total={finalTotal}
            cliente={createdSale.client}
            onClose={() => setShowInvoice(false)}
            onEmitted={(comprobante, qrDataUrl) => {
              setInvoice(comprobante);
              setInvoiceQr(qrDataUrl);
              // El comprobante tiene que salir impreso: se manda a la impresora apenas llega el CAE
              setTimeout(() => handlePrint(), 400);
            }}
          />
        )}

        <div id="printable-receipt" style={{ display: 'none' }}>
          <TicketReceipt
            createdSale={createdSale}
            storeName={storeName}
            invoice={invoice}
            invoiceQr={invoiceQr}
            pickedUpBy={pickedUpBy}
            formatPrice={formatPrice}
          />
        </div>
      </>
    );
  }

  return (
    <MotionDiv 
      {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <MotionDiv
        {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.95, opacity: 0 } })}
        onClick={(e: any) => e.stopPropagation()}
        className="card bg-white dark:bg-slate-900 w-full max-w-xl p-4 md:p-5 h-[85vh] sm:h-auto max-h-[90vh] sm:max-h-[95vh] flex flex-col shadow-xl rounded-2xl border border-slate-200 dark:border-slate-800 outline-none"
        tabIndex={-1}
        ref={(el: any) => {
          if (el && !isProcessing && !showSuccess && paymentType !== 'CASH' && paymentType !== 'MIXED' && paymentType !== 'DEBT') {
            el.focus();
          }
        }}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <MangoIcon className="w-6 h-6" />
            <h2 className="text-lg font-bold text-gray-800 dark:text-slate-100">Confirmar Pago</h2>
          </div>
          <div className="flex items-center gap-1">
          <button
            onClick={() => useTourStore.getState().start('payment')}
            title="Ver recorrido de la ventana de cobro"
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-rose-600 transition-colors"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
          </div>
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-3 pb-1">
          <div data-tour="pay-total" className="text-center py-3.5 px-4 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 text-white dark:from-slate-950 dark:to-black border border-slate-800 shadow-inner shrink-0">
            <p className="text-[10px] font-semibold text-slate-400 mb-1 uppercase tracking-[0.2em]">Total a Cobrar</p>
            <p className="text-3xl sm:text-4xl font-black text-white tracking-tight font-mono">{formatPrice(finalTotal)}</p>
          </div>

          <div className="space-y-3">
            {finalTotal >= 0 ? (
              <>
                <div data-tour="pay-metodos" className="grid grid-cols-4 gap-2.5">
                  {mainMethods.map((pm) => {
                    const isSelected = paymentType === pm.key;
                    return (
                      <button 
                        key={pm.key} 
                        onClick={() => setPaymentType(pm.key)}
                        className={`relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border-2 transition-all duration-150 cursor-pointer select-none group active:scale-[0.98] ${
                          isSelected 
                            ? 'shadow-lg ring-2 ring-offset-1 dark:ring-offset-slate-900 font-extrabold' 
                            : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-xs'
                        }`}
                        style={isSelected ? { borderColor: pm.color, backgroundColor: `${pm.color}15`, color: pm.color } : {}}>
                        
                        {/* 3D Keycap Badge */}
                        <span className={`absolute top-2 right-2 min-w-[22px] h-5.5 px-1.5 flex items-center justify-center rounded-md text-[11px] font-mono font-black transition-all ${
                          isSelected
                            ? 'bg-teal-700 text-white dark:bg-teal-600 dark:text-white shadow-[0_2px_0_0_rgba(0,0,0,0.3)]'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200 border border-slate-300/80 dark:border-slate-600 shadow-[0_2px_0_0_rgba(0,0,0,0.12)] group-hover:border-slate-400'
                        }`}>
                          {pm.num}
                        </span>

                        <pm.icon className={`w-6 h-6 mt-1 transition-transform group-hover:scale-110 ${isSelected ? '' : 'text-slate-500 dark:text-slate-400'}`} style={isSelected ? { color: pm.color } : {}} />
                        <span className="text-[10.5px] font-black text-center leading-tight uppercase tracking-wider">{pm.label}</span>
                      </button>
                    );
                  })}
                </div>

                {!isDebtPayment && (
                  <button 
                    onClick={() => setPaymentType('DEBT')}
                    className={`relative w-full flex items-center justify-center gap-2.5 p-3 rounded-2xl border-2 transition-all duration-150 cursor-pointer select-none group active:scale-[0.98] ${
                      paymentType === 'DEBT' 
                        ? 'shadow-lg border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-2 ring-amber-400 ring-offset-1 dark:ring-offset-slate-900 font-extrabold' 
                        : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 hover:border-amber-300 dark:hover:border-amber-800/50 hover:shadow-xs'
                    }`}>
                    <CreditCard className={`w-4.5 h-4.5 transition-transform group-hover:scale-110 ${paymentType === 'DEBT' ? 'text-amber-500' : 'text-amber-500/80'}`} />
                    <span className="text-[11px] font-black uppercase tracking-[0.12em]">Cuenta Corriente (Cliente)</span>
                    <span className={`absolute top-2.5 right-3 min-w-[24px] h-5.5 px-1.5 flex items-center justify-center rounded-md text-[11px] font-mono font-black transition-all ${
                      paymentType === 'DEBT'
                        ? 'bg-amber-600 text-white shadow-[0_2px_0_0_rgba(0,0,0,0.3)]'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200 border border-slate-300/80 dark:border-slate-600 shadow-[0_2px_0_0_rgba(0,0,0,0.12)]'
                    }`}>
                      5
                    </span>
                  </button>
                )}

                {/* Venta a Acopio (Retiro Posterior / Obra) - Solo Ferretería */}
                {!isDebtPayment && hasFeature('acopio') && (
                  <div data-tour="pay-acopio" className="p-3 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 rounded-2xl flex items-center justify-between gap-3 transition-all">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">📦</span>
                      <div>
                        <p className="text-xs font-black text-rose-950 dark:text-rose-200">Venta a Acopio (Retiro en Obra / Posterior)</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">Retiene los materiales para emitir remitos de entrega parciales</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input 
                        type="checkbox" 
                        checked={isAcopio} 
                        onChange={(e) => setIsAcopio(e.target.checked)} 
                        className="sr-only peer"
                      />
                      <div className="w-10 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
                    </label>
                  </div>
                )}
              </>
            ) : (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 text-rose-850 dark:text-rose-350 rounded-xl text-xs font-semibold space-y-1.5">
                <p className="font-bold flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-rose-500" /> 
                  Saldo a favor del cliente: {formatPrice(Math.abs(finalTotal))}
                </p>
                <p className="text-[11px]">No se permite entregar dinero en efectivo. El saldo restante será acreditado en la cuenta corriente del cliente seleccionado.</p>
              </div>
            )}
          </div>

          {/* Payment Fields - Always rendered but only active based on paymentType */}
          <div data-tour="pay-detalle" className="space-y-3">
            {paymentType === 'CASH' && (
              <div className="animate-in slide-in-from-top-2 duration-200">
                {!disableChangeCalc ? (
                  <>
                    <div className="flex items-center justify-between mb-1 ml-0.5">
                      <label className="block text-[9px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Monto recibido</label>
                      <button 
                        type="button" 
                        onClick={() => setCashReceived(finalTotal)}
                        className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        Pago exacto ({formatPrice(finalTotal)})
                      </button>
                    </div>

                    <input 
                      type="number" 
                      value={cashReceived || ''} 
                      onChange={(e) => setCashReceived(Number(e.target.value))} 
                      onKeyDown={(e) => { 
                        if (e.key === 'Enter') { 
                          if (cashReceived >= finalTotal) {
                            e.preventDefault();
                            handleConfirm();
                          }
                        } 
                      }}
                      className="input-field text-2xl font-bold text-center py-3 h-14 bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" 
                      autoFocus 
                      placeholder="0" 
                    />

                    {/* Quick Smart Cash Suggestions & Increments */}
                    <div className="mt-2 space-y-1.5">
                      {smartCashOptions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 justify-center">
                          {smartCashOptions.map((amount) => (
                            <button
                              key={`smart_${amount}`}
                              type="button"
                              onClick={() => setCashReceived(amount)}
                              className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-xs border ${
                                cashReceived === amount
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-500/20'
                                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                              }`}
                            >
                              {amount === finalTotal ? `Exacto ${formatPrice(amount)}` : formatPrice(amount)}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-1 justify-center pt-0.5">
                        {quickIncrements.map((inc) => (
                          <button
                            key={`inc_${inc}`}
                            type="button"
                            onClick={() => setCashReceived((prev) => (Number(prev) || 0) + inc)}
                            className="px-2 py-0.5 rounded-xl text-[10.5px] font-semibold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 transition-all active:scale-95 cursor-pointer"
                          >
                            +${inc.toLocaleString('es-AR')}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setCashReceived(0)}
                          className="px-2 py-0.5 rounded-xl text-[10.5px] font-semibold bg-slate-100 hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 text-slate-500 transition-all active:scale-95 cursor-pointer"
                        >
                          Limpiar
                        </button>
                      </div>
                    </div>

                    <p className="text-[9px] text-slate-500 dark:text-slate-400 text-center mt-2 font-semibold uppercase tracking-tight">Presioná <span className="font-black text-slate-800 dark:text-slate-200">[ENTER]</span> para confirmar la venta</p>
                    {cashReceived >= finalTotal && (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 mt-2.5">
                        <p className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Vuelto a entregar</p>
                        <p className="text-3xl font-black text-emerald-600 dark:text-emerald-500">{formatPrice(change)}</p>
                      </motion.div>
                    )}
                  </>
                ) : (
                  <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border-2 border-emerald-300 dark:border-emerald-800/80 rounded-2xl text-center shadow-xs">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 text-[10.5px] font-black uppercase tracking-wider mb-2">
                      <Banknote className="w-4 h-4 stroke-[2.5]" />
                      <span>Cobro Rápido en Efectivo</span>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 font-semibold mb-1">
                      Total exacto a ingresar a caja:
                    </div>
                    <div className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight">
                      {formatPrice(finalTotal)}
                    </div>
                    <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 text-xs font-extrabold shadow-xs">
                      <span>Presioná</span>
                      <kbd className="px-2 py-0.5 rounded bg-slate-950 text-white dark:bg-white dark:text-slate-950 font-mono font-black text-[11px] shadow-[0_1.5px_0_0_rgba(0,0,0,0.3)]">
                        ENTER ↵
                      </kbd>
                      <span>para registrar cobro</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(paymentType === 'DEBT' || isAcopio) && (() => {
              const selectedClient = clients.find(c => c.id === selectedClientId);
              const isOverLimit = selectedClient && selectedClient.creditLimit && (selectedClient.balance + finalTotal) > selectedClient.creditLimit;
              const authList = selectedClient?.authorizedPickups 
                ? selectedClient.authorizedPickups.split(',').map((p: string) => p.trim()).filter(Boolean)
                : [];

              return (
                <div className="animate-in slide-in-from-top-2 duration-200">
                  <div className={`p-5 rounded-2xl border space-y-4 ${
                    isAcopio && paymentType !== 'DEBT'
                      ? 'bg-rose-50/80 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/50'
                      : 'bg-teal-50 dark:bg-teal-900/10 border-teal-100 dark:border-teal-800/50'
                  }`}>
                    <span className={`text-[10px] font-bold uppercase tracking-widest block ${
                      isAcopio && paymentType !== 'DEBT' ? 'text-rose-600 dark:text-rose-400' : 'text-teal-600 dark:text-teal-400'
                    }`}>
                      {isAcopio && paymentType !== 'DEBT' ? 'Asociar Cliente al Acopio de Materiales' : 'Seleccionar Cliente'}
                    </span>
                    <input type="text" value={clientSearch} onChange={e => setClientSearch(e.target.value)} className="input-field py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white border-slate-300 dark:border-slate-600" placeholder="Buscar cliente por nombre o DNI..." autoFocus={paymentType === 'DEBT'} />
                    <div className="max-h-[160px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      {filteredClients.map(client => (
                        <button key={client.id} onClick={() => { setSelectedClientId(client.id); setPickedUpBy(client.name); }} className={`w-full text-left p-3 rounded-xl text-sm transition-all shadow-sm ${selectedClientId === client.id ? 'bg-teal-600 text-white font-bold' : 'bg-white dark:bg-slate-800 text-slate-650 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:border-teal-300 dark:hover:border-teal-700'}`}>
                          <div className="flex justify-between items-center">
                            <span className="font-bold">{client.name}</span>
                            <span className="text-[10px] opacity-80">Deuda: {formatPrice(client.balance)}</span>
                          </div>
                        </button>
                      ))}
                      {filteredClients.length === 0 && <p className="text-xs text-slate-600 dark:text-slate-400 text-center py-4">No se encontraron clientes</p>}
                    </div>

                    {selectedClient && (
                      <div className="pt-3 border-t border-teal-200 dark:border-teal-800 space-y-2.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-600 dark:text-slate-300 font-semibold">Cliente seleccionado:</span>
                          <span className="font-black text-slate-900 dark:text-white">{selectedClient.name}</span>
                        </div>
                        {selectedClient.creditLimit && (
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-600 dark:text-slate-300 font-semibold">Límite de Crédito:</span>
                            <span className="font-bold text-rose-600 dark:text-rose-400">{formatPrice(selectedClient.creditLimit)}</span>
                          </div>
                        )}
                        {isOverLimit && (
                          <div className="p-2.5 bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-bold rounded-xl">
                            ⚠️ Atención: La compra superará el límite de crédito ({formatPrice(selectedClient.balance + finalTotal)} / {formatPrice(selectedClient.creditLimit)}).
                          </div>
                        )}

                        <div className="space-y-1.5 pt-1">
                          <label className="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                            ¿Quién retira los materiales?
                          </label>
                          <div className="flex flex-wrap gap-1.5 mb-1">
                            <button
                              type="button"
                              onClick={() => setPickedUpBy(selectedClient.name)}
                              className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all ${
                                pickedUpBy === selectedClient.name
                                  ? 'bg-teal-700 border-teal-700 text-white shadow-xs'
                                  : 'bg-white dark:bg-slate-800 border-slate-300 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              Titular
                            </button>
                            {authList.map((person: string, idx: number) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setPickedUpBy(person)}
                                className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all ${
                                  pickedUpBy === person
                                    ? 'bg-teal-700 border-teal-700 text-white shadow-xs'
                                    : 'bg-white dark:bg-slate-800 border-slate-300 text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {person}
                              </button>
                            ))}
                          </div>
                          <input
                            type="text"
                            placeholder="Nombre de quien retira para firma de ticket..."
                            value={pickedUpBy}
                            onChange={e => setPickedUpBy(e.target.value)}
                            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-teal-600"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {paymentType === 'MIXED' && (
              <div className="animate-in slide-in-from-top-2 duration-200 space-y-3">
                <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest text-center">Dividí el pago en dos partes</p>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 space-y-3">
                    <span className="text-[9px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Primer Pago</span>
                    <div className="flex gap-1">
                      {['CASH', ...posnets.map(p => p.id)].map((mt) => (
                        <button key={mt} onClick={() => setMixedMethod1(mt)} className={`flex-1 py-1.5 rounded-xl text-[8px] font-bold uppercase transition-all ${mixedMethod1 === mt ? 'bg-rose-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600'}`}>
                          {mt === 'CASH' ? 'Efect.' : (posnets.find(p => p.id === mt)?.name || mt)}
                        </button>
                      ))}
                    </div>
                    <input 
                      ref={input1Ref}
                      type="number" 
                      value={mixedAmount1 || ''} 
                      onChange={(e) => setMixedAmount1(Number(e.target.value))} 
                      onKeyDown={(e) => { if (e.key === 'Enter') input2Ref.current?.focus(); }}
                      className="input-field text-lg font-bold bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-600" 
                      placeholder="0.00" 
                      autoFocus 
                    />
                  </div>

                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 space-y-3">
                    <span className="text-[9px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Segundo Pago</span>
                    <div className="flex gap-1">
                      {['CASH', ...posnets.map(p => p.id)].map((mt) => (
                        <button key={mt} onClick={() => setMixedMethod2(mt)} className={`flex-1 py-1.5 rounded-xl text-[8px] font-bold uppercase transition-all ${mixedMethod2 === mt ? 'bg-rose-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600'}`}>
                          {mt === 'CASH' ? 'Efect.' : (posnets.find(p => p.id === mt)?.name || mt)}
                        </button>
                      ))}
                    </div>
                    <input 
                      ref={input2Ref}
                      type="number" 
                      value={mixedAmount2 || ''} 
                      onChange={(e) => setMixedAmount2(Number(e.target.value))} 
                      onKeyDown={(e) => { 
                        if (e.key === 'Enter' && mixedValid) { 
                          e.preventDefault(); 
                          handleConfirm(); 
                        } 
                      }}
                      className="input-field text-lg font-bold bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-600" 
                      placeholder="0.00" 
                    />
                  </div>
                </div>

                <div className={`text-center py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest ${mixedMethod1 === mixedMethod2 ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400' : mixedValid ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'}`}>
                  {mixedMethod1 === mixedMethod2 ? '⚠️ Métodos duplicados' : mixedValid ? `✅ Total Completo` : `⚠️ Faltan ${formatPrice(finalTotal - mixedTotal)}`}
                </div>
              </div>
            )}
          </div>

          {totalSurcharge > 0 && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/25 border-2 border-amber-300 dark:border-amber-800/80 text-amber-950 dark:text-amber-100 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-2xs">
                  <AlertTriangle className="w-4 h-4 stroke-[2.5]" /> Recargo por Método de Pago
                </span>
                <span className="text-xs font-bold text-amber-800 dark:text-amber-300">
                  {surchargedProductsList.length} {surchargedProductsList.length === 1 ? 'producto afectado' : 'productos afectados'}
                </span>
              </div>
              <div className="space-y-1.5 pt-0.5">
                {surchargedProductsList.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs sm:text-sm bg-white/90 dark:bg-slate-900/80 px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-800/60 shadow-2xs">
                    <span className="font-bold text-slate-800 dark:text-slate-100 truncate mr-2">{item.name}</span>
                    <div className="flex items-center gap-2 shrink-0 font-mono">
                      <span className="line-through text-slate-400 text-xs">{formatPrice(item.originalPrice)}</span>
                      <span className="font-black text-rose-600 dark:text-rose-400 text-xs sm:text-sm">{formatPrice(item.newPrice)}</span>
                      <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">+{item.percentage}%</span>
                    </div>
                  </div>
                ))}
                <div className="border-t border-amber-200 dark:border-amber-900/80 pt-2.5 flex items-center justify-between font-extrabold text-xs sm:text-sm text-amber-950 dark:text-amber-100">
                  <span className="uppercase tracking-wider">Total Recargo Aplicado:</span>
                  <span className="text-base font-black text-amber-600 dark:text-amber-400 font-mono">+{formatPrice(totalSurcharge)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fixed Modal Footer */}
        <div className="shrink-0 pt-3 border-t border-slate-200 dark:border-slate-750">
          <button data-tour="pay-finalizar" onClick={handleConfirm}
            disabled={isProcessing || !paymentType || (paymentType === 'CASH' && !disableChangeCalc && cashReceived < finalTotal) || (paymentType === 'MIXED' && !mixedValid) || (paymentType === 'DEBT' && !selectedClientId && !isDebtPayment)}
            className="w-full btn-success py-3.5 px-4 text-base flex items-center justify-center gap-2.5 disabled:opacity-30 disabled:grayscale shadow-lg shadow-emerald-600/20 cursor-pointer transition-all active:scale-[0.98] rounded-2xl" id="confirm-payment-btn">
            {isProcessing ? (
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                <span className="font-extrabold uppercase tracking-wider text-sm">Procesando Venta...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 w-full">
                <Check className="w-5 h-5 stroke-[3]" />
                <span className="font-black uppercase tracking-wider text-sm sm:text-base">FINALIZAR VENTA</span>
                <span className="bg-black/25 dark:bg-white/25 text-white px-2 py-0.5 rounded-xl text-xs font-black tracking-widest border border-white/30 shadow-xs ml-1">
                  [ENTER]
                </span>
              </div>
            )}
          </button>
        </div>
      </MotionDiv>
    </MotionDiv>
  );
}

import { useState, useEffect, useRef } from 'react';
import { usePOSStore } from '../../stores/posStore';
import { motion } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { X, Banknote, CreditCard, Smartphone, Shuffle, Check, Printer, CornerDownLeft, QrCode } from 'lucide-react';
import QRCode from 'qrcode';

export default function PaymentModal({ total, sessionId, onClose, onSuccess }: { total: number; sessionId: string; onClose: () => void; onSuccess: () => void }) {
  const storeName = (localStorage.getItem('gd_store_name') || 'GO! Punto de Venta').toUpperCase();
  const { cart, getCartItemsWithDiscounts, getCheckoutPayload } = usePOSStore();
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
  const [cashReceived, setCashReceived] = useState(0);
  const [mixedMethod1, setMixedMethod1] = useState<string>('CASH');
  const [mixedMethod2, setMixedMethod2] = useState<string>(posnets[0]?.id || 'CLOVER');
  const [mixedAmount1, setMixedAmount1] = useState(0);
  const [mixedAmount2, setMixedAmount2] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [clientSearch, setClientSearch] = useState('');

   const [showSuccess, setShowSuccess] = useState(false);
   const [createdSale, setCreatedSale] = useState<any>(null);
   const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

  const change = paymentType === 'CASH' ? Math.max(0, cashReceived - total) : 0;
  const mixedTotal = mixedAmount1 + mixedAmount2;
  const mixedValid = Math.abs(mixedTotal - total) < 0.01 && mixedMethod1 !== mixedMethod2;

  const formatPrice = (p: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(p);

  useEffect(() => { if (paymentType === 'MIXED') setMixedAmount2(Math.max(0, total - mixedAmount1)); }, [mixedAmount1, total, paymentType]);
  
  const input1Ref = useRef<HTMLInputElement>(null);
  const input2Ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paymentType === 'DEBT') {
      api.get('/clients').then(res => setClients(res.data)).catch(() => {});
    }
  }, [paymentType]);

  // Main input keyboard shortcut listener (1-5 for payment types)
  useEffect(() => {
    if (isProcessing || showSuccess) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
      
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (!isInput) {
        if (['1', '2', '3', '4', '5'].includes(e.key)) {
          if (paymentType === null) {
            if (e.key === '1') setPaymentType('CASH');
            posnets.forEach((p, idx) => {
              if (e.key === String(idx + 2)) setPaymentType(p.id);
            });
            if (e.key === String(posnets.length + 2)) setPaymentType('MIXED');
            if (e.key === '5') setPaymentType('DEBT');
          }
        } else if (e.key === 'Enter') {
          // If a payment type is already chosen (except CASH and MIXED which require custom input focus first, or DEBT without client selected), let Enter confirm!
          if (paymentType && paymentType !== 'CASH' && paymentType !== 'MIXED') {
            if (paymentType === 'DEBT' && !selectedClientId) return;
            e.preventDefault();
            handleConfirm();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProcessing, showSuccess, paymentType, selectedClientId, onClose]);

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
      }
    };
    window.addEventListener('keydown', handleSuccessKeys);
    return () => window.removeEventListener('keydown', handleSuccessKeys);
  }, [showSuccess, createdSale]);

  const handlePrint = () => {
    window.print();
  };

  const handleNewSale = () => {
    onSuccess();
  };

  const handleConfirm = async () => {
    if (paymentType === 'DEBT' && !selectedClientId) {
      toast.error('Seleccioná un cliente para la cuenta corriente');
      return;
    }

    setIsProcessing(true);
    try {
      const payments = paymentType === 'MIXED'
        ? [{ method: mixedMethod1, amount: mixedAmount1 }, { method: mixedMethod2, amount: mixedAmount2 }]
        : [{ method: paymentType as string, amount: total }];
      
      const { appliedPromosInfo } = getCartItemsWithDiscounts();
      const response = await api.post('/sales', { 
        sessionId, 
        items: getCheckoutPayload(), 
        payments,
        clientId: paymentType === 'DEBT' ? selectedClientId : undefined,
        appliedPromotions: appliedPromosInfo
      });
      setCreatedSale(response.data);
      
      // Generate offline QR code dynamically
      try {
        const qrData = `https://www.afip.gob.ar/fe/qr/?cuit=20359874529&tipoComprobante=11&puntoVenta=4&numeroComprobante=${response.data.saleNumber}&importe=${response.data.total}&cae=8372432392218`;
        const dataUrl = await QRCode.toDataURL(qrData, { margin: 1, width: 200 });
        setQrCodeUrl(dataUrl);
      } catch (qrErr) {
        console.error('Failed to generate local QR code:', qrErr);
      }

      setShowSuccess(true);
      toast.success('✅ Venta registrada exitosamente');
    } catch (err: any) { 
      toast.error(err.response?.data?.message || 'Error al procesar la venta'); 
    } finally { 
      setIsProcessing(false); 
    }
  };

  const mainMethods = [
    { key: 'CASH', label: 'Efectivo', icon: Banknote, color: '#10b981', num: '1' },
    ...posnets.map((p, idx) => ({
      key: p.id,
      label: p.name,
      icon: CreditCard,
      color: idx % 2 === 0 ? '#f59e0b' : '#3b82f6',
      num: String(idx + 2)
    })),
    { key: 'MIXED', label: 'Mixto', icon: Shuffle, color: '#8b5cf6', num: String(posnets.length + 2) },
  ];

  const filteredClients = clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()));

  // Render Success State Screen
  if (showSuccess && createdSale) {
    const saleDate = new Date(createdSale.createdAt).toLocaleString('es-AR');
    const qrData = `https://www.afip.gob.ar/fe/qr/?cuit=20359874529&tipoComprobante=11&puntoVenta=4&numeroComprobante=${createdSale.saleNumber}&importe=${createdSale.total}&cae=8372432392218`;
    return (
      <>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="card w-full max-w-xl p-8 text-center bg-white shadow-2xl relative overflow-hidden rounded-3xl border border-slate-100">
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
            <motion.div initial={{ scale: 0 }} animate={{ scale: [0, 1.2, 1] }} transition={{ duration: 0.5 }} className="w-20 h-20 rounded-full bg-emerald-50 border-4 border-emerald-100 flex items-center justify-center text-emerald-500 shadow-lg shadow-emerald-50">
              <Check className="w-10 h-10 stroke-[4]" />
            </motion.div>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 mb-2">¡Venta Registrada!</h2>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-6">Ticket N° #{createdSale.saleNumber.toString().padStart(6, '0')}</p>

          {/* Change Display */}
          {paymentType === 'CASH' && (
            <div className="mb-6 p-5 rounded-3xl bg-emerald-50/50 border border-emerald-100/50 max-w-sm mx-auto shadow-sm">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest block mb-1">Vuelto a entregar</span>
              <span className="text-4xl font-bold text-emerald-600 tracking-tight">{formatPrice(change)}</span>
              <div className="flex justify-between items-center mt-3 pt-3 border-t border-emerald-100/50 text-[10px] text-slate-400 font-bold uppercase">
                <span>Cobrado: {formatPrice(cashReceived)}</span>
                <span>Total: {formatPrice(total)}</span>
              </div>
            </div>
          )}

          {/* Normal Confirmation display for other methods */}
          {paymentType !== 'CASH' && (
            <div className="mb-6 p-5 rounded-3xl bg-slate-50 border border-slate-100 max-w-sm mx-auto text-left space-y-2">
              <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                <span>Método de cobro</span>
                <span className="text-indigo-600 uppercase font-bold tracking-wider">{paymentType}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                <span>Total facturado</span>
                <span className="text-slate-800 font-bold">{formatPrice(total)}</span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto mb-2">
            <button onClick={handlePrint} className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl border-2 border-indigo-600 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-50 transition-all font-bold hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-md shadow-indigo-100">
              <Printer className="w-6 h-6 stroke-[2.5]" />
              <span className="text-[10px] uppercase tracking-widest">Imprimir Ticket</span>
              <span className="text-[8px] font-bold text-indigo-400 opacity-80 uppercase tracking-wider bg-white border border-indigo-100 px-2 py-0.5 rounded-md mt-1 shadow-sm">[F9]</span>
            </button>

            <button onClick={handleNewSale} className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl border-2 border-emerald-600 bg-emerald-500 text-white hover:bg-emerald-600 transition-all font-bold hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-lg shadow-emerald-200">
              <CornerDownLeft className="w-6 h-6 stroke-[3]" />
              <span className="text-[10px] uppercase tracking-widest text-white font-bold">Nueva Venta</span>
              <span className="text-[8px] font-bold text-emerald-100 bg-emerald-600 border border-emerald-500 px-2 py-0.5 rounded-md mt-1 shadow-sm">[ENTER]</span>
            </button>
          </div>
          </motion.div>
        </motion.div>

        <div id="printable-receipt" style={{ display: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', fontFamily: 'monospace', fontSize: '8pt', color: '#000', gap: '8px' }}>
            
            {/* Title & Info */}
            <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <h4 style={{ margin: 0, fontSize: '10.5pt', fontWeight: 'bold', textTransform: 'uppercase' }}>{storeName}</h4>
              <p style={{ margin: 0, fontWeight: 'bold' }}>C.U.I.T. N° 20-35987452-9</p>
              <p style={{ margin: 0 }}>Punto de Venta N° 00004</p>
              <p style={{ margin: 0, fontWeight: 'bold', textTransform: 'uppercase' }}>RESPONSABLE INSCRIPTO</p>
              <p style={{ margin: 0 }}>ING. BRUTOS: Convenio Multilateral</p>
              <p style={{ margin: 0 }}>Inicio de Actividades: 10/12/2023</p>
            </div>

            {/* Invoice Main Meta */}
            <div style={{ borderBottom: '1px dashed #000', paddingBottom: '6px', display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 'bold' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>COMPROBANTE:</span>
                <span>Factura C</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>N° COMP.:</span>
                <span>{'00004-' + createdSale.saleNumber.toString().padStart(8, '0')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>FECHA EMISIÓN:</span>
                <span>{new Date(createdSale.createdAt).toLocaleDateString('es-AR')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>HORA EMISIÓN:</span>
                <span>{new Date(createdSale.createdAt).toLocaleTimeString('es-AR')}</span>
              </div>
            </div>

            {/* Items Section */}
            <div style={{ borderBottom: '1px dashed #000', paddingBottom: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                <span style={{ width: '55%' }}>DETALLE</span>
                <span style={{ width: '20%', textAlign: 'center' }}>CANT.</span>
                <span style={{ width: '25%', textAlign: 'right' }}>TOTAL</span>
              </div>
              {createdSale.items.map((item: any, idx: number) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ width: '55%', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.productName}
                  </span>
                  <span style={{ width: '20%', textAlign: 'center' }}>{item.quantity.toFixed(1)}</span>
                  <span style={{ width: '25%', textAlign: 'right' }}>{formatPrice(item.total)}</span>
                </div>
              ))}
            </div>

            {/* Totals Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 'bold', fontSize: '9pt' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>SUBTOTAL:</span>
                <span>{formatPrice(createdSale.total * 0.79)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7.5pt', color: '#555' }}>
                <span>IVA 21.00%:</span>
                <span>{formatPrice(createdSale.total * 0.21)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5pt', fontWeight: '900', borderTop: '1px dashed #000', paddingTop: '4px', color: '#e11d48' }}>
                <span>TOTAL NETO:</span>
                <span>{formatPrice(createdSale.total)}</span>
              </div>
            </div>

            {/* Footer Text */}
            <p style={{ margin: 0, fontSize: '7pt', textAlign: 'center', borderTop: '1px dashed #000', paddingTop: '8px', fontWeight: 'bold' }}>
              ¡Muchas gracias por su compra! - {storeName}
            </p>

            {/* AFIP / ARCA Fiscal Barcode & QR Code simulation */}
            <div style={{ borderTop: '1px dashed #000', paddingTop: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                {/* QR Code Container */}
                <div style={{ width: '50px', height: '50px', border: '1px solid #ccc', borderRadius: '4px', padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', flexShrink: 0, backgroundColor: '#fff' }}>
                  {qrCodeUrl ? (
                    <img 
                      src={qrCodeUrl} 
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                      alt="ARCA QR" 
                    />
                  ) : (
                    <div style={{ fontSize: '6pt', color: '#999' }}>QR Error</div>
                  )}
                </div>
                <div style={{ fontSize: '7pt', color: '#444', fontWeight: 'bold', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <p style={{ color: '#000', fontWeight: '900', display: 'flex', alignItems: 'center', gap: '3px', textTransform: 'uppercase', margin: 0 }}>
                    <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                    Comprobante Autorizado
                  </p>
                  <p style={{ margin: 0 }}>CAE N°: <span style={{ color: '#000', fontWeight: '900' }}>8372432392218</span></p>
                  <p style={{ margin: 0 }}>Vence CAE: <span style={{ color: '#000', fontWeight: '900' }}>14/06/2026</span></p>
                </div>
              </div>

              {/* Simulated AFIP barcode text */}
              <div style={{ width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                <div style={{ fontFamily: 'monospace', fontSize: '7pt', letterSpacing: '0.2em', color: '#000', backgroundColor: '#f0f0f0', padding: '4px', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                  |||| | ||||| | ||| |||| | ||| | ||| ||||| |||| | |||| |||
                </div>
                <span style={{ fontSize: '6pt', color: '#666', fontFamily: 'monospace' }}>ARCA COD. 94 - REGISTRO N° 102492810</span>
              </div>
            </div>

          </div>
        </div>
      </>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.95, opacity: 0 }} 
        onClick={(e) => e.stopPropagation()} 
        className="card bg-white w-full max-w-2xl p-6 max-h-[95vh] overflow-y-auto shadow-xl rounded-2xl border border-slate-200"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-800">Confirmar Pago</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-slate-100 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="text-center mb-5 py-4 rounded-xl bg-slate-50 border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-widest">Total a cobrar</p>
          <p className="text-4xl font-extrabold text-slate-900 tracking-tight">{formatPrice(total)}</p>
        </div>

        <div className="space-y-4 mb-5">
          <div className="grid grid-cols-4 gap-2">
            {mainMethods.map((pm) => (
              <button key={pm.key} onClick={() => setPaymentType(pm.key)}
                className={`relative flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all duration-200 cursor-pointer select-none hover:scale-[1.02] active:scale-[0.98] ${paymentType === pm.key ? 'shadow-lg' : 'border-slate-100 bg-white text-slate-400 hover:border-slate-200'}`}
                style={paymentType === pm.key ? { borderColor: pm.color, backgroundColor: `${pm.color}05`, color: pm.color } : {}}>
                <span className="absolute top-1.5 right-1.5 text-[8px] font-bold opacity-40 bg-slate-200 text-slate-600 w-4 h-4 flex items-center justify-center rounded-md">{pm.num}</span>
                <pm.icon className="w-6 h-6" style={paymentType === pm.key ? { color: pm.color } : {}} />
                <span className="text-[10px] font-bold text-center leading-tight uppercase tracking-widest">{pm.label}</span>
              </button>
            ))}
          </div>

          <button onClick={() => setPaymentType('DEBT')}
            className={`relative w-full flex items-center justify-center gap-3 p-3.5 rounded-2xl border-2 transition-all duration-200 cursor-pointer select-none ${paymentType === 'DEBT' ? 'shadow-lg border-pink-500 bg-pink-50 text-pink-600' : 'border-slate-100 bg-white text-slate-400 hover:border-pink-100'}`}>
            <span className="absolute top-2.5 right-4 text-[9px] font-bold opacity-40 bg-pink-200 text-pink-700 px-2 py-0.5 rounded-md">5</span>
            <Shuffle className="w-5 h-5" />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">Cuenta Corriente (Cliente)</span>
          </button>
        </div>

        {/* Payment Fields - Always rendered but only active based on paymentType */}
        <div className="space-y-4 mb-6">
          {paymentType === 'CASH' && (
            <div className="animate-in slide-in-from-top-2 duration-200">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Monto recibido</label>
              <input 
                type="number" 
                value={cashReceived || ''} 
                onChange={(e) => setCashReceived(Number(e.target.value))} 
                onKeyDown={(e) => { if (e.key === 'Enter' && cashReceived >= total) handleConfirm(); }}
                className="input-field text-3xl font-bold text-center py-5 h-20" 
                autoFocus 
                placeholder="0" 
              />
              <p className="text-[9px] text-slate-400 text-center mt-2 font-bold uppercase tracking-tight">Presioná ENTER para confirmar la venta</p>
              {cashReceived >= total && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4 rounded-2xl bg-emerald-50 border border-emerald-100 mt-4">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Vuelto a entregar</p>
                  <p className="text-4xl font-bold text-emerald-600">{formatPrice(change)}</p>
                </motion.div>
              )}
              <div className="grid grid-cols-4 gap-2 mt-4">
                {[1000, 2000, 5000, 10000].map((amount) => (
                  <button key={amount} onClick={() => setCashReceived(amount)} className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 transition-all active:scale-95">{formatPrice(amount)}</button>
                ))}
              </div>
            </div>
          )}

          {paymentType === 'DEBT' && (
            <div className="animate-in slide-in-from-top-2 duration-200">
              <div className="p-5 rounded-2xl bg-pink-50 border border-pink-100 space-y-4">
                <span className="text-[10px] font-bold text-pink-500 uppercase tracking-widest block">Seleccionar Cliente</span>
                <input type="text" value={clientSearch} onChange={e => setClientSearch(e.target.value)} className="input-field py-3 text-sm" placeholder="Buscar cliente por nombre o DNI..." />
                <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {filteredClients.map(client => (
                    <button key={client.id} onClick={() => setSelectedClientId(client.id)} className={`w-full text-left p-4 rounded-xl text-sm transition-all shadow-sm ${selectedClientId === client.id ? 'bg-pink-500 text-white font-bold' : 'bg-white text-slate-600 border border-slate-100 hover:border-pink-300'}`}>
                      <div className="flex justify-between items-center">
                        <span className="font-bold">{client.name}</span>
                        <span className="text-[10px] opacity-70">DNI: {client.dni || 'N/A'}</span>
                      </div>
                    </button>
                  ))}
                  {filteredClients.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No se encontraron clientes</p>}
                </div>
              </div>
            </div>
          )}

          {paymentType === 'MIXED' && (
            <div className="animate-in slide-in-from-top-2 duration-200 space-y-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Dividí el pago en dos partes</p>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-3">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Primer Pago</span>
                  <div className="flex gap-1">
                    {['CASH', ...posnets.map(p => p.id)].map((mt) => (
                      <button key={mt} onClick={() => setMixedMethod1(mt)} className={`flex-1 py-1.5 rounded-lg text-[8px] font-bold uppercase transition-all ${mixedMethod1 === mt ? 'bg-indigo-600 text-white' : 'bg-white text-slate-400 border border-slate-100'}`}>
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
                    className="input-field text-lg font-bold" 
                    placeholder="0.00" 
                    autoFocus 
                  />
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-3">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Segundo Pago</span>
                  <div className="flex gap-1">
                    {['CASH', ...posnets.map(p => p.id)].map((mt) => (
                      <button key={mt} onClick={() => setMixedMethod2(mt)} className={`flex-1 py-1.5 rounded-lg text-[8px] font-bold uppercase transition-all ${mixedMethod2 === mt ? 'bg-indigo-600 text-white' : 'bg-white text-slate-400 border border-slate-100'}`}>
                        {mt === 'CASH' ? 'Efect.' : (posnets.find(p => p.id === mt)?.name || mt)}
                      </button>
                    ))}
                  </div>
                  <input 
                    ref={input2Ref}
                    type="number" 
                    value={mixedAmount2 || ''} 
                    onChange={(e) => setMixedAmount2(Number(e.target.value))} 
                    onKeyDown={(e) => { if (e.key === 'Enter' && mixedValid) handleConfirm(); }}
                    className="input-field text-lg font-bold" 
                    placeholder="0.00" 
                  />
                </div>
              </div>

              <div className={`text-center py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest ${mixedMethod1 === mixedMethod2 ? 'bg-rose-50 text-rose-500' : mixedValid ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                {mixedMethod1 === mixedMethod2 ? '⚠️ Métodos duplicados' : mixedValid ? `✅ Total Completo` : `⚠️ Faltan ${formatPrice(total - mixedTotal)}`}
              </div>
            </div>
          )}
        </div>

        <button onClick={handleConfirm}
          disabled={isProcessing || (paymentType === 'CASH' && cashReceived < total) || (paymentType === 'MIXED' && !mixedValid) || (paymentType === 'DEBT' && !selectedClientId)}
          className="w-full btn-success py-4 text-base flex items-center justify-center gap-3 disabled:opacity-30 disabled:grayscale shadow-md cursor-pointer transition-all active:scale-[0.97]" id="confirm-payment-btn">
          {isProcessing ? <span className="animate-spin text-xl">⏳</span> : <Check className="w-5 h-5 stroke-[3]" />}
          <span className="font-bold uppercase tracking-wider">{isProcessing ? 'Procesando...' : 'Finalizar Venta'}</span>
        </button>
      </motion.div>
    </motion.div>
  );
}

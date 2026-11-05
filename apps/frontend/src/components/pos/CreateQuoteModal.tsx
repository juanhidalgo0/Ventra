import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, X, Check, Share2, Printer, Calendar, User, Phone, CheckCircle2 } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { CartItem } from '../../stores/posStore';
import { QuotePreview, quoteWhatsappUrl, storeNameOfQuote } from './QuoteDocument';
import { applyManualSurcharge, parseSurchargeValue, serviceItems, servicesTotal, type ServiceCharge } from '../mobile/checkout';

interface CreateQuoteModalProps {
  cart: CartItem[];
  total: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateQuoteModal({ cart, total, onClose, onSuccess }: CreateQuoteModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [validityDays, setValidityDays] = useState(7);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdQuote, setCreatedQuote] = useState<any>(null);
  const [showSheet, setShowSheet] = useState(false);

  const storeName = storeNameOfQuote();

  // Precio de evento: recargo $ o % repartido en los productos (el cliente ve cada uno a su precio)
  const [surchargeMode, setSurchargeMode] = useState<'FIXED' | 'PCT'>('PCT');
  const [surchargeValue, setSurchargeValue] = useState('');
  // Cargos por servicio (barra, armado, traslado): renglones con nombre y monto
  const [services, setServices] = useState<ServiceCharge[]>([]);
  const [serviceName, setServiceName] = useState('');
  const [serviceAmount, setServiceAmount] = useState('');

  const surchargeNumber = parseSurchargeValue(surchargeMode, surchargeValue);
  const surcharge = Number.isFinite(surchargeNumber) && surchargeNumber > 0 ? { mode: surchargeMode, value: surchargeNumber, reason: '' } : null;
  const { quoteItems, surchargeTotal } = useMemo(() => {
    const base = cart.map((item) => ({ productId: item.productId, productName: item.name, price: item.price, quantity: item.quantity, discount: 0 }));
    const { items, manualTotal } = applyManualSurcharge(base, base, [], surcharge);
    return {
      quoteItems: [...items, ...serviceItems(services)].map((i) => ({ productId: i.productId, productName: i.productName, unitPrice: i.price as number, quantity: i.quantity })),
      surchargeTotal: manualTotal,
    };
  }, [cart, surchargeMode, surchargeValue, services]);
  const serviceTotal = servicesTotal(services);
  const quoteTotal = Math.round((total + surchargeTotal + serviceTotal) * 100) / 100;

  const addService = () => {
    const amount = parseSurchargeValue('FIXED', serviceAmount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Poné el monto del servicio'); return; }
    setServices((list) => [...list, { name: serviceName.trim().slice(0, 80) || 'Cargo por servicio', amount }]);
    setServiceName('');
    setServiceAmount('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      toast.error('Ingresá el nombre del cliente');
      return;
    }

    setIsSubmitting(true);
    try {
      // Mismos nombres que el servidor (clientName, unitPrice, productName...): con otros el guardado fallaba.
      // Los productos ya llevan su parte del recargo y los servicios van al final.
      const items = quoteItems;

      const res = await api.post('/quotes', {
        clientName: customerName.trim(),
        clientPhone: customerPhone.trim() || undefined,
        notes: notes.trim() || undefined,
        validDays: validityDays,
        // El total que se ve en pantalla, con las promos, el recargo y los servicios: el presupuesto dice lo mismo
        finalTotal: quoteTotal,
        items
      });

      setCreatedQuote(res.data);
      toast.success('Presupuesto guardado con éxito');
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al guardar presupuesto');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col"
      >
        <style>{`
          @media print {
            @page { size: 80mm 297mm; margin: 0 !important; }
            body * { visibility: hidden !important; }
            #printable-quote, #printable-quote * { visibility: visible !important; }
            #printable-quote {
              display: block !important;
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 80mm !important;
              font-family: 'Courier New', Courier, monospace !important;
              font-size: 8.5pt !important;
              line-height: 1.4 !important;
              padding: 4mm 4mm 12mm 4mm !important;
              box-sizing: border-box !important;
            }
          }
        `}</style>

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
              <FileText className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">
                {createdQuote ? 'Presupuesto Creado' : 'Nuevo Presupuesto / Cotización'}
              </h2>
              <p className="text-xs text-slate-500">
                {createdQuote
                  ? `${createdQuote.items.length} artículos por un total de $${Number(createdQuote.total).toLocaleString('es-AR')}`
                  : `${cart.length} artículos por un total de $${Number(quoteTotal).toLocaleString('es-AR')}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!createdQuote ? (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                Nombre del Cliente / Empresa *
              </label>
              <div className="relative flex items-center">
                <User className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Ej: Juan Pérez / Constructora Silva"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Teléfono / WhatsApp
                </label>
                <div className="relative flex items-center">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    type="tel"
                    placeholder="Ej: 1123456789"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Días de Validez
                </label>
                <div className="relative flex items-center">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <select
                    value={validityDays}
                    onChange={(e) => setValidityDays(Number(e.target.value))}
                    className="w-full bg-white border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value={3}>3 días</option>
                    <option value={7}>7 días (1 semana)</option>
                    <option value={15}>15 días</option>
                    <option value={30}>30 días (1 mes)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Recargo</label>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-slate-300 overflow-hidden shrink-0">
                  {(['PCT', 'FIXED'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setSurchargeMode(m)}
                      className={`px-2.5 py-1.5 text-xs font-black cursor-pointer ${surchargeMode === m ? 'bg-amber-500 text-white' : 'bg-white text-slate-600'}`}>
                      {m === 'FIXED' ? '$' : '%'}
                    </button>
                  ))}
                </div>
                <input inputMode="decimal" value={surchargeValue} onChange={(e) => setSurchargeValue(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder={surchargeMode === 'PCT' ? 'Ej: 40 (precio de evento)' : 'Monto a sumar'}
                  className="flex-1 min-w-0 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-amber-500" />
                {surchargeTotal > 0 && <span className="text-xs font-bold text-amber-700 shrink-0">+${Number(surchargeTotal).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>}
              </div>

              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider self-start pt-2">Servicios</label>
              <div className="space-y-1.5 min-w-0">
                {services.map((sv, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 bg-white border border-sky-200 rounded-lg px-2.5 py-1.5">
                    <span className="text-xs font-semibold text-slate-800 truncate">{sv.name}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="text-xs font-bold text-sky-700">${Number(sv.amount).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>
                      <button type="button" onClick={() => setServices((list) => list.filter((_, j) => j !== i))} title="Quitar el servicio"
                        className="p-0.5 rounded text-slate-400 hover:text-rose-600 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                    </span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5">
                  <input value={serviceName} maxLength={80} onChange={(e) => setServiceName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addService(); } }}
                    placeholder="Ej: Servicio de barra 5 hs"
                    className="flex-1 min-w-0 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-sky-500" />
                  <input inputMode="decimal" value={serviceAmount} onChange={(e) => setServiceAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addService(); } }}
                    placeholder="$ monto"
                    className="w-24 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-sky-500" />
                  <button type="button" onClick={addService} disabled={!serviceAmount.trim()}
                    className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer">Agregar</button>
                </div>
              </div>

              {(surchargeTotal > 0 || serviceTotal > 0) && (
                <>
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Total</span>
                  <span className="text-sm font-black text-slate-900 text-right">${Number(quoteTotal).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>
                </>
              )}
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                Observaciones / Notas (opcional)
              </label>
              <textarea
                rows={2}
                placeholder="Ej: Entrega sin cargo en obra / Pago contado efectivo"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-amber-500 resize-none"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !customerName.trim()}
                className="btn-primary"
              >
                <Check className="w-4 h-4" /> Guardar Presupuesto
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-5 text-center">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">
                Presupuesto {createdQuote.quoteNumber}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Guardado para {createdQuote.clientName} por ${Number(createdQuote.total).toLocaleString('es-AR')}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2">
              <a
                href={quoteWhatsappUrl(createdQuote)}
                target="_blank"
                rel="noreferrer"
                className="p-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all"
              >
                <Share2 className="w-5 h-5" />
                <span>Enviar x WhatsApp</span>
              </a>

              <button
                type="button"
                onClick={handlePrint}
                className="p-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
              >
                <Printer className="w-5 h-5" />
                <span>Imprimir Ticket</span>
              </button>

              <button
                type="button"
                onClick={() => setShowSheet(true)}
                className="p-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
              >
                <FileText className="w-5 h-5" />
                <span>Hoja A4</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="btn-secondary w-full"
            >
              Listo / Volver a Ventas
            </button>
          </div>
        )}

        {/* Printable Ticket Receipt for Quote */}
        {createdQuote && (
          <div id="printable-quote" style={{ display: 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', fontFamily: 'monospace', fontSize: '8pt', color: '#000', gap: '8px' }}>
              <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '8px' }}>
                {storeName && <h4 style={{ margin: 0, fontSize: '11pt', fontWeight: 'bold' }}>{storeName.toUpperCase()}</h4>}
                <p style={{ margin: 0, fontWeight: 'bold', fontSize: '9pt', marginTop: '2px' }}>COTIZACIÓN / PRESUPUESTO</p>
                <p style={{ margin: 0, fontSize: '7pt', color: '#555' }}>DOCUMENTO NO VÁLIDO COMO FACTURA</p>
              </div>

              <div style={{ borderBottom: '1px dashed #000', paddingBottom: '6px', fontSize: '7.5pt' }}>
                <div>N° PRESUPUESTO: {createdQuote.quoteNumber}</div>
                <div>CLIENTE: {createdQuote.clientName}</div>
                {createdQuote.clientPhone && <div>TELÉFONO: {createdQuote.clientPhone}</div>}
                <div>FECHA: {new Date(createdQuote.createdAt).toLocaleDateString('es-AR')}</div>
                <div>VALIDEZ: Hasta {new Date(createdQuote.validUntil).toLocaleDateString('es-AR')}</div>
              </div>

              <div style={{ borderBottom: '1px dashed #000', paddingBottom: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                  <span style={{ width: '55%' }}>ARTÍCULO</span>
                  <span style={{ width: '20%', textAlign: 'center' }}>CANT.</span>
                  <span style={{ width: '25%', textAlign: 'right' }}>TOTAL</span>
                </div>
                {createdQuote.items.map((it: any, idx: number) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ width: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.productName || it.product?.name || 'Producto'}
                    </span>
                    <span style={{ width: '20%', textAlign: 'center' }}>{Number(it.quantity).toFixed(1)}</span>
                    <span style={{ width: '25%', textAlign: 'right' }}>${Number(it.subtotal).toLocaleString('es-AR')}</span>
                  </div>
                ))}
              </div>

              {createdQuote.discount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>DESCUENTO:</span>
                  <span>-${Number(createdQuote.discount).toLocaleString('es-AR')}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10pt', fontWeight: 'bold', paddingTop: '4px' }}>
                <span>TOTAL ESTIMADO:</span>
                <span>${Number(createdQuote.total).toLocaleString('es-AR')}</span>
              </div>

              {createdQuote.notes && (
                <div style={{ borderTop: '1px dashed #000', paddingTop: '4px', fontSize: '7pt' }}>
                  Nota: {createdQuote.notes}
                </div>
              )}

              <p style={{ textAlign: 'center', fontSize: '6.5pt', color: '#666', borderTop: '1px dashed #000', paddingTop: '6px', margin: 0 }}>
                Los precios y stock están sujetos a variación sin previo aviso. Gracias por su consulta.
              </p>
            </div>
          </div>
        )}
      </motion.div>
      {showSheet && createdQuote && <QuotePreview quote={createdQuote} onClose={() => setShowSheet(false)} />}
    </div>
  );
}
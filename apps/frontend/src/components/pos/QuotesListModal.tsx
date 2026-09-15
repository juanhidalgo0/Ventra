import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, X, Search, ShoppingCart, Share2, Trash2, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { usePOSStore } from '../../stores/posStore';

interface QuotesListModalProps {
  onClose: () => void;
  onLoadCart: () => void;
}

export default function QuotesListModal({ onClose, onLoadCart }: QuotesListModalProps) {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('PENDING');

  const { addToCart, clearCart } = usePOSStore();
  const storeName = localStorage.getItem('store_name') || 'Ferretería & Corralón';

  const fetchQuotes = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/quotes', {
        params: { status: statusFilter !== 'ALL' ? statusFilter : undefined }
      });
      setQuotes(res.data || []);
    } catch (err) {
      toast.error('Error al cargar presupuestos');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotes();
  }, [statusFilter]);

  const handleLoadToCart = (quote: any) => {
    if (!quote.items || quote.items.length === 0) {
      toast.error('Este presupuesto no tiene productos');
      return;
    }

    clearCart();
    quote.items.forEach((item: any) => {
      if (item.product) {
        addToCart(item.product, item.price, item.quantity);
      }
    });

    toast.success('Presupuesto #' + quote.quoteNumber + ' cargado al carrito');
    onLoadCart();
    onClose();
  };

  const handleShareWhatsApp = (quote: any) => {
    const lines = [
      '*PRESUPUESTO - ' + storeName.toUpperCase() + '*',
      'N° #' + quote.quoteNumber.toString().padStart(5, '0'),
      'Cliente: ' + quote.customerName,
      'Fecha: ' + new Date(quote.createdAt).toLocaleDateString('es-AR'),
      'Válido hasta: ' + new Date(quote.expiresAt).toLocaleDateString('es-AR'),
      '--------------------------------',
      ...quote.items.map((i: any) => 
        '• ' + i.quantity + 'x ' + (i.product?.name || 'Item') + ' - $' + Number(i.price * i.quantity).toLocaleString()
      ),
      '--------------------------------',
      '*TOTAL: $' + Number(quote.total).toLocaleString() + '*',
    ];
    if (quote.notes) {
      lines.push('Notas: ' + quote.notes);
    }

    const cleanPhone = (quote.customerPhone || '').replace(/\D/g, '');
    const phoneParam = cleanPhone ? 'phone=' + (cleanPhone.startsWith('54') ? cleanPhone : '54' + cleanPhone) + '&' : '';
    const url = 'https://api.whatsapp.com/send?' + phoneParam + 'text=' + encodeURIComponent(lines.join('\n'));
    window.open(url, '_blank');
  };

  const handleDeleteQuote = async (quoteId: string) => {
    if (!window.confirm('¿Seguro que deseas eliminar este presupuesto?')) return;
    try {
      await api.delete('/quotes/' + quoteId);
      toast.success('Presupuesto eliminado');
      setQuotes(quotes.filter(q => q.id !== quoteId));
    } catch (err) {
      toast.error('Error al eliminar presupuesto');
    }
  };

  const filteredQuotes = quotes.filter(q => 
    q.customerName.toLowerCase().includes(search.toLowerCase()) ||
    (q.customerPhone && q.customerPhone.includes(search)) ||
    q.quoteNumber.toString().includes(search)
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
              <FileText className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Presupuestos Guardados</h2>
              <p className="text-xs text-slate-500">Cargá cotizaciones pendientes directamente al carrito con 1 clic</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-slate-200 bg-white flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por cliente, número o teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-amber-500"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {['PENDING', 'ACCEPTED', 'ALL'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                  statusFilter === st
                    ? 'bg-amber-500 border-amber-500 text-white shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {st === 'PENDING' ? 'Pendientes' : st === 'ACCEPTED' ? 'Aceptados' : 'Todos'}
              </button>
            ))}
          </div>
        </div>

        {/* Quotes List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
              <p className="text-xs font-medium">Cargando presupuestos...</p>
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <FileText className="w-10 h-10 mx-auto stroke-1 text-slate-300" />
              <p className="text-sm font-semibold">No se encontraron presupuestos</p>
              <p className="text-xs text-slate-400">Podés crear uno nuevo desde el carrito en el botón "Presupuesto".</p>
            </div>
          ) : (
            filteredQuotes.map((quote) => (
              <div
                key={quote.id}
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-amber-300 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200">
                      #{quote.quoteNumber.toString().padStart(5, '0')}
                    </span>
                    <h3 className="font-bold text-slate-900 text-sm">{quote.customerName}</h3>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                      quote.status === 'PENDING'
                        ? 'bg-amber-100 text-amber-800'
                        : quote.status === 'ACCEPTED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}>{quote.status === 'PENDING' ? 'PENDIENTE' : quote.status === 'ACCEPTED' ? 'ACEPTADO' : quote.status}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
                    <span>{new Date(quote.createdAt).toLocaleDateString('es-AR')}</span>
                    <span>•</span>
                    <span>{quote.items?.length || 0} artículos</span>
                    {quote.customerPhone && (
                      <>
                        <span>•</span>
                        <span>{quote.customerPhone}</span>
                      </>
                    )}
                  </div>
                  {quote.notes && (
                    <p className="text-[11px] text-slate-600 italic">"{quote.notes}"</p>
                  )}
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <span className="text-base font-extrabold text-slate-900 mr-2">
                    ${Number(quote.total).toLocaleString()}
                  </span>

                  <button
                    onClick={() => handleShareWhatsApp(quote)}
                    className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all border border-emerald-200 cursor-pointer"
                    title="Compartir por WhatsApp"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleLoadToCart(quote)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    <span>Cargar Carrito</span>
                  </button>

                  <button
                    onClick={() => handleDeleteQuote(quote.id)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                    title="Eliminar presupuesto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
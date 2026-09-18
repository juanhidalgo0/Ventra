import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Search, DollarSign, CreditCard, Shuffle, User, Phone, 
  FileText, ArrowLeft, Clock, Calendar, CheckCircle2, 
  AlertCircle, ChevronRight, Wallet, Receipt
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

interface Client {
  id: string;
  name: string;
  dni: string | null;
  phone: string | null;
  balance: number;
}

interface CobroCtaCteModalProps {
  sessionId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CobroCtaCteModal({ sessionId, onClose, onSuccess }: CobroCtaCteModalProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientFilter, setClientFilter] = useState<'all' | 'debt' | 'clean' | 'credit'>('all');
  
  // Navigation views: 'clients' | 'form' | 'history'
  const [view, setView] = useState<'clients' | 'form' | 'history'>('clients');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientForHistory, setClientForHistory] = useState<Client | null>(null);

  // History state
  const [clientMovements, setClientMovements] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'PURCHASES' | 'PAYMENTS'>('ALL');

  // Payment form state
  const [amount, setAmount] = useState<string>('');
  
  // Dynamic Payment Methods from localStorage
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

  const mainMethods = [
    { key: 'CASH', label: 'Efectivo', icon: DollarSign, color: '#10b981' },
    ...posnets.map((p, idx) => ({
      key: p.id,
      label: p.name,
      icon: CreditCard,
      color: idx % 2 === 0 ? '#D9A70F' : '#3b82f6',
    })),
    { key: 'MIXED', label: 'Mixto', icon: Shuffle, color: '#8b5cf6' },
  ];

  const [paymentType, setPaymentType] = useState<string>('CASH');
  
  // Mixed Payment States
  const [mixedMethod1, setMixedMethod1] = useState<string>('CASH');
  const [mixedMethod2, setMixedMethod2] = useState<string>(posnets[0]?.id || 'CLOVER');
  const [mixedAmount1, setMixedAmount1] = useState<number>(0);
  const [mixedAmount2, setMixedAmount2] = useState<number>(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const mixedAmount1Ref = useRef<HTMLInputElement>(null);
  const mixedAmount2Ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadClients();
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Update second mixed amount automatically
  useEffect(() => {
    if (paymentType === 'MIXED') {
      const totalNum = Number(amount) || 0;
      setMixedAmount2(Math.max(0, totalNum - mixedAmount1));
    }
  }, [mixedAmount1, amount, paymentType]);

  const loadClients = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get('/clients');
      setClients(data || []);
    } catch (err) {
      console.error('Error al cargar clientes:', err);
      toast.error('Error al cargar la lista de clientes');
    } finally {
      setIsLoading(false);
    }
  };

  const loadClientHistory = async (client: Client) => {
    setClientForHistory(client);
    setIsLoadingHistory(true);
    setView('history');
    setHistoryFilter('ALL');
    try {
      const { data } = await api.get(`/clients/${client.id}`);
      setClientMovements(data.movements || []);
    } catch (err) {
      console.error('Error al cargar movimientos:', err);
      toast.error('No se pudo cargar el historial del cliente');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const selectClientForPayment = (client: Client) => {
    setSelectedClient(client);
    setAmount(client.balance > 0 ? client.balance.toString() : '');
    setView('form');
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(val);
  };

  const filteredClients = clients.filter(c => {
    const matchesSearch = 
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (c.dni && c.dni.includes(searchTerm)) ||
      (c.phone && c.phone.includes(searchTerm));
    
    if (!matchesSearch) return false;

    if (clientFilter === 'debt') return (c.balance || 0) > 0;
    if (clientFilter === 'clean') return (c.balance || 0) === 0;
    if (clientFilter === 'credit') return (c.balance || 0) < 0;
    return true;
  });

  const totalDebt = clients.reduce((acc, c) => acc + (c.balance > 0 ? c.balance : 0), 0);
  const debtClientsCount = clients.filter(c => (c.balance || 0) > 0).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) {
      toast.error('Por favor, seleccione un cliente');
      return;
    }

    const payAmount = Number(amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      toast.error('Por favor, ingrese un monto válido mayor a 0');
      return;
    }

    if (paymentType === 'MIXED') {
      const sum = mixedAmount1 + mixedAmount2;
      if (Math.abs(sum - payAmount) > 0.01) {
        toast.error(`La suma de los pagos mixtos (${formatCurrency(sum)}) no coincide con el total (${formatCurrency(payAmount)})`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const finalDesc = paymentType === 'MIXED'
        ? `Pago Mixto - ${mixedMethod1}: ${formatCurrency(mixedAmount1)} | ${mixedMethod2}: ${formatCurrency(mixedAmount2)}`
        : `Pago a Cuenta Corriente (Método: ${paymentType})`;

      // 1. Register movement in customer current account (reduces debt)
      await api.post(`/clients/${selectedClient.id}/movement`, {
        type: 'PAYMENT',
        amount: payAmount,
        description: finalDesc
      });

      // 2. Register sale record in database to balance cash register session
      const payments = paymentType === 'MIXED'
        ? [
            { method: mixedMethod1, amount: mixedAmount1 },
            { method: mixedMethod2, amount: mixedAmount2 }
          ].filter(p => p.amount > 0)
        : [{ method: paymentType, amount: payAmount }];

      await api.post('/sales', {
        sessionId,
        clientId: selectedClient.id,
        payments,
        items: [
          {
            productId: 'PAGO_CTA_CTE',
            productName: `PAGO CUENTA CORRIENTE - ${selectedClient.name}`,
            quantity: 1,
            price: payAmount,
            total: payAmount
          }
        ],
        notes: finalDesc
      });

      toast.success(`✅ Cobro de ${formatCurrency(payAmount)} registrado con éxito`);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error al registrar cobro:', err);
      toast.error(err.response?.data?.message || 'Error al procesar el cobro');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200"
    >
      <div 
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-5xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col h-[90vh] max-h-[820px] transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* TOP HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-850 shrink-0">
          <div className="flex items-center gap-3">
            {view !== 'clients' && (
              <button 
                onClick={() => setView('clients')} 
                className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-250 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all cursor-pointer shadow-2xs"
                title="Volver a la lista de clientes"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                {view === 'clients' && 'Cobro de Cuentas Corrientes'}
                {view === 'form' && `Registrar Pago - ${selectedClient?.name}`}
                {view === 'history' && `Historial de ${clientForHistory?.name}`}
              </h3>
              <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-0.5">
                {view === 'clients' && `${debtClientsCount} clientes con deuda • Total por cobrar: ${formatCurrency(totalDebt)}`}
                {view === 'form' && `Saldo actual: ${selectedClient ? formatCurrency(selectedClient.balance) : '$0'}`}
                {view === 'history' && 'Registro histórico de compras y abonos'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {view === 'form' && selectedClient && (
              <button
                type="button"
                onClick={() => loadClientHistory(selectedClient)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 hover:bg-rose-100 rounded-xl text-xs font-bold transition-all border border-rose-200 dark:border-rose-800 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Ver Historial</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              title="Cerrar (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* MODAL BODY */}
        <div className="flex-1 overflow-hidden flex flex-col p-5 sm:p-6 bg-slate-50/40 dark:bg-slate-900/60">
          
          {/* VIEW 1: CLIENTS LIST & CARDS */}
          {view === 'clients' && (
            <div className="flex-1 flex flex-col overflow-hidden space-y-4">
              
              {/* Search & Filter Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
                <div className="relative flex-1 flex items-center">
                  <Search className="absolute left-4 w-4 h-4 text-rose-500/70 dark:text-rose-400 pointer-events-none" />
                  <input 
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar cliente por nombre, DNI o teléfono..."
                    autoFocus
                    className="w-full bg-white dark:bg-slate-800/90 border border-slate-250 dark:border-slate-700 rounded-2xl pl-11 pr-4 py-2.5 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/10 font-bold text-slate-800 dark:text-slate-100 text-sm shadow-2xs transition-all placeholder:font-normal placeholder:text-slate-400"
                  />
                  {searchTerm && (
                    <button onClick={() => setSearchTerm('')} className="absolute right-3 text-slate-400 hover:text-slate-600">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 shrink-0">
                  {[
                    { id: 'all', label: 'Todos', count: clients.length },
                    { id: 'debt', label: 'Con Deuda', count: clients.filter(c => c.balance > 0).length, color: 'text-rose-600' },
                    { id: 'clean', label: 'Al Día', count: clients.filter(c => c.balance === 0).length },
                    { id: 'credit', label: 'A Favor', count: clients.filter(c => c.balance < 0).length, color: 'text-emerald-600' }
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setClientFilter(f.id as any)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                        clientFilter === f.id
                          ? 'bg-teal-700 text-white dark:bg-teal-600 dark:text-white shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <span>{f.label}</span>
                      <span className="ml-1.5 opacity-70">({f.count})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Cards Grid */}
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-8 h-8 border-3 border-rose-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Cargando fichas de clientes...</p>
                  </div>
                ) : filteredClients.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white/40 dark:bg-slate-850/40">
                    <User className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-2 stroke-[1.2]" />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No se encontraron clientes</p>
                    <p className="text-xs text-slate-400 mt-1">Prueba cambiando el término de búsqueda o el filtro.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {filteredClients.map((client) => {
                      const hasDebt = client.balance > 0;
                      const hasCredit = client.balance < 0;
                      const initial = client.name ? client.name.charAt(0).toUpperCase() : '?';

                      return (
                        <div
                          key={client.id}
                          className="group relative bg-white dark:bg-slate-850 rounded-2xl p-4 border border-slate-200/90 dark:border-slate-750 shadow-2xs hover:shadow-md hover:border-rose-400 dark:hover:border-rose-500 transition-all flex flex-col justify-between"
                        >
                          <div>
                            {/* Card Top: Avatar, Name & Status */}
                            <div className="flex items-start justify-between gap-2.5 mb-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0 shadow-2xs ${
                                  hasDebt 
                                    ? 'bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900' 
                                    : hasCredit
                                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400'
                                    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}>
                                  {initial}
                                </div>
                                <div className="min-w-0">
                                  <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 truncate group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                                    {client.name}
                                  </h4>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-semibold mt-0.5">
                                    <span>{client.dni ? `DNI: ${client.dni}` : 'Sin DNI'}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Balance Badge */}
                              <div className="text-right shrink-0">
                                <span className={`inline-flex px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                                  hasDebt
                                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                    : hasCredit
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'
                                }`}>
                                  {hasDebt ? 'Debe' : hasCredit ? 'A favor' : 'Al día'}
                                </span>
                              </div>
                            </div>

                            {/* Phone & Details */}
                            {client.phone && (
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mb-3 px-1">
                                <Phone className="w-3 h-3 text-slate-400" />
                                <span className="font-medium">{client.phone}</span>
                              </div>
                            )}

                            {/* Prominent Balance Display */}
                            <div className={`p-3 rounded-xl mb-3 flex items-center justify-between ${
                              hasDebt 
                                ? 'bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30' 
                                : hasCredit
                                ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30'
                                : 'bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800'
                            }`}>
                              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                                {hasDebt ? 'Saldo Deudor:' : 'Saldo Actual:'}
                              </span>
                              <span className={`text-base font-black font-mono tracking-tight ${
                                hasDebt ? 'text-rose-600 dark:text-rose-400' : hasCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'
                              }`}>
                                {formatCurrency(Math.abs(client.balance || 0))}
                              </span>
                            </div>
                          </div>

                          {/* Card Action Buttons */}
                          <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                            <button
                              type="button"
                              onClick={() => loadClientHistory(client)}
                              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                              title="Ver compras y pagos del cliente"
                            >
                              <FileText className="w-3.5 h-3.5 text-rose-500" />
                              <span>Historial</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => selectClientForPayment(client)}
                              className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                            >
                              <DollarSign className="w-3.5 h-3.5 stroke-[2.8]" />
                              <span>{hasDebt ? 'Cobrar Deuda' : 'Registrar Abono'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW 2: PAYMENT FORM (COBRO) */}
          {view === 'form' && selectedClient && (
            <div className="flex-1 flex flex-col justify-between max-w-2xl mx-auto w-full overflow-hidden">
              <form onSubmit={handleSubmit} className="flex-1 flex flex-col justify-between gap-4 overflow-hidden py-1">
                <div className="space-y-4">
                  {/* Amount Input */}
                  <div className="bg-white dark:bg-slate-850 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-750 shadow-sm space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                        Monto a Cobrar / Abonar
                      </label>
                      {selectedClient.balance > 0 && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setAmount(selectedClient.balance.toString())}
                            className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-600 dark:text-rose-300 text-[11px] font-bold rounded-lg transition-colors border border-rose-200 dark:border-rose-900 cursor-pointer"
                          >
                            Total Deuda ({formatCurrency(selectedClient.balance)})
                          </button>
                          <button
                            type="button"
                            onClick={() => setAmount(Math.round(selectedClient.balance / 2).toString())}
                            className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                          >
                            50% ({formatCurrency(Math.round(selectedClient.balance / 2))})
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="relative flex items-center">
                      <span className="absolute left-4 text-2xl font-black text-slate-400 pointer-events-none">$</span>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        required
                        min="1"
                        step="any"
                        autoFocus
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl pl-10 pr-4 py-3.5 outline-none focus:border-rose-500 dark:focus:border-rose-500 font-mono font-black text-2xl text-slate-900 dark:text-white transition-all shadow-inner"
                      />
                    </div>
                  </div>

                  {/* Payment Methods Grid */}
                  <div className="bg-white dark:bg-slate-850 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-750 shadow-sm space-y-2.5">
                    <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                      Medio de Pago
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {mainMethods.map((pm) => (
                        <button
                          key={pm.key}
                          type="button"
                          onClick={() => setPaymentType(pm.key)}
                          className={`relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all duration-200 cursor-pointer select-none hover:scale-[1.02] active:scale-[0.98] ${
                            paymentType === pm.key 
                              ? 'shadow-md dark:shadow-none' 
                              : 'border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-350'
                          }`}
                          style={paymentType === pm.key ? { borderColor: pm.color, backgroundColor: `${pm.color}15`, color: pm.color } : {}}
                        >
                          <pm.icon className="w-5 h-5" style={paymentType === pm.key ? { color: pm.color } : {}} />
                          <span className="text-[10px] font-black text-center leading-tight uppercase tracking-wider">{pm.label}</span>
                        </button>
                      ))}
                    </div>

                    {/* Mixed Payment Split */}
                    {paymentType === 'MIXED' && (
                      <div className="animate-in slide-in-from-top-2 duration-200 space-y-2 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 mt-2">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Dividir el cobro en dos medios de pago</p>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {/* Split 1 */}
                          <div className="p-3 rounded-xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-750 space-y-1.5">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Parte 1</span>
                            <div className="flex gap-1">
                              {['CASH', ...posnets.map(p => p.id)].map((mt) => (
                                <button 
                                  key={mt} 
                                  type="button"
                                  onClick={() => setMixedMethod1(mt)} 
                                  className={`flex-1 py-1 rounded-lg text-[9px] font-bold uppercase transition-all ${
                                    mixedMethod1 === mt ? 'bg-rose-600 text-white font-bold' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-350 border border-slate-200 dark:border-slate-700'
                                  }`}
                                >
                                  {mt === 'CASH' ? 'Efect.' : (posnets.find(p => p.id === mt)?.name || mt)}
                                </button>
                              ))}
                            </div>
                            <input 
                              ref={mixedAmount1Ref}
                              type="number" 
                              value={mixedAmount1 || ''} 
                              onChange={(e) => setMixedAmount1(Number(e.target.value))} 
                              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 font-mono font-bold text-base text-slate-800 dark:text-slate-100" 
                              placeholder="0.00" 
                            />
                          </div>

                          {/* Split 2 */}
                          <div className="p-3 rounded-xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-750 space-y-1.5">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Parte 2 (Restante)</span>
                            <div className="flex gap-1">
                              {['CASH', ...posnets.map(p => p.id)].map((mt) => (
                                <button 
                                  key={mt} 
                                  type="button"
                                  onClick={() => setMixedMethod2(mt)} 
                                  className={`flex-1 py-1 rounded-lg text-[9px] font-bold uppercase transition-all ${
                                    mixedMethod2 === mt ? 'bg-rose-600 text-white font-bold' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-350 border border-slate-200 dark:border-slate-700'
                                  }`}
                                >
                                  {mt === 'CASH' ? 'Efect.' : (posnets.find(p => p.id === mt)?.name || mt)}
                                </button>
                              ))}
                            </div>
                            <input 
                              ref={mixedAmount2Ref}
                              type="number" 
                              value={mixedAmount2 || ''} 
                              onChange={(e) => setMixedAmount2(Number(e.target.value))} 
                              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 font-mono font-bold text-base text-slate-800 dark:text-slate-100" 
                              placeholder="0.00" 
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setView('clients')}
                    className="flex-1 btn-secondary py-3.5 text-xs uppercase tracking-wider font-black"
                  >
                    Volver a Clientes
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-2 btn-success py-3.5 text-xs uppercase tracking-wider font-black shadow-lg shadow-emerald-600/20"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isSubmitting ? 'Procesando Cobro...' : 'Confirmar Cobro y Guardar'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* VIEW 3: CLIENT HISTORY (COMPRAS Y PAGOS) */}
          {view === 'history' && clientForHistory && (
            <div className="flex-1 flex flex-col overflow-hidden space-y-4">
              
              {/* History Top Card */}
              <div className="bg-white dark:bg-slate-850 rounded-2xl p-4 border border-slate-200 dark:border-slate-750 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-black text-sm flex items-center justify-center">
                    {clientForHistory.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-900 dark:text-slate-100">{clientForHistory.name}</h4>
                    <p className="text-[10px] text-slate-400 font-semibold">
                      {clientForHistory.dni ? `DNI: ${clientForHistory.dni}` : 'Sin DNI'} • Saldo: <b className={clientForHistory.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}>{formatCurrency(clientForHistory.balance)}</b>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {/* Filter tabs */}
                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-[11px] font-bold">
                    <button
                      onClick={() => setHistoryFilter('ALL')}
                      className={`px-3 py-1 rounded-lg transition-all ${historyFilter === 'ALL' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs' : 'text-slate-500'}`}
                    >
                      Todos
                    </button>
                    <button
                      onClick={() => setHistoryFilter('PURCHASES')}
                      className={`px-3 py-1 rounded-lg transition-all ${historyFilter === 'PURCHASES' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs' : 'text-slate-500'}`}
                    >
                      Compras
                    </button>
                    <button
                      onClick={() => setHistoryFilter('PAYMENTS')}
                      className={`px-3 py-1 rounded-lg transition-all ${historyFilter === 'PAYMENTS' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs' : 'text-slate-500'}`}
                    >
                      Pagos
                    </button>
                  </div>

                  <button
                    onClick={() => selectClientForPayment(clientForHistory)}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-sm cursor-pointer ml-auto"
                  >
                    <DollarSign className="w-3.5 h-3.5 stroke-[2.8]" />
                    <span>Abonar</span>
                  </button>
                </div>
              </div>

              {/* History Timeline */}
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                {isLoadingHistory ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-8 h-8 border-3 border-rose-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Cargando movimientos del cliente...</p>
                  </div>
                ) : clientMovements.filter(m => {
                  if (historyFilter === 'PURCHASES') return m.type === 'DEBT';
                  if (historyFilter === 'PAYMENTS') return m.type === 'PAYMENT';
                  return true;
                }).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white/40 dark:bg-slate-850/40">
                    <Receipt className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-2 stroke-[1.2]" />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No hay movimientos registrados</p>
                    <p className="text-xs text-slate-400 mt-1">Este cliente no registra operaciones en el filtro seleccionado.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {clientMovements
                      .filter((mov) => {
                        if (historyFilter === 'PURCHASES') return mov.type === 'DEBT';
                        if (historyFilter === 'PAYMENTS') return mov.type === 'PAYMENT';
                        return true;
                      })
                      .map((mov) => {
                        const isPayment = mov.type === 'PAYMENT';
                        const dateFormatted = new Date(mov.createdAt).toLocaleString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        });

                        return (
                          <div
                            key={mov.id}
                            className={`p-4 rounded-2xl border transition-all flex flex-col md:flex-row justify-between items-stretch md:items-start gap-3 bg-white dark:bg-slate-850 ${
                              isPayment
                                ? 'border-emerald-200/80 dark:border-emerald-900/50'
                                : 'border-rose-200/80 dark:border-rose-900/50'
                            }`}
                          >
                            <div className="space-y-1.5 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${
                                  isPayment 
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' 
                                    : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                }`}>
                                  {isPayment ? 'Pago / Abono' : 'Compra a Cuenta Corriente'}
                                </span>
                                <span className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> {dateFormatted}
                                </span>
                              </div>

                              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                {mov.description || (isPayment ? 'Pago registrado' : 'Compra en local')}
                              </p>

                              {/* Itemized breakdown if it's a purchase */}
                              {!isPayment && mov.sale?.items && mov.sale.items.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-750 space-y-1">
                                  <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Productos comprados:</p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                    {mov.sale.items.map((item: any) => (
                                      <div key={item.id} className="flex justify-between items-center text-[10px] text-slate-600 dark:text-slate-400 font-semibold bg-slate-50 dark:bg-slate-900 px-2 py-1 rounded-lg">
                                        <span className="truncate mr-2">• {item.quantity}x {item.productName}</span>
                                        <span className="font-mono font-bold shrink-0">{formatCurrency(item.total)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="text-right space-y-1 flex flex-row md:flex-col justify-between md:justify-start items-center md:items-end border-t md:border-t-0 border-slate-100 dark:border-slate-800 pt-2 md:pt-0 shrink-0">
                              <p className={`text-base font-black font-mono ${isPayment ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {isPayment ? '-' : '+'} {formatCurrency(mov.amount)}
                              </p>
                              <p className="text-[10px] text-slate-400 font-mono font-bold">
                                Saldo post: {formatCurrency(mov.balanceAfter)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}

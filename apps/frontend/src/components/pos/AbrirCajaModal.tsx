import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Unlock, Lock, Laptop, DollarSign } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

interface AbrirCajaModalProps {
  onClose: () => void;
  onSuccess: (session: any) => void;
  terminalName: string;
}

export default function AbrirCajaModal({ onClose, onSuccess, terminalName }: AbrirCajaModalProps) {
  const [openingAmount, setOpeningAmount] = useState(30000);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('default_opening_amount');
    if (saved) {
      setOpeningAmount(Number(saved));
    }

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleOpen = async () => {
    setIsSubmitting(true);
    try {
      const { data } = await api.post('/cash/open', { 
        terminalName, 
        openingAmount, 
        openingNotes: 'Apertura desde POS' 
      });
      toast.success('✅ Caja abierta correctamente');
      onSuccess(data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al abrir caja');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fmt = (p: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(p);

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }} 
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.95, opacity: 0 }} 
        onClick={(e) => e.stopPropagation()} 
        className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100 flex flex-col p-6 space-y-5"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-500">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Abrir Caja Registradora</h3>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Turno del terminal activo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-1">Terminal Activo</label>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-650">
              <Laptop className="w-4 h-4 text-slate-400" />
              <span>{terminalName}</span>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-1">Monto de Apertura ($)</label>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-extrabold text-slate-450 select-none">
              <DollarSign className="w-4 h-4 text-slate-400" />
              <span>{fmt(openingAmount)}</span>
            </div>
            <p className="text-[9px] text-amber-500 font-bold mt-1.5 ml-1">🔒 Monto bloqueado por la administración general.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 pt-2">
          <button 
            onClick={handleOpen}
            disabled={isSubmitting}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
          >
            <Unlock className="w-4.5 h-4.5 text-indigo-200" /> {isSubmitting ? 'Abriendo...' : 'Abrir Caja'}
          </button>
          <button onClick={onClose} className="px-5 py-3.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
            Cancelar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

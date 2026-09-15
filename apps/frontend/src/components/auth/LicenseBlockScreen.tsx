import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Lock, KeyRound, Copy, Check, RefreshCw, ShieldAlert, AlertCircle } from 'lucide-react';
import { GoDeliveryLogo } from './ConnectionScreen';

interface LicenseBlockScreenProps {
  onActivated: () => void;
  statusData: {
    machineUuid: string;
    expiresAt: string;
    isClockTampered?: boolean;
  };
}

export default function LicenseBlockScreen({ onActivated, statusData }: LicenseBlockScreenProps) {
  const [activationCode, setActivationCode] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [isCheckingOnline, setIsCheckingOnline] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyUuid = () => {
    navigator.clipboard.writeText(statusData.machineUuid);
    setCopied(true);
    toast.success('ID copiado al portapapeles', { icon: '📋' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activationCode.trim()) {
      toast.error('Ingresa un código válido');
      return;
    }

    setIsActivating(true);
    try {
      await api.post('/auth/license/activate', { code: activationCode });
      toast.success('Licencia activada con éxito');
      onActivated();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Código incorrecto');
    } finally {
      setIsActivating(false);
    }
  };

  const handleCheckOnline = async () => {
    setIsCheckingOnline(true);
    try {
      const { data } = await api.get('/auth/license/status');
      if (data.isActive) {
        toast.success('Licencia renovada en línea');
        onActivated();
      } else {
        toast.error('Aún no se registra el pago para este equipo');
      }
    } catch {
      toast.error('No se pudo conectar con el servidor');
    } finally {
      setIsCheckingOnline(false);
    }
  };

  const fmtDate = (d: string) => {
    try {
      const date = new Date(d);
      if (date.getFullYear() <= 1970) return 'Nunca activada';
      return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch {
      return 'Vencida';
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-50/80 backdrop-blur-md flex items-center justify-center p-4 font-sans select-none overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 25 }}
        className="w-full max-w-[420px] bg-white border border-slate-400/60 rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden"
      >
        {/* Header */}
        <div className="flex flex-col items-center text-center space-y-5 mb-8">
          <div className="w-16 h-16 rounded-2xl overflow-hidden border border-slate-300 shadow-sm">
             <GoDeliveryLogo className="w-full h-full" />
          </div>
          
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 text-rose-600 text-[11px] font-bold uppercase tracking-wide">
              {statusData.isClockTampered ? <ShieldAlert className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              <span>{statusData.isClockTampered ? 'Conflicto de Seguridad' : 'Licencia Inactiva'}</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              {statusData.isClockTampered ? 'Reloj del Sistema Alterado' : 'Acceso Suspendido'}
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed font-medium px-4">
              {statusData.isClockTampered
                ? 'La hora de tu PC es incorrecta. Por favor, sincroniza la hora actual de tu equipo por seguridad.'
                : 'El acceso al Punto de Venta se encuentra inactivo por falta de renovación o licencia vencida.'}
            </p>
          </div>
        </div>

        {/* Info Block */}
        <div className="bg-slate-50 rounded-2xl p-4 mb-6 space-y-4">
          <div>
            <span className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              ID del Equipo
            </span>
            <div className="flex items-center justify-between gap-3">
              <code className="text-sm font-semibold text-slate-700 truncate tracking-wide">
                {statusData.machineUuid}
              </code>
              <button
                type="button"
                onClick={handleCopyUuid}
                className="p-1.5 text-slate-600 hover:text-slate-700 hover:bg-slate-200/50 rounded-md transition-colors"
                title="Copiar ID"
              >
                <AnimatePresence mode="wait">
                  {copied ? (
                    <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }} key="check">
                      <Check className="w-4 h-4 text-emerald-500" />
                    </motion.div>
                  ) : (
                    <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }} key="copy">
                      <Copy className="w-4 h-4" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </div>
          </div>
          
          <div className="h-px bg-slate-200/60 w-full" />
          
          <div className="flex justify-between items-center text-[13px]">
            <span className="font-semibold text-slate-700">Último vencimiento</span>
            <span className="font-bold text-slate-900">
              {fmtDate(statusData.expiresAt)}
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleActivate} className="space-y-5">
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider ml-1">
              Código de Activación
            </label>
            <div className="relative flex items-center">
              <KeyRound className="absolute left-4 w-4 h-4 text-slate-600" />
              <input
                type="text"
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                className="w-full bg-white border border-slate-400 rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-slate-900 tracking-widest placeholder-slate-300 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 transition-all uppercase"
                maxLength={14}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2.5 pt-2">
            <button
              type="submit"
              disabled={isActivating || isCheckingOnline}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold h-11 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 active:scale-[0.98]"
            >
              {isActivating ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              <span>{isActivating ? 'Activando...' : 'Activar Licencia'}</span>
            </button>
            
            <button
              type="button"
              onClick={handleCheckOnline}
              disabled={isCheckingOnline || isActivating}
              className="w-full bg-white hover:bg-slate-50 text-slate-600 font-semibold h-11 rounded-xl text-sm border border-slate-400 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]"
            >
              <RefreshCw className={`w-4 h-4 ${isCheckingOnline ? 'animate-spin' : ''}`} />
              <span>Verificar pago en línea</span>
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

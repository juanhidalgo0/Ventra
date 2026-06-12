import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Lock, Key, Copy, Check, RefreshCw, AlertTriangle, ShieldAlert } from 'lucide-react';
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
    toast.success('📋 ID de Computadora copiado');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activationCode.trim()) {
      toast.error('Ingresa un código de activación');
      return;
    }

    setIsActivating(true);
    try {
      await api.post('/auth/license/activate', { code: activationCode });
      toast.success('✅ ¡Licencia activada con éxito!');
      onActivated();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Código de activación incorrecto');
    } finally {
      setIsActivating(false);
    }
  };

  const handleCheckOnline = async () => {
    setIsCheckingOnline(true);
    try {
      const { data } = await api.get('/auth/license/status');
      if (data.isActive) {
        toast.success('✅ ¡Licencia renovada en línea correctamente!');
        onActivated();
      } else {
        toast.error('❌ Aún no se registra el pago en línea para este dispositivo.');
      }
    } catch {
      toast.error('⚠️ No se pudo conectar con el servidor central de licencias.');
    } finally {
      setIsCheckingOnline(false);
    }
  };

  const fmtDate = (d: string) => {
    try {
      const date = new Date(d);
      if (date.getFullYear() <= 1970) {
        return 'Nunca activada';
      }
      return date.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return 'Vencida';
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#090d16]/90 backdrop-blur-[20px] flex items-center justify-center p-4 font-sans select-none overflow-y-auto">
      {/* Dynamic Animated Glow Orbs */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-rose-500/10 rounded-full blur-[120px] pointer-events-none animate-pulse duration-[8000ms]" />
      <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[130px] pointer-events-none animate-pulse duration-[6000ms]" />
      <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-violet-600/5 rounded-full blur-[100px] pointer-events-none animate-pulse duration-[10000ms]" />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 100, damping: 15 }}
        className="w-full max-w-md bg-gradient-to-b from-[#131926]/90 to-[#0c0f17]/95 border border-[#222c44]/80 rounded-[2.5rem] p-8 shadow-[0_30px_70px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.05)] relative overflow-hidden text-center space-y-6"
      >
        {/* Top Accent Gradient Border */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-rose-500/80 to-transparent" />
        
        {/* Soft internal gradient glow */}
        <div className="absolute -top-16 -right-16 w-40 h-40 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Brand Logo Wrapper */}
        <div className="flex justify-center mb-2">
          <motion.div 
            whileHover={{ scale: 1.05, rotate: 1 }}
            className="p-3.5 bg-gradient-to-b from-[#182033] to-[#0d1321] rounded-2.5xl border border-[#25324e] shadow-xl relative group"
          >
            <div className="absolute inset-0 bg-rose-500/10 rounded-2.5xl blur opacity-0 group-hover:opacity-100 transition-opacity" />
            <GoDeliveryLogo className="w-10 h-10 relative z-10" />
          </motion.div>
        </div>

        {/* Title and Badge */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-black uppercase tracking-wider mx-auto shadow-inner shadow-rose-950/20">
            {statusData.isClockTampered ? (
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-450" />
            )}
            <span>{statusData.isClockTampered ? 'Conflicto de Hora' : 'Suscripción Requerida'}</span>
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight leading-none">
            {statusData.isClockTampered ? 'Reloj del Sistema Alterado' : 'Licencia Mensual Inactiva'}
          </h2>
          <p className="text-slate-400 text-xs leading-relaxed max-w-sm mx-auto font-medium">
            {statusData.isClockTampered
              ? 'La hora de tu PC es anterior a los registros de venta guardados. Por seguridad, sincroniza la hora actual de tu equipo.'
              : 'El acceso al Punto de Venta (POS) está temporalmente inactivo por falta de renovación o licencia vencida.'}
          </p>
        </div>

        {/* Device Information Card */}
        <div className="bg-[#0b0e16]/80 border border-[#1d273a] rounded-2xl p-5 text-left space-y-4 shadow-inner relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
          <div>
            <span className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest block mb-2">
              ID de Computadora (UUID)
            </span>
            <div className="flex items-center justify-between gap-3 bg-[#111622] border border-[#1f293d] rounded-xl px-4 py-3 hover:border-slate-700 transition-colors group">
              <code className="text-[11px] font-bold text-rose-400 truncate tracking-wide font-mono">
                {statusData.machineUuid}
              </code>
              <button
                type="button"
                onClick={handleCopyUuid}
                className="p-2 bg-[#171e2f] hover:bg-[#20293f] rounded-lg text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer shrink-0 border border-[#26334f] hover:border-slate-600 flex items-center justify-center"
                title="Copiar ID de hardware"
              >
                <AnimatePresence mode="wait">
                  {copied ? (
                    <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }} key="check">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    </motion.div>
                  ) : (
                    <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }} key="copy">
                      <Copy className="w-3.5 h-3.5" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center text-xs pt-3 border-t border-[#1a2335]">
            <span className="font-semibold text-slate-500">Último Vencimiento:</span>
            <span className="font-extrabold text-rose-400 bg-rose-500/10 px-3 py-1 rounded-lg border border-rose-500/20 shadow-inner">
              {fmtDate(statusData.expiresAt)}
            </span>
          </div>
        </div>

        {/* Activation Form */}
        <form onSubmit={handleActivate} className="space-y-4">
          <div className="space-y-2 text-left">
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest ml-1">
              Código de Activación
            </label>
            <div className="relative group">
              <input
                type="text"
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                className="w-full bg-[#0b0e16]/90 border border-[#1d273a] rounded-xl pl-12 pr-4 py-3.5 text-sm font-extrabold text-white tracking-[0.25em] placeholder-slate-700 outline-none focus:border-rose-500/60 focus:ring-1 focus:ring-rose-500/40 focus:bg-[#0e121d] transition-all text-center font-mono shadow-inner uppercase"
                maxLength={14}
              />
              <Key className="absolute left-4.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-rose-450 transition-colors" />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={handleCheckOnline}
              disabled={isCheckingOnline || isActivating}
              className="flex-1 bg-gradient-to-b from-[#151d2e] to-[#0e1421] hover:from-[#1b263b] hover:to-[#121929] text-slate-300 hover:text-white font-extrabold h-12 rounded-xl text-xs uppercase tracking-wider border border-[#24314c] transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 shadow-md hover:shadow-lg disabled:opacity-50"
            >
              {isCheckingOnline ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-400" />
                  <span>Verificando...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Verificar en Línea</span>
                </>
              )}
            </button>

            <button
              type="submit"
              disabled={isActivating || isCheckingOnline}
              className="flex-1 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white font-black h-12 rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 hover:shadow-rose-500/30 transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isActivating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Habilitando...</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Habilitar Sistema</span>
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

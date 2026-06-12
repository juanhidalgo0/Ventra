import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, Eye, EyeOff, Loader2, ShieldCheck, UserCheck, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

// Premium SVG Go! Delivery Logo replica
function GoDeliveryLogo({ className = 'w-16 h-16' }: { className?: string }) {
  return (
    <img src="./godelivery-logo.jpg" className={`${className} rounded-full object-cover`} alt="GoDelivery" />
  );
}
export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isInitialized, setIsInitialized] = useState(true);
  const [checkLoading, setCheckLoading] = useState(true);
  const [registering, setRegistering] = useState(false);

  const [loadingMessage, setLoadingMessage] = useState('Iniciando servidores locales...');

  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    let retries = 0;
    const maxRetries = 150; // Extended retries for slow systems/first extract

    const detectPortAndCheckInit = async () => {
      const portsToTry = [3001, 3002, 3003, 3004, 3005];
      
      for (const p of portsToTry) {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 200); // Fast 200ms ping
          const response = await fetch(`http://127.0.0.1:${p}/api/auth/init-status`, { signal: controller.signal });
          clearTimeout(id);
          
          if (response.ok) {
            const data = await response.json();
            console.log(`[Frontend] Successfully connected to backend on port: ${p}`);
            sessionStorage.setItem('active_backend_port', p.toString());
            setIsInitialized(data.initialized);
            setCheckLoading(false);

            // Fetch local IP (silent logging, no toast notifications)
            try {
              const infoRes = await fetch(`http://127.0.0.1:${p}/api/system/info`);
              if (infoRes.ok) {
                const infoData = await infoRes.json();
                console.log(`[Frontend] Server local IP detected: ${infoData.localIp}`);
              }
            } catch (err) {
              console.error('Error fetching system info:', err);
            }
            return; // Success! Stop retrying
          }
        } catch (e) {
          // Port not active, check next one
        }
      }

      // If no port responded, schedule next retry in 1s
      retries++;
      console.warn(`[Frontend] Backend not ready on ports 3001-3005, retry #${retries}...`);

      if (retries >= 35) {
        setLoadingMessage('Estableciendo conexión final con el backend...');
      } else if (retries >= 20) {
        setLoadingMessage('Iniciando el servidor de base de datos local...');
      } else if (retries >= 5) {
        setLoadingMessage('Instalando dependencias de la aplicación... (Solo la primera vez, esto puede tardar un momento)');
      } else {
        setLoadingMessage('Iniciando servidores locales...');
      }

      if (retries < maxRetries) {
        setTimeout(detectPortAndCheckInit, 1000);
      } else {
        setCheckLoading(false); // Fallback to show login if server fails permanently
      }
    };

    detectPortAndCheckInit();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password);
      toast.success('¡Sesión iniciada con éxito!');
      navigate('/pos');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRegisterFirstAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistering(true);
    try {
      await api.post('/auth/register-first-admin', { username, password });
      toast.success('¡Administrador creado con éxito!');
      await login(username, password);
      toast.success('¡Sesión iniciada!');
      navigate('/pos');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al registrar administrador');
    } finally {
      setRegistering(false);
    }
  };

  if (checkLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-tr from-slate-100 via-white to-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
        {/* Decorative background radial glows */}
        <div className="absolute top-[-30%] left-[-20%] w-[70%] h-[70%] rounded-full bg-rose-500/5 blur-[140px] pointer-events-none" />
        <div className="absolute bottom-[-30%] right-[-20%] w-[70%] h-[70%] rounded-full bg-slate-200/20 blur-[140px] pointer-events-none" />

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }} 
          animate={{ opacity: 1, scale: 1 }} 
          className="relative z-10 w-full max-w-md card p-8 bg-white border border-slate-200/80 shadow-2xl text-center flex flex-col items-center gap-6"
        >
          <div className="p-1 bg-white rounded-2xl shadow-xl border-4 border-rose-500/20">
            <GoDeliveryLogo className="w-20 h-20" />
          </div>
          
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">Preparando tu terminal</h2>
            <p className="text-rose-600 text-[10px] text-center font-extrabold uppercase tracking-widest flex items-center justify-center gap-1.5">
              <span>Cargando sistema POS</span>
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
            </p>
          </div>

          <div className="w-full bg-slate-50 p-6 rounded-2xl border border-slate-200/50 flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-rose-600 animate-spin" />
            <div className="space-y-1 text-center">
              <p className="text-slate-700 text-xs font-bold leading-normal px-2">
                {loadingMessage}
              </p>
              <p className="text-[10px] text-slate-400 font-semibold">
                Por favor, no cierres la aplicación
              </p>
            </div>
          </div>

          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden relative">
            <motion.div 
              initial={{ left: "-100%" }} 
              animate={{ left: "100%" }} 
              transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }} 
              className="absolute top-0 bottom-0 w-1/3 bg-rose-500 rounded-full" 
            />
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-tr from-slate-100 via-white to-slate-50 flex items-center justify-center relative overflow-hidden">
      {/* Decorative background glassmorphism radial glows */}
      <div className="absolute top-[-30%] left-[-20%] w-[70%] h-[70%] rounded-full bg-rose-500/5 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-30%] right-[-20%] w-[70%] h-[70%] rounded-full bg-slate-200/20 blur-[140px] pointer-events-none" />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative z-10 w-full max-w-md px-6">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1 }} className="text-center mb-8 flex flex-col items-center gap-4">
          <div className="p-1 bg-white rounded-2xl shadow-2xl border-4 border-rose-500/20">
            <GoDeliveryLogo className="w-20 h-20" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight mb-0.5 leading-none">GO! Portal</h1>
            <p className="text-[10px] text-rose-600 font-extrabold tracking-widest uppercase flex items-center justify-center gap-1.5 mt-2">
              <span>Sincronizado con GoDelivery</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            </p>
          </div>
        </motion.div>
 
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card p-8 bg-white border border-slate-200/80 shadow-2xl text-slate-800">
            {!isInitialized ? (
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center border border-amber-500/20">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-800 tracking-tight">Configurar Administrador</h2>
                </div>
                <p className="text-xs text-slate-500 mb-6 font-medium leading-relaxed">
                  Esta es la primera vez que se inicia el sistema. Debes crear una cuenta de administrador inicial obligatoria para poder acceder.
                </p>
 
                <form onSubmit={handleRegisterFirstAdmin} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 ml-1">Usuario (ADMIN)</label>
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value.toUpperCase())} placeholder="Ej: AMIN" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:bg-white focus:border-rose-500 outline-none text-slate-800 transition-all font-semibold" required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 ml-1">Contraseña (Solo números)</label>
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ej: 1234" className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-4 pr-12 py-3 text-sm focus:bg-white focus:border-rose-500 outline-none text-slate-800 transition-all font-semibold" required />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-650 transition-colors">
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  <button type="submit" disabled={registering || !username || !password} className="w-full btn-primary py-3.5 text-base bg-rose-600 hover:bg-rose-750 text-white flex items-center justify-center gap-2 disabled:opacity-50 mt-6 cursor-pointer shadow-lg shadow-rose-500/20 font-bold rounded-2xl">
                    {registering ? <><Loader2 className="w-5 h-5 animate-spin" /> Registrando...</> : 'Crear y Continuar'}
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center border border-rose-500/20">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-800 tracking-tight">Acceso de Empleado</h2>
                </div>
 
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 ml-1">Usuario</label>
                    <input id="login-username" type="text" value={username} onChange={(e) => setUsername(e.target.value.toUpperCase())} placeholder="Ingresá tu usuario" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:bg-white focus:border-rose-500 outline-none text-slate-800 transition-all font-semibold" autoFocus required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 ml-1">Contraseña</label>
                    <div className="relative">
                      <input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ingresá tu contraseña" className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-4 pr-12 py-3 text-sm focus:bg-white focus:border-rose-500 outline-none text-slate-800 transition-all font-semibold" required />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-650 transition-colors">
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  <button id="login-submit" type="submit" disabled={isLoading || !username || !password} className="w-full btn-primary py-3.5 text-base bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center gap-2 disabled:opacity-50 mt-6 cursor-pointer shadow-lg shadow-rose-500/20 font-bold rounded-2xl">
                    {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Ingresando...</> : 'Iniciar Turno'}
                  </button>
                </form>
              </div>
            )}
        </motion.div>
        <p className="text-center text-slate-400/60 text-[10px] font-bold uppercase tracking-widest mt-8">© 2026 GO! Portal POS — v2.0</p>
      </motion.div>
    </div>
  );
}

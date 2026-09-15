import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { motion, AnimatePresence } from 'framer-motion';

import { ShoppingBag, Eye, EyeOff, Loader2, ShieldCheck, UserCheck, UserPlus, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { MangoLogo } from '../common/MangoLogo';

const perfMode = typeof window !== 'undefined' && localStorage.getItem('performance_mode') === 'true';
const MotionDiv = (perfMode ? 'div' : motion.div) as any;
const fadeUp = perfMode ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } };
const staggerParent = perfMode ? {} : {
  initial: 'hidden', animate: 'visible',
  variants: { hidden: {}, visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } }
};
const staggerItem = perfMode ? {} : {
  variants: { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } } }
};

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isInitialized, setIsInitialized] = useState(true);
  const [checkLoading, setCheckLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [showBackToSetup, setShowBackToSetup] = useState(false);

  const [loadingMessage, setLoadingMessage] = useState('Iniciando servidores locales...');

  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    const rawHost = window.location.hostname;
    const isLocalDesktopContext = !rawHost || rawHost === 'localhost' || rawHost === '127.0.0.1' || rawHost.includes('tauri') || rawHost.endsWith('.localhost');
    // Only show "back to server selection" when the user actually went through
    // that screen (desktop app choosing Iniciar Servidor / Conectar Cliente) —
    // irrelevant on the public web/demo deployment, which has no /setup flow.
    setShowBackToSetup(isLocalDesktopContext && !!localStorage.getItem('connection_mode'));

    // Deployed as a normal website: the backend is the same origin that served this
    // page (see services/api.ts), so just ask it directly instead of port-scanning
    // http://<domain>:3001-3005 — that scan can never succeed off a real domain and
    // used to leave this screen "loading" for up to 150 seconds before falling back.
    if (!isLocalDesktopContext) {
      Promise.all([
        api.get('/auth/init-status').then(({ data }) => setIsInitialized(data.initialized)),
        api.get('/system/info').then(({ data }) => setIsDemo(!!data.isDemo)).catch(() => {}),
      ])
        .catch(() => setIsInitialized(true))
        .finally(() => setCheckLoading(false));
      return;
    }

    let retries = 0;
    const maxRetries = 150; // Extended retries for slow systems/first extract

    const detectPortAndCheckInit = async () => {
      const savedPort = sessionStorage.getItem('active_backend_port');
      const basePorts = [3001, 3002, 3003, 3004, 3005];
      const portsToTry = savedPort ? Array.from(new Set([parseInt(savedPort), ...basePorts])) : basePorts;

      const host = '127.0.0.1';

      for (const p of portsToTry) {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 200); // Fast 200ms ping
          const response = await fetch(`http://${host}:${p}/api/auth/init-status`, { signal: controller.signal });
          clearTimeout(id);
          
          if (response.ok) {
            const data = await response.json();
            console.log(`[Frontend] Successfully connected to backend on port: ${p}`);
            sessionStorage.setItem('active_backend_port', p.toString());
            setIsInitialized(data.initialized);
            setCheckLoading(false);
 
            // Fetch local IP (show toast with connection address if server mode)
            try {
              const infoRes = await fetch(`http://${host}:${p}/api/system/info`);
              if (infoRes.ok) {
                const infoData = await infoRes.json();
                console.log(`[Frontend] Server local IP detected: ${infoData.localIp}`);
                const isServerMode = localStorage.getItem('connection_mode') !== 'CLIENT';
                if (isServerMode && infoData.localIp && infoData.localIp !== 'localhost') {
                  toast.success(
                    `Servidor iniciado. Conexión en red: http://${infoData.localIp}:${p}`, 
                    { duration: 8000, id: 'server-started-toast' }
                  );
                }
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

  const handleDemoLogin = async () => {
    setDemoLoading(true);
    try {
      await login('ADMIN', '1234');
      navigate('/pos');
    } catch (err: any) {
      toast.error(err.message || 'No se pudo entrar a la demo');
    } finally {
      setDemoLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password);
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
        {!perfMode && (
          <>
            <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-rose-200/25 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-amber-200/20 blur-3xl pointer-events-none" />
          </>
        )}
        <MotionDiv
          {...(perfMode ? {} : { initial: { opacity: 0, scale: 0.96, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 }, transition: { duration: 0.35, ease: 'easeOut' } })}
          className="relative z-10 w-full max-w-md card p-8 bg-white border border-slate-400/80 shadow-2xl text-center flex flex-col items-center gap-6"
        >
          <MotionDiv {...staggerParent} className="flex flex-col items-center gap-6 w-full">
            <MotionDiv {...staggerItem} className={perfMode ? '' : 'boot-halo'}>
              <MangoLogo className={`w-16 h-16 relative z-10 ${perfMode ? '' : 'boot-halo__logo'}`} />
            </MotionDiv>

            <MotionDiv {...staggerItem} className="space-y-2">
              <h2 className="text-xl font-bold text-slate-800 tracking-tight">Preparando tu terminal</h2>
              <p className="text-rose-600 text-[10px] text-center font-extrabold uppercase tracking-widest flex items-center justify-center gap-1.5">
                <span>Cargando sistema POS</span>
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
              </p>
            </MotionDiv>

            <MotionDiv {...staggerItem} className="w-full bg-slate-50 p-6 rounded-2xl border border-slate-400/50 flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 text-rose-600 animate-spin" />
              <div className="space-y-1 text-center">
                {perfMode ? (
                  <p className="text-slate-700 text-xs font-bold leading-normal px-2">{loadingMessage}</p>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={loadingMessage}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="text-slate-700 text-xs font-bold leading-normal px-2"
                    >
                      {loadingMessage}
                    </motion.p>
                  </AnimatePresence>
                )}
                <p className="text-[10px] text-slate-600 font-semibold">
                  Por favor, no cierres la aplicación
                </p>
              </div>
            </MotionDiv>

            <MotionDiv {...staggerItem} className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden relative">
              {/* Progress-bar motion is cheap (one element) so it always animates,
                  even in performance mode — only the heavier entrance stagger is gated. */}
              <motion.div
                className="absolute top-0 bottom-0 w-1/3 rounded-full bg-gradient-to-r from-rose-400 via-rose-600 to-rose-400 bg-[length:200%_100%]"
                animate={{ left: ['-33%', '100%'], backgroundPosition: ['0% 0%', '200% 0%'] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              />
            </MotionDiv>
          </MotionDiv>
        </MotionDiv>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center relative overflow-hidden">
      {!perfMode && (
        <>
          <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-rose-200/25 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-amber-200/20 blur-3xl pointer-events-none" />
        </>
      )}

      {showBackToSetup && (
        <button
          type="button"
          onClick={() => { localStorage.removeItem('server_ip'); localStorage.removeItem('connection_mode'); navigate('/setup'); }}
          className="absolute top-5 left-5 z-20 flex items-center gap-1.5 text-slate-500 hover:text-rose-600 text-[11px] font-bold cursor-pointer transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Cambiar servidor
        </button>
      )}
      <MotionDiv {...staggerParent} className="relative z-10 w-full max-w-md px-6">
        <MotionDiv {...staggerItem} className="text-center mb-8 flex flex-col items-center gap-3">
          <MangoLogo className="w-16 h-16" />
          <div>
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight mb-0.5 leading-none">Ventra</h1>
            <p className="text-[10px] text-rose-600 font-extrabold tracking-widest uppercase flex items-center justify-center gap-1.5 mt-2">
              <span>Conectado a tu tienda online</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            </p>
          </div>
        </MotionDiv>

        <MotionDiv {...staggerItem} className="card p-8 bg-white border border-slate-400/80 shadow-2xl text-slate-800 w-full">
            {!isInitialized ? (
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center border border-amber-500/20">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-800 tracking-tight">Configurar Administrador</h2>
                </div>
                <p className="text-xs text-slate-700 mb-6 font-medium leading-relaxed">
                  Esta es la primera vez que se inicia el sistema. Debes crear una cuenta de administrador inicial obligatoria para poder acceder.
                </p>
 
                <form onSubmit={handleRegisterFirstAdmin} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 ml-1">Usuario (ADMIN)</label>
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value.toUpperCase())} placeholder="Ej: ADMIN" className="w-full bg-slate-50 border border-slate-400 rounded-2xl px-4 py-3 text-sm focus:bg-white focus:border-rose-500 outline-none text-slate-800 transition-all font-semibold" required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 ml-1">Contraseña (Solo números)</label>
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ej: 1234" className="w-full bg-slate-50 border border-slate-400 rounded-2xl pl-4 pr-12 py-3 text-sm focus:bg-white focus:border-rose-500 outline-none text-slate-800 transition-all font-semibold" required />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-650 transition-colors">
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
                {isDemo && (
                  <div className="mb-6 pb-6 border-b border-dashed border-slate-300">
                    <button
                      type="button"
                      onClick={handleDemoLogin}
                      disabled={demoLoading}
                      className="w-full btn-primary py-3.5 text-base bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-lg shadow-rose-500/20 font-bold rounded-2xl"
                    >
                      {demoLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Entrando...</> : 'Entrar a la demo (un clic)'}
                    </button>
                    <p className="text-center text-[10px] text-slate-600 font-semibold mt-2.5">
                      Sin registro. Usuario de prueba: <span className="font-mono font-bold">ADMIN</span> / <span className="font-mono font-bold">1234</span>
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center border border-rose-500/20">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-800 tracking-tight">{isDemo ? 'O ingresá manualmente' : 'Acceso de Empleado'}</h2>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 ml-1">Usuario</label>
                    <input id="login-username" type="text" value={username} onChange={(e) => setUsername(e.target.value.toUpperCase())} placeholder="Ingresá tu usuario" className="w-full bg-slate-50 border border-slate-400 rounded-2xl px-4 py-3 text-sm focus:bg-white focus:border-rose-500 outline-none text-slate-800 transition-all font-semibold" autoFocus required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 ml-1">Contraseña</label>
                    <div className="relative">
                      <input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ingresá tu contraseña" className="w-full bg-slate-50 border border-slate-400 rounded-2xl pl-4 pr-12 py-3 text-sm focus:bg-white focus:border-rose-500 outline-none text-slate-800 transition-all font-semibold" required />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-650 transition-colors">
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
        </MotionDiv>
        <MotionDiv {...staggerItem} className="text-center text-slate-600/60 text-[10px] font-bold uppercase tracking-widest mt-8">© 2026 Ventra POS — v2.0</MotionDiv>
      </MotionDiv>
    </div>
  );
}

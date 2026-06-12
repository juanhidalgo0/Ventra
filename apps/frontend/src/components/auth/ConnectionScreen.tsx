import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Server, Monitor, Globe, ChevronRight, Loader2, Wifi, WifiOff } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import axios from 'axios';

// Premium SVG Go! Delivery Logo
export function GoDeliveryLogo({ className = 'w-20 h-20' }: { className?: string }) {
  return (
    <img src="./godelivery-logo.jpg" className={`${className} rounded-full object-cover`} alt="GoDelivery" />
  );
}

// Custom promiseAny helper to avoid target environment mismatch
function promiseAny<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let rejectedCount = 0;
    const errors: any[] = [];
    if (promises.length === 0) {
      reject(new Error('No promises provided'));
      return;
    }
    promises.forEach((p, index) => {
      Promise.resolve(p).then(
        (val) => resolve(val),
        (err) => {
          errors[index] = err;
          rejectedCount++;
          if (rejectedCount === promises.length) {
            reject(new Error('All promises rejected'));
          }
        }
      );
    });
  });
}

export default function ConnectionScreen() {
  const [mode, setMode] = useState<'SELECT' | 'CLIENT'>('SELECT');
  const [ip, setIp] = useState(() => localStorage.getItem('saved_client_ip') || '');
  const [isTesting, setIsTesting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    const silentAutoDetect = async () => {
      // 1. If we loaded the page from a remote host (e.g. they typed the server IP to open it)
      const host = window.location.hostname;
      if (host && host !== 'localhost' && host !== '127.0.0.1' && !host.includes('tauri') && !host.endsWith('.localhost')) {
        try {
          const testApi = axios.create({ baseURL: `http://${host}:3001/api`, timeout: 1500 });
          await testApi.get('/system/info');
          if (!active) return;
          localStorage.setItem('server_ip', host);
          localStorage.setItem('saved_client_ip', host);
          localStorage.setItem('connection_mode', 'CLIENT');
          toast.success(`Conectado automáticamente al servidor: ${host}`);
          navigate('/login');
          return;
        } catch {}
      }
    };

    silentAutoDetect();

    return () => {
      active = false;
    };
  }, [navigate]);

  const handleAutoDetect = async () => {
    setIsScanning(true);
    
    // 1. Try checking localhost:3001
    try {
      const testApi = axios.create({ baseURL: 'http://localhost:3001/api', timeout: 1000 });
      await testApi.get('/system/info');
      localStorage.setItem('server_ip', 'localhost');
      localStorage.setItem('connection_mode', 'SERVER');
      toast.success('¡Servidor local detectado y conectado!');
      navigate('/login');
      return;
    } catch {}

    // 2. Try checking last saved client IP
    const savedIp = localStorage.getItem('saved_client_ip');
    if (savedIp) {
      try {
        const testApi = axios.create({ baseURL: `http://${savedIp}:3001/api`, timeout: 1200 });
        await testApi.get('/system/info');
        localStorage.setItem('server_ip', savedIp);
        localStorage.setItem('connection_mode', 'CLIENT');
        toast.success(`Conectado a la última IP: ${savedIp}`);
        navigate('/login');
        return;
      } catch {}
    }

    // 3. Scan local subnets in parallel (Magical Subnet Scan!)
    const commonSubnets = ['192.168.1', '192.168.0'];
    const promises: Promise<string>[] = [];

    for (const subnet of commonSubnets) {
      for (let i = 1; i <= 254; i++) {
        const targetIp = `${subnet}.${i}`;
        promises.push(
          (async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1200);
            try {
              const res = await fetch(`http://${targetIp}:3001/api/system/info`, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (res.ok) return targetIp;
            } catch {
              clearTimeout(timeoutId);
            }
            throw new Error();
          })()
        );
      }
    }

    try {
      const detectedIp = await promiseAny(promises);
      localStorage.setItem('server_ip', detectedIp);
      localStorage.setItem('saved_client_ip', detectedIp);
      localStorage.setItem('connection_mode', 'CLIENT');
      toast.success(`¡Servidor detectado y conectado: ${detectedIp}!`);
      navigate('/login');
    } catch {
      toast.error('No se encontró ningún servidor activo en la red local. Configura la IP manualmente.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleStartLocal = () => {
    localStorage.setItem('server_ip', 'localhost');
    localStorage.setItem('connection_mode', 'SERVER');
    toast.success('Modo Servidor iniciado');
    navigate('/login');
  };

  const handleConnectClient = async () => {
    if (!ip) { toast.error('Ingresá una IP válida'); return; }
    setIsTesting(true);
    try {
      // Temporarily set IP to test connection
      localStorage.setItem('server_ip', ip);
      localStorage.setItem('saved_client_ip', ip); // Save to pre-fill on next startup
      await api.get('/system/info');
      localStorage.setItem('connection_mode', 'CLIENT');
      toast.success('Conexión exitosa');
      navigate('/login');
    } catch (err) {
      toast.error('No se pudo conectar al servidor. Verificá la IP y que el servidor esté corriendo.');
      localStorage.removeItem('server_ip');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-gradient-to-tr from-slate-100 via-white to-slate-50 flex items-center justify-center p-3 sm:p-4 relative overflow-hidden select-none">
      {/* Decorative background glassmorphism effects */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-rose-500/5 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-slate-200/20 blur-[140px] pointer-events-none" />
 
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-xl">
        <div className="text-center mb-4 sm:mb-5 flex flex-col items-center gap-2">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }} 
            animate={{ scale: 1, opacity: 1 }} 
            transition={{ delay: 0.1 }}
            className="p-1 bg-white rounded-xl shadow-md border border-rose-500/10"
          >
            <GoDeliveryLogo className="w-12 h-12 sm:w-14 sm:h-14" />
          </motion.div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight leading-none mb-1">GO! Portal</h1>
            <p className="text-rose-600 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-1.5">
               <span>Terminal de Ventas</span>
               <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
            </p>
          </div>
        </div>
 
        {isScanning ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="card p-4 sm:p-6 max-w-sm mx-auto bg-white shadow-lg border border-slate-200 text-slate-800 text-center flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center border border-rose-500/20">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 mb-1 tracking-tight">Escaneando red local...</h2>
              <p className="text-[11px] font-medium text-slate-500 leading-relaxed max-w-[260px]">
                Buscando automáticamente un servidor activo del POS en tu red local. Por favor, espera un momento.
              </p>
            </div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden relative">
              <motion.div 
                initial={{ left: "-100%" }} 
                animate={{ left: "100%" }} 
                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }} 
                className="absolute top-0 bottom-0 w-1/3 bg-rose-500 rounded-full" 
              />
            </div>
            <button 
              onClick={() => setIsScanning(false)} 
              className="text-[9px] font-bold uppercase tracking-wider text-rose-600 hover:text-rose-700 mt-1 hover:underline cursor-pointer"
            >
              Cancelar escaneo automático
            </button>
          </motion.div>
        ) : mode === 'SELECT' ? (
          <div className="space-y-3 sm:space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              <motion.button 
                whileHover={{ y: -3, scale: 1.01 }} 
                onClick={handleStartLocal}
                className="card p-4 sm:p-5 text-left hover:border-rose-500 group bg-white transition-all duration-300 shadow-md border border-slate-200/80 text-slate-800 flex flex-col justify-between min-h-[140px] sm:min-h-[180px]"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center mb-3 group-hover:bg-rose-600 group-hover:text-white transition-all shadow-md">
                    <Server className="w-5 h-5" />
                  </div>
                  <h2 className="text-base font-bold text-slate-800 mb-1 tracking-tight">Iniciar Servidor</h2>
                  <p className="text-slate-500 text-[11px] font-medium leading-normal">
                    Esta PC actuará como el servidor central de la tienda, guardando la base de datos local y sincronizando.
                  </p>
                </div>
                <div className="flex items-center text-rose-600 group-hover:text-rose-500 font-extrabold text-xs gap-0.5 mt-3">
                  Comenzar <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </motion.button>
    
              <motion.button 
                whileHover={{ y: -3, scale: 1.01 }} 
                onClick={() => setMode('CLIENT')}
                className="card p-4 sm:p-5 text-left hover:border-rose-500 group bg-white transition-all duration-300 shadow-md border border-slate-200/80 text-slate-800 flex flex-col justify-between min-h-[140px] sm:min-h-[180px]"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center mb-3 group-hover:bg-rose-600 group-hover:text-white transition-all shadow-md">
                    <Globe className="w-5 h-5" />
                  </div>
                  <h2 className="text-base font-bold text-slate-800 mb-1 tracking-tight">Conectar Cliente</h2>
                  <p className="text-slate-500 text-[11px] font-medium leading-normal">
                    Conectarse a un servidor del POS existente en la red local. Ideal para terminales adicionales de ventas.
                  </p>
                </div>
                <div className="flex items-center text-rose-600 group-hover:text-rose-500 font-extrabold text-xs gap-0.5 mt-3">
                  Configurar IP <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </motion.button>
            </div>
 
            <motion.button 
              whileHover={{ y: -3, scale: 1.005 }} 
              onClick={handleAutoDetect}
              className="w-full card p-3 sm:p-4 text-left hover:border-rose-500 group bg-white transition-all duration-300 shadow-md border border-slate-200/80 text-slate-800 flex items-center gap-3 sm:gap-4 cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-all shadow-md shrink-0">
                <Wifi className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-slate-800 mb-0.5 tracking-tight">Buscar Servidor Automáticamente</h2>
                <p className="text-slate-500 text-[11px] font-medium leading-normal">
                  Escanear la red Wi-Fi/cableada local en busca de un servidor activo para conectarte al instante.
                </p>
              </div>
              <div className="flex items-center text-emerald-600 group-hover:text-emerald-500 font-extrabold text-xs gap-0.5 shrink-0">
                Detectar <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </motion.button>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, x: 15 }} animate={{ opacity: 1, x: 0 }} className="card p-4 sm:p-6 max-w-sm mx-auto bg-white shadow-lg border border-slate-200 text-slate-800">
            <button onClick={() => setMode('SELECT')} className="text-[10px] font-bold uppercase tracking-wider text-rose-600 hover:text-rose-700 mb-4 flex items-center gap-0.5">
              ← Volver atrás
            </button>
            <h2 className="text-lg font-bold text-slate-800 mb-1 tracking-tight">Conectar al Servidor</h2>
            <p className="text-[11px] font-medium text-slate-500 mb-4">Ingresá la dirección IP de la PC que está actuando como servidor del POS.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[9px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 ml-0.5">Dirección IP del Servidor</label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={ip} 
                    onChange={(e) => setIp(e.target.value)} 
                    placeholder="Ej: 192.168.0.15" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-3.5 pr-10 py-2.5 text-base font-mono tracking-wider focus:bg-white focus:border-rose-500 outline-none text-slate-800 transition-all" 
                    autoFocus 
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {ip ? <Wifi className="w-4 h-4 text-rose-600" /> : <WifiOff className="w-4 h-4 text-slate-300" />}
                  </div>
                </div>
              </div>
              
              <button 
                onClick={handleConnectClient} 
                disabled={isTesting || !ip}
                className="w-full btn-primary py-3 text-sm bg-rose-600 hover:bg-rose-700 text-white shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isTesting ? <><Loader2 className="w-4 h-4 animate-spin" /> Conectando...</> : 'Probar Conexión'}
              </button>
              
              <p className="text-center text-[9px] font-bold text-slate-400">
                Asegurate de que ambas PCs estén en la misma red Wi-Fi o cableada.
              </p>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

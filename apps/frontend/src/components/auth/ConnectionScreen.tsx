import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

import { Server, Globe, ChevronRight, Loader2, Wifi, WifiOff, X } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import axios from 'axios';
import { MangoLogo } from '../common/MangoLogo';

export const GoDeliveryLogo = MangoLogo;

const SCAN_PORT = 3001;
const PER_IP_TIMEOUT_MS = 900;
const BATCH_SIZE = 40;
const HARD_SCAN_TIMEOUT_MS = 15000; // Never let a scan feel "stuck" forever

export default function ConnectionScreen() {
  const [mode, setMode] = useState<'SELECT' | 'CLIENT'>('SELECT');
  const [ip, setIp] = useState(() => localStorage.getItem('saved_client_ip') || '');
  const [isTesting, setIsTesting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [foundServers, setFoundServers] = useState<string[]>([]);
  const navigate = useNavigate();

  // Every async connection attempt (scan or manual) is tagged with the current
  // operationId. If the user cancels, switches screens, or starts a different
  // attempt, the id changes — any older attempt that resolves later checks its
  // captured id against the ref and silently no-ops instead of navigating or
  // updating state out from under the user. This is what was causing both
  // reported bugs: a stale scan/connect finishing late and hijacking the UI.
  const operationId = useRef(0);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      operationId.current++; // invalidate anything still in flight
    };
  }, []);

  const connectToServer = (detectedIp: string, myOpId: number) => {
    if (!isMounted.current || myOpId !== operationId.current) return;
    localStorage.setItem('server_ip', detectedIp);
    localStorage.setItem('saved_client_ip', detectedIp);
    localStorage.setItem('connection_mode', 'CLIENT');
    navigate('/login');
  };

  useEffect(() => {
    const myOpId = ++operationId.current;

    const silentAutoDetect = async () => {
      const host = window.location.hostname;
      if (host && host !== 'localhost' && host !== '127.0.0.1' && !host.includes('tauri') && !host.endsWith('.localhost')) {
        try {
          const testApi = axios.create({ baseURL: `${window.location.origin}/api`, timeout: 1500 });
          await testApi.get('/system/info');
          if (!isMounted.current || myOpId !== operationId.current) return;
          const hostWithPort = window.location.port ? `${host}:${window.location.port}` : host;
          localStorage.setItem('server_ip', hostWithPort);
          localStorage.setItem('saved_client_ip', hostWithPort);
          localStorage.setItem('connection_mode', 'CLIENT');
          navigate('/login');
          return;
        } catch {
          try {
            const testApi = axios.create({ baseURL: `http://${host}:${SCAN_PORT}/api`, timeout: 1500 });
            await testApi.get('/system/info');
            if (!isMounted.current || myOpId !== operationId.current) return;
            localStorage.setItem('server_ip', host);
            localStorage.setItem('saved_client_ip', host);
            localStorage.setItem('connection_mode', 'CLIENT');
            navigate('/login');
            return;
          } catch {}
        }
      }
    };

    silentAutoDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAutoDetect = async () => {
    const myOpId = ++operationId.current;
    setFoundServers([]);
    setIsScanning(true);
    setScanProgress({ done: 0, total: 0 });

    const hardTimeout = setTimeout(() => {
      if (myOpId === operationId.current) {
        operationId.current++; // invalidate this attempt
        if (isMounted.current) {
          setIsScanning(false);
          toast.error('La búsqueda tardó demasiado y se canceló. Probá conectarte manualmente con la IP del servidor.');
        }
      }
    }, HARD_SCAN_TIMEOUT_MS);

    try {
      let localSubnet = '';
      let myLocalIp = '';
      for (const port of [SCAN_PORT, 3002, 3003, 3004, 3005]) {
        try {
          const infoRes = await fetch(`http://127.0.0.1:${port}/api/system/info`);
          if (infoRes.ok) {
            const infoData = await infoRes.json();
            if (infoData.localIp && infoData.localIp !== 'localhost') {
              myLocalIp = infoData.localIp;
              const parts = infoData.localIp.split('.');
              if (parts.length === 4) localSubnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
              break;
            }
          }
        } catch {}
        if (myOpId !== operationId.current) return;
      }

      // Scan the machine's own detected subnet first (fast path — this covers
      // the overwhelming majority of real setups). Only fall back to guessing
      // other common subnets if that first pass finds nothing.
      const subnetsToTry = localSubnet ? [localSubnet] : [];
      const fallbackSubnets = ['192.168.1', '192.168.0', '192.168.100'].filter(s => s !== localSubnet);

      const checkIp = async (targetIp: string) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), PER_IP_TIMEOUT_MS);
        try {
          const res = await fetch(`http://${targetIp}:${SCAN_PORT}/api/system/info`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok) return targetIp;
        } catch {
          clearTimeout(timeoutId);
        }
        throw new Error();
      };

      const scanSubnets = async (subnets: string[]) => {
        const ipsToScan: string[] = [];
        for (const subnet of subnets) {
          for (let i = 1; i <= 254; i++) {
            const targetIp = `${subnet}.${i}`;
            if (targetIp === myLocalIp) continue;
            ipsToScan.push(targetIp);
          }
        }
        setScanProgress(prev => ({ done: prev.done, total: prev.total + ipsToScan.length }));

        const found: string[] = [];
        for (let i = 0; i < ipsToScan.length; i += BATCH_SIZE) {
          if (myOpId !== operationId.current) return found;
          const batch = ipsToScan.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(candidateIp => checkIp(candidateIp).then(
            (val) => { found.push(val); },
            () => {}
          )));
          setScanProgress(prev => ({ ...prev, done: prev.done + batch.length }));
        }
        return found;
      };

      let validIps = subnetsToTry.length ? await scanSubnets(subnetsToTry) : [];
      if (myOpId !== operationId.current) return;

      if (validIps.length === 0 && fallbackSubnets.length > 0) {
        const more = await scanSubnets(fallbackSubnets);
        validIps = [...validIps, ...more];
      }
      if (myOpId !== operationId.current) return;

      clearTimeout(hardTimeout);
      setIsScanning(false);

      if (validIps.length === 0) {
        toast.error('No se encontró ningún servidor activo en la red local. Si esta PC es el servidor, elegí "Iniciar Servidor".');
      } else if (validIps.length === 1) {
        connectToServer(validIps[0], myOpId);
      } else {
        setFoundServers(validIps);
      }
    } finally {
      clearTimeout(hardTimeout);
    }
  };

  const cancelScan = () => {
    operationId.current++; // invalidates the in-flight scan so it can never act later
    setIsScanning(false);
  };

  const handleStartLocal = () => {
    operationId.current++;
    localStorage.setItem('server_ip', 'localhost');
    localStorage.setItem('connection_mode', 'SERVER');
    navigate('/login');
  };

  const openClientMode = () => {
    operationId.current++; // invalidate any pending auto-detect before switching
    setIsScanning(false);
    setFoundServers([]);
    setMode('CLIENT');
  };

  const handleConnectClient = async () => {
    if (!ip) { toast.error('Ingresá una IP válida'); return; }
    const myOpId = ++operationId.current;
    setIsTesting(true);
    try {
      localStorage.setItem('server_ip', ip);
      localStorage.setItem('saved_client_ip', ip);
      await api.get('/system/info');
      if (!isMounted.current || myOpId !== operationId.current) return;
      localStorage.setItem('connection_mode', 'CLIENT');
      navigate('/login');
    } catch (err) {
      if (!isMounted.current || myOpId !== operationId.current) return;
      toast.error('No se pudo conectar al servidor. Verificá la IP y que el servidor esté corriendo.');
      localStorage.removeItem('server_ip');
    } finally {
      if (isMounted.current && myOpId === operationId.current) setIsTesting(false);
    }
  };

  const perfMode = localStorage.getItem('performance_mode') === 'true';
  const scanPct = scanProgress.total > 0 ? Math.min(100, Math.round((scanProgress.done / scanProgress.total) * 100)) : 0;

  return (
    <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-3 sm:p-4 relative overflow-hidden select-none">
      {!perfMode && (
        <>
          <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-rose-200/25 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-amber-200/20 blur-3xl pointer-events-none" />
        </>
      )}

      <motion.div
        {...(perfMode ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: 'easeOut' } })}
        className="relative z-10 w-full max-w-xl"
      >
        <motion.div
          {...(perfMode ? {} : { initial: { opacity: 0, y: -6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: 0.05, ease: 'easeOut' } })}
          className="text-center mb-5 sm:mb-6 flex flex-col items-center gap-2.5"
        >
          <div className={`p-1 bg-white rounded-2xl ${perfMode ? 'border border-slate-200' : 'shadow-lg shadow-rose-500/10'}`}>
            <GoDeliveryLogo className="w-12 h-12 sm:w-14 sm:h-14" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight leading-none mb-1.5">Ventra</h1>
            <p className="text-rose-700 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-1.5">
               <span>Terminal de Ventas</span>
               <span className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${!perfMode ? 'animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)]' : ''}`} />
            </p>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {foundServers.length > 0 ? (
            <motion.div key="found" {...(perfMode ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.25 } })} className="card p-5 sm:p-8 bg-white border border-slate-200 rounded-3xl shadow-xl flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100">
                <Server className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800 mb-1 tracking-tight">Se encontraron varios servidores</h2>
                <p className="text-[11px] font-medium text-slate-500 leading-relaxed max-w-[280px]">
                  Elegí a cuál conectarte:
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full mt-1">
                {foundServers.map(s => (
                  <button
                    key={s}
                    onClick={() => connectToServer(s, operationId.current)}
                    className="p-3 border border-slate-200 rounded-xl hover:border-rose-400 hover:bg-rose-50/50 text-slate-700 font-bold transition-all shadow-sm active:scale-[0.98] cursor-pointer"
                  >
                    Conectar a {s}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setFoundServers([])}
                className="text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 mt-1 hover:underline cursor-pointer"
              >
                Cancelar
              </button>
            </motion.div>
          ) : isScanning ? (
            <motion.div key="scanning" {...(perfMode ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.25 } })} className="card p-5 sm:p-8 bg-white border border-slate-200 rounded-3xl shadow-xl flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100 relative">
                <span className="absolute inset-1 rounded-2xl border border-rose-400/50 animate-ping" />
                <span className="absolute inset-1 rounded-2xl border border-rose-400/30 animate-ping [animation-delay:0.6s]" />
                <Wifi className="w-6 h-6 relative z-10" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800 mb-1 tracking-tight">Escaneando red local...</h2>
                <p className="text-[11px] font-medium text-slate-500 leading-relaxed max-w-[280px]">
                  Buscando un servidor Ventra activo en tu red. Esto puede tardar unos segundos.
                </p>
              </div>
              <div className="w-full">
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden relative mb-1.5">
                  <motion.div
                    className="h-full bg-rose-600 rounded-full"
                    animate={{ width: `${scanPct}%` }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  />
                </div>
                {scanProgress.total > 0 && (
                  <p className="text-[10px] font-mono font-bold text-slate-400">{scanProgress.done} / {scanProgress.total} direcciones</p>
                )}
              </div>
              <button
                onClick={cancelScan}
                className="text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:text-rose-600 mt-1 flex items-center gap-1 hover:underline cursor-pointer"
              >
                <X className="w-3 h-3" /> Cancelar escaneo
              </button>
            </motion.div>
          ) : mode === 'SELECT' ? (
            <motion.div key="select" className="space-y-3 sm:space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <motion.button
                  initial={perfMode ? false : { opacity: 0, y: 14 }}
                  animate={perfMode ? false : { opacity: 1, y: 0 }}
                  transition={perfMode ? undefined : { duration: 0.35, delay: 0.12, ease: 'easeOut' }}
                  whileHover={perfMode ? {} : { y: -3, scale: 1.01 }}
                  onClick={handleStartLocal}
                  className={`card p-4 sm:p-5 text-left group bg-white transition-all duration-300 rounded-3xl ${perfMode ? 'shadow-sm' : 'shadow-md hover:shadow-xl'} border border-slate-200 hover:border-rose-400 text-slate-800 flex flex-col justify-between min-h-[140px] sm:min-h-[180px] cursor-pointer`}
                >
                  <div>
                    <div className={`w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-3 group-hover:bg-rose-600 group-hover:text-white transition-all ${perfMode ? '' : 'shadow-sm'}`}>
                      <Server className="w-5 h-5" />
                    </div>
                    <h2 className="text-base font-bold text-slate-800 mb-1 tracking-tight">Iniciar Servidor</h2>
                    <p className="text-slate-500 text-[11px] font-medium leading-normal">
                      Esta PC actuará como el servidor central de la tienda, guardando la base de datos local.
                    </p>
                  </div>
                  <div className="flex items-center text-rose-600 group-hover:text-rose-500 font-extrabold text-xs gap-0.5 mt-3">
                    Comenzar <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </motion.button>

                <motion.button
                  initial={perfMode ? false : { opacity: 0, y: 14 }}
                  animate={perfMode ? false : { opacity: 1, y: 0 }}
                  transition={perfMode ? undefined : { duration: 0.35, delay: 0.2, ease: 'easeOut' }}
                  whileHover={perfMode ? {} : { y: -3, scale: 1.01 }}
                  onClick={openClientMode}
                  className={`card p-4 sm:p-5 text-left group bg-white transition-all duration-300 rounded-3xl ${perfMode ? 'shadow-sm' : 'shadow-md hover:shadow-xl'} border border-slate-200 hover:border-amber-400 text-slate-800 flex flex-col justify-between min-h-[140px] sm:min-h-[180px] cursor-pointer`}
                >
                  <div>
                    <div className={`w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3 group-hover:bg-amber-600 group-hover:text-white transition-all ${perfMode ? '' : 'shadow-sm'}`}>
                      <Globe className="w-5 h-5" />
                    </div>
                    <h2 className="text-base font-bold text-slate-800 mb-1 tracking-tight">Conectar Cliente</h2>
                    <p className="text-slate-500 text-[11px] font-medium leading-normal">
                      Conectate a un servidor del POS existente. Ideal para terminales adicionales de venta.
                    </p>
                  </div>
                  <div className="flex items-center text-amber-600 group-hover:text-amber-500 font-extrabold text-xs gap-0.5 mt-3">
                    Configurar IP <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </motion.button>
              </div>

              <motion.button
                initial={perfMode ? false : { opacity: 0, y: 14 }}
                animate={perfMode ? false : { opacity: 1, y: 0 }}
                transition={perfMode ? undefined : { duration: 0.35, delay: 0.28, ease: 'easeOut' }}
                onClick={handleAutoDetect}
                className={`w-full group relative overflow-hidden p-4 rounded-2xl border border-slate-200 bg-white hover:border-emerald-400 ${perfMode ? '' : 'hover:shadow-md'} transition-all text-left flex items-center justify-between cursor-pointer`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-all shrink-0">
                    <Wifi className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-bold text-slate-800 mb-0.5 tracking-tight">Buscar Servidor Automáticamente</h2>
                    <p className="text-slate-500 text-[11px] font-medium leading-normal truncate">
                      Escanea tu red local en busca de un servidor activo.
                    </p>
                  </div>
                </div>
                <div className="flex items-center text-emerald-600 group-hover:text-emerald-500 font-extrabold text-xs gap-0.5 shrink-0 ml-2">
                  Detectar <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </motion.button>
            </motion.div>
          ) : (
            <motion.div key="client" {...(perfMode ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.25 } })} className="card p-5 sm:p-8 bg-white border border-slate-200 rounded-3xl shadow-xl">
              <button onClick={() => setMode('SELECT')} className="text-[10px] font-bold uppercase tracking-wider text-amber-700 hover:text-amber-800 mb-4 flex items-center gap-0.5 cursor-pointer">
                ← Volver atrás
              </button>
              <h2 className="text-lg font-bold text-slate-800 mb-1 tracking-tight">Conectar al Servidor</h2>
              <p className="text-[11px] font-medium text-slate-500 mb-4">Ingresá la dirección IP de la PC que está actuando como servidor del POS.</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-[9px] font-bold text-amber-700 uppercase tracking-widest mb-1.5 ml-0.5">Dirección IP del Servidor</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && ip && !isTesting) handleConnectClient(); }}
                      placeholder="Ej: 192.168.0.15"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3.5 pr-10 py-2.5 text-base font-mono tracking-wider focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/15 outline-none text-slate-800 transition-all"
                      autoFocus
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {ip ? <Wifi className="w-4 h-4 text-amber-600" /> : <WifiOff className="w-4 h-4 text-slate-300" />}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleConnectClient}
                  disabled={isTesting || !ip}
                  className="w-full btn-primary py-3 text-sm bg-amber-700 hover:bg-amber-800 text-white shadow-md flex items-center justify-center gap-1.5 cursor-pointer rounded-xl font-bold disabled:opacity-50"
                >
                  {isTesting ? <><Loader2 className="w-4 h-4 animate-spin" /> Conectando...</> : 'Probar Conexión'}
                </button>

                <p className="text-center text-[9px] font-bold text-slate-400">
                  Asegurate de que ambas PCs estén en la misma red Wi-Fi o cableada.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

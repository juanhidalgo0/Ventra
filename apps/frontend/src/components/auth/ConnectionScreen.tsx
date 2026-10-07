import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

import { ArrowLeft, ArrowRight, Loader2, Network, Server, Wifi } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import axios from 'axios';
import { MangoLogo } from '../common/MangoLogo';
import AuthLayout, { authCard, authIconBox, authInput, authLabel, authLead, authPrimaryButton, authSecondaryButton, authTitle } from './AuthLayout';

export const GoDeliveryLogo = MangoLogo;

const SCAN_PORT = 3001;
const PER_IP_TIMEOUT_MS = 900;
const BATCH_SIZE = 40;
const HARD_SCAN_TIMEOUT_MS = 15000; // Never let a scan feel "stuck" forever

type Mode = 'SELECT' | 'CLIENT';

export default function ConnectionScreen() {
  // Se recuerda en la sesión para que un remontaje no devuelva al usuario a la selección
  const [mode, setModeState] = useState<Mode>(() =>
    sessionStorage.getItem('setup_mode') === 'CLIENT' ? 'CLIENT' : 'SELECT');
  const setMode = (m: Mode) => {
    sessionStorage.setItem('setup_mode', m);
    setModeState(m);
  };
  const [ip, setIp] = useState(() => localStorage.getItem('saved_client_ip') || '');
  const [isTesting, setIsTesting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [foundServers, setFoundServers] = useState<string[]>([]);
  // Búsqueda terminada sin resultados: se ofrece reintentar o cargar la dirección a mano
  const [scanFailed, setScanFailed] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const navigate = useNavigate();

  // Every async connection attempt (scan or manual) is tagged with the current
  // operationId. If the user cancels, switches screens, or starts a different
  // attempt, the id changes — any older attempt that resolves later checks its
  // captured id against the ref and silently no-ops instead of navigating or
  // updating state out from under the user.
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
    sessionStorage.removeItem('setup_mode');
    navigate('/login');
  };

  useEffect(() => {
    const myOpId = ++operationId.current;

    const silentAutoDetect = async () => {
      const host = window.location.hostname;
      if (host && host !== 'localhost' && host !== '127.0.0.1' && !host.includes('tauri') && !host.endsWith('.localhost')) {
        try {
          // En la web (Ventra en la nube) la caja puede tardar unos segundos en despertar
          const testApi = axios.create({ baseURL: `${window.location.origin}/api`, timeout: 10000 });
          await testApi.get('/system/info');
          if (!isMounted.current || myOpId !== operationId.current) return;
          const hostWithPort = window.location.port ? `${host}:${window.location.port}` : host;
          localStorage.setItem('server_ip', hostWithPort);
          localStorage.setItem('saved_client_ip', hostWithPort);
          localStorage.setItem('connection_mode', 'CLIENT');
          sessionStorage.removeItem('setup_mode');
          navigate('/login');
          return;
        } catch {
          // Una página https no puede llamar a http:// (el navegador lo bloquea)
          if (window.location.protocol === 'https:') return;
          try {
            const testApi = axios.create({ baseURL: `http://${host}:${SCAN_PORT}/api`, timeout: 1500 });
            await testApi.get('/system/info');
            if (!isMounted.current || myOpId !== operationId.current) return;
            localStorage.setItem('server_ip', host);
            localStorage.setItem('saved_client_ip', host);
            localStorage.setItem('connection_mode', 'CLIENT');
            sessionStorage.removeItem('setup_mode');
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
    setScanFailed(false);
    setShowManual(false);
    setIsScanning(true);
    setScanProgress({ done: 0, total: 0 });

    const hardTimeout = setTimeout(() => {
      if (myOpId === operationId.current) {
        operationId.current++; // invalidate this attempt
        if (isMounted.current) {
          setIsScanning(false);
          setScanFailed(true);
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
        setScanFailed(true);
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
    sessionStorage.removeItem('setup_mode');
    navigate('/login');
  };

  const backToSelect = () => {
    operationId.current++;
    setIsScanning(false);
    setFoundServers([]);
    setScanFailed(false);
    setShowManual(false);
    setMode('SELECT');
  };

  const handleConnectClient = async () => {
    if (!ip.trim()) { toast.error('Escribí la dirección de la otra PC'); return; }
    const myOpId = ++operationId.current;
    setIsTesting(true);
    try {
      localStorage.setItem('server_ip', ip.trim());
      localStorage.setItem('saved_client_ip', ip.trim());
      await api.get('/system/info');
      if (!isMounted.current || myOpId !== operationId.current) return;
      localStorage.setItem('connection_mode', 'CLIENT');
      sessionStorage.removeItem('setup_mode');
      navigate('/login');
    } catch (err) {
      if (!isMounted.current || myOpId !== operationId.current) return;
      toast.error('No pudimos conectarnos con esa dirección. Revisá que la otra PC esté prendida y con Ventra abierto.');
      localStorage.removeItem('server_ip');
    } finally {
      if (isMounted.current && myOpId === operationId.current) setIsTesting(false);
    }
  };

  const perfMode = localStorage.getItem('performance_mode') === 'true';
  const scanPct = scanProgress.total > 0 ? Math.min(100, Math.round((scanProgress.done / scanProgress.total) * 100)) : 0;

  // Caja adicional: escribir la dirección de la caja principal (la búsqueda automática es la fila de abajo)
  const openManual = () => {
    operationId.current++;
    setIsScanning(false);
    setFoundServers([]);
    setScanFailed(false);
    setShowManual(true);
    setMode('CLIENT');
  };
  const openScan = () => {
    setMode('CLIENT');
    handleAutoDetect();
  };

  const enter = perfMode ? {} : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] } };
  const cardIn = (delay: number) => (perfMode ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, delay, ease: [0.2, 0.8, 0.2, 1] } });
  const back = (
    <button onClick={backToSelect} className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-900 mb-5 transition-colors cursor-pointer">
      <ArrowLeft className="w-3.5 h-3.5" /> Volver
    </button>
  );
  const choice = 'group text-left bg-white rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-400 transition-colors cursor-pointer';

  return (
    <AuthLayout wide>
      <div className="select-none">
        <AnimatePresence mode="wait">
          {foundServers.length > 0 ? (
            <motion.div key="found" {...enter} className={`${authCard} max-w-[440px] mx-auto`}>
              {back}
              <h2 className={authTitle}>Encontramos {foundServers.length} PCs con Ventra</h2>
              <p className={authLead}>Elegí la caja principal del local.</p>
              <div className="mt-5 rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden">
                {foundServers.map((s) => (
                  <button key={s} onClick={() => connectToServer(s, operationId.current)}
                    className="group w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors cursor-pointer">
                    <span className={authIconBox}><Server className="w-[18px] h-[18px]" strokeWidth={1.75} /></span>
                    <span className="flex-1">
                      <span className="block text-[14px] font-medium">PC con Ventra</span>
                      <span className="block text-[13px] text-slate-500 font-mono">{s}</span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-900 transition-colors" />
                  </button>
                ))}
              </div>
            </motion.div>
          ) : isScanning ? (
            <motion.div key="scanning" {...enter} className={`${authCard} max-w-[440px] mx-auto`}>
              <h2 className={authTitle}>Buscando la caja principal…</h2>
              <p className={authLead}>Revisamos tu red. Dejá la otra PC prendida y con Ventra abierto.</p>
              <div className="mt-6 h-[3px] w-full bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-slate-900 rounded-full transition-[width] duration-300 ease-out" style={{ width: `${Math.max(4, scanPct)}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between text-[13px] text-slate-500">
                <span className="inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {scanProgress.total > 0 ? `${scanPct}% revisado` : 'Preparando la búsqueda'}</span>
                <button onClick={() => { cancelScan(); setScanFailed(true); }} className="hover:text-slate-900 transition-colors cursor-pointer">Cancelar</button>
              </div>
            </motion.div>
          ) : mode === 'CLIENT' && scanFailed && !showManual ? (
            <motion.div key="failed" {...enter} className={`${authCard} max-w-[440px] mx-auto`}>
              {back}
              <h2 className={authTitle}>No encontramos la caja principal</h2>
              <p className={authLead}>Revisá que la otra PC esté prendida, con Ventra abierto y en la misma red (el mismo Wi‑Fi o router).</p>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button onClick={handleAutoDetect} className={authPrimaryButton}>Buscar de nuevo</button>
                <button onClick={() => setShowManual(true)} className={authSecondaryButton}>Escribir la dirección</button>
              </div>
              <p className="mt-5 text-[13px] text-slate-500">¿Es la única PC del local? <button onClick={handleStartLocal} className="font-medium text-slate-900 underline underline-offset-2 cursor-pointer">Usarla como caja principal</button></p>
            </motion.div>
          ) : mode === 'CLIENT' ? (
            <motion.div key="manual" {...enter} className={`${authCard} max-w-[440px] mx-auto`}>
              {back}
              <h2 className={authTitle}>Conectar a la caja principal</h2>
              <p className={authLead}>Escribí la dirección de la PC principal. La ves en esa PC, en el menú → Acceso remoto.</p>
              <div className="mt-6">
                <label htmlFor="server-ip" className={authLabel}>Dirección</label>
                <input
                  id="server-ip"
                  type="text"
                  inputMode="decimal"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && ip && !isTesting) handleConnectClient(); }}
                  placeholder="192.168.0.15"
                  className={`${authInput} font-mono tabular-nums`}
                  autoFocus
                />
              </div>
              <button onClick={handleConnectClient} disabled={isTesting || !ip.trim()} className={`${authPrimaryButton} mt-4`}>
                {isTesting ? <><Loader2 className="w-4 h-4 animate-spin" /> Conectando…</> : 'Conectar'}
              </button>
              <p className="mt-5 text-[13px] text-slate-500">¿No sabés la dirección? <button onClick={handleAutoDetect} className="font-medium text-slate-900 underline underline-offset-2 cursor-pointer">Buscarla sola en la red</button></p>
            </motion.div>
          ) : (
            <motion.div key="select" className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <motion.button {...cardIn(0.04)} onClick={handleStartLocal} className={`${choice} p-5 flex flex-col justify-between min-h-[172px]`}>
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className={authIconBox}><Server className="w-[18px] h-[18px]" strokeWidth={1.75} /></span>
                      <span className="text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-100 rounded-full px-2 py-px">Recomendado</span>
                    </div>
                    <h2 className="text-[15px] font-semibold text-slate-900">Caja principal</h2>
                    <p className="mt-1 text-[13.5px] text-slate-600 leading-snug">Acá se guardan los productos, las ventas y la caja. Elegila si es la única PC del local o la que ya venías usando.</p>
                  </div>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-900">
                    Comenzar <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </motion.button>

                <motion.button {...cardIn(0.08)} onClick={openManual} className={`${choice} p-5 flex flex-col justify-between min-h-[172px]`}>
                  <div>
                    <div className="mb-4"><span className={authIconBox}><Network className="w-[18px] h-[18px]" strokeWidth={1.75} /></span></div>
                    <h2 className="text-[15px] font-semibold text-slate-900">Caja adicional</h2>
                    <p className="mt-1 text-[13.5px] text-slate-600 leading-snug">Se conecta a la caja principal del local y usa los mismos productos y el mismo stock.</p>
                  </div>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-900">
                    Escribir la dirección <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </motion.button>
              </div>

              <motion.button {...cardIn(0.12)} onClick={openScan} className={`${choice} w-full p-4 flex items-center justify-between gap-3`}>
                <span className="flex items-center gap-3 min-w-0">
                  <span className={authIconBox}><Wifi className="w-[18px] h-[18px]" strokeWidth={1.75} /></span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-slate-900">Buscar la caja principal automáticamente</span>
                    <span className="block text-[13px] text-slate-600">Para una caja adicional: revisa tu red y se conecta sola.</span>
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-900 shrink-0">
                  Buscar <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </motion.button>

              <p className="text-center text-[13px] text-slate-500 pt-2">
                ¿Ya usabas Ventra en esta PC? Elegí <span className="font-medium text-slate-700">Caja principal</span>: tus datos siguen ahí.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AuthLayout>
  );
}

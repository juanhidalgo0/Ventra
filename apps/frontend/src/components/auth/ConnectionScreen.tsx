import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

import { ArrowLeft, ArrowRight, Check, Loader2, Monitor, Network } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import axios from 'axios';
import { MangoLogo } from '../common/MangoLogo';
import { APP_VERSION } from '../../appVersion';

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
  const [focused, setFocused] = useState(0);
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

  // "Ya tengo Ventra en otra PC": se busca sola en la red; la dirección a mano queda de respaldo
  const openClientMode = () => {
    operationId.current++; // invalidate any pending auto-detect before switching
    setFoundServers([]);
    setMode('CLIENT');
    handleAutoDetect();
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

  // Las opciones del primer paso, para recorrerlas con el teclado (↑ ↓ y Enter)
  const options = [
    { key: 'main', title: 'Como caja principal', desc: 'Acá se guardan los productos, las ventas y la caja. Elegila si es la única PC del local o la que ya venías usando.', icon: Monitor, onSelect: handleStartLocal, recommended: true },
    { key: 'other', title: 'Como caja adicional', desc: 'Se conecta a la caja principal del local y usa los mismos productos y el mismo stock. La buscamos sola en tu red.', icon: Network, onSelect: openClientMode, recommended: false },
  ];

  useEffect(() => {
    if (mode !== 'SELECT' || isScanning || foundServers.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocused((f) => Math.min(options.length - 1, f + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setFocused((f) => Math.max(0, f - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); options[focused]?.onSelect(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isScanning, foundServers.length, focused]);

  // Todo lo de esta pantalla es el paso 1; el 2 es el ingreso con usuario
  const step = 1;
  const fade = perfMode ? {} : { initial: { opacity: 0, x: 12 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -12 }, transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] } };

  return (
    <div className="h-screen w-screen flex bg-white text-slate-900 select-none overflow-hidden">
      {/* Panel de marca */}
      <aside className="hidden lg:flex w-[40%] max-w-[560px] shrink-0 flex-col justify-between bg-rose-900 text-white px-12 py-10">
        <div className="flex items-center gap-3">
          <GoDeliveryLogo className="w-9 h-9 rounded-[10px]" />
          <span className="text-[17px] font-semibold tracking-tight">Ventra</span>
        </div>

        <div className="max-w-[400px]">
          <h1 className="text-[34px] leading-[1.15] font-semibold tracking-[-0.02em]">
            Tu caja, tu stock y tus ventas, en un solo lugar.
          </h1>
          <ul className="mt-8 space-y-4 text-[15px] text-rose-100/90">
            {[
              'Cobrás rápido, con lector de códigos y todos los medios de pago.',
              'El stock se actualiza solo con cada venta y cada compra.',
              'Ves cómo va el negocio desde el celular, estés donde estés.',
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <Check className="w-4 h-4 mt-[3px] shrink-0 text-rose-300" strokeWidth={2.5} />
                <span className="leading-snug">{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[13px] text-rose-200/70">Hecho en Argentina para kioscos, almacenes y comercios de barrio.</p>
      </aside>

      {/* Contenido */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-6 sm:px-10 h-16 shrink-0">
          <div className="flex items-center gap-2.5 lg:invisible">
            <GoDeliveryLogo className="w-7 h-7 rounded-lg" />
            <span className="text-[15px] font-semibold tracking-tight">Ventra</span>
          </div>
          <ol className="flex items-center gap-2 text-[13px]" aria-label="Pasos">
            {['Esta PC', 'Ingresar'].map((label, i) => {
              const n = i + 1;
              const done = n < step;
              const active = n === step;
              return (
                <li key={label} className="flex items-center gap-2">
                  {i > 0 && <span className="w-6 h-px bg-slate-200" />}
                  <span className={`w-5 h-5 rounded-full grid place-items-center text-[11px] font-semibold tabular-nums ${active ? 'bg-slate-900 text-white' : done ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {done ? <Check className="w-3 h-3" strokeWidth={3} /> : n}
                  </span>
                  <span className={active ? 'font-medium text-slate-900' : 'text-slate-500'}>{label}</span>
                </li>
              );
            })}
          </ol>
        </header>

        <div className="flex-1 flex items-center justify-center px-6 sm:px-10 overflow-y-auto">
          <div className="w-full max-w-[480px] py-10">
            <AnimatePresence mode="wait">
              {mode === 'SELECT' ? (
                <motion.section key="select" {...fade}>
                  <h2 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">¿Cómo vas a usar esta PC?</h2>
                  <p className="mt-2 text-[15px] text-slate-600 leading-relaxed">Lo elegís una sola vez. Si ya usabas Ventra en esta PC, elegí caja principal: tus datos siguen ahí.</p>

                  <div className="mt-8 rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden" role="listbox">
                    {options.map((o, i) => (
                      <button
                        key={o.key}
                        role="option"
                        aria-selected={focused === i}
                        onMouseEnter={() => setFocused(i)}
                        onClick={o.onSelect}
                        className={`w-full flex items-start gap-4 px-5 py-[18px] text-left transition-colors duration-fast cursor-pointer outline-none ${focused === i ? 'bg-slate-50' : 'bg-white'}`}
                      >
                        <span className={`mt-0.5 w-9 h-9 shrink-0 rounded-lg border grid place-items-center ${focused === i ? 'border-slate-300 text-slate-900 bg-white' : 'border-slate-200 text-slate-500'}`}>
                          <o.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-[15px] font-semibold">{o.title}</span>
                            {o.recommended && <span className="text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-100 rounded-full px-2 py-px">Recomendado</span>}
                          </span>
                          <span className="block mt-1 text-[14px] text-slate-600 leading-snug">{o.desc}</span>
                        </span>
                        <ArrowRight className={`w-4 h-4 mt-2.5 shrink-0 transition-all duration-fast ${focused === i ? 'text-slate-900 translate-x-0.5' : 'text-slate-300'}`} />
                      </button>
                    ))}
                  </div>

                  <p className="mt-6 text-[13px] text-slate-500 leading-relaxed">
                    ¿Cambiaste de PC? Elegí <span className="font-medium text-slate-700">caja principal</span> e ingresá con tu usuario: si el comercio está vinculado a tu cuenta de Ventra, se baja todo desde la nube.
                  </p>
                </motion.section>
              ) : (
                <motion.section key="client" {...fade}>
                  <button onClick={backToSelect} className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-900 transition-colors cursor-pointer">
                    <ArrowLeft className="w-3.5 h-3.5" /> Volver
                  </button>

                  {isScanning ? (
                    <div className="mt-6">
                      <h2 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">Buscando la otra PC…</h2>
                      <p className="mt-2 text-[15px] text-slate-600 leading-relaxed">Revisamos tu red. Dejá la otra PC prendida y con Ventra abierto.</p>
                      <div className="mt-8">
                        <div className="h-[3px] w-full bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-slate-900 rounded-full transition-[width] duration-300 ease-out" style={{ width: `${Math.max(4, scanPct)}%` }} />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[13px] text-slate-500">
                          <span className="inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {scanProgress.total > 0 ? `${scanPct}% revisado` : 'Preparando la búsqueda'}</span>
                          <button onClick={() => { cancelScan(); setScanFailed(true); }} className="hover:text-slate-900 transition-colors cursor-pointer">Cancelar</button>
                        </div>
                      </div>
                    </div>
                  ) : foundServers.length > 0 ? (
                    <div className="mt-6">
                      <h2 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">Encontramos {foundServers.length} PCs con Ventra</h2>
                      <p className="mt-2 text-[15px] text-slate-600 leading-relaxed">Elegí la caja principal del local.</p>
                      <div className="mt-8 rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden">
                        {foundServers.map((s) => (
                          <button key={s} onClick={() => connectToServer(s, operationId.current)}
                            className="group w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-50 transition-colors duration-fast cursor-pointer">
                            <span className="w-9 h-9 shrink-0 rounded-lg border border-slate-200 grid place-items-center text-slate-500"><Monitor className="w-[18px] h-[18px]" strokeWidth={1.75} /></span>
                            <span className="flex-1">
                              <span className="block text-[15px] font-semibold">PC con Ventra</span>
                              <span className="block text-[13px] text-slate-500 font-mono">{s}</span>
                            </span>
                            <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-900 transition-colors" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6">
                      {scanFailed && !showManual ? (
                        <>
                          <h2 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">No encontramos otra PC</h2>
                          <p className="mt-2 text-[15px] text-slate-600 leading-relaxed">Revisá que la otra PC esté prendida, con Ventra abierto y conectada a la misma red (el mismo Wi‑Fi o el mismo router).</p>
                          <div className="mt-8 flex flex-wrap gap-3">
                            <button onClick={handleAutoDetect} className="h-11 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[14px] font-medium transition-colors cursor-pointer">Buscar de nuevo</button>
                            <button onClick={() => setShowManual(true)} className="h-11 px-5 rounded-lg border border-slate-300 hover:bg-slate-50 text-[14px] font-medium transition-colors cursor-pointer">Escribir la dirección</button>
                          </div>
                          <p className="mt-6 text-[13px] text-slate-500 leading-relaxed">¿Esta es la única PC del local? <button onClick={handleStartLocal} className="font-medium text-slate-900 underline underline-offset-2 cursor-pointer">Usarla como caja principal</button></p>
                        </>
                      ) : (
                        <>
                          <h2 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">Dirección de la otra PC</h2>
                          <p className="mt-2 text-[15px] text-slate-600 leading-relaxed">En la PC principal la ves en el menú, en Acceso remoto. Tiene esta forma: 192.168.0.15</p>
                          <label htmlFor="server-ip" className="block mt-8 text-[13px] font-medium text-slate-700">Dirección</label>
                          <input
                            id="server-ip"
                            type="text"
                            inputMode="decimal"
                            value={ip}
                            onChange={(e) => setIp(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && ip && !isTesting) handleConnectClient(); }}
                            placeholder="192.168.0.15"
                            className="mt-2 w-full h-11 rounded-lg border border-slate-300 bg-white px-3.5 text-[15px] font-mono tabular-nums text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition"
                            autoFocus
                          />
                          <button onClick={handleConnectClient} disabled={isTesting || !ip.trim()}
                            className="mt-4 w-full h-11 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[14px] font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                            {isTesting ? <><Loader2 className="w-4 h-4 animate-spin" /> Conectando…</> : 'Conectar'}
                          </button>
                          <p className="mt-6 text-[13px] text-slate-500"><button onClick={handleAutoDetect} className="font-medium text-slate-900 underline underline-offset-2 cursor-pointer">Buscarla sola en la red</button></p>
                        </>
                      )}
                    </div>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>

        <footer className="flex items-center justify-between px-6 sm:px-10 h-14 shrink-0 text-[12px] text-slate-500">
          <span>{APP_VERSION ? `Versión ${APP_VERSION}` : 'Ventra'}</span>
          <a href="https://ventra.store" target="_blank" rel="noreferrer" className="hover:text-slate-900 transition-colors">¿Necesitás ayuda? ventra.store</a>
        </footer>
      </main>
    </div>
  );
}

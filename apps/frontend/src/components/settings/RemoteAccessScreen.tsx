import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Smartphone, Laptop, Wifi, ShieldAlert, CheckCircle2, Copy, ExternalLink, QrCode, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import api from '../../services/api';

export default function RemoteAccessScreen() {
  const [localIp, setLocalIp] = useState('localhost');
  const [tailscaleIp, setTailscaleIp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const { data } = await api.get('/system/info');
        setLocalIp(data.localIp || 'localhost');
        setTailscaleIp(data.tailscaleIp || null);
      } catch (err) {
        console.error('Error fetching system info:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSystemInfo();

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('User accepted the PWA install prompt');
      setDeferredPrompt(null);
    }
  };

  const remoteUrl = tailscaleIp ? `http://${tailscaleIp}:5180` : `http://${localIp}:5180`;

  useEffect(() => {
    if (qrCanvasRef.current && !loading) {
      QRCode.toCanvas(
        qrCanvasRef.current,
        remoteUrl,
        {
          width: 200,
          margin: 1,
          color: {
            dark: '#0f172a', // slate-900
            light: '#ffffff',
          },
        },
        (error) => {
          if (error) console.error('Error generating QR code:', error);
        }
      );
    }
  }, [remoteUrl, loading]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(remoteUrl);
    toast.success('¡Enlace copiado al portapapeles!');
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 w-full h-full overflow-y-auto custom-scrollbar">
      {/* Title Header */}
      <div className="flex items-center gap-3">
        <Smartphone className="w-7 h-7 text-rose-500 animate-pulse-soft" />
        <div>
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-wider dark:text-slate-100">Acceso Remoto y Móvil</h2>
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mt-0.5">Conecta tu celular a GO! Portal en tiempo real</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Connection Box */}
        <div className="card p-6 bg-white border border-slate-400/80 shadow-md dark:bg-slate-900 dark:border-slate-800 flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider dark:text-slate-200 flex items-center gap-2">
              <Laptop className="w-5 h-5 text-indigo-500" />
              Direcciones del Servidor
            </h3>
            
            <div className="space-y-3">
              {/* Tailscale IP status */}
              <div className="p-4 rounded-xl border border-slate-400/50 bg-slate-50 dark:bg-slate-950 dark:border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-slate-600 tracking-wider">Red Tailscale VPN</span>
                  {tailscaleIp ? (
                    <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full dark:bg-emerald-950/60 dark:text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> Activo
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full dark:bg-amber-950/60 dark:text-amber-400">
                      <ShieldAlert className="w-3 h-3" /> No detectado
                    </span>
                  )}
                </div>
                <div className="text-lg font-black text-slate-800 dark:text-slate-100">
                  {tailscaleIp || 'VPN Desconectada'}
                </div>
                <p className="text-[10px] text-slate-600 leading-normal font-semibold">
                  Utiliza esta dirección para conectarte de forma segura desde cualquier parte del mundo.
                </p>
              </div>

              {/* Local network IP status */}
              <div className="p-4 rounded-xl border border-slate-400/50 bg-slate-50 dark:bg-slate-950 dark:border-slate-800/80 space-y-1">
                <span className="text-[10px] font-black uppercase text-slate-600 tracking-wider">Red Local Wi-Fi (LAN)</span>
                <div className="text-base font-bold text-slate-700 dark:text-slate-300">
                  {localIp}:5180
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-black uppercase text-slate-600 tracking-wider">Enlace de Conexión Directa</span>
              <div className="flex items-center gap-2 p-3 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-400/50 dark:border-slate-800/60">
                <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 truncate select-all">{remoteUrl}</span>
                <button 
                  onClick={handleCopyUrl}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-700 hover:text-slate-700 transition-colors ml-auto cursor-pointer"
                  title="Copiar URL"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            {deferredPrompt && (
              <button 
                onClick={handleInstallApp}
                className="btn bg-emerald-600 hover:bg-emerald-700 text-white w-full flex items-center justify-center gap-2 cursor-pointer text-xs uppercase font-extrabold tracking-wider"
              >
                <Download className="w-4 h-4" /> Instalar App PWA
              </button>
            )}

            <a 
              href={remoteUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="btn btn-primary w-full flex items-center justify-center gap-2 cursor-pointer text-xs uppercase font-extrabold tracking-wider"
            >
              Probar en el Navegador <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* QR Code Installation Box */}
        <div className="card p-6 bg-white border border-slate-400/80 shadow-md dark:bg-slate-900 dark:border-slate-800 flex flex-col items-center justify-center text-center gap-4">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider dark:text-slate-200 flex items-center gap-2">
            <QrCode className="w-5 h-5 text-rose-500" />
            Escanear Código QR
          </h3>
          <p className="text-[10px] text-slate-600 font-bold uppercase max-w-xs leading-normal">
            Escanea este código con tu celular (conectado a Tailscale) para ingresar directamente sin escribir la IP.
          </p>

          <div className="p-3 bg-white rounded-2xl border-4 border-slate-300 shadow-inner flex items-center justify-center relative overflow-hidden">
            {loading ? (
              <div className="w-[200px] h-[200px] flex items-center justify-center text-slate-600 font-bold text-xs">Cargando código QR...</div>
            ) : (
              <canvas ref={qrCanvasRef} className="w-[200px] h-[200px]" />
            )}
          </div>
        </div>
      </div>

      {/* PWA / App Installation Guide */}
      <div className="card p-6 bg-white border border-slate-400/80 shadow-md dark:bg-slate-900 dark:border-slate-800 space-y-4">
        <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider dark:text-slate-200 flex items-center gap-2 border-b border-slate-300 dark:border-slate-800 pb-3">
          <Download className="w-5 h-5 text-emerald-500" />
          Instalar como Aplicación en tu Celular (PWA)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* iOS (iPhone/iPad) Instruction */}
          <div className="space-y-2 p-4 rounded-xl border border-slate-400/40 bg-slate-50/50 dark:bg-slate-950/40 dark:border-slate-800/40">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase text-slate-600 dark:text-slate-300">iPhone / iPad (Safari)</span>
            </div>
            <ol className="list-decimal list-inside text-xs text-slate-700 font-bold space-y-1.5 leading-normal dark:text-slate-600">
              <li>Escanea el código QR de arriba o ingresa la dirección IP en Safari.</li>
              <li>Toca el botón de <strong className="text-slate-700 dark:text-slate-300">Compartir</strong> (icono de un cuadrado con flecha hacia arriba en la barra inferior).</li>
              <li>Selecciona la opción <strong className="text-slate-700 dark:text-slate-300">"Agregar a la pantalla de inicio"</strong>.</li>
              <li>¡Listo! Abre el acceso directo en tu celular para usar GoPortal en pantalla completa.</li>
            </ol>
          </div>

          {/* Android (Chrome) Instruction */}
          <div className="space-y-2 p-4 rounded-xl border border-slate-400/40 bg-slate-50/50 dark:bg-slate-950/40 dark:border-slate-800/40">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase text-slate-600 dark:text-slate-300">Android (Chrome)</span>
            </div>
            <ol className="list-decimal list-inside text-xs text-slate-700 font-bold space-y-1.5 leading-normal dark:text-slate-600">
              <li>Debido a que usamos una IP HTTP local, Chrome requiere activar un permiso de seguridad:
                <div className="my-2 p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/50 rounded-lg text-[10px] text-amber-700 dark:text-amber-400 font-bold">
                  1. Abre una pestaña en Chrome en tu celular y entra a: <strong className="select-all block font-mono bg-white dark:bg-black p-1 rounded mt-1">chrome://flags/#unsafely-treat-insecure-origin-as-secure</strong>
                  2. Activa ("Enabled") la opción e introduce en el cuadro de texto:<strong className="select-all block font-mono bg-white dark:bg-black p-1 rounded mt-1">{remoteUrl}</strong>
                  3. Toca en "Relaunch" abajo a la derecha para reiniciar Chrome.
                </div>
              </li>
              <li>Entra nuevamente a la dirección y verás un botón verde de **"Instalar App PWA"** en la pantalla.</li>
              <li>Toca el botón e instálala. Se creará una app real (sin barras del navegador ni el logo de Chrome).</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

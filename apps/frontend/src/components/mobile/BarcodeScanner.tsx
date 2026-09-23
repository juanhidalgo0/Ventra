import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Flashlight } from 'lucide-react';

/** El lector de códigos del navegador (Chrome en Android). En iPhone todavía no existe: el botón no se muestra. */
export const canScanBarcodes = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/**
 * Escáner con la cámara del celular. Llama a onCode con cada código leído
 * (con una pausa entre lecturas para no cargar dos veces el mismo producto).
 */
export default function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    let lastRead = { code: '', at: 0 };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (cancelled) return;
        trackRef.current = stream.getVideoTracks()[0];
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'],
        });
        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue;
            const now = Date.now();
            if (value && (value !== lastRead.code || now - lastRead.at > 2000)) {
              lastRead = { code: value, at: now };
              navigator.vibrate?.(40);
              setLastCode(value);
              onCode(value);
            }
          } catch { /* cuadro sin código */ }
          timer = window.setTimeout(tick, 180);
        };
        tick();
      } catch {
        setError('No pudimos usar la cámara. Revisá que Ventra tenga permiso para usarla.');
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  const toggleTorch = async () => {
    try {
      await (trackRef.current as any)?.applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch(!torch);
    } catch { /* el celular no tiene linterna controlable */ }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black flex flex-col keep-animated mobile-app">
      <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <button onClick={onClose} className="w-11 h-11 rounded-full bg-white/15 backdrop-blur flex items-center justify-center" aria-label="Cerrar escáner">
          <X className="w-5 h-5 text-white" />
        </button>
        <button onClick={toggleTorch} className={`w-11 h-11 rounded-full backdrop-blur flex items-center justify-center ${torch ? 'bg-white text-slate-900' : 'bg-white/15 text-white'}`} aria-label="Linterna">
          <Flashlight className="w-5 h-5" />
        </button>
      </div>

      <video ref={videoRef} playsInline muted className="flex-1 w-full object-cover" />

      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        <div className="w-[78%] max-w-sm aspect-[1.6] rounded-3xl border-[3px] border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
      </div>

      <div className="absolute bottom-0 inset-x-0 px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] text-center">
        {error ? (
          <p className="text-[14px] text-white bg-red-600/90 rounded-2xl px-4 py-3">{error}</p>
        ) : (
          <>
            <p className="text-[15px] font-semibold text-white">Apuntá al código de barras</p>
            <p className="text-[12.5px] text-white/70 mt-1">
              {lastCode ? `Último leído: ${lastCode}` : 'Se agrega solo al carrito. Podés seguir escaneando.'}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

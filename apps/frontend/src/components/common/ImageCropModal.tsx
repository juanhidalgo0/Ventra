import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, Check } from 'lucide-react';

/**
 * Encuadre de una imagen antes de subirla (logo o portada de la tienda): se arrastra para
 * moverla y se hace zoom con la barra, la rueda del mouse o pellizcando. Devuelve la imagen
 * recortada al tamaño final, lista para guardar.
 */
export default function ImageCropModal({
  file, aspect, outWidth, outHeight, title, hint, round, onCancel, onDone,
}: {
  file: File;
  aspect: number; // ancho / alto del recorte
  outWidth: number;
  outHeight: number;
  title: string;
  hint: string; // resolución recomendada
  round?: boolean; // guía de logo
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const measure = () => {
      const el = frame.current;
      if (el) setBox({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [img]);

  // Escala base: la imagen cubre todo el recorte
  const base = img && box.w ? Math.max(box.w / img.width, box.h / img.height) : 1;
  const sizeAt = (z: number) => ({ w: img ? img.width * base * z : 0, h: img ? img.height * base * z : 0 });
  const clampAt = (p: { x: number; y: number }, z: number) => {
    const s = sizeAt(z);
    return { x: Math.min(0, Math.max(box.w - s.w, p.x)), y: Math.min(0, Math.max(box.h - s.h, p.y)) };
  };
  const { w: dw, h: dh } = sizeAt(zoom);
  // Arranca centrada
  const cur = pos ?? { x: (box.w - dw) / 2, y: (box.h - dh) / 2 };

  const setZoomAround = (z: number) => {
    const nz = Math.min(4, Math.max(1, z));
    const cx = box.w / 2, cy = box.h / 2, k = nz / zoom;
    setPos(clampAt({ x: cx - (cx - cur.x) * k, y: cy - (cy - cur.y) * k }, nz));
    setZoom(nz);
  };

  const done = () => {
    if (!img || !box.w) return;
    const scale = base * zoom;
    const c = document.createElement('canvas');
    c.width = outWidth; c.height = outHeight;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -cur.x / scale, -cur.y / scale, box.w / scale, box.h / scale, 0, 0, outWidth, outHeight);
    // Logos PNG conservan la transparencia; el resto va en JPG liviano
    const png = round && file.type === 'image/png';
    onDone(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.82));
  };

  const endPointer = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); pinch.current = null; drag.current = null; };
  const small = img && (img.width < outWidth * 0.8 || img.height < outHeight * 0.8);

  return createPortal(
    <div className="fixed inset-0 z-[400] bg-slate-950/80 flex items-center justify-center p-4 keep-style mobile-app" onClick={onCancel}>
      <div className="w-full max-w-[640px] bg-white rounded-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div>
            <p className="text-[16px] font-bold text-slate-900">{title}</p>
            <p className="text-[12.5px] text-slate-500">Arrastrá para encuadrar y usá el zoom. {hint}</p>
          </div>
          <button onClick={onCancel} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0" aria-label="Cancelar">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="px-5 py-4 bg-slate-100">
          <div
            ref={frame}
            className={`relative mx-auto overflow-hidden bg-slate-300 touch-none select-none cursor-grab active:cursor-grabbing ${round ? 'rounded-[22%]' : 'rounded-xl'}`}
            style={{ aspectRatio: String(aspect), width: aspect > 1 ? '100%' : 'min(100%, 300px)' }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (pointers.current.size === 2) {
                const [a, b] = [...pointers.current.values()];
                pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom };
                drag.current = null;
              } else {
                drag.current = { x: e.clientX, y: e.clientY, px: cur.x, py: cur.y };
              }
            }}
            onPointerMove={(e) => {
              if (!pointers.current.has(e.pointerId)) return;
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (pinch.current && pointers.current.size === 2) {
                const [a, b] = [...pointers.current.values()];
                setZoomAround(pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d));
              } else if (drag.current) {
                setPos(clampAt({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }, zoom));
              }
            }}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onWheel={(e) => setZoomAround(zoom * (e.deltaY < 0 ? 1.08 : 0.92))}
          >
            {img && box.w > 0 && (
              <img
                src={img.src}
                alt=""
                draggable={false}
                className="absolute top-0 left-0 max-w-none pointer-events-none"
                style={{ width: dw, height: dh, transform: `translate(${cur.x}px, ${cur.y}px)` }}
              />
            )}
            {/* Guía de tercios */}
            <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
              {Array.from({ length: 9 }).map((_, i) => <div key={i} className="border border-white/30" />)}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setZoomAround(zoom - 0.25)} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center" aria-label="Alejar">
              <ZoomOut className="w-4 h-4 text-slate-600" />
            </button>
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoomAround(Number(e.target.value))} className="flex-1 accent-rose-600" />
            <button onClick={() => setZoomAround(zoom + 0.25)} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center" aria-label="Acercar">
              <ZoomIn className="w-4 h-4 text-slate-600" />
            </button>
          </div>
          {small && (
            <p className="text-[12.5px] text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
              Esta imagen mide {img!.width}×{img!.height} px y puede verse borrosa. Si podés, usá una más grande.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onCancel} className="h-12 rounded-xl bg-slate-100 text-slate-700 text-[15px] font-semibold">Cancelar</button>
            <button onClick={done} disabled={!img} className="h-12 rounded-xl bg-rose-600 text-white text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
              <Check className="w-4 h-4" /> Usar imagen
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Medidas de la tienda online */
export const STORE_LOGO = { aspect: 1, outWidth: 400, outHeight: 400, hint: 'Recomendado: 512×512 px, cuadrado.' };
export const STORE_BANNER = { aspect: 3, outWidth: 1500, outHeight: 500, hint: 'Recomendado: 1500×500 px (3 de ancho por 1 de alto).' };

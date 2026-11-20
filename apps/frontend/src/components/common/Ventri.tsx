import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { setStoreSetting, STORE_SETTINGS_EVENT } from '../../services/storeSettings';
import { lockShortcuts } from '../../utils/shortcutLock';

/**
 * Ventri: la mascota de Ventra (un ticket de caja en caricatura, la misma de los reels y la que
 * contesta en Instagram). Biblia del personaje: marketing/ventri/BIBLIA.md; las caras salen de
 * marketing/ventri/kit (fondo transparente, public/ventri/*.webp).
 *
 * En la caja aparece solo en momentos tranquilos (modo práctica, abrir y cerrar el turno, la
 * ayuda y las esperas), nunca en el cobro ni en el escaneo. Se prende o apaga en Configuración
 * ("Mostrar a Ventri en la caja"), un ajuste del comercio que viaja a todas sus cajas.
 */

export type VentriCara = 'picara' | 'guino' | 'sorprendida' | 'mate' | 'indignada' | 'pila';

/** equipo: dueño y encargados (de entrada); todos: también los cajeros; nadie: apagada */
export type VentriCaja = 'equipo' | 'todos' | 'nadie';

const LS_KEY = 'ventra_ventri_caja';
const CHANGED = 'ventra:ventri-caja';

export function getVentriCaja(): VentriCaja {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === 'equipo' || v === 'nadie' ? v : 'todos';
  } catch {
    return 'todos';
  }
}

export function saveVentriCaja(v: VentriCaja) {
  setStoreSetting('ventri_caja', v);
  window.dispatchEvent(new Event(CHANGED));
}

/** ¿Se muestra Ventri a quien está usando la caja ahora? */
export function useVentri(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  const [mode, setMode] = useState<VentriCaja>(getVentriCaja);
  useEffect(() => {
    const refresh = () => setMode(getVentriCaja());
    window.addEventListener(STORE_SETTINGS_EVENT, refresh);
    window.addEventListener(CHANGED, refresh);
    return () => {
      window.removeEventListener(STORE_SETTINGS_EVENT, refresh);
      window.removeEventListener(CHANGED, refresh);
    };
  }, []);
  if (mode === 'nadie') return false;
  if (mode === 'todos') return true;
  return role === 'ADMIN' || role === 'SUPERVISOR';
}

/** "jugar", "juego", "¿jugamos?", "a jugar": lo que abre el juego secreto si se lo escriben a Ventri en la Ayuda */
export const PIDE_JUEGO = /^\s*[¡!¿]*\s*(a\s+)?(jugar|juego|jugamos)\s*[!?.]*\s*$/i;

/**
 * Hora pico: el minijuego secreto de Ventri (public/ventri/juego.js, un archivo sin dependencias
 * que se baja recién cuando se abre). Mientras está abierto, los atajos de la caja no se disparan
 * y el juego se traga todas las teclas; si pasan un código con el lector, se cierra solo.
 */
export function abrirJuegoVentri() {
  const w = window as any;
  if (w.ventriJuego?.abierto?.()) return; // ya está abierto: no tocar los atajos de la caja
  const soltar = lockShortcuts();
  const abrir = () => {
    if (!w.ventriJuego?.abrir({ contexto: 'caja', alCerrar: soltar })) soltar();
  };
  if (w.ventriJuego) { abrir(); return; }
  const s = document.createElement('script');
  // Ruta relativa a propósito: en la PC la caja se abre desde un archivo (file://), donde
  // "/ventri/…" apuntaría a la raíz del disco. Con HashRouter la página siempre es index.html.
  s.src = 'ventri/juego.js?v=1';
  s.onload = abrir;
  s.onerror = soltar;
  document.head.appendChild(s);
}

/** Ancho/alto de cada cara (public/ventri) y dónde está el centro de la "cabeza" del ticket, para el gorrito */
const FORMA: Record<VentriCara, { ratio: number; cabeza: number }> = {
  picara: { ratio: 0.88, cabeza: 0.42 }, guino: { ratio: 0.9, cabeza: 0.57 }, sorprendida: { ratio: 0.83, cabeza: 0.45 },
  mate: { ratio: 0.78, cabeza: 0.43 }, indignada: { ratio: 0.8, cabeza: 0.5 }, pila: { ratio: 1.23, cabeza: 0.5 },
};

/** Temporada de fiestas: la prende navidad.js (public/navidad.js) del 1/12 al 6/1, con la clase "navidad" en <html> */
export function esNavidad(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('navidad');
}

/** El mismo gorrito de navidad.js, dibujado adentro de Ventri (así la sigue cuando se mueve) */
const Gorro = ({ size, cara }: { size: number; cara: VentriCara }) => {
  const w = size * FORMA[cara].ratio;
  const hatW = size * 0.42;
  return (
    <svg viewBox="0 0 100 84" aria-hidden style={{ position: 'absolute', width: hatW, left: w * FORMA[cara].cabeza - hatW * 0.45, top: size * 0.11 - hatW * 0.69, transform: 'rotate(-12deg)', transformOrigin: '50% 90%', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.18))' }}>
      <path d="M12 66C20 36 42 10 68 9c15-.6 24 10 26 25-8-7-18-9-24-3-6 8-4 22 0 35z" fill="#D62839" />
      <path d="M40 66c4-20 14-35 30-35-6 8-4 22 0 35z" fill="#A81D2C" />
      <circle cx="92" cy="38" r="9.5" fill="#fff" stroke="#e3e6ea" strokeWidth="1.5" />
      <rect x="4" y="59" width="76" height="19" rx="9.5" fill="#fff" stroke="#e3e6ea" strokeWidth="1.5" />
    </svg>
  );
};

/**
 * Una cara de Ventri. `entra`: aparece de abajo una vez (solo transform/opacity).
 * `gorro`: en las fiestas lleva gorrito (de entrada, solo si navidad.js prendió la temporada).
 */
export function VentriImg({ cara, size = 72, entra = false, gorro, className = '' }: { cara: VentriCara; size?: number; entra?: boolean; gorro?: boolean; className?: string }) {
  const conGorro = gorro ?? esNavidad();
  const img = (
    <img
      src={`/ventri/${cara}.webp`}
      alt=""
      aria-hidden
      draggable={false}
      style={{ height: size, width: 'auto' }}
      className={`select-none pointer-events-none shrink-0 ${conGorro ? '' : entra ? 'ventri-entra' : ''} ${conGorro ? '' : className}`}
    />
  );
  if (!conGorro) return img;
  return (
    <span className={`relative inline-block shrink-0 pointer-events-none ${entra ? 'ventri-entra' : ''} ${className}`} style={{ height: size, width: size * FORMA[cara].ratio }}>
      {img}
      <Gorro size={size} cara={cara} />
    </span>
  );
}

/** Ventri hablando: la cara al costado y lo que dice en un globito. */
export function VentriDice({ cara, children, size = 64, className = '' }: { cara: VentriCara; children: ReactNode; size?: number; className?: string }) {
  return (
    <div className={`flex items-end gap-2.5 ${className}`}>
      <VentriImg cara={cara} size={size} entra />
      <div className="ventri-globo relative flex-1 min-w-0 rounded-2xl rounded-bl-md bg-emerald-50 dark:bg-emerald-900/25 border border-emerald-200/80 dark:border-emerald-800/60 px-3.5 py-2.5 text-[13px] leading-snug text-emerald-950 dark:text-emerald-100">
        {children}
      </div>
    </div>
  );
}

/**
 * Para las esperas: Ventri sale impresa de la ranura de la impresora, una y otra vez (en CSS, así
 * se mueve también en modo rendimiento).
 */
export function VentriImprimiendo({ size = 96 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center" aria-hidden>
      <div className="keep-animated overflow-hidden" style={{ height: size, paddingTop: 2 }}>
        <div className="keep-animated ventri-imprime">
          <VentriImg cara="mate" size={size} />
        </div>
      </div>
      {/* la ranura de la impresora térmica */}
      <div className="h-2.5 rounded-full bg-slate-800 dark:bg-slate-600" style={{ width: size * 1.05 }} />
    </div>
  );
}

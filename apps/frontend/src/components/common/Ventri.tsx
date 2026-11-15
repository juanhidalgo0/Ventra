import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { setStoreSetting, STORE_SETTINGS_EVENT } from '../../services/storeSettings';

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
    return v === 'todos' || v === 'nadie' ? v : 'equipo';
  } catch {
    return 'equipo';
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

/** Una cara de Ventri. `entra`: aparece de abajo una vez (solo transform/opacity). */
export function VentriImg({ cara, size = 72, entra = false, className = '' }: { cara: VentriCara; size?: number; entra?: boolean; className?: string }) {
  return (
    <img
      src={`/ventri/${cara}.webp`}
      alt=""
      aria-hidden
      draggable={false}
      style={{ height: size, width: 'auto' }}
      className={`select-none pointer-events-none shrink-0 ${entra ? 'ventri-entra' : ''} ${className}`}
    />
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

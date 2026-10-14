import { useEffect, useState } from 'react';
import { setStoreSetting, STORE_SETTINGS_EVENT } from '../services/storeSettings';

/**
 * Fondo inicial de la caja: el cambio que tiene que haber en el cajón al abrir. Lo fija el dueño
 * y viaja a todos los equipos (ajuste del comercio). No entra en las cuentas del turno: queda
 * siempre en el cajón, así que el arqueo cuenta solo lo que se retira.
 */
const KEY = 'cash_opening_float';
/** Aviso local cuando el dueño lo cambia en este equipo (lo de otros equipos llega por STORE_SETTINGS_EVENT) */
const CHANGED_EVENT = 'ventra:opening-float';

/** null = el dueño todavía no lo cargó */
export function getOpeningFloat(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveOpeningFloat(amount: number) {
  setStoreSetting(KEY, String(Math.max(0, Math.round(amount))));
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** El valor vigente, al día si se cambia acá o en otro equipo. */
export function useOpeningFloat(): number | null {
  const [value, setValue] = useState(getOpeningFloat);
  useEffect(() => {
    const refresh = () => setValue(getOpeningFloat());
    window.addEventListener(STORE_SETTINGS_EVENT, refresh);
    window.addEventListener(CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(STORE_SETTINGS_EVENT, refresh);
      window.removeEventListener(CHANGED_EVENT, refresh);
    };
  }, []);
  return value;
}


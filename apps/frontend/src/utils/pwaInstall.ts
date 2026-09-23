import { useEffect, useState } from 'react';

/**
 * Instalación de la app (PWA). El navegador avisa una sola vez, al cargar la página,
 * que se puede instalar (beforeinstallprompt, en Chrome/Android/Edge): se guarda acá
 * apenas arranca la app para poder ofrecer el botón "Instalar" en cualquier pantalla.
 * En iPhone no existe ese aviso: se muestran las instrucciones de Safari.
 */
let deferred: any = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

const isDesktopApp = () => !!(window as any).__TAURI__ || /electron/i.test(navigator.userAgent);
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;

/** 'prompt' = el navegador puede instalarla con un toque · 'ios' = mostrar instrucciones · null = no aplica */
export function usePwaInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  const mode: 'prompt' | 'ios' | null =
    isDesktopApp() || isStandalone() ? null : deferred ? 'prompt' : isIOS() ? 'ios' : null;

  const install = async () => {
    if (!deferred) return false;
    deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    deferred = null;
    notify();
    return choice?.outcome === 'accepted';
  };

  return { mode, install };
}

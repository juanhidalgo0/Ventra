/**
 * En la app de escritorio (Tauri) los enlaces a otras páginas (la tienda online,
 * WhatsApp, etc.) no hacen nada: la ventana de Ventra no abre pestañas. Acá se
 * atrapan todos esos enlaces y se abren en el navegador de Windows.
 */
const tauriInvoke = () => {
  const t = (window as any).__TAURI__;
  return t?.core?.invoke || t?.invoke;
};

const isExternal = (href: string) => {
  try {
    const u = new URL(href, window.location.href);
    if (u.protocol === 'mailto:' || u.protocol === 'tel:') return true;
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== window.location.origin;
  } catch {
    return false;
  }
};

export function openExternal(url: string) {
  const invoke = tauriInvoke();
  if (invoke) invoke('open_browser', { url }).catch(() => {});
  else window.open(url, '_blank', 'noopener');
}

if (typeof window !== 'undefined' && tauriInvoke()) {
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented) return;
    const href = a.getAttribute('href') || '';
    if (a.target === '_blank' || isExternal(href)) {
      if (!isExternal(href)) return;
      e.preventDefault();
      openExternal(a.href);
    }
  }, true);

  const originalOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url ? String(url) : '';
    if (href && isExternal(href)) {
      openExternal(new URL(href, window.location.href).toString());
      return null;
    }
    return originalOpen(url as any, target, features);
  }) as typeof window.open;
}

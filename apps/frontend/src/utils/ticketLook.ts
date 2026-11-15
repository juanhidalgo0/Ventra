import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { STORE_SETTINGS_EVENT } from '../services/storeSettings';

/**
 * Cómo sale el ticket térmico: ancho del papel (de cada PC, porque depende de la impresora),
 * y para todo el comercio el logo arriba, un QR al pie (la tienda online o el WhatsApp) y un
 * mensaje propio. Se configura en Configuración → "Cómo sale el ticket" (TicketLookCard).
 */
const WIDTH_KEY = 'ventra_ticket_width';
export type TicketWidth = 80 | 58;
export const getTicketWidth = (): TicketWidth => { try { return localStorage.getItem(WIDTH_KEY) === '58' ? 58 : 80; } catch { return 80; } };
export const setTicketWidth = (w: TicketWidth) => {
  try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* sin espacio */ }
  window.dispatchEvent(new CustomEvent(STORE_SETTINGS_EVENT, { detail: ['ticket_width'] }));
};

/**
 * CSS de impresión del ticket: solo sale `selector`, al ancho del papel. Uno solo para el cobro,
 * la reimpresión, la factura y el presupuesto, así no se separan con el tiempo.
 */
export function ticketPrintCss(selector = '#printable-receipt', width: TicketWidth = getTicketWidth()) {
  const narrow = width === 58;
  return `
  @media print {
    @page { size: ${width}mm 297mm; margin: 0 !important; }
    * { transform: none !important; animation: none !important; }
    html, body, #root { margin: 0 !important; padding: 0 !important; background: #fff !important; width: ${width}mm !important; }
    body * { visibility: hidden !important; }
    ${selector}, ${selector} * { visibility: visible !important; }
    ${selector} {
      display: block !important; position: absolute !important; left: 0 !important; top: 0 !important;
      width: ${width}mm !important; max-width: ${width}mm !important;
      font-family: 'Courier New', Courier, monospace !important; font-size: ${narrow ? '7.5pt' : '8.5pt'} !important; line-height: 1.4 !important;
      color: #000 !important; background: #fff !important;
      padding: ${narrow ? '2mm 2mm 10mm 2mm' : '4mm 4mm 12mm 4mm'} !important; margin: 0 !important; box-sizing: border-box !important;
    }
  }`;
}

const read = (k: string) => { try { return (localStorage.getItem(k) || '').trim(); } catch { return ''; } };

/**
 * El logo pasado a blanco y negro puro: la térmica no imprime grises (los hace con puntitos y
 * el logo sale manchado). Fondo transparente = blanco. Se hace una vez por logo.
 */
const bwCache = new Map<string, Promise<string | null>>();
export function logoForThermal(src: string): Promise<string | null> {
  if (!src) return Promise.resolve(null);
  if (!bwCache.has(src)) {
    bwCache.set(src, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const maxW = 360;
          const scale = Math.min(1, maxW / img.width);
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const d = ctx.getImageData(0, 0, w, h);
          // Umbral por el brillo promedio: sirve igual para logos claros y oscuros
          let sum = 0;
          for (let i = 0; i < d.data.length; i += 4) sum += 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
          const avg = sum / (d.data.length / 4);
          const cut = Math.min(200, Math.max(90, avg - 25));
          for (let i = 0; i < d.data.length; i += 4) {
            const v = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2] < cut ? 0 : 255;
            d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
            d.data[i + 3] = 255;
          }
          ctx.putImageData(d, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    }));
  }
  return bwCache.get(src)!;
}

const qrCache = new Map<string, Promise<string | null>>();
const qrFor = (url: string) => {
  if (!qrCache.has(url)) qrCache.set(url, QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#000000', light: '#ffffff' } }).catch(() => null));
  return qrCache.get(url)!;
};

export interface TicketLook {
  width: TicketWidth;
  logo: string | null;
  qr: string | null;
  qrLabel: string;
  footer: string;
  address: string;
  phone: string;
}

export const QR_LABEL: Record<string, string> = {
  store: 'Pedí online escaneando acá',
  whatsapp: 'Escribinos por WhatsApp',
};

function snapshot() {
  const qrKind = read('ventra_ticket_qr') || 'none';
  return {
    width: getTicketWidth(),
    logoSrc: read('ventra_ticket_logo') === '0' ? '' : read('gd_store_logo'),
    qrKind,
    qrUrl: qrKind === 'none' ? '' : read('ventra_ticket_qr_url'),
    footer: read('ventra_ticket_footer'),
    address: read('gd_store_address'),
    phone: read('gd_store_phone'),
  };
}

/** Lo que lleva el ticket, ya listo para imprimir (logo en blanco y negro, QR dibujado). */
export function useTicketLook(): TicketLook {
  const [base, setBase] = useState(snapshot);
  const [logo, setLogo] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    const again = () => setBase(snapshot());
    window.addEventListener(STORE_SETTINGS_EVENT, again);
    window.addEventListener('storage', again);
    return () => { window.removeEventListener(STORE_SETTINGS_EVENT, again); window.removeEventListener('storage', again); };
  }, []);
  useEffect(() => {
    let alive = true;
    logoForThermal(base.logoSrc).then((l) => { if (alive) setLogo(l); });
    return () => { alive = false; };
  }, [base.logoSrc]);
  useEffect(() => {
    let alive = true;
    (base.qrUrl ? qrFor(base.qrUrl) : Promise.resolve(null)).then((q) => { if (alive) setQr(q); });
    return () => { alive = false; };
  }, [base.qrUrl]);

  return { width: base.width, logo, qr, qrLabel: QR_LABEL[base.qrKind] || '', footer: base.footer, address: base.address, phone: base.phone };
}

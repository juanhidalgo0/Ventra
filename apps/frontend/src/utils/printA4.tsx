import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterPaint } from './printToPdf';
import { printReport } from './ticketPrinter';

/**
 * Imprime hojas A4 (notas de venta, remitos, hojas de carga y de ruta) sin tocar la pantalla:
 * se dibujan aparte, se imprime solo eso y se borran. Va por la impresora de reportes (la A4)
 * si la PC tiene una elegida; si no, abre el cuadro de impresión. Cada hoja que tenga que
 * empezar en una página nueva lleva `breakBefore: 'page'`.
 */
const PRINT_CSS = `
  @media print {
    @page { size: A4 portrait !important; margin: 10mm !important; }
    html, body, #root { width: auto !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
    body * { visibility: hidden !important; }
    #printable-receipt { display: none !important; }
    #ventra-a4-print, #ventra-a4-print * { visibility: visible !important; }
    #ventra-a4-print { display: block !important; position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; }
  }
`;

export async function printA4(content: ReactNode) {
  const host = document.createElement('div');
  host.id = 'ventra-a4-print';
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:190mm;background:#fff;';
  const style = document.createElement('style');
  style.textContent = PRINT_CSS;
  document.body.append(host, style);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(content));
    await afterPaint();
    await printReport();
  } finally {
    root.unmount();
    host.remove();
    style.remove();
  }
}

/**
 * Impresión directa de comprobantes en la app de escritorio: al facturar, el ticket sale
 * solo por la impresora elegida en esta PC, sin el cuadro de impresión de Windows.
 * En el navegador no se puede (siempre pregunta), así que ahí se sigue usando window.print().
 */
const invoke = () => {
  const t = (window as any).__TAURI__;
  return (t?.core?.invoke || t?.invoke) as ((cmd: string, args?: any) => Promise<any>) | undefined;
};

const KEY = 'ventra_ticket_printer';
const AUTO_KEY = 'ventra_auto_print_invoice';

export const canPrintSilently = () => !!invoke();

export const getTicketPrinter = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setTicketPrinter = (name: string) => { try { localStorage.setItem(KEY, name); } catch { /* sin espacio */ } };

/** Encendido salvo que se haya apagado a mano */
export const getAutoPrintInvoice = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
export const setAutoPrintInvoice = (on: boolean) => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* sin espacio */ } };

export async function listPrinters(): Promise<string[]> {
  const inv = invoke();
  if (!inv) return [];
  try { return (await inv('list_printers')) || []; } catch { return []; }
}

/** Imprime la pantalla actual (con su CSS de impresión) sin preguntar. Tira error si no salió. */
export async function printSilently(): Promise<void> {
  const inv = invoke();
  if (!inv) throw new Error('Solo en la app de escritorio');
  await inv('silent_print', { printer: getTicketPrinter() || null });
}

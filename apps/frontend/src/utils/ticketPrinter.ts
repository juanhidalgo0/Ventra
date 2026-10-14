/**
 * Impresión directa en la app de escritorio: el ticket y la factura salen solos por la impresora
 * de tickets (la térmica), y los cierres y reportes por la impresora de reportes si se eligió una
 * (la común, A4). Cada PC elige las suyas. En el navegador no se puede imprimir sin preguntar,
 * así que ahí se sigue usando window.print().
 */
const invoke = () => {
  const t = (window as any).__TAURI__;
  return (t?.core?.invoke || t?.invoke) as ((cmd: string, args?: any) => Promise<any>) | undefined;
};

const KEY = 'ventra_ticket_printer';
const AUTO_KEY = 'ventra_auto_print_invoice';
const REPORT_KEY = 'ventra_report_printer';

export const canPrintSilently = () => !!invoke();

export const getTicketPrinter = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setTicketPrinter = (name: string) => { try { localStorage.setItem(KEY, name); } catch { /* sin espacio */ } };

/** Impresora de cierres y reportes. Vacía = se abre el cuadro de impresión para elegir */
export const getReportPrinter = () => { try { return localStorage.getItem(REPORT_KEY) || ''; } catch { return ''; } };
export const setReportPrinter = (name: string) => { try { localStorage.setItem(REPORT_KEY, name); } catch { /* sin espacio */ } };

/** Encendido salvo que se haya apagado a mano */
export const getAutoPrintInvoice = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
export const setAutoPrintInvoice = (on: boolean) => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* sin espacio */ } };

export async function listPrinters(): Promise<string[]> {
  const inv = invoke();
  if (!inv) return [];
  try { return (await inv('list_printers')) || []; } catch { return []; }
}

/**
 * Imprime la pantalla actual (con su CSS de impresión) sin preguntar: los tickets por la impresora
 * de tickets y los reportes por la de reportes. Tira error si no salió.
 */
export async function printSilently(kind: 'ticket' | 'report' = 'ticket'): Promise<void> {
  const inv = invoke();
  if (!inv) throw new Error('Solo en la app de escritorio');
  await inv('silent_print', { printer: (kind === 'report' ? getReportPrinter() : getTicketPrinter()) || null });
}

/** Aviso cuando el ticket no salió: qué pasó y dónde se arregla */
export const printFailMessage = (err: any) =>
  `No se imprimió el ticket: ${err?.message || err || 'la impresora no respondió'}. Revisá que la impresora térmica esté prendida y elegida en Configuración → Impresoras de esta PC, y volvé a imprimir.`;

/**
 * Cierres, arqueos y reportes: directo a la impresora de reportes si esta PC tiene una elegida;
 * si no (o si falla), el cuadro de impresión de siempre para elegir dónde.
 */
export async function printReport(): Promise<void> {
  if (canPrintSilently() && getReportPrinter()) {
    const { default: toast } = await import('react-hot-toast');
    const aviso = toast.loading('Imprimiendo...');
    try {
      await printSilently('report');
      toast.success(`Impreso en ${getReportPrinter()}`, { id: aviso, duration: 3000 });
      return;
    } catch (err: any) {
      toast.error(`${err?.message || err || 'No se pudo imprimir'}. Elegí la impresora en el cuadro.`, { id: aviso, duration: 6000 });
    }
  }
  window.print();
}

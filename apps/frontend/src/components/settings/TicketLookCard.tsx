import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import toast from 'react-hot-toast';
import { Receipt, Printer } from 'lucide-react';
import TicketReceipt from '../pos/TicketReceipt';
import StoreLogoField from '../common/StoreLogoField';
import { setStoreSetting } from '../../services/storeSettings';
import { getTicketWidth, setTicketWidth, ticketPrintCss, type TicketWidth } from '../../utils/ticketLook';
import { canPrintSilently, printSilently, printFailMessage } from '../../utils/ticketPrinter';
import { publicStoreUrl } from '../../utils/storeLinks';

const read = (k: string) => { try { return (localStorage.getItem(k) || '').trim(); } catch { return ''; } };

/** wa.me necesita el número con código de país: 11 1234-5678 → 5491112345678 */
function waLink(raw: string): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = d.slice(1);
  if (!d.startsWith('54')) d = `549${d}`;
  return `https://wa.me/${d}`;
}

const money = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`;
const SAMPLE = {
  saleNumber: 1234,
  createdAt: new Date().toISOString(),
  total: 10800,
  items: [
    { productName: 'PACK CERVEZA LATA X6', quantity: 1, total: 9000 },
    { productName: 'GASEOSA COLA 500', quantity: 1, total: 1800 },
  ],
  payments: [{ method: 'CASH', amount: 10800 }],
};

/**
 * Cómo sale el ticket: ancho del papel (de esta PC), logo, QR (tienda online o WhatsApp) y mensaje
 * al pie, con vista previa e "Imprimir prueba" (para saber si la impresora y el papel andan).
 * Va en la web y en la app de escritorio.
 */
export default function TicketLookCard() {
  const [width, setWidth] = useState<TicketWidth>(getTicketWidth());
  const [logoOn, setLogoOn] = useState(read('ventra_ticket_logo') !== '0');
  const [qr, setQr] = useState(read('ventra_ticket_qr') || 'none');
  const [footer, setFooter] = useState(read('ventra_ticket_footer'));
  const [hasLogo, setHasLogo] = useState(!!read('gd_store_logo'));
  // El estilo de la prueba se pone solo mientras se imprime: si quedaba, cualquier otra impresión
  // desde Configuración sacaba el ticket de prueba
  const [printing, setPrinting] = useState(false);
  const [links, setLinks] = useState<{ store: string; whatsapp: string }>({ store: '', whatsapp: waLink(read('gd_store_phone')) });

  // El link de la tienda online (si está publicada) y su WhatsApp
  useEffect(() => {
    const storeId = read('ventra_store_id');
    if (!storeId) return;
    import('../../services/onlineStore')
      .then((m) => m.loadStoreConfig(storeId))
      .then((cfg: any) => setLinks((l) => ({
        store: cfg?.isPublished && cfg?.subdomain ? publicStoreUrl(cfg.subdomain) : '',
        whatsapp: waLink(cfg?.whatsappNumber || '') || l.whatsapp,
      })))
      .catch(() => {});
  }, []);

  const chooseQr = (kind: string) => {
    const url = kind === 'store' ? links.store : kind === 'whatsapp' ? links.whatsapp : '';
    if (kind !== 'none' && !url) {
      toast.error(kind === 'store' ? 'Primero publicá tu tienda online' : 'Cargá el teléfono del comercio (Datos del comercio)');
      return;
    }
    setQr(kind);
    setStoreSetting('ticket_qr_url', url);
    setStoreSetting('ticket_qr', kind);
  };

  const printTest = async () => {
    // La vista previa de abajo es la que sale: misma hoja que un ticket de verdad
    flushSync(() => setPrinting(true));
    if (canPrintSilently()) {
      const aviso = toast.loading('Imprimiendo la prueba...');
      try { await printSilently('ticket'); toast.success('Prueba enviada a la impresora', { id: aviso }); }
      catch (err) { toast.error(printFailMessage(err), { id: aviso, duration: 8000 }); }
      finally { setPrinting(false); }
      return;
    }
    // En tablets window.print() vuelve antes de imprimir: se saca al terminar
    const done = () => { window.removeEventListener('afterprint', done); setTimeout(() => setPrinting(false), 1500); };
    window.addEventListener('afterprint', done);
    window.print();
  };

  const pill = (on: boolean) => `px-3 py-2 rounded-xl text-[13px] font-semibold border transition-colors ${on ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-rose-300'}`;
  const storeName = (read('gd_store_name') || 'Mi comercio').toUpperCase();

  return (
    <div className="card p-6 space-y-5">
      {printing && <style>{ticketPrintCss('#printable-receipt-test', width)}</style>}
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-rose-50 text-rose-600"><Receipt className="w-[18px] h-[18px]" /></span>
        <h3 className="text-[15px] font-bold text-slate-900 tracking-tight">Cómo sale el ticket</h3>
      </div>

      <div className="grid md:grid-cols-[1fr_auto] gap-6">
        <div className="space-y-5">
          <div>
            <label className="block text-[12.5px] font-semibold text-slate-600 mb-1.5">Ancho del papel (esta PC)</label>
            <div className="flex gap-2">
              {([80, 58] as TicketWidth[]).map((w) => (
                <button key={w} type="button" className={pill(width === w)} onClick={() => { setWidth(w); setTicketWidth(w); }}>{w} mm</button>
              ))}
            </div>
            <p className="text-[12.5px] text-slate-500 mt-1.5">Mirá el rollo: el ancho viene escrito en la caja. Si el ticket sale cortado a la derecha, es de 58 mm.</p>
          </div>

          <div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={logoOn} className="w-4 h-4 accent-rose-600"
                onChange={(e) => { setLogoOn(e.target.checked); setStoreSetting('ticket_logo', e.target.checked ? '1' : '0'); }} />
              <span className="text-[14px] font-semibold text-slate-800">Logo arriba</span>
            </label>
            {logoOn && (
              <div className="mt-2">
                <StoreLogoField compact onChange={(l) => setHasLogo(!!l)} />
                <p className="text-[12.5px] text-slate-500 mt-1">{hasLogo ? 'Sale en blanco y negro, que es lo que imprime la térmica.' : 'Subí el logo y sale en todos los tickets.'}</p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[12.5px] font-semibold text-slate-600 mb-1.5">QR al pie</label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={pill(qr === 'none')} onClick={() => chooseQr('none')}>Sin QR</button>
              <button type="button" className={pill(qr === 'store')} onClick={() => chooseQr('store')}>Mi tienda online</button>
              <button type="button" className={pill(qr === 'whatsapp')} onClick={() => chooseQr('whatsapp')}>Mi WhatsApp</button>
            </div>
            <p className="text-[12.5px] text-slate-500 mt-1.5">El cliente lo escanea y te vuelve a comprar: abre tu tienda o te escribe por WhatsApp. En las facturas no va (ya llevan el QR de ARCA).</p>
          </div>

          <div>
            <label className="block text-[12.5px] font-semibold text-slate-600 mb-1.5">Mensaje al pie</label>
            <input value={footer} maxLength={90} placeholder={`¡Muchas gracias por su compra! - ${storeName}`}
              onChange={(e) => setFooter(e.target.value)}
              onBlur={() => setStoreSetting('ticket_footer', footer.trim())}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[14px] bg-white" />
            <p className="text-[12.5px] text-slate-500 mt-1.5">Ej.: "Seguinos en Instagram @tukiosco". La dirección y el teléfono salen de Datos del comercio.</p>
          </div>

          <button type="button" onClick={printTest}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800">
            <Printer className="w-4 h-4" /> Imprimir prueba
          </button>
        </div>

        <div>
          <p className="text-[12.5px] font-semibold text-slate-600 mb-1.5">Vista previa</p>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-3 mx-auto" style={{ width: width === 58 ? 230 : 310 }}>
            <TicketReceipt createdSale={SAMPLE} storeName={storeName} formatPrice={money} />
          </div>
        </div>
      </div>

      {/* La hoja que sale con "Imprimir prueba" */}
      <div id="printable-receipt-test" style={{ display: 'none' }}>
        <TicketReceipt createdSale={SAMPLE} storeName={storeName} formatPrice={money} />
      </div>
    </div>
  );
}

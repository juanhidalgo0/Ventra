import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { SalesNoteSheet, loadSalesNoteContext, MissingStoreNameError, type SalesNoteContext, type SalesNoteShow } from './SalesNoteSheet';
import DocumentPreview from '../common/DocumentPreview';

const OPTIONS: { key: SalesNoteShow; label: string; help: string }[] = [
  { key: 'both', label: 'Las dos', help: 'La nota de venta (con precios) se la queda el cliente. El remito (sin precios) lo firma quien recibe y vuelve con el chofer.' },
  { key: 'note', label: 'Nota de venta', help: 'Con precios y total: es el comprobante de lo que compró el cliente.' },
  { key: 'remito', label: 'Remito', help: 'Sin precios: lo firma quien recibe la mercadería y vuelve con el chofer como prueba de entrega.' },
];
const DOC_LABEL: Record<SalesNoteShow, string> = { both: 'la nota de venta y el remito', note: 'la nota de venta', remito: 'el remito' };
const FILE_LABEL: Record<SalesNoteShow, string> = { both: 'Nota_y_remito', note: 'Nota_de_venta', remito: 'Remito' };
const money = (n: number) => `$ ${(Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

/** Distribuidora: la nota de venta y el remito de una venta, en pantalla antes de imprimir. */
export default function SalesNotePreview({ sale, paymentLabel, initialShow = 'both', onClose }: { sale: any; paymentLabel?: string; initialShow?: SalesNoteShow; onClose: () => void }) {
  const [ctx, setCtx] = useState<SalesNoteContext | null>(null);
  const [show, setShow] = useState<SalesNoteShow>(initialShow);

  useEffect(() => {
    let alive = true;
    loadSalesNoteContext(sale)
      .then((c) => { if (alive) setCtx(c); })
      .catch((err) => {
        toast.error(err instanceof MissingStoreNameError ? err.message : 'No se pudo armar la nota de venta', { duration: 6000 });
        onClose();
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale]);

  const client = ctx?.client;
  const numero = String(sale.saleNumber ?? 0).padStart(8, '0');
  const safe = (s: string) => s.replace(/[^\wÀ-ſ]+/g, '_').slice(0, 30);

  return (
    <DocumentPreview
      title={`Venta N° ${numero}`}
      subtitle={`${client?.name || 'Sin cliente'}${client?.locality ? ` · ${client.locality}` : ''}`}
      options={OPTIONS}
      option={show}
      onOption={(k) => setShow(k as SalesNoteShow)}
      loading={!ctx}
      fileName={`${FILE_LABEL[show]}_${numero}${client?.name ? '_' + safe(client.name) : ''}`}
      whatsapp={ctx ? {
        phone: client?.phone,
        text: `¡Hola${client?.name ? ' ' + client.name : ''}! Te mando ${DOC_LABEL[show]} N° ${numero} de ${ctx.emisor.name}` + (show !== 'remito' ? ` por ${money(Number(sale.total) || 0)}.` : '.'),
        hint: client?.phone ? `Al ${client.phone}` : 'El cliente no tiene teléfono: elegís el contacto en WhatsApp',
      } : undefined}
      onClose={onClose}
      render={(paper) => ctx && (
        <SalesNoteSheet sale={sale} client={ctx.client} emisor={ctx.emisor} paymentLabel={paymentLabel} codeOf={ctx.codeOf} show={show} paper={paper} />
      )}
    />
  );
}

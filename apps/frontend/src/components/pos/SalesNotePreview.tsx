import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { SalesNoteSheet, loadSalesNoteContext, MissingStoreNameError, readNoteCopies, printedNumber, type SalesNoteContext, type SalesNoteShow } from './SalesNoteSheet';
import SheetOptions from './SheetOptions';
import DocumentPreview from '../common/DocumentPreview';

// Lo de casi todas las distribuidoras: una hoja con precios que firma quien recibe. Sin precios,
// para cuando recibe un empleado que no tiene que ver los importes.
const OPTIONS: { key: SalesNoteShow; label: string; help: string }[] = [
  { key: 'note', label: 'Con precios', help: 'Nota de venta con precios, total y lugar para la firma: el cliente se queda con los precios y firma que recibió.' },
  { key: 'remito', label: 'Sin precios', help: 'Remito sin importes, con lugar para la firma: para cuando recibe un empleado que no tiene que ver los precios.' },
];
const DOC_LABEL: Record<SalesNoteShow, string> = { both: 'la nota de venta y el remito', note: 'la nota de venta', remito: 'el remito' };
const FILE_LABEL: Record<SalesNoteShow, string> = { both: 'Nota_y_remito', note: 'Nota_de_venta', remito: 'Remito' };
const money = (n: number) => `$ ${(Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

/** Distribuidora: la nota de venta y el remito de una venta, en pantalla antes de imprimir. */
export default function SalesNotePreview({ sale, paymentLabel, initialShow = 'note', onClose }: { sale: any; paymentLabel?: string; initialShow?: SalesNoteShow; onClose: () => void }) {
  const [ctx, setCtx] = useState<SalesNoteContext | null>(null);
  const [show, setShow] = useState<SalesNoteShow>(initialShow);
  const [copies, setCopies] = useState(readNoteCopies);

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
  // El número que va impreso (puede seguir la numeración de los talonarios: ver printedNumber)
  const impreso = printedNumber(sale.saleNumber);
  const safe = (s: string) => s.replace(/[^\wÀ-ſ]+/g, '_').slice(0, 30);

  return (
    <DocumentPreview
      title={`Venta N° ${numero}`}
      subtitle={`${client?.name || 'Sin cliente'}${client?.locality ? ` · ${client.locality}` : ''}`}
      options={OPTIONS}
      option={show}
      onOption={(k) => setShow(k as SalesNoteShow)}
      loading={!ctx}
      fileName={`${FILE_LABEL[show]}_${impreso}${client?.name ? '_' + safe(client.name) : ''}`}
      whatsapp={ctx ? {
        phone: client?.phone,
        text: `¡Hola${client?.name ? ' ' + client.name : ''}! Te mando ${DOC_LABEL[show]} N° ${impreso} de ${ctx.emisor.name}` + (show !== 'remito' ? ` por ${money(Number(sale.total) || 0)}.` : '.'),
        hint: client?.phone ? `Al ${client.phone}` : 'El cliente no tiene teléfono: elegís el contacto en WhatsApp',
      } : undefined}
      onClose={onClose}
      notice={<SheetOptions copies={copies} onCopies={setCopies} onSaved={() => loadSalesNoteContext(sale).then(setCtx).catch(() => {})} />}
      render={(paper) => ctx && (
        <SalesNoteSheet sale={sale} client={ctx.client} emisor={ctx.emisor} paymentLabel={paymentLabel} codeOf={ctx.codeOf} show={show} copies={copies} paper={paper} />
      )}
    />
  );
}

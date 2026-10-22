import toast from 'react-hot-toast';
import { clientOrderLink } from '../../services/onlineStore';

/** Número de WhatsApp argentino ("221 555-0199" → 5492215550199) */
export function waNumber(phone?: string | null) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('54')) return d.startsWith('549') ? d : '549' + d.slice(2);
  d = d.replace(/^0/, '');
  return d.length >= 10 ? '549' + d : null;
}

/**
 * Venta a comercios: arma el link personal del cliente para pedir en la tienda y lo manda por
 * WhatsApp (o lo copia, si el cliente no tiene teléfono). Devuelve el link o null si no se pudo.
 */
export async function sendClientOrderLink(client: any): Promise<string | null> {
  const busy = toast.loading('Armando el link…');
  try {
    const url = await clientOrderLink(client);
    toast.dismiss(busy);
    try { await navigator.clipboard.writeText(url); } catch { /* sin portapapeles: igual se abre WhatsApp */ }
    const wa = waNumber(client.phone);
    const store = (localStorage.getItem('gd_store_name') || '').trim();
    const text = `¡Hola${client.name ? ` ${client.name}` : ''}! Este es tu link para hacernos los pedidos${store ? ` a ${store}` : ''}: ${url}\nEntrás con tus datos ya cargados y podés repetir tu último pedido.`;
    if (wa) {
      window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, '_blank');
      toast.success('Link copiado y listo para mandar por WhatsApp');
    } else {
      toast.success('Link copiado. El cliente no tiene teléfono: pegáselo donde quieras.');
    }
    return url;
  } catch (err: any) {
    toast.dismiss(busy);
    const msg = err?.message === 'WHOLESALE_OFF'
      ? 'Primero activá la venta a comercios en Tienda online → Venta a comercios.'
      : err?.message === 'STORE_OFF'
        ? 'Tu tienda online todavía no está publicada: publicala desde Tienda online.'
        : 'No se pudo armar el link. Revisá la conexión y que la PC esté vinculada a tu cuenta.';
    toast.error(msg, { duration: 7000 });
    return null;
  }
}

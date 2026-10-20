// Ayudas de los encargos que usan el inicio y la pantalla (sin traer la pantalla entera)

/** Número de WhatsApp argentino a partir de lo que esté cargado ("221 555-0199" → 5492215550199) */
export function waNumber(phone?: string | null) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('54')) return d.startsWith('549') ? d : '549' + d.slice(2);
  d = d.replace(/^0/, '');
  return d.length >= 10 ? '549' + d : null;
}

export const dayDiff = (d: Date) => {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
};
export function dueLabel(due: any) {
  if (!due) return 'Sin fecha de entrega';
  const d = new Date(due);
  const n = dayDiff(d);
  const hour = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : n === -1 ? 'Ayer' : d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' }).replace(',', '');
  return `${day} ${hour}`;
}

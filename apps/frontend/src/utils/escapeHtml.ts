/**
 * Escapa un texto para meterlo en HTML armado a mano (reportes para imprimir o PDF).
 * Nombres de productos, clientes o notas los escribe cualquiera (y algunos llegan de la
 * tienda online): sin escapar, un nombre con "<img onerror=…>" ejecutaba código en la app.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

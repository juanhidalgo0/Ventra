/** Icono propio de "Venta rápida": bolsa de compra con un rayo. */
export default function QuickSaleIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 8h14l-1.2 11.1A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.9L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      <path d="M12.8 11 10.2 15h3.6l-2.6 4" fill="currentColor" strokeWidth={1.6} />
    </svg>
  );
}

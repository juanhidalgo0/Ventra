import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import QuotesListModal from './QuotesListModal';

/** La lista de presupuestos como pantalla, para entrar desde el menú lateral */
export default function QuotesScreen() {
  const navigate = useNavigate();
  // Cargar al carrito o pasar a encargo ya llevan a otra pantalla: al cerrar no hay que volver a navegar
  const left = useRef(false);
  return (
    <QuotesListModal
      onClose={() => { if (!left.current) navigate('/pos'); }}
      onLoadCart={() => { left.current = true; navigate('/pos'); }}
      onToWorkOrder={(draft) => {
        left.current = true;
        try { sessionStorage.setItem('ventra_workorder_from_online', JSON.stringify(draft)); } catch { /* sin espacio: se carga a mano */ }
        navigate('/encargos?nuevo=1');
      }}
    />
  );
}

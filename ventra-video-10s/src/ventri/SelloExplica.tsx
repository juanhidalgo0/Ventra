import React from 'react';
import { inter } from '../marca';
import { CREMA, VERDE } from './comun';

// El sello de la sección "Ventri explica". SIEMPRE igual en todos los episodios: misma esquina (arriba a la
// izquierda, debajo de la barra de Instagram), mismo tamaño, verde Ventra sobre crema, un poco torcido como
// un sello de goma. Aparece con corte seco, sin rebote ni animación.
export const SelloExplica: React.FC = () => (
  <div
    style={{
      position: 'absolute', top: 178, left: 44, transform: 'rotate(-3deg)', transformOrigin: 'left top',
      padding: '10px 20px 8px', background: CREMA, border: `5px solid ${VERDE}`, borderRadius: 10,
      boxShadow: '0 5px 0 rgba(0,0,0,.35)', fontFamily: inter, fontWeight: 900, fontSize: 36, letterSpacing: 3,
      color: VERDE, lineHeight: 1,
    }}
  >
    <span style={{ display: 'inline-block', borderBottom: `3px solid ${VERDE}`, paddingBottom: 4 }}>VENTRI EXPLICA</span>
  </div>
);

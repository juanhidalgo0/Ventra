import './demo/resetEpoch'; // demo pública: reinicio general (antes que todo, los stores leen el navegador al cargar)
import './perfModeDefault';
import './utils/pwaInstall';
import './utils/externalLinks'; // en la app de escritorio, los enlaces externos abren el navegador // escucha desde el arranque el aviso de "se puede instalar"
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionGlobalConfig } from 'framer-motion';

// En computadoras, framer-motion queda apagado: sus animaciones corren en JS cuadro
// por cuadro y son lo que más traba una PC vieja. Todo llega directo a su estado
// final (entradas, salidas, barras); las animaciones que quedan son CSS livianas
// (index.css). En celulares (la app del dueño) se mantienen.
MotionGlobalConfig.skipAnimations = !(window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 768);
import { HashRouter } from 'react-router-dom';
import AppToaster from './components/common/AppToaster';
import App from './App';
import { installErrorReport } from './services/errorReport';
import './fonts';
import './index.css';
import './cursores.css'; // después de index.css: les gana a las clases cursor-* de Tailwind
import './utils/cursorSize';

// Chrome manda teclas "falsas" (sin key ni code) cuando autocompleta un campo: se frenan acá,
// antes que cualquier otro oyente, para que nadie lea e.key.length sobre undefined.
window.addEventListener('keydown', (e) => {
  if (typeof e.key !== 'string') e.stopImmediatePropagation();
}, true);

// Si se publicó una caja web nueva con la pestaña abierta, los pedazos viejos ya no existen
// ("Failed to fetch dynamically imported module"): se recarga una vez para tomar la versión nueva.
window.addEventListener('vite:preloadError', (ev) => {
  try {
    const KEY = 'ventra_reload_chunk';
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60_000) return; // ya se recargó hace poco: que siga y se reporte
    sessionStorage.setItem(KEY, String(Date.now()));
    ev.preventDefault();
    window.location.reload();
  } catch { /* sin sessionStorage: que siga el error normal */ }
});

// Errores que nadie atrapa: van al admin (pestaña Cajas)
installErrorReport();

// React root render

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <AppToaster />
    </HashRouter>
  </React.StrictMode>,
);

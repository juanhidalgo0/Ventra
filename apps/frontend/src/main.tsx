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
import './fonts';
import './index.css';

// React root render

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <AppToaster />
    </HashRouter>
  </React.StrictMode>,
);

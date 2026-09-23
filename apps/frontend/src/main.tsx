import './perfModeDefault';
import './utils/pwaInstall';
import './utils/externalLinks'; // en la app de escritorio, los enlaces externos abren el navegador // escucha desde el arranque el aviso de "se puede instalar"
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import AppToaster from './components/common/AppToaster';
import App from './App';
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

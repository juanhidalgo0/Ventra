import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

// React root render
localStorage.removeItem('server_ip');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: { background: '#fff', color: '#1e293b', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '14px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' },
          success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
          error: { iconTheme: { primary: '#f43f5e', secondary: '#fff' } },
        }}
      />
    </HashRouter>
  </React.StrictMode>,
);

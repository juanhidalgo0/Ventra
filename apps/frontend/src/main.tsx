import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { Toaster, ToastBar, toast } from 'react-hot-toast';
import App from './App';
import './index.css';

// React root render

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <Toaster
        position="top-right"
        containerClassName="keep-animated"
        toastOptions={{
          duration: 3000,
        }}
      >
        {(t) => (
          <ToastBar 
            toast={t}
            style={{ 
              padding: 0, 
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              border: '1px solid #e2e8f0',
              borderRadius: '12px'
            }}
          >
            {({ icon, message }) => (
              <div className="relative flex flex-col w-full min-w-[300px]">
                <div 
                  className="flex items-center gap-3 p-4 bg-white cursor-pointer" 
                  onClick={() => {
                    toast.dismiss(t.id);
                    const posInput = document.getElementById('pos-search') as HTMLInputElement | null;
                    if (posInput) {
                      setTimeout(() => posInput.focus(), 30);
                    }
                  }}
                >
                  {icon}
                  <div className="flex-1 text-sm font-semibold text-slate-800 break-words">{message}</div>
                </div>
                
                {t.duration && t.duration !== Infinity && (
                  <div className="w-full h-1 bg-slate-100">
                    <div 
                      className={`h-full ${t.type === 'error' ? 'bg-rose-500' : t.type === 'success' ? 'bg-emerald-500' : 'bg-slate-400'}`}
                      style={{ 
                        animation: t.visible ? `toast-progress ${t.duration}ms linear forwards` : 'none' 
                      }} 
                    />
                  </div>
                )}
              </div>
            )}
          </ToastBar>
        )}
      </Toaster>
    </HashRouter>
  </React.StrictMode>,
);

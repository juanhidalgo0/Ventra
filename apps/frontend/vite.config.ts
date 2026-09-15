import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5180,
    host: true,
    strictPort: true,
    proxy: {
      '/api': { 
        target: 'http://localhost:3001', 
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (res && !(res as any).headersSent) {
              (res as any).writeHead?.(503, { 'Content-Type': 'application/json' });
              (res as any).end?.(JSON.stringify({ message: 'Servidor iniciando...' }));
            }
          });
        }
      },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});

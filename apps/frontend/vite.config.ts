import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Demo pública (go-portal-pos): VENTRA_DEMO=true cambia el SDK de Firebase por versiones locales
// (src/demo/firebase) que guardan todo en el navegador. Así la demo nunca crea nada real.
const DEMO = process.env.VENTRA_DEMO === 'true';
const demoFirebase = DEMO
  ? ['app', 'auth', 'firestore', 'storage', 'messaging'].map((m) => ({
      find: new RegExp(`^firebase/${m}$`),
      replacement: path.resolve(__dirname, `./src/demo/firebase/${m}.ts`),
    }))
  : [];

export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __VENTRA_DEMO__: JSON.stringify(DEMO) },
  resolve: { alias: [{ find: '@', replacement: path.resolve(__dirname, './src') }, ...demoFirebase] },
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

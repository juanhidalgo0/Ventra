// SOLO DESARROLLO: igual que vite.config.ts, pero los servicios de la tienda online y de
// Firebase se reemplazan por versiones en memoria (src/dev/reel*Mock.ts). Para grabar el
// reel de la tienda sin tocar datos reales: npx vite --config vite.reel.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Tailwind busca las clases con rutas relativas a la carpeta de trabajo: si el servidor se
// lanza desde otra carpeta (por ejemplo la raíz del repo) la página sale casi sin estilos.
process.chdir(__dirname);

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: /^(?:\.\.?\/)+(?:services\/)?onlineStore$/, replacement: path.resolve(__dirname, './src/dev/reelStoreMock.ts') },
      { find: /^(?:\.\.?\/)+(?:services\/)?ventraFirebase$/, replacement: path.resolve(__dirname, './src/dev/reelFirebaseMock.ts') },
      { find: /^(?:\.\.?\/)+(?:services\/)?agenda$/, replacement: path.resolve(__dirname, './src/dev/reelAgendaMock.ts') },
      { find: /^(?:\.\.?\/)+(?:utils\/)?overlayWatchdog$/, replacement: path.resolve(__dirname, './src/dev/reelNoop.ts') },
    ],
  },
  server: { port: 5181, host: true, strictPort: true },
});

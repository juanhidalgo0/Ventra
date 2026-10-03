// true solo en la compilación de la demo pública (VENTRA_DEMO=true, ver vite.config.ts)
declare const __VENTRA_DEMO__: boolean;
export const IS_DEMO_BUILD = typeof __VENTRA_DEMO__ !== 'undefined' && __VENTRA_DEMO__;

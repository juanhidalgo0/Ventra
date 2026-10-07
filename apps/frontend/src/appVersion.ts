declare const __APP_VERSION__: string;
/** Versión de Ventra con la que se armó esta app (vacía si no se pudo leer) */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

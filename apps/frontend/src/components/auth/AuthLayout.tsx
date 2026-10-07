import type { ReactNode } from 'react';
import { MangoLogo } from '../common/MangoLogo';
import { APP_VERSION } from '../../appVersion';

/**
 * Marco de las pantallas de entrada (configuración inicial e ingreso). Estructura de siempre
 * (logo centrado arriba, contenido en tarjetas) para no confundir a nadie, con un estilo más
 * prolijo: tipografía liviana, bordes finos, versión de la app y ayuda abajo.
 */
export default function AuthLayout({ topLeft, children, wide = false }: {
  /** Acción chica arriba a la izquierda (ej. "Cambiar cómo se usa esta PC") */
  topLeft?: ReactNode;
  /** Ancho para dos tarjetas lado a lado (configuración inicial) */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 flex flex-col relative overflow-x-hidden">
      {topLeft && <div className="absolute top-5 left-5 z-20">{topLeft}</div>}

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-10">
        <div className={`w-full ${wide ? 'max-w-[600px]' : 'max-w-[420px]'}`}>
          <div className="text-center mb-8 flex flex-col items-center select-none">
            <MangoLogo className="w-12 h-12 rounded-xl" />
            <h1 className="mt-4 text-[24px] font-semibold tracking-[-0.02em] leading-none">Ventra</h1>
            <p className="mt-2 text-[13px] text-slate-500">Terminal de ventas</p>
          </div>
          {children}
        </div>
      </main>

      <footer className="flex items-center justify-between px-5 sm:px-6 h-12 shrink-0 text-[12px] text-slate-500 select-none">
        <span className="tabular-nums">{APP_VERSION ? `Versión ${APP_VERSION}` : 'Ventra'}</span>
        <a href="https://ventra.store" target="_blank" rel="noreferrer" className="hover:text-slate-900 transition-colors">¿Necesitás ayuda? ventra.store</a>
      </footer>
    </div>
  );
}

/** Tarjeta blanca de borde fino */
export const authCard = 'bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6 sm:p-7';
/** Título dentro de una tarjeta */
export const authTitle = 'text-[20px] leading-tight font-semibold tracking-[-0.02em] text-slate-900';
export const authLead = 'mt-1.5 text-[14px] text-slate-600 leading-relaxed';
/** Estilos compartidos de los formularios de entrada */
export const authLabel = 'block text-[13px] font-medium text-slate-700 mb-2';
export const authInput = 'w-full h-11 rounded-lg border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition';
export const authPrimaryButton = 'w-full h-11 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[14px] font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
export const authSecondaryButton = 'w-full h-11 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 text-[14px] font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer';
/** Ícono en un cuadrado de borde fino */
export const authIconBox = 'w-9 h-9 shrink-0 rounded-lg border border-slate-200 bg-white grid place-items-center text-slate-600';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { MangoLogo } from '../common/MangoLogo';
import { APP_VERSION } from '../../appVersion';

const STEPS = ['Esta PC', 'Ingresar'];

/**
 * Marco común de las pantallas de entrada (configuración inicial, ingreso, arranque):
 * panel de marca a la izquierda, contenido a la derecha, pasos arriba y versión abajo.
 */
export default function AuthLayout({ step, headerAction, children }: {
  /** Paso actual (1 o 2); sin paso no se muestra el indicador */
  step?: number;
  /** Acción chica arriba a la derecha (ej. "Cambiar cómo se usa esta PC") */
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen h-screen w-screen flex bg-white text-slate-900 overflow-hidden">
      <aside className="hidden lg:flex w-[40%] max-w-[560px] shrink-0 flex-col justify-between bg-rose-900 text-white px-12 py-10 select-none">
        <div className="flex items-center gap-3">
          <MangoLogo className="w-9 h-9 rounded-[10px]" />
          <span className="text-[17px] font-semibold tracking-tight">Ventra</span>
        </div>

        <div className="max-w-[400px]">
          <h1 className="text-[34px] leading-[1.15] font-semibold tracking-[-0.02em]">
            Tu caja, tu stock y tus ventas, en un solo lugar.
          </h1>
          <ul className="mt-8 space-y-4 text-[15px] text-rose-100/90">
            {[
              'Cobrás rápido, con lector de códigos y todos los medios de pago.',
              'El stock se actualiza solo con cada venta y cada compra.',
              'Ves cómo va el negocio desde el celular, estés donde estés.',
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <Check className="w-4 h-4 mt-[3px] shrink-0 text-rose-300" strokeWidth={2.5} />
                <span className="leading-snug">{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[13px] text-rose-200/70">Hecho en Argentina para kioscos, almacenes y comercios de barrio.</p>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-4 px-6 sm:px-10 h-16 shrink-0">
          <div className="flex items-center gap-2.5 lg:invisible select-none">
            <MangoLogo className="w-7 h-7 rounded-lg" />
            <span className="text-[15px] font-semibold tracking-tight">Ventra</span>
          </div>
          <div className="flex items-center gap-6">
            {headerAction}
            {step && (
              <ol className="hidden sm:flex items-center gap-2 text-[13px] select-none" aria-label="Pasos">
                {STEPS.map((label, i) => {
                  const n = i + 1;
                  const done = n < step;
                  const active = n === step;
                  return (
                    <li key={label} className="flex items-center gap-2">
                      {i > 0 && <span className="w-6 h-px bg-slate-200" />}
                      <span className={`w-5 h-5 rounded-full grid place-items-center text-[11px] font-semibold tabular-nums ${active ? 'bg-slate-900 text-white' : done ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {done ? <Check className="w-3 h-3" strokeWidth={3} /> : n}
                      </span>
                      <span className={active ? 'font-medium text-slate-900' : 'text-slate-500'}>{label}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center px-6 sm:px-10 overflow-y-auto">
          <div className="w-full max-w-[440px] py-10">{children}</div>
        </div>

        <footer className="flex items-center justify-between px-6 sm:px-10 h-14 shrink-0 text-[12px] text-slate-500">
          <span className="tabular-nums">{APP_VERSION ? `Versión ${APP_VERSION}` : 'Ventra'}</span>
          <a href="https://ventra.store" target="_blank" rel="noreferrer" className="hover:text-slate-900 transition-colors">¿Necesitás ayuda? ventra.store</a>
        </footer>
      </main>
    </div>
  );
}

/** Estilos compartidos de los formularios de entrada */
export const authInput = 'w-full h-11 rounded-lg border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition';
export const authPrimaryButton = 'w-full h-11 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[14px] font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
export const authTitle = 'text-[28px] leading-tight font-semibold tracking-[-0.02em]';
export const authLead = 'mt-2 text-[15px] text-slate-600 leading-relaxed';

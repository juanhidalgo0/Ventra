import type { ComponentType } from 'react';
import { Sparkles } from 'lucide-react';

/** Etiqueta chica para menús y botones de funciones que todavía no están habilitadas */
export function ComingSoonBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${className}`}>
      Próximamente
    </span>
  );
}

/** Tarjeta que ocupa el lugar de una función que todavía no está habilitada */
export function ComingSoonCard({ title, description, icon: Icon = Sparkles }: { title: string; description: string; icon?: ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex items-start gap-4">
      <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
          <ComingSoonBadge />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{description}</p>
      </div>
    </div>
  );
}

/** Pantalla completa para una sección del menú que todavía no está habilitada */
export default function ComingSoonScreen({ title, description, icon }: { title: string; description: string; icon?: ComponentType<{ className?: string }> }) {
  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto w-full">
      <ComingSoonCard title={title} description={description} icon={icon} />
    </div>
  );
}

import { useNavigate, useParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ChevronRight } from 'lucide-react';
import { ScreenHeader } from './ui';
import { SETTINGS_SECTIONS, settingsSection } from '../settings/settingsSections';

const SettingsScreen = lazy(() => import('../settings/SettingsScreen'));

/** Índice de Configuración en el celular: las mismas secciones y grupos que en la PC, que se abren de a una. */
export default function MobileSettingsScreen() {
  const navigate = useNavigate();
  const groups = (['Tu negocio', 'Caja', 'Equipo', 'Sistema', null] as const)
    .map((g) => ({ title: g, items: SETTINGS_SECTIONS.filter((s) => s.group === g) }))
    .filter((g) => g.items.length);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader back title="Configuración" subtitle="Ajustá el sistema a tu negocio" />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
        {groups.map((g) => (
          <div key={g.title || 'peligro'}>
            {g.title && <p className="px-1 pb-1.5 text-[12px] font-semibold text-slate-500">{g.title}</p>}
            <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
              {g.items.map(({ id, label, description, icon: Icon, danger }) => (
                <button key={id} onClick={() => navigate(`/settings/${id}`)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-red-50 text-red-600' : 'bg-rose-50 text-rose-700'}`}><Icon className="w-5 h-5" /></span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[14.5px] font-medium ${danger ? 'text-red-700' : 'text-slate-800'}`}>{label}</span>
                    <span className="block text-[12px] text-slate-500 truncate">{description}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[12px] text-slate-400 text-center px-6">Algunos ajustes (impresora, copias de seguridad) aplican a la PC donde corre el sistema.</p>
      </div>
    </div>
  );
}

/** Una sección de Configuración a pantalla completa (el contenido es el mismo de la PC). */
export function MobileSettingsSection() {
  const { tab } = useParams();
  const section = settingsSection(tab);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader back title={section?.label || 'Configuración'} />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Suspense fallback={null}>
          <SettingsScreen key={section?.id || tab} initialTab={section?.id || tab} embedded />
        </Suspense>
      </div>
    </div>
  );
}

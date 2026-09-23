import { useNavigate, useParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Laptop, Sliders, Calculator, Users, Database, BadgeCheck, Link2, ShieldAlert, ChevronRight } from 'lucide-react';
import { ScreenHeader } from './ui';

const SettingsScreen = lazy(() => import('../settings/SettingsScreen'));

/** Mismas secciones que la Configuración de la PC. */
export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General y caja', hint: 'Rubro, terminal y punto de venta', icon: Laptop, tint: 'bg-rose-50 text-rose-700' },
  { id: 'posnets', label: 'Medios de pago', hint: 'Posnets y cobros que aceptás', icon: Sliders, tint: 'bg-sky-50 text-sky-700' },
  { id: 'recargos', label: 'Recargos', hint: 'Por medio de pago y categoría', icon: Calculator, tint: 'bg-amber-50 text-amber-700' },
  { id: 'personal', label: 'Personal y cajeros', hint: 'Usuarios, roles y contraseñas', icon: Users, tint: 'bg-violet-50 text-violet-700' },
  { id: 'suscripcion', label: 'Suscripción y nube', hint: 'Tu plan y la copia en la nube', icon: BadgeCheck, tint: 'bg-emerald-50 text-emerald-700' },
  { id: 'backups', label: 'Copias de seguridad', hint: 'Backups y restauración', icon: Database, tint: 'bg-slate-100 text-slate-700' },
  { id: 'integraciones', label: 'Integraciones', hint: 'Servicios conectados', icon: Link2, tint: 'bg-slate-100 text-slate-700' },
  { id: 'mantenimiento', label: 'Mantenimiento', hint: 'Reinicios y limpieza de datos', icon: ShieldAlert, tint: 'bg-red-50 text-red-600' },
];

/** Índice de Configuración en el celular: una lista de secciones que se abren de a una. */
export default function MobileSettingsScreen() {
  const navigate = useNavigate();
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader back title="Configuración" subtitle="Ajustá el sistema a tu negocio" />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
          {SETTINGS_SECTIONS.map(({ id, label, hint, icon: Icon, tint }) => (
            <button key={id} onClick={() => navigate(`/settings/${id}`)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tint}`}><Icon className="w-5 h-5" /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14.5px] font-medium text-slate-800">{label}</span>
                <span className="block text-[12px] text-slate-500 truncate">{hint}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>
          ))}
        </div>
        <p className="text-[12px] text-slate-400 text-center mt-4 px-6">Algunos ajustes (impresora, copias de seguridad) aplican a la PC donde corre el sistema.</p>
      </div>
    </div>
  );
}

/** Una sección de Configuración a pantalla completa (el contenido es el mismo de la PC). */
export function MobileSettingsSection() {
  const { tab } = useParams();
  const section = SETTINGS_SECTIONS.find((s) => s.id === tab);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader back title={section?.label || 'Configuración'} />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Suspense fallback={null}>
          <SettingsScreen initialTab={tab} embedded />
        </Suspense>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { motion } from 'framer-motion';
import { UserPlus, Pencil, X, Save } from 'lucide-react';
import { WORK_ROLES, IMPRENTA_ROLES } from '../../services/workRole';
import { hasFeature } from '../../stores/businessStore';
import { Field, Toggle, inputCls } from './SettingsUI';

export interface UserFormValues {
  username: string;
  password: string;
  role: string;
  workRole: string;
  isActive: boolean;
}

/** Alta y edición de un usuario del comercio (la misma ventana para las dos cosas). */
export default function UserFormModal({
  mode, initial, onClose, onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<UserFormValues>;
  onClose: () => void;
  onSubmit: (values: UserFormValues) => Promise<void>;
}) {
  const [v, setV] = useState<UserFormValues>({
    username: initial?.username || '',
    password: '',
    role: initial?.role || 'CASHIER',
    workRole: initial?.workRole || '',
    isActive: initial?.isActive !== false,
  });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<UserFormValues>) => setV((cur) => ({ ...cur, ...patch }));
  const edit = mode === 'edit';

  // Imprenta (o cualquier comercio con encargos): quién atiende y quién solo trabaja
  const workRoles = v.role === 'ADMIN'
    ? null
    : hasFeature('preorders')
      ? { title: '¿Qué hace en la distribuidora?', all: 'Elige en cada equipo', list: WORK_ROLES, note: 'Entra directo a lo suyo en cualquier celular o PC, y ve solo eso.' }
      : hasFeature('workorders')
        ? { title: '¿Qué hace en los encargos?', all: 'Atiende y trabaja', list: IMPRENTA_ROLES, note: 'Taller y Diseño entran directo a los encargos y no ven precios. Cancelar o cambiar el precio de un encargo con seña pide la clave del administrador.' }
        : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSubmit(v); } finally { setSaving(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-[16px] font-bold text-slate-900 flex items-center gap-2">
            {edit ? <Pencil className="w-[18px] h-[18px] text-rose-600" /> : <UserPlus className="w-[18px] h-[18px] text-rose-600" />}
            {edit ? 'Editar usuario' : 'Sumar usuario'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <Field label="Usuario" hint="Con este nombre entra a la caja. Sin espacios.">
            <input
              value={v.username}
              onChange={(e) => set({ username: e.target.value.toUpperCase().replace(/\s+/g, '') })}
              className={inputCls}
              placeholder="JUAN.PEREZ"
              required
              autoFocus={!edit}
            />
          </Field>

          <Field label={edit ? 'Contraseña nueva' : 'Contraseña'} hint={edit ? 'Dejala vacía para no cambiarla.' : undefined}>
            <input
              type="password"
              value={v.password}
              onChange={(e) => set({ password: e.target.value })}
              className={inputCls}
              placeholder={edit ? 'Sin cambios' : 'Elegí una contraseña'}
              required={!edit}
            />
          </Field>

          <Field label="Rol">
            <select value={v.role} onChange={(e) => set({ role: e.target.value })} className={`${inputCls} cursor-pointer`}>
              <option value="CASHIER">Cajero: vende y cobra</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="ADMIN">Administrador: acceso completo</option>
            </select>
          </Field>

          {workRoles && (
            <div>
              <p className="text-[12.5px] font-semibold text-slate-600 mb-1.5">{workRoles.title}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {[{ key: '', label: 'De todo', text: workRoles.all }, ...workRoles.list].map((w) => (
                  <button key={w.key || 'todo'} type="button" onClick={() => set({ workRole: w.key })}
                    className={`text-left px-3 py-2 rounded-xl border-2 cursor-pointer transition-colors ${v.workRole === w.key ? 'border-rose-500 bg-rose-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <span className="block text-[13px] font-semibold text-slate-800">{w.label}</span>
                    <span className="block text-[11.5px] text-slate-500 leading-tight">{w.text}</span>
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-slate-500 mt-1.5">{workRoles.note}</p>
            </div>
          )}

          {edit && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <span className="block text-[14px] font-semibold text-slate-800">Usuario activo</span>
                <span className="block text-[12px] text-slate-500">Apagado, no puede entrar.</span>
              </div>
              <Toggle checked={v.isActive} onChange={(isActive) => set({ isActive })} label="Usuario activo" />
            </div>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-slate-100">
          <button type="submit" disabled={saving} className="btn-primary flex-1 h-11 text-[14px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer">
            {edit ? <Save className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {saving ? 'Guardando…' : edit ? 'Guardar cambios' : 'Sumar usuario'}
          </button>
          <button type="button" onClick={onClose} className="h-11 px-5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-[14px] font-semibold cursor-pointer">
            Cancelar
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}

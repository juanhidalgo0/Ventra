import { useState } from 'react';
import toast from 'react-hot-toast';
import { createPatient, updatePatient, parseNum, ACTIVITY, type Patient, type Activity, type Sex } from '../../services/nutri';
import { localNow } from '../../services/agendaCore';
import { Modal, input, label } from '../agenda/agendaUi';
import { SEX_LABEL } from './nutriUi';

/**
 * Alta o edición de los datos del paciente. Solo el nombre es obligatorio: el resto se completa
 * cuando se puede (sin sexo, edad o altura no se calculan el % de grasa ni las calorías).
 */
export default function PatientForm({ storeId, patient, prefill, onClose, onSaved }: {
  storeId: string;
  patient?: Patient;
  prefill?: { name?: string; phone?: string };
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const p = patient;
  const [f, setF] = useState({
    name: p?.name || prefill?.name || '',
    phone: p?.phone || prefill?.phone || '',
    email: p?.email || '',
    dni: p?.dni || '',
    birthDate: p?.birthDate || '',
    sex: (p?.sex || '') as Sex | '',
    obraSocial: p?.obraSocial || '',
    occupation: p?.occupation || '',
    goal: p?.goal || '',
    goalWeight: p?.goalWeight != null ? String(p.goalWeight).replace('.', ',') : '',
    activity: (p?.activity || '') as Activity | '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    if (f.name.trim().length < 2) return toast.error('Escribí el nombre del paciente');
    setSaving(true);
    const data = {
      name: f.name.trim().slice(0, 80),
      phone: f.phone.trim() || undefined,
      email: f.email.trim() || undefined,
      dni: f.dni.replace(/\D/g, '') || undefined,
      birthDate: f.birthDate || undefined,
      sex: f.sex || undefined,
      obraSocial: f.obraSocial.trim() || undefined,
      occupation: f.occupation.trim() || undefined,
      goal: f.goal.trim() || undefined,
      goalWeight: parseNum(f.goalWeight),
      activity: f.activity || undefined,
    };
    try {
      if (p) { await updatePatient(storeId, p, data); toast.success('Datos guardados'); onSaved?.(p.id); }
      else { const id = await createPatient(storeId, data); toast.success('Paciente creado'); onSaved?.(id); }
      onClose();
    } catch (e: any) {
      console.warn('[Nutri] No se pudo guardar el paciente', e);
      toast.error('No se pudo guardar. Revisá la conexión.');
    } finally { setSaving(false); }
  };

  const today = localNow().dateKey;
  return (
    <Modal title={p ? 'Datos del paciente' : 'Nuevo paciente'} onClose={onClose}
      footer={<button disabled={saving} onClick={save} className="w-full h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-bold disabled:opacity-60">{saving ? 'Guardando…' : p ? 'Guardar' : 'Crear paciente'}</button>}>
      <div className="space-y-3.5">
        <div>
          <label className={label}>Nombre y apellido *</label>
          <input autoFocus={!p} value={f.name} onChange={set('name')} maxLength={80} placeholder="Ej.: Laura Gómez" className={input} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Teléfono (WhatsApp)</label>
            <input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="11 5555-1234" className={input} />
          </div>
          <div>
            <label className={label}>DNI</label>
            <input value={f.dni} onChange={set('dni')} inputMode="numeric" maxLength={12} className={input} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Fecha de nacimiento</label>
            <input type="date" value={f.birthDate} max={today} min="1900-01-01" onChange={set('birthDate')} className={input} />
          </div>
          <div>
            <label className={label}>Sexo (para las fórmulas)</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['F', 'M'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setF((x) => ({ ...x, sex: x.sex === s ? '' : s }))} aria-pressed={f.sex === s}
                  className={`h-11 rounded-xl text-[14px] font-semibold border ${f.sex === s ? 'bg-rose-600 text-white border-rose-600' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>{SEX_LABEL[s]}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Obra social / prepaga</label>
            <input value={f.obraSocial} onChange={set('obraSocial')} maxLength={60} placeholder="Particular" className={input} />
          </div>
          <div>
            <label className={label}>Ocupación</label>
            <input value={f.occupation} onChange={set('occupation')} maxLength={60} className={input} />
          </div>
        </div>
        <div>
          <label className={label}>Email</label>
          <input type="email" value={f.email} onChange={set('email')} maxLength={80} className={input} />
        </div>
        <div className="pt-1 border-t border-slate-100" />
        <div>
          <label className={label}>Objetivo</label>
          <input value={f.goal} onChange={set('goal')} maxLength={140} placeholder="Ej.: bajar de peso y mejorar el colesterol" className={input} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Peso objetivo (kg)</label>
            <input value={f.goalWeight} onChange={set('goalWeight')} inputMode="decimal" placeholder="Opcional" className={input} />
          </div>
          <div>
            <label className={label}>Actividad física</label>
            <select value={f.activity} onChange={set('activity')} className={input}>
              <option value="">Sin dato</option>
              {(Object.keys(ACTIVITY) as Activity[]).map((a) => <option key={a} value={a}>{ACTIVITY[a].label} · {ACTIVITY[a].hint}</option>)}
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}

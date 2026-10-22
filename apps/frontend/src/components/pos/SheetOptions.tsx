import { useState } from 'react';
import toast from 'react-hot-toast';
import { Settings2, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../services/api';
import { setStoreSetting } from '../../services/storeSettings';
import { useAuthStore } from '../../stores/authStore';
import { CopiesToggle, readDocNumbering, printedNumber, type SalesNoteCopies } from './SalesNoteSheet';
import StoreLogoField from '../common/StoreLogoField';

const IVA_OPTIONS: [string, string][] = [
  ['', 'Sin indicar'],
  ['RESPONSABLE_INSCRIPTO', 'Responsable inscripto'],
  ['MONOTRIBUTO', 'Monotributo'],
  ['EXENTO', 'Exento'],
];

const input = 'w-full h-9 px-3 rounded-lg border border-slate-300 text-[13px] outline-none focus:border-slate-500 bg-white';

/**
 * Arriba de las hojas (no sale impreso): el duplicado y, para el dueño, "Datos de la hoja": lo que
 * va en el encabezado (nombre, dirección, CUIT…) y desde qué número se imprimen las hojas, para
 * seguir la numeración de los talonarios que ya usa el comercio.
 */
export default function SheetOptions({ copies, onCopies, onSaved }: { copies: SalesNoteCopies; onCopies: (c: SalesNoteCopies) => void; onSaved: () => void }) {
  const isAdmin = useAuthStore((s) => s.user?.role === 'ADMIN');
  const [open, setOpen] = useState(false);
  const own = (k: string) => localStorage.getItem(k) || '';
  const [f, setF] = useState(() => ({
    name: own('gd_store_name'), address: own('gd_store_address'), phone: own('gd_store_phone'), cuit: own('gd_store_cuit'),
    iva: own('gd_store_iva'), iibb: own('gd_store_iibb'), start: own('gd_store_start'),
    prefix: readDocNumbering().prefix || '', next: '',
  }));
  const [nextInfo, setNextInfo] = useState<{ index: number; next: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    const opening = !open;
    setOpen(opening);
    if (opening && !nextInfo) {
      try {
        const { data } = await api.get('/sales/next-number', { silent: true } as any);
        setNextInfo(data);
        // Lo que va a salir en la próxima hoja con la numeración de hoy
        setF((x) => ({ ...x, next: x.next || String(Number(printedNumber(data.next, { raw: true }))) }));
      } catch { /* sin servidor: no se puede tocar la numeración */ }
    }
  };

  const save = async () => {
    const name = f.name.trim();
    if (!name) { toast.error('El nombre del comercio no puede quedar vacío'); return; }
    const cuit = f.cuit.replace(/\D/g, '');
    if (cuit && cuit.length !== 11) { toast.error('El CUIT tiene 11 números'); return; }
    const prefix = f.prefix.replace(/\D/g, '').slice(0, 5);
    const nextNum = Number(f.next.replace(/\D/g, ''));
    setSaving(true);
    try {
      setStoreSetting('store_name', name);
      setStoreSetting('store_address', f.address.trim());
      setStoreSetting('store_phone', f.phone.trim());
      setStoreSetting('store_cuit', cuit);
      setStoreSetting('store_iva', f.iva);
      setStoreSetting('store_iibb', f.iibb.trim());
      setStoreSetting('store_start_date', f.start);
      const cfg = readDocNumbering();
      cfg.prefix = prefix ? prefix.padStart(4, '0') : '';
      // Próximo número: la hoja del próximo pedido o venta de esta caja sale con ese número y sigue
      if (nextInfo && nextNum > 0 && nextNum !== Number(printedNumber(nextInfo.next, { raw: true }))) {
        cfg.byNode = { ...(cfg.byNode || {}), [String(nextInfo.index)]: { base: nextInfo.next - 1, start: nextNum } };
      }
      setStoreSetting('doc_numbering', JSON.stringify(cfg));
      toast.success('Listo: así salen las hojas');
      setOpen(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div>
      <div className="flex items-center gap-2 pr-4">
        <div className="flex-1 min-w-0"><CopiesToggle copies={copies} onChange={onCopies} /></div>
        {isAdmin && (
          <button onClick={toggle} className="shrink-0 h-8 px-3 rounded-lg border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5" /> Datos de la hoja {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {open && (
        <div className="px-5 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px]">
          <p className="sm:col-span-2 text-slate-500">Lo que sale arriba de cada hoja. Se guarda para todas las cajas del comercio.</p>
          <div className="sm:col-span-2"><StoreLogoField onChange={onSaved} /></div>
          <label className="space-y-1"><span className="font-semibold text-slate-700">Nombre del comercio</span><input className={input} value={f.name} onChange={set('name')} maxLength={60} /></label>
          <label className="space-y-1"><span className="font-semibold text-slate-700">Dirección</span><input className={input} value={f.address} onChange={set('address')} maxLength={120} placeholder="Calle 12 N° 850, Magdalena" /></label>
          <label className="space-y-1"><span className="font-semibold text-slate-700">Teléfono</span><input className={input} value={f.phone} onChange={set('phone')} maxLength={40} /></label>
          <label className="space-y-1"><span className="font-semibold text-slate-700">CUIT</span><input className={input} value={f.cuit} onChange={set('cuit')} inputMode="numeric" maxLength={13} placeholder="Sin guiones" /></label>
          <label className="space-y-1"><span className="font-semibold text-slate-700">Condición frente al IVA</span>
            <select className={input} value={f.iva} onChange={set('iva')}>{IVA_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="space-y-1"><span className="font-semibold text-slate-700">Ingresos Brutos</span><input className={input} value={f.iibb} onChange={set('iibb')} maxLength={30} placeholder="Opcional" /></label>
          <label className="space-y-1"><span className="font-semibold text-slate-700">Inicio de actividades</span><input type="date" className={input} value={f.start} onChange={set('start')} /></label>
          <div className="sm:col-span-2 mt-1 pt-2 border-t border-slate-200">
            <p className="font-semibold text-slate-800">Numeración de las hojas</p>
            <p className="text-slate-500 mt-0.5">Para seguir el número de tus talonarios: la próxima hoja de esta caja sale con este número y después sigue. Las que ya imprimiste no cambian.</p>
          </div>
          <label className="space-y-1"><span className="font-semibold text-slate-700">Punto de venta</span><input className={input} value={f.prefix} onChange={set('prefix')} inputMode="numeric" maxLength={5} placeholder="Opcional, ej. 0001" /></label>
          <label className="space-y-1"><span className="font-semibold text-slate-700">Próximo número</span>
            <input className={input} value={f.next} onChange={set('next')} inputMode="numeric" maxLength={8} disabled={!nextInfo} placeholder={nextInfo ? '' : 'Sin conexión con el servidor'} />
          </label>
          {(f.prefix || f.next) && (
            <p className="sm:col-span-2 text-slate-600">Va a salir así: <b>N° {f.prefix.replace(/\D/g, '') ? `${f.prefix.replace(/\D/g, '').padStart(4, '0')}-` : ''}{String(Number(f.next.replace(/\D/g, '')) || 0).padStart(8, '0')}</b></p>
          )}
          <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} className="h-9 px-3.5 rounded-lg text-[13px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer">Cancelar</button>
            <button onClick={save} disabled={saving} className="h-9 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">Guardar</button>
          </div>
        </div>
      )}
    </div>
  );
}

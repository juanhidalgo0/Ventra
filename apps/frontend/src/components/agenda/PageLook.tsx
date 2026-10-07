import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Palette, MapPin, Instagram, ChevronDown, Clock, Store } from 'lucide-react';
import ImageCropModal, { STORE_LOGO, STORE_BANNER } from '../common/ImageCropModal';
import { ColorField, ImagePick, StorePreview, StoreHoursEditor } from '../store/StoreLook';
import { saveStoreConfig, dayRanges, StoreOwnedElsewhereError, type StoreConfig } from '../../services/onlineStore';
import { input, label } from './agendaUi';

/** Lo que se edita en "Mi página": los mismos campos de ventra_stores/{id} que Tienda online → Apariencia y Datos del negocio. */
const LOOK_KEYS = ['logoUrl', 'primaryColor', 'bannerUrl', 'description', 'address', 'instagram', 'hours'] as const;
type LookKey = typeof LOOK_KEYS[number];
export type PageLookData = Pick<StoreConfig, LookKey>;

const pick = (c: StoreConfig): PageLookData => Object.fromEntries(LOOK_KEYS.map((k) => [k, (c as any)[k] ?? (k === 'hours' ? undefined : '')])) as PageLookData;
const same = (a: any, b: any) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/**
 * Apariencia de la página donde reservan los clientes, para todos los planes con agenda (el plan
 * Agenda no tiene Tienda online). En los planes Tienda y Full es la misma página que la tienda:
 * lo que se cambia acá se ve en Tienda online y al revés.
 */
export default function PageLook({ storeId, config, kindLabel, sharedWithStore, mobile, onSaved }: {
  storeId: string; config: StoreConfig; kindLabel?: string; sharedWithStore: boolean; mobile: boolean;
  onSaved: (patch: Partial<StoreConfig>) => void;
}) {
  const saved = useMemo(() => pick(config), [config]);
  const [v, setV] = useState<PageLookData>(saved);
  const [open, setOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [crop, setCrop] = useState<{ file: File; kind: 'logo' | 'banner' } | null>(null);
  const [saving, setSaving] = useState(false);
  // Solo si cambió lo guardado de la página (guardar la agenda también actualiza la tienda, y no tiene que borrar lo que se está editando acá)
  const savedKey = JSON.stringify(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setV(saved); }, [savedKey]);

  const dirtyKeys = LOOK_KEYS.filter((k) => !same(v[k], saved[k]));
  const dirty = dirtyKeys.length > 0;
  const set = (p: Partial<PageLookData>) => setV((cur) => ({ ...cur, ...p }));
  const accent = v.primaryColor || '#0E6E52';
  const subtitle = v.description || kindLabel || 'Turnos online';
  const missing = [!v.logoUrl && 'logo', !v.description && 'descripción', !v.address && 'dirección'].filter(Boolean) as string[];

  const save = async () => {
    if (!dirty || saving) return;
    // Solo lo que cambió: no se pisa lo que se haya tocado en Tienda online mientras tanto
    const patch = Object.fromEntries(dirtyKeys.map((k) => [k, k === 'instagram' ? String(v[k] || '').trim().replace(/^@/, '') : k === 'description' || k === 'address' ? String(v[k] || '').trim() : v[k]])) as Partial<StoreConfig>;
    setSaving(true);
    try {
      await saveStoreConfig(storeId, patch);
      onSaved(patch);
      toast.success(sharedWithStore ? 'Listo: ya se ve en tu página y en tu tienda' : 'Listo: ya se ve en tu página');
    } catch (err) {
      console.error('[Agenda] No se pudo guardar la página', err);
      toast.error(err instanceof StoreOwnedElsewhereError ? err.message : 'No se pudo guardar. Revisá la conexión y probá de nuevo.');
    } finally { setSaving(false); }
  };

  const openDays = (v.hours || []).map((h, i) => (h?.open && dayRanges(h).length ? i : -1)).filter((i) => i >= 0);
  const hoursText = !openDays.length ? 'Sin horarios: la página no muestra "Abierto ahora"'
    : [1, 2, 3, 4, 5, 6, 0].filter((d) => openDays.includes(d)).map((d) => `${DAY_SHORT[d]} ${dayRanges(v.hours![d]).map((r) => `${r.from}–${r.to}`).join(' y ')}`).join(' · ');

  return (
    <section data-tour="agenda-cfg-look" className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center shrink-0"><Palette className="w-[18px] h-[18px] text-rose-600" /></span>
        <button type="button" onClick={() => setOpen(!open)} className="flex-1 min-w-0 text-left" aria-expanded={open}>
          <p className="text-[15px] font-bold text-slate-900 flex items-center gap-1.5">Mi página <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} /></p>
          <p className="text-[12.5px] text-slate-500">
            {sharedWithStore ? 'Logo, color, portada y datos del local. Es la misma página que tu tienda online.' : 'Logo, color, portada y datos del local: cómo te ven tus clientes al reservar.'}
          </p>
        </button>
        {dirty ? (
          <span className="flex items-center gap-1.5 shrink-0">
            {!mobile && <button onClick={() => setV(saved)} disabled={saving} className="h-9 px-3 rounded-xl text-[13px] font-semibold text-slate-500 hover:bg-slate-50">Descartar</button>}
            <button onClick={save} disabled={saving} className="h-9 px-3 rounded-xl bg-rose-600 text-white text-[13px] font-semibold disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar'}</button>
          </span>
        ) : !open && (
          <button onClick={() => setOpen(true)} className="h-9 px-3 rounded-xl bg-rose-50 text-rose-700 text-[13px] font-semibold shrink-0">Editar</button>
        )}
      </div>

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-3 w-full flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 text-left hover:border-slate-300">
          <span className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center shrink-0" style={{ backgroundColor: v.logoUrl ? '#fff' : accent }}>
            {v.logoUrl ? <img src={v.logoUrl} alt="" className="w-full h-full object-cover" /> : <Store className="w-5 h-5 text-white" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-slate-800 truncate">{config.businessName || 'Mi negocio'}</span>
            <span className="block text-[12.5px] text-slate-500 truncate">{subtitle}</span>
          </span>
          <span className="w-5 h-5 rounded-full shrink-0 ring-2 ring-white shadow" style={{ backgroundColor: accent }} title="Color principal" />
          {missing.length > 0 && <span className="hidden sm:inline text-[12px] font-medium text-amber-700 bg-amber-50 rounded-full px-2.5 py-1 shrink-0">Falta {missing.join(', ')}</span>}
        </button>
      ) : (
        <div className="mt-4 space-y-5 anim-rise">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr,1fr] gap-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <ImagePick label="Logo" hint="Cuadrado" src={v.logoUrl} contain onPick={(file) => setCrop({ file, kind: 'logo' })} onClear={() => set({ logoUrl: '' })} />
                <ImagePick label="Portada" hint="Apaisada, 1500×500" src={v.bannerUrl} onPick={(file) => setCrop({ file, kind: 'banner' })} onClear={() => set({ bannerUrl: '' })} />
              </div>
              <ColorField label="Color principal (botones y detalles)" value={accent} onChange={(c) => set({ primaryColor: c })} />
              <div>
                <label className={label}>Descripción corta · aparece debajo del nombre</label>
                <input className={input} maxLength={120} value={v.description || ''} onChange={(e) => set({ description: e.target.value })} placeholder={kindLabel ? `Ej.: ${kindLabel} en el centro · turnos en el día` : 'Ej.: Estética y depilación · turnos en el día'} />
              </div>
            </div>
            <StorePreview config={{ ...v, businessName: config.businessName, announcement: config.announcement, secondaryColor: config.secondaryColor }} accent={accent} subtitle={subtitle} cta="Reservar turno"
              note="Se actualiza mientras editás. Tus clientes lo ven al guardar." />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>Dirección del local</label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input className={`${input} pl-9`} value={v.address || ''} onChange={(e) => set({ address: e.target.value })} placeholder="Av. Siempreviva 742" />
              </div>
            </div>
            <div>
              <label className={label}>Instagram</label>
              <div className="relative">
                <Instagram className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input className={`${input} pl-9`} value={v.instagram || ''} onChange={(e) => set({ instagram: e.target.value })} placeholder="@mi_negocio" />
              </div>
            </div>
          </div>

          <div>
            <button type="button" onClick={() => setHoursOpen(!hoursOpen)} className="w-full flex items-center gap-3 text-left" aria-expanded={hoursOpen}>
              <Clock className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-semibold text-slate-800">Horarios del local</span>
                <span className="block text-[12px] text-slate-500 truncate">{hoursText}</span>
              </span>
              <span className="text-[12.5px] font-semibold text-rose-700 shrink-0">{hoursOpen ? 'Listo' : 'Cambiar'}</span>
            </button>
            {hoursOpen && (
              <div className="mt-2.5 anim-rise">
                <p className="text-[12px] text-slate-500 mb-2">Se muestran en tu página con “Abierto ahora”. Los turnos se dan según los horarios de cada profesional.</p>
                <StoreHoursEditor hours={v.hours} onChange={(hours) => set({ hours })} />
              </div>
            )}
          </div>
        </div>
      )}

      {crop && (
        <ImageCropModal
          file={crop.file}
          {...(crop.kind === 'logo' ? STORE_LOGO : STORE_BANNER)}
          round={crop.kind === 'logo'}
          title={crop.kind === 'logo' ? 'Encuadrar logo' : 'Encuadrar portada'}
          onCancel={() => setCrop(null)}
          onDone={(url) => { set(crop.kind === 'logo' ? { logoUrl: url } : { bannerUrl: url }); setCrop(null); }}
        />
      )}
    </section>
  );
}

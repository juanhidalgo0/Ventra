import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Inbox, Package, Plus, Trash2, Copy, MessageCircle, RefreshCw, Video, ExternalLink, Link2 } from 'lucide-react';
import {
  acceptIntake, dismissIntake, sellPack, removePack, ensurePortalLink, ensureVideoLink, activePack, parseNum, INTAKE_FIELDS,
  type Patient,
} from '../../services/nutri';
import { localNow, waPhone, PAY_METHODS } from '../../services/agenda';
import { Modal, input, label } from '../agenda/agendaUi';
import { useConfirm } from '../common/ConfirmDialog';
import { money } from '../mobile/ui';
import { shortDate } from './nutriUi';

const storeName = () => { try { return localStorage.getItem('gd_store_name') || ''; } catch { return ''; } };
const firstName = (name: string) => name.trim().split(/\s+/)[0];

/** Abre WhatsApp con el mensaje (o lo copia si el paciente no tiene teléfono) */
function sendWhatsApp(p: Patient, text: string) {
  if (p.phone) window.open(`https://wa.me/${waPhone(p.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  else navigator.clipboard?.writeText(text).then(() => toast.success('Sin teléfono cargado: copiamos el mensaje'), () => toast.error('Cargale el teléfono para mandarlo'));
}

const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success('Link copiado'), () => toast.error('No se pudo copiar'));

// ─── Ficha previa que mandó el paciente ───

export function IntakeBanner({ storeId, p }: { storeId: string; p: Patient }) {
  const [busy, setBusy] = useState(false);
  if (!p.intake || p.intake.reviewed) return null;
  const answers = INTAKE_FIELDS.filter((f) => p.intake!.data[f.key]?.trim());
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); } catch { toast.error('No se pudo guardar'); setBusy(false); }
  };
  return (
    <section className="rounded-2xl bg-sky-50 border border-sky-200 p-4">
      <p className="flex items-center gap-1.5 text-[14px] font-bold text-sky-900"><Inbox className="w-4 h-4" /> {firstName(p.name)} completó su ficha previa · {new Date(p.intake.at).toLocaleDateString('es-AR')}</p>
      <div className="mt-2 space-y-1.5">
        {answers.map((f) => (
          <p key={f.key} className="text-[13px] text-slate-700"><span className="font-semibold text-slate-900">{f.label}</span><br />{p.intake!.data[f.key]}</p>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => run(() => acceptIntake(storeId, p), 'Pasada a la historia clínica')} className="h-10 px-4 rounded-xl bg-sky-700 text-white text-[13.5px] font-semibold disabled:opacity-60">Pasar a la historia clínica</button>
        <button disabled={busy} onClick={() => run(() => dismissIntake(storeId, p), 'Ficha previa archivada')} className="h-10 px-4 rounded-xl bg-white text-slate-600 border border-slate-200 text-[13.5px] font-semibold disabled:opacity-60">No pasarla</button>
      </div>
    </section>
  );
}

// ─── Packs de consultas ───

export function PacksCard({ storeId, p }: { storeId: string; p: Patient }) {
  const [selling, setSelling] = useState(false);
  const [ask, askDialog] = useConfirm();
  const packs = [...(p.packs || [])].sort((a, b) => b.paidAt - a.paidAt);
  const active = activePack(p);
  const remove = async (id: string, name: string) => {
    if (!(await ask({ title: 'Sacar el pack', message: `"${name}" y su cobro se borran. Solo se puede si todavía no usó ninguna sesión.`, confirmLabel: 'Sacar', danger: true }))) return;
    try { await removePack(storeId, p, id); toast.success('Pack sacado'); } catch { toast.error('No se pudo sacar'); }
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
      {askDialog}
      <div className="flex items-center gap-2">
        <p className="flex-1 flex items-center gap-1.5 text-[13px] font-bold text-slate-900"><Package className="w-4 h-4 text-rose-600" /> Packs de consultas</p>
        <button onClick={() => setSelling(true)} className="h-8 px-3 rounded-full bg-rose-50 text-rose-700 text-[12.5px] font-semibold inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Vender</button>
      </div>
      {!packs.length && <p className="mt-1.5 text-[12.5px] text-slate-500">Cobrá varias consultas juntas: cada consulta descuenta una sesión.</p>}
      {packs.slice(0, 4).map((k) => (
        <div key={k.id} className="mt-2 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className={`text-[13px] font-semibold truncate ${k === active ? 'text-slate-900' : 'text-slate-500'}`}>{k.name}</p>
            <p className="text-[12px] text-slate-500 tabular-nums">{k.used} de {k.sessions} usadas · {money(k.price)} · {shortDate(k.dateKey)}</p>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-rose-500" style={{ width: `${Math.min(100, (k.used / k.sessions) * 100)}%` }} /></div>
          </div>
          {k.used === 0 && <button onClick={() => remove(k.id, k.name)} title="Sacar" className="w-8 h-8 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>}
        </div>
      ))}
      {selling && <SellPackModal storeId={storeId} p={p} onClose={() => setSelling(false)} />}
    </div>
  );
}

function SellPackModal({ storeId, p, onClose }: { storeId: string; p: Patient; onClose: () => void }) {
  const today = localNow().dateKey;
  const [f, setF] = useState({ sessions: '4', price: '', method: PAY_METHODS[0], dateKey: today, name: '' });
  const [saving, setSaving] = useState(false);
  const sessions = Math.round(parseNum(f.sessions) || 0);
  const name = f.name.trim() || `Pack ${sessions || '…'} consultas`;
  const save = async () => {
    if (sessions < 2 || sessions > 50) return toast.error('El pack tiene que tener entre 2 y 50 consultas');
    const price = parseNum(f.price) ?? 0;
    setSaving(true);
    try { await sellPack(storeId, p, { name, sessions, price, method: f.method, dateKey: f.dateKey || today }); toast.success(price ? 'Pack vendido: el cobro está en Cobros' : 'Pack cargado'); onClose(); }
    catch { toast.error('No se pudo guardar'); setSaving(false); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal title={`Vender pack a ${firstName(p.name)}`} onClose={onClose}
      footer={<button disabled={saving} onClick={save} className="w-full h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-bold disabled:opacity-60">{saving ? 'Guardando…' : 'Cobrar el pack'}</button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Consultas</label><input value={f.sessions} onChange={set('sessions')} inputMode="numeric" className={input} /></div>
          <div><label className={label}>Precio total</label><input value={f.price} onChange={set('price')} inputMode="decimal" placeholder="$" className={input} /></div>
        </div>
        <div><label className={label}>Nombre</label><input value={f.name} onChange={set('name')} maxLength={60} placeholder={name} className={input} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Cómo pagó</label>
            <select value={f.method} onChange={set('method')} className={input}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          </div>
          <div><label className={label}>Fecha</label><input type="date" value={f.dateKey} max={today} onChange={set('dateKey')} className={input} /></div>
        </div>
        {sessions > 1 && parseNum(f.price) ? <p className="text-[12.5px] text-slate-500">Sale {money((parseNum(f.price) || 0) / sessions)} cada consulta.</p> : null}
      </div>
    </Modal>
  );
}

// ─── Link del paciente y videollamada ───

export function PortalModal({ storeId, p, onClose }: { storeId: string; p: Patient; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, askDialog] = useConfirm();
  const load = async (renew = false) => {
    setBusy(true);
    try { setLink(await ensurePortalLink(storeId, p, renew)); if (renew) toast.success('Link nuevo: el anterior ya no anda'); }
    catch (err) { console.warn('[Nutri] link del portal', err); toast.error('No se pudo crear el link. Revisá la conexión.'); }
    finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!link) load(); }, []);
  const from = storeName();
  const text = link ? `Hola ${firstName(p.name)}! Este es tu espacio${from ? ` en ${from}` : ''}: ahí ves tu plan alimentario y tu evolución${!p.intake ? ', y completás una ficha corta antes de la consulta' : ''}.\n${link}` : '';
  const renew = async () => {
    if (await ask({ title: 'Generar un link nuevo', message: 'El link que ya le mandaste deja de andar. Usalo si lo compartió por error.', confirmLabel: 'Generar' })) load(true);
  };
  return (
    <Modal title="Link del paciente" onClose={onClose}>
      {askDialog}
      <p className="text-[13.5px] text-slate-600">Con este link, {firstName(p.name)} ve su plan vigente, su evolución de peso, su próximo control y la videollamada{!p.intake ? ', y completa la ficha previa' : ''}. No ve tus evaluaciones ni notas.</p>
      <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-[13px] text-slate-800 break-all min-h-[44px]">{link || 'Creando el link…'}</div>
      {link && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => sendWhatsApp(p, text)} className="h-11 px-4 rounded-xl bg-[#1FAF55] text-white text-[14px] font-semibold inline-flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> Mandar por WhatsApp</button>
          <button onClick={() => copy(link)} className="h-11 px-4 rounded-xl bg-slate-100 text-slate-700 text-[14px] font-semibold inline-flex items-center gap-1.5"><Copy className="w-4 h-4" /> Copiar</button>
          <a href={link} target="_blank" rel="noopener" className="h-11 px-4 rounded-xl bg-slate-100 text-slate-700 text-[14px] font-semibold inline-flex items-center gap-1.5"><ExternalLink className="w-4 h-4" /> Ver como el paciente</a>
          <button disabled={busy} onClick={renew} className="h-11 px-3 rounded-xl text-slate-500 text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"><RefreshCw className="w-4 h-4" /> Link nuevo</button>
        </div>
      )}
    </Modal>
  );
}

export function VideoModal({ storeId, p, onClose }: { storeId: string; p: Patient; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(p.videoLink || null);
  const [busy, setBusy] = useState(false);
  const load = async (renew = false) => {
    setBusy(true);
    try { setLink(await ensureVideoLink(storeId, p, renew)); } catch { toast.error('No se pudo crear la sala'); } finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!link) load(); }, []);
  const text = link ? `Hola ${firstName(p.name)}! Para la consulta online entrá a este link a la hora del turno (no hace falta instalar nada):\n${link}` : '';
  return (
    <Modal title="Consulta por videollamada" onClose={onClose}>
      <p className="text-[13.5px] text-slate-600">Una sala de Jitsi Meet para {firstName(p.name)}: se abre en el navegador, sin cuenta ni app. Es la misma para todas sus consultas online y también la ve en su link.</p>
      <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-[13px] text-slate-800 break-all min-h-[44px]">{link || 'Creando la sala…'}</div>
      {link && (
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={link} target="_blank" rel="noopener" className="h-11 px-4 rounded-xl bg-rose-600 text-white text-[14px] font-semibold inline-flex items-center gap-1.5"><Video className="w-4 h-4" /> Entrar ahora</a>
          <button onClick={() => sendWhatsApp(p, text)} className="h-11 px-4 rounded-xl bg-[#1FAF55] text-white text-[14px] font-semibold inline-flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> Mandarle el link</button>
          <button onClick={() => copy(link)} className="h-11 px-4 rounded-xl bg-slate-100 text-slate-700 text-[14px] font-semibold inline-flex items-center gap-1.5"><Copy className="w-4 h-4" /> Copiar</button>
          <button disabled={busy} onClick={() => load(true)} className="h-11 px-3 rounded-xl text-slate-500 text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"><RefreshCw className="w-4 h-4" /> Sala nueva</button>
        </div>
      )}
    </Modal>
  );
}

export { Link2 as PortalIcon, Video as VideoIcon };

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import { Smartphone, Copy, MessageCircle, Loader2, QrCode, UserX, Link2, Wallet, ShieldCheck, Plus } from 'lucide-react';
import { deleteDoc, doc } from 'firebase/firestore';
import api from '../../services/api';
import { getVentraDb } from '../../services/ventraFirebase';
import { IS_DEMO_BUILD } from '../../demo/flag';
import { useConfirm } from '../common/ConfirmDialog';
import { openExternal } from '../subscription/SubscriptionPanel';
import { Modal, input, label } from './agendaUi';
import { saveStaffPrivate, permsOf, staffBookingLink, type StaffPrivate, type StaffPay, type StaffPerms } from '../../services/agenda';

export interface ProLink { staffId: string; userId: string; username: string; isActive: boolean }

/** Quiénes de la agenda tienen usuario propio (solo el dueño lo ve). */
export function useAgendaPros() {
  const [list, setList] = useState<ProLink[] | null>(null);
  const load = () => {
    if (IS_DEMO_BUILD) { setList([]); return; }
    api.get('/agenda-pros', { silent: true } as any).then(({ data }) => setList(Array.isArray(data) ? data : [])).catch(() => setList([]));
  };
  useEffect(load, []);
  return { list, reload: load };
}

/**
 * Lo demás de cada profesional para el dueño: su link de reservas, cómo cobra (comisión o alquiler
 * del sillón) y qué puede hacer desde su celular. Se guarda aparte (agenda_staff), no en la página pública.
 */
export function StaffExtras({ storeId, staffId, staffName, storeUrl, priv, hasAccess }: {
  storeId: string; staffId: string; staffName: string; storeUrl: string | null; priv: StaffPrivate | undefined; hasAccess: boolean;
}) {
  const perms = permsOf(priv?.perms);
  const pay = priv?.pay || null;
  const [mode, setMode] = useState<'none' | 'commission' | 'chair'>(pay?.mode || 'none');
  const [pct, setPct] = useState(String(pay?.mode === 'commission' ? pay.pct : 50));
  const [amount, setAmount] = useState(String(pay?.mode === 'chair' ? pay.amount : ''));
  const [every, setEvery] = useState<'week' | 'month'>(pay?.mode === 'chair' ? pay.every : 'week');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMode(pay?.mode || 'none');
    if (pay?.mode === 'commission') setPct(String(pay.pct));
    if (pay?.mode === 'chair') { setAmount(String(pay.amount)); setEvery(pay.every); }
  }, [pay?.mode, (pay as any)?.pct, (pay as any)?.amount, (pay as any)?.every]);

  const link = storeUrl ? staffBookingLink(storeUrl, staffId) : '';
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast.success(`Link de ${staffName} copiado`); } catch { toast.error('No se pudo copiar'); } };
  const savePay = async () => {
    let next: StaffPay | null = null;
    if (mode === 'commission') {
      const n = Number(pct);
      if (!(n >= 0 && n <= 100)) return toast.error('La comisión va de 0 a 100%');
      next = { mode: 'commission', pct: n };
    } else if (mode === 'chair') {
      const n = Number(String(amount).replace(/\./g, ''));
      if (!(n > 0)) return toast.error('Poné cuánto paga por el sillón');
      next = { mode: 'chair', amount: n, every };
    }
    setBusy(true);
    try { await saveStaffPrivate(storeId, staffId, { pay: next }); toast.success('Guardado'); } catch { toast.error('No se pudo guardar'); } finally { setBusy(false); }
  };
  const setPerm = async (k: keyof StaffPerms, v: boolean) => {
    try { await saveStaffPrivate(storeId, staffId, { perms: { ...perms, [k]: v } }); } catch { toast.error('No se pudo guardar'); }
  };
  const dirty = mode !== (pay?.mode || 'none')
    || (mode === 'commission' && Number(pct) !== (pay?.mode === 'commission' ? pay.pct : NaN))
    || (mode === 'chair' && (Number(amount) !== (pay?.mode === 'chair' ? pay.amount : NaN) || every !== (pay?.mode === 'chair' ? pay.every : '')));
  const tog = 'flex items-center gap-2 text-[13px] text-slate-600';

  if (IS_DEMO_BUILD) return null;
  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      {link && (
        <div className="flex items-center gap-2 text-[12.5px] flex-wrap">
          <Link2 className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-slate-600">Su link de reservas (abre directo con {staffName.split(' ')[0]})</span>
          <button onClick={copy} className="ag-press h-8 px-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold flex items-center gap-1"><Copy className="w-3.5 h-3.5" /> Copiar</button>
        </div>
      )}
      <div>
        <p className="text-[12.5px] font-semibold text-slate-600 flex items-center gap-1.5 mb-1.5"><Wallet className="w-4 h-4 text-slate-400" /> Cómo cobra</p>
        <div className="flex flex-wrap gap-1.5">
          {([['none', 'Sin definir'], ['commission', 'Comisión'], ['chair', 'Alquila el sillón']] as const).map(([v, t]) => (
            <button key={v} onClick={() => setMode(v)} className={`ag-press h-8 px-3 rounded-full text-[12.5px] font-semibold border ${mode === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>{t}</button>
          ))}
        </div>
        {mode === 'commission' && (
          <div className="mt-2 flex items-center gap-2 text-[13px] text-slate-600">
            Se lleva el <input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))} inputMode="decimal" className="w-16 h-9 px-2 rounded-lg border border-slate-200 text-[14px]" /> % de lo que atiende
          </div>
        )}
        {mode === 'chair' && (
          <div className="mt-2 flex items-center gap-2 text-[13px] text-slate-600 flex-wrap">
            Se queda con todo y paga $ <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 9))} inputMode="numeric" className="w-28 h-9 px-2 rounded-lg border border-slate-200 text-[14px]" />
            <select value={every} onChange={(e) => setEvery(e.target.value as 'week' | 'month')} className="h-9 px-2 rounded-lg border border-slate-200 bg-white text-[13.5px]">
              <option value="week">por semana</option><option value="month">por mes</option>
            </select>
          </div>
        )}
        {dirty && <button disabled={busy} onClick={savePay} className="mt-2 h-9 px-3.5 rounded-lg bg-rose-600 text-white text-[13px] font-semibold disabled:opacity-60">Guardar cómo cobra</button>}
      </div>
      {hasAccess && (
        <div>
          <p className="text-[12.5px] font-semibold text-slate-600 flex items-center gap-1.5 mb-1.5"><ShieldCheck className="w-4 h-4 text-slate-400" /> Desde su celular puede</p>
          <div className="space-y-1.5">
            <label className={tog}><input type="checkbox" className="w-4 h-4 accent-rose-600" checked={perms.hours} onChange={(e) => setPerm('hours', e.target.checked)} /> Cambiar su horario</label>
            <label className={tog}><input type="checkbox" className="w-4 h-4 accent-rose-600" checked={perms.phones} onChange={(e) => setPerm('phones', e.target.checked)} /> Ver el teléfono de sus clientes y escribirles</label>
            <label className={tog}><input type="checkbox" className="w-4 h-4 accent-rose-600" checked={perms.earnings} onChange={(e) => setPerm('earnings', e.target.checked)} /> Ver sus números (lo atendido y lo que le toca)</label>
          </div>
        </div>
      )}
    </div>
  );
}

/** Recepción: usuarios que manejan la agenda de todos (sin configuración ni caja) */
export function DeskAccess({ storeId, links, onChange }: { storeId: string; links: ProLink[]; onChange: () => void }) {
  const [adding, setAdding] = useState<string | null>(null);
  // El que se está creando queda montado (su QR vive ahí) aunque ya aparezca en la lista
  const desks = links.filter((l) => l.staffId.startsWith('desk-') && l.isActive && l.staffId !== adding);
  if (IS_DEMO_BUILD) return null;
  return (
    <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-3">
      <p className="text-[13.5px] font-semibold text-slate-800">Recepción</p>
      <p className="text-[12.5px] text-slate-500">Alguien que atiende el teléfono o el mostrador y maneja los turnos de todos, sin ver la configuración ni la caja.</p>
      {desks.map((d) => (
        <ProAccess key={d.staffId} storeId={storeId} staffId={d.staffId} staffName="Recepción" saved link={d} onChange={onChange} />
      ))}
      {adding && (
        <ProAccess storeId={storeId} staffId={adding} staffName="Recepción" saved link={links.find((l) => l.staffId === adding)} grantLabel="Crear usuario de recepción" onChange={onChange} />
      )}
      {(!adding || links.some((l) => l.staffId === adding && l.isActive)) && (
        <button onClick={() => setAdding(`desk-${Math.random().toString(36).slice(2, 10)}`)} className="mt-2 ag-press h-8 px-3 rounded-lg bg-slate-100 text-slate-700 text-[12.5px] font-semibold flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Sumar recepción</button>
      )}
    </div>
  );
}

const userFrom = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 20);

/**
 * "Acceso a su celular" de un profesional: un usuario propio con el que ve, carga y maneja solo
 * sus turnos. El dueño le da el acceso, le pasa el QR (sirve una vez) y se lo puede sacar.
 */
export function ProAccess({ storeId, staffId, staffName, saved, link, onChange, grantLabel }: {
  storeId: string; staffId: string; staffName: string;
  /** Texto del botón para dar acceso (recepción usa otro) */
  grantLabel?: string;
  /** El profesional ya está guardado en la agenda (la nube lo busca ahí) */
  saved: boolean;
  link: ProLink | undefined;
  onChange: () => void;
}) {
  const [open, setOpen] = useState<null | 'grant' | 'qr'>(null);
  const [busy, setBusy] = useState(false);
  const [ask, askDialog] = useConfirm();
  const [qr, setQr] = useState<{ url: string; until: number; username: string } | null>(null);
  const has = !!link && link.isActive;

  const newQr = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/agenda-pros/qr', { staffId, staffName });
      if (!data.link) throw new Error(data.warning || 'No se pudo generar el QR');
      setQr({ url: data.link, until: Date.now() + (data.expiresInSeconds || 900) * 1000, username: link?.username || '' });
      setOpen('qr');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'No se pudo generar el QR');
    } finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!(await ask({
      title: `¿Sacarle el acceso a ${staffName || 'este profesional'}?`,
      message: 'Deja de poder entrar a su agenda desde el celular. Sus turnos siguen en la agenda.',
      confirmLabel: 'Sacar acceso', cancelLabel: 'Volver', danger: true,
    }))) return;
    setBusy(true);
    try {
      const { data } = await api.post('/agenda-pros/revoke', { staffId });
      // Sin conexión de la caja con la nube, se corta desde acá (la sesión del dueño puede borrar el registro)
      if (!data?.cloud) await deleteDoc(doc(getVentraDb(), 'ventra_stores', storeId, 'agenda_pros', staffId)).catch(() => {});
      toast.success('Acceso quitado');
      onChange();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'No se pudo quitar el acceso');
    } finally { setBusy(false); }
  };

  if (IS_DEMO_BUILD) return null;
  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap text-[12.5px]">
      <Smartphone className="w-4 h-4 text-slate-400 shrink-0" />
      {has ? (
        <>
          <span className="text-slate-600">Entra con su celular como <b>{link!.username}</b></span>
          <button disabled={busy} onClick={newQr} className="ag-press h-8 px-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold flex items-center gap-1"><QrCode className="w-3.5 h-3.5" /> Nuevo QR</button>
          <button disabled={busy} onClick={revoke} className="ag-press h-8 px-2.5 rounded-lg text-red-600 font-semibold flex items-center gap-1"><UserX className="w-3.5 h-3.5" /> Sacar acceso</button>
        </>
      ) : saved && staffName.trim() ? (
        <button onClick={() => setOpen('grant')} className="ag-press h-8 px-3 rounded-lg bg-rose-50 text-rose-700 font-semibold">{grantLabel || 'Darle acceso a su agenda en su celular'}</button>
      ) : (
        <span className="text-slate-400">Guardá los cambios para darle acceso a su agenda desde su celular</span>
      )}
      {open === 'grant' && (
        <GrantSheet staffId={staffId} staffName={staffName} onClose={() => setOpen(null)}
          onDone={(r) => { onChange(); if (r) { setQr(r); setOpen('qr'); } else setOpen(null); }} />
      )}
      {open === 'qr' && qr && <QrSheet staffName={staffName} qr={qr} onClose={() => { setOpen(null); setQr(null); }} />}
      {askDialog}
    </div>
  );
}

function GrantSheet({ staffId, staffName, onClose, onDone }: {
  staffId: string; staffName: string; onClose: () => void;
  onDone: (qr: { url: string; until: number; username: string } | null) => void;
}) {
  const [username, setUsername] = useState(staffId.startsWith('desk-') ? 'RECEPCION' : userFrom(staffName.split(' ')[0] || staffName));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!username.trim()) return toast.error('Poné un nombre de usuario');
    if (!/^\d{4,}$/.test(password)) return toast.error('La clave tiene que tener al menos 4 números');
    setBusy(true);
    try {
      const { data } = await api.post('/agenda-pros/grant', { staffId, staffName, username, password });
      toast.success(`Listo: ${staffName} ya tiene su acceso`);
      if (data.warning) toast(data.warning, { duration: 8000 });
      onDone(data.link ? { url: data.link, until: Date.now() + (data.expiresInSeconds || 900) * 1000, username: data.username } : null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'No se pudo crear el acceso');
      setBusy(false);
    }
  };
  return (
    <Modal title={staffId.startsWith('desk-') ? 'Usuario de recepción' : `Acceso para ${staffName}`} onClose={onClose}
      footer={<button disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-rose-600 text-white font-semibold disabled:opacity-60 flex items-center justify-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />} Crear acceso</button>}>
      <div className="space-y-4">
        {staffId.startsWith('desk-')
          ? <p className="text-[13.5px] text-slate-600">Recepción ve y maneja <b>la agenda de todos</b>: carga, mueve y confirma turnos de cualquier profesional y le avisamos de cada reserva. No ve la configuración ni la caja.</p>
          : <p className="text-[13.5px] text-slate-600">Con su usuario, {staffName} ve <b>solo sus turnos</b> desde su celular: los carga, los confirma, bloquea sus horarios y le avisamos cuando le reservan. No ve la caja, la plata del local ni los turnos de los demás.</p>}
        <div className="grid grid-cols-2 gap-3">
          <div><span className={label}>Usuario</span><input className={input} value={username} onChange={(e) => setUsername(e.target.value.replace(/\s+/g, '').toUpperCase().slice(0, 20))} autoCapitalize="characters" /></div>
          <div><span className={label}>Clave (solo números)</span><input className={input} value={password} onChange={(e) => setPassword(e.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" placeholder="Ej.: 4821" /></div>
        </div>
        <p className="text-[12px] text-slate-500">Pasale la clave en persona. Después le mostrás un QR para que entre desde su celular.</p>
      </div>
    </Modal>
  );
}

function QrSheet({ staffName, qr, onClose }: { staffName: string; qr: { url: string; until: number; username: string }; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, tick] = useState(0);
  useEffect(() => { if (canvas.current) QRCode.toCanvas(canvas.current, qr.url, { width: 220, margin: 1 }).catch(() => {}); }, [qr.url]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.round((qr.until - Date.now()) / 1000));
  const first = staffName.split(' ')[0] || staffName;
  const text = `Hola ${first}! Para ver tu agenda de turnos desde el celular abrí este link (sirve una vez, por 15 minutos): ${qr.url}${qr.username ? `\nDespués entrás con tu usuario ${qr.username} y tu clave.` : ''}`;
  const copy = async () => { try { await navigator.clipboard.writeText(qr.url); toast.success('Link copiado'); } catch { toast.error('No se pudo copiar'); } };
  return (
    <Modal title={`Celular de ${staffName}`} onClose={onClose}
      footer={<button onClick={onClose} className="w-full h-12 rounded-2xl bg-slate-900 text-white font-semibold">Listo</button>}>
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[14px] font-semibold text-slate-800">Que {first} escanee este QR con la cámara de su celular</p>
        {left > 0 ? <canvas ref={canvas} className="rounded-xl bg-white p-2 border border-slate-200" /> : <p className="text-[13px] text-red-600">El QR venció. Cerrá y tocá "Nuevo QR".</p>}
        <p className="text-[12.5px] text-slate-500">Sirve <b>una sola vez</b> y vence en <b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>.{qr.username ? <> Después entra con el usuario <b>{qr.username}</b> y su clave.</> : null}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={copy} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12.5px] font-semibold flex items-center gap-1.5"><Copy className="w-4 h-4" /> Copiar link</button>
          <button onClick={() => openExternal(`https://wa.me/?text=${encodeURIComponent(text)}`)} className="h-9 px-3 rounded-lg bg-[#25D366] text-white text-[12.5px] font-semibold flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> Mandar por WhatsApp</button>
        </div>
        <p className="text-[11.5px] text-slate-400">Consejo: que la agregue a la pantalla de inicio para usarla como una app y recibir los avisos.</p>
      </div>
    </Modal>
  );
}

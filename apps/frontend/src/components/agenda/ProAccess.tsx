import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import { Smartphone, Copy, MessageCircle, Loader2, QrCode, UserX } from 'lucide-react';
import { deleteDoc, doc } from 'firebase/firestore';
import api from '../../services/api';
import { getVentraDb } from '../../services/ventraFirebase';
import { IS_DEMO_BUILD } from '../../demo/flag';
import { useConfirm } from '../common/ConfirmDialog';
import { openExternal } from '../subscription/SubscriptionPanel';
import { Modal, input, label } from './agendaUi';

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

const userFrom = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 20);

/**
 * "Acceso a su celular" de un profesional: un usuario propio con el que ve, carga y maneja solo
 * sus turnos. El dueño le da el acceso, le pasa el QR (sirve una vez) y se lo puede sacar.
 */
export function ProAccess({ storeId, staffId, staffName, saved, link, onChange }: {
  storeId: string; staffId: string; staffName: string;
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
        <button onClick={() => setOpen('grant')} className="ag-press h-8 px-3 rounded-lg bg-rose-50 text-rose-700 font-semibold">Darle acceso a su agenda en su celular</button>
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
  const [username, setUsername] = useState(userFrom(staffName.split(' ')[0] || staffName));
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
    <Modal title={`Acceso para ${staffName}`} onClose={onClose}
      footer={<button disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-rose-600 text-white font-semibold disabled:opacity-60 flex items-center justify-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />} Crear acceso</button>}>
      <div className="space-y-4">
        <p className="text-[13.5px] text-slate-600">Con su usuario, {staffName} ve <b>solo sus turnos</b> desde su celular: los carga, los confirma, bloquea sus horarios y le avisamos cuando le reservan. No ve la caja, la plata del local ni los turnos de los demás.</p>
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

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2, MessageCircle, Check, ChevronDown } from 'lucide-react';
import api from '../../services/api';
import { useOwnerAccess } from '../../utils/managerAccess';

interface Status {
  linked: boolean; phone?: string; questions?: number; number?: string;
  summary?: { enabled: boolean; hour: number };
  supervisorsAllowed?: boolean;
  supervisors?: { id: string; name: string; phone: string }[];
}
interface Code { code: string; link: string; number: string; expiresInMin: number }

const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const HOURS = Array.from({ length: 16 }, (_, i) => i + 8);

/**
 * Preguntale a tu negocio por WhatsApp (ver /ai/whatsapp y firebase/functions/wa-owner.js): cada
 * uno vincula su teléfono mandando un código al número de Ventra y después pregunta desde ahí,
 * aunque no esté en el local. El dueño decide si los encargados también pueden (sin ver costos
 * ni ganancias) y cada uno puede pedir el resumen del día a la hora que quiera.
 */
export default function AskWhatsApp({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const isOwner = useOwnerAccess();
  const [open, setOpen] = useState(defaultOpen);
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState<Code | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const justLinked = useRef(false);

  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);

  const load = async () => {
    try {
      const { data } = await api.get('/ai/whatsapp', { silent: true } as any);
      setStatus(data);
      setError('');
      return data as Status;
    } catch (err: any) {
      setError(err?.response?.data?.message || 'No se pudo conectar con Ventra. Revisá internet.');
      return null;
    }
  };

  useEffect(() => { if (open && !status) load(); }, [open]);

  // Esperando que mande el código desde el teléfono
  useEffect(() => {
    if (!code || status?.linked) return;
    const t = window.setInterval(async () => {
      const s = await load();
      if (s?.linked) { justLinked.current = true; setCode(null); }
    }, 4000);
    const stop = window.setTimeout(() => setCode(null), code.expiresInMin * 60 * 1000);
    return () => { window.clearInterval(t); window.clearTimeout(stop); };
  }, [code, status?.linked]);

  const post = async (path: string, body: object, failMsg: string) => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/ai/whatsapp/${path}`, body, { silent: true } as any);
      return data;
    } catch (err: any) {
      setError(err?.response?.data?.message || failMsg);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const data = await post('code', {}, 'No se pudo pedir el código. Probá de nuevo.');
    if (!data) return;
    setCode(data);
    setQr(await QRCode.toDataURL(data.link, { margin: 1, width: 360 }));
    if (isPhone()) window.open(data.link, '_blank');
  };

  const unlink = async (target?: string) => {
    if (!window.confirm(target ? '¿Desvincular el WhatsApp de este encargado?' : '¿Desvincular tu WhatsApp? Vas a dejar de poder preguntarle a Ventra desde ahí.')) return;
    const data = await post('unlink', target ? { target } : {}, 'No se pudo desvincular. Probá de nuevo.');
    if (data) { if (!target) justLinked.current = false; setStatus(data); }
  };

  const setSummary = async (summary: { enabled: boolean; hour: number }) => {
    const data = await post('summary', summary, 'No se pudo guardar el resumen. Probá de nuevo.');
    if (data) setStatus(data);
  };

  const setSupervisors = async (allowed: boolean) => {
    if (!allowed && (status?.supervisors?.length || 0) > 0 && !window.confirm('Los encargados que ya lo vincularon van a quedar desvinculados. ¿Seguimos?')) return;
    const data = await post('supervisors', { allowed }, 'No se pudo guardar. Probá de nuevo.');
    if (data) await load();
  };

  const chat = status?.number ? `https://wa.me/${status.number}` : '';
  const summary = status?.summary || { enabled: false, hour: 21 };
  const blocked = !isOwner && status && !status.supervisorsAllowed && !status.linked;

  return (
    <div className="mt-3 pt-3 border-t border-violet-100">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 text-left">
        <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0"><MessageCircle className="w-4 h-4" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-bold text-slate-900 leading-tight">Preguntale por WhatsApp</span>
          <span className="block text-[11.5px] text-slate-500 leading-tight">Desde tu celular, aunque no estés en el local</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2.5 text-[12.5px] text-slate-700 leading-relaxed space-y-2.5">
          {error && <p className="text-rose-700">{error}</p>}
          {!status && !error && <p className="text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…</p>}

          {blocked && <p>El dueño todavía no habilitó que los encargados le pregunten a Ventra por WhatsApp. Pedile que lo active acá mismo, desde su usuario.</p>}

          {status?.linked && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5">
              <p className="flex items-center gap-1.5 font-semibold text-emerald-900"><Check className="w-4 h-4" /> {justLinked.current ? '¡Listo! Tu WhatsApp quedó vinculado' : `Vinculado al ${status.phone}`}</p>
              <p className="mt-1 text-emerald-900/80">Escribile a Ventra lo que quieras saber, con tus palabras. También te explica cómo hacer cosas en el sistema.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {chat && <a href={chat} target="_blank" rel="noreferrer" className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-semibold inline-flex items-center">Abrir WhatsApp</a>}
                <button type="button" onClick={() => unlink()} disabled={busy} className="h-8 px-3 rounded-lg border border-emerald-300 text-emerald-900 text-[12.5px] font-semibold hover:bg-emerald-100 disabled:opacity-50">Desvincular</button>
              </div>
              <div className="mt-2.5 pt-2.5 border-t border-emerald-200 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={summary.enabled} disabled={busy} onChange={(e) => setSummary({ ...summary, enabled: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
                  <span className="text-emerald-900">Mandarme el resumen del día</span>
                </label>
                <select value={summary.hour} disabled={busy || !summary.enabled} onChange={(e) => setSummary({ ...summary, hour: Number(e.target.value) })}
                  className="h-7 px-1.5 rounded-md border border-emerald-300 bg-white text-[12px] text-emerald-900 disabled:opacity-50">
                  {HOURS.map((h) => <option key={h} value={h}>a las {h} h</option>)}
                </select>
              </div>
            </div>
          )}

          {status && !status.linked && !code && !blocked && (
            <>
              <p>Vinculá tu WhatsApp una sola vez y preguntale a Ventra como a una persona. Contesta con los números de tu negocio (lo último que la caja mandó a la nube).</p>
              <button type="button" onClick={start} disabled={busy}
                className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Vincular mi WhatsApp
              </button>
            </>
          )}

          {code && !status?.linked && (
            <div className="rounded-xl bg-white border border-slate-200 px-3 py-3">
              {isPhone() ? (
                <p>Se abrió WhatsApp con el mensaje listo: <b>tocá enviar</b>. Si no se abrió, <a href={code.link} target="_blank" rel="noreferrer" className="text-emerald-700 font-semibold underline">abrilo acá</a>.</p>
              ) : (
                <div className="flex gap-3 items-center">
                  {qr && <img src={qr} alt="Código QR para vincular WhatsApp" className="w-32 h-32 shrink-0 rounded-lg border border-slate-200" />}
                  <p>Escaneá el código con la cámara de tu celular: se abre WhatsApp con el mensaje listo. <b>Tocá enviar</b> y listo.</p>
                </div>
              )}
              <p className="mt-2 text-[11.5px] text-slate-500">O mandá <b className="text-slate-700">VINCULAR {code.code}</b> al +{code.number.replace(/^549(\d{3})(\d{3})(\d{4})$/, '54 9 $1 $2 $3')}. El código vale {code.expiresInMin} minutos.</p>
              <p className="mt-1.5 text-[11.5px] text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Esperando tu mensaje…</p>
            </div>
          )}

          {isOwner && status && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={!!status.supervisorsAllowed} disabled={busy} onChange={(e) => setSupervisors(e.target.checked)} className="mt-0.5 w-4 h-4 accent-emerald-600" />
                <span>
                  <span className="block font-semibold text-slate-800">Que los encargados también puedan</span>
                  <span className="block text-[11.5px] text-slate-500">Cada uno vincula su WhatsApp desde su usuario. Ven ventas, stock y caja, pero no costos ni ganancias. Usan el mismo cupo de preguntas.</span>
                </span>
              </label>
              {!!status.supervisors?.length && (
                <ul className="mt-2 space-y-1">
                  {status.supervisors.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span>{s.name} · {s.phone}</span>
                      <button type="button" onClick={() => unlink(s.id)} disabled={busy} className="text-rose-700 font-semibold hover:underline disabled:opacity-50">Desvincular</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

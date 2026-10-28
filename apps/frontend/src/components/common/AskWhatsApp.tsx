import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2, MessageCircle, Check, ChevronDown } from 'lucide-react';
import api from '../../services/api';

interface Status { linked: boolean; phone?: string; questions?: number; number?: string }
interface Code { code: string; link: string; number: string; expiresInMin: number }

const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Preguntale a tu negocio por WhatsApp (ver /ai/whatsapp y firebase/functions/wa-owner.js): el
 * dueño vincula su teléfono mandando un código al número de Ventra y después pregunta desde
 * ahí, aunque no esté en el local. Contesta con lo último que la caja mandó a la nube.
 */
export default function AskWhatsApp() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState<Code | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const justLinked = useRef(false);

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

  const start = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/ai/whatsapp/code', {}, { silent: true } as any);
      setCode(data);
      setQr(await QRCode.toDataURL(data.link, { margin: 1, width: 360 }));
      if (isPhone()) window.open(data.link, '_blank');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'No se pudo pedir el código. Probá de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!window.confirm('¿Desvincular tu WhatsApp? Vas a dejar de poder preguntarle a Ventra desde ahí.')) return;
    setBusy(true);
    try {
      await api.post('/ai/whatsapp/unlink', {}, { silent: true } as any);
      justLinked.current = false;
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'No se pudo desvincular. Probá de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const chat = status?.number ? `https://wa.me/${status.number}` : '';

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
        <div className="mt-2.5 text-[12.5px] text-slate-700 leading-relaxed">
          {error && <p className="mb-2 text-rose-700">{error}</p>}
          {!status && !error && <p className="text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…</p>}

          {status?.linked && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5">
              <p className="flex items-center gap-1.5 font-semibold text-emerald-900"><Check className="w-4 h-4" /> {justLinked.current ? '¡Listo! Tu WhatsApp quedó vinculado' : `Vinculado al ${status.phone}`}</p>
              <p className="mt-1 text-emerald-900/80">Escribile a Ventra lo que quieras saber: "¿cuánto vendí hoy?", "¿me quedan Coca de 1,5?", "¿cómo viene la caja?".</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {chat && <a href={chat} target="_blank" rel="noreferrer" className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-semibold inline-flex items-center">Abrir WhatsApp</a>}
                <button type="button" onClick={unlink} disabled={busy} className="h-8 px-3 rounded-lg border border-emerald-300 text-emerald-900 text-[12.5px] font-semibold hover:bg-emerald-100 disabled:opacity-50">Desvincular</button>
              </div>
            </div>
          )}

          {status && !status.linked && !code && (
            <>
              <p>Vinculá tu WhatsApp una sola vez y preguntale a Ventra como a una persona. Contesta con los números de tu caja (lo último que mandó a la nube).</p>
              <button type="button" onClick={start} disabled={busy}
                className="mt-2 h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
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
        </div>
      )}
    </div>
  );
}

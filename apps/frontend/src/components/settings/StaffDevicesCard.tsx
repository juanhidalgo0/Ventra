import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import { Smartphone, QrCode, Copy, Trash2, Loader2, MessageCircle, X } from 'lucide-react';
import api from '../../services/api';

interface Device { id: string; name: string | null; label: string; createdAt: number | null; lastSeenAt: number | null }

/** "Chrome en Android", "Safari en iPhone": lo que dice el navegador del celular */
function deviceText(ua: string) {
  const os = /iPhone|iPad/i.test(ua) ? 'iPhone' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : '';
  const br = /SamsungBrowser/i.test(ua) ? 'Samsung Internet' : /EdgA?\//i.test(ua) ? 'Edge' : /CriOS|Chrome/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : /Firefox|FxiOS/i.test(ua) ? 'Firefox' : '';
  return [br, os].filter(Boolean).join(' en ') || 'Navegador';
}
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');

/**
 * Celulares de empleados: entran a la caja web desde su teléfono sin la cuenta de Google del
 * dueño. El dueño muestra un QR (o manda el link): sirve una vez, por 15 minutos. Después el
 * empleado entra con su usuario y contraseña. Se puede dar de baja cualquier celular.
 */
export default function StaffDevicesCard() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState(false);
  const [link, setLink] = useState<{ url: string; until: number } | null>(null);
  const [name, setName] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, tick] = useState(0);

  const load = () => api.get('/staff-devices', { silent: true } as any)
    .then(({ data }) => { setDevices(Array.isArray(data) ? data : []); setError(''); })
    .catch((e) => { setDevices([]); setError(e?.response?.data?.message || ''); });
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (link && canvas.current) QRCode.toCanvas(canvas.current, link.url, { width: 220, margin: 1 }).catch(() => {});
  }, [link]);
  // Cuenta regresiva del código; al vencer se cierra y se actualiza la lista (por si ya lo usaron)
  useEffect(() => {
    if (!link) return;
    const iv = setInterval(() => {
      if (Date.now() > link.until) { setLink(null); load(); } else tick((n) => n + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, [link]);

  const pair = async () => {
    setPairing(true);
    try {
      const { data } = await api.post('/staff-devices/pair', name.trim() ? { name: name.trim() } : {});
      setLink({ url: data.link, until: Date.now() + (data.expiresInSeconds || 900) * 1000 });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'No se pudo generar el código');
    } finally {
      setPairing(false);
    }
  };
  const revoke = async (d: Device) => {
    if (!window.confirm(`¿Dar de baja ${d.name || deviceText(d.label)}? Ese celular deja de entrar a la caja (en menos de 10 minutos).`)) return;
    try {
      await api.post(`/staff-devices/${d.id}/revoke`);
      toast.success('Celular dado de baja');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'No se pudo dar de baja');
    }
  };
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); toast.success('Link copiado'); } catch { toast.error('No se pudo copiar'); }
  };
  const left = link ? Math.max(0, Math.round((link.until - Date.now()) / 1000)) : 0;

  return (
    <div className="card p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-rose-50 text-rose-600">
            <Smartphone className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold tracking-tight text-slate-900">Celulares de empleados</h3>
            <p className="text-[13px] text-slate-500 mt-0.5 leading-snug">Para que entren a la caja web desde su teléfono <b>sin tu cuenta de Google</b>. Después entran con su usuario y contraseña de acá arriba.</p>
          </div>
        </div>
        {!link && (
          <button onClick={pair} disabled={pairing} className="btn-primary h-9 px-4 text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-60">
            {pairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />} Sumar un celular
          </button>
        )}
      </div>

      {!link && (
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="De quién es (opcional): Ej. Celular de Mica"
          className="w-full sm:w-80 px-3 py-2 rounded-lg border border-slate-300 text-[13px]" />
      )}

      {link && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 flex flex-col sm:flex-row gap-4 items-center">
          <canvas ref={canvas} className="rounded-xl bg-white p-2 shrink-0" />
          <div className="flex-1 min-w-0 space-y-2 text-[13px] text-slate-700">
            <p className="font-bold text-slate-800">Que el empleado escanee este QR con la cámara de su celular</p>
            <p>O mandale el link. Sirve <b>una sola vez</b> y vence en <b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={copy} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12.5px] font-semibold flex items-center gap-1.5 cursor-pointer"><Copy className="w-4 h-4" /> Copiar link</button>
              <a href={`https://wa.me/?text=${encodeURIComponent(`Para entrar a la caja de Ventra desde tu celular, abrí este link (sirve una vez, por 15 minutos): ${link.url}`)}`} target="_blank" rel="noreferrer"
                className="h-9 px-3 rounded-lg bg-[#25D366] text-white text-[12.5px] font-semibold flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> Mandar por WhatsApp</a>
              <button onClick={() => { setLink(null); load(); }} className="h-9 px-3 rounded-lg text-[12.5px] font-semibold text-slate-600 flex items-center gap-1.5 cursor-pointer"><X className="w-4 h-4" /> Listo</button>
            </div>
            <p className="text-[11.5px] text-slate-500">Si el empleado todavía no tiene usuario, crealo arriba con "Crear Cajero".</p>
          </div>
        </div>
      )}

      {devices === null ? (
        <p className="text-[12.5px] text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</p>
      ) : error ? (
        <p className="text-[12.5px] text-amber-700">{error}</p>
      ) : devices.length === 0 ? (
        <p className="text-[12.5px] text-slate-500">Todavía no hay celulares habilitados.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800 truncate">{d.name || deviceText(d.label)}</p>
                <p className="text-[11.5px] text-slate-500">{d.name ? `${deviceText(d.label)} · ` : ''}habilitado el {when(d.createdAt)}{d.lastSeenAt ? ` · último uso ${when(d.lastSeenAt)}` : ''}</p>
              </div>
              <button onClick={() => revoke(d)} className="h-8 px-3 rounded-lg border border-rose-200 text-rose-600 text-[12px] font-semibold flex items-center gap-1.5 hover:bg-rose-50 cursor-pointer shrink-0">
                <Trash2 className="w-3.5 h-3.5" /> Dar de baja
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { X, MessageCircle, Check, Loader2, PhoneOff } from 'lucide-react';
import { waNumber } from '../distribuidora/clientLink';
import { clientOrderLink } from '../../services/onlineStore';
import { useOnlineOrders } from '../../services/onlineStoreOrders';
import { readRouteDays, dayName } from '../../services/routeDays';

/**
 * Aviso a todos los clientes de una zona ("mañana pasamos por Magdalena, pasanos tu pedido").
 * WhatsApp no deja mandar mensajes masivos desde un número común: se manda uno por uno, con el
 * mensaje ya escrito para cada cliente (su nombre y su link de pedidos), y se marca a quién ya se
 * le mandó para seguir donde se quedó.
 */

const TEXT_KEY = 'ventra_zone_notice_text';
/** Mandar con el mensaje armado o solo abrir el chat (lo de siempre): se recuerda en el equipo */
const USE_TEXT_KEY = 'ventra_zone_notice_use_text';
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const today = () => new Date().toISOString().slice(0, 10);
const sentKey = (zone: string) => `ventra_zone_sent_${norm(zone)}_${today()}`;
const readSent = (zone: string): string[] => { try { return JSON.parse(localStorage.getItem(sentKey(zone)) || '[]'); } catch { return []; } };

/** "Mañana jueves", "El jueves" o "Esta semana", según el recorrido */
function whenText(zone: string) {
  const map = readRouteDays();
  const key = Object.keys(map).find((k) => norm(k) === norm(zone));
  const days = key ? map[key] : null;
  if (days?.length) {
    for (let k = 1; k <= 7; k++) {
      const d = new Date();
      d.setDate(d.getDate() + k);
      if (days.includes(d.getDay())) return k === 1 ? `Mañana ${dayName(d.getDay())}` : `El ${dayName(d.getDay())}`;
    }
  }
  return 'Esta semana';
}

export default function ZoneNotice({ zone, clients, onClose }: { zone: string; clients: any[]; onClose: () => void }) {
  const wholesale = useOnlineOrders((s) => s.wholesale) === true;
  const defaultText = wholesale
    ? '¡Hola {nombre}! {dia} pasamos por {zona}. Pasanos tu pedido acá: {link} o respondé este mensaje.'
    : '¡Hola {nombre}! {dia} pasamos por {zona}. ¿Qué te llevamos? Respondé este mensaje con tu pedido.';
  const [useText, setUseText] = useState(() => { try { return localStorage.getItem(USE_TEXT_KEY) === '1'; } catch { return false; } });
  const [text, setText] = useState(() => { try { return localStorage.getItem(TEXT_KEY) || defaultText; } catch { return defaultText; } });
  const [sent, setSent] = useState<string[]>(() => readSent(zone));
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const dia = useMemo(() => whenText(zone), [zone]);

  const withPhone = clients.filter((c) => waNumber(c.phone));
  const noPhone = clients.filter((c) => !waNumber(c.phone));
  const usesLink = text.includes('{link}');

  useEffect(() => { try { localStorage.setItem(TEXT_KEY, text); } catch { /* sin espacio */ } }, [text]);
  useEffect(() => { try { localStorage.setItem(USE_TEXT_KEY, useText ? '1' : '0'); } catch { /* sin espacio */ } }, [useText]);

  const messageFor = (c: any, link?: string) => {
    const put = (s: string, key: string, value: string) => s.split(key).join(value);
    let t = put(put(put(text, '{nombre}', String(c.name || '').trim()), '{zona}', zone), '{dia}', dia);
    // Sin link (tienda apagada o no se pudo armar), se saca la parte del link
    t = link ? put(t, '{link}', link) : put(t.replace(/\s*[^.!?\n]*\{link\}[^.!?\n]*[.!?]?/g, ''), '{link}', '');
    return t.replace(/\s{2,}/g, ' ').trim();
  };

  const send = async (c: any) => {
    const wa = waNumber(c.phone);
    if (!wa) return;
    setBusy(c.id);
    let link = links[c.id];
    if (useText && usesLink && wholesale && !link) {
      try { link = await clientOrderLink(c); setLinks((m) => ({ ...m, [c.id]: link! })); } catch { link = ''; }
    }
    // Sin mensaje armado solo se abre el chat con el cliente
    window.open(useText ? `https://wa.me/${wa}?text=${encodeURIComponent(messageFor(c, link))}` : `https://wa.me/${wa}`, '_blank');
    const next = Array.from(new Set([...sent, c.id]));
    setSent(next);
    try { localStorage.setItem(sentKey(zone), JSON.stringify(next)); } catch { /* sin espacio */ }
    setBusy(null);
  };

  const sample = withPhone[0] || clients[0];
  const pending = withPhone.filter((c) => !sent.includes(c.id));

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/60 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Avisar a ${zone}`} onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg max-h-[92dvh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-bold text-slate-900">Avisar a {zone}</p>
            <p className="text-[12.5px] text-slate-500">{withPhone.length} {withPhone.length === 1 ? 'cliente' : 'clientes'} con WhatsApp · {sent.filter((id) => withPhone.some((c) => c.id === id)).length} ya avisados hoy</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer" aria-label="Cerrar"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 cursor-pointer select-none">
            <span>
              <span className="block text-[13.5px] font-semibold text-slate-800">Con mensaje armado</span>
              <span className="block text-[12px] text-slate-500">{useText ? 'Se abre el chat con el mensaje ya escrito.' : 'Apagado: solo se abre el chat con cada cliente.'}</span>
            </span>
            <input type="checkbox" checked={useText} onChange={(e) => setUseText(e.target.checked)} className="w-5 h-5 accent-emerald-600 shrink-0" />
          </label>
          {useText && <div>
            <p className="text-[12.5px] font-semibold text-slate-700 mb-1.5">Mensaje</p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[14px] outline-none focus:border-emerald-500 focus:bg-white resize-none" />
            <p className="text-[11.5px] text-slate-500 mt-1">
              Se completan solos: <b>{'{nombre}'}</b>, <b>{'{dia}'}</b> ({dia.toLowerCase()}), <b>{'{zona}'}</b>{wholesale ? <>, <b>{'{link}'}</b> (su link de pedidos)</> : null}.
              <button onClick={() => setText(defaultText)} className="ml-1 font-semibold text-emerald-700 cursor-pointer">Volver al original</button>
            </p>
            {sample && (
              <p className="mt-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-[13px] text-emerald-900 whitespace-pre-wrap">
                {messageFor(sample, usesLink && wholesale ? 'ventra.store/…' : '')}
              </p>
            )}
          </div>}

          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {withPhone.map((c) => {
              const done = sent.includes(c.id);
              return (
                <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    {done ? <Check className="w-4 h-4" /> : <MessageCircle className="w-3.5 h-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-slate-900 truncate">{c.name}</span>
                    <span className="block text-[12px] text-slate-500 truncate">{c.phone}</span>
                  </span>
                  <button onClick={() => send(c)} disabled={busy === c.id}
                    className={`h-9 px-3.5 rounded-xl text-[13px] font-bold cursor-pointer flex items-center gap-1.5 disabled:opacity-60 ${done ? 'border border-slate-200 text-slate-600' : 'bg-[#25D366] hover:bg-[#1fbe5b] text-white'}`}>
                    {busy === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{done ? 'Otra vez' : 'Mandar'}
                  </button>
                </div>
              );
            })}
            {withPhone.length === 0 && <p className="px-4 py-3 text-[13px] text-slate-500">Ningún cliente de {zone} tiene teléfono cargado.</p>}
          </div>

          {noPhone.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-[12.5px] text-amber-900 flex gap-2">
              <PhoneOff className="w-4 h-4 shrink-0 mt-0.5" />
              <span><b>Sin teléfono:</b> {noPhone.map((c) => c.name).join(', ')}. Cargales el número en su ficha para poder avisarles.</span>
            </div>
          )}
        </div>

        <div className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] border-t border-slate-100">
          {pending.length > 0 ? (
            <button onClick={() => send(pending[0])} disabled={!!busy}
              className="w-full h-12 rounded-2xl bg-[#25D366] hover:bg-[#1fbe5b] text-white font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60">
              <MessageCircle className="w-4 h-4" /> Mandar al siguiente: {pending[0].name}
            </button>
          ) : (
            <p className="text-center text-[13.5px] font-semibold text-emerald-700 py-2">{withPhone.length ? 'Listo: ya les avisaste a todos' : 'No hay a quién avisar'}</p>
          )}
        </div>
      </div>
    </div>
  );
}

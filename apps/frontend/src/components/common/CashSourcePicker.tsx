import { useEffect, useState } from 'react';
import { Wallet, Landmark, Ban } from 'lucide-react';
import api from '../../services/api';
import { useFeature } from '../../stores/businessStore';

/** De dónde sale la plata de un pago en efectivo (compra, pago a un proveedor) */
export type CashSource = { source: 'SESSION' | 'FUND' | 'NONE'; sessionId?: string };

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

/** ¿El medio elegido es efectivo? (los textos de medios de pago varían según la pantalla) */
export const isCashMethod = (method?: string | null) => !method || /efectivo|cash/i.test(method);

/**
 * "¿De dónde sale la plata?": el cajón de una caja abierta, la caja del mes (solo el dueño) o
 * ninguna (ya estaba afuera de las cajas). Arranca en la caja abierta de quien paga, si tiene.
 */
export default function CashSourcePicker({ value, onChange, dark = false }: { value: CashSource | null; onChange: (v: CashSource) => void; dark?: boolean }) {
  const usesFund = useFeature('monthfund');
  const [data, setData] = useState<{ sessions: any[]; fund: number | null } | null>(null);

  useEffect(() => {
    api.get('/cash/pay-sources').then((r) => {
      setData(r.data);
      if (!value) {
        const s = r.data.sessions.find((x: any) => x.mine) || r.data.sessions[0];
        onChange(s ? { source: 'SESSION', sessionId: s.id } : usesFund && r.data.fund != null ? { source: 'FUND' } : { source: 'NONE' });
      }
    }).catch(() => { setData({ sessions: [], fund: null }); if (!value) onChange({ source: 'NONE' }); });
  }, []);

  if (!data) return <p className="text-[12px] text-slate-400">Buscando cajas…</p>;
  const options: { key: string; v: CashSource; label: string; hint: string; Icon: any }[] = [
    ...data.sessions.map((s) => ({ key: s.id, v: { source: 'SESSION' as const, sessionId: s.id }, label: `Cajón de ${s.terminalName}`, hint: s.user ? `Caja abierta de ${s.user}` : 'Caja abierta', Icon: Wallet })),
    ...(usesFund && data.fund != null ? [{ key: 'FUND', v: { source: 'FUND' as const }, label: 'Caja del mes', hint: `Hay ${money(data.fund)} guardados`, Icon: Landmark }] : []),
    { key: 'NONE', v: { source: 'NONE' as const }, label: 'No sale de ninguna caja', hint: 'Transferencia, o plata que ya estaba afuera', Icon: Ban },
  ];
  const isOn = (v: CashSource) => value?.source === v.source && (v.source !== 'SESSION' || value?.sessionId === v.sessionId);

  return (
    <div className="space-y-1.5">
      <p className={`text-[12px] font-bold ${dark ? 'text-slate-300' : 'text-slate-600'}`}>¿De dónde sale la plata?</p>
      {options.map(({ key, v, label, hint, Icon }) => (
        <button key={key} type="button" onClick={() => onChange(v)} aria-pressed={isOn(v)}
          className={`w-full text-left px-3 py-2.5 rounded-xl border-2 flex items-center gap-2.5 cursor-pointer ${isOn(v) ? 'border-rose-600 bg-rose-50' : 'border-slate-200 bg-white'}`}>
          <Icon className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-slate-800 truncate">{label}</span>
            <span className="block text-[11.5px] text-slate-500 truncate">{hint}</span>
          </span>
        </button>
      ))}
      {!data.sessions.length && <p className="text-[11.5px] text-slate-500">No hay cajas abiertas ahora.</p>}
    </div>
  );
}

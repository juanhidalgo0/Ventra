import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { X } from 'lucide-react';
import { getVentraDb } from '../../services/ventraFirebase';
import { APP_VERSION } from '../../appVersion';
import { usePlanStore } from '../../stores/planStore';
import { useBusinessStore } from '../../stores/businessStore';

/**
 * Aviso que Ventra manda a las cajas desde el admin (ventra_desktop/broadcast, lectura pública):
 * "hay versión nueva", "mañana corte de 10 a 11"… Puede ir a todos o solo a un plan, un rubro o a
 * las versiones hasta cierta. Una franja angosta arriba; cerrado una vez, no vuelve (por id).
 */
interface Broadcast {
  id: string | null; text: string; level?: 'info' | 'warn' | 'bad';
  plans?: string[]; rubros?: string[]; maxVersion?: string | null; until?: string | null; link?: string | null;
}

const DISMISSED = 'ventra_broadcast_closed';
const readClosed = (): string[] => { try { return JSON.parse(localStorage.getItem(DISMISSED) || '[]'); } catch { return []; } };

const cmpVersion = (a: string, b: string) => {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
};

const COLORS = {
  info: 'bg-slate-900 text-white',
  warn: 'bg-amber-500 text-slate-950',
  bad: 'bg-red-600 text-white',
};

export default function AdminBroadcast() {
  const [b, setB] = useState<Broadcast | null>(null);
  const [closed, setClosed] = useState<string[]>(readClosed);
  const plan = usePlanStore((s) => s.plan);
  const isDemo = usePlanStore((s) => s.isDemo);
  const profiles = useBusinessStore((s) => (s as any).profiles as string[] | undefined);
  const profile = useBusinessStore((s) => (s as any).profile as string | undefined);

  useEffect(() => {
    try {
      return onSnapshot(doc(getVentraDb(), 'ventra_desktop', 'broadcast'),
        (snap) => setB(snap.exists() ? (snap.data() as Broadcast) : null),
        () => setB(null));
    } catch { return undefined; }
  }, []);

  if (!b || !b.id || !b.text || isDemo || closed.includes(b.id)) return null;
  if (b.until && Date.parse(b.until) < Date.now()) return null;
  if (b.plans?.length && (!plan || !b.plans.includes(plan))) return null;
  const mine = profiles?.length ? profiles : profile ? [profile] : [];
  if (b.rubros?.length && !mine.some((p) => b.rubros!.includes(p))) return null;
  if (b.maxVersion && (!APP_VERSION || cmpVersion(APP_VERSION, b.maxVersion) > 0)) return null;

  const close = () => {
    const next = [...closed.slice(-19), b.id!];
    setClosed(next);
    try { localStorage.setItem(DISMISSED, JSON.stringify(next)); } catch { /* sin navegador guardado: vuelve a aparecer al recargar */ }
  };

  return (
    <div role="status" className={`fixed top-0 left-1/2 -translate-x-1/2 z-[99990] max-w-[calc(100vw-16px)] mt-1 flex items-center gap-3 rounded-full pl-4 pr-1.5 py-1.5 text-xs font-semibold shadow-lg ${COLORS[b.level || 'info']}`}>
      <span className="min-w-0 truncate">{b.text}</span>
      {b.link && <a href={b.link} target="_blank" rel="noopener noreferrer" className="shrink-0 underline underline-offset-2">Ver más</a>}
      <button onClick={close} aria-label="Cerrar aviso" className="shrink-0 rounded-full p-1 hover:bg-black/10"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

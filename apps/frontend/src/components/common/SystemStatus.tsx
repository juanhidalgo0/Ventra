import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { X, RefreshCw, Loader2, Wifi, Server, Cloud, Printer, DatabaseBackup, BadgeCheck, Info, MessageCircle, Copy } from 'lucide-react';
import api from '../../services/api';
import { APP_VERSION } from '../../appVersion';
import { canPrintSilently, getTicketPrinter, listPrinters } from '../../utils/ticketPrinter';
import { openExternal } from '../../utils/externalLinks';
import { useAuthStore } from '../../stores/authStore';

/**
 * "Todo funcionando": una pastilla arriba (verde, amarilla o roja) y, al tocarla, el estado de cada
 * parte del sistema en palabras simples, con qué hacer si algo falla y un botón para mandarle el
 * diagnóstico a Ventra por WhatsApp. Solo mira: no cambia nada.
 */
type Level = 'ok' | 'warn' | 'bad' | 'off';
interface Check { key: string; label: string; level: Level; detail: string; fix?: string; icon: typeof Wifi }

const SUPPORT_WA = '5492212048533';
const OPEN_EVENT = 'ventra:system-status';
export const openSystemStatus = () => window.dispatchEvent(new Event(OPEN_EVENT));

const ago = (iso?: string | null) => {
  if (!iso) return null;
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min)) return null;
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
};

async function runChecks(isAdmin: boolean): Promise<Check[]> {
  const checks: Check[] = [];
  const online = navigator.onLine;
  checks.push({
    key: 'net', label: 'Internet', icon: Wifi, level: online ? 'ok' : 'warn',
    detail: online ? 'Conectado' : 'Sin internet',
    fix: online ? undefined : 'La caja sigue vendiendo igual. Cuando vuelva internet, todo se sube solo a la nube.',
  });

  const t0 = performance.now();
  let sync: any = null;
  try {
    sync = (await api.get('/sync/status', { timeout: 8000 })).data;
    const ms = Math.round(performance.now() - t0);
    checks.push({ key: 'server', label: 'Caja', icon: Server, level: ms > 3000 ? 'warn' : 'ok', detail: ms > 3000 ? `Responde lento (${(ms / 1000).toFixed(1)} s)` : 'Funcionando', fix: ms > 3000 ? 'Si sigue lento, cerrá Ventra y volvé a abrirlo.' : undefined });
  } catch {
    checks.push({ key: 'server', label: 'Caja', icon: Server, level: 'bad', detail: 'No responde', fix: 'Cerrá Ventra y volvé a abrirlo. Si sigue igual, mandanos el diagnóstico.' });
  }

  if (sync) {
    if (!sync.enabled) {
      checks.push({ key: 'cloud', label: 'Copia en la nube', icon: Cloud, level: 'off', detail: 'Esta caja no está vinculada a una cuenta', fix: 'Vinculala desde Configuración → Suscripción para tener todo guardado en la nube y verlo desde el celular.' });
    } else if (sync.lastError && online) {
      checks.push({ key: 'cloud', label: 'Copia en la nube', icon: Cloud, level: 'warn', detail: `No se pudo sincronizar${sync.pending ? ` (${sync.pending} cambios esperando)` : ''}`, fix: 'Se vuelve a intentar sola cada minuto. Nada se pierde: los cambios quedan guardados en esta PC.' });
    } else {
      const when = ago(sync.lastSyncAt);
      checks.push({
        key: 'cloud', label: 'Copia en la nube', icon: Cloud, level: sync.pending > 50 ? 'warn' : 'ok',
        detail: sync.pending > 0 ? `${sync.pending} cambios subiendo${when ? ` · última ${when}` : ''}` : `Al día${when ? ` · ${when}` : ''}`,
      });
    }
  }

  if (canPrintSilently()) {
    const chosen = getTicketPrinter();
    if (!chosen) {
      checks.push({ key: 'printer', label: 'Impresora de tickets', icon: Printer, level: 'ok', detail: 'La predeterminada de Windows' });
    } else {
      const list = await listPrinters();
      const found = list.includes(chosen);
      checks.push({ key: 'printer', label: 'Impresora de tickets', icon: Printer, level: found ? 'ok' : 'bad', detail: found ? chosen : `"${chosen}" no aparece`, fix: found ? undefined : 'Revisá que esté prendida y conectada. Si la cambiaste, elegila de nuevo en Configuración → Impresoras de esta PC.' });
    }
  }

  if (isAdmin) {
    try {
      const list: any[] = (await api.get('/system/backup/list', { timeout: 8000 })).data || [];
      const last = list.map((b) => new Date(b.createdAt).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0];
      const days = last ? (Date.now() - last) / 86400000 : Infinity;
      checks.push({
        key: 'backup', label: 'Respaldo en esta PC', icon: DatabaseBackup, level: days <= 2 ? 'ok' : 'warn',
        detail: last ? `Último ${ago(new Date(last).toISOString())}` : 'Todavía no hay',
        fix: days <= 2 ? undefined : 'Hacé uno desde Configuración → Respaldos (un clic).',
      });
    } catch { /* sin permisos o sin respaldos: no se muestra */ }
  }

  try {
    const sub = (await api.get('/subscription/status', { timeout: 8000 })).data;
    if (sub?.state === 'ACTIVE') {
      checks.push({ key: 'plan', label: 'Suscripción', icon: BadgeCheck, level: (sub.daysLeft ?? 99) <= 3 ? 'warn' : 'ok', detail: `${sub.planName || 'Ventra'} · ${sub.daysLeft ?? '—'} días`, fix: (sub.daysLeft ?? 99) <= 3 ? 'Se renueva sola con Mercado Pago. Si cambiaste la tarjeta, revisala en ventra.store → Mi cuenta.' : undefined });
    } else if (sub?.state === 'GRACE') {
      checks.push({ key: 'plan', label: 'Suscripción', icon: BadgeCheck, level: 'warn', detail: `Vencida · ${sub.daysLeft} días de gracia`, fix: 'Renovala en ventra.store → Mi cuenta para que no quede en solo lectura.' });
    } else if (sub?.state === 'READ_ONLY') {
      checks.push({ key: 'plan', label: 'Suscripción', icon: BadgeCheck, level: 'bad', detail: 'Vencida: solo lectura', fix: 'Renovala en ventra.store → Mi cuenta y la caja vuelve a vender en el momento.' });
    }
  } catch { /* sin datos de suscripción */ }

  checks.push({ key: 'version', label: 'Versión', icon: Info, level: 'ok', detail: APP_VERSION ? `Ventra ${APP_VERSION}` : 'Ventra' });
  return checks;
}

const worst = (checks: Check[]): Level =>
  checks.some((c) => c.level === 'bad') ? 'bad' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';

const DOT: Record<Level, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', off: 'bg-slate-300' };
const PILL: Record<Level, string> = {
  ok: 'border-emerald-200 text-emerald-800 bg-emerald-50/60 hover:bg-emerald-50',
  warn: 'border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100',
  bad: 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100',
  off: 'border-slate-200 text-slate-600 bg-white',
};
const TEXT: Record<Level, string> = { ok: 'Todo funcionando', warn: 'Revisar', bad: 'Hay un problema', off: 'Todo funcionando' };

export function SystemStatusPill() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'ADMIN' || sessionStorage.getItem('admin_unlocked') === 'true';
  const [level, setLevel] = useState<Level>('ok');
  const [open, setOpen] = useState(false);

  // Cada minuto, solo lo barato (internet y la nube): el resto se mira al abrir
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      let l: Level = navigator.onLine ? 'ok' : 'warn';
      try {
        const s = (await api.get('/sync/status', { timeout: 8000 })).data;
        if (s?.enabled && s.lastError && navigator.onLine) l = 'warn';
      } catch { l = 'bad'; }
      if (alive) setLevel(l);
    };
    tick();
    const t = setInterval(tick, 60000);
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    const on = () => tick();
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => { alive = false; clearInterval(t); window.removeEventListener(OPEN_EVENT, onOpen); window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);

  return (
    <>
      <button onClick={() => setOpen(true)} title={`${TEXT[level]}: internet, nube, impresora y respaldos`} aria-label={`Estado del sistema: ${TEXT[level]}`}
        className={`hidden md:flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-[12px] font-semibold whitespace-nowrap transition-colors ${PILL[level]}`}>
        <span className="relative flex w-2 h-2">
          {level !== 'ok' && <span className={`absolute inset-0 rounded-full ${DOT[level]} animate-ping opacity-60`} />}
          <span className={`relative w-2 h-2 rounded-full ${DOT[level]}`} />
        </span>
        <span className={level === 'ok' ? 'hidden 2xl:inline' : 'hidden xl:inline'}>{TEXT[level]}</span>
      </button>
      {open && <SystemStatusPanel isAdmin={isAdmin} onClose={() => setOpen(false)} onLevel={setLevel} />}
    </>
  );
}

function SystemStatusPanel({ isAdmin, onClose, onLevel }: { isAdmin: boolean; onClose: () => void; onLevel: (l: Level) => void }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setBusy(true);
    const c = await runChecks(isAdmin);
    if (!alive.current) return;
    setChecks(c);
    onLevel(worst(c));
    setBusy(false);
  }, [isAdmin, onLevel]);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const report = () => {
    const store = (() => { try { return localStorage.getItem('gd_store_name') || ''; } catch { return ''; } })();
    const lines = (checks || []).map((c) => `${c.level === 'ok' ? '✅' : c.level === 'warn' ? '⚠️' : c.level === 'bad' ? '❌' : '➖'} ${c.label}: ${c.detail}`);
    return [`Diagnóstico de Ventra${store ? ` — ${store}` : ''}`, new Date().toLocaleString('es-AR'), ...lines, `Navegador: ${navigator.userAgent.slice(0, 120)}`].join('\n');
  };
  const sendWa = () => openExternal(`https://wa.me/${SUPPORT_WA}?text=${encodeURIComponent(`Hola, necesito ayuda con Ventra.\n\n${report()}`)}`);
  const copy = async () => { try { await navigator.clipboard.writeText(report()); toast.success('Diagnóstico copiado'); } catch { toast.error('No se pudo copiar'); } };

  const level = checks ? worst(checks) : 'ok';

  return createPortal(
    <div className="fixed inset-0 z-[9200] bg-slate-900/40 flex items-start justify-end p-3 sm:p-4 anim-veil" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="sys-title" onClick={(e) => e.stopPropagation()}
        className="keep-style w-full max-w-sm mt-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl anim-pop overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div>
            <p className="eyebrow">Estado del sistema</p>
            <h2 id="sys-title" className="text-[17px] font-bold text-slate-900 dark:text-slate-100 mt-0.5 flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${DOT[level]}`} />
              {checks ? TEXT[level] : 'Revisando…'}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={load} disabled={busy} aria-label="Volver a revisar" title="Volver a revisar" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
              <RefreshCw className={`w-4.5 h-4.5 ${busy ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="px-3 pb-2 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {!checks && <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
          {checks?.map((c) => (
            <div key={c.key} className="flex gap-3 px-2 py-2.5 rounded-xl">
              <span className="relative mt-0.5 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                <c.icon className="w-4 h-4" />
                <span className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${DOT[c.level]}`} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 leading-tight">{c.label}</p>
                <p className={`text-[12.5px] leading-snug mt-0.5 ${c.level === 'bad' ? 'text-red-600 font-semibold' : c.level === 'warn' ? 'text-amber-700 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>{c.detail}</p>
                {c.fix && <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-snug mt-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5">{c.fix}</p>}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <button onClick={sendWa} disabled={!checks} className="flex-1 h-9 rounded-xl bg-[#25D366] hover:brightness-95 text-white text-[13px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">
            <MessageCircle className="w-4 h-4" /> Pedir ayuda por WhatsApp
          </button>
          <button onClick={copy} disabled={!checks} title="Copiar el diagnóstico" aria-label="Copiar el diagnóstico" className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

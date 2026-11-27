import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  type YearReview as Review, fetchYearReview, MIN_TICKETS, MESES, DIAS_PLURAL, money, int, moneyShort, dayLong,
  peakHour, bestWeekday, bestMonth, growthPct, qtyLabel, paymentGroups, hourPhrase,
} from './yearReviewData';
import { openInviteStore } from '../referral/InviteStore';
import { useVentri, VentriImg, type VentriCara } from '../common/Ventri';
import { useAuthStore } from '../../stores/authStore';
import { reviewYear } from './yearReviewData';

/**
 * "Tu año en Ventra": el año del negocio en historias a pantalla completa, como las de Instagram,
 * y al final un resumen con un gracias. Tocar a la derecha avanza, a la izquierda vuelve,
 * mantener apretado pausa. Flechas, espacio y Esc también.
 */
const OPEN_EVENT = 'ventra:year-review';
export const openYearReview = (year?: number) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { year } }));

const STORY_MS = 7000;

const storeName = () => { try { return localStorage.getItem('gd_store_name') || ''; } catch { return ''; } };

/** Un número que sube de 0 al valor cuando la historia se muestra */
function useCountUp(target: number, run: boolean, ms = 1400) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) { setV(0); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

function Count({ value, run, format }: { value: number; run: boolean; format: (n: number) => string }) {
  const v = useCountUp(value, run);
  return <>{format(v)}</>;
}

/** Entra de abajo con un retraso, para que cada historia se arme de a partes */
function Rise({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  return <div className={`yr-rise ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>;
}

interface Story { key: string; bg: string; cara?: VentriCara; render: (on: boolean) => ReactNode }

export default function YearReview() {
  const [year, setYear] = useState<number | null>(null);
  const [data, setData] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const ventri = useVentri();

  useEffect(() => {
    const onOpen = (e: Event) => {
      const y = (e as CustomEvent).detail?.year ?? (new Date().getMonth() >= 10 ? new Date().getFullYear() : new Date().getFullYear() - 1);
      setYear(y); setI(0); setElapsed(0); setData(null); setError(null);
    };
    const onClose = () => { setYear(null); setData(null); };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener('ventra:year-review-close', onClose);
    return () => { window.removeEventListener(OPEN_EVENT, onOpen); window.removeEventListener('ventra:year-review-close', onClose); };
  }, []);

  useEffect(() => {
    if (year == null) return;
    let alive = true;
    fetchYearReview(year)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e?.response?.status === 403 ? 'Solo el dueño puede ver el resumen del año.' : 'No se pudo armar el resumen. Probá de nuevo en un rato.'); });
    return () => { alive = false; };
  }, [year]);

  const close = useCallback(() => { setYear(null); setData(null); }, []);
  const stories = data && data.tickets >= MIN_TICKETS && year != null ? buildStories(data, year, ventri) : [];
  const last = stories.length - 1;
  const next = useCallback(() => { setI((v) => Math.min(last, v + 1)); setElapsed(0); }, [last]);
  const prev = useCallback(() => { setI((v) => Math.max(0, v - 1)); setElapsed(0); }, []);

  // Avance solo, salvo en la última (la del cierre) o en pausa
  useEffect(() => {
    if (!stories.length || paused || i >= last) return;
    let raf = 0, t0 = performance.now() - elapsed;
    const tick = (t: number) => {
      const e = t - t0;
      if (e >= STORY_MS) { next(); return; }
      setElapsed(e);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, paused, stories.length, last]);

  useEffect(() => {
    if (year == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.stopImmediatePropagation(); e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.stopImmediatePropagation(); e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [year, close, next, prev]);

  const holdStart = useHold(setPaused);
  if (year == null) return null;

  const story = stories[i];

  return createPortal(
    <div data-year-review className="keep-style keep-animated fixed inset-0 z-[9600] bg-black/85 flex items-center justify-center anim-veil">
      <style>{CSS}</style>
      <div className="relative w-full h-full sm:w-[min(440px,calc((100vh-32px)*0.5625))] sm:h-[min(calc(100vh-32px),782px)] sm:rounded-[28px] overflow-hidden shadow-2xl text-white select-none"
        style={{ background: story?.bg || 'linear-gradient(160deg,#062e23,#0b5a43 60%,#17925f)' }}>

        {/* Barritas de progreso */}
        {stories.length > 0 && (
          <div className="absolute top-0 inset-x-0 z-20 flex gap-1 px-3 pt-3">
            {stories.map((s, k) => (
              <div key={s.key} className="h-[3px] flex-1 rounded-full bg-white/25 overflow-hidden">
                <div className="h-full bg-white rounded-full" style={{ width: k < i ? '100%' : k === i ? (i === last ? '100%' : `${(elapsed / STORY_MS) * 100}%`) : '0%' }} />
              </div>
            ))}
          </div>
        )}
        <div className="absolute top-6 inset-x-0 z-20 flex items-center justify-between px-4">
          <span className="text-[12px] font-bold tracking-wide text-white/80">Tu {year} en Ventra</span>
          <button onClick={close} aria-label="Cerrar" className="p-2 -mr-2 rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>

        {!data && !error && (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-white/80" />
            <p className="text-[15px] font-semibold text-white/85">Juntando tu año…</p>
          </div>
        )}
        {error && (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-[16px] font-semibold">{error}</p>
            <button onClick={close} className="h-10 px-5 rounded-full bg-white text-emerald-900 font-bold text-[14px]">Cerrar</button>
          </div>
        )}
        {data && data.tickets < MIN_TICKETS && (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
            {ventri && <VentriImg cara="mate" size={110} />}
            <p className="text-[22px] font-extrabold leading-tight">Todavía es poquito para un resumen</p>
            <p className="text-[14px] text-white/80">Con {MIN_TICKETS} ventas en {year} armamos tu año. Llevás {int(data.tickets)}.</p>
            <button onClick={close} className="mt-2 h-10 px-5 rounded-full bg-white text-emerald-900 font-bold text-[14px]">Cerrar</button>
          </div>
        )}

        {story && (
          <>
            {/* Zonas para tocar: izquierda vuelve, derecha avanza; mantener apretado pausa */}
            {i < last && (
              <>
                <button aria-label="Anterior" className="absolute left-0 top-14 bottom-0 w-1/3 z-10 cursor-default" onClick={prev} {...holdStart} />
                <button aria-label="Siguiente" className="absolute right-0 top-14 bottom-0 w-2/3 z-10 cursor-default" onClick={next} {...holdStart} />
              </>
            )}
            <div key={story.key} className={`relative h-full flex flex-col px-7 pt-20 ${ventri && story.cara ? 'pb-24' : 'pb-8'}`}>
              {story.render(true)}
              {ventri && story.cara && (
                <div className="absolute right-4 bottom-3 pointer-events-none"><VentriImg cara={story.cara} size={76} entra /></div>
              )}
            </div>
            {/* Flechas en la PC */}
            <button onClick={prev} disabled={i === 0} aria-label="Anterior"
              className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/20 hover:bg-black/35 items-center justify-center disabled:opacity-0">
              <ChevronLeft className="w-5 h-5" />
            </button>
            {i < last && (
              <button onClick={next} aria-label="Siguiente"
                className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/20 hover:bg-black/35 items-center justify-center">
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Tarjeta para abrirlo desde Reportes (PC y celular). Solo el dueño. */
export function YearReviewBanner({ className = '' }: { className?: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'ADMIN' || sessionStorage.getItem('admin_unlocked') === 'true' || localStorage.getItem('admin_unlocked') === 'true';
  if (!isAdmin) return null;
  const year = reviewYear();
  return (
    <button onClick={() => openYearReview(year)}
      className={`keep-style group w-full text-left rounded-2xl overflow-hidden text-white flex items-center gap-4 px-5 py-4 shadow-sm hover:shadow-md transition-shadow ${className}`}
      style={{ background: 'linear-gradient(120deg,#062e23 0%,#0b5a43 55%,#17925f 100%)' }}>
      <span className="text-[30px] font-black text-yellow-300 leading-none tabular-nums">{year}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-extrabold">Tu año en Ventra</span>
        <span className="block text-[12.5px] text-white/80 leading-snug">Tu mejor día, el producto estrella y la hora pico, en historias</span>
      </span>
      <ChevronRight className="w-5 h-5 text-white/70 group-hover:translate-x-0.5 transition-transform shrink-0" />
    </button>
  );
}

/** Mantener apretado pausa (como en Instagram) */
function useHold(setPaused: (v: boolean) => void) {
  const timer = useRef<number | undefined>(undefined);
  return {
    onPointerDown: () => { timer.current = window.setTimeout(() => setPaused(true), 220); },
    onPointerUp: () => { clearTimeout(timer.current); setPaused(false); },
    onPointerLeave: () => { clearTimeout(timer.current); setPaused(false); },
  };
}

// ── Las historias ─────────────────────────────────────────────────────

const BG = {
  verde: 'linear-gradient(160deg,#062e23 0%,#0b5a43 55%,#17925f 100%)',
  noche: 'linear-gradient(165deg,#0b1026 0%,#1e1b4b 55%,#4338ca 100%)',
  sol: 'linear-gradient(160deg,#7c2d12 0%,#c2410c 50%,#f59e0b 100%)',
  uva: 'linear-gradient(160deg,#3b0764 0%,#6d28d9 55%,#c026d3 100%)',
  mar: 'linear-gradient(160deg,#082f49 0%,#0369a1 55%,#06b6d4 100%)',
  rosa: 'linear-gradient(160deg,#4c0519 0%,#be123c 55%,#fb7185 100%)',
};

const Eyebrow = ({ children }: { children: ReactNode }) => (
  <p className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-white/70">{children}</p>
);

function buildStories(r: Review, year: number, ventri: boolean): Story[] {
  const name = storeName();
  const growth = growthPct(r);
  const peak = peakHour(r);
  const wd = bestWeekday(r);
  const month = bestMonth(r);
  const top = r.topProducts[0];
  const pays = paymentGroups(r);
  const maxMonth = Math.max(1, ...r.months.map((m) => m.total));
  const hours = Array.from({ length: 24 }, (_, h) => r.hours.find((x) => x.hour === h)?.tickets || 0);
  const firstHour = Math.max(0, hours.findIndex((t) => t > 0));
  const lastHour = 23 - [...hours].reverse().findIndex((t) => t > 0);
  const hourSlice = hours.slice(firstHour, lastHour + 1);
  const maxHour = Math.max(1, ...hourSlice);
  const unfinished = new Date(r.to).getMonth() < 11 || new Date(r.to).getDate() < 31;

  const list: Story[] = [];

  list.push({
    key: 'portada', bg: BG.verde, cara: 'picara',
    render: () => (
      <div className="flex-1 flex flex-col justify-center">
        <Rise><Eyebrow>{name || 'Tu negocio'}</Eyebrow></Rise>
        <Rise delay={150}><p className="mt-3 text-[64px] leading-[0.9] font-black tracking-tight text-yellow-300">{year}</p></Rise>
        <Rise delay={300}><p className="mt-3 text-[30px] leading-[1.05] font-extrabold">Así fue tu año<br />detrás del mostrador</p></Rise>
        <Rise delay={600}><p className="mt-6 text-[14px] text-white/75">{unfinished ? `Con todo lo vendido hasta hoy. ` : ''}Tocá para seguir →</p></Rise>
      </div>
    ),
  });

  list.push({
    key: 'total', bg: BG.noche, cara: 'sorprendida',
    render: (on) => (
      <div className="flex-1 flex flex-col justify-center">
        <Rise><Eyebrow>Este año vendiste</Eyebrow></Rise>
        <Rise delay={150}><p className="mt-3 text-[46px] leading-none font-black tracking-tight tabular-nums"><Count value={r.total} run={on} format={money} /></p></Rise>
        <Rise delay={500}><p className="mt-4 text-[20px] font-bold">en <span className="text-yellow-300"><Count value={r.tickets} run={on} format={int} /></span> ventas</p></Rise>
        {growth != null && (
          <Rise delay={900}>
            <span className={`mt-6 inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[14px] font-extrabold ${growth >= 0 ? 'bg-emerald-400 text-emerald-950' : 'bg-white/15 text-white'}`}>
              {growth >= 0 ? `▲ ${growth}% más que en ${year - 1}` : `${growth}% que en ${year - 1}: ¡el que viene es tuyo!`}
            </span>
          </Rise>
        )}
        <Rise delay={1200}><p className="mt-6 text-[14px] text-white/75">Ticket promedio: <b className="text-white">{money(r.avgTicket)}</b></p></Rise>
      </div>
    ),
  });

  list.push({
    key: 'dias', bg: BG.sol, cara: 'mate',
    render: (on) => (
      <div className="flex-1 flex flex-col justify-center">
        <Rise><Eyebrow>Levantaste la persiana</Eyebrow></Rise>
        <Rise delay={150}><p className="mt-2 text-[80px] leading-none font-black tabular-nums"><Count value={r.daysOpen} run={on} format={int} /></p></Rise>
        <Rise delay={300}><p className="text-[24px] font-extrabold">días</p></Rise>
        {r.bestDay && (
          <Rise delay={800}>
            <div className="mt-8 rounded-2xl bg-black/20 p-4">
              <p className="text-[12px] font-bold uppercase tracking-wider text-white/70">Tu día récord</p>
              <p className="mt-1 text-[20px] font-extrabold">{dayLong(r.bestDay.day)}</p>
              <p className="text-[15px] text-white/85">{money(r.bestDay.total)} en {int(r.bestDay.tickets)} ventas</p>
            </div>
          </Rise>
        )}
      </div>
    ),
  });

  if (top) {
    list.push({
      key: 'estrella', bg: BG.uva, cara: 'guino',
      render: () => (
        <div className="flex-1 flex flex-col justify-center">
          <Rise><Eyebrow>Tu producto estrella</Eyebrow></Rise>
          {top.image && <Rise delay={100}><img src={top.image} alt="" className="mt-4 w-24 h-24 rounded-2xl object-cover bg-white shadow-xl" /></Rise>}
          <Rise delay={200}><p className="mt-4 text-[32px] leading-[1.05] font-black">{top.name}</p></Rise>
          <Rise delay={450}><p className="mt-2 text-[18px] font-bold text-yellow-300">{qtyLabel(top.qty, top.unit)} vendidas</p></Rise>
          {r.topProducts.length > 1 && (
            <Rise delay={850}>
              <ol className="mt-7 space-y-2">
                {r.topProducts.slice(1, 5).map((p, k) => (
                  <li key={p.id} className="flex items-baseline gap-3 text-[14.5px]">
                    <span className="w-5 text-white/60 font-bold tabular-nums">{k + 2}</span>
                    <span className="flex-1 min-w-0 truncate font-semibold">{p.name}</span>
                    <span className="text-white/70 tabular-nums">{qtyLabel(p.qty, p.unit).replace(' unidades', ' u.')}</span>
                  </li>
                ))}
              </ol>
            </Rise>
          )}
          <Rise delay={1100}><p className="mt-6 text-[13px] text-white/70">{int(r.distinctProducts)} productos distintos pasaron por tu caja{r.unitsSold ? ` y ${int(r.unitsSold)} unidades salieron por la puerta` : ''}.</p></Rise>
        </div>
      ),
    });
  }

  if (peak) {
    list.push({
      key: 'hora', bg: BG.mar,
      render: () => (
        <div className="flex-1 flex flex-col justify-center">
          <Rise><Eyebrow>La hora pico</Eyebrow></Rise>
          <Rise delay={150}><p className="mt-2 text-[56px] leading-none font-black">{peak.hour} h</p></Rise>
          <Rise delay={300}><p className="mt-2 text-[22px] font-extrabold">{hourPhrase(peak.hour)}</p></Rise>
          <Rise delay={500}>
            <div className="mt-7 h-32 flex items-end gap-[3px]">
              {hourSlice.map((t, k) => (
                <div key={k} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`w-full rounded-t-[3px] yr-grow ${firstHour + k === peak.hour ? 'bg-yellow-300' : 'bg-white/35'}`}
                    style={{ height: `${Math.max(3, (t / maxHour) * 112)}px`, animationDelay: `${600 + k * 30}ms` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-white/60 tabular-nums"><span>{firstHour} h</span><span>{lastHour} h</span></div>
          </Rise>
          {wd && <Rise delay={1100}><p className="mt-6 text-[16px] font-semibold">Y el día más fuerte: <b className="text-yellow-300">{DIAS_PLURAL[wd.weekday]}</b></p></Rise>}
        </div>
      ),
    });
  }

  if (r.months.length > 1 && month) {
    list.push({
      key: 'meses', bg: BG.verde, cara: 'pila',
      render: () => (
        <div className="flex-1 flex flex-col justify-center">
          <Rise><Eyebrow>Mes a mes</Eyebrow></Rise>
          <Rise delay={150}><p className="mt-2 text-[28px] leading-tight font-black">El mejor fue <span className="text-yellow-300 capitalize">{MESES[month.month - 1]}</span></p></Rise>
          <Rise delay={300}><p className="text-[15px] text-white/80">con {moneyShort(month.total)} vendidos</p></Rise>
          <Rise delay={500}>
            <div className="mt-7 h-40 flex items-end gap-1.5">
              {Array.from({ length: 12 }, (_, k) => {
                const m = r.months.find((x) => x.month === k + 1);
                return (
                  <div key={k} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className={`w-full rounded-t-md yr-grow ${m && m.month === month.month ? 'bg-yellow-300' : 'bg-white/35'}`}
                      style={{ height: `${m ? Math.max(4, (m.total / maxMonth) * 136) : 2}px`, animationDelay: `${600 + k * 60}ms` }} />
                    <span className="text-[10px] font-bold text-white/60 uppercase">{MESES[k][0]}</span>
                  </div>
                );
              })}
            </div>
          </Rise>
        </div>
      ),
    });
  }

  list.push({
    key: 'gente', bg: BG.rosa, cara: 'sorprendida',
    render: () => (
      <div className="flex-1 flex flex-col justify-center gap-5">
        <Rise><Eyebrow>Momentos del año</Eyebrow></Rise>
        {r.topClient && (
          <Rise delay={150}>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-[12px] font-bold uppercase tracking-wider text-white/70">Tu cliente más fiel</p>
              <p className="mt-1 text-[22px] font-extrabold truncate">{r.topClient.name}</p>
              <p className="text-[14px] text-white/85">Volvió {int(r.topClient.tickets)} veces. ¡Merece un regalito!</p>
            </div>
          </Rise>
        )}
        <Rise delay={450}>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-[12px] font-bold uppercase tracking-wider text-white/70">Tu venta más grande</p>
            <p className="mt-1 text-[28px] font-black tabular-nums">{money(r.biggestTicket)}</p>
          </div>
        </Rise>
        {pays.length > 0 && (
          <Rise delay={750}>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-[12px] font-bold uppercase tracking-wider text-white/70 mb-2.5">Cómo te pagaron</p>
              <div className="flex h-3 rounded-full overflow-hidden bg-white/10">
                {pays.map((p, k) => <div key={p.label} style={{ width: `${p.pct}%`, background: PAY_COLORS[k % PAY_COLORS.length] }} />)}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                {pays.slice(0, 4).map((p, k) => (
                  <span key={p.label} className="text-[12.5px] font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: PAY_COLORS[k % PAY_COLORS.length] }} />{p.label} {p.pct}%
                  </span>
                ))}
              </div>
            </div>
          </Rise>
        )}
      </div>
    ),
  });

  list.push({ key: 'final', bg: BG.verde, cara: 'guino', render: () => <ClosingStory r={r} year={year} ventri={ventri} onClose={() => window.dispatchEvent(new Event('ventra:year-review-close'))} /> });
  return list;
}

const PAY_COLORS = ['#fde047', '#ffffff', '#5eead4', '#c4b5fd', '#fca5a5', '#94a3b8'];

/** Última historia: el año en cuatro números y un gracias (sin compartir: el dueño lo pidió así) */
function ClosingStory({ r, year, ventri, onClose }: { r: Review; year: number; ventri: boolean; onClose: () => void }) {
  const top = r.topProducts[0];
  const peak = peakHour(r);
  const tiles: [string, string][] = [
    ['Vendiste', moneyShort(r.total)],
    ['Ventas', int(r.tickets)],
    ['Días abiertos', int(r.daysOpen)],
    ['Hora pico', peak ? `${peak.hour} h` : '—'],
  ];
  return (
    <div className="flex-1 min-h-0 flex flex-col justify-center">
      <Rise><Eyebrow>Gracias por este {year}</Eyebrow></Rise>
      <Rise delay={120}><p className="mt-2 text-[30px] leading-[1.05] font-black">Un año enorme{storeName() ? <><br /><span className="text-yellow-300">{storeName()}</span></> : null}</p></Rise>
      <Rise delay={300}>
        <div className="mt-6 grid grid-cols-2 gap-2.5">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-black/20 px-3.5 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/65">{label}</p>
              <p className="mt-0.5 text-[22px] font-black tabular-nums leading-tight">{value}</p>
            </div>
          ))}
        </div>
      </Rise>
      {top && <Rise delay={500}><p className="mt-4 text-[14px] text-white/85">Y lo que más salió: <b className="text-white">{top.name}</b>.</p></Rise>}
      <Rise delay={700}><p className="mt-2 text-[14px] text-white/75">¡Que el {year + 1} venga todavía mejor!</p></Rise>
      <Rise delay={900}>
        <button onClick={onClose} className="mt-7 w-full h-12 rounded-full bg-yellow-300 hover:bg-yellow-200 text-emerald-950 text-[15px] font-extrabold">
          {ventri ? '¡Gracias, Ventri!' : 'Cerrar'}
        </button>
        <button onClick={() => { onClose(); openInviteStore(); }}
          className="mt-3 w-full text-center text-[12.5px] font-semibold text-white/80 hover:text-white underline underline-offset-2">
          ¿Conocés otro comercio? Invitalo y ganá un mes gratis
        </button>
      </Rise>
    </div>
  );
}

const CSS = `
.yr-rise { animation: yr-rise 600ms cubic-bezier(0.22, 1, 0.36, 1) backwards; }
@keyframes yr-rise { from { opacity: 0; transform: translateY(18px); } }
.yr-grow { transform-origin: bottom; animation: yr-grow 700ms cubic-bezier(0.22, 1, 0.36, 1) backwards; }
@keyframes yr-grow { from { transform: scaleY(0); } }
@media (prefers-reduced-motion: reduce) { .yr-rise, .yr-grow { animation: none; } }
`;

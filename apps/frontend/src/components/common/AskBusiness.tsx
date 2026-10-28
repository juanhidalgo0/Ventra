import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Loader2, SendHorizontal, X } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { usePlanStore } from '../../stores/planStore';
import { useBusinessStore, type BusinessProfile } from '../../stores/businessStore';
import AskWhatsApp from './AskWhatsApp';

/** Lo abre cualquier pantalla (por ejemplo la paleta Ctrl+K). whatsapp: abre directo la parte de WhatsApp. */
export const openAskBusiness = (opts: { whatsapp?: boolean } = {}) => window.dispatchEvent(new CustomEvent('ventra:ask-business', { detail: opts }));

/** Dueño o encargado, en cualquier plan: la IA busca en ventas, stock, turnos o pedidos según lo que tenga el comercio */
export function useCanAskBusiness() {
  const role = useAuthStore((s) => s.user?.role) || '';
  return ['ADMIN', 'SUPERVISOR'].includes(role);
}

/** Los límites de preguntas (ver LIMITS/DAILY de ask en firebase/functions/ai.js) */
export const ASK_LIMITS = { daily: 30, monthly: 300 };

/** Ejemplos según el plan y el rubro (los mismos de la bienvenida por WhatsApp, ver ai-agent.js) */
export function useAskSuggestions(): string[] {
  const plan = usePlanStore((s) => s.plan);
  const features = usePlanStore((s) => s.features);
  const profile = useBusinessStore((s) => s.profile) as BusinessProfile;
  if (plan === 'agenda' || plan === 'agenda_pro' || (features && !features.caja && !features.tienda && features.agenda)) {
    return ['¿Qué turnos tengo mañana?', '¿Quién faltó esta semana?', '¿Cuánto cobré de señas este mes?', '¿Qué día tengo más reservas?', '¿Cómo bloqueo un día en la agenda?'];
  }
  if (plan === 'tienda' || (features && !features.caja && features.tienda)) {
    return ['¿Cuántos pedidos entraron hoy?', '¿Qué es lo más pedido online?', '¿Tengo pedidos sin atender?', '¿Qué turnos tengo mañana?'];
  }
  if (profile === 'GASTRONOMIA') return ['¿Cuánto vendí hoy?', '¿Qué es lo más pedido esta semana?', '¿A qué hora vendo más?', '¿Cómo viene la caja?', '¿Qué productos me dejan menos ganancia?'];
  if (profile === 'DISTRIBUIDORA') return ['¿Qué pedidos tengo para el reparto de mañana?', '¿Qué clientes dejaron de pedir?', '¿Quién me debe más?', '¿Qué tengo que reponer?', '¿Cuánto les debo a los proveedores?'];
  if (profile === 'IMPRENTA') return ['¿Qué encargos tengo para hoy?', '¿Hay encargos atrasados?', '¿Cuánto me falta cobrar de encargos?', '¿Cuánto vendí esta semana?'];
  if ((profile as string) === 'NUTRICION') return ['¿Qué turnos tengo mañana?', '¿Quién faltó esta semana?', '¿Cuánto cobré online este mes?', '¿Cómo cargo una consulta?'];
  return ['¿Cuánto vendí esta semana contra la pasada?', '¿Qué productos me dejan más ganancia este mes?', '¿Quién me debe más?', '¿Qué productos no se venden hace un mes?', '¿Qué día de la semana vendo más?'];
}

/** **negrita** dentro de un renglón */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>))}</>;
}

/** Respuesta de la IA: párrafos y listas con guiones */
export function AnswerText({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^([-•*]|\d+[.)])\s+/.test(line);
    const last = blocks[blocks.length - 1];
    const clean = item ? line.replace(/^([-•*]|\d+[.)])\s+/, '') : line;
    if (last && last.list === item && item) last.lines.push(clean);
    else blocks.push({ list: item, lines: [clean] });
  }
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => (b.list ? (
        <ul key={i} className="list-disc pl-5 space-y-0.5">{b.lines.map((l, j) => <li key={j}><Inline text={l} /></li>)}</ul>
      ) : <p key={i}><Inline text={b.lines[0]} /></p>))}
    </div>
  );
}

/**
 * "Preguntale a tu negocio" (ver /ai/ask): el dueño o el encargado pregunta con sus palabras y la
 * IA busca los datos que necesita (ventas, stock, turnos, pedidos) y responde. Recuerda las dos
 * preguntas anteriores, para seguir la charla ("¿y ayer?").
 */
export default function AskBusiness({ compact = false, whatsappOpen = false }: { compact?: boolean; whatsappOpen?: boolean }) {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [leftToday, setLeftToday] = useState<number | null>(null);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const suggestions = useAskSuggestions();

  const ask = async (q = question) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true); setError(''); setAnswer(''); setAsked(text); setQuestion('');
    try {
      const { data } = await api.post('/ai/ask', { question: text, history }, { timeout: 120000, silent: true } as any);
      const a = String(data?.answer || 'No encontré una respuesta.');
      setAnswer(a);
      setHistory((h) => [...h, { q: text, a }].slice(-2));
      if (typeof data?.questionsLeftToday === 'number') setLeftToday(data.questionsLeftToday);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'No se pudo responder. Revisá internet y probá de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white ${compact ? 'p-3.5' : 'p-4'}`}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-7 h-7 rounded-lg bg-violet-600 text-white flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4" /></span>
        <div>
          <p className="text-[13.5px] font-bold text-slate-900 leading-tight">Preguntale a tu negocio</p>
          <p className="text-[11.5px] text-slate-500 leading-tight">Lo que quieras, con tus palabras: responde con tus números y te explica cómo usar Ventra</p>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} disabled={busy}
          placeholder={asked ? 'Seguí preguntando…' : 'Escribí tu pregunta…'}
          className="flex-1 min-w-0 h-10 px-3.5 rounded-xl border border-slate-300 bg-white text-[13.5px] outline-none focus:border-violet-500" />
        <button type="submit" disabled={busy || !question.trim()} aria-label="Preguntar"
          className="h-10 px-3.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 flex items-center gap-1.5 text-[13px] font-semibold shrink-0">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}{!compact && 'Preguntar'}
        </button>
      </form>
      {!asked && (
        <>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {suggestions.slice(0, compact ? 3 : 5).map((s) => (
              <button key={s} type="button" onClick={() => ask(s)} className="px-2.5 py-1 rounded-full bg-white border border-violet-200 text-[11.5px] text-violet-800 hover:bg-violet-50">{s}</button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-slate-500">Tenés {ASK_LIMITS.daily} preguntas por día ({ASK_LIMITS.monthly} por mes).</p>
        </>
      )}
      {asked && (
        <div className="mt-3 rounded-xl bg-white border border-slate-200 px-3.5 py-3 text-[13px] text-slate-800 leading-relaxed">
          <p className="text-[11.5px] font-semibold text-slate-500 mb-1.5">{asked}</p>
          {busy ? <p className="text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Mirando tus números…</p>
            : error ? <p className="text-rose-700">{error}</p>
            : <AnswerText text={answer} />}
        </div>
      )}
      {leftToday !== null && leftToday <= 5 && !busy && (
        <p className="mt-2 text-[11.5px] text-slate-500">{leftToday > 0 ? `Te ${leftToday === 1 ? 'queda 1 pregunta' : `quedan ${leftToday} preguntas`} por hoy.` : 'Por hoy no quedan preguntas: mañana podés seguir.'}</p>
      )}
      <AskWhatsApp defaultOpen={whatsappOpen} />
    </div>
  );
}

/** Botón fijo de la barra de arriba y panel lateral: a mano desde cualquier pantalla del dueño */
export function AskBusinessButton() {
  const [open, setOpen] = useState<false | { whatsapp?: boolean }>(false);
  const can = useCanAskBusiness();
  useEffect(() => {
    const onOpen = (e: Event) => setOpen({ ...((e as CustomEvent).detail || {}) });
    window.addEventListener('ventra:ask-business', onOpen);
    return () => window.removeEventListener('ventra:ask-business', onOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!can) return null;
  return (
    <>
      <button onClick={() => setOpen({})} title="Preguntale a tu negocio: con tus palabras, responde con tus números"
        className="flex items-center gap-1.5 h-8 px-2.5 lg:px-3 rounded-full whitespace-nowrap bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-800 text-[12px] font-semibold transition-colors">
        <Sparkles className="w-3.5 h-3.5" /> <span className="hidden lg:inline">Preguntale a tu negocio</span>
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[80] bg-slate-900/30 flex justify-end" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md h-full bg-white shadow-2xl p-4 overflow-y-auto">
            <div className="flex justify-end mb-1">
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" aria-label="Cerrar"><X className="w-5 h-5" /></button>
            </div>
            <AskBusiness whatsappOpen={!!open.whatsapp} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

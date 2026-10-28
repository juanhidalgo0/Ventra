import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Loader2, SendHorizontal, X } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { usePlanStore } from '../../stores/planStore';
import { useBusinessStore, isConsultorio } from '../../stores/businessStore';
import AskWhatsApp from './AskWhatsApp';

/** Lo abre cualquier pantalla (por ejemplo la paleta Ctrl+K) */
export const openAskBusiness = () => window.dispatchEvent(new Event('ventra:ask-business'));

/** Solo para el dueño o encargado de un comercio con caja (las consultas son de ventas y stock) */
export function useCanAskBusiness() {
  const role = useAuthStore((s) => s.user?.role) || '';
  const caja = usePlanStore((s) => s.features?.caja) !== false;
  const consultorio = isConsultorio(useBusinessStore((s) => s.profile));
  return ['ADMIN', 'SUPERVISOR'].includes(role) && caja && !consultorio;
}

const SUGGESTIONS = [
  '¿Cuánto vendí esta semana contra la pasada?',
  '¿Qué productos me dejan más ganancia este mes?',
  '¿Quién me debe más?',
  '¿Qué productos no se venden hace un mes?',
  '¿Qué día de la semana vendo más?',
];

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
 * "Preguntale a tu negocio" (ver /ai/ask): el dueño pregunta con sus palabras y responde con
 * los números del sistema. La IA no ve la base: elige consultas fijas que corre la PC.
 */
export default function AskBusiness({ compact = false }: { compact?: boolean }) {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [leftToday, setLeftToday] = useState<number | null>(null);
  // Vincular el WhatsApp es cosa del dueño
  const isOwner = useAuthStore((s) => s.user?.role) === 'ADMIN';

  const ask = async (q = question) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true); setError(''); setAnswer(''); setAsked(text); setQuestion('');
    try {
      const { data } = await api.post('/ai/ask', { question: text }, { timeout: 90000, silent: true } as any);
      setAnswer(String(data?.answer || 'No encontré una respuesta.'));
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
          <p className="text-[11.5px] text-slate-500 leading-tight">Con tus palabras: responde con los números de tu sistema</p>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} disabled={busy}
          placeholder="Ej.: ¿cuánto vendí de gaseosas este mes?"
          className="flex-1 min-w-0 h-10 px-3.5 rounded-xl border border-slate-300 bg-white text-[13.5px] outline-none focus:border-violet-500" />
        <button type="submit" disabled={busy || !question.trim()} aria-label="Preguntar"
          className="h-10 px-3.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 flex items-center gap-1.5 text-[13px] font-semibold shrink-0">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}{!compact && 'Preguntar'}
        </button>
      </form>
      {!asked && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {SUGGESTIONS.slice(0, compact ? 3 : 5).map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} className="px-2.5 py-1 rounded-full bg-white border border-violet-200 text-[11.5px] text-violet-800 hover:bg-violet-50">{s}</button>
          ))}
        </div>
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
      {isOwner && <AskWhatsApp />}
    </div>
  );
}

/** Botón fijo de la barra de arriba y panel lateral: a mano desde cualquier pantalla del dueño */
export function AskBusinessButton() {
  const [open, setOpen] = useState(false);
  const can = useCanAskBusiness();
  useEffect(() => {
    const onOpen = () => setOpen(true);
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
      <button onClick={() => setOpen(true)} title="Preguntale a tu negocio: con tus palabras, responde con tus números"
        className="flex items-center gap-1.5 h-8 px-2.5 lg:px-3 rounded-full whitespace-nowrap bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-800 text-[12px] font-semibold transition-colors">
        <Sparkles className="w-3.5 h-3.5" /> <span className="hidden lg:inline">Preguntale a tu negocio</span>
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[80] bg-slate-900/30 flex justify-end" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md h-full bg-white shadow-2xl p-4 overflow-y-auto">
            <div className="flex justify-end mb-1">
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" aria-label="Cerrar"><X className="w-5 h-5" /></button>
            </div>
            <AskBusiness />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

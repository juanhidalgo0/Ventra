import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircleQuestion, Loader2, SendHorizontal, X } from 'lucide-react';
import api from '../../../services/api';
import { AnswerText } from '../AskBusiness';
import { lockShortcuts } from '../../../utils/shortcutLock';

type Msg = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = ['¿Cómo cierro la caja?', '¿Cómo cargo una promo 2x1?', '¿Cómo creo un usuario para un empleado?'];

/** Links de la respuesta, clickeables (el soporte por WhatsApp) */
function withLinks(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((p, i) => (/^https?:\/\//.test(p)
    ? <a key={i} href={p.replace(/[.,)]+$/, '')} target="_blank" rel="noreferrer" className="text-rose-700 underline break-all">{p}</a>
    : <AnswerText key={i} text={p} />));
}

/**
 * Ayuda adentro del sistema (ver /ai/help): responde cómo se hace algo en Ventra, con la guía de
 * pantallas y la base de conocimiento. Sabe en qué pantalla está la persona.
 */
export default function HelpChat({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  // Mientras está abierta, los atajos de la caja (F1…F12) no se disparan
  useEffect(() => lockShortcuts(), []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const send = async (q = text) => {
    const content = q.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next); setText(''); setBusy(true); setError('');
    try {
      const { data } = await api.post('/ai/help', { messages: next, screen: pathname }, { timeout: 60000, silent: true } as any);
      setMessages([...next, { role: 'assistant', content: String(data?.answer || '') }]);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'No pude responder. Revisá internet y probá de nuevo.');
      setMessages(messages);
      setText(content);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="keep-style fixed bottom-5 right-5 z-[9000] w-[min(380px,calc(100vw-2.5rem))] h-[min(560px,calc(100vh-2.5rem))] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.45)] flex flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <span className="w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0"><MessageCircleQuestion className="w-[18px] h-[18px]" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 leading-tight">Preguntale a la ayuda</p>
          <p className="text-[11.5px] text-slate-500 leading-tight">Cómo se hace cualquier cosa en Ventra</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Cerrar"><X className="w-5 h-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-[13px] leading-relaxed">
        {!messages.length && (
          <div className="space-y-2">
            <p className="text-slate-600 dark:text-slate-300">Escribí qué querés hacer y te digo los pasos.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="px-2.5 py-1 rounded-full bg-rose-50 border border-rose-200 text-[12px] text-rose-800 hover:bg-rose-100">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (m.role === 'user' ? (
          <div key={i} className="flex justify-end"><p className="max-w-[85%] rounded-2xl rounded-br-md bg-rose-600 text-white px-3 py-2">{m.content}</p></div>
        ) : (
          <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-3 py-2">{withLinks(m.content)}</div>
        )))}
        {busy && <p className="text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando…</p>}
        {error && <p className="text-rose-700">{error}</p>}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 p-3 border-t border-slate-100 dark:border-slate-800">
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} disabled={busy} placeholder="Ej.: ¿cómo anulo una venta?"
          className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-[13.5px] outline-none focus:border-rose-500" />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Enviar" className="w-10 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 flex items-center justify-center shrink-0">
          <SendHorizontal className="w-4 h-4" />
        </button>
      </form>
    </div>,
    document.body,
  );
}

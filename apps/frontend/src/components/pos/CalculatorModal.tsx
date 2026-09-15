import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Delete, Copy, Check, Calculator } from 'lucide-react';
import toast from 'react-hot-toast';

interface CalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CalculatorModal({ isOpen, onClose }: CalculatorModalProps) {
  const [display, setDisplay] = useState('0');
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [waitingForNewValue, setWaitingForNewValue] = useState(false);
  const [copied, setCopied] = useState(false);
  const [equation, setEquation] = useState('');

  const clearAll = useCallback(() => {
    setDisplay('0');
    setPrevValue(null);
    setOperation(null);
    setWaitingForNewValue(false);
    setEquation('');
  }, []);

  const clearEntry = useCallback(() => {
    setDisplay('0');
  }, []);

  const inputDigit = useCallback((digit: string) => {
    if (waitingForNewValue) {
      setDisplay(digit);
      setWaitingForNewValue(false);
    } else {
      setDisplay(prev => (prev === '0' ? digit : prev + digit));
    }
  }, [waitingForNewValue]);

  const inputDecimal = useCallback(() => {
    if (waitingForNewValue) {
      setDisplay('0.');
      setWaitingForNewValue(false);
      return;
    }
    if (!display.includes('.')) {
      setDisplay(prev => prev + '.');
    }
  }, [display, waitingForNewValue]);

  const handleBackspace = useCallback(() => {
    if (waitingForNewValue) return;
    setDisplay(prev => {
      if (prev.length <= 1 || (prev.length === 2 && prev.startsWith('-'))) {
        return '0';
      }
      return prev.slice(0, -1);
    });
  }, [waitingForNewValue]);

  const toggleSign = useCallback(() => {
    setDisplay(prev => {
      const val = parseFloat(prev);
      if (val === 0) return '0';
      return (val * -1).toString();
    });
  }, []);

  const calculate = (a: number, b: number, op: string): number => {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '×':
      case '*': return a * b;
      case '÷':
      case '/': return b !== 0 ? a / b : 0;
      default: return b;
    }
  };

  const handleOperator = useCallback((nextOp: string) => {
    const inputValue = parseFloat(display);

    if (prevValue === null) {
      setPrevValue(inputValue);
      setEquation(`${inputValue} ${nextOp}`);
    } else if (operation) {
      if (waitingForNewValue) {
        setOperation(nextOp);
        setEquation(`${prevValue} ${nextOp}`);
        return;
      }
      const result = calculate(prevValue, inputValue, operation);
      setPrevValue(result);
      setDisplay(String(Number(result.toFixed(6))));
      setEquation(`${Number(result.toFixed(6))} ${nextOp}`);
    }

    setWaitingForNewValue(true);
    setOperation(nextOp);
  }, [display, prevValue, operation, waitingForNewValue]);

  const handleEquals = useCallback(() => {
    const inputValue = parseFloat(display);

    if (prevValue !== null && operation) {
      const result = calculate(prevValue, inputValue, operation);
      const formatted = Number(result.toFixed(6));
      setEquation(`${prevValue} ${operation} ${inputValue} =`);
      setDisplay(String(formatted));
      setPrevValue(null);
      setOperation(null);
      setWaitingForNewValue(true);
    }
  }, [display, prevValue, operation]);

  const handleCopy = () => {
    navigator.clipboard.writeText(display);
    setCopied(true);
    toast.success('Copiado al portapapeles');
    setTimeout(() => setCopied(false), 2000);
  };

  // Keyboard support
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        inputDigit(e.key);
      } else if (e.key === '.' || e.key === ',') {
        e.preventDefault();
        inputDecimal();
      } else if (e.key === '+' || e.key === '-') {
        e.preventDefault();
        handleOperator(e.key);
      } else if (e.key === '*') {
        e.preventDefault();
        handleOperator('×');
      } else if (e.key === '/') {
        e.preventDefault();
        handleOperator('÷');
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        handleEquals();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        clearAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, inputDigit, inputDecimal, handleOperator, handleEquals, handleBackspace, clearAll, onClose]);

  if (!isOpen) return null;

  const perfMode = typeof window !== 'undefined' && localStorage.getItem('performance_mode') === 'true';
  const MotionDiv = (perfMode ? 'div' : motion.div) as any;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <MotionDiv
          {...(perfMode ? {} : { initial: { opacity: 0, scale: 0.95, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.95, y: 8 }, transition: { duration: 0.15 } })}
          onClick={(e) => e.stopPropagation()}
          className="relative bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-[330px] overflow-hidden flex flex-col font-sans"
        >
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Calculator className="w-4 h-4" />
              </div>
              <span className="text-xs font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">Calculadora</span>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* OLED / Screen Display */}
          <div className="m-3 p-4 bg-slate-950 rounded-2xl border border-slate-800/90 shadow-inner flex flex-col items-end justify-between min-h-[95px] select-all relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-xl pointer-events-none" />
            <span className="text-xs font-mono font-medium text-slate-400 min-h-[16px] truncate max-w-full">
              {equation || '\u00A0'}
            </span>
            <div className="flex items-baseline justify-between w-full mt-1.5 gap-2">
              <button
                onClick={handleCopy}
                title="Copiar resultado"
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors cursor-pointer shrink-0"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
              <span className="text-3xl sm:text-[34px] font-mono font-black text-white tracking-tight break-all text-right leading-none">
                {display}
              </span>
            </div>
          </div>

          {/* Keypad */}
          <div className="px-3 pb-3 grid grid-cols-4 gap-2">
            {/* Row 1 */}
            <button
              onClick={clearAll}
              className="h-11 rounded-xl bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 font-black text-xs uppercase tracking-wider transition-all active:scale-95 border border-rose-200 dark:border-rose-900/50 cursor-pointer"
            >
              AC
            </button>
            <button
              onClick={clearEntry}
              className="h-11 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 border border-slate-200 dark:border-slate-700 cursor-pointer"
            >
              C
            </button>
            <button
              onClick={handleBackspace}
              className="h-11 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold transition-all active:scale-95 border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer"
              title="Borrar último dígito"
            >
              <Delete className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleOperator('÷')}
              className={`h-11 rounded-xl text-base font-black transition-all active:scale-95 border cursor-pointer ${
                operation === '÷'
                  ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/30'
                  : 'bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border-rose-200/70 dark:border-rose-800/60'
              }`}
            >
              ÷
            </button>

            {/* Row 2 */}
            <button
              onClick={() => inputDigit('7')}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              7
            </button>
            <button
              onClick={() => inputDigit('8')}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              8
            </button>
            <button
              onClick={() => inputDigit('9')}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              9
            </button>
            <button
              onClick={() => handleOperator('×')}
              className={`h-11 rounded-xl text-base font-black transition-all active:scale-95 border cursor-pointer ${
                operation === '×'
                  ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/30'
                  : 'bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border-rose-200/70 dark:border-rose-800/60'
              }`}
            >
              ×
            </button>

            {/* Row 3 */}
            <button
              onClick={() => inputDigit('4')}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              4
            </button>
            <button
              onClick={() => inputDigit('5')}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              5
            </button>
            <button
              onClick={() => inputDigit('6')}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              6
            </button>
            <button
              onClick={() => handleOperator('-')}
              className={`h-11 rounded-xl text-base font-black transition-all active:scale-95 border cursor-pointer ${
                operation === '-'
                  ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/30'
                  : 'bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border-rose-200/70 dark:border-rose-800/60'
              }`}
            >
              -
            </button>

            {/* Row 4 */}
            <button
              onClick={() => inputDigit('1')}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              1
            </button>
            <button
              onClick={() => inputDigit('2')}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              2
            </button>
            <button
              onClick={() => inputDigit('3')}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              3
            </button>
            <button
              onClick={() => handleOperator('+')}
              className={`h-11 rounded-xl text-base font-black transition-all active:scale-95 border cursor-pointer ${
                operation === '+'
                  ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/30'
                  : 'bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border-rose-200/70 dark:border-rose-800/60'
              }`}
            >
              +
            </button>

            {/* Row 5 */}
            <button
              onClick={toggleSign}
              className="h-11 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm transition-all active:scale-95 border border-slate-200 dark:border-slate-700 cursor-pointer"
            >
              ±
            </button>
            <button
              onClick={() => inputDigit('0')}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              0
            </button>
            <button
              onClick={inputDecimal}
              className="h-11 rounded-xl bg-slate-50/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base transition-all active:scale-95 border border-slate-200/80 dark:border-slate-700 shadow-2xs cursor-pointer font-mono"
            >
              .
            </button>
            <button
              onClick={handleEquals}
              className="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xl transition-all active:scale-95 shadow-md shadow-emerald-600/25 border border-emerald-500 flex items-center justify-center cursor-pointer"
            >
              =
            </button>
          </div>

          {/* Footer Shortcuts Hint */}
          <div className="px-4 py-2 bg-slate-50/80 dark:bg-slate-950/50 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10.5px] font-semibold text-slate-400 dark:text-slate-500">
            <span>[ESC] Cerrar</span>
            <span>Teclas numéricas activas</span>
          </div>
        </MotionDiv>
      </div>
    </AnimatePresence>
  );
}

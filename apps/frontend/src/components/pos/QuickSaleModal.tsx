import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import QuickSaleIcon from './QuickSaleIcon';

/**
 * Venta rápida: productos sin código ni inventario (caramelos, bolsas, propinas).
 * Solo pide precio y cantidad. Se abre con el código "1" o con F1 en el POS.
 */
export const QUICK_SALE_PRODUCT_ID = 'VENTA_RAPIDA';

export function buildQuickSaleProduct(price: number) {
  return {
    id: QUICK_SALE_PRODUCT_ID,
    name: 'VENTA RÁPIDA',
    barcode: QUICK_SALE_PRODUCT_ID,
    salePrice: price,
    categoryId: null,
    unlimitedStock: true,
    stock: 999999,
  };
}

interface Props {
  onClose: () => void;
  onConfirm: (price: number, quantity: number) => void;
}

function parseAmount(raw: string) {
  // Acepta "1500", "1.500" (miles), "12,5" y "12.5" (decimales)
  let normalized = raw;
  if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}$/.test(raw)) normalized = raw.replace(/\./g, '');
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

export default function QuickSaleModal({ onClose, onConfirm }: Props) {
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const priceRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const priceNum = parseAmount(price);
  const qtyNum = parseAmount(qty) || 0;
  const valid = priceNum > 0 && qtyNum > 0;

  useEffect(() => {
    const t = setTimeout(() => priceRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const submit = () => {
    if (!valid) return;
    onConfirm(priceNum, qtyNum);
  };

  // Enter en precio pasa a cantidad; Enter en cantidad agrega al carrito
  const onPriceKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (priceNum > 0) qtyRef.current?.focus();
    }
  };

  const onFieldKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      submit();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="keep-style w-full max-w-[400px] bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-[0_24px_60px_-16px_rgba(15,23,42,0.45)] p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-400 to-rose-600 text-white flex items-center justify-center shadow-sm shadow-rose-600/30">
              <QuickSaleIcon className="w-6 h-6" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-tight">Venta Rápida</h2>
              <p className="text-[11.5px] text-slate-500">Productos sin código · <kbd className="font-mono font-bold">F1</kbd> o código <kbd className="font-mono font-bold">1</kbd></p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Precio <span className="text-rose-600">*</span></span>
            <div className="relative">
              <span className="absolute inset-y-0 left-3.5 flex items-center text-slate-400 font-semibold text-[17px] pointer-events-none">$</span>
              <input
                ref={priceRef}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ''))}
                onKeyDown={onPriceKey}
                placeholder="0"
                className="w-full h-12 pl-8 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-850 text-[17px] font-semibold text-slate-900 dark:text-white outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15 transition-all placeholder:text-slate-300"
              />
            </div>
          </label>
          <label className="block">
            <span className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Cantidad</span>
            <input
              ref={qtyRef}
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ''))}
              onKeyDown={onFieldKey}
              onFocus={(e) => e.target.select()}
              className="w-full h-12 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-850 text-[17px] font-semibold text-slate-900 dark:text-white outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15 transition-all"
            />
          </label>
        </div>

        {valid && qtyNum !== 1 && (
          <p className="mt-3 text-[12.5px] text-slate-500">
            Total: <span className="font-bold text-slate-800 dark:text-slate-200">${(priceNum * qtyNum).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 mt-5">
          <button
            onClick={onClose}
            className="h-12 rounded-xl border border-slate-300 dark:border-slate-700 text-[14px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="h-12 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-bold shadow-md shadow-rose-600/25 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-800 transition-colors"
          >
            Agregar al Carrito
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

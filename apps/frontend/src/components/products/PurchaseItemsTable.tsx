import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Trash2, Plus, ChevronDown } from 'lucide-react';

/**
 * La lista de productos de una compra (2026-11-12, pedido del dueño: "que siempre quede bien, fácil de
 * usar y entender, prolija, sin campos encimados").
 * - Una línea por producto con lo que importa: cantidad, costo, margen, precio de venta (destacado, con
 *   el que tenía) y subtotal. Entra en la pantalla sin correr de costado.
 * - Lo demás (código de barras, categoría y marca de un producto nuevo, vencimiento, bulto, descuentos
 *   del proveedor) va en "Más datos", que se abre debajo de ese producto.
 * - El cursor arranca en el primer campo. Enter pasa al siguiente (y a la fila de abajo), Shift+Enter
 *   vuelve, ↑ / ↓ cambian de producto en la misma columna.
 * Los datos y las cuentas siguen en NewPurchaseScreen: esto solo muestra y avisa los cambios.
 */

/** Clave del renglón: el producto, o la propia si el producto está en más de un renglón */
export const rowId = (i: { productId: string; lineId?: string }) => i.lineId || i.productId;

export interface TableItem {
  productId: string;
  /** Mismo producto en dos renglones de la boleta: cada renglón tiene su propia clave */
  lineId?: string;
  barcode: string;
  sku?: string;
  name: string;
  variant: string;
  quantity: number;
  cost: number;
  total: number;
  buyFormat: string;
  unitsPerPack: number;
  presentationType: string;
  isNew?: boolean;
  margin?: number;
  salePrice?: number;
  discount1?: number;
  discount2?: number;
  discount3?: number;
  categoryName?: string;
  brandName?: string;
  trackExpiry?: boolean;
  expiresAt?: string;
  candidates?: { id: string; name: string }[];
  base?: { costPrice: number; salePrice: number };
  newProductData?: { categoryId?: string | null; brandId?: string | null };
}

interface Props<T extends TableItem> {
  items: T[];
  useIva: boolean;
  expiryEnabled: boolean;
  netCostOf: (item: T) => number;
  update: (id: string, field: keyof T, value: any) => void;
  setNewProductField: (id: string, field: 'categoryId' | 'brandId', value: string | null) => void;
  remove: (id: string) => void;
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  onCreateCategory: (productId: string) => void;
  onCreateBrand: (productId: string) => void;
  /** Debajo del nombre: comparación de costos y "¿ya lo tenés?" */
  renderNameExtras: (item: T) => ReactNode;
  /** La fila para buscar y agregar productos (va al final de la lista) */
  addRow: ReactNode;
  /** Al pasar la última celda con Enter */
  onLeaveLast: () => void;
}

const money = (n: number) => `$ ${(Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const numVal = (v: any) => (v === '' || v === null || v === undefined ? '' : v);

export default function PurchaseItemsTable<T extends TableItem>(p: Props<T>) {
  const { items, useIva } = p;
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  // El cursor arranca en el primer campo apenas hay productos (una sola vez por pantalla)
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !items.length) return;
    focused.current = true;
    setTimeout(() => wrap.current?.querySelector<HTMLInputElement>('[data-nav]')?.focus(), 150);
  }, [items.length]);

  const onNav = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const all = Array.from(wrap.current?.querySelectorAll<HTMLInputElement>('[data-nav]') || []);
    const i = all.indexOf(el);
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = all[e.shiftKey ? i - 1 : i + 1];
      if (next) next.focus(); else if (!e.shiftKey) p.onLeaveLast();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); // en un número, las flechas cambiarían el valor
      const row = Number(el.dataset.row), col = el.dataset.col;
      all.find((c) => Number(c.dataset.row) === row + (e.key === 'ArrowDown' ? 1 : -1) && c.dataset.col === col)?.focus();
    }
  };
  const nav = (row: number, col: string) => ({ 'data-nav': '1', 'data-row': row, 'data-col': col, onKeyDown: onNav, onFocus: (e: any) => e.target.select() });

  const field = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13.5px] font-semibold text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 tabular-nums';
  const small = 'h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12.5px] font-medium text-slate-700 outline-none focus:border-emerald-500';
  const label = 'block text-[11px] font-semibold text-slate-500 mb-1';
  const th = 'px-3 py-2.5 text-[11.5px] font-semibold text-slate-500';

  return (
    <div ref={wrap} className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-left">
            <th className={`${th} w-10 text-center`}>#</th>
            <th className={th}>Producto</th>
            <th className={`${th} w-[96px] text-center`}>Cantidad</th>
            <th className={`${th} w-[136px] text-right`}>Costo unit.</th>
            <th className={`${th} w-[88px] text-right`}>Margen</th>
            <th className={`${th} w-[140px] text-right text-emerald-800`}>Precio de venta</th>
            <th className={`${th} w-[130px] text-right`}>Subtotal</th>
            <th className="w-[84px]" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const net = p.netCostOf(item);
            const finalCost = net * (useIva ? 1.21 : 1);
            const oldPrice = !item.isNew && item.base?.salePrice ? item.base.salePrice : 0;
            const priceChanged = oldPrice > 0 && Math.abs((Number(item.salePrice) || 0) - oldPrice) >= 0.01;
            const disc = [item.discount1, item.discount2, item.discount3].map((d) => Number(d) || 0);
            const isOpen = !!open[rowId(item)];
            // Lo que conviene completar en "Más datos" (un puntito avisa)
            const needs = (item.isNew && !item.newProductData?.categoryId) || (item.trackExpiry && !item.expiresAt);
            const sub = [
              item.sku ? `Cód. ${item.sku}` : '',
              item.barcode ? `EAN ${item.barcode}` : '',
              item.buyFormat === 'PACK' ? `${(Number(item.quantity) || 0) * item.unitsPerPack} u. (bultos de ${item.unitsPerPack})` : '',
              disc.some(Boolean) ? `desc. ${disc.filter(Boolean).join(' + ')}%` : '',
              useIva ? `costo con IVA ${money(finalCost)}` : '',
            ].filter(Boolean).join(' · ');
            return [
              <tr key={rowId(item)} className={`border-b border-slate-100 ${isOpen ? 'bg-slate-50/70' : 'hover:bg-slate-50/50'} focus-within:bg-emerald-50/40`}>
                <td className="px-3 py-3 text-center text-[12.5px] font-semibold text-slate-400 align-top pt-[18px]">{idx + 1}</td>
                <td className="px-3 pb-3 pt-[17px] align-top">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[14px] font-semibold text-slate-800 truncate" title={item.name}>{item.name}</span>
                    {item.isNew && <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10.5px] font-bold">Nuevo</span>}
                  </div>
                  {sub && <div className="mt-0.5 text-[12px] text-slate-500 truncate">{sub}</div>}
                  {p.renderNameExtras(item)}
                </td>
                <td className="px-2 py-3 align-top">
                  <input type="number" min={0} value={numVal(item.quantity)} {...nav(idx, 'qty')}
                    onChange={(e) => { const v = parseFloat(e.target.value); p.update(rowId(item), 'quantity' as keyof T, isNaN(v) ? '' : v); }}
                    className={`${field} text-center`} />
                </td>
                <td className="px-2 py-3 align-top">
                  <input type="number" min={0} step="any" value={numVal(item.cost)} {...nav(idx, 'cost')}
                    onChange={(e) => { const v = parseFloat(e.target.value); p.update(rowId(item), 'cost' as keyof T, isNaN(v) ? '' : v); }}
                    className={`${field} text-right`} />
                </td>
                <td className="px-2 py-3 align-top">
                  <div className="relative">
                    <input type="number" step="any" value={numVal(item.margin)} {...nav(idx, 'margin')}
                      onChange={(e) => { const v = parseFloat(e.target.value); p.update(rowId(item), 'margin' as keyof T, isNaN(v) ? '' : v); }}
                      className={`${field} pr-6 text-right`} />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-slate-400">%</span>
                  </div>
                </td>
                <td className="px-2 py-3 align-top">
                  <input type="number" min={0} step="any" value={numVal(item.salePrice)} {...nav(idx, 'price')}
                    onChange={(e) => { const v = parseFloat(e.target.value); p.update(rowId(item), 'salePrice' as keyof T, isNaN(v) ? '' : v); }}
                    className={`${field} text-right font-bold text-emerald-800 border-emerald-200 bg-emerald-50/40`} />
                  {priceChanged && <div className="mt-1 text-right text-[11px] font-medium text-amber-700">antes {money(oldPrice)}</div>}
                </td>
                <td className="px-3 py-3 align-top pt-[18px] text-right text-[14px] font-semibold text-slate-800 tabular-nums">{money(item.total)}</td>
                <td className="px-2 py-3 align-top">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => toggle(rowId(item))} title="Más datos: código, categoría, vencimiento, descuentos"
                      className={`relative h-9 w-9 rounded-lg inline-flex items-center justify-center cursor-pointer ${isOpen ? 'bg-slate-200 text-slate-700' : 'text-slate-500 hover:bg-slate-100'}`}>
                      <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      {needs && !isOpen && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500" />}
                    </button>
                    <button type="button" onClick={() => p.remove(rowId(item))} title="Sacar de la compra"
                      className="h-9 w-9 rounded-lg text-slate-400 hover:text-[#dc2626] hover:bg-[#fef2f2] inline-flex items-center justify-center cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>,
              isOpen && (
                <tr key={`${rowId(item)}-more`} className="border-b border-slate-100 bg-slate-50/70">
                  <td />
                  <td colSpan={7} className="px-3 pb-4 pt-1">
                    <div className="flex flex-wrap gap-x-5 gap-y-3 items-end">
                      <div>
                        <span className={label}>Código de barras</span>
                        {item.isNew
                          ? <input type="text" value={item.barcode} placeholder="Escaneá o escribí" onChange={(e) => p.update(rowId(item), 'barcode' as keyof T, e.target.value)} className={`${small} w-44`} />
                          : <div className="h-8 flex items-center text-[12.5px] text-slate-700">{item.barcode || 'Sin código'}</div>}
                      </div>
                      {item.isNew && (
                        <div>
                          <span className={label}>Categoría</span>
                          <div className="flex items-center gap-1">
                            <select value={item.newProductData?.categoryId || ''} onChange={(e) => p.setNewProductField(rowId(item), 'categoryId', e.target.value || null)} className={`${small} w-44 cursor-pointer`}>
                              <option value="">Sin categoría</option>
                              {p.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <button type="button" onClick={() => p.onCreateCategory(rowId(item))} title="Crear categoría" className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 inline-flex items-center justify-center cursor-pointer"><Plus className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      )}
                      {item.isNew && (
                        <div>
                          <span className={label}>Marca</span>
                          <div className="flex items-center gap-1">
                            <select value={item.newProductData?.brandId || ''} onChange={(e) => p.setNewProductField(rowId(item), 'brandId', e.target.value || null)} className={`${small} w-40 cursor-pointer`}>
                              <option value="">Sin marca</option>
                              {p.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                            <button type="button" onClick={() => p.onCreateBrand(rowId(item))} title="Crear marca" className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 inline-flex items-center justify-center cursor-pointer"><Plus className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      )}
                      {item.presentationType === 'PACK' && (
                        <div>
                          <span className={label}>Se compra por</span>
                          <select value={item.buyFormat} onChange={(e) => p.update(rowId(item), 'buyFormat' as keyof T, e.target.value)} className={`${small} w-40 cursor-pointer`}>
                            <option value="UNIT">Unidad</option>
                            <option value="PACK">Bulto de {item.unitsPerPack}</option>
                          </select>
                        </div>
                      )}
                      {(item.trackExpiry || (item.isNew && p.expiryEnabled)) && (
                        <div>
                          <span className={label}>Vencimiento{item.trackExpiry ? '' : ' (opcional)'}</span>
                          <input type="date" value={item.expiresAt || ''} onChange={(e) => p.update(rowId(item), 'expiresAt' as keyof T, e.target.value)}
                            className={`${small} w-40 ${item.trackExpiry && !item.expiresAt ? 'border-amber-300 bg-amber-50' : ''}`} />
                        </div>
                      )}
                      <div>
                        <span className={label}>Descuentos del proveedor (%)</span>
                        <div className="flex items-center gap-1">
                          {([1, 2, 3] as const).map((n) => (
                            <input key={n} type="number" min={0} max={100} placeholder="0" value={(item as any)[`discount${n}`] || ''}
                              onChange={(e) => { const v = parseFloat(e.target.value); p.update(rowId(item), `discount${n}` as keyof T, isNaN(v) ? 0 : v); }}
                              className={`${small} w-14 text-center`} />
                          ))}
                          {net !== (Number(item.cost) || 0) && <span className="ml-1 text-[12px] font-semibold text-emerald-700">neto {money(net)}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              ),
            ];
          })}
          <tr>
            <td />
            <td colSpan={7} className="px-3 py-3">{p.addRow}</td>
          </tr>
        </tbody>
      </table>
      {items.length > 0 && (
        <p className="px-4 pb-3 text-[11.5px] text-slate-400">
          <b className="font-semibold text-slate-500">Enter</b> pasa al campo siguiente · <b className="font-semibold text-slate-500">Shift+Enter</b> vuelve · <b className="font-semibold text-slate-500">↑ ↓</b> cambian de producto · <ChevronDown className="inline w-3 h-3 -mt-0.5" /> más datos del producto
        </p>
      )}
    </div>
  );
}

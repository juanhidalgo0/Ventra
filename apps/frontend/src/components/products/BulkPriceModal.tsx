import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, X, Percent, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { usePOSStore } from '../../stores/posStore';

interface BulkPriceModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function BulkPriceModal({ onClose, onSuccess }: BulkPriceModalProps) {
  const [filterType, setFilterType] = useState<'ALL' | 'SUPPLIER' | 'CATEGORY' | 'BRAND'>('ALL');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [direction, setDirection] = useState<'INCREASE' | 'DECREASE'>('INCREASE');
  const [percentage, setPercentage] = useState<string>('10');
  const [target, setTarget] = useState<'COST_AND_SALE' | 'SALE_ONLY' | 'COST_ONLY'>('COST_AND_SALE');
  
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [supRes, catRes, brRes] = await Promise.allSettled([
          api.get('/suppliers'),
          api.get('/categories'),
          api.get('/brands')
        ]);
        if (supRes.status === 'fulfilled') setSuppliers(supRes.value.data || []);
        if (catRes.status === 'fulfilled') setCategories(catRes.value.data || []);
        if (brRes.status === 'fulfilled') setBrands(brRes.value.data || []);
      } catch (err) {
        console.error('Error fetching filters for bulk price modal', err);
      }
    };
    fetchData();
  }, []);

  const numPercentage = parseFloat(percentage) || 0;
  const signedPercentage = direction === 'INCREASE' ? Math.abs(numPercentage) : -Math.abs(numPercentage);
  const sampleOriginal = 1000;
  const sampleNew = Math.round(sampleOriginal * (1 + signedPercentage / 100));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (numPercentage <= 0) {
      toast.error('Ingresá un porcentaje mayor a 0');
      return;
    }

    if (filterType === 'SUPPLIER' && !selectedSupplierId) {
      toast.error('Por favor seleccioná un proveedor');
      return;
    }
    if (filterType === 'CATEGORY' && !selectedCategoryId) {
      toast.error('Por favor seleccioná una categoría');
      return;
    }
    if (filterType === 'BRAND' && !selectedBrandId) {
      toast.error('Por favor seleccioná una marca');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: any = {
        percentage: signedPercentage,
        target,
        supplierId: filterType === 'SUPPLIER' ? selectedSupplierId : undefined,
        categoryId: filterType === 'CATEGORY' ? selectedCategoryId : undefined,
        brandId: filterType === 'BRAND' ? selectedBrandId : undefined,
      };

      const res = await api.post('/products/bulk-update-prices', payload);
      toast.success(res.data.message || 'Precios actualizados con éxito');
      usePOSStore.getState().setProducts([]);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al actualizar precios');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-xl">
              <Percent className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Actualización Masiva de Precios</h2>
              <p className="text-xs text-slate-500">Aumentá o descontá precios por proveedor, categoría o marca</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[80vh]">
          {/* Alcance / Filtro */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
              1. Alcance de la actualización
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'ALL', label: 'Todos' },
                { id: 'SUPPLIER', label: 'Proveedor' },
                { id: 'CATEGORY', label: 'Categoría' },
                { id: 'BRAND', label: 'Marca' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFilterType(opt.id as any)}
                  className={`py-2 px-2.5 text-xs font-bold rounded-lg border transition-all ${
                    filterType === opt.id
                      ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                      : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Dropdown conditional on filter */}
            {filterType === 'SUPPLIER' && (
              <div className="mt-2.5">
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">Seleccionar Proveedor</label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-rose-500"
                >
                  <option value="">-- Seleccioná un proveedor --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {filterType === 'CATEGORY' && (
              <div className="mt-2.5">
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">Seleccionar Categoría</label>
                <select
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-rose-500"
                >
                  <option value="">-- Seleccioná una categoría --</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {filterType === 'BRAND' && (
              <div className="mt-2.5">
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">Seleccionar Marca</label>
                <select
                  value={selectedBrandId}
                  onChange={(e) => setSelectedBrandId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-rose-500"
                >
                  <option value="">-- Seleccioná una marca --</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Tipo de Ajuste & Porcentaje */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
              2. Ajuste porcentual
            </label>
            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <button
                type="button"
                onClick={() => setDirection('INCREASE')}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border text-xs font-bold transition-all ${
                  direction === 'INCREASE'
                    ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                    : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <TrendingUp className="w-4 h-4" /> Aumento (+ %)
              </button>
              <button
                type="button"
                onClick={() => setDirection('DECREASE')}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border text-xs font-bold transition-all ${
                  direction === 'DECREASE'
                    ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                    : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <TrendingDown className="w-4 h-4" /> Descuento (- %)
              </button>
            </div>

            <div className="relative flex items-center">
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="1000"
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
                placeholder="10"
                className="w-full bg-white border-2 border-rose-200 rounded-xl pl-4 pr-10 py-2.5 text-lg font-bold text-slate-800 outline-none focus:border-rose-600"
              />
              <span className="absolute right-4 font-bold text-slate-400 text-base">%</span>
            </div>
          </div>

          {/* Precios a Modificar */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
              3. ¿Qué valores actualizar?
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'COST_AND_SALE', label: 'Costo y Venta' },
                { id: 'SALE_ONLY', label: 'Solo Venta' },
                { id: 'COST_ONLY', label: 'Solo Costo' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTarget(t.id as any)}
                  className={`py-2 px-2 text-[11px] font-bold rounded-lg border text-center transition-all ${
                    target === t.id
                      ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                      : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic Preview */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Previsualización de Impacto
            </span>
            <p className="text-xs font-semibold text-slate-700">
              Un producto que hoy vale <span className="font-bold text-slate-900">${sampleOriginal.toLocaleString()}</span> pasará a valer{' '}
              <span className={`font-bold ${direction === 'INCREASE' ? 'text-emerald-600' : 'text-rose-600'}`}>
                ${sampleNew.toLocaleString()}
              </span>{' '}
              ({direction === 'INCREASE' ? `+${numPercentage}%` : `-${numPercentage}%`}).
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || numPercentage <= 0}
              className="btn-primary"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Actualizando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" /> Aplicar Actualización
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

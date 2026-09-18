import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { 
  X, 
  Tag, 
  Printer, 
  Search, 
  Sliders, 
  Check, 
  MapPin, 
  Barcode 
} from 'lucide-react';
import { renderBarcodeSvg } from '../../utils/barcodeLabels';

interface GaveteroLabelModalProps {
  products: any[];
  onClose: () => void;
}

export default function GaveteroLabelModal({ products, onClose }: GaveteroLabelModalProps) {
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(() => {
    // Default select products with location or top 20
    const withLocation = products.filter(p => Boolean(p.location)).map(p => p.id);
    return withLocation.length > 0 ? withLocation : products.slice(0, 15).map(p => p.id);
  });
  const [search, setSearch] = useState('');
  const [labelSize, setLabelSize] = useState<'standard' | 'compact' | 'drawer'>('standard');
  const [showLocation, setShowLocation] = useState(true);
  const [showBarcode, setShowBarcode] = useState(true);
  const [showPrice, setShowPrice] = useState(true);

  const filteredProducts = products.filter(p => {
    if (!search) return true;
    const term = search.toLowerCase();
    return p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.includes(term)) || (p.location && p.location.toLowerCase().includes(term));
  });

  const selectedProducts = products.filter(p => selectedProductIds.includes(p.id));

  const toggleProduct = (id: string) => {
    setSelectedProductIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedProductIds.length === filteredProducts.length) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(filteredProducts.map(p => p.id));
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-white dark:bg-slate-900 w-full max-w-5xl h-[88vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-white dark:bg-slate-900 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-600 flex items-center justify-center">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight text-slate-800 dark:text-white">Generador de Etiquetas de Gavetero / Estantería</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                  Ferretería & Mostrador
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Etiquetas autoadhesivas de gaveta con código de barras, ubicación, medida y precio</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Configuration Bar */}
        <div className="p-4 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Formato:</span>
            <div className="flex gap-1.5 p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
              <button
                type="button"
                onClick={() => setLabelSize('standard')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  labelSize === 'standard' ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Estándar (60x30 mm)
              </button>
              <button
                type="button"
                onClick={() => setLabelSize('drawer')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  labelSize === 'drawer' ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Gavetero Frontal (50x20 mm)
              </button>
            </div>

            <div className="flex items-center gap-3 ml-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showLocation} onChange={e => setShowLocation(e.target.checked)} className="rounded" />
                <span>Ubicación</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showBarcode} onChange={e => setShowBarcode(e.target.checked)} className="rounded" />
                <span>Cód. Barras</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} className="rounded" />
                <span>Precio</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              <strong>{selectedProductIds.length}</strong> seleccionadas
            </span>
            <button
              onClick={handlePrint}
              disabled={selectedProductIds.length === 0}
              className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-teal-600/20 transition-all cursor-pointer disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              Imprimir Etiquetas
            </button>
          </div>
        </div>

        {/* Content: Left Selector, Right Live Sheet Preview */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Product Selection */}
          <div className="w-80 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-900/50">
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input 
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar productos..."
                  className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="flex justify-between items-center text-[10px] px-1">
                <button 
                  type="button" 
                  onClick={handleSelectAll} 
                  className="font-bold text-teal-600 hover:underline cursor-pointer"
                >
                  {selectedProductIds.length === filteredProducts.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                </button>
                <span className="text-slate-400">{filteredProducts.length} productos</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {filteredProducts.map(p => {
                const isSelected = selectedProductIds.includes(p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => toggleProduct(p.id)}
                    className={`p-2 rounded-lg border text-xs transition-all cursor-pointer flex items-center justify-between gap-2 ${
                      isSelected 
                        ? 'border-teal-500 bg-teal-50/60 dark:bg-teal-950/40 text-teal-950 dark:text-teal-100 font-bold' 
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate leading-tight">{p.name}</p>
                      {p.location && (
                        <span className="text-[9px] text-amber-700 dark:text-amber-400 font-semibold block mt-0.5">
                          📍 {p.location}
                        </span>
                      )}
                    </div>
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-300'
                    }`}>
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Live Printable Sheet Preview */}
          <div className="flex-1 overflow-y-auto p-6 bg-slate-100/70 dark:bg-slate-950 custom-scrollbar flex flex-col items-center">
            <div id="printable-labels-sheet" className="bg-white text-black p-6 rounded-xl shadow-lg border border-slate-300 w-full max-w-[210mm] min-h-[297mm]">
              <style>{`
                @media print {
                  @page {
                    size: A4 portrait;
                    margin: 8mm;
                  }
                  body * {
                    visibility: hidden;
                  }
                  #printable-labels-sheet, #printable-labels-sheet * {
                    visibility: visible;
                  }
                  #printable-labels-sheet {
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: 100% !important;
                    box-shadow: none !important;
                    border: none !important;
                    padding: 0 !important;
                  }
                }
              `}</style>

              <div className={`grid gap-3 ${
                labelSize === 'drawer' 
                  ? 'grid-cols-4' 
                  : 'grid-cols-3'
              }`}>
                {selectedProducts.map(p => (
                  <div 
                    key={p.id} 
                    className={`border-2 border-black rounded-lg p-2.5 flex flex-col justify-between text-black bg-white ${
                      labelSize === 'drawer' ? 'h-[75px]' : 'h-[105px]'
                    }`}
                  >
                    {/* Top: Location & SKU */}
                    <div className="flex items-center justify-between border-b border-black/30 pb-1 text-[9px] font-bold">
                      {showLocation && p.location ? (
                        <span className="bg-black text-white px-1.5 py-0.2 rounded text-[8px] uppercase tracking-wider">
                          GAVETA: {p.location}
                        </span>
                      ) : (
                        <span className="text-gray-500 font-mono text-[8px]">
                          {p.sku || p.barcode?.slice(-6) || 'FERR'}
                        </span>
                      )}
                      {p.unit && p.unit !== 'UNIT' && (
                        <span className="font-extrabold uppercase text-[8px]">
                          [{p.unit}]
                        </span>
                      )}
                    </div>

                    {/* Middle: Name */}
                    <p className={`font-black leading-tight uppercase line-clamp-2 my-auto ${
                      labelSize === 'drawer' ? 'text-[9.5px]' : 'text-[11px]'
                    }`}>
                      {p.name}
                    </p>

                    {/* Bottom: Barcode & Price */}
                    <div className="flex items-end justify-between pt-1 border-t border-black/30 mt-auto">
                      {showBarcode && p.barcode ? (
                        <div className="leading-none">
                          <div
                            className="w-[30mm] h-[7mm] [&>svg]:w-full [&>svg]:h-full"
                            dangerouslySetInnerHTML={{ __html: renderBarcodeSvg(p.barcode) || '' }}
                          />
                          <span className="font-mono text-[7px] tracking-tight block font-bold mt-0.5">
                            {p.barcode}
                          </span>
                        </div>
                      ) : <div />}

                      {showPrice && (
                        <span className={`font-mono font-black tracking-tight ${
                          labelSize === 'drawer' ? 'text-xs' : 'text-sm'
                        }`}>
                          $${p.salePrice.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {selectedProducts.length === 0 && (
                <div className="text-center py-20 text-gray-400">
                  <Tag className="w-12 h-12 stroke-1 mx-auto mb-2" />
                  <p className="text-sm font-bold">No hay productos seleccionados para imprimir</p>
                  <p className="text-xs">Seleccioná artículos de la lista lateral para armar la plancha de etiquetas</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { useMarketingStore } from '../../stores/marketingStore';
import api from '../../services/api';
import { Search, Plus, Trash2, ArrowLeft, Image as ImageIcon, Printer, Download, Save, Palette, Layout } from 'lucide-react';
import { toast } from 'react-hot-toast';
import html2canvas from 'html2canvas';

export default function MarketingEditor({ groupId, onBack }: { groupId: string | null, onBack: () => void }) {
  const { groups, createGroup, updateGroup } = useMarketingStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<any[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'products' | 'design'>('products');
  
  // Design settings
  const [format, setFormat] = useState<'ig_feed' | 'ig_story' | 'a4' | 'a3'>('ig_feed');
  const [theme, setTheme] = useState<'dark' | 'light' | 'brand'>('dark');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(true);
  const [showCodes, setShowCodes] = useState(false);
  
  const designRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (groupId) {
      const group = groups.find(g => g.id === groupId);
      if (group) {
        setName(group.name);
        setDescription(group.description || '');
        setItems(group.items.map(i => ({ ...i.product, marketingGroupId: i.id }))); // Storing product info
      }
    }
  }, [groupId, groups]);

  useEffect(() => {
    const search = async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const { data } = await api.get('/products', { params: { search: searchQuery, take: 10 } });
        setSearchResults(data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearching(false);
      }
    };
    
    const timeout = setTimeout(search, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const handleSave = async () => {
    if (!name) {
      toast.error('El nombre es requerido');
      return;
    }
    
    const itemsData = items.map((p, idx) => ({ productId: p.id, order: idx }));
    
    const loadingToast = toast.loading('Guardando...');
    try {
      if (groupId) {
        await updateGroup(groupId, name, description, itemsData);
      } else {
        await createGroup(name, description, itemsData);
      }
      toast.success('Grupo guardado con éxito', { id: loadingToast });
      onBack();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Error al guardar';
      toast.error(`Error: ${errorMessage}`, { id: loadingToast });
    }
  };

  const handleExportImage = async () => {
    if (!designRef.current) return;
    
    const loadingToast = toast.loading('Generando imagen de alta calidad...');
    try {
      const canvas = await html2canvas(designRef.current, {
        scale: 2, // High resolution
        useCORS: true,
        backgroundColor: theme === 'dark' ? '#0f172a' : theme === 'brand' ? '#4f46e5' : '#ffffff'
      });
      
      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = image;
      link.download = `lista_precios_${name.replace(/\s+/g, '_')}.png`;
      link.click();
      toast.success('Imagen generada con éxito', { id: loadingToast });
    } catch (err) {
      toast.error('Error al generar la imagen', { id: loadingToast });
      console.error(err);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = searchQuery.trim();
      if (!code) return;

      setIsSearching(true);
      try {
        const { data } = await api.get('/products', { params: { search: code, take: 10 } });
        const exactMatch = data.find((p: any) => p.barcode === code || p.sku === code);
        const match = exactMatch || data[0];
        
        if (match) {
          if (!items.find(i => i.id === match.id)) {
            setItems(prev => [...prev, match]);
            toast.success(`Producto agregado: ${match.name}`);
          } else {
            toast.error('El producto ya está en la lista');
          }
          setSearchQuery('');
          setSearchResults([]);
        } else {
          toast.error('Producto no encontrado');
        }
      } catch (err) {
        console.error(err);
        toast.error('Error al buscar el producto');
      } finally {
        setIsSearching(false);
      }
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setLogoUrl(url);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-400 px-6 py-4 flex items-center justify-between z-10 sticky top-0 hide-on-print">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 text-slate-600 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-800">{groupId ? 'Editar Grupo' : 'Nuevo Grupo de Marketing'}</h2>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setActiveTab('products')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${activeTab === 'products' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Productos
          </button>
          <button 
            onClick={() => setActiveTab('design')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${activeTab === 'design' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Diseño / Exportar
          </button>
          <div className="w-px h-6 bg-slate-200 mx-2"></div>
          <button 
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg shadow hover:bg-emerald-700 active:scale-95 transition-all"
          >
            <Save className="w-4 h-4" /> Guardar
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar p-6">
        {activeTab === 'products' ? (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-400 shadow-sm space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 mb-2">Información del Grupo</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre de la lista / grupo</label>
                  <input 
                    type="text" 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    placeholder="Ej. Ofertas Fin de Semana" 
                    className="w-full bg-slate-50 border border-slate-400 rounded-lg px-4 py-2.5 outline-none focus:border-rose-400 focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción (opcional)</label>
                  <input 
                    type="text" 
                    value={description} 
                    onChange={e => setDescription(e.target.value)} 
                    placeholder="Válido hasta agotar stock..." 
                    className="w-full bg-slate-50 border border-slate-400 rounded-lg px-4 py-2.5 outline-none focus:border-rose-400 focus:bg-white transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-400 shadow-sm">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 mb-4">Añadir Productos</h3>
              
              <div className="relative mb-6">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Buscar producto por nombre o código para agregar..." 
                  className="w-full bg-slate-50 border border-slate-400 rounded-xl pl-11 pr-4 py-3 text-sm font-medium outline-none focus:border-rose-400 focus:bg-white transition-all"
                />
                
                {searchQuery.length >= 2 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-400 overflow-hidden z-20">
                    {isSearching ? (
                      <div className="p-4 text-center text-sm text-slate-700">Buscando...</div>
                    ) : searchResults.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto">
                        {searchResults.map(prod => (
                          <div 
                            key={prod.id} 
                            onClick={() => {
                              if (!items.find(i => i.id === prod.id)) {
                                  setItems([...items, prod]);
                              }
                              setSearchQuery('');
                            }}
                            className="flex items-center justify-between p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-300 last:border-0"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                                <img src={prod.imageUrl || './product-placeholder.png'} alt="" className="w-8 h-8 object-cover rounded-md" onError={(e) => (e.target as HTMLImageElement).src = './product-placeholder.png'} />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-800">{prod.name}</p>
                                <p className="text-xs text-slate-600">$ {prod.salePrice.toLocaleString()}</p>
                              </div>
                            </div>
                            <Plus className="w-5 h-5 text-rose-500" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 text-center text-sm text-slate-700">No se encontraron productos</div>
                    )}
                  </div>
                )}
              </div>

              {/* Selected Products */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-slate-700 px-4 mb-2">
                  <span>Productos en la lista ({items.length})</span>
                  <span>Precio de venta</span>
                </div>
                {items.length === 0 ? (
                  <div className="text-center py-8 text-slate-600 border-2 border-dashed border-slate-400 rounded-xl">
                    Busca y selecciona productos para agregar a esta lista
                  </div>
                ) : (
                  items.map((prod, idx) => (
                    <div key={prod.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-400 rounded-xl group hover:border-rose-300 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-600 w-4">{idx + 1}.</span>
                        <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center border border-slate-400">
                          <img src={prod.imageUrl || './product-placeholder.png'} alt="" className="w-8 h-8 object-cover rounded-md" onError={(e) => (e.target as HTMLImageElement).src = './product-placeholder.png'} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800">{prod.name}</p>
                          <p className="text-xs text-slate-600">{prod.barcode || 'Sin código'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-black text-slate-800">$ {prod.salePrice.toLocaleString()}</span>
                        <button 
                          onClick={() => setItems(items.filter((_, i) => i !== idx))}
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6 hide-on-print">
            {/* Design Controls */}
            <div className="w-full lg:w-80 space-y-4 shrink-0">
              <div className="bg-white p-5 rounded-2xl border border-slate-400 shadow-sm space-y-5">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2 mb-3">
                    <Layout className="w-4 h-4" /> Formato
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setFormat('ig_feed')} className={`p-3 rounded-xl border text-left transition-all ${format === 'ig_feed' ? 'border-rose-500 bg-rose-50 ring-2 ring-rose-500/20' : 'border-slate-400 hover:bg-slate-50'}`}>
                      <p className="text-sm font-bold text-slate-800">Instagram Feed</p>
                      <p className="text-[10px] text-slate-700">1080x1080 (Cuadrado)</p>
                    </button>
                    <button onClick={() => setFormat('ig_story')} className={`p-3 rounded-xl border text-left transition-all ${format === 'ig_story' ? 'border-rose-500 bg-rose-50 ring-2 ring-rose-500/20' : 'border-slate-400 hover:bg-slate-50'}`}>
                      <p className="text-sm font-bold text-slate-800">Stories / Reels</p>
                      <p className="text-[10px] text-slate-700">1080x1920 (Vertical)</p>
                    </button>
                    <button onClick={() => setFormat('a4')} className={`p-3 rounded-xl border text-left transition-all ${format === 'a4' ? 'border-rose-500 bg-rose-50 ring-2 ring-rose-500/20' : 'border-slate-400 hover:bg-slate-50'}`}>
                      <p className="text-sm font-bold text-slate-800">Catálogo A4</p>
                      <p className="text-[10px] text-slate-700">Imprimir Catálogo</p>
                    </button>
                    <button onClick={() => setFormat('a3')} className={`p-3 rounded-xl border text-left transition-all ${format === 'a3' ? 'border-rose-500 bg-rose-50 ring-2 ring-rose-500/20' : 'border-slate-400 hover:bg-slate-50'}`}>
                      <p className="text-sm font-bold text-slate-800">Etiquetas A4</p>
                      <p className="text-[10px] text-slate-700">Para Góndolas</p>
                    </button>
                  </div>
                </div>

                <div className="border-t border-slate-300 pt-5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3">Opciones de Impresión</h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={showImages} 
                        onChange={(e) => setShowImages(e.target.checked)}
                        className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 h-4 w-4"
                      />
                      <span className="text-sm font-semibold text-slate-700">Mostrar imágenes</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={showCodes} 
                        onChange={(e) => setShowCodes(e.target.checked)}
                        className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 h-4 w-4"
                      />
                      <span className="text-sm font-semibold text-slate-700">Mostrar códigos</span>
                    </label>
                  </div>
                </div>

                {format !== 'a3' && (
                  <>
                    <div className="border-t border-slate-300 pt-5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2 mb-3">
                        <Palette className="w-4 h-4" /> Estilo (Tema)
                      </h3>
                      <div className="flex gap-2">
                        <button onClick={() => setTheme('dark')} className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${theme === 'dark' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-400 text-slate-600 hover:bg-slate-50'}`}>Dark</button>
                        <button onClick={() => setTheme('light')} className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${theme === 'light' ? 'border-slate-300 bg-white shadow-sm' : 'border-slate-400 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>Light</button>
                        <button onClick={() => setTheme('brand')} className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${theme === 'brand' ? 'border-rose-600 bg-rose-600 text-white' : 'border-slate-400 text-slate-600 hover:bg-slate-50'}`}>Vibrante</button>
                      </div>
                    </div>

                    <div className="border-t border-slate-300 pt-5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2 mb-3">
                        <ImageIcon className="w-4 h-4" /> Logo del Local
                      </h3>
                      <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-300 rounded-xl hover:bg-slate-50 hover:border-rose-400 transition-all cursor-pointer">
                        {logoUrl ? (
                          <img src={logoUrl} alt="Logo" className="max-h-16 object-contain" />
                        ) : (
                          <div className="text-center">
                            <Plus className="w-6 h-6 text-slate-600 mx-auto mb-1" />
                            <span className="text-xs font-semibold text-slate-700">Subir Logo (PNG/JPG)</span>
                          </div>
                        )}
                        <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                      </label>
                      {logoUrl && <button onClick={() => setLogoUrl(null)} className="text-[10px] text-red-500 font-semibold mt-2 w-full text-center">Quitar Logo</button>}
                    </div>
                  </>
                )}
                
                <div className="pt-5 border-t border-slate-300">
                  {(format === 'ig_feed' || format === 'ig_story') ? (
                    <button 
                      onClick={handleExportImage}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-purple-600 to-rose-600 text-white font-bold rounded-xl shadow-lg hover:shadow-rose-500/25 active:scale-95 transition-all"
                    >
                      <Download className="w-5 h-5" /> Descargar Imagen PNG
                    </button>
                  ) : (
                    <button 
                      onClick={handlePrint}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-slate-800 text-white font-bold rounded-xl shadow-lg hover:bg-slate-700 active:scale-95 transition-all"
                    >
                      <Printer className="w-5 h-5" /> Imprimir Documento
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Canvas Preview Area */}
            <div className="flex-1 bg-slate-200/50 rounded-2xl border border-slate-300 overflow-auto flex items-center justify-center p-4 lg:p-8 min-h-[600px] print:p-0 print:border-none print:bg-white print:overflow-visible">
              
              {/* Actual Design Wrapper */}
              <div 
                ref={designRef}
                className={`
                  print-area transition-all origin-top
                  ${format === 'ig_feed' ? 'w-[1080px] h-[1080px] shrink-0 zoom-wrapper-feed overflow-hidden relative' : ''}
                  ${format === 'ig_story' ? 'w-[1080px] h-[1920px] shrink-0 zoom-wrapper-story overflow-hidden relative' : ''}
                  ${(format === 'a4' || format === 'a3') ? 'flex flex-col gap-12 print:gap-0' : ''}
                  ${(format === 'ig_feed' || format === 'ig_story') && theme === 'dark' ? 'bg-slate-900 text-white' : ''}
                  ${(format === 'ig_feed' || format === 'ig_story') && theme === 'light' ? 'bg-slate-50 text-slate-800' : ''}
                  ${(format === 'ig_feed' || format === 'ig_story') && theme === 'brand' ? 'bg-gradient-to-br from-rose-600 via-purple-600 to-rose-500 text-white' : ''}
                `}
                style={{
                  padding: (format === 'ig_feed' || format === 'ig_story') ? '60px' : '0'
                }}
              >
                {/* --- Social Media Formats --- */}
                {(format === 'ig_feed' || format === 'ig_story') && (
                  <div className="h-full flex flex-col relative z-10">
                    <div className="flex justify-between items-center mb-12">
                      <div>
                        <h1 className={`text-6xl font-black uppercase tracking-tight ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>
                          {name || 'NUESTRAS OFERTAS'}
                        </h1>
                        {description && (
                          <p className={`text-2xl mt-4 font-medium ${theme === 'light' ? 'text-slate-700' : 'text-white/80'}`}>
                            {description}
                          </p>
                        )}
                      </div>
                      {logoUrl ? (
                        <div className={`backdrop-blur-md p-4 rounded-3xl border ${theme === 'light' ? 'bg-white/50 border-slate-400 shadow-sm' : 'bg-white/10 border-white/20'}`}>
                          <img src={logoUrl} alt="Logo" className="w-32 h-32 object-contain" />
                        </div>
                      ) : (
                        <div className={`backdrop-blur-md px-8 py-6 rounded-3xl border ${theme === 'light' ? 'bg-white/50 border-slate-400 shadow-sm' : 'bg-white/10 border-white/20'} flex items-center justify-center`}>
                          <span className={`text-5xl font-black italic tracking-tighter ${theme === 'light' ? '' : 'text-white'}`} style={theme === 'light' ? { color: '#0E6E52' } : undefined}>VENTRA</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-8 mt-8 flex-1 content-start">
                      {items.slice(0, format === 'ig_feed' ? 6 : 12).map((item, idx) => (
                        <div 
                          key={idx} 
                          className={`flex items-center gap-6 p-6 rounded-3xl border ${theme === 'light' ? 'bg-white border-slate-400 shadow-xl shadow-slate-200/50' : 'bg-white/10 backdrop-blur-lg border-white/20 shadow-2xl shadow-black/20'}`}
                        >
                          <div className={`w-32 h-32 rounded-2xl overflow-hidden shrink-0 shadow-inner ${theme === 'light' ? 'bg-slate-50' : 'bg-white/5'}`}>
                            <img src={item.imageUrl || './product-placeholder.png'} alt="" className="w-full h-full object-cover" onError={(e) => (e.target as HTMLImageElement).src = './product-placeholder.png'} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className={`text-2xl font-bold truncate ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>{item.name}</h3>
                            <p className={`text-4xl font-black mt-2 ${theme === 'brand' ? 'text-yellow-300' : theme === 'light' ? 'text-rose-600' : 'text-rose-400'}`}>
                              $ {item.salePrice.toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className={`mt-auto text-center pt-10 text-xl font-bold ${theme === 'light' ? 'text-slate-600' : 'text-white/50'}`}>
                      {items.length > (format === 'ig_feed' ? 6 : 12) ? `+ ${items.length - (format === 'ig_feed' ? 6 : 12)} productos más en el local` : '¡Te esperamos!'}
                    </div>
                  </div>
                )}
                
                {/* --- Decorative shapes for Social Media --- */}
                {(format === 'ig_feed' || format === 'ig_story') && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
                     <div className={`absolute -top-40 -right-40 w-96 h-96 rounded-full blur-[100px] ${theme === 'light' ? 'bg-rose-200/50' : theme === 'dark' ? 'bg-rose-500/20' : 'bg-white/20'}`}></div>
                     <div className={`absolute bottom-0 -left-20 w-80 h-80 rounded-full blur-[100px] ${theme === 'light' ? 'bg-rose-200/50' : theme === 'dark' ? 'bg-rose-500/20' : 'bg-white/20'}`}></div>
                  </div>
                )}

                {/* --- A4 Catalog Format --- */}
                {format === 'a4' && (
                  <>
                    {Array.from({ length: Math.ceil(items.length / 20) || 1 }).map((_, pageIndex) => {
                      const pageItems = items.slice(pageIndex * 20, (pageIndex + 1) * 20);
                      return (
                        <div key={pageIndex} className="w-[210mm] min-h-[297mm] bg-white print:w-[210mm] print:min-h-[297mm] shrink-0 shadow-2xl print:shadow-none zoom-wrapper-print relative" style={{ padding: '10mm', pageBreakAfter: 'always', breakAfter: 'page' }}>
                          <div className="text-slate-900 flex flex-col h-full bg-white relative">
                            {pageIndex === 0 && (
                              <div className="flex justify-between items-center bg-slate-900 text-white p-8 rounded-2xl mb-8 shadow-md">
                                <div>
                                  <h1 className="text-4xl font-black uppercase tracking-tight text-white">{name || 'NUESTRO CATÁLOGO'}</h1>
                                  {description && <p className="text-lg text-slate-300 mt-2 font-medium">{description}</p>}
                                </div>
                                {logoUrl && (
                                  <div className="bg-white rounded-xl p-3 shadow-lg flex items-center justify-center min-w-[80px]">
                                    <img src={logoUrl} alt="Logo" className="h-16 object-contain" />
                                  </div>
                                )}
                              </div>
                            )}
                            
                            <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                              {pageItems.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center py-4 border-b-2 border-dashed border-slate-400 break-inside-avoid group">
                                  <div className="flex items-center gap-4 min-w-0 flex-1">
                                    {showImages && (
                                      <div className="w-16 h-16 bg-white border border-slate-300 rounded-xl shadow-sm flex-shrink-0 flex items-center justify-center overflow-hidden p-1">
                                         <img src={item.imageUrl || './product-placeholder.png'} alt="" className="w-full h-full object-cover rounded-lg" onError={(e) => (e.target as HTMLImageElement).src = './product-placeholder.png'} />
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="text-lg font-bold text-slate-800 truncate group-hover:text-rose-600 transition-colors">{item.name}</p>
                                      {showCodes && item.barcode && (
                                        <p className="text-xs font-semibold text-slate-600 truncate tracking-widest mt-1 uppercase">{item.barcode}</p>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right ml-4 shrink-0">
                                    <span className="text-[10px] font-bold text-slate-600 block mb-0.5 uppercase tracking-widest">Precio</span>
                                    <span className="text-2xl font-black text-slate-900 whitespace-nowrap leading-none">$ {item.salePrice.toLocaleString()}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                            
                            <div className="mt-auto pt-16 pb-4 flex justify-between items-center">
                               <p className="text-xs font-bold text-slate-300 uppercase tracking-widest">Precios sujetos a modificaciones sin previo aviso</p>
                               <p className="text-xs font-bold text-slate-400">Página {pageIndex + 1} de {Math.ceil(items.length / 20) || 1}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}

                {/* --- A4 Labels (Góndola) Format --- */}
                {format === 'a3' && (
                  <>
                    {Array.from({ length: Math.ceil(items.length / 14) || 1 }).map((_, pageIndex) => {
                      const pageItems = items.slice(pageIndex * 14, (pageIndex + 1) * 14);
                      return (
                        <div key={pageIndex} className="w-[210mm] min-h-[297mm] bg-white print:w-[210mm] print:min-h-[297mm] shrink-0 shadow-2xl print:shadow-none zoom-wrapper-print relative flex flex-col" style={{ padding: '10mm', pageBreakAfter: 'always', breakAfter: 'page' }}>
                          <div className="grid grid-cols-2 gap-4 text-slate-900 flex-1 content-start">
                            {pageItems.map((item, idx) => (
                              <div key={idx} className="border-2 border-slate-800 rounded-xl flex h-[40mm] relative overflow-hidden bg-white shadow-sm">
                                {logoUrl && (
                                   <img src={logoUrl} alt="" className="absolute top-1/2 right-4 -translate-y-1/2 w-16 opacity-[0.05] pointer-events-none grayscale" />
                                )}
                                
                                {/* Left: Image (Full height) */}
                                {showImages && (
                                  <div className="w-[40mm] h-full bg-white border-r-2 border-slate-300 flex-shrink-0 flex items-center justify-center p-2 relative z-10">
                                    <img src={item.imageUrl || './product-placeholder.png'} alt="" className="w-full h-full object-contain rounded-md" onError={(e) => (e.target as HTMLImageElement).src = './product-placeholder.png'} />
                                  </div>
                                )}
                                
                                {/* Right: Info */}
                                <div className="flex-1 flex flex-col p-3 relative z-10 min-w-0">
                                  <p className="text-[14px] font-extrabold text-slate-900 uppercase leading-snug line-clamp-2 break-words">{item.name}</p>
                                  {showCodes && item.barcode && (
                                    <p className="text-[11px] font-bold text-slate-700 truncate mt-1 tracking-wider">{item.barcode}</p>
                                  )}
                                  
                                  {/* Bottom right: Price */}
                                  <div className="mt-auto flex justify-end">
                                    <span className="text-[40px] font-black text-slate-900 leading-none tracking-tight">$ {item.salePrice.toLocaleString()}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-auto pt-4 flex justify-between items-center text-slate-400">
                             <p className="text-xs font-bold uppercase tracking-widest">Etiquetas de Góndola</p>
                             <p className="text-xs font-bold">Página {pageIndex + 1} de {Math.ceil(items.length / 14) || 1}</p>
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}

              </div>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @media screen {
          .zoom-wrapper-feed { zoom: 0.3; }
          .zoom-wrapper-story { zoom: 0.25; }
          .zoom-wrapper-print { zoom: 0.4; }

          @media (min-width: 640px) {
             .zoom-wrapper-print { zoom: 0.5; }
          }
          @media (min-width: 768px) {
             .zoom-wrapper-feed { zoom: 0.4; }
             .zoom-wrapper-story { zoom: 0.3; }
             .zoom-wrapper-print { zoom: 0.6; }
          }
          @media (min-width: 1024px) {
             .zoom-wrapper-feed { zoom: 0.45; }
             .zoom-wrapper-story { zoom: 0.35; }
             .zoom-wrapper-print { zoom: 0.7; }
          }
          @media (min-width: 1280px) {
             .zoom-wrapper-feed { zoom: 0.5; }
             .zoom-wrapper-story { zoom: 0.4; }
             .zoom-wrapper-print { zoom: 0.9; }
          }
          @media (min-width: 1536px) {
             .zoom-wrapper-feed { zoom: 0.6; }
          }
        }
        @media print {
          @page { size: auto; margin: 0; }
          body * {
            visibility: hidden;
          }
          .print-area, .print-area * {
            visibility: visible;
          }
          .print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 10mm !important;
            transform: none !important;
            zoom: 1 !important;
          }
        }
      `}} />
    </div>
  );
}

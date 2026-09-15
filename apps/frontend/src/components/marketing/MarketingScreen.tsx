import React, { useEffect, useState } from 'react';
import { useMarketingStore } from '../../stores/marketingStore';
import { Plus, Megaphone, Trash2, Edit2, LayoutGrid, Download, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import MarketingEditor from './MarketingEditor';

export default function MarketingScreen() {
  const { groups, isLoading, fetchGroups, deleteGroup } = useMarketingStore();
  const navigate = useNavigate();
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  if (isCreating || editingGroupId) {
    return (
      <MarketingEditor 
        groupId={editingGroupId} 
        onBack={() => {
          setIsCreating(false);
          setEditingGroupId(null);
          fetchGroups();
        }} 
      />
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4 md:p-6 overflow-hidden bg-slate-50/50">
      {/* Header */}
      <div className="flex items-center justify-between bg-white p-5 rounded-2xl border border-slate-400 shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/products')}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-purple-500 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-rose-500/20">
            <Megaphone className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800">Marketing y Etiquetas</h1>
            <p className="text-sm text-slate-700 font-medium">Gestiona tus listas de precios y etiquetas para impresión.</p>
          </div>
        </div>
        <button 
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 text-white rounded-xl font-bold shadow-md hover:bg-rose-700 hover:shadow-lg transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          <span>Nuevo Grupo</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {isLoading && groups.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-600"></div>
          </div>
        ) : groups.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mb-4">
              <LayoutGrid className="w-10 h-10 text-rose-300" />
            </div>
            <h3 className="text-lg font-bold text-slate-700">Aún no tienes grupos de marketing</h3>
            <p className="text-slate-700 max-w-md mt-2">
              Crea un grupo de productos para generar hermosas listas de precios para Instagram, WhatsApp o para imprimir etiquetas para tu comercio.
            </p>
            <button 
              onClick={() => setIsCreating(true)}
              className="mt-6 px-6 py-2 bg-slate-800 text-white rounded-lg font-semibold hover:bg-slate-700 transition-colors"
            >
              Crear mi primer grupo
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {groups.map(group => (
              <div key={group.id} className="bg-white rounded-2xl border border-slate-400 p-5 shadow-sm hover:shadow-md transition-shadow group flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">{group.name}</h3>
                    {group.description && <p className="text-sm text-slate-700 line-clamp-2 mt-1">{group.description}</p>}
                    <p className="text-xs font-semibold text-rose-600 mt-2 bg-rose-50 inline-block px-2 py-1 rounded-md">
                      {group.items.length} productos
                    </p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => setEditingGroupId(group.id)}
                      className="p-2 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="Editar"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => {
                        if (confirm('¿Seguro que deseas eliminar este grupo?')) {
                          deleteGroup(group.id);
                        }
                      }}
                      className="p-2 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div className="mt-auto pt-4 border-t border-slate-300 grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setEditingGroupId(group.id)}
                    className="flex items-center justify-center gap-2 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold transition-colors"
                  >
                    <Edit2 className="w-4 h-4" /> Editar
                  </button>
                  <button 
                    onClick={() => setEditingGroupId(group.id)}
                    className="flex items-center justify-center gap-2 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-sm font-semibold transition-colors"
                  >
                    <Download className="w-4 h-4" /> Exportar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

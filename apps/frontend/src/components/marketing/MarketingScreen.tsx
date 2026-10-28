import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, LayoutGrid, ArrowLeft, Tag, Image as ImageIcon, FileText, Layers } from 'lucide-react';
import api from '../../services/api';
import { useMarketingStore } from '../../stores/marketingStore';
import MarketingEditor, { type GroupView } from './MarketingEditor';
import ShelfLabelModal from '../products/ShelfLabelModal';

/**
 * Grupos de productos ("Cervezas", "Gaseosas", "Ofertas de la semana"): se arman una vez y
 * sirven para reimprimir las etiquetas cuando cambian los precios (todas o solo las que
 * cambiaron), hacer la imagen para redes y la lista de precios A4.
 */
export default function MarketingScreen() {
  const { groups, isLoading, fetchGroups, deleteGroup } = useMarketingStore();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<{ id: string | null; view: GroupView } | null>(null);
  const [labels, setLabels] = useState<{ ids: string[] } | null>(null);
  // Lo que cambió de precio en la última semana: para avisarlo en cada grupo
  const [changed, setChanged] = useState<Record<string, number | null>>({});

  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useEffect(() => {
    api.get('/products/price-changes', { params: { days: 7 } })
      .then(({ data }) => setChanged(Object.fromEntries((data || []).map((r: any) => [r.id, r.prevSalePrice]))))
      .catch(() => {});
  }, [editing]);

  if (editing) {
    return <MarketingEditor groupId={editing.id} initialView={editing.view} onBack={() => { setEditing(null); fetchGroups(); }} />;
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4 md:p-6 overflow-hidden bg-slate-50/50">
      <div className="flex items-center justify-between gap-3 bg-white p-4 md:p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/products')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-700" title="Volver a Productos"><ArrowLeft className="w-5 h-5" /></button>
          <div className="w-11 h-11 rounded-xl bg-rose-600 flex items-center justify-center text-white shrink-0"><Layers className="w-5 h-5" /></div>
          <div className="min-w-0">
            <h1 className="text-xl font-black text-slate-800">Grupos y carteles</h1>
            <p className="text-[13px] text-slate-600">Armá un grupo (por ejemplo, todas las cervezas) y reimprimí sus etiquetas, hacé la imagen para redes o la lista de precios.</p>
          </div>
        </div>
        <button onClick={() => setEditing({ id: null, view: 'social' })} className="flex items-center gap-2 px-4 py-2.5 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 shrink-0">
          <Plus className="w-5 h-5" /> <span className="hidden sm:inline">Nuevo grupo</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && groups.length === 0 ? (
          <div className="h-full flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-600" /></div>
        ) : groups.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mb-4"><LayoutGrid className="w-10 h-10 text-rose-300" /></div>
            <h3 className="text-lg font-bold text-slate-700">Todavía no armaste ningún grupo</h3>
            <p className="text-slate-600 max-w-md mt-2 text-[14px]">Por ejemplo "Cervezas": la próxima vez que suban, elegís el grupo y reimprimís todas sus etiquetas de una, sin buscarlas una por una.</p>
            <button onClick={() => setEditing({ id: null, view: 'social' })} className="mt-6 px-6 py-2.5 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-700">Armar mi primer grupo</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {groups.map((group) => {
              const ids = group.items.map((i) => i.productId);
              const changedIds = ids.filter((id) => id in changed);
              return (
                <div key={group.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[16px] font-bold text-slate-800 truncate">{group.name}</h3>
                      {group.description && <p className="text-[12.5px] text-slate-600 line-clamp-2 mt-0.5">{group.description}</p>}
                      <p className="text-[12px] text-slate-500 mt-1">{ids.length} {ids.length === 1 ? 'producto' : 'productos'}</p>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <button onClick={() => setEditing({ id: group.id, view: 'social' })} className="p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="Editar el grupo"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => { if (window.confirm(`¿Borrar el grupo "${group.name}"? Los productos no se borran.`)) deleteGroup(group.id); }}
                        className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Borrar el grupo"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  {changedIds.length > 0 && (
                    <button onClick={() => setLabels({ ids: changedIds })}
                      className="mt-3 text-left rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-900 hover:bg-amber-100">
                      <b>{changedIds.length} {changedIds.length === 1 ? 'cambió' : 'cambiaron'} de precio esta semana.</b> Imprimir solo {changedIds.length === 1 ? 'esa etiqueta' : 'esas etiquetas'} →
                    </button>
                  )}
                  <div className="mt-auto pt-3 grid grid-cols-3 gap-2">
                    <button onClick={() => setLabels({ ids })} disabled={!ids.length} className="flex flex-col items-center gap-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[12px] font-bold disabled:opacity-50">
                      <Tag className="w-4 h-4" /> Etiquetas
                    </button>
                    <button onClick={() => setEditing({ id: group.id, view: 'social' })} className="flex flex-col items-center gap-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-[12px] font-semibold">
                      <ImageIcon className="w-4 h-4" /> Para redes
                    </button>
                    <button onClick={() => setEditing({ id: group.id, view: 'list' })} className="flex flex-col items-center gap-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-[12px] font-semibold">
                      <FileText className="w-4 h-4" /> Lista A4
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {labels && <ShelfLabelModal initialProductIds={labels.ids} prevPrices={changed} onClose={() => setLabels(null)} />}
    </div>
  );
}

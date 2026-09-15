import { useState } from 'react';
import { 
  ClipboardCheck, 
  Download, 
  Upload, 
  CheckCircle2, 
  Play, 
  History, 
  Search, 
  Calendar, 
  Plus, 
  ArrowRight,
  ChevronRight,
  FileText
} from 'lucide-react';

export default function StockAuditScreen() {
  const [currentStep, setCurrentStep] = useState(1);

  return (
    <div className="h-full flex flex-col gap-6 bg-slate-50/30 p-2 overflow-y-auto custom-scrollbar pb-10">
      {/* Header Info */}
      <div className="card p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
           <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-500">
              <ClipboardCheck className="w-6 h-6" />
           </div>
           <div>
              <h3 className="text-sm font-bold text-gray-800">Auditoría de Stock</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Revisión y ajustes de inventario físico</p>
           </div>
        </div>
        <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input type="text" placeholder="Buscar..." className="bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-4 py-2 text-[10px] font-bold outline-none focus:bg-white focus:border-emerald-200 transition-all w-48" />
            </div>
            <button className="p-2 rounded-xl bg-white border border-gray-100 text-gray-400 hover:text-emerald-500 transition-all"><Calendar className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="card px-12 py-8">
        <div className="relative flex items-center justify-between">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-[2px] bg-slate-100" />
          {[
            { step: 1, label: 'Iniciar', icon: Play },
            { step: 2, label: 'Descargar', icon: Download },
            { step: 3, label: 'Importar', icon: Upload },
            { step: 4, label: 'Revisar y Aplicar', icon: CheckCircle2 }
          ].map((s) => (
            <div key={s.step} className="relative z-10 flex flex-col items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-500 ${currentStep >= s.step ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'bg-slate-100 text-slate-600'}`}>
                {currentStep > s.step ? <CheckCircle2 className="w-5 h-5" /> : s.step}
              </div>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${currentStep >= s.step ? 'text-emerald-600' : 'text-slate-300'}`}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Main Action Card */}
      <div className="card p-12 flex flex-col items-center justify-center text-center">
        <div className="w-20 h-20 rounded-2xl bg-emerald-50 flex items-center justify-center mb-8">
           <ClipboardCheck className="w-10 h-10 text-emerald-500" />
        </div>
        <h3 className="text-xl font-bold text-gray-800 tracking-tight mb-2">Iniciar Nueva Auditoría</h3>
        <p className="text-[11px] text-gray-400 font-bold max-w-[340px] leading-relaxed uppercase tracking-widest mb-8">
          Compará tu inventario físico contra el sistema y detectá diferencias automáticamente. 
          <br /><span className="text-emerald-500">La plantilla NO muestra el stock actual para garantizar un conteo honesto.</span>
        </p>
        <button className="px-8 py-4 rounded-2xl bg-emerald-500 text-white font-bold text-sm uppercase tracking-widest flex items-center gap-3 shadow-xl shadow-emerald-200 hover:scale-105 active:scale-95 transition-all">
           <Plus className="w-5 h-5" /> Crear Auditoría
        </button>
      </div>

      {/* Audit History Table */}
      <div className="card flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-50 flex items-center justify-between">
          <h3 className="text-[11px] font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-500" /> Historial de Auditorías
          </h3>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Registro de todas las auditorías realizadas</p>
        </div>
        
        <table className="w-full text-left">
          <thead className="bg-slate-50/50">
            <tr>
              <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Fecha</th>
              <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Auditoría</th>
              <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Productos</th>
              <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Dif.</th>
              <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Mermas</th>
              <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Sobrantes</th>
              <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Valor Neto</th>
              <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Estado</th>
              <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            <tr className="hover:bg-slate-50/50 transition-colors group">
              <td className="px-6 py-4 text-[11px] font-bold text-gray-400">13/05/2026 18:41</td>
              <td className="px-6 py-4">
                 <p className="text-[11px] font-bold text-gray-700">Auditoría 13/5/2026</p>
                 <p className="text-[9px] text-emerald-500 font-bold uppercase tracking-widest">VENTRA POS</p>
              </td>
              <td className="px-6 py-4 text-[11px] font-bold text-gray-600">0</td>
              <td className="px-6 py-4 text-[11px] font-bold text-gray-600">0</td>
              <td className="px-6 py-4">
                 <p className="text-[11px] font-bold text-rose-500">0</p>
                 <p className="text-[9px] text-gray-400 font-bold">$ 0,00</p>
              </td>
              <td className="px-6 py-4">
                 <p className="text-[11px] font-bold text-emerald-500">0</p>
                 <p className="text-[9px] text-gray-400 font-bold">$ 0,00</p>
              </td>
              <td className="px-6 py-4 text-[11px] font-bold text-gray-700">-$ 0,00</td>
              <td className="px-6 py-4">
                 <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[9px] font-bold uppercase tracking-widest">Borrador</span>
              </td>
              <td className="px-6 py-4 text-right">
                 <button className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    Ver detalle <ChevronRight className="w-3.5 h-3.5" />
                 </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { 
  Plus, 
  Minus, 
  Shuffle, 
  Wallet, 
  CreditCard, 
  Smartphone, 
  ArrowUpRight, 
  ArrowDownRight,
  ChevronRight,
  Settings2,
  Lock,
  ArrowRightLeft,
  Building2,
  Box,
  FileText,
  UserCheck,
  TrendingUp,
  Clock
} from 'lucide-react';
import { motion } from 'framer-motion';

export default function TreasuryScreen() {
  return (
    <div className="h-full flex flex-col gap-6 bg-slate-50/30 p-2 overflow-y-auto custom-scrollbar pb-10">
      {/* ATAJOS RAPIDOS */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] px-2">Atajos Rápidos</h3>
        <div className="grid grid-cols-2 gap-4">
          <button className="h-24 bg-rose-600 rounded-xl p-6 text-white text-left shadow-xl shadow-rose-100 flex flex-col justify-between group active:scale-95 transition-all">
            <div className="flex items-center justify-between">
              <FileText className="w-6 h-6 opacity-60 group-hover:scale-110 transition-transform" />
              <ArrowUpRight className="w-4 h-4 opacity-40" />
            </div>
            <div>
              <p className="text-sm font-bold">Nueva Orden de Pago</p>
              <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">Generá una OP correlativa</p>
            </div>
          </button>
          <button className="h-24 bg-[#10b981] rounded-xl p-6 text-white text-left shadow-xl shadow-emerald-100 flex flex-col justify-between group active:scale-95 transition-all">
            <div className="flex items-center justify-between">
              <TrendingUp className="w-6 h-6 opacity-60 group-hover:scale-110 transition-transform" />
              <ArrowDownRight className="w-4 h-4 opacity-40" />
            </div>
            <div>
              <p className="text-sm font-bold">Pagar Deuda Proveedor</p>
              <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">Cancelá cuentas corrientes</p>
            </div>
          </button>
        </div>
      </div>

      {/* CAJAS ACTIVAS */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Cajas activas (1)</h3>
          <button className="text-[10px] font-bold text-rose-500 uppercase tracking-widest flex items-center gap-1 hover:gap-2 transition-all">Ver historial <ChevronRight className="w-3 h-3" /></button>
        </div>
        <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600 font-bold">G</div>
              <div>
                <div className="flex items-center gap-2">
                   <h4 className="text-base font-bold text-gray-800">VENTRA POS</h4>
                   <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 text-[9px] font-bold uppercase tracking-widest">Activa</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Apertura: 18:30 p.m.</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Efectivo en Caja</p>
              <h4 className="text-2xl font-bold text-gray-800 tracking-tighter">$ 30.000</h4>
              <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest mt-1">Inicial: $30.000</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <button className="flex items-center justify-center gap-2 py-3 rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 transition-all">
              <Plus className="w-3.5 h-3.5" /> Ingreso
            </button>
            <button className="flex items-center justify-center gap-2 py-3 rounded-xl border border-rose-100 bg-rose-50 text-rose-600 text-[10px] font-bold uppercase tracking-widest hover:bg-rose-100 transition-all">
              <Minus className="w-3.5 h-3.5" /> Retiro
            </button>
            <button className="flex items-center justify-center gap-2 py-3 rounded-xl border border-rose-100 bg-rose-50 text-rose-600 text-[10px] font-bold uppercase tracking-widest hover:bg-rose-100 transition-all">
              <Shuffle className="w-3.5 h-3.5" /> Transfer.
            </button>
          </div>
        </div>
      </div>

      {/* MOVIMIENTOS MANUALES */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] px-2">Movimientos manuales del mes</h3>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 min-h-[200px] flex flex-col items-center justify-center text-center opacity-40">
           <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mb-4">
              <Clock className="w-6 h-6 text-slate-300" />
           </div>
           <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Sin movimientos manuales en este período</p>
           <p className="text-[9px] text-slate-300 font-bold mt-1">Podés cambiar los filtros del mes</p>
        </div>
      </div>

      {/* CONFIGURACION SECTION */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] px-2">Configuración</h3>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Motivos de Caja', desc: 'Personalizá tus motivos de ingresos y egresos manuales.', icon: Settings2, badge: 'Disponible' },
            { label: 'PIN de Cierre / Retiros', desc: 'Protegé acciones críticas (cierre, retiro, gastos virtuales).', icon: Lock, badge: 'Inactivo', badgeColor: 'bg-slate-100 text-slate-600' },
            { label: 'Destino del Cierre', desc: 'Indicá a dónde va el efectivo al cerrar caja.', icon: ArrowRightLeft, badge: 'Próximamente', badgeColor: 'bg-rose-50 text-rose-400' },
            { label: 'Cuentas Bancarias', desc: 'Cargá tus cuentas (Banco, Mercado Pago, etc.) y conciliá movimientos.', icon: Building2, badge: 'Próximamente', badgeColor: 'bg-rose-50 text-rose-400' }
          ].map((cfg) => (
            <div key={cfg.label} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm group hover:border-rose-100 transition-all flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-gray-400 group-hover:text-rose-500 transition-colors">
                      <cfg.icon className="w-5 h-5" />
                    </div>
                    <h4 className="text-sm font-bold text-gray-800">{cfg.label}</h4>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest ${cfg.badgeColor || 'bg-emerald-100 text-emerald-600'}`}>{cfg.badge}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 leading-relaxed pr-6">{cfg.desc}</p>
              </div>
              <button className="text-[10px] font-bold text-rose-500 uppercase tracking-widest flex items-center gap-1 mt-6 group-hover:gap-2 transition-all">Configurar <ChevronRight className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      </div>
      
      <div className="px-4 py-3 bg-rose-50/50 rounded-2xl border border-rose-100/50 flex items-center gap-3">
        <TrendingUp className="w-5 h-5 text-rose-500" />
        <p className="text-[10px] font-bold text-rose-600 leading-relaxed">
          Tip: Tesorería es el centro neurálgico para mantener tu contabilidad limpia. Configurá motivos custom para tipificar mejor los movimientos de caja, y activá el PIN admin para proteger los retiros y gastos virtuales.
        </p>
      </div>
    </div>
  );
}

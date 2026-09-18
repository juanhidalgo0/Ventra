import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, Upload, FileSpreadsheet, Download, Loader2, AlertTriangle, XCircle, CheckCircle2, PlusCircle, RefreshCw, ArrowLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { downloadFromApi } from '../../utils/download';

interface Issue {
  row: number;
  codigo: string | null;
  nombre: string;
  action: 'CREATE' | 'UPDATE' | 'SKIP';
  errors: string[];
  warnings: string[];
}

interface Preview {
  source: 'VENTRA' | 'MODPRESUP';
  total: number;
  created: number;
  updated: number;
  skipped: number;
  withWarnings: number;
  issuesTruncated: boolean;
  issues: Issue[];
  presentColumns: string[];
  notInFile: number;
  newNames: { categories: string[]; brands: string[]; suppliers: string[] };
}

interface VentraImportModalProps {
  onClose: () => void;
  /** Arranca la importación real; el progreso lo muestra la pantalla de productos */
  onConfirm: (file: File, updateStock: boolean) => void;
  onLegacyImport: () => void;
}

const ACTION_LABEL: Record<Issue['action'], string> = { CREATE: 'Nuevo', UPDATE: 'Actualiza', SKIP: 'Se omite' };

export default function VentraImportModal({ onClose, onConfirm, onLegacyImport }: VentraImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'errors' | 'warnings'>('errors');
  const [updateStock, setUpdateStock] = useState(true);

  const analyze = async (f: File) => {
    setFile(f);
    setPreview(null);
    setError(null);
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', f);
      const { data } = await api.post<Preview>('/products/import/ventra/preview', formData);
      setPreview(data);
      setTab(data.skipped > 0 ? 'errors' : 'warnings');
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo leer el archivo');
    } finally {
      setIsLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const downloadReport = () => {
    if (!preview) return;
    const esc = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = ['fila;codigo;nombre;accion;errores;advertencias'];
    for (const i of preview.issues) {
      lines.push([i.row, esc(i.codigo), esc(i.nombre), ACTION_LABEL[i.action], esc(i.errors.join(' | ')), esc(i.warnings.join(' | '))].join(';'));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reporte_importacion_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadTemplate = async () => {
    try {
      await downloadFromApi('/products/import/ventra/template', 'ventra_plantilla_productos.xlsx');
    } catch {
      toast.error('No se pudo descargar la plantilla');
    }
  };

  const errorIssues = preview?.issues.filter(i => i.errors.length > 0) || [];
  const warningIssues = preview?.issues.filter(i => i.errors.length === 0 && i.warnings.length > 0) || [];
  const shownIssues = tab === 'errors' ? errorIssues : warningIssues;
  const importable = preview ? preview.created + preview.updated : 0;
  const newNames = preview?.newNames;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
              <FileSpreadsheet className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Importar productos</h2>
              <p className="text-xs text-slate-500">Formato Ventra (.xlsx) o base de modpresup (.mdb) · se revisa todo antes de guardar</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.mdb"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) analyze(f); }}
        />

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {!preview && (
            <>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => inputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) analyze(f); }}
                className="w-full border-2 border-dashed border-slate-300 rounded-xl py-10 flex flex-col items-center gap-2 hover:border-emerald-500 hover:bg-emerald-50/40 transition-colors disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                    <span className="text-sm font-semibold text-slate-700">Analizando {file?.name}...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-slate-400" />
                    <span className="text-sm font-semibold text-slate-700">Elegí o arrastrá el archivo .xlsx o .mdb</span>
                    <span className="text-xs text-slate-500">Todavía no se guarda nada: primero vas a ver qué cambia</span>
                    <span className="text-[11px] text-slate-400">De modpresup usá el archivo <b>provlocal.mdb</b> de su carpeta Data (con el programa cerrado)</span>
                  </>
                )}
              </button>

              {error && (
                <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <button onClick={downloadTemplate} className="flex items-center gap-1.5 font-semibold text-emerald-700 hover:underline">
                  <Download className="w-3.5 h-3.5" /> Descargar plantilla vacía
                </button>
                <button onClick={onLegacyImport} className="text-slate-500 hover:text-slate-700 hover:underline">
                  Importar desde otro formato (DBF / CSV antiguo)
                </button>
              </div>
            </>
          )}

          {preview && (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-slate-600 truncate">
                  <span className="font-semibold text-slate-800">{file?.name}</span> · {preview.total} productos
                  {preview.source === 'MODPRESUP' && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold align-middle">Convertido desde modpresup</span>
                  )}
                </p>
                <button
                  onClick={() => { setPreview(null); setFile(null); }}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 shrink-0"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Elegir otro archivo
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <SummaryCard icon={<PlusCircle className="w-4 h-4" />} label="Nuevos" value={preview.created} tone="emerald" />
                <SummaryCard icon={<RefreshCw className="w-4 h-4" />} label="Se actualizan" value={preview.updated} tone="sky" />
                <SummaryCard icon={<AlertTriangle className="w-4 h-4" />} label="Con advertencias" value={preview.withWarnings} tone="amber" />
                <SummaryCard icon={<XCircle className="w-4 h-4" />} label="Con errores (se omiten)" value={preview.skipped} tone="red" />
              </div>

              {newNames && (newNames.categories.length + newNames.brands.length + newNames.suppliers.length > 0) && (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                  <p className="font-semibold text-slate-700">Se van a crear:</p>
                  {newNames.categories.length > 0 && <NameList label="Rubros" names={newNames.categories} />}
                  {newNames.brands.length > 0 && <NameList label="Marcas" names={newNames.brands} />}
                  {newNames.suppliers.length > 0 && <NameList label="Proveedores" names={newNames.suppliers} />}
                </div>
              )}

              {preview.notInFile > 0 && (
                <p className="text-xs text-slate-500">
                  Hay {preview.notInFile} productos en Ventra que no están en el archivo: no se modifican ni se borran.
                </p>
              )}

              {(errorIssues.length > 0 || warningIssues.length > 0) && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between bg-slate-50 border-b border-slate-200 px-2">
                    <div className="flex">
                      {([['errors', `Errores (${errorIssues.length})`], ['warnings', `Advertencias (${warningIssues.length})`]] as const).map(([id, label]) => (
                        <button
                          key={id}
                          onClick={() => setTab(id)}
                          className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors ${tab === id ? (id === 'errors' ? 'border-red-500 text-red-700' : 'border-amber-500 text-amber-700') : 'border-transparent text-slate-500'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button onClick={downloadReport} className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 px-2">
                      <Download className="w-3.5 h-3.5" /> Reporte .csv
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {shownIssues.length === 0 && (
                      <p className="text-xs text-slate-500 p-4 text-center">Sin {tab === 'errors' ? 'errores' : 'advertencias'}.</p>
                    )}
                    {shownIssues.map(i => (
                      <div key={i.row} className="px-3 py-2 text-xs">
                        <div className="flex items-baseline gap-2">
                          <span className="text-slate-400 font-mono shrink-0">Fila {i.row}</span>
                          {i.codigo && <span className="font-mono font-semibold text-slate-700 shrink-0">{i.codigo}</span>}
                          <span className="text-slate-800 truncate">{i.nombre || '(sin nombre)'}</span>
                          <span className="ml-auto text-[10px] font-semibold text-slate-500 shrink-0">{ACTION_LABEL[i.action]}</span>
                        </div>
                        {[...i.errors.map(m => ['e', m]), ...i.warnings.map(m => ['w', m])].map(([kind, msg], idx) => (
                          <p key={idx} className={`mt-0.5 ${kind === 'e' ? 'text-red-600' : 'text-amber-700'}`}>• {msg}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                  {preview.issuesTruncated && (
                    <p className="text-[11px] text-slate-500 px-3 py-2 border-t border-slate-200">Se muestran los primeros {preview.issues.length} casos.</p>
                  )}
                </div>
              )}

              {preview.updated > 0 && preview.presentColumns.includes('stock') && (
                <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer select-none">
                  <input type="checkbox" checked={updateStock} onChange={e => setUpdateStock(e.target.checked)} className="mt-1 accent-emerald-600" />
                  <span>
                    Reemplazar el stock de los productos que ya existen
                    <span className="block text-xs text-slate-500">Destildalo si el archivo tiene precios nuevos pero el stock de Ventra está más actualizado.</span>
                  </span>
                </label>
              )}
            </>
          )}
        </div>

        {preview && (
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {importable > 0 ? `Se van a guardar ${importable} productos.` : 'No hay productos válidos para importar.'}
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                Cancelar
              </button>
              <button
                disabled={importable === 0 || !file}
                onClick={() => file && onConfirm(file, updateStock)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-4 h-4" /> Importar {importable}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

const TONES = {
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  sky: 'bg-sky-50 border-sky-200 text-sky-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  red: 'bg-red-50 border-red-200 text-red-700',
};

function SummaryCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: keyof typeof TONES }) {
  return (
    <div className={`rounded-xl border p-3 ${TONES[tone]}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold">{icon}{label}</div>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function NameList({ label, names }: { label: string; names: string[] }) {
  const shown = names.slice(0, 12);
  return (
    <p>
      <span className="font-semibold">{label} ({names.length}):</span> {shown.join(', ')}{names.length > shown.length ? '…' : ''}
    </p>
  );
}

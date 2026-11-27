import { useState } from 'react';
import { FileSpreadsheet, FileText, Loader2, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { downloadReport, type Report } from '../../utils/report';

type Builder = () => Report | null | undefined | Promise<Report | null | undefined>;

async function run(build: Builder, kind: 'xlsx' | 'pdf') {
  const report = await build();
  if (!report) { toast.error('No hay datos para descargar'); return; }
  await downloadReport(report, kind);
  toast.success(kind === 'xlsx' ? 'Excel descargado' : 'PDF descargado');
}

/**
 * Botones "Excel" y "PDF" de un informe. `build` arma el informe con lo que se ve en
 * pantalla (puede ser async si tiene que traer más datos).
 *  - default: dos botones con texto (barra de herramientas de escritorio)
 *  - compact: dos botones chicos (encabezados de modales y tarjetas)
 *  - header: un botón redondo blanco translúcido con menú (encabezado verde del celular)
 */
export default function ExportButtons({ build, variant = 'default', disabled, className = '' }: {
  build: Builder;
  variant?: 'default' | 'compact' | 'header';
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [open, setOpen] = useState(false);

  const go = async (kind: 'xlsx' | 'pdf') => {
    if (busy || disabled) return;
    setOpen(false);
    setBusy(kind);
    try {
      await run(build, kind);
    } catch (e) {
      console.error('Export error', e);
      toast.error('No se pudo armar el archivo');
    } finally {
      setBusy(null);
    }
  };

  if (variant === 'header') {
    return (
      <div className={`relative ${className}`}>
        <button onClick={() => setOpen((o) => !o)} disabled={disabled} aria-label="Descargar Excel o PDF" aria-expanded={open}
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:scale-95 disabled:opacity-40">
          {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Download className="w-[18px] h-[18px]" />}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-12 z-50 w-48 rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden text-slate-800">
              <button onClick={() => go('xlsx')} className="w-full px-4 py-3 flex items-center gap-2.5 text-[14px] font-semibold hover:bg-slate-50 active:bg-slate-100">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Descargar Excel
              </button>
              <button onClick={() => go('pdf')} className="w-full px-4 py-3 flex items-center gap-2.5 text-[14px] font-semibold hover:bg-slate-50 active:bg-slate-100 border-t border-slate-100">
                <FileText className="w-4 h-4 text-rose-600" /> Descargar PDF
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  const compact = variant === 'compact';
  const base = compact
    ? 'h-8 px-2.5 rounded-lg text-[11px] gap-1'
    : 'h-9 px-3 rounded-xl text-[12.5px] gap-1.5';
  const icon = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <div className={`flex items-center gap-1.5 shrink-0 ${className}`}>
      <button onClick={() => go('xlsx')} disabled={disabled || !!busy} title="Descargar en Excel (.xlsx)"
        className={`${base} inline-flex items-center font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm cursor-pointer active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed`}>
        {busy === 'xlsx' ? <Loader2 className={`${icon} animate-spin`} /> : <FileSpreadsheet className={`${icon} text-emerald-600`} />} Excel
      </button>
      <button onClick={() => go('pdf')} disabled={disabled || !!busy} title="Descargar en PDF"
        className={`${base} inline-flex items-center font-bold bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600 shadow-sm cursor-pointer active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed`}>
        {busy === 'pdf' ? <Loader2 className={`${icon} animate-spin`} /> : <FileText className={icon} />} PDF
      </button>
    </div>
  );
}

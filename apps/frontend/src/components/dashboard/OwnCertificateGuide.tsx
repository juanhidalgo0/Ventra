import { useState } from 'react';
import { Check, Copy, Download, FileUp, KeyRound, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

/**
 * Certificado propio del comercio, paso a paso. Ventra arma la clave y el pedido (la clave no
 * sale del servidor del comercio), el comercio lo sube a ARCA con su clave fiscal, carga el
 * certificado que le dan y lo habilita para factura electrónica. No se autoriza a nadie.
 */
interface Props {
  config: any;
  onConfig: (config: any) => void;
  onTest: () => void;
  testing: boolean;
}

const fecha = (d: any) => (d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

function download(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/pkcs10' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** El certificado como lo descargó: texto PEM o el archivo binario (va en base64) */
async function readCertificate(file: File): Promise<{ certPem?: string; certDerBase64?: string }> {
  const text = await file.text();
  if (text.includes('-----BEGIN CERTIFICATE-----')) return { certPem: text };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { certDerBase64: btoa(bin) };
}

export default function OwnCertificateGuide({ config, onConfig, onTest, testing }: Props) {
  const [busy, setBusy] = useState<'request' | 'install' | null>(null);
  const [pasted, setPasted] = useState('');
  const homo = config.environment !== 'PRODUCCION';
  const installed = config.hasOwnCertificate && config.certSource === 'OWN';
  const pending = !!config.hasPendingRequest;
  const fileName = `ventra-${config.cuit}.csr`;
  const missingData = !config.cuit || !config.razonSocial;
  const daysLeft = config.certExpiresAt ? Math.floor((new Date(config.certExpiresAt).getTime() - Date.now()) / 86400000) : null;
  const alias = config.certAlias || 'ventra';

  const request = async () => {
    setBusy('request');
    try {
      const { data } = await api.post('/fiscal/certificate/request');
      onConfig(data.config);
      download(data.csr, data.fileName);
      toast.success('Pedido generado: se descargó el archivo para subir a ARCA');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo generar el pedido');
    } finally {
      setBusy(null);
    }
  };

  const install = async (body: { certPem?: string; certDerBase64?: string }) => {
    setBusy('install');
    try {
      const { data } = await api.post('/fiscal/certificate', body);
      onConfig(data);
      setPasted('');
      toast.success('Certificado cargado. Falta habilitarlo para factura electrónica (paso 4)');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cargar el certificado', { duration: 8000 });
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file?: File | null) => {
    if (!file) return;
    install(await readCertificate(file));
  };

  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success('Copiado'));

  const step = (n: number, done: boolean, title: string, body: any, active = true) => (
    <li className={`flex gap-3 ${active ? '' : 'opacity-50'}`}>
      <span className={`w-6 h-6 rounded-full text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5 ${done ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}`}>
        {done ? <Check className="w-3.5 h-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-[12.5px] font-bold text-slate-800 dark:text-slate-100">{title}</p>
        <div className="text-[12px] text-slate-600 dark:text-slate-300 leading-snug space-y-1.5">{body}</div>
      </div>
    </li>
  );
  const btn = 'h-8 px-3 rounded-lg text-[12px] font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-3">
      {installed && (
        <div className={`p-2.5 rounded-lg text-[12px] flex items-start gap-2 ${daysLeft != null && daysLeft < 45 ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-emerald-50 border border-emerald-200 text-emerald-900'}`}>
          {daysLeft != null && daysLeft < 45 ? <AlertTriangle className="w-4 h-4 shrink-0 mt-px" /> : <KeyRound className="w-4 h-4 shrink-0 mt-px" />}
          <span>
            <strong>Certificado propio cargado</strong>{config.certCuit ? ` · CUIT ${config.certCuit}` : ''} · vence el {fecha(config.certExpiresAt)}.
            {daysLeft != null && daysLeft < 45 && ' Renovalo antes: generá un pedido nuevo y seguí los mismos pasos (el actual sigue andando hasta que cargues el nuevo).'}
          </span>
        </div>
      )}

      <ol className="space-y-3.5">
        {step(1, pending || installed, 'Generá el pedido de certificado', (
          <>
            <p>Ventra arma la clave y el pedido a nombre de tu CUIT. La clave queda guardada en tu Ventra y nunca se comparte.</p>
            {missingData ? (
              <p className="text-amber-700 font-semibold">Primero completá y guardá la CUIT y la razón social (arriba).</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button onClick={request} disabled={busy !== null} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>
                  {busy === 'request' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {pending || installed ? 'Generar un pedido nuevo' : 'Generar y descargar el pedido'}
                </button>
                {pending && config.pendingCsr && (
                  <>
                    <button onClick={() => download(config.pendingCsr, fileName)} className={`${btn} border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`}><Download className="w-3.5 h-3.5" /> Descargar de nuevo</button>
                    <button onClick={() => copy(config.pendingCsr)} className={`${btn} border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`}><Copy className="w-3.5 h-3.5" /> Copiar el texto</button>
                  </>
                )}
              </div>
            )}
            {pending && <p className="text-slate-500">Pedido generado el {fecha(config.pendingAt)}: archivo <strong>{fileName}</strong>.</p>}
          </>
        ), true)}

        {step(2, installed && !pending, homo ? 'Subilo a ARCA (homologación, para probar)' : 'Subilo a ARCA', homo ? (
          <ol className="list-decimal list-inside space-y-1">
            <li>Entrá a <strong>arca.gob.ar</strong> con tu clave fiscal y abrí <strong>WSASS - Autogestión Certificados Homologación</strong> (si no está, agregalo en <em>Administrador de Relaciones de Clave Fiscal → Adherir servicio</em>).</li>
            <li>Tocá <strong>Nuevo certificado</strong>, poné como nombre <strong>{alias}</strong> y pegá el texto del pedido (botón <em>Copiar el texto</em>).</li>
            <li>Tocá <strong>Crear DN y obtener certificado</strong> y copiá el certificado que aparece.</li>
          </ol>
        ) : (
          <ol className="list-decimal list-inside space-y-1">
            <li>Entrá a <strong>arca.gob.ar</strong> con la CUIT <strong>{config.cuit || 'del comercio'}</strong> y tu clave fiscal (nivel 3).</li>
            <li>Abrí <strong>Administración de Certificados Digitales</strong>. Si no está: <em>Administrador de Relaciones de Clave Fiscal → Adherir servicio → ARCA → Servicios interactivos</em>, y volvé a entrar.</li>
            <li>Tocá <strong>Agregar alias</strong>, poné <strong>{alias}</strong>, elegí el archivo <strong>{fileName}</strong> y confirmá.</li>
            <li>En el alias tocá <strong>Ver</strong> y descargá el certificado.</li>
          </ol>
        ), pending || installed)}

        {step(3, installed && !pending, 'Cargá el certificado que te dio ARCA', (
          <>
            <label className={`${btn} border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 ${!pending && !installed ? 'pointer-events-none' : ''}`}>
              {busy === 'install' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />} Elegir el archivo del certificado
              <input type="file" accept=".crt,.pem,.cer,.cert" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <div className="flex gap-2">
              <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={2} placeholder="O pegá acá el texto del certificado (-----BEGIN CERTIFICATE-----…)"
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-850 text-[11px] font-mono outline-none focus:border-emerald-500" />
              <button onClick={() => install({ certPem: pasted })} disabled={!pasted.trim() || busy !== null} className={`${btn} bg-slate-900 text-white self-start`}>Cargar</button>
            </div>
          </>
        ), pending || installed)}

        {step(4, false, 'Habilitalo para factura electrónica', homo ? (
          <p>En WSASS tocá <strong>Crear autorización a servicio</strong>: computador <strong>{alias}</strong>, servicio <strong>wsfe - Facturación Electrónica</strong>, y confirmá.</p>
        ) : (
          <p>En <strong>Administrador de Relaciones de Clave Fiscal → Nueva relación</strong>: en <em>Servicio</em> buscá <strong>ARCA → WebServices → Facturación Electrónica</strong>; en <em>Representante</em> elegí el computador fiscal <strong>{alias}</strong> y confirmá.</p>
        ), installed)}

        {step(5, false, 'Probá la conexión', (
          <>
            <p>Revisa todo sin emitir ningún comprobante y te dice qué falta (por ejemplo, el punto de venta para web services).</p>
            <button onClick={onTest} disabled={!installed || testing} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Probar conexión
            </button>
          </>
        ), installed)}
      </ol>
    </div>
  );
}

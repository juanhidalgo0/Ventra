import * as fs from 'fs';
import * as path from 'path';

/**
 * Restauración diferida de un backup.
 *
 * En Windows, SQLite puede dejar los archivos -wal/-shm tomados un rato después de
 * cerrar la conexión, y reemplazar la base con esos archivos vivos al lado la
 * corrompe. Cuando no se pueden liberar, el backup queda "en espera" y se aplica
 * al arrancar la aplicación, que es el único momento en el que nadie tiene la
 * base abierta.
 */

export const PENDING_SUFFIX = '.restore-pending';

export function pendingRestorePaths(dbPath: string) {
  return { data: `${dbPath}${PENDING_SUFFIX}`, marker: `${dbPath}${PENDING_SUFFIX}.json` };
}

/** Deja el backup listo para aplicarse en el próximo arranque. */
export function stagePendingRestore(dbPath: string, backupFilePath: string, filename: string) {
  const { data, marker } = pendingRestorePaths(dbPath);
  fs.copyFileSync(backupFilePath, data);
  fs.writeFileSync(marker, JSON.stringify({ filename, stagedAt: new Date().toISOString() }, null, 2), 'utf8');
}

/**
 * Se llama al iniciar, ANTES de abrir la base. Si hay un backup en espera, lo
 * pone en su lugar y borra los archivos de transacción viejos.
 */
export function applyPendingRestore(dbPath: string): { applied: boolean; filename?: string; error?: string } {
  const { data, marker } = pendingRestorePaths(dbPath);
  if (!fs.existsSync(marker) || !fs.existsSync(data)) return { applied: false };

  let filename: string | undefined;
  try {
    filename = JSON.parse(fs.readFileSync(marker, 'utf8')).filename;
  } catch {}

  try {
    /*
     * La copia previa tiene que incluir los archivos de transacción.
     *
     * En modo WAL, dev.db por sí solo puede estar casi vacío: lo vendido desde el
     * último volcado vive en dev.db-wal. Copiar únicamente dev.db y después borrar
     * el -wal deja una "copia de seguridad" sin los datos recientes, y el borrado
     * es irreversible. Se guardan los tres juntos: así la copia se puede restaurar.
     */
    if (fs.existsSync(dbPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const prefijo = `${dbPath}.before-restore-${stamp}`;
      try {
        fs.copyFileSync(dbPath, prefijo);
        for (const suffix of ['-wal', '-shm']) {
          const file = `${dbPath}${suffix}`;
          if (fs.existsSync(file)) fs.copyFileSync(file, `${prefijo}${suffix}`);
        }
      } catch (err: any) {
        // Sin copia previa completa no se sigue: reemplazar la base sería irreversible.
        console.error('[PendingRestore] No se pudo guardar la copia previa, se cancela:', err.message);
        return { applied: false, filename, error: `No se pudo resguardar la base actual: ${err.message}` };
      }
    }

    for (const suffix of ['-wal', '-shm', '-journal']) {
      const file = `${dbPath}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    fs.copyFileSync(data, dbPath);
    fs.unlinkSync(data);
    fs.unlinkSync(marker);
    console.log(`[PendingRestore] Backup restaurado al iniciar: ${filename || path.basename(data)}`);
    return { applied: true, filename };
  } catch (err: any) {
    console.error('[PendingRestore] No se pudo aplicar el backup en espera:', err.message);
    return { applied: false, filename, error: err.message };
  }
}

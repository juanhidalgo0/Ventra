import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaService } from '../../database/prisma.service';

interface BackupSettings {
  autoBackupEnabled: boolean;
  backupTime: string; // formato "HH:MM"
}

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private backupDir = '';
  private settingsFile = '';
  private cronJobName = 'dailyBackupJob';

  constructor(
    private schedulerRegistry: SchedulerRegistry,
    private prismaService: PrismaService
  ) {
    // Almacenar backups en la raíz del proyecto para máxima seguridad y fácil acceso
    this.backupDir = path.join(process.cwd(), 'backups');
    this.settingsFile = path.join(this.backupDir, 'backup-settings.json');

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  onModuleInit() {
    console.log('[BackupService] Inicializando gestor de backups...');
    this.initCronJobFromSettings();
  }

  onModuleDestroy() {
    this.stopCronJob();
  }

  /**
   * Obtiene la ruta física del archivo SQLite local.
   */
  private getDbPath(): string {
    // Resolver DATABASE_URL (ej: "file:./dev.db?connection_limit=1")
    const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
    const dbUrlWithoutQuery = dbUrl.split('?')[0];
    let cleanPath = dbUrlWithoutQuery.replace('file:', '');
    
    // Si la ruta es relativa, la resolvemos desde apps/backend/prisma
    if (!path.isAbsolute(cleanPath)) {
      cleanPath = path.join(process.cwd(), 'prisma', cleanPath);
    }
    
    return path.normalize(cleanPath);
  }

  /**
   * Obtiene la configuración guardada de backups.
   */
  getBackupSettings(): BackupSettings {
    if (fs.existsSync(this.settingsFile)) {
      try {
        const content = fs.readFileSync(this.settingsFile, 'utf8');
        return JSON.parse(content);
      } catch (err) {
        console.error('[BackupService] Error leyendo settings de backup:', err);
      }
    }
    // Valores por defecto
    return {
      autoBackupEnabled: false,
      backupTime: '22:00', // 10 PM
    };
  }

  /**
   * Guarda y actualiza la configuración de backups y regenera el Cron Job.
   */
  async updateBackupSettings(enabled: boolean, time: string): Promise<BackupSettings> {
    const settings: BackupSettings = { autoBackupEnabled: enabled, backupTime: time };
    fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2), 'utf8');
    
    // Regenerar tarea programada
    this.initCronJobFromSettings();
    return settings;
  }

  /**
   * Inicia o actualiza el Cron Job basado en los settings guardados.
   */
  private initCronJobFromSettings() {
    this.stopCronJob();

    const settings = this.getBackupSettings();
    if (!settings.autoBackupEnabled) {
      console.log('[BackupService] Backups automáticos desactivados en configuración.');
      return;
    }

    try {
      const [hours, minutes] = settings.backupTime.split(':').map(Number);
      // Cron expression: "segundos minutos horas * * *" (todos los días a esa hora)
      const cronExpression = `0 ${minutes} ${hours} * * *`;

      console.log(`[BackupService] Programando backup diario a las ${settings.backupTime} (Cron: "${cronExpression}")`);

      const job = new CronJob(cronExpression, async () => {
        console.log('[BackupService] [Cron] Iniciando backup automático programado diario...');
        try {
          await this.createBackup('AUTOMATIC');
        } catch (err: any) {
          console.error('[BackupService] [Cron] Error en backup automático programado:', err.message);
        }
      });

      this.schedulerRegistry.addCronJob(this.cronJobName, job);
      job.start();
    } catch (err: any) {
      console.error('[BackupService] Error inicializando Cron Job:', err.message);
    }
  }

  /**
   * Detiene y elimina el Cron Job programado si existe.
   */
  private stopCronJob() {
    try {
      if (this.schedulerRegistry.doesExist('cron', this.cronJobName)) {
        const job = this.schedulerRegistry.getCronJob(this.cronJobName);
        job.stop();
        this.schedulerRegistry.deleteCronJob(this.cronJobName);
        console.log('[BackupService] Tarea de backup anterior detenida.');
      }
    } catch (err) {}
  }

  /**
   * Crea una copia física de la base de datos local SQLite de forma limpia y segura.
   */
  async createBackup(type: 'MANUAL' | 'AUTOMATIC' | 'SAFETY' = 'MANUAL'): Promise<{ filename: string; path: string; size: number }> {
    // Checkpoint SQLite WAL first to merge all pending transactions into the main database file
    try {
      console.log('[BackupService] Ejecutando checkpoint de SQLite para consolidar el archivo WAL...');
      await this.prismaService.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (err: any) {
      console.warn('[BackupService] No se pudo hacer checkpoint de WAL:', err.message);
    }

    const dbPath = this.getDbPath();
    
    if (!fs.existsSync(dbPath)) {
      throw new Error(`La base de datos original no existe en la ruta esperada: ${dbPath}`);
    }

    // Nombre de archivo con fecha y hora argentina format compatible
    const date = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    const filename = `backup_${type.toLowerCase()}_${timestamp}.db`;
    const destPath = path.join(this.backupDir, filename);

    // Copiado físico binario directo al directorio local por defecto
    fs.copyFileSync(dbPath, destPath);

    let finalPath = destPath;

    // Si es un backup manual y estamos corriendo dentro del proceso fork de Electron
    if (type === 'MANUAL' && process.send) {
      const chosenPath = await new Promise<string | null>((resolve) => {
        const handler = (msg: any) => {
          if (msg && msg.type === 'SELECT_SAVE_PATH_RESPONSE') {
            process.off('message', handler);
            resolve(msg.path);
          }
        };
        process.on('message', handler);
        process.send!({ type: 'SELECT_SAVE_PATH', defaultName: filename });
        // Cancelar por timeout a los 60 segundos
        setTimeout(() => {
          process.off('message', handler);
          resolve(null);
        }, 60000);
      });

      if (!chosenPath) {
        // Eliminar la copia local generada por defecto si el usuario canceló el diálogo
        try { fs.unlinkSync(destPath); } catch {}
        throw new Error('Copia de seguridad cancelada por el usuario.');
      }

      // Guardar copia física en la ruta externa seleccionada
      fs.copyFileSync(dbPath, chosenPath);
      finalPath = chosenPath;
    }
    
    const stats = fs.statSync(destPath);
    console.log(`[BackupService] [${type}] Copia de seguridad guardada con éxito en: ${finalPath} (Tamaño: ${stats.size} bytes)`);

    // Mantener sólo los últimos 15 backups automáticos para optimizar almacenamiento local
    if (type === 'AUTOMATIC') {
      this.cleanupOldAutomaticBackups();
    }

    return {
      filename,
      path: finalPath,
      size: stats.size,
    };
  }

  /**
   * Lista todos los backups disponibles ordenados del más reciente al más antiguo.
   */
  async listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    
    const files = fs.readdirSync(this.backupDir);
    const dbBackups = files
      .filter((file) => file.startsWith('backup_') && file.endsWith('.db'))
      .map((file) => {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);
        let typeStr = 'AUTOMÁTICO';
        if (file.includes('_manual_')) typeStr = 'MANUAL';
        else if (file.includes('_safety_')) typeStr = 'SEGURIDAD (PRE-RESTORE)';
        else if (file.includes('_uploaded_')) typeStr = 'SUBIDO';
        return {
          filename: file,
          size: stats.size,
          createdAt: stats.birthtime,
          type: typeStr,
        };
      });

    // Ordenar por fecha de creación descendente (más recientes primero)
    return dbBackups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Retorna la ruta absoluta a un archivo de backup específico.
   */
  getBackupFilePath(filename: string): string {
    const safeFilename = path.basename(filename);
    const fullPath = path.join(this.backupDir, safeFilename);
    if (!fs.existsSync(fullPath)) {
      throw new Error('Archivo de backup no encontrado');
    }
    return fullPath;
  }

  /**
   * Limpia los backups automáticos antiguos, reteniendo los 15 más recientes.
   */
  private cleanupOldAutomaticBackups() {
    try {
      const files = fs.readdirSync(this.backupDir);
      const autoBackups = files
        .filter((file) => file.startsWith('backup_automatic_') && file.endsWith('.db'))
        .map((file) => {
          const filePath = path.join(this.backupDir, file);
          return {
            filename: file,
            filePath,
            createdAt: fs.statSync(filePath).birthtime,
          };
        })
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); // Más viejos primero

      // Si superamos el límite (15), borramos los excedentes más viejos
      const MAX_BACKUPS = 15;
      if (autoBackups.length > MAX_BACKUPS) {
        const toDelete = autoBackups.slice(0, autoBackups.length - MAX_BACKUPS);
        toDelete.forEach((backup) => {
          fs.unlinkSync(backup.filePath);
          console.log(`[BackupService] Backup automático antiguo eliminado por rotación: ${backup.filename}`);
        });
      }
    } catch (err: any) {
      console.error('[BackupService] Error rotando backups antiguos:', err.message);
    }
  }

  /**
   * Helper to check if a file is a valid SQLite database
   */
  private isValidSqlite(filePath: string): boolean {
    try {
      const buffer = Buffer.alloc(16);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);
      return buffer.toString('ascii', 0, 15) === 'SQLite format 3';
    } catch (err) {
      return false;
    }
  }

  /**
   * Restores a backup file by copying it over the active SQLite database file.
   */
  async restoreBackup(filename: string): Promise<{ success: boolean; message: string }> {
    const backupFilePath = this.getBackupFilePath(filename);

    if (!fs.existsSync(backupFilePath)) {
      throw new Error('El archivo de backup especificado no existe.');
    }

    if (!this.isValidSqlite(backupFilePath)) {
      throw new Error('El archivo seleccionado no es una base de datos SQLite válida.');
    }

    const dbPath = this.getDbPath();

    // 1. Create a safety backup of the active database before overwriting
    try {
      await this.createBackup('SAFETY'); // Save current state as safety backup
    } catch (err: any) {
      console.warn('[BackupService] No se pudo crear backup de seguridad previo al restore:', err.message);
    }

    try {
      // 2. Disconnect Prisma
      console.log('[BackupService] Desconectando Prisma antes de restaurar...');
      await this.prismaService.$disconnect();

      // 3. Wait a brief moment to ensure all locks are released
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 4. Overwrite active database file
      console.log(`[BackupService] Restaurando base de datos desde ${backupFilePath} hacia ${dbPath}...`);
      
      // Clean up SQLite WAL and journal files to prevent database corruption on replace
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      const journalPath = `${dbPath}-journal`;
      if (fs.existsSync(walPath)) {
        try { fs.unlinkSync(walPath); } catch {}
      }
      if (fs.existsSync(shmPath)) {
        try { fs.unlinkSync(shmPath); } catch {}
      }
      if (fs.existsSync(journalPath)) {
        try { fs.unlinkSync(journalPath); } catch {}
      }

      fs.copyFileSync(backupFilePath, dbPath);

      // 5. Reconnect Prisma
      console.log('[BackupService] Reconectando Prisma...');
      await this.prismaService.$connect();

      return {
        success: true,
        message: 'Base de datos restaurada con éxito.',
      };
    } catch (err: any) {
      console.error('[BackupService] Error durante la restauración:', err);
      // Try to reconnect no matter what
      try {
        await this.prismaService.$connect();
      } catch {}
      throw new Error(`Error en el proceso de restauración: ${err.message}`);
    }
  }

  /**
   * Recibe un buffer de archivo subido, lo guarda localmente y lo restaura.
   */
  async restoreFromUploadedFile(fileBuffer: Buffer, originalName: string): Promise<{ success: boolean; message: string; filename: string }> {
    const date = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    
    const ext = path.extname(originalName).toLowerCase();
    if (ext !== '.db' && ext !== '.sqlite') {
      throw new Error('El archivo debe tener extensión .db o .sqlite');
    }

    const filename = `backup_uploaded_${timestamp}.db`;
    const destPath = path.join(this.backupDir, filename);

    // Guardar el buffer en el directorio de backups
    fs.writeFileSync(destPath, fileBuffer);

    // Validar que sea SQLite válido
    if (!this.isValidSqlite(destPath)) {
      try {
        fs.unlinkSync(destPath);
      } catch {}
      throw new Error('El archivo cargado no es una base de datos SQLite válida.');
    }

    // Ejecutar la restauración
    const restoreResult = await this.restoreBackup(filename);

    return {
      success: true,
      message: 'Base de datos subida y restaurada con éxito.',
      filename,
    };
  }
}

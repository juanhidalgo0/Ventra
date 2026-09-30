import { Controller, Get, Post, Body, Res, BadRequestException, Query, UseInterceptors, UploadedFile, UseGuards, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import { randomBytes } from 'crypto';
import { BackupService } from './backup.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

// La descarga se abre en el navegador del sistema, que no tiene la sesión de la app:
// el administrador pide un pase de un solo uso que vale un minuto para ese archivo.
const DOWNLOAD_TICKET_MS = 60 * 1000;

@Controller('system/backup')
export class BackupController {
  private downloadTickets = new Map<string, { filename: string; expiresAt: number }>();

  constructor(private readonly backupService: BackupService) {}

  @Get('list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async listBackups() {
    return this.backupService.listBackups();
  }

  @Post('create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async createManualBackup() {
    try {
      const result = await this.backupService.createBackup('MANUAL');
      return {
        success: true,
        message: 'Backup creado con éxito',
        ...result,
      };
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Error al generar el backup');
    }
  }

  @Post('download-ticket')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  createDownloadTicket(@Body('filename') filename: string) {
    if (!filename) {
      throw new BadRequestException('Nombre de archivo obligatorio');
    }
    try {
      this.backupService.getBackupFilePath(filename);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Archivo de backup no encontrado');
    }
    const now = Date.now();
    for (const [key, t] of this.downloadTickets) if (t.expiresAt < now) this.downloadTickets.delete(key);
    const ticket = randomBytes(32).toString('hex');
    this.downloadTickets.set(ticket, { filename, expiresAt: now + DOWNLOAD_TICKET_MS });
    return { ticket };
  }

  @Get('download')
  async downloadBackup(@Res() res: Response, @Query('ticket') ticket: string) {
    const entry = ticket ? this.downloadTickets.get(ticket) : undefined;
    if (entry) this.downloadTickets.delete(ticket);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new UnauthorizedException('El enlace de descarga venció. Volvé a descargar el backup desde la app.');
    }
    const filename = entry.filename;
    try {
      const filePath = this.backupService.getBackupFilePath(filename);
      return res.download(filePath);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Error al descargar el backup');
    }
  }

  @Post('restore/select')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async restoreSelect(@Body('filename') filename: string) {
    if (!filename) {
      throw new BadRequestException('Nombre de archivo obligatorio');
    }
    try {
      return await this.backupService.restoreBackup(filename);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Error al restaurar la copia de seguridad');
    }
  }

  @Post('restore/upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file'))
  async restoreUpload(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Debe subir un archivo de base de datos válido (.db o .sqlite)');
    }
    try {
      return await this.backupService.restoreFromUploadedFile(file.buffer, file.originalname);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Error al procesar y restaurar el archivo');
    }
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getSettings(): Promise<{ autoBackupEnabled: boolean; backupTime: string }> {
    return this.backupService.getBackupSettings();
  }

  @Post('settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async saveSettings(@Body() data: { autoBackupEnabled: boolean; backupTime: string }): Promise<{ success: boolean; message: string; settings: { autoBackupEnabled: boolean; backupTime: string } }> {
    if (data.autoBackupEnabled && !data.backupTime) {
      throw new BadRequestException('La hora del backup es obligatoria');
    }
    
    // Validar formato HH:MM
    if (data.backupTime && !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(data.backupTime)) {
      throw new BadRequestException('Formato de hora incorrecto. Use HH:MM');
    }

    const updated = await this.backupService.updateBackupSettings(data.autoBackupEnabled, data.backupTime);
    return {
      success: true,
      message: 'Configuración de backup guardada',
      settings: updated,
    };
  }
}

import { Controller, Get, Post, Body, Res, BadRequestException, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { Response } from 'express';
import { BackupService } from './backup.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('system/backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get('list')
  async listBackups() {
    return this.backupService.listBackups();
  }

  @Post('create')
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

  @Get('download')
  async downloadBackup(@Res() res: Response, @Query('filename') filename: string) {
    if (!filename) {
      throw new BadRequestException('Nombre de archivo obligatorio');
    }
    try {
      const filePath = this.backupService.getBackupFilePath(filename);
      return res.download(filePath);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Error al descargar el backup');
    }
  }

  @Post('restore/select')
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
  async getSettings(): Promise<{ autoBackupEnabled: boolean; backupTime: string }> {
    return this.backupService.getBackupSettings();
  }

  @Post('settings')
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

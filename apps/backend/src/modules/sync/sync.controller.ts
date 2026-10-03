import { BadRequestException, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { SyncService } from './sync.service';

@Controller('sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private sync: SyncService) {}

  @Get('status')
  status() {
    return this.sync.getStatus();
  }

  @Post('now')
  now() {
    return this.sync.syncNow();
  }

  // La llama el actualizador antes de cerrar el servidor
  @Post('pause')
  pause() {
    return this.sync.pauseForShutdown();
  }

  // Reemplaza los datos de esta caja por los de la nube: solo el administrador
  @Post('restore')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async restore() {
    try {
      return await this.sync.restoreFromCloud();
    } catch (err: any) {
      throw new BadRequestException(err.response?.data?.error || err.message || 'No se pudieron recuperar los datos');
    }
  }
}

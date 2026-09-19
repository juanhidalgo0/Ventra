import { BadRequestException, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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

  @Post('restore')
  async restore() {
    try {
      return await this.sync.restoreFromCloud();
    } catch (err: any) {
      throw new BadRequestException(err.response?.data?.error || err.message || 'No se pudieron recuperar los datos');
    }
  }
}

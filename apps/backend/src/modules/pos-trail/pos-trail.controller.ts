import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { PosTrailService } from './pos-trail.service';

/** Control de anulaciones. Registrar lo hace cualquier caja; ver y ajustar, solo el dueño. */
@Controller('pos-trail')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PosTrailController {
  constructor(private trail: PosTrailService) {}

  @Post()
  ingest(@Request() req, @Body('events') events: any[]) {
    return this.trail.ingest(req.user?.sub, events);
  }

  @Get()
  @Roles('ADMIN')
  list(@Query('from') from?: string, @Query('to') to?: string, @Query('userId') userId?: string, @Query('level') level?: string) {
    return this.trail.list({ from, to, userId, level });
  }

  @Post('settings')
  @Roles('ADMIN')
  settings(@Body('bigAmount') bigAmount: number) {
    return this.trail.setBigAmount(bigAmount);
  }
}

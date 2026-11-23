import { Controller, Get, Post, Body, Request, UseGuards, ServiceUnavailableException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { agendaStaffIdOf } from '../agenda-pros/agenda-pros.store';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private subscription: SubscriptionService, private prisma: PrismaService) {}

  @Get('status')
  status() {
    // Si está vencido pregunta a la nube antes de contestar: así los días o el plan que se cambian desde el admin se ven enseguida
    return this.subscription.freshStatus();
  }

  // Vincular la PC a una cuenta le da a esa cuenta todos los datos del comercio: solo el administrador
  @Post('link/start')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async startLink() {
    try {
      return await this.subscription.startLink();
    } catch {
      throw new ServiceUnavailableException('No hay conexión con ventra.store. Revisá internet y probá de nuevo.');
    }
  }

  /** Sesión de la cuenta para la tienda online. { linked: false } si esta instalación no está vinculada. */
  @Post('store-session')
  async storeSession(@Request() req: any, @Body() body: { legacyStoreId?: string; legacyIdToken?: string }) {
    // Demo pública: nunca una sesión de la cuenta. La app de la demo usa su Firebase local
    // (VENTRA_DEMO); cualquier otra se niega a seguir al ver demo: true (ver ventraFirebase.ts).
    if (process.env.DEMO_MODE === 'true') return { linked: false, demo: true };
    // La agenda de turnos también vive en la tienda (ventra_stores): necesita la misma sesión
    const { features } = this.subscription.getStatus();
    if (!features.tienda && !features.agenda) {
      throw new ForbiddenException({
        code: 'PLAN_NO_TIENDA',
        message: 'Tu plan Ventra Caja no incluye la tienda online. Pasate al plan Full en ventra.store para usarla.',
      });
    }
    // Profesional de la agenda (barbero, estilista...): una sesión que solo ve y toca sus turnos.
    // Con el candado la llamada viaja con el token del administrador, así que el dueño ve todo.
    const proStaffId = await agendaStaffIdOf(this.prisma, req.user);
    try {
      const session = await this.subscription.storeSession({
        ...(proStaffId ? { proStaffId } : {}),
        legacyStoreId: typeof body?.legacyStoreId === 'string' ? body.legacyStoreId : undefined,
        legacyIdToken: typeof body?.legacyIdToken === 'string' ? body.legacyIdToken : undefined,
      });
      return session ? { linked: true, ...session } : { linked: false };
    } catch {
      throw new ServiceUnavailableException('No se pudo conectar con la tienda online. Revisá internet y probá de nuevo.');
    }
  }

  @Post('refresh')
  refresh() {
    return this.subscription.refresh();
  }
}

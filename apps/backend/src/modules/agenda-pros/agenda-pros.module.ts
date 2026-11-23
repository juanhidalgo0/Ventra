import { BadRequestException, Body, ConflictException, Controller, Get, Module, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { PrismaService } from '../../database/prisma.service';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { StaffDevicesModule, StaffDevicesService } from '../staff-devices/staff-devices.module';
import { SubscriptionService } from '../subscription/subscription.service';
import { readAgendaPros, writeAgendaPros, STAFF_ID_RE } from './agenda-pros.store';

/**
 * Acceso de cada profesional de la agenda (barbero, estilista...) a sus propios turnos desde su
 * celular. El dueño, desde la agenda: "Darle acceso" crea un usuario de la caja para ese
 * profesional, lo vincula (store_settings agenda_pros) y da un QR de un solo uso para su celular
 * (los mismos "Celulares de empleados"). Al entrar con ese usuario, la nube le da una sesión que
 * solo ve y toca los turnos de ese profesional (ventraStoreSession + firestore.rules).
 */
@Controller('agenda-pros')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgendaProsController {
  constructor(private prisma: PrismaService, private users: UsersService, private devices: StaffDevicesService, private subscription: SubscriptionService) {}

  /** Profesionales con acceso: { staffId, userId, username, isActive } */
  @Get()
  @Roles('ADMIN')
  async list() {
    const map = await readAgendaPros(this.prisma);
    const ids = Object.keys(map);
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, isActive: true } }) : [];
    return users.map((u) => ({ staffId: map[u.id], userId: u.id, username: u.username, isActive: u.isActive }));
  }

  /**
   * Le da acceso a un profesional: usuario nuevo (o el que ya tenía, con la clave nueva) y un QR
   * para su celular. { staffId, staffName, username, password }
   */
  @Post('grant')
  @Roles('ADMIN')
  async grant(@Request() req: any, @Body() body: { staffId?: string; staffName?: string; username?: string; password?: string }) {
    const staffId = String(body?.staffId || '');
    if (!STAFF_ID_RE.test(staffId)) throw new BadRequestException('Profesional inválido');
    const staffName = String(body?.staffName || '').trim().slice(0, 60) || 'profesional';
    const password = String(body?.password || '');
    const map = await readAgendaPros(this.prisma);
    const currentUserId = Object.keys(map).find((u) => map[u] === staffId);
    const current = currentUserId ? await this.prisma.user.findUnique({ where: { id: currentUserId } }) : null;

    let user: { id: string; username: string };
    if (current && current.role !== 'ADMIN') {
      // Ya tenía usuario: se reactiva y, si vino una clave, se cambia
      user = await this.users.update(current.id, { isActive: true, ...(password ? { password } : {}) }, req.user?.sub || null);
    } else {
      const username = String(body?.username || '').trim().replace(/\s+/g, '');
      if (!username) throw new BadRequestException('Poné un nombre de usuario');
      if (!password) throw new BadRequestException('Poné una clave (solo números)');
      try {
        user = await this.users.create({ username, password, fullName: username, role: 'CASHIER' }, req.user?.sub || null);
      } catch (err) {
        if (err instanceof ConflictException) throw new ConflictException('Ese nombre de usuario ya existe: elegí otro');
        throw err;
      }
    }

    // Un usuario por profesional y un profesional por usuario
    for (const [u, s] of Object.entries(map)) if (s === staffId || u === user.id) delete map[u];
    map[user.id] = staffId;
    await writeAgendaPros(this.prisma, map);

    return { staffId, userId: user.id, username: user.username, ...(await this.qrFor(staffName)) };
  }

  /** Otro QR para el mismo profesional (celular nuevo, o se venció el anterior). { staffId, staffName } */
  @Post('qr')
  @Roles('ADMIN')
  async qr(@Body() body: { staffId?: string; staffName?: string }) {
    const staffId = String(body?.staffId || '');
    const map = await readAgendaPros(this.prisma);
    if (!Object.values(map).includes(staffId)) throw new BadRequestException('Ese profesional todavía no tiene acceso');
    return this.qrFor(String(body?.staffName || '').trim().slice(0, 60) || 'profesional');
  }

  /** Le saca el acceso: se desvincula y su usuario queda desactivado (no puede entrar más). { staffId } */
  @Post('revoke')
  @Roles('ADMIN')
  async revoke(@Request() req: any, @Body() body: { staffId?: string }) {
    const staffId = String(body?.staffId || '');
    const map = await readAgendaPros(this.prisma);
    const userIds = Object.keys(map).filter((u) => map[u] === staffId);
    for (const u of userIds) delete map[u];
    await writeAgendaPros(this.prisma, map);
    for (const u of userIds) {
      const user = await this.prisma.user.findUnique({ where: { id: u }, select: { role: true } });
      if (user && user.role !== 'ADMIN') await this.users.update(u, { isActive: false }, req.user?.sub || null);
    }
    // En la nube: se borra su registro y se cortan sus sesiones. Sin internet, la app del dueño lo reintenta.
    const cloud = await this.subscription.revokeAgendaPro(staffId).catch(() => false);
    return { ok: true, cloud };
  }

  /** QR para el celular. Si la caja no está vinculada a la nube, el acceso queda igual y se avisa. */
  private async qrFor(staffName: string) {
    try {
      const { link, expiresInSeconds } = await this.devices.pair(`Celular de ${staffName}`);
      return { link, expiresInSeconds, warning: null as string | null };
    } catch (err: any) {
      return { link: null, expiresInSeconds: 0, warning: String(err?.response?.message || err?.message || 'No se pudo generar el QR') };
    }
  }
}

@Module({ imports: [UsersModule, StaffDevicesModule], controllers: [AgendaProsController] })
export class AgendaProsModule {}

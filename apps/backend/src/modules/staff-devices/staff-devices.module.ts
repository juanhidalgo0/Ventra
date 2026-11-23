import { BadRequestException, Body, Controller, Get, HttpException, Injectable, Module, Param, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import axios from 'axios';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { SubscriptionService } from '../subscription/subscription.service';

const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';
/** Dirección de la caja web: el link del celular del empleado va ahí */
const WEB_URL = process.env.VENTRA_WEB_URL || 'https://web.ventra.store';

/**
 * Celulares de empleados: para que entren a la caja web desde su teléfono sin la cuenta de
 * Google del dueño. El dueño genera un código de un solo uso (QR o link, 15 minutos); el celular
 * que lo abre queda habilitado para este comercio y el empleado entra con su usuario y contraseña.
 * Los códigos y la lista viven en la nube de Ventra (ventraStaffDevices); acá se pide con las
 * credenciales de esta caja.
 */
@Injectable()
export class StaffDevicesService {
  constructor(private subscription: SubscriptionService) {}

  private async call(action: 'pair' | 'list' | 'revoke', body: Record<string, unknown> = {}) {
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) throw new BadRequestException('Para habilitar celulares, esta caja tiene que estar vinculada a tu cuenta de Ventra (Configuración → Suscripción y nube).');
    try {
      const { data } = await axios.post(`${FUNCTIONS_URL}/ventraStaffDevices`, { ...creds, action, ...body }, { timeout: 20_000 });
      return data;
    } catch (err: any) {
      const status = err?.response?.status;
      const message = err?.response?.data?.error;
      if (status && message) throw new HttpException(message, status >= 500 ? 503 : status);
      throw new ServiceUnavailableException('No se pudo conectar con la nube de Ventra. Revisá internet y probá de nuevo.');
    }
  }

  async pair(name?: string) {
    const data = await this.call('pair', name ? { name: String(name).slice(0, 60) } : {});
    return { link: `${WEB_URL}/_ventra/staff?t=${data.code}`, expiresInSeconds: data.expiresInSeconds };
  }

  async list() {
    return (await this.call('list')).devices || [];
  }

  async revoke(id: string) {
    return this.call('revoke', { id });
  }
}

@Controller('staff-devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffDevicesController {
  constructor(private service: StaffDevicesService) {}

  @Get()
  @Roles('ADMIN')
  list() { return this.service.list(); }

  @Post('pair')
  @Roles('ADMIN')
  pair(@Body('name') name?: string) { return this.service.pair(name); }

  @Post(':id/revoke')
  @Roles('ADMIN')
  revoke(@Param('id') id: string) { return this.service.revoke(id); }
}

@Module({ controllers: [StaffDevicesController], providers: [StaffDevicesService], exports: [StaffDevicesService] })
export class StaffDevicesModule {}

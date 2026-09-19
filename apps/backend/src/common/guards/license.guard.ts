import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { SubscriptionService } from '../../modules/subscription/subscription.service';

// Con la suscripción vencida (pasada la gracia) la app queda en solo lectura:
// se puede consultar todo, pero no vender ni registrar nada. Se permite lo
// necesario para entrar, renovar/vincular y resguardar los datos (backups).
const ALLOWED_WHEN_READ_ONLY = ['/api/auth/', '/api/subscription/', '/api/system/', '/api/sync/'];

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private subscription: SubscriptionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;

    const path = String(req.originalUrl || req.url || '').split('?')[0];
    if (ALLOWED_WHEN_READ_ONLY.some((p) => path.startsWith(p))) return true;

    if (this.subscription.isReadOnly()) {
      const needsLink = this.subscription.getStatus().state === 'NEEDS_LINK';
      throw new HttpException({
        statusCode: HttpStatus.FORBIDDEN,
        code: 'SUBSCRIPTION_READ_ONLY',
        message: needsLink
          ? 'Esta PC todavía no está vinculada a tu cuenta de Ventra. Entrá a Configuración → Suscripción y nube y tocá "Vincular esta PC" para empezar a vender.'
          : 'Tu suscripción de Ventra venció y terminaron los días de gracia: la app está en modo solo lectura. Renová en ventra.store para seguir vendiendo.',
      }, HttpStatus.FORBIDDEN);
    }
    return true;
  }
}

import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { SubscriptionService } from '../../modules/subscription/subscription.service';

// Con la suscripción vencida (pasada la gracia) la app queda en solo lectura:
// se puede consultar todo, pero no vender ni registrar nada. Se permite lo
// necesario para entrar, renovar/vincular y resguardar los datos (backups).
const ALLOWED_WHEN_READ_ONLY = ['/api/auth/', '/api/subscription/', '/api/system/', '/api/sync/'];

// Lo que solo incluye el plan Caja (sistema de ventas). Con el plan Tienda se pueden
// consultar, pero no registrar. Productos, stock, categorías y promociones son de los dos.
const CAJA_ONLY = ['/api/cash', '/api/sales', '/api/fiscal', '/api/acopio', '/api/clients', '/api/purchases', '/api/suppliers', '/api/surcharges', '/api/quotes'];
const isUnder = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(p + '/'));

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private subscription: SubscriptionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;

    const path = String(req.originalUrl || req.url || '').split('?')[0];
    if (ALLOWED_WHEN_READ_ONLY.some((p) => path.startsWith(p))) return true;

    if (!this.subscription.getStatus().features.caja && isUnder(path, CAJA_ONLY)) {
      throw new HttpException({
        statusCode: HttpStatus.FORBIDDEN,
        code: 'PLAN_NO_CAJA',
        message: 'Tu plan Ventra Tienda no incluye el sistema de ventas. Pasate al plan Full en ventra.store para usar la caja.',
      }, HttpStatus.FORBIDDEN);
    }

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

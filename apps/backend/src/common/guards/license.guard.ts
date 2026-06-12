import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { LicenseService } from '../../modules/auth/license.service';

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private licenseService: LicenseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const url = request.url;

    // Skip license checks for authentication and license endpoints
    if (
      url.includes('/auth/license') ||
      url.includes('/auth/login') ||
      url.includes('/auth/init-status') ||
      url.includes('/auth/register-first-admin') ||
      url.includes('/auth/refresh')
    ) {
      return true;
    }

    const status = await this.licenseService.getLicenseStatus();
    if (!status.isActive) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          message: status.isClockTampered 
            ? 'Reloj del sistema alterado detectado. Corrige la hora en tu PC.' 
            : 'Licencia mensual vencida o no activa. Por favor, realiza el pago.',
          error: 'Payment Required',
          machineUuid: status.machineUuid,
          expiresAt: status.expiresAt,
          isClockTampered: status.isClockTampered
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }
}

import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { LicenseService } from '../../modules/auth/license.service';

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private licenseService: LicenseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    return true;
  }
}

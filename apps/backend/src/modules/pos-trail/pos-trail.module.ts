import { Global, Module } from '@nestjs/common';
import { PosTrailController } from './pos-trail.controller';
import { PosTrailService } from './pos-trail.service';

// Global: el borrado de productos (ProductsService) también se registra acá
@Global()
@Module({
  controllers: [PosTrailController],
  providers: [PosTrailService],
  exports: [PosTrailService],
})
export class PosTrailModule {}

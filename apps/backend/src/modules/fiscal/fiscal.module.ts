import { Module } from '@nestjs/common';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';
import { WsaaService } from './wsaa.service';
import { WsfeService } from './wsfe.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FiscalController],
  providers: [FiscalService, WsaaService, WsfeService],
  exports: [FiscalService],
})
export class FiscalModule {}

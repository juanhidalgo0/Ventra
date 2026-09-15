import { Module } from '@nestjs/common';
import { AcopioService } from './acopio.service';
import { AcopioController } from './acopio.controller';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AcopioController],
  providers: [AcopioService],
  exports: [AcopioService],
})
export class AcopioModule {}

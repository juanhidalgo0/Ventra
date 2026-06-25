import { Module } from '@nestjs/common';
import { SurchargesController } from './surcharges.controller';
import { SurchargesService } from './surcharges.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SurchargesController],
  providers: [SurchargesService],
  exports: [SurchargesService],
})
export class SurchargesModule {}

import { AiModule } from '../ai/ai.module';
import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { ScanJobsService } from './scan-jobs.service';
import { PrismaModule } from '../../database/prisma.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [PrismaModule, ProductsModule, AiModule],
  controllers: [PurchasesController],
  providers: [PurchasesService, ScanJobsService],
  exports: [PurchasesService],
})
export class PurchasesModule {}

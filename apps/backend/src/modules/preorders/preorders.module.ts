import { Module } from '@nestjs/common';
import { PreOrdersController } from './preorders.controller';
import { PreOrdersService } from './preorders.service';
import { DeliveryRunsController } from './delivery-runs.controller';
import { DeliveryRunsService } from './delivery-runs.service';
import { DistribReportsService } from './distrib-reports.service';
import { TodayService } from './today.service';
import { PrismaModule } from '../../database/prisma.module';
import { SalesModule } from '../sales/sales.module';
import { FiscalModule } from '../fiscal/fiscal.module';

@Module({
  imports: [PrismaModule, SalesModule, FiscalModule],
  controllers: [PreOrdersController, DeliveryRunsController],
  providers: [PreOrdersService, DeliveryRunsService, TodayService, DistribReportsService],
})
export class PreOrdersModule {}

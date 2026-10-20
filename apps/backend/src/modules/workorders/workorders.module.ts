import { Module } from '@nestjs/common';
import { WorkOrdersController } from './workorders.controller';
import { WorkOrdersService } from './workorders.service';
import { PrismaModule } from '../../database/prisma.module';
import { SalesModule } from '../sales/sales.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [PrismaModule, SalesModule, SubscriptionModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
})
export class WorkOrdersModule {}

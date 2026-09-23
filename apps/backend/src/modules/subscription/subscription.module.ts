import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { NotifyService } from './notify.service';

@Global()
@Module({
  providers: [SubscriptionService, NotifyService],
  controllers: [SubscriptionController],
  exports: [SubscriptionService, NotifyService],
})
export class SubscriptionModule {}

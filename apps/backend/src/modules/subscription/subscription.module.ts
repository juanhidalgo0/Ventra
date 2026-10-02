import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { NotifyService } from './notify.service';
import { NotificationsController } from './notifications.controller';

@Global()
@Module({
  providers: [SubscriptionService, NotifyService],
  controllers: [SubscriptionController, NotificationsController],
  exports: [SubscriptionService, NotifyService],
})
export class SubscriptionModule {}

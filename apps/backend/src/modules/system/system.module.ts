import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SystemController } from './system.controller';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { DemoResetService } from './demo-reset.service';
import { AuthModule } from '../auth/auth.module';
import { ProductsModule } from '../products/products.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    ProductsModule,
    SyncModule,
  ],
  controllers: [SystemController, BackupController],
  providers: [BackupService, DemoResetService],
  exports: [BackupService],
})
export class SystemModule {}

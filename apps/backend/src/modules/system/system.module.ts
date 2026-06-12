import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SystemController } from './system.controller';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
  ],
  controllers: [SystemController, BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class SystemModule {}

import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ContactImportController } from './contact-import.controller';
import { ContactImportService } from './contact-import.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClientsController, ContactImportController],
  providers: [ClientsService, ContactImportService],
  exports: [ClientsService],
})
export class ClientsModule {}

import { Module } from '@nestjs/common';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [QuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}

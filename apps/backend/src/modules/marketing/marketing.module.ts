import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [MarketingController],
  providers: [MarketingService, PrismaService],
})
export class MarketingModule {}

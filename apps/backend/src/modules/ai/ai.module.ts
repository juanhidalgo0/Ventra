import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { WebsocketModule } from '../../websockets/websocket.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { InsightsService } from './insights.service';
import { PriceListService } from './price-list.service';

@Module({
  imports: [PrismaModule, WebsocketModule],
  controllers: [AiController],
  providers: [AiService, InsightsService, PriceListService],
  exports: [AiService],
})
export class AiModule {}

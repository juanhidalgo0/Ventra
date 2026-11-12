import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { WebsocketModule } from '../../websockets/websocket.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { InsightsService } from './insights.service';
import { PriceListService } from './price-list.service';
import { ProductMatcherService } from './product-matcher.service';
import { SharedCatalogService } from '../products/shared-catalog.service';

@Module({
  imports: [PrismaModule, WebsocketModule],
  controllers: [AiController],
  // SharedCatalogService: el mapa compartido de códigos de proveedor (tanda 3 de boletas)
  providers: [AiService, InsightsService, PriceListService, ProductMatcherService, SharedCatalogService],
  exports: [AiService, ProductMatcherService],
})
export class AiModule {}

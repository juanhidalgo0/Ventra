import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { WebsocketModule } from '../../websockets/websocket.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [WebsocketModule, ProductsModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}

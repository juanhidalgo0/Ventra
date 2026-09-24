import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { WebsocketModule } from '../../websockets/websocket.module';
import { ProductsModule } from '../products/products.module';
import { CashRegisterModule } from '../cash-register/cash-register.module';

@Module({
  imports: [WebsocketModule, ProductsModule, CashRegisterModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { SalesModule } from './modules/sales/sales.module';
import { CashRegisterModule } from './modules/cash-register/cash-register.module';
import { SystemModule } from './modules/system/system.module';
import { ClientsModule } from './modules/clients/clients.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { WebsocketModule } from './websockets/websocket.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { APP_GUARD } from '@nestjs/core';
import { LicenseGuard } from './common/guards/license.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    AuthModule,
    CashRegisterModule,
    CategoriesModule,
    ClientsModule,
    PrismaModule,
    ProductsModule,
    PurchasesModule,
    SalesModule,
    SuppliersModule,
    SystemModule,
    UsersModule,
    WebsocketModule,
    PromotionsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: LicenseGuard,
    },
  ],
})
export class AppModule {}

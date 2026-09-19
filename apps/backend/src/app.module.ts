import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { BrandsModule } from './modules/brands/brands.module';
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
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { SyncModule } from './modules/sync/sync.module';

import { MarketingModule } from './modules/marketing/marketing.module';
import { SurchargesModule } from './modules/surcharges/surcharges.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { AcopioModule } from './modules/acopio/acopio.module';

@Module({
  imports: [
    SubscriptionModule,
    SyncModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    AuthModule,
    BrandsModule,
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
    MarketingModule,
    SurchargesModule,
    QuotesModule,
    AcopioModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: LicenseGuard,
    },
  ],
})
export class AppModule {}

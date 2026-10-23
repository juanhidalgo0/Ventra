import { ProductImagesController } from './product-images.controller';
import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { FirebaseSyncService } from './firebase-sync.service';
import { SyncImageService } from './sync-image.service';
import { SharedCatalogService } from './shared-catalog.service';
import { VentraImportService } from './ventra-import.service';
import { HardwareImageService } from './hardware-image.service';
import { ProductsController } from './products.controller';
import { SyncController } from './sync.controller';
import { WebsocketModule } from '../../websockets/websocket.module';

@Module({
  imports: [WebsocketModule],
  controllers: [ProductsController, SyncController, ProductImagesController],
  providers: [ProductsService, FirebaseSyncService, SyncImageService, SharedCatalogService, VentraImportService, HardwareImageService],
  exports: [ProductsService, FirebaseSyncService, SyncImageService, SharedCatalogService],
})
export class ProductsModule {}

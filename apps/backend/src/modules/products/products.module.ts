import { ProductMergeService } from './product-merge.service';
import { ProductImagesController } from './product-images.controller';
import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { FirebaseSyncService } from './firebase-sync.service';
import { SyncImageService } from './sync-image.service';
import { SharedCatalogService } from './shared-catalog.service';
import { VentraImportService } from './ventra-import.service';
import { HardwareImageService } from './hardware-image.service';
import { PriceEditorService } from './price-editor.service';
import { ProductsController } from './products.controller';
import { SyncController } from './sync.controller';
import { WebsocketModule } from '../../websockets/websocket.module';
import { GoModule } from '../go/go.module';

@Module({
  imports: [WebsocketModule, GoModule],
  controllers: [ProductsController, SyncController, ProductImagesController],
  providers: [ProductsService, FirebaseSyncService, SyncImageService, SharedCatalogService, VentraImportService, HardwareImageService, PriceEditorService, ProductMergeService],
  exports: [ProductsService, FirebaseSyncService, SyncImageService, SharedCatalogService],
})
export class ProductsModule {}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { FirebaseSyncService } from './firebase-sync.service';
import axios from 'axios';

@Injectable()
export class SyncImageService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private firebaseSync: FirebaseSyncService,
  ) {}

  // Helper: Clean product names for search engines
  cleanName(name: string): string {
    if (!name) return '';
    let cleaned = name.toLowerCase();
    
    // 1. Remove multipliers like "x 20", "x20", "x 6"
    cleaned = cleaned.replace(/\bx\s*\d+\b/gi, ' ');
    
    // 2. Remove decimals/weights/volumes like "1.5 l", "1,5lt", "500gr", "473ml", "1.35 lts", "30 sobres"
    cleaned = cleaned.replace(/\d+([.,]\d+)?\s*(gr|g|kg|kgs|l|lt|lts|ml|cc|un|u|sobres|sob)\b/gi, ' ');
    
    // 3. Remove isolated letters that are units
    cleaned = cleaned.replace(/\b(gr|g|kg|l|lt|lts|ml|cc|un|u)\b/gi, ' ');
    
    // 4. Remove all non-alphanumeric characters, except spaces. Keep Spanish characters (áéíóúñü).
    cleaned = cleaned.replace(/[^a-z0-9áéíóúñü\s]/gi, ' ');
    
    // 5. Collapse spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned.toUpperCase();
  }

  // Helper: Strict matching validator
  isStrictMatch(query: string, resultName: string): boolean {
    const qClean = this.cleanName(query).toLowerCase();
    const rClean = this.cleanName(resultName).toLowerCase();
    
    const words = qClean.split(' ').filter(w => w.length >= 3);
    if (words.length === 0) return false;
    
    // First brand/major word must be present
    const firstWord = words[0];
    if (rClean.includes(firstWord)) {
      return true;
    }
    
    // Or at least 50% of the major words must be present
    let matches = 0;
    for (const word of words) {
      if (rClean.includes(word)) matches++;
    }
    
    return (matches / words.length) >= 0.5;
  }

  // Helper: Validate if a string is a standard numeric EAN/UPC barcode
  isValidNumericBarcode(barcode: string): boolean {
    if (!barcode) return false;
    return /^\d+$/.test(barcode) && barcode.length >= 8;
  }

  // 1. Barcode EAN Lookup: Open Food Facts Argentina
  async fetchImageFromOpenFoodFacts(barcode: string): Promise<string | null> {
    try {
      const url = `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'MaxikioscoPaulos/1.0 (NestJS Backend; admin@paulospos.com)' },
        timeout: 4000,
      });
      if (response.data && response.data.status === 1 && response.data.product) {
        const product = response.data.product;
        const imageUrl = product.image_url || product.image_front_url || product.image_small_url;
        if (imageUrl) {
          console.log(`[OFF Barcode] ${barcode} matches: ${product.product_name || ''}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      console.error(`[OFF Barcode] Error searching ${barcode}:`, err.message);
    }
    return null;
  }

  // 2. Barcode EAN Lookup: Carrefour Argentina VTEX EAN Search
  async fetchImageFromCarrefourByBarcode(barcode: string): Promise<string | null> {
    try {
      const url = `https://www.carrefour.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 5000,
      });

      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        const item = firstProduct.items?.[0];
        const imageUrl = item?.images?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`[Carrefour Barcode] Match for EAN "${barcode}": ${firstProduct.productName}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      console.error(`[Carrefour Barcode] Error searching EAN "${barcode}":`, err.message);
    }
    return null;
  }

  // 3. Barcode EAN Lookup: Farmacity Argentina VTEX EAN Search (For Drugstore/OTC items)
  async fetchImageFromFarmacityByBarcode(barcode: string): Promise<string | null> {
    try {
      const url = `https://www.farmacity.com/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 5000,
      });

      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        const item = firstProduct.items?.[0];
        const imageUrl = item?.images?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`[Farmacity Barcode] Match for EAN "${barcode}": ${firstProduct.productName}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      console.error(`[Farmacity Barcode] Error searching EAN "${barcode}":`, err.message);
    }
    return null;
  }

  // 4. High-Precision Name Lookup: Carrefour Argentina VTEX Search
  async fetchImageFromCarrefourByName(name: string): Promise<string | null> {
    try {
      const query = this.cleanName(name);
      const url = `https://www.carrefour.com.ar/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 5000,
      });

      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        if (this.isStrictMatch(name, firstProduct.productName)) {
          const item = firstProduct.items?.[0];
          const imageUrl = item?.images?.[0]?.imageUrl;
          if (imageUrl) {
            console.log(`[Carrefour Name] Verified Match for "${name}": ${firstProduct.productName}`);
            return imageUrl;
          }
        } else {
          console.log(`[Carrefour Name] Match rejected for "${name}" (returned: "${firstProduct.productName}")`);
        }
      }
    } catch (err: any) {
      console.error(`[Carrefour Name] Error searching name "${name}":`, err.message);
    }
    return null;
  }

  // 5. High-Precision Name Lookup: Farmacity Argentina VTEX Search (Drugstore/OTC items)
  async fetchImageFromFarmacityByName(name: string): Promise<string | null> {
    try {
      const query = this.cleanName(name);
      const url = `https://www.farmacity.com/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 5000,
      });

      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        if (this.isStrictMatch(name, firstProduct.productName)) {
          const item = firstProduct.items?.[0];
          const imageUrl = item?.images?.[0]?.imageUrl;
          if (imageUrl) {
            console.log(`[Farmacity Name] Verified Match for "${name}": ${firstProduct.productName}`);
            return imageUrl;
          }
        } else {
          console.log(`[Farmacity Name] Match rejected for "${name}" (returned: "${firstProduct.productName}")`);
        }
      }
    } catch (err: any) {
      console.error(`[Farmacity Name] Error searching name "${name}":`, err.message);
    }
    return null;
  }

  private isCancelled = false;

  cancelAssignment() {
    this.isCancelled = true;
  }

  async assignImagesToProducts(userId: string): Promise<{ successCount: number; totalProcessed: number }> {
    console.log('[SyncImageService] Starting high precision Argentine image assignment...');
    this.isCancelled = false; // Reset flag on start

    // Fetch ALL active products that do not have a custom image
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { imageUrl: null },
          { imageUrl: '' },
          { imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80' }
        ]
      }
    });

    const totalProducts = products.length;
    console.log(`[SyncImageService] Found ${totalProducts} products to process.`);

    if (totalProducts === 0) {
      this.events.emitImageSyncProgress({
        progress: 100,
        total: 0,
        current: 0,
        successCount: 0,
        noMatchCount: 0,
        status: 'No hay productos pendientes de imágenes.',
        isComplete: true
      });
      return { successCount: 0, totalProcessed: 0 };
    }

    let successCount = 0;
    let index = 0;

    // Process in parallel chunks of 4 to optimize performance and prevent timeouts
    const concurrency = 4;
    for (let i = 0; i < products.length; i += concurrency) {
      const chunk = products.slice(i, i + concurrency);

      if (this.isCancelled) {
        console.log('[SyncImageService] Image assignment cancelled by user.');
        this.isCancelled = false; // Reset flag
        this.events.emitImageSyncProgress({
          progress: 100,
          total: totalProducts,
          current: index,
          successCount,
          noMatchCount: index - successCount,
          status: 'Búsqueda cancelada por el usuario.',
          isComplete: true
        });
        return { successCount, totalProcessed: index };
      }

      await Promise.all(chunk.map(async (product) => {
        let foundImageUrl: string | null = null;

        // TIER 1: Barcode-based Search (Carrefour EAN -> Farmacity EAN -> OFF as fallback)
        if (product.barcode && this.isValidNumericBarcode(product.barcode)) {
          // 1. Carrefour EAN Search
          foundImageUrl = await this.fetchImageFromCarrefourByBarcode(product.barcode);

          // 2. Farmacity EAN Search
          if (!foundImageUrl) {
            foundImageUrl = await this.fetchImageFromFarmacityByBarcode(product.barcode);
          }

          // 3. Open Food Facts as fallback
          if (!foundImageUrl) {
            foundImageUrl = await this.fetchImageFromOpenFoodFacts(product.barcode);
          }
        }

        // TIER 2: Strict Name-based Search (Carrefour Name -> Farmacity Name)
        if (!foundImageUrl && product.name) {
          // 1. Carrefour Name Search
          foundImageUrl = await this.fetchImageFromCarrefourByName(product.name);

          // 2. Farmacity Name Search
          if (!foundImageUrl) {
            foundImageUrl = await this.fetchImageFromFarmacityByName(product.name);
          }
        }

        // Save image to database only if we successfully found it via EAN or verified strict Name Search
        if (foundImageUrl) {
          const compressedUrl = await this.firebaseSync.compressRemoteImageToBase64(foundImageUrl);
          await this.prisma.product.update({
            where: { id: product.id },
            data: { imageUrl: compressedUrl }
          });
          successCount++;

          // Notify POS and frontend in real-time
          this.events.emitProductUpdated({ id: product.id, imageUrl: compressedUrl });
        }
      }));

      index += chunk.length;
      const progressPercent = Math.round((index / totalProducts) * 100);

      this.events.emitImageSyncProgress({
        progress: progressPercent,
        total: totalProducts,
        current: index,
        successCount,
        noMatchCount: index - successCount,
        status: `Procesando: ${chunk[chunk.length - 1]?.name || ''}`
      });

      // 400ms delay between parallel batches to respect external APIs
      await new Promise(r => setTimeout(r, 400));
    }

    this.events.emitImageSyncProgress({
      progress: 100,
      total: totalProducts,
      current: totalProducts,
      successCount,
      noMatchCount: totalProducts - successCount,
      status: `¡Búsqueda finalizada! Se asignaron ${successCount} imágenes con éxito.`,
      isComplete: true
    });

    console.log(`[SyncImageService] Finished. Assigned ${successCount}/${totalProducts} images.`);
    return { successCount, totalProcessed: totalProducts };
  }
}

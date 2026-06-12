import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { FirebaseSyncService } from '../products/firebase-sync.service';

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private firebaseSync: FirebaseSyncService,
  ) {}

  async findAll() {
    return (this.prisma as any).purchase.findMany({
      include: { supplier: true, user: { select: { fullName: true } }, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    supplierId: string;
    userId: string;
    invoiceNumber?: string;
    items: { productId: string; quantity: number; cost: number; buyFormat?: string }[];
    paymentStatus: 'PAID' | 'OWED';
    paymentMethod?: string;
    notes?: string;
  }) {
    const total = data.items.reduce((acc, item) => acc + (item.quantity * item.cost), 0);
    const productsToSync: { barcode: string; newStock: number; salePrice: number; name: string; description: string; categoryName: string; minStock: number; imageUrl: string }[] = [];

    const purchase = await this.prisma.$transaction(async (tx) => {
      // 1. Create Purchase
      const newPurchase = await (tx as any).purchase.create({
        data: {
          supplierId: data.supplierId,
          userId: data.userId,
          invoiceNumber: data.invoiceNumber,
          total,
          paymentStatus: data.paymentStatus,
          paymentMethod: data.paymentMethod,
          notes: data.notes,
        },
      });

      // 2. Create Items and Update Stock
      for (const item of data.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId }, include: { category: true } });
        if (!product) throw new NotFoundException(`Producto ${item.productId} no encontrado`);

        const isPack = item.buyFormat === 'PACK' && product.presentationType === 'PACK';
        const unitsPerPack = isPack ? (product.unitsPerPack || 1) : 1;
        const totalUnitsAdded = item.quantity * unitsPerPack;
        const unitCost = isPack ? (item.cost / unitsPerPack) : item.cost;

        await (tx as any).purchaseItem.create({
          data: {
            purchaseId: newPurchase.id,
            productId: item.productId,
            productName: product.name,
            quantity: item.quantity,
            cost: item.cost,
            total: item.quantity * item.cost,
            buyFormat: item.buyFormat || 'UNIT',
          },
        });

        const stockBefore = product.stock;
        const stockAfter = stockBefore + totalUnitsAdded;

        // Update Product Stock and Cost Price
        await tx.product.update({
          where: { id: item.productId },
          data: { 
            stock: stockAfter,
            costPrice: unitCost // Store unit cost
          },
        });

        // Create Inventory Movement
        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            userId: data.userId,
            type: 'ENTRY',
            quantity: totalUnitsAdded,
            stockBefore,
            stockAfter,
            reason: isPack 
              ? `Compra a proveedor (${item.quantity} paq. x ${unitsPerPack} u.)` 
              : 'Compra a proveedor',
            reference: `Compra #${newPurchase.id}`,
          },
        });

        if (product.barcode) {
          productsToSync.push({
            barcode: product.barcode,
            newStock: stockAfter,
            salePrice: product.salePrice,
            name: product.name,
            description: product.description || '',
            categoryName: product.category?.name || 'Varios',
            minStock: product.minStock,
            imageUrl: product.imageUrl || '',
          });
        }
      }

      return newPurchase;
    });

    // Sync all updated stocks to GoDelivery in real-time outside transaction
    for (const p of productsToSync) {
      this.firebaseSync.syncProductToFirestore(
        p.barcode,
        p.newStock,
        p.salePrice,
        {
          name: p.name,
          description: p.description,
          categoryName: p.categoryName,
          minStock: p.minStock,
          imageUrl: p.imageUrl,
        }
      ).catch(err => {
        console.error(`Error syncing product ${p.barcode} to Firestore after purchase:`, err.message);
      });
    }

    return purchase;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { FirebaseSyncService } from '../products/firebase-sync.service';
import axios from 'axios';
import { Jimp } from 'jimp';

function parseArgentineNumber(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  
  // Remove spaces
  let cleanStr = str.replace(/\s/g, '');
  
  // If the string contains both dot and comma
  if (cleanStr.includes('.') && cleanStr.includes(',')) {
    const dotIdx = cleanStr.indexOf('.');
    const commaIdx = cleanStr.indexOf(',');
    if (dotIdx < commaIdx) {
      // Argentine format: 6.528,97 -> remove dots, replace comma with dot
      cleanStr = cleanStr.replace(/\./g, '').replace(/,/g, '.');
    } else {
      // US format: 6,528.97 -> remove commas
      cleanStr = cleanStr.replace(/,/g, '');
    }
  } else if (cleanStr.includes(',')) {
    // Only comma: 1549,03 -> replace with dot
    cleanStr = cleanStr.replace(/,/g, '.');
  } else {
    // Check if it's an integer with a dot that might be a thousands separator
    const parts = cleanStr.split('.');
    if (parts.length === 2 && parts[1].length === 3) {
      // E.g. 6.528 -> 6528
      cleanStr = cleanStr.replace(/\./g, '');
    }
  }
  
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? 0 : parsed;
}

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
    items?: { 
      productId?: string; 
      quantity: number; 
      cost: number; 
      buyFormat?: string;
      salePrice?: number;
      newProductData?: {
        name: string;
        barcode?: string;
        sku?: string;
        salePrice?: number;
        categoryId?: string;
        brandId?: string;
        unitsPerPack?: number;
        presentationType?: string;
      };
    }[];
    paymentStatus: 'PAID' | 'OWED';
    paymentMethod?: string;
    notes?: string;
    manualTotal?: number;
  }) {
    const total = data.manualTotal !== undefined 
      ? Number(data.manualTotal) 
      : (data.items || []).reduce((acc, item) => acc + (item.quantity * item.cost), 0) * 1.21;
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
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          let productId = item.productId;

        // If it's a new product, create it first
        if (!productId && item.newProductData) {
          const barcode = item.newProductData.barcode || null;
          const sku = item.newProductData.sku || null;
          
          let existingProduct = null;
          if (barcode) {
            existingProduct = await tx.product.findUnique({ where: { barcode } });
          }
          if (!existingProduct && sku) {
            existingProduct = await tx.product.findUnique({ where: { sku } });
          }

          if (existingProduct) {
            productId = existingProduct.id;
          } else {
            const costVal = (item.cost || 0) * 1.21;
            const saleVal = item.newProductData.salePrice || (costVal * 1.3);
            const newProduct = await tx.product.create({
              data: {
                name: item.newProductData.name,
                barcode: barcode,
                sku: sku,
                costPrice: costVal,
                salePrice: saleVal,
                stock: 0,
                categoryId: item.newProductData.categoryId || null,
                brandId: item.newProductData.brandId || null,
                unitsPerPack: item.newProductData.unitsPerPack || 1,
                presentationType: item.newProductData.presentationType || 'UNIT',
              },
              include: { category: true }
            });
            productId = newProduct.id;
          }
        }

        const product = await tx.product.findUnique({ 
          where: { id: productId }, 
          include: { category: true } 
        });
        if (!product) throw new NotFoundException(`Producto ${productId} no encontrado`);

        const isPack = item.buyFormat === 'PACK' && product.presentationType === 'PACK';
        const unitsPerPack = isPack ? (product.unitsPerPack || 1) : 1;
        const totalUnitsAdded = item.quantity * unitsPerPack;
        const unitCost = isPack ? (item.cost / unitsPerPack) : item.cost;
        const unitCostWithIva = unitCost * 1.21;

        await (tx as any).purchaseItem.create({
          data: {
            purchaseId: newPurchase.id,
            productId: productId,
            productName: product.name,
            quantity: item.quantity,
            cost: item.cost * 1.21,
            total: item.quantity * item.cost * 1.21,
            buyFormat: item.buyFormat || 'UNIT',
          },
        });

        const stockBefore = product.stock;
        const stockAfter = stockBefore + totalUnitsAdded;

        // Update Product Stock, Cost Price and Sale Price
        const updatedSalePrice = item.salePrice || product.salePrice;
        const updateData: any = {
          stock: stockAfter,
          costPrice: unitCostWithIva, // Store unit cost with IVA
          salePrice: updatedSalePrice,
          isActive: true // Reactivate if soft-deleted
        };

        if (item.newProductData) {
          if (item.newProductData.categoryId) {
            updateData.categoryId = item.newProductData.categoryId;
          }
          if (item.newProductData.brandId) {
            updateData.brandId = item.newProductData.brandId;
          }
          if (item.newProductData.name) {
            updateData.name = item.newProductData.name;
          }
          if (item.newProductData.unitsPerPack) {
            updateData.unitsPerPack = item.newProductData.unitsPerPack;
          }
          if (item.newProductData.presentationType) {
            updateData.presentationType = item.newProductData.presentationType;
          }
        }

        await tx.product.update({
          where: { id: productId },
          data: updateData,
        });

        // Create Inventory Movement
        await tx.inventoryMovement.create({
          data: {
            productId: productId,
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

        productsToSync.push({
          barcode: product.barcode || product.id,
          newStock: stockAfter,
          salePrice: updatedSalePrice,
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

  async scanInvoice(files: Express.Multer.File[], manualTotal?: number) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('La clave de API de Gemini (GEMINI_API_KEY) no está configurada en las variables de entorno.');
    }

    const inlineDataParts = [];
    for (const file of files) {
      console.log(`[GeminiAI] Preparando imagen original para escaneo: ${file.originalname || 'sin-nombre'} (${(file.buffer.length / 1024 / 1024).toFixed(2)} MB)`);
      inlineDataParts.push({
        inlineData: {
          mimeType: file.mimetype || 'image/jpeg',
          data: file.buffer.toString('base64'),
        }
      });
    }

    let promptText = `Eres un experto en OCR visual y extracción de datos estructurados de comprobantes de compra.
Tu tarea es analizar la imagen de la boleta (factura impresa, ticket de supermercado/mayorista o incluso notas/comprobantes escritos a mano) y extraer la lista completa de todos los productos físicos reales comprados.

Primero, transcribe la tabla completa de artículos de la boleta columna por columna en formato markdown. Esto sirve para alinear visualmente los datos. Luego, extrae cada artículo detallado.

Extrae los datos en formato JSON con la siguiente estructura:
{
  "rawTableTranscription": "Transcripción en markdown de la tabla de la boleta (con columnas: ARTICULO/SKU, CANTIDAD, U.B., DESCRIPCION, PRECIO UNITARIO, TOTAL) para asegurar la alineación horizontal de cada fila.",
  "supplierName": "Nombre del proveedor o emisor de la boleta (detecta el membrete o texto superior)",
  "invoiceNumber": "Número de comprobante completo (por ejemplo, FA-0001-00001234, o el número de ticket)",
  "date": "Fecha de la factura en formato YYYY-MM-DD",
  "totalFacturaAPagar": "Total general final a pagar impreso al pie de la boleta (por ejemplo, '304.947,88' o '304947.88').",
  "items": [
    {
      "sku": "Código interno o número de artículo del proveedor si existe en la línea del producto (por ejemplo, de la columna ARTICULO). Déjalo vacío si no tiene o si es manuscrito.",
      "barcode": "Código de barras numérico (EAN/GTIN) si aparece impreso o manuscrito al lado del producto. Si no está, déjalo vacío.",
      "name": "Nombre o descripción del producto de forma clara y completa. Si es abreviado, consérvalo tal cual. Si está escrito a mano, transcríbelo lo mejor posible.",
      "packageQuantity": "Cantidad literal de bultos/packs comprados según se indica en la columna 'CANTIDAD' (por ejemplo, si compraste 1 caja/bulto de galletitas, extrae 1). Si no hay bultos y se vende por unidad suelta, es simplemente la cantidad indicada.",
      "unitsPerPack": "Unidades por bulto/pack de la columna 'U.B.' (Unidades por Bulto). Si es por unidad individual o no se especifica, usa 1.",
      "total": "Valor neto o subtotal de la línea de este producto de la columna TOTAL (como STRING, por ejemplo '6.528,97' o '9.153,36' o '31.171,08'). NUNCA extraigas el precio unitario (columna P.U. CON I.V.A. o PRECIO SIN I.V.A.) como TOTAL de la línea. Extrae el total literal acumulado de esa línea del producto."
    }
  ]
}

REGLAS CRÍTICAS:
1. Extrae ABSOLUTAMENTE TODOS los productos físicos de la lista que tengan una cantidad y precio/total. No importa si son 2, 21, o 50 filas. Extrae todas las que encuentres.
2. Si la boleta está escrita a mano, haz tu mejor esfuerzo para transcribir las descripciones de los artículos, cantidades y totales.
3. IGNORA POR COMPLETO las líneas de descuentos globales o promociones (ej. "Promoción 161559", "15% - Llevando...", "Paga Solo"), recargos, o resúmenes de pie de página como "BULTOS" (ej. "21 BULTOS EN CARRO"), "KILOS" o "TOTAL GENERAL". NUNCA mezcles cantidades de resúmenes de bultos con líneas de descuento.
4. Asegúrate de alinear correctamente cada columna de la misma fila (código, descripción, cantidad y total de la misma línea pertenecen al mismo producto). Asegúrate de que los valores de TOTAL de cada fila correspondan exactamente a ese producto y no a la fila superior o inferior.
5. AUTO-CORRECCIÓN MATEMÁTICA CON CONCORDANCIA: Suma todos los 'total' de los artículos, multiplícalo por 1.21 (IVA) y aplica los descuentos del pie de la factura. Corrobora que esta suma coincida exactamente con el total general de la factura ('totalFacturaAPagar'). Si no coincide, significa que has cometido un error de alineación de precios o has leído mal un total; vuelve a analizar la imagen, auto-corrígete y devuelve los datos alineados correctamente.`;

    if (manualTotal !== undefined && manualTotal !== null) {
      promptText += `\n\n6. ANCLAJE DE TOTAL: El total final a pagar de esta factura/boleta es exactamente: ${manualTotal}. Usa este valor de anclaje para validar que el subtotal y la suma de los productos que extraigas (contando IVA y descuentos) coincidan lógicamente con este total general de ${manualTotal}.`;
    }

    const models = [
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.1-pro-preview',
      'gemini-2.5-flash',
      'gemini-2.5-pro'
    ];

    let lastError = null;
    let parsedData = null;
    const errors: string[] = [];

    for (const model of models) {
      try {
        console.log(`[GeminiAI] Intentando escaneo con modelo ${model} y ${files.length} imágenes...`);
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            contents: [
              {
                parts: [
                  { text: promptText },
                  ...inlineDataParts
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  rawTableTranscription: { type: 'STRING', description: 'Transcripción markdown de la tabla de artículos de la boleta.' },
                  supplierName: { type: 'STRING' },
                  invoiceNumber: { type: 'STRING' },
                  date: { type: 'STRING', description: 'Fecha de la boleta en formato YYYY-MM-DD' },
                  totalFacturaAPagar: { type: 'STRING', description: 'Total general de la factura impreso al final.' },
                  items: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        barcode: { type: 'STRING' },
                        sku: { type: 'STRING' },
                        name: { type: 'STRING' },
                        packageQuantity: { type: 'NUMBER' },
                        unitsPerPack: { type: 'NUMBER' },
                        total: { type: 'STRING', description: 'Total neto literal de la línea de la boleta (ej: "6.528,97" o "6528.97")' },
                      },
                      required: ['name', 'packageQuantity', 'total'],
                    },
                  },
                },
                required: ['rawTableTranscription', 'items'],
              },
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 25000, // 25 seconds timeout for fast failover
          }
        );

        const parsedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!parsedText) {
          throw new Error('No se recibió respuesta válida del modelo de IA.');
        }

        parsedData = JSON.parse(parsedText);
        console.log(`[GeminiAI] Escaneo exitoso con modelo ${model}`);
        break; // Exit models loop
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status;
        const apiErrorMsg = err.response?.data?.error?.message || err.message;
        const logMsg = `Modelo ${model} falló (Status ${status}): ${apiErrorMsg}`;
        console.warn(`[GeminiAI] ${logMsg}`);
        errors.push(logMsg);
        
        // Only abort immediately on definitive authentication or authorization errors (401, 403)
        if (status && [401, 403].includes(status)) {
          throw err;
        }
        // Failover to the next model immediately
      }
    }

    if (!parsedData) {
      if (lastError.response?.status === 503) {
        throw new Error('Los servidores de Google Gemini están temporalmente saturados. Por favor, intenta de nuevo en unos segundos.');
      }
      throw new Error(`No se pudo procesar la boleta con IA tras intentar con varios modelos: ${errors.join(' | ')}`);
    }

    try {
      // Match supplier if found
      let matchedSupplier = null;
      if (parsedData.supplierName) {
        matchedSupplier = await this.prisma.supplier.findFirst({
          where: {
            name: {
              contains: parsedData.supplierName,
            },
          },
        });
      }

      // Load all active products into memory once to prevent SQLite lock and database bottleneck
      const rawProducts = await this.prisma.product.findMany({
        where: { isActive: true },
        include: { additionalBarcodes: true },
      });

      // Filter out any potential nulls to be absolutely safe
      const allProducts = (rawProducts || []).filter(p => p !== null && p !== undefined);

      // Match products in memory
      const items = (parsedData.items || []).map((item: any) => {
        let matchedProduct = null;
        
        // Clean and validate barcodes and SKUs
        let barcodeVal = item.barcode ? String(item.barcode).trim() : '';
        const skuVal = item.sku ? String(item.sku).trim() : '';
        
        // Safety check: if barcode was populated with the SKU value, clear it
        if (barcodeVal === skuVal) {
          barcodeVal = '';
        }

        // 1. Match by Barcode
        if (barcodeVal) {
          matchedProduct = allProducts.find(
            p => p && (p.barcode === barcodeVal || (p.additionalBarcodes && p.additionalBarcodes.some(ab => ab && ab.barcode === barcodeVal)))
          );
        }

        // 2. Match by SKU
        if (!matchedProduct && skuVal) {
          matchedProduct = allProducts.find(
            p => p && (p.sku === skuVal || p.barcode === skuVal)
          );
        }

        // 3. Match by Name
        if (!matchedProduct && item.name) {
          const searchName = item.name.toUpperCase();
          matchedProduct = allProducts.find(
            p => p && p.name && p.name.toUpperCase().includes(searchName)
          );
        }

        // Calculate quantity based on bultos and units per bulto (U.B.)
        const unitsPerPackVal = item.unitsPerPack || 1;
        const packageQtyVal = item.packageQuantity || 1;
        const quantityVal = packageQtyVal * unitsPerPackVal;
        const rawNetTotal = parseArgentineNumber(item.total);
        const netCost = rawNetTotal / quantityVal;

        return {
          barcode: barcodeVal,
          sku: skuVal,
          name: item.name,
          quantity: quantityVal,
          unitsPerPack: unitsPerPackVal,
          presentationType: 'UNIT', // Default everything to UNIT as requested
          cost: parseFloat(netCost.toFixed(2)),
          total: parseFloat(rawNetTotal.toFixed(2)),
          product: (matchedProduct && matchedProduct.id) ? {
            id: matchedProduct.id,
            barcode: matchedProduct.barcode,
            sku: matchedProduct.sku,
            name: matchedProduct.name,
            costPrice: matchedProduct.costPrice,
            salePrice: matchedProduct.salePrice,
            unit: matchedProduct.unit,
            presentationType: matchedProduct.presentationType,
            unitsPerPack: matchedProduct.unitsPerPack,
          } : null,
        };
      });

      return {
        supplierName: parsedData.supplierName || '',
        matchedSupplier: (matchedSupplier && matchedSupplier.id) ? {
          id: matchedSupplier.id,
          name: matchedSupplier.name,
        } : null,
        invoiceNumber: parsedData.invoiceNumber || '',
        date: parsedData.date || new Date().toISOString().split('T')[0],
        items,
      };

    } catch (err: any) {
      console.error('Error scanning invoice with Gemini:', err.response?.data || err.message);
      if (err.response?.status === 503) {
        throw new Error('El modelo de IA de Gemini está experimentando alta demanda (saturación temporal). Por favor, intenta de nuevo en unos segundos.');
      }
      throw new Error(`Error al escanear la boleta con IA: ${err.message}`);
    }
  }

  async deleteOne(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { items: { include: { product: true } } },
    });
    if (!purchase) throw new NotFoundException('Compra no encontrada');

    await this.prisma.$transaction(async (tx) => {
      // Deduct stock for each item if the product exists
      for (const item of purchase.items) {
        if (item.product) {
          const isPack = item.buyFormat === 'PACK' && item.product.presentationType === 'PACK';
          const unitsPerPack = isPack ? (item.product.unitsPerPack || 1) : 1;
          const totalUnits = item.quantity * unitsPerPack;
          
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: {
                decrement: totalUnits,
              },
            },
          });
        }
      }

      // Delete the purchase items first, then the purchase
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await tx.purchase.delete({ where: { id } });
    });

    return { success: true };
  }

  async deleteAll() {
    const purchases = await this.prisma.purchase.findMany({
      include: { items: { include: { product: true } } },
    });

    await this.prisma.$transaction(async (tx) => {
      for (const p of purchases) {
        for (const item of p.items) {
          if (item.product) {
            const isPack = item.buyFormat === 'PACK' && item.product.presentationType === 'PACK';
            const unitsPerPack = isPack ? (item.product.unitsPerPack || 1) : 1;
            const totalUnits = item.quantity * unitsPerPack;

            await tx.product.update({
              where: { id: item.productId },
              data: {
                stock: {
                  decrement: totalUnits,
                },
              },
            });
          }
        }
      }

      await tx.purchaseItem.deleteMany({});
      await tx.purchase.deleteMany({});
    });

    return { success: true };
  }

  async restorePurchase(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!purchase) throw new NotFoundException('Compra no encontrada');

    const restoredProducts = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of purchase.items) {
        let product = await tx.product.findUnique({ where: { id: item.productId } });

        if (product) {
          // Reactivate and update cost price and stock
          const isPack = item.buyFormat === 'PACK' && product.presentationType === 'PACK';
          const unitsPerPack = isPack ? (product.unitsPerPack || 1) : 1;
          const totalUnits = item.quantity * unitsPerPack;

          // If the product was inactive/deleted, we set stock to the purchase quantity. If it was active, we add to it.
          const newStock = product.isActive ? (product.stock + totalUnits) : totalUnits;

          product = await tx.product.update({
            where: { id: product.id },
            data: {
              isActive: true,
              costPrice: item.cost,
              // If it had a very low sale price or default, we ensure it has a markup
              salePrice: product.salePrice > item.cost ? product.salePrice : (item.cost * 1.3),
              stock: newStock,
            },
          });
        } else {
          // Re-create the product
          const costVal = item.cost;
          const saleVal = costVal * 1.3;

          product = await tx.product.create({
            data: {
              id: item.productId,
              name: item.productName.toUpperCase(),
              costPrice: costVal,
              salePrice: saleVal,
              stock: item.quantity,
              isActive: true,
              presentationType: item.buyFormat || 'UNIT',
              unitsPerPack: 1,
            },
          });
        }
        restoredProducts.push(product);
      }
    });

    // Sync restored products with firestore in background
    for (const p of restoredProducts) {
      const syncBarcode = p.barcode || p.id;
      this.firebaseSync.syncProductToFirestore(
        syncBarcode,
        p.stock,
        p.salePrice,
        { name: p.name }
      ).catch(err => console.error('Error syncing restored product to Firestore:', err));
    }

    return { success: true, restoredCount: restoredProducts.length };
  }
}

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import { Jimp } from 'jimp';

@Injectable()
export class FirebaseSyncService implements OnModuleInit {
  private firestore: admin.firestore.Firestore | null = null;
  private isInitialized = false;
  private comercioId = '';
  private categoryCache: { [key: string]: string } = {};

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.comercioId = 'godelivery-magdalena';
    
    try {
      const credentialsJsonEnv = this.config.get<string>('FIREBASE_CREDENTIALS_JSON');
      let serviceAccount: any = null;

      if (credentialsJsonEnv) {
        try {
          serviceAccount = JSON.parse(credentialsJsonEnv);
          console.log('[FirebaseSync] Cargando credenciales de Firebase directamente desde memoria (Var de Entorno Encriptada/Segura).');
        } catch (err: any) {
          console.error('[FirebaseSync] Error al parsear FIREBASE_CREDENTIALS_JSON de entorno:', err.message);
        }
      }

      let serviceAccountPathUsed = '';
      if (!serviceAccount) {
        const serviceAccountPath = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH') || 'firebase-credentials.json';
        const absolutePath = path.isAbsolute(serviceAccountPath)
          ? serviceAccountPath
          : path.join(process.cwd(), serviceAccountPath);
        serviceAccountPathUsed = absolutePath;

        if (fs.existsSync(absolutePath)) {
          serviceAccount = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
        }
      }

      if (serviceAccount) {
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
          });
        }
        
        this.firestore = admin.firestore();
        this.isInitialized = true;
        
        // Cargar un comercio predeterminado si no hay uno dinámico guardado
        const configFilePath = path.join(process.cwd(), 'godelivery_comercio_id.txt');
        if (fs.existsSync(configFilePath)) {
          this.comercioId = fs.readFileSync(configFilePath, 'utf8').trim();
        } else {
          const defaultComercioId = this.config.get<string>('GODELIVERY_COMERCIO_ID');
          if (defaultComercioId) {
            this.comercioId = defaultComercioId;
          }
        }

        console.log('  ======================================================');
        console.log('  📡 Maxikiosco Paulos POS - CONEXIÓN NUBE ACTIVA');
        console.log(`  🔗 Conectado a Firestore. Comercio ID base: "${this.comercioId}"`);
        console.log('  📈 Optimizaciones listas para reducir operaciones de Firebase.');
        console.log('  ======================================================');
      } else {
        console.warn(`[FirebaseSync] Archivo de credenciales no encontrado en: ${serviceAccountPathUsed || 'firebase-credentials.json'}. Operando en modo local.`);
      }
    } catch (err: any) {
      console.error('[FirebaseSync] Error al inicializar Firebase SDK:', err.message);
      this.isInitialized = false;
      this.firestore = null;
    }
  }

  /**
   * Verifica de manera estricta si un email tiene una cuenta y comercio registrados en GoDelivery Firestore.
   */
  async checkUserAndCommerceExists(email: string): Promise<{ userExists: boolean; commerceExists: boolean }> {
    if (!this.isInitialized || !this.firestore || !email) {
      return { userExists: false, commerceExists: false };
    }
    try {
      console.log(`[FirebaseSync] Validando cuenta de Google en GoDelivery: ${email}`);
      const usersRef = this.firestore.collection('users');
      const userSnapshot = await usersRef.where('email', '==', email).limit(1).get();
      
      if (userSnapshot.empty) {
        return { userExists: false, commerceExists: false };
      }
      
      const uid = userSnapshot.docs[0].id;
      const comerciosRef = this.firestore.collection('comercios');
      const commerceSnapshot = await comerciosRef.where('ownerId', '==', uid).limit(1).get();
      
      if (commerceSnapshot.empty) {
        return { userExists: true, commerceExists: false };
      }
      
      return { userExists: true, commerceExists: true };
    } catch (err: any) {
      console.error(`[FirebaseSync] Error validando existencia del usuario/comercio [${email}]:`, err.message);
      return { userExists: false, commerceExists: false };
    }
  }

  async verifyGoogleEmailOwnsTerminalCommerce(email: string): Promise<boolean> {
    if (!this.isInitialized || !this.firestore || !email) {
      return false;
    }
    try {
      console.log(`[FirebaseSync] Verificando comercio asociado para el email: ${email}`);
      
      const usersRef = this.firestore.collection('users');
      const userSnapshot = await usersRef.where('email', '==', email).limit(1).get();
      
      if (userSnapshot.empty) {
        console.warn(`[FirebaseSync] No se encontró usuario para el email: ${email}`);
        return false;
      }
      
      const uid = userSnapshot.docs[0].id;
      const comerciosRef = this.firestore.collection('comercios');
      const commerceSnapshot = await comerciosRef.where('ownerId', '==', uid).limit(1).get();
      
      if (commerceSnapshot.empty) {
        console.warn(`[FirebaseSync] El usuario no tiene ningún comercio registrado.`);
        return false;
      }
      
      const commerceDoc = commerceSnapshot.docs[0];
      const resolvedId = commerceDoc.id;
      
      // Guardar dinámicamente el comercio ID en memoria y persistirlo
      this.comercioId = resolvedId;
      const configFilePath = path.join(process.cwd(), 'godelivery_comercio_id.txt');
      fs.writeFileSync(configFilePath, resolvedId, 'utf8');
      
      console.log(`[FirebaseSync] POS vinculado con éxito al comercio: "${resolvedId}" (${commerceDoc.data().name})`);
      return true;
    } catch (err: any) {
      console.error(`[FirebaseSync] Error verificando propiedad del comercio por email:`, err.message);
      return false;
    }
  }

  /**
   * Descarga y comprime una imagen remota, convirtiéndola a Base64 ultra-liviana.
   */
  async compressRemoteImageToBase64(imageUrl: string): Promise<string> {
    if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
      return imageUrl;
    }

    try {
      console.log(`[FirebaseSync] Descargando y comprimiendo imagen: ${imageUrl}`);
      const image = await Jimp.read(imageUrl);
      
      // Resize preserving aspect ratio (max 180x180)
      if (image.width > image.height) {
        image.resize({ w: 180 });
      } else {
        image.resize({ h: 180 });
      }
      
      // Compress quality to 55% using getBuffer options
      const buffer = await image.getBuffer("image/jpeg", { quality: 55 });
      const base64 = buffer.toString('base64');
      return `data:image/jpeg;base64,${base64}`;
    } catch (err: any) {
      console.error(`[FirebaseSync] Error al comprimir imagen remota [${imageUrl}]:`, err.message);
      // Fallback a URL original en caso de error
      return imageUrl;
    }
  }

  /**
   * Resuelve dinámicamente el comercioId asociado a un email de Google en GoDelivery Firestore.
   */
  async resolveComercioIdByEmail(email: string): Promise<string> {
    if (!this.isInitialized || !this.firestore || !email) return this.comercioId;
    
    const defaultComercioId = this.config.get<string>('GODELIVERY_COMERCIO_ID');
    
    try {
      console.log(`[FirebaseSync] Resolviendo comercio para el email: ${email}`);
      const usersRef = this.firestore.collection('users');
      const userSnapshot = await usersRef.where('email', '==', email).limit(1).get();
      
      if (!userSnapshot.empty) {
        const uid = userSnapshot.docs[0].id;
        const comerciosRef = this.firestore.collection('comercios');
        const commerceSnapshot = await comerciosRef.where('ownerId', '==', uid).limit(1).get();
        
        if (!commerceSnapshot.empty) {
          const comercioDoc = commerceSnapshot.docs[0];
          const resolvedId = comercioDoc.id;
          
          if (defaultComercioId && defaultComercioId !== resolvedId) {
            console.warn(`[FirebaseSync] Advertencia: El comercio asociado a esta cuenta de Google (${comercioDoc.data().name || 'Desconocido'}) no coincide con el configurado en esta terminal POS ("${defaultComercioId}"). Usando "${resolvedId}" de forma dinámica.`);
          }
          
          this.comercioId = resolvedId;
          console.log(`[FirebaseSync] ¡Comercio de GoDelivery detectado y vinculado! ID: "${this.comercioId}", Nombre: "${comercioDoc.data().name}"`);
          return this.comercioId;
        } else {
          console.warn(`[FirebaseSync] No se encontró ningún comercio perteneciente a uid: ${uid}`);
        }
      } else {
        console.warn(`[FirebaseSync] No se encontró ningún usuario de GoDelivery con email: ${email}`);
      }
    } catch (err: any) {
      console.error(`[FirebaseSync] Error resolviendo comercio por email [${email}]:`, err.message);
      // Fallback: don't throw, just return current comercioId
      return this.comercioId;
    }
    
    // Fallback: search for commerce by name "Maxikiosco Paulos" and score best candidates
    try {
      const resolvedId = await this.resolveComercioIdByName('Maxikiosco Paulos', email);
      if (defaultComercioId && defaultComercioId !== resolvedId) {
        console.warn(`[FirebaseSync] Advertencia: El comercio resuelto por nombre no coincide con el predeterminado de la terminal. Usando "${resolvedId}" de forma dinámica.`);
      }
      this.comercioId = resolvedId;
      return resolvedId;
    } catch {
      return this.comercioId;
    }
  }

  /**
   * Resuelve el comercioId por su nombre.
   * Si existen varios comercios con el mismo nombre, utiliza coincidencia difusa de correo del dueño.
   */
  async resolveComercioIdByName(name: string, fallbackEmail?: string): Promise<string> {
    if (!this.isInitialized || !this.firestore || !name) return this.comercioId;
    try {
      console.log(`[FirebaseSync] Resolviendo comercio por nombre: "${name}"`);
      const comerciosRef = this.firestore.collection('comercios');
      const snapshot = await comerciosRef.where('name', '==', name).get();
      
      if (!snapshot.empty) {
        if (snapshot.size === 1) {
          const doc = snapshot.docs[0];
          this.comercioId = doc.id;
          console.log(`[FirebaseSync] Comercio único encontrado por nombre: "${name}" -> ID: "${this.comercioId}"`);
          return this.comercioId;
        }
        
        console.log(`[FirebaseSync] Múltiples comercios con el nombre "${name}" encontrados. Evaluando coincidencia...`);
        let bestMatchId = '';
        let highestScore = -1;
        
        for (const doc of snapshot.docs) {
          const data = doc.data();
          const ownerId = data.ownerId;
          let score = 0;
          
          if (ownerId) {
            const userDoc = await this.firestore.collection('users').doc(ownerId).get();
            if (userDoc.exists) {
              const userEmail = userDoc.data()?.email || '';
              console.log(`[FirebaseSync] Evaluando comercio ID: "${doc.id}" del email: "${userEmail}"`);
              
              if (fallbackEmail) {
                // Remove numbers and domains to compare base username prefix (e.g. kioscopaulos7 -> kioscopaulos)
                const prefix1 = fallbackEmail.split('@')[0].toLowerCase().replace(/[0-9]/g, '');
                const prefix2 = userEmail.split('@')[0].toLowerCase().replace(/[0-9]/g, '');
                
                if (prefix1 === prefix2 && prefix1.length > 2) {
                  score += 100;
                }
                if (userEmail.toLowerCase() === fallbackEmail.toLowerCase()) {
                  score += 500;
                }
              }
            }
          }
          
          if (score > highestScore) {
            highestScore = score;
            bestMatchId = doc.id;
          }
        }
        
        if (bestMatchId) {
          this.comercioId = bestMatchId;
          console.log(`[FirebaseSync] Mejor match seleccionado por nombre/email: "${name}" -> ID: "${this.comercioId}" (score: ${highestScore})`);
          return this.comercioId;
        }
        
        // Final fallback: first found
        this.comercioId = snapshot.docs[0].id;
        console.log(`[FirebaseSync] Fallback al primer comercio por nombre: "${name}" -> ID: "${this.comercioId}"`);
        return this.comercioId;
      } else {
        console.warn(`[FirebaseSync] No se encontró ningún comercio con el nombre: "${name}"`);
      }
    } catch (err: any) {
      console.error(`[FirebaseSync] Error resolviendo comercio por nombre [${name}]:`, err.message);
    }
    return this.comercioId;
  }

  /**
   * Elimina todas las categorías del comercio en GoDelivery Firestore
   * y limpia el caché en memoria.
   */
  async clearAllCategories(): Promise<void> {
    if (!this.isInitialized || !this.firestore || !this.comercioId) return;
    try {
      console.log(`[FirebaseSync] Eliminando categorías previas del comercio: ${this.comercioId}`);
      const categoriesRef = this.firestore.collection('comercios').doc(this.comercioId).collection('categories');
      const snapshot = await categoriesRef.get();
      
      if (!snapshot.empty) {
        const batch = this.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`[FirebaseSync] Se eliminaron ${snapshot.size} categorías de GoDelivery.`);
      }
      
      // Clear local category cache
      this.categoryCache = {};
    } catch (err: any) {
      console.error(`[FirebaseSync] Error al eliminar categorías previas:`, err.message);
    }
  }

  /**
   * Pre-crea un listado de categorías únicas en GoDelivery Firestore
   * y las registra en el categoryCache en memoria.
   */
  async precreateCategories(categoryNames: string[]): Promise<void> {
    if (!this.isInitialized || !this.firestore || !this.comercioId || categoryNames.length === 0) return;
    try {
      console.log(`[FirebaseSync] Pre-creando ${categoryNames.length} categorías únicas para el comercio ${this.comercioId}...`);
      const categoriesRef = this.firestore.collection('comercios').doc(this.comercioId).collection('categories');
      
      let order = 0;
      for (const name of categoryNames) {
        const cacheKey = `${this.comercioId}:${name}`;
        
        // Double check if it exists
        const snapshot = await categoriesRef.where('name', '==', name).limit(1).get();
        let catId = '';
        
        if (!snapshot.empty) {
          catId = snapshot.docs[0].id;
        } else {
          const newDocRef = categoriesRef.doc();
          await newDocRef.set({
            name: name,
            order: order,
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
          catId = newDocRef.id;
          console.log(`[FirebaseSync] Categoría [${name}] pre-creada con ID: ${catId}`);
        }
        
        this.categoryCache[cacheKey] = catId;
        order++;
      }
    } catch (err: any) {
      console.error(`[FirebaseSync] Error al pre-crear categorías:`, err.message);
    }
  }

  /**
   * Sincroniza stock y precio de un producto local con GoDelivery Firestore.
   * Auto-crea el producto y su categoría si no existen en la nube.
   */
  async syncProductToFirestore(
    barcode: string,
    newStock: number,
    price: number,
    extraData?: {
      name?: string;
      description?: string;
      categoryName?: string;
      minStock?: number;
      imageUrl?: string;
    }
  ): Promise<string | undefined> {
    if (!this.isInitialized || !this.firestore || !barcode) return;

    try {
      const productsRef = this.firestore.collection('comercios').doc(this.comercioId).collection('products');
      const querySnapshot = await productsRef.where('barcode', '==', barcode).limit(1).get();
      
      let categoryId = '';
      if (extraData?.categoryName && extraData.categoryName.trim() !== '' && extraData.categoryName.toLowerCase() !== 'varios') {
        const cacheKey = `${this.comercioId}:${extraData.categoryName}`;
        if (this.categoryCache[cacheKey]) {
          categoryId = this.categoryCache[cacheKey];
        } else {
          const categoriesRef = this.firestore.collection('comercios').doc(this.comercioId).collection('categories');
          const catSnapshot = await categoriesRef.where('name', '==', extraData.categoryName).limit(1).get();
          
          if (!catSnapshot.empty) {
            categoryId = catSnapshot.docs[0].id;
          } else {
            // Create the category in GoDelivery
            const newCatRef = categoriesRef.doc();
            const allCatsSnapshot = await categoriesRef.get();
            const nextOrder = allCatsSnapshot.size;
            
            await newCatRef.set({
              name: extraData.categoryName,
              order: nextOrder,
              isActive: true,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            categoryId = newCatRef.id;
            console.log(`[FirebaseSync] Categoría [${extraData.categoryName}] creada en GoDelivery con ID: ${categoryId}`);
          }
          this.categoryCache[cacheKey] = categoryId;
        }
      }

      const defaultPlaceholder = 'https://godelivery-magdalena.web.app/logo.png';
      
      const finalImageUrl = extraData?.imageUrl || defaultPlaceholder;

      if (!querySnapshot.empty) {
        const docRef = querySnapshot.docs[0].ref;
        const currentData = querySnapshot.docs[0].data();
        
        const updates: any = {
          price: price,
          barcode: barcode, // Asegurar que el código de barras se actualice en GoDelivery
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (extraData?.name) updates.name = extraData.name;
        if (extraData?.description !== undefined) updates.description = extraData.description;
        if (categoryId) updates.categoryId = categoryId;
        
        // Only update product image URL if provided to prevent overwriting with default placeholder during sales
        if (extraData?.imageUrl) {
          updates.image = finalImageUrl;
        }

        // If GoDelivery handles stock as limited, we sync it (or default to limited if not specified)
        if (currentData.stockMode === 'limited' || !currentData.stockMode) {
          updates.stockQuantity = newStock;
          updates.stockMode = 'limited';
        }

        await docRef.update(updates);
        console.log(`[FirebaseSync] Producto [${barcode}] actualizado con imagen en GoDelivery.`);
      } else {
        // Create the product in GoDelivery!
        const newProductRef = productsRef.doc();
        await newProductRef.set({
          name: extraData?.name || 'Producto POS',
          barcode: barcode,
          description: extraData?.description || '',
          price: price,
          categoryId: categoryId || '',
          image: finalImageUrl,
          optionsGroups: [],
          isAvailable: true,
          stockMode: 'limited',
          stockQuantity: newStock,
          stockThreshold: extraData?.minStock !== undefined ? extraData.minStock : 3,
          order: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[FirebaseSync] Producto [${barcode}] creado exitosamente en GoDelivery (comercio: ${this.comercioId}).`);
      }

      return finalImageUrl;
    } catch (err: any) {
      console.error(`[FirebaseSync] Error al sincronizar producto [${barcode}]:`, err.message);
      // Don't throw — Firebase errors must never break a sale
      return undefined;
    }
  }

  /**
   * Sincroniza la eliminación/desactivación de un producto con GoDelivery.
   */
  async syncProductDeletion(barcode: string) {
    if (!this.isInitialized || !this.firestore || !barcode) return;

    try {
      const productsRef = this.firestore.collection('comercios').doc(this.comercioId).collection('products');
      const querySnapshot = await productsRef.where('barcode', '==', barcode).limit(1).get();
      
      if (!querySnapshot.empty) {
        const docRef = querySnapshot.docs[0].ref;
        await docRef.update({
          isAvailable: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[FirebaseSync] Producto [${barcode}] marcado como no disponible en GoDelivery.`);
      }
    } catch (err: any) {
      console.error(`[FirebaseSync] Error al sincronizar baja [${barcode}]:`, err.message);
    }
  }

  /**
   * Elimina los productos de Firestore que no estén en la lista de códigos de barras permitidos.
   */
  async cleanOrphanedProducts(allowedBarcodes: string[]): Promise<number> {
    if (!this.isInitialized || !this.firestore || !this.comercioId) return 0;
    try {
      console.log(`[FirebaseSync] Iniciando limpieza de productos huérfanos para el comercio: ${this.comercioId}`);
      const productsRef = this.firestore.collection('comercios').doc(this.comercioId).collection('products');
      const snapshot = await productsRef.get();
      
      if (snapshot.empty) return 0;
      
      const allowedSet = new Set(allowedBarcodes);
      const docsToDelete: admin.firestore.DocumentReference[] = [];
      
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const barcode = data.barcode;
        
        // Si el producto en Firestore no tiene código de barra o no está en el listado permitido, se elimina
        if (!barcode || !allowedSet.has(barcode)) {
          docsToDelete.push(doc.ref);
        }
      });
      
      const totalToDelete = docsToDelete.length;
      if (totalToDelete > 0) {
        console.log(`[FirebaseSync] Encontrados ${totalToDelete} productos obsoletos para eliminar. Procesando en lotes...`);
        const chunkSize = 400;
        for (let i = 0; i < totalToDelete; i += chunkSize) {
          const chunk = docsToDelete.slice(i, i + chunkSize);
          const batch = this.firestore.batch();
          chunk.forEach(ref => {
            batch.delete(ref);
          });
          await batch.commit();
          console.log(`[FirebaseSync] Lote completado: eliminados productos ${i + 1} a ${Math.min(i + chunkSize, totalToDelete)}`);
        }
        console.log(`[FirebaseSync] Se eliminaron exitosamente un total de ${totalToDelete} productos huérfanos de GoDelivery.`);
      }
      
      return totalToDelete;
    } catch (err: any) {
      console.error(`[FirebaseSync] Error al limpiar productos huérfanos:`, err.message);
      return 0;
    }
  }

  /**
   * Obtiene las estadísticas detalladas y pedidos de la tienda online de un comercio en GoDelivery.
   */
  async getStoreStats(email: string) {
    if (!this.isInitialized || !this.firestore || !email) {
      return null;
    }

    try {
      const comercioId = await this.resolveComercioIdByEmail(email);
      if (!comercioId) return null;

      // 1. Obtener datos del comercio
      const commerceDoc = await this.firestore.collection('comercios').doc(comercioId).get();
      const commerceData = commerceDoc.exists ? commerceDoc.data() : null;

      // 2. Obtener estadísticas de productos
      const productsSnapshot = await this.firestore
        .collection('comercios')
        .doc(comercioId)
        .collection('products')
        .get();
      
      const totalProducts = productsSnapshot.size;
      const outOfStockProducts = productsSnapshot.docs.filter(
        d => (d.data().stockQuantity || 0) <= 0
      ).length;

      // 3. Obtener pedidos de GoDelivery
      const ordersSnapshot = await this.firestore
        .collection('orders')
        .where('comercioId', '==', comercioId)
        .get();

      const orders = ordersSnapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt
        };
      });

      // Ordenar pedidos por fecha de creación descendente
      orders.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });

      const totalOrders = orders.length;
      const pendingOrders = orders.filter((o: any) => o.status === 'pending').length;
      const completedOrders = orders.filter(
        (o: any) => o.status === 'delivered' || o.status === 'completed' || o.status === 'entregado'
      ).length;
      const cancelledOrders = orders.filter(
        (o: any) => o.status === 'cancelled' || o.status === 'rechazado'
      ).length;

      // Calcular facturación de pedidos que no estén cancelados ni rechazados
      const totalRevenue = orders.reduce((sum: number, o: any) => {
        if (o.status !== 'cancelled' && o.status !== 'rechazado') {
          return sum + (o.total || 0);
        }
        return sum;
      }, 0);

      return {
        commerce: {
          id: comercioId,
          name: commerceData?.name || 'Mi Tienda Online',
          subdomain: commerceData?.subdomain || commerceData?.slug || 'kiosco',
          isActive: commerceData?.isActive !== false,
          whatsapp: commerceData?.whatsapp || commerceData?.phone || '',
          address: commerceData?.address || '',
          instagram: commerceData?.instagram || '',
          facebook: commerceData?.facebook || '',
          schedules: commerceData?.schedules || [{ open: '08:00', close: '20:00' }],
          viewMode: commerceData?.viewMode || 'GRID',
        },
        stats: {
          totalProducts,
          outOfStockProducts,
          totalOrders,
          pendingOrders,
          completedOrders,
          cancelledOrders,
          totalRevenue,
        },
        recentOrders: orders.slice(0, 10).map((o: any) => ({
          id: o.id,
          clientName: o.clientName || o.client?.name || o.userName || 'Cliente Web',
          total: o.total || 0,
          status: o.status || 'pending',
          createdAt: o.createdAt
        }))
      };
    } catch (err: any) {
      console.error('[FirebaseSync] Error obteniendo estadísticas de GoDelivery:', err.message);
      return null;
    }
  }

  /**
   * Actualiza los datos de configuración de la tienda en Firestore.
   */
  async updateCommerceConfig(email: string, configData: any) {
    if (!this.isInitialized || !this.firestore || !email) {
      return null;
    }

    try {
      const comercioId = await this.resolveComercioIdByEmail(email);
      if (!comercioId) throw new Error('No se encontró el comercio asociado a esta cuenta.');

      const docRef = this.firestore.collection('comercios').doc(comercioId);

      const updates: any = {};
      if (configData.storeName !== undefined) updates.name = configData.storeName;
      if (configData.whatsapp !== undefined) updates.whatsapp = configData.whatsapp;
      if (configData.address !== undefined) updates.address = configData.address;
      if (configData.instagram !== undefined) updates.instagram = configData.instagram;
      if (configData.facebook !== undefined) updates.facebook = configData.facebook;
      if (configData.isActive !== undefined) updates.isActive = configData.isActive;
      if (configData.viewMode !== undefined) updates.viewMode = configData.viewMode;
      if (configData.schedules !== undefined) updates.schedules = configData.schedules;

      updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      await docRef.update(updates);
      console.log(`[FirebaseSync] Configuración de la tienda online actualizada en GoDelivery para el comercio ID: ${comercioId}`);
      return { success: true, comercioId };
    } catch (err: any) {
      console.error('[FirebaseSync] Error al actualizar la configuración del comercio:', err.message);
      return null;
    }
  }
}

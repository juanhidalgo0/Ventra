# Traspaso: fotos con IA, que ningún producto quede sin foto (2026-11-13)

Pedido del dueño: mejorar la búsqueda de fotos y que nunca quede un producto sin imagen.
Aprobó las ideas 1, 2 y 3 (abajo) sabiendo el costo: Haiku a unos US$ 0,0001 por producto
(con US$ 1 alcanza para unos 10.000 productos; Paulos tiene unos 5.000).
Antes había pedido que las fotos fueran gratis y sin IA; esta vez aceptó usar Haiku.

1. **Foto provisoria y reintento automático**: si no aparece foto, se guarda una tarjeta generada
   y una tarea de cada noche vuelve a buscar las provisorias.
2. **Arreglar el nombre con IA antes de buscar**: "GALL.OREO 118G X1" → "Galletitas Oreo 118 g".
3. **La IA elige la foto**: mira 2 a 4 fotos encontradas y elige la que es ese producto o ninguna.

## Hecho (sin commit ni publicación)

### Nube: `firebase/functions/ai.js`, tarea `kind: "photos"` de `ventraAi`
- `step: "names"`: `items: [{ name }]` (hasta 100, de a 50 en paralelo) →
  `items: [{ i, query, generic }]`. Lo que la IA no devuelve queda con el nombre tal cual.
- `step: "pick"`: `items: [{ name, generic?, photos: [{ mediaType, data(base64), title }] }]`
  (hasta 12 productos y 4 fotos por producto; cada foto pesa como máximo 400 KB en base64) →
  `items: [{ i, photo (1..n, 0 = ninguna), sure }]`. Los productos sin fotos no se mandan ni se cuentan.
- Cupo: cada producto cuenta 1 por paso. `LIMITS.photos = 20000` por mes y `DAILY.photos = 2000` por día.
  Se exporta `photosCount`.
- Pruebas: 3 nuevas en `firebase/test/ai.test.cjs`; `node firebase/test/ai.test.cjs` → 47 bien, 0 con falla.

## Falta: PC (`apps/backend`)

1. **`src/modules/products/placeholder-image.ts`** (nuevo):
   - Tarjeta SVG en base64 de 300x300 con fondo pastel (el color sale del nombre) y 2 iniciales grandes.
   - El encabezado del SVG es fijo y tiene un largo múltiplo de 3, para que el prefijo base64 sea siempre
     igual y se pueda filtrar con Prisma `startsWith`.
   - Atributos `data-ventra="provisoria" data-tries="n" data-at="ms"`: la propia tarjeta guarda los intentos.
   - Exportar `MISSING_IMAGE`: null, '', la foto vieja de Unsplash y `{ imageUrl: { startsWith: PREFIJO } }`.
   - Exportar también `isPlaceholder(url)`, `placeholderImage(name, tries)` y `placeholderInfo(url)`.
   - Reemplazar las listas `missing` repetidas en `sync-image.service.ts` (líneas 10 y 802),
     `products.service.ts` (filtro `hasImage`, cerca de la línea 140) y `hardware-image.service.ts` (línea 12).
2. **`AiService.call`**: agregar `'photos'` al tipo de `kind`.
   **`ProductsModule`**: importar `AiModule` (no hay ciclo: `AiModule` solo importa Prisma y Websocket).
3. **`SyncImageService.findPhotosBatch(products)`**, que reemplaza a `findPhoto`:
   - Si el código de barras es real y `lookupBarcode` da una foto segura, se usa esa.
   - Si no, se guardan las candidatas dudosas para que elija la IA.
   - El resto pasa por la IA en el paso `names`. Si la IA falla (PC sin vincular, tope, sin internet),
     se busca como antes con `runSearchersInParallel` por nombre.
   - Con la búsqueda que devuelve la IA, `nameCandidates(query)` busca en las tiendas VTEX
     (`/api/catalog_system/pub/products/search?ft=`: carrefour, dia, masonline, jumbo, farmacity, vea, disco).
     Toma 2 resultados por tienda, los ordena con `nameSimilarity` y se queda con 4.
   - Miniaturas: bajar cada foto con axios (timeout de 6 s), achicarla con Jimp a unos 160 px y pasarla a JPEG base64.
   - Paso `pick` de a 12 productos. Se acepta cualquier foto mayor que 0.
     Si el `pick` falla, solo se acepta la foto si pasa `isStrictMatch` contra el título.
4. **`autoPhotos`**: usar `findPhotosBatch`. Lo que no se encuentre se guarda como provisoria con `tries + 1`.
   La provisoria no se manda a Firestore.
5. **Reintento diario**: `setInterval` de 1 hora, como en `suppliers.service`.
   - Una vez por día, controlado con `StoreSetting 'photo_retry_day'` para que no corran varias PCs.
   - No corre si `VENTRA_NODE_KIND === 'cloud'` ni en la demo.
   - Hasta 400 productos: primero los que no tienen foto, después las provisorias vencidas.
     Esperas según `tries`: 1, 3, 7, 14 y 30 días.
6. **Foto quitada a propósito**: hoy '' significa tanto "nunca tuvo foto" como "la quitó el dueño".
   - Cuando el dueño la quita (`products.service` update, `photoRemoved`), guardar el id en
     `StoreSetting 'photo_opt_out'` y que el reintento lo saltee.
   - Ver `ProductPhoto.tsx:139`: el mensaje dice que queda sin foto.
7. **`products.service`**:
   - Al crear un producto (cerca de la línea 848) y al editarlo (cerca de la línea 981), usar
     `autoPhotos([id])` también para los productos sin código.
   - Al editar, solo si cambió el nombre o el código, o si no es provisoria, para no gastar IA en cada edición.
8. **`assignImagesToProducts`** (botón "Buscar fotos"): los que no tienen foto pasan por `findPhotosBatch`
   de a 24, avisando el progreso.
9. **GO** (`go.service.ts:580`): no mandar provisorias (`!isPlaceholder(url)`).
   Revisar también si alguna función de la nube pasa el base64 a Storage suponiendo que es JPEG.
10. **Caja**:
    - En modo gastro (`POSScreen.tsx:2510`), la tarjeta ámbar aparece cuando `!product.imageUrl`;
      con una provisoria no aparecería.
    - Decidir si en gastro se trata la provisoria como "sin foto", o no crear provisorias en gastro.
    - No cambiar el estilo de la caja (lo pidió el dueño).

## Después
- Probar con 50 productos de Paulos y pasarle al dueño el costo medido. El costo queda en
  `ventra_ai_usage.costUsd` y la cantidad en el campo `photos`.
- Publicar `ventraAi` (`--only functions:ventra:ventraAi`) y la caja, solo con el OK del dueño.
- Actualizar `firebase/functions/chat/ventra-kb.md` con cómo funcionan ahora las fotos.

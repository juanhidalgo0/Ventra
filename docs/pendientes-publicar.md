# Pendientes de publicar

Actualizado: 7 de octubre de 2026. Regla: **nada nuevo hasta vaciar esta lista**, salvo bugs.

## 0. Boletas a prueba de errores — tanda 1 (12/11/2026, lista, sin publicar)

Plan completo en `docs/plan-boletas-ia.md`. Probado con IA y base simuladas (`npm run test:boletas`, `test:stock`, `test:http`, `test:repetidos` en `apps/backend`; `node firebase/test/ai.test.cjs` y `wa-owner.test.cjs`).

| Qué | Dónde |
|---|---|
| Muestras de boletas (foto + lectura + resultado confirmado) **detrás de un interruptor apagado** | `firebase/functions/invoice-samples.js`, `ai.js`; la caja manda lo confirmado |
| Catálogos de cualquier tamaño (la IA recibe los 30 parecidos por renglón) | `product-matcher.service.ts` |
| Mismo producto en dos renglones (por código) | `product-matcher.service.ts`, `NewPurchaseScreen`, `PurchaseItemsTable` |
| QR de ARCA leído sobre la foto original (total, CUIT, número, fecha, nota de crédito, a nombre de otro) | `invoice-reader/arca-qr.ts` (paquete nuevo `jsqr`), `ai.js` |
| Aviso de foto movida/oscura/chica (PC y celular) | `utils/photoQuality.ts` |
| Deshacer boleta (stock, costos y precios como antes; productos nuevos ocultos) | `purchases.service.ts` (`undoPurchase`, columna `undo_info`), `PurchasesScreen` |
| Hojas que faltan se suman a la pendiente; WhatsApp hasta 20 fotos; impuestos internos al costo | `purchases.service.ts`, `wa-owner-invoice.js`, `ai.js` |

Orden para publicar (con tu OK):
1. `cd firebase/functions` y `FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase deploy --only functions:ventra:ventraAi,functions:ventra:ventraWaOwnerInbox` (antes que la caja: la caja nueva manda `qr`, `stage: "confirm"` y lee `impuestosInternos`).
2. `npm run deploy:cloud` (caja en la nube; corre `test:http`).
3. Versión de PC.

Para prender las muestras: crear en Firestore `ventra_config/invoiceSamples` con `{ enabled: false, uids: ["<tu uid>"] }` (solo tu cuenta). Para todos (`enabled: true`) **hace falta antes actualizar los términos** y decidir cuánto tiempo se guardan.

### Regla del lector de boletas (tanda 2.4)

**Ningún cambio a `firebase/functions/ai.js` (lectura de boletas) se publica sin correr la evaluación y sin que el acierto se mantenga o suba:**

```
cd firebase/functions
node eval-boletas/eval.js --fabricadas          (boletas fabricadas: siempre)
node eval-boletas/eval.js --muestras --bajar    (muestras reales confirmadas, cuando haya)
```

Si baja contra la línea de base, el comando lo dice ("no publicar") y termina con error. Las marcadas "Leyó mal" se evalúan primero (`--leyo-mal`). Necesita `VENTRA_ANTHROPIC_KEY` en la terminal; muestra el costo estimado y pregunta antes de gastar.

**Línea de base (12/11/2026, IA de verdad, 60 fotos fabricadas, US$ 0,23):** 49 de 60 perfectas (81,7%). Limpia, con sombra y con otro papel atrás: 100%. Girada 90%, borrosa 80%. Cortada 20%: esperable, falta el pie y el lector no inventa el total (la boleta queda para revisar). Los errores reales que quedan: el CUIT en fotos borrosas (2 de 10) y, en una foto girada de un presupuesto, leyó que los precios no tenían IVA. Escaló a Sonnet 2 veces y a Opus 1. Ojo: la IA varía un poco de una corrida a otra, así que una baja de una sola boleta puede ser ruido; ante la duda, correr de nuevo.

## 0b. Boletas — tanda 2 (12/11/2026, lista, sin publicar)

| Qué | Dónde |
|---|---|
| Comando de evaluación con informe por hoja, proveedor y forma de foto; corridas y línea de base en `.boletas-eval/` (fuera de git) | `firebase/functions/eval-boletas/eval.js`, `compare.js` |
| 10 boletas fabricadas (A, B, C, ticket, remito, presupuesto, a mano, bebidas "bultos,unidades", IVA mezclado con descuento, impuestos internos) × 6 fotos (limpia, girada, borrosa, sombra, cortada, papel atrás) | `eval-boletas/fabricadas.js`, `generar.js` (usa el Chrome de la PC) |
| Botón "Leyó mal" en la revisión → marca las muestras y avisa en el admin, pestaña **Boletas** | `ReviewTabs`, `purchases.service.ts` (`reportMisread`), `invoice-samples.js`, `invoice-admin.js`, `index.js` (acciones `boletas`), `web/admin.html` |

Para publicar: funciones `ventraAi` y `ventraAdmin`, la web (admin.html) y la caja. **Todavía no corrí la evaluación con la IA de verdad** (cuesta ~US$ 0,60 las 60 fotos): hace falta tu OK y la clave en la terminal. Esa primera corrida queda como línea de base.

## 0c. Boletas — tanda 3 (lista, sin publicar)

| Qué | Dónde |
|---|---|
| Mapa compartido código del proveedor → código de barras (un voto por comercio; 2+ coinciden = solo; 1 = sugerencia; no coinciden = dudoso) | `firebase/functions/supplier-codes.js` (acciones `supplierGet`/`supplierConfirm` de **ventraBarcodes**), `product-matcher.service.ts`, `shared-catalog.service.ts` |
| Producto nuevo que viene con código de barras, nombre y bulto de otros comercios | `purchases.service.ts` (`scanOne`), `NewPurchaseScreen` |
| "Primera boleta de este proveedor": avance, sugerencias y asociar pasando el lector | `FirstInvoicePanel.tsx` |
| Pantalla "Productos repetidos" en la revisión (la API ya existía) | `DuplicatesModal.tsx`, `ReviewTabs` |

Para publicar: función **ventraBarcodes** (antes que la caja) y la caja.

## 0d. Boletas — tanda 4 (lista, sin publicar)

| Qué | Dónde |
|---|---|
| Lecciones a prueba: con 3+ boletas confirmadas de ese proveedor se lee con y sin cada lección nueva; se adopta (para todos) o se descarta (para nadie). Cada lunes 10 h (tope US$ 2) y botón "Probar ahora" en admin → Boletas (tope US$ 0,60) | `firebase/functions/lesson-trials.js`, `supplier-lessons.js`, `index.js` (`ventraLessonTrialsWeekly`, acción `lessonsTrial`) |
| Ficha fija del proveedor (precios con o sin IVA, bultos o unidades, columna U.B., código interno, "bultos,unidades"), armada con las boletas confirmadas y metida en la primera lectura | `supplier-lessons.js` (`profileFrom`, `updateProfile`), `invoice-samples.js` |

Para publicar: funciones `ventraAi`, `ventraAdmin`, **`ventraLessonTrialsWeekly` (nueva)** y la web (admin.html). Ojo: la ficha y las pruebas usan las muestras, así que no hacen nada hasta prender `ventra_config/invoiceSamples`.

## 0e. Boletas — tanda 5 (lista, sin publicar)

Antes de cambiar, se probó cómo se comportaba: **un remito en $ 0 dejaba el costo del producto en $ 0 y su factura volvía a sumar el stock** (8 → 14). Arreglado:

| Qué | Dónde |
|---|---|
| Un renglón sin precio (remito) solo suma stock: no toca costo ni precio de venta | `purchases.service.ts` (`create`, `confirmPendingInner`) |
| "Es la factura de este remito": mismos productos y cantidades de un remito reciente → completa costos y deuda sin volver a sumar stock | `findRemitoFor`, `invoiceForRemito`, columna `doc_type`; aviso en `NewPurchaseScreen` |
| Nota de crédito (la IA la marca o el QR de ARCA): resta deuda; resta stock solo si se tilda "Devolví esta mercadería"; numeración propia | `confirmCreditNote`, `CreditNotePanel.tsx`, `ai.js` |
| Ticket largo en tramos: guía en pantalla y al juntar se sacan los renglones repetidos entre fotos | `ai.js` (`isTramo`, `joinTramos`), `ScanInvoiceSheet`, `NewPurchaseScreen` |

Para publicar: `ventraAi` (con la evaluación de boletas antes, por la regla) y la caja.

## 0f. Boletas — tanda 6 (lista, sin publicar)

| Qué | Dónde |
|---|---|
| Revisar solo lo dudoso: "34 renglones bien, 3 para mirar", lo que está bien plegado, el control del total a la vista y el motivo de cada duda (Enter salta entre dudas) | `NewPurchaseScreen` (pantalla de compras; la caja y el cobro no cambian) |
| Automático por proveedor: a las 5 boletas seguidas confirmadas sin tocar, ofrece "¿Cargar solas las de este proveedor?"; se apaga solo si una necesita corrección. El interruptor general sigue | `purchases.service.ts` (`scanStreak`, `supplierAuto`), columnas `scan_auto`/`scan_streak` en proveedores |
| Aprobar desde el celular: aviso nuevo "Boleta para aprobar" cuando un empleado escanea; el dueño (o encargado) confirma las limpias desde Compras en el celular | `notify.service.ts`, `firebase/functions/notify.js`, `MobilePurchasesScreen`, `MobileNotificationsScreen` |
| Sin internet: en la PC las fotos quedan en espera en disco (`ventra-scan-queue/`) y se leen solas; en el celular quedan en el teléfono y se mandan al volver la conexión | `scan-jobs.service.ts`, `ScanJobPanel`, `utils/scanQueue.ts`, `ScanInvoiceSheet` |

Para publicar: función **ventraNotify** (el aviso nuevo) y la caja (PC y web).

## 0g. Boletas — tanda 7 (lista, sin publicar)

| Qué | Dónde |
|---|---|
| Producto nuevo sin código de barras: el catálogo compartido sugiere códigos por nombre (mismo tamaño), con un toque; nunca solo | `firebase/functions/barcodes.js` (`search`, índice `words`), acción `searchName` de **ventraBarcodes**, `shared-catalog.service.ts`, `NewPurchaseScreen` |
| Caja: al escanear un código no registrado, "¿Es alguno de estos recién comprados sin código?" dentro de la ventana de alta rápida (la pantalla de cobro no cambia) | `UnknownCodeModal.tsx`, `products.controller.ts` (`recent-without-barcode`, `assign-barcode`) |
| Factura por WhatsApp en PDF, Excel o CSV: se lee sin IA, como en la PC | `wa-owner.js`, `wa-owner-invoice.js` |

Para publicar: **ventraBarcodes**, **ventraWaOwner** + **ventraWaOwnerInbox**, y la caja. Después, con tu OK: `node scripts/backfill-barcode-words.js --aplicar` (completa el índice de los códigos viejos; escribe en producción; sin `--aplicar` solo cuenta).

Pendiente tuyo (7.3): **averiguar con dos o tres comercios cómo les llega la factura hoy** (mail, WhatsApp, portal del proveedor). Por mail todavía no se recibe: hace falta una casilla de entrada (por ejemplo, reenviar a una dirección de Ventra); se arma cuando sepamos si vale la pena.

## 0h. Boletas — tanda 8 (lista, sin publicar)

| Qué | Dónde |
|---|---|
| Admin → Boletas: sin tocar por proveedor, renglones corregidos, costo por boleta, escaladas, "Leyó mal", lecciones y **los que peor se leen** | `invoice-admin.js`, `web/admin.html` |
| Aviso al comercio "Un proveedor subió fuerte un precio" (15% o más al confirmar una compra, escaneada o a mano) | `purchases.service.ts` (`afterConfirmAlerts`), `notify.service.ts`, `firebase/functions/notify.js` |
| Aviso "La factura de X no cierra": la boleta escaneada no cerraba y se confirmó sin cambiar nada | ídem |

Para publicar: **ventraNotify**, **ventraAdmin**, la web (admin.html) y la caja.

**Todo el plan de boletas (tandas 1 a 8) queda hecho y sin publicar.** Orden sugerido: primero correr la evaluación de boletas con la IA de verdad (línea de base), después funciones (`ventraAi`, `ventraBarcodes`, `ventraNotify`, `ventraAdmin`, `ventraLessonTrialsWeekly`, `ventraWaOwner`, `ventraWaOwnerInbox`), la web, la caja en la nube (`npm run deploy:cloud`) y la versión de PC.

## 1. Publicar ya (todo está hecho y probado)

| # | Qué | Cómo | Notas |
|---|-----|------|-------|
| 1 | **Versión 1.0.53 de Ventra para PC** | Yo armo la versión (subo el tag `v1.0.53`); vos, en GitHub → Actions → "Publicar version" → `v1.0.53` | Trae las pantallas de entrada nuevas y el arreglo para que una actualización nunca vuelva a bajar todo de la nube. La 1.0.52 ya está publicada. |
| 2 | **Caja web** (web.ventra.store) | `fly deploy -c fly.cloud.toml` desde la carpeta Kiosco | Lleva lo mismo que la PC. Hacelo junto con el punto 1. |
| 3 | **Aviso al celular de consumo de empleados** | `cd firebase/functions` y `npx firebase deploy --only functions` | Solo si no lo corriste después del 6/10. Firebase pide todos los secretos para publicar funciones: si falta uno, avisame. |

## 2. Terminar (falta un solo paso, casi siempre tuyo)

| # | Qué | Qué falta | Quién |
|---|-----|-----------|-------|
| 4 | **Cupones de la tienda online** | Publicar reglas, funciones, tienda y hosting | Vos (te paso los comandos juntos) |
| 5 | **Factura electrónica (ARCA)** | Sacar el certificado de **producción** de la CUIT de Ventra, cargar el secreto `ARCA_CREDENTIALS` y publicar `ventraFiscal` | Vos, en ARCA |
| 6 | **WhatsApp automático de la agenda** | Que Meta reactive la cuenta, plantilla `turno_recordatorio` aprobada en la cuenta real, secretos `VENTRA_WA_*` | Vos, en Meta |
| 7 | **Recordatorios por email** | Verificar el dominio ventra.store en Resend (registros DNS) | Vos, en el proveedor del dominio |
| 8 | **Google Search Console** | Dar de alta ventra.store y mandar el sitemap | Vos (10 minutos) |

## 3. Congelado (no se toca hasta tener 10 kioscos pagando)

- App en Play Store y App Store
- Modo gastronomía
- Landings nuevas por rubro (ropa, rotiserías, comparativa con Turnito)
- Cobro anual
- Archivado de historia vieja fuera de Neon (está apagado y anda bien así)

## 4. Calidad de la caja (lo hago yo)

- [ ] Prueba automática de stock y caja que corra antes de cada versión (venta, anulación, kits, compras, consumo, cierres)
- [ ] Errores de cada PC visibles en el panel de administración
- [ ] Publicar primero en 1 o 2 PCs y después en todas

## Para no olvidar

- Cada versión nueva: **una sola por vez**, probada, y recién después "Publicar version".
- Una vista previa o una prueba local **nunca** se conecta a la nube ni a GoDelivery (ver `tools/preview/README.md`).

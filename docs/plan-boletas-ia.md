# Plan: escaneo de boletas a prueba de errores

Armado el 2026-11-12 con el dueño. Este documento es el traspaso completo: quien lo ejecute no necesita la conversación original.

## Objetivo

Que cargar una compra con una foto sea tan confiable y rápido que nadie elija hacerlo a mano.

- **Ningún error entra callado.** Cada boleta queda verificada por la cuenta (renglones = total impreso) o marcada para revisar. No se promete 100% de acierto con fotos de celular; se promete que lo dudoso se ve.
- **Mejora sola con el uso.** Lo que aprende un comercio le sirve a todos (aprobado por el dueño), sin que el error de uno contagie a los demás.
- **Se puede medir.** Ningún cambio al lector se publica si baja el acierto contra boletas reales.

Número principal a seguir: **boletas confirmadas sin tocar nada**, por proveedor.

## Cómo trabajar este plan

- Una tanda por sesión, en el orden de abajo. Cada tanda termina con sus pruebas pasando y un commit propio.
- Antes de tocar algo, leer el código actual: varias piezas ya existen y hay que extenderlas, no rehacerlas.
- **No publicar nada sin el OK del dueño.** Dejar anotado en `docs/pendientes-publicar.md` qué quedó listo.
- El árbol de trabajo tiene cambios sin commit de otros temas (rama `rediseno-ui`): hacer commit solo de los archivos de la tanda, nunca `git add -A`.
- **El repositorio es público:** ninguna foto de boleta real, CUIT de clientes ni clave va al repo.
- Esta PC tiene credenciales de gcloud y hubo pruebas que escribieron en producción: las pruebas usan IA y base simuladas; lo que lea de producción (tanda 2) es solo lectura.

## Reglas del dueño que no se tocan

1. Nada se crea ni se modifica (productos, códigos, stock, precios) hasta que se confirma la boleta.
2. La carga automática arranca apagada; se enciende solo por decisión del comercio.
3. Nunca se crea un producto nuevo si hay uno parecido: queda dudoso con sugerencias.
4. El código interno del proveedor va en SKU, nunca en código de barras (`barcode-check.ts`).
5. No cambiar el estilo de la caja ni del cobro: los cajeros no se tienen que confundir.
6. Entrar con el candado cuenta como ADMIN: usar `useOwnerAccess` / `useManagerAccess`, nunca solo `user.role`.
7. Opus solo como última instancia de lectura; nunca para leer todo (costo).
8. Entre comercios no se comparten precios ni cantidades de compra; solo cómo viene la boleta y la relación código de proveedor → código de barras.
9. Con cada cambio visible, actualizar `firebase/functions/chat/ventra-kb.md` y `ventra-ayuda.md`.

## Cómo funciona hoy

| Pieza | Dónde | Qué hace |
|---|---|---|
| Lectura de la foto | `firebase/functions/ai.js` (`INVOICE_ONE_PROMPT`, `readInvoicePageCore`, `invoiceCloses`, `lineOk`, `groupInvoicePages`, `finishInvoices`) | Una lectura por hoja con Haiku. Controla renglón (cantidad × precio = total) y cierre contra subtotal/total al 0,5%. Si no cierra relee Sonnet y después Opus. Hoja sin total: dos lecturas tienen que coincidir. Junta hojas del mismo comprobante. |
| Lecciones por proveedor | `firebase/functions/supplier-lessons.js`, colección `ventra_supplier_lessons/{cuit}` | Texto libre, hasta 10 por CUIT. La de un comercio la usan todos cuando la confirma un segundo. |
| Catálogo compartido de códigos | `firebase/functions/barcodes.js`, `ventra_barcodes/{código}` | Nombre y foto por código de barras, un voto por comercio. Solo se busca por código. |
| Lectura en segundo plano | `apps/backend/src/modules/purchases/scan-jobs.service.ts` | Achica cada foto a 2000 px y la manda de a una (stage `page`), después agrupa (stage `group`). |
| Buscar el producto | `apps/backend/src/modules/ai/product-matcher.service.ts` | Código de barras → aprendido del proveedor (`supplier_codes`, local) → SKU → nombre → IA. Tres sugerencias para los no encontrados. |
| Códigos | `apps/backend/src/modules/purchases/invoice-reader/barcode-check.ts` | `isBarcode` estricto y control por columna (`splitInvoiceCodes`). |
| Compras | `apps/backend/src/modules/purchases/purchases.service.ts` | Borradores PENDING, dudosos, DUPLICATE por proveedor + número, `correctionsOf` manda las correcciones a la nube, `keepMarginSale`. |
| Juntar repetidos | `apps/backend/src/modules/products/product-merge.service.ts` | Ya existe: juntar, separar y deshacer. |
| PDF/Excel sin IA | `apps/backend/src/modules/purchases/invoice-reader/` | Lector de PDF de texto y planillas. |
| Pantallas | `apps/frontend/src/components/products/` (`InvoiceScanCard`, `NewPurchaseScreen`, `PurchasesScreen`, `ScannedPurchasesWatcher`) | Escaneo, revisión y pendientes. |

Pruebas: `npm run test:boletas`, `test:stock`, `test:http`, `test:repetidos` en `apps/backend`; `firebase/test/ai.test.cjs`. Todas con IA simulada.

## Fallas ya encontradas

- **Catálogos grandes:** `match()` manda a la IA `products.slice(0, 4000)`. Un comercio con 5.771 productos tiene un tercio del catálogo fuera de alcance.
- **Mismo producto en dos renglones:** al final de `match()` un producto se queda con un solo renglón; el otro queda sin asociar.
- **Lecciones sin comprobar:** nadie mide si una lección mejora o empeora la lectura.
- **No hay nota de crédito:** `docType` es factura, remito, nota, ticket u otro.
- **Hojas que faltan** de una factura pendiente: al escanearlas dice "ya estaba cargada" en vez de sumarlas.
- **WhatsApp** sigue con tope de 6 fotos.
- **Costo sin impuestos internos** en algunos proveedores (anotado, sin arreglar).
- **No se guardan las fotos:** no hay con qué medir.

---

## Tanda 1 — Empezar a juntar y arreglos rápidos

Va primero porque juntar boletas reales lleva meses.

> **Hecha el 2026-11-12, sin publicar** (ver `docs/pendientes-publicar.md`). Notas para las tandas siguientes:
> - Muestras: `firebase/functions/invoice-samples.js`, interruptor `ventra_config/invoiceSamples { enabled, uids }`. Se guardan desde el stage `page` y desde la lectura de varias fotos juntas (celular); el borrador lleva `sampleIds` y `confirmPending` manda lo confirmado (`stage: "confirm"`). La boleta confirmada desde el bot de WhatsApp todavía no manda su resultado.
> - Catálogo: hasta 2.000 productos va entero a la IA (no se perdía nada); más grande, la unión de los 30 parecidos de cada renglón.
> - QR: formato confirmado con el PDF oficial de ARCA ("Especificaciones del QR", versión 1). Nota de crédito: queda marcada y nunca se carga sola; restar deuda y stock es la tanda 5.2.
> - Deshacer: solo compras confirmadas desde ahora (guardan `undo_info`); las viejas siguen con Eliminar.
> - Impuestos internos: campo `impuestosInternos` aparte; con precios sin IVA se reparten entre todos los renglones según su importe (la boleta no dice a qué renglón van).
> - WhatsApp: tope 20 fotos (más de 6 se leen de a una en la caja, para entrar en el tiempo del bot).

**1.1 Guardar cada boleta como muestra**
- En la nube, al leer una hoja (stage `page`): guardar la foto en Storage y un documento `ventra_invoice_samples/{id}` con comercio, CUIT, lo que leyó la IA, qué modelos intervinieron y si cerró. Devolver el `sampleId`.
- La caja guarda el `sampleId` en el borrador y, al confirmar, manda lo que quedó (renglones finales). Ese resultado confirmado es la respuesta correcta.
- Solo lo leen las funciones y el admin; las reglas no lo exponen.
- Detrás de un interruptor (apagado hasta que el dueño actualice los términos).
- Hecho cuando: una boleta escaneada y confirmada deja foto + lectura + resultado en la nube, y con el interruptor apagado no guarda nada.

**1.2 Catálogos de cualquier tamaño**
- En `match()`: para cada renglón sin encontrar, tomar los 30 más parecidos (reusar `similar()` con tope mayor) y mandar a la IA solo la unión de esos candidatos.
- Hecho cuando: una prueba con 6.000 productos encuentra uno que está en la posición 5.500.

**1.3 Mismo producto en dos renglones**
- Permitirlo cuando los dos renglones coinciden por código de barras, aprendido o código interno. Mantener la regla de "uno solo" para coincidencias por nombre o IA.

**1.4 QR de ARCA**
- Leer el QR en la caja, sobre la foto original antes de achicarla. El QR de la factura electrónica trae un JSON en base64 con fecha, CUIT del emisor, punto de venta, tipo y número de comprobante, importe y documento del receptor. **Confirmar el formato en la documentación de ARCA antes de programar.**
- Usarlo como: total exacto (el parámetro `manualTotal` ya existe), CUIT, número y fecha; tipo de comprobante para distinguir nota de crédito.
- Si el documento del receptor no es el del comercio, avisar ("esta factura está a nombre de otro").
- Si el QR no se lee, todo sigue como hoy.
- Hecho cuando: una factura con QR legible cierra contra el importe del QR aunque el total impreso esté tapado.

**1.5 Aviso de foto mala antes de subir**
- En el celular y en la PC: detectar foto movida, oscura o muy chica. Aviso con "Sacar de nuevo" y "Usar igual"; nunca bloquea.

**1.6 Deshacer una boleta confirmada**
- Revisar primero qué existe hoy para anular una compra y si devuelve stock, costos y precios de venta.
- Si no lo hace completo: guardar al confirmar los valores anteriores de cada producto y ofrecer "Deshacer boleta". Los productos creados por esa boleta se ocultan si no tuvieron ventas.

**1.7 Pendientes anotados**
- Hojas que faltan: sumarlas a la factura pendiente.
- Sacar el tope de 6 fotos de WhatsApp (`wa-owner.js`).
- Costo con impuestos internos.

## Tanda 2 — Banco de pruebas

**2.1 Comando de evaluación**
- Nuevo comando que baja las muestras a una carpeta local fuera del repo (agregarla a `.gitignore`), corre el lector real y compara contra lo confirmado.
- Mide por hoja y por proveedor: CUIT, número, fecha, total; por renglón cantidad, unidades por bulto, costo, código; boleta perfecta sí/no; costo y cuántas veces escaló a Sonnet u Opus.
- Guarda el resultado como línea de base y muestra la diferencia con la corrida anterior.
- Antes de correr muestra el costo estimado y pide confirmación; acepta un tope de hojas.

**2.2 Boletas fabricadas**
- Generar boletas con contenido conocido en los formatos argentinos comunes (factura A, B y C, ticket fiscal, remito, presupuesto, nota a mano, distribuidora de bebidas con "bultos,unidades", 10,5% y 21% mezclados, percepciones, impuestos internos).
- Arruinarlas: giradas, borrosas, con sombra, cortadas, con otro papel atrás.
- Estas sí pueden ir al repo.

**2.3 Botón "Leyó mal"**
- En la revisión: un toque marca la muestra y avisa al dueño de Ventra en el admin. Esas muestras se evalúan primero.

**2.4 Regla de publicación**
- Anotar en `docs/pendientes-publicar.md`: ningún cambio a `ai.js` se publica sin correr la evaluación y sin que el acierto se mantenga o suba.

Hecho cuando: el comando corre contra al menos las boletas fabricadas y da un informe comparable entre corridas.

## Tanda 3 — Mapa compartido entre comercios

**3.1 La colección**
- `ventra_supplier_codes/{cuit}_{código}`: código de barras, nombre y unidades por bulto, con un voto por comercio (misma mecánica que `barcodes.js`).
- Se alimenta al confirmar una boleta (donde hoy `learn()` guarda en `supplier_codes` local). Solo con CUIT válido y código de barras que pase `isBarcode`.

**3.2 Uso al leer**
- En `match()`, después de lo aprendido local y antes del SKU: pedir a la nube los códigos de los renglones sin encontrar.
- Dos o más comercios coinciden: se asocia solo, confianza alta. Un solo comercio: sugerencia, queda dudoso. Se contradicen: dudoso.
- Producto nuevo: viene con código de barras, nombre y unidades por bulto ya completos.
- Sin internet: sigue como hoy, sin error.

**3.3 Pantalla "primera boleta de este proveedor"**
- Cuando el proveedor no tiene nada aprendido: todos los renglones en una lista para asociar de corrido, con las sugerencias a la vista.
- Aviso honesto arriba: "La primera boleta de cada proveedor lleva unos minutos. Las próximas son segundos."
- Mostrar el avance: "34 de 40 reconocidos".

**3.4 Asociar con el lector**
- En la revisión, parado en un renglón: pasar el lector por el producto. Si el código ya existe, se asocia a ese producto; si no, queda como código del producto nuevo. Salta al siguiente renglón sin código.

**3.5 Repetidos**
- Desde la revisión y al terminar la primera boleta, enlazar a "Productos repetidos" (ya existe).

Hecho cuando: una prueba con dos comercios simulados muestra que lo que asoció el primero lo recibe el segundo, y que un voto solo no carga nada solo.

## Tanda 4 — Aprendizaje que se comprueba

**4.1 Lecciones a prueba**
- Una lección nueva queda como candidata. Con tres o más muestras de ese CUIT, se corre la lectura con y sin la lección: se adopta si el acierto sube, se descarta si baja.
- Con menos muestras, sigue la regla actual (dos comercios).
- Corre semanal y con botón en el admin, con tope de gasto.

**4.2 Ficha del proveedor**
- Además del texto libre, datos fijos por CUIT: si los precios traen IVA, si la cantidad viene en bultos o unidades, si la columna de código es interna, si hay columna de unidades por bulto, formato de cantidad.
- Se arma sola con las boletas confirmadas y entra en la primera lectura, para que Haiku acierte de entrada y escale menos.

Hecho cuando: una lección que empeora las muestras queda descartada sola y se ve en el admin.

## Tanda 5 — Casos reales que faltan

**5.1 Remito primero, factura después**
- Al llegar una factura, buscar un remito reciente del mismo proveedor con los mismos productos y cantidades. Proponer "es la factura de este remito": completa costos y deuda sin volver a sumar stock.
- Probar primero cómo se comporta hoy.

**5.2 Nota de crédito**
- Sumar el tipo al lector (y tomarlo del QR). Resta deuda; resta stock solo si el dueño confirma que es devolución de mercadería.

**5.3 Ticket largo en varios tramos**
- Guía en pantalla: "sacá el siguiente tramo dejando 2 renglones repetidos".
- Al juntar hojas del mismo comprobante, descartar los renglones repetidos entre el final de una foto y el principio de la siguiente.

## Tanda 6 — Que lo elijan en vez de cargar a mano

**6.1 Revisar solo lo dudoso**
- "34 renglones bien, 3 para mirar": los que están bien, plegados; el control a la vista ("suma $182.400 = total impreso"). En la PC, Enter salta a la siguiente duda.
- Sin cambiar el estilo de la caja: esto es la pantalla de compras.

**6.2 Automático por proveedor**
- Después de 5 boletas seguidas de un proveedor confirmadas sin tocar nada, ofrecer "¿Cargar solas las de este proveedor?". Se apaga solo si una boleta de ese proveedor necesita corrección.
- El interruptor general actual sigue existiendo.

**6.3 Aprobar desde el celular**
- El empleado saca la foto; al dueño le llega el aviso y puede revisar y confirmar desde la app.

**6.4 Sin internet**
- La foto queda en cola y se lee cuando vuelve la conexión, con aviso claro de que está esperando.

## Tanda 7 — Boletas sin código de barras y sin foto

**7.1 Buscar por nombre en el catálogo compartido**
- Índice por palabras sobre `ventra_barcodes` para proponer el código de un producto nuevo. Siempre con confirmación de un toque, nunca solo.

**7.2 Asociar en la caja**
- Al escanear un código no registrado, además del alta rápida que ya existe: "¿Es alguno de estos recién comprados sin código?". Sin cambiar el aspecto de la pantalla de cobro.

**7.3 Factura por mail o WhatsApp**
- Aceptar el PDF que manda el proveedor y pasarlo por el lector sin IA. Averiguar antes con dos o tres comercios cómo les llega hoy.

## Tanda 8 — Seguimiento

- En el admin: boletas sin tocar por proveedor, renglones corregidos, costo por boleta, proveedores que peor leen.
- Avisos al comercio: un proveedor subió fuerte un precio; la cuenta de la factura está mal.

---

## Segunda vuelta (anotado, no ahora)

- Aviso de margen con precio sugerido.
- Recordatorio de pago en cuenta corriente.
- Pedir vencimiento al recibir en los rubros que lo usan.
- Resumen mensual por WhatsApp con el tiempo ahorrado.
- Comparar lo pedido con lo que llegó.
- Mostrar el recorte de la foto al lado de cada renglón (probar antes si la IA ubica bien las filas).

## Publicar

Siempre con OK del dueño y en este orden:

1. La función de la nube: `firebase deploy --only functions:ventra:ventraAi` (y las que cambien), con `FUNCTIONS_DISCOVERY_TIMEOUT=90`.
2. La caja en la nube: `npm run deploy:cloud` (corre `test:http` antes).
3. La versión de PC.

Si la caja nueva sale antes que la función, las fotos fallan.

## Decisiones pendientes del dueño

- Actualizar los términos para avisar que se guardan las fotos de las boletas (hasta entonces, el interruptor de 1.1 queda apagado para clientes; se puede encender en la cuenta propia).
- Cuánto tiempo se guardan las muestras.

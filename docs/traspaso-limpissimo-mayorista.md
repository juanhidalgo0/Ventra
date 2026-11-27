# Traspaso: Limpissimo y lista mayorista (sesión del 19-11-2026)

Para seguir en otra cuenta. Rama `rediseno-ui`, último commit `dc878e9` (tag `v1.0.109`, subido).

## Lo que pidió el cliente (Limpissimo, distribuidora de limpieza de San Jorge)

- Cuenta Ventra: **limppisimosanjorge@gmail.com** (con doble p). Firebase uid / tenant: `CN3OU7wxANUD8SXf7qmVOqjQEsu2`. Plan Full. Usa la **caja web** (web.ventra.store, fly `ventra-cloud`).
- Viene del sistema "Fidel". Sus planillas están en `Descargas` y los archivos listos para importar, en `Descargas\Limpissimo para importar`:
  1. `1 - Productos (formato Ventra).xlsx`: **ya importado** (628 productos con código, marca, categoría y mayorista).
  2. `2 - Proveedores.xlsx`: **ya importado** (23).
  3. `3 - Clientes.xlsx`: **ya importado** (354, con 77 saldos).
  4. `4 - Productos precios minorista y mayorista.xlsx`: **FALTA IMPORTAR**. Va en Productos → Datos → Importar productos, con "Actualizar stock" tildado. Trae código, nombre, rubro, marca, proveedor (traducido al nombre con que se importó, para no duplicar), costo, minorista (de "Listas de Precios MINORISTA.xlsx"), mayorista (del PDF "LISTA NOV NUEVA") y **stock** (106 negativos, se cargan igual que en Fidel; el importador avisa "Stock negativo"). Probado en una base local: 626 actualizados + 11 nuevos sin mayorista, sin repetir proveedores.
- Los scripts de lectura y armado están en el scratchpad de la sesión (temporales): `parse-lista.cjs` (PDF), `make-update-xlsx.cjs` (archivo 4), `cols.py`, `tenant-*.cjs` (lecturas de Neon).

## Hecho y publicado hoy (v1.0.105 → v1.0.109)

- **Lista Mayorista/Minorista por cliente** (`Client.priceList = TRADE`, `Product.tradePrice`; en la distribuidora se llama "Mayorista", en la ferretería "Gremio"): caja de PC y del celular, Preventa (servidor incluido), tienda online, cobro de pedidos de la tienda.
- **Producto**: margen mayorista sobre el costo, que sigue al costo. **Aumentar precios**: modo "Margen sobre costo".
- **Promos y combos** con precio mayorista; **combos de varios productos** en la tienda, Preventa, Pedidos, caja y reparto (commit d6aa4a2, mezclado en 975b2db).
- **Tienda online**: los precios mayoristas van en `ventra_stores/{id}/tradePrices/{clave}` (no se pueden listar) y solo los ve el cliente con su link. `order-check.js` (ventraOrderPush) los tiene en cuenta. Reglas, ventraOrderPush, ventraChat y hosting de la tienda publicados.
- **Caja**: "Cobrar" va directo a Consumidor final; el cliente se elige o cambia en el cobro (SaleClientPicker). "Cobrar con precio mayorista (sin registrar cliente)" (`WALK_IN_TRADE`, vuelve a minorista al vaciar o cobrar).
- **Importar clientes y proveedores desde Excel** (Clientes / Proveedores → Importar; solo el dueño). Los saldos entran como "Saldo anterior al sistema"; importar dos veces no duplica.
- **Catálogo en PDF** (Productos → Precios → Catálogo en PDF): minorista, mayorista o los dos.
- **Productos**: columna minorista/mayorista, filtro "Con/Sin precio mayorista", código interno visible donde no hay código de barras.
- Caja web (`ventra-cloud`) y demo (`go-portal-pos`) publicadas en 1.0.108. **1.0.109 se estaba publicando** al cortar: revisar `fly releases -a ventra-cloud` / `-a go-portal-pos`. Si no se publicó, desde una copia limpia en `dc878e9`: `npm run deploy:cloud` y `fly deploy -c fly.toml`.

## Incidente de datos (resuelto en la cuenta del cliente; el arreglo está en 1.0.109)

Al entrar como **soporte** desde el navegador del dueño, `syncStoreSettings` subió a la cuenta de Limpissimo la configuración de Maxikiosco Paulos que había en ese navegador (nombre, dirección, teléfono, CUIT, IVA, QR del ticket, días de reparto, fondo de caja, socios, valor hora). Causa: todos los comercios comparten la dirección de la caja web, y lo que el servidor no tenía se subía desde el navegador.

- **Limpieza hecha** (14:50 UTC, con `push()` de `firebase/functions/sync.js`, equipo `soporte-ventra`): esos 11 ajustes quedaron vacíos en la cuenta del cliente. Logo y rubro de Limpissimo intactos. Otros ajustes subidos en el mismo momento quedaron como estaban (permitir stock negativo, alertas de stock bajo, consumo de empleados, margen de compra 40, códigos de cargas virtuales, onboarding hecho): revisar con el dueño si los quiere en blanco.
- **Arreglo (dfbbc14)**: `apps/cloud-host/host.js` pone `window.__VENTRA_TENANT` y `window.__VENTRA_SUPPORT` en la página. `apps/frontend/src/services/storeSettings.ts` (`guardTenant`) olvida la configuración si es de otro comercio, y en soporte nunca sube la del navegador. Solo surte efecto con la caja web en 1.0.109.
- Pendiente: avisar a los demás clientes a los que se entró como soporte desde ese navegador (puede haberles pasado lo mismo) y revisar su `store_settings` en Neon.

## Pendiente

1. Confirmar que la 1.0.109 quedó publicada (caja web y demo).
2. **"Publicar version" en GitHub** (Actions → Publicar version → `v1.0.109`): el navegador de la app no tenía la sesión de GitHub. Las 1.0.105–108 no hace falta publicarlas.
3. Que el cliente importe el **archivo 4** (precios y stock).
4. Responder al cliente (últimos audios):
   - Elegir un cliente ya cargado pone sola su lista de precios: así funciona.
   - **Fotos**: faltan las de algunos productos. Hay que usar Productos → Fotos (fotos por código o con IA).
   - **Stock**: no se ve todavía porque falta importar el archivo 4.
   - **"Oferta por cantidad"**: "A partir de 10 unidades, precio por unidad $X" quiere decir que, llevando 10 o más de ese producto en un mismo ticket o pedido, cada unidad se cobra $X. Es distinta del precio mayorista, que depende del cliente. Conviene mejorar el texto de ayuda de ese bloque en `ProductModal.tsx`.
5. Memorias actualizadas: `ventra-lista-mayorista.md` y `limpissimo-cliente.md`. Sumar este incidente a la memoria si no está.

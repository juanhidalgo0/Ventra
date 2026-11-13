# Traspaso: tienda de Dany's Pizza y catálogo de la distribuidora

Estado al 13/11/2026. Rama `rediseno-ui`. **Nada de esto tiene commit ni está publicado.**
El árbol tiene muchos otros cambios sin commit que no son de esta tarea: commitear solo los archivos de abajo.

---

## Parte 1 — Dany's Pizza: "Lo más pedido" + sugerencia al confirmar (HECHO, sin publicar)

Pedido del dueño: mejorar la tienda online de Dany's Pizzas (`tienda.ventra.store/danys-pizza`,
doc `ventra_stores/store_b0eba996f02e41d3b961dc97f97c3f97`, rubro `GASTRONOMIA`).
El dueño **descartó** "estado del pedido en vivo" (Recibido → En el horno → En camino). No hacerlo.

### Qué se hizo

| Archivo | Cambio |
|---|---|
| `firebase/tienda/index.html` | `bestSellers()` / `bestCard()` / `bestHtml()`: fila deslizable "Lo más pedido" arriba del menú (solo `S.food`, solo con "Todo" elegido y sin búsqueda). Toma productos con `rank`, sin bebidas ni postres (`DRINK_RE`, `SWEET_RE` sobre categoría), de 3 a 5; si hay menos de 3 no aparece. Cada tarjeta tiene #puesto y el mismo `buyControl` del menú (con agregados o tamaños abre la ficha). |
| `firebase/tienda/index.html` | `upsellHtml()` reescrito: antes mostraba hasta 8 bebidas y postres mezclados. Ahora: si el pedido no tiene bebida → "¿Le sumás algo para tomar?" con bebidas; si ya tiene → "¿Y algo dulce para el final?" con postres; si tiene las dos → nada. Máximo 4, ordenadas por `rank`. |
| `firebase/tienda/index.html` | `groupVariants`: el grupo (chica/grande) toma el menor `rank` de sus variantes. `refreshProduct` también actualiza el botón de la tarjeta de "Lo más pedido". CSS `.best*` y `.ups-sub`. Ícono nuevo `#i-flame`. |
| `apps/frontend/src/services/onlineStore.ts` | `OnlineProduct.rank?`. `bestSellerRanks()` llama a `GET /sales/dashboard?from=<hace 90 días>&top=30`; `syncCatalogToStore` le pone `rank` (1 = más vendido) a cada producto antes de publicar. Si falla, publica sin rank (la sección no aparece). `rank` NO está en `diffCatalog` a propósito (si no, todo figuraría "con cambios"). |
| `apps/backend/src/modules/sales/sales.controller.ts` + `sales.service.ts` | `getDashboardData` acepta `top` opcional (1-50, por defecto 10). Los servidores viejos lo ignoran y devuelven 10. |
| `tools/preview/tienda-pizza.js` + `.claude/launch.json` (`tienda-pizza-preview`, puerto 5241) | Vista previa SIN nube: sirve la tienda con Firebase simulado y una pizzería inventada. Abrir `http://localhost:5241/pizza-prueba`. |

Verificado: los dos proyectos compilan (`npx tsc --noEmit` en `apps/backend` y `apps/frontend`). En la vista previa (celular 375 px): la fila muestra 5 sin bebidas/postres, el "+" suma y el contador se actualiza, la sugerencia pasa de bebidas a postres al sumar una Coca y desaparece al sumar un flan. Sin errores en consola.

### Para que el cliente lo vea (pedir OK al dueño antes de cada paso)
1. Commit de los archivos de la tabla.
2. Publicar la tienda: `firebase deploy --only hosting:tienda` (desde `firebase/`).
3. Caja web (fly) y versión nueva de Ventra para las PCs (el cálculo del ranking vive en la caja). Ver cómo se publica sin romper: `npm run deploy:cloud`; el tag de versión lo sube Claude y "Publicar version" en GitHub lo aprieta el dueño.
4. Dany's tiene que **volver a publicar su catálogo** desde Ventra (Tienda online → Sincronizar). El catálogo publicado es del 28/09 y no tiene `rank`.

### Revisión de la carta de Dany's (catálogo público, solo lectura)
79 productos: 39 con foto, 34 con descripción.
- Sin foto: todas las bebidas, los 3 postres (Chocotorta, Estilo tiramisú, Postre Oreo), la fainá, empanadas de carne, cebolla y queso, humita, jamón y queso, pollo, tomate y queso; pizzas anchoas, calabresa, doble muzzarella, fugazza con muzzarella (y con roquefort), jamón y huevo, palmitos.
- Sin descripción: napolitanas, jamón y morrón, palmitos, jamón y huevo, jamón crudo, entre otras.
- Importa porque la sugerencia de postres va a salir sin foto. Recomendación al dueño: cargar esas fotos.

---

## Parte 1b — Botón "Categorías" en todas las tiendas (HECHO, sin publicar)

Pedido del dueño: como en las tiendas de GO. En `firebase/tienda/index.html`: chip "Categorías" (ícono `#i-grid`) al principio de la barra de categorías cuando hay 4 o más (`manyCats()`); abre la hoja `#catSheet` con todas de la A a la Z, foto del primer producto, cantidad, subcategorías de muestra y buscador que también encuentra subcategorías (`catsListHtml`, `openCats`, `pickCat`). Si no encuentra, "Buscarlo entre los productos" (`cat-find`). Probado en la vista previa a 375 px, sin errores. Se publica junto con la Parte 1 (`hosting:tienda`, no necesita caja nueva).

---

## Parte 2 — Distribuidora Magdalena: tienda tipo catálogo (BOCETO, sin empezar)

El dueño quiere que la tienda de la distribuidora sea "tipo catálogo, para muchos productos, cómoda para sus clientes" (comercios que reponen). Hoy la tienda muestra tarjetas grandes de 2 a 4 por fila (`.grid` en `firebase/tienda/index.html`), pensadas para pocos productos.

Contexto que ya existe (no rehacer): venta a comercios con `S.cfg.wholesale.enabled` (`WS()`), bulto (`packOf`, `p.pack {size, price}`), oferta por cantidad (`offerOf`, `p.wholesale {price, minQty}`), link personal del cliente `?c=<token>` con su último pedido ("Repetir último pedido", `ws-repeat`), días de reparto por localidad (`routeDays`, "próximo día de reparto"), stock libre (`stock/free`) que topa cantidades. Precios iguales para todos los clientes.

### Boceto mostrado al dueño (falta su OK para armarlo)
Se activa solo con la venta a comercios prendida; el resto de las tiendas no cambia.
- Lista compacta: una fila por producto (foto chica 40 px, nombre, "Bulto x8 $27.200 · u. $3.400", etiqueta de oferta) con **"+ Bulto" y "+ Unidad" en la misma fila**; al tocar pasa a stepper "2 bultos" con − / +. ~8 productos por pantalla en celular.
- Arriba: saludo con el nombre del comercio (si entra con link) y aviso del día de reparto.
- Buscador por nombre, marca o código que filtra mientras se escribe.
- Rubros fijos (sticky) + chips "Siempre pedís" y "Ofertas".
- "Lo que siempre pedís" arriba de todo (de su historial; hoy solo está el último pedido publicado en el doc del cliente) + "Repetir último pedido".
- Barra fija abajo: bultos, unidades y total → Ver pedido.
- Liviana con miles de productos: dibujar filas a medida que se scrollea y fotos con lazy loading.

Dos detalles del boceto que **no existen** y el dueño todavía no decidió:
1. "Pedí hasta el miércoles": hay días de reparto por localidad pero no hora de cierre para pedir; habría que agregarla a la config.
2. "Avisarme" en productos sin stock: lo más trabajoso; sugerido dejarlo para después.

Próximo paso: preguntar al dueño si lo arma así y si incluye esos dos detalles. "Lo que siempre pedís" con más de un pedido necesita que Ventra publique más historial en `ventra_stores/{id}/clients/{token}`.

---

## Notas para quien siga
- Nunca publicar (hosting, funciones, fly, reglas) sin OK explícito del dueño.
- Esta PC tiene credenciales de gcloud: pruebas que llamen a la nube escriben en producción. Usar la vista previa simulada.
- La tienda es un solo HTML sin build (`firebase/tienda/index.html`, JS ES5 con `var`/`function`). Mantener ese estilo.
- Textos al dueño y en la UI: en castellano rioplatense, simples, sin tecnicismos.
- El asistente de la web lee `firebase/functions/chat/ventra-kb.md`: al publicar, sumar ahí "Lo más pedido" y la nueva sugerencia.

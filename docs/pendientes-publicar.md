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

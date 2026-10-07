# Pendientes de publicar

Actualizado: 7 de octubre de 2026. Regla: **nada nuevo hasta vaciar esta lista**, salvo bugs.

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

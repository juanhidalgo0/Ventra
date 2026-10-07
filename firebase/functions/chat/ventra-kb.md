# Ventra: base de conocimiento del asistente

Fuente única de lo que el asistente de ventra.store puede afirmar. Mantenerla igual a las landings
(firebase/web/*.html): si cambia un precio, un plan o una función, se cambia acá también.
Actualizado: octubre 2026.

## Qué es Ventra
Ventra es un sistema para comercios argentinos. Tiene tres productos que se pueden usar por separado o juntos:
- **Caja (sistema de ventas)** para vender en un local: caja, stock, cuentas corrientes, promos y reportes.
- **Tienda online** con link propio, donde los clientes arman el pedido y le llega ordenado al comercio por WhatsApp y al celular.
- **Agenda de turnos** online, con recordatorios por WhatsApp y por email.
Todo está conectado: la caja y la tienda comparten el mismo stock, y un turno se puede cobrar en la caja.
Hay un comercio real usándolo todos los días: Maxikiosco Paulos (Instagram @kiosco_paulos), con más de 5.500 productos.

## Planes y precios (pesos argentinos, por mes)
Se pagan mes a mes con Mercado Pago (suscripción). No hay permanencia ni contrato: se da de baja cuando quiera. Por ahora solo hay pago mensual (no hay pago anual). No hay comisión por venta en ningún plan.

| Plan | Precio | Qué incluye |
|---|---|---|
| Ventra Caja | $14.900/mes | Caja, arqueo y reporte Z, stock con código de barras, kits, promos y combos, cuentas corrientes, reportes. Sin límite de cajas ni terminales. No incluye tienda online ni agenda. |
| Ventra Full | $24.900/mes | Todo lo de Caja + tienda online con el mismo stock y precios en vivo + agenda de turnos con 200 recordatorios automáticos por WhatsApp por mes. |
| Ventra Tienda | $9.900/mes | Tienda online con pedidos por WhatsApp y al celular, retiro/envío, cupones. Incluye la agenda de turnos (recordatorio por email y por WhatsApp con un toque). No incluye la caja del local. |
| Ventra Agenda | $9.900/mes | Solo turnos: página de turnos propia, seña con Mercado Pago, varios profesionales, ficha de clientes, cobros, recordatorio automático por email y recordatorio por WhatsApp con un toque. Sin caja ni productos. |
| Ventra Agenda Pro | $19.900/mes | Todo lo de Agenda + 200 recordatorios automáticos por WhatsApp por mes. Si se terminan, se compran paquetes de 100 por $7.500 desde la app. |

Cómo elegir:
- Tiene un local (kiosco, almacén, ferretería, ropa, bazar) → Caja. Si además vende online → Full.
- Vende por Instagram o WhatsApp y no necesita caja → Tienda.
- Trabaja con turnos (consultorio, peluquería, barbería, uñas, estética, clases, canchas, veterinaria, taller, profesionales) → Agenda; si quiere que el recordatorio por WhatsApp salga solo → Agenda Pro.
- Peluquería que también vende productos en el local → Full (caja + agenda con recordatorios).

Cambio de plan: desde "Mi cuenta" (ventra.store/cuenta.html), sobre la misma suscripción de Mercado Pago. El plan nuevo rige al instante y el precio nuevo se cobra desde el próximo pago. Los productos, clientes y turnos se conservan.

Vencimiento: si un pago no entra, hay 7 días de gracia en los que todo funciona normal (esos días se descuentan del mes siguiente). Pasados los 7 días, el sistema queda en modo solo lectura hasta que se renueve.

## Cómo empezar
- **Demo gratis**: app.ventra.store, sin registrarse ni tarjeta. Se elige qué plan probar y se usa con datos de ejemplo. La demo se reinicia sola cada pocas horas: no usarla para datos reales.
- **Suscribirse**: en la página del plan, tocar el botón del plan, entrar con una cuenta de Google y pagar con Mercado Pago. Se pide el correo de la cuenta de Mercado Pago (tiene que ser el de Mercado Pago, aunque sea distinto del de Google).
- **Agenda y Tienda** se usan desde el navegador (web.ventra.store), en la compu o el celular. No hay que instalar nada.
- **Caja / Full**: se puede usar desde el navegador (web.ventra.store) o instalar la app de Windows en la PC del local. La app se descarga desde "Mi cuenta" y la PC se vincula con un código de 8 caracteres. La versión instalada sigue vendiendo aunque se corte internet.
- **Ayuda para arrancar**: el equipo de Ventra ayuda a pasar los productos y precios (por ejemplo desde una planilla de Excel). Se pide por WhatsApp.

## Caja (sistema de ventas)
- Venta rápida: lector de código de barras, búsqueda instantánea, atajos de teclado; unidad, kilo o pack en la misma venta.
- Caja: apertura y cierre de turno, arqueo, cierre X y reporte Z con el detalle por medio de pago (efectivo, Mercado Pago, tarjetas/posnet). Tesorería y gastos.
- Stock: alertas de stock mínimo, compras a proveedores, auditoría de cada movimiento. Vencimientos por lote con avisos antes de que venzan.
- Promos: 2×1, combos a precio fijo y descuentos, con tope de stock o fecha.
- Cuentas corrientes (fiado) con límite de crédito e historial.
- Varias cajas y terminales al mismo tiempo, cada usuario con su rol y permisos, sin pagar por cada una.
- Impresora de tickets: cualquier impresora térmica de 80 mm instalada en la PC; también imprime etiquetas de código de barras. Lectores USB funcionan sin configurar nada.
- Requisitos de la app instalada: Windows 10 u 11 de 64 bits.
- Funciones por rubro (se activan según el rubro elegido):
  - Ferretería / corralón: presupuestos, acopio y remitos parciales, lista gremio, sustitutos, venta por metro/kilo/litro, fotos por medida.
  - Ropa / calzado: cada modelo con talles y colores, cada variante con su stock y código; cambio de talle en la caja.
  - Gastronomía (rotiserías, pizzerías, cafeterías): productos con tamaños, tipo de pedido (mesa, para llevar, delivery), aclaraciones por ítem, pizza mitad y mitad.
  - Kiosco / almacén y multirubro.
- Modo práctica: una caja simulada con productos del rubro para aprender sin tocar datos reales.

## Tienda online
- Link propio del tipo tienda.ventra.store/nombre-del-negocio, para la bio de Instagram, WhatsApp Business o Google Maps. Al compartirlo se ve con el nombre, el logo y la portada.
- Catálogo con fotos, categorías, buscador y promos; productos sin stock ocultos o marcados. Logo, portada y color propios.
- Carrito y pedido ordenado: el cliente elige, aclara y confirma; al comercio le llega con número de pedido, total, forma de entrega y forma de pago, por WhatsApp y con aviso al celular. Todos los pedidos quedan en un panel; si un pedido queda sin atender, se avisa.
- Entrega: retiro en el local y/o envío a domicilio, con costo de envío, envío gratis desde cierto monto, zona de entrega y pedido mínimo. También envíos con GoDelivery (servicio de envíos independiente que cobra su envío aparte).
- Pagos: el cliente elige cómo paga entre los medios que habilitó el comercio (efectivo, transferencia mostrando el alias, Mercado Pago, tarjeta). El cobro lo arregla el comercio con el cliente. La tienda todavía no cobra con tarjeta online dentro de la página.
- Cupones de descuento: porcentaje, monto fijo o envío gratis, con fecha y límite de usos.
- Horarios: la tienda muestra si está abierto o cerrado.
- Con Ventra Full, la caja del local y la tienda comparten stock y precios en vivo.

## Agenda de turnos
- Página de turnos propia (link tienda.ventra.store/nombre), abierta las 24 horas. Los clientes no descargan nada: reservan desde el navegador del celular eligiendo servicio, profesional y horario libre.
- Varios profesionales, cada uno con sus horarios y servicios. Vista del día y de la semana.
- Servicios típicos del rubro ya cargados con su duración (peluquería, barbería, uñas, estética, salud/consultorio, clases, profesionales, mascotas, taller, canchas y deportes); el comercio pone sus precios.
- Seña con Mercado Pago: porcentaje o monto fijo; el turno queda reservado cuando se paga, y la plata va directo a la cuenta de Mercado Pago del comercio (tiene que conectarla).
- El cliente recibe un link para ver o cancelar su turno; el horario cancelado vuelve a quedar libre.
- Ficha de cada cliente: cuántas veces vino, última visita, ausencias, cuánto gastó y notas del dueño.
- Cobros: se marca cada turno como cobrado y se ve cuánto entró por medio de pago y por profesional. Con Ventra Full, el turno se cobra en la caja junto con productos.
- Avisos al celular cuando entra una reserva, y cuando el cliente confirma, cancela o pide cambiar.
- Se maneja todo desde el celular (en el navegador) o desde la compu.

## Recordatorios de turnos
- **Por email (gratis, todos los planes con agenda)**: si el cliente dejó su email al reservar, le llega un recordatorio con el link para ver o cancelar el turno y el turno para agregar a su calendario.
- **Por WhatsApp con un toque (todos los planes con agenda)**: la app arma el mensaje de recordatorio de cada cliente y el dueño lo manda tocando un botón.
- **Por WhatsApp automático (Agenda Pro y Full)**: sale solo desde el número de Ventra, con el nombre del negocio, el servicio, el día y la hora, y dos botones: "Confirmo" y "Necesito cambiarlo". El dueño elige cuándo sale: el día anterior a las 18 o a las 20 hs, o 1, 2 o 3 horas antes del turno. No se manda de noche (entre las 22 y las 8). Si el cliente escribe, se le pasa el WhatsApp del comercio.
- Cupo: 200 recordatorios automáticos por mes en Agenda Pro y Full; se renuevan el 1° de cada mes y no se acumulan. Paquetes extra de 100 por $7.500, que se compran desde la app o Mi cuenta y se acreditan solos; los de paquete no vencen. Si se terminan, la agenda sigue funcionando y los recordatorios se mandan con un toque. Se avisa cuando quedan pocos.

## Lo que Ventra todavía NO hace (no prometerlo)
- Factura electrónica ante ARCA (AFIP): está en desarrollo, todavía no se puede facturar desde Ventra. Hoy registra cada venta con su ticket, separa los montos por medio de pago y arma el resumen del período para el contador.
- Cobro online con tarjeta dentro de la tienda.
- Pago anual de la suscripción.
- Comanda a cocina impresa aparte y mesas abiertas para restaurantes.
- App en Play Store y App Store (por ahora se usa desde el navegador del celular).
- Agrupar los talles de un mismo modelo en una sola ficha de la tienda online (hoy cada talle se publica como producto).

## Contacto y datos
- WhatsApp de Ventra (atención por personas del equipo): https://wa.me/5492212025603
- Mi cuenta (suscripción, cambio de plan, descarga de la app, vincular PC): https://ventra.store/cuenta.html
- Demo: https://app.ventra.store
- Páginas: inicio https://ventra.store/ · sistema de ventas https://ventra.store/sistema-de-ventas · tienda online https://ventra.store/tienda-online · agenda de turnos https://ventra.store/turnos · peluquerías https://ventra.store/peluquerias
- Privacidad: https://ventra.store/privacidad.html · Condiciones: https://ventra.store/terminos.html
- Funciona en cualquier ciudad de Argentina.

# Ventra por dentro: dónde está cada cosa

Guía para la ayuda adentro del sistema (kind "help" de ventraAi). Cada vez que se agrega o se mueve una pantalla, un menú o un botón, actualizar acá.

## El menú
Barra de la izquierda (en la PC). Arriba, el botón grande lleva a la pantalla principal: **Punto de Venta** (o **Venta de mostrador** en una distribuidora, **Mi agenda** en el plan Agenda, **Pacientes** en el consultorio de nutrición).
- **Hoy** (solo distribuidora): pedidos por zona, repartos y la plata del día.
- **Productos**: Inventario, Promociones y Combos, Compras, Control de Stock, Auditoría de Stock.
- **Caja & Tesorería**: Control de Caja, Cuentas Corrientes, Tesorería.
- **Clientes**, **Proveedores**, **Gastos**, **Historial de Ventas**.
- **Pedidos online** (si tiene tienda), **Agenda de turnos**, **Clientes de la agenda**, **Cobros de turnos**.
- **Reportes**, **Facturación** (todavía no disponible: "Próximamente").
- **Tienda Online**: Configuración y Métricas y Ventas.
- Según el rubro: **Presupuestos** (ferretería), **Encargos** (imprenta y trabajos por encargo), **Preventa**, **Reparto** e **Informes de reparto** (distribuidora).
- **Acceso Remoto**: usar el sistema desde el celular.
- Abajo: **Configuración**.
- Arriba hay un buscador de pantallas y acciones (**Ctrl + K**).
- Arriba a la derecha, el botón **Ayuda** (en la caja está abajo a la izquierda, o con Ctrl + K → Ayuda): esta ayuda para preguntar, los recorridos guiados de la pantalla en la que estás y los atajos de teclado.
- Al lado, **Preguntale a tu negocio** (dueño y encargados): preguntas sobre ventas, productos, stock, deudores, gastos y compras, respondidas con los números del sistema. También está en el inicio del celular y en Reportes.

## Vender (Punto de Venta)
- Primero se abre la caja: **F8** (o el botón de estado de caja arriba) → abrir caja con el efectivo inicial.
- Pasá el lector de código de barras o escribí el nombre y **Enter**. **Shift + Enter** elige la cantidad antes de agregar. **+ / −** cambian la cantidad del último producto.
- **F1**: venta rápida (un importe sin producto; también con el código 1).
- Cobrar: el botón de cobrar o **Enter** con el buscador vacío. En la ventana de cobro, el medio de pago con las teclas **1, 2, 3…**; en efectivo se carga con cuánto paga y calcula el vuelto; **mixto** reparte entre varios medios. **Enter** finaliza: descuenta el stock e imprime el ticket.
- **F2** pausa el ticket (ticket en espera); **Shift + F2** muestra los que están en espera. **Shift + Supr** vacía el ticket. **F3** calculadora. **F4** reimprime el último ticket.
- Otros atajos de la barra de arriba: **F5** cobro de cuenta corriente, **F6** historial de ventas, **F7** gastos, **F9** proveedores, **F10** mi usuario, **F11** pantalla completa, **F12** panel de administración.
- Devoluciones: botón de devoluciones en las herramientas del mostrador; el producto vuelve al stock.
- Anular una venta: **Historial de Ventas** (o F6) → la venta → anular.
- Cliente de la venta: elegirlo antes de cobrar (para cuenta corriente, lista de precios de gremio o la nota de venta de la distribuidora).
- Código que no está cargado: al pasarlo, Ventra trae solo el nombre y la foto (de supermercados por código exacto) y deja darlo de alta sin salir de la venta, poniendo el precio. Si encuentra varias fotos, se toca la correcta. Si lo carga un empleado, queda "para revisar" y al dueño le aparece el aviso en Productos.
- Cerrar la caja: **F8** → cerrar, contando el efectivo; el sistema calcula las diferencias. Cierre X (parcial) y reporte Z (del día) con el detalle por medio de pago.
- Celular: botón **Conectar celular** (código QR) para usar el sistema desde el teléfono sin instalar nada.

## Productos
- **Productos → Inventario**: la lista. **Nuevo Producto** para cargar uno (con el código de barras trae nombre y foto solo). Tocar un producto lo edita.
- Menú **Precios**: **Ajuste masivo por %** (por proveedor, rubro o marca), **Redondear precios**, y **Lista de precios del proveedor** (subir el PDF, Excel o fotos de la lista nueva: Ventra encuentra cada producto, muestra cuánto cambia el costo y deja aplicar manteniendo el margen). En la pestaña "Sin encontrar" se asocia cada renglón a tu producto (sugeridos o "Buscar el mío"); con el proveedor elegido arriba, Ventra lo recuerda para las próximas listas y boletas de ese proveedor.
- Menú **Etiquetas**: etiquetas con código de barras y etiquetas de gavetero.
- Menú **Fotos**: **Buscar y asignar fotos** (a los que no tienen) y **Volver a buscar para todos**.
- Menú **Datos**: **Importar productos** (planilla de Excel en formato Ventra, o base de otros sistemas), **Exportar productos**, exportar para GoDelivery.
- Promos (2×1, combos, descuentos por cantidad): **Productos → Promociones y Combos**.
- Stock bajo y reposición: **Productos → Control de Stock**. Contar el stock real: **Auditoría de Stock**.
- Vencimientos por lote: en el producto, activar **Controla vencimiento** y cargar los lotes; avisa antes de que venzan.
- Talles y colores, tamaños con distinto precio: al cargar el producto, la opción de variantes u opciones.

## Compras y proveedores
- **Productos → Compras**: cargar una compra a mano o subir la boleta del proveedor (PDF, Excel o CSV se leen sin IA; las fotos, con IA). En la PC se revisa en la misma pantalla: los productos encontrados vienen con el precio de venta sugerido (mantiene el margen) y los que no están se asocian a uno existente o se crean. Al confirmar suma el stock y actualiza costos y precios; Ventra aprende el código de cada proveedor para la próxima.
- Desde el celular: **Compras → Escanear boleta**. Si los renglones suman el total y no hay nada dudoso, la compra se carga sola (stock, costos, precios manteniendo el margen y productos nuevos, que quedan para revisar en Productos) y queda a cuenta del proveedor. Si algo no cierra, queda en **Compras → Por revisar** en la PC. La opción "Cargarla sola si está todo bien" está en esa misma pantalla del celular.
- **Proveedores**: datos, cuenta con cada proveedor y pagos. Pagarle con plata de la caja: **F9** en la caja.

## Clientes y cuentas corrientes
- **Clientes**: alta, datos, límite de crédito y saldo. Vender fiado: elegir el cliente en la venta y cobrar "a cuenta corriente".
- Cobrarle a un cliente que debe: **F5** en la caja (cobro de cuenta corriente) o desde su ficha.

## Plata
- **Gastos** (o **F7**): salidas de dinero de la caja; se descuentan del arqueo.
- **Caja & Tesorería → Control de Caja**: turnos, cierres y diferencias. **Tesorería**: movimientos de dinero fuera de la caja.
- **Reportes**: ventas por período, productos más vendidos, medios de pago, ganancias. Arriba, **Preguntale a tu negocio**: se escribe una pregunta ("¿cuánto vendí esta semana contra la pasada?", "¿quién me debe más?") y responde con los datos del sistema.
- **Historial de Ventas**: todos los tickets, ver detalle, reimprimir y anular.

## Configuración
Secciones: **General y POS** (rubro, datos del negocio y del ticket, comportamiento de la caja), **Métodos de pago** (posnets y medios de cobro), **Recargos** (por medio de pago o categoría), **Personal y cajeros** (usuarios, roles, contraseñas y qué hace cada uno: vendedor, chofer o mostrador), **Backup y seguridad** (copias automáticas y restaurar), **Suscripción y nube** (plan, vincular esta PC con el código de 8 caracteres, copia en la nube), **Integraciones** (Mercado Pago), **Mantenimiento**.
- Impresora de tickets: cualquier térmica de 80 mm instalada en Windows; se elige en General y POS.
- Cambiar el rubro: General y POS → Rubro / Tipo de Comercio.
- La clave del administrador se cambia en Personal y cajeros (o en Mi usuario, F10). Si se olvidó: en la pantalla de ingreso, "¿Olvidaste la contraseña del administrador?".

## Tienda online
- **Tienda Online → Configuración**: datos del negocio, dirección web, WhatsApp para los pedidos, colores, logo y portada, entregas y pagos, cupones. Elegir qué productos se ven en la tienda. **Mirala como tu cliente** para probarla y hacerla visible cuando esté lista; si cambiás algo después, aparece el aviso para publicar los cambios.
- Los pedidos llegan a **Pedidos online** y con un aviso en la caja.
- Distribuidoras: **Venta a comercios** dentro de Tienda online, con un link personal por cliente.

## Agenda de turnos
- **Agenda de turnos**: vista del día y de la semana; cargar, mover, bloquear horarios y avisar turnos. El botón de configurar la agenda: servicios, profesionales, horarios y reglas de reserva.
- **Clientes de la agenda**: historial de cada cliente. **Cobros de turnos**: lo cobrado.

## Distribuidora
- **Hoy**: botones para tomar un pedido, armar un reparto, vender en el mostrador o cargar una compra.
- **Preventa**: los pedidos (Pendientes y Vendidos) y "Nuevo pedido": primero el cliente, después los productos (por bulto o unidad); "Repetir" carga su último pedido. **Pedido de WhatsApp**: pegar el mensaje o subir la foto de la lista del cliente y la IA arma el pedido para revisar.
- **Reparto**: armar el reparto (día, chofer, pedidos por localidad), hojas de carga y de ruta, remitos, registrar entregas y rendir la plata cuando vuelve el camión.
- **Informes de reparto**: lo que entregó y cobró cada reparto.

## Encargos (imprenta y trabajos por encargo)
- **Encargos**: cargar el trabajo con seña, fecha de entrega y recordatorio; avisar al cliente por WhatsApp y dar el comprobante.

## Consultorio de nutrición
- **Pacientes**: ficha con datos, objetivo e historia clínica; cada consulta con mediciones (el IMC, el % de grasa y el metabolismo se calculan solos) y gráficos de evolución. Los turnos y cobros, en la Agenda.

## Problemas comunes
- No imprime el ticket: revisar en Configuración → General y POS qué impresora está elegida y que esté instalada y prendida en Windows.
- El lector de códigos no anda: los lectores USB funcionan sin configurar; probar en un bloc de notas que escriba el código y que el cursor esté en el buscador de la caja.
- "Equipo no vinculado" o funciones de la nube que no andan: Configuración → Suscripción y nube → vincular la PC con el código de 8 caracteres de "Mi cuenta" (ventra.store/cuenta.html).
- El sistema quedó en modo solo lectura: la suscripción venció (pasaron los 7 días de gracia); se renueva desde Mi cuenta.

// Guided tours. Targets are `data-tour="..."` attributes in the screens; a step
// whose target isn't on screen (e.g. the cart while the caja is closed) is
// skipped, and a step with no target renders centered.
// Wrap words in **double asterisks** to highlight them in the brand green.

export interface TourStep {
  target?: string;
  title: string;
  body: string;
  /** Click the target when the step opens (e.g. to switch to a settings tab). */
  click?: boolean;
}

export const TOURS = {
  // Tour inicial: lo mínimo para hacer la primera venta. Se abre solo la primera vez.
  pos: [
    { title: 'Punto de Venta', body: 'Este es tu **mostrador digital**. En menos de un minuto te mostramos cómo hacer tu primera venta.' },
    { target: 'pos-caja', title: 'Abrí la caja', body: 'Todo empieza acá: abrí la caja para empezar el turno. Al cerrarla contás el efectivo y el sistema calcula solo las diferencias.' },
    { target: 'pos-search', title: 'Escaneá o buscá', body: 'Pasá el **lector de código de barras** o escribí el nombre del producto y presioná **Enter**.' },
    { target: 'pos-rapida', title: 'Venta rápida', body: 'Para lo que no tiene código (caramelos, bolsas): tocá acá, presioná **F1** o escribí **1** y Enter. Solo cargás **precio y cantidad**.' },
    { target: 'pos-products', title: 'O tocá un producto', body: 'Cada producto que tocás se **suma al ticket**. Filtrá por categoría para encontrarlo más rápido.' },
    { target: 'pos-cart', title: 'Ticket en curso', body: 'Acá se arma la venta: cambiá **cantidades** o quitá ítems antes de cobrar.' },
    { target: 'pos-confirm', title: 'Confirmar venta', body: 'Cobrá con este botón o con **Enter** con el buscador vacío. Se abre la ventana de pago y el stock se descuenta **automáticamente**.' },
    { target: 'pos-admin', title: 'Panel de administración', body: 'Desde acá entrás al **panel principal**: productos, reportes y configuración.' },
    { title: '¡Listo para vender!', body: 'Eso es lo básico. Con el **botón de ayuda** (abajo a la izquierda) ves más recorridos y la lista de **atajos de teclado**.' },
  ],
  posCaja: [
    { title: 'Caja y dinero', body: 'Todo lo que tiene que ver con **la plata del turno**: cobros, pagos y control.' },
    { target: 'pos-caja', title: 'Estado de la caja', body: 'Con la caja abierta, acá ves el **resumen del turno** y hacés el **cierre** con el conteo de billetes.' },
    { target: 'pos-ctacte', title: 'Cobro de cuenta corriente', body: 'Registrá los **pagos de clientes que te deben** (fiados). El saldo de su cuenta se actualiza al instante.' },
    { target: 'pos-gastos', title: 'Gastos', body: 'Anotá las **salidas de dinero de la caja**: limpieza, delivery, compras chicas. Se descuentan del arqueo.' },
    { target: 'pos-proveedores', title: 'Pago a proveedores', body: 'Pagale a un proveedor **con plata de la caja** y dejá registrado a quién y por qué.' },
    { target: 'pos-historial', title: 'Historial de ventas', body: 'Consultá los tickets del turno: **ver el detalle, reimprimir y anular** ventas.' },
  ],
  posHerramientas: [
    { title: 'Herramientas del mostrador', body: 'Funciones que te ahorran tiempo **en el día a día**.' },
    { target: 'pos-espera', title: 'Tickets en espera', body: '¿El cliente se olvidó algo? **Pausá el ticket** y atendé al siguiente. Acá recuperás los que dejaste en espera.' },
    { target: 'pos-reimprimir', title: 'Reimprimir', body: 'Volvé a imprimir el **último ticket** vendido.' },
    { target: 'pos-devolucion', title: 'Devoluciones', body: 'Registrá un **producto que el cliente devuelve**. El stock vuelve al inventario.' },
    { target: 'pos-calculadora', title: 'Calculadora', body: 'Una **calculadora rápida** para vueltos o cuentas, sin salir del POS.' },
    { target: 'pos-vista', title: 'Vista del catálogo', body: 'Alterná entre **cuadrícula y lista**. La lista muestra más productos a la vez.' },
    { target: 'pos-celular', title: 'Conectar celular', body: 'Escaneá el **código QR** con la cámara del celular para usar el sistema desde el teléfono, sin instalar nada.' },
    { target: 'pos-fullscreen', title: 'Pantalla completa', body: 'Ocultá la barra del navegador para tener **más espacio** en el mostrador.' },
    { target: 'pos-usuario', title: 'Tu usuario', body: 'Muestra **quién está cobrando**. Desde acá cambiás tu contraseña.' },
    { target: 'pos-logout', title: 'Cerrar sesión', body: 'Salí al terminar tu turno para que **otro cajero** entre con su propio usuario.' },
  ],
  posFerreteria: [
    { title: 'Funciones de ferretería', body: 'Herramientas pensadas para **ventas a gremios y obras**.' },
    { target: 'pos-cliente', title: 'Cliente de la venta', body: 'Asigná un **cliente o gremio** para aplicar su lista de precios o descuento especial.' },
    { target: 'pos-presupuestos', title: 'Presupuestos', body: 'Armá **cotizaciones** sin descontar stock, compartilas por **WhatsApp** y cargalas al ticket cuando el cliente confirma.' },
    { target: 'pos-acopios', title: 'Acopios', body: 'Ventas que el cliente **paga ahora y retira después**. Llevá el control de lo entregado y lo pendiente.' },
  ],
  payment: [
    { title: 'Ventana de cobro', body: 'Acá terminás la venta. Te mostramos cómo cobrar **rápido y sin errores**.' },
    { target: 'pay-total', title: 'Total a cobrar', body: 'El **importe final** con descuentos y recargos ya aplicados. Si el medio de pago tiene recargo, se suma acá.' },
    { target: 'pay-metodos', title: 'Medio de pago', body: 'Elegí **efectivo, tarjeta, transferencia o mixto**. Cada uno tiene su tecla numérica (**1, 2, 3…**) para elegirlo sin mouse.' },
    { target: 'pay-acopio', title: 'Venta a acopio', body: 'Marcalo si el cliente **retira la mercadería más adelante**. Queda registrada como pendiente de entrega.' },
    { target: 'pay-detalle', title: 'Detalle del pago', body: 'En efectivo, cargá **con cuánto paga** y el sistema calcula el **vuelto**. En mixto, repartí el total entre varios medios.' },
    { target: 'pay-finalizar', title: 'Finalizar venta', body: 'Confirmá con este botón o con **Enter**. El stock se descuenta **automáticamente** y se imprime el ticket.' },
  ],
  settings: [
    { title: 'Centro de ajustes', body: 'Acá se adapta **Ventra** a tu negocio. Te mostramos qué se configura en cada sección.' },
    { target: 'settings-general', click: true, title: 'General y POS', body: 'Datos del **negocio**, del **ticket** y el comportamiento del punto de venta.' },
    { target: 'settings-posnets', click: true, title: 'Métodos de pago', body: 'Activá los **medios de cobro** que aceptás y configurá tus posnets.' },
    { target: 'settings-recargos', click: true, title: 'Recargos', body: 'Definí **recargos por medio de pago**, por ejemplo tarjeta de crédito en cuotas.' },
    { target: 'settings-personal', click: true, title: 'Personal y cajeros', body: 'Creá usuarios para tu equipo y decidí **qué puede hacer** cada uno.' },
    { target: 'settings-backups', click: true, title: 'Backup y seguridad', body: 'Guardá **copias de seguridad** de tus datos y restauralas cuando lo necesites.' },
    { target: 'settings-integraciones', click: true, title: 'Integraciones', body: 'Conectá servicios externos como **MercadoPago**.' },
    { title: 'Configuración lista', body: 'Ya conocés el centro de ajustes. Volvé cuando quieras **cambiar cómo funciona** tu negocio.' },
  ],
  onlineStore: [
    { title: 'Tu tienda online', body: 'Un **catálogo propio** con tu marca, donde los pedidos llegan directo a tu WhatsApp.' },
    { target: 'store-nav-negocio', click: true, title: 'Datos del negocio', body: 'El **nombre**, la **dirección web** y el **WhatsApp** donde te llega cada pedido.' },
    { target: 'store-nav-productos', click: true, title: 'Productos', body: 'Decidí **qué productos** se venden online. Los cambios de precio y stock también se marcan acá.' },
    { target: 'store-nav-apariencia', click: true, title: 'Apariencia', body: 'Elegí **colores, logo y portada** para que la tienda se vea como tu negocio.' },
    { target: 'store-nav-entregas', click: true, title: 'Entregas y pagos', body: 'Retiro, envío, costos y **medios de pago** que aceptás.' },
    { target: 'store-visible', title: 'Hacerla visible', body: 'Cuando esté lista, **hacé visible la tienda** y compartí el enlace. Si cambiás algo después, aparece un aviso abajo para **publicar los cambios**.' },
  ],
} satisfies Record<string, TourStep[]>;

export type TourId = keyof typeof TOURS;

export interface HelpEntry {
  tour: TourId;
  label: string;
  description: string;
}

/** Recorridos que ofrece el botón de ayuda en cada pantalla. */
export const ROUTE_HELP: Record<string, HelpEntry[]> = {
  '/pos': [
    { tour: 'pos', label: 'Primeros pasos', description: 'Cómo hacer tu primera venta' },
    { tour: 'posCaja', label: 'Caja y dinero', description: 'Cuentas corrientes, gastos, proveedores e historial' },
    { tour: 'posHerramientas', label: 'Herramientas del mostrador', description: 'Tickets en espera, devoluciones, celular y más' },
    { tour: 'posFerreteria', label: 'Ferretería', description: 'Clientes y gremios, presupuestos y acopios' },
  ],
  '/settings': [{ tour: 'settings', label: 'Centro de ajustes', description: 'Qué se configura en cada sección' }],
  '/online-store': [{ tour: 'onlineStore', label: 'Tienda online', description: 'Cómo dejar lista tu tienda' }],
};

/** Atajos de teclado que lista la ayuda en cada pantalla. */
export const ROUTE_SHORTCUTS: Record<string, { group: string; keys: [string, string][] }[]> = {
  '/pos': [
    {
      group: 'Barra superior',
      keys: [
        ['F8', 'Abrir caja / estado de caja'],
        ['F5', 'Cobro de cuenta corriente'],
        ['F6', 'Historial de ventas'],
        ['F7', 'Gastos'],
        ['F9', 'Proveedores'],
        ['F10', 'Mi usuario'],
        ['F11', 'Pantalla completa'],
        ['F12', 'Panel de administración'],
      ],
    },
    {
      group: 'Venta',
      keys: [
        ['F1', 'Venta rápida (también con el código 1)'],
        ['Enter', 'Agregar lo buscado · con el buscador vacío, cobrar'],
        ['Shift + Enter', 'Elegir la cantidad antes de agregar (también Shift + clic)'],
        ['+ / −', 'Cantidad del último producto'],
        ['F2', 'Pausar ticket'],
        ['Shift + F2', 'Ver ventas en espera (↑ ↓ y Enter para reanudar)'],
        ['Shift + Supr', 'Vaciar el ticket actual'],
        ['F3', 'Calculadora'],
        ['F4', 'Reimprimir último ticket'],
        ['Esc', 'Cerrar ventanas'],
      ],
    },
    {
      group: 'Ventana de cobro',
      keys: [
        ['1, 2, 3…', 'Elegir medio de pago'],
        ['Enter', 'Finalizar venta'],
      ],
    },
  ],
};

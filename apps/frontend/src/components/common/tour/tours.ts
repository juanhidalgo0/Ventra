// Guided tours. Targets are `data-tour="..."` attributes in the screens; a step
// whose target isn't on screen (e.g. the cart while the caja is closed) is
// skipped, and a step with no target renders centered.
// Wrap words in **double asterisks** to highlight them in the brand green.
// A tour can also be a function of the business (plan, rubro and tipo de
// servicio, see tourContext.ts): it returns its steps; `false` entries are left out.
import type { TourCtx } from './tourContext';

export interface TourStep {
  target?: string;
  title: string;
  body: string;
  /** Click the target when the step opens (e.g. to switch to a settings tab). */
  click?: boolean;
}

type Tour = TourStep[] | ((c: TourCtx) => (TourStep | false | null | undefined)[]);

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** Paso propio del rubro en el primer recorrido de la caja. */
const RUBRO_POS: Record<string, TourStep | null> = {
  KIOSKO: null,
  FERRETERIA: { title: 'Hecho para ferretería', body: 'Vendé **por metro, kilo o litro**, armá **presupuestos** y llevá **acopios**. En el botón de ayuda tenés el recorrido **Ferretería** con todo eso.' },
  INDUMENTARIA: { title: 'Talles y colores', body: 'Al tocar una prenda elegís **talle y color**. Si pasás el **código de la variante** con el lector, se suma directo la correcta y descuenta **su propio stock**.' },
  GASTRONOMIA: { title: 'Tamaños y promos', body: 'Los productos con **tamaños** (chica, grande, docena) te preguntan cuál al tocarlos, y las **promos por cantidad** se aplican solas en el ticket.' },
  MULTIRUBRO: { title: 'Todo en un mostrador', body: 'Las prendas te piden **talle y color**, lo que va por medida se vende **por metro o kilo** y el resto por unidad, **todo en el mismo ticket**.' },
};

const adminBody = (c: TourCtx) => {
  const parts = ['productos', 'reportes'];
  if (c.plan.tienda) parts.push('la **tienda online**');
  if (c.plan.agenda) parts.push('la **agenda de turnos**');
  return `Desde acá entrás al **panel principal**: ${parts.join(', ')} y la configuración.`;
};

export const TOURS = {
  // Tour inicial: lo mínimo para hacer la primera venta. Se abre solo la primera vez.
  pos: (c) => [
    { title: 'Punto de Venta', body: 'Este es tu **mostrador digital**. En menos de un minuto te mostramos cómo hacer tu primera venta.' },
    { target: 'pos-caja', title: 'Abrí la caja', body: 'Todo empieza acá: abrí la caja para empezar el turno. Al cerrarla contás el efectivo y el sistema calcula solo las diferencias.' },
    { target: 'pos-search', title: 'Escaneá o buscá', body: 'Pasá el **lector de código de barras** o escribí el nombre del producto y presioná **Enter**.' },
    { target: 'pos-rapida', title: 'Venta rápida', body: c.profile === 'GASTRONOMIA'
      ? 'Para algo que no está cargado (un agregado, un pedido especial): tocá acá, presioná **F1** o escribí **1** y Enter. Solo cargás **precio y cantidad**.'
      : 'Para lo que no tiene código (caramelos, bolsas): tocá acá, presioná **F1** o escribí **1** y Enter. Solo cargás **precio y cantidad**.' },
    { target: 'pos-products', title: 'O tocá un producto', body: 'Cada producto que tocás se **suma al ticket**. Filtrá por categoría para encontrarlo más rápido.' },
    RUBRO_POS[c.profile],
    c.biz.expiry && c.profile !== 'GASTRONOMIA' && { title: 'Vencimientos', body: 'Si cargás la **fecha de vencimiento** de cada lote, Ventra te avisa **antes de que se venza** para que lo vendas primero.' },
    { target: 'pos-cart', title: 'Ticket en curso', body: 'Acá se arma la venta: cambiá **cantidades** o quitá ítems antes de cobrar.' },
    { target: 'pos-confirm', title: 'Confirmar venta', body: 'Cobrá con este botón o con **Enter** con el buscador vacío. Se abre la ventana de pago y el stock se descuenta **automáticamente**.' },
    { target: 'pos-admin', title: 'Panel de administración', body: adminBody(c) },
    c.plan.tienda && { title: 'Pedidos de la tienda online', body: 'Los pedidos que entran por tu tienda te llegan con un **aviso en la caja**, para prepararlos y cobrarlos como una venta más.' },
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
  onlineStore: (c) => [
    { title: 'Tu tienda online', body: c.profile === 'GASTRONOMIA'
      ? 'Tu **carta online** con tu marca: los pedidos llegan directo a tu WhatsApp o a la app.'
      : 'Un **catálogo propio** con tu marca, donde los pedidos llegan directo a tu WhatsApp.' },
    { target: 'store-nav-negocio', click: true, title: 'Datos del negocio', body: 'El **nombre**, la **dirección web** y el **WhatsApp** donde te llega cada pedido.' },
    { target: 'store-nav-productos', click: true, title: 'Productos', body: c.profile === 'GASTRONOMIA'
      ? 'Decidí **qué platos** se ven online. Podés pausar lo que **hoy no hay** sin volver a publicar, y sumar **extras con precio** (borde relleno, agregados).'
      : c.biz.variants
        ? 'Decidí **qué productos** se venden online. Las prendas muestran sus **talles y colores** con el stock de cada uno.'
        : 'Decidí **qué productos** se venden online. Los cambios de precio y stock también se marcan acá.' },
    { target: 'store-nav-apariencia', click: true, title: 'Apariencia', body: 'Elegí **colores, logo y portada** para que la tienda se vea como tu negocio.' },
    { target: 'store-nav-entregas', click: true, title: 'Entregas y pagos', body: 'Retiro, envío, costos y **medios de pago** que aceptás.' },
    c.plan.agenda && { title: 'Turnos desde la tienda', body: 'Tu plan incluye la **agenda**: si das turnos, configuralos en **Agenda** y tus clientes reservan desde **esta misma tienda**.' },
    { target: 'store-visible', title: 'Hacerla visible', body: 'Cuando esté lista, **hacé visible la tienda** y compartí el enlace. Si cambiás algo después, aparece un aviso abajo para **publicar los cambios**.' },
  ],
  // Agenda de turnos: textos según el tipo de servicio (peluquería, salud, clases...) y el plan.
  agenda: (c) => [
    { title: `La agenda de ${c.w.title}`, body: `Acá ves los ${c.w.turnos} de cada día: los que reservan tus **${c.w.clientes}** solos desde tu link y los que cargás vos.` },
    { target: 'agenda-days', title: 'Elegí el día', body: `Tocá un día para ver sus ${c.w.turnos}. Debajo de cada fecha ves **cuántos ${c.w.turnos} tiene**, así encontrás rápido los días libres.` },
    { target: 'agenda-new', title: `${cap(c.w.turno)} a mano`, body: `Para el ${c.w.cliente} que **te llama o te escribe**: elegís ${c.w.ejemplo}, el día y uno de los **horarios libres**, que ya respetan la duración.` },
    { target: 'agenda-block', title: 'Bloquear horarios', body: `¿No atendés en algún momento? Bloqueá ${c.w.bloqueo} y **nadie puede reservar** en ese horario.` },
    { target: 'agenda-staff', title: 'Cada uno con su agenda', body: `Filtrá por ${c.w.staff}: cada uno tiene **su color, sus horarios y sus servicios**.` },
    { target: 'agenda-list', title: `Tus ${c.w.turnos}`, body: `Tocá uno para **confirmarlo**, avisarle por **WhatsApp**${c.plan.caja ? '' : ', **cobrarlo**'} o marcar si **no vino**. El que está en curso se marca en vivo.` },
    { target: 'agenda-share', title: 'Compartí tu link', body: `Pegalo en tu **Instagram y tu WhatsApp**: tus ${c.w.clientes} reservan solos, a cualquier hora, y el ${c.w.turno} aparece acá al instante.` },
    c.w.consejo,
    c.agendaOnly && { title: `${cap(c.w.clientes)} y cobros`, body: `En **Clientes** ves a quién atendiste y cuántas veces vino, y en **Cobros** cuánto entró cada día y con qué medio.` },
    { target: 'agenda-tab-config', title: 'Configurar', body: `Servicios, ${c.w.staff}, horarios y **reglas de reserva** se cambian desde acá cuando quieras.` },
  ],
  agendaConfig: (c) => [
    { title: `Armemos la agenda de ${c.w.title}`, body: `Con tres cosas tus ${c.w.clientes} ya pueden reservar solos: **servicios**, **quién atiende** y **cuándo**.` },
    { target: 'agenda-cfg-page', title: 'Tu página de turnos', body: `El **nombre**, la **dirección** que les pasás a tus ${c.w.clientes} y tu **WhatsApp**.` },
    { target: 'agenda-cfg-services', title: 'Servicios', body: `${c.w.servicios} Si arrancás de cero, tocá tu rubro y te cargamos los **servicios típicos**.` },
    { target: 'agenda-cfg-staff', title: cap(c.w.staff), body: 'Quiénes atienden y **en qué horarios**. Si trabajás solo o sola, agregate a vos. Se puede usar **horario cortado** (9 a 13 y 17 a 21).' },
    { target: 'agenda-cfg-rules', title: 'Reglas de reserva', body: `Cada cuánto se ofrecen horarios, **cuánta anticipación** pedís y si los ${c.w.turnos} online se **confirman solos**.` },
    { target: 'agenda-cfg-online', title: 'Tomar turnos online', body: `Cuando esté todo, **prendé esto y guardá**: tu página empieza a recibir ${c.w.turnos}.` },
  ],
} satisfies Record<string, Tour>;

export type TourId = keyof typeof TOURS;

export interface HelpEntry {
  tour: TourId;
  label: string;
  description: string;
  /** Solo se ofrece si aplica a este comercio */
  when?: (c: TourCtx) => boolean;
}

/** Pasos del recorrido para este comercio. */
export function tourSteps(id: TourId, c: TourCtx): TourStep[] {
  const t = TOURS[id] as Tour;
  return (typeof t === 'function' ? t(c) : t).filter(Boolean) as TourStep[];
}

/** Recorridos que ofrece el botón de ayuda en cada pantalla. */
export const ROUTE_HELP: Record<string, HelpEntry[]> = {
  '/pos': [
    { tour: 'pos', label: 'Primeros pasos', description: 'Cómo hacer tu primera venta' },
    { tour: 'posCaja', label: 'Caja y dinero', description: 'Cuentas corrientes, gastos, proveedores e historial' },
    { tour: 'posHerramientas', label: 'Herramientas del mostrador', description: 'Tickets en espera, devoluciones, celular y más' },
    { tour: 'posFerreteria', label: 'Ferretería', description: 'Clientes y gremios, presupuestos y acopios', when: (c) => !!(c.biz.quotes || c.biz.acopio || c.biz.tradePricing) },
  ],
  '/settings': [{ tour: 'settings', label: 'Centro de ajustes', description: 'Qué se configura en cada sección' }],
  '/online-store': [{ tour: 'onlineStore', label: 'Tienda online', description: 'Cómo dejar lista tu tienda' }],
  '/agenda': [
    { tour: 'agenda', label: 'Tu agenda', description: 'Ver, cargar, bloquear y avisar turnos' },
    { tour: 'agendaConfig', label: 'Configurar la agenda', description: 'Servicios, horarios y reglas de reserva' },
  ],
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

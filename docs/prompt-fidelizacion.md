# Super prompt: Club de clientes (puntos, sellos y premios) para Ventra

> Copiá desde "INICIO DEL PROMPT" hasta el final y pegalo en una sesión nueva de Claude Code abierta en `C:\Users\PC\Desktop\Kiosco`.

---

## INICIO DEL PROMPT

Sos el desarrollador principal de **Ventra**, el sistema de ventas que está en este repositorio. Vas a diseñar y programar el **Club de clientes**: un programa de fidelización para que cada comercio que usa Ventra haga que sus clientes ganen puntos o sellos y los cambien por premios. Lo hacemos en **tres etapas**, una por vez, y cada etapa termina andando, probada y commiteada.

Hablame en castellano simple, sin tecnicismos. Yo soy el dueño de Ventra, no el comercio.

### 1. Qué tiene que lograr

Para el **comercio**: que el cliente vuelva más seguido y gaste más, sin frenar la fila en la caja y sin que el programa le coma el margen.
Para el **cliente del comercio**: sumar sin bajar ninguna app, ver cuánto tiene y cuánto le falta para un premio, y que canjear sea fácil.
Para **Ventra**: un argumento fuerte para vender el plan Full, y que cada comercio que lo use nos haga publicidad sola.

Nombre en los menús: **"Club de clientes"**. El cliente final ve **"Club {nombre del comercio}"**.

### 2. Cómo está armado Ventra hoy (verificalo en el código antes de diseñar)

- **Caja en cada PC, sin internet**: backend NestJS + Prisma con SQLite propio (`apps/backend`), frontend React (`apps/frontend`), app de escritorio en `apps/desktop`.
- **Sincronización**: todas las cajas (PCs y la caja en la nube) se sincronizan en los dos sentidos a través de Neon (`apps/backend/src/modules/sync/sync.service.ts`, `firebase/functions/sync.js`). Gana el último cambio por fila. Los contadores (`products.stock`, `clients.balance`, `promotions.sold_stock`) viajan como **diferencias** (deltas), no como valor final. Toda tabla con id se sincroniza sola. La caja en la nube es el mismo backend corriendo en fly.io (`apps/cloud-host`).
- **Clientes**: modelo `Client` en `apps/backend/prisma/schema.prisma` (DNI único, teléfono, email, saldo de cuenta corriente). `Sale.clientId` ya existe. `AccountMovement` es un libro de movimientos con saldo antes y después: es el modelo a imitar.
- **Caja**: `apps/frontend/src/components/pos/POSScreen.tsx` y `PaymentModal.tsx`. El cliente elegido en la caja vive en `posStore.selectedClient`. Ojo: `PaymentModal` hoy baja **todos** los clientes con `GET /clients` y filtra en el navegador; con miles de socios eso no aguanta.
- **Celular**: `components/mobile/MobileSellScreen.tsx` (vender), app del dueño en `components/mobile`.
- **Ticket**: `pos/TicketReceipt.tsx`, `utils/ticketLook.ts`, `settings/TicketLookCard.tsx` (ya imprime un QR al pie que lleva a la tienda o al WhatsApp).
- **Anular venta**: `sales.service.ts` → `cancel()`.
- **Funciones activables por rubro**: `stores/businessStore.ts` (`BusinessFeature`, `PROFILE_FEATURES`, `hasFeature`).
- **Permisos**: para lo que es solo del dueño o del encargado, usar siempre `useOwnerAccess()` / `useManagerAccess()` de `utils/managerAccess.ts`, nunca solo `user.role` (el dueño entra con el candado sobre la sesión del cajero).
- **Nube (Firebase Functions, `firebase/functions`)**: `coupons.js` (validación pública con tope de intentos por IP, el patrón a copiar), `whatsapp.js` + `reminder-quota.js` (WhatsApp Cloud API con cupo mensual por comercio), `email-reminders.js` (mails gratis con Resend), `notify.js` (avisos al dueño), `insights-cloud.js` + `ai-agent.js` (la IA lee Neon con herramientas de solo lectura), `usage.js` (contadores por comercio).
- **Tienda online**: `firebase/tienda/index.html` en `tienda.ventra.store/<slug>`. Los pedidos llegan a Firestore y las cajas los toman con `services/onlineStoreOrders.ts` (`claimOrder`, una transacción para que no se dupliquen).
- **Control de anulaciones**: `apps/backend/src/modules/pos-trail` (`void-score.ts` es una función pura de puntaje y los avisos van solo al dueño). Es el modelo para el antifraude.
- **Otros lugares donde se cobra**: modo gastronomía (`pos/gastro.tsx`), cobro de turnos (`pos/turnoCobro.ts`), modo práctica (`pos/posPractice.ts`, **nunca** suma puntos), cierres X/Z (`CierreCajaModal.tsx`).
- **Ayuda e IA**: `firebase/functions/chat/ventra-kb.md` y `chat/ventra-ayuda.md` se actualizan con cada función nueva.

Si algo de esto no coincide con lo que encontrás, decímelo antes de seguir.

### 3. Reglas que no se negocian

1. **No cambiar el estilo de la caja.** Los cajeros ya la conocen. Lo nuevo entra como un agregado chico, con el mismo estilo que lo que ya existe: un campo, un atajo de teclado, una línea en el ticket. Nada de rediseñar el cobro.
2. **Sumar puntos no puede agregar más de 2 o 3 segundos a una venta.** Si el cajero no identifica al cliente, la venta sale igual que hoy.
3. **Tiene que andar sin internet.** La PC suma y canjea sin conexión, y después todo se sincroniza sin perder ni duplicar movimientos.
4. **Los puntos son un libro de movimientos, no un número que se pisa.** El saldo es la suma de los movimientos. Si guardás un saldo calculado para que sea rápido, tiene que viajar como delta, igual que `clients.balance`.
5. **El antifraude es secreto para los cajeros**, igual que el control de anulaciones.
6. **Nada se publica sin mi OK**: ni funciones, ni reglas, ni hosting, ni la caja en la nube, ni una versión de PC. Cuando te lo pida, el orden es: funciones → reglas y hosting → caja en la nube con `npm run deploy:cloud` (corre `test:http`) → versión de PC. Si el árbol tiene trabajo a medias de otra sesión, se publica desde un worktree limpio.
7. **Commits por etapa**, con mensajes claros en castellano, solo con tus archivos.
8. Al terminar cada etapa: actualizá `ventra-kb.md` y `ventra-ayuda.md`, dejá un traspaso en `docs/traspaso-club-clientes.md` (qué se hizo, qué falta, cómo se prueba) y guardá o actualizá la memoria del proyecto.

### 4. Decisiones de diseño (ya tomadas; si ves un problema real, avisame)

**4.1 La inflación.** En Argentina, "cada $1.000 = 1 punto" queda viejo en meses, y los premios fijos en pesos se desvalorizan.
- Se gana un **porcentaje de lo que se paga** (por ejemplo 3%), configurable en general y por categoría o producto.
- Los **premios son productos del inventario** (o un descuento). Cada premio tiene un costo en puntos, que puede ser **automático** (sale del precio actual del producto y del porcentaje, así el costo real del programa queda siempre en el % elegido) o **fijo** (lo pone el dueño a mano y el sistema le avisa cuando quedó barato frente al precio actual). El automático va por defecto.
- Los puntos **vencen por inactividad**: si el cliente no compra en N meses (6 por defecto), se avisa antes y se vencen. Es más justo que un vencimiento por fecha y limita la pérdida de valor.
- Los **sellos** ("8 cafés = 1 gratis") se cuentan por unidad o por visita, así que no les afecta la inflación.

**4.2 Qué suma y qué no.**
- No suman: recargas virtuales (`VIRTUAL_LOAD_*`), consumo de empleados (`INTERNAL`), pagos de cuenta corriente como producto (`PAGO_CTA_CTE`), modo práctica, ni la parte pagada con puntos.
- **Cigarrillos y tabaco excluidos por defecto** (margen muy bajo y la ley de control de tabaco restringe las promociones). El dueño puede excluir más categorías o productos.
- **Fiado**: la venta a cuenta corriente no suma al momento. Suma cuando el cliente paga, sobre lo que paga.
- Se redondea siempre hacia abajo, a puntos enteros.

**4.3 Canjear.**
- **Premio-producto**: entra al ticket a $0 como bonificación del 100% marcada como canje, descuenta stock y deja ver el costo del premio en los reportes.
- **Puntos como descuento**: el cliente usa puntos para bajar el total. Para ARCA y para el arqueo es una **bonificación**, no un medio de pago: la factura sale por el total ya bonificado y la caja no espera esa plata. En el cierre X/Z aparece la línea "Descuentos por puntos".
- **Verificación al canjear**, configurable: nada, últimos 3 números del DNI, o el código de la tarjeta digital. Que nadie canjee los puntos de otro con solo decir un teléfono.

**4.4 Identificar al cliente (lo más importante).**
- **Teléfono normalizado** (formato argentino, siempre igual guardado) como identificador principal; DNI como alternativa; y un **código de socio** corto (6 dígitos) con código de barras Code128 con un prefijo propio, para que el lector lo escanee desde el celular o desde una tarjeta impresa. El escaneo entra por el mismo campo de productos: si el código tiene el prefijo del club, se adjunta el cliente en vez de buscar un producto (no puede chocar con códigos de balanza ni internos: revisalo).
- **Alta en la caja en 5 segundos**: teléfono + nombre + tilde "el cliente aceptó" (consentimiento). El resto lo completa el cliente desde su celular.
- **QR en el ticket para sumar después**: si la venta salió sin socio, el ticket trae un QR "Escaneá y sumá X puntos". Es un código de un solo uso, vence a los 7 días, y el cliente lo reclama desde el celular poniendo su teléfono. El cajero no hace nada.
- **Socio = `Client`**. Una persona es un solo registro para el fiado, la factura, los encargos y el club. Campos nuevos sugeridos: `phoneKey` (normalizado), `birthday`, `clubOptIn` + fecha + canal, `clubCode`, `tier`, `pointsBalance` (delta), `lastVisitAt`, `referredById`, `messagesOptOut`. Cuidados:
  - La pantalla de cuentas corrientes no se puede llenar de socios del club: filtrá a los que tienen movimientos de cuenta.
  - Hace falta una **búsqueda de clientes del lado del servidor** para la caja, en vez de bajar todos.
  - Si ya hay teléfonos repetidos, la migración no puede fallar, y hace falta una forma de unir clientes duplicados.

**4.5 Dónde viven los datos.**
- El libro de puntos y los socios viven en la base de la caja (Prisma) y se sincronizan como todo lo demás, porque la caja suma sin internet.
- Lo que llega desde la web (altas, reclamos de ticket, referidos, canjes en la tienda) entra por la nube de forma **idempotente** (el mismo pedido aplicado dos veces suma una sola vez). Evaluá dos caminos y elegí el más robusto, explicándome por qué: (a) una cola en Firestore que toma cualquier caja, como los pedidos de la tienda con `claimOrder`; (b) que la función escriba directo como un nodo más de la sincronización en `sync.js`. Tené en cuenta que la caja en la nube se apaga sola a los 15 minutos sin uso.
- La página del cliente lee el saldo desde Neon con una función, igual que `insights-cloud.js`, y nunca expone datos de otros clientes.

**4.6 Privacidad y ley** (verificá y mostrame lo que encuentres; no soy abogado y vos tampoco):
- Consentimiento explícito para guardar el teléfono y mandar mensajes, para qué se usan, y baja fácil ("BAJA" por WhatsApp o un botón en la tarjeta) (Ley 25.326).
- Bases y condiciones del programa visibles en la página del club: cómo se gana, vencimiento, y que cambios se avisan con anticipación. El sistema genera un texto base que el dueño puede editar.
- **Sin sorteos, ruletas ni raspaditas atados a una compra** (Lealtad Comercial).
- **No dar puntos por reseñas de Google** (las reseñas pagadas van contra las reglas de Google).

**4.7 Costos de WhatsApp.** Cada mensaje cuesta: utilidad unos USD 0,026, marketing unos USD 0,062 en Argentina. Avisos como "sumaste puntos" pueden ser de utilidad; "volvé, tenés puntos dobles" es marketing. Hace falta:
- Un **cupo** por comercio: revisá `reminder-quota.js` y proponeme si se comparte con los recordatorios de turnos o va aparte.
- Un **tope por cliente** (como mucho 1 mensaje de marketing por semana).
- Que el dueño elija qué avisos se mandan.
- **Mail gratis** como alternativa cuando el cliente dejó su correo, y la **tarjeta web** que siempre muestra el saldo sin costo.

**4.8 Planes.** Incluido en **Full**. En los planes Agenda y Agenda Pro, sellos y puntos por servicios (etapa 2). En la distribuidora, apagado por defecto. Va como nueva `BusinessFeature` `'club'`, **apagada por defecto**. Se activa con un asistente que trae **plantillas por rubro**:
- **Kiosco**: 2% y premios típicos.
- **Cafetería y gastronomía**: sellos 8+1.
- **Peluquería**: sellos 5+1 corte.
- **Ropa**: 5% y niveles.
- **Ferretería**: 2%.

### 5. Etapas

#### Etapa 1: Base (puntos, premios, caja, ticket y tarjeta web)

1. **Datos**: modelos Prisma (socios en `Client`, `ClubMovement` como libro con tipos `EARN | REDEEM | REVERSE | EXPIRE | ADJUST | BONUS`, `ClubReward` como catálogo de premios, y la configuración del club), migración segura, y entrada en la sincronización con el saldo como delta.
2. **Cálculo** como funciones puras y probadas: cuánto suma una venta (exclusiones, porcentaje por categoría, fiado), cuánto cuesta un premio (automático o fijo), reversa total y parcial en devoluciones.
3. **Configuración** (solo el dueño): activar, nombre del club, porcentaje, exclusiones, catálogo de premios, verificación para canjear, vencimiento y bases y condiciones.
4. **Caja PC**:
   - Identificar al cliente por teléfono, DNI o escaneo, con un atajo de teclado.
   - Alta rápida.
   - Ver saldo y premios alcanzables.
   - Canjear un premio o puntos como descuento.
   - Acreditar al cobrar, dentro de la misma transacción que la venta.
   - Todo sin cambiar el estilo.
   - También en modo gastronomía y en el cobro de turnos.
5. **Celular**: lo mismo en `MobileSellScreen`.
6. **Ticket**: si hay socio, "Sumaste 45 puntos · Tenés 320 · Te faltan 80 para {premio}". Si no hay, el QR para sumar después. Decidí con criterio cómo convive con el QR que ya existe en 58 mm y 80 mm, y mostrame una prueba.
7. **Anulaciones y devoluciones**: restan los puntos. Si el saldo queda negativo, se permite, y bloquea canjes hasta volver a positivo.
8. **Página del cliente** (`tienda.ventra.store/<slug>/club`, ultra liviana, sin app):
   - Alta del socio.
   - Reclamo del ticket.
   - Tarjeta con código de barras y QR.
   - Saldo, premios con barra de progreso, historial y bases.
   - Botón "Agregar a inicio".
   - Acceso por un link secreto que se le da al cliente (en el ticket o por WhatsApp), con recuperación por código al WhatsApp o al mail.
   - Tope de intentos por IP, como en `coupons.js`.
   - Pie "Creado con Ventra" con link: así nos conocen otros comercios.
9. **Panel mínimo del dueño**: lista de socios con búsqueda, ficha con movimientos, y ajuste manual solo para el dueño, con motivo obligatorio y registro en auditoría.
10. **Pruebas**:
    - `npm run test:club` en el backend, con las funciones puras.
    - Las rutas nuevas en `test:http`.
    - Pruebas de las funciones en `firebase/test/*.test.cjs`.
    - Un escenario en `tools/sync-sim`: dos PCs sin internet que suman y canjean al mismo socio a la vez y después sincronizan. No se pierde ni se duplica ningún movimiento y el saldo cierra.

#### Etapa 2: Que vuelvan (retención)

1. **Sellos**: tarjetas por producto, categoría o servicio ("8 cafés = 1 gratis", "5 cortes = el 6º gratis"), con el sello impreso en el ticket y visible en la tarjeta web.
2. **Niveles** (Bronce, Plata, Oro) por **cantidad de visitas en los últimos 90 días**, que no depende de la inflación. Beneficios configurables: más puntos por compra, regalo de cumpleaños, envío gratis en la tienda.
3. **Campañas y multiplicadores**: x2 en días u horarios flojos, por categoría o producto, y x3 en lo que vence pronto (conectado a los vencimientos por lote, feature `expiry`). Se aplica **el mejor** multiplicador, no se suman, para controlar el costo.
4. **Bonus**:
   - **Bienvenida**: al hacerse socio.
   - **Cumpleaños**: una vez por año, solo si el socio se dio de alta 30 días antes o más.
   - **Primera compra.**
5. **Vencimiento por inactividad** con aviso 7 días antes.
6. **Mensajes automáticos** (WhatsApp con plantillas, cupo, tope por cliente y BAJA; y mail gratis):
   - Sumaste puntos y te faltan X para el premio.
   - Se te vencen los puntos.
   - Feliz cumpleaños.
   - **Clientes dormidos**: no volvió en N días, puntos dobles esta semana.

   Pasame el texto de cada plantilla para aprobarlas en Meta antes de programar el envío.
7. **Panel completo** (computadora y app del dueño):
   - Socios nuevos.
   - Qué porcentaje de las ventas se hace con socio identificado.
   - Cuántos vuelven y cada cuánto.
   - Ticket promedio de socios frente a no socios.
   - Puntos emitidos, canjeados y vencidos.
   - **Lo que el comercio debe en puntos**, en pesos a precio actual de los premios.
   - Costo real del programa como % de las ventas.
   - Mejores clientes.
   - Lista de dormidos con botón para mandarles un WhatsApp gratis desde el celular del dueño (wa.me, como el envío manual de la agenda).
8. **IA**: herramientas de solo lectura en `insights-cloud.js` para que el dueño pregunte "¿quiénes son mis mejores clientes?" o "¿cuántos socios dejaron de venir?", desde la app y desde su WhatsApp.
9. **Antifraude** (secreto para cajeros): puntaje como `void-score.ts` para casos como muchas ventas del mismo cajero al mismo socio en poco tiempo, el teléfono de un empleado usado como socio, canjes seguidos, o ajustes manuales. Aviso al dueño con `notify` y tope de puntos por día por socio.
10. **Agenda**: sellos y puntos por servicio en los turnos cobrados. Antes, investigá dónde quedan registrados los cobros del plan Agenda (Firestore o Neon) y proponé cómo sumar sin duplicar.

#### Etapa 3: Crecer

1. **Referidos**: link personal en la tarjeta. Ganan los dos cuando el amigo hace su primera compra (con monto mínimo), con un tope de referidos por mes.
2. **Google Wallet y Apple Wallet**: pase de socio con saldo que se actualiza solo. Explicame qué cuentas hacen falta (la consola de emisor de Google y el Pass Type ID de Apple Developer) antes de programar.
3. **Todos los canales con los mismos puntos**:
   - **Tienda online**: en el checkout, el cliente pone su teléfono, ve cuántos puntos gana y puede canjear. Los puntos se acreditan cuando el pedido se convierte en venta.
   - **GO**: revisá cómo entran a Ventra sus pedidos y hacé lo mismo.
4. **Marketing**:
   - Landing pública con SEO impecable (por ejemplo `/programa-de-puntos`), al estilo de las demás páginas de `firebase/web`.
   - **Cartel imprimible para el mostrador**, "Sumate al Club {comercio}" con QR de alta. Reusá `socialImage.ts` y `shelfLabels.ts`.
   - Ejemplos de socios y movimientos en la demo por visitante, para cada rubro.
   - Una guía de venta del club para el bot de Instagram.
5. **Red de comercios del barrio** (puntos compartidos entre comercios Ventra): **solo una propuesta escrita**, sin programar. Tiene que explicar quién paga el premio cuando se gana en un comercio y se canjea en otro, cómo se liquida entre ellos, riesgos legales y costo.

### 6. Cómo trabajamos

1. **Antes de escribir código**: leé lo que nombré en la sección 2, después escribime **una página** con el diseño final de la etapa 1 (modelos, pantallas y flujo en la caja) y una lista corta de las decisiones que necesitás que yo tome (con tu recomendación en cada una). Esperá mi OK.
2. Programá la etapa completa, con pruebas.
3. Probala vos en la vista previa (caja PC, celular, ticket y página del cliente) y mandame capturas. **Nunca** pruebes contra la nube real: esta PC tiene credenciales de producción y ya pasó que una prueba escribió en prod.
4. Commit, traspaso, memoria, y frená. Yo lo pruebo y te digo si seguimos con la siguiente etapa.

Decisiones que quiero que me confirmes al principio, con tu recomendación:
- Porcentaje por defecto por rubro.
- Meses de inactividad para el vencimiento.
- Verificación por defecto para canjear.
- Si el cupo de WhatsApp se comparte con los turnos.
- Cómo convive el QR del club con el QR actual del ticket.
- Si el alta desde la web pide código por WhatsApp (cuesta) o alcanza con el link secreto.

## FIN DEL PROMPT

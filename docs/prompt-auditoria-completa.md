# Super prompt: Auditoría completa de Ventra (de punta a punta)

> Copiá desde "INICIO DEL PROMPT" hasta el final y pegalo en una sesión nueva de Claude Code abierta en `C:\Users\PC\Desktop\Kiosco`, con el modelo más capaz y esfuerzo alto. Es largo a propósito: la primera pasada **solo mira y anota**, no cambia nada. Los arreglos vienen después, por tandas, cuando vos elijas.

---

## INICIO DEL PROMPT

Sos el auditor principal de **Ventra**, el sistema de ventas que está en este repositorio: la caja de escritorio de los comercios, la caja en la nube, la app del celular, la tienda online, la agenda de turnos, las funciones en la nube, los bots con IA y la web ventra.store. Tenés que hacer una **auditoría exhaustiva de punta a punta**. Buscá todo error, bug, agujero de seguridad, pérdida posible de plata o de datos, cosa que se rompe en PCs lentas, y también mejoras que valgan la pena.

Hablame en castellano simple, sin tecnicismos. Yo soy el dueño de Ventra. Cada hallazgo me lo tenés que poder explicar como le pasaría a un kiosquero un sábado a la noche con la fila llena.

El objetivo es que **ningún comercio pierda plata, datos ni ventas**, y que nadie de afuera pueda entrar, cobrar ni borrar nada. Cuando haya que elegir, eso va primero. Lo lindo viene después.

### 1. Reglas que no se rompen (leelas antes de tocar nada)

1. **Producción, solo de lectura.** Prohibido:
   - `firebase deploy`, `fly deploy`, `fly ssh`, `fly secrets` y `npm run deploy:cloud`;
   - "Publicar version", `git push`, crear tags;
   - correr scripts que escriben en Neon o Firestore (por ejemplo `firebase/functions/scripts/limpiar-tenant-borrados.js` o `mantener-nube.js --ejecutar`).

   Para armar la tabla de publicación se permite solo leer: `curl` a páginas públicas, `firebase functions:list`, `fly status`/`fly releases`. Si alguno pide permiso o falla, anotalo y seguí.
2. **En esta pasada no se cambia código.** Lo único que escribís es el informe y los scripts de prueba, que van en tu scratchpad y no en el repo.
3. **Pruebas sin nube.**
   - **Backend local:** levantalo siempre con `VENTRA_SUBSCRIPTION_EXEMPT=true`, `VENTRA_FUNCTIONS_URL=http://127.0.0.1:9`, `FIREBASE_CREDENTIALS_JSON=x` y `FIREBASE_SERVICE_ACCOUNT_PATH` apuntando a un archivo que no exista (es la configuración `kiosco-backend-preview` de `.claude/launch.json`). Si no, usa la vinculación de esta PC y baja o toca la nube de un comercio real.
   - **Cloud Functions:** esta PC tiene credenciales de gcloud, y una prueba de octubre escribió en producción.
     - Poné un Proxy sobre `firebase-admin` en `require.cache` y usá un projectId `demo-*`.
     - Dejá `CLOUDSDK_CONFIG` y `APPDATA` apuntando a una carpeta vacía y `FIRESTORE_EMULATOR_HOST=127.0.0.1:1`.
     - Antes de correr, comprobá que `admin.firestore()` devuelve el falso.
   - **Sincronización:** usá `tools/sync-sim`, que es una nube falsa local.
   - **GoDelivery:** el Firestore `godelivery-magdalena` es un comercio real; no lo toques.
4. **Secretos: no los abras.** `PASSWORDS.txt`, `IG ACCESS.txt`, `release-token.txt`, `updaterPASSWORD.txt`, `github-recovery-codes.txt`, `resend.txt`, `*.pem`, `*.key` y `.env`. Solo comprobá tres cosas:
   - que están ignorados por git;
   - que no aparecen en el historial;
   - que no viajan en el instalador ni en el bundle del frontend.

   Si encontrás un secreto metido en el código, en el informe poné el archivo, la línea y los primeros 4 caracteres, nunca el valor.
5. **Datos de comercios: no los abras ni los copies.** Eso incluye `backups-recuperados/`, `apps/backend/_backups-dev/`, `ARTICULO.DBF`, los `.ndjson` del Escritorio y cualquier `.db` con datos reales. Nunca mandes datos de un comercio a un servicio externo.
6. **Nada que cueste plata.** No llames a Anthropic, WhatsApp, Mercado Pago, Resend, Meta, ElevenLabs ni Higgsfield de verdad: usá simulaciones.
7. **El árbol tiene trabajo sin commit de otras sesiones.** No hagas `stash`, `checkout`, `reset` ni `clean`, y no muevas de rama.
8. **El informe no se commitea.** Si el repo es público, el informe describe agujeros. Para saber si es público, mirá con `curl -s -o /dev/null -w "%{http_code}" https://github.com/juanhidalgo0/Ventra`: 200 es público y 404 es privado.

### 2. Decisiones que ya tomé (no las reportes como error)

- No se pide la clave de administrador para anular ni para cambiar precio. Sí hay una demora creciente cuando se pone mal la clave, sin bloqueo largo.
- "Envío con GoDelivery" queda en la tienda.
- Las señas de la agenda **no se devuelven**.
- Hay un solo plan pago, el Full. El plan Caja de $14.900 se eliminó; el código viejo de planes en las funciones es a propósito.
- El identificador del instalador `com.godelivery.pos` **no se cambia**, porque movería los datos de cada PC.
- Quien entra con el candado (clave de administrador sobre la sesión del cajero) cuenta como ADMIN. Para eso se usan `useOwnerAccess()` y `useManagerAccess()` de `apps/frontend/src/utils/managerAccess.ts`.
- **No se cambia el estilo de la caja** (cobro, carrito vacío, primeros pasos): los cajeros ya la conocen. Los arreglos funcionales sí van.
- Ventri, la mascota, nunca aparece en el cobro, en el escaneo ni en errores de venta.
- Suscripción:
  - los 7 días de gracia se descuentan al renovar y después la caja queda en solo lectura;
  - las PCs sin vincular son gratis;
  - la prueba gratis es de 7 días.
- Sincronización: gana el último cambio, y los contadores (`products.stock`, `clients.balance`, `promotions.sold_stock`) viajan como diferencias.

Si alguna de estas decisiones causa un problema grave, podés decirlo en "Decisiones que necesito", pero no como bug.

### 3. Cómo está armado Ventra (verificalo: si el código dice otra cosa, manda el código y anotalo)

- **Caja de escritorio.** Funciona sin internet, cada PC con su propia base SQLite.
  - **Backend:** NestJS + Prisma en `apps/backend`, con unos 44 modelos en `prisma/schema.prisma`. Los módulos están en `src/modules`: acopio, ai, auth, brands, cash-register, categories, clients, fiscal, go, marketing, mercadopago, pos-trail, preorders, products, promotions, purchases, quotes, sales, settings, subscription, suppliers, surcharges, sync, system, users y workorders.
  - **Frontend:** React + Vite en `apps/frontend`, con HashRouter. Las pantallas están en `src/components/*`: pos, cash-register, products, clients, suppliers, reports, settings, mobile, store, agenda, distribuidora, reparto, carniceria, nutri, workorders, fiscal, go, etc.
  - **App de escritorio:** Tauri en `src-tauri`. `src/lib.rs` arranca el backend con su propio `node.exe`. El instalador NSIS tiene su hook en `windows/hooks.nsh` y el actualizador va firmado.
  - Existe además `apps/desktop` (Electron, con `loadFile` / `file://`). Averiguá si todavía se usa o es código muerto.
  - **Armado:** `build:*` en el `package.json` de la raíz, más `copy-frontend.js`, `copy-backend.js` y `apps/backend/scripts/gen-init-schema.js`.
  - **Versiones:** se publican con `.github/workflows/release-desktop.yml` y `publish-release.yml` cuando se sube un tag `v1.0.x`. El número está en `package.json`, `src-tauri/tauri.conf.json` y `apps/frontend/src/appVersion.ts`.
- **Sincronización.**
  - Va de las PCs y la caja en la nube hacia Neon (PostgreSQL) y vuelve: `apps/backend/src/modules/sync/sync.service.ts`, `firebase/functions/sync.js`, `sync-head.js` y `archive.js`.
  - Toda tabla con id se sincroniza sola. Cada caja numera en su propio rango: la caja 0 conserva sus números y la caja k usa k·1.000.000 en adelante.
  - Las filas cuyo "padre" todavía no llegó se apartan (`sync_parked`). La carga completa se hace por tandas.
- **Caja en la nube.**
  - `apps/cloud-host` (`host.js`, `bot-gateway.js`, `login.html`) corre en fly.io como app `ventra-cloud` (`fly.cloud.toml`, `Dockerfile.cloud`). Levanta el backend de cada comercio cuando se usa y lo apaga cuando queda quieto.
  - La demo es otra app: `fly.toml` (`go-portal-pos`), con DEMO_MODE y una base por visitante.
  - **Ojo:** fly arma la imagen con el árbol de trabajo, cambios sin commit incluidos.
- **Funciones en la nube** (`firebase/functions`, unas 67 exportadas en `index.js`, codebase `ventra`):
  - suscripciones y Mercado Pago: `mercadopago.js`, `subscription-rules.js`, `mp-checks.js`;
  - factura electrónica ARCA: `fiscal.js`;
  - IA: `ai.js`, `ai-agent.js`, `ai-organize.js`, `ai-review.js`, `supplier-lessons.js`, `supplier-codes.js`;
  - chat de la web: `chat.js`, con la base de conocimiento en `chat/*.md`;
  - WhatsApp: `whatsapp.js` y el del dueño en `wa-owner*.js`;
  - bot de Instagram: `instagram.js`;
  - mails: `account-emails.js`, `signup-emails.js`, `email-reminders.js`, `mail-kit.js`;
  - agenda: `agenda.js`; cupones: `coupons.js`; pedidos: `order-check.js`;
  - portal del paciente de nutrición: `nutri-portal.js`;
  - consumo y costos: `usage.js`, `dashboard.js`;
  - respaldos: `backup.js`; catálogo de códigos compartido: `barcodes.js`; direcciones de tiendas: `store-slugs.js`;
  - el resto: `invoice-*.js`, `ventra-api/`, `support.js`, `notify.js`, `speech-to-text.js`.
- **Reglas:** `firebase/firestore.rules` y `firebase/storage.rules`, con sus pruebas en `firebase/test/rules.test.mjs`.
- **Web pública** (`firebase/web`, ventra.store):
  - páginas de inicio, rubros, precios, `/empezar` (alta en 4 pasos), `cuenta.html` (Mi cuenta y baja), `admin.html` y `panel.html` (paneles internos), `descargar.html`;
  - scripts `ventra-cuenta.js`, `ventra-chat.js`, `ventri.js` (y el minijuego en `ventri/juego.js`), `medicion.js`, `menu.js`, `estilo.css`;
  - `sitemap.xml`, `robots.txt` y las imágenes `og`.
- **Tienda online y agenda** (`firebase/tienda`): `index.html` es la tienda y la agenda de cada comercio, y `paciente.html` es el portal del paciente.
- **Celular.** El mismo frontend, con una app del dueño en `components/mobile` (PWA con `sw.js`). La versión de tiendas usa Capacitor: `apps/frontend/capacitor.config.json`, `apps/frontend/android` y `codemagic.yaml`.
- **Integraciones:**
  - Mercado Pago (OAuth, suscripciones, cobro);
  - ARCA (factura y nota de crédito);
  - WhatsApp Cloud API, Instagram y Meta;
  - Anthropic (Haiku, Sonnet y Opus, con topes de gasto);
  - Resend (mails);
  - GoDelivery (módulo `go`). GoDelivery tiene su propio repo en `C:\Users\PC\Desktop\GoDelivery`, que queda **fuera de esta auditoría salvo la integración**.
  - Hardware: impresoras térmicas de 58 y 80 mm, lector de códigos, balanza (etiquetas con PLU = SKU) y varias terminales en la misma red.
- **Marketing** (`marketing/`, `ventra-video-10s/`): fuera de la auditoría, salvo que haya secretos o archivos pesados en git.

### 4. Antes de empezar

1. Leé lo que ya se sabe:
   - la memoria del proyecto (`MEMORY.md` y los archivos que nombra);
   - la auditoría anterior, `docs/auditoria-2026-10-14.md`;
   - lo pendiente de publicar, `docs/pendientes-publicar.md`;
   - `git log --oneline -40` y `git status`.
2. Corré todo lo que ya existe y anotá el resultado exacto. Si algo no corre, explicá por qué; no es una falla del código hasta que lo demuestres.

| Chequeo | Comando |
|---|---|
| Tipos del backend | `cd apps/backend && npx tsc --noEmit` |
| Tipos y armado del frontend | `cd apps/frontend && npm run build` (es `tsc -b && vite build`; anotá también el tamaño del bundle) |
| Pruebas del backend | `npm run test:fiscal`, `test:stock`, `test:packs`, `test:boletas`, `test:auth`, `test:anulaciones`, `test:precios`, `test:repetidos`, `test:organizar`, `test:http` (en `apps/backend`, con las variables sin nube del punto 1.3) |
| Pruebas del frontend | `npm run test:nutri`, `npm run test:balanza` (en `apps/frontend`) |
| Funciones | `cd firebase/test && node <archivo>.test.cjs` para cada uno (usan `fake-firestore.cjs` y terminan con "N bien, M con falla"; antes de correrlos, confirmá que ninguno puede llegar a producción, por la regla 1.3); las reglas con `npm test` (necesita el emulador de Firestore) |
| Nube | `cd apps/cloud-host && node --test bot-gateway.test.cjs` |
| Sincronización | `cd tools/sync-sim && npm run escenarios` |
| Dependencias | `npm audit --omit=dev` en `apps/backend`, `apps/frontend` y `firebase/functions` |

### 5. Qué revisar, por área

Para cada área contestá estas preguntas con evidencia. No te quedes en la lista: si ves algo raro al lado, seguilo.

**A. La plata (lo más importante)**
- **El total:** ¿el total de un ticket es siempre la suma exacta de sus líneas? Fijate en la PC, el celular, la caja web, la tienda, los presupuestos, los encargos y la factura del mes.
- **Redondeos y repartos.** Tienen que cerrar al peso:
  - el recargo manual en $ o % que se reparte en los productos;
  - el cargo por servicio;
  - el recargo por transferencia;
  - los descuentos y promos;
  - la pizza mitad y mitad, redondeada a $1.000;
  - los packs;
  - la venta por kilo o por plata;
  - las etiquetas de balanza.
- **Cómo se guarda la plata:** ¿se usan Float/`number` con sumas que arrastran centavos?
- **El cobro:**
  - pagos mixtos, vuelto y saldo a favor;
  - cuenta corriente y fiado: ¿`clients.balance` coincide siempre con la suma de los `AccountMovement`?
  - montos negativos, cero o vacíos.
- **Anulaciones:**
  - ¿devuelven el stock y sacan la plata de la caja correcta, aunque la caja ya esté cerrada?
  - ¿se puede anular dos veces?
  - una venta con factura, ¿genera nota de crédito?
- **La caja y las cuentas del negocio:**
  - cierres X y Z y arqueo con borrador;
  - caja del mes, Tesorería, socios y reparto de ganancias, comisiones;
  - factura del mes agrupada;
  - pagos a proveedores: la deuda es compras menos pagos;
  - señas de agenda y encargos;
  - consumo de empleados (INTERNAL a $0: solo descuenta stock).
- **Fechas y hora:** Argentina es UTC−3.
  - una venta a las 23:59 y otra a las 00:01;
  - un cierre pasada la medianoche;
  - reportes por día, semana y mes;
  - vencimientos de productos;
  - recordatorios de turnos.
- **Numeración:** ¿se puede duplicar un número de venta o de comprobante entre cajas o al restaurar un respaldo?
- **Suscripción y cobro a los comercios:**
  - prueba de 7 días y gracia;
  - doble suscripción en Mercado Pago;
  - baja;
  - qué pasa cuando MP avisa tarde o avisa dos veces;
  - qué pasa con una PC que se queda sin internet un mes.

**B. Stock**
- Las diferencias que viajan entre cajas: ¿alguna vez se suman dos veces o se pierden?
- Kits y packs con stock calculado.
- Lotes y vencimientos (`product_lots`).
- Las compras, ¿suman stock?
- Boletas automáticas: si la misma boleta entra dos veces (por foto, WhatsApp o reintento), ¿duplica el stock? Fijate en `supplier_codes` y en los códigos internos frente a los códigos de barras.
- El desposte de la carnicería, cargado como compra.
- La venta a comercios: el stock tiene que bajar recién cuando sale el reparto.
- Pedidos online: ¿cuándo baja el stock y qué pasa si se cancelan?
- Stock negativo y alta rápida desde la caja.

**C. Sincronización y trabajo sin internet**
- Gana el último cambio de la fila entera: ¿se pierden datos cuando dos cajas cambian campos distintos del mismo producto?
- ¿Se usa la hora de la PC en algún lado? Una PC con la hora mal, ¿pisa datos?
- ¿Se pueden saltear filas al bajar novedades por páginas?
- Las filas apartadas por falta del "padre": ¿alguna puede quedar apartada para siempre?
- La carga completa y la realineación: ¿se cortan si se apaga la PC o la caja en la nube?
- Una PC que vuelve después de 7 días sin internet, y dos PCs que venden el último producto a la vez.
- Esquema distinto entre versiones: una PC vieja con la nube nueva, y una tabla nueva que llega a una PC que no la conoce.
- ¿Hay tablas que se sincronizan y no deberían? Por ejemplo sesiones, claves, datos de una sola PC o `terminals.json`.
- El tamaño de Neon y la limpieza automática (`ventraSyncMaintenance`).

**D. Seguridad y permisos**
- **Endpoints del backend:** revisá cada uno de los controllers de NestJS. ¿Tiene guard? ¿El permiso se controla **en el servidor** y no solo ocultando el botón? Armá una lista de los endpoints sin protección y separá los que deberían tenerla.
- **Roles:** cajero, encargado y administrador, y el token del candado.
- **Red del local:** en qué dirección escucha el backend, límite de intentos (`login-throttle.ts`), largo de las claves y si la demora creciente funciona de verdad.
- **Caja en la nube con muchos comercios:**
  - ¿un comercio puede leer o tocar a otro?
  - rutas con `../` en `/data/tenants/<uid>`;
  - el ruteo de `host.js` y de `bot-gateway.js`;
  - sesiones de 400 días: ¿se pueden cortar?
- **Reglas de Firestore y Storage:** revisá colección por colección quién lee y quién escribe.
  - ¿Alguien sin pagar puede tener tienda o agenda?
  - ¿Hay datos personales legibles por cualquiera? Por ejemplo los teléfonos de los clientes de la agenda o los **pacientes de nutrición, que son datos de salud**.
  - Límites de tamaño y de tipo de archivo en Storage.
- **Funciones:**
  - las `onRequest` sin autenticación;
  - CORS abierto;
  - validación de lo que entra;
  - firma de los webhooks de Mercado Pago, WhatsApp e Instagram;
  - webhooks repetidos: ¿la función es idempotente?
  - límites por IP: ¿se pueden saltear con un `X-Forwarded-For` falso?
- **IA:**
  - texto metido a propósito en una foto de boleta, en un DM de Instagram o en un WhatsApp para que la IA haga algo indebido;
  - el WhatsApp del dueño puede cambiar precios: ¿se verifica que el número sea del dueño o de un encargado de **ese** comercio?
  - topes de gasto;
  - datos de un comercio que se cuelan en las respuestas a otro, por las lecciones por proveedor o el catálogo compartido de códigos `ventraBarcodes`. ¿Un comercio puede "envenenar" el catálogo de todos con un nombre o una foto falsos?
- **Código inyectado:** buscá `innerHTML` con datos que escribe un comercio o un cliente, en la tienda, la web, `admin.html`, `panel.html`, los tickets, los mails y las plantillas A4.
- **Secretos:** en el bundle (`VITE_*`), en el instalador, en el historial de git y en los registros (¿se imprime algún token?).
- **Licencia y suscripción:** ¿se pueden saltear con una variable de entorno, atrasando el reloj o borrando un archivo? ¿Existe una ruta de "reset" de licencia (`reset.txt` nombra `/api/auth/license/dev-reset`) que funcione en una PC instalada?
- **Actualizador:** firma, descarga por HTTPS, bajar a una versión vieja, y qué pasa si se corta a la mitad.

**E. Caja en la nube y demo**
- Apagado por inactividad mientras se está sincronizando, y memoria por comercio. ¿Cuántas cajas abiertas aguanta el servidor?
- Arranque en frío: ¿cuánto tarda y qué ve el cajero mientras tanto (`preparing.html`)?
- Demo por visitante: ¿se borran las bases viejas o se puede llenar el disco?
- Chequeos de salud y registros útiles para cuando algo se cae.
- Incidente del 11/11: un `body-parser` registrado en una sola ruta dejó la nube sin login. ¿Hay otro parecido? ¿`@sparticuz/chromium` se carga bien (es ESM)?

**F. Funciones en la nube**
- Armá una tabla de las ~67 funciones. Para cada una: qué la dispara, si pide autenticación, memoria y tiempo máximo, si es idempotente y qué pasa si falla.
- La opción global `memory: "512Mi"` es inválida (debería ser `"512MiB"`): ¿qué funciones corren con 256 MiB sin saberlo?
- Tareas programadas que recorren todos los comercios: ¿aguantan con 100 o con 1.000?
- Errores que se tragan sin aviso, reintentos que duplican mails, WhatsApps o cobros, y costos (BigQuery, Neon, IA).

**G. IA, bots y lector de boletas**
- Topes diarios y mensuales y su costo por modelo.
- Qué pasa si Anthropic no responde o devuelve un JSON roto.
- Boletas: pasan de Haiku a Sonnet y a Opus, con controles por columna. Revisá:
  - varias fotos que se juntan en un solo comprobante;
  - el costo sin impuestos internos;
  - una boleta que "no cierra", ¿se carga igual?
- Lector sin IA de PDF, Excel y CSV.
- El bot de Instagram (Ventri): ¿se presenta una sola vez, sigue la guía de venta y deriva a una persona cuando corresponde?
- El chat de la web: el límite de 20 mensajes y si las respuestas están desactualizadas frente a lo que hace el sistema hoy (`chat/ventra-kb.md`).

**H. Web pública, tienda y agenda**
- Cada página de `firebase/web`:
  - carga sin errores en consola, con links y anclas vivos;
  - se ve en un celular de 360 px sin scroll horizontal;
  - los `?v=` de cada script están actualizados.
- `/empezar` y Mi cuenta: baja, login desde el navegador interno de Instagram y Facebook, y errores de cuenta.
- SEO: título, descripción, canonical, OG, datos estructurados, `sitemap.xml` y `robots.txt`.
- Velocidad: peso de las imágenes, LCP y fuentes.
- Accesibilidad básica: contraste, foco y textos alternativos.
- Medición: `medicion.js` todavía no tiene los códigos; ¿rompe algo así?
- **Tienda:**
  - el precio tiene que validarlo la nube, nunca el navegador;
  - cupones, mitad y mitad, recargo por transferencia y pago con Mercado Pago;
  - pedido duplicado por doble toque;
  - comercio cerrado u horario de atención;
  - tienda de venta a comercios con link por cliente.
- **Agenda:** doble turno a la misma hora, señas, recordatorios por WhatsApp y zona horaria.
- **Portal del paciente** (`paciente.html`, `nutri-portal.js`): cómo se identifica el paciente y si otro puede ver su plan.

**I. Celular**
- El `sw.js` nunca guarda `/api`. Un usuario con una versión vieja guardada, ¿se actualiza solo?
- Capacitor y Android: el armado, `codemagic.yaml`, márgenes seguros y tamaño de los botones.
- Escáner con la cámara: `BarcodeDetector` solo anda en Chrome de Android; ¿qué pasa en iPhone?
- Sin internet a mitad de una venta desde el celular.
- La caja del dueño es por usuario: el celular usa la caja que el dueño ya tiene abierta.

**J. Escritorio: arranque, instalador, actualizador y hardware**
- **Arranque:** puerto ocupado, backend que no arranca (`backend-startup-error.log`) y qué ve el cajero en ese caso.
- **Instalador:** la carpeta, `hooks.nsh` y la primera actualización en PCs instaladas con versiones viejas.
- **Respaldos automáticos:** dónde quedan, cada cuánto, cuántos se guardan y si **restaurar se probó alguna vez**.
- **Corte de luz** en medio de una venta: transacciones, WAL de SQLite y la base corrupta al reiniciar.
- **Migraciones** de Prisma al actualizar: una PC que salta de la 1.0.60 a la 1.0.104.
- **Impresoras de 58 y 80 mm:**
  - impresora desconectada o sin papel;
  - el ticket que imprimía la pantalla del celular;
  - logo y QR.
- **Lector:** escaneo rápido con dígitos juntados, lecturas malas (dígito verificador) y un código que llega mientras hay un modal abierto.
- **Varias terminales en la misma red:** `terminals.json`.
- **Rutas absolutas en `file://`:** `VentriImg` (`/ventri/…`) y `MangoLogo` (`/ventra-logo.png`) pueden no verse en la PC instalada. Confirmalo o descartalo.

**K. Factura electrónica y legal**
- ARCA:
  - la pasarela, el CAE, la nota de crédito al anular y el punto de venta;
  - homologación frente a producción: ¿puede salir una factura real por error en una prueba?
  - tipos A, B y C e IVA.
- Privacidad y términos frente a lo que de verdad se guarda: datos de salud, WhatsApp, la IA que procesa boletas y la medición.
- Botón de baja visible en la web (en Argentina es obligatorio, por la Res. 424/2020) y consentimiento de cookies si se suman el Píxel y GA4.

**L. Rendimiento y PCs lentas**
- Pensá en una PC con Windows 10, 4 GB de RAM y disco mecánico, con 6.000 productos (Kiosco Paulos tiene 5.771).
- Fotos en base64 dentro de la base y de la sincronización.
- `PaymentModal` baja **todos** los clientes.
- Búsquedas sin índice en el esquema de Prisma y consultas N+1.
- Tamaño del bundle del frontend.
- Fugas de memoria con la caja abierta 12 horas: intervalos, listeners y sockets.
- El modo rendimiento.

**M. Calidad del código y orden del repo**
- Archivos que no deberían estar en git: `apps/backend/*.log`, `prisma/terminals.json`, `tsbuildinfo`, `apps/backend/scratch/*` y scripts sueltos en la raíz (`inspect_*.js`, `test_search_solufix.js`, `reset.txt`).
- Código muerto (por ejemplo `apps/desktop` si ya no se usa) y archivos duplicados que hay que mantener a mano, como `ventri/juego.js`, que está en dos lugares.
- `any`, `@ts-ignore`, `TODO` y `FIXME` en lo que toca plata.
- Lo que toca plata o stock y **no tiene prueba**.
- Textos en inglés o con errores que ve el usuario.

**N. Qué está publicado y qué no**
- Para cada pieza (versión de PC, caja web, demo, cada función, hosting de la web, hosting de la tienda, reglas) anotá:
  - qué hay en git;
  - qué tag tiene;
  - qué está publicado, con la evidencia (`curl`, `functions:list`, `fly releases`);
  - qué está **publicado sin commit**, que es riesgo de perderlo.
- Workflows de GitHub: ¿alguno publica solo al hacer push?
- Compatibilidad: ¿la nube de hoy sigue atendiendo bien a las PCs con versiones viejas?

### 6. Sospechosos conocidos (confirmá o descartá cada uno, con evidencia)

1. Rutas absolutas `/ventri/…` y `/ventra-logo.png` en la PC instalada (`file://`).
2. `setGlobalOptions({ memory: "512Mi" })` inválido.
3. Límite por IP que se saltea con `X-Forwarded-For` en agenda, chat y cupones (pendiente de la auditoría anterior).
4. Gana la fila entera, no el campo: se pierden cambios hechos a la vez en cajas distintas.
5. `PaymentModal` baja todos los clientes.
6. `PATCH /promotions` borra los productos de la promo si no se mandan.
7. Boleta por WhatsApp: varias fotos terminan en un solo comprobante y el costo queda sin impuestos internos.
8. Clave de ADMIN que vuelve a 1234 al entrar: el arreglo es el commit 0d5f19e. ¿Está en la versión publicada?
9. Documento de prueba que quedó en producción en el admin de costos.
10. Ruta de reset de licencia (`/api/auth/license/dev-reset`): ¿existe y funciona en producción?
11. fly arma con el árbol de trabajo: un `deploy:cloud` puede subir trabajo a medias de otra sesión.
12. Mucho trabajo publicado sin commit (ver `docs/pendientes-publicar.md` y la memoria).
13. Todos los puntos abiertos de `docs/auditoria-2026-10-14.md`: C1 a C7, A1 a A8 y M1 a M5.

### 7. Cómo trabajar

- **Usá subagentes en paralelo, uno por área** (o por grupo de áreas: A+B, C+E, D, F+G, H+I, J+K, L+M+N). Pasale a cada uno, completas, las reglas de la sección 1 y las decisiones de la sección 2. Cada subagente devuelve hallazgos con archivo, línea y escenario.
- **Vos verificás en persona cada hallazgo 🔴 y 🟠** antes de ponerlo en el informe: leyendo el código o, mejor, reproduciéndolo con una prueba en el scratchpad o en un backend local sin nube. Lo que no puedas confirmar va marcado **"a confirmar"**, con lo que falta para confirmarlo.
- **Para probar la interfaz,** usá las configuraciones de `.claude/launch.json` (`kiosco-backend-preview`, `ventra-web`, `tienda-local`, etc.) y el navegador integrado. Probá siempre con datos inventados.
- **Preferí pocos hallazgos ciertos a muchos supuestos.** No infles la gravedad. Si algo ya está bien resuelto, decilo en "Lo que está bien hecho".
- **No repitas como nuevo lo que la auditoría anterior ya reportó:** ponelo en la tabla de seguimiento con su estado.
- **Ignorá `.claude/worktrees/`, `node_modules/`, `dist/`, `build/` y `src-tauri/target/`:** son copias o archivos generados. Si no, los subagentes van a reportar todo dos veces.

### 8. El informe

Guardalo en `docs/auditoria-AAAA-MM-DD.md`, con la fecha real, **y no lo commitees**. Tiene que tener estas secciones:

0. **Resumen para el dueño:** 5 a 10 líneas sin tecnicismos y la tabla de los 10 más urgentes, con qué es, gravedad y esfuerzo.
1. **Qué se corrió:** la tabla de la sección 4 con los resultados reales.
2. **Seguimiento de la auditoría anterior:** cada punto marcado como arreglado, parcial, abierto o empeoró, con la evidencia.
3. **Hallazgos, de más grave a menos grave.** Cada uno con este formato:
   ```
   ### [ID] Título corto — 🔴/🟠/🟡/🟢 · Esfuerzo S/M/L · Seguro / A confirmar
   **Qué pasa:** en palabras de un kiosquero.
   **Cuándo pasa:** escenario concreto paso a paso.
   **Dónde:** archivo:línea (todos los que intervienen).
   **Qué se pierde:** plata, datos, ventas, seguridad, clientes, tiempo.
   **Arreglo propuesto:** qué cambiar, y qué podría romper el arreglo (sobre todo en PCs ya instaladas y en la sincronización).
   **Cómo probarlo:** la prueba que demuestra el error y que después demuestra el arreglo.
   ```
   - 🔴 **Crítico:** se pierde plata o datos, se filtran datos de clientes, o alguien de afuera puede entrar, cobrar o borrar.
   - 🟠 **Alto:** pasa en el uso normal y le cuesta plata o ventas a un comercio, o se rompe algo que se cobra.
   - 🟡 **Medio:** caso raro, molestia o deuda que va a doler con más comercios.
   - 🟢 **Bajo:** prolijidad.
4. **Mejoras que no son errores:** separadas en velocidad, producto y ventas/marketing (web, SEO, mensajes). Cortas, con el porqué y el esfuerzo.
5. **Qué está publicado y qué no:** la tabla del área N.
6. **Lo que está bien hecho (no tocar).**
7. **Plan en tandas:** primero lo 🔴 de esfuerzo bajo, después lo que toca plata, después la escala. Cada tanda tiene que poder publicarse sola.
8. **Decisiones que necesito del dueño:** preguntas cerradas, con tu recomendación.

### 9. Cuando termines

- En el chat mostrame solo el resumen, los 10 más urgentes y las decisiones que necesito. **No arregles nada todavía.**
- Guardá en la memoria del proyecto un resumen de la auditoría (archivo nuevo y una línea en `MEMORY.md`).
- Cuando yo elija una tanda, se trabaja así:
  - primero una prueba que reproduce el error, después el arreglo;
  - después se corren **todas** las pruebas de la sección 4;
  - el commit lleva solo los archivos de esa tanda (`git add <archivo>`, nunca `git add -A`) y no se publica nada.
  - Si un archivo de la tanda ya tiene cambios sin commit de otra sesión, frená y preguntame.
  - No cambies el estilo de la caja.
  - Si el arreglo toca la sincronización, la base o el instalador, probalo con `tools/sync-sim` y pensá qué pasa en una PC que se actualiza desde una versión vieja.

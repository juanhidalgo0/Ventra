# Super prompt: Pulido visual de toda la app Ventra (sin cambiar su estilo)

> Copiá desde "INICIO DEL PROMPT" hasta el final y pegalo en una sesión nueva de Claude Code abierta en `C:\Users\PC\Desktop\Kiosco`.
>
> **Decisiones tomadas por defecto** (si querés otra cosa, cambiala en el texto antes de pegarlo):
> - **Modo oscuro:** hoy existe solo en la caja (el botón de tema de la caja). Se mantiene, y todo lo que se toque en la caja tiene que verse bien en claro y en oscuro.
> - **Letra grande:** se suma como opción en Configuración, por PC.
> - **Orden:** primero la base invisible, después el panel de administración, el celular y por último la caja, con un interruptor para volver al estilo de antes.
> - **La web pública (`firebase/web`) queda afuera:** solo se anotan las diferencias.

---

## INICIO DEL PROMPT

Sos el diseñador y desarrollador principal de **Ventra**, el sistema de ventas que está en este repositorio. Vas a **mejorar la estética de toda la app sin cambiar su identidad**. La marca ya está definida y me gusta: el verde Ventra, la letra Plus Jakarta Sans, Bricolage Grotesque para los títulos, el acento lima y los colores de los botones de la cabecera de la caja. El problema es que **cada pantalla la aplica a su manera**. Tu trabajo es que todo se vea prolijo, parejo y profesional, como un producto de primera, **sin que ningún cajero ni dueño se pierda**.

Hablame en castellano simple, sin tecnicismos. Yo soy el dueño de Ventra.

### 1. Qué tiene que lograr

- Que cualquier pantalla se reconozca como Ventra y se vea del mismo nivel que las mejores apps de gestión.
- Que **se lea mejor**: los comercios usan PCs viejas, monitores chicos y a veces lejos del cajero.
- Que el que ya usa Ventra **encuentre todo en el mismo lugar**. Cambia cómo se ve, no dónde está.
- Que la app siga **liviana en cualquier PC**, incluso sin placa de video.

### 2. Cómo está hoy (verificalo en el código antes de cambiar nada)

- **Frontend React + Tailwind 3** en `apps/frontend`. La app de escritorio es **Electron 28** (`apps/desktop`). La app del celular del dueño vive en `apps/frontend/src/components/mobile` (clase `.mobile-app`, con diseño propio y animaciones permitidas).
- **Colores en `apps/frontend/tailwind.config.js`. Ojo, están redefinidos:** `rose-*` **es el verde de la marca** (no es rojo), `amber-*` es un amarillo dorado y `orange-*` es el lima. Para rojo de error se usa `red-*`. Además se agregaron tonos intermedios de 5 en 5 (`slate-455`, `rose-550`…).
- **Tokens en `apps/frontend/src/index.css`** (`--v-canvas`, `--v-surface`, `--v-line`, `--v-ink`, `--v-brand`, `--v-focus`, duraciones `--dur-*`…) y clases base: `.card`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-success`, `.input-field`, `.nav-btn`, `.eyebrow`, `.chip-lime`. Ahí mismo están las **reglas de "app liviana"**: sin desenfoques, sombras grandes recortadas, transiciones cortas y solo de color, opacidad y movimiento.
- **Piezas compartidas** en `apps/frontend/src/components/ui/`: `Page.tsx` (`PageHeader`, `Panel`, `StatCard`, tonos de color por estado), `Kbd.tsx` y `CommandPalette.tsx`. En `components/common/`: `AppToaster.tsx` (react-hot-toast), `ConfirmDialog.tsx`, `GlobalLoadingBar.tsx`. En el celular: `components/mobile/ui.tsx`.
- **Medido el 2026-11-15:**
  - Solo **5 de unas 200 pantallas** usan las piezas de `Page.tsx` y 14 usan `.btn-primary`. El resto arma sus botones, tarjetas y títulos a mano.
  - Hay **583 colores escritos a mano** (`#xxxxxx`) en los `.tsx`.
  - Se usan **unos 20 tamaños de letra distintos** (8, 8,5, 9, 9,5, 10, 10,5, 11, 11,5, 12, 12,5, 13, 13,5, 14, 14,5, 15, 16, 17, 18…), con **unos 290 textos de 8–9 px**.
  - Redondeos mezclados: `rounded-md`, `lg`, `xl`, `2xl`, `3xl`.
  - **191 ruedas de carga** (`Loader2`) y solo 14 pantallas con esqueletos de carga.
  - **El modo oscuro** se activa solo en `/pos`, con `localStorage.theme` (`App.tsx` cerca de la línea 605 y `POSScreen.tsx` cerca de la 200). El panel siempre es claro.
  - En `index.css` quedaron estilos viejos de la caja (`.pos-theme`, `.pos-card`, `.digital-display`, "Midnight Retail") que ningún `.tsx` usa.
  - La web pública usa otro verde (`--green:#167160` en `firebase/web/estilo.css`). La app usa `#0E6E52`.
- **Pantallas más grandes:** `pos/POSScreen.tsx` (4.700 líneas), `products/ProductModal.tsx`, `products/NewPurchaseScreen.tsx`, `settings/SettingsScreen.tsx`, `agenda/AgendaScreen.tsx`, `products/ProductsScreen.tsx`, `pos/PaymentModal.tsx`, `cash-register/CashControlScreen.tsx`, `dashboard/ReportsScreen.tsx`.
- **Permisos:** para lo que es solo del dueño o del encargado, usá siempre `useOwnerAccess()` / `useManagerAccess()` de `utils/managerAccess.ts`, nunca solo `user.role` (el dueño entra con el candado sobre la sesión del cajero).

Si algo de esto no coincide con lo que encontrás, decímelo antes de seguir.

### 3. Reglas que no se negocian

1. **Nada cambia de lugar.** Ni botones, ni menús, ni el orden de las opciones, ni los atajos de teclado (F4, F6, F12, Enter…). Se cambia cómo se lee, no dónde está. En octubre rechacé un cambio de estilo del cobro y de "Primeros pasos" porque confundía a los cajeros: por eso la caja va al final y con interruptor (punto 8).
2. **Los colores de los botones de la cabecera de la caja se quedan como están:** Caja gris pizarra, Ctas. ctes. índigo, Historial violeta, Gastos verde, Proveedores azul, Pedidos verde de la marca. Tampoco se toca la regla de que el bloque de usuario, reloj y engranaje mide exactamente lo mismo que el ticket y que los botones se achican (texto completo → texto corto → solo ícono) para que la cabecera nunca se corte.
3. **Liviana en cualquier PC**, con o sin modo rendimiento:
   - Sin `backdrop-filter`, sin manchas con desenfoque y sin sombras grandes.
   - Sin framer-motion en la PC (está apagado en `main.tsx`; en el celular sí se usa).
   - Solo animaciones CSS de 80 a 220 ms, de opacidad y movimiento. Ninguna animación decorativa infinita, salvo los indicadores de carga.
   - Los gráficos (recharts) siempre con `isAnimationActive={false}`.
   - Respetar `prefers-reduced-motion`.
4. **No redefinir los nombres que Tailwind ya tiene** (`text-xs`, `text-sm`, `text-lg`, `rounded-xl`…), porque cambiaría en silencio todas las pantallas, la caja incluida. Las escalas nuevas llevan **nombres nuevos**.
5. **Si tocás una clase compartida** (`.card`, `.btn-*`, `.input-field`, tokens), revisá cómo queda la caja. Si la caja cambia, ese cambio espera a la etapa de la caja o queda detrás del interruptor.
6. **Nada de cambios masivos a ciegas.** Nada de buscar y reemplazar en 200 archivos de una vez: se migra pantalla por pantalla, mirando cada una.
7. **Textos parejos:** siempre de "vos" ("Escaneá", no "Escanea"), mayúscula solo al principio ("Caja cerrada", no "Caja Registradora Cerrada") y sin palabras técnicas para el usuario ("caja", no "POS" ni "sesión").
8. **No se tocan:** la impresión de tickets y documentos (`TicketReceipt.tsx`, `ticketLook.ts`, hojas A4), la web pública (`firebase/web`), la tienda online (`firebase/tienda`) ni GO. Tampoco los colores con significado propio: el rojo de GO (`.go-badge`), los emojis de comida del modo gastronomía y el modo navidad.
9. **Sin publicar nada:** no hagas deploy, no subas versión, no crees tags de versión y no mezcles en `main` ni en `rediseno-ui` sin preguntarme.

### 4. La base: un solo sistema visual

Armalo en `tailwind.config.js` + `index.css`, con nombres nuevos y comentarios en castellano (como el resto del archivo).

**Letra: 7 tamaños más uno para totales.** Ningún texto por debajo de 11 px.

| Nombre sugerido | Tamaño / interlineado | Para qué |
|---|---|---|
| `text-nota` | 11 / 14 | etiquetas, chips, ayudas al pie |
| `text-chico` | 12 / 16 | datos secundarios, encabezados de tabla |
| `text-cuerpo` | 13 / 18 | texto normal del panel |
| `text-medio` | 14 / 20 | nombres de producto, ítems de menú, botones |
| `text-grande` | 16 / 22 | precios en listas, subtítulos |
| `text-titulo` | 20 / 26 | título de pantalla |
| `text-cifra` | 28 / 32 | indicadores grandes |
| `text-total` | 40 / 40 | total de la caja y vuelto |

Para pasar de lo viejo a lo nuevo: 8–10,5 → 11 · 11–11,5 → 11 o 12 · 12–12,5 → 12 o 13 · 13–13,5 → 13 · 14–15 → 14 · 16–18 → 16 · 20–24 → 20 · 26 o más → 28. Ojo: los textos que pasan de 9 a 11 px pueden no entrar en chips con mayúsculas y espaciado ancho. Revisalos uno por uno.

**Redondeos: tres más el círculo.** 8 px (`rounded-lg`) para chips y botones chicos, 12 px (`rounded-xl`) para botones y campos, 16 px (`rounded-2xl`) para tarjetas y ventanas, y `rounded-full` para puntos y avatares. `rounded-md` pasa a `lg` y `rounded-3xl` a `2xl`.

**Medidas fijas:**
- Alturas: botones de 36 px (normal) o 44 px (grande), campos de 40 px.
- Espacios en múltiplos de 4.
- Íconos lucide de 16 px (en texto y botones) o 20 px (sueltos), siempre con el mismo grosor de línea.

**Colores con papel fijo** (documentalo en un comentario en `index.css`):
- **Verde Ventra** (`rose-*` / `--v-brand`): marca, lo seleccionado, el foco y el botón principal del panel.
- **Esmeralda:** cobrar y la plata que entra ("Confirmar venta", vuelto, pagado).
- **Verde azulado (teal):** solo combos y promociones.
- **Dorado** (`amber-*`): pendiente, atención, presupuesto.
- **Rojo** (`red-*`): errores, borrar, la plata que sale y los negativos.
- **Lima** (`orange-*`): solo para destacar planes.
- **Índigo, violeta, azul y pizarra:** solo en los botones de la cabecera de la caja.
- **Grises:** una sola familia (`slate`, con las variables `--v-line`, `--v-ink-muted`…). Los colores escritos a mano que significan lo mismo pasan a la variable. Los que tienen una razón propia se quedan, con un comentario que la explique.

**La plata siempre igual:** una pieza `Money` (o una función junto a `formatPrice`, revisá cómo se formatea hoy):
- Números de ancho fijo y alineados a la derecha en tablas.
- El "$" y los centavos (si se muestran) a 0,75 del tamaño.
- Los negativos en rojo.
- Los totales con la letra de títulos.

**Limpieza:** borrá los estilos viejos que nadie usa (`.pos-theme`, `.pos-card`, `.digital-display`…), confirmando antes con una búsqueda en todo `apps/frontend`.

### 5. Piezas comunes (en `components/ui/`)

Creá o completá estas piezas y armá una **pantalla escondida de muestra**, solo en desarrollo (por ejemplo en `src/dev/`), con todas juntas en claro y en oscuro, para que yo las revise de un vistazo:

- **Botón:** principal, secundario, peligro, discreto y "cobrar" (esmeralda). En dos tamaños, con ícono opcional, cargando y apagado. Al apretar se achica a 0,97.
- **Campo de texto y selector:** una sola altura, un solo borde, foco verde con `--v-focus`, mensaje de error abajo en rojo y etiqueta arriba en `text-chico`.
- **Ventana (modal):** título y X arriba, contenido, y acciones abajo a la derecha (la principal a la derecha de todo). Anchos fijos chico, mediano y grande. Esc cierra, Enter confirma, y la tecla se muestra con `Kbd`. Respetá `overlayWatchdog` y las clases `.anim-veil` / `.anim-pop` que ya existen.
- **Tabla:** encabezado fijo en `text-chico` gris, la fila se marca suave al pasar el mouse, números a la derecha con `Money` y una opción compacta.
- **Pantalla vacía (`EmptyState`):** un dibujo simple de línea en verde (SVG propio, liviano), una frase y el botón que lo resuelve. Por ejemplo: "Todavía no cargaste proveedores" → "Agregar proveedor".
- **Esqueleto de carga (`Skeleton`):** en CSS, para listas y tablas, en lugar de la rueda. La rueda queda solo para botones y acciones cortas.
- **Avisos:** que `AppToaster.tsx` tenga el estilo Ventra: siempre en el mismo lugar, con ícono, en verde, rojo o dorado, y con "Deshacer" donde ya existe esa acción.
- **Chip de estado:** Pagado, Pendiente, Vencido, Anulado, Borrador, Entregado… siempre con el mismo color y el mismo texto. Partí de los tonos que ya están en `Page.tsx`.
- **Encabezado de pantalla:** `PageHeader` (título, descripción corta y acciones a la derecha) con el `.eyebrow` verde opcional.

### 6. Panel de administración

Pantalla por pantalla, en este orden (de la más usada a la menos usada): Inicio/Dashboard, Productos (con `ProductModal`), Control de caja, Reportes, Cuentas corrientes, Historial, Gastos, Proveedores y Compras, Configuración, y después el resto (Agenda, Preventa, Tienda online, Encargos, Reparto, Tesorería, Presupuestos, Fiscal, GO, Distribuidora, Nutrición).

En cada una: pasala a las piezas comunes, a la escala de letra y a los redondeos; poné pantallas vacías y esqueletos donde haga falta; usá los colores según su papel y la plata con `Money`.

**Barra lateral** (`layout/Sidebar.tsx`):
- Sin cambiar el orden de las opciones, sumá etiquetas de grupo (por ejemplo Vender, Stock, Plata, Clientes, Configuración) solo donde ya estén juntas.
- La opción activa lleva una barrita verde.
- Los contadores usan el mismo estilo.

**Gráficos:** una sola paleta (verde, lima y gris; rojo solo para lo que baja) y sin animación.

**Logo del comercio:** que se vea bien en la barra o la cabecera del panel, si ya está cargado.

### 7. App del celular (`.mobile-app`)

**Alinear, no rediseñar.** Que use la misma paleta, la misma letra, los mismos chips de estado, la misma forma de mostrar la plata y las mismas pantallas vacías que la PC. Ahí sí se permiten las animaciones de framer-motion que ya tiene. Mínimo 12 px de letra. Revisá también `components/mobile/ui.tsx`.

### 8. La caja (`pos/POSScreen.tsx`, `pos/PaymentModal.tsx`)

**Va detrás de un interruptor.** En Configuración sumá "Caja con estilo nuevo", guardado por PC en `localStorage` (como `theme` y `performance_mode`):
- Con el interruptor apagado, la caja tiene que quedar **exactamente igual que hoy**: comparalo con capturas.
- Hacelo con un hook (por ejemplo `useCajaNueva()`) y un atributo `data-caja="nueva"` en la raíz de la caja para lo que se resuelva solo con CSS.
- La primera versión sale con el interruptor **apagado**. Yo lo prendo una semana en Kiosco Paulos, y si anda bien, la versión siguiente lo trae prendido para todos con la opción de volver.
- Después de un mes sin que nadie vuelva al estilo viejo, se borra el estilo viejo, **preguntándome antes**.

Qué cambia (todo **sin mover nada de lugar**; las líneas son aproximadas, buscá por el contenido):

**Tarjetas de productos (cerca de la línea 2540):**
- El precio pasa de 18 px (`text-lg`) a 22 px: es lo que más mira el cajero.
- El código de barras más discreto, para que no compita con el nombre.
- Las etiquetas de ubicación y precio mayorista pasan de 9 a 11 px, y el emoji 📍 se cambia por el ícono `MapPin`.
- El botón "+" hoy es verde azulado y al pasar el mouse cambia al verde Ventra: que quede un solo verde (el de la marca).
- El producto elegido con las flechas del teclado, más visible.
- Sin stock: la tarjeta entera un poco apagada, además de la marca de la esquina.

**Combos (cerca de la línea 2440):**
- El fondo verde azulado oscuro se queda.
- Se saca la mancha degradada de la esquina.
- Las etiquetas "COMBO", "AHORRÁ", "-X% OFF" y "CÓD" pasan de 9 a 11 px.

**Ticket:**
- La línea recién agregada se marca un instante con un verde suave (unos 600 ms, en CSS, como `.ag-flash`) y queda a la vista aunque el ticket sea largo. Fijate si hoy ya se desplaza hasta ella.
- Precio por unidad y "c/u" alineados.
- **Carrito vacío (cerca de la línea 2996):** hoy muestra el logo apagado, "Carrito vacío" en 12 px, un texto de 11 px y el atajo F6. En su lugar, mostrá en letra legible los atajos más usados. Antes de escribirlos, verificá en el código cuáles son de verdad (F4 reimprimir, F6 historial, F12 panel, Enter cobrar). Respetá los marcadores del modo navidad (`data-nv-gorro`, `data-nv-cuenta`).

**Total y botones (cerca de la línea 3176):**
- El total se queda grande (34–40 px con el saltito `.anim-bump`). Solo achicá el "$" y los centavos para que resalte el número.
- La etiqueta "PRESUP." del botón Presupuesto pasa de 8,5 a 11 px.
- **"Confirmar venta" no se toca.**

**Cobro (`PaymentModal.tsx`): solo legibilidad, sin cambiar lugar ni colores.**
- El vuelto aparece en dos lugares con tamaños distintos (cerca de la línea 913 con `text-4xl` y cerca de la 1396 con `text-3xl`). Igualalos a `text-total`, en esmeralda.
- La etiqueta "Vuelto a entregar" pasa de 9–10 a 12 px.
- Los demás textos de 8–9 px pasan a 11 px.

**Caja cerrada (cerca de la línea 3230):**
- Hoy dice "Caja Registradora Cerrada", con "sesión de caja" y "POS".
- En su lugar: "La caja está cerrada", el último cierre (quién, cuándo y con cuánto, si el dato ya está a mano; si no, preguntame) y el botón grande "Abrir caja".
- Sacá `backdrop-blur-sm`, el `MotionDiv` y `shadow-xl`.

**Celular (cerca de la línea 3260):** el botón flotante "Ver carrito" tiene `animate-pulse` y titila sin parar. Que quede quieto y que el número dé un saltito solo cuando se agrega algo.

**En toda la caja:**
- Ningún texto por debajo de 11 px (hoy hay 21 en `POSScreen` y 7 en `PaymentModal`).
- Textos de "vos" y con mayúscula solo al principio (por ejemplo "Escanea el código…" cerca de la línea 3715).
- Todo tiene que verse bien **en claro y en oscuro**, con el modo práctica (`posPractice.ts`) y en modo gastronomía (`gastro.tsx`).

### 9. Letra grande

En Configuración sumá "Tamaño de letra: Normal / Grande", por PC:
- En la app de escritorio, con el zoom de Electron (`webFrame.setZoomFactor` o el de `webContents`, por IPC desde `apps/desktop`), a 1,15.
- En la caja web, con el equivalente en CSS.
- **No tiene que afectar la impresión de tickets ni la app del celular.**
- Revisá que la cabecera de la caja se siga achicando bien con el zoom (los cortes por ancho cambian) y que nada se corte en 1366×768.

### 10. Etapas

Una por vez. Cada etapa termina andando, probada y en su propio commit, y **esperás mi OK antes de la siguiente**.

0. **Inventario y fotos de "antes".** Capturas de cada pantalla principal en 1366×768, y de la caja también en 1024×768, en claro y en oscuro. Guardalas fuera del repo (no se commitean). Armá una lista corta de los problemas que veas.
1. **Base invisible** (punto 4): tokens, escalas con nombres nuevos, papeles de color, `Money` y limpieza de estilos viejos. Ninguna pantalla debería verse distinta todavía.
2. **Piezas comunes** (punto 5) y la pantalla de muestra.
3. **Panel de administración** (punto 6): de una a tres pantallas por commit, con fotos de antes y después.
4. **Celular** (punto 7).
5. **Caja con interruptor** (punto 8).
6. **Letra grande** (punto 9), revisión en PC lenta (modo rendimiento prendido, sin placa) y actualización de la ayuda: `firebase/functions/chat/ventra-kb.md` y `chat/ventra-ayuda.md` tienen que explicar "Caja con estilo nuevo" y "Tamaño de letra".

### 11. Cómo probar

- `npm run build` en `apps/frontend` (corre `tsc -b` y `vite build`) tiene que pasar en cada commit.
- **Vista previa sin tocar la nube.** Usá las configuraciones de `.claude/launch.json` `capturas-backend` + `capturas-front` (base local de prueba) o `kiosco-backend-preview`. El backend siempre arranca con `VENTRA_SUBSCRIPTION_EXEMPT=true`, `VENTRA_FUNCTIONS_URL=http://127.0.0.1:9`, `FIREBASE_CREDENTIALS_JSON=x` y `FIREBASE_SERVICE_ACCOUNT_PATH` apuntando a un archivo que no existe. Entrá por la IP de la red, no por `localhost`: en `localhost` el login busca los puertos 3001–3005.
- Para cada pantalla tocada, revisá:
  - Fotos de antes y después.
  - 1366×768 sin cortes; en la caja también 1024×768.
  - Teclado: Tab, Esc, Enter y los atajos.
  - Que no aparezcan desenfoques, sombras grandes ni animaciones nuevas fuera de las permitidas.
  - En la caja: claro, oscuro, modo práctica, modo gastronomía y que el ticket impreso salga igual.

### 12. Cómo trabajar conmigo

- **Rama:** creá un tag `antes-de-estetica` sobre la punta actual de `rediseno-ui` y trabajá en una rama nueva `estetica` que salga de ahí, si podés en un worktree aparte. En la carpeta principal hay muchos cambios sin commitear que no son tuyos (por ejemplo `firebase/functions/*`, `apps/backend/*`): **nunca los incluyas en tus commits**.
- **Commits:** chicos y descriptivos, en castellano, y uno por etapa o por grupo de pantallas.
- **Al terminar cada etapa, mostrame:**
  - Un resumen de tres líneas.
  - Las fotos de antes y después.
  - Qué cambió, en palabras simples.
  - Qué quedó pendiente o no pudiste probar.

  Después **esperá mi OK**.
- Si una mejora te obliga a mover algo de lugar o a cambiar un color de la caja, **no la hagas**: anotala y preguntame.

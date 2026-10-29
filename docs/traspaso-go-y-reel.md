# Traspaso: GO + Ventra y reel publicitario (2026-10-26)

Nota para seguir el trabajo desde otra sesión o cuenta de Claude. Leer completa antes de tocar nada.
Más contexto en la memoria del proyecto: `C:\Users\PC\.claude\projects\C--Users-PC-Desktop-Kiosco\memory\MEMORY.md`.
Archivos que más sirven: `go-tienda-mercado.md`, `ventra-go-compra-repartidor.md`, `go-ideas-pendientes-escala.md`, `ventra-videos-remotion.md`, `firebase-functions-deploy.md` y `marketing-mindset.md`.

## 1. Estado de Ventra (repo Kiosco, rama `rediseno-ui`)

| Qué | Commit | Estado |
|---|---|---|
| Botón de GO en la caja: solo el logo y el número en rojo `#e11d48` con onda suave (`.go-badge` en `apps/frontend/src/index.css`). Sin cartel arriba: `GoOrderAlert` solo suena y vibra. Modal de pedidos rediseñado (`GoOrdersModal.tsx`). | b1b7f78 + versión 1.0.82 (b955cb0, tag `v1.0.82` subido) | **Publicado en fly** (release v90). **Falta "Publicar versión"** en GitHub Actions → publish-release → `v1.0.82`. Lo hace el dueño, que tiene la sesión de GitHub; `gh` no está instalado. |
| Pago mixto: el medio sin recargo (efectivo) cubre primero los productos con recargo, y el recargo va solo sobre lo que no cubre (`mixedSurchargePercents` en `PaymentModal.tsx`). | 61bb744 + versión 1.0.83 (522d088, tag `v1.0.83` subido) | **Publicado en fly** (release v91, 2026-10-26). **Falta "Publicar versión"** `v1.0.83` en GitHub Actions (la hace el dueño; reemplaza a la 1.0.82). |
| GO Delivery en el menú de toda PC vinculada: el Sidebar consulta `/go/status` y ya no depende de que esa PC haya abierto GO. Logo de GO en lugar de la bicicleta (menú, tarjeta de Integraciones y aviso "Pedido GO" del ticket). | 61bb744 + 1.0.83 | Igual que la fila de arriba. |

Detalle conocido: el recargo se redondea por unidad, así que en el pago mixto puede quedar $1 arriba (por ejemplo $116 en vez de $115). El dueño no pidió cambiarlo.

**Cuidado:** en el árbol de trabajo hay muchos cambios ajenos sin commitear (consultorio de nutrición en `Sidebar.tsx`, `MobileShell.tsx`, `businessStore.ts`, `App.tsx` y otros). No meterlos en commits de GO: commitear solo lo propio. Si un archivo mezcla cambios, armar el índice desde HEAD con los cambios propios (`git hash-object -w` + `git update-index --cacheinfo`).

### Cómo publicar una versión de Ventra
1. Subir la versión en `package.json` y `src-tauri/tauri.conf.json` y commitear `chore: version 1.0.X`.
2. Crear el tag `v1.0.X` y hacer `git push origin rediseno-ui` y `git push origin v1.0.X`.
3. Caja web (fly), desde un worktree limpio y **con rutas absolutas** (las relativas fallan en Windows):
   ```bash
   git -C C:/Users/PC/Desktop/Kiosco worktree add ../ventra-10XX v1.0.XX
   fly deploy 'C:\Users\PC\Desktop\ventra-10XX' --config 'C:\Users\PC\Desktop\ventra-10XX\fly.cloud.toml' --remote-only
   ```
   Después, `git worktree remove --force ../ventra-10XX`. El clasificador a veces bloquea el deploy: hacerlo solo con un pedido explícito del dueño ("publicalo").
4. "Publicar versión" en GitHub Actions: lo hace el dueño.

## 2. Ambiente de prueba (sin nube)

- **Emuladores de GO**: `cd C:/Users/PC/Desktop/GoDelivery && npx firebase-tools emulators:start --config firebase.e2e.json --project demo-godelivery`. Arrancan vacíos: hay que volver a correr la simulación.
- **Caja de prueba**: configs `go-sim-backend` (puerto 3020) y `go-sim-front` (puerto 5240) de `.claude/launch.json`. Usuario `ADMIN`, clave `sim1234`. La base está en `C:/Users/PC/AppData/Local/Temp/claude/C--Users-PC-Desktop-Kiosco/9ac7127d-2c36-4d83-b106-4e4e9b0e8cb5/scratchpad/sim/db/sim.db`. En el front: `localStorage.setItem('server_ip', location.host)`.
- **App GO de prueba**: config `go-sim-app` (puerto 5174, con emuladores).
- **Simulación** (vincula la caja, publica el catálogo y deja un pedido abierto con `SIM_KEEP=1`):
  ```bash
  cd C:/Users/PC/Desktop/GoDelivery && VENTRA_DB=C:/Users/PC/AppData/Local/Temp/claude/C--Users-PC-Desktop-Kiosco/9ac7127d-2c36-4d83-b106-4e4e9b0e8cb5/scratchpad/sim/db/sim.db FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 GCLOUD_PROJECT=demo-godelivery SIM_KEEP=1 node tests/simulacion-ventra-go.mjs
  ```
  Resultado esperado: 20 bien (21 sin `SIM_KEEP`).
- **Disparar el aviso de GO en la caja de prueba** (consola del front):
  `const m = await import('/src/services/websocket.ts'); m.wsService.socket.listeners('go:order').forEach(f=>f({type:'new',id:'demo-'+Date.now(),number:'2312',count:3,isShopper:true,status:'pending'}))`
- En la base de prueba quedó un recargo de prueba (+10% con CLOVER y MERCADOPAGO en la categoría de golosinas, `d5430352-…`). Borrarlo desde la pantalla de recargos si molesta en las capturas.
- **Esta PC tiene credenciales de gcloud**: un script de funciones corrido sin emuladores escribe en **producción**. Confirmar las variables de los emuladores antes de correr cualquier cosa.

## 3. Trabajo en curso: reel "El precio viaja solo" (Ventra + GO)

Pedido del dueño: una publicidad que muestre **imágenes reales de Ventra y de la tienda en GO**, que se vea cómo funciona y se entienda bien. Antes de idear, leer la skill `.claude/skills/ventra-video/SKILL.md`. El estilo aprobado es fintech cálido (crema `#F7F3EC` + verde Ventra, Plus Jakarta Sans, app real en primer plano, música real con cortes en compás). Tomar de referencia `marketing/remotion/src/reel-agenda-pro` (guion.ts, piezas.tsx con `Telefono`, `Captura`, `Resalte`, `Titular`, `Notificacion`) y su audio `scripts/reel-agenda-pro-audio.py`.

**Estado (2026-10-26, tarde):** hecho y renderizado, sin commit. Falta que el dueño lo vea y apruebe.
- Video: `marketing/remotion/out/reel-go.mp4` (33,6 s) y portada `out/reel-go-portada.png`. Composición `ReelGo` en `src/reel-go/` (guion.ts + ReelGo.tsx, reusa las piezas de reel-agenda-pro), audio con `python scripts/reel-go-audio.py` (mismo tema "That Good Feeling"; si el dueño quiere otro, cambiar `musica.mp3` y los números del guion).
- Capturas reales en `public/reel-go/app/`. `scripts/capturar-app.mjs` ahora acepta `"movil": false` (caja de la PC, 1280x800 escala 2) y `"sesion"` (sessionStorage).
- La caja de prueba se abre en `http://[::1]:5240` (con `localhost` busca el servidor en 3001-3005 y no entra). La sesión se arma pidiendo el token a `/api/auth/login` antes de capturar y marcando los recorridos como vistos (`ventra_tours_seen_v2:<id>`).
- En el emulador la tienda se llama "Kiosco La Esquina" (logo inventado, Belgrano 455), con fotos tomadas de GO producción **solo en lectura** (REST público). Se borraron los productos basura de la prueba en la caja y en GO, se ordenaron los stocks y la Coca 2,25 L quedó en $4.100. El pedido #15 (Coca + agua) está abierto; el #14 viejo se borró de `go_orders`.
- El cambio de precio viaja de verdad: al guardar en la caja llegó a GO en 3-4 s sin tocar nada más.

**Guion final:** "Lunes, 8:40. Subió la Coca." → "La cambiás en la caja…" ($3.800 → $4.100, Guardar) → "…y en GO ya está." → "Todo tu kiosco, con fotos." → "Un vecino pide." → "En la caja, entra el pedido." → "El repartidor lo compra acá…" → "…y paga como cualquier cliente." → "Un solo precio. En la caja y en GO." → cierre Ventra + GO, "Tu kiosco en GO, con los precios de tu caja", ventra.store, Ventra Full $24.900.

**Plan original** (queda como referencia):

**Guion propuesto** (100 bpm, 1 compás = 72 cuadros, 20–35 s, 1080×1920):
1. En la PC, en Ventra, se cambia el precio de la Coca-Cola 2,25 L de $3.800 a $4.100 (modal de edición de producto). Titular: "Cambiás un precio en la caja…".
2. En el celular, la tienda de GO (vista kiosco) ya muestra $4.100, resaltado. Titular: "…y en GO ya está."
3. La tienda: categorías, combos y fotos ("Todo tu catálogo, con fotos y categorías"). No prometer 5.700 productos: ese número es de Paulos.
4. Un vecino arma el carrito y hace el pedido.
5. En la caja entra el pedido: suena y aparece el botón negro de GO con el 1 en rojo; se abre "Pedidos de GO".
6. "Cobrar en la caja" arma el ticket: el repartidor compra en el mostrador como cualquier cliente.
7. Cierre: Ventra + GO, "ventra.store", "Ventra Full $24.900/mes".

**Para capturar:**
- Usar `marketing/remotion/scripts/capturar-app.mjs` (Chrome headless por CDP). Hoy emula un celular (`mobile: true`). Para la caja de la PC hay que agregar una opción de escritorio (por ejemplo 1280×800 con `deviceScaleFactor` 2) para poder acercar la cámara sin perder nitidez.
- Login: el perfil de Chrome es nuevo, así que hay que pasar en `storage` los tokens de la caja de prueba (copiarlos del localStorage del front de prueba) y `server_ip`.
- La tienda de prueba se llama "Kiosco Paulos (simulación)" y tiene el logo genérico. Para el video, renombrarla en el emulador a un **kiosco inventado** (por ejemplo "Kiosco La Esquina") y ponerle un logo propio. **No mostrar a Paulos sin permiso de su dueño:** se le preguntó al dueño de Ventra y todavía no respondió.
- A varios productos de prueba les faltan fotos. Ponerles fotos reales de producto (por código de barras) en el emulador; las fotos HD de las marcas se pueden leer de GO producción **solo en lectura**.
- Solo prometer lo que figura en `firebase/functions/chat/ventra-kb.md` (la sección de GO Delivery está en la línea ~53). GO es la app de delivery de Magdalena.

## 3b. Reel "Un pedido real en Kiosco Paulos" (2026-10-26)

Con permiso del dueño de Paulos. Hecho y renderizado, sin commit: `marketing/remotion/out/reel-paulos.mp4` (36 s) y `out/reel-paulos-portada.png`. Composición `ReelPaulos` (`src/reel-paulos/`: guion.json con los clips en compases + ReelPaulos.tsx), audio `python scripts/reel-paulos-audio.py`. **La música es provisoria** (la misma de los otros reels): falta que el dueño elija un tema.
- Las tomas son **video real** de la app grabado con `scripts/grabar-app.mjs` (Chrome por CDP, toques, deslizamientos y tipeo reales, mp4 a 60 fps + JSON con los toques). Están en `public/reel-paulos/tomas/` (pedido, caja, seguimiento).
- La tienda es una copia en el emulador de la de producción (`comercios/paulos-copia`, leída solo por REST público, 5.769 productos con `source: "copia"` para que la publicación de la caja no los oculte). La caja de prueba quedó **vinculada a paulos-copia** (código `PAULOSCP`), con los productos B1 (promo Branca + Coca), HIELO y Lays con los códigos de Paulos.
- Pedido #17 (`R3Wi2Z9QsiqGSA7qpUsk`): combo Fernet + Coca, hielo sugerido por "Combiná con…", Lays; la caja lo cobró (ticket 83, paga con $30.000, vuelto $2.500) y el seguimiento se movió a mano como el repartidor (comprado → en camino → llegó → entregado).
- Para grabar: zona `Pacific/Tongatapu` (se ve lunes 21:30), `gd-onboarding-done`, `gd-client-tour-done-<uid>` y la dirección con `setDeliveryAddress` después del login (si no, aparecen la guía y "Activá tu ubicación").

## 4. Pendientes para después (pedidos por el dueño)
- Botón "Abrir mi súper en GO" que haga en minutos lo que con Paulos se hizo a mano (categorías con IA, fotos HD, combos, vista kiosco y recargos).
- Paulos como caso de éxito: landing y reel con números reales, con permiso.
- Otras ideas ofrecidas sin decisión todavía: precio GO por categoría (+% para cubrir la comisión), reemplazos elegidos por el cliente, búsquedas sin resultado, "volver a pedir", lista ordenada por góndola, mayor de 18 en alcohol y cigarrillos.

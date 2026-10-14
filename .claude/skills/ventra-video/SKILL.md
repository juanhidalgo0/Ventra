---
name: ventra-video
description: Dirección y proceso para hacer videos publicitarios de Ventra (reels, historias, anuncios) con Remotion en marketing/remotion. Usar antes de idear, guionar, animar o musicalizar cualquier video de Ventra, para que salga con identidad propia y no con la estética genérica de los videos hechos con IA.
---

# Videos de Ventra

El objetivo es que un video de Ventra se reconozca sin ver el logo: que parezca filmado o vivido, no "generado". Lo que sigue manda por encima de los gustos por defecto.

## 0. Lo que el dueño ya aprobó y rechazó (leer primero)

- **Rechazado:** animación genérica (Bricolage/Inter, entradas suaves, celular flotando con app inventada) = "parece IA". Stop-motion de papel con fuentes de Office = "poco profesional".
- **Aprobado: fintech cálido** (como Mercado Pago o Ualá). Referencia: `src/reel-agenda-pro`.
  - **App real** en primer plano: capturas de la app de verdad con `scripts/capturar-app.mjs` + un JSON de tomas (ver `scripts/capturas-agenda.json`), sobre la vista de desarrollo `apps/frontend/reel-tienda.html` (servidor `reel-tienda` de `.claude/launch.json`, datos en memoria, sin nube; `?plan=agenda_pro&rubro=pelu`). El script también mide dónde quedó cada texto para resaltarlo exacto.
  - **Plus Jakarta Sans** (la de la app y la web, OFL) en `public/fuentes/`; Inter para interfaz.
  - Crema `#F7F3EC` + verde Ventra; el verde entra con un círculo que crece. Titulares grandes alineados a la izquierda, cada línea sube desde una máscara.
  - **Música real** con licencia libre (Pixabay), elegida por el dueño; se detecta el tempo y cada escena dura un compás. El audio se recorta en compás y termina con el final verdadero del tema (ver `scripts/reel-agenda-pro-audio.py`). Sonidos de interfaz sintetizados muy bajos debajo.
  - Pantallas recreadas (WhatsApp, avisos) con los textos reales que manda el sistema (plantilla y avisos de `firebase/functions`).
  - Celular grande (escala 1,2–1,3) para que la interfaz se lea en un teléfono; la parte de abajo puede quedar fuera del cuadro.

## 1. Primero la idea, después la animación

- Cada video cuenta **una escena concreta de una persona concreta** (una peluquera a las 23:47, un kiosquero cerrando la caja un domingo), no una lista de funciones.
- Antes de escribir código, proponer **3 ideas distintas** en una línea cada una y elegir una (o que elija el dueño). El dueño **no quiere filmar**: las ideas tienen que poder hacerse enteras con animación, sonido sintetizado y capturas de la app. Lo "real" se logra con detalles verosímiles (horas, nombres, mensajes como los escribe la gente), no con filmación.
- Prohibida la fórmula "problema → *pero ahora existe X* → 5 funciones → precio". Si el video se puede describir así, rehacer la idea.
- Una sola idea fuerte por video. Máximo 3 funciones mencionadas; el resto lo cuenta la web.
- 20 a 35 s, vertical 1080×1920, 30 fps. Tiene que entenderse **sin sonido** (el texto es parte de la escena) y ganar **con sonido**.

## 2. Lenguaje visual

- **Diegético primero:** el texto vive dentro de la escena (notificaciones, la pantalla de la app, un ticket, una agenda de papel). Los carteles superpuestos son la excepción y van grandes, en Bricolage, alineados a la izquierda, a veces cortados por el borde del cuadro.
- **Cámara con cuerpo:** deriva suave de cámara en mano (suma de senos lentos, ±6 px, ±0,4°), empujes y alejamientos lentos para marcar el cambio de escena. Nada perfectamente quieto.
- **Textura:** grano fino animado (feTurbulence con semilla por cuadro, opacidad ≈ 0,06–0,1) y viñeta. La luz viene de algo de la escena (la pantalla, la ventana), no de una mancha decorativa.
- **Cortes secos y silencios.** El corte a negro y el silencio son herramientas. Transiciones solo cuando significan algo (pasa el tiempo, amanece).
- **Movimiento:** curvas ease-out cortas (6–12 cuadros). Sin rebote, sin `spring` con overshoot, sin elementos que "saltan" escalando desde 0.
- **Color:** verdes de marca (`src/marca.ts`: #136B57, #0B4A3C, #7FE3B8) y crema #F7F3EC para el "después". La noche/el caos puede ser fría y oscura; Ventra entra con luz cálida.
- **Tipografía:** el dueño encontró Bricolage + Inter "genéricas de IA". Cada video elige tipografías **que pertenezcan a su mundo** (letras recortadas de revista, escritura a mano, máquina de escribir, rotuladora Dymo, sellos de goma) en vez de una sans prolija. Se pueden usar las fuentes de Windows/Office de la PC (Cooper Black, Rockwell Extra Bold, Stencil, Playbill, Ink Free, Segoe Print, Lucida Sans Typewriter, Tw Cen MT Condensed Extra Bold…). Las variantes "Condensed"/"Demi" se registran con `@font-face { src: local('<nombre completo>') }` y se espera la carga con `delayRender` (ver `src/reel-faltazos/papel.tsx`). **No** usar las fuentes que instaló el dueño desde sitios gratuitos (28 Days Later, BAD GRUNGE, White On Black…): suelen ser solo para uso personal.
- **Piezas reutilizables de stop-motion** en `src/reel-faltazos/papel.tsx`: `salto` y `tiembla` (animación a tercios con temblor), `Papel` (recorte con fibra y sombra), `Cinta`, `Recortes` (letras de revista), `AMano`, `Trazo` (tachón, círculo, flecha), `Sello`, `Dymo`, `Mano`.

## 3. Lista de lo que NO se hace (lo que hace que todo parezca igual)

- Texto centrado que aparece palabra por palabra con rebote.
- Manchas de degradé flotando, glassmorphism decorativo, fondos de puntitos, brillos que pasan por encima.
- Tarjetas de "funciones" con íconos en grilla, checklists animados, contadores que suben solos sin motivo.
- Emojis en pantalla. Íconos genéricos de librería como protagonistas.
- Música de stock alegre de principio a fin. La voz de ElevenLabs por defecto que usa todo el mundo.
- Mockups de celular flotando y girando en 3D sobre un fondo liso.
- Frases de agencia: "Llevá tu negocio al siguiente nivel", "Todo en un solo lugar", "Simple. Rápido. Seguro."

## 4. Sonido

- El sonido cuenta la historia: ambiente del lugar, vibraciones, la caja, el silencio. La música es sostén, no protagonista.
- Se sintetiza en Python (numpy/scipy, sin samples con derechos) en `marketing/remotion/scripts/`, leyendo los tiempos del mismo guion que usa el video, y se mezcla a −14 LUFS con el ffmpeg de `ffmpeg-static`.
- Si hay voz, preferir una **voz real** grabada con el celular (el dueño o alguien del rubro). Rioplatense, con voseo, sin tono de locutor.

## 5. Lo que se puede prometer

- La fuente es `firebase/functions/chat/ventra-kb.md`. Si una función figura como PRÓXIMAMENTE, no se muestra.
- Excepciones autorizadas por el dueño (2026-10-09): **cobro/seña con Mercado Pago en la agenda** se puede mostrar; los **recordatorios por WhatsApp** funcionan.
- Precios actuales: Agenda desde $9.900/mes (recordatorio automático en Agenda Pro $19.900), Full $24.900. Ventra Caja ya no se vende.
- Nombres y datos de ejemplo inventados (nunca clientes reales sin permiso).
- **General, no de un solo género ni rubro:** clientes mezclados (Nico, Flor, Juan, Caro…), textos neutros ("cada cliente", "¿Van a venir?", nunca "todas"/"cada una") y servicios que sirvan para cualquiera (corte, barba, color). El dueño lo pidió explícitamente.

## 6. Proceso técnico

1. Guion en `src/<reel>/guion.json`: escenas en cuadros y cada evento (notificación, cartel, sonido). Es la única fuente de tiempos para el video **y** para el audio.
2. Componentes en `src/<reel>/`, composición registrada en `src/Root.tsx`.
3. Antes de animar todo, sacar **cuadros fijos** de cada escena (`npx remotion still <Id> out/stills/x.png --frame=N`) y revisarlos.
4. Audio: `python scripts/<reel>-audio.py` → `public/<reel>/audio.wav`.
5. Render: `npx remotion render <Id> out/<reel>.mp4`. Revisar algunos cuadros del mp4 final antes de entregarlo.
6. Portada: un still del momento más fuerte (no el logo).
7. Checklist final: ¿se entiende sin sonido? ¿hay algo de la lista del punto 3? ¿promete algo que no está? ¿el último cuadro dice qué hacer (ventra.store) y el precio?

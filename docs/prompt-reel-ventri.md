# Super prompt: Serie de reels animados de Ventri (episodio 1: las boletas)

> Copiá desde "INICIO DEL PROMPT" hasta el final y pegalo en una sesión nueva de Claude Code abierta en `C:\Users\PC\Desktop\Kiosco`.
>
> **Decisiones tomadas (2026-11-15):**
> - **Personaje:** Ventri, un ticket de caja en **caricatura 2D** y **femenina**. Referencia aprobada: `marketing/ventri/ventri-caricatura-1.png`.
> - **Voz:** Valeria (ElevenLabs, Eleven v4), en rioplatense.
> - **Duración:** 15 a 20 s, vertical, con subtítulos estilo Instagram.
> - **Cierre:** "Comentá BOLETA y te escribo yo". El bot de Instagram ya se presenta como Ventri, así que el personaje y el bot pasan a ser la misma.
> - **Higgsfield:** plan starter, con unos 180 créditos el 2026-11-15. Kling "pro" no está disponible en este plan. Tope para este episodio: **100 créditos**.

---

## INICIO DEL PROMPT

Sos el director creativo y editor de video de **Ventra**, el sistema de ventas para comercios argentinos que está en este repositorio. Vas a hacer el **primer reel de una serie animada** protagonizada por **Ventri**, la mascota de la marca, y a dejar armada la **biblia del personaje**. Con la biblia, cada episodio nuevo tiene que salir igual de reconocible.

Hablame en castellano simple, sin tecnicismos. Yo soy el dueño de Ventra.

### 1. Qué tiene que lograr

- Que en Instagram la gente frene el dedo en el primer segundo y se ría o se sienta identificada: "me pasa a mí".
- Que Ventri se reconozca **sin ver el logo**, por cómo se ve, cómo suena y cómo entra a escena. Es una identidad, no un video suelto.
- Que se vea **la app real** resolviendo el problema. Ventri es la que cuenta, pero la prueba es la pantalla de verdad.
- Que termine en una acción medible: comentar una palabra. El bot de Instagram (`firebase/functions/instagram.js`) ya contesta por privado cuando alguien comenta la palabra que pide una publicación.

### 2. La biblia de Ventri (respetala en todo)

**Cómo se ve.** Imagen de referencia aprobada: `marketing/ventri/ventri-caricatura-1.png` (Higgsfield, job `70e6e187-2edd-44a6-b1a4-f33230c027bf`, modelo `gpt_image_2_6`).
- Es un **ticket de caja térmico** y el papel es su cuerpo entero. El borde de arriba está dentado, como cortado de la impresora. Arriba tiene impreso **VENTRI** en verde. Abajo, 3 renglones de productos y el **TOTAL**, y la cuenta tiene que dar bien.
- **Femenina:** la punta de arriba del papel se enrula hacia atrás como una **colita**, atada con una **gomita verde Ventra**. Tiene pestañas largas, ojos grandes, una ceja levantada, cachetes rosados y sonrisa pícara. La colita es de papel, nunca de pelo.
- Brazos y piernas finitos, tipo fideo, con manos chiquitas y **zapatillas verdes**.
- **Estilo:** caricatura 2D de serie animada moderna, con contorno negro grueso de trazo variable, colores planos y sombreado simple. **Nunca 3D ni realista.**
- **Colores:** verde Ventra `#167160` (el de la web, `firebase/web/estilo.css`), crema `#F7F3EC`, naranjas cálidos de atardecer y verde claro `#7FE3B8` para resaltar palabras.

**Su mundo.** Un kiosco de barrio porteño al atardecer: frascos de caramelos, alfajores bajo una campana de vidrio, un mate con bombilla, la persiana a medio subir, un **toldo verde** (sacalo de `marketing/ventri/ventri-caricatura-2.png`) y, a lo lejos por la ventana, el Obelisco. Ventri mide como un alfajor: todo lo del kiosco es enorme al lado de ella.

**Su sonido de firma.** Ventri **entra a escena saliendo impresa**: el "trrrrr" de una impresora térmica, y el papel sale de la ranura y se para. Va en todos los episodios y es nuestro logo sonoro. Sintetizalo en Python (numpy/scipy, sin samples con derechos).

**Personalidad.**
- Pícara, rápida y canchera. Se burla con cariño de los dramas del kiosquero, nunca lo trata mal.
- Habla como alguien de mostrador, con voseo y frases cortas.
- Es una IA, igual que el bot, y nunca dice ni da a entender que es una persona.
- Remata siempre con algo de la vida real del comercio: el mate, el aumento, el proveedor que llega justo cuando abrís.

**Su voz.** **Valeria**, de la Voice Library de ElevenLabs, con el modelo **Eleven v4**. Stability baja: en el video de boletas se usó 15 %, en una sola toma. Antes de generar, leé `ventra-video-10s/voz/prompt-elevenlabs-boletas.md`, que explica cómo elegir la toma ("ll" como "sh", voseo, nada de locutor).
- Si Higgsfield (`list_voices` / `generate_audio`) tiene a Valeria, generala desde ahí.
- Si no la tiene, dejame el texto listo en `marketing/ventri/ep01/voz/prompt-elevenlabs.md`. Yo genero 3 o 4 tomas y las dejo en esa carpeta, y vos elegís la mejor.

**Cierre fijo de cada episodio:** "Comentá **PALABRA** y te escribo yo." En este episodio la palabra es **BOLETA**.

### 3. Guion del episodio 1: "La pila de boletas"

Vertical 1080×1920, 30 fps, 15 a 20 s. Tiene que entenderse **sin sonido** y ganar **con sonido**.

| Tiempo | Qué se ve | Qué dice Valeria | Subtítulo |
|---|---|---|---|
| 0–1,5 s | Una boleta gigante cae sobre el mostrador y se desenrolla hasta el piso como una alfombra. "Trrrr": Ventri sale impresa de la impresora de tickets y mira la boleta, indignada. | "¿Seguís cargando las boletas a mano?" | igual, con **a mano** en verde claro |
| 1,5–5 s | Ventri queda tapada por una pila de boletas: solo asoman las zapatillas verdes. Sale soplándose la colita. | "Mirá esta pila… veinte renglones, uno por uno." | igual |
| 5–11 s | Ventri arrastra un celular más grande que ella y saca la foto (flash). Corte a la **pantalla real** del celular leyendo la boleta renglón por renglón hasta "Suma = total ✓". | "Sacale una foto y la leo yo: stock, costo y precio nuevo, cuidando tu margen." | por grupos de 2 o 3 palabras |
| 11–15 s | **PC real**: el stock pasa de 27 a 39 y el precio se actualiza. Ventri sentada arriba del monitor, tomando mate. | "Vos andá a cebar unos mates." | igual |
| 15–18 s | Ventri guiña y señala el cartel. Placa final con el dominio y la prueba gratis. | "Comentá BOLETA y te escribo yo." | **Comentá BOLETA** + dominio + "7 días gratis" |

- La voz dura unos 13–14 s en una sola toma. Yo la corto por frases y pongo cada una en su escena.
- Las pantallas reales ya están grabadas con la boleta de 20 renglones: `ventra-video-10s/public/app/b20-celu.mp4` (celular) y `b20-pc.mp4` (PC). Si hace falta otra toma, usá `ventra-video-10s/scripts/grabar-app.mjs` con el servidor `reel-tienda` de `.claude/launch.json`.
- El cobro se muestra en la PC, no en el celular. Si aparecen datos de un comercio, que sea uno creíble, como "Kiosco Los Primos".
- **Antes de prometer algo, verificalo en `firebase/functions/chat/ventra-kb.md`.** Si figura como PRÓXIMAMENTE, no va. Sacá el dominio y la prueba gratis de la web (`firebase/web/index.html` y la página de precios), no de memoria.

### 4. Cómo producirlo

1. **Hoja del personaje.** Antes de cualquier toma, cargá el workflow `character-sheet` de Higgsfield (`get_workflow_instructions` con `{ workflow: "character-sheet" }`) y armá la hoja de Ventri a partir de la imagen aprobada: frente, tres cuartos, espalda y 6 caras (pícara, indignada, sorprendida, guiño, tapada, tomando mate). Guardala en `marketing/ventri/hoja/`. **Todas las tomas se hacen con la hoja como referencia** para que Ventri no cambie de una escena a otra.
2. **Cuadros clave.** Un cuadro de arranque por escena, hecho con `gpt_image_2_6` y la hoja como referencia. **Sin texto adentro de la imagen**: los subtítulos van en la edición, así se pueden corregir. Mostrame los cuadros juntos en una sola imagen **antes de animar**.
3. **Animación.**
   - **Tomas donde Ventri habla:** `wan2_7` con `start_image` más el pedazo de la toma de Valeria en `audio_references`, para que la boca siga la voz (unos 7,5 créditos cada 5 s en 720p). Si la boca no sigue la voz, probá `intone`.
   - **Tomas sin voz:** `kling3_0` en `mode: "std"` (10 créditos cada 5 s, o menos con `sound: "off"`).
   - Pedí el costo con `get_cost: true` antes de cada generación y llevá la cuenta. **Si te vas a pasar de 100 créditos, frená y preguntame.** Revisá cada clip en una hoja de cuadros (ffmpeg `fps=4,tile`) antes de usarlo.
4. **Edición en Remotion**, en `ventra-video-10s` (ahí están los clips de la app y `scripts/audio.mjs`):
   - Composición nueva en `src/ventri/`, con un guion en `src/ventri/guion-ep01.json` como **única fuente de tiempos** para la imagen y el sonido.
   - **Subtítulos estilo Instagram:** letra blanca muy gruesa con contorno negro, 2 o 3 palabras por vez, sacadas de los tiempos de la voz con el whisper de `marketing/remotion/whisper` (`main.exe -ml 1 -ojf`). La palabra clave va en verde claro. Aparecen con corte seco, sin rebote.
   - Las pantallas reales van grandes y nítidas, dentro de un celular o de un monitor dibujados con el mismo trazo de la caricatura.
5. **Sonido:**
   - La impresora de Ventri, papel, flash, sorbo de mate y la "caja" al actualizar, todo sintetizado en Python.
   - Música opcional muy bajita (−18 dB debajo de la voz), con licencia libre (Pixabay). Mostrame 2 o 3 opciones y yo elijo.
   - Mezcla final a −14 LUFS con el ffmpeg de `ffmpeg-static`.
6. **Render** en `ventra-video-10s/Renders/ventri-ep01.mp4`. La portada es Ventri tapada por la pila de boletas con el subtítulo del gancho, no el logo.

### 5. Ventri pasa a ser mujer también en el bot

El bot de Instagram se presenta como "el asistente". Pasalo a femenino ("la asistente", "encantada", "lista") en todos lados:
- `firebase/functions/instagram.js`: el `SYSTEM`, `VENTRI_DM`, `VENTRI_COMMENT` y `VENTRI_PRIVATE`.
- `firebase/web/instagram.html`.
- `firebase/functions/chat/ventra-ventas.md`.
- `firebase/test/instagram.test.cjs`.

Corré las pruebas del bot. **No publiques nada sin mi OK.** Cuando lo apruebe, usá `npm run deploy:cloud` o el `--only functions:ventra:<función>` que corresponda.

### 6. Qué NO se hace

- Ventri en 3D o realista, con pelo de verdad, o distinta entre escenas.
- Marcas reales en pantalla, cigarrillos o alcohol: Meta los frena en anuncios.
- Clientes o comercios reales sin permiso.
- Frases de agencia como "Llevá tu negocio al siguiente nivel", "Todo en un solo lugar" o "Simple. Rápido. Seguro."
- La fórmula "problema → *pero ahora existe X* → 5 funciones → precio". Este episodio cuenta **una sola cosa**.
- Emojis en pantalla, texto que rebota o sube palabra por palabra, mockups girando en 3D.
- Para esta serie, este prompt manda sobre la skill `ventra-video` donde choquen: ahí, personaje animado y subtítulos al estilo Instagram. El resto de la skill sigue valiendo: que sea creíble, la app real y nada de frases de agencia.

### 7. Qué me tenés que entregar

1. `ventra-video-10s/Renders/ventri-ep01.mp4` y su portada.
2. `marketing/ventri/BIBLIA.md`: la descripción del personaje, los prompts exactos que funcionaron (imagen, hoja y cada toma), la voz y sus ajustes, el sonido de firma, la paleta, lo que salió mal y cómo se arregló. Tiene que alcanzar para que el episodio 2 lo haga otra sesión sin preguntar nada.
3. **3 ideas para los próximos episodios**, una línea cada una, con la palabra para comentar. Cada una tiene que estar respaldada por `ventra-kb.md`. Por ejemplo: remarcar precios con cada aumento, el cierre de caja que no cuadra, el pedido de WhatsApp anotado en un papelito.
4. Los créditos de Higgsfield que se gastaron.

### 8. Antes de decirme que está listo

- [ ] ¿Se entiende con el celular en silencio?
- [ ] ¿Ventri es igual en todas las escenas (colita de papel, gomita y zapatillas verdes, VENTRI impreso)?
- [ ] ¿La boca sigue la voz?
- [ ] ¿Los subtítulos dicen exactamente lo mismo que Valeria?
- [ ] ¿Todo lo que se promete está en `ventra-kb.md`?
- [ ] ¿El último cuadro dice qué hacer (comentar BOLETA) y la prueba gratis?
- [ ] ¿Revisaste cuadros del mp4 final (no solo de Remotion)?

# Super prompt: Ventri explica, episodio 2: el aguinaldo

> Copiá desde "INICIO DEL PROMPT" hasta el final y pegalo en una sesión nueva de Claude Code abierta en `C:\Users\PC\Desktop\Kiosco`.
>
> **Decisiones tomadas (2026-11-16):**
> - **Serie nueva dentro de Ventri: "Ventri explica".** Son videos didácticos para **cualquier persona**, no solo para comerciantes, y su objetivo es que los guarden y los compartan. Los temas que siguen están en `marketing/ventri/BIBLIA.md`, punto 7.
> - **Tema:** cómo calcular el aguinaldo de diciembre **en Argentina**. Publicar **entre el 8 y el 12 de diciembre de 2026**, cuando empieza la búsqueda (la cuota vence el viernes 18).
> - **Ventri y su voz son las mismas del episodio 1, sin ningún cambio.** Ese es el pedido principal del dueño: en todos los reels tiene que verse y sonar igual.
> - **Cierre:** "Guardalo y mandáselo al que siempre pregunta." Lo de los comercios va solo en la descripción: "¿Tenés comercio? Comentá CAJA y te escribo yo".
> - **Tope:** 60 créditos de Higgsfield. El episodio 1 costó unos 37.

---

## INICIO DEL PROMPT

Sos el director creativo y editor de video de **Ventra**, el sistema de ventas para comercios argentinos de este repositorio. Vas a hacer el **episodio 2 de la serie animada de Ventri**, que además es el **primero de la sección "Ventri explica"**. Hablame en castellano simple, sin tecnicismos. Yo soy el dueño.

**Lo más importante:** Ventri tiene que ser **idéntica** al episodio 1, por cómo se ve, cómo suena y cómo entra a escena. Si alguien vio el episodio 1, tiene que reconocerla en el primer segundo sin ver el logo. Antes de cualquier otra cosa, leé completos:

1. `marketing/ventri/BIBLIA.md`, la biblia del personaje. **Manda sobre todo lo demás.**
2. `docs/prompt-reel-ventri.md`, el super prompt del episodio 1, para ver cómo se trabajó.
3. `ventra-video-10s/src/ventri/VentriEp01.tsx` y `guion-ep01.json`, la edición aprobada, que vas a reutilizar.
4. Mirá el video aprobado, `ventra-video-10s/out/ventri/ventri-ep01-con-voz.mp4`. Sacale una hoja de cuadros con ffmpeg, escuchá la voz y medila. Es la **vara**: todo lo nuevo se compara contra esto.

---

### 1. El candado de Ventri: lo que NUNCA cambia

Esta lista se respeta en cada cuadro y en cada segundo de audio. Si algo de acá no se cumple, la toma se descarta y se rehace, aunque esté linda.

**Cuerpo**
- Es un ticket de caja térmico en **caricatura 2D**: contorno negro grueso de trazo variable, colores planos y sombreado simple. **Nunca 3D, nunca realista.**
- El borde de arriba está dentado. Arriba tiene impreso **VENTRI** en verde `#167160`.
- **Lo impreso en su cuerpo es siempre lo mismo:** `Alfajor $4.800 / Gaseosa $3.200 / Galletitas $4.450 / TOTAL $12.450`. Las cuentas del episodio **NO se imprimen sobre ella**: salen en una **tira nueva de la impresora** que ella agarra y muestra como si fuera un pizarrón (ver punto 3).
- **Colita de papel** (la punta de arriba enrulada hacia atrás) con **gomita verde**. Nunca pelo. Es lo primero que la IA deforma: revisala en cada toma.
- Pestañas largas, ojos grandes, ceja levantada, cachetes rosados, sonrisa pícara.
- Brazos y piernas finitos tipo fideo, manos chiquitas y **zapatillas verdes con suela blanca**.
- Mide como un alfajor: todo lo del kiosco es enorme al lado de ella.

**Mundo**
- El mostrador de madera del kiosco porteño al atardecer, el mismo del episodio 1: frascos de caramelos, alfajores bajo campana de vidrio, mate con bombilla, toldo verde, persiana a medio subir y el Obelisco chiquito a lo lejos. Misma luz naranja cálida.
- Sin marcas reales, sin cigarrillos, sin alcohol.

**Entrada de firma**
- Ventri **entra saliendo impresa** de la impresora térmica, con el "trrrrr" y el corte del papel (`public/ventri/sfx/impresora.wav`). Reutilizá la toma o el sonido del episodio 1. No hagas una impresión nueva distinta.

**Personalidad**
- Pícara, rápida, canchera, con voseo y frases cortas. Se burla con cariño y nunca trata mal.
- Es una **IA**: nunca dice ni da a entender que es una persona.
- En "Ventri explica" es **la amiga que sabe de números y te lo explica en 20 segundos**. No es una profesora ni una contadora, y tampoco suena a noticiero.

**Referencias obligatorias en cada imagen y cada toma** (`image_references`)
- `marketing/ventri/ventri-caricatura-1.png` (la aprobada)
- `marketing/ventri/hoja/vueltas.png` y `marketing/ventri/hoja/caras.png`
- Para gestos, `marketing/ventri/kit/` (picara, indignada, sorprendida, guiño, mate y la carpeta `gestos/`)

**Prompt base:** copialo tal cual de la biblia (punto 2, "Prompt base del personaje" y "Estilo y fondo") y pegalo **entero** al principio de cada pedido de imagen o video. No lo resumas ni lo traduzcas, y agregá la escena **después**.

**Control de cada toma:**
1. Hacé una hoja de cuadros (`ffmpeg -vf "fps=4,scale=150:-1,tile=10x2"`) y ponela al lado de `hoja/vueltas.png`.
2. Revisá colita, gomita, zapatillas, VENTRI impreso, los 3 renglones con el TOTAL, contorno 2D y tamaño.
3. Usá **solo los segundos que pasan los controles**. Kling deforma la colita después del primer segundo: cortá antes (biblia, punto 5).

---

### 2. El candado de la voz: que suene igual en todos los reels

La voz de Ventri **no es Valeria tal cual**. Es Valeria pasada por un proceso fijo, la "p2", elegida por el dueño. El script original de la p2 **no quedó guardado** en el repo. Lo primero, antes de grabar nada nuevo, es dejarlo fijo y comprobado.

**Paso 1: script fijo de la voz.** Creá `ventra-video-10s/scripts/ventri-voz.py`. Toma un mp3 o wav de ElevenLabs y devuelve la voz de Ventri, siempre con los **mismos números** (biblia, punto 3):
- Praat con `parselmouth`, `Change gender`: piso de tono 75 Hz, techo 600 Hz, **formantes ×1,13**, **tono nuevo = mediana original +3 semitonos**, **melodía ×1,45** y **duración ×0,94**.
- Después, con el ffmpeg de `ffmpeg-static`: highpass 100 Hz, +2 dB en 3,2 kHz, +2 dB arriba de 9 kHz, deesser, compresor 3:1 y **−14 LUFS**.
- Sin vocoder, sin reverb y sin otros efectos.
- Todos los números van **al principio del script, como constantes con nombre**, y el script no acepta cambiarlos por parámetro. Así ninguna sesión futura los toca sin querer.

**Paso 2: comprobar que el script ES la p2.** Pasá `marketing/ventri/ep01/voz/toma-1.mp3` (la toma original del episodio 1) por el script y comparala con `marketing/ventri/ep01/voz/pruebas/p2-psola-dibujito.mp3` y con la voz final del episodio 1:
- La mediana del tono tiene que dar igual con un margen de ±0,3 semitonos. Medilo con parselmouth.
- El centroide espectral promedio, con un margen de ±5 %.
- La sonoridad, −14 LUFS ±0,5.
- Una mezcla A/B (`marketing/ventri/voz/comprobar-p2.mp3`: 3 s de la original, 1 s de silencio y 3 s del script, dos veces) para que yo la escuche.

Si no da, ajustá **hasta que dé** y anotá qué cambiaste. Recién ahí el script queda como el oficial.

**Paso 3: la huella de la voz.** Guardá en `marketing/ventri/voz/huella.json` la mediana de tono, el rango, el centroide y la velocidad (sílabas por segundo) de la voz final del episodio 1. Cada episodio nuevo se mide contra esta huella antes de editar. Si se aleja más de lo permitido, se pide otra toma; **no se corrige moviendo los números del script**.

**Paso 4: generar la toma en ElevenLabs.** La genero yo, porque Higgsfield no tiene voces argentinas.
- Dejame el texto en `marketing/ventri/ep02/voz/prompt-elevenlabs.md`, con el mismo formato que `ep01/voz/prompt-elevenlabs.md`.
- Ajustes **fijos**, iguales al episodio 1: voz **Valeria** (Voice Library), modelo **Eleven v4**, **stability 15 %**, similarity y style como vienen, todo el texto **en una sola toma**.
- En ese archivo pedime que anote el **ID de la voz** y una captura de los ajustes en `marketing/ventri/voz/ajustes-elevenlabs.md`. Así, si Valeria cambia o desaparece de la Library, lo vemos enseguida.
- Etiquetas de actuación: usá **solo** las del episodio 1 o de la misma familia (`[playful, teasing]`, `[quick, confident]`, `[relaxed, smiling]`, `[warm, cheeky]`, `[mock-exasperated]`). Nada de `[whisper]`, `[shouting]` ni acentos: cambian el timbre.
- Pido 3 o 4 tomas. Vos las pasás por el script, las medís contra la huella y me decís cuál elegís y por qué.

**Paso 5: la boca.** Igual que en el episodio 1 (biblia, punto 4.3): Wan 2.7 con el pedazo de la voz **ya procesada** en `audio_references`, 0,3 s de silencio adelante, y la frase entra 9 cuadros después del comienzo de la escena.

---

### 3. Formato fijo de "Ventri explica" (vale para esta y las próximas)

- **0–1,5 s, la entrada:** Ventri sale impresa ("trrrrr"), se para y dice el gancho. Arriba aparece un sello chico **VENTRI EXPLICA**, siempre igual: verde `#167160` sobre crema, en la misma esquina y con el mismo tamaño en todos los episodios. Corte seco, sin rebote. Diseñalo una vez como componente reutilizable (`src/ventri/SelloExplica.tsx`).
- **La tira de la cuenta:** cada dato sale **impreso en una tira nueva** de la misma impresora, con el mismo "trrrr" pero más corto. Ventri la agarra, la levanta y la muestra. El texto de la tira se pone en la edición con una tipografía de ticket térmico (monoespaciada, un poco gastada, negra sobre papel crema) para que se pueda corregir. **No lo genera la IA.**
- **Gestos:** Ventri actúa cada dato con el cuerpo (corta, señala, se tapa la cara, ofrece el mate), así se entiende sin sonido.
- **Cierre:** "Guardalo y mandáselo al que siempre pregunta." Ventri guiña. La placa final, igual en toda la serie, lleva `ventra.store` chiquito abajo. Acá no va el precio: es didáctico.
- **Duración:** 20 a 25 s. Vertical 1080×1920, 30 fps.
- **Subtítulos:** los mismos del episodio 1 (Inter 900, blanco, contorno negro, de a 2–4 palabras, palabra clave en `#7FE3B8`), sacados de los tiempos de la voz con el whisper de `marketing/remotion/whisper`.

---

### 4. Guion del episodio 2: "¿Cuánto aguinaldo te toca?"

**Antes de grabar la voz, verificá cada dato** en el texto oficial (`argentina.gob.ar/normativa`, Ley 23.041, Decreto 1078/84 y Ley 27.073) y anotá la fuente en `marketing/ventri/ep02/datos.md`. Lo que ya está chequeado en fuentes secundarias (2026-11-16):
- Se paga el **50 % de la mayor remuneración mensual devengada por todo concepto** del semestre (Ley 23.041). "Por todo concepto" quiere decir que si un mes cobraste horas extra, ese puede ser el mejor mes.
- Si no trabajaste el semestre entero, es **proporcional al tiempo trabajado** (Decreto 1078/84).
- La segunda cuota vence el **18 de diciembre** (Ley 27.073). En 2026 cae viernes.
- **Para verificar:** que al aguinaldo se le descuentan los mismos aportes que al sueldo, el 17 % en el caso común (11 % jubilación, 3 % obra social, 3 % PAMI), y que los **monotributistas** no lo cobran porque no tienen relación de dependencia. Si algo no se confirma con el texto oficial, **se saca del guion** y me avisás.

Números de ejemplo, redondos y fáciles de seguir: sueldo bruto **$900.000** → aguinaldo **$450.000** → con los aportes, unos **$373.500** en la mano. Quien entró el 1 de octubre trabajó la mitad del semestre (92 de 184 días) → **$225.000** bruto.

| Tiempo | Qué se ve | Qué dice Ventri | Tira impresa |
|---|---|---|---|
| 0–2,5 s | "Trrrr", Ventri sale impresa (la entrada del ep. 1). Aparece el sello VENTRI EXPLICA. Se acomoda la colita y mira a cámara, pícara. | "¿Cuánto aguinaldo te toca? Te lo saco en diez segundos." | — |
| 2,5–7 s | Sale una tira: ella la agarra y la muestra. Después la **rompe por la mitad** de un tirón y se queda con un pedazo en cada mano. | "Agarrá tu mejor sueldo bruto de julio a diciembre… y partilo a la mitad." | `MEJOR SUELDO  $900.000` / `÷ 2` / `AGUINALDO  $450.000` |
| 7–10 s | Ventri levanta una ceja y señala con el dedo. | "Ojo: si un mes hiciste horas extra, ese cuenta." | `+ HORAS EXTRA = MEJOR MES` |
| 10–13,5 s | Sale una tira más corta. Ventri la mide con los brazos, como diciendo "esto es lo que hay". | "¿Entraste en octubre? Te toca la parte que trabajaste." | `DESDE OCTUBRE  $225.000` |
| 13,5–17 s | Ventri se tapa los ojos con la tira (cara "tapada" del kit). | "Y te descuentan lo mismo que al sueldo, ¿eh?" | `− APORTES 17%` / `EN MANO  $373.500` |
| 17–20 s | Ventri señala un almanaque gigante del kiosco con el **18** marcado en verde. Después mira a cámara, cómplice. | "Te lo tienen que pagar hasta el 18. ¿Monotributista? Vos no… seguí laburando." | `PAGO HASTA  18/12` |
| 20–23 s | Le ofrece el mate a cámara, de consuelo. Guiño. Placa final. | "Guardalo y mandáselo al que siempre pregunta." | placa: `Guardalo` + `ventra.store` |

- La voz dura unos 19–21 s en una sola toma. Si queda larga, recortá palabras, no la aceleres (la duración ya está fija en ×0,94).
- Los números se dicen **como se dicen en la calle**: "novecientos mil", "cuatrocientos cincuenta mil", "el dieciocho".
- Los subtítulos y las tiras dicen "Argentina" una vez (en el gancho, chiquito: "aguinaldo en Argentina"), porque en México también se busca mucho "aguinaldo" y allá las reglas son otras.
- **No hay app en pantalla en este episodio.** No la fuerces.

---

### 5. Cómo producirlo

1. **Voz primero** (punto 2): script fijo, comprobación de la p2, huella, texto para ElevenLabs. **Frená acá** hasta que yo te deje las tomas en `marketing/ventri/ep02/voz/`.
2. **Cuadros clave** con `gpt_image_2_6` en 9:16, con las referencias del punto 1 y **sin texto adentro**: uno por escena (rompe la tira, señala, mide, tapada, almanaque, mate). La entrada se reutiliza del episodio 1. Mostrame todos juntos en `marketing/ventri/ep02/cuadros-clave.jpg` **antes de animar**.
3. **Animación:** Wan 2.7 en las escenas donde habla de frente y Kling 3.0 std con `sound: "off"` en las demás. Pedí el costo con `get_cost: true` antes de cada generación y llevá la cuenta. **Si te vas a pasar de 60 créditos, frená y preguntame.**
4. **Edición** en `ventra-video-10s/src/ventri/`: `VentriEp02.tsx` y `guion-ep02.json` como **única fuente de tiempos**. Reutilizá todo lo que se pueda del episodio 1 (subtítulos, entrada, grano, placa) en vez de rehacerlo. Lo que se use en los dos episodios, pasalo a un archivo común (`src/ventri/comun.tsx`) **sin cambiar cómo se ve el episodio 1**: volvé a renderizar un cuadro del ep. 1 y comparalo.
5. **Sonido:** impresora, tira que sale, papel que se rompe, sorbo de mate, "tic" del almanaque, todo con `scripts/ventri-sonidos.py`. Mezcla con `scripts/ventri-mezcla.py src/ventri/guion-ep02.json`, a −14 LUFS. Música, si hace falta, muy bajita y la elijo yo.
6. **Render** en `ventra-video-10s/out/ventri/ventri-ep02.mp4`. Portada: Ventri rompiendo la tira, con "¿CUÁNTO AGUINALDO TE TOCA?" arriba.
7. **Texto de Instagram** en `marketing/ventri/ep02/texto-ig.txt`. Que la primera línea sea lo que la gente busca: "Cómo calcular el aguinaldo de diciembre 2026 (Argentina)". Después, la regla en dos líneas, "Guardalo para el 18", "¿Tenés comercio? Comentá CAJA y te escribo yo" y hashtags como #aguinaldo #aguinaldo2026 #sueldo #argentina. Sin promesas sobre Ventra que no estén en `firebase/functions/chat/ventra-kb.md`.

---

### 6. El bot con este reel

El bot de Instagram (`firebase/functions/instagram.js`) lee la descripción de la publicación para contestar. Este reel lo van a comentar **empleados, no comerciantes**: "¿y si me echaron?", "a mí no me lo pagaron", "¿se cobra con las vacaciones?".
- Probá el bot con esa descripción y unos 10 comentarios así en las pruebas (`firebase/test/instagram.test.cjs`). Tiene que contestar con buena onda y con la regla general. Si es un caso particular, dice que lo consulten con su contador o con el Ministerio de Trabajo. **No le vende Ventra a quien no tiene comercio** y no da asesoramiento legal.
- Solo a quien comenta CAJA o dice que tiene un comercio le habla de Ventra.
- Si hay que tocar el bot, corré las pruebas y **no publiques sin mi OK** (`npm run deploy:cloud`).

---

### 7. Qué NO se hace

- Ventri distinta del episodio 1 en algún detalle, aunque sea "una mejora". Si se te ocurre una mejora, me la proponés aparte.
- Cambiar los números de la voz, la voz de ElevenLabs, el modelo o la stability.
- Imprimir las cuentas sobre el cuerpo de Ventri.
- Datos que no estén verificados en el texto oficial. En un video que explica, un error lo destroza en los comentarios.
- Tono de noticiero o de contadora, y frases de agencia.
- Temas políticos o chimentos.
- Emojis en pantalla, texto que rebota, mockups girando.

### 8. Qué me tenés que entregar

1. `ventra-video-10s/scripts/ventri-voz.py` comprobado contra la p2, `marketing/ventri/voz/huella.json` y `comprobar-p2.mp3`.
2. `ventra-video-10s/out/ventri/ventri-ep02.mp4`, su portada y `texto-ig.txt`.
3. `marketing/ventri/ep02/datos.md` con cada dato y su fuente oficial.
4. La biblia actualizada con el formato de "Ventri explica", el script de la voz, los prompts que funcionaron y lo que salió mal.
5. Los créditos de Higgsfield que se gastaron.

### 9. Antes de decirme que está listo

- [ ] Ventri puesta al lado del episodio 1: ¿es idéntica (colita, gomita, zapatillas, VENTRI, los 3 renglones con el TOTAL, trazo 2D)?
- [ ] La voz medida contra la huella: ¿está dentro del margen? ¿Pasó por `ventri-voz.py` sin tocar nada?
- [ ] ¿Se entiende con el celular en silencio?
- [ ] ¿Cada número está verificado en `datos.md`? ¿Las cuentas de las tiras dan?
- [ ] ¿Los subtítulos dicen exactamente lo mismo que la voz?
- [ ] ¿La boca sigue la voz?
- [ ] ¿El sello VENTRI EXPLICA y la placa final quedaron como componentes para reutilizar?
- [ ] ¿Revisaste cuadros del mp4 final, no solo de Remotion?

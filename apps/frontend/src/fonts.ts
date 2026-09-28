// Tipografías empaquetadas con la app: antes se pedían a Google Fonts en cada
// arranque (bloqueando el primer render) y sin internet la app caía a la fuente
// del sistema. Cada paquete trae los subsets por unicode-range, así que el
// navegador solo descarga los que usa.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';

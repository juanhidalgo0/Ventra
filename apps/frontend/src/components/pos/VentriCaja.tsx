import { useEffect, useRef, useState } from 'react';
import { VentriImg, esNavidad, useVentri, type VentriCara } from '../common/Ventri';

/**
 * Ventri en la caja, en los momentos quietos (ver components/common/Ventri y la biblia del personaje):
 *
 * - VentriEnReposo: con el carrito vacío y la caja sin tocar 3 minutos, se asoma desde abajo del
 *   carrito y hace un gesto animado, distinto cada vez (se sortean sin repetir hasta usarlos todos).
 *   Se queda 15 s o hasta que se carga un producto. Como mucho una vez cada 25 minutos en cada caja.
 *   "Mira el reloj" solo sale cuando el turno lleva 3 horas o más abierto, y dice cuántas van.
 * - VentriFestejos: abajo a la izquierda, nunca durante el cobro.
 *   · Al abrir la primera caja del día (en esta PC): saludo animado ("¡Buenos días!" según la hora).
 *   · En cada apertura de caja: la primera venta y las ventas 50, 100, 150, 200, 300 y 500.
 *
 * Los gestos son clips de Kling pasados a WebP con transparencia (public/ventri/gesto-*.webp,
 * ventra-video-10s/scripts/ventri-gesto.py). En las fiestas (navidad.js) va la cara fija con
 * gorrito, que sí puede llevarlo, y hay saludos propios. Todo respeta el interruptor
 * "Mostrar a Ventri en la caja". Para probar sin esperar, en la consola:
 *   ventraVentri.muestra()  ·  ventraVentri.reposo('mate')  ·  ventraVentri.festejo(100)  ·  ventraVentri.buenDia()
 */

const QUIETA_MS = 3 * 60_000;          // caja sin tocar
const CADA_MS = 25 * 60_000;           // entre una aparición y la siguiente
const DURA_MS = 15_000;                // cuánto se queda (si el carrito sigue vacío)
const FESTEJO_MS = 6000;               // cuánto dura un festejo
const SALUDO_MS = 7000;                // cuánto dura el saludo de la primera caja del día
const RELOJ_DESDE_H = 3;               // "mira el reloj" desde estas horas de turno
const LS_ULTIMA = 'ventri_reposo_ultima';
const LS_BOLSA = 'ventri_reposo_bolsa';
const LS_ULTIMA_ACCION = 'ventri_reposo_accion';
const LS_VENTAS = 'ventri_ventas_dia';
const LS_BUEN_DIA = 'ventri_buen_dia';
const EV_REPOSO = 'ventri:reposo';
const EV_VENTA = 'ventri:venta';
const EV_FESTEJO = 'ventri:festejo';
const EV_SALUDO = 'ventri:saludo';
const HITOS = [50, 100, 150, 200, 300, 500];

type IdAccion = 'mate' | 'saluda' | 'estira' | 'tickets' | 'reloj';
/** gesto: el clip animado; cara + anim: lo que se usa en las fiestas (con gorrito) */
type Accion = { id: IdAccion | 'fiestas'; gesto: string; cara: VentriCara; anim: string; texto: string };

const ACCIONES: Record<IdAccion, (horasTurno: number) => Accion> = {
  mate: () => ({ id: 'mate', gesto: 'gesto-mate', cara: 'mate', anim: 'ventri-a-mate', texto: 'Un matecito mientras no hay nadie 🧉' }),
  saluda: () => ({ id: 'saluda', gesto: 'gesto-saluda', cara: 'picara', anim: 'ventri-a-saluda', texto: '¿Todo tranqui? Acá estoy si me necesitás.' }),
  estira: () => ({ id: 'estira', gesto: 'gesto-estira', cara: 'picara', anim: 'ventri-a-estira', texto: 'Ahhh… a estirar un poco el papel.' }),
  tickets: () => ({ id: 'tickets', gesto: 'gesto-tickets', cara: 'pila', anim: 'ventri-a-tiembla', texto: 'Acomodo los tickets, ya vuelvo…' }),
  reloj: (h) => ({ id: 'reloj', gesto: 'gesto-reloj', cara: 'sorprendida', anim: 'ventri-a-mira', texto: `¡Ya van ${h} ${h === 1 ? 'hora' : 'horas'} de turno! 👀` }),
};

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsNum = (k: string) => Number(lsGet(k)) || 0;
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin espacio */ } };

/** Horas enteras que lleva abierto el turno */
const horasDeTurno = (inicio?: string | null) => (inicio ? Math.max(0, Math.floor((Date.now() - new Date(inicio).getTime()) / 3_600_000)) : 0);

/**
 * La próxima animación: se sacan de una "bolsa" sin repetir hasta usarlas todas, y al rellenarla
 * nunca toca la misma que la última. El reloj solo entra si el turno ya lleva RELOJ_DESDE_H horas.
 */
function proximaAccion(horasTurno: number, forzada?: IdAccion): Accion {
  if (forzada) return ACCIONES[forzada](Math.max(horasTurno, RELOJ_DESDE_H));
  if (esNavidad()) {
    const d = new Date(), m = d.getMonth(), dia = d.getDate();
    if (m === 11 && (dia === 24 || dia === 25)) return { id: 'fiestas', gesto: '', cara: 'guino', anim: 'ventri-a-saluda', texto: '¡Feliz Navidad! 🎄 Que se venda todo hoy.' };
    if ((m === 11 && dia === 31) || (m === 0 && dia === 1)) return { id: 'fiestas', gesto: '', cara: 'guino', anim: 'ventri-a-salta', texto: '¡Feliz año nuevo! 🥂 Gracias por vender conmigo.' };
  }
  const disponibles: IdAccion[] = ['mate', 'saluda', 'estira', 'tickets'];
  if (horasTurno >= RELOJ_DESDE_H) disponibles.push('reloj');
  let bolsa: IdAccion[] = [];
  try { bolsa = JSON.parse(lsGet(LS_BOLSA) || '[]'); } catch { /* bolsa nueva */ }
  bolsa = bolsa.filter((id) => disponibles.includes(id));
  if (!bolsa.length) {
    const ultima = lsGet(LS_ULTIMA_ACCION);
    bolsa = disponibles.filter((id) => id !== ultima);
  }
  const id = bolsa[Math.floor(Math.random() * bolsa.length)];
  lsSet(LS_BOLSA, JSON.stringify(bolsa.filter((x) => x !== id)));
  lsSet(LS_ULTIMA_ACCION, id);
  const a = ACCIONES[id](horasTurno);
  // En las fiestas: la cara fija con gorrito y un texto de fiestas para el saludo
  if (esNavidad() && id === 'saluda') return { ...a, texto: '¡Felices fiestas! 🎄 Acá estoy si me necesitás.' };
  if (esNavidad() && id === 'mate') return { ...a, texto: 'Un matecito con gorrito, que hace calor 🧉' };
  return a;
}

/** El gesto animado o, en las fiestas (o si el clip no carga), la cara fija con su movimiento y gorrito */
function VentriGesto({ accion, alto }: { accion: { gesto: string; cara: VentriCara; anim: string }; alto: number }) {
  const [fallo, setFallo] = useState(false);
  if (!accion.gesto || esNavidad() || fallo) {
    return (
      <div className={`keep-animated ${accion.anim}`} style={{ transformOrigin: '50% 100%' }}>
        <VentriImg cara={accion.cara} size={Math.round(alto * 0.88)} />
      </div>
    );
  }
  return (
    <img src={`/ventri/${accion.gesto}.webp`} alt="" aria-hidden draggable={false} onError={() => setFallo(true)}
      className="select-none" style={{ height: alto, width: 'auto' }} />
  );
}

/** Lo llama la caja cuando termina un cobro (cuenta las ventas de esta apertura de caja) */
export function ventriVentaHecha() {
  window.dispatchEvent(new Event(EV_VENTA));
}

/** Lo llama la caja al abrirse: si es la primera apertura del día en esta PC, Ventri saluda */
export function ventriCajaAbierta() {
  const hoy = new Date().toDateString();
  if (lsGet(LS_BUEN_DIA) === hoy) return;
  lsSet(LS_BUEN_DIA, hoy);
  window.dispatchEvent(new Event(EV_SALUDO));
}

if (typeof window !== 'undefined') {
  const reposo = (id?: IdAccion) => window.dispatchEvent(new CustomEvent(EV_REPOSO, { detail: id }));
  const festejo = (n = 1) => window.dispatchEvent(new CustomEvent(EV_FESTEJO, { detail: n }));
  const buenDia = () => window.dispatchEvent(new Event(EV_SALUDO));
  (window as any).ventraVentri = {
    reposo, festejo, buenDia,
    /** Muestra todas las animaciones seguidas (con el carrito vacío y la caja abierta) */
    muestra: () => {
      const pasos: [string, () => void][] = [
        ['Saludo de la primera caja del día', buenDia],
        ['Reposo: mate', () => reposo('mate')],
        ['Reposo: saluda', () => reposo('saluda')],
        ['Reposo: se estira', () => reposo('estira')],
        ['Reposo: acomoda los tickets', () => reposo('tickets')],
        ['Reposo: mira el reloj (turno de 3 h o más)', () => reposo('reloj')],
        ['Festejo: primera venta de la caja', () => festejo(1)],
        ['Festejo: venta 100', () => festejo(100)],
      ];
      pasos.forEach(([nombre, fn], i) => setTimeout(() => { console.info(`[Ventri] ${i + 1}/${pasos.length} ${nombre}`); fn(); }, i * 8000));
      return `${pasos.length} animaciones, una cada 8 s (${pasos.length * 8} s en total)`;
    },
  };
}

/** Se asoma desde el borde de abajo del carrito vacío. Va adentro del cartel de "Carrito vacío" (relative). */
export function VentriEnReposo({ libre, inicioTurno }: { libre: boolean; inicioTurno?: string | null }) {
  const on = useVentri();
  const [accion, setAccion] = useState<Accion | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const ultimaActividad = useRef(Date.now());
  const libreRef = useRef(libre);
  libreRef.current = libre;
  const inicioRef = useRef(inicioTurno);
  inicioRef.current = inicioTurno;

  // Cualquier tecla, toque o rueda del mouse cuenta como actividad (para saber cuándo la caja está
  // quieta). No la hace irse: no tapa nada y así se llega a ver. Se va cuando se carga un producto
  // (el carrito deja de estar vacío y se desmonta) o a los 15 segundos.
  useEffect(() => {
    const activo = () => { ultimaActividad.current = Date.now(); };
    const evs = ['keydown', 'pointerdown', 'wheel'] as const;
    evs.forEach((e) => window.addEventListener(e, activo, true));
    return () => evs.forEach((e) => window.removeEventListener(e, activo, true));
  }, []);

  const mostrar = (forzada?: IdAccion | null, forzado = false) => {
    if (!forzado && (!libreRef.current || document.hidden)) return;
    lsSet(LS_ULTIMA, String(Date.now()));
    setSaliendo(false);
    setAccion(proximaAccion(horasDeTurno(inicioRef.current), forzada || undefined));
  };

  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      const ahora = Date.now();
      if (ahora - ultimaActividad.current < QUIETA_MS) return;
      if (ahora - lsNum(LS_ULTIMA) < CADA_MS) return;
      mostrar();
    }, 15_000);
    const forzar = (e: Event) => mostrar((e as CustomEvent).detail, true);
    window.addEventListener(EV_REPOSO, forzar);
    return () => { clearInterval(t); window.removeEventListener(EV_REPOSO, forzar); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  // Se va sola
  useEffect(() => {
    if (!accion || saliendo) return;
    const t = setTimeout(() => setSaliendo(true), DURA_MS);
    return () => clearTimeout(t);
  }, [accion, saliendo]);
  useEffect(() => {
    if (!saliendo) return;
    const t = setTimeout(() => { setAccion(null); setSaliendo(false); }, 400);
    return () => clearTimeout(t);
  }, [saliendo]);

  if (!on || !accion || !libre) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 h-[160px] overflow-hidden pointer-events-none flex justify-center" aria-hidden>
      <div key={accion.texto} className={`flex items-end gap-2 ${saliendo ? 'ventri-baja' : 'ventri-sube'}`}>
        <VentriGesto accion={accion} alto={130} />
        <p className="ventri-globo mb-16 max-w-[170px] rounded-2xl rounded-bl-md bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/60 shadow-sm px-3 py-2 text-[12px] font-semibold leading-snug text-emerald-900 dark:text-emerald-100 text-left">
          {accion.texto}
        </p>
      </div>
    </div>
  );
}

type Festejo = { clave: string; texto: string; gesto: string; cara: VentriCara; anim: string; dura: number };

const saludoDeLaHora = () => {
  const h = new Date().getHours();
  const base = h >= 5 && h < 13 ? '¡Buenos días!' : h >= 13 && h < 20 ? '¡Buenas tardes!' : '¡Buenas noches!';
  return esNavidad() ? `${base} Felices fiestas 🎄 ¡A vender!` : `${base} ¡A vender! 💪`;
};

/** Saludo de la primera caja del día y festejos de ventas, abajo a la izquierda. Montar una vez en la caja. */
export function VentriFestejos({ practica, sesion }: { practica: boolean; sesion?: string | null }) {
  const on = useVentri();
  const [f, setF] = useState<Festejo | null>(null);
  const practicaRef = useRef(practica);
  practicaRef.current = practica;
  const sesionRef = useRef(sesion);
  sesionRef.current = sesion;

  useEffect(() => {
    const armar = (n: number): Festejo => {
      const fiestas = esNavidad();
      const base = { gesto: 'gesto-festejo', cara: 'guino' as VentriCara, anim: 'ventri-a-salta', dura: FESTEJO_MS, clave: `v${n}-${Date.now()}` };
      if (n === 1) return { ...base, texto: fiestas ? '¡Primera venta de la caja! 🎄 Arrancamos.' : '¡Primera venta de la caja! Arrancamos 💪' };
      return { ...base, texto: `¡Venta número ${n} de esta caja! ${fiestas ? '🎄' : '🔥'}` };
    };
    const onVenta = () => {
      // Se cuenta por apertura de caja (cada turno abierto empieza de cero), no por día
      if (practicaRef.current || !sesionRef.current) return;
      const sesion = sesionRef.current;
      let n = 0;
      try {
        const g = JSON.parse(lsGet(LS_VENTAS) || '{}');
        n = g.sesion === sesion ? Number(g.n) || 0 : 0;
      } catch { /* empieza de cero */ }
      n += 1;
      lsSet(LS_VENTAS, JSON.stringify({ sesion, n }));
      if (n === 1 || HITOS.includes(n)) setF(armar(n));
    };
    const onForzado = (e: Event) => setF(armar(Number((e as CustomEvent).detail) || 1));
    const onSaludo = () => setF({ clave: `s-${Date.now()}`, texto: saludoDeLaHora(), gesto: 'gesto-saluda', cara: 'picara', anim: 'ventri-a-saluda', dura: SALUDO_MS });
    window.addEventListener(EV_VENTA, onVenta);
    window.addEventListener(EV_FESTEJO, onForzado);
    window.addEventListener(EV_SALUDO, onSaludo);
    return () => {
      window.removeEventListener(EV_VENTA, onVenta);
      window.removeEventListener(EV_FESTEJO, onForzado);
      window.removeEventListener(EV_SALUDO, onSaludo);
    };
  }, []);

  useEffect(() => {
    if (!f) return;
    const t = setTimeout(() => setF(null), f.dura);
    return () => clearTimeout(t);
  }, [f]);

  if (!on || !f) return null;
  return (
    <div key={f.clave} className="fixed left-5 bottom-5 z-40 pointer-events-none flex items-end gap-2 ventri-festejo" style={{ animationDuration: `${f.dura}ms` }} aria-live="polite">
      <VentriGesto accion={f} alto={120} />
      <p className="mb-10 rounded-2xl rounded-bl-md bg-emerald-700 text-white shadow-lg px-3.5 py-2 text-[13.5px] font-bold leading-snug">
        {f.texto}
      </p>
    </div>
  );
}

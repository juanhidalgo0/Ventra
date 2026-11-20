/*
 * Ventri · Hora pico: el minijuego secreto de Ventri.
 *
 * Ventri está parada en el mostrador del kiosco y del toldo cae de todo. Hay que atajar los
 * productos (cada uno suma su precio al ticket) y esquivar el billete trucho (te saca una vida),
 * la libreta del fiado (te saca plata) y el corte de luz (quedás a oscuras). Ayudan el mate (todo
 * más lento), el cobro con QR (imán) y la medialuna (una vida más). Si un producto toca el
 * mostrador, se pierde una vida. Cada 15 s pasa una hora del día (de 08:00 en adelante) y se pone
 * más difícil; a las 13 y a las 20 hay hora pico, donde todo vale el doble.
 * Récord, misiones y rango quedan guardados en esa PC (localStorage "ventri_hora_pico").
 *
 * Hecho para andar en cualquier PC: un solo archivo sin dependencias, canvas 2D con los dibujos
 * armados una sola vez (nada de sombras ni filtros en cada cuadro), sonidos hechos con WebAudio
 * (sin archivos) y modo liviano automático si la PC no llega a unos 35 cuadros por segundo.
 *
 * Dónde se abre (es secreto):
 *   - Caja: escribirle "jugar" a Ventri en la Ayuda (components/common/Ventri.tsx, abrirJuegoVentri),
 *     el atajo ↑ ↑ ↓ ↓ ← → ← → B A (components/pos/VentriCaja.tsx)
 *     o ventraVentri.juego() en la consola. Mientras está abierto se traga todas las teclas, así no
 *     se dispara nada de la caja; si pasan un código con el lector, se cierra solo (y ese código
 *     no entra a medias en la venta: hay que volver a pasarlo).
 *   - Web: escribirle "jugar" en el chat, tocar 5 veces a Ventri o entrar con #jugar (ventri.js).
 *
 * Uso: ventriJuego.abrir({ contexto: 'caja' | 'web', alCerrar: function (motivo) {} })
 *      devuelve false si ya estaba abierto. motivo: 'salir' o 'cliente' (pasaron un código).
 *
 * Este archivo está repetido igual en apps/frontend/public/ventri/juego.js y en
 * firebase/web/ventri/juego.js: si se cambia uno, copiar al otro.
 */
(function () {
  'use strict';
  if (window.ventriJuego) return;

  // Las caras de Ventri están en la misma carpeta que este archivo
  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^\/]*$/, '') : 'ventri/';
  })();

  // ---------------------------------------------------------------- medidas
  // Todo se dibuja en unidades "lógicas": el alto siempre es 600 y el ancho sale de la pantalla.
  var H = 600;
  var PISO = 508;              // la tapa del mostrador, donde pisa Ventri
  var TOLDO = 70;              // alto del toldo: lo que cae sale de abajo
  var VH = 112;                // alto de Ventri
  var TECHO = PISO - VH + 22;  // altura a la que ataja
  var ATAJA = 44;              // medio ancho de la parte de Ventri que ataja
  var R = 24;                  // radio de lo que cae
  var VMAX = 660;              // velocidad de Ventri con el teclado
  var NIVEL_SEG = 15;          // cada cuánto pasa una hora
  var HORA0 = 8;               // el kiosco abre a las 8
  var LUZ_SEG = 5;             // cuánto dura el corte de luz
  var W = 960;                 // ancho lógico (lo calcula medir())
  var PX = 1;                  // pixeles reales por unidad lógica

  var OUT = '#1d1915', VERDE = '#167160', CREMA = '#F7F3EC', VCLARO = '#7FE3B8', OSCURO = '#0F1F1A';
  var FUENTE = 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
  var MONO = 'Consolas, "Courier New", monospace';
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var tactil = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function azar(l) { return l[Math.floor(Math.random() * l.length)]; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hora(h) { return pad(((h % 24) + 24) % 24) + ':00'; }
  function plata(n) {
    n = Math.round(n);
    return (n < 0 ? '−$' : '$') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; });
  }
  // Azar repetible (para que la ciudad del fondo sea siempre la misma)
  function semilla(s) { return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

  // ---------------------------------------------------------------- lo que cae
  var TIPOS = {
    alfajor: { c: 'prod', nombre: 'Alfajor', precio: 4800, peso: 24, migas: ['#6b3d22', '#d9a05b'] },
    gaseosa: { c: 'prod', nombre: 'Gaseosa', precio: 3200, peso: 20, migas: ['#f08a24', '#ffd9a8'] },
    galletitas: { c: 'prod', nombre: 'Galletitas', precio: 4450, peso: 18, migas: ['#2f6fd1', '#d9a05b'] },
    chupetin: { c: 'prod', nombre: 'Chupetín', precio: 600, peso: 19, migas: ['#ff5d8f', '#ffffff'] },
    caramelo: { c: 'prod', nombre: 'Caramelo', precio: 300, peso: 19, migas: ['#ffcf33', '#ff7a3d'] },
    dorado: { c: 'prod', nombre: 'Alfajor dorado', precio: 20000, peso: 0, migas: ['#ffd23f', '#fff3b0'] },
    trucho: { c: 'malo', nombre: 'Billete trucho', migas: ['#a7d39b', '#d62839'] },
    fiado: { c: 'malo', nombre: 'Libreta del fiado', migas: ['#f1e7cf', '#e06c6c'] },
    rayo: { c: 'malo', nombre: 'Corte de luz', migas: ['#ffd400', '#2b2346'] },
    mate: { c: 'ayuda', nombre: 'Matecito', migas: ['#8a5a33', '#5e9a3c'] },
    qr: { c: 'ayuda', nombre: 'Cobro con QR', migas: ['#ffffff', '#1e88e5'] },
    medialuna: { c: 'ayuda', nombre: 'Medialuna', migas: ['#e9a646', '#fff0c8'] },
  };
  var PRODUCTOS = ['alfajor', 'gaseosa', 'galletitas', 'chupetin', 'caramelo', 'dorado'];

  // ---------------------------------------------------------------- misiones y rangos
  var MISIONES = {
    alfajores: { metas: [10, 25, 50], txt: function (n) { return 'Atajá ' + n + ' alfajores'; }, val: function (s) { return s.alfajor; } },
    combo: { metas: [15, 40, 80], txt: function (n) { return 'Hacé un combo de ' + n; }, val: function (s) { return s.comboMax; } },
    total: { metas: [60000, 200000, 500000], txt: function (n) { return 'Vendé ' + plata(n) + ' en una partida'; }, val: function (s) { return s.total; } },
    hora: { metas: [12, 16, 20, 23], tope: true, txt: function (n) { return 'Llegá a las ' + hora(n); }, val: function (s) { return s.horaMax; } },
    truchos: { metas: [5, 15, 30], txt: function (n) { return 'Esquivá ' + n + ' billetes truchos'; }, val: function (s) { return s.truchosEsq; } },
    mates: { metas: [2, 4, 7], txt: function (n) { return 'Tomate ' + n + ' matecitos'; }, val: function (s) { return s.mates; } },
    dorados: { metas: [1, 2, 4], txt: function (n) { return n === 1 ? 'Atajá un alfajor dorado' : 'Atajá ' + n + ' alfajores dorados'; }, val: function (s) { return s.dorados; } },
    golosinas: { metas: [20, 45, 90], txt: function (n) { return 'Atajá ' + n + ' caramelos o chupetines'; }, val: function (s) { return s.golosinas; } },
  };
  function metaDe(m) {
    var d = MISIONES[m.id], ms = d.metas;
    if (m.tier < ms.length) return ms[m.tier];
    if (d.tope) return ms[ms.length - 1];
    return Math.round(ms[ms.length - 1] * (1 + 0.5 * (m.tier - ms.length + 1)));
  }
  var RANGOS = [
    [0, 'Aprendiz de mostrador'], [3, 'Caja veloz'], [8, 'Manos rápidas'], [15, 'Terror de los truchos'],
    [25, 'Leyenda del turno tarde'], [40, 'Patrimonio del barrio'], [60, 'Leyenda del mostrador'],
  ];
  function rango(e) { var r = 0; for (var i = 0; i < RANGOS.length; i++) if (e >= RANGOS[i][0]) r = i; return r; }

  // ---------------------------------------------------------------- lo guardado
  var LS = 'ventri_hora_pico';
  var datos = {};
  function leerDatos() {
    try { datos = JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { datos = {}; }
    if (!datos || typeof datos !== 'object') datos = {};
    datos.record = +datos.record || 0;
    datos.mejorHora = +datos.mejorHora || HORA0;
    datos.estrellas = +datos.estrellas || 0;
    datos.partidas = +datos.partidas || 0;
    datos.mudo = !!datos.mudo;
    if (!datos.tiers || typeof datos.tiers !== 'object') datos.tiers = {};
    var ok = Array.isArray(datos.misiones) && datos.misiones.length === 3 &&
      datos.misiones.every(function (m) { return m && MISIONES[m.id] && m.tier >= 0; });
    // Las primeras enseñan a jugar: atajar, aguantar y esquivar
    if (!ok) datos.misiones = [{ id: 'alfajores', tier: 0 }, { id: 'hora', tier: 0 }, { id: 'truchos', tier: 0 }];
  }
  function guardar() { try { localStorage.setItem(LS, JSON.stringify(datos)); } catch (e) { /* sin lugar: se juega igual */ } }

  // ---------------------------------------------------------------- dibujos (una vez)
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function base(c) { c.strokeStyle = OUT; c.lineWidth = 3; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.globalAlpha = 1; }

  function alfajor(c, abajo, dulce, arriba, brillo) {
    c.fillStyle = abajo; c.beginPath(); c.ellipse(0, 8, 22, 10, 0, 0, 7); c.fill(); c.stroke();
    c.fillStyle = dulce; c.fillRect(-21, -2, 42, 9);
    c.beginPath(); c.moveTo(-21.5, -2); c.lineTo(-21.5, 7); c.moveTo(21.5, -2); c.lineTo(21.5, 7); c.stroke();
    c.fillStyle = arriba; c.beginPath(); c.ellipse(0, -4, 22, 11, 0, 0, 7); c.fill(); c.stroke();
    c.strokeStyle = brillo; c.lineWidth = 2.5; c.beginPath(); c.ellipse(-3, -6, 12, 5, 0, Math.PI * 1.05, Math.PI * 1.6); c.stroke();
    base(c);
  }

  var DIB = {
    alfajor: function (c) { alfajor(c, '#5b3420', '#d9a05b', '#7b4728', '#c08a66'); },
    dorado: function (c) {
      alfajor(c, '#c98d12', '#fff0b3', '#f2c230', '#fffbe6');
      c.strokeStyle = '#fff6c2'; c.lineWidth = 2.5;
      [[-20, -20], [22, -16], [16, 20]].forEach(function (p) {
        c.beginPath(); c.moveTo(p[0] - 5, p[1]); c.lineTo(p[0] + 5, p[1]); c.moveTo(p[0], p[1] - 5); c.lineTo(p[0], p[1] + 5); c.stroke();
      });
      base(c);
    },
    gaseosa: function (c) {
      c.fillStyle = '#f08a24'; c.beginPath();
      c.moveTo(-5, -20); c.lineTo(5, -20); c.lineTo(5, -14); c.quadraticCurveTo(13, -8, 13, 2); c.lineTo(13, 21);
      c.quadraticCurveTo(13, 26, 8, 26); c.lineTo(-8, 26); c.quadraticCurveTo(-13, 26, -13, 21); c.lineTo(-13, 2);
      c.quadraticCurveTo(-13, -8, -5, -14); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = CREMA; c.fillRect(-12, 4, 24, 11);
      c.beginPath(); c.moveTo(-13, 4); c.lineTo(13, 4); c.moveTo(-13, 15); c.lineTo(13, 15); c.stroke();
      c.strokeStyle = VERDE; c.lineWidth = 2; c.beginPath(); c.moveTo(-8, 10); c.quadraticCurveTo(-4, 6, 0, 10); c.quadraticCurveTo(4, 14, 8, 10); c.stroke();
      base(c);
      c.fillStyle = VERDE; rr(c, -7, -27, 14, 8, 2); c.fill(); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 3; c.beginPath(); c.moveTo(-8, -3); c.lineTo(-8, 1); c.moveTo(-8, 18); c.lineTo(-8, 22); c.stroke();
      base(c);
    },
    galletitas: function (c) {
      c.rotate(-0.12);
      c.fillStyle = '#2f6fd1'; rr(c, -21, -16, 42, 32, 5); c.fill();
      c.fillStyle = '#ffd23f'; c.fillRect(-21, -9, 42, 6);
      c.fillStyle = '#d9a05b';
      [[-9, 7], [8, 7]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 7.5, 0, 7); c.fill(); c.lineWidth = 2; c.stroke(); });
      c.fillStyle = '#6b3d22';
      [[-11, 5], [-7, 9], [-9, 4], [6, 5], [10, 8], [8, 10]].forEach(function (p) { c.fillRect(p[0] - 1, p[1] - 1, 2, 2); });
      base(c); rr(c, -21, -16, 42, 32, 5); c.stroke();
    },
    chupetin: function (c) {
      c.fillStyle = '#ffffff'; rr(c, -2.5, 4, 5, 24, 2); c.fill(); c.stroke();
      c.fillStyle = '#ff5d8f'; c.beginPath(); c.arc(0, -7, 16, 0, 7); c.fill(); c.stroke();
      c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.beginPath();
      for (var a = 0.4; a < 11.5; a += 0.25) {
        var rad = a * 1.18, px = Math.cos(a) * rad, py = -7 + Math.sin(a) * rad;
        if (a === 0.4) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke(); base(c);
      c.beginPath(); c.arc(0, -7, 16, 0, 7); c.stroke();
    },
    caramelo: function (c) {
      c.fillStyle = '#ffcf33';
      c.beginPath(); c.moveTo(-11, 0); c.lineTo(-24, -10); c.lineTo(-21, 0); c.lineTo(-24, 10); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(11, 0); c.lineTo(24, -10); c.lineTo(21, 0); c.lineTo(24, 10); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#ff7a3d'; c.beginPath(); c.ellipse(0, 0, 14, 11, 0, 0, 7); c.fill(); c.stroke();
      c.strokeStyle = '#ffe9a8'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(-6, -8); c.lineTo(-1, 8); c.moveTo(2, -9); c.lineTo(7, 7); c.stroke();
      base(c);
    },
    trucho: function (c) {
      c.rotate(0.08);
      c.fillStyle = '#a7d39b'; rr(c, -27, -15, 54, 30, 3); c.fill(); c.stroke();
      c.strokeStyle = '#5c8f55'; c.lineWidth = 1.5; rr(c, -23, -11, 46, 22, 2); c.stroke();
      c.fillStyle = '#d9ecd2'; c.beginPath(); c.ellipse(-12, 0, 7, 8, 0, 0, 7); c.fill(); c.stroke();
      c.strokeStyle = OUT; c.lineWidth = 2; c.beginPath(); c.moveTo(-17, 3); c.quadraticCurveTo(-12, -0.5, -7, 3); c.stroke();
      c.fillStyle = '#3f6b39'; c.font = '900 12px ' + FUENTE; c.fillText('$', 9, 5);
      c.rotate(-0.36);
      c.strokeStyle = '#d62839'; c.lineWidth = 2.5; rr(c, -20, -8.5, 40, 17, 3); c.stroke();
      c.fillStyle = '#d62839'; c.font = '900 11.5px ' + FUENTE; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('FALSO', 0, 1);
      base(c);
    },
    fiado: function (c) {
      c.rotate(-0.08);
      c.fillStyle = '#f1e7cf'; rr(c, -17, -21, 34, 43, 3); c.fill(); c.stroke();
      c.strokeStyle = '#e06c6c'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-9, -18); c.lineTo(-9, 20); c.stroke();
      c.strokeStyle = '#9fb3c8'; c.lineWidth = 1.2;
      for (var y = -2; y <= 17; y += 5) { c.beginPath(); c.moveTo(-14, y); c.lineTo(14, y); c.stroke(); }
      c.strokeStyle = '#4a5560'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(-6, 1); c.lineTo(8, 1); c.moveTo(-6, 6); c.lineTo(4, 6); c.moveTo(-6, 11); c.lineTo(10, 11); c.stroke();
      c.fillStyle = OUT; c.font = '900 9.5px ' + FUENTE; c.textAlign = 'center'; c.fillText('FIADO', 2, -8);
      c.fillStyle = '#9aa3ad'; c.strokeStyle = OUT; c.lineWidth = 1.5;
      for (var k = -15; k <= 15; k += 7.5) { c.beginPath(); c.arc(-17, k, 2.6, 0, 7); c.fill(); c.stroke(); }
      base(c);
    },
    rayo: function (c) {
      c.fillStyle = '#2b2346'; c.beginPath(); c.arc(0, 0, 21, 0, 7); c.fill(); c.stroke();
      c.fillStyle = '#ffd400'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(4, -16); c.lineTo(-9, 3); c.lineTo(-1, 3); c.lineTo(-4, 16); c.lineTo(10, -4); c.lineTo(2, -4); c.closePath();
      c.fill(); c.stroke(); base(c);
    },
    mate: function (c) {
      c.fillStyle = '#8a5a33'; c.beginPath(); c.moveTo(-11, -7);
      c.bezierCurveTo(-23, 1, -19, 25, 0, 25); c.bezierCurveTo(19, 25, 23, 1, 11, -7); c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 3; c.beginPath(); c.arc(0, 9, 12, Math.PI * 1.1, Math.PI * 1.45); c.stroke();
      base(c);
      c.fillStyle = '#cfd5dc'; c.beginPath(); c.ellipse(0, -7, 12.5, 4.5, 0, 0, 7); c.fill(); c.stroke();
      c.fillStyle = '#5e9a3c'; c.beginPath(); c.ellipse(0, -7, 8.5, 2.4, 0, 0, 7); c.fill();
      c.lineWidth = 6; c.beginPath(); c.moveTo(3, -8); c.lineTo(11, -27); c.stroke();
      c.strokeStyle = '#d7dce2'; c.lineWidth = 2.6; c.stroke();
      base(c);
    },
    qr: function (c) {
      c.fillStyle = '#ffffff'; rr(c, -19, -19, 38, 38, 5); c.fill(); c.stroke();
      function ojo(x, y) {
        c.fillStyle = OUT; c.fillRect(x, y, 11, 11);
        c.fillStyle = '#ffffff'; c.fillRect(x + 2, y + 2, 7, 7);
        c.fillStyle = OUT; c.fillRect(x + 3.5, y + 3.5, 4, 4);
      }
      ojo(-15, -15); ojo(4, -15); ojo(-15, 4);
      c.fillStyle = OUT;
      [[5, 5], [9, 5], [13, 7], [5, 9], [11, 11], [7, 13], [13, 13], [-1, -13], [-1, -7], [-1, -1], [-7, -1], [-13, -1], [3, -1], [1, 5], [1, 11]].forEach(function (p) { c.fillRect(p[0], p[1], 3, 3); });
      base(c);
    },
    medialuna: function (c) {
      c.fillStyle = '#e9a646'; c.beginPath();
      c.arc(0, 8, 22, Math.PI * 0.95, Math.PI * 2.05);
      c.arc(0, 16, 14, Math.PI * 1.98, Math.PI * 1.02, true);
      c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = '#b8742a'; c.lineWidth = 2; c.beginPath();
      [-0.55, -0.18, 0.18, 0.55].forEach(function (k) {
        var a = Math.PI * 1.5 + k;
        c.moveTo(Math.cos(a) * 14.5, 16 + Math.sin(a) * 14.5); c.lineTo(Math.cos(a) * 21, 8 + Math.sin(a) * 21);
      });
      c.stroke();
      c.strokeStyle = 'rgba(255,240,200,.9)'; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 8, 18, Math.PI * 1.22, Math.PI * 1.4); c.stroke();
      base(c);
    },
  };

  // Ventri dibujada a mano, por si las caras no cargan
  function ventriDibujada(c) {
    c.lineJoin = 'round'; base(c);
    c.fillStyle = CREMA; c.beginPath(); c.moveTo(-34, 0); c.lineTo(-34, -94);
    for (var i = 0; i <= 8; i++) c.lineTo(-34 + i * 8.5, -94 - (i % 2 ? 7 : 0));
    c.lineTo(34, 0); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = VERDE; c.font = '900 13px ' + FUENTE; c.textAlign = 'center'; c.fillText('VENTRI', 0, -74);
    c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(-11, -54, 7, 8, 0, 0, 7); c.ellipse(11, -54, 7, 8, 0, 0, 7); c.fill(); c.stroke();
    c.fillStyle = OUT; c.beginPath(); c.arc(-10, -53, 3.5, 0, 7); c.arc(12, -53, 3.5, 0, 7); c.fill();
    c.fillStyle = 'rgba(255,120,140,.5)'; c.beginPath(); c.arc(-21, -42, 5, 0, 7); c.arc(21, -42, 5, 0, 7); c.fill();
    c.beginPath(); c.arc(0, -40, 8, 0.15, Math.PI - 0.15); c.stroke();
    c.strokeStyle = '#a69d90'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-22, -24); c.lineTo(22, -24); c.moveTo(-22, -16); c.lineTo(22, -16); c.moveTo(-22, -8); c.lineTo(22, -8); c.stroke();
    base(c);
  }

  // ---------------------------------------------------------------- lienzos armados
  var SPR = {}, CARA = {}, IMG = {}, ICONOS = {};
  // Dónde está el centro del papel en cada cara (fracción del ancho), igual que en Ventri.tsx
  var CARAS = { picara: 0.42, guino: 0.57, sorprendida: 0.45, mate: 0.43, indignada: 0.5 };
  var fondo = null, fondoViejo = null, fundido = 0, toldo = null, cieloActual = 'tarde';

  function lienzo(w, h, px) {
    px = px || PX;
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * px)); cv.height = Math.max(1, Math.round(h * px));
    var c = cv.getContext('2d'); c.scale(px, px); c.lineJoin = 'round'; c.lineCap = 'round'; base(c);
    return { cv: cv, c: c };
  }
  function dibujo(k, px) { var L = lienzo(64, 64, px); L.c.translate(32, 32); DIB[k](L.c); return L.cv; }
  function armarSprites() { for (var k in DIB) SPR[k] = dibujo(k, PX); }
  function icono(k) {
    if (!ICONOS[k]) { try { ICONOS[k] = dibujo(k, 1.5).toDataURL(); } catch (e) { ICONOS[k] = ''; } }
    return ICONOS[k];
  }

  function cargarCaras() {
    Object.keys(CARAS).forEach(function (k) {
      if (IMG[k]) return;
      var im = new Image();
      im.onload = function () { if (abierto) escalarCara(k); };
      im.src = BASE + k + '.webp';
      IMG[k] = im;
    });
  }
  function escalarCara(k) {
    var im = IMG[k];
    if (!im || !im.complete || !im.naturalWidth) return;
    var w = VH * im.naturalWidth / im.naturalHeight, L = lienzo(w, VH);
    L.c.imageSmoothingQuality = 'high';
    L.c.drawImage(im, 0, 0, w, VH);
    CARA[k] = { cv: L.cv, w: w };
  }

  var CIELOS = {
    trasnoche: { arriba: '#05070f', medio: '#12142e', abajo: '#23214a', edif: '#0b0c1c', lejos: '#16173a', obe: '#2c2f5c', noche: true },
    manana: { arriba: '#78c4f0', medio: '#b9e3fa', abajo: '#f1faff', edif: '#7f9db2', lejos: '#a9c4d6', obe: '#eae4d8', sol: '#fff6c9' },
    mediodia: { arriba: '#3f9fe6', medio: '#8fcff5', abajo: '#def3ff', edif: '#6d8ea6', lejos: '#9ab9cf', obe: '#f1ece2', sol: '#fffbe0' },
    tarde: { arriba: '#3b2a5c', medio: '#e0774a', abajo: '#ffc98a', edif: '#4a2f4f', lejos: '#7a4a66', obe: '#a8707e', sol: '#ffe2a8' },
    noche: { arriba: '#0d1230', medio: '#272a5c', abajo: '#4d3a72', edif: '#14152e', lejos: '#25264d', obe: '#3a3d6e', noche: true },
  };
  function cieloDe(h) { h = ((h % 24) + 24) % 24; return h < 8 ? 'trasnoche' : h < 12 ? 'manana' : h < 16 ? 'mediodia' : h < 20 ? 'tarde' : 'noche'; }

  function nube(c, x, y, s) {
    c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath();
    c.arc(x, y, 18 * s, 0, 7); c.arc(x + 20 * s, y - 8 * s, 22 * s, 0, 7); c.arc(x + 42 * s, y, 17 * s, 0, 7); c.fill();
    c.fillRect(x, y, 42 * s, 17 * s);
  }
  function frasco(c, x, y) {
    var r = semilla(5), cols = ['#ff5d8f', '#ffcf33', '#7FE3B8', '#ff7a3d', '#8fb8ff'];
    c.save(); rr(c, x - 22, y - 52, 44, 50, 10); c.clip();
    for (var i = 0; i < 24; i++) { c.fillStyle = cols[i % 5]; c.beginPath(); c.arc(x - 18 + r() * 36, y - 4 - r() * 36, 5, 0, 7); c.fill(); }
    c.restore();
    c.fillStyle = 'rgba(255,255,255,.22)'; rr(c, x - 22, y - 52, 44, 50, 10); c.fill(); c.stroke();
    c.fillStyle = VERDE; rr(c, x - 18, y - 62, 36, 11, 4); c.fill(); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.moveTo(x - 14, y - 42); c.lineTo(x - 14, y - 20); c.stroke();
    base(c);
  }

  function armarFondo(nombre) {
    var k = CIELOS[nombre], L = lienzo(W, H), c = L.c, r = semilla(11), i, x, w, h;
    var g = c.createLinearGradient(0, 0, 0, PISO);
    g.addColorStop(0, k.arriba); g.addColorStop(0.6, k.medio); g.addColorStop(1, k.abajo);
    c.fillStyle = g; c.fillRect(0, 0, W, PISO + 1);
    if (k.noche) {
      for (i = 0; i < 70; i++) {
        var ss = r() < 0.15 ? 2.4 : 1.4;
        c.fillStyle = 'rgba(255,255,255,' + (0.3 + r() * 0.6).toFixed(2) + ')';
        c.fillRect(r() * W, TOLDO + 10 + r() * (PISO - TOLDO - 230), ss, ss);
      }
      c.fillStyle = '#f4f1e6'; c.beginPath(); c.arc(W * 0.8, 150, 24, 0, 7); c.fill();
      c.fillStyle = '#e0dbc9'; c.beginPath(); c.arc(W * 0.8 - 7, 145, 5, 0, 7); c.arc(W * 0.8 + 8, 157, 4, 0, 7); c.fill();
    } else {
      var tarde = nombre === 'tarde';
      c.globalAlpha = 0.92; c.fillStyle = k.sol; c.beginPath(); c.arc(W * 0.74, tarde ? PISO - 125 : 150, tarde ? 54 : 32, 0, 7); c.fill(); c.globalAlpha = 1;
      if (!tarde) { nube(c, W * 0.14, 150, 1); nube(c, W * 0.46, 210, 0.75); }
    }
    // Ciudad de lejos, el Obelisco chiquito y la cuadra de enfrente
    c.fillStyle = k.lejos; x = -10;
    while (x < W) { w = 40 + r() * 60; h = 90 + r() * 120; c.fillRect(x, PISO - h, w, h); x += w + 4; }
    var ox = W * 0.63;
    c.fillStyle = k.obe; c.beginPath();
    c.moveTo(ox - 8, PISO); c.lineTo(ox - 5, PISO - 228); c.lineTo(ox, PISO - 246); c.lineTo(ox + 5, PISO - 228); c.lineTo(ox + 8, PISO); c.closePath(); c.fill();
    if (k.noche) { c.fillStyle = '#ff5c5c'; c.fillRect(ox - 1.5, PISO - 251, 3, 4); }
    x = -20;
    while (x < W) {
      w = 50 + r() * 70; h = 50 + r() * 90;
      c.fillStyle = k.edif; c.fillRect(x, PISO - h, w, h);
      c.fillStyle = k.noche ? 'rgba(255,214,120,.85)' : 'rgba(255,255,255,.2)';
      for (var vy = PISO - h + 12; vy < PISO - 16; vy += 18) {
        for (var vx = x + 8; vx < x + w - 12; vx += 16) if (r() < (k.noche ? 0.45 : 0.6)) c.fillRect(vx, vy, 7, 9);
      }
      x += w + 6;
    }
    // La sombra del toldo
    g = c.createLinearGradient(0, TOLDO - 10, 0, TOLDO + 34);
    g.addColorStop(0, 'rgba(0,0,0,.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, TOLDO - 10, W, 44);
    // El mostrador
    c.fillStyle = '#8a5a33'; c.fillRect(0, PISO, W, H - PISO);
    c.fillStyle = '#c38b52'; c.fillRect(0, PISO, W, 14);
    c.fillStyle = '#dca46a'; c.fillRect(0, PISO, W, 3);
    c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(0, PISO + 14, W, 4);
    c.fillStyle = VERDE; c.fillRect(0, PISO + 18, W, 5);
    c.strokeStyle = 'rgba(0,0,0,.16)'; c.lineWidth = 2;
    for (x = 30; x < W; x += 64) { c.beginPath(); c.moveTo(x, PISO + 23); c.lineTo(x, H); c.stroke(); }
    base(c);
    c.fillStyle = VERDE; rr(c, W / 2 - 75, PISO + 38, 150, 34, 8); c.fill(); c.stroke();
    c.fillStyle = CREMA; c.font = '900 19px ' + FUENTE; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('KIOSCO', W / 2, PISO + 56);
    base(c);
    if (W >= 520) frasco(c, 48, PISO);
    return L.cv;
  }

  function armarToldo() {
    var L = lienzo(W, TOLDO + 14), c = L.c, sw = 46, i, x;
    for (i = 0, x = 0; x < W; i++, x += sw) {
      c.fillStyle = i % 2 ? CREMA : VERDE;
      c.fillRect(x, 0, sw, TOLDO - 12);
      c.beginPath(); c.arc(x + sw / 2, TOLDO - 12, sw / 2, 0, Math.PI); c.fill();
    }
    c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 2;
    for (x = 0; x < W; x += sw) { c.beginPath(); c.arc(x + sw / 2, TOLDO - 12, sw / 2, 0, Math.PI); c.stroke(); }
    var g = c.createLinearGradient(0, 0, 0, 24);
    g.addColorStop(0, 'rgba(0,0,0,.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, 24);
    c.fillStyle = '#0c3f35'; c.fillRect(0, 0, W, 6);
    return L.cv;
  }

  function cambiarCielo(nombre) {
    if (nombre === cieloActual && fondo) return;
    fondoViejo = liviano ? null : fondo;
    fundido = fondoViejo ? 1 : 0;
    cieloActual = nombre;
    fondo = armarFondo(nombre);
  }

  // ---------------------------------------------------------------- sonido (WebAudio, sin archivos)
  var AC = null, master = null, ruidoBuf = null;
  function audio() {
    if (datos.mudo) return null;
    if (!AC) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { AC = new C(); master = AC.createGain(); master.gain.value = 0.32; master.connect(AC.destination); } catch (e) { AC = null; return null; }
    }
    if (AC.state === 'suspended') { try { AC.resume(); } catch (e) { /* sin sonido */ } }
    return AC;
  }
  function tono(f, dur, tipo, vol, f2, cuando) {
    var a = audio(); if (!a) return;
    try {
      var t = a.currentTime + (cuando || 0), o = a.createOscillator(), g = a.createGain();
      o.type = tipo || 'sine'; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
    } catch (e) { /* sin sonido */ }
  }
  function ruido(dur, vol, filtro, frec, cuando, cortes) {
    var a = audio(); if (!a) return;
    try {
      if (!ruidoBuf) {
        ruidoBuf = a.createBuffer(1, Math.floor(a.sampleRate * 1.5), a.sampleRate);
        var d = ruidoBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      var t = a.currentTime + (cuando || 0), s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      s.buffer = ruidoBuf; f.type = filtro || 'bandpass'; f.frequency.value = frec || 1800; f.Q.value = 0.9;
      if (cortes) {
        // la impresora térmica: el ruido va a los saltitos
        for (var k = 0; k < dur * cortes - 1; k++) { g.gain.setValueAtTime(vol, t + k / cortes); g.gain.setValueAtTime(vol * 0.2, t + (k + 0.55) / cortes); }
        g.gain.setValueAtTime(0, t + dur);
      } else {
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      }
      s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
    } catch (e) { /* sin sonido */ }
  }
  function arpegio(notas, paso, tipo, vol) { notas.forEach(function (f, i) { tono(f, paso * 2, tipo || 'triangle', vol || 0.16, 0, i * paso); }); }
  var SON = {
    pip: function (combo) {
      var f = 1400 * Math.pow(2, Math.min(combo, 36) / 36);
      tono(f, 0.07, 'square', 0.06); tono(f * 1.5, 0.07, 'square', 0.045, 0, 0.05);
    },
    dorado: function () { arpegio([784, 988, 1175, 1568, 1976], 0.06, 'triangle', 0.18); },
    trucho: function () { tono(150, 0.34, 'sawtooth', 0.15, 70); ruido(0.2, 0.25, 'lowpass', 900); },
    fiado: function () { tono(560, 0.32, 'triangle', 0.18, 170); },
    rayo: function () { ruido(0.4, 0.32, 'highpass', 2500); tono(90, 0.45, 'square', 0.09, 40); },
    cae: function () { tono(115, 0.2, 'sine', 0.35, 50); ruido(0.13, 0.2, 'lowpass', 1200); },
    ayuda: function () { arpegio([523, 659, 784, 1046], 0.05, 'triangle', 0.16); },
    mate: function () { ruido(0.5, 0.12, 'bandpass', 650); arpegio([523, 659, 784, 1046], 0.06, 'triangle', 0.14); },
    hora: function () { tono(1046, 0.5, 'sine', 0.17); tono(784, 0.75, 'sine', 0.17, 0, 0.22); },
    pico: function () { arpegio([523, 659, 784, 1046, 1318, 1568], 0.07, 'square', 0.06); },
    combo: function () { tono(880, 0.12, 'triangle', 0.15); tono(1320, 0.22, 'triangle', 0.15, 0, 0.09); },
    mision: function () { arpegio([659, 784, 988, 1318], 0.08, 'triangle', 0.15); },
    fin: function () { arpegio([523, 392, 330, 262], 0.15, 'triangle', 0.16); },
    impresora: function () { ruido(1.15, 0.13, 'bandpass', 2600, 0, 30); ruido(0.09, 0.2, 'highpass', 3200, 1.2); },
    record: function () { arpegio([523, 659, 784, 1046, 784, 1046, 1318], 0.09, 'square', 0.07); },
  };

  // ---------------------------------------------------------------- partida
  var J = null, P = [], T = [];
  var teclas = { izq: false, der: false };

  function nuevoJuego(demo) {
    return {
      demo: demo, estado: demo ? 'menu' : 'jugando',
      t: 0, nivel: 0, total: 0, visto: 0, combo: 0, vidas: 3, gracia: 0,
      vx: W / 2, vel: 0, velT: 0, meta: W / 2, teclado: false,
      items: [], spawn: demo ? 0.3 : 1.1, ultimoBueno: null,
      ef: { mate: 0, qr: 0, luz: 0, pico: 0 },
      caraTemp: 'picara', caraT: 0, squash: 0, temblor: 0, cartel: null, aviso: null,
      cuenta: {}, plata: {}, fiado: 0,
      s: { alfajor: 0, comboMax: 0, total: 0, horaMax: HORA0, truchosEsq: 0, mates: 0, dorados: 0, golosinas: 0 },
      cumplidas: [], hechas: [], finT: 0, finMostrado: false, causa: '',
    };
  }

  function multi(c) { return c >= 50 ? 4 : c >= 25 ? 3 : c >= 10 ? 2 : 1; }
  var HITOS_COMBO = {
    10: ['¡Combo x2!', 'Todo vale el doble', VCLARO],
    25: ['¡Combo x3!', '¡Qué manos!', '#ffb648'],
    50: ['¡Combo x4!', '¡Imparable!', '#ff8fc0'],
    100: ['¡100 seguidas!', 'Esto ya es arte', '#ffd23f'],
  };
  var FRASES_HORA = {
    8: '¡Abrimos la persiana!', 9: 'Los chicos del colegio', 10: 'Pasa el proveedor', 11: 'Media mañana', 12: 'Mediodía',
    14: '¿Siesta? ¿Qué siesta?', 15: 'Mate y facturas', 16: 'Salida del colegio', 17: 'La merienda', 18: 'Vuelven del laburo',
    19: 'Atardecer en el barrio', 21: 'Partido en la tele', 22: 'Antojo de alfajor', 23: 'Cerrando… ¿o no?', 0: 'Turno noche', 3: 'Los insomnes',
  };

  function intervalo() {
    if (J.demo) return 0.85;
    var i = Math.max(0.3, 1.05 * Math.pow(0.9, J.nivel));
    return J.ef.pico > 0 ? i * 0.5 : i;
  }
  function caida() { return J.demo ? 170 : Math.min(470, 165 + 21 * J.nivel); }

  function producto() {
    var total = 0, k;
    for (k = 0; k < PRODUCTOS.length; k++) total += TIPOS[PRODUCTOS[k]].peso;
    var r = Math.random() * total;
    for (k = 0; k < PRODUCTOS.length; k++) { r -= TIPOS[PRODUCTOS[k]].peso; if (r <= 0) return PRODUCTOS[k]; }
    return 'alfajor';
  }
  function elegir() {
    if (J.demo || J.ef.pico > 0) return producto();
    var d = J.nivel, r = Math.random();
    var pMalo = d === 0 ? 0.05 : Math.min(0.3, 0.08 + 0.022 * d);
    if (r < pMalo) {
      var malos = ['trucho', 'trucho', 'trucho'];
      if (d >= 2) malos.push('fiado', 'fiado');
      if (d >= 4 && J.ef.luz <= 0) malos.push('rayo');
      return azar(malos);
    }
    var hayAyuda = J.items.some(function (it) { return TIPOS[it.tipo].c === 'ayuda'; });
    if (!hayAyuda && d >= 1 && r - pMalo < 0.05) {
      var ay = ['mate', 'qr'];
      if (J.vidas < 3) ay.push('medialuna', 'medialuna');
      return azar(ay);
    }
    if (d >= 1 && Math.random() < 0.025) return 'dorado';
    return producto();
  }

  function aparecer() {
    var tipo = elegir(), cl = TIPOS[tipo].c;
    var v = caida() * rnd(0.92, 1.08) * (tipo === 'dorado' ? 1.3 : 1);
    var y0 = TOLDO - 28, llega = J.t + (TECHO - y0) / v, x = rnd(40, W - 40), i, o;
    if (cl !== 'malo') {
      // Que se pueda llegar desde lo anterior que había que atajar, aunque se juegue con el teclado
      var u = J.ultimoBueno;
      if (u) { var alc = VMAX * Math.max(0.08, llega - u.t) * 0.8 + ATAJA; x = clamp(x, u.x - alc, u.x + alc); }
      J.ultimoBueno = { t: llega, x: x };
    } else {
      // Lo malo nunca cae justo encima de un producto que llega al mismo tiempo
      for (i = 0; i < J.items.length; i++) {
        o = J.items[i];
        if (TIPOS[o.tipo].c !== 'malo' && Math.abs(o.llega - llega) < 0.45 && Math.abs(o.x - x) < 95) x = o.x + (x < o.x ? -1 : 1) * 120;
      }
    }
    J.items.push({ tipo: tipo, x: clamp(x, 34, W - 34), y: y0, v: v, llega: llega, fase: rnd(0, 6), giro: rnd(1.5, 3.5) });
  }

  function ponerCara(k, s) { J.caraTemp = k; J.caraT = s; }
  function caraActual() {
    if (J.caraT > 0) return J.caraTemp;
    if (J.estado === 'fin') return 'indignada';
    if (J.ef.mate > 0) return 'mate';
    if (J.combo >= 10 || J.ef.pico > 0) return 'guino';
    return 'picara';
  }

  function chispas(x, y, n, cols, f) {
    var max = liviano || reduce ? 40 : 150;
    for (var i = 0; i < n && P.length < max; i++) {
      P.push({ x: x, y: y, vx: rnd(-1, 1) * f, vy: rnd(-1.1, -0.25) * f, t: 0, v: rnd(0.45, 0.85), c: cols[i % cols.length], s: rnd(3, 6.5), r: rnd(0, 6), vr: rnd(-9, 9) });
    }
  }
  function texto(s, x, y, col, tam) {
    T.push({ s: s, x: clamp(x, 70, W - 70), y: y, c: col, z: tam || 19, t: 0, v: 0.9 });
    if (T.length > 12) T.shift();
  }
  function cartel(txt, sub, col, dur) { J.cartel = { txt: txt, sub: sub, c: col || '#fff', t: 0, v: dur || 1.6 }; }

  function atajar(it) {
    var tipo = it.tipo, d = TIPOS[tipo];
    if (d.c === 'prod') {
      J.combo++;
      if (J.combo > J.s.comboMax) J.s.comboMax = J.combo;
      var gana = d.precio * multi(J.combo) * (J.ef.pico > 0 ? 2 : 1);
      J.total += gana; J.s.total = J.total;
      J.cuenta[tipo] = (J.cuenta[tipo] || 0) + 1;
      J.plata[tipo] = (J.plata[tipo] || 0) + gana;
      if (tipo === 'alfajor') J.s.alfajor++;
      if (tipo === 'dorado') J.s.dorados++;
      if (tipo === 'caramelo' || tipo === 'chupetin') J.s.golosinas++;
      J.squash = 1;
      if (J.demo) { chispas(it.x, it.y, 5, [CREMA, VCLARO], 180); return; }
      if (tipo === 'dorado') {
        SON.dorado(); chispas(it.x, it.y, 28, ['#ffd23f', '#fff3b0', '#f2a516'], 380);
        cartel('¡Alfajor dorado!', '+' + plata(gana), '#ffd23f', 1.3); ponerCara('sorprendida', 0.6);
      } else {
        SON.pip(J.combo); chispas(it.x, it.y, 7, [CREMA, VCLARO, '#ffffff'], 220);
        texto('+' + plata(gana), it.x, it.y - 12, '#ffffff', 19);
      }
      var h = HITOS_COMBO[J.combo];
      if (h) { cartel(h[0], h[1], h[2], 1.4); SON.combo(); }
    } else if (tipo === 'trucho') {
      SON.trucho(); chispas(it.x, it.y, 14, d.migas, 260);
      perderVida('¡Billete trucho!', 'trucho', it.x, it.y, 'indignada');
    } else if (tipo === 'fiado') {
      var pierde = Math.min(J.total, Math.max(1000, Math.round(J.total * 0.1 / 100) * 100));
      J.total -= pierde; J.fiado += pierde; J.s.total = J.total; J.combo = 0;
      SON.fiado(); chispas(it.x, it.y, 12, d.migas, 240); ponerCara('indignada', 0.9); J.temblor = 5;
      texto('¡Fiado! ' + plata(-pierde), it.x, it.y - 12, '#ffb648', 21);
    } else if (tipo === 'rayo') {
      J.ef.luz = LUZ_SEG; SON.rayo(); ponerCara('sorprendida', 1);
      cartel('¡Se cortó la luz!', 'Atajá a ciegas…', '#ffd400', 1.5);
    } else if (tipo === 'mate') {
      J.ef.mate = 6; J.s.mates++; SON.mate(); chispas(it.x, it.y, 12, [VCLARO, '#ffffff'], 220);
      texto('Matecito: todo más tranqui', it.x, it.y - 12, VCLARO, 18);
    } else if (tipo === 'qr') {
      J.ef.qr = 7; SON.ayuda(); chispas(it.x, it.y, 12, ['#8fc8ff', '#ffffff'], 220); ponerCara('sorprendida', 0.5);
      texto('¡Cobro con QR! Imán', it.x, it.y - 12, '#8fc8ff', 18);
    } else if (tipo === 'medialuna') {
      SON.ayuda(); chispas(it.x, it.y, 12, d.migas, 220);
      if (J.vidas < 3) { J.vidas++; texto('+1 vida', it.x, it.y - 12, '#ff8fa8', 20); }
      else { J.total += 3000; J.s.total = J.total; texto('+' + plata(3000), it.x, it.y - 12, '#ffffff', 19); }
    }
    revisarMisiones();
  }

  function perderVida(txt, causa, x, y, cara) {
    J.combo = 0;
    if (J.estado !== 'jugando') return;
    if (J.gracia > 0) { texto(txt, x, y - 12, '#ff9a9a', 17); return; }
    J.vidas--; J.gracia = 1; J.temblor = 10; ponerCara(cara, 0.9);
    texto(txt, x, y - 12, '#ff6b6b', 22);
    if (J.vidas <= 0) terminar(causa);
  }

  function cayo(it) {
    var cl = TIPOS[it.tipo].c;
    chispas(it.x, PISO - 4, cl === 'prod' ? 10 : 5, TIPOS[it.tipo].migas, 200);
    if (J.demo || J.estado !== 'jugando') return;
    if (cl === 'prod') { SON.cae(); perderVida('¡Se cayó!', 'cayo', it.x, PISO - 30, 'sorprendida'); }
    else if (it.tipo === 'trucho') { J.s.truchosEsq++; revisarMisiones(); }
  }

  function subirNivel(n) {
    J.nivel = n;
    var h = (HORA0 + n) % 24;
    J.s.horaMax = HORA0 + n;
    if (h === 13 || h === 20 || (n >= 16 && n % 4 === 0)) {
      J.ef.pico = 7; SON.pico(); cartel('¡HORA PICO!', hora(h) + ' · todo vale el doble', '#ffb648', 1.8);
    } else {
      SON.hora(); cartel(hora(h), FRASES_HORA[h] || 'Turno trasnoche', '#ffffff', 1.5);
    }
    cambiarCielo(cieloDe(h));
    revisarMisiones();
  }

  function revisarMisiones() {
    if (J.demo || J.estado !== 'jugando') return;
    datos.misiones.forEach(function (m) {
      if (J.cumplidas.indexOf(m.id) >= 0) return;
      if (MISIONES[m.id].val(J.s) >= metaDe(m)) {
        J.cumplidas.push(m.id);
        J.aviso = { s: '★ Misión cumplida: ' + MISIONES[m.id].txt(metaDe(m)), t: 0, v: 2.8 };
        SON.mision();
      }
    });
  }

  function terminar(causa) {
    if (J.estado !== 'jugando') return;
    J.estado = 'fin'; J.causa = causa; J.finT = 0;
    if (raiz) raiz.classList.remove('vj-juega');
    teclas.izq = teclas.der = false;
    SON.fin();
    // Cuentas: misiones cumplidas, estrellas, récord
    var r0 = rango(datos.estrellas), quedan = [];
    datos.misiones.forEach(function (m) {
      if (J.cumplidas.indexOf(m.id) < 0) { quedan.push(m); return; }
      var est = Math.min(3, m.tier + 1);
      datos.estrellas += est;
      datos.tiers[m.id] = (datos.tiers[m.id] || 0) + 1;
      J.hechas.push({ txt: MISIONES[m.id].txt(metaDe(m)), est: est });
    });
    var tiene = function (id) { return quedan.some(function (m) { return m.id === id; }); };
    while (quedan.length < 3) {
      var libres = Object.keys(MISIONES).filter(function (id) { return !tiene(id) && J.cumplidas.indexOf(id) < 0; });
      if (!libres.length) libres = Object.keys(MISIONES).filter(function (id) { return !tiene(id); });
      var id = azar(libres);
      quedan.push({ id: id, tier: datos.tiers[id] || 0 });
    }
    datos.misiones = quedan;
    J.subioRango = rango(datos.estrellas) > r0;
    J.record = J.total > datos.record;
    J.recordAntes = datos.record;
    if (J.record) datos.record = J.total;
    datos.mejorHora = Math.max(datos.mejorHora, J.s.horaMax);
    datos.partidas++;
    guardar();
  }

  function moverVentri(dt) {
    var antes = J.vx, i, it;
    if (J.demo) {
      // En el menú juega sola: va a buscar lo que está más cerca de caer
      var mejor = null;
      for (i = 0; i < J.items.length; i++) { it = J.items[i]; if (!mejor || it.y > mejor.y) mejor = it; }
      if (mejor) J.meta = mejor.x;
      J.vx += clamp(J.meta - J.vx, -520 * dt, 520 * dt);
    } else if (J.estado === 'jugando') {
      var dir = (teclas.izq ? -1 : 0) + (teclas.der ? 1 : 0);
      if (dir) J.teclado = true;
      if (J.teclado) {
        J.velT += (dir * VMAX - J.velT) * Math.min(1, dt * 16);
        J.vx += J.velT * dt;
      } else {
        J.vx += clamp((J.meta - J.vx) * Math.min(1, dt * 20), -1700 * dt, 1700 * dt);
      }
    }
    J.vx = clamp(J.vx, 34, W - 34);
    var v = dt > 0 ? (J.vx - antes) / dt : 0;
    J.vel += (v - J.vel) * Math.min(1, dt * 12);
  }

  function actualizar(dt) {
    var lento = J.ef.mate > 0 ? 0.5 : 1, dti = dt * lento, i, it;
    J.t += dt;
    if (J.estado === 'jugando' && !J.demo) {
      var n = Math.floor(J.t / NIVEL_SEG);
      if (n > J.nivel) subirNivel(n);
    }
    for (var k in J.ef) if (J.ef[k] > 0) J.ef[k] = Math.max(0, J.ef[k] - dt);
    if (J.gracia > 0) J.gracia -= dt;
    if (J.caraT > 0) J.caraT -= dt;
    J.squash = Math.max(0, J.squash - dt * 5);
    J.temblor = Math.max(0, J.temblor - dt * 40);
    J.visto += (J.total - J.visto) * Math.min(1, dt * 9);
    if (Math.abs(J.total - J.visto) < 1) J.visto = J.total;
    if (J.cartel) { J.cartel.t += dt; if (J.cartel.t >= J.cartel.v) J.cartel = null; }
    if (J.aviso) { J.aviso.t += dt; if (J.aviso.t >= J.aviso.v) J.aviso = null; }

    if (J.demo || J.estado === 'jugando') {
      J.spawn -= dti;
      if (J.spawn <= 0) { aparecer(); J.spawn = intervalo(); }
    }
    moverVentri(dt);

    for (i = J.items.length - 1; i >= 0; i--) {
      it = J.items[i];
      if (i >= J.items.length) continue;
      it.y += it.v * dti;
      if (J.ef.qr > 0 && TIPOS[it.tipo].c === 'prod' && it.y > TOLDO + 30 && it.y < TECHO) it.x += (J.vx - it.x) * Math.min(1, dt * 3.2);
      var vale = J.demo || J.estado === 'jugando';
      if (vale && it.y + R >= TECHO && it.y - R <= TECHO + 34 && Math.abs(it.x - J.vx) <= ATAJA + R * 0.5) {
        J.items.splice(i, 1); atajar(it); continue;
      }
      if (it.y + R * 0.5 >= PISO + 4) { J.items.splice(i, 1); cayo(it); }
    }

    for (i = P.length - 1; i >= 0; i--) {
      var p = P[i]; p.t += dt;
      if (p.t >= p.v) { P.splice(i, 1); continue; }
      p.vy += 950 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    }
    for (i = T.length - 1; i >= 0; i--) { T[i].t += dt; T[i].y -= 48 * dt; if (T[i].t >= T[i].v) T.splice(i, 1); }

    if (J.estado === 'fin') {
      J.finT += dt;
      if (J.finT > 0.9 && !J.finMostrado) { J.finMostrado = true; mostrarFin(); }
    }
  }

  // ---------------------------------------------------------------- dibujo de cada cuadro
  function dibujarItems(c, t) {
    for (var i = 0; i < J.items.length; i++) {
      var it = J.items[i], cl = TIPOS[it.tipo].c;
      if (cl === 'ayuda' || it.tipo === 'dorado') {
        var pul = 0.5 + 0.5 * Math.sin(t * 6 + it.fase);
        c.fillStyle = it.tipo === 'dorado' ? 'rgba(255,214,64,' + (0.25 + 0.25 * pul).toFixed(2) + ')' : 'rgba(127,227,184,' + (0.22 + 0.22 * pul).toFixed(2) + ')';
        c.beginPath(); c.arc(it.x, it.y, 30 + pul * 4, 0, 7); c.fill();
      }
      c.save(); c.translate(it.x, it.y); c.rotate(Math.sin(t * it.giro + it.fase) * 0.28);
      c.drawImage(SPR[it.tipo], -32, -32, 64, 64);
      c.restore();
    }
  }

  function dibujarVentri(c, t) {
    var k = caraActual(), f = CARA[k] ? CARA[k] : CARA.picara, centro = CARA[k] ? CARAS[k] : CARAS.picara;
    var quieta = Math.abs(J.vel) < 30;
    var bob = quieta ? Math.sin(t * 3.2) * 1.6 : -Math.abs(Math.sin(t * 16)) * 3;
    c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(J.vx, PISO + 3, 32, 6, 0, 0, 7); c.fill();
    if (J.ef.qr > 0) {
      c.strokeStyle = 'rgba(143,200,255,' + (0.35 + 0.3 * Math.sin(t * 8)).toFixed(2) + ')'; c.lineWidth = 4;
      c.beginPath(); c.ellipse(J.vx, PISO - VH / 2, 62, 70, 0, 0, 7); c.stroke(); base(c);
    }
    c.save(); c.translate(J.vx, PISO + 4 + bob);
    c.rotate(clamp(J.vel / 2600, -0.2, 0.2));
    if (J.squash > 0.01) c.scale(1 + 0.09 * J.squash, 1 - 0.11 * J.squash);
    if (J.gracia > 0 && J.estado === 'jugando' && Math.floor(J.gracia * 14) % 2 === 0) c.globalAlpha = 0.4;
    if (f) c.drawImage(f.cv, -f.w * centro, -VH, f.w, VH);
    else ventriDibujada(c);
    c.restore();
  }

  function dibujarEfectos(c) {
    var i, p, x;
    for (i = 0; i < P.length; i++) {
      p = P[i];
      c.globalAlpha = 1 - p.t / p.v; c.fillStyle = p.c;
      c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillRect(-p.s / 2, -p.s * 0.35, p.s, p.s * 0.7); c.restore();
    }
    c.globalAlpha = 1;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    for (i = 0; i < T.length; i++) {
      p = T[i]; x = p.t / p.v;
      c.globalAlpha = x > 0.6 ? (1 - x) / 0.4 : 1;
      c.font = '900 ' + p.z + 'px ' + FUENTE; c.lineWidth = 5; c.strokeStyle = 'rgba(10,20,16,.85)';
      c.strokeText(p.s, p.x, p.y); c.fillStyle = p.c; c.fillText(p.s, p.x, p.y);
    }
    base(c);
  }

  function oscuridad(c) {
    var e = J.ef.luz, a = Math.min(1, (LUZ_SEG - e) / 0.3, e / 0.5);
    if (LUZ_SEG - e < 0.7 && Math.floor(reloj * 20) % 3 === 0) a *= 0.35;  // la luz titila al cortarse
    var g = c.createRadialGradient(J.vx, PISO - 60, 70, J.vx, PISO - 60, 250);
    g.addColorStop(0, 'rgba(4,6,16,0)'); g.addColorStop(1, 'rgba(4,6,16,' + (0.94 * a).toFixed(3) + ')');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }

  function pastilla(c, x, y, w, h, r, col) { c.fillStyle = col; rr(c, x, y, w, h, r); c.fill(); }
  function corazon(c, x, y, s, lleno) {
    c.beginPath(); c.moveTo(x, y + s * 0.9);
    c.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.7, y - s * 1.3, x, y - s * 0.45);
    c.bezierCurveTo(x + s * 0.7, y - s * 1.3, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
    c.fillStyle = lleno ? '#ff4d6d' : 'rgba(255,255,255,.14)'; c.fill();
    c.lineWidth = 2; c.strokeStyle = lleno ? '#ffffff' : 'rgba(255,255,255,.4)'; c.stroke();
  }

  function hud(c) {
    var i;
    // La plata y las vidas
    pastilla(c, 12, 10, 196, 84, 16, 'rgba(10,26,21,.84)');
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillStyle = VCLARO; c.font = '800 10.5px ' + FUENTE; c.fillText('TOTAL', 26, 29);
    c.fillStyle = '#ffffff'; c.font = '900 24px ' + FUENTE; c.fillText(plata(J.visto), 26, 55);
    for (i = 0; i < 3; i++) corazon(c, 32 + i * 25, 76, 9, i < J.vidas);
    if (J.combo >= 2) {
      var m = multi(J.combo) * (J.ef.pico > 0 ? 2 : 1);
      c.font = '900 18px ' + FUENTE; c.textAlign = 'right';
      var mw = c.measureText('x' + m).width;
      c.fillStyle = m >= 4 ? '#ff8fc0' : m === 3 ? '#ffb648' : m === 2 ? VCLARO : '#ffffff';
      c.fillText('x' + m, 196, 83);
      c.font = '700 11px ' + FUENTE; c.fillStyle = 'rgba(255,255,255,.8)'; c.fillText('combo ' + J.combo, 190 - mw, 81);
    }
    // El reloj del kiosco: arriba al medio o, en pantallas angostas, a la derecha debajo de los botones
    var angosto = W < 560, pico = J.ef.pico > 0, pw = pico ? 156 : 100;
    var cx = angosto ? W - 12 - pw / 2 : W / 2, cy = angosto ? 58 : 10;
    if (pico) {
      pastilla(c, cx - 78, cy, 156, 42, 14, Math.floor(reloj * 6) % 2 ? '#e8590c' : '#f76707');
      c.fillStyle = '#ffffff'; c.font = '900 17px ' + FUENTE; c.textAlign = 'center'; c.fillText('¡HORA PICO! x2', cx, cy + 26);
      c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(cx - 62, cy + 35, 124, 3);
      c.fillStyle = '#ffffff'; c.fillRect(cx - 62, cy + 35, 124 * J.ef.pico / 7, 3);
    } else {
      pastilla(c, cx - 50, cy, 100, 42, 14, 'rgba(10,26,21,.84)');
      c.fillStyle = '#ffffff'; c.font = '800 22px ' + MONO; c.textAlign = 'center'; c.fillText(hora(HORA0 + J.nivel), cx, cy + 29);
    }
    // Lo que está activo (mate, QR, sin luz), con lo que le queda
    var act = [];
    if (J.ef.mate > 0) act.push(['mate', J.ef.mate / 6, VCLARO]);
    if (J.ef.qr > 0) act.push(['qr', J.ef.qr / 7, '#8fc8ff']);
    if (J.ef.luz > 0) act.push(['rayo', J.ef.luz / LUZ_SEG, '#ffd400']);
    for (i = 0; i < act.length; i++) {
      var ax = (angosto ? W - 62 : cx) - (act.length - 1) * 21 + i * 42, ay = cy + 66;
      c.fillStyle = 'rgba(10,26,21,.84)'; c.beginPath(); c.arc(ax, ay, 18, 0, 7); c.fill();
      c.drawImage(SPR[act[i][0]], ax - 14, ay - 14, 28, 28);
      c.strokeStyle = act[i][2]; c.lineWidth = 3; c.beginPath(); c.arc(ax, ay, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * act[i][1]); c.stroke();
    }
    base(c);
  }

  function dibujarCarteles(c) {
    var k = J.cartel;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    if (k) {
      var p = k.t / k.v, s = p < 0.12 ? 0.55 + (p / 0.12) * 0.55 : p < 0.2 ? 1.1 - ((p - 0.12) / 0.08) * 0.1 : 1;
      var big = Math.min(46, W / 10.5);
      c.save(); c.globalAlpha = p > 0.75 ? (1 - p) / 0.25 : 1; c.translate(W / 2, H * 0.36); c.scale(s, s);
      c.font = '900 ' + big + 'px ' + FUENTE; c.lineWidth = 9; c.strokeStyle = 'rgba(10,20,16,.88)';
      c.strokeText(k.txt, 0, 0); c.fillStyle = k.c; c.fillText(k.txt, 0, 0);
      if (k.sub) {
        c.font = '800 19px ' + FUENTE; c.lineWidth = 6;
        c.strokeText(k.sub, 0, big * 0.78); c.fillStyle = '#ffffff'; c.fillText(k.sub, 0, big * 0.78);
      }
      c.restore();
    }
    var a = J.aviso;
    if (a) {
      c.save(); c.globalAlpha = a.t < 0.2 ? a.t / 0.2 : a.t > a.v - 0.4 ? (a.v - a.t) / 0.4 : 1;
      c.font = '800 14px ' + FUENTE;
      var w = Math.min(W - 24, c.measureText(a.s).width + 32);
      var ay2 = W < 560 ? 158 : 108;
      pastilla(c, W / 2 - w / 2, ay2, w, 32, 16, 'rgba(242,194,48,.96)');
      c.fillStyle = OSCURO; c.fillText(a.s, W / 2, ay2 + 17, w - 20);
      c.restore();
    }
    base(c);
  }

  var reloj = 0;
  function dibujar() {
    var c = ctx;
    c.setTransform(PX, 0, 0, PX, 0, 0);
    if (J.temblor > 0.5 && !reduce) {
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      c.translate(rnd(-1, 1) * J.temblor, rnd(-1, 1) * J.temblor);
    }
    if (fondo) c.drawImage(fondo, 0, 0, W, H);
    if (fondoViejo && fundido > 0) { c.globalAlpha = fundido; c.drawImage(fondoViejo, 0, 0, W, H); c.globalAlpha = 1; }
    dibujarItems(c, reloj);
    if (toldo) c.drawImage(toldo, 0, 0, W, TOLDO + 14);
    dibujarVentri(c, reloj);
    dibujarEfectos(c);
    if (J.ef.luz > 0) oscuridad(c);
    c.setTransform(PX, 0, 0, PX, 0, 0);
    if (!J.demo) { hud(c); dibujarCarteles(c); }
  }

  // ---------------------------------------------------------------- rendimiento y tamaño
  var liviano = false, cuadros = 0, acum = 0;
  function rendimiento(dt) {
    if (liviano || !J || J.estado !== 'jugando') return;
    cuadros++; acum += dt;
    if (cuadros >= 90) {
      // Si la PC no llega a ~35 cuadros por segundo: menos resolución y menos chispas
      if (acum / cuadros > 1 / 35) { liviano = true; medir(); }
      cuadros = 0; acum = 0;
    }
  }

  var medida = [0, 0], chequeo = 0;
  function medir() {
    if (!cv) return;
    medida = [window.innerWidth, window.innerHeight];
    var vw = Math.max(320, window.innerWidth), vh = Math.max(300, window.innerHeight);
    W = Math.round(clamp(H * vw / vh, 380, 1100));
    var escala = Math.min(vw / W, vh / H);
    PX = escala * Math.min(window.devicePixelRatio || 1, liviano ? 1 : 1.5);
    if (liviano) PX = Math.min(PX, 1);
    cv.width = Math.round(W * PX); cv.height = Math.round(H * PX);
    cv.style.width = Math.round(W * escala) + 'px'; cv.style.height = Math.round(H * escala) + 'px';
    armarSprites();
    CARA = {}; Object.keys(CARAS).forEach(escalarCara);
    fondoViejo = null; fundido = 0;
    fondo = armarFondo(cieloActual);
    toldo = armarToldo();
    if (J) { J.vx = clamp(J.vx, 34, W - 34); J.meta = clamp(J.meta, 34, W - 34); }
  }

  // ---------------------------------------------------------------- pantallas (HTML)
  var FRASES_MENU = [
    '¡Llegó la hora pico! Atajá todo… menos los billetes truchos 😏',
    'Si se te cae un alfajor no pasa nada. Mentira, pasa. Atajalo.',
    'El fiado no se ataja: se esquiva. Lección de vida.',
    'Cuando caiga un mate, agarralo: todo va más tranqui 🧉',
    'El alfajor dorado vale $20.000. Si lo ves, corré.',
    'A las 13 y a las 20 es hora pico: todo vale el doble.',
  ];

  function leyenda() {
    var chip = function (k, txt) { return '<span class="vj-chip"><img src="' + icono(k) + '" alt="">' + txt + '</span>'; };
    var prods = ['alfajor', 'gaseosa', 'galletitas', 'chupetin', 'caramelo'].map(function (k) {
      return '<img src="' + icono(k) + '" alt="' + esc(TIPOS[k].nombre) + '" title="' + esc(TIPOS[k].nombre + ' · ' + plata(TIPOS[k].precio)) + '">';
    }).join('');
    return '<div class="vj-bloque"><p class="vj-h">Qué cae del toldo</p>' +
      '<div class="vj-ley vj-ok"><b>Atajá</b><span>' + prods + '</span></div>' +
      '<div class="vj-ley vj-ok"><b></b><span>' + chip('dorado', 'Alfajor dorado: $20.000') + '</span></div>' +
      '<div class="vj-ley vj-mal"><b>Esquivá</b><span>' + chip('trucho', 'Trucho: −1 vida') + chip('fiado', 'Fiado: te saca plata') + chip('rayo', 'Corte de luz') + '</span></div>' +
      '<div class="vj-ley vj-ay"><b>Te ayudan</b><span>' + chip('mate', 'Mate: todo lento') + chip('qr', 'QR: imán') + chip('medialuna', 'Medialuna: +1 vida') + '</span></div>' +
      '</div>';
  }

  function htmlMisiones(lista) {
    return '<ul class="vj-mis">' + lista.map(function (m) {
      return '<li><span class="vj-est">★' + Math.min(3, m.tier + 1) + '</span>' + esc(MISIONES[m.id].txt(metaDe(m))) + '</li>';
    }).join('') + '</ul>';
  }

  function htmlRango() {
    var rg = rango(datos.estrellas), sig = RANGOS[rg + 1];
    var prog = sig ? (datos.estrellas - RANGOS[rg][0]) / (sig[0] - RANGOS[rg][0]) : 1;
    return '<div class="vj-bloque"><div class="vj-rango"><b>' + esc(RANGOS[rg][1]) + '</b><span>★ ' + datos.estrellas + (sig ? ' / ' + sig[0] : '') + '</span></div>' +
      '<div class="vj-prog"><i style="width:' + Math.round(prog * 100) + '%"></i></div>' +
      (sig ? '<p class="vj-chico">Próximo rango: ' + esc(sig[1]) + '</p>' : '<p class="vj-chico">Rango máximo. Respeto.</p>') + '</div>';
  }

  function htmlMenu() {
    var ayuda = tactil ? 'Arrastrá el dedo para mover a Ventri' : 'Mouse o ← → para moverte · P pausa · M sonido · Esc salir';
    return '<div class="vj-card vj-menu">' +
      '<div>' +
        '<div class="vj-hola"><img class="vj-cara" src="' + BASE + 'picara.webp" alt=""><p class="vj-globo">' + esc(azar(FRASES_MENU)) + '</p></div>' +
        '<p class="vj-kicker">El juego secreto de Ventri</p>' +
        '<h2 class="vj-titulo">Hora pico</h2>' +
        '<p class="vj-sub">Atajá todo lo que cae del toldo antes de que toque el mostrador. Cada producto suma su precio al ticket; si se te cae uno, perdés una vida.</p>' +
        '<button type="button" class="vj-btn" data-a="jugar">¡A vender! <kbd>Enter</kbd></button>' +
        '<p class="vj-ayuda">' + ayuda + '</p>' +
        (opciones.contexto === 'caja' ? '<p class="vj-ayuda">Si pasás un producto por el lector, el juego se cierra solo.</p>' : '') +
      '</div>' +
      '<div>' +
        leyenda() +
        '<div class="vj-bloque"><p class="vj-h">Misiones</p>' + htmlMisiones(datos.misiones) + '</div>' +
        htmlRango() +
        (datos.record ? '<p class="vj-record">Tu récord: <b>' + plata(datos.record) + '</b> · llegaste hasta las ' + hora(datos.mejorHora) + '</p>' : '') +
      '</div>' +
    '</div>';
  }

  function htmlPausa() {
    return '<div class="vj-card vj-chica">' +
      '<img class="vj-cara" src="' + BASE + 'mate.webp" alt="">' +
      '<h2 class="vj-titulo">Pausa</h2><p class="vj-sub">Un matecito y seguimos. El kiosco te espera.</p>' +
      '<div class="vj-botones"><button type="button" class="vj-btn" data-a="seguir">Seguir <kbd>P</kbd></button>' +
      '<button type="button" class="vj-btn2" data-a="salir">Salir <kbd>Esc</kbd></button></div></div>';
  }

  function dientes() {
    var p = ['0 0', '100% 0'], n = 22;
    for (var i = n; i >= 0; i--) p.push((i * 100 / n).toFixed(2) + '% ' + (i % 2 ? 'calc(100% - 8px)' : '100%'));
    return 'polygon(' + p.join(',') + ')';
  }
  function barras() {
    var s = [], x = 0;
    while (x < 220) {
      var b = 1 + Math.floor(Math.random() * 3), g = 1 + Math.floor(Math.random() * 3);
      s.push(OUT + ' ' + x + 'px ' + (x + b) + 'px', 'transparent ' + (x + b) + 'px ' + (x + b + g) + 'px');
      x += b + g;
    }
    return 'linear-gradient(90deg,' + s.join(',') + ')';
  }
  function linea(izq, der, clase) { return '<div class="vj-l ' + (clase || '') + '"><span>' + izq + '</span><span>' + der + '</span></div>'; }

  function fraseFin() {
    if (J.record && J.total > 0) return { cara: 'guino', txt: azar(['¡Récord! Así se atiende un kiosco 💚', 'Nuevo récord. Ya podés pedir aumento… a vos mismo.']) };
    if (J.t < 20) return { cara: 'sorprendida', txt: '¿Ya? Si recién subimos la persiana 😅' };
    if (J.causa === 'trucho') return { cara: 'indignada', txt: '¡Te comiste un trucho! Miralos bien antes de atajar 👀' };
    if (J.total >= 300000) return { cara: 'guino', txt: 'Facturaste como un súper. Ni yo imprimo tan rápido.' };
    return { cara: 'sorprendida', txt: azar(['Tranqui, a todos se nos cae un alfajor alguna vez.', 'Casi. La próxima cerramos la caja con todo.', 'Ese alfajor tenía nombre y apellido…']) };
  }

  function htmlFin() {
    var f = new Date(), h = '', algo = false;
    h += '<div class="vj-t-logo">VENTRI</div><div class="vj-t-c">KIOSCO · HORA PICO</div>';
    h += '<div class="vj-t-c vj-t-chico">' + pad(f.getDate()) + '/' + pad(f.getMonth() + 1) + '/' + f.getFullYear() + ' ' + pad(f.getHours()) + ':' + pad(f.getMinutes()) + '</div><div class="vj-t-raya"></div>';
    PRODUCTOS.forEach(function (k) {
      if (!J.cuenta[k]) return;
      algo = true; h += linea(J.cuenta[k] + ' x ' + esc(TIPOS[k].nombre), plata(J.plata[k]));
    });
    if (!algo) h += linea('Sin ventas', '$0');
    if (J.fiado) h += linea('Fiado (no vuelve)', plata(-J.fiado));
    h += '<div class="vj-t-raya"></div>' + linea('TOTAL', plata(J.total), 'vj-t-total') + '<div class="vj-t-raya"></div>';
    h += linea('Cerraste a las', hora(HORA0 + J.nivel)) + linea('Combo máximo', J.s.comboMax) + linea('Tu récord', plata(datos.record));
    if (J.record && J.total > 0) h += '<div class="vj-sello">¡NUEVO RÉCORD!</div>';
    J.hechas.forEach(function (m) { h += '<div class="vj-t-m">★' + m.est + ' ' + esc(m.txt) + '</div>'; });
    h += '<div class="vj-t-raya"></div><div class="vj-t-c">¡Gracias por su compra!</div><div class="vj-t-barras" style="background:' + barras() + '"></div>';

    var fr = fraseFin(), extra = '';
    if (J.subioRango) extra += '<div class="vj-logro">¡Subiste de rango! Ahora sos <b>' + esc(RANGOS[rango(datos.estrellas)][1]) + '</b></div>';
    extra += '<div class="vj-bloque"><p class="vj-h">Próximas misiones</p>' + htmlMisiones(datos.misiones) + '</div>';
    var web = opciones.contexto === 'web';
    return '<div class="vj-fin">' +
      '<div class="vj-imp"><div class="vj-ranura"></div><div class="vj-papel"><div class="vj-ticket" style="clip-path:' + dientes() + '">' + h + '</div></div></div>' +
      '<div class="vj-lado">' +
        '<div class="vj-hola"><img class="vj-cara" src="' + BASE + fr.cara + '.webp" alt=""><p class="vj-globo">' + esc(fr.txt) + '</p></div>' +
        extra +
        '<div class="vj-botones"><button type="button" class="vj-btn" data-a="jugar">Otra vez <kbd>Enter</kbd></button>' +
        (web ? '<button type="button" class="vj-btn2" data-a="compartir">Desafiá a alguien</button>' : '') +
        '<button type="button" class="vj-btn2" data-a="salir">Salir <kbd>Esc</kbd></button></div>' +
        (web ? '<a class="vj-cta" href="/empezar.html">¿Tenés un kiosco? Probá Ventra 7 días gratis →</a>' : '') +
      '</div>' +
    '</div>';
  }

  var capa = null;
  function mostrarCapa(html) {
    if (!capa) return;
    capa.innerHTML = html;
    capa.classList.add('on');
    capa.scrollTop = 0;
  }
  function ocultarCapa() { if (capa) { capa.classList.remove('on'); capa.innerHTML = ''; } }

  function mostrarFin() {
    mostrarCapa(htmlFin());
    SON.impresora();
    if (J.record && J.total > 0) {
      setTimeout(function () {
        if (!abierto || !J || J.estado !== 'fin') return;
        SON.record();
        chispas(W * 0.3, 140, 40, ['#ffd23f', VCLARO, '#ff8fc0', '#ffffff'], 520);
        chispas(W * 0.7, 140, 40, ['#ffd23f', VCLARO, '#ff8fc0', '#ffffff'], 520);
      }, 1250);
    }
  }

  function compartir(boton) {
    var txt = 'Vendí ' + plata(J.total) + ' en Hora pico, el juego secreto de Ventri 🧾 ¿Me ganás?';
    var url = location.origin + '/#jugar';
    if (navigator.share) { navigator.share({ title: 'Ventri · Hora pico', text: txt, url: url }).catch(function () {}); return; }
    var listo = function () { boton.textContent = '¡Copiado! Pegalo donde quieras'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt + ' ' + url).then(listo, function () {});
  }

  // ---------------------------------------------------------------- estados
  function menu() {
    J = nuevoJuego(true); P.length = 0; T.length = 0;
    cambiarCielo('tarde');
    mostrarCapa(htmlMenu());
  }
  function empezar() {
    audio();  // el sonido se habilita con este click o tecla
    ocultarCapa();
    J = nuevoJuego(false); P.length = 0; T.length = 0;
    raiz.classList.add('vj-juega');
    cambiarCielo('manana');
    cartel('08:00', '¡Abrimos la persiana!', '#ffffff', 1.6);
    SON.hora();
    cuadros = 0; acum = 0;
  }
  function pausar() {
    if (!J || J.estado !== 'jugando') return;
    J.estado = 'pausa'; teclas.izq = teclas.der = false;
    raiz.classList.remove('vj-juega');
    mostrarCapa(htmlPausa());
  }
  function seguir() {
    if (!J || J.estado !== 'pausa') return;
    ocultarCapa(); J.estado = 'jugando'; raiz.classList.add('vj-juega'); ultimo = 0;
  }
  function alternarSonido() {
    datos.mudo = !datos.mudo; guardar();
    if (datos.mudo && AC && AC.state === 'running') { try { AC.suspend(); } catch (e) { /* nada */ } }
    var b = raiz && raiz.querySelector('[data-a="sonido"]');
    if (b) b.innerHTML = datos.mudo ? ICO.mudo : ICO.sonido;
  }

  // ---------------------------------------------------------------- teclado, mouse y lector
  // El lector de códigos escribe dígitos muy rápido (menos de 45 ms entre uno y otro): si pasa
  // eso, es que llegó un cliente. Se traga el código entero (hasta el Enter) y se cierra el juego,
  // así el código no entra a medias en la venta.
  var lect = { n: 0, t: 0, tragando: false, timer: 0 };
  function lector(e) {
    var ahora = Date.now();
    if (lect.tragando) {
      clearTimeout(lect.timer);
      if (e.key === 'Enter' || e.key === 'Tab') cerrar('cliente');
      else lect.timer = setTimeout(function () { cerrar('cliente'); }, 250);
      return true;
    }
    if (/^[0-9]$/.test(e.key)) {
      lect.n = ahora - lect.t < 45 ? lect.n + 1 : 1; lect.t = ahora;
      if (lect.n >= 4) { lect.tragando = true; lect.timer = setTimeout(function () { cerrar('cliente'); }, 250); return true; }
    } else lect.n = 0;
    return false;
  }

  function alTeclear(e) {
    if (!abierto) return;
    // Mientras se juega, ninguna tecla le llega a la página (ni a los atajos de la caja)
    e.stopImmediatePropagation(); e.preventDefault();
    if (lector(e)) return;
    var k = e.key;
    if (k === 'Escape') { cerrar('salir'); return; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { teclas.izq = true; if (J) J.teclado = true; return; }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { teclas.der = true; if (J) J.teclado = true; return; }
    if (e.repeat) return;
    if (k === 'm' || k === 'M') { alternarSonido(); return; }
    if (k === 'p' || k === 'P') { if (J.estado === 'pausa') seguir(); else pausar(); return; }
    if (k === 'Enter' || k === ' ') {
      if (J.estado === 'menu') empezar();
      else if (J.estado === 'pausa') seguir();
      else if (J.estado === 'fin' && J.finMostrado && J.finT > 1.6) empezar();
    }
  }
  function alSoltar(e) {
    if (!abierto) return;
    e.stopImmediatePropagation(); e.preventDefault();
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') teclas.izq = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') teclas.der = false;
  }
  function tragar(e) { if (abierto) { e.stopImmediatePropagation(); e.preventDefault(); } }

  function alPuntero(e) {
    if (!J || J.demo || J.estado !== 'jugando' || !cv) return;
    var r = cv.getBoundingClientRect();
    if (!r.width) return;
    J.meta = clamp((e.clientX - r.left) / r.width * W, 0, W);
    J.teclado = false;
  }
  function alClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-a]') : null;
    if (!b) return;
    var a = b.getAttribute('data-a');
    if (a === 'jugar') empezar();
    else if (a === 'seguir') seguir();
    else if (a === 'salir') cerrar('salir');
    else if (a === 'pausa') { if (J.estado === 'pausa') seguir(); else pausar(); }
    else if (a === 'sonido') alternarSonido();
    else if (a === 'compartir') compartir(b);
  }
  var tRedim = 0;
  function alRedimensionar() { clearTimeout(tRedim); tRedim = setTimeout(function () { if (abierto) medir(); }, 120); }
  function alPerderFoco() { if (document.hidden || !document.hasFocus()) pausar(); }

  function escuchar(on) {
    var f = on ? 'addEventListener' : 'removeEventListener';
    window[f]('keydown', alTeclear, true);
    window[f]('keyup', alSoltar, true);
    window[f]('keypress', tragar, true);
    window[f]('resize', alRedimensionar);
    window[f]('blur', alPerderFoco);
    document[f]('visibilitychange', alPerderFoco);
  }

  // ---------------------------------------------------------------- abrir y cerrar
  var ICO = {
    sonido: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    mudo: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>',
    pausa: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
    cerrar: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  var abierto = false, opciones = {}, raiz = null, cv = null, ctx = null, raf = 0, ultimo = 0, overflowAntes = '';

  function bucle(ts) {
    if (!abierto) return;
    raf = requestAnimationFrame(bucle);
    var dt = ultimo ? (ts - ultimo) / 1000 : 1 / 60;
    ultimo = ts;
    if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;
    reloj += dt;
    // Por si la ventana cambió de tamaño sin avisar (minimizada, panel oculto, otra pantalla)
    if (++chequeo % 30 === 0 && (window.innerWidth !== medida[0] || window.innerHeight !== medida[1])) medir();
    if (J.estado !== 'pausa') actualizar(dt);
    if (fundido > 0) { fundido -= dt / 1.4; if (fundido <= 0) { fundido = 0; fondoViejo = null; } }
    rendimiento(dt);
    dibujar();
  }

  function abrir(op) {
    if (abierto) return false;
    abierto = true; opciones = op || {};
    leerDatos(); estilos(); cargarCaras();
    raiz = document.createElement('div');
    raiz.className = 'vj keep-style keep-animated';
    raiz.setAttribute('role', 'dialog');
    raiz.setAttribute('aria-label', 'Ventri: Hora pico');
    raiz.tabIndex = -1;
    raiz.innerHTML = '<canvas class="vj-cv"></canvas>' +
      '<div class="vj-barra">' +
        '<button type="button" class="vj-ico" data-a="sonido" title="Sonido (M)" aria-label="Sonido">' + (datos.mudo ? ICO.mudo : ICO.sonido) + '</button>' +
        '<button type="button" class="vj-ico" data-a="pausa" title="Pausa (P)" aria-label="Pausa">' + ICO.pausa + '</button>' +
        '<button type="button" class="vj-ico" data-a="salir" title="Salir (Esc)" aria-label="Salir">' + ICO.cerrar + '</button>' +
      '</div><div class="vj-capa"></div>';
    document.body.appendChild(raiz);
    cv = raiz.querySelector('.vj-cv');
    ctx = cv.getContext('2d', { alpha: false });
    capa = raiz.querySelector('.vj-capa');
    raiz.addEventListener('pointermove', alPuntero);
    raiz.addEventListener('pointerdown', alPuntero);
    raiz.addEventListener('click', alClick);
    overflowAntes = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    cieloActual = 'tarde'; fondo = null;
    medir();
    menu();
    escuchar(true);
    try { raiz.focus({ preventScroll: true }); } catch (e) { /* sin foco */ }
    ultimo = 0; raf = requestAnimationFrame(bucle);
    return true;
  }

  function cerrar(motivo) {
    if (!abierto) return;
    abierto = false;
    cancelAnimationFrame(raf);
    escuchar(false);
    clearTimeout(lect.timer); clearTimeout(tRedim);
    lect.tragando = false; lect.n = 0;
    teclas.izq = teclas.der = false;
    if (raiz && raiz.parentNode) raiz.parentNode.removeChild(raiz);
    raiz = cv = ctx = capa = null;
    fondo = fondoViejo = toldo = null; SPR = {}; CARA = {};
    J = null; P = []; T = [];
    document.documentElement.style.overflow = overflowAntes;
    if (AC && AC.state === 'running') { try { AC.suspend(); } catch (e) { /* nada */ } }
    var cb = opciones.alCerrar; opciones = {};
    if (typeof cb === 'function') { try { cb(motivo || 'salir'); } catch (e) { /* nada */ } }
  }

  // ---------------------------------------------------------------- estilos
  function estilos() {
    if (document.getElementById('vj-estilos')) return;
    var F = FUENTE.replace(/"/g, "'");
    var css = '' +
      '.vj{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;background:#08110e;display:flex;align-items:center;justify-content:center;overflow:hidden;font-family:' + F + ';color:#0F1F1A;-webkit-user-select:none;user-select:none;outline:0;-webkit-tap-highlight-color:transparent;line-height:1.35;letter-spacing:normal;text-align:left;text-transform:none}' +
      '.vj *{box-sizing:border-box}' +
      '.vj .vj-cv{display:block;touch-action:none;max-width:none}' +
      '.vj.vj-juega .vj-cv{cursor:none}' +
      '.vj .vj-barra{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:4}' +
      '.vj .vj-ico{width:40px;height:40px;border-radius:12px;border:0;margin:0;padding:0;background:rgba(10,26,21,.74);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:none;color:#fff}' +
      '.vj .vj-ico:hover{background:#167160}' +
      '.vj .vj-ico svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;display:block}' +
      '.vj .vj-capa{position:absolute;top:0;left:0;right:0;bottom:0;display:none;padding:60px 16px 16px;overflow:auto;z-index:3;background:rgba(6,14,11,.5)}' +
      '.vj .vj-capa.on{display:flex}' +
      '.vj .vj-card{margin:auto;background:#F7F3EC;color:#0F1F1A;border-radius:24px;padding:22px 24px;width:100%;max-width:800px;box-shadow:0 0 0 3px #0F1F1A,0 30px 70px -18px rgba(0,0,0,.65);animation:vj-entra .4s cubic-bezier(.34,1.45,.64,1) both}' +
      '@keyframes vj-entra{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:none}}' +
      '.vj .vj-menu{display:grid;grid-template-columns:1fr 1.05fr;gap:22px;align-items:start}' +
      '@media (max-width:780px){.vj .vj-menu{grid-template-columns:1fr;gap:6px}.vj .vj-card{padding:18px}}' +
      '.vj .vj-hola{display:flex;align-items:flex-end;gap:10px;margin:0 0 12px}' +
      '.vj .vj-cara{height:96px;width:auto;flex:none;display:block;max-width:none;margin:0}' +
      '.vj .vj-globo{margin:0 0 34px;background:#fff;border:2px solid #0F1F1A;border-radius:16px 16px 16px 4px;padding:9px 12px;font-size:13.5px;font-weight:600;line-height:1.35;color:#0F1F1A}' +
      '.vj .vj-kicker{margin:0;font-size:11.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#167160}' +
      '.vj .vj-titulo{margin:2px 0 8px;font-size:46px;line-height:1;font-weight:900;color:#0F1F1A;letter-spacing:-.02em;font-family:inherit}' +
      '.vj .vj-sub{margin:0 0 16px;font-size:14px;line-height:1.45;color:#3b4a44}' +
      '.vj .vj-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:54px;border:0;border-radius:16px;background:#167160;color:#fff;font:900 19px/1 ' + F + ';cursor:pointer;box-shadow:0 5px 0 #0c4a3e;transition:transform .08s,box-shadow .08s;margin:0;padding:0 18px;text-transform:none;letter-spacing:normal}' +
      '.vj .vj-btn:hover{background:#1a8470}' +
      '.vj .vj-btn:active{transform:translateY(4px);box-shadow:0 1px 0 #0c4a3e}' +
      '.vj .vj-btn2{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:46px;border:2px solid #0F1F1A;border-radius:14px;background:#fff;color:#0F1F1A;font:800 15px/1 ' + F + ';cursor:pointer;margin:0;padding:0 16px;box-shadow:none;text-transform:none;letter-spacing:normal}' +
      '.vj .vj-btn2:hover{background:#eef7f3}' +
      '.vj kbd{font:700 11px/1 ' + F + ';background:rgba(255,255,255,.2);border-radius:6px;padding:4px 6px;color:inherit;border:0;box-shadow:none}' +
      '.vj .vj-btn2 kbd{background:rgba(15,31,26,.08)}' +
      '.vj .vj-ayuda{margin:10px 0 0;font-size:12px;color:#5b6b64;text-align:center}' +
      '.vj .vj-bloque{background:#fff;border:2px solid rgba(15,31,26,.12);border-radius:16px;padding:11px 14px;margin:0 0 10px}' +
      '.vj .vj-h{margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#5b6b64}' +
      '.vj .vj-ley{display:flex;align-items:center;gap:8px;margin-top:4px}' +
      '.vj .vj-ley b{width:70px;flex:none;font-size:13px;font-weight:800}' +
      '.vj .vj-ley span{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px}' +
      '.vj .vj-ok b{color:#167160}.vj .vj-mal b{color:#c92a3a}.vj .vj-ay b{color:#1e6fc2}' +
      '.vj .vj-ley img{width:32px;height:32px;display:inline-block;max-width:none;margin:0}' +
      '.vj .vj-chip{display:inline-flex;align-items:center;gap:2px;font-size:12px;font-weight:600;color:#33433d}' +
      '.vj .vj-chip img{width:28px;height:28px}' +
      '.vj .vj-mis{list-style:none;margin:0;padding:0}' +
      '.vj .vj-mis li{display:flex;gap:8px;align-items:center;font-size:13.5px;font-weight:600;padding:5px 0;border-top:1px dashed rgba(15,31,26,.15);margin:0;color:#0F1F1A}' +
      '.vj .vj-mis li:first-child{border-top:0}' +
      '.vj .vj-est{flex:none;font-size:11.5px;font-weight:900;color:#8a5a00;background:#fff3c4;border-radius:999px;padding:2px 7px}' +
      '.vj .vj-rango{display:flex;justify-content:space-between;gap:10px;font-size:14px}' +
      '.vj .vj-rango span{color:#8a5a00;font-weight:800}' +
      '.vj .vj-prog{height:8px;background:rgba(15,31,26,.1);border-radius:99px;margin-top:7px;overflow:hidden}' +
      '.vj .vj-prog i{display:block;height:100%;min-width:6px;background:linear-gradient(90deg,#167160,#7FE3B8);border-radius:99px}' +
      '.vj .vj-chico{margin:6px 0 0;font-size:12px;color:#5b6b64}' +
      '.vj .vj-record{margin:2px 2px 0;font-size:13px;color:#33433d}' +
      '.vj .vj-chica{max-width:360px;text-align:center}' +
      '.vj .vj-chica .vj-cara{margin:0 auto 8px;height:110px}' +
      '.vj .vj-botones{display:flex;flex-direction:column;gap:10px;margin-top:14px}' +
      // Fin: el ticket sale de la impresora
      '.vj .vj-fin{display:flex;gap:28px;align-items:center;justify-content:center;flex-wrap:wrap;margin:auto;width:100%;max-width:760px}' +
      '.vj .vj-imp{width:300px;max-width:100%;flex:none}' +
      '.vj .vj-ranura{height:18px;border-radius:10px;background:#1b2421;box-shadow:inset 0 4px 0 rgba(0,0,0,.55),0 0 0 3px #3a4a44;position:relative;z-index:2}' +
      '.vj .vj-papel{overflow:hidden;margin:-9px 12px 0}' +
      '.vj .vj-ticket{background:#FBF8F1;color:#1d1915;font:13px/1.5 ' + MONO + ';padding:22px 16px 28px;animation:vj-imprime 1.15s steps(15) both}' +
      '@keyframes vj-imprime{from{transform:translateY(-100%)}to{transform:none}}' +
      '.vj .vj-t-logo{font:900 26px/1.1 ' + F + ';color:#167160;text-align:center;letter-spacing:.06em}' +
      '.vj .vj-t-c{text-align:center}' +
      '.vj .vj-t-chico{font-size:11.5px;color:#6b6258}' +
      '.vj .vj-t-raya{border-top:2px dashed #b9b0a3;margin:7px 0}' +
      '.vj .vj-l{display:flex;justify-content:space-between;gap:10px}' +
      '.vj .vj-l span:last-child{white-space:nowrap}' +
      '.vj .vj-t-total{font-weight:900;font-size:18px}' +
      '.vj .vj-sello{margin:10px auto 6px;width:max-content;transform:rotate(-6deg);border:3px solid #d62839;color:#d62839;font:900 15px/1.2 ' + F + ';padding:4px 10px;border-radius:8px;letter-spacing:.06em}' +
      '.vj .vj-t-m{color:#167160;font-weight:700;margin-top:4px}' +
      '.vj .vj-t-barras{height:36px;margin:10px 16px 0}' +
      '.vj .vj-lado{width:340px;max-width:100%}' +
      '.vj .vj-lado .vj-globo{margin-bottom:30px}' +
      '.vj .vj-logro{background:#fff3c4;border:2px solid #f2c230;border-radius:14px;padding:10px 14px;margin:0 0 10px;font-size:14px;font-weight:600;color:#0F1F1A;animation:vj-entra .4s .9s both}' +
      '.vj .vj-cta{display:block;text-align:center;margin-top:14px;font-size:13.5px;font-weight:700;color:#7FE3B8;text-decoration:underline}' +
      '@media (prefers-reduced-motion:reduce){.vj .vj-card,.vj .vj-ticket,.vj .vj-logro{animation:none}}';
    var st = document.createElement('style');
    st.id = 'vj-estilos'; st.textContent = css;
    document.head.appendChild(st);
  }

  window.ventriJuego = { abrir: abrir, cerrar: function () { cerrar('salir'); }, abierto: function () { return abierto; } };
})();

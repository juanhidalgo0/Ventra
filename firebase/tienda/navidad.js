/* Modo navidad de Ventra (web, caja, tiendas online y GO usan este mismo archivo).
 * Se prende solo del 1 de diciembre al 6 de enero. Nada que publicar para encenderlo o apagarlo.
 *
 * Se configura con atributos en el <script>:
 *   data-gorro=".sel, .sel"   logos que llevan gorrito (se dibuja por encima, sin tocar el logo)
 *   data-luces=".sel"         elemento debajo del que cuelga la guirnalda de luces (data-luces-chicas: más finita)
 *   En la página: [data-nv-gorro] lleva gorrito aunque el logo esté apagado; [data-nv-cuenta hidden] se llena
 *   con los días que faltan para Navidad y se muestra.
 *   data-saludo="24"          cartelito "Faltan X días para Navidad" una vez por día, a N px del borde de abajo
 *   data-arbolito="right:20px;bottom:96px"  arbolito quieto en esa esquina: aparece el 8/12 y suma
 *                             una bolita por día hasta el 24; el 25 tiene la estrella
 *   data-brindis              el 24 y el 31 desde las 20 h (hasta las 2): cartel de brindis y fuegos chiquitos
 *   data-sin-efectos="pos|x"  rutas (hash o path) donde no aparece el cartel, el arbolito ni el brindis
 *   data-apagado=".clase"     si <html> tiene esta clase, no se muestra nada (ej. repartidores)
 *
 * Para probarlo fuera de fecha: ?navidad=1 (se ve como un 13/12) y ?navidad_fecha=12-24-21 (mes-día-hora).
 * ?navidad=0 vuelve a lo normal. Quien no lo quiera: ventraNavidad.apagar() en la consola.
 */
(function () {
  var s = document.currentScript; if (!s || window.ventraNavidad) return;
  var at = function (n) { return s.getAttribute('data-' + n); };
  var cfg = {
    gorro: at('gorro') || '',
    luces: at('luces') || '',
    lucesChicas: s.hasAttribute('data-luces-chicas'),
    saludo: at('saludo'),
    arbolito: at('arbolito'),
    brindis: s.hasAttribute('data-brindis'),
    sinEfectos: at('sin-efectos') || at('sin-nieve') || '',
    apagado: at('apagado') || ''
  };
  var root = document.documentElement;

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { } }

  var q = location.search + '&' + location.hash;
  var mF = /[?&]navidad=([01])/.exec(q); if (mF) ss('navidad_forzar', mF[1]);
  var mD = /[?&]navidad_fecha=(\d{1,2})-(\d{1,2})(?:-(\d{1,2}))?/.exec(q); if (mD) { ss('navidad_forzar', '1'); ss('navidad_fecha', mD[1] + '-' + mD[2] + '-' + (mD[3] || 12)); }
  if (ss('navidad_forzar') === '0') ss('navidad_fecha', '');

  function enTemporada(d) { return d.getMonth() === 11 || (d.getMonth() === 0 && d.getDate() <= 6); }
  // La fecha "de hoy" (simulada cuando se está probando)
  function ahora() {
    var d = new Date(), f = ss('navidad_fecha');
    if (f) { var p = f.split('-'); return new Date(d.getFullYear(), +p[0] - 1, +p[1], +p[2], d.getMinutes()); }
    if (ss('navidad_forzar') === '1' && !enTemporada(d)) return new Date(d.getFullYear(), 11, 13, d.getHours(), d.getMinutes());
    return d;
  }
  var probando = !!ss('navidad_fecha') || (ss('navidad_forzar') === '1' && !enTemporada(new Date()));

  window.ventraNavidad = {
    apagar: function () { ls('navidad_off', '1'); location.reload(); },
    prender: function () { ls('navidad_off', null); location.reload(); }
  };
  if (ss('navidad_forzar') === '0' || !enTemporada(ahora()) || ls('navidad_off') === '1') return;

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function apagadoAhora() { return cfg.apagado && root.classList.contains(cfg.apagado.replace(/^\./, '')); }
  function rutaSinEfectos() { return !!cfg.sinEfectos && new RegExp(cfg.sinEfectos, 'i').test(location.hash + ' ' + location.pathname); }
  root.classList.add('navidad');

  /* ---------- Estilos ---------- */
  var FONT = '"Plus Jakarta Sans",system-ui,sans-serif';
  var css = ''
    + '.nv-gorro{position:fixed;left:0;top:0;pointer-events:none;z-index:2147483000;transform-origin:30% 90%;transition:opacity .2s;will-change:transform}'
    + '.nv-gorro svg{display:block;width:100%;height:auto;filter:drop-shadow(0 2px 2px rgba(0,0,0,.18))}'
    + '.nv-luces{position:absolute;left:0;right:0;top:100%;height:20px;pointer-events:none;z-index:1;overflow:hidden;'
    + 'background:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2744%27 height=%2712%27%3E%3Cpath d=%27M0 1.5 Q22 9 44 1.5%27 fill=%27none%27 stroke=%27%23314a3f%27 stroke-width=%271.4%27/%3E%3C/svg%3E") repeat-x 0 0}'
    + '.nv-luces i{position:absolute;top:5px;width:7px;height:11px;margin-left:-3.5px;border-radius:50% 50% 50% 50%/40% 40% 60% 60%;background:var(--c);box-shadow:0 0 6px 1px var(--c);animation:nvBrillo 2.4s ease-in-out infinite}'
    + '.nv-luces i:before{content:"";position:absolute;left:1.5px;top:-3px;width:4px;height:3px;border-radius:1px;background:#3b4a43}'
    + '.nv-luces.chica{height:15px;background-size:34px 9px}'
    + '.nv-luces.chica i{top:3px;width:5px;height:8px;margin-left:-2.5px;box-shadow:0 0 4px 0 var(--c)}'
    + '.nv-luces.chica i:before{left:1px;top:-2px;width:3px;height:2px}'
    + '@keyframes nvBrillo{0%,100%{opacity:1}50%{opacity:.35;box-shadow:none}}'
    // Cartelitos (saludo del día, brindis y el del arbolito)
    + '.nv-cartel{position:fixed;left:0;right:0;margin:0 auto;width:min(390px,calc(100vw - 24px));box-sizing:border-box;z-index:2147483647;display:flex;align-items:center;gap:12px;'
    + 'padding:14px 10px 14px 12px;border-radius:18px;overflow:hidden;background:#fff;color:#13241C;font-family:' + FONT + ';text-align:left;'
    + 'box-shadow:0 22px 44px -20px rgba(12,40,28,.5),0 0 0 1px rgba(12,40,28,.07);'
    + 'transform:translateY(22px) scale(.97);opacity:0;transition:transform .5s cubic-bezier(.25,1.4,.5,1),opacity .3s}'
    + '.nv-cartel.on{transform:none;opacity:1}'
    // franja de bastón navideño arriba
    + '.nv-cartel:before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:repeating-linear-gradient(-45deg,#D62839 0 7px,#fff 7px 11px,#1F7A4D 11px 18px,#fff 18px 22px)}'
    + '.nv-ic{flex:none;width:48px;height:52px;border-radius:13px;background:#FFF4EC;display:flex;align-items:center;justify-content:center;font-size:27px;line-height:1}'
    + '.nv-ic.cal{flex-direction:column;justify-content:flex-start;background:#fff;box-shadow:0 0 0 1px #ECEFEC,0 4px 10px -6px rgba(0,0,0,.25);overflow:hidden}'
    + '.nv-ic.cal i{display:block;width:100%;padding:3px 0 2px;background:#D62839;color:#fff;font:800 9px/1 ' + FONT + ';letter-spacing:.12em;text-align:center;font-style:normal}'
    + '.nv-ic.cal b{flex:1;display:flex;align-items:center;font:800 23px/1 ' + FONT + ';color:#13241C;letter-spacing:-.02em}'
    + '.nv-tx{flex:1;min-width:0}'
    + '.nv-tx strong{display:block;font:750 15px/1.25 ' + FONT + ';letter-spacing:-.01em}'
    + '.nv-tx span{display:block;margin-top:3px;font:500 12.5px/1.35 ' + FONT + ';color:#5E6E66}'
    + '.nv-x{flex:none;align-self:flex-start;width:28px;height:28px;margin:-4px 0 0;border:0;border-radius:9px;background:transparent;color:#93A29A;font:400 20px/1 system-ui;cursor:pointer}'
    + '.nv-x:hover{background:rgba(0,0,0,.05);color:#13241C}'
    + '.nv-barra{position:absolute;left:0;bottom:0;height:3px;width:100%;background:#1F7A4D;opacity:.28;transform-origin:left;animation:nvBarra linear forwards}'
    + '@keyframes nvBarra{from{transform:scaleX(1)}to{transform:scaleX(0)}}'
    // versión de brindis: oscura con dorado
    + '.nv-cartel.oscuro{background:radial-gradient(130% 160% at 0% 0%,#1E5E47 0%,#0D2E23 55%,#07160F 100%);color:#fff;box-shadow:0 24px 50px -18px rgba(0,0,0,.6),0 0 0 1px rgba(255,214,120,.25)}'
    + '.nv-cartel.oscuro:before{background:linear-gradient(90deg,transparent,#FFD978 20%,#FFF1C4 50%,#FFD978 80%,transparent);height:2px}'
    + '.nv-cartel.oscuro .nv-ic{background:rgba(255,214,120,.12);box-shadow:inset 0 0 0 1px rgba(255,214,120,.45)}'
    + '.nv-cartel.oscuro strong{color:#FFE7A3}'
    + '.nv-cartel.oscuro .nv-tx span{color:#C7D7CE}'
    + '.nv-cartel.oscuro .nv-x{color:#9FB5AA}.nv-cartel.oscuro .nv-x:hover{background:rgba(255,255,255,.08);color:#fff}'
    + '.nv-cartel.oscuro .nv-barra{background:#FFD978;opacity:.5}'
    + '@media (max-width:480px){.nv-cartel{padding:12px 8px 12px 10px;gap:10px;border-radius:16px}.nv-ic{width:44px;height:48px}.nv-tx strong{font-size:14px}}'
    // Arbolito
    + '.nv-arbol{position:fixed;z-index:2147482500;width:54px;height:64px;padding:0;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;'
    + 'filter:drop-shadow(0 4px 6px rgba(0,0,0,.22));transition:transform .2s,opacity .25s}'
    + '.nv-arbol:hover{transform:translateY(-2px) rotate(-3deg)}'
    + '.nv-con-cartel .nv-arbol{opacity:0;pointer-events:none}'
    + '.nv-arbol svg{display:block;width:100%;height:100%}'
    + '.nv-arbol .nueva{transform-box:fill-box;transform-origin:center;animation:nvPop .7s cubic-bezier(.3,1.8,.5,1) 1.2s both}'
    + '@keyframes nvPop{from{transform:scale(0)}to{transform:scale(1)}}'
    + '.nv-arbol-tip{position:fixed;z-index:2147483001;width:220px;box-sizing:border-box;padding:12px 14px 11px;border-radius:14px;overflow:hidden;background:#fff;color:#13241C;font:700 14px/1.3 ' + FONT + ';'
    + 'box-shadow:0 18px 40px -18px rgba(12,40,28,.5),0 0 0 1px rgba(12,40,28,.07);opacity:0;transform:translateY(6px);transition:opacity .2s,transform .2s;pointer-events:none}'
    + '.nv-arbol-tip:before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:repeating-linear-gradient(-45deg,#D62839 0 7px,#fff 7px 11px,#1F7A4D 11px 18px,#fff 18px 22px)}'
    + '.nv-arbol-tip.on{opacity:1;transform:none}'
    + '.nv-arbol-tip small{display:block;font-weight:500;font-size:12.5px;color:#5E6E66;margin-top:3px}'
    + '.nv-fuegos{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147482000}'
    + '@media (prefers-reduced-motion:reduce){.nv-luces i,.nv-arbol .nueva{animation:none}.nv-cartel{transition:opacity .3s}}';
  var st = document.createElement('style'); st.textContent = css; (document.head || root).appendChild(st);

  /* ---------- Gorrito sobre los logos ---------- */
  var GORRO = '<svg viewBox="0 0 100 84" aria-hidden="true">'
    + '<path d="M12 66C20 36 42 10 68 9c15-.6 24 10 26 25-8-7-18-9-24-3-6 8-4 22 0 35z" fill="#D62839"/>'
    + '<path d="M40 66c4-20 14-35 30-35-6 8-4 22 0 35z" fill="#A81D2C"/>'
    + '<circle cx="92" cy="38" r="9.5" fill="#fff" stroke="#e3e6ea" stroke-width="1.5"/>'
    + '<rect x="4" y="59" width="76" height="19" rx="9.5" fill="#fff" stroke="#e3e6ea" stroke-width="1.5"/>'
    + '</svg>';
  var gorros = []; // { el, hat }

  function buscarLogos() {
    if (!cfg.gorro) return;
    var lista = document.querySelectorAll(cfg.gorro);
    gorros = gorros.filter(function (g) { if (g.el.isConnected) return true; g.hat.remove(); return false; });
    for (var i = 0; i < lista.length && gorros.length < 6; i++) {
      var el = lista[i];
      if (gorros.some(function (g) { return g.el === el; })) continue;
      var h = document.createElement('div'); h.className = 'nv-gorro'; h.innerHTML = GORRO; h.style.opacity = '0';
      document.body.appendChild(h);
      gorros.push({ el: el, hat: h });
    }
    ubicar();
  }

  // Solo se ve si el logo está visible y nada lo tapa (modales, barras, etc.)
  function visible(el, r) {
    if (r.width < 22 || r.height < 22 || r.bottom < 0 || r.top > innerHeight) return false;
    var top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top || !(top === el || el.contains(top) || top.contains(el))) return false;
    for (var n = el, k = 0; n && k < 4; n = n.parentElement, k++) {
      var cs = getComputedStyle(n);
      if (el.hasAttribute('data-nv-gorro')) break; // marcado a propósito: va con gorrito aunque esté tenue
      if (Number(cs.opacity) < 0.6 || cs.visibility === 'hidden' || /grayscale/.test(cs.filter)) return false;
    }
    return true;
  }

  function ubicar() {
    var off = apagadoAhora();
    gorros.forEach(function (g) {
      var r = g.el.getBoundingClientRect();
      if (off || !visible(g.el, r)) { g.hat.style.opacity = '0'; return; }
      var w = Math.round(Math.max(r.width, r.height) * 0.85);
      g.hat.style.width = w + 'px';
      g.hat.style.transform = 'translate(' + Math.round(r.left + r.width * 0.3 - w * 0.15) + 'px,' + Math.round(r.top - w * 0.5) + 'px) rotate(14deg)';
      g.hat.style.opacity = '1';
    });
    if (arbol) arbol.style.display = off || rutaSinEfectos() ? 'none' : '';
  }

  var pend = false;
  function pedirUbicar() { if (pend) return; pend = true; requestAnimationFrame(function () { pend = false; ubicar(); }); }

  /* ---------- Luces debajo de la barra ---------- */
  var COLORES = ['#E63946', '#FFC93C', '#2EC46D', '#3FA7F5', '#FF7AB6'];
  function colgarLuces() {
    if (!cfg.luces || apagadoAhora()) return;
    var el = document.querySelector(cfg.luces);
    if (!el || el.querySelector(':scope > .nv-luces')) return;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var tira = document.createElement('div'); tira.className = 'nv-luces' + (cfg.lucesChicas ? ' chica' : ''); tira.setAttribute('aria-hidden', 'true');
    var h = ''; // 90 lamparitas alcanzan para pantallas de hasta 4000 px (al cargar en segundo plano el ancho puede dar 0)
    for (var i = 0; i < 90; i++) {
      h += '<i style="left:' + (i * (cfg.lucesChicas ? 34 : 44) + (cfg.lucesChicas ? 17 : 22)) + 'px;--c:' + COLORES[i % COLORES.length] + ';animation-delay:' + ((i * 0.37) % 2.4).toFixed(2) + 's"></i>';
    }
    tira.innerHTML = h;
    el.appendChild(tira);
  }

  /* ---------- Cartelitos ---------- */
  // icono: emoji, o un número para la hojita de almanaque de diciembre
  function cartel(abajo, icono, titulo, sub, oscuro, ms) {
    ms = ms || 6000;
    var el = document.createElement('div'); el.className = 'nv-cartel' + (oscuro ? ' oscuro' : ''); el.setAttribute('role', 'status');
    el.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + ' + (Number(abajo) || 24) + 'px)';
    var ic = typeof icono === 'number'
      ? '<div class="nv-ic cal" aria-hidden="true"><i>DIC</i><b>' + icono + '</b></div>'
      : '<div class="nv-ic" aria-hidden="true">' + icono + '</div>';
    el.innerHTML = ic + '<div class="nv-tx"><strong>' + titulo + '</strong><span>' + sub + '</span></div>'
      + '<button type="button" class="nv-x" aria-label="Cerrar">×</button><i class="nv-barra" style="animation-duration:' + ms + 'ms"></i>';
    document.body.appendChild(el);
    root.classList.add('nv-con-cartel'); // mientras está el cartel, el arbolito se corre para no taparse
    var hecho = false, cerrar = function () {
      if (hecho) return; hecho = true; el.classList.remove('on');
      setTimeout(function () { el.remove(); if (!document.querySelector('.nv-cartel')) root.classList.remove('nv-con-cartel'); }, 450);
    };
    el.querySelector('.nv-x').addEventListener('click', cerrar);
    void el.offsetWidth; el.classList.add('on'); // fuerza el estilo inicial para que entre con transición
    setTimeout(cerrar, ms);
  }
  function diasParaNavidad(d) { return Math.round((new Date(d.getFullYear(), 11, 25) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); }

  // Textos chicos que la página pide con [data-nv-cuenta] (ej. el carrito vacío de la caja)
  function textoCorto(d) {
    var m = d.getMonth(), dia = d.getDate(), f = diasParaNavidad(d);
    if (m === 11 && f > 1) return '🎄 Faltan ' + f + ' días para Navidad';
    if (m === 11 && f === 1) return '🎄 ¡Hoy es Nochebuena!';
    if (m === 11 && f === 0) return '🎅 ¡Feliz Navidad!';
    if (m === 11 && dia === 31) return '🥂 ¡Último día del año!';
    if (m === 11) return '✨ Felices fiestas';
    return '🎉 ¡Feliz ' + d.getFullYear() + '!';
  }
  function llenarCuentas() {
    var els = document.querySelectorAll('[data-nv-cuenta]');
    if (!els.length) return;
    var t = textoCorto(ahora());
    for (var i = 0; i < els.length; i++) { if (els[i].textContent !== t) els[i].textContent = t; els[i].hidden = false; }
  }

  function textoDelDia(d) {
    var m = d.getMonth(), dia = d.getDate();
    if (m === 11 && dia < 24) return [diasParaNavidad(d), 'Faltan ' + diasParaNavidad(d) + ' días para Navidad', 'Felices fiestas de parte de Ventra 🎄'];
    if (m === 11 && dia === 24) return ['🎄', '¡Hoy es Nochebuena!', 'Felices fiestas te desea Ventra'];
    if (m === 11 && dia === 25) return ['🎅', '¡Feliz Navidad!', 'Que tengas un gran día'];
    if (m === 11 && dia === 31) return ['🥂', '¡Último día del año!', 'Gracias por elegirnos en ' + d.getFullYear()];
    if (m === 11) return ['✨', 'Felices fiestas', 'Que cierres el año con todo'];
    if (m === 0 && dia === 6) return ['👑', '¡Feliz día de Reyes!', 'Feliz ' + d.getFullYear()];
    return ['🎉', '¡Feliz ' + d.getFullYear() + '!', 'Que sea un gran año para tu negocio'];
  }
  function saludar() {
    if (cfg.saludo == null || apagadoAhora() || rutaSinEfectos()) return;
    var d = ahora(), hoy = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    if (!probando && ls('navidad_saludo') === hoy) return; // una vez por día
    ls('navidad_saludo', hoy);
    var t = textoDelDia(d);
    setTimeout(function () { cartel(cfg.saludo, t[0], t[1], t[2]); }, 1800);
  }

  /* ---------- Arbolito: se arma el 8 de diciembre y suma una bolita por día ---------- */
  // 17 bolitas (del 8 al 24), de abajo hacia arriba
  var BOLITAS = [[18, 55], [42, 54], [30, 52], [12, 51], [48, 50], [24, 44], [37, 45], [16, 41], [44, 40], [30, 37],
    [21, 31], [39, 31], [30, 27], [25, 21], [35, 20], [30, 15], [27, 11]];
  var TONOS_BOLITA = ['#E63946', '#FFC93C', '#3FA7F5', '#FF7AB6', '#F4F4F4'];
  var arbol = null;
  function svgArbol(n, estrella, nuevaHoy) {
    var b = '';
    for (var i = 0; i < n; i++) {
      var p = BOLITAS[i];
      b += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.9" fill="' + TONOS_BOLITA[i % TONOS_BOLITA.length] + '"'
        + (nuevaHoy && i === n - 1 ? ' class="nueva"' : '') + '/>';
    }
    return '<svg viewBox="0 0 60 72" aria-hidden="true">'
      + '<rect x="26" y="58" width="8" height="9" rx="1.5" fill="#8B5A2B"/>'
      + '<path d="M18 64h24l-2 6H20z" fill="#C0392B"/>'
      + '<path d="M30 6 50 30H42L54 46H44L58 60H2L16 46H6L18 30H10Z" fill="#1F7A4D"/>'
      + '<path d="M30 6 50 30H42L54 46H44L58 60H30Z" fill="#17643E"/>'
      + '<path d="M14 49c10 4 22 4 34-2M18 34c8 3 17 3 26-1" fill="none" stroke="#FFD166" stroke-width="1.3" stroke-dasharray="2 2.5" opacity=".9"/>'
      + b
      + (estrella ? '<path d="M30 0l2.4 4.9 5.4.8-3.9 3.8.9 5.4L30 12.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" fill="#FFD166" stroke="#E0A800" stroke-width=".8"/>'
        : '<path d="M30 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L30 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="none" stroke="#C9B26B" stroke-width="1" stroke-dasharray="1.5 1.5"/>')
      + '</svg>';
  }
  function armarArbolito() {
    if (cfg.arbolito == null) return;
    var d = ahora(), m = d.getMonth(), dia = d.getDate();
    if (m === 11 && dia < 8) return; // el arbolito se arma el 8 de diciembre
    var n = m === 11 ? Math.min(17, dia - 7) : 17, estrella = !(m === 11 && dia < 25);
    var clave = d.getFullYear() + '-' + (m + 1) + '-' + dia, nuevaHoy = n < 17 && ls('navidad_arbol') !== clave;
    ls('navidad_arbol', clave);
    arbol = document.createElement('button'); arbol.type = 'button'; arbol.className = 'nv-arbol';
    arbol.setAttribute('aria-label', 'Arbolito de Navidad');
    arbol.setAttribute('style', cfg.arbolito);
    arbol.innerHTML = svgArbol(n, estrella, nuevaHoy || probando);
    document.body.appendChild(arbol);
    var tip = null, tt = 0;
    arbol.addEventListener('click', function () {
      if (!tip) { tip = document.createElement('div'); tip.className = 'nv-arbol-tip'; document.body.appendChild(tip); }
      var hoy = ahora(), falta = diasParaNavidad(hoy), t;
      if (hoy.getMonth() === 11 && falta > 1) t = 'Faltan ' + falta + ' días para Navidad<small>Cada día le sumamos una bolita</small>';
      else if (falta === 1) t = '¡Hoy es Nochebuena!<small>Ya está completo</small>';
      else t = 'Felices fiestas<small>De parte de todo el equipo de Ventra</small>';
      tip.innerHTML = t;
      var r = arbol.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(innerWidth - 228, r.left + r.width / 2 - 110)) + 'px';
      tip.style.top = 'auto'; tip.style.bottom = (innerHeight - r.top + 8) + 'px';
      tip.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { tip.classList.remove('on'); }, 3500);
    });
    ubicar();
  }

  /* ---------- Brindis: el 24 y el 31 a la noche ---------- */
  function nocheDeBrindis(d) {
    var m = d.getMonth(), dia = d.getDate(), h = d.getHours();
    if (m === 11 && dia === 24 && h >= 20) return { k: '24', t: ['🥂', '¡Feliz Nochebuena!', 'Brindamos con vos esta noche'] };
    if (m === 11 && dia === 25 && h < 2) return { k: '24', t: ['🎄', '¡Feliz Navidad!', 'Que la pases lindo con los tuyos'] };
    if (m === 11 && dia === 31 && h >= 20) return { k: '31', t: ['🥂', '¡Último brindis del año!', 'Gracias por acompañarnos en ' + d.getFullYear()] };
    if (m === 0 && dia === 1 && h < 2) return { k: '31', t: ['🎆', '¡Feliz ' + d.getFullYear() + '!', 'Que sea un gran año'] };
    return null;
  }
  function brindar() {
    if (!cfg.brindis || apagadoAhora() || rutaSinEfectos() || document.hidden) return;
    var d = ahora(), b = nocheDeBrindis(d); if (!b) return;
    // Una vez antes y otra después de las 12 (si la página sigue abierta a la medianoche)
    var clave = (d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear()) + '-' + b.k + '-' + (d.getHours() >= 20 ? 'noche' : 'doce');
    if (!probando && ls('navidad_brindis') === clave) return;
    ls('navidad_brindis', clave);
    cartel(cfg.saludo || 24, b.t[0], b.t[1], b.t[2], true, 8000);
    if (!reduce) fuegos(5200);
  }
  function fuegos(ms) {
    var cv = document.createElement('canvas'); cv.className = 'nv-fuegos'; cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var TONOS = ['#FFD166', '#E63946', '#2EC46D', '#3FA7F5', '#FF7AB6', '#FFFFFF'];
    var chispas = [], inicio = performance.now(), prox = 0, prev = inicio;
    function estallido() {
      var x = W * (0.15 + Math.random() * 0.7), y = H * (0.12 + Math.random() * 0.3), c = TONOS[(Math.random() * TONOS.length) | 0];
      var n = W < 600 ? 26 : 38;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * 6.283 + Math.random() * 0.2, v = 1.6 + Math.random() * 1.8;
        chispas.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vida: 1, c: c });
      }
    }
    function cuadro(t) {
      var dt = Math.min(3, (t - prev) / 16.7); prev = t;
      if (t - inicio < ms - 1200 && t >= prox) { estallido(); prox = t + 450 + Math.random() * 500; }
      ctx.clearRect(0, 0, W, H);
      for (var i = chispas.length - 1; i >= 0; i--) {
        var p = chispas[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.035 * dt; p.vx *= 0.985; p.vy *= 0.985; p.vida -= 0.013 * dt;
        if (p.vida <= 0) { chispas.splice(i, 1); continue; }
        ctx.globalAlpha = p.vida; ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.9, 0, 6.283); ctx.fill();
      }
      if ((t - inicio < ms || chispas.length) && !document.hidden) requestAnimationFrame(cuadro); else cv.remove();
    }
    requestAnimationFrame(cuadro);
  }

  // Para ver los carteles con calma al probar: ventraNavidad.ver('dia') o ventraNavidad.ver('brindis')
  window.ventraNavidad.ver = function (que) {
    var d = ahora(), t = que === 'brindis' ? (nocheDeBrindis(d) || nocheDeBrindis(new Date(d.getFullYear(), 11, 31, 22))).t : textoDelDia(d);
    cartel(cfg.saludo, t[0], t[1], t[2], que === 'brindis', 60000);
  };

  /* ---------- Arranque ---------- */
  function iniciar() {
    colgarLuces();
    buscarLogos();
    armarArbolito();
    llenarCuentas();
    if (cfg.brindis && nocheDeBrindis(ahora())) setTimeout(brindar, 1500); else saludar();
    if (cfg.brindis) setInterval(brindar, 60000); // por si la página queda abierta hasta la noche o las 12
    addEventListener('scroll', pedirUbicar, { passive: true, capture: true });
    addEventListener('resize', pedirUbicar);
    addEventListener('hashchange', pedirUbicar);
    if ('MutationObserver' in window) {
      var tm = 0;
      new MutationObserver(function () { clearTimeout(tm); tm = setTimeout(function () { colgarLuces(); buscarLogos(); llenarCuentas(); }, 120); })
        .observe(document.body, { childList: true, subtree: true });
    }
    setInterval(ubicar, 1200); // por si algo se mueve sin scroll (menús, transiciones)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();

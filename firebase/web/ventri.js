// Ventri en ventra.store: la mascota de Ventra (un ticket de caja en caricatura), la misma de los
// reels, la que contesta en Instagram y la que acompaña la caja. Biblia: marketing/ventri/BIBLIA.md.
//
// Uso en una página: <div data-ventri="picara" data-gesto="saluda" data-dice="¡Hola! Soy Ventri…" data-pos="mock"></div>
//   data-ventri  cara fija: picara, guino, sorprendida, indignada, mate (public: /ventri/*.webp, ~30 KB)
//   data-gesto   opcional: saluda o festejo. El clip animado (~500 KB) se baja recién cuando Ventri
//                entra en pantalla (no frena la carga de la página) y no se usa con "ahorro de datos"
//                ni con "reducir movimiento".
//   data-dice    lo que dice, en un globito (opcional)
//   data-pos     mock (asomada al costado de la captura del inicio), final (en el cierre oscuro,
//                arriba de los botones), paso (en /empezar), centro (página de error)
// window.ventri.decir(el, texto, cara?) le cambia lo que dice a una Ventri ya dibujada.
// window.ventri.jugar() abre "Hora pico", el minijuego secreto (/ventri/juego.js, se baja recién
// ahí). Secretos para abrirlo: tocar 5 veces seguidas a Ventri, escribirle "jugar" en el chat
// (ventra-chat.js) o entrar a cualquier página con #jugar (es el link que comparte el juego).
(function () {
  if (window.ventri) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ahorro = navigator.connection && navigator.connection.saveData;

  var css = '' +
    '.vt{display:flex;align-items:flex-end;gap:10px;pointer-events:none;--vt-h:120px}' +
    '.vt-img{height:var(--vt-h);width:auto;flex:none;user-select:none;-webkit-user-drag:none;filter:drop-shadow(0 10px 14px rgba(3,20,15,.18))}' +
    // !important: las páginas tienen estilos para sus párrafos (margen automático, texto claro en las
    // secciones oscuras…) que no tienen que pisar el globito
    '.vt p.vt-globo{margin:0 0 calc(var(--vt-h)*.42)!important;max-width:230px!important;width:auto!important;padding:10px 14px!important;border-radius:18px 18px 18px 6px;background:#fff!important;color:#0F1F1A!important;' +
    'font:600 14px/1.35 Inter,system-ui,sans-serif!important;letter-spacing:normal!important;text-align:left!important;box-shadow:0 14px 30px -14px rgba(3,20,15,.45),0 0 0 1px rgba(15,31,26,.06)}' +
    '.vt p.vt-globo b{color:#167160!important;font-weight:700}' +
    // Entrada al aparecer en pantalla (solo transform/opacity)
    '.vt .vt-img{opacity:0;transform:translateY(18px) scale(.94);transition:opacity .45s ease,transform .6s cubic-bezier(.34,1.5,.64,1)}' +
    '.vt .vt-globo{opacity:0;transform:translateY(8px);transition:opacity .4s ease .25s,transform .4s ease .25s}' +
    '.vt.vt-on .vt-img,.vt.vt-on .vt-globo{opacity:1;transform:none}' +
    // Al costado de la captura del inicio
    '.vt-mock{position:absolute;left:-28px;bottom:-26px;z-index:3;--vt-h:150px}' +
    '@media (max-width:900px){.vt-mock{left:-6px;bottom:-18px;--vt-h:110px}.vt-mock p.vt-globo{font-size:13px!important;max-width:170px!important}}' +
    // En el cierre oscuro, arriba de los botones
    '.vt-final{justify-content:center;margin:6px auto 4px;--vt-h:118px}' +
    '@media (max-width:560px){.vt-final{--vt-h:96px}.vt-final p.vt-globo{font-size:13px!important;max-width:190px!important}}' +
    // En /empezar, al lado del título del paso
    '.vt-paso{margin:0 0 14px;--vt-h:84px}.vt-paso p.vt-globo{font-size:13.5px!important;max-width:280px!important}' +
    '.vt-centro{justify-content:center;--vt-h:170px}' +
    // Ventri se puede tocar (es la puerta al juego secreto): un saltito por toque
    '.vt .vt-img{pointer-events:auto;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}' +
    '.vt.vt-on .vt-img.vt-toc{animation:vt-toc .32s ease}' +
    '@keyframes vt-toc{40%{transform:scale(1.07,.93)}75%{transform:scale(.97,1.03)}}' +
    '@media (prefers-reduced-motion:reduce){.vt .vt-img,.vt .vt-globo{transition:none;opacity:1;transform:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  // **texto** → negrita verde
  var fmt = function (s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); };

  function armar(el) {
    if (el.__vt) return; el.__vt = true;
    var cara = el.getAttribute('data-ventri') || 'picara';
    var dice = el.getAttribute('data-dice');
    el.classList.add('vt', 'vt-' + (el.getAttribute('data-pos') || 'final'));
    el.setAttribute('aria-hidden', dice ? 'false' : 'true');
    el.innerHTML = '<img class="vt-img" src="/ventri/' + cara + '.webp" alt="" width="' + 110 + '" height="' + 120 + '" decoding="async" loading="lazy">' +
      (dice ? '<p class="vt-globo">' + fmt(dice) + '</p>' : '');
    // el ancho real depende de la cara: que el navegador lo calcule con el alto
    var img = el.querySelector('img'); img.removeAttribute('width'); img.removeAttribute('height');
  }

  function aparecer(el) {
    el.classList.add('vt-on');
    var gesto = el.getAttribute('data-gesto');
    if (!gesto || reduce || ahorro) return;
    var g = new Image();
    g.onload = function () { var img = el.querySelector('.vt-img'); if (img) img.src = g.src; };
    g.src = '/ventri/gesto-' + gesto + '.webp';
  }

  function iniciar() {
    var els = document.querySelectorAll('[data-ventri]');
    els.forEach(armar);
    if (!('IntersectionObserver' in window)) { els.forEach(aparecer); return; }
    var io = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) { if (e.isIntersecting) { aparecer(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.35 });
    els.forEach(function (el) { io.observe(el); });
  }

  window.ventri = {
    decir: function (el, texto, cara) {
      if (!el) return;
      var g = el.querySelector('.vt-globo');
      if (g) { g.style.opacity = '0'; setTimeout(function () { g.innerHTML = fmt(texto); g.style.opacity = ''; }, 160); }
      if (cara) { var img = el.querySelector('.vt-img'); if (img) img.src = '/ventri/' + cara + '.webp'; }
    },
    gesto: function (el, gesto) { if (el) { el.setAttribute('data-gesto', gesto); aparecer(el); } },
    jugar: jugar,
  };

  // ---- Hora pico, el minijuego secreto
  var cargandoJuego = false;
  function jugar() {
    if (window.ventriJuego) { window.ventriJuego.abrir({ contexto: 'web', alCerrar: sacarHash }); return; }
    if (cargandoJuego) return;
    cargandoJuego = true;
    var s = document.createElement('script');
    s.src = '/ventri/juego.js?v=1';
    s.onload = function () { cargandoJuego = false; if (window.ventriJuego) window.ventriJuego.abrir({ contexto: 'web', alCerrar: sacarHash }); };
    s.onerror = function () { cargandoJuego = false; };
    document.head.appendChild(s);
  }
  // Al salir del juego se saca el #jugar, así al recargar no se vuelve a abrir
  function sacarHash() {
    if (location.hash === '#jugar' && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  }
  if (location.hash === '#jugar') jugar();
  window.addEventListener('hashchange', function () { if (location.hash === '#jugar') jugar(); });

  // 5 toques seguidos a Ventri: al tercero se hace la sorprendida, al cuarto avisa, al quinto juega
  var toques = { el: null, n: 0, t: 0 };
  document.addEventListener('click', function (e) {
    var img = e.target && e.target.closest ? e.target.closest('.vt .vt-img') : null;
    if (!img) return;
    var el = img.closest('.vt'), ahora = Date.now();
    toques.n = toques.el === el && ahora - toques.t < 1500 ? toques.n + 1 : 1;
    toques.el = el; toques.t = ahora;
    img.classList.remove('vt-toc'); void img.offsetWidth; img.classList.add('vt-toc');
    var globo = el.querySelector('.vt-globo');
    if (globo && !el.__vtTexto) { el.__vtTexto = globo.innerHTML; el.__vtCara = img.getAttribute('src'); }
    if (toques.n === 3 && globo) window.ventri.decir(el, '¿Qué hacés? 👀', 'sorprendida');
    if (toques.n === 4 && globo) window.ventri.decir(el, 'Uno más y te muestro **algo secreto**…', 'guino');
    if (toques.n >= 5) {
      toques.n = 0;
      jugar();
      // Vuelve a decir lo de siempre
      if (globo && el.__vtTexto) setTimeout(function () { globo.innerHTML = el.__vtTexto; img.src = el.__vtCara; }, 600);
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();

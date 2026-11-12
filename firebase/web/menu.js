/* Barra de arriba y menú del celular de la web (lo usan todas las páginas; estilos en estilo.css) */
(function(){
  var tb = document.getElementById('topbar'); if (!tb) return;
  // Línea debajo de la barra al bajar
  var onS = function(){ tb.classList.toggle('scrolled', scrollY > 8); };
  addEventListener('scroll', onS, { passive:true }); onS();

  // Desplegables de la compu: uno abierto a la vez; se cierran al tocar afuera, con Escape o al elegir
  var dd = document.querySelectorAll('.menu details');
  dd.forEach(function(d){ d.addEventListener('toggle', function(){ if (d.open) dd.forEach(function(o){ if (o !== d) o.open = false; }); }); });
  document.addEventListener('click', function(e){ dd.forEach(function(d){ if (!d.contains(e.target) || e.target.closest('.drop a')) d.open = false; }); });

  // El que abre su Ventra queda recordado en este navegador (sin datos personales, solo una marca):
  // la próxima vez "Abrir mi Ventra" aparece en verde y la barra de abajo lo lleva a su Ventra
  var KEY = 'ventra_cliente', root = document.documentElement;
  window.ventraRecordarCliente = function(){
    try { localStorage.setItem(KEY, '1'); } catch(e){}
    if (!root.classList.contains('es-cliente')) { root.classList.add('es-cliente'); dockCliente(); }
  };
  document.addEventListener('click', function(e){
    if (e.target && e.target.closest && e.target.closest('a[href^="https://web.ventra.store"]')) window.ventraRecordarCliente();
  }, true);
  function dockCliente(){
    var dk = document.getElementById('dock'); if (!dk || dk.getAttribute('data-cliente')) return;
    var a = dk.querySelector('a.btn'), t = dk.querySelector('span'); if (!a) return;
    dk.setAttribute('data-cliente', '1');
    if (t) t.innerHTML = '<b>Tu Ventra</b><small>Caja, tienda y agenda</small>';
    a.href = 'https://web.ventra.store'; a.textContent = 'Abrir mi Ventra';
    a.removeAttribute('data-start'); a.setAttribute('data-track', 'open_dock');
  }
  if (root.classList.contains('es-cliente')) dockCliente();

  // Menú del celular
  var b =tb.querySelector('.burger'), m = document.getElementById('mnav');
  if (!b || !m) return;
  function setM(open){
    if (open) m.style.top = Math.max(0, tb.getBoundingClientRect().bottom) + 'px';
    m.classList.toggle('open', open);
    b.setAttribute('aria-expanded', open);
    b.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  b.addEventListener('click', function(){ setM(!m.classList.contains('open')); });
  m.addEventListener('click', function(e){ if (e.target.closest('a')) setM(false); });
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    dd.forEach(function(d){ if (d.open){ d.open = false; d.querySelector('summary').focus(); } });
    if (m.classList.contains('open')){ setM(false); b.focus(); }
  });
  addEventListener('resize', function(){ if (innerWidth > 1020 && m.classList.contains('open')) setM(false); });

  // La página en la que estás, marcada
  var here = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  m.querySelectorAll('.mn-l[href^="/"]').forEach(function(a){ if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page'); });

  // Con la sesión iniciada, "¿Ya sos cliente?" sobra: queda "Mi cuenta · Salir" (lo arma ventra-cuenta.js)
  var area = document.getElementById('authAreaMobile'), q = m.querySelector('.mn-q');
  if (area && q && 'MutationObserver' in window) new MutationObserver(function(){ q.hidden = !!area.querySelector('.auth-user'); }).observe(area, { childList:true, subtree:true });
})();

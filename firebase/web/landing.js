// Animaciones compartidas de las landings: aparición al bajar, con un pequeño escalonado entre
// hermanos (tarjetas de una grilla). Sin JS, o con animaciones reducidas, todo se ve igual.
(function(){
  var els = document.querySelectorAll('.rv');
  els.forEach(function(el){
    if (el.style.getPropertyValue('--d')) return;
    var sibs = Array.prototype.filter.call(el.parentNode.children, function(c){ return c.classList.contains('rv'); });
    var i = sibs.indexOf(el);
    if (i > 0) el.style.setProperty('--d', Math.min(i, 6) * 0.07 + 's');
  });
  // Al terminar de aparecer se saca la clase: así vuelven a andar los efectos al pasar el mouse
  function show(el){ el.classList.add('in'); setTimeout(function(){ el.classList.remove('rv', 'in'); el.style.removeProperty('--d'); }, 1400); }
  if (!('IntersectionObserver' in window)) { els.forEach(function(el){ el.classList.add('in'); }); return; }
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if (e.isIntersecting){ show(e.target); io.unobserve(e.target); } });
  }, { threshold:.12, rootMargin:'0px 0px -6% 0px' });
  els.forEach(function(el){ io.observe(el); });
})();

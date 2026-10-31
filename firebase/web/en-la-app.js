// Google rechaza el login dentro del navegador interno de otras apps (Instagram, Facebook,
// TikTok…: error 403 disallowed_useragent), y de ahí viene mucha gente. Avisamos antes de que
// lo intente y le damos cómo salir a Chrome o Safari. El botón de Google queda igual por si
// la detección se equivoca.
(function(){
  if (window.Capacitor) return; // nuestra app nativa entra con su propio login
  var ua = navigator.userAgent || '';
  if (!/FBAN|FBAV|FB_IAB|FBIOS|Instagram|TikTok|musical_ly|BytedanceWebview|Snapchat|Twitter|LinkedInApp|Line\/|MicroMessenger|GSA\/|; wv\)/i.test(ua)) return;
  var android = /Android/i.test(ua);

  function notice(){
    var box = document.createElement('div');
    box.className = 'en-la-app';
    box.style.cssText = 'margin:0 0 16px;padding:14px;border-radius:14px;background:#FFF4D6;border:1px solid #E8C867;color:#4A3A0C;font-size:14px;line-height:1.45;text-align:left';
    var txt = document.createElement('div');
    txt.innerHTML = '<b>Abrí esta página en ' + (android ? 'Chrome' : 'Safari') + ' para entrar.</b> Google no deja iniciar sesión desde el navegador de esta app.' +
      (android ? '' : ' Tocá el menú de arriba (⋯) y elegí <b>Abrir en Safari</b>, o copiá el link y pegalo ahí.');
    box.appendChild(txt);
    var btnCss = 'display:block;width:100%;margin-top:10px;padding:12px;border:0;border-radius:999px;background:#0B3D2E;color:#fff;font:inherit;font-weight:650;text-align:center;text-decoration:none;cursor:pointer';
    if (android) {
      var open = document.createElement('a');
      open.href = 'intent://' + location.host + location.pathname + location.search + '#Intent;scheme=https;package=com.android.chrome;end';
      open.textContent = 'Abrir en Chrome';
      open.style.cssText = btnCss;
      box.appendChild(open);
    }
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copiar el link';
    copy.style.cssText = btnCss + (android ? ';background:transparent;color:#0B3D2E;border:1px solid #0B3D2E' : '');
    copy.addEventListener('click', function(){
      function done(){ copy.textContent = '¡Copiado! Pegalo en ' + (android ? 'Chrome' : 'Safari'); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, fallback);
      else fallback();
      function fallback(){
        var i = document.createElement('input'); i.value = location.href; document.body.appendChild(i); i.select();
        try { document.execCommand('copy'); done(); } catch(e){ copy.textContent = location.href; }
        i.remove();
      }
    });
    box.appendChild(copy);
    return box;
  }

  function run(){
    document.querySelectorAll('[data-google-login]').forEach(function(b){ b.parentNode.insertBefore(notice(), b); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();

// Ventra accounts: Google sign-in + subscription checkout, on Ventra's own
// Firebase project (public client config, safe to expose). The Firebase SDK (~200KB) is loaded lazily — on the first
// sign-in/plan click, or once the page is idle — so it never slows first paint.
(function(){
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyCFiHwebmIbwqVjaW0nu6_Swb646zFyX8k",
    // En ventra.store (dominio propio) el login de Google muestra ventra.store;
    // en la URL técnica de Firebase usa el dominio por defecto del proyecto.
    authDomain: /(^|\.)ventra\.store$/.test(location.hostname) ? location.hostname : "ventra-9cba5.firebaseapp.com",
    projectId: "ventra-9cba5",
    storageBucket: "ventra-9cba5.firebasestorage.app",
    messagingSenderId: "23136382753",
    appId: "1:23136382753:web:5d2f4115a77a607435d860"
  };
  var DEMO_URL = 'https://app.ventra.store';
  var CREATE_SUBSCRIPTION_URL = "https://us-central1-ventra-9cba5.cloudfunctions.net/createVentraSubscription";
  var authAreas = [document.getElementById('authArea'), document.getElementById('authAreaMobile')];
  var auth = null, loading = null, firstState = null;

  // Métricas propias, sin cookies ni datos personales (ver ventraSiteEvent): vista de la página
  // (<html data-page>), tarjetas con data-track y botones de plan. Si falla, no pasa nada.
  var EVENT_URL = 'https://us-central1-ventra-9cba5.cloudfunctions.net/ventraSiteEvent';
  function track(e){
    try {
      var body = JSON.stringify({ e: e });
      if (!(navigator.sendBeacon && navigator.sendBeacon(EVENT_URL, body))) fetch(EVENT_URL, { method:'POST', body: body, keepalive: true }).catch(function(){});
    } catch(err){}
  }
  window.ventraTrack = function(e){ if (!/^(localhost|127\.)/.test(location.hostname)) track(e); };
  var page = document.documentElement.getAttribute('data-page');
  if (page && !/^(localhost|127\.)/.test(location.hostname)) track('view_' + page);
  document.addEventListener('click', function(ev){
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-track], .plan-btn') : null;
    if (!el || /^(localhost|127\.)/.test(location.hostname)) return;
    track(el.getAttribute('data-track') || 'plan_' + el.getAttribute('data-plan'));
  }, true);

  // Las landings por rubro (/peluquerias…) marcan <html data-rubro="…">: viaja con la
  // suscripción para que la app arranque con ese rubro elegido. Las UTM de la visita
  // también, para saber qué aviso o canal trae cada alta.
  var RUBRO_KEY = 'ventra_signup_rubro', UTM_KEY = 'ventra_signup_utm';
  function currentRubro(){ return document.documentElement.getAttribute('data-rubro') || ''; }
  function signupUtm(){
    try {
      var q = new URLSearchParams(location.search), utm = {};
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function(k){ var v = q.get(k); if (v) utm[k.slice(4)] = v.slice(0, 60); });
      if (Object.keys(utm).length) sessionStorage.setItem(UTM_KEY, JSON.stringify(utm));
      return JSON.parse(sessionStorage.getItem(UTM_KEY) || 'null');
    } catch(e){ return null; }
  }
  signupUtm();
  // El rubro elegido en la página sobrevive al ida y vuelta del login con Google (redirect)
  function rememberRubro(){ try { var r = currentRubro(); if (r) sessionStorage.setItem(RUBRO_KEY, JSON.stringify({ path: location.pathname, rubro: r })); } catch(e){} }
  try {
    var savedRubro = JSON.parse(sessionStorage.getItem(RUBRO_KEY) || 'null');
    if (savedRubro && savedRubro.path === location.pathname && currentRubro()) {
      document.documentElement.setAttribute('data-rubro', savedRubro.rubro);
      document.dispatchEvent(new CustomEvent('ventra:rubro', { detail: savedRubro.rubro }));
    }
  } catch(e){}

  function loadScript(src){
    return new Promise(function(res, rej){ var el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = rej; document.head.appendChild(el); });
  }
  function ensureFirebase(){
    if (loading) return loading;
    loading = loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
      .then(function(){ return loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js'); })
      .then(function(){ return loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js'); })
      .then(function(){
        firebase.initializeApp(FIREBASE_CONFIG);
        auth = firebase.auth();
        firstState = new Promise(function(res){
          var done = false;
          auth.onAuthStateChanged(function(user){
            renderAuthArea(user);
            applyPlanLinks(user);
            if (!done){ done = true; res(user); }
          });
        });
        return firstState;
      })
      .catch(function(err){ loading = null; throw err; });
    return loading;
  }

  // Con un plan al día, los botones de demo pasan a abrir el Ventra del cliente
  // "Abrir mi Ventra": si ya entraste con Google acá, web.ventra.store te recibe con esa
  // misma sesión (el token viaja en un formulario, nunca en la URL). Sin sesión, el link
  // funciona normal y web.ventra.store pide entrar.
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href^="https://web.ventra.store"]') : null;
    // Antes de que cargue el SDK no hay sesión que pasar: el link funciona normal
    var user = a && auth ? auth.currentUser : null;
    if (!a || !user || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    var target = '_self';
    if (a.target === '_blank') { target = 'ventra_web_' + Date.now(); window.open('about:blank', target); }
    user.getIdToken().then(function(token){
      var f = document.createElement('form');
      f.method = 'POST'; f.action = 'https://web.ventra.store/_ventra/handoff'; f.target = target; f.style.display = 'none';
      var i = document.createElement('input'); i.type = 'hidden'; i.name = 'idToken'; i.value = token;
      f.appendChild(i); document.body.appendChild(f); f.submit(); f.remove();
    }).catch(function(){ window.open(a.href, target); });
  });

  var WEB_APP_URL = 'https://web.ventra.store';
  function applyPlanLinks(user){
    if (!user) return;
    firebase.firestore().collection('ventra_accounts').doc(user.uid).get().then(function(doc){
      if (!doc.exists) return;
      var d = doc.data(), until = d.paidUntil && d.paidUntil.toDate ? d.paidUntil.toDate() : null;
      // Vigente o dentro de los 7 días de gracia
      if (!until || Date.now() > until.getTime() + 7 * 864e5) return;
      // Ya es cliente: "Empezar" no tiene sentido, lo lleva a su cuenta
      // (arriba ya está "Mi cuenta" al lado, no hace falta repetirlo)
      document.querySelectorAll('a[data-start]').forEach(function(a){ a.href = '/cuenta.html'; a.textContent = 'Mi cuenta'; a.removeAttribute('data-start'); if (a.closest('.nav')) a.style.display = 'none'; });
      document.querySelectorAll('a[href="' + DEMO_URL + '"]').forEach(function(a){
        a.href = WEB_APP_URL;
        var arrow = a.querySelector('.arr');
        a.textContent = /demo gratis/i.test(a.textContent) ? 'Abrir mi Ventra' : 'Mi Ventra';
        if (arrow) a.appendChild(arrow);
      });
    }).catch(function(){});
  }

  function renderAuthArea(user){
    authAreas.forEach(function(area){
      if (!area) return;
      area.innerHTML = '';
      if (!user) {
        // Como en cualquier web: lleva a la página de entrar, y de ahí a la cuenta
        var b = document.createElement('a');
        b.className = 'auth-btn'; b.href = '/cuenta.html'; b.textContent = 'Iniciar sesión';
        area.appendChild(b);
        return;
      }
      var wrap = document.createElement('div'); wrap.className = 'auth-user';
      if (user.photoURL) { var img = document.createElement('img'); img.src = user.photoURL; img.alt = ''; img.referrerPolicy = 'no-referrer'; wrap.appendChild(img); }
      var name = document.createElement('a'); name.className = 'auth-name'; name.href = '/cuenta.html'; name.title = 'Mi cuenta';
      var first = document.createElement('span'); first.className = 'auth-first';
      first.textContent = (user.displayName || user.email || '').split(' ')[0] + ' · ';
      name.appendChild(first); name.appendChild(document.createTextNode('Mi cuenta'));
      var out = document.createElement('button'); out.type = 'button'; out.textContent = 'Salir';
      out.addEventListener('click', function(){ auth.signOut(); });
      wrap.appendChild(name); wrap.appendChild(out); area.appendChild(wrap);
    });
  }

  /* Alta en /empezar: la página arma los pasos (negocio → plan → Google → correo de Mercado
     Pago) y usa esto para entrar y crear la suscripción. Mercado Pago ata la suscripción a un
     correo y exige que quien paga entre con la cuenta de MP de ESE correo, que casi nunca es el
     de Google: por eso la página lo pide en un campo propio antes de salir del sitio. */
  function startCheckout(user, plan, payerEmail, rubro){
    return user.getIdToken().then(function(token){
      return fetch(CREATE_SUBSCRIPTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ plan: plan, payerEmail: payerEmail, rubro: rubro || currentRubro() || undefined, utm: signupUtm() || undefined })
      });
    }).then(function(res){ return res.json().then(function(data){ return { ok: res.ok, data: data }; }); });
  }
  window.ventraCuenta = {
    ready: ensureFirebase,
    // Con popup si se puede (no sale de la página); si el navegador lo bloquea, redirect
    signInGoogle: function(){
      return ensureFirebase().then(function(){
        var provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        return auth.signInWithPopup(provider).then(function(r){ return r.user; }).catch(function(err){
          if (err && /popup-blocked|operation-not-supported|web-storage/.test(err.code || '')) return auth.signInWithRedirect(provider).then(function(){ return null; });
          throw err;
        });
      });
    },
    signOut: function(){ return auth ? auth.signOut() : Promise.resolve(); },
    startCheckout: startCheckout,
    track: window.ventraTrack
  };

  // Los botones "Elegir / Empezar con …" de las landings y los links "Empezar" llevan a
  // /empezar con el plan (o la necesidad) y el rubro que eligió en la página.
  function startUrl(base){
    var url = new URL(base, location.origin), r = currentRubro();
    if (r && !url.searchParams.has('rubro')) url.searchParams.set('rubro', r);
    if (!url.searchParams.has('desde') && page) url.searchParams.set('desde', page);
    return url.pathname + url.search;
  }
  document.querySelectorAll('.plan-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      location.href = startUrl('/empezar?plan=' + encodeURIComponent(btn.getAttribute('data-plan')));
    });
  });
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[data-start]') : null;
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    location.href = startUrl(a.getAttribute('href'));
  });

  renderAuthArea(null);
  // Plan de prueba oculto (solo administradores): ventra.store/?plan=prueba
  try {
    if (page !== 'empezar' && new URLSearchParams(location.search).get('plan') === 'prueba') location.replace('/empezar?plan=prueba');
  } catch(e){}
  // Restore a returning visitor's session without blocking the first render.
  var idle = window.requestIdleCallback || function(cb){ return setTimeout(cb, 2500); };
  window.addEventListener('load', function(){ idle(function(){ ensureFirebase().catch(function(){}); }, { timeout:4000 }); });
})();

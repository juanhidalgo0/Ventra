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
  var GOOGLE_ICON = '<svg width="15" height="15" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.9 5.1 29.7 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.9 5.1 29.7 3 24 3 16.3 3 9.7 7.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 45c5.6 0 10.7-2.1 14.5-5.6l-6.7-5.6C29.7 35.5 27 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.6 5.1C9.6 40.6 16.2 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.8l6.7 5.6C41.1 36.5 45 30.8 45 24c0-1.4-.1-2.7-.4-3.5z"/></svg>';
  var authAreas = [document.getElementById('authArea'), document.getElementById('authAreaMobile')];
  var auth = null, pendingPlan = null, loading = null, firstState = null;

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
            if (user && pendingPlan){ var plan = pendingPlan; pendingPlan = null; startCheckout(user, plan); }
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
    var user = firebase.auth().currentUser;
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
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'auth-btn'; b.innerHTML = GOOGLE_ICON + 'Iniciar sesión';
        b.addEventListener('click', function(){ signIn(); });
        area.appendChild(b);
        return;
      }
      var wrap = document.createElement('div'); wrap.className = 'auth-user';
      if (user.photoURL) { var img = document.createElement('img'); img.src = user.photoURL; img.alt = ''; img.referrerPolicy = 'no-referrer'; wrap.appendChild(img); }
      var name = document.createElement('a'); name.className = 'auth-name'; name.href = '/cuenta.html'; name.title = 'Mi cuenta';
      name.textContent = (user.displayName || user.email || '').split(' ')[0] + ' · Mi cuenta';
      var out = document.createElement('button'); out.type = 'button'; out.textContent = 'Salir';
      out.addEventListener('click', function(){ auth.signOut(); });
      wrap.appendChild(name); wrap.appendChild(out); area.appendChild(wrap);
    });
  }

  function signIn(){
    // A popup must open inside the click itself. If the SDK is already loaded we
    // can do that; otherwise the click's "user gesture" is gone by the time it
    // loads, so use a full-page redirect instead (the chosen plan survives it).
    var viaPopup = !!auth;
    if (!viaPopup && pendingPlan){ try { sessionStorage.setItem('ventra_pending_plan', pendingPlan); } catch(e){} }
    return ensureFirebase().then(function(){
      var provider = new firebase.auth.GoogleAuthProvider();
      return viaPopup ? auth.signInWithPopup(provider) : auth.signInWithRedirect(provider);
    }).catch(function(err){
      console.error('Ventra auth error:', err);
      pendingPlan = null;
      alert('No se pudo iniciar sesión con Google. Probá de nuevo.');
    });
  }

  /* Mercado Pago ata la suscripción a un correo y después exige que quien paga entre
     con la cuenta de MP de ESE correo. El de Google rara vez coincide con el de
     Mercado Pago, y el checkout rechaza con "el correo no coincide con la
     suscripción". Por eso se pregunta antes de salir del sitio. */
  function pedirCorreoMercadoPago(sugerido){
    var msg = '¿Con qué correo entrás a Mercado Pago?\n\n' +
              'Tiene que ser el de tu cuenta de Mercado Pago. Si no es el mismo que usás acá, ' +
              'el pago te va a dar error.';
    var valor = window.prompt(msg, sugerido || '');
    if (valor === null) return null;              // canceló
    valor = valor.trim().toLowerCase();
    if (!valor) return sugerido || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor)) {
      alert('Ese correo no parece válido. Revisalo y probá de nuevo.');
      return pedirCorreoMercadoPago(sugerido);
    }
    return valor;
  }

  function startCheckout(user, plan){
    var btn = document.querySelector('.plan-btn[data-plan="' + plan + '"]');
    var originalHTML = btn ? btn.innerHTML : '';

    var correoMp = pedirCorreoMercadoPago(user.email || '');
    if (correoMp === null) return;                // canceló: no se toca el botón

    if (btn) { btn.disabled = true; btn.textContent = 'Redirigiendo a Mercado Pago…'; }

    user.getIdToken().then(function(token){
      return fetch(CREATE_SUBSCRIPTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ plan: plan, payerEmail: correoMp, rubro: currentRubro() || undefined, utm: signupUtm() || undefined })
      });
    })
      .then(function(res){ return res.json().then(function(data){ return { ok: res.ok, data: data }; }); })
      .then(function(result){
        if (!result.ok || !result.data.initPoint) throw new Error(result.data.error || 'Error desconocido');
        window.location.href = result.data.initPoint;
      })
      .catch(function(err){
        console.error('Ventra checkout error:', err);
        alert('No se pudo iniciar la suscripción. Probá de nuevo en un momento.');
        if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
      });
  }

  document.querySelectorAll('.plan-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var plan = btn.getAttribute('data-plan');
      rememberRubro();
      if (auth && auth.currentUser) return startCheckout(auth.currentUser, plan);
      if (auth) { pendingPlan = plan; return signIn(); }
      // SDK not loaded yet: the session may still exist, so check before asking to sign in.
      btn.disabled = true;
      ensureFirebase().then(function(user){
        btn.disabled = false;
        if (user) startCheckout(user, plan);
        else { pendingPlan = plan; try { sessionStorage.setItem('ventra_pending_plan', plan); } catch(e){} auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); }
      }).catch(function(){ btn.disabled = false; alert('No se pudo conectar. Revisá tu conexión y probá de nuevo.'); });
    });
  });

  renderAuthArea(null);
  // Hovering or focusing a sign-in/plan button warms the SDK up before the click lands.
  document.addEventListener('pointerover', function(e){ if (e.target.closest && e.target.closest('.plan-btn, .auth-btn')) ensureFirebase().catch(function(){}); }, { passive:true });
  document.addEventListener('focusin', function(e){ if (e.target.closest && e.target.closest('.plan-btn, .auth-btn')) ensureFirebase().catch(function(){}); });
  try { var saved = sessionStorage.getItem('ventra_pending_plan'); if (saved){ sessionStorage.removeItem('ventra_pending_plan'); pendingPlan = saved; ensureFirebase().catch(function(){}); } } catch(e){}
  // Plan de prueba oculto (solo administradores): ventra.store/?plan=prueba
  try {
    if (new URLSearchParams(location.search).get('plan') === 'prueba' && !pendingPlan) {
      pendingPlan = 'prueba';
      ensureFirebase().then(function(user){
        if (!user && pendingPlan) { try { sessionStorage.setItem('ventra_pending_plan', 'prueba'); } catch(e){} auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); }
      }).catch(function(){});
    }
  } catch(e){}
  // Restore a returning visitor's session without blocking the first render.
  var idle = window.requestIdleCallback || function(cb){ return setTimeout(cb, 2500); };
  window.addEventListener('load', function(){ idle(function(){ ensureFirebase().catch(function(){}); }, { timeout:4000 }); });
})();

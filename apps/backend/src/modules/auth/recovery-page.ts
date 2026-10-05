/**
 * Página de "Olvidé la contraseña del administrador" que la PC abre en el navegador de Windows
 * (ver PasswordRecoveryService). Entra con Google en el proyecto de Firebase de Ventra y le
 * pasa el token a esta misma PC. `id` ya viene validado (48 hex) o vacío.
 */
export function recoveryPage(id: string) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Ventra · Recuperar acceso</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,sans-serif;color:#0F1F1A;
    background:#08362A;background-image:radial-gradient(800px 520px at 75% -10%,rgba(52,172,126,.32),transparent 70%)}
  .card{width:100%;max-width:420px;background:#FBF9F5;border-radius:26px;padding:36px 30px 30px;text-align:center;box-shadow:0 30px 80px -30px rgba(3,20,15,.6)}
  img{width:56px;height:56px;border-radius:16px;display:block;margin:0 auto 16px}
  h1{margin:0;font-size:22px;letter-spacing:-.03em}
  p{margin:8px 0 22px;color:#56655F;font-size:14px;line-height:1.55}
  button{width:100%;height:48px;border-radius:999px;border:0;background:#08362A;color:#F6F2EC;font:600 15px Inter,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px}
  button:disabled{opacity:.6;cursor:default}
  .g{width:18px;height:18px;background:#fff;border-radius:50%;padding:2px}
  .msg{margin-top:14px;font-size:13px;min-height:18px;color:#56655F}
  .err{color:#B4412B;font-weight:600}
  .ok{color:#0F6E50;font-weight:700;font-size:16px}
</style>
</head>
<body>
<main class="card">
  <img src="https://ventra.store/ventra-logo.png" alt="Ventra">
  <h1>Recuperar el acceso</h1>
  <p id="desc">Entrá con la <b>cuenta de Google con la que pagás Ventra</b>. Después elegís la contraseña nueva en el programa.</p>
  <button id="go"><svg class="g" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Entrar con Google</button>
  <div class="msg" id="msg"></div>
</main>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script>
(function(){
  var id = ${JSON.stringify(id)};
  var btn = document.getElementById('go'), msg = document.getElementById('msg'), desc = document.getElementById('desc');
  function say(t, cls){ msg.textContent = t; msg.className = 'msg' + (cls ? ' ' + cls : ''); }
  if (!id) { btn.disabled = true; say('Este enlace no es válido. Volvé a Ventra y tocá "Olvidé la contraseña" otra vez.', 'err'); return; }
  firebase.initializeApp({ apiKey: "AIzaSyCFiHwebmIbwqVjaW0nu6_Swb646zFyX8k", authDomain: "ventra-9cba5.firebaseapp.com", projectId: "ventra-9cba5", appId: "1:23136382753:web:5d2f4115a77a607435d860" });
  var provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  btn.onclick = function(){
    btn.disabled = true; say('Abriendo Google…');
    firebase.auth().signInWithPopup(provider)
      .then(function(r){ say('Verificando la cuenta…'); return r.user.getIdToken(true); })
      .then(function(idToken){
        return fetch('/api/auth/recover/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, idToken: idToken }) });
      })
      .then(function(res){ return res.json().then(function(d){ if (!res.ok) throw new Error(d.message || 'No se pudo verificar'); }); })
      .then(function(){
        firebase.auth().signOut();
        btn.style.display = 'none'; desc.style.display = 'none';
        say('Listo. Volvé a Ventra para elegir la contraseña nueva. Ya podés cerrar esta pestaña.', 'ok');
      })
      .catch(function(e){
        firebase.auth().signOut();
        btn.disabled = false;
        if (e && e.code === 'auth/popup-closed-by-user') return say('');
        if (e && e.code === 'auth/unauthorized-domain') return say('Abrí esto desde la PC principal del local (la que tiene el servidor de Ventra).', 'err');
        say((e && e.message) || 'No se pudo verificar', 'err');
      });
  };
})();
</script>
</body>
</html>`;
}

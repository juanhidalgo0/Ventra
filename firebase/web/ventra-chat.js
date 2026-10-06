// Asistente de Ventra con IA, para todas las páginas de ventra.store.
// Habla con la función ventraChat (firebase/functions/chat.js), que responde en vivo (SSE) a partir de
// la base de conocimiento de Ventra. La conversación queda en esta pestaña (sessionStorage), así sigue
// al pasar de una página a otra. Si el asistente no está disponible, ofrece el WhatsApp.
(function(){
  if (window.__ventraChat) return; window.__ventraChat = true;
  var API = 'https://us-central1-ventra-9cba5.cloudfunctions.net/ventraChat';
  // Pruebas locales: en localhost se puede apuntar a un servidor de prueba (localStorage.vc_api)
  try { if (/^(localhost|127\.)/.test(location.hostname) && localStorage.getItem('vc_api')) API = localStorage.getItem('vc_api'); } catch(e){}
  var WA = 'https://wa.me/5492212025603';
  var KEY = 'ventra_chat_v1', MAX_TURNS = 20;
  var page = document.documentElement.getAttribute('data-page') || 'home';
  var SUGGEST = {
    'home': ['¿Qué plan me conviene?', '¿Puedo probarlo gratis?', '¿Funciona sin internet?'],
    'sistema-de-ventas': ['¿Sirve para mi kiosco?', '¿Funciona con mi impresora y lector?', '¿Emite factura electrónica?'],
    'tienda-online': ['¿Cobra comisión por venta?', '¿Cómo me pagan los clientes?', '¿Puedo hacer envíos?'],
    'turnos': ['¿Cómo funcionan los recordatorios?', '¿Puedo cobrar seña?', '¿Sirve para varios profesionales?'],
    'peluquerias': ['¿Cómo funcionan los recordatorios?', '¿Cuál es la diferencia entre Agenda y Agenda Pro?', '¿Puedo cobrar seña?']
  };
  var track = function(e){ try { if (window.ventraTrack) window.ventraTrack(e); } catch(err){} };

  var state = { conv: '', messages: [] };
  try { var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (saved && Array.isArray(saved.messages)) state = saved; } catch(e){}
  if (!state.conv) state.conv = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var save = function(){ try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch(e){} };

  var css = '\
.vc-launch{position:fixed;left:18px;bottom:18px;z-index:45;display:flex;align-items:center;gap:9px;height:52px;padding:0 18px 0 8px;border-radius:999px;border:0;cursor:pointer;background:#06261D;color:#F6F2EC;font:600 14.5px/1 Inter,system-ui,sans-serif;box-shadow:0 16px 34px -14px rgba(3,20,15,.7),0 0 0 1px rgba(246,242,236,.08) inset;transition:transform .3s cubic-bezier(.16,1,.3,1)}\
.vc-launch:hover{transform:translateY(-2px)}\
.vc-launch .vc-dot{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#34AC7E,#167160)}\
.vc-launch .vc-pulse{position:absolute;left:8px;top:8px;width:36px;height:36px;border-radius:50%;box-shadow:0 0 0 0 rgba(52,172,126,.6);animation:vcp 2.4s infinite}\
@keyframes vcp{70%{box-shadow:0 0 0 12px rgba(52,172,126,0)}100%{box-shadow:0 0 0 0 rgba(52,172,126,0)}}\
@media (prefers-reduced-motion:reduce){.vc-launch .vc-pulse{animation:none}}\
@media (max-width:760px){.vc-launch{bottom:84px;height:48px;padding-right:14px}.vc-launch .vc-txt{font-size:13.5px}}\
.vc-panel{position:fixed;left:18px;bottom:18px;z-index:60;width:min(390px,calc(100vw - 36px));height:min(600px,calc(100vh - 36px));display:flex;flex-direction:column;background:#FBF9F5;color:#0F1F1A;border-radius:22px;overflow:hidden;box-shadow:0 30px 80px -24px rgba(3,20,15,.55),0 0 0 1px rgba(15,31,26,.08);font:15px/1.5 Inter,system-ui,sans-serif;transform-origin:bottom left;animation:vcin .35s cubic-bezier(.16,1,.3,1)}\
@keyframes vcin{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}\
@media (max-width:560px){.vc-panel{left:0;right:0;bottom:0;width:100%;height:100%;border-radius:0}}\
.vc-head{display:flex;align-items:center;gap:11px;padding:14px 14px 14px 16px;background:#06261D;color:#F6F2EC}\
.vc-head img{width:34px;height:34px;border-radius:10px}\
.vc-head b{display:block;font-size:15px}\
.vc-head small{display:block;font-size:12px;color:rgba(246,242,236,.62)}\
.vc-x{margin-left:auto;width:36px;height:36px;border-radius:50%;border:0;background:rgba(246,242,236,.08);color:#F6F2EC;cursor:pointer;font-size:20px;line-height:1}\
.vc-body{flex:1;overflow-y:auto;padding:16px 14px 8px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}\
.vc-msg{max-width:88%;padding:10px 13px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word;font-size:14.5px}\
.vc-msg.bot{align-self:flex-start;background:#fff;border:1px solid #E4DDD1;border-bottom-left-radius:5px}\
.vc-msg.me{align-self:flex-end;background:#08362A;color:#F6F2EC;border-bottom-right-radius:5px}\
.vc-msg a{color:#167160;font-weight:600;text-decoration:underline;text-underline-offset:2px;word-break:break-all}\
.vc-msg.me a{color:#CDEEE0}\
.vc-typing span{display:inline-block;width:6px;height:6px;margin:0 2px;border-radius:50%;background:#8A958F;animation:vct 1.2s infinite}\
.vc-typing span:nth-child(2){animation-delay:.15s}.vc-typing span:nth-child(3){animation-delay:.3s}\
@keyframes vct{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}\
.vc-sug{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 8px}\
.vc-sug button{border:1px solid #CDEEE0;background:#EAF7F1;color:#0A4736;border-radius:999px;padding:7px 12px;font:600 13px/1.2 Inter,system-ui,sans-serif;cursor:pointer;text-align:left}\
.vc-human{display:flex;align-items:center;justify-content:center;gap:7px;margin:0 14px 8px;padding:9px;border-radius:12px;background:#fff;border:1px solid #E4DDD1;color:#0F1F1A;font-size:13.5px;font-weight:600;text-decoration:none}\
.vc-human.hot{border-color:#25D366;background:#EFFCF3}\
.vc-form{display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid #E4DDD1;background:#fff}\
.vc-form textarea{flex:1;resize:none;border:1px solid #E4DDD1;border-radius:14px;padding:10px 12px;font:15px/1.4 Inter,system-ui,sans-serif;max-height:110px;outline:none;color:#0F1F1A;background:#FBF9F5}\
.vc-form textarea:focus{border-color:#167160}\
.vc-send{width:44px;height:44px;flex:none;align-self:flex-end;border:0;border-radius:50%;background:#08362A;color:#F6F2EC;cursor:pointer;display:grid;place-items:center}\
.vc-send:disabled{opacity:.45;cursor:default}\
.vc-note{padding:0 14px 10px;background:#fff;font-size:11px;color:#8A958F;text-align:center}\
.vc-note a{color:inherit}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var esc = function(s){ return String(s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); };
  // Formato mínimo: **negrita** y links solo a Ventra y WhatsApp
  function fmt(text){
    return esc(text)
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/https:\/\/(?:[a-z0-9-]+\.)*(?:ventra\.store|wa\.me)\/?[^\s<)"]*/gi, function(u){
        var clean = u.replace(/[.,;:]+$/, ''), rest = u.slice(clean.length);
        return '<a href="' + clean + '" target="_blank" rel="noopener">' + clean.replace(/^https:\/\//, '') + '</a>' + rest;
      });
  }

  var launch = document.createElement('button');
  launch.type = 'button'; launch.className = 'vc-launch'; launch.setAttribute('aria-label', 'Abrir el asistente de Ventra');
  launch.innerHTML = '<span class="vc-pulse"></span><span class="vc-dot"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg></span><span class="vc-txt">¿Dudas? Preguntame</span>';
  document.body.appendChild(launch);

  var panel = null, body, input, sendBtn, sugBox, human, busy = false;

  function waLink(){
    var last = state.messages.filter(function(m){ return m.role === 'user'; }).pop();
    var text = 'Hola! Estaba hablando con el asistente de Ventra' + (last ? ' y quería consultar: ' + last.content.slice(0, 300) : '');
    return WA + '?text=' + encodeURIComponent(text);
  }
  function bubble(role, text){
    var d = document.createElement('div');
    d.className = 'vc-msg ' + (role === 'user' ? 'me' : 'bot');
    d.innerHTML = fmt(text);
    body.appendChild(d); body.scrollTop = body.scrollHeight;
    return d;
  }
  function renderAll(){
    body.innerHTML = '';
    bubble('assistant', '¡Hola! Soy el asistente de Ventra. Preguntame lo que quieras: planes, precios, cómo funciona la caja, la tienda online o la agenda de turnos.');
    state.messages.forEach(function(m){ bubble(m.role, m.content); });
    sugBox.style.display = state.messages.length ? 'none' : '';
    human.href = waLink();
  }

  function open(){
    track('chat_open');
    if (panel) { panel.style.display = ''; launch.style.display = 'none'; input.focus(); return; }
    panel = document.createElement('div');
    panel.className = 'vc-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Asistente de Ventra');
    panel.innerHTML =
      '<div class="vc-head"><img src="/ventra-icon-192.png" alt=""><div><b>Asistente de Ventra</b><small>Responde con IA · puede equivocarse</small></div><button type="button" class="vc-x" aria-label="Cerrar">×</button></div>' +
      '<div class="vc-body" aria-live="polite"></div>' +
      '<div class="vc-sug"></div>' +
      '<a class="vc-human" target="_blank" rel="noopener"><svg width="16" height="16" viewBox="0 0 24 24" fill="#25D366"><path d="M12 .2A11.8 11.8 0 0 0 1.9 17.9L.2 24l6.3-1.7A11.8 11.8 0 1 0 12 .2Zm0 21.6a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1 1 12 21.8Z"/></svg>Hablar con una persona</a>' +
      '<form class="vc-form"><textarea rows="1" maxlength="1000" placeholder="Escribí tu pregunta…" aria-label="Tu pregunta"></textarea><button class="vc-send" type="submit" aria-label="Enviar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>' +
      '<div class="vc-note">No compartas datos personales. <a href="/privacidad.html#asistente" target="_blank" rel="noopener">Privacidad</a></div>';
    document.body.appendChild(panel);
    body = panel.querySelector('.vc-body'); input = panel.querySelector('textarea'); sendBtn = panel.querySelector('.vc-send');
    sugBox = panel.querySelector('.vc-sug'); human = panel.querySelector('.vc-human');
    (SUGGEST[page] || SUGGEST.home).forEach(function(q){
      var b = document.createElement('button'); b.type = 'button'; b.textContent = q;
      b.onclick = function(){ ask(q); }; sugBox.appendChild(b);
    });
    panel.querySelector('.vc-x').onclick = function(){ panel.style.display = 'none'; launch.style.display = ''; };
    human.onclick = function(){ track('chat_handoff'); };
    panel.querySelector('form').onsubmit = function(e){ e.preventDefault(); ask(input.value); };
    input.addEventListener('keydown', function(e){ if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); ask(input.value); } });
    input.addEventListener('input', function(){ input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 110) + 'px'; });
    renderAll();
    launch.style.display = 'none';
    input.focus();
  }

  async function ask(text){
    text = String(text || '').trim();
    if (!text || busy) return;
    if (state.messages.filter(function(m){ return m.role === 'user'; }).length >= MAX_TURNS) {
      bubble('assistant', 'Llegamos al límite de esta conversación. Para seguir, escribinos por WhatsApp: ' + WA);
      return;
    }
    busy = true; sendBtn.disabled = true; input.value = ''; input.style.height = 'auto'; sugBox.style.display = 'none';
    state.messages.push({ role: 'user', content: text.slice(0, 1000) }); save();
    bubble('user', text);
    track('chat_msg');
    var out = bubble('assistant', ''); out.innerHTML = '<span class="vc-typing"><span></span><span></span><span></span></span>';
    var reply = '', failed = false;
    try {
      var res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: state.messages, conv: state.conv, page: page }) });
      if (!res.ok || !res.body) {
        var info = await res.json().catch(function(){ return {}; });
        failed = true;
        reply = res.status === 503 ? 'Ahora no puedo responder por acá, pero el equipo te contesta por WhatsApp: ' + WA
          : (info.error && res.status === 429 ? info.error + ' ' + WA : 'Uy, no pude responder ahora. Escribinos por WhatsApp: ' + WA);
      } else {
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
        for (;;) {
          var r = await reader.read(); if (r.done) break;
          buf += dec.decode(r.value, { stream: true });
          var parts = buf.split('\n\n'); buf = parts.pop();
          parts.forEach(function(p){
            var line = p.replace(/^data: /, ''); if (!line) return;
            var ev; try { ev = JSON.parse(line); } catch(e){ return; }
            if (ev.t === 'delta') reply += ev.text;
            else if (ev.t === 'replace') reply = ev.text;
            else if (ev.t === 'error') { reply = ev.text; failed = true; }
            out.innerHTML = fmt(reply); body.scrollTop = body.scrollHeight;
          });
        }
      }
    } catch(e) {
      failed = true; reply = 'Sin conexión. Revisá internet o escribinos por WhatsApp: ' + WA;
    }
    out.innerHTML = fmt(reply || ('No pude responder. Escribinos por WhatsApp: ' + WA));
    body.scrollTop = body.scrollHeight;
    // Una respuesta que falló no se guarda: la pregunta se puede volver a mandar
    if (failed || !reply) state.messages.pop(); else state.messages.push({ role: 'assistant', content: reply.slice(0, 4000) });
    save();
    human.href = waLink();
    human.classList.toggle('hot', /Te paso con una persona|wa\.me/.test(reply));
    busy = false; sendBtn.disabled = false; input.focus();
  }

  launch.onclick = open;
  if (state.messages.length) launch.querySelector('.vc-txt').textContent = 'Seguir conversación';
})();

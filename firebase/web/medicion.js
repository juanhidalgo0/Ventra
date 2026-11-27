// Medición de visitas de ventra.store: Google Analytics 4 y Píxel de Meta.
// Mientras los dos códigos estén vacíos no carga nada. En localhost no mide.
// Los eventos de la web (ventraTrack en ventra-cuenta.js) llegan acá por window.ventraMedir:
// Analytics los recibe todos con su nombre y Meta solo los que sirven para optimizar anuncios.
(function(){
  var GA_ID = 'G-NK8FJ1S7G5';         // Analytics: propiedad ventra-9cba5, flujo web "ventra-app"
  var PIXEL_ID = '1136922689314192';  // Píxel "Ventra web" del portafolio "Ventra | Sistema de ventas" (2610346422745180 es la APP del bot; 1508922827806508 quedó suelto en la cuenta publicitaria y no deja generar token)

  if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) return;
  if (!GA_ID && !PIXEL_ID) return;

  if (GA_ID) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    var g = document.createElement('script');
    g.async = true; g.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(g);
  }

  if (PIXEL_ID) {
    /* Código base del Píxel de Meta */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  // Eventos del Píxel que Meta entiende como resultados (para medir y optimizar el anuncio).
  // Los que pasan en Mercado Pago los manda la nube (functions/meta-capi.js): StartTrial cuando
  // se autoriza la tarjeta de la prueba, Subscribe en el primer cobro y Purchase en los siguientes.
  var META = {
    signup_negocio: 'Lead',                 // eligió su negocio en /empezar
    signup_google: 'CompleteRegistration',  // entró con Google: cuenta creada
    signup_pago: 'InitiateCheckout',        // salió a Mercado Pago (todavía no cargó la tarjeta)
    chat_msg: 'Contact'                     // escribió en el chat de la web
  };
  window.ventraMedir = function(e){
    try {
      if (!e || /^view_/.test(e)) return; // las vistas ya las cuenta cada herramienta sola
      if (GA_ID && window.gtag) window.gtag('event', e);
      if (PIXEL_ID && window.fbq) {
        if (META[e]) window.fbq('track', META[e]);
        else if (/^(start_|plan_|card_)/.test(e)) window.fbq('trackCustom', e);
      }
    } catch(err){}
  };
})();

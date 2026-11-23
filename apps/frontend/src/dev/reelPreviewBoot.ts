// SOLO DESARROLLO: sesión de ejemplo para /reel-preview.html. Se importa antes que la app
// para que los stores arranquen ya "logueados" (sin contraseña ni backend real).
// La app real borra la sesión al iniciar si no ve `session_initialized`; la marcamos antes.
sessionStorage.setItem('session_initialized', 'true');
localStorage.setItem('server_ip', window.location.host);
localStorage.setItem('accessToken', 'demo');
localStorage.setItem('refreshToken', 'demo');
// ?pro=<id> (m o s): entra un profesional de la agenda con usuario propio (ve solo su agenda)
const PRO = new URLSearchParams(location.search).get('pro');
localStorage.setItem('user', JSON.stringify(PRO
  ? { id: 'u-pro', username: 'SOFI', fullName: 'SOFI', role: 'CASHIER', agendaStaffId: PRO }
  : { id: 'demo', username: 'sofi', fullName: 'Sofi', role: 'ADMIN' }));
// Sin tours de bienvenida en la grabación
import { TOURS } from '../components/common/tour/tours';
localStorage.setItem('ventra_tours_seen_v2:demo', JSON.stringify(Object.fromEntries(Object.keys(TOURS).map((k) => [k, true]))));

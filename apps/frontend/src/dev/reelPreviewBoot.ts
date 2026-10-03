// SOLO DESARROLLO: sesión de ejemplo para /reel-preview.html. Se importa antes que la app
// para que los stores arranquen ya "logueados" (sin contraseña ni backend real).
// La app real borra la sesión al iniciar si no ve `session_initialized`; la marcamos antes.
sessionStorage.setItem('session_initialized', 'true');
localStorage.setItem('server_ip', window.location.host);
localStorage.setItem('accessToken', 'demo');
localStorage.setItem('refreshToken', 'demo');
localStorage.setItem('user', JSON.stringify({ id: 'demo', username: 'sofi', fullName: 'Sofi', role: 'ADMIN' }));
// Sin tours de bienvenida en la grabación
import { TOURS } from '../components/common/tour/tours';
localStorage.setItem('ventra_tours_seen:demo', JSON.stringify(Object.fromEntries(Object.keys(TOURS).map((k) => [k, true]))));

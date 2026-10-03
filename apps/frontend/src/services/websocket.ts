import { io, Socket } from 'socket.io-client';

/** El mismo token que usan los pedidos a la API (el de administrador si está desbloqueado). */
function currentToken(): string {
  const adminToken = sessionStorage.getItem('admin_unlocked') === 'true' ? sessionStorage.getItem('adminAccessToken') : null;
  return adminToken || localStorage.getItem('accessToken') || '';
}

class WebSocketService {
  private socket: Socket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  connect() {
    if (this.socket) {
      // Ya existe (por ejemplo, rechazado antes de iniciar sesión): se reintenta con el token
      // actual sin perder los oyentes que ya tiene registrados
      if (!this.socket.connected && !this.socket.active) this.socket.connect();
      return;
    }
    const savedIp = localStorage.getItem('server_ip');
    const activePort = sessionStorage.getItem('active_backend_port') || '3001';
    let socketUrl = '/';
    // Same rule as services/api.ts: a saved server_ip matching this page's own
    // host just means "deployed on a real domain", not "connect to a LAN IP".
    if (savedIp && savedIp !== 'localhost' && savedIp !== '127.0.0.1' && savedIp !== window.location.host && savedIp !== window.location.hostname) {
      const hasPort = savedIp.includes(':');
      socketUrl = `http://${savedIp}${hasPort ? '' : ':3001'}`;
    } else if (
      window.location.protocol === 'file:' ||
      window.location.protocol.startsWith('tauri') ||
      window.location.hostname.includes('tauri')
    ) {
      socketUrl = `http://127.0.0.1:${activePort}`;
    } else {
      socketUrl = window.location.origin;
    }
    const socket = io(socketUrl, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 20,
      // El servidor solo acepta sesiones iniciadas. Se pide en cada intento, así una
      // reconexión usa el token ya renovado.
      auth: (cb) => cb({ token: currentToken() }),
    });
    this.socket = socket;
    socket.on('connect', () => console.log('📡 WebSocket connected to:', socketUrl));
    socket.on('disconnect', () => console.log('📡 WebSocket disconnected'));
    socket.on('connect_error', () => {
      // Sesión rechazada (por ejemplo, el token venció): en ese caso socket.io no reintenta
      // solo. Un pedido cualquiera a la API renueva la sesión y se vuelve a probar.
      if (socket.active || !currentToken()) return;
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(async () => {
        await import('./api').then(({ default: api }) => api.get('/auth/me', { silent: true } as any)).catch(() => {});
        if (this.socket === socket && !socket.connected) socket.connect();
      }, 5000);
    });
  }

  disconnect() { clearTimeout(this.retryTimer); this.socket?.disconnect(); this.socket = null; }
  on(event: string, callback: (...args: any[]) => void) { this.socket?.on(event, callback); }
  off(event: string, callback?: (...args: any[]) => void) { this.socket?.off(event, callback); }
  emit(event: string, data?: any) { this.socket?.emit(event, data); }
  get isConnected() { return this.socket?.connected || false; }
}

export const wsService = new WebSocketService();

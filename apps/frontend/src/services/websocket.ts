import { io, Socket } from 'socket.io-client';

class WebSocketService {
  private socket: Socket | null = null;

  connect() {
    if (this.socket?.connected) return;
    const savedIp = localStorage.getItem('server_ip');
    const activePort = sessionStorage.getItem('active_backend_port') || '3001';
    let socketUrl = '/';
    if (savedIp && savedIp !== 'localhost' && savedIp !== '127.0.0.1') {
      socketUrl = `http://${savedIp}:3001`;
    } else if (window.location.protocol === 'file:') {
      socketUrl = `http://127.0.0.1:${activePort}`;
    }
    this.socket = io(socketUrl, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 10 });
    this.socket.on('connect', () => console.log('📡 WebSocket connected'));
    this.socket.on('disconnect', () => console.log('📡 WebSocket disconnected'));
  }

  disconnect() { this.socket?.disconnect(); this.socket = null; }
  on(event: string, callback: (...args: any[]) => void) { this.socket?.on(event, callback); }
  off(event: string, callback?: (...args: any[]) => void) { this.socket?.off(event, callback); }
  emit(event: string, data?: any) { this.socket?.emit(event, data); }
  get isConnected() { return this.socket?.connected || false; }
}

export const wsService = new WebSocketService();

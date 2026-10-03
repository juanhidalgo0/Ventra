import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { isAllowedOrigin } from '../common/allowed-origin';

/**
 * Canal en tiempo real (ventas, caja, productos). Solo para sesiones iniciadas: antes
 * cualquiera en la red, o cualquier página abierta en la PC de la caja, podía escuchar
 * cada venta y cada movimiento de caja.
 */
@WebSocketGateway({
  cors: { origin: (origin: string, cb: (err: Error | null, ok?: boolean) => void) => cb(null, !origin || isAllowedOrigin(origin)) },
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedClients = new Map<string, any>();

  afterInit(server: Server) {
    // El secreto lo crea main.ts al arrancar, antes de levantar los módulos
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    server.use((socket, next) => {
      const fromAuth = socket.handshake.auth && (socket.handshake.auth as any).token;
      const header = String(socket.handshake.headers.authorization || '');
      const token = String(fromAuth || (header.startsWith('Bearer ') ? header.slice(7) : ''));
      try {
        if (!token) throw new Error('sin sesión');
        jwt.verify(token);
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });
  }

  handleConnection(client: Socket) {
    console.log(`📡 Client connected: ${client.id}`);
    this.connectedClients.set(client.id, { connectedAt: new Date() });
  }

  handleDisconnect(client: Socket) {
    console.log(`📡 Client disconnected: ${client.id}`);
    this.connectedClients.delete(client.id);
  }

  emitSaleCreated(sale: any) {
    this.server?.emit('sale:created', sale);
  }

  emitStockUpdated(updates: any[]) {
    this.server?.emit('stock:updated', updates);
  }

  emitCashUpdated(data: any) {
    this.server?.emit('cash:updated', data);
  }

  /**
   * Pide a las terminales de un usuario que cierren su sesión (por ejemplo, después
   * de un cierre X o Z), para que no quede una sesión abierta en otra máquina.
   * `clientId` identifica a la terminal que originó el cierre, que se maneja sola.
   */
  emitForceLogout(data: { userId: string; reason: string; sessionId?: string; clientId?: string }) {
    this.server?.emit('auth:force-logout', data);
  }

  emitProductUpdated(product: any) {
    this.server?.emit('product:updated', product);
  }

  emitImportProgress(data: { 
    progress: number; 
    total: number; 
    current: number; 
    status: string;
    details?: {
      imported: number;
      updated: number;
      lastItem: string;
    }
  }) {
    this.server?.emit('import:progress', data);
  }

  emitSyncProgress(data: {
    progress: number;
    total: number;
    current: number;
    status: string;
    isComplete?: boolean;
    error?: string;
    omittedCount?: number;
    failedCount?: number;
  }) {
    this.server?.emit('sync:progress', data);
  }

  emitImageSyncProgress(data: {
    progress: number;
    total: number;
    current: number;
    status: string;
    isComplete?: boolean;
    error?: string;
    successCount?: number;
    noMatchCount?: number;
  }) {
    this.server?.emit('sync:images:progress', data);
  }

  getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }
}

import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedClients = new Map<string, any>();

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

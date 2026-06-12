import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
export declare class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    server: Server;
    private connectedClients;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    emitSaleCreated(sale: any): void;
    emitStockUpdated(updates: any[]): void;
    emitCashUpdated(data: any): void;
    emitProductUpdated(product: any): void;
    getConnectedClientsCount(): number;
}

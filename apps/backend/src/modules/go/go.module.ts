import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { WebsocketModule } from '../../websockets/websocket.module';
import { GoController } from './go.controller';
import { GoService } from './go.service';

@Module({
  imports: [PrismaModule, WebsocketModule],
  controllers: [GoController],
  providers: [GoService],
  exports: [GoService],
})
export class GoModule {}

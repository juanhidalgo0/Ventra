import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { WebsocketModule } from '../../websockets/websocket.module';
import { AiModule } from '../ai/ai.module';
import { GoController } from './go.controller';
import { GoService } from './go.service';

@Module({
  imports: [PrismaModule, WebsocketModule, AiModule],
  controllers: [GoController],
  providers: [GoService],
  exports: [GoService],
})
export class GoModule {}

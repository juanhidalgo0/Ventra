import { Body, Controller, Post, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AiService } from './ai.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private ai: AiService) {}

  /** Pedido de WhatsApp → renglones del catálogo (multipart: text + files) */
  @Post('order')
  @UseInterceptors(FilesInterceptor('files', 6, { limits: { fileSize: 15 * 1024 * 1024 } }))
  parseOrder(@Body('text') text: string, @UploadedFiles() files: any[]) {
    return this.ai.parseOrder(text, files || []);
  }
}

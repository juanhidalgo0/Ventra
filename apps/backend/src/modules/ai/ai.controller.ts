import { Body, Controller, Post, Request, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { AiService } from './ai.service';
import { InsightsService } from './insights.service';
import { PriceListService } from './price-list.service';

const MANAGERS = ['ADMIN', 'SUPERVISOR'];

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private ai: AiService, private insights: InsightsService, private priceList: PriceListService) {}

  /** Pedido de WhatsApp → renglones del catálogo (multipart: text + files) */
  @Post('order')
  @UseInterceptors(FilesInterceptor('files', 6, { limits: { fileSize: 15 * 1024 * 1024 } }))
  parseOrder(@Body('text') text: string, @UploadedFiles() files: any[]) {
    return this.ai.parseOrder(text, files || []);
  }

  /** Lista de precios del proveedor (PDF, Excel/CSV o fotos) → renglones y su producto */
  @Post('price-list/read')
  @Roles(...MANAGERS)
  @UseInterceptors(FilesInterceptor('files', 6, { limits: { fileSize: 25 * 1024 * 1024 } }))
  readPriceList(@UploadedFiles() files: any[], @Body('supplierId') supplierId?: string) {
    return this.priceList.read(files || [], supplierId || undefined);
  }

  /** Costos y precios de venta que quedarían, con las opciones elegidas */
  @Post('price-list/preview')
  @Roles(...MANAGERS)
  previewPriceList(@Body() body: any) {
    return this.priceList.preview(body?.items || [], body);
  }

  @Post('price-list/apply')
  @Roles(...MANAGERS)
  applyPriceList(@Body() body: any, @Request() req) {
    return this.priceList.apply(body || {}, req.user.sub);
  }

  /** Preguntale a tu negocio */
  @Post('ask')
  @Roles(...MANAGERS)
  ask(@Body('question') question: string) {
    return this.ai.ask(question, (queries) => this.insights.run(queries));
  }

  /** Ayuda dentro del sistema (cualquier usuario) */
  @Post('help')
  help(@Body() body: { messages?: { role: string; content: string }[]; screen?: string }) {
    return this.ai.help(body?.messages || [], body?.screen);
  }
}

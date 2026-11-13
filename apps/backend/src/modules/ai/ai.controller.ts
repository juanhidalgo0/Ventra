import { Body, Controller, Get, Param, Post, Query, Request, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { AiService } from './ai.service';
import { InsightsService } from './insights.service';
import { PriceListService } from './price-list.service';
import { OrganizeService } from './organize.service';

const MANAGERS = ['ADMIN', 'SUPERVISOR'];

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private ai: AiService, private insights: InsightsService, private priceList: PriceListService, private organize: OrganizeService) {}

  // ─── Organizar automáticamente (categorías, subcategorías y marcas con IA) ───
  @Get('organize/status')
  @Roles(...MANAGERS)
  organizeStatus() {
    return this.organize.status();
  }

  @Post('organize/plan')
  @Roles(...MANAGERS)
  organizePlan(@Body() body: any) {
    return this.organize.plan(body || {});
  }

  @Post('organize/batch')
  @Roles(...MANAGERS)
  organizeBatch(@Body() body: any) {
    return this.organize.batch(body || {});
  }

  @Post('organize/apply')
  @Roles(...MANAGERS)
  organizeApply(@Body() body: any, @Request() req) {
    return this.organize.apply(body || {}, req.user?.sub);
  }

  @Post('organize/undo/:batchId')
  @Roles(...MANAGERS)
  organizeUndo(@Param('batchId') batchId: string) {
    return this.organize.undo(batchId);
  }

  /** Al crear un producto: categoría y marca sugeridas (chips que se tocan para aplicar) */
  @Get('organize/suggest')
  organizeSuggest(@Query('name') name: string, @Query('rubro') rubro?: string) {
    return this.organize.suggest(name, rubro);
  }

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

  /** Este renglón de la lista es este producto: se aprende para ese proveedor */
  @Post('price-list/learn')
  @Roles(...MANAGERS)
  learnPriceList(@Body() body: any) {
    return this.priceList.learn(String(body?.supplierId || ''), body?.items || []);
  }

  @Post('price-list/apply')
  @Roles(...MANAGERS)
  applyPriceList(@Body() body: any, @Request() req) {
    return this.priceList.apply(body || {}, req.user.sub);
  }

  /** Preguntale a tu negocio */
  @Post('ask')
  @Roles(...MANAGERS)
  ask(@Body('question') question: string, @Body('history') history: any, @Request() req) {
    return this.ai.ask(question, (queries) => this.insights.run(queries), { role: req.user?.role }, Array.isArray(history) ? history : []);
  }

  /**
   * Preguntar por WhatsApp: cada uno vincula su teléfono. El dueño, además, habilita a los
   * encargados y puede desvincularlos (target = últimos 4 dígitos).
   */
  @Get('whatsapp')
  @Roles(...MANAGERS)
  whatsappStatus(@Request() req) {
    return this.ai.whatsapp('status', req.user);
  }

  @Post('whatsapp/code')
  @Roles(...MANAGERS)
  whatsappCode(@Request() req) {
    return this.ai.whatsapp('code', req.user);
  }

  @Post('whatsapp/unlink')
  @Roles(...MANAGERS)
  whatsappUnlink(@Body('target') target: string, @Request() req) {
    return this.ai.whatsapp('unlink', req.user, req.user?.role === 'ADMIN' && target ? { target: String(target).slice(-4) } : {});
  }

  @Post('whatsapp/summary')
  @Roles(...MANAGERS)
  whatsappSummary(@Body() body: { enabled?: boolean; hour?: number }, @Request() req) {
    return this.ai.whatsapp('summary', req.user, { summary: { enabled: !!body?.enabled, hour: Number(body?.hour) || 21 } });
  }

  @Post('whatsapp/supervisors')
  @Roles('ADMIN')
  whatsappSupervisors(@Body('allowed') allowed: boolean, @Request() req) {
    return this.ai.whatsapp('supervisors', req.user, { allowed: !!allowed });
  }

  /** Ayuda dentro del sistema (cualquier usuario) */
  @Post('help')
  help(@Body() body: { messages?: { role: string; content: string }[]; screen?: string }) {
    return this.ai.help(body?.messages || [], body?.screen);
  }
}

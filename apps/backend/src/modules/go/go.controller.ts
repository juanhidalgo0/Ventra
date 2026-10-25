import { Controller, Get, Post, Put, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { GoService } from './go.service';

/** GO Delivery: vincular, qué se publica, pedidos y estadísticas. Ver GoService. */
@Controller('go')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GoController {
  constructor(private go: GoService) {}

  @Get('status')
  status() {
    return this.go.status();
  }

  @Post('link')
  @Roles('ADMIN')
  link(@Body() body: { code?: string; storeName?: string }) {
    return this.go.linkWithCode(String(body?.code || ''), String(body?.storeName || ''));
  }

  @Post('unlink')
  @Roles('ADMIN')
  unlink() {
    return this.go.unlink();
  }

  @Put('settings')
  @Roles('ADMIN')
  settings(@Body() body: { publishMode?: string; publishCategories?: string[]; syncStock?: boolean }) {
    return this.go.updateSettings(body || {});
  }

  @Post('main-pc')
  @Roles('ADMIN')
  mainPc() {
    return this.go.makeMainPc();
  }

  /** Entrar al panel del comercio en GO (link de un solo uso) */
  @Post('panel-link')
  @Roles('ADMIN')
  panelLink(@Body() body: { section?: string }) {
    return this.go.panelLink(String(body?.section || 'settings'));
  }

  @Post('sync-now')
  @Roles('ADMIN')
  syncNow() {
    return this.go.syncNow();
  }

  @Get('products')
  @Roles('ADMIN')
  products(@Query('search') search?: string, @Query('categoryId') categoryId?: string, @Query('only') only?: string) {
    return this.go.listProducts({ search, categoryId, only });
  }

  /** Saca todos los productos de la tienda de GO (quedan sin publicar) */
  @Post('products/unpublish-all')
  @Roles('ADMIN')
  unpublishAll() {
    return this.go.unpublishAll();
  }

  /** publish: true / false fija los productos; null los vuelve a la regla general */
  @Put('products')
  @Roles('ADMIN')
  setProducts(@Body() body: { ids?: string[]; publish?: boolean | null }) {
    return this.go.setProductsPublish(body?.ids || [], body?.publish === undefined ? null : body.publish);
  }

  /** Los pedidos los ve también el cajero: el repartidor viene a comprar al mostrador */
  @Get('orders')
  orders(@Query('from') from?: string, @Query('to') to?: string, @Query('status') status?: string) {
    return this.go.listOrders({ from, to, status });
  }

  @Get('stats')
  @Roles('ADMIN')
  stats(@Query('from') from?: string, @Query('to') to?: string) {
    return this.go.stats({ from, to });
  }
}

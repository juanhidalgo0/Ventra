import { Controller, Get, Post, Body, Patch, Param, UseGuards, Request, Delete, ForbiddenException, Query } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  findAll() { return this.clientsService.findAll(); }

  /** Resumen de cuenta: saldo anterior, cada venta a cuenta y cada pago con el saldo que dejó, y el saldo final */
  @Get(':id/statement')
  statement(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) { return this.clientsService.statement(id, { from, to }); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.clientsService.findOne(id); }

  @Post()
  create(@Body() data: any, @Request() req: any) { return this.clientsService.create(data, req.user?.role === 'ADMIN'); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any, @Request() req: any) { return this.clientsService.update(id, data, req.user?.role === 'ADMIN'); }

  @Post(':id/movement')
  addMovement(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    const userId = req.user?.sub;
    return this.clientsService.addMovement(id, { ...data, userId: data.userId || userId });
  }

  @Post(':id/movements')
  addMovements(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    const userId = req.user?.sub;
    return this.clientsService.addMovement(id, { ...data, userId: data.userId || userId });
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException('Solo el administrador puede borrar clientes');
    return this.clientsService.remove(id);
  }
}

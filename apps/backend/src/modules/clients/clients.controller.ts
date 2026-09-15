import { Controller, Get, Post, Body, Patch, Param, UseGuards, Request, Delete } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  findAll() { return this.clientsService.findAll(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.clientsService.findOne(id); }

  @Post()
  create(@Body() data: any) { return this.clientsService.create(data); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any) { return this.clientsService.update(id, data); }

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
  remove(@Param('id') id: string) {
    return this.clientsService.remove(id);
  }
}

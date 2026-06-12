import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { CashRegisterService } from './cash-register.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('cash')
@UseGuards(JwtAuthGuard)
export class CashRegisterController {
  constructor(private cashService: CashRegisterService) {}

  @Get('terminal-name')
  getTerminalName(@Query('terminalId') terminalId: string) {
    return this.cashService.getTerminalName(terminalId);
  }

  @Post('open')
  open(@Request() req, @Body() dto: { terminalName: string; openingAmount: number; openingNotes?: string }) {
    return this.cashService.open(req.user.sub, dto);
  }

  @Post(':sessionId/close')
  close(@Param('sessionId') sessionId: string, @Request() req, @Body() dto: { closingAmountCounted?: number; closingNotes?: string }) {
    return this.cashService.close(sessionId, req.user.sub, dto);
  }

  @Get('pending-arqueos')
  getPendingArqueos(@Request() req) {
    return this.cashService.getPendingArqueos(req.user.sub);
  }

  @Post(':sessionId/arqueo')
  completeArqueo(@Param('sessionId') sessionId: string, @Request() req, @Body() dto: { closingAmountCounted: number; closingNotes?: string; posnetDeclarations?: Record<string, number> }) {
    return this.cashService.completeArqueo(sessionId, req.user.sub, dto);
  }

  @Get('active')
  getActive() {
    return this.cashService.getActiveSessions();
  }

  @Get('current')
  getCurrent(@Request() req, @Query('terminalName') terminalName?: string) { 
    return this.cashService.getCurrentSession(req.user.sub, terminalName); 
  }

  @Post('reset-all')
  resetAll() {
    return this.cashService.resetAllCajas();
  }

  @Get('movements')
  getMovements(@Query('type') type?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.cashService.getMovements({ type, from, to });
  }

  @Delete('movement/:id')
  deleteMovement(@Param('id') id: string, @Request() req) {
    return this.cashService.deleteCashMovement(id, req.user.sub);
  }

  @Get('history')
  getHistory(@Query('userId') userId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.cashService.getHistory({ userId, from, to });
  }

  @Post(':sessionId/movement')
  addMovement(@Param('sessionId') sessionId: string, @Request() req, @Body() dto: { type: string; amount: number; description?: string }) {
    return this.cashService.addCashMovement(sessionId, req.user.sub, dto);
  }
}

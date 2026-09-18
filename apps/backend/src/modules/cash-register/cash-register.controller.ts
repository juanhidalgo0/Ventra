import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
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

  @Get('server-ip')
  getServerIp() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let ip = '127.0.0.1';
    
    const isLocalPrivateIP = (ipStr: string) => {
      const parts = ipStr.split('.');
      if (parts.length !== 4) return false;
      const p1 = parseInt(parts[0]);
      const p2 = parseInt(parts[1]);
      // Class C private: 192.168.x.x
      if (p1 === 192 && p2 === 168) return true;
      // Class B private: 172.16.x.x to 172.31.x.x
      if (p1 === 172 && p2 >= 16 && p2 <= 31) return true;
      // Class A private: 10.x.x.x (excluding CGNAT / Tailscale 100.x.x.x)
      if (p1 === 10) return true;
      return false;
    };
    
    const privateIps: string[] = [];
    const physicalIps: string[] = [];
    const fallbackIps: string[] = [];
    
    for (const devName in interfaces) {
      const isVirtual = devName.toLowerCase().includes('virtual') || 
                        devName.toLowerCase().includes('vbox') || 
                        devName.toLowerCase().includes('vmware') || 
                        devName.toLowerCase().includes('wsl') || 
                        devName.toLowerCase().includes('loopback') || 
                        devName.toLowerCase().includes('host-only') ||
                        devName.toLowerCase().includes('tailscale') ||
                        devName.toLowerCase().includes('vethernet');
                        
      const iface = interfaces[devName];
      if (iface) {
        for (const alias of iface) {
          if (alias.family === 'IPv4' && !alias.internal) {
            const isPrivate = isLocalPrivateIP(alias.address);
            if (isPrivate && !isVirtual) {
              privateIps.push(alias.address);
            } else if (!isVirtual) {
              physicalIps.push(alias.address);
            } else {
              fallbackIps.push(alias.address);
            }
          }
        }
      }
    }
    
    if (privateIps.length > 0) {
      ip = privateIps[0];
    } else if (physicalIps.length > 0) {
      ip = physicalIps[0];
    } else if (fallbackIps.length > 0) {
      ip = fallbackIps[0];
    }
    
    return { ip, tunnelUrl: process.env.PUBLIC_TUNNEL_URL || '' };
  }

  @Post('open')
  open(@Request() req, @Body() dto: { terminalName: string; openingAmount: number; openingNotes?: string }) {
    return this.cashService.open(req.user.sub, dto);
  }

  @Post(':sessionId/close')
  close(@Param('sessionId') sessionId: string, @Request() req, @Body() dto: { closingAmountCounted?: number; closingNotes?: string; clientId?: string }) {
    return this.cashService.close(sessionId, req.user.sub, dto);
  }

  @Get('pending-arqueos')
  getPendingArqueos(@Request() req) {
    return this.cashService.getPendingArqueos(req.user.sub);
  }

  @Get('pending-arqueos/all')
  getAllPendingArqueos() {
    return this.cashService.getAllPendingArqueos();
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

  @Get('z-report/pending')
  getPendingZReportSummary() {
    return this.cashService.getPendingZReportSummary();
  }

  @Get('z-reports')
  getZReportsHistory(@Query('skip') skip?: number, @Query('limit') limit?: number) {
    return this.cashService.getZReportsHistory({
      skip: skip !== undefined ? Number(skip) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('z-report/generate')
  generateZReport(@Request() req) {
    return this.cashService.generateZReport(req.user.sub);
  }

  @Get('movements')
  getMovements(@Query('type') type?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.cashService.getMovements({ type, from, to });
  }

  @Delete('movement/:id')
  deleteMovement(@Param('id') id: string, @Request() req) {
    return this.cashService.deleteCashMovement(id, req.user.sub);
  }

  @Put('movement/:id')
  updateMovement(@Param('id') id: string, @Request() req, @Body() dto: { type?: string; amount?: number; description?: string }) {
    return this.cashService.updateCashMovement(id, req.user.sub, dto);
  }

  @Get('history')
  getHistory(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: number,
    @Query('limit') limit?: number,
  ) {
    return this.cashService.getHistory({
      userId,
      from,
      to,
      skip: skip !== undefined ? Number(skip) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('session/:id')
  getSessionById(@Param('id') id: string) {
    return this.cashService.getSessionById(id);
  }

  @Post(':sessionId/movement')
  addMovement(@Param('sessionId') sessionId: string, @Request() req, @Body() dto: { type: string; amount: number; description?: string }) {
    return this.cashService.addCashMovement(sessionId, req.user.sub, dto);
  }
}

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
  async getServerIp() {
    return { ip: await outboundLanIp(), tunnelUrl: process.env.PUBLIC_TUNNEL_URL || '' };
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
  generateZReport(@Request() req, @Body() dto: { clientId?: string }) {
    return this.cashService.generateZReport(req.user.sub, dto?.clientId);
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

/**
 * IP de esta PC en la red local, la que tiene que escanear el celular.
 *
 * No se puede elegir por nombre de interfaz: Windows llama "Ethernet 2" al adaptador
 * Host-Only de VirtualBox, que no contiene "virtual" ni "vbox" en el nombre y encima
 * usa un rango 192.168.x.x igual de privado que el de la red real. Elegir la primera
 * 192.168 que aparezca devuelve una dirección a la que el celular nunca llega.
 *
 * En vez de adivinar, se le pregunta al sistema operativo qué interfaz usaría para
 * salir a internet: se abre un socket UDP hacia una dirección pública y se lee la IP
 * local que el sistema eligió para la ruta. No se envía ningún paquete (UDP no
 * establece conexión) y no hace falta tener internet: alcanza con que exista la ruta.
 */
async function outboundLanIp(): Promise<string> {
  const dgram = require('dgram');
  const elegida = await new Promise<string>((resolve) => {
    let listo = false;
    const socket = dgram.createSocket('udp4');
    const terminar = (valor: string) => {
      if (listo) return;
      listo = true;
      try { socket.close(); } catch {}
      resolve(valor);
    };
    socket.once('error', () => terminar(''));
    try {
      socket.connect(53, '8.8.8.8', () => {
        try { terminar(socket.address().address || ''); } catch { terminar(''); }
      });
    } catch { terminar(''); }
    setTimeout(() => terminar(''), 700);
  });
  if (elegida && elegida !== '0.0.0.0' && !elegida.startsWith('127.')) return elegida;

  // Respaldo: primera IPv4 privada no interna, descartando rangos que son siempre
  // virtuales (192.168.56.x es el Host-Only por defecto de VirtualBox) y la CGNAT
  // 100.64-127.x.x que usa Tailscale.
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const candidatas: string[] = [];
  for (const nombre in interfaces) {
    for (const alias of interfaces[nombre] || []) {
      if (alias.family !== 'IPv4' || alias.internal) continue;
      const ip = alias.address as string;
      const [a, b] = ip.split('.').map(Number);
      if (ip.startsWith('192.168.56.')) continue;
      if (a === 100 && b >= 64 && b <= 127) continue;
      const privada = (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a === 10;
      if (privada) candidatas.push(ip);
    }
  }
  return candidatas[0] || '127.0.0.1';
}

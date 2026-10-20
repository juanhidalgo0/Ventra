import { Controller, Post, Body, Req, Res, UseGuards, BadRequestException, NotFoundException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { demoContext, demoVisitors, isDemoMode, readDemoCookie, setDemoCookie } from './demo-visitors';
import { applyDemoProfile, DEMO_PROFILES, DemoProfile } from './demo-rubros';

/** Demo pública: cada visitante arranca su propia demo y la arma según el rubro que elige. */
@Controller('demo')
export class DemoController {
  constructor(private prisma: PrismaService) {}

  /**
   * La pantalla de entrada lo llama antes de entrar. Si este navegador ya tiene una demo en
   * curso sigue con esa (por ejemplo, salió para entrar como el vendedor); si no, arranca una
   * nueva desde cero. `created` le avisa al navegador que olvide lo de la demo anterior.
   */
  @Post('start')
  async start(@Req() req: any, @Res({ passthrough: true }) res: any) {
    if (!isDemoMode()) throw new NotFoundException();
    const current = demoVisitors.get(readDemoCookie(req));
    if (current) {
      setDemoCookie(req, res, current.id); // otro día más
      return { created: false };
    }
    try {
      // Fuera de cualquier demo: la copia sale siempre de la base molde
      const visitor = await demoContext.exit(() => demoVisitors.create(this.prisma));
      setDemoCookie(req, res, visitor.id);
      return { created: true };
    } catch (err: any) {
      throw new HttpException(err.message || 'No se pudo preparar la demo', err.status || 500);
    }
  }

  /** Carga el catálogo y los ejemplos del rubro elegido en la demo de este visitante. */
  @Post('rubro')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async rubro(@Body() body: { profile?: string }) {
    if (!isDemoMode()) throw new NotFoundException();
    const visitor = demoContext.getStore();
    if (!visitor) throw new BadRequestException('Tu demo terminó. Entrá de nuevo para empezar otra.');
    const profile = String(body?.profile || '') as DemoProfile;
    if (!DEMO_PROFILES.includes(profile)) throw new BadRequestException('Rubro desconocido');
    await applyDemoProfile(visitor.client, profile);
    return { ok: true };
  }
}

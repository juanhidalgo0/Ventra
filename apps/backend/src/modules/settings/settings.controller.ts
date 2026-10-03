import { Controller, Get, Put, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

const KEY_RE = /^[a-z0-9_.-]{1,64}$/;
const MAX_VALUE = 20_000;
const MAX_KEYS = 50;

/**
 * Configuración del comercio compartida entre todos sus equipos (tabla store_settings).
 * Una fila por ajuste: el sync la lleva a las otras cajas, a la nube y al celular, y como
 * gana el último cambio por fila, dos equipos que tocan ajustes distintos no se pisan.
 * SQL directo (como las migraciones de PrismaService): no depende de regenerar el cliente.
 */
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private prisma: PrismaService) {}

  /** { clave: valor } con todos los ajustes guardados. */
  @Get()
  async all() {
    const rows: { id: string; value: string }[] = await this.prisma.$queryRawUnsafe(`SELECT id, value FROM store_settings`);
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try { out[r.id] = JSON.parse(r.value); } catch { /* valor roto: se ignora */ }
    }
    return out;
  }

  /**
   * Cuánto avanzó el comercio en usar Ventra, para los "Primeros pasos" y para no mostrarle la
   * bienvenida a un comercio que ya trabaja. Solo conteos baratos (EXISTS en las ventas: en un
   * kiosco grande son cientos de miles).
   */
  @Get('activation')
  @Roles('ADMIN')
  async activation() {
    const [row]: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE is_active = 1) AS products,
        (SELECT COUNT(*) FROM users WHERE is_active = 1) AS users,
        EXISTS (SELECT 1 FROM sales) AS hasSales
    `);
    return { products: Number(row?.products) || 0, users: Number(row?.users) || 0, hasSales: !!Number(row?.hasSales) };
  }

  /** Guarda varios ajustes de una vez: { values: { clave: valor } }. null borra el ajuste. */
  @Put()
  @Roles('ADMIN')
  async save(@Body() body: { values?: Record<string, unknown> }) {
    const values = body?.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new BadRequestException('Faltan los ajustes');
    const entries = Object.entries(values);
    if (entries.length > MAX_KEYS) throw new BadRequestException('Demasiados ajustes juntos');
    for (const [key, value] of entries) {
      if (!KEY_RE.test(key)) throw new BadRequestException(`Ajuste inválido: ${key}`);
      if (value !== null && JSON.stringify(value).length > MAX_VALUE) throw new BadRequestException(`El ajuste ${key} es demasiado grande`);
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        if (value === null) {
          await tx.$executeRawUnsafe(`DELETE FROM store_settings WHERE id = ?`, key);
          continue;
        }
        const json = JSON.stringify(value);
        // Sin cambios no se escribe: cada escritura viaja por el sync a todos los equipos
        await tx.$executeRawUnsafe(
          `INSERT INTO store_settings (id, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
           WHERE store_settings.value <> excluded.value`,
          key, json,
        );
      }
    });
    return this.all();
  }
}

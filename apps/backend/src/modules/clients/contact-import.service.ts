import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ContactKind, ContactRow, parseContacts } from './contact-import';

/** Lo que dice el saldo importado en la cuenta corriente y en la deuda con el proveedor */
export const OPENING_NOTE = 'Saldo anterior al sistema (importado)';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const cuitFmt = (d: string) => `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  /** Nuevos con saldo y la suma de esos saldos (a los que ya existían no se les toca el saldo) */
  withBalance: number;
  balanceTotal: number;
  trade: number;
  problems: string[];
  sample: { name: string; cuit: string | null; dni: string | null; locality: string | null; priceList: string; balance: number; existing: boolean }[];
}

/**
 * Importa clientes o proveedores de una planilla de otro sistema. Se puede repetir: reconoce a
 * los que ya están por CUIT, DNI o nombre y solo les completa los datos (el saldo se carga una
 * sola vez, al crearlos, como movimiento "Saldo anterior al sistema").
 */
@Injectable()
export class ContactImportService {
  constructor(private prisma: PrismaService) {}

  private parse(buffer: Buffer, kind: ContactKind) {
    if (kind !== 'clients' && kind !== 'suppliers') throw new BadRequestException('Tipo de importación desconocido');
    try {
      return parseContacts(buffer, kind);
    } catch {
      throw new BadRequestException('No pude leer el archivo. Tiene que ser una planilla de Excel (.xlsx o .xls) o CSV.');
    }
  }

  /** Clientes o proveedores que ya están, para reconocerlos */
  private async existing(kind: ContactKind) {
    if (kind === 'clients') {
      const list = await this.prisma.client.findMany({ select: { id: true, name: true, cuit: true, dni: true } });
      return list.map((c) => ({ id: c.id, name: c.name, cuit: (c.cuit || '').replace(/\D/g, '') || null, dni: c.dni || null }));
    }
    const rows = await this.prisma.$queryRawUnsafe<{ id: string; name: string; cuit: string | null }[]>(`SELECT id, name, cuit FROM suppliers`).catch(async () =>
      (await this.prisma.supplier.findMany({ select: { id: true, name: true } })).map((s) => ({ ...s, cuit: null })));
    return rows.map((s) => ({ id: s.id, name: s.name, cuit: (s.cuit || '').replace(/\D/g, '') || null, dni: null as string | null }));
  }

  private matcher(list: { id: string; name: string; cuit: string | null; dni: string | null }[]) {
    const byCuit = new Map(list.filter((x) => x.cuit).map((x) => [x.cuit!, x.id]));
    const byDni = new Map(list.filter((x) => x.dni).map((x) => [x.dni!, x.id]));
    const byName = new Map(list.map((x) => [norm(x.name), x.id]));
    return (r: ContactRow) => (r.cuit && byCuit.get(r.cuit)) || (r.dni && byDni.get(r.dni)) || byName.get(norm(r.name)) || null;
  }

  async preview(buffer: Buffer, kind: ContactKind): Promise<ImportSummary> {
    const { rows, problems } = this.parse(buffer, kind);
    const find = this.matcher(await this.existing(kind));
    const isNew = rows.map((r) => !find(r));
    const news = rows.filter((_, i) => isNew[i]);
    const withBal = news.filter((r) => Math.abs(r.balance) >= 0.01);
    return {
      total: rows.length,
      created: news.length,
      updated: rows.length - news.length,
      withBalance: withBal.length,
      balanceTotal: Math.round(withBal.reduce((s, r) => s + r.balance, 0) * 100) / 100,
      trade: rows.filter((r) => r.priceList === 'TRADE').length,
      problems: problems.slice(0, 50),
      sample: rows.slice(0, 8).map((r, i) => ({ name: r.name, cuit: r.cuit, dni: r.dni, locality: r.locality, priceList: r.priceList, balance: r.balance, existing: !isNew[i] })),
    };
  }

  async run(buffer: Buffer, kind: ContactKind, userId: string): Promise<ImportSummary> {
    if (!userId) throw new BadRequestException('Falta el usuario');
    const summary = await this.preview(buffer, kind);
    const { rows } = this.parse(buffer, kind);
    const find = this.matcher(await this.existing(kind));
    let created = 0, updated = 0;
    const failed: string[] = [];
    for (const r of rows) {
      const id = find(r);
      try {
        if (kind === 'clients') await this.saveClient(r, id, userId);
        else await this.saveSupplier(r, id, userId);
        if (id) updated++; else created++;
      } catch (e: any) {
        failed.push(`Renglón ${r.line} (${r.name}): ${e?.code === 'P2002' ? 'DNI repetido con otro cliente' : 'no se pudo guardar'}`);
      }
    }
    return { ...summary, created, updated, problems: [...summary.problems, ...failed].slice(0, 80) };
  }

  /** Datos de la planilla; en uno que ya existe solo se completan los que tienen valor */
  private clientData(r: ContactRow) {
    const d: any = {
      name: r.name,
      ivaCondition: r.ivaCondition,
      priceList: r.priceList,
      ...(r.cuit ? { cuit: r.cuit } : {}),
      ...(r.dni ? { dni: r.dni } : {}),
      ...(r.phone ? { phone: r.phone } : {}),
      ...(r.email ? { email: r.email } : {}),
      ...(r.address ? { address: r.address } : {}),
      ...(r.locality ? { locality: r.locality } : {}),
      ...(r.monthlyInvoice ? { monthlyInvoice: true } : {}),
    };
    return d;
  }

  private async saveClient(r: ContactRow, id: string | null, userId: string) {
    if (id) { await this.prisma.client.update({ where: { id }, data: this.clientData(r) }); return; }
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.client.create({ data: this.clientData(r) });
      if (Math.abs(r.balance) < 0.01) return;
      // Positivo: nos debe (como una venta a cuenta). Negativo: tiene a favor (como un pago adelantado)
      await tx.accountMovement.create({
        data: { clientId: c.id, userId, type: r.balance > 0 ? 'DEBT' : 'PAYMENT', amount: Math.abs(r.balance), balanceBefore: 0, balanceAfter: r.balance, description: OPENING_NOTE },
      });
      await tx.client.update({ where: { id: c.id }, data: { balance: r.balance } });
    });
  }

  private async saveSupplier(r: ContactRow, id: string | null, userId: string) {
    const base: any = { name: r.name, ...(r.contact ? { contact: r.contact } : {}), ...(r.phone ? { phone: r.phone } : {}), ...(r.email ? { email: r.email } : {}) };
    const extras = async (sid: string) => {
      if (r.cuit) await this.prisma.$executeRawUnsafe(`UPDATE suppliers SET cuit = ? WHERE id = ?`, cuitFmt(r.cuit), sid).catch(() => {});
      if (r.paymentDays) await this.prisma.$executeRawUnsafe(`UPDATE suppliers SET payment_days = ? WHERE id = ?`, r.paymentDays, sid).catch(() => {});
    };
    if (id) { await this.prisma.supplier.update({ where: { id }, data: base }); await extras(id); return; }
    const s = await this.prisma.supplier.create({ data: base });
    await extras(s.id);
    if (r.balance >= 0.01) {
      // Lo que se le debe entra como una compra a pagar, sin productos (no mueve stock ni la caja)
      await this.prisma.purchase.create({ data: { supplierId: s.id, userId, total: r.balance, status: 'COMPLETED', paymentStatus: 'OWED', invoiceNumber: 'SALDO INICIAL', notes: OPENING_NOTE } });
    } else if (r.balance <= -0.01) {
      // A favor nuestro: un pago adelantado que se descuenta de las próximas compras
      await this.prisma.supplierPayment.create({ data: { supplierId: s.id, userId, amount: Math.abs(r.balance), method: 'SALDO', notes: OPENING_NOTE } });
    }
  }
}

import { PrismaService } from '../../database/prisma.service';

/**
 * Profesionales de la agenda con usuario propio: qué usuario de la caja es qué profesional
 * de la agenda. Se guarda en store_settings (clave agenda_pros = { userId: staffId }) para que
 * viaje sola por el sync a la nube y a las otras cajas, sin tocar la tabla de usuarios.
 */
export const AGENDA_PROS_KEY = 'agenda_pros';
export const STAFF_ID_RE = /^[\w-]{1,40}$/;

export async function readAgendaPros(prisma: PrismaService): Promise<Record<string, string>> {
  try {
    const rows: { value: string }[] = await prisma.$queryRawUnsafe(`SELECT value FROM store_settings WHERE id = ?`, AGENDA_PROS_KEY);
    const parsed = rows[0] ? JSON.parse(rows[0].value) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [userId, staffId] of Object.entries(parsed)) {
      if (typeof staffId === 'string' && STAFF_ID_RE.test(staffId)) out[userId] = staffId;
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeAgendaPros(prisma: PrismaService, map: Record<string, string>) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO store_settings (id, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
     WHERE store_settings.value <> excluded.value`,
    AGENDA_PROS_KEY, JSON.stringify(map),
  );
}

/** Profesional de la agenda que es este usuario (null si no es ninguno). El administrador nunca lo es: ve todo. */
export async function agendaStaffIdOf(prisma: PrismaService, user: { id?: string; sub?: string; role?: string } | null | undefined): Promise<string | null> {
  const id = user?.id || user?.sub;
  if (!id || user?.role === 'ADMIN') return null;
  return (await readAgendaPros(prisma))[id] || null;
}

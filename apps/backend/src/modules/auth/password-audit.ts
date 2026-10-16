import * as os from 'os';

type AuditDb = { auditLog: { create(args: any): Promise<unknown> } };

/**
 * Deja anotado cada cambio de clave (nunca la clave ni su hash): de quién, quién la cambió,
 * por dónde y en qué caja. Los registros suben a la nube con el sync, así que se ve también
 * desde qué caja se hizo. Antes no quedaba rastro y no se podía saber por qué la clave cambiaba.
 */
export async function logPasswordChange(
  db: AuditDb,
  target: { id: string; username: string },
  actorId: string | null,
  via: 'PROPIA' | 'USUARIOS' | 'RECUPERACION' | 'ALTA' | 'PRIMER_ADMIN',
) {
  const terminal = process.env.VENTRA_NODE_KIND === 'cloud' ? 'nube' : os.hostname();
  try {
    await db.auditLog.create({
      data: {
        userId: actorId,
        entityType: 'USER',
        entityId: target.id,
        action: 'PASSWORD_CHANGE',
        newValues: JSON.stringify({ username: target.username, via }),
        terminal,
      },
    });
  } catch (err: any) {
    // El cambio de clave ya se hizo: si no se puede anotar, no se le devuelve error al usuario
    console.warn('[Auth] No se pudo anotar el cambio de clave:', err.message);
  }
}

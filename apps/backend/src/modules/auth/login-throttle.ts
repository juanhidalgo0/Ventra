import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';

/** Sin intentos fallidos por este tiempo, se empieza de cero. */
const FORGET_MS = 15 * 60 * 1000;

/**
 * Demora creciente ante claves incorrectas, por equipo (IP). No bloquea a nadie por minutos:
 * los dos primeros errores no esperan, después 1, 2, 4, 8, 16 y como mucho 30 segundos. Alcanza
 * para que probar las 10.000 claves de 4 números lleve días en vez de minutos (el backend se
 * puede alcanzar desde el WiFi del local).
 *
 * Los intentos de un mismo equipo se atienden de a uno: mandar muchos a la vez no saltea la espera.
 */
export class LoginThrottle {
  private state = new Map<string, { failures: number; until: number; last: number }>();
  private queue = new Map<string, Promise<unknown>>();

  constructor(private now: () => number = () => Date.now()) {}

  static delayFor(failures: number): number {
    if (failures < 3) return 0;
    return Math.min(30, 2 ** (failures - 3)) * 1000;
  }

  run<T>(key: string, attempt: () => Promise<T>): Promise<T> {
    const prev = this.queue.get(key) || Promise.resolve();
    const result = prev.then(() => this.guarded(key, attempt));
    const tail = result.catch(() => undefined);
    this.queue.set(key, tail);
    tail.then(() => { if (this.queue.get(key) === tail) this.queue.delete(key); });
    return result;
  }

  private async guarded<T>(key: string, attempt: () => Promise<T>): Promise<T> {
    const now = this.now();
    this.prune(now);
    let s = this.state.get(key);
    if (s && now - s.last > FORGET_MS) { this.state.delete(key); s = undefined; }
    if (s && now < s.until) {
      const secs = Math.ceil((s.until - now) / 1000);
      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Varios intentos con la clave incorrecta. Esperá ${secs} ${secs === 1 ? 'segundo' : 'segundos'} y probá de nuevo.`,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      const r = await attempt();
      this.state.delete(key);
      return r;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        const failures = (s?.failures || 0) + 1;
        const at = this.now();
        this.state.set(key, { failures, until: at + LoginThrottle.delayFor(failures), last: at });
      }
      throw err;
    }
  }

  private prune(now: number) {
    if (this.state.size < 500) return;
    for (const [k, v] of this.state) if (now - v.last > FORGET_MS) this.state.delete(k);
  }
}

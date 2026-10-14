/**
 * Pruebas de la demora ante claves incorrectas (LoginThrottle), con un reloj falso.
 *
 *   npm run test:auth
 */
import * as assert from 'assert';
import { UnauthorizedException } from '@nestjs/common';
import { LoginThrottle } from '../src/modules/auth/login-throttle';

let fallas = 0;
let ok = 0;
const t = async (nombre: string, fn: () => Promise<void>) => {
  try {
    await fn();
    ok++;
    console.log(`ok    ${nombre}`);
  } catch (e: any) {
    fallas++;
    console.log(`FALLA ${nombre}\n      ${e.message}`);
  }
};

const mal = async () => { throw new UnauthorizedException('Credenciales inválidas'); };
const bien = async () => 'sesión';
const status = (e: any) => e?.getStatus?.();

async function main() {
  await t('los dos primeros errores no esperan; el tercero, 1 segundo', async () => {
    let now = 0;
    const th = new LoginThrottle(() => now);
    for (let i = 0; i < 3; i++) await assert.rejects(() => th.run('pc', mal), (e) => status(e) === 401);
    // Durante la espera ni siquiera se prueba la clave (también la correcta espera)
    await assert.rejects(() => th.run('pc', bien), (e) => status(e) === 429 && /1 segundo/.test(e.message));
    now += 1000;
    assert.strictEqual(await th.run('pc', bien), 'sesión');
  });

  await t('la espera crece hasta 30 segundos y no más', async () => {
    let now = 0;
    const th = new LoginThrottle(() => now);
    const esperas: number[] = [];
    for (let i = 0; i < 10; i++) {
      await assert.rejects(() => th.run('pc', mal));
      esperas.push(LoginThrottle.delayFor(i + 1) / 1000);
      now += LoginThrottle.delayFor(i + 1);
    }
    assert.deepStrictEqual(esperas, [0, 0, 1, 2, 4, 8, 16, 30, 30, 30]);
  });

  await t('entrar bien borra los errores', async () => {
    let now = 0;
    const th = new LoginThrottle(() => now);
    for (let i = 0; i < 2; i++) await assert.rejects(() => th.run('pc', mal));
    await th.run('pc', bien);
    for (let i = 0; i < 2; i++) await assert.rejects(() => th.run('pc', mal), (e) => status(e) === 401);
  });

  await t('cada equipo tiene su propia cuenta: un celular que se equivoca no frena la caja', async () => {
    let now = 0;
    const th = new LoginThrottle(() => now);
    for (let i = 0; i < 5; i++) { await th.run('celular', mal).catch(() => {}); }
    assert.strictEqual(await th.run('caja', bien), 'sesión');
  });

  await t('15 minutos sin intentos: se empieza de cero', async () => {
    let now = 0;
    const th = new LoginThrottle(() => now);
    for (let i = 0; i < 8; i++) { await th.run('pc', mal).catch(() => {}); now += 30000; }
    now += 15 * 60 * 1000 + 1;
    for (let i = 0; i < 2; i++) await assert.rejects(() => th.run('pc', mal), (e) => status(e) === 401);
  });

  await t('muchos intentos a la vez se atienden de a uno (no saltean la espera)', async () => {
    const now = 0;
    const th = new LoginThrottle(() => now);
    const r = await Promise.allSettled(Array.from({ length: 50 }, () => th.run('atacante', mal)));
    const probadas = r.filter((x) => x.status === 'rejected' && status((x as any).reason) === 401).length;
    assert.strictEqual(probadas, 3, `se probaron ${probadas} claves`);
  });

  await t('otros errores (no de clave) no cuentan como intento fallido', async () => {
    const now = 0;
    const th = new LoginThrottle(() => now);
    for (let i = 0; i < 5; i++) await assert.rejects(() => th.run('pc', async () => { throw new Error('base ocupada'); }));
    assert.strictEqual(await th.run('pc', bien), 'sesión');
  });

  console.log(`\n${ok} bien, ${fallas} con falla`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });

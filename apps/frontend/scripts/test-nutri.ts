// Pruebas de los cálculos del consultorio de nutrición (services/nutriCore.ts).
// npm run test:nutri
import assert from 'node:assert/strict';
import {
  ageOn, bmi, bmiCategory, healthyWeightRange, waistHipRatio, waistRisk, bodyFatDW, fatPctOf, mifflin, harrisBenedict,
  totalEnergy, summarize, evolution, editable, parseNum, daysBetween, type Consulta,
} from '../src/services/nutriCore';

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log('  ✓', name); };
const near = (a: number | null, b: number, tol = 0.15) => assert.ok(a != null && Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

t('edad cumplida', () => {
  assert.equal(ageOn('1990-05-20', '2026-05-19'), 35);
  assert.equal(ageOn('1990-05-20', '2026-05-20'), 36);
  assert.equal(ageOn(undefined, '2026-05-20'), null);
  assert.equal(ageOn('20/05/1990', '2026-05-20'), null);
});

t('IMC y categoría OMS', () => {
  assert.equal(bmi(80, 180), 24.7);
  assert.equal(bmi(undefined, 180), null);
  assert.equal(bmiCategory(24.7, 30)?.label, 'Normal');
  assert.equal(bmiCategory(25, 30)?.label, 'Sobrepeso');
  assert.equal(bmiCategory(41, 30)?.label, 'Obesidad grado III');
  assert.equal(bmiCategory(17, 30)?.label, 'Bajo peso');
  assert.equal(bmiCategory(30, 15)?.tone, 'info');
  assert.deepEqual(healthyWeightRange(165), [50.4, 67.8]);
});

t('cintura y cintura/cadera', () => {
  assert.equal(waistHipRatio(80, 100), 0.8);
  assert.equal(waistRisk(85, 'F')?.tone, 'warn');
  assert.equal(waistRisk(90, 'F')?.tone, 'bad');
  assert.equal(waistRisk(90, 'M')?.tone, 'ok');
  assert.equal(waistRisk(90, undefined), null);
});

t('% de grasa por pliegues (Durnin-Womersley + Siri)', () => {
  // Mujer de 30 años, Σ4 = 51 mm → densidad 1.1423 − 0.0632·log10(51) ≈ 1.03438 → ≈ 28.5 %
  near(bodyFatDW({ biceps: 10, triceps: 15, subscapular: 12, suprailiac: 14 }, 'F', 30), 28.5);
  // Hombre de 25 años, Σ4 = 40 mm → 1.1631 − 0.0632·log10(40) ≈ 1.06185 → ≈ 16.2 %
  near(bodyFatDW({ biceps: 6, triceps: 10, subscapular: 12, suprailiac: 12 }, 'M', 25), 16.2);
  // Faltan pliegues, sexo o edad: no se calcula
  assert.equal(bodyFatDW({ biceps: 6, triceps: 10, subscapular: 12 }, 'M', 25), null);
  assert.equal(bodyFatDW({ biceps: 6, triceps: 10, subscapular: 12, suprailiac: 12 }, 'M', 15), null);
  // Sin pliegues completos se usa el de la balanza
  assert.deepEqual(fatPctOf({ bia: { fatPct: 31 } }, 'F', 30), { value: 31, source: 'bioimpedancia' });
});

t('energía: Mifflin-St Jeor, Harris-Benedict y actividad', () => {
  assert.equal(mifflin(80, 180, 30, 'M'), 1780);
  assert.equal(mifflin(60, 165, 40, 'F'), 1270);
  assert.equal(harrisBenedict(80, 180, 30, 'M'), 1865); // 66,473 + 1100,13 + 900,59 − 202,65
  assert.equal(mifflin(80, 180, null, 'M'), null);
  assert.equal(totalEnergy(1780, 'moderada'), 2759);
  assert.equal(totalEnergy(1780, undefined), null);
});

const c = (id: string, dateKey: string, m: Partial<Consulta>): Consulta => ({ id, dateKey, ...m });

t('resumen del paciente', () => {
  const list = [
    c('b', '2026-09-20', { weight: 86, nextControl: '2026-10-20' }),
    c('a', '2026-08-20', { weight: 90, height: 170, first: true }),
    c('c', '2026-10-18', { waist: 95, nextControl: '2026-11-18' }),
  ];
  const s = summarize(list, '2026-10-22');
  assert.equal(s.visits, 3);
  assert.equal(s.firstDate, '2026-08-20');
  assert.equal(s.lastVisit, '2026-10-18');
  assert.equal(s.firstWeight, 90);
  assert.equal(s.lastWeight, 86);
  assert.equal(s.height, 170);
  assert.equal(s.bmi, 29.8);
  // Solo los controles que todavía no pasaron
  assert.equal(s.nextControl, '2026-11-18');
  assert.deepEqual(summarize([], '2026-10-22'), { visits: 0 });
});

t('evolución usa la última altura medida', () => {
  const pts = evolution([
    c('a', '2026-08-20', { weight: 90, height: 170 }),
    c('b', '2026-09-20', { weight: 86, skinfolds: { biceps: 10, triceps: 15, subscapular: 12, suprailiac: 14 } }),
  ], { sex: 'F', birthDate: '1996-01-01' });
  assert.equal(pts[1].bmi, 29.8);
  near(pts[1].fatPct ?? null, 28.5);
  assert.equal(pts[1].sumFolds, 51);
  assert.equal(pts[0].fatPct, undefined);
});

t('ventana de 24 h para corregir una consulta', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  assert.equal(editable(c('a', '2026-10-22', { createdAt: { seconds: now / 1000 - 3600 } }), now), true);
  assert.equal(editable(c('a', '2026-10-21', { createdAt: { seconds: now / 1000 - 25 * 3600 } }), now), false);
  assert.equal(editable(c('a', '2026-10-22', {}), now), true);
});

t('números escritos a mano y días', () => {
  assert.equal(parseNum('72,5'), 72.5);
  assert.equal(parseNum('72.5 kg'), 72.5);
  assert.equal(parseNum(''), undefined);
  assert.equal(parseNum('0'), undefined);
  assert.equal(daysBetween('2026-10-01', '2026-10-22'), 21);
});

console.log(`\n${n} pruebas OK`);

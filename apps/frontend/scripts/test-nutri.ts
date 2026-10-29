// Pruebas de los cálculos del consultorio de nutrición (services/nutriCore.ts).
// npm run test:nutri
import assert from 'node:assert/strict';
import {
  ageOn, bmi, bmiCategory, healthyWeightRange, waistHipRatio, waistRisk, bodyFatDW, fatPctOf, mifflin, harrisBenedict,
  totalEnergy, summarize, evolution, editable, parseNum, daysBetween, type Consulta,
  activePack, defaultCoverage, applyPackSession, controlsToRemind, whenLabel, reminderText, mergeIntake, hasObraSocial, newVideoLink, type Pack,
} from '../src/services/nutriCore';
import {
  household, itemLine, planTotals, mealTotals, macroSplit, proteinPerKg, scalePlan, planFromTemplate, suggestedKcal, planText, roundGrams, nice, itemFromFood, PLAN_TEMPLATES,
} from '../src/services/nutriPlan';
import { FOODS, searchFoods, foodById } from '../src/services/nutriFoods';

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

// ─── Plan alimentario ───

t('tabla de alimentos: ids únicos, macros que cierran con las calorías', () => {
  assert.equal(new Set(FOODS.map((f) => f.id)).size, FOODS.length);
  // El vino y la cerveza: sus calorías vienen sobre todo del alcohol (7 kcal/g), que no es un macro
  const ALCOHOL = new Set(['vino', 'cerveza']);
  for (const f of FOODS) {
    assert.ok(f.grams > 0 && /^\d/.test(f.measure), `${f.id}: medida sin número`);
    // Las kcal de la tabla y las de los macros (4/4/9) no se alejan más de un 15 % (ni 12 kcal en los livianos)
    const fromMacros = f.p * 4 + f.c * 4 + f.f * 9;
    if (ALCOHOL.has(f.id)) continue;
    assert.ok(Math.abs(fromMacros - f.k) <= Math.max(12, f.k * 0.15), `${f.id}: ${f.k} kcal vs ${Math.round(fromMacros)} por macros`);
  }
});

t('buscar alimentos sin tildes y por partes, primero los propios', () => {
  assert.equal(searchFoods('pollo pech')[0].id, 'pollo-pechuga');
  assert.equal(searchFoods('platano').length, 0);
  assert.ok(searchFoods('limon').length === 0 && searchFoods('lim', [{ id: 'own-1', name: 'Limonada casera', group: 'bebidas', k: 30, p: 0, c: 8, f: 0, measure: '1 vaso', grams: 200, custom: true }])[0].custom);
  assert.equal(searchFoods('azucar')[0].id, 'azucar');
});

t('medida casera: fracciones y redondeo a cuartos', () => {
  assert.equal(nice(1.5), '1½');
  assert.equal(nice(0.25), '¼');
  assert.equal(nice(2.1), '2');
  assert.equal(household({ grams: 300, measure: '1 taza', unitGrams: 200 }), '1½ taza');
  assert.equal(household({ grams: 60, measure: '3 cucharadas', unitGrams: 30 }), '6 cucharadas');
  assert.equal(household({ grams: 75, measure: '1/2 unidad', unitGrams: 75 }), '½ unidad');
  assert.equal(household({ grams: 5, measure: '1 plato', unitGrams: 200 }), null);
  assert.equal(itemLine({ id: 'x', name: 'Verduras a gusto', grams: 0 }), 'Verduras a gusto');
  assert.equal(itemLine(itemFromFood(foodById('leche-descremada')!, 200)), '1 taza · Leche descremada (200 g)');
});

t('totales del plan, reparto de macros y proteínas por kilo', () => {
  const meals = [{ id: 'm', name: 'Almuerzo', items: [itemFromFood(foodById('pollo-pechuga')!, 200), itemFromFood(foodById('arroz-blanco')!, 100), itemFromFood(foodById('aceite')!, 10)] }];
  const tt = planTotals({ meals });
  assert.equal(tt.kcal, 220 + 360 + 88);
  assert.equal(tt.p, 46 + 7);
  assert.deepEqual(mealTotals(meals[0]), tt);
  const split = macroSplit(tt)!;
  assert.equal(split.p + split.c + split.f, 100);
  assert.equal(proteinPerKg(tt, 70), 0.8);
  assert.equal(proteinPerKg(tt, undefined), null);
});

t('plantillas: se llevan a las calorías pedidas, sin tocar verduras ni infusiones', () => {
  for (const tpl of PLAN_TEMPLATES) {
    for (const kcal of [1400, 1800, 2600]) {
      const plan = planFromTemplate(tpl.id, kcal);
      const got = planTotals(plan).kcal;
      assert.ok(Math.abs(got - kcal) <= kcal * 0.05, `${tpl.id} a ${kcal}: dio ${got}`);
      const veg = plan.meals.flatMap((m) => m.items).filter((i) => i.foodId === 'verduras-mix' || i.foodId === 'infusion');
      const original = planFromTemplate(tpl.id).meals.flatMap((m) => m.items).filter((i) => i.foodId === 'verduras-mix' || i.foodId === 'infusion');
      assert.deepEqual(veg.map((i) => i.grams), original.map((i) => i.grams));
      // Cantidades redondeadas (de a 5 g, o de a 10 g desde 100 g)
      for (const i of plan.meals.flatMap((m) => m.items)) assert.equal(i.grams, roundGrams(i.grams));
    }
    // Las comidas quedan en orden de horario
    const times = planFromTemplate(tpl.id).meals.map((m) => m.time || '');
    assert.deepEqual(times, [...times].sort());
  }
  assert.equal(roundGrams(137), 140);
  assert.equal(roundGrams(2), 5);
  assert.equal(scalePlan({ meals: [] }, 2000).meals.length, 0);
});

t('calorías sugeridas según el gasto y la plantilla', () => {
  assert.equal(suggestedKcal('descenso', 2300), 1800);
  assert.equal(suggestedKcal('masa-muscular', 2300), 2600);
  assert.equal(suggestedKcal('descenso', 1500), 1200);
  assert.equal(suggestedKcal('descenso', null), undefined);
});

t('el plan como mensaje de WhatsApp', () => {
  const txt = planText(planFromTemplate('descenso', 1600), { patient: 'Ana Pérez', from: 'Lic. Gómez' });
  assert.ok(txt.startsWith('Hola Ana, te paso tu plan alimentario.'));
  assert.ok(txt.includes('*Desayuno* (08:00)'));
  assert.ok(txt.includes('*Recomendaciones*'));
  assert.ok(txt.trim().endsWith('Lic. Gómez'));
});

// ─── Packs, obra social, recordatorios y ficha previa ───

const pack = (id: string, sessions: number, used: number, paidAt: number): Pack => ({ id, name: `Pack ${id}`, sessions, used, price: 40000, method: 'Efectivo', dateKey: '2026-10-01', paidAt });

t('packs: se usa el más viejo con sesiones libres y no se pasa del total', () => {
  const packs = [pack('nuevo', 4, 0, 200), pack('viejo', 4, 4, 100), pack('medio', 4, 1, 150)];
  assert.equal(activePack({ packs })?.id, 'medio');
  assert.equal(activePack({ packs: [pack('lleno', 2, 2, 1)] }), null);
  assert.equal(applyPackSession(packs, 'medio', 1).find((k) => k.id === 'medio')!.used, 2);
  assert.equal(applyPackSession(packs, 'viejo', 1).find((k) => k.id === 'viejo')!.used, 4);
  assert.equal(applyPackSession(packs, 'nuevo', -1).find((k) => k.id === 'nuevo')!.used, 0);
});

t('cobertura propuesta: pack, si no obra social, si no particular', () => {
  assert.deepEqual(defaultCoverage({ packs: [pack('a', 4, 1, 1)], obraSocial: 'OSDE' }), { type: 'pack', packId: 'a', packName: 'Pack a' });
  assert.deepEqual(defaultCoverage({ obraSocial: ' OSDE ', obraSocialNumber: '123', obraSocialPlan: '' }), { type: 'obra_social', name: 'OSDE', number: '123' });
  assert.deepEqual(defaultCoverage({ obraSocial: 'Particular' }), { type: 'particular' });
  assert.equal(hasObraSocial({ obraSocial: 'ninguna' }), false);
  assert.equal(hasObraSocial({ obraSocial: 'PAMI' }), true);
});

t('controles para recordar y el mensaje', () => {
  const list = [
    { name: 'Ana', nextControl: '2026-10-24' },
    { name: 'Beto', nextControl: '2026-10-23', remindedFor: '2026-10-23' },
    { name: 'Caro', nextControl: '2026-10-30' },
    { name: 'Dani', nextControl: '2026-10-22' },
    { name: 'Eva', nextControl: '2026-10-21' },
    { name: 'Fede', nextControl: '2026-10-23', archived: true },
  ];
  assert.deepEqual(controlsToRemind(list, '2026-10-22').map((p) => p.name), ['Dani', 'Ana']);
  assert.equal(whenLabel('2026-10-22', '2026-10-22'), 'hoy');
  assert.equal(whenLabel('2026-10-23', '2026-10-22'), 'mañana');
  assert.equal(whenLabel('2026-10-29', '2026-10-22'), 'el jueves 29/10');
  const msg = reminderText({ name: 'Ana María Pérez', nextControl: '2026-10-23' }, '2026-10-22', { bookingUrl: 'https://ventra.store/lic-gomez/turnos', from: 'Lic. Gómez' });
  assert.ok(msg.startsWith('Hola Ana! Te recuerdo que mañana'));
  assert.ok(msg.includes('https://ventra.store/lic-gomez/turnos'));
  assert.ok(reminderText({ name: 'Ana', nextControl: '2026-10-23' }, '2026-10-22').includes('Avisame qué día'));
});

t('ficha previa a la historia clínica: completa lo vacío y agrega abajo lo distinto', () => {
  const h = mergeIntake({ allergies: 'Maní', medication: '' }, { allergies: 'Mariscos', medication: 'Levotiroxina', reason: '  Bajar de peso ', likes: '' });
  assert.equal(h.medication, 'Levotiroxina');
  assert.equal(h.reason, 'Bajar de peso');
  assert.equal(h.allergies, 'Maní\n(Ficha previa) Mariscos');
  assert.equal(h.likes, undefined);
  assert.equal(mergeIntake({ allergies: 'Maní' }, { allergies: 'Maní' }).allergies, 'Maní');
});

t('sala de videollamada', () => {
  assert.match(newVideoLink(), /^https:\/\/meet\.jit\.si\/ventra-consulta-[a-z0-9]{6,}$/);
  assert.notEqual(newVideoLink(), newVideoLink());
});

console.log(`\n${n} pruebas OK`);

const crypto = require('crypto');

const SECRET_WORD = 'paulos-pos-license-key-lock-2026';

function getYearWeek(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const weekNum = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${target.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getYearMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function generateCode(machineUuid, type, period) {
  const input = `${machineUuid.trim().toUpperCase()}-${type}-${period}-${SECRET_WORD}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex').toUpperCase();
  const part1 = hash.substring(0, 4);
  const part2 = hash.substring(4, 8);
  const part3 = hash.substring(8, 12);
  return `${part1}-${part2}-${part3}`;
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log(`
======================================================
  GoDelivery POS - Generador de Licencias
======================================================
Uso:
  node keygen.js <ID_DE_COMPUTADORA> <1w | 1m | demo> [offset]

Parámetros:
  ID_DE_COMPUTADORA : El ID / UUID de la máquina (ej. 4C4C4544-...)
  1w | 1m | demo    : Tipo de licencia: "1w" para 1 semana, "1m" para 1 mes, "demo" para Demo (7 días)
  offset (opcional) : Desplazamiento en el tiempo (ej. 1 para la siguiente semana/mes, por defecto 0)

Ejemplos:
  Generar código de 1 semana para hoy:
    node keygen.js FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF 1w

  Generar código de 1 mes para hoy:
    node keygen.js FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF 1m

  Generar código de Demo para hoy:
    node keygen.js FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF demo
`);
  process.exit(0);
}

const uuid = args[0].trim().toUpperCase();
const typeArg = args[1].toLowerCase();
const offset = parseInt(args[2] || '0', 10);

const date = new Date();
if (typeArg === '1w' || typeArg === 'w') {
  date.setDate(date.getDate() + offset * 7);
  const period = getYearWeek(date);
  const code = generateCode(uuid, '1W', period);
  console.log(`\n🔑 CÓDIGO DE ACTIVACIÓN (1 SEMANA - Periodo: ${period}):`);
  console.log(`👉 ${code}\n`);
} else if (typeArg === 'demo') {
  date.setDate(date.getDate() + offset * 7);
  const period = getYearWeek(date);
  const code = generateCode(uuid, 'DEMO', period);
  console.log(`\n🔑 CÓDIGO DE ACTIVACIÓN (DEMO 7 DÍAS - Periodo: ${period}):`);
  console.log(`👉 ${code}\n`);
} else if (typeArg === '1m' || typeArg === 'm') {
  date.setMonth(date.getMonth() + offset);
  const period = getYearMonth(date);
  const code = generateCode(uuid, '1M', period);
  console.log(`\n🔑 CÓDIGO DE ACTIVACIÓN (1 MES - Periodo: ${period}):`);
  console.log(`👉 ${code}\n`);
} else {
  console.error('Tipo inválido. Usa "1w", "1m" o "demo".');
}

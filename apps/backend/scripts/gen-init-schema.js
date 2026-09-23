// Genera dist/ncc/init-schema.sql: el esquema COMPLETO de la base en SQL.
// La app instalada no trae la CLI de prisma, así que en una instalación nueva
// (base vacía) el backend crea todas las tablas ejecutando este archivo.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'ncc', 'init-schema.sql');
const sql = execSync('npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script', {
  cwd: root,
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db' },
  encoding: 'utf8',
});
if (!/CREATE TABLE "users"/.test(sql)) throw new Error('El esquema generado no tiene la tabla users');
fs.writeFileSync(out, sql);
console.log(`[Build] init-schema.sql generado (${(sql.length / 1024).toFixed(0)} KB)`);

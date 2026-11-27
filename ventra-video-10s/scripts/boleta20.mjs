// Arma los datos de la boleta larga (20 renglones) del video de boletas: el mismo archivo lo usan el
// papel que se ve en el video (src/boletas/boleta20.json) y la respuesta simulada de la IA en la grabación.
// Productos del catálogo de prueba de la caja (apps/frontend/src/dev/reelCatalog.json); 2 son nuevos.
//   node scripts/boleta20.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CAT = JSON.parse(fs.readFileSync(path.join(RAIZ, '..', 'apps', 'frontend', 'src', 'dev', 'reelCatalog.json'), 'utf8'));
const venta = (re) => { const p = CAT.find((x) => re.test(x.name)); if (!p) throw new Error(`No está en el catálogo: ${re}`); return p; };

// [cantidad, expresión del catálogo (o nombre si es nuevo), cambio de costo en % (null = igual), venta si es nuevo]
const LISTA = [
  [12, /BON O BON/, 12], [24, /MOGUL/, null], [36, /TODDY/, 11], [48, /SPRING POP/, null], [20, /TERRABUSI/, null],
  [12, /DOÑA MAGDALENA/, null], [12, /VACALIN/, null], [24, /MAGGI/, null], [10, /FINLANDIA/, null], [48, /AMSTEL/, 9],
  [6, /CAMPARI/, null], [24, /ALA JABON/, null], [20, /LADY SOFT/, null], [24, /FELPITA/, null], [20, /BANDERITA/, null],
  [12, /RAID/, null], [12, /COLGATE/, null], [16, /S\.LIBRE/, null],
  [20, 'MILKA AVELLANA ENTERA X 100', null, 8900], [30, 'TAKIS EXPLOSION X 85 GR', null, 3200],
];
const r10 = (n) => Math.round(n / 10) * 10;
const r100 = (n) => Math.round(n / 100) * 100;
const renglones = LISTA.map(([cant, q, cambio, ventaNueva]) => {
  const p = typeof q === 'string' ? null : venta(q);
  const ventaActual = p ? p.salePrice : ventaNueva;
  // el costo que ya tiene la app de prueba (ReelPreview: 70 % de la venta); los nuevos, 65 %
  const costoViejo = p ? Math.round(ventaActual * 0.7) : r10(ventaActual * 0.65);
  const costo = cambio ? r10(costoViejo * (1 + cambio / 100)) : costoViejo;
  return {
    cant, desc: p ? p.name : q, productId: p ? p.id : null, unit: costo, imp: costo * cant,
    // el precio de venta sube lo mismo que el costo: el margen queda igual (redondeado a $ 100)
    venta: ventaActual, ventaNueva: cambio ? r100(costo * (ventaActual / costoViejo)) : ventaActual, cambio,
  };
});
const total = renglones.reduce((s, r) => s + r.imp, 0);
const datos = { proveedor: 'Distribuidora Norte', factura: '0003-00018427', fecha: '14/11/2026', cliente: 'KIOSCO LOS PRIMOS', total, renglones };
fs.mkdirSync(path.join(RAIZ, 'src', 'boletas'), { recursive: true });
fs.writeFileSync(path.join(RAIZ, 'src', 'boletas', 'boleta20.json'), JSON.stringify(datos, null, 1));
console.log(`ok src/boletas/boleta20.json · ${renglones.length} renglones · total $ ${total.toLocaleString('es-AR')}`);
for (const r of renglones) console.log(String(r.cant).padStart(3), r.desc.padEnd(42), String(r.unit).padStart(7), String(r.imp).padStart(8), r.cambio ? `costo +${r.cambio}% venta ${r.venta}→${r.ventaNueva}` : '');

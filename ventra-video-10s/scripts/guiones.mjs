// Arma los guiones de grabación (JSON para scripts/grabar-app.mjs) de cada clip de la app real.
//   node scripts/guiones.mjs  →  scripts/grabar-<clip>.json
// Después: node scripts/grabar-app.mjs scripts/grabar-<clip>.json public/app
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOCK = fs.readFileSync(path.join(AQUI, 'mock-app.js'), 'utf8');
const BOLETA = path.join(AQUI, '..', 'grabaciones', 'boleta.png');
// Video de boletas (20 s): la boleta larga y sus datos, que la lectura simulada devuelve tal cual
const BOLETA20 = path.join(AQUI, '..', 'grabaciones', 'boleta20.png');
const DATOS20 = fs.readFileSync(path.join(AQUI, '..', 'src', 'boletas', 'boleta20.json'), 'utf8');
const MOCK20 = `window.__boleta20 = ${DATOS20};
${MOCK}`;

const base = {
  base: 'http://localhost:5181/reel-preview.html',
  ancho: 390, alto: 844, escala: 2, movil: true,
  // La app muestra la hora de esta zona: hoy a las 6 de la mañana acá son las 19 h allá (más creíble para un kiosco)
  zona: 'Australia/Brisbane',
  storage: {
    getting_started_hidden: '1', onboarding_done: '1', gd_store_name: 'Kiosco Los Primos', business_profile: 'KIOSKO',
    business_features: JSON.stringify({ bulk: false, delivery: false, preorders: false }), business_intents: JSON.stringify(['mostrador']),
    // "Cargarla sola si está todo bien" activado, como lo tiene un comercio que usa la carga automática
    purchase_auto: JSON.stringify({ enabled: true, keepMargin: true, round: 100 }),
  },
};
// Cierra el cartel de "productos nuevos para revisar" si quedó a la vista
const sinAvisos = `document.querySelectorAll('[aria-label="Cerrar"], button').forEach((b) => { const t = b.closest('div')?.innerText || ''; if (/productos nuevos para revisar/.test(t) && /^(×|✕|)$/.test(b.innerText.trim())) b.click(); }); true`;

const guiones = {
  boleta: [
    { ir: '#/purchases', carga: 4500 },
    { js: MOCK, espera: 600 },
    { ir: '#/inicio', carga: 1500 },
    { ir: '#/purchases', carga: 2000 },
    { js: sinAvisos, espera: 300 },
    { grabar: true },
    { espera: 500 },
    { toque: 'Escanear boleta', espera: 1000 },
    { marca: 'hoja' },
    { archivo: BOLETA, sel: 'input[type=file]', espera: 1400 },
    { foto: 'control-boleta-1' },
    { marca: 'leer' },
    { toque: 'Leer la boleta', espera: 300 },
    { hasta: "document.body.innerText.includes('Boleta leída')", max: 15000 },
    { marca: 'leida' },
    { espera: 2000 },
    { foto: 'control-boleta-2' },
    { ir: '#/products', carga: 1800 },
    { foto: 'control-boleta-3' },
    { marca: 'revisar' },
    { toque: 'Revisar', espera: 1800 },
    { marca: 'fotos' },
    { espera: 1200 },
    { foto: 'control-boleta-4' },
  ],
  sininternet: [
    { ir: '#/pos', carga: 4500 },
    { js: MOCK, espera: 600 },
    { ir: '#/inicio', carga: 1500 },
    { ir: '#/pos', carga: 2500 },
    { js: sinAvisos, espera: 300 },
    { grabar: true },
    { espera: 500 },
    { marca: 'corte' },
    { js: `(async () => { (await import('/src/services/offlineStart.ts')).markOfflineStart(new Date(Date.now() - 18 * 60e3).toISOString()); return true; })()`, espera: 900 },
    { foto: 'control-off-1' },
    { marca: 'producto1' },
    { toque: 'BON O BON', espera: 450 },
    { marca: 'producto2' },
    { toque: 'FINLANDIA', espera: 450 },
    { marca: 'producto3' },
    { toque: 'BON O BON', espera: 700 },
    { foto: 'control-off-2' },
    { marca: 'cobrar' },
    { toque: 'Cobrar', espera: 900 },
    { toque: 'Cobrar $', espera: 1200 },
    { foto: 'control-off-3' },
    { marca: 'confirmar' },
    { toque: 'Confirmar $', espera: 1300 },
    { foto: 'control-off-4' },
    { marca: 'vuelve' },
    { js: `(async () => { (await import('/src/services/offlineStart.ts')).markUpToDate(); return true; })()`, espera: 1600 },
    { foto: 'control-off-5' },
  ],
  pedido: [
    { ir: '#/pedidos', carga: 4500 },
    { js: MOCK, espera: 400 },
    { js: `window.__reelStore.setConfig({ businessName: 'Kiosco Los Primos', rubro: 'KIOSCO', subdomain: 'kioscolosprimos', isPublished: true }); true` },
    { ir: '#/inicio', carga: 1200 },
    { ir: '#/pedidos', carga: 2200 },
    { js: sinAvisos, espera: 300 },
    { grabar: true },
    { espera: 700 },
    { marca: 'entra' },
    { js: `(() => { const ahora = new Date(); const ts = { toDate: () => ahora, toMillis: () => +ahora, seconds: Math.floor(+ahora / 1000) };
      window.__reelStore.pushOrder({ id: 'pedido-1', orderCode: 'D8RS', status: 'PENDING', stage: 'NEW', createdAt: ts,
        customerName: 'Lucas Ferreyra', customerPhone: '2214567890', delivery: 'PICKUP', paymentMethod: 'Efectivo', deliveryCost: 0,
        items: [ { productId: 'demo20', name: 'AMSTEL LATA X 473', price: 1900, qty: 4 }, { productId: 'demo1', name: 'BON O BON BLANCO X 18 UN', price: 10500, qty: 1 } ],
        total: 18100 }); return true; })()`, espera: 1500 },
    { foto: 'control-pedido-1' },
    { marca: 'abrir' },
    { toque: 'Lucas', espera: 1500 },
    { foto: 'control-pedido-2' },
  ],
};

// La tienda online, del lado del cliente (scripts/tienda-local.cjs): la tienda real de firebase/tienda
guiones.tienda = [
  { ir: '', carga: 3500 },
  { log: "[...document.querySelectorAll('[data-act=add]')].slice(0,40).map((b) => b.dataset.id).join(',')" },
  { grabar: true },
  { espera: 400 },
  { js: "document.querySelector('[data-act=add][data-id=\"demo20\"]').scrollIntoView({ behavior: 'smooth', block: 'center' }); true", espera: 900 },
  { marca: 'agrega2' },
  { toque: { sel: '[data-act=add][data-id="demo20"]' }, espera: 400 },
  { toque: { sel: '[data-act=inc][data-id="demo20"]' }, espera: 300 },
  { toque: { sel: '[data-act=inc][data-id="demo20"]' }, espera: 300 },
  { toque: { sel: '[data-act=inc][data-id="demo20"]' }, espera: 500 },
  { marca: 'agrega3' },
  { toque: { sel: '[data-act=add][data-id="demo1"]' }, espera: 700 },
  { foto: 'control-tienda-1' },
  { marca: 'carrito' },
  { toque: { sel: '[data-act=open-cart]' }, espera: 1200 },
  { toque: 'Continuar', espera: 1200 },
  { foto: 'control-tienda-2' },
  { js: "document.querySelector('[data-act=send]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); true", espera: 900 },
  { marca: 'enviar' },
  { toque: { sel: '[data-act=send]' }, espera: 1800 },
  { foto: 'control-tienda-3' },
  { log: "(window.__pedidoEnviado || {}).orderCode" },
];
// La caja de la PC (1280×800): cobro sin internet y la boleta del celular que llega a la computadora
const PC = { ancho: 1280, alto: 800, escala: 1.5, movil: false };
const entrarPC = [
  { ir: '#/pos', carga: 5000 },
  { js: MOCK, espera: 600 },
  { ir: '#/products', carga: 1500 },
  { ir: '#/pos', carga: 2500 },
  { js: sinAvisos, espera: 300 },
];
guiones['pc-cobro'] = [
  ...entrarPC,
  { grabar: true },
  { espera: 500 },
  { marca: 'corte' },
  { js: `(async () => { (await import('/src/services/offlineStart.ts')).markOfflineStart(new Date(Date.now() - 18 * 60e3).toISOString()); return true; })()`, espera: 900 },
  { marca: 'escanea1' },
  { teclas: '7790580119065\n', espera: 450 },
  { marca: 'escanea2' },
  { teclas: '7790742167101\n', espera: 450 },
  { marca: 'escanea3' },
  { teclas: '7793147573548\n', espera: 450 },
  { marca: 'escanea4' },
  { teclas: '7500810034460\n', espera: 700 },
  { foto: 'control-pc-cobro-1' },
  { marca: 'cobrar' },
  { toque: 'Confirmar venta', espera: 1200 },
  { foto: 'control-pc-cobro-2' },
  { marca: 'efectivo' },
  { teclas: '1', espera: 600 },
  { marca: 'recibido' },
  { teclas: '25000', ms: 70, espera: 700 },
  { foto: 'control-pc-cobro-2b' },
  { marca: 'confirmar' },
  { teclas: '\n', espera: 1500 },
  { foto: 'control-pc-cobro-3' },
  { marca: 'vuelve' },
  { js: `(async () => { (await import('/src/services/offlineStart.ts')).markUpToDate(); return true; })()`, espera: 1600 },
  { foto: 'control-pc-cobro-4' },
];
guiones['pc-boleta'] = [
  ...entrarPC,
  { grabar: true },
  { espera: 600 },
  { marca: 'llega' },
  { js: `(async () => { window.__boletaLeida = true; return true; })()`, espera: 200 },
  { hasta: "document.body.innerText.includes('para revisar')", max: 40000, cada: 200 },
  { marca: 'aviso' },
  { espera: 1400 },
  { foto: 'control-pc-boleta-1' },
  { marca: 'revisar' },
  { toque: 'Revisar', espera: 1800 },
  { foto: 'control-pc-boleta-2' },
];
// El mismo pedido llegando a la PC del kiosco (Pedidos)
guiones['pc-pedido'] = guiones.pedido;
// ── Video de boletas (20 s), de mañana ──────────────────────────────────────────────
guiones['b20-celu'] = [
  { ir: '#/purchases', carga: 4500 },
  { js: MOCK20, espera: 600 },
  { ir: '#/inicio', carga: 1500 },
  { ir: '#/purchases', carga: 2000 },
  { js: sinAvisos, espera: 300 },
  { grabar: true },
  { espera: 500 },
  { toque: 'Escanear boleta', espera: 1000 },
  { marca: 'hoja' },
  { archivo: BOLETA20, sel: 'input[type=file]', espera: 1400 },
  { foto: 'control-b20-1' },
  { marca: 'leer' },
  { toque: 'Leer la boleta', espera: 1200 },
  { foto: 'control-b20-2' },
  { hasta: "document.body.innerText.includes('Boleta leída')", max: 15000 },
  { marca: 'leida' },
  { espera: 1600 },
  { foto: 'control-b20-3' },
  { marca: 'baja' },
  { deslizar: 420, ms: 1100, espera: 1200 },
  { foto: 'control-b20-4' },
];
guiones['b20-pc'] = [
  { ir: '#/products', carga: 5000 },
  { js: MOCK20, espera: 600 },
  { ir: '#/pos', carga: 1500 },
  { ir: '#/products', carga: 2500 },
  { js: sinAvisos, espera: 300 },
  { foto: 'control-b20pc-1' },
  { medir: ['BON O BON BLANCO X 18 UN', 'TODDY GALLETITAS', 'AMSTEL LATA'], nombre: 'antes' },
  { grabar: true },
  { espera: 800 },
  { marca: 'antes' },
  { js: `(async () => { window.__boletaLeida = true; return true; })()`, espera: 300 },
  { ir: '#/pos', carga: 900 },
  { ir: '#/products', carga: 1800 },
  { marca: 'despues' },
  { medir: ['BON O BON BLANCO X 18 UN', 'TODDY GALLETITAS', 'AMSTEL LATA', 'MILKA', 'TAKIS'], nombre: 'despues' },
  { foto: 'control-b20pc-2' },
  { hasta: "document.body.innerText.includes('para revisar')", max: 40000, cada: 200 },
  { marca: 'aviso' },
  { espera: 1400 },
  { foto: 'control-b20pc-3' },
  { marca: 'revisar' },
  { toque: 'Revisar', espera: 1800 },
  { foto: 'control-b20pc-4' },
];
const MANANA = { zona: 'Atlantic/South_Georgia' };
const propio = {
  'b20-celu': MANANA,
  'b20-pc': { ...PC, ...MANANA },
  'pc-pedido': PC,
  'pc-cobro': PC,
  'pc-boleta': PC,
  tienda: { base: 'http://localhost:5307/', storage: { ventra_customer: JSON.stringify({ name: 'Lucas Ferreyra', phone: '2214567890', address: 'Calle 12 N° 845' }) } },
};

for (const [nombre, pasos] of Object.entries(guiones)) {
  const destino = path.join(AQUI, `grabar-${nombre}.json`);
  fs.writeFileSync(destino, JSON.stringify({ ...base, ...(propio[nombre] || {}), tomas: [{ nombre, pasos }] }, null, 1));
  console.log('ok', destino);
}

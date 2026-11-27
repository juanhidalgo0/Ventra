// Vista local de la tienda online REAL (firebase/tienda/index.html, sin modificarla) para grabar el video:
// reemplaza Firebase por datos de prueba de "Kiosco Los Primos" con el mismo catálogo de la caja
// (apps/frontend/src/dev/reelCatalog.json). Basado en tools/preview/tienda-pizza.js.
//   node scripts/tienda-local.cjs   →  http://localhost:5307
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../firebase/tienda');
const CATALOGO = require(path.resolve(__dirname, '../../apps/frontend/src/dev/reelCatalog.json'));

const cat = (n) =>
  /AMSTEL|CAMPARI|COCA|MANAOS|SCHNEIDER|ISENBECK/.test(n) ? 'BEBIDAS'
  : /BON O BON|FERRERO|MILKA|MOGUL|SPRING|FANTOCHE|TERRABUSI|TODDY/.test(n) ? 'GOLOSINAS'
  : /ALA|LADY|FELPITA|AIR PUR|BANDERITA|RAID|COLGATE|S.LIBRE/.test(n) ? 'LIMPIEZA'
  : /TAKIS|LAYS|PIPAS/.test(n) ? 'SNACKS'
  : /CAT CHOW|WHISKAS/.test(n) ? 'MASCOTAS' : 'ALMACEN';
const PRIMERO = { demo27: 1, demo20: 2, demo25: 3, demo1: 4, demo16: 5, demo8: 6 };
// Primero los que pide el cliente del video, así sus categorías quedan arriba
const items = [...CATALOGO].sort((a, b) => (PRIMERO[a.id] || 99) - (PRIMERO[b.id] || 99)).filter((p) => !/TABACO|PHILIP/.test(p.name)).map((p) => ({
  productId: p.id, name: p.name, price: p.salePrice, category: cat(p.name), inStock: true, unit: 'UNIT',
  imageUrl: p.imageUrl, ...(PRIMERO[p.id] ? { rank: PRIMERO[p.id] } : {}),
}));
const cfg = {
  claimed: true, isPublished: true, subdomain: 'kioscolosprimos', businessName: 'Kiosco Los Primos', storeName: 'Kiosco Los Primos', name: 'Kiosco Los Primos', rubro: 'KIOSCO',
  brandColor: '#167160', pickupEnabled: true, deliveryEnabled: true, deliveryCost: 0, orderChannel: 'APP',
  paymentMethods: ['Efectivo', 'Transferencia', 'Mercado Pago'], address: 'Calle 7 N° 1320',
  hours: [0, 1, 2, 3, 4, 5, 6].map(() => ({ open: true, from: '00:00', to: '23:59', ranges: [{ from: '00:00', to: '23:59' }] })), catalogParts: 1,
};

const stub = `<script>
(function(){
  var cfg=${JSON.stringify(cfg)};
  var items=${JSON.stringify(items)};
  function snap(data){ return {exists:!!data,data:function(){ return data; },ref:ref('ventra_stores/s1'),id:'s1'}; }
  function ref(p){ return {
    collection:function(c){ return col(p+'/'+c); },
    get:function(){ var d=null; if(p==='ventra_store_slugs/kioscolosprimos') d={storeId:'s1'}; else if(p==='ventra_stores/s1') d=cfg; else if(p==='ventra_stores/s1/catalog/p0') d={items:items}; return Promise.resolve(snap(d)); },
    set:function(){ return Promise.resolve(); }, update:function(){ return Promise.resolve(); },
    onSnapshot:function(){ return function(){}; }
  }; }
  function col(p){ var q={ doc:function(id){ return ref(p+'/'+(id||'nuevo')); }, where:function(){ return q; }, limit:function(){ return q; }, orderBy:function(){ return q; },
    get:function(){ return Promise.resolve({size:0,empty:true,docs:[]}); }, add:function(o){ window.__pedidoEnviado=o; return Promise.resolve(ref(p+'/x')); }, onSnapshot:function(){ return function(){}; } }; return q; }
  var fs={ collection:function(c){ return col(c); }, doc:function(p){ return ref(p); } };
  var fn=function(){ return fs; }; fn.FieldValue={serverTimestamp:function(){ return new Date(); },increment:function(n){ return n; }}; fn.Timestamp={now:function(){ return {toMillis:function(){ return Date.now(); }}; }};
  window.firebase={ initializeApp:function(){ return {}; }, firestore:fn, app:function(){ return {}; } };
  window.__PREVIEW_SLUG='kioscolosprimos';
})();
</script>`;

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url);
  if (url !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+firebase-app-compat\.js"><\/script>/, stub)
             .replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"><\/script>/g, '');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(5307, () => console.log('tienda de Kiosco Los Primos en http://localhost:5307'));

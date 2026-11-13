// Vista previa de la tienda (gastronomía) sin nube: reemplaza Firebase por datos de prueba.
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/PC/Desktop/Kiosco/firebase/tienda';

const stub = `<script>
(function(){
  var cfg={claimed:true,isPublished:true,subdomain:'pizza-prueba',storeName:'Pizzería de prueba',name:'Pizzería de prueba',rubro:'GASTRONOMIA',
    brandColor:'#C2410C',pickupEnabled:true,deliveryEnabled:true,deliveryCost:1500,paymentMethods:['Efectivo','Transferencia'],
    hours:[0,1,2,3,4,5,6].map(function(){ return {open:true,from:'00:00',to:'23:59',ranges:[{from:'00:00',to:'23:59'}]}; }),catalogParts:1,
    extraGroups:[{id:'b',name:'Borde',min:0,max:1,options:[{id:'br',name:'Borde relleno',price:2500}],categories:['PIZZAS'],productIds:[],active:true}]};
  var P=function(id,name,price,cat,rank,desc){ var x={productId:id,name:name,price:price,category:cat,inStock:true,unit:'UNIT',description:desc||''}; if(rank) x.rank=rank; return x; };
  var items=[
    P('p1','MUZZARELLA',12000,'PIZZAS',2,'Salsa, muzzarella y aceitunas'),
    P('p2','NAPOLITANA',14500,'PIZZAS',4,'Muzzarella, tomate y ajo'),
    P('p3','FUGAZZETA',13500,'PIZZAS',6,'Cebolla y muzzarella'),
    P('p4','CALABRESA',15000,'PIZZAS',0,'Muzzarella, longaniza, morrón'),
    P('p5','ESPECIAL',15500,'PIZZAS',8,'Jamón, morrón y huevo'),
    P('e1','EMPANADA DE CARNE',1500,'EMPANADAS',1,'Cortada a cuchillo'),
    P('e2','EMPANADA JYQ',1500,'EMPANADAS',0,''),
    P('b1','COCA COLA 1,5 L',3500,'BEBIDAS',3,''),
    P('b2','CERVEZA QUILMES 1 L',4000,'BEBIDAS',5,''),
    P('b3','AGUA 500 ML',1500,'BEBIDAS',0,''),
    P('b4','SPRITE 1,5 L',3300,'BEBIDAS',9,''),
    P('d1','FLAN CASERO',3000,'POSTRES',7,'Con dulce de leche'),
    P('d2','HELADO 1/4 KG',4500,'POSTRES',0,'')
  ];
  function snap(data){ return {exists:!!data,data:function(){ return data; },ref:ref('ventra_stores/s1'),id:'s1'}; }
  function ref(p){ return {
    collection:function(c){ return col(p+'/'+c); },
    get:function(){ var d=null; if(p==='ventra_store_slugs/pizza-prueba') d={storeId:'s1'}; else if(p==='ventra_stores/s1') d=cfg; else if(p==='ventra_stores/s1/catalog/p0') d={items:items}; return Promise.resolve(snap(d)); },
    set:function(){ return Promise.resolve(); }, update:function(){ return Promise.resolve(); },
    onSnapshot:function(){ return function(){}; }
  }; }
  function col(p){ var q={ doc:function(id){ return ref(p+'/'+(id||'nuevo')); }, where:function(){ return q; }, limit:function(){ return q; }, orderBy:function(){ return q; },
    get:function(){ return Promise.resolve({size:0,empty:true,docs:[]}); }, add:function(){ return Promise.resolve(ref(p+'/x')); }, onSnapshot:function(){ return function(){}; } }; return q; }
  var fs={ collection:function(c){ return col(c); }, doc:function(p){ return ref(p); } };
  var fn=function(){ return fs; }; fn.FieldValue={serverTimestamp:function(){ return new Date(); },increment:function(n){ return n; }}; fn.Timestamp={now:function(){ return {toMillis:function(){ return Date.now(); }}; }};
  window.firebase={ initializeApp:function(){ return {}; }, firestore:fn, app:function(){ return {}; } };
  window.__PREVIEW_SLUG='pizza-prueba';
})();
</script>`;

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url);
  if (url !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+firebase-app-compat\.js"><\/script>/, stub)
             .replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"><\/script>/g, '');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(5241, () => console.log('pizza-preview en http://localhost:5241'));

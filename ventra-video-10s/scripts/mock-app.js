// Se ejecuta DENTRO de la vista de prueba de la app (reel-preview.html, servidor reel-tienda) durante la
// grabación. No modifica la app: envuelve las respuestas simuladas que ya tiene (api.defaults.adapter)
// para sumar lo que este video necesita: la lectura de la boleta, sin avisos de la vista de prueba, y los
// dos productos que crea la boleta (Milka y Takis) que recién aparecen después de escanearla.
// Si antes se define window.__boleta20 (datos de src/boletas/boleta20.json), la lectura devuelve esa boleta
// larga y, una vez leída, el stock de cada producto aparece sumado.
(async () => {
  if (window.__mock10s) return true;
  window.__mock10s = true;
  const api = (await import('/src/services/api.ts')).default;
  const previo = api.defaults.adapter;
  const NUEVOS = /MILKA|TAKIS/;
  window.__boletaLeida = false;
  const ok = (config, data) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
  const RESULTADO = {
    status: 'OK', auto: true, supplierName: 'Distribuidora Norte', matchedSupplier: { name: 'Distribuidora Norte' },
    invoiceNumber: '0003-00018427', updatedPrices: 2, newProducts: 2,
    items: [
      { quantity: 12, name: 'BON O BON BLANCO X 18 UN', total: 81900, product: { name: 'BON O BON BLANCO X 18 UN', salePrice: 10500 }, suggestedSalePrice: 11400, changePct: 12 },
      { quantity: 24, name: 'MOGUL MORAS X 150 GR', total: 36720, product: { name: 'MOGUL MORAS X 150 GR', salePrice: 2350 }, suggestedSalePrice: 2350, changePct: 0 },
      { quantity: 20, name: 'MILKA AVELLANA ENTERA X 100', total: 115800, product: null },
      { quantity: 30, name: 'TAKIS EXPLOSION X 85 GR', total: 62400, product: null },
      { quantity: 36, name: 'TODDY GALLETITAS X 126 GR', total: 20880, product: { name: 'TODDY GALLETITAS X 126 GR', salePrice: 890 }, suggestedSalePrice: 990, changePct: 11 },
    ],
  };
  const B20 = window.__boleta20;
  if (B20) {
    RESULTADO.items = B20.renglones.map((r) => ({
      quantity: r.cant, name: r.desc, total: r.imp,
      product: r.productId ? { name: r.desc, salePrice: r.venta } : null,
      suggestedSalePrice: r.productId ? r.ventaNueva : undefined, changePct: r.cambio ?? 0,
    }));
    RESULTADO.updatedPrices = B20.renglones.filter((r) => r.cambio).length;
  }
  // Después de leer la boleta larga, el stock de cada producto aparece sumado (lo que cargó la compra)
  const sumar = (p) => {
    const r = B20 && window.__boletaLeida && B20.renglones.find((x) => x.productId === p.id);
    return r ? { ...p, stock: (Number(p.stock) || 0) + r.cant, costPrice: r.unit, salePrice: r.ventaNueva, price: r.ventaNueva } : p;
  };
  const filtrar = (lista) => (window.__boletaLeida ? lista : lista.filter((p) => !NUEVOS.test(p.name || ''))).map(sumar);
  // Los dos productos que creó la boleta, con el nombre y la foto que les puso Ventra solo
  const catalogo = (await previo({ url: '/products', method: 'get', headers: {} })).data || [];
  const foto = (re) => (catalogo.find((p) => re.test(p.name)) || {}).imageUrl || null;
  const hace = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const PARA_REVISAR = [
    { id: 'demo25', name: 'MILKA AVELLANA ENTERA X 100', barcode: '3045140118502', salePrice: 8900, costPrice: 5790, imageUrl: foto(/MILKA/), createdAt: hace(1) },
    { id: 'demo27', name: 'TAKIS EXPLOSION X 85 GR', barcode: '7500810034460', salePrice: 3200, costPrice: 2080, imageUrl: foto(/TAKIS/), createdAt: hace(1) },
  ];
  let revisiones = null;
  try { revisiones = (await import('/src/components/products/ProductReviews.tsx')).useProductReviews; } catch {}
  api.defaults.adapter = async (config) => {
    const url = String(config.url || '').split('?')[0];
    const m = (config.method || 'get').toLowerCase();
    if (url === '/products/reviews/pending') return ok(config, window.__boletaLeida ? PARA_REVISAR : []);
    // La pantalla Productos de la PC cuenta los productos aparte (la vista de prueba no lo simula)
    if (url === '/products/count') return ok(config, filtrar(catalogo).length);
    if (url.startsWith('/products/reviews')) return ok(config, { ok: true });
    if (url === '/purchases/scan-invoice-bg' && m === 'post') return ok(config, { id: 'lectura-1' });
    if (url.startsWith('/purchases/scan-invoice-bg/')) {
      window.__boletaLeida = true;
      revisiones?.setState({ count: PARA_REVISAR.length });
      return ok(config, { status: 'done', result: RESULTADO });
    }
    const r = await previo(config);
    if (m === 'get' && url.startsWith('/products')) {
      if (Array.isArray(r.data)) r.data = filtrar(r.data);
      else if (r.data && Array.isArray(r.data.products)) r.data = { ...r.data, products: filtrar(r.data.products) };
    }
    return r;
  };
  // El aviso "N productos nuevos para revisar" de la vista de prueba
  revisiones?.setState({ count: 0 });
  return true;
})()

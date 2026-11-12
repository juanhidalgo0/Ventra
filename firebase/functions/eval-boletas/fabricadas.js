// ═══════════════════════════════════════════════════
// Boletas fabricadas para el banco de pruebas (plan-boletas-ia.md, tanda 2.2).
// Contenido conocido en los formatos argentinos comunes. Proveedores, CUIT y productos INVENTADOS
// (el repositorio es público): los CUIT tienen dígito verificador válido pero no son de nadie conocido.
// Cada boleta: { id, tipo, proveedor, cuit, numero, fecha, letra, items, ... } → html() y esperado().
// ═══════════════════════════════════════════════════

/** CUIT con dígito verificador correcto */
function cuit(prefix, body) {
  const d = `${prefix}${body}`;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let dv = 11 - (w.reduce((s, k, i) => s + k * Number(d[i]), 0) % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return `${prefix}-${body}-${dv}`;
}
const CLIENTE = { nombre: "KIOSCO DE PRUEBA", cuit: cuit("20", "11122233") };

const ar = (n, dec = 2) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const r2 = (n) => Math.round(n * 100) / 100;

// i: [código interno, código de barras, nombre, bultos, unidades por bulto, precio unitario NETO (por bulto o unidad según la columna), iva%]
const BOLETAS = [
  {
    id: "factura-a-almacen", tipo: "factura", letra: "A", proveedor: "DISTRIBUIDORA LOS ALAMOS S.A.", cuit: cuit("30", "71555123"), numero: "0004-00012877", fecha: "2026-10-14",
    precios: "sin iva", percepciones: 1850.4, columnas: "ub",
    items: [["100234", "", "YERBA MATE SUAVE 1 KG", 2, 10, 2890, 21], ["100877", "", "ARROZ LARGO FINO 1 KG", 3, 10, 1120.5, 21], ["101002", "", "FIDEOS TIRABUZON 500 G", 2, 20, 690, 21], ["101450", "", "ACEITE GIRASOL 900 ML", 1, 12, 2350, 21], ["102001", "", "AZUCAR COMUN 1 KG", 2, 10, 980, 21], ["103300", "", "PURE DE TOMATE 520 G", 1, 24, 615.75, 21]],
  },
  {
    id: "factura-b-mayorista", tipo: "factura", letra: "B", proveedor: "MAYORISTA EL PUENTE SRL", cuit: cuit("30", "71666234"), numero: "0012-00098450", fecha: "2026-10-20",
    precios: "finales", columnas: "simple",
    items: [["", "7790001000017", "GALLETITAS DULCES VAINILLA 150 G", 12, 1, 1210, 21], ["", "7790001000024", "ALFAJOR TRIPLE CHOCOLATE 70 G", 24, 1, 980.1, 21], ["", "7790001000031", "CARAMELOS FRUTALES BOLSA 800 G", 2, 1, 5445, 21], ["", "7790001000048", "CHICLES MENTA X 20", 5, 1, 2662, 21], ["", "7790001000055", "GASEOSA COLA 2,25 L", 6, 1, 2420, 21]],
  },
  {
    id: "factura-c-monotributo", tipo: "factura", letra: "C", proveedor: "PANADERIA DON CARLOS", cuit: cuit("20", "28777345"), numero: "0002-00001544", fecha: "2026-10-21",
    precios: "finales", columnas: "simple",
    items: [["", "", "PAN FRANCES X KG", 8, 1, 2400, 0], ["", "", "FACTURAS SURTIDAS DOCENA", 3, 1, 6000, 0], ["", "", "BUDIN DE VAINILLA", 4, 1, 3200, 0]],
  },
  {
    id: "ticket-mayorista", tipo: "ticket", letra: "B", proveedor: "SUPERMAYORISTA RUTA 2 S.A.", cuit: cuit("30", "71888456"), numero: "0045-00334129", fecha: "2026-10-22",
    precios: "finales", columnas: "ticket",
    items: [["", "7790002000016", "LECHE ENTERA 1L", 12, 1, 1150, 21], ["", "7790002000023", "YOGUR FRUTILLA 1L", 6, 1, 1890, 21], ["", "7790002000030", "MANTECA 200 G", 4, 1, 2310, 21], ["", "7790002000047", "QUESO CREMA 290 G", 3, 1, 2780, 21]],
  },
  {
    id: "remito-sin-precios", tipo: "remito", letra: "R", proveedor: "LIMPIEZA TOTAL SA", cuit: cuit("30", "71999567"), numero: "0001-00004410", fecha: "2026-10-23",
    precios: "", columnas: "remito",
    items: [["LT-55", "", "LAVANDINA 2 L", 6, 1, 0, 21], ["LT-80", "", "DETERGENTE LIMON 750 ML", 12, 1, 0, 21], ["LT-91", "", "ESPONJA DOBLE USO", 10, 1, 0, 21]],
  },
  {
    id: "presupuesto", tipo: "nota", letra: "X", proveedor: "GOLOSINAS SUR", cuit: "", numero: "0000-00000312", fecha: "2026-10-24",
    precios: "finales", columnas: "simple", noValido: true,
    items: [["G01", "", "CHUPETIN FRUTAL X 50", 2, 1, 4500, 0], ["G07", "", "TURRON DE MANI X 25", 3, 1, 5250, 0], ["G12", "", "PASTILLAS MENTA X 12", 4, 1, 3600, 0]],
  },
  {
    id: "nota-a-mano", tipo: "nota", letra: "X", proveedor: "VERDULERIA EL TANO", cuit: "", numero: "", fecha: "2026-10-25",
    precios: "finales", columnas: "mano",
    items: [["", "", "PAPA", 10, 1, 900, 0], ["", "", "CEBOLLA", 5, 1, 1100, 0], ["", "", "TOMATE", 4, 1, 2500, 0], ["", "", "LECHUGA", 3, 1, 1800, 0]],
  },
  {
    id: "bebidas-bultos-unidades", tipo: "factura", letra: "A", proveedor: "BEBIDAS DEL VALLE S.A.", cuit: cuit("30", "71444678"), numero: "0007-00056002", fecha: "2026-10-26",
    precios: "sin iva", columnas: "bultosUnidades", internos: 3120,
    // cantidad "bultos,unidades": la 3ra es 0 bultos y 4 unidades
    items: [["5001", "", "AGUA SIN GAS 2 L X 6", 3, 6, 7200, 21], ["5007", "", "CERVEZA RUBIA LATA 473 X 24", 2, 24, 28800, 21], ["5013", "", "GASEOSA LIMA 1,5 L X 8", 0.5, 8, 11200, 21], ["5020", "", "JUGO NARANJA 1 L X 12", 1, 12, 13800, 10.5]],
  },
  {
    id: "factura-a-mixta-descuento", tipo: "factura", letra: "A", proveedor: "DISTRIBUIDORA NORTE GRANDE SRL", cuit: cuit("30", "71333789"), numero: "0003-00020011", fecha: "2026-10-27",
    precios: "sin iva", columnas: "simple", descuento: { texto: "BONIFICACION 5%", pct: 5 },
    items: [["7001", "", "HARINA 000 1 KG", 10, 1, 650, 10.5], ["7002", "", "PAN RALLADO 500 G", 6, 1, 890, 21], ["7003", "", "POLENTA 500 G", 8, 1, 720, 10.5], ["7004", "", "MAYONESA 500 G", 4, 1, 1980, 21], ["7005", "", "VINAGRE 1 L", 3, 1, 1150, 21]],
  },
  {
    id: "factura-a-cigarrillos", tipo: "factura", letra: "A", proveedor: "TABACALERA DEL LITORAL SA", cuit: cuit("30", "71222890"), numero: "0001-00077312", fecha: "2026-10-28",
    precios: "sin iva", columnas: "simple", internos: 18450.6,
    items: [["C20", "", "CIGARRILLOS RUBIOS X 20", 30, 1, 1850, 21], ["C10", "", "CIGARRILLOS MENTOLADOS X 10", 20, 1, 1100, 21], ["E01", "", "ENCENDEDOR DESCARTABLE", 25, 1, 380, 21]],
  },
];

/** Lo que tiene que leer el lector de una boleta (ver eval-boletas/compare.js) */
function esperado(b) {
  const lineas = linesOf(b);
  return {
    supplierName: b.proveedor, supplierCuit: b.cuit, invoiceNumber: b.numero, date: b.fecha, total: b.tipo === "remito" ? 0 : r2(totales(b).total),
    items: lineas.map((l) => ({
      code: l.codigo, barcode: l.ean, name: l.nombre, quantity: l.unidades, unitsPerPack: l.upp,
      // Costo neto por unidad: con precios finales se le saca el IVA (como hace la caja); con descuento, ya descontado
      cost: b.tipo === "remito" ? 0 : r2((l.neto * (1 - (b.descuento ? b.descuento.pct / 100 : 0))) / (b.precios === "finales" ? 1.21 : 1) / l.unidades),
    })),
  };
}

function linesOf(b) {
  return b.items.map(([codigo, ean, nombre, bultos, upp, precio, iva]) => {
    const unidades = Math.round(bultos * upp * 100) / 100;
    // Columna U.B.: el precio es por unidad; en el resto, por bulto (o unidad si upp = 1)
    const neto = b.columnas === "ub" ? r2(precio * unidades) : r2(precio * bultos);
    return { codigo, ean, nombre, bultos, upp, unidades, precio, iva, neto };
  });
}

function totales(b) {
  const lineas = linesOf(b);
  const bruto = lineas.reduce((s, l) => s + l.neto, 0);
  const desc = b.descuento ? r2(bruto * b.descuento.pct / 100) : 0;
  const factor = bruto > 0 ? (bruto - desc) / bruto : 1;
  if (b.precios !== "sin iva") return { bruto, desc, neto: bruto - desc, iva21: 0, iva105: 0, perc: 0, internos: 0, total: bruto - desc };
  const iva21 = r2(lineas.filter((l) => l.iva === 21).reduce((s, l) => s + l.neto * factor, 0) * 0.21);
  const iva105 = r2(lineas.filter((l) => l.iva === 10.5).reduce((s, l) => s + l.neto * factor, 0) * 0.105);
  const perc = b.percepciones || 0, internos = b.internos || 0;
  return { bruto, desc, neto: bruto - desc, iva21, iva105, perc, internos, total: r2(bruto - desc + iva21 + iva105 + perc + internos) };
}

const css = `body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111}
.hoja{width:1240px;min-height:1750px;padding:60px;box-sizing:border-box}
.cab{display:flex;justify-content:space-between;border:2px solid #111;padding:22px}
.letra{width:90px;height:90px;border:3px solid #111;font-size:64px;font-weight:bold;display:flex;align-items:center;justify-content:center}
h1{font-size:34px;margin:0 0 6px}.chico{font-size:19px;line-height:1.45}
table{width:100%;border-collapse:collapse;margin-top:26px;font-size:21px}
th{border-bottom:2px solid #111;text-align:left;padding:8px 6px;background:#eee}td{padding:9px 6px;border-bottom:1px solid #ccc}
.n{text-align:right;white-space:nowrap}.pie{margin-top:30px;margin-left:auto;width:520px;font-size:22px}
.pie div{display:flex;justify-content:space-between;padding:4px 0}.tot{font-weight:bold;font-size:28px;border-top:2px solid #111;margin-top:6px;padding-top:8px}
.ticket{width:620px;font-family:'Courier New',monospace;font-size:21px;padding:40px;margin:0 auto}
.mano{font-family:'Segoe Print','Comic Sans MS',cursive;font-size:38px;color:#1a2a8a;padding:90px;line-height:1.7;background:#fffef6;width:1240px;min-height:1750px;box-sizing:border-box}`;

/** La boleta en HTML, tamaño A4 a ~150 ppp (1240 × 1754) */
function html(b) {
  const L = linesOf(b);
  const T = totales(b);
  const head = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>`;
  if (b.columnas === "mano") {
    return `${head}<div class="mano"><div style="font-size:46px">${b.proveedor}</div><div>${b.fecha.split("-").reverse().join("/")}</div><br>
${L.map((l) => `<div>${l.bultos} kg ${l.nombre.toLowerCase()} ........ $${ar(l.neto, 0)}</div>`).join("")}<br><div style="font-size:44px">Total $${ar(T.total, 0)}</div></div></body></html>`;
  }
  if (b.columnas === "ticket") {
    return `${head}<div class="ticket"><div style="text-align:center;font-weight:bold">${b.proveedor}</div><div style="text-align:center">CUIT ${b.cuit}<br>IVA RESPONSABLE INSCRIPTO</div>
<div>TIQUE FACTURA ${b.letra} Nro ${b.numero}</div><div>Fecha ${b.fecha.split("-").reverse().join("/")}</div><div>----------------------------------------</div>
${L.map((l) => `<div>${l.unidades} x ${ar(l.precio)}</div><div>${l.ean} ${l.nombre}</div><div style="text-align:right">${ar(l.neto)}</div>`).join("")}
<div>----------------------------------------</div><div style="font-size:28px;font-weight:bold">TOTAL $ ${ar(T.total)}</div><div>IVA CONTENIDO</div><div>CONTADO</div></div></body></html>`;
  }
  const cols = {
    ub: ["ARTICULO", "CANT.", "U.B.", "DESCRIPCION", "P. UNIT.", "IMPORTE"],
    simple: ["CÓDIGO", "CANTIDAD", "DESCRIPCIÓN", "PRECIO", "SUBTOTAL"],
    remito: ["CÓDIGO", "CANTIDAD", "DESCRIPCIÓN"],
    bultosUnidades: ["ART.", "CANT. (B,U)", "DESCRIPCIÓN", "P. BULTO", "IMPORTE"],
  }[b.columnas];
  const row = (l) => ({
    ub: [l.codigo, ar(l.bultos, 0), l.upp, l.nombre, ar(l.precio), ar(l.neto)],
    simple: [l.codigo || l.ean, ar(l.bultos, 0), l.nombre, ar(l.precio), ar(l.neto)],
    remito: [l.codigo, ar(l.bultos, 0), l.nombre],
    bultosUnidades: [l.codigo, `${Math.floor(l.bultos)},${String(Math.round((l.bultos % 1) * l.upp)).padStart(2, "0")}`, l.nombre, ar(l.precio), ar(l.neto)],
  }[b.columnas]);
  const right = (k) => (k > 0 && /CANT|U\.B|PRECIO|P\. |IMPORTE|SUBTOTAL/.test(cols[k]) ? "n" : "");
  const pie = b.tipo === "remito" ? "" : b.precios === "sin iva"
    ? `<div class="pie"><div><span>Subtotal neto</span><span>${ar(T.bruto)}</span></div>${T.desc ? `<div><span>${b.descuento.texto}</span><span>-${ar(T.desc)}</span></div><div><span>Neto gravado</span><span>${ar(T.neto)}</span></div>` : ""}
<div><span>IVA 21%</span><span>${ar(T.iva21)}</span></div>${T.iva105 ? `<div><span>IVA 10,5%</span><span>${ar(T.iva105)}</span></div>` : ""}${T.perc ? `<div><span>Percepción IIBB</span><span>${ar(T.perc)}</span></div>` : ""}${T.internos ? `<div><span>Impuestos internos</span><span>${ar(T.internos)}</span></div>` : ""}
<div class="tot"><span>TOTAL</span><span>$ ${ar(T.total)}</span></div></div>`
    : `<div class="pie"><div class="tot"><span>TOTAL</span><span>$ ${ar(T.total)}</span></div></div>`;
  return `${head}<div class="hoja"><div class="cab"><div><h1>${b.proveedor}</h1><div class="chico">${b.cuit ? `CUIT: ${b.cuit}<br>` : ""}Av. Siempre Viva 123 - Ciudad<br>${b.letra === "C" ? "Monotributo" : b.cuit ? "IVA Responsable Inscripto" : ""}</div></div>
<div class="letra">${b.letra}</div><div class="chico" style="text-align:right"><b style="font-size:28px">${{ factura: "FACTURA", remito: "REMITO", nota: b.noValido ? "PRESUPUESTO" : "NOTA DE PEDIDO", ticket: "TIQUE" }[b.tipo]}</b><br>N° ${b.numero}<br>Fecha: ${b.fecha.split("-").reverse().join("/")}${b.noValido ? "<br><b>DOCUMENTO NO VÁLIDO COMO FACTURA</b>" : ""}</div></div>
<div class="chico" style="margin-top:14px">Cliente: ${CLIENTE.nombre} — CUIT ${CLIENTE.cuit} — Condición de venta: Cuenta corriente</div>
<table><tr>${cols.map((c, k) => `<th class="${right(k)}">${c}</th>`).join("")}</tr>${L.map((l) => `<tr>${row(l).map((v, k) => `<td class="${right(k)}">${v}</td>`).join("")}</tr>`).join("")}</table>${pie}</div></body></html>`;
}

/** Formas de arruinar la foto (las aplica generar.js con sharp) */
const ARRUINAR = ["limpia", "girada", "borrosa", "sombra", "cortada", "papel-atras"];

module.exports = { BOLETAS, esperado, html, totales, linesOf, ARRUINAR, cuit };

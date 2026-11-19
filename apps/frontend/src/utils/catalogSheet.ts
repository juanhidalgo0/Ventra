import { escapeHtml } from './escapeHtml';

/**
 * Catálogo A4 para mandar en PDF a los clientes que no usan la tienda online: tapa con el logo,
 * los datos del comercio y la fecha, y los productos por categoría en tarjetas (con foto o sin),
 * con el precio minorista, el mayorista o los dos.
 *
 * Las hojas se arman acá (no las corta el navegador): así cada página sale completa, con su
 * encabezado de categoría y su pie, igual en la PC, en la web y al guardarla en PDF.
 */

export interface CatalogItem {
  name: string;
  category: string;
  brand?: string | null;
  code?: string | null;
  image?: string | null;
  /** Precio minorista (el de venta) */
  price: number;
  /** Precio mayorista (vacío = el mismo) */
  tradePrice?: number | null;
  /** Bulto: unidades y precio del bulto entero */
  pack?: { size: number; price: number } | null;
  /**
   * Ofertas ya escritas para la lista elegida ("Bulto x12: $10.200", "Desde 10 u.: $850 c/u",
   * "3x2", "-15%", "12 por $9.000"). Si vienen, reemplazan la línea del bulto.
   */
  offers?: string[];
}

export type CatalogPrices = 'RETAIL' | 'TRADE' | 'BOTH';

export interface CatalogOptions {
  title: string;
  storeName?: string;
  logo?: string | null;
  phone?: string;
  address?: string;
  accent: string;
  showImages: boolean;
  showCodes: boolean;
  prices: CatalogPrices;
  /** Cómo se llama la segunda lista ("Mayorista") */
  tradeName: string;
  note?: string;
}

/**
 * Nombre con que se guarda el PDF (el navegador usa el título de la página):
 * "Catálogo mayorista - Limpissimo - 19-11-2026". Sin caracteres que no van en un nombre de archivo.
 */
export function catalogFileName(o: Pick<CatalogOptions, 'title' | 'storeName' | 'prices' | 'tradeName'>, date = new Date()): string {
  const list = o.prices === 'TRADE' ? o.tradeName.toLowerCase() : o.prices === 'BOTH' ? `minorista y ${o.tradeName.toLowerCase()}` : '';
  const title = (o.title || 'Catálogo').trim();
  const head = list && !title.toLowerCase().includes(o.tradeName.toLowerCase()) ? `${title} ${list}` : title;
  const day = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
  return [head, (o.storeName || '').trim(), day]
    .filter(Boolean)
    .join(' - ')
    .replace(/[\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

const money = (n: number) => `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * Medidas de la hoja en mm (las mismas del CSS de abajo): las hojas se arman sumando alturas
 * reales, así cada una sale llena sin pasarse. Si se cambia el CSS, cambiar acá también.
 */
const MM = {
  /** Lo que entra entre el borde de arriba y el pie (con 2 mm de resguardo) */
  content: 271,
  /** Tapa de la primera hoja: franja de color + margen */
  cover: 43,
  cat: 13.4,
  /** Renglón de 3 tarjetas con foto (47 mm + 3 de separación) */
  grid: 50,
  /** Renglón de la lista sin fotos, y con su línea de ofertas */
  list: 6.4,
  listOffers: 10.4,
  indexHead: 8,
  indexRow: 4.6,
};
const INDEX_MAX = 24;

type Block = { kind: 'cat'; name: string } | { kind: 'row'; items: CatalogItem[] };

export function buildCatalogDocument(all: CatalogItem[], o: CatalogOptions): string {
  const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const grid = o.showImages;
  const perRow = grid ? 3 : 1;
  const nCols = grid ? 1 : 2;

  // Por categoría y por nombre
  const byCat = new Map<string, CatalogItem[]>();
  for (const it of all) {
    const c = (it.category || 'Varios').trim() || 'Varios';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(it);
  }
  const cats = [...byCat.keys()].sort((a, b) => (a === 'Varios' ? 1 : b === 'Varios' ? -1 : a.localeCompare(b, 'es')));
  const blocks: Block[] = [];
  for (const c of cats) {
    const list = byCat.get(c)!.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    blocks.push({ kind: 'cat', name: c });
    for (let i = 0; i < list.length; i += perRow) blocks.push({ kind: 'row', items: list.slice(i, i + perRow) });
  }

  // Índice en la tapa (con la hoja de cada categoría): solo si hay varias categorías
  const showIndex = cats.length >= 3 && all.length > 24;
  const indexEntries = Math.min(cats.length, INDEX_MAX);
  const noteLines = o.note ? Math.ceil(o.note.length / 95) : 0;
  const firstExtra = MM.cover + (noteLines ? noteLines * 4.6 + 3 : 0) + (showIndex ? MM.indexHead + Math.ceil(indexEntries / 3) * MM.indexRow : 0);

  const height = (b?: Block) => (!b ? 0 : b.kind === 'cat' ? MM.cat : grid ? MM.grid : b.items[0]?.offers?.length ? MM.listOffers : MM.list);

  // Hojas → columnas (la lista va en 2) → bloques. Un título de categoría nunca queda solo al pie,
  // y la categoría que sigue en otra columna u hoja repite su título.
  const pages: Block[][][] = [];
  let page: Block[][] = [[]];
  let used = 0;
  let currentCat = '';
  const catPage = new Map<string, number>();
  const cap = () => MM.content - (pages.length === 0 ? firstExtra : 0);
  const col = () => page[page.length - 1];
  const nextCol = () => {
    if (page.length < nCols) page.push([]);
    else { pages.push(page); page = [[]]; }
    used = 0;
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const need = b.kind === 'cat' ? MM.cat + height(blocks[i + 1]) : height(b);
    if (col().length && used + need > cap() + 1e-6) nextCol();
    if (!col().length && b.kind === 'row' && currentCat) { col().push({ kind: 'cat', name: `${currentCat} (sigue)` }); used += MM.cat; }
    if (b.kind === 'cat') { currentCat = b.name; catPage.set(b.name, pages.length + 1); }
    col().push(b);
    used += height(b);
  }
  pages.push(page);

  const money0 = money;
  const offersHtml = (it: CatalogItem, max: number) => (it.offers || []).slice(0, max).map((x) => `<span class="chip">${escapeHtml(x)}</span>`).join('');
  const tradeOf = (it: CatalogItem) => (Number(it.tradePrice) > 0 ? Number(it.tradePrice) : it.price);
  const priceHtml = (it: CatalogItem) => {
    const extra = it.offers ? (it.offers.length ? `<div class="offers">${offersHtml(it, 2)}</div>` : '')
      : it.pack && it.pack.size > 1 ? `<div class="pack">Bulto x${it.pack.size}: ${money0(it.pack.price)}</div>` : '';
    if (o.prices === 'RETAIL') return `<div class="price">${money0(it.price)}</div>${extra}`;
    if (o.prices === 'TRADE') return `<div class="price">${money0(tradeOf(it))}</div>${extra}`;
    return `<div class="prices"><div><span>Minorista</span><b>${money0(it.price)}</b></div><div class="tp"><span>${escapeHtml(o.tradeName)}</span><b>${money0(tradeOf(it))}</b></div></div>${extra}`;
  };
  const card = (it: CatalogItem) => {
    const off = !!it.offers?.length;
    return `<div class="card${off ? ' has-offers' : ''}">
      <div class="pic">${it.image ? `<img src="${escapeHtml(it.image)}" alt="">` : `<span class="nopic">${escapeHtml((it.name || '?').slice(0, 1))}</span>`}${off ? '<span class="otag">Oferta</span>' : ''}</div>
      <div class="body">
        <div class="name">${escapeHtml(it.name)}</div>
        <div class="meta">${[it.brand ? escapeHtml(it.brand) : '', o.showCodes && it.code ? `Cód. ${escapeHtml(it.code)}` : ''].filter(Boolean).join(' · ')}</div>
        ${priceHtml(it)}
      </div>
    </div>`;
  };
  const listRow = (it: CatalogItem) => {
    const off = !!it.offers?.length;
    const pr = o.prices === 'RETAIL' ? money0(it.price) : o.prices === 'TRADE' ? money0(tradeOf(it)) : `${money0(it.price)} <i>/ ${money0(tradeOf(it))}</i>`;
    return `<div class="lrow${off ? ' off' : ''}"><div class="lmain"><div class="lname"><span>${escapeHtml(it.name)}</span>${o.showCodes && it.code ? `<small>${escapeHtml(it.code)}</small>` : ''}</div>${off ? `<div class="loffers">${offersHtml(it, 3)}</div>` : ''}</div><div class="ldots"></div><div class="lprice">${pr}</div></div>`;
  };
  const blockHtml = (b: Block) => (b.kind === 'cat'
    ? `<h2>${escapeHtml(b.name)}</h2>`
    : grid ? `<div class="row">${b.items.map(card).join('')}</div>` : b.items.map(listRow).join(''));

  const priceLabel = o.prices === 'RETAIL' ? 'Precios minoristas' : o.prices === 'TRADE' ? `Precios ${o.tradeName.toLowerCase()}s` : `Precio minorista / ${o.tradeName.toLowerCase()}`;
  const contact = [o.phone ? `WhatsApp ${o.phone}` : '', o.address || ''].filter(Boolean).join(' · ');
  const indexHtml = showIndex ? `<section class="index"><h3>En este catálogo</h3><ul>${cats.slice(0, INDEX_MAX - (cats.length > INDEX_MAX ? 1 : 0)).map((c) => `<li><span>${escapeHtml(c)}</span><i></i><b>${catPage.get(c) ?? ''}</b></li>`).join('')}${cats.length > INDEX_MAX ? `<li><span>y ${cats.length - INDEX_MAX + 1} más</span></li>` : ''}</ul></section>` : '';
  const html = pages.map((cols, p) => `<div class="page">
      ${p === 0 ? `<header>
        ${o.logo ? `<img class="logo" src="${escapeHtml(o.logo)}" alt="">` : ''}
        <div class="htxt">
          ${o.storeName ? `<div class="store">${escapeHtml(o.storeName)}</div>` : ''}
          <h1>${escapeHtml(o.title || 'Catálogo')}</h1>
          <p class="sub">${escapeHtml(priceLabel)} · al ${today}${o.prices !== 'RETAIL' ? ' · con IVA' : ''}</p>
          ${contact ? `<p class="contact">${escapeHtml(contact)}</p>` : ''}
        </div>
      </header>${o.note ? `<p class="note">${escapeHtml(o.note)}</p>` : ''}${indexHtml}` : ''}
      <div class="content ${grid ? 'grid' : 'lcols'}${o.prices === 'BOTH' ? ' both' : ''}">
        ${grid ? cols[0].map(blockHtml).join('') : cols.map((c) => `<div class="lcol">${c.map(blockHtml).join('')}</div>`).join('')}
      </div>
      <footer>
        ${o.logo && p > 0 ? `<img class="flogo" src="${escapeHtml(o.logo)}" alt="">` : ''}
        <span class="fl">${escapeHtml(o.storeName || '')}${contact ? ` · ${escapeHtml(contact)}` : ''}</span>
        <span>Precios al ${today}, sujetos a cambio · Hoja ${p + 1} de ${pages.length}</span>
      </footer>
    </div>`).join('');

  const ink = o.accent === '#111827' ? '#0f172a' : o.accent;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(catalogFileName(o))}</title><style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
  .page { width: 210mm; height: 297mm; padding: 10mm 10mm 8mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; overflow: hidden; background: #fff; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  header { background: ${o.accent}; color: #fff; border-radius: 4mm; padding: 6mm 7mm; margin-bottom: 4mm; display: flex; align-items: center; gap: 5mm; max-height: 39mm; overflow: hidden; }
  .logo { width: 24mm; height: 24mm; flex: none; object-fit: contain; background: #fff; border-radius: 3mm; padding: 1.5mm; }
  .htxt { min-width: 0; }
  .store { font-size: 3.4mm; font-weight: 800; letter-spacing: .4mm; text-transform: uppercase; opacity: .9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  h1 { font-size: 10mm; font-weight: 900; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 3.8mm; margin-top: 1.2mm; opacity: .95; font-weight: 600; }
  .contact { font-size: 3.4mm; margin-top: .8mm; opacity: .9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .note { font-size: 3.4mm; line-height: 4.6mm; color: #334155; margin: 0 1mm 3mm; font-weight: 600; }
  .index { margin: 0 1mm 3mm; }
  .index h3 { font-size: 2.8mm; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: .3mm; height: 5mm; }
  .index ul { list-style: none; display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 7mm; }
  .index li { display: flex; align-items: baseline; gap: 1.2mm; height: 4.6mm; font-size: 3mm; font-weight: 600; color: #334155; min-width: 0; }
  .index li span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .index li i { flex: 1; min-width: 2mm; border-bottom: .3mm dotted #cbd5e1; }
  .index li b { color: ${ink}; font-weight: 900; }
  .content { flex: 1; min-height: 0; }
  h2 { font-size: 4.6mm; font-weight: 900; color: ${ink}; text-transform: uppercase; letter-spacing: .3mm; border-bottom: .6mm solid ${o.accent}; padding: 1.5mm 0 1mm; margin: 1.5mm 0 2.5mm; height: 9.4mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-bottom: 3mm; }
  .card { border: .3mm solid #e2e8f0; border-radius: 3mm; overflow: hidden; display: flex; flex-direction: column; height: 47mm; }
  .card.has-offers { border-color: #fdba74; }
  .pic { position: relative; height: 22mm; flex: none; display: flex; align-items: center; justify-content: center; background: #f8fafc; }
  .pic img { max-width: 92%; max-height: 92%; object-fit: contain; }
  .both .pic { height: 17mm; }
  .has-offers .pic { height: 15mm; }
  .both .has-offers .pic { height: 10mm; }
  .nopic { font-size: 9mm; font-weight: 900; color: #cbd5e1; }
  .has-offers .nopic { font-size: 6mm; }
  .otag { position: absolute; top: 1.5mm; right: 1.5mm; background: #ea580c; color: #fff; font-size: 2.3mm; font-weight: 900; letter-spacing: .2mm; text-transform: uppercase; border-radius: 1mm; padding: .4mm 1.2mm; }
  .body { padding: 2mm 2.5mm; display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .name { font-size: 3.1mm; font-weight: 800; line-height: 1.15; text-transform: uppercase; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .meta { font-size: 2.5mm; color: #64748b; margin-top: .6mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .price { margin-top: auto; font-size: 5mm; font-weight: 900; color: ${ink}; }
  .prices { margin-top: auto; display: flex; flex-direction: column; gap: .3mm; }
  .prices div { display: flex; justify-content: space-between; align-items: baseline; font-size: 2.6mm; color: #475569; }
  .prices b { font-size: 3.6mm; color: #0f172a; }
  .prices .tp b { color: ${ink}; font-size: 4.2mm; }
  .pack { font-size: 2.5mm; color: #475569; margin-top: .4mm; }
  .chip { font-size: 2.45mm; line-height: 3.2mm; font-weight: 800; color: #c2410c; background: #fff7ed; border: .25mm solid #fed7aa; border-radius: 1mm; padding: 0 1.2mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .offers { display: flex; flex-direction: column; align-items: flex-start; gap: .6mm; margin-top: 1mm; }
  .offers .chip { max-width: 100%; }
  .lcols { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; align-items: start; }
  .lcol { min-width: 0; }
  .lrow { display: flex; align-items: flex-start; gap: 1.5mm; height: 6.4mm; padding-top: 1.4mm; border-bottom: .2mm solid #f1f5f9; overflow: hidden; }
  .lrow.off { height: 10.4mm; }
  .lmain { min-width: 0; flex: 0 1 auto; }
  .lname { display: flex; align-items: baseline; gap: 1.2mm; font-size: 3mm; line-height: 3.5mm; font-weight: 700; text-transform: uppercase; min-width: 0; }
  .lname span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lname small { flex: none; font-size: 2.3mm; color: #94a3b8; font-weight: 600; }
  .loffers { display: flex; gap: .8mm; margin-top: .7mm; overflow: hidden; }
  .loffers .chip { flex: none; font-size: 2.3mm; line-height: 3mm; }
  .ldots { flex: 1; min-width: 3mm; height: 3mm; border-bottom: .35mm dotted #cbd5e1; }
  .lprice { font-size: 3.4mm; line-height: 3.5mm; font-weight: 900; white-space: nowrap; color: ${ink}; }
  .lprice i { font-style: normal; color: #64748b; font-size: 2.8mm; }
  footer { display: flex; align-items: center; gap: 3mm; font-size: 2.7mm; color: #64748b; padding-top: 2mm; border-top: .2mm solid #e2e8f0; }
  footer .fl { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .flogo { width: 5mm; height: 5mm; object-fit: contain; }
  @media screen { body { background: #e2e8f0; padding: 12px; } .page { margin: 0 auto 12px; box-shadow: 0 1px 4px rgba(15,23,42,.18); } }
  </style></head><body>${html}</body></html>`;
}

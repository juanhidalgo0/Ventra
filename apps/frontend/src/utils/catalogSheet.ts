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

const money = (n: number) => `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Renglones por hoja: con foto, 3 tarjetas por renglón; sin foto, una lista en 2 columnas */
const ROWS_WITH_PHOTO = 5;
const ROWS_WITHOUT_PHOTO = 38;

type Block = { kind: 'cat'; name: string } | { kind: 'row'; items: CatalogItem[] };

export function buildCatalogDocument(all: CatalogItem[], o: CatalogOptions): string {
  const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const perRow = o.showImages ? 3 : 2;
  const rowsPerPage = o.showImages ? ROWS_WITH_PHOTO : ROWS_WITHOUT_PHOTO;

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

  // Hojas: la primera tiene la tapa (ocupa 2 renglones). Un título de categoría no queda solo al pie.
  const pages: Block[][] = [];
  let cur: Block[] = [];
  let used = 0;
  const capacity = () => rowsPerPage - (pages.length === 0 ? (o.showImages ? 1 : 6) : 0);
  const cost = (b: Block) => (b.kind === 'cat' ? (o.showImages ? 0.35 : 1.6) : 1);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const need = b.kind === 'cat' ? cost(b) + 1 : cost(b);
    if (cur.length && used + need > capacity() + 1e-9) { pages.push(cur); cur = []; used = 0; }
    // Una categoría que sigue en la hoja nueva repite su título
    if (!cur.length && b.kind === 'row') {
      const prevCat = [...blocks.slice(0, i)].reverse().find((x) => x.kind === 'cat') as { kind: 'cat'; name: string } | undefined;
      if (prevCat) { cur.push({ kind: 'cat', name: `${prevCat.name} (sigue)` }); used += cost(prevCat); }
    }
    cur.push(b);
    used += cost(b);
  }
  if (cur.length || !pages.length) pages.push(cur);

  const priceHtml = (it: CatalogItem) => {
    const trade = Number(it.tradePrice) > 0 ? Number(it.tradePrice) : it.price;
    const packLine = it.pack && it.pack.size > 1 ? `<div class="pack">Bulto x${it.pack.size}: ${money(it.pack.price)}</div>` : '';
    if (o.prices === 'RETAIL') return `<div class="price">${money(it.price)}</div>${packLine}`;
    if (o.prices === 'TRADE') return `<div class="price">${money(trade)}</div>${packLine}`;
    return `<div class="prices"><div><span>Minorista</span><b>${money(it.price)}</b></div><div class="tp"><span>${escapeHtml(o.tradeName)}</span><b>${money(trade)}</b></div></div>${packLine}`;
  };
  const card = (it: CatalogItem) => `<div class="card">
      ${o.showImages ? `<div class="pic">${it.image ? `<img src="${escapeHtml(it.image)}" alt="">` : `<span class="nopic">${escapeHtml((it.name || '?').slice(0, 1))}</span>`}</div>` : ''}
      <div class="body">
        <div class="name">${escapeHtml(it.name)}</div>
        <div class="meta">${[it.brand ? escapeHtml(it.brand) : '', o.showCodes && it.code ? `Cód. ${escapeHtml(it.code)}` : ''].filter(Boolean).join(' · ')}</div>
        ${priceHtml(it)}
      </div>
    </div>`;
  const listRow = (it: CatalogItem) => {
    const trade = Number(it.tradePrice) > 0 ? Number(it.tradePrice) : it.price;
    const pr = o.prices === 'RETAIL' ? money(it.price) : o.prices === 'TRADE' ? money(trade) : `${money(it.price)} <i>/ ${money(trade)}</i>`;
    return `<div class="lrow"><div class="lname">${escapeHtml(it.name)}${o.showCodes && it.code ? ` <small>${escapeHtml(it.code)}</small>` : ''}</div><div class="ldots"></div><div class="lprice">${pr}</div></div>`;
  };

  const priceLabel = o.prices === 'RETAIL' ? 'Precios minoristas' : o.prices === 'TRADE' ? `Precios ${o.tradeName.toLowerCase()}s` : `Precio minorista / ${o.tradeName.toLowerCase()}`;
  const contact = [o.phone ? `WhatsApp ${o.phone}` : '', o.address || ''].filter(Boolean).join(' · ');
  const html = pages.map((blocksOfPage, p) => `<div class="page">
      ${p === 0 ? `<header>
        ${o.logo ? `<img class="logo" src="${escapeHtml(o.logo)}" alt="">` : ''}
        <div class="htxt">
          ${o.storeName ? `<div class="store">${escapeHtml(o.storeName)}</div>` : ''}
          <h1>${escapeHtml(o.title || 'Catálogo')}</h1>
          <p class="sub">${escapeHtml(priceLabel)} · al ${today}${o.prices !== 'RETAIL' ? ' · con IVA' : ''}</p>
          ${contact ? `<p class="contact">${escapeHtml(contact)}</p>` : ''}
        </div>
      </header>${o.note ? `<p class="note">${escapeHtml(o.note)}</p>` : ''}` : ''}
      <div class="content ${o.showImages ? 'grid' : 'list'}${o.prices === 'BOTH' ? ' both' : ''}">
        ${blocksOfPage.map((b) => (b.kind === 'cat'
          ? `<h2>${escapeHtml(b.name)}</h2>`
          : o.showImages ? `<div class="row">${b.items.map(card).join('')}</div>` : b.items.map(listRow).join(''))).join('')}
      </div>
      <footer><span>${escapeHtml(o.storeName || '')}${contact ? ` · ${escapeHtml(contact)}` : ''}</span><span>Precios al ${today} · Hoja ${p + 1} de ${pages.length}</span></footer>
    </div>`).join('');

  const ink = o.accent === '#111827' ? '#0f172a' : o.accent;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(o.title || 'Catálogo')}</title><style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
  .page { width: 210mm; height: 297mm; padding: 10mm 10mm 8mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; overflow: hidden; background: #fff; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  header { background: ${o.accent}; color: #fff; border-radius: 4mm; padding: 6mm 7mm; margin-bottom: 4mm; display: flex; align-items: center; gap: 5mm; }
  .logo { width: 22mm; height: 22mm; object-fit: contain; background: #fff; border-radius: 3mm; padding: 1.5mm; }
  .store { font-size: 3.4mm; font-weight: 800; letter-spacing: .4mm; text-transform: uppercase; opacity: .9; }
  h1 { font-size: 10mm; font-weight: 900; line-height: 1.05; }
  .sub { font-size: 3.8mm; margin-top: 1.2mm; opacity: .95; font-weight: 600; }
  .contact { font-size: 3.4mm; margin-top: .8mm; opacity: .9; }
  .note { font-size: 3.4mm; color: #334155; margin: 0 1mm 3mm; }
  .content { flex: 1; }
  h2 { font-size: 4.6mm; font-weight: 900; color: ${ink}; text-transform: uppercase; letter-spacing: .3mm; border-bottom: .6mm solid ${o.accent}; padding: 1.5mm 0 1mm; margin: 1.5mm 0 2.5mm; }
  .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-bottom: 3mm; }
  .card { border: .3mm solid #e2e8f0; border-radius: 3mm; overflow: hidden; display: flex; flex-direction: column; height: 47mm; }
  .pic { height: 22mm; display: flex; align-items: center; justify-content: center; background: #f8fafc; }
  .pic img { max-width: 92%; max-height: 92%; object-fit: contain; }
  .both .pic { height: 17mm; }
  .nopic { font-size: 9mm; font-weight: 900; color: #cbd5e1; }
  .body { padding: 2mm 2.5mm; display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .name { font-size: 3.1mm; font-weight: 800; line-height: 1.15; text-transform: uppercase; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .meta { font-size: 2.5mm; color: #64748b; margin-top: .6mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .price { margin-top: auto; font-size: 5mm; font-weight: 900; color: ${ink}; }
  .prices { margin-top: auto; display: flex; flex-direction: column; gap: .3mm; }
  .prices div { display: flex; justify-content: space-between; align-items: baseline; font-size: 2.6mm; color: #475569; }
  .prices b { font-size: 3.6mm; color: #0f172a; }
  .prices .tp b { color: ${ink}; font-size: 4.2mm; }
  .pack { font-size: 2.5mm; color: #475569; margin-top: .4mm; }
  .list { columns: 2; column-gap: 8mm; }
  .list h2 { break-after: avoid; }
  .lrow { display: flex; align-items: flex-end; gap: 1.5mm; padding: 1.25mm 0; border-bottom: .2mm solid #f1f5f9; break-inside: avoid; }
  .lname { font-size: 3mm; font-weight: 700; text-transform: uppercase; line-height: 1.15; }
  .lname small { font-size: 2.3mm; color: #94a3b8; font-weight: 600; }
  .ldots { flex: 1; min-width: 3mm; border-bottom: .35mm dotted #cbd5e1; margin-bottom: .9mm; }
  .lprice { font-size: 3.4mm; font-weight: 900; white-space: nowrap; color: ${ink}; }
  .lprice i { font-style: normal; color: #64748b; font-size: 2.8mm; }
  footer { display: flex; justify-content: space-between; gap: 4mm; font-size: 2.7mm; color: #64748b; padding-top: 2mm; border-top: .2mm solid #e2e8f0; }
  @media screen { body { background: #e2e8f0; padding: 12px; } .page { margin: 0 auto 12px; box-shadow: 0 1px 4px rgba(15,23,42,.18); } }
  </style></head><body>${html}</body></html>`;
}

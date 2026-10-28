import { escapeHtml } from './escapeHtml';

/**
 * Lista de precios A4 de un grupo (para pegar en el mostrador o mandar en PDF): encabezado con
 * el logo y el nombre del comercio, los productos en dos columnas y la fecha de los precios.
 */

export interface PriceListItem { name: string; price: number; image?: string | null; code?: string | null }

export interface PriceListOptions {
  title: string;
  subtitle?: string;
  storeName?: string;
  logo?: string | null;
  phone?: string;
  address?: string;
  accent: string;
  showImages: boolean;
  showCodes: boolean;
}

const PER_PAGE = 30;
const money = (n: number) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;

export function buildPriceListDocument(items: PriceListItem[], o: PriceListOptions): string {
  const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const perPage = o.showImages ? 20 : PER_PAGE;
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const contact = [o.phone ? `WhatsApp ${o.phone}` : '', o.address || ''].filter(Boolean).join(' · ');
  const html: string[] = [];
  for (let p = 0; p < pages; p++) {
    const slice = items.slice(p * perPage, (p + 1) * perPage);
    html.push(`<div class="page">
      ${p === 0 ? `<header>
        <div class="head">
          ${o.logo ? `<img class="logo" src="${escapeHtml(o.logo)}" alt="">` : ''}
          <div>
            ${o.storeName ? `<div class="store">${escapeHtml(o.storeName)}</div>` : ''}
            <h1>${escapeHtml(o.title || 'Lista de precios')}</h1>
            ${o.subtitle ? `<p class="sub">${escapeHtml(o.subtitle)}</p>` : ''}
          </div>
        </div>
      </header>` : ''}
      <div class="rows">
        ${slice.map((it) => `<div class="row">
          ${o.showImages ? `<div class="pic">${it.image ? `<img src="${escapeHtml(it.image)}" alt="">` : ''}</div>` : ''}
          <div class="info"><div class="name">${escapeHtml(it.name)}</div>${o.showCodes && it.code ? `<div class="code">${escapeHtml(it.code)}</div>` : ''}</div>
          <div class="dots"></div>
          <div class="price">${money(it.price)}</div>
        </div>`).join('')}
      </div>
      <footer><span>${escapeHtml(contact)}</span><span>Precios al ${today}${pages > 1 ? ` · Hoja ${p + 1} de ${pages}` : ''}</span></footer>
    </div>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(o.title || 'Lista de precios')}</title><style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
  .page { width: 210mm; height: 297mm; padding: 12mm 12mm 10mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; position: relative; background: #fff; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  header { background: ${o.accent}; color: #fff; border-radius: 4mm; padding: 6mm 7mm; margin-bottom: 6mm; }
  .head { display: flex; align-items: center; gap: 5mm; }
  .logo { width: 18mm; height: 18mm; object-fit: contain; background: #fff; border-radius: 3mm; padding: 1.5mm; }
  .store { font-size: 3.4mm; font-weight: 800; letter-spacing: 0.4mm; text-transform: uppercase; opacity: .9; }
  h1 { font-size: 9mm; font-weight: 900; line-height: 1.05; }
  .sub { font-size: 4mm; margin-top: 1mm; opacity: .9; }
  .rows { flex: 1; columns: 2; column-gap: 9mm; }
  .row { display: flex; align-items: center; gap: 2.5mm; padding: 2.3mm 0; border-bottom: 0.25mm solid #e2e8f0; break-inside: avoid; }
  .pic { width: 11mm; height: 11mm; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .pic img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .info { min-width: 0; flex-shrink: 1; }
  .name { font-size: 3.5mm; font-weight: 700; line-height: 1.15; text-transform: uppercase; }
  .code { font-size: 2.4mm; color: #64748b; font-family: 'Courier New', monospace; }
  .dots { flex: 1; min-width: 4mm; border-bottom: 0.4mm dotted #cbd5e1; margin: 0 1mm; align-self: flex-end; margin-bottom: 1.2mm; }
  .price { font-size: 4.6mm; font-weight: 900; white-space: nowrap; color: ${o.accent === '#111827' ? '#0f172a' : o.accent}; }
  footer { display: flex; justify-content: space-between; font-size: 2.8mm; color: #64748b; padding-top: 3mm; }
  @media screen { body { background: #e2e8f0; padding: 12px; } .page { margin: 0 auto 12px; box-shadow: 0 1px 4px rgba(15,23,42,.18); } }
  </style></head><body>${html.join('')}</body></html>`;
}

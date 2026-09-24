/**
 * Convierte una hoja de impresión de la app (las mismas que imprime la PC, montadas ocultas
 * con "hidden print:block") en un PDF A4 que se descarga. Se usa en el celular, donde no hay
 * impresora: la hoja se copia fuera de pantalla con el ancho de una A4, se fotografía con
 * html2canvas y se reparte en páginas con jsPDF.
 */
const A4_WIDTH_PX = 794; // 210 mm a 96 ppp
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MARGIN_MM = 4; // igual que @page { margin: 4mm } de las hojas

export async function downloadPrintableAsPdf(source: HTMLElement, filename: string, opts: { remove?: string[] } = {}) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${A4_WIDTH_PX}px;background:#ffffff;color:#000000;pointer-events:none;`;
  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  clone.className = '';
  clone.style.display = 'block';
  for (const sel of opts.remove || []) clone.querySelectorAll(sel).forEach((el) => el.remove());
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    const canvas = await html2canvas(host, {
      scale: 2, backgroundColor: '#ffffff', windowWidth: A4_WIDTH_PX, logging: false,
      // html2canvas dibuja el texto de las celdas de tabla unos píxeles más abajo que el
      // navegador y la línea de cada fila lo tacha: en la copia se sube el texto de las celdas.
      onclone: (doc) => {
        const st = doc.createElement('style');
        st.textContent = 'td, th { position: relative; top: -2px; }';
        doc.head.appendChild(st);
      },
    });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const imgW = PAGE_W_MM - MARGIN_MM * 2;
    const pxPerMm = canvas.width / imgW;
    const pagePx = Math.floor((PAGE_H_MM - MARGIN_MM * 2) * pxPerMm);
    for (let y = 0, page = 0; y < canvas.height; y += pagePx, page++) {
      const h = Math.min(pagePx, canvas.height - y);
      if (h < 4) break;
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      slice.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (page > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_MM, MARGIN_MM, imgW, h / pxPerMm);
    }
    pdf.save(filename);
  } finally {
    host.remove();
  }
}

/**
 * Espera a que React pinte la hoja recién montada (dos cuadros) y a que carguen las fuentes.
 * Con la pestaña en segundo plano los cuadros no llegan: a los 400 ms se sigue igual.
 */
export const afterPaint = () =>
  new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const fonts = (document as any).fonts;
      Promise.race([fonts?.ready || Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]).then(() => resolve());
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 400);
  });

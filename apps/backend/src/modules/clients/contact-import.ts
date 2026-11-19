import * as XLSX from 'xlsx';

/**
 * Lectura de planillas de clientes o proveedores que vienen de otro sistema (Excel o CSV).
 *
 * Reconoce las columnas por su nombre, aunque el otro sistema haya exportado mal los acentos
 * ("C�digo", "Raz�n Social"): se comparan solo las consonantes del nombre de la columna
 * (codigo → cdg), así "Código", "Codigo" y "C�digo" son la misma.
 *
 * No escribe nada: devuelve los renglones limpios y los avisos (ver ContactImportService).
 */
export type ContactKind = 'clients' | 'suppliers';

export interface ContactRow {
  /** Renglón de la planilla (para los avisos) */
  line: number;
  code: string | null;
  name: string;
  /** Persona de contacto (proveedores) */
  contact: string | null;
  cuit: string | null;
  dni: string | null;
  ivaCondition: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  locality: string | null;
  priceList: 'RETAIL' | 'TRADE';
  /** Positivo: el cliente nos debe / le debemos al proveedor */
  balance: number;
  /** Proveedores: días para pagar */
  paymentDays: number | null;
  /** Clientes: se les factura todo junto a fin de mes */
  monthlyInvoice: boolean;
}

/** Consonantes del nombre de la columna: "Código", "Codigo" y "C�digo" dan "cdg" */
const skeleton = (h: unknown) => String(h ?? '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '').replace(/[aeiou]/g, '');

const FIELDS: Record<string, string[]> = {
  code: ['codigo', 'cod', 'id'],
  first: ['nombre', 'nombres'],
  last: ['apellido', 'apellidos'],
  company: ['razonsocial', 'razon'],
  fantasy: ['nombrefantasia', 'fantasia', 'nombrecomercial', 'comercio'],
  email: ['email', 'mail', 'correo', 'correoelectronico'],
  address: ['domicilio', 'direccion', 'calle'],
  locality: ['localidad', 'ciudad', 'pueblo'],
  mobile: ['telefonocelular', 'celular', 'whatsapp', 'movil'],
  phone: ['telefonofijo', 'telefono', 'tel'],
  contact: ['contacto', 'personadecontacto'],
  iva: ['condicioniva', 'iva', 'condicionfrentealiva', 'situacioniva'],
  idType: ['tipoidentificacion', 'tipodocumento', 'tipodoc'],
  idNumber: ['numero', 'nrodocumento', 'documento', 'numerodocumento', 'nro'],
  cuit: ['cuit', 'cuil'],
  dni: ['dni'],
  priceList: ['listadeprecios', 'listaprecios', 'lista'],
  balance: ['saldo', 'saldoactual', 'deuda', 'saldocuentacorriente'],
  days: ['vencimiento', 'plazo', 'diasdepago', 'plazodepago'],
  notes: ['observacion', 'observaciones', 'notas', 'nota'],
};
const SKELETONS = Object.fromEntries(Object.entries(FIELDS).map(([k, list]) => [k, new Set(list.map(skeleton))]));

const clean = (v: unknown) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().replace(/^"+|"+$/g, '').trim();
  return s && s !== '-' ? s : '';
};
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const num = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  // 1.082.717,93 (argentino) o 1082717.93
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function ivaOf(v: string): string {
  const s = skeleton(v);
  if (s.includes(skeleton('inscripto'))) return 'RESPONSABLE_INSCRIPTO';
  if (s.includes(skeleton('monotribut'))) return 'MONOTRIBUTO';
  if (s.includes(skeleton('exento'))) return 'EXENTO';
  if (s.includes(skeleton('nocategorizado'))) return 'NO_CATEGORIZADO';
  return 'CONSUMIDOR_FINAL';
}

/** Lee la primera hoja con datos y la convierte en renglones de clientes o proveedores. */
export function parseContacts(buffer: Buffer, kind: ContactKind): { rows: ContactRow[]; problems: string[]; columns: string[] } {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });
  const sheet = wb.SheetNames.map((n) => wb.Sheets[n]).find((s) => s && s['!ref']);
  if (!sheet) return { rows: [], problems: ['La planilla está vacía'], columns: [] };
  const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true, blankrows: false });
  // El encabezado es el primer renglón que tiene una columna de nombre
  const headIdx = table.findIndex((r) => (r || []).some((h) => ['first', 'company', 'fantasy'].some((k) => SKELETONS[k].has(skeleton(h)))));
  if (headIdx < 0) return { rows: [], problems: ['No encontré la columna de nombre (Nombre, Razón Social o Nombre Fantasía)'], columns: [] };
  const head = table[headIdx].map((h) => String(h ?? ''));
  const col: Record<string, number> = {};
  head.forEach((h, i) => {
    const s = skeleton(h);
    for (const [k, set] of Object.entries(SKELETONS)) if (set.has(s) && col[k] === undefined) col[k] = i;
  });
  const get = (r: unknown[], k: string) => (col[k] === undefined ? '' : clean(r[col[k]]));

  const body = table.slice(headIdx + 1).map((r, i) => ({ r: r || [], line: headIdx + i + 2 }));
  // Un mail que se repite en muchos renglones es del vendedor que los cargó, no del cliente
  const emailCount = new Map<string, number>();
  for (const { r } of body) { const e = get(r, 'email').toLowerCase(); if (e) emailCount.set(e, (emailCount.get(e) || 0) + 1); }

  const rows: ContactRow[] = [];
  const problems: string[] = [];
  for (const { r, line } of body) {
    const person = [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' ');
    const company = get(r, 'company');
    const fantasy = get(r, 'fantasy');
    const legal = company || person;
    let name: string;
    if (kind === 'clients') name = fantasy && legal && fantasy.toLowerCase() !== legal.toLowerCase() ? `${fantasy} (${legal})` : fantasy || legal;
    else name = fantasy || company || person;
    if (!name) { if (r.some((c) => clean(c))) problems.push(`Renglón ${line}: sin nombre, no se carga`); continue; }

    const idType = skeleton(get(r, 'idType'));
    const idNum = digits(get(r, 'idNumber'));
    let cuit = digits(get(r, 'cuit')) || null;
    let dni = digits(get(r, 'dni')) || null;
    if (idNum) {
      if (idType === skeleton('cuit') || idType === skeleton('cuil') || (!idType && idNum.length === 11)) cuit = cuit || idNum;
      else if (idType === skeleton('dni') || (!idType && idNum.length >= 6 && idNum.length <= 9)) dni = dni || idNum;
    }
    if (cuit && cuit.length !== 11) { problems.push(`Renglón ${line} (${name}): CUIT ${cuit} no tiene 11 números, no se carga el CUIT`); cuit = null; }
    if (dni && (dni.length < 6 || dni.length > 9)) { problems.push(`Renglón ${line} (${name}): DNI ${dni} raro, no se carga el DNI`); dni = null; }

    const email = get(r, 'email').toLowerCase();
    const notes = get(r, 'notes');
    const days = num(get(r, 'days'));
    rows.push({
      line,
      code: get(r, 'code') || null,
      name: name.slice(0, 150),
      contact: kind === 'suppliers' && person && person !== name ? person : get(r, 'contact') || null,
      cuit,
      dni,
      ivaCondition: ivaOf(get(r, 'iva')),
      phone: get(r, 'mobile') || get(r, 'phone') || null,
      email: email && (emailCount.get(email) || 0) <= 2 && /@/.test(email) ? email : null,
      address: get(r, 'address') || null,
      locality: get(r, 'locality') || null,
      priceList: /mayor|gremio|comercio/i.test(get(r, 'priceList')) ? 'TRADE' : 'RETAIL',
      balance: Math.round(num(col.balance === undefined ? 0 : r[col.balance]) * 100) / 100,
      paymentDays: days > 0 && days < 366 ? Math.round(days) : null,
      monthlyInvoice: /una vez al mes|fin de mes|mensual/i.test(notes),
    });
  }

  // El mismo DNI o CUIT dos veces: se carga el primero (en Ventra no pueden repetirse)
  const seen = new Map<string, number>();
  for (const row of rows) {
    for (const key of [row.dni && `dni:${row.dni}`, row.cuit && `cuit:${row.cuit}`].filter(Boolean) as string[]) {
      const first = seen.get(key);
      if (first !== undefined) {
        problems.push(`Renglón ${row.line} (${row.name}): ${key.startsWith('dni') ? 'DNI' : 'CUIT'} repetido con el renglón ${first}, se carga sin ese dato`);
        if (key.startsWith('dni')) row.dni = null; else row.cuit = null;
      } else seen.set(key, row.line);
    }
  }
  return { rows, problems, columns: Object.keys(col) };
}

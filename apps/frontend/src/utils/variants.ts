/**
 * Variantes (talle / color). Cada variante es un producto más: comparten `variantGroupId`
 * y se distinguen por `variantAttrs`. El POS las junta para mostrar el modelo una sola vez.
 */

export type VariantAttrs = Record<string, string>;

export const parseVariantAttrs = (raw?: string | null): VariantAttrs => {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/** "M · NEGRO" — lo que se ve en el botón de cada variante. */
export const variantLabel = (attrs: VariantAttrs): string =>
  Object.values(attrs).map((v) => String(v || '').trim()).filter(Boolean).join(' · ');

/** Los nombres de atributo que usa un modelo, en el orden en que aparecen. Ej. ['talle', 'color'] */
export const variantAxes = (products: any[]): string[] => {
  const axes: string[] = [];
  for (const p of products) {
    for (const key of Object.keys(parseVariantAttrs(p.variantAttrs))) {
      if (!axes.includes(key)) axes.push(key);
    }
  }
  return axes;
};

/** Los valores de un atributo dentro de un modelo, sin repetir. Ej. talle -> ['S','M','L'] */
export const variantValues = (products: any[], axis: string): string[] => {
  const values: string[] = [];
  for (const p of products) {
    const v = parseVariantAttrs(p.variantAttrs)[axis];
    if (v && !values.includes(v)) values.push(v);
  }
  return values;
};

/** Todas las variantes activas de un modelo, ordenadas, sacadas del catálogo. */
export const variantsOfGroup = (catalog: any[], variantGroupId?: string | null): any[] => {
  if (!variantGroupId) return [];
  return catalog
    .filter((p) => p.variantGroupId === variantGroupId)
    .sort((a, b) =>
      variantLabel(parseVariantAttrs(a.variantAttrs)).localeCompare(
        variantLabel(parseVariantAttrs(b.variantAttrs)), 'es', { numeric: true },
      ));
};

export interface VariantGroup {
  _isVariantGroup: true;
  _variants: any[];
}

/**
 * Colapsa las variantes de la lista visible: deja una tarjeta por modelo, con el stock sumado.
 * Los integrantes del grupo se buscan en el catálogo completo (`catalog`), no en la lista
 * recortada, para que no se pierdan talles que quedaron fuera de la ventana de resultados.
 */
export const collapseVariantGroups = (list: any[], catalog: any[] = []): any[] => {
  const membersByGroup = new Map<string, any[]>();
  for (const p of catalog.length ? catalog : list) {
    if (!p?.variantGroupId) continue;
    membersByGroup.set(p.variantGroupId, [...(membersByGroup.get(p.variantGroupId) || []), p]);
  }

  const seen = new Set<string>();
  const out: any[] = [];

  for (const p of list) {
    const groupId = p?.variantGroupId;
    if (!groupId) {
      out.push(p);
      continue;
    }
    if (seen.has(groupId)) continue;
    seen.add(groupId);

    const members = membersByGroup.get(groupId) || [p];
    if (members.length <= 1) {
      out.push(p);
      continue;
    }

    const sorted = [...members].sort((a, b) =>
      variantLabel(parseVariantAttrs(a.variantAttrs)).localeCompare(
        variantLabel(parseVariantAttrs(b.variantAttrs)), 'es', { numeric: true },
      ));

    // La variante que trajo la búsqueda es la que manda para precio y foto
    out.push({
      ...p,
      name: p.baseName || p.name,
      stock: members.reduce((acc, m) => acc + (Number(m.stock) || 0), 0),
      _isVariantGroup: true,
      _variants: sorted,
    });
  }

  return out;
};

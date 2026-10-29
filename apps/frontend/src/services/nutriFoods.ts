/**
 * Tabla de alimentos para armar planes alimentarios: valores de referencia por 100 g de la parte
 * comestible (en crudo salvo que diga cocido), redondeados, con una medida casera habitual.
 * Son aproximados, como los de cualquier tabla: la nutricionista los puede corregir en cada plan
 * y sumar los suyos (se guardan en su consultorio).
 */

export type FoodGroup = 'lacteos' | 'carnes' | 'cereales' | 'legumbres' | 'verduras' | 'frutas' | 'grasas' | 'azucares' | 'bebidas' | 'preparaciones';

export const FOOD_GROUPS: Record<FoodGroup, string> = {
  lacteos: 'Lácteos y huevos',
  carnes: 'Carnes y pescados',
  cereales: 'Cereales, panes y tubérculos',
  legumbres: 'Legumbres y soja',
  verduras: 'Verduras',
  frutas: 'Frutas',
  grasas: 'Aceites, frutos secos y semillas',
  azucares: 'Azúcares y dulces',
  bebidas: 'Bebidas',
  preparaciones: 'Preparaciones',
};

/** Por 100 g: kcal, proteínas, hidratos y grasas (g) */
export interface Per100 { k: number; p: number; c: number; f: number }

export interface Food extends Per100 {
  id: string;
  name: string;
  group: FoodGroup;
  /** Medida casera habitual y cuánto pesa */
  measure: string;
  grams: number;
  /** Cargado por la nutricionista (no viene en la tabla) */
  custom?: boolean;
}

type Row = [id: string, name: string, group: FoodGroup, k: number, p: number, c: number, f: number, measure: string, grams: number];

const ROWS: Row[] = [
  // Lácteos y huevos
  ['leche-entera', 'Leche entera', 'lacteos', 61, 3.2, 4.7, 3.3, '1 taza', 200],
  ['leche-descremada', 'Leche descremada', 'lacteos', 35, 3.4, 5, 0.1, '1 taza', 200],
  ['yogur-entero', 'Yogur entero natural', 'lacteos', 61, 3.5, 4.7, 3.3, '1 pote', 190],
  ['yogur-descremado', 'Yogur descremado', 'lacteos', 40, 4, 5.5, 0.1, '1 pote', 190],
  ['queso-cremoso', 'Queso cremoso', 'lacteos', 300, 20, 2, 24, '1 porción (cajita de fósforos)', 30],
  ['queso-port-light', 'Queso port salut light', 'lacteos', 230, 24, 2, 14, '1 porción', 30],
  ['queso-untable-desc', 'Queso untable descremado', 'lacteos', 120, 12, 4, 6, '1 cucharada', 20],
  ['ricota-desc', 'Ricota descremada', 'lacteos', 100, 11, 4, 4, '1 cucharada', 30],
  ['queso-rallado', 'Queso rallado', 'lacteos', 390, 33, 3, 28, '1 cucharada', 10],
  ['huevo', 'Huevo', 'lacteos', 143, 12.6, 0.7, 9.5, '1 unidad', 50],
  ['clara', 'Clara de huevo', 'lacteos', 52, 11, 0.7, 0.2, '1 clara', 33],

  // Carnes y pescados
  ['carne-magra', 'Carne vacuna magra (nalga, peceto, lomo)', 'carnes', 120, 21, 0, 4, '1 porción', 150],
  ['carne-picada-comun', 'Carne picada común', 'carnes', 250, 17, 0, 20, '1 porción', 150],
  ['carne-picada-especial', 'Carne picada especial', 'carnes', 170, 20, 0, 10, '1 porción', 150],
  ['pollo-pechuga', 'Pollo, pechuga sin piel', 'carnes', 110, 23, 0, 1.5, '1 porción', 150],
  ['pollo-muslo', 'Pollo, muslo sin piel', 'carnes', 120, 20, 0, 4.5, '1 porción', 150],
  ['cerdo-lomo', 'Cerdo, lomo o carré', 'carnes', 140, 21, 0, 6, '1 porción', 150],
  ['merluza', 'Merluza', 'carnes', 80, 17, 0, 1, '1 filet', 150],
  ['salmon', 'Salmón', 'carnes', 200, 20, 0, 13, '1 porción', 150],
  ['atun-natural', 'Atún al natural (escurrido)', 'carnes', 110, 25, 0, 1, '1 lata', 120],
  ['jamon-cocido', 'Jamón cocido', 'carnes', 115, 17, 1, 5, '1 feta', 20],
  ['pavita', 'Pechuga de pavo (fiambre)', 'carnes', 100, 18, 2, 2, '1 feta', 20],

  // Cereales, panes y tubérculos
  ['arroz-blanco', 'Arroz blanco (crudo)', 'cereales', 360, 7, 79, 0.6, '1 porción en crudo', 60],
  ['arroz-integral', 'Arroz integral (crudo)', 'cereales', 350, 7.5, 74, 2.7, '1 porción en crudo', 60],
  ['fideos', 'Fideos secos (crudos)', 'cereales', 360, 12, 73, 1.5, '1 porción en crudo', 80],
  ['fideos-integrales', 'Fideos integrales (crudos)', 'cereales', 350, 13, 68, 2.5, '1 porción en crudo', 80],
  ['avena', 'Avena arrollada', 'cereales', 380, 13, 66, 7, '3 cucharadas', 30],
  ['pan-frances', 'Pan francés', 'cereales', 270, 9, 56, 1, '1 pancito', 50],
  ['pan-integral', 'Pan integral de molde', 'cereales', 250, 11, 43, 3.5, '1 rebanada', 25],
  ['pan-lactal', 'Pan lactal blanco', 'cereales', 265, 8, 49, 3.5, '1 rebanada', 25],
  ['galletitas-agua', 'Galletitas de agua', 'cereales', 420, 10, 70, 11, '3 unidades', 25],
  ['galletas-arroz', 'Galletas de arroz', 'cereales', 380, 8, 80, 3, '1 unidad', 9],
  ['polenta', 'Polenta (harina de maíz, cruda)', 'cereales', 360, 8, 78, 1.5, '1 porción en crudo', 50],
  ['quinoa', 'Quinoa (cruda)', 'cereales', 370, 14, 64, 6, '1 porción en crudo', 50],
  ['copos-maiz', 'Copos de maíz sin azúcar', 'cereales', 375, 7, 84, 1, '1 taza', 30],
  ['granola', 'Granola', 'cereales', 450, 10, 60, 18, '1/4 taza', 30],
  ['papa', 'Papa', 'cereales', 80, 2, 17, 0.1, '1 mediana', 150],
  ['batata', 'Batata', 'cereales', 90, 1.5, 21, 0.1, '1 mediana', 150],
  ['choclo', 'Choclo en granos', 'cereales', 90, 3.3, 19, 1.3, '1/2 taza', 80],

  // Legumbres y soja
  ['lentejas-cocidas', 'Lentejas cocidas', 'legumbres', 116, 9, 20, 0.4, '1/2 taza', 100],
  ['garbanzos-cocidos', 'Garbanzos cocidos', 'legumbres', 164, 9, 27, 2.6, '1/2 taza', 100],
  ['porotos-cocidos', 'Porotos cocidos', 'legumbres', 130, 9, 23, 0.5, '1/2 taza', 100],
  ['lentejas-secas', 'Lentejas secas (crudas)', 'legumbres', 340, 24, 57, 1, '1 porción en crudo', 50],
  ['tofu', 'Tofu', 'legumbres', 80, 8, 2, 4.5, '1 porción', 100],
  ['soja-texturizada', 'Soja texturizada (seca)', 'legumbres', 330, 50, 30, 1, '1 porción en seco', 30],

  // Verduras
  ['lechuga', 'Lechuga', 'verduras', 15, 1.3, 2.9, 0.2, '1 plato', 50],
  ['tomate', 'Tomate', 'verduras', 18, 0.9, 3.9, 0.2, '1 mediano', 120],
  ['zanahoria', 'Zanahoria', 'verduras', 41, 0.9, 10, 0.2, '1 mediana', 80],
  ['zapallo', 'Zapallo', 'verduras', 26, 1, 6.5, 0.1, '1 porción', 150],
  ['zapallito', 'Zapallito', 'verduras', 17, 1.2, 3.1, 0.3, '1 unidad', 150],
  ['berenjena', 'Berenjena', 'verduras', 25, 1, 6, 0.2, '1/2 unidad', 120],
  ['brocoli', 'Brócoli', 'verduras', 34, 2.8, 7, 0.4, '1 taza', 90],
  ['espinaca', 'Espinaca', 'verduras', 23, 2.9, 3.6, 0.4, '1 taza cocida', 150],
  ['acelga', 'Acelga', 'verduras', 19, 1.8, 3.7, 0.2, '1 taza cocida', 150],
  ['cebolla', 'Cebolla', 'verduras', 40, 1.1, 9.3, 0.1, '1/2 unidad', 70],
  ['morron', 'Morrón', 'verduras', 26, 1, 6, 0.3, '1/2 unidad', 80],
  ['pepino', 'Pepino', 'verduras', 15, 0.7, 3.6, 0.1, '1/2 unidad', 100],
  ['remolacha', 'Remolacha', 'verduras', 43, 1.6, 10, 0.2, '1 mediana', 100],
  ['chauchas', 'Chauchas', 'verduras', 31, 1.8, 7, 0.2, '1 taza', 100],
  ['champinones', 'Champiñones', 'verduras', 22, 3.1, 3.3, 0.3, '1 taza', 70],
  ['verduras-mix', 'Verduras variadas (ensalada o salteado)', 'verduras', 25, 1.3, 5, 0.2, '1 plato', 200],

  // Frutas
  ['manzana', 'Manzana', 'frutas', 52, 0.3, 14, 0.2, '1 mediana', 150],
  ['banana', 'Banana', 'frutas', 89, 1.1, 23, 0.3, '1 mediana', 120],
  ['naranja', 'Naranja', 'frutas', 47, 0.9, 12, 0.1, '1 mediana', 180],
  ['mandarina', 'Mandarina', 'frutas', 53, 0.8, 13, 0.3, '1 unidad', 100],
  ['pera', 'Pera', 'frutas', 57, 0.4, 15, 0.1, '1 mediana', 150],
  ['frutillas', 'Frutillas', 'frutas', 32, 0.7, 7.7, 0.3, '1 taza', 150],
  ['durazno', 'Durazno', 'frutas', 39, 0.9, 10, 0.3, '1 mediano', 150],
  ['kiwi', 'Kiwi', 'frutas', 61, 1.1, 15, 0.5, '1 unidad', 75],
  ['uvas', 'Uvas', 'frutas', 69, 0.7, 18, 0.2, '1 taza', 150],
  ['anana', 'Ananá', 'frutas', 50, 0.5, 13, 0.1, '1 rodaja', 100],
  ['sandia', 'Sandía', 'frutas', 30, 0.6, 7.6, 0.2, '1 tajada', 200],
  ['melon', 'Melón', 'frutas', 34, 0.8, 8, 0.2, '1 tajada', 200],
  ['ciruela', 'Ciruela', 'frutas', 46, 0.7, 11, 0.3, '2 unidades', 120],
  ['palta', 'Palta', 'frutas', 160, 2, 9, 15, '1/2 unidad', 75],
  ['pasas', 'Pasas de uva', 'frutas', 300, 3, 79, 0.5, '1 cucharada', 15],

  // Aceites, frutos secos y semillas
  ['aceite', 'Aceite (oliva, girasol, canola)', 'grasas', 884, 0, 0, 100, '1 cucharada', 13],
  ['manteca', 'Manteca', 'grasas', 717, 0.9, 0.1, 81, '1 cucharadita', 5],
  ['mayonesa', 'Mayonesa', 'grasas', 680, 1, 0.6, 75, '1 cucharada', 15],
  ['mayonesa-light', 'Mayonesa light', 'grasas', 300, 1, 7, 30, '1 cucharada', 15],
  ['nueces', 'Nueces', 'grasas', 654, 15, 14, 65, '1 puñado', 30],
  ['almendras', 'Almendras', 'grasas', 579, 21, 22, 50, '1 puñado', 30],
  ['mani', 'Maní sin sal', 'grasas', 567, 26, 16, 49, '1 puñado', 30],
  ['pasta-mani', 'Pasta de maní', 'grasas', 588, 25, 20, 50, '1 cucharada', 15],
  ['chia', 'Semillas de chía', 'grasas', 486, 17, 42, 31, '1 cucharada', 10],
  ['lino', 'Semillas de lino', 'grasas', 534, 18, 29, 42, '1 cucharada', 10],
  ['aceitunas', 'Aceitunas', 'grasas', 145, 1, 4, 15, '10 unidades', 40],

  // Azúcares y dulces
  ['azucar', 'Azúcar', 'azucares', 400, 0, 100, 0, '1 cucharadita', 5],
  ['miel', 'Miel', 'azucares', 304, 0.3, 82, 0, '1 cucharada', 20],
  ['dulce-leche', 'Dulce de leche', 'azucares', 315, 7, 55, 7.5, '1 cucharada', 20],
  ['mermelada', 'Mermelada común', 'azucares', 250, 0.4, 62, 0, '1 cucharada', 20],
  ['mermelada-light', 'Mermelada light', 'azucares', 110, 0.3, 27, 0, '1 cucharada', 20],
  ['chocolate-amargo', 'Chocolate amargo 70%', 'azucares', 600, 8, 46, 43, '1 barrita', 20],
  ['alfajor', 'Alfajor', 'azucares', 450, 5, 63, 20, '1 unidad', 50],
  ['barra-cereal', 'Barra de cereal', 'azucares', 400, 6, 70, 10, '1 unidad', 25],

  // Bebidas
  ['infusion', 'Infusión (café, té, mate) sin azúcar', 'bebidas', 2, 0.1, 0.3, 0, '1 taza', 200],
  ['agua', 'Agua', 'bebidas', 0, 0, 0, 0, '1 vaso', 250],
  ['jugo-naranja', 'Jugo de naranja exprimido', 'bebidas', 45, 0.7, 10, 0.2, '1 vaso', 200],
  ['gaseosa', 'Gaseosa común', 'bebidas', 42, 0, 10.6, 0, '1 vaso', 200],
  ['vino', 'Vino', 'bebidas', 85, 0.1, 2.6, 0, '1 copa', 150],
  ['cerveza', 'Cerveza', 'bebidas', 43, 0.5, 3.6, 0, '1 vaso', 250],
  ['whey', 'Proteína en polvo (suero)', 'bebidas', 380, 75, 10, 5, '1 medida', 30],

  // Preparaciones
  ['milanesa-horno', 'Milanesa de carne al horno', 'preparaciones', 230, 20, 12, 11, '1 unidad', 120],
  ['hamburguesa-casera', 'Hamburguesa casera de carne', 'preparaciones', 230, 17, 0, 18, '1 unidad', 110],
  ['empanada-carne', 'Empanada de carne al horno', 'preparaciones', 270, 10, 28, 13, '1 unidad', 80],
  ['pizza-muzza', 'Pizza de muzzarella', 'preparaciones', 270, 11, 30, 11, '1 porción', 120],
  ['tarta-verdura', 'Tarta de verdura', 'preparaciones', 230, 7, 20, 13, '1 porción', 150],
  ['medialuna', 'Medialuna', 'preparaciones', 400, 7, 45, 21, '1 unidad', 40],
];

export const FOODS: Food[] = ROWS.map(([id, name, group, k, p, c, f, measure, grams]) => ({ id, name, group, k, p, c, f, measure, grams }));

const FOOD_BY_ID = new Map(FOODS.map((f) => [f.id, f]));
export const foodById = (id: string, custom: Food[] = []) => custom.find((f) => f.id === id) || FOOD_BY_ID.get(id);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Busca por palabras sueltas, sin tildes ("pollo pech" encuentra la pechuga). Primero los propios. */
export function searchFoods(q: string, custom: Food[] = [], limit = 12): Food[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const all = [...custom, ...FOODS];
  if (!words.length) return all.slice(0, limit);
  const hits = all.filter((f) => { const n = fold(f.name); return words.every((w) => n.includes(w)); });
  // Los que empiezan con lo buscado, arriba
  return hits.sort((a, b) => Number(!fold(a.name).startsWith(words[0])) - Number(!fold(b.name).startsWith(words[0]))).slice(0, limit);
}

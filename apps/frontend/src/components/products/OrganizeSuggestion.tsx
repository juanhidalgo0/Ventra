import { useEffect, useRef, useState } from 'react';
import { Sparkles, Check } from 'lucide-react';
import api from '../../services/api';
import { PROFILE_LABELS, useBusinessStore } from '../../stores/businessStore';

/**
 * Debajo del nombre, al crear un producto: "Sugerido: Bebidas › Gaseosas · Coca-Cola". Tocar un chip
 * pone esa categoría o marca (y la crea si no existía); si no se toca, no pasa nada.
 * Primero se busca sin IA (backend /ai/organize/suggest); la IA solo si hace falta.
 */

interface CatSug { id: string | null; name: string; parent: string | null; isNew: boolean }
interface BrandSug { id: string | null; name: string; isNew: boolean }

const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export default function OrganizeSuggestion({ name, categoryId, brandId, categories, brands, onCategory, onBrand, reloadCategories, reloadBrands }: {
  name: string;
  categoryId: string;
  brandId: string;
  categories: any[];
  brands: any[];
  onCategory: (id: string) => void;
  onBrand: (id: string) => void;
  reloadCategories: () => Promise<void> | void;
  reloadBrands: () => Promise<void> | void;
}) {
  const profile = useBusinessStore((s) => s.profile);
  const [cat, setCat] = useState<CatSug | null>(null);
  const [brand, setBrand] = useState<BrandSug | null>(null);
  const [busy, setBusy] = useState<'' | 'cat' | 'brand'>('');
  const seq = useRef(0);

  useEffect(() => {
    const q = name.trim();
    if (q.length < 4 || (categoryId && brandId)) { setCat(null); setBrand(null); return; }
    const my = ++seq.current;
    // Que termine de escribir (o de escanear) antes de preguntar
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/ai/organize/suggest', { params: { name: q, rubro: PROFILE_LABELS[profile]?.title || '' }, timeout: 35000, silent: true } as any);
        if (my !== seq.current) return;
        setCat(data?.category || null);
        setBrand(data?.brand || null);
      } catch { /* sin sugerencia: no se muestra nada */ }
    }, 1100);
    return () => clearTimeout(timer);
  }, [name, profile, categoryId, brandId]);

  // Los nombres de categoría no se repiten (ni entre principales y subcategorías)
  const findCat = (n: string) => categories.find((c) => norm(c.name) === norm(n));

  const applyCategory = async () => {
    if (!cat || busy) return;
    if (cat.id) { onCategory(cat.id); return; }
    setBusy('cat');
    try {
      let parentId: string | null = null;
      if (cat.parent) {
        const p = findCat(cat.parent);
        parentId = p ? p.id : (await api.post('/categories', { name: cat.parent })).data.id;
      }
      const existing = findCat(cat.name);
      const id = existing ? existing.id : (await api.post('/categories', { name: cat.name, parentCategoryId: parentId })).data.id;
      await reloadCategories();
      onCategory(id);
    } catch { /* si falla, queda para elegir a mano */ } finally { setBusy(''); }
  };

  const applyBrand = async () => {
    if (!brand || busy) return;
    if (brand.id) { onBrand(brand.id); return; }
    setBusy('brand');
    try {
      const existing = brands.find((b) => norm(b.name) === norm(brand.name));
      const id = existing ? existing.id : (await api.post('/brands', { name: brand.name })).data.id;
      await reloadBrands();
      onBrand(id);
    } catch { /* queda para elegir a mano */ } finally { setBusy(''); }
  };

  const showCat = cat && !categoryId;
  const showBrand = brand && !brandId;
  if (!showCat && !showBrand) return null;
  const chipCls = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-300 bg-white text-[11.5px] font-semibold text-slate-700 hover:border-rose-400 hover:text-rose-700 transition-colors disabled:opacity-50';
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[11.5px] text-slate-500">
      <Sparkles className="w-3.5 h-3.5 text-rose-400" />
      <span>Sugerido:</span>
      {showCat && (
        <button type="button" className={chipCls} onClick={applyCategory} disabled={!!busy} title={cat!.isNew ? 'Categoría nueva: se crea al tocarla' : 'Tocá para ponerla'}>
          {busy === 'cat' ? <Check className="w-3 h-3 animate-pulse" /> : null}
          {cat!.parent ? `${cat!.parent} › ${cat!.name}` : cat!.name}{cat!.isNew ? ' (nueva)' : ''}
        </button>
      )}
      {showCat && showBrand && <span>·</span>}
      {showBrand && (
        <button type="button" className={chipCls} onClick={applyBrand} disabled={!!busy} title={brand!.isNew ? 'Marca nueva: se crea al tocarla' : 'Tocá para ponerla'}>
          {busy === 'brand' ? <Check className="w-3 h-3 animate-pulse" /> : null}
          {brand!.name}{brand!.isNew ? ' (nueva)' : ''}
        </button>
      )}
    </div>
  );
}

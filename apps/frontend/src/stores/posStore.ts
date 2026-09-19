import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { resolveServerUrl } from '../services/api';

export interface CartItem { 
  productId: string;
  cartKey: string;
  name: string; 
  price: number; 
  regularPrice?: number;
  originalSalePrice?: number;
  tradePrice?: number;
  wholesalePrice?: number;
  wholesaleMinQty?: number;
  isCustomPrice?: boolean;
  quantity: number; 
  barcode?: string; 
  maxStock: number; 
  isPromo?: boolean;
  isReturn?: boolean;
  promoId?: string;
  categoryId?: string;
  productsMetadata?: { productId: string; name: string; price: number; quantity: number }[];
  imageUrl?: string;
}

interface POSState {
  cart: CartItem[];
  promotions: any[];
  setPromotions: (promos: any[]) => void;
  addToCart: (product: any, customPrice?: number, quantity?: number, isReturn?: boolean) => void;
  addPromoToCart: (promo: any, productsList?: any[], customSelectedMetadata?: { productId: string; name: string; price: number; quantity: number }[]) => void;
  applySuggestedPromo: (promo: any, productsList?: any[]) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getTotal: () => number;
  getDiscounts: () => number;
  getAppliedPromotions: () => { name: string; discount: number }[];
  getCartItemsWithDiscounts: () => { discountsMap: { [productId: string]: number }; appliedPromosInfo: { id: string; quantitySold: number }[] };
  getCheckoutPayload: () => { productId: string; quantity: number; discount: number; price?: number; categoryId?: string }[];
  getFinalTotal: () => number;
  getItemCount: () => number;

  // Cache System for offline-first and cache warming
  products: any[];
  categories: any[];
  clients: any[];
  selectedClient: any | null;
  setSelectedClient: (client: any | null) => void;
  isWarmed: boolean;
  setProducts: (products: any[]) => void;
  setCategories: (categories: any[]) => void;
  setClients: (clients: any[]) => void;
  setIsWarmed: (isWarmed: boolean) => void;

  heldCarts: { id: string; cart: CartItem[]; createdAt: string; clientName?: string }[];
  holdCart: (clientName?: string) => void;
  resumeCart: (id: string) => void;
  deleteHeldCart: (id: string) => void;

  lastSale: any | null;
  setLastSale: (sale: any) => void;
}

function autoCombineCombos(cart: CartItem[], promotions: any[], productsList: any[] = []): CartItem[] {
  let newCart = [...cart];
  let changed = true;

  const allProds = productsList.length > 0 ? productsList : (usePOSStore.getState()?.products || []);
  const productsMap = new Map<string, any>(allProds.map(p => [p.id, p]));

  while (changed) {
    changed = false;
    // Only look at active FIXED_COMBO promotions
    const fixedCombos = promotions.filter(p => p.type === 'FIXED_COMBO' && p.isActive);

    for (const promo of fixedCombos) {
      if (!promo.products || promo.products.length === 0) continue;

      // Group the promo products by groupId or by index/id for backwards compatibility
      const groupsMap = new Map<string, { groupId: string; quantity: number; productIds: string[] }>();
      promo.products.forEach((pp: any, idx: number) => {
        const gId = pp.groupId || `single_${pp.productId}_${idx}`;
        if (!groupsMap.has(gId)) {
          groupsMap.set(gId, {
            groupId: gId,
            quantity: pp.quantity || 1,
            productIds: []
          });
        }
        groupsMap.get(gId)!.productIds.push(pp.productId);
      });

      const groups = Array.from(groupsMap.values());
      if (groups.length === 0) continue;

      const normalItems = newCart.filter(item => !item.isPromo && !item.isReturn);
      const tempAvailable = new Map<string, number>();
      normalItems.forEach(item => {
        tempAvailable.set(item.productId, (tempAvailable.get(item.productId) || 0) + item.quantity);
      });

      const itemsToDeduct: { productId: string; quantity: number }[] = [];
      let canCombine = true;

      for (const g of groups) {
        let needed = g.quantity;
        const matchedForGroup: { productId: string; quantity: number }[] = [];

        for (const pid of g.productIds) {
          const avail = tempAvailable.get(pid) || 0;
          if (avail > 0) {
            const take = Math.min(avail, needed);
            matchedForGroup.push({ productId: pid, quantity: take });
            tempAvailable.set(pid, avail - take);
            needed -= take;
            if (needed <= 0) break;
          }
        }

        if (needed > 0) {
          canCombine = false;
          break;
        }

        itemsToDeduct.push(...matchedForGroup);
      }

      if (canCombine && itemsToDeduct.length > 0) {
        // Deduct combined items from newCart
        for (const deduction of itemsToDeduct) {
          let toRemove = deduction.quantity;
          newCart = newCart.map(item => {
            if (!item.isPromo && !item.isReturn && item.productId === deduction.productId && toRemove > 0) {
              const reduceBy = Math.min(item.quantity, toRemove);
              toRemove -= reduceBy;
              return { ...item, quantity: item.quantity - reduceBy };
            }
            return item;
          }).filter(item => item.quantity > 0 || item.isReturn);
        }

        // Build metadata for products used in this specific combo instance
        let originalPrice = 0;
        const productsMetadata: { productId: string; name: string; price: number; quantity: number }[] = [];

        itemsToDeduct.forEach((d) => {
          const prod = productsMap.get(d.productId);
          const price = prod ? prod.salePrice : 0;
          const name = prod ? prod.name : 'Producto';
          originalPrice += price * d.quantity;
          productsMetadata.push({
            productId: d.productId,
            name,
            price,
            quantity: d.quantity,
          });
        });

        const promoPrice = promo.fixedPrice ?? originalPrice;
        const comboVariantKey = `PROMO_${promo.id}_` + itemsToDeduct.map(d => `${d.productId}_${d.quantity}`).sort().join('_');

        const existingPromo = newCart.find(i => i.cartKey === comboVariantKey);
        if (existingPromo) {
          newCart = newCart.map(i =>
            i.cartKey === comboVariantKey
              ? {
                  ...i,
                  quantity: i.quantity + 1,
                }
              : i
          );
        } else {
          newCart.push({
            productId: `PROMO_${promo.id}`,
            cartKey: comboVariantKey,
            name: promo.name,
            price: promoPrice,
            quantity: 1,
            maxStock: 999999,
            isPromo: true,
            promoId: promo.id,
            productsMetadata,
          });
        }

        changed = true;
        break;
      }
    }
  }

  return newCart;
}

export const usePOSStore = create<POSState>()(
  persist(
    (set, get) => ({
      cart: [],
      promotions: [],
      products: [],
      categories: [],
      clients: [],
      isWarmed: false,
      heldCarts: [],

      holdCart: (clientName) => {
        const currentCart = get().cart;
        if (currentCart.length === 0) return;
        
        const newHeldCart = {
          id: Math.random().toString(36).substr(2, 9),
          cart: currentCart,
          createdAt: new Date().toISOString(),
          clientName: clientName || `Cliente ${get().heldCarts.length + 1}`
        };
        
        set({
          heldCarts: [newHeldCart, ...get().heldCarts],
          cart: []
        });
      },

      resumeCart: (id) => {
        const target = get().heldCarts.find(h => h.id === id);
        if (!target) return;
        
        const currentCart = get().cart;
        let newHeldCarts = get().heldCarts.filter(h => h.id !== id);
        
        if (currentCart.length > 0) {
          const autoHeld = {
            id: Math.random().toString(36).substr(2, 9),
            cart: currentCart,
            createdAt: new Date().toISOString(),
            clientName: `Sesión Anterior (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
          };
          newHeldCarts = [autoHeld, ...newHeldCarts];
        }
        
        set({
          cart: target.cart,
          heldCarts: newHeldCarts
        });
      },

      deleteHeldCart: (id) => {
        set({
          heldCarts: get().heldCarts.filter(h => h.id !== id)
        });
      },

      setPromotions: (promos) => set({ promotions: promos }),
      // Las fotos del catálogo vienen como ruta del servidor ("/api/product-images/..."):
      // acá se convierten a la dirección completa, para que se vean tanto en la app de
      // escritorio (que sirve la pantalla desde otro origen) como en la web.
      setProducts: (products) => set({
        products: (products || []).map((p: any) => (p && typeof p.imageUrl === 'string' && p.imageUrl.startsWith('/api/')
          ? { ...p, imageUrl: resolveServerUrl(p.imageUrl) }
          : p)),
      }),
      setCategories: (categories) => set({ categories }),
      setClients: (clients) => set({ clients }),
      selectedClient: null,
      setSelectedClient: (client) => {
        set((state) => {
          const isTrade = client?.priceList === 'TRADE';
          const tradeDiscount = Number(client?.tradeDiscountPercentage) || 0;

          const updatedCart = state.cart.map((item) => {
            if (item.isCustomPrice || item.isPromo || item.isReturn) return item;

            const basePrice = item.originalSalePrice ?? item.regularPrice ?? item.price;
            let effectiveRegularPrice = basePrice;

            if (isTrade) {
              if (item.tradePrice && Number(item.tradePrice) > 0) {
                effectiveRegularPrice = Number(item.tradePrice);
              } else if (tradeDiscount > 0) {
                effectiveRegularPrice = Math.round(basePrice * (1 - tradeDiscount / 100) * 100) / 100;
              }
            }

            const effectivePrice = (!item.isCustomPrice && item.wholesalePrice && item.wholesaleMinQty && item.quantity >= item.wholesaleMinQty)
              ? item.wholesalePrice
              : effectiveRegularPrice;

            return {
              ...item,
              regularPrice: effectiveRegularPrice,
              price: effectivePrice,
              originalSalePrice: basePrice
            };
          });

          return { selectedClient: client, cart: updatedCart };
        });
      },
      setIsWarmed: (isWarmed) => set({ isWarmed }),

  addToCart: (product, customPrice?, quantity = 1, isReturn = false) => {
    set((state) => {
      const isCustom = customPrice !== undefined;
      const baseSalePrice = Number(product.salePrice);
      let calculatedRegularPrice = Number(isCustom ? customPrice : product.salePrice);

      const isTrade = !isCustom && state.selectedClient?.priceList === 'TRADE';
      if (isTrade) {
        if (product.tradePrice && Number(product.tradePrice) > 0) {
          calculatedRegularPrice = Number(product.tradePrice);
        } else if (state.selectedClient.tradeDiscountPercentage && Number(state.selectedClient.tradeDiscountPercentage) > 0) {
          calculatedRegularPrice = Math.round(baseSalePrice * (1 - Number(state.selectedClient.tradeDiscountPercentage) / 100) * 100) / 100;
        }
      }

      const regularPrice = Math.round(calculatedRegularPrice * 100) / 100;
      const wholesalePrice = (!isCustom && product.wholesalePrice && Number(product.wholesalePrice) > 0)
        ? Math.round(Number(product.wholesalePrice) * 100) / 100
        : undefined;
      const wholesaleMinQty = (!isCustom && product.wholesaleMinQty && Number(product.wholesaleMinQty) > 0)
        ? Number(product.wholesaleMinQty)
        : undefined;

      const cartKey = isReturn 
        ? `${product.id}_return` 
        : (isCustom ? `${product.id}_custom_${regularPrice}` : `${product.id}_std`);

      const existing = state.cart.find((i) => i.cartKey === cartKey);
      let updatedCart;
      
      const qtyToAdd = isReturn ? -Math.abs(quantity) : quantity;
      
      if (existing) {
        const newQty = parseFloat((existing.quantity + qtyToAdd).toFixed(3));
        const effectivePrice = (!existing.isCustomPrice && existing.wholesalePrice && existing.wholesaleMinQty && newQty >= existing.wholesaleMinQty)
          ? existing.wholesalePrice
          : (existing.regularPrice ?? existing.price);

        updatedCart = state.cart.map((i) => 
          i.cartKey === cartKey 
            ? { ...i, quantity: newQty, price: effectivePrice } 
            : i
        );
      } else {
        const initialQty = parseFloat(Number(qtyToAdd).toFixed(3));
        const effectivePrice = (!isCustom && wholesalePrice && wholesaleMinQty && initialQty >= wholesaleMinQty)
          ? wholesalePrice
          : regularPrice;

        updatedCart = [...state.cart, { 
          cartKey, 
          productId: product.id, 
          name: product.name + (isReturn ? ' (DEVOLUCIÓN)' : ''), 
          price: effectivePrice, 
          regularPrice,
          originalSalePrice: baseSalePrice,
          tradePrice: product.tradePrice ? Number(product.tradePrice) : undefined,
          wholesalePrice,
          wholesaleMinQty,
          isCustomPrice: isCustom,
          quantity: initialQty, 
          barcode: product.barcode, 
          maxStock: product.unlimitedStock ? 999999 : (product.stock ?? 999999), 
          categoryId: product.categoryId,
          isReturn,
          imageUrl: product.imageUrl
        }];
      }
      
      const combinedCart = autoCombineCombos(updatedCart, state.promotions, [product]);
      return { cart: combinedCart };
    });
  },

  addPromoToCart: (promo, productsList = [], customSelectedMetadata) => {
    set((state) => {
      const pList = productsList.length > 0 ? productsList : state.products;
      const productsMap = new Map<string, any>(pList.map(p => [p.id, p]));
      let originalPrice = 0;
      let productsMetadata: { productId: string; name: string; price: number; quantity: number }[] = [];

      if (customSelectedMetadata && customSelectedMetadata.length > 0) {
        productsMetadata = customSelectedMetadata;
        originalPrice = customSelectedMetadata.reduce((sum, item) => sum + item.price * item.quantity, 0);
      } else if (promo.type === 'FIXED_COMBO') {
        const groupMap = new Map<string, any[]>();
        promo.products.forEach((pp: any, idx: number) => {
          const gId = pp.groupId || `single_${pp.productId}_${idx}`;
          if (!groupMap.has(gId)) groupMap.set(gId, []);
          groupMap.get(gId)!.push(pp);
        });

        groupMap.forEach((gItems) => {
          // Select only the first/primary option of each group
          const primary = gItems[0];
          const prod = primary.product || productsMap.get(primary.productId);
          const price = prod ? prod.salePrice : 0;
          const name = prod ? prod.name : 'Producto';
          originalPrice += price * primary.quantity;
          productsMetadata.push({
            productId: primary.productId,
            name,
            price,
            quantity: primary.quantity,
          });
        });
      } else {
        promo.products.forEach((pp: any) => {
          const prod = pp.product || productsMap.get(pp.productId);
          const price = prod ? prod.salePrice : 0;
          const name = prod ? prod.name : 'Producto';
          originalPrice += price * pp.quantity;
          productsMetadata.push({
            productId: pp.productId,
            name,
            price,
            quantity: pp.quantity,
          });
        });
      }

      let promoPrice = originalPrice;
      if (promo.type === 'FIXED_COMBO') {
        promoPrice = promo.fixedPrice ?? originalPrice;
      } else if (promo.type === 'DISCOUNT_PERCENT') {
        promoPrice = originalPrice * (1 - (promo.discountPercentage || 0) / 100);
      } else if (promo.type === 'NX_M') {
        const factor = promo.nValue ? (promo.mValue || 0) / promo.nValue : 1;
        promoPrice = originalPrice * factor;
      }

      let calculatedMaxStock = 999999;
      if (promo.type === 'FIXED_COMBO') {
        const groupMap = new Map<string, any[]>();
        promo.products.forEach((pp: any, idx: number) => {
          const gId = pp.groupId || `single_${pp.productId}_${idx}`;
          if (!groupMap.has(gId)) groupMap.set(gId, []);
          groupMap.get(gId)!.push(pp);
        });
        const groupLimits = Array.from(groupMap.values()).map(gItems => {
          const totalGroupStock = gItems.reduce((acc, pp) => {
            const prod = pp.product || productsMap.get(pp.productId);
            return acc + (prod ? (prod.stock ?? 0) : 0);
          }, 0);
          const reqQty = gItems[0].quantity || 1;
          return Math.floor(totalGroupStock / reqQty);
        });
        calculatedMaxStock = groupLimits.length > 0 ? Math.min(...groupLimits) : 999999;
      } else {
        const stockLimits = promo.products.map((pp: any) => {
          const prod = pp.product || productsMap.get(pp.productId);
          const prodStock = prod ? (prod.stock ?? 0) : 0;
          return Math.floor(prodStock / pp.quantity);
        });
        calculatedMaxStock = stockLimits.length > 0 ? Math.min(...stockLimits) : 999999;
      }
      const maxStock = calculatedMaxStock > 0 ? calculatedMaxStock : 999999;

      const comboVariantKey = `PROMO_${promo.id}_` + productsMetadata.map(d => `${d.productId}_${d.quantity}`).sort().join('_');

      const existing = state.cart.find((i) => i.cartKey === comboVariantKey);
      if (existing) {
        return {
          cart: state.cart.map((i) =>
            i.cartKey === comboVariantKey ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }

      const newPromoItem: CartItem = {
        productId: `PROMO_${promo.id}`,
        cartKey: comboVariantKey,
        name: promo.name,
        price: promoPrice,
        quantity: 1,
        maxStock,
        isPromo: true,
        promoId: promo.id,
        productsMetadata,
      };

      return { cart: [...state.cart, newPromoItem] };
    });
  },

  applySuggestedPromo: (promo, productsList = []) => {
    set((state) => {
      let newCart = [...state.cart];
      const pList = productsList.length > 0 ? productsList : state.products;
      const productsMap = new Map<string, any>(pList.map(p => [p.id, p]));

      // 1. Group promo products to identify items to remove from cart
      const groupsMap = new Map<string, { groupId: string; quantity: number; productIds: string[] }>();
      promo.products.forEach((pp: any, idx: number) => {
        const gId = pp.groupId || `single_${pp.productId}_${idx}`;
        if (!groupsMap.has(gId)) {
          groupsMap.set(gId, {
            groupId: gId,
            quantity: pp.quantity || 1,
            productIds: []
          });
        }
        groupsMap.get(gId)!.productIds.push(pp.productId);
      });

      const groups = Array.from(groupsMap.values());
      const itemsToDeduct: { productId: string; quantity: number }[] = [];

      for (const g of groups) {
        let needed = g.quantity;
        for (const pid of g.productIds) {
          const inCartItem = newCart.find(i => !i.isPromo && !i.isReturn && i.productId === pid);
          if (inCartItem && inCartItem.quantity > 0) {
            const take = Math.min(inCartItem.quantity, needed);
            itemsToDeduct.push({ productId: pid, quantity: take });
            needed -= take;
            if (needed <= 0) break;
          }
        }
      }

      // Deduct matched items
      for (const deduction of itemsToDeduct) {
        let toRemove = deduction.quantity;
        newCart = newCart.map(item => {
          if (!item.isPromo && !item.isReturn && item.productId === deduction.productId && toRemove > 0) {
            const reduceBy = Math.min(item.quantity, toRemove);
            toRemove -= reduceBy;
            return { ...item, quantity: item.quantity - reduceBy };
          }
          return item;
        }).filter(item => item.quantity > 0 || item.isReturn);
      }

      // 2. Build metadata for combo
      let originalPrice = 0;
      const productsMetadata: { productId: string; name: string; price: number; quantity: number }[] = [];

      if (itemsToDeduct.length > 0) {
        itemsToDeduct.forEach((d) => {
          const prod = productsMap.get(d.productId);
          const price = prod ? prod.salePrice : 0;
          const name = prod ? prod.name : 'Producto';
          originalPrice += price * d.quantity;
          productsMetadata.push({
            productId: d.productId,
            name,
            price,
            quantity: d.quantity,
          });
        });
      } else {
        // Fallback: take first item per group
        groups.forEach((g) => {
          const firstPid = g.productIds[0];
          const prod = productsMap.get(firstPid);
          const price = prod ? prod.salePrice : 0;
          const name = prod ? prod.name : 'Producto';
          originalPrice += price * g.quantity;
          productsMetadata.push({
            productId: firstPid,
            name,
            price,
            quantity: g.quantity,
          });
        });
      }

      const promoPrice = promo.fixedPrice ?? originalPrice;
      const comboVariantKey = `PROMO_${promo.id}_` + productsMetadata.map(d => `${d.productId}_${d.quantity}`).sort().join('_');

      const existingPromo = newCart.find(i => i.cartKey === comboVariantKey);
      if (existingPromo) {
        newCart = newCart.map(i =>
          i.cartKey === comboVariantKey ? { ...i, quantity: i.quantity + 1 } : i
        );
      } else {
        newCart.push({
          productId: `PROMO_${promo.id}`,
          cartKey: comboVariantKey,
          name: promo.name,
          price: promoPrice,
          quantity: 1,
          maxStock: 999999,
          isPromo: true,
          promoId: promo.id,
          productsMetadata,
        });
      }

      return { cart: newCart };
    });
  },

  removeFromCart: (cartKey) => set((state) => ({ cart: state.cart.filter((i) => i.cartKey !== cartKey) })),

  updateQuantity: (cartKey, quantity) => set((state) => {
    const roundedQty = parseFloat(Number(quantity).toFixed(3));
    const updatedCart = state.cart.map((i) => {
      if (i.cartKey !== cartKey) return i;
      const effectivePrice = (!i.isCustomPrice && i.wholesalePrice && i.wholesaleMinQty && roundedQty >= i.wholesaleMinQty)
        ? i.wholesalePrice
        : (i.regularPrice ?? i.price);
      return { ...i, quantity: Math.max(0, roundedQty), price: effectivePrice };
    }).filter((i) => i.quantity > 0);
    const combinedCart = autoCombineCombos(updatedCart, state.promotions, []);
    return { cart: combinedCart };
  }),

  clearCart: () => set({ cart: [] }),
  
  getTotal: () => {
    const total = get().cart.reduce((sum, item) => {
      if (item.isPromo && item.productsMetadata) {
        const originalPrice = item.productsMetadata.reduce((s, p) => s + p.price * p.quantity, 0);
        return sum + Math.max(originalPrice, item.price) * item.quantity;
      }
      return sum + item.price * item.quantity;
    }, 0);
    return Math.round(total * 100) / 100;
  },

  getCartItemsWithDiscounts: () => {
    const { cart, promotions } = get();
    const discountsMap: { [productId: string]: number } = {};
    const appliedPromosInfo: { id: string; quantitySold: number }[] = [];

    const isPromoActive = (promo: any) => {
      if (!promo.isActive) return false;
      if (promo.limitType === 'DATE' && promo.endDate) {
        if (new Date() > new Date(promo.endDate)) return false;
      }
      if (promo.limitType === 'STOCK' && promo.limitStock !== null && promo.limitStock !== undefined) {
        if (promo.soldStock >= promo.limitStock) return false;
      }
      return true;
    };

    const normalCart = cart.filter(item => !item.isPromo);

    // 1. NX_M Promotions
    promotions.filter(p => p.type === 'NX_M' && isPromoActive(p)).forEach(promo => {
      const promoProductIds = promo.products.map((pp: any) => pp.productId);
      const cartItemsInPromo = normalCart.filter(item => promoProductIds.includes(item.productId));
      
      if (cartItemsInPromo.length > 0) {
        cartItemsInPromo.forEach(item => {
          const timesApplied = Math.floor(item.quantity / promo.nValue);
          let unitsForPromo = timesApplied * promo.nValue;
          
          if (promo.limitType === 'STOCK' && promo.limitStock !== null && promo.limitStock !== undefined) {
            const remainingPromoStock = Math.max(0, promo.limitStock - promo.soldStock);
            if (unitsForPromo > remainingPromoStock) {
              const maxTimes = Math.floor(remainingPromoStock / promo.nValue);
              unitsForPromo = maxTimes * promo.nValue;
            }
          }

          if (unitsForPromo > 0) {
            const freeUnits = (unitsForPromo / promo.nValue) * (promo.nValue - promo.mValue);
            const promoDiscount = freeUnits * item.price;
            discountsMap[item.productId] = (discountsMap[item.productId] || 0) + promoDiscount;
            appliedPromosInfo.push({
              id: promo.id,
              quantitySold: unitsForPromo
            });
          }
        });
      }
    });

    // 2. FIXED_COMBO Promotions
    promotions.filter(p => p.type === 'FIXED_COMBO' && isPromoActive(p)).forEach(promo => {
      let maxCombos = Infinity;
      let originalComboPrice = 0;
      
      promo.products.forEach((pp: any) => {
        const itemInCart = normalCart.find(i => i.productId === pp.productId);
        if (!itemInCart || itemInCart.quantity < pp.quantity) {
          maxCombos = 0;
        } else {
          maxCombos = Math.min(maxCombos, Math.floor(itemInCart.quantity / pp.quantity));
          originalComboPrice += itemInCart.price * pp.quantity;
        }
      });

      if (maxCombos > 0 && maxCombos !== Infinity) {
        if (promo.limitType === 'STOCK' && promo.limitStock !== null && promo.limitStock !== undefined) {
          const remainingPromoStock = Math.max(0, promo.limitStock - promo.soldStock);
          const itemsPerCombo = promo.products.reduce((acc: number, pp: any) => acc + pp.quantity, 0);
          const maxCombosAllowed = Math.floor(remainingPromoStock / itemsPerCombo);
          maxCombos = Math.min(maxCombos, maxCombosAllowed);
        }

        if (maxCombos > 0) {
          const discountPerCombo = originalComboPrice - (promo.fixedPrice || 0);
          const totalPromoDiscount = discountPerCombo * maxCombos;
          
          promo.products.forEach((pp: any) => {
            const itemInCart = normalCart.find(i => i.productId === pp.productId);
            if (itemInCart) {
              const itemOriginalPrice = itemInCart.price * pp.quantity * maxCombos;
              const proportion = itemOriginalPrice / (originalComboPrice * maxCombos);
              const itemShare = totalPromoDiscount * proportion;
              discountsMap[pp.productId] = (discountsMap[pp.productId] || 0) + itemShare;
            }
          });

          const totalItemsSoldInCombo = maxCombos * promo.products.reduce((acc: number, pp: any) => acc + pp.quantity, 0);
          appliedPromosInfo.push({
            id: promo.id,
            quantitySold: totalItemsSoldInCombo
          });
        }
      }
    });

    // 3. DISCOUNT_PERCENT Promotions (Oferta %)
    promotions.filter(p => p.type === 'DISCOUNT_PERCENT' && isPromoActive(p)).forEach(promo => {
      const promoProductIds = promo.products.map((pp: any) => pp.productId);
      const cartItemsInPromo = normalCart.filter(item => promoProductIds.includes(item.productId));

      cartItemsInPromo.forEach(item => {
        let quantityToDiscount = item.quantity;

        if (promo.limitType === 'STOCK' && promo.limitStock !== null && promo.limitStock !== undefined) {
          const remainingPromoStock = Math.max(0, promo.limitStock - promo.soldStock);
          quantityToDiscount = Math.min(quantityToDiscount, remainingPromoStock);
        }

        if (quantityToDiscount > 0) {
          const promoDiscount = item.price * (promo.discountPercentage / 100) * quantityToDiscount;
          discountsMap[item.productId] = (discountsMap[item.productId] || 0) + promoDiscount;
          appliedPromosInfo.push({
            id: promo.id,
            quantitySold: quantityToDiscount
          });
        }
      });
    });

    // 4. Manual / Merged promo items from cart
    const promoCart = cart.filter(item => item.isPromo);
    promoCart.forEach((item) => {
      if (item.promoId) {
        const promo = promotions.find(p => p.id === item.promoId);
        if (promo) {
          const itemsPerCombo = promo.products.reduce((acc: number, pp: any) => acc + pp.quantity, 0);
          appliedPromosInfo.push({
            id: promo.id,
            quantitySold: item.quantity * itemsPerCombo
          });
        }
      }
    });

    return { discountsMap, appliedPromosInfo };
  },

  getAppliedPromotions: () => {
    const { cart, promotions, getCartItemsWithDiscounts } = get();
    const { discountsMap } = getCartItemsWithDiscounts();
    const applied: { name: string; discount: number }[] = [];

    const isPromoActive = (promo: any) => {
      if (!promo.isActive) return false;
      if (promo.limitType === 'DATE' && promo.endDate) {
        if (new Date() > new Date(promo.endDate)) return false;
      }
      if (promo.limitType === 'STOCK' && promo.limitStock !== null && promo.limitStock !== undefined) {
        if (promo.soldStock >= promo.limitStock) return false;
      }
      return true;
    };

    const normalCart = cart.filter(item => !item.isPromo);

    promotions.filter(isPromoActive).forEach(promo => {
      let promoDiscount = 0;
      
      if (promo.type === 'NX_M') {
        const promoProductIds = promo.products.map((pp: any) => pp.productId);
        const cartItemsInPromo = normalCart.filter(item => promoProductIds.includes(item.productId));
        cartItemsInPromo.forEach(item => {
          const timesApplied = Math.floor(item.quantity / promo.nValue);
          let unitsForPromo = timesApplied * promo.nValue;
          if (promo.limitType === 'STOCK' && promo.limitStock !== null && promo.limitStock !== undefined) {
            const remainingPromoStock = Math.max(0, promo.limitStock - promo.soldStock);
            if (unitsForPromo > remainingPromoStock) {
              const maxTimes = Math.floor(remainingPromoStock / promo.nValue);
              unitsForPromo = maxTimes * promo.nValue;
            }
          }
          if (unitsForPromo > 0) {
            const freeUnits = (unitsForPromo / promo.nValue) * (promo.nValue - promo.mValue);
            promoDiscount += freeUnits * item.price;
          }
        });
      } else if (promo.type === 'FIXED_COMBO') {
        let maxCombos = Infinity;
        let originalComboPrice = 0;
        promo.products.forEach((pp: any) => {
          const itemInCart = normalCart.find(i => i.productId === pp.productId);
          if (!itemInCart || itemInCart.quantity < pp.quantity) {
            maxCombos = 0;
          } else {
            maxCombos = Math.min(maxCombos, Math.floor(itemInCart.quantity / pp.quantity));
            originalComboPrice += itemInCart.price * pp.quantity;
          }
        });
        if (maxCombos > 0 && maxCombos !== Infinity) {
          if (promo.limitType === 'STOCK' && promo.limitStock !== null && promo.limitStock !== undefined) {
            const remainingPromoStock = Math.max(0, promo.limitStock - promo.soldStock);
            const itemsPerCombo = promo.products.reduce((acc: number, pp: any) => acc + pp.quantity, 0);
            const maxCombosAllowed = Math.floor(remainingPromoStock / itemsPerCombo);
            maxCombos = Math.min(maxCombos, maxCombosAllowed);
          }
          if (maxCombos > 0) {
            const discountPerCombo = originalComboPrice - (promo.fixedPrice || 0);
            promoDiscount = discountPerCombo * maxCombos;
          }
        }
      } else if (promo.type === 'DISCOUNT_PERCENT') {
        const promoProductIds = promo.products.map((pp: any) => pp.productId);
        const cartItemsInPromo = normalCart.filter(item => promoProductIds.includes(item.productId));
        cartItemsInPromo.forEach(item => {
          let quantityToDiscount = item.quantity;
          if (promo.limitType === 'STOCK' && promo.limitStock !== null && promo.limitStock !== undefined) {
            const remainingPromoStock = Math.max(0, promo.limitStock - promo.soldStock);
            quantityToDiscount = Math.min(quantityToDiscount, remainingPromoStock);
          }
          if (quantityToDiscount > 0) {
            promoDiscount += item.price * (promo.discountPercentage / 100) * quantityToDiscount;
          }
        });
      }

      if (promoDiscount > 0) {
        applied.push({ name: promo.name || `${promo.nValue}x${promo.mValue}`, discount: promoDiscount });
      }
    });

    // 2. Add merged promo items as applied promotions
    cart.filter(item => item.isPromo).forEach(item => {
      if (item.productsMetadata) {
        const originalPrice = item.productsMetadata.reduce((s, p) => s + p.price * p.quantity, 0);
        const promoDiscount = (originalPrice - item.price) * item.quantity;
        if (promoDiscount > 0) {
          applied.push({ name: item.name, discount: promoDiscount });
        }
      }
    });

    return applied;
  },

  getCheckoutPayload: () => {
    const { cart, getCartItemsWithDiscounts } = get();
    const { discountsMap } = getCartItemsWithDiscounts();
    const exploded: { productId: string; quantity: number; discount: number; price?: number; categoryId?: string }[] = [];

    const addExplodedItem = (productId: string, qty: number, disc: number, price?: number, categoryId?: string) => {
      const existing = exploded.find(item => item.productId === productId && item.price === price);
      if (existing) {
        existing.quantity += qty;
        existing.discount += disc;
      } else {
        exploded.push({ productId, quantity: qty, discount: disc, price, categoryId });
      }
    };

    cart.forEach(item => {
      if (item.isPromo && item.productsMetadata) {
        const originalPrice = item.productsMetadata.reduce((s, p) => s + p.price * p.quantity, 0);
        const totalDiscount = (originalPrice - item.price) * item.quantity;

        item.productsMetadata.forEach(pp => {
          const itemOriginalSubtotal = pp.price * pp.quantity * item.quantity;
          const proportion = originalPrice > 0 ? (itemOriginalSubtotal / (originalPrice * item.quantity)) : 0;
          const itemShareDiscount = totalDiscount * proportion;

          addExplodedItem(pp.productId, pp.quantity * item.quantity, itemShareDiscount, pp.price);
        });
      } else {
        addExplodedItem(item.productId, item.quantity, discountsMap[item.productId] || 0, item.price, item.categoryId);
      }
    });

    return exploded;
  },

  getDiscounts: () => get().getAppliedPromotions().reduce((sum, p) => sum + p.discount, 0),

  getFinalTotal: () => Math.round((get().getTotal() - get().getDiscounts()) * 100) / 100,

  getItemCount: () => get().cart.reduce((sum, item) => sum + item.quantity, 0),

  lastSale: null,
  setLastSale: (sale: any) => set({ lastSale: sale }),
    }),
    {
      name: 'paulos-pos-cache',
      partialize: (state) => ({
        // We persist categories and heldCarts (tickets en espera)
        // Products and clients are loaded from SQLite to avoid localStorage 5MB quota
        categories: state.categories,
        heldCarts: state.heldCarts,
        lastSale: state.lastSale,
      }),
    }
  )
);


import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartItem { 
  productId: string;
  cartKey: string;
  name: string; 
  price: number; 
  quantity: number; 
  barcode?: string; 
  maxStock: number; 
  isPromo?: boolean;
  promoId?: string;
  productsMetadata?: { productId: string; name: string; price: number; quantity: number }[];
}

interface POSState {
  cart: CartItem[];
  promotions: any[];
  setPromotions: (promos: any[]) => void;
  addToCart: (product: any, customPrice?: number) => void;
  addPromoToCart: (promo: any, productsList?: any[]) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getTotal: () => number;
  getDiscounts: () => number;
  getAppliedPromotions: () => { name: string; discount: number }[];
  getCartItemsWithDiscounts: () => { discountsMap: { [productId: string]: number }; appliedPromosInfo: { id: string; quantitySold: number }[] };
  getCheckoutPayload: () => { productId: string; quantity: number; discount: number; price?: number }[];
  getFinalTotal: () => number;
  getItemCount: () => number;

  // Cache System for offline-first and cache warming
  products: any[];
  categories: any[];
  clients: any[];
  isWarmed: boolean;
  setProducts: (products: any[]) => void;
  setCategories: (categories: any[]) => void;
  setClients: (clients: any[]) => void;
  setIsWarmed: (isWarmed: boolean) => void;
}

function autoCombineCombos(cart: CartItem[], promotions: any[], productsList: any[] = []): CartItem[] {
  let newCart = [...cart];
  let changed = true;

  while (changed) {
    changed = false;
    // Only look at active FIXED_COMBO promotions
    const fixedCombos = promotions.filter(p => p.type === 'FIXED_COMBO' && p.isActive);

    for (const promo of fixedCombos) {
      // Check if all products of the combo are in the cart (non-promo items)
      let canCombine = true;
      const normalItems = newCart.filter(item => !item.isPromo);

      for (const pp of promo.products) {
        const item = normalItems.find(i => i.productId === pp.productId);
        if (!item || item.quantity < pp.quantity) {
          canCombine = false;
          break;
        }
      }

      if (canCombine) {
        // We can combine! Let's subtract the individual products from the cart
        promo.products.forEach((pp: any) => {
          newCart = newCart.map(item => {
            if (!item.isPromo && item.productId === pp.productId) {
              return { ...item, quantity: item.quantity - pp.quantity };
            }
            return item;
          }).filter(item => item.quantity > 0);
        });

        // Add the combo to the cart
        const existingPromo = newCart.find(i => i.productId === `PROMO_${promo.id}`);
        if (existingPromo) {
          newCart = newCart.map(i =>
            i.productId === `PROMO_${promo.id}` ? { ...i, quantity: i.quantity + 1 } : i
          );
        } else {
          // Calculate metadata and price for the new promo item
          let originalPrice = 0;
          const productsMetadata: { productId: string; name: string; price: number; quantity: number }[] = [];

          promo.products.forEach((pp: any) => {
            const prod = pp.product || productsList.find((p: any) => p.id === pp.productId);
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

          const promoPrice = promo.fixedPrice ?? originalPrice;
          
          const stockLimits = promo.products.map((pp: any) => {
            const prod = pp.product || productsList.find((p: any) => p.id === pp.productId);
            const prodStock = prod ? (prod.stock ?? 0) : 0;
            return Math.floor(prodStock / pp.quantity);
          });
          const calculatedMaxStock = stockLimits.length > 0 ? Math.min(...stockLimits) : 999999;
          const maxStock = calculatedMaxStock > 0 ? calculatedMaxStock : 999999;

          newCart.push({
            productId: `PROMO_${promo.id}`,
            cartKey: `PROMO_${promo.id}`,
            name: promo.name,
            price: promoPrice,
            quantity: 1,
            maxStock,
            isPromo: true,
            promoId: promo.id,
            productsMetadata,
          });
        }

        changed = true;
        break; // Break the inner loop to restart with the modified cart
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

      setPromotions: (promos) => set({ promotions: promos }),
      setProducts: (products) => set({ products }),
      setCategories: (categories) => set({ categories }),
      setClients: (clients) => set({ clients }),
      setIsWarmed: (isWarmed) => set({ isWarmed }),

  addToCart: (product, customPrice?) => {
    set((state) => {
      const priceToUse = customPrice !== undefined ? customPrice : product.salePrice;
      const cartKey = `${product.id}_${priceToUse}`;
      const existing = state.cart.find((i) => i.cartKey === cartKey);
      let updatedCart;
      if (existing) {
        updatedCart = state.cart.map((i) => i.cartKey === cartKey ? { ...i, quantity: i.quantity + 1 } : i);
      } else {
        updatedCart = [...state.cart, { cartKey, productId: product.id, name: product.name, price: priceToUse, quantity: 1, barcode: product.barcode, maxStock: product.unlimitedStock ? 999999 : (product.stock ?? 999999) }];
      }
      
      const combinedCart = autoCombineCombos(updatedCart, state.promotions, [product]);
      return { cart: combinedCart };
    });
  },

  addPromoToCart: (promo, productsList = []) => {
    set((state) => {
      const existing = state.cart.find((i) => i.productId === `PROMO_${promo.id}`);
      if (existing) {
        return {
          cart: state.cart.map((i) =>
            i.productId === `PROMO_${promo.id}` ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }

      let originalPrice = 0;
      const productsMetadata: { productId: string; name: string; price: number; quantity: number }[] = [];

      promo.products.forEach((pp: any) => {
        const prod = pp.product || productsList.find((p: any) => p.id === pp.productId);
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

      let promoPrice = originalPrice;
      if (promo.type === 'FIXED_COMBO') {
        promoPrice = promo.fixedPrice ?? originalPrice;
      } else if (promo.type === 'DISCOUNT_PERCENT') {
        promoPrice = originalPrice * (1 - (promo.discountPercentage || 0) / 100);
      } else if (promo.type === 'NX_M') {
        const factor = promo.nValue ? (promo.mValue || 0) / promo.nValue : 1;
        promoPrice = originalPrice * factor;
      }

      const stockLimits = promo.products.map((pp: any) => {
        const prod = pp.product || productsList.find((p: any) => p.id === pp.productId);
        const prodStock = prod ? (prod.stock ?? 0) : 0;
        return Math.floor(prodStock / pp.quantity);
      });
      const calculatedMaxStock = stockLimits.length > 0 ? Math.min(...stockLimits) : 999999;
      const maxStock = calculatedMaxStock > 0 ? calculatedMaxStock : 999999;

      const newPromoItem: CartItem = {
        productId: `PROMO_${promo.id}`,
        cartKey: `PROMO_${promo.id}`,
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

  removeFromCart: (cartKey) => set((state) => ({ cart: state.cart.filter((i) => i.cartKey !== cartKey) })),

  updateQuantity: (cartKey, quantity) => set((state) => {
    const updatedCart = state.cart.map((i) => i.cartKey === cartKey ? { ...i, quantity: Math.max(0, quantity) } : i).filter((i) => i.quantity > 0);
    const combinedCart = autoCombineCombos(updatedCart, state.promotions, []);
    return { cart: combinedCart };
  }),

  clearCart: () => set({ cart: [] }),
  
  getTotal: () => {
    return get().cart.reduce((sum, item) => {
      if (item.isPromo && item.productsMetadata) {
        const originalPrice = item.productsMetadata.reduce((s, p) => s + p.price * p.quantity, 0);
        return sum + originalPrice * item.quantity;
      }
      return sum + item.price * item.quantity;
    }, 0);
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
    const exploded: { productId: string; quantity: number; discount: number; price?: number }[] = [];

    const addExplodedItem = (productId: string, qty: number, disc: number, price?: number) => {
      const existing = exploded.find(item => item.productId === productId && item.price === price);
      if (existing) {
        existing.quantity += qty;
        existing.discount += disc;
      } else {
        exploded.push({ productId, quantity: qty, discount: disc, price });
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
        addExplodedItem(item.productId, item.quantity, discountsMap[item.productId] || 0, item.price);
      }
    });

    return exploded;
  },

  getDiscounts: () => get().getAppliedPromotions().reduce((sum, p) => sum + p.discount, 0),

  getFinalTotal: () => get().getTotal() - get().getDiscounts(),
  
      getItemCount: () => get().cart.reduce((sum, item) => sum + item.quantity, 0),
    }),
    {
      name: 'paulos-pos-cache',
      partialize: (state) => ({
        // We no longer persist 'products' and 'clients' to localStorage
        // because large catalogs easily exceed the browser's 5MB quota.
        // The local SQLite backend is fast enough to serve them on boot.
        categories: state.categories,
      }),
    }
  )
);


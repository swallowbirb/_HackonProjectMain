import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

/**
 * Client-side cart with localStorage persistence.
 * No backend cart model — the cart lives in the browser.
 *
 * Shape: cart = [{ productId, quantity, sizeSelected?, title?, price?, image? }]
 *
 * The extra fields (title, price, image) are stored when available so the cart
 * page can render without fetching each product individually.
 */

const STORAGE_KEY = 'marketplace_cart';

function loadCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  } catch { /* quota exceeded — silently ignore */ }
}

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cart, setCart] = useState(loadCart);

  // Persist to localStorage on every change
  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  const addToCart = useCallback((productId, qty = 1, meta = {}) => {
    setCart((prev) => {
      const existing = prev.find(
        (i) => i.productId === productId && i.sizeSelected === (meta.sizeSelected || null)
      );
      if (existing) {
        return prev.map((i) =>
          i.productId === productId && i.sizeSelected === (meta.sizeSelected || null)
            ? { ...i, quantity: i.quantity + qty, ...meta }
            : i
        );
      }
      return [...prev, { productId, quantity: qty, sizeSelected: null, ...meta }];
    });
  }, []);

  const removeFromCart = useCallback((productId, sizeSelected = null) => {
    setCart((prev) =>
      prev.filter(
        (i) => !(i.productId === productId && i.sizeSelected === sizeSelected)
      )
    );
  }, []);

  const setQuantity = useCallback((productId, quantity, sizeSelected = null) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.productId === productId && i.sizeSelected === sizeSelected
            ? { ...i, quantity: Math.max(0, quantity) }
            : i
        )
        .filter((i) => i.quantity > 0)
    );
  }, []);

  const keepOneOf = useCallback((productId) => {
    setCart((prev) => {
      const matching = prev.filter((i) => i.productId === productId);
      if (matching.length === 0) return prev;
      const others = prev.filter((i) => i.productId !== productId);
      return [...others, { ...matching[0], quantity: 1 }];
    });
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const value = useMemo(
    () => ({
      cart,
      cartCount,
      addToCart,
      removeFromCart,
      setQuantity,
      keepOneOf,
      clearCart,
    }),
    [cart, cartCount, addToCart, removeFromCart, setQuantity, keepOneOf, clearCart]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    return {
      cart: [],
      cartCount: 0,
      addToCart: () => {},
      removeFromCart: () => {},
      setQuantity: () => {},
      keepOneOf: () => {},
      clearCart: () => {},
    };
  }
  return ctx;
}

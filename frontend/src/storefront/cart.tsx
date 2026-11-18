import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type CartItem = {
  type: "photo" | "album";
  id: string;
  title: string;
  priceCents: number;
  thumbUrl: string | null;
  /** For photos: the album they belong to, used to avoid charging twice. */
  albumId: string | null;
};

type CartValue = {
  items: CartItem[];
  add: (item: CartItem) => void;
  remove: (id: string) => void;
  removeMany: (ids: string[]) => void;
  clear: () => void;
  has: (id: string) => boolean;
  /** Photos already covered by an album in the cart are free. */
  isCovered: (item: CartItem) => boolean;
  totalCents: number;
  count: number;
};

const STORAGE_KEY = `cart:${typeof window === "undefined" ? "" : window.location.hostname}`;
const CartContext = createContext<CartValue | null>(null);

function readCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as CartItem[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(readCart);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage can be unavailable (private mode); the cart still works in memory.
    }
  }, [items]);

  const add = useCallback((item: CartItem) => {
    setItems((previous) =>
      previous.some((existing) => existing.id === item.id) ? previous : [...previous, item],
    );
  }, []);
  const remove = useCallback(
    (id: string) => setItems((previous) => previous.filter((item) => item.id !== id)),
    [],
  );
  const removeMany = useCallback(
    (ids: string[]) => setItems((previous) => previous.filter((item) => !ids.includes(item.id))),
    [],
  );
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartValue>(() => {
    const albumIds = new Set(items.filter((item) => item.type === "album").map((item) => item.id));
    const isCovered = (item: CartItem) =>
      item.type === "photo" && item.albumId !== null && albumIds.has(item.albumId);
    return {
      items,
      add,
      remove,
      removeMany,
      clear,
      has: (id) => items.some((item) => item.id === id),
      isCovered,
      totalCents: items.reduce((sum, item) => sum + (isCovered(item) ? 0 : item.priceCents), 0),
      count: items.length,
    };
  }, [items, add, remove, removeMany, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>");
  return value;
}

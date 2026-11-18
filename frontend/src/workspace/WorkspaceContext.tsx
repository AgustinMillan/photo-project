import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError } from "../lib/api.ts";
import { accountApi, storesApi } from "../lib/endpoints.ts";
import type { Account, Store } from "../lib/types.ts";

const STORAGE_KEY = "photo.currentStoreId";

function readStoredStoreId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredStoreId(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage can be unavailable (private mode); the selection just won't persist.
  }
}

type WorkspaceValue = {
  loading: boolean;
  error: unknown;
  account: Account | null;
  stores: Store[];
  currentStore: Store | null;
  selectStore: (id: string) => void;
  reload: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(readStoredStoreId);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let nextAccount: Account | null = null;

      try {
        nextAccount = (await accountApi.get()).account;
      } catch (caught) {
        // A user who has not completed onboarding has no account yet.
        if (!(caught instanceof ApiError && caught.status === 404)) throw caught;
      }

      setAccount(nextAccount);
      setStores(nextAccount ? (await storesApi.list()).stores : []);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const currentStore = useMemo(
    () => stores.find((store) => store.id === currentId) ?? stores[0] ?? null,
    [stores, currentId],
  );

  const selectStore = useCallback((id: string) => {
    setCurrentId(id);
    writeStoredStoreId(id);
  }, []);

  const value = useMemo<WorkspaceValue>(
    () => ({ loading, error, account, stores, currentStore, selectStore, reload }),
    [loading, error, account, stores, currentStore, selectStore, reload],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);

  if (!value) {
    throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  }

  return value;
}

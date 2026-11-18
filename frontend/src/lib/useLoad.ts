import { useCallback, useEffect, useState } from "react";

type LoadState<T> = { data: T | null; error: unknown; loading: boolean };

/** Runs `load` on mount and whenever `deps` change; `reload()` re-runs it. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<LoadState<T>>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are provided by the caller
  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: null }));

    load()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ data: null, error, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  return { ...state, reload };
}

import { Alert, Spinner } from "../components/ui.tsx";
import { publicApi } from "../lib/endpoints.ts";
import { useLoad } from "../lib/useLoad.ts";

/** Public storefront placeholder. The API resolves the store from the Host header. */
export function StorefrontPage() {
  const { data, loading, error } = useLoad(() => publicApi.resolveStore(), []);

  if (loading) return <Spinner />;

  if (error || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <Alert>Esta página no existe.</Alert>
      </main>
    );
  }

  const { store } = data;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-5xl text-fg">{store.name}</h1>
      <p className="mt-4 max-w-md text-fg-dim">
        {store.publicationStatus === "published"
          ? "Pronto vas a poder ver las galerías de este estudio."
          : "Este estudio está preparando su vitrina."}
      </p>
    </main>
  );
}

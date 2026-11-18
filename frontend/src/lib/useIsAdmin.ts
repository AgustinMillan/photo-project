import { useEffect, useState } from "react";
import { adminApi } from "./endpoints.ts";

/** True when the signed-in user can open the platform admin dashboard. */
export function useIsAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    adminApi
      .me()
      .then((result) => {
        if (!cancelled) setAdmin(result.admin);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return admin;
}

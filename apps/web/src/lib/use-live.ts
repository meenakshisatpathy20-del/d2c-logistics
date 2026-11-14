"use client";

import { useCallback, useEffect, useState } from "react";
import { SHIPMENTS_CHANGED } from "./api";

/**
 * Loads data, refreshes it on a timer and whenever a booking changes shipments,
 * so the screen stays current without anyone pressing refresh.
 */
export function useLive<T>(load: () => Promise<T>, everyMs = 30_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [load]);

  useEffect(() => {
    // Start loading after the first paint; later refreshes run on a timer and on bookings.
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, everyMs);
    window.addEventListener(SHIPMENTS_CHANGED, refresh);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener(SHIPMENTS_CHANGED, refresh);
    };
  }, [refresh, everyMs]);

  return { data, error, refresh };
}

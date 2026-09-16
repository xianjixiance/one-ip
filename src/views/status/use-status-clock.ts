import { useEffect, useState } from "react";
import { STATUS_MAX_AGE } from "./freshness";

/** One expiry timer for the page; it never sends requests. */
export function useStatusClock(updatedAt: number[]) {
  const [now, setNow] = useState(Date.now);
  const nextExpiry = Math.min(
    ...updatedAt
      .map((time) => time + STATUS_MAX_AGE)
      .filter((time) => time > now),
  );
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, nextExpiry - Date.now()) + 1,
    );
    return () => window.clearTimeout(timer);
  }, [nextExpiry]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return now;
}

import { HttpError } from "@/lib/network";
import { createRequestScheduler } from "@/lib/request-scheduler";
import { detectSite, type Site } from "@/views/home/api";
import type { ProbeResult } from "./split-model";

const schedule = createRequestScheduler(6);
export async function probeSite(
  site: Site,
  signal: AbortSignal,
): Promise<ProbeResult> {
  signal.throwIfAborted();
  if (site.method === "unsupported")
    return { status: "unsupported", checkedAt: Date.now(), durationMs: 0 };
  return schedule(async () => {
    const start = performance.now();
    const result = (
      value: Omit<ProbeResult, "checkedAt" | "durationMs">,
    ): ProbeResult => ({
      ...value,
      checkedAt: Date.now(),
      durationMs: Math.round(performance.now() - start),
    });
    try {
      return result({ status: "success", geo: await detectSite(site, signal) });
    } catch (error) {
      signal.throwIfAborted(); // Cancellation must not become a failed network result.
      if (error instanceof HttpError)
        return result({ status: "http-error", httpStatus: error.status });
      if (error instanceof Error && error.name === "TimeoutError")
        return result({ status: "timeout" });
      if (error instanceof TypeError)
        return result({ status: "network-error" });
      return result({ status: "unreadable" });
    }
  }, signal);
}

import type { ServiceStatus } from "./api";

export const STATUS_MAX_AGE = 5 * 60_000;
export const statusQueryPolicy = {
  retry: false,
  staleTime: 60_000,
  refetchInterval: 120_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;

type StatusQuery = {
  data?: ServiceStatus;
  dataUpdatedAt: number;
  error: unknown;
  isPending: boolean;
};

/** Freshness uses the last successful receipt, never an incident's age. */
export function statusSnapshot(query: StatusQuery, now: number) {
  const expired = Boolean(
    query.data && now - query.dataUpdatedAt >= STATUS_MAX_AGE,
  );
  const historical = Boolean(query.data && (query.error || expired));
  return {
    indicator: historical ? undefined : query.data?.status?.indicator,
    previousIndicator: historical ? query.data?.status?.indicator : undefined,
    historical,
    freshness: expired
      ? ("expired" as const)
      : query.error
        ? ("error" as const)
        : query.isPending
          ? ("pending" as const)
          : ("current" as const),
  };
}

export type StatusSnapshot = ReturnType<typeof statusSnapshot>;

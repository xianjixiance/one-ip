import { useQueries, useQueryClient } from "@tanstack/react-query";
import { getGeo } from "./api";
import sites from "./sites.json";
import { probeTarget, type SplitRow } from "./split-model";
import { probeSite } from "./split-probe";

export function useSplitProbes(enabled = true) {
  const client = useQueryClient();
  const queries = useQueries({
    queries: sites.map((site) => ({
      queryKey: ["split", site.name, "v2"],
      queryFn: ({ signal }: { signal: AbortSignal }) => probeSite(site, signal),
      enabled,
      staleTime: 60_000,
      retry: false,
    })),
  });
  const ips = [
    ...new Set(queries.flatMap((q) => (q.data?.geo ? [q.data.geo.ip] : []))),
  ];
  const geoQueries = useQueries({
    queries: ips.map((ip) => ({
      queryKey: ["geoip", ip],
      queryFn: ({ signal }: { signal: AbortSignal }) => getGeo(ip, signal),
      staleTime: 300_000,
      retry: false,
      enabled,
    })),
  });
  const geoByIp = new Map(ips.map((ip, i) => [ip, geoQueries[i]]));
  const rows: SplitRow[] = sites.map((site, i) => {
    const query = queries[i];
    const base = query.data?.geo;
    const geo = base && geoByIp.get(base.ip);
    return {
      ...site,
      id: site.name,
      target: probeTarget(site),
      result: query.data,
      geo: base
        ? {
            ...base,
            ...Object.fromEntries(
              Object.entries(geo?.data ?? {}).filter(
                ([, value]) => value !== undefined,
              ),
            ),
          }
        : undefined,
      pending: query.isFetching,
      visible: enabled,
      geoPending: !!base && !!geo?.isFetching,
    };
  });
  rows.sort(
    (a, b) =>
      Number(a.method === "unsupported") - Number(b.method === "unsupported"),
  );
  const busy = queries.some((q) => q.isFetching);
  const completed = rows.filter((row) => !row.pending && row.result).length;
  function retry(ids?: string[]) {
    return Promise.all(
      queries.flatMap((query, i) =>
        sites[i].method !== "unsupported" &&
        (!ids || ids.includes(sites[i].name))
          ? [query.refetch()]
          : [],
      ),
    );
  }
  return {
    rows,
    busy,
    completed,
    retry,
    stop: () => client.cancelQueries({ queryKey: ["split"] }),
  };
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { IpText } from "@/components/toolkit";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import {
  detectDnsExits,
  dnsSampleCount,
  type DnsProgress,
} from "@/views/dns-exit/api";
import { runWebRtc } from "@/views/webrtc/api";
import { useQuery } from "@tanstack/react-query";
import { getMyIp, getBrowserIp } from "./api";
import { compareAddresses } from "./split-model";

export function SplitNetworkChecks() {
  const [started, setStarted] = useState(false);
  const query = useQuery({
    queryKey: ["split-network-checks"],
    enabled: started,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal: outer }) => {
      const signal = AbortSignal.any([outer, AbortSignal.timeout(20_000)]);
      let dns: DnsProgress | undefined;
      const [http, ipv4, ipv6, udp] = await Promise.all([
        getMyIp(signal).catch(() => null),
        getBrowserIp(4, signal).catch(() => null),
        getBrowserIp(6, signal).catch(() => null),
        runWebRtc(undefined, signal).catch(() => null),
        detectDnsExits(signal, (state) => {
          dns = state;
        }).catch(() => null),
      ]);
      outer.throwIfAborted();
      return { http, ipv4, ipv6, udp, dns, checkedAt: Date.now() };
    },
  });
  const data = query.data;
  const udp = data?.udp?.results.filter((result) => result.public) ?? [];
  const dnsRows = data?.dns?.results ?? [];
  const resolver = (row: DnsProgress["results"][number]) => (
    <div key={row.ip} className="min-w-0 break-words">
      <IpText ip={row.ip} />
      <span className="ml-2 text-xs text-muted-foreground">
        {row.geo} · {row.sources.join(" / ")}
      </span>
    </div>
  );
  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("联合诊断")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              "同时检查 HTTP、IPv4 / IPv6、DNS 和 WebRTC，核对不同流量的出口。",
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            if (started) void query.refetch();
            else setStarted(true);
          }}
        >
          {t(
            query.isFetching
              ? "联合检测中…"
              : started
                ? "重新联合诊断"
                : "开始联合诊断",
          )}
        </Button>
      </div>
      {query.isFetching && (
        <p role="status" className="mt-4 text-xs text-muted-foreground">
          {t("正在采样，最多约 20 秒；暂时不可用的检测不会阻塞其他结果。")}
        </p>
      )}
      {data && !query.isFetching && (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("采样时间")} · {new Date(data.checkedAt).toLocaleString()}
          </p>
          <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {[
              ["本站 HTTP 出口", data.http?.ip],
              ["IPv4 探测出口", data.ipv4?.ip],
              ["IPv6 探测出口", data.ipv6?.ip],
              ["WebRTC 的 HTTP 对照出口", data.udp?.baseline?.ip],
            ].map(([label, ip]) => (
              <div key={label} className="min-w-0 border-b pb-2">
                <dt className="mb-1 text-xs text-muted-foreground">
                  {t(label!)}
                </dt>
                <dd className="break-all">
                  {ip ? <IpText ip={ip} /> : t("未取得结果")}
                </dd>
              </div>
            ))}
            <div className="min-w-0">
              <dt className="mb-1 text-xs text-muted-foreground">
                WebRTC / UDP
              </dt>
              <dd className="space-y-1">
                {udp.length ? (
                  udp.map((row) => (
                    <div
                      key={row.ip}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <IpText ip={row.ip} />
                      <span className="text-xs text-muted-foreground">
                        {t(
                          {
                            same: "与 HTTP 对照一致",
                            different: "与 HTTP 对照不同，请核对规则",
                            "different-family": "地址族不同，分别核查",
                            unknown: "对照结果未知",
                          }[compareAddresses(data.udp?.baseline?.ip, row.ip)],
                        )}
                      </span>
                    </div>
                  ))
                ) : (
                  <span>{t("未采集到公网 UDP 地址，不能据此判定安全。")}</span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs text-muted-foreground">
                {t("DNS 解析器")} ·{" "}
                {t("完成 {0}/{1} 次采样，失败 {2} 次", [
                  data.dns?.count ?? 0,
                  dnsSampleCount,
                  data.dns?.failed ?? 0,
                ])}
              </dt>
              <dd className="space-y-1">
                {dnsRows.length
                  ? dnsRows.slice(0, 3).map(resolver)
                  : t("未取得结果")}
                {dnsRows.length > 3 && (
                  <details className="pt-2">
                    <summary className="cursor-pointer text-xs underline underline-offset-4">
                      {t("展开其余 {0} 个解析器", [dnsRows.length - 3])}
                    </summary>
                    <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                      {dnsRows.slice(3).map(resolver)}
                    </div>
                  </details>
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            {t(
              "DNS 显示解析器地址；不同协议、地址族或目标的出口不同，不等于泄漏。未取得结果也不代表安全，请结合自己的分流规则判断。",
            )}
          </p>
          <div className="mt-3 flex gap-4 text-xs">
            <Link className="underline underline-offset-4" to="/network/dns">
              {t("完整 DNS 检测")}
            </Link>
            <Link
              className="underline underline-offset-4"
              to="/browser/privacy"
            >
              {t("完整 WebRTC 检测")}
            </Link>
          </div>
        </>
      )}
      {query.isError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {t("本次联合诊断未完成，请重试。")}
        </p>
      )}
    </section>
  );
}

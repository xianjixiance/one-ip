import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CountryFlag } from "@/components/country-flag";
import { IpText } from "@/components/toolkit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { useSplitProbes } from "./use-split-probes";

export function SplitResults() {
  const container = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setEnabled(true);
        observer.disconnect();
      }
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const { rows, busy } = useSplitProbes(enabled);
  const successes = rows.filter((row) => !row.pending && row.geo);
  const exits = [
    ...new Map(
      successes.map((row) => [row.geo!.ip, row.geo!] as const),
    ).values(),
  ];
  return (
    <Card ref={container} className="mb-3">
      <CardHeader>
        <div className="row-between">
          <CardTitle>{t("网站分流出口")}</CardTitle>
          <Link className="small muted" to="/network/exits">
            {t("查看全部 ›")}
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-1 sm:grid-cols-2">
          {exits.map((geo) => (
            <div
              key={geo.ip}
              className="flex min-w-0 items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs"
            >
              <CountryFlag code={geo.country_code} />
              <span className="min-w-0 flex-1">
                <IpText ip={geo.ip} />
              </span>
              <Link
                className="shrink-0 text-muted-foreground underline-offset-4 hover:underline"
                to="/network/exits"
              >
                {t("{0} 个站点", [
                  successes.filter((row) => row.geo?.ip === geo.ip).length,
                ])}
              </Link>
            </div>
          ))}
        </div>
        <p className="home-note pt-2" role="status">
          {busy || !enabled
            ? t("正在检测分流出口…")
            : t("已读取 {0}/{1} 个支持检测站点的出口；{2} 个暂不支持。", [
                successes.length,
                rows.filter((row) => row.method !== "unsupported").length,
                rows.filter((row) => row.method === "unsupported").length,
              ])}
        </p>
      </CardContent>
    </Card>
  );
}
